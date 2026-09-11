(() => {
  const root = document.createElement('aside');
  root.className = 'incident-history';
  root.setAttribute('aria-label', 'Incident history');
  root.innerHTML = `
    <header class="incident-history-head">
      <div>
        <span class="incident-history-kicker">OPERATIONS HISTORY · DEMO</span>
        <h2>Incident history</h2>
      </div>
      <button class="incident-history-close" type="button" aria-label="Close">×</button>
    </header>
    <div class="incident-history-toolbar">
      <span id="incident-history-count">0 CASES</span>
      <button id="incident-history-toggle" type="button">SHOW HISTORY</button>
    </div>
    <div id="incident-history-list" class="incident-history-list">
      <div class="incident-history-empty">No incidents recorded in this session.</div>
    </div>
  `;
  document.body.appendChild(root);

  const list = root.querySelector('#incident-history-list');
  const count = root.querySelector('#incident-history-count');
  const toggle = root.querySelector('#incident-history-toggle');
  const cases = [];
  let open = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>\'\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function statusFor(item) {
    return item.closed ? 'CLOSED' : 'ACTIVE';
  }

  function render() {
    count.textContent = `${cases.length} ${cases.length === 1 ? 'CASE' : 'CASES'}`;
    if (!cases.length) {
      list.innerHTML = '<div class="incident-history-empty">No incidents recorded in this session.</div>';
      return;
    }
    list.innerHTML = cases.map((item, index) => `
      <button class="incident-history-row" type="button" data-index="${index}">
        <div class="incident-history-row-top">
          <strong>${esc(item.alert)}</strong>
          <span class="incident-history-status ${item.closed ? 'closed' : 'active'}">${statusFor(item)}</span>
        </div>
        <div class="incident-history-location">${esc(item.segment)} · KM ${esc(item.km)}</div>
        <div class="incident-history-meta">${esc(item.assetCount)} assets · ${esc(item.time)}</div>
      </button>
    `).join('');
  }

  function record(data) {
    const item = {
      eventId: data?.event_id || `demo-${Date.now()}`,
      alert: String(data?.alert_type || 'LINE BREACH').replace(/_/g, ' '),
      segment: data?.segment || 'Demo sector',
      km: Number(data?.km_marker || 0).toFixed(1),
      assetCount: Array.isArray(data?.incident?.assets) ? data.incident.assets.length : 0,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      closed: false,
      data,
    };
    const existing = cases.findIndex(item => item.eventId === item.eventId);
    if (existing >= 0) cases.splice(existing, 1);
    cases.unshift(item);
    if (cases.length > 12) cases.length = 12;
    render();
  }

  function markClosed(eventId) {
    const item = cases.find(entry => entry.eventId === eventId);
    if (item) {
      item.closed = true;
      render();
    }
  }

  function showDetail(item) {
    if (!item?.data) return;
    window.RailWatchControlRoom?.ingest?.(item.data);
    document.dispatchEvent(new CustomEvent('railwatch:history-selected', { detail: item.data }));
  }

  root.querySelector('.incident-history-close').addEventListener('click', () => root.classList.remove('visible'));
  toggle.addEventListener('click', () => {
    open = !open;
    root.classList.toggle('visible', open);
    toggle.textContent = open ? 'HIDE HISTORY' : 'SHOW HISTORY';
  });
  list.addEventListener('click', event => {
    const row = event.target.closest('[data-index]');
    if (!row) return;
    showDetail(cases[Number(row.dataset.index)]);
  });

  document.addEventListener('railwatch:incident', event => record(event.detail));
  document.addEventListener('railwatch:incident-closed', event => markClosed(event.detail?.eventId));

  window.RailWatchHistory = { record, markClosed, show: () => { open = true; root.classList.add('visible'); toggle.textContent = 'HIDE HISTORY'; } };
})();
