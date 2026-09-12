(() => {
  const root = document.createElement('aside');
  root.className = 'audit-feed-panel';
  root.setAttribute('aria-label', 'Incident audit trail');
  root.innerHTML = `
    <header class="audit-head">
      <div><span class="audit-kicker">AUDIT TRAIL · DEMO</span><h2>Incident activity</h2></div>
      <button class="audit-close" type="button" aria-label="Close">×</button>
    </header>
    <div class="audit-list" id="audit-list"><div class="audit-empty">No incident activity yet.</div></div>
    <footer class="audit-foot">DEMO EVENTS · NOT AN AUTHORITATIVE TRANSNET AUDIT LOG</footer>
  `;
  document.body.appendChild(root);
  const list = root.querySelector('#audit-list');
  const events = [];
  const seen = new Set();

  root.querySelector('.audit-close').addEventListener('click', () => root.classList.remove('visible'));

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function add(action, detail, tone = '', reveal = false) {
    const key = `${action}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.unshift({ action, detail, tone, time: timeNow() });
    if (events.length > 12) events.pop();
    if (reveal) root.classList.add('visible');
    render();
  }

  function render() {
    list.innerHTML = events.length ? events.map(item => `
      <article class="audit-event ${item.tone}">
        <span class="audit-dot"></span>
        <div><strong>${item.action}</strong><p>${item.detail}</p><small>${item.time}</small></div>
      </article>`).join('') : '<div class="audit-empty">No incident activity yet.</div>';
  }

  document.addEventListener('railwatch:incident', event => {
    const data = event.detail || {};
    add('INCIDENT DETECTED', `${data.alert_type || 'LINE BREACH'} · ${data.segment || 'Demo sector'} · KM ${Number(data.km_marker || 0).toFixed(1)}`, 'critical', false);
  });

  document.addEventListener('railwatch:stage', event => {
    const stage = event.detail?.stage;
    if (!stage) return;
    const messages = {
      LOCATE: 'Incident positioned and mapped',
      VERIFY: 'Infrastructure asset selected for verification',
      RESPOND: 'Response action initiated',
      RESOLVE: 'Response completed · case ready to close',
      PROVE: 'Incident closed · evidence preserved',
    };
    add(stage, messages[stage] || 'Workflow stage advanced', stage === 'PROVE' ? 'success' : 'info', false);
  });

  document.addEventListener('railwatch:audit', event => {
    const action = event.detail?.action;
    const detail = event.detail?.detail;
    if (action) add(action, detail || 'Operator action recorded', action.includes('SEALED') ? 'success' : 'info', false);
  });

  document.addEventListener('click', event => {
    const el = event.target.closest('button, [role="button"]');
    if (!el) return;
    if (el.matches('[data-action="verify"]')) add('FIELD VERIFICATION', 'Operator marked selected asset for field verification', 'info', false);
    if (el.matches('[data-action="cctv"]')) add('CCTV EVIDENCE', 'Operator opened demo CCTV evidence', 'info', false);
    if (el.id === 'cctv-verified') add('VISUAL CHECK', 'Operator confirmed demo visual check', 'success', false);
    if (el.matches('.dispatch-access-btn')) add('DISPATCH REVIEW', 'Response recommendation opened', 'info', false);
    if (el.id === 'dispatch-confirm') add('RESPONSE QUEUED', 'Demo response dispatch recorded locally', 'warning', false);
    if (el.id === 'close-incident') add('INCIDENT CLOSED', 'Operator closed the demo incident and preserved evidence', 'success', false);
    if (el.id === 'view-report') add('REPORT OPENED', 'Incident evidence report opened in a new tab', 'info', false);
  });
})();
