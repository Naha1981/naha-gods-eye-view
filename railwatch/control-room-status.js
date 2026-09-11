(() => {
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');

  const root = document.createElement('section');
  root.className = 'control-room-status';
  root.setAttribute('aria-label', 'Incident status overview');
  root.innerHTML = `
    <div class="crs-main">
      <span class="crs-kicker">INCIDENT CONTROL · DEMO</span>
      <strong id="crs-title">NO ACTIVE INCIDENT</strong>
      <span id="crs-location">Waiting for telemetry</span>
    </div>
    <div class="crs-stage-row" aria-label="Response progress">
      <span class="crs-stage active" data-stage="DETECT">DETECT</span>
      <span class="crs-stage" data-stage="LOCATE">LOCATE</span>
      <span class="crs-stage" data-stage="VERIFY">VERIFY</span>
      <span class="crs-stage" data-stage="RESPOND">RESPOND</span>
      <span class="crs-stage" data-stage="RESOLVE">RESOLVE</span>
      <span class="crs-stage" data-stage="PROVE">PROVE</span>
    </div>
    <div class="crs-metrics">
      <div><small>STATUS</small><strong id="crs-status">STANDBY</strong></div>
      <div><small>PRIORITY</small><strong id="crs-priority">—</strong></div>
      <div><small>ASSETS</small><strong id="crs-assets">0</strong></div>
      <div><small>UNRESOLVED</small><strong id="crs-unresolved">0</strong></div>
    </div>
  `;
  document.body.appendChild(root);

  const title = root.querySelector('#crs-title');
  const locationEl = root.querySelector('#crs-location');
  const status = root.querySelector('#crs-status');
  const priority = root.querySelector('#crs-priority');
  const assets = root.querySelector('#crs-assets');
  const unresolved = root.querySelector('#crs-unresolved');
  const stages = [...root.querySelectorAll('.crs-stage')];

  const stageIndex = { DETECT: 0, LOCATE: 1, VERIFY: 2, RESPOND: 3, RESOLVE: 4, PROVE: 5 };

  function updateStage(stage) {
    const index = stageIndex[stage] ?? 0;
    stages.forEach((el, i) => {
      el.classList.toggle('active', i === index);
      el.classList.toggle('complete', i < index);
    });
  }

  function ingest(data) {
    const incident = data?.incident;
    if (!incident) return;
    const assetList = Array.isArray(incident.assets) ? incident.assets : [];
    const unresolvedCount = assetList.filter(asset => {
      const value = String(asset.status || '').toUpperCase();
      return value === 'ALERT' || value === 'UNKNOWN';
    }).length;
    title.textContent = String(data.alert_type || 'LINE BREACH').replace(/_/g, ' ');
    locationEl.textContent = `${data.segment || 'Demo sector'} · KM ${Number(data.km_marker || 0).toFixed(1)}`;
    status.textContent = 'ACTIVE';
    priority.textContent = String(data.severity || 'CRITICAL').toUpperCase();
    assets.textContent = String(assetList.length);
    unresolved.textContent = String(unresolvedCount);
    root.classList.add('has-incident');
    updateStage('DETECT');
  }

  function setResolutionStage(stage) {
    updateStage(stage);
    if (stage === 'RESOLVE') status.textContent = 'READY TO CLOSE';
    if (stage === 'PROVE') status.textContent = 'CLOSED · EVIDENCE PRESERVED';
  }

  async function hydrateRecentIncident() {
    try {
      const response = await fetch(`${apiBase}/api/v1/events?limit=1`);
      if (!response.ok) return;
      const events = await response.json();
      const latest = events?.at(-1)?.data;
      if (latest) ingest(latest);
    } catch (_) {
      // Main map and operator workflow remain usable if the API is unavailable.
    }
  }

  document.addEventListener('railwatch:incident', event => ingest(event.detail));
  document.addEventListener('railwatch:stage', event => setResolutionStage(event.detail?.stage));
  window.RailWatchControlRoom = { ingest, setResolutionStage };
  hydrateRecentIncident();
})();
