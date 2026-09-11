(() => {
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');

  const root = document.createElement('aside');
  root.className = 'dispatch-intelligence';
  root.setAttribute('aria-label', 'Response dispatch intelligence');
  root.innerHTML = `
    <header class="dispatch-head">
      <div>
        <span class="dispatch-kicker">RESPONSE DISPATCH · DEMO</span>
        <h2>Recommended response</h2>
      </div>
      <button id="dispatch-close" class="dispatch-close" type="button" aria-label="Close">×</button>
    </header>
    <div id="dispatch-body" class="dispatch-body">
      <div class="dispatch-empty">Select DISPATCH on an infrastructure asset to calculate a response recommendation.</div>
    </div>
  `;
  document.body.appendChild(root);

  const body = root.querySelector('#dispatch-body');
  root.querySelector('#dispatch-close').addEventListener('click', () => root.classList.remove('visible'));

  const teams = [
    { name: 'Northern Corridor Response Team 02', type: 'RAIL SECURITY / FIELD RESPONSE', distance: 8.4, eta: 13, availability: 'AVAILABLE', action: 'Secure the incident zone, protect the track and inspect the suspected tampering point.' },
    { name: 'Permanent Way Inspection Unit 07', type: 'TRACK / INFRASTRUCTURE', distance: 11.7, eta: 18, availability: 'AVAILABLE', action: 'Inspect the track, turnout and adjacent equipment for physical damage or interference.' },
    { name: 'Signal & Telecommunications Team 03', type: 'SIGNALLING / TELECOMS', distance: 16.2, eta: 24, availability: 'AVAILABLE', action: 'Verify signalling and wayside communications equipment and isolate affected equipment if required.' },
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>\'\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function chooseTeam(asset) {
    const type = String(asset?.asset_type || '').toUpperCase();
    if (type.includes('SIGNALLING') || type.includes('TELECOMMUNICATION')) return teams[2];
    if (type.includes('TRACK')) return teams[1];
    return teams[0];
  }

  function priorityFor(asset) {
    const status = String(asset?.status || '').toUpperCase();
    if (status === 'ALERT') return { label: 'CRITICAL', className: 'critical' };
    if (status === 'UNKNOWN') return { label: 'HIGH', className: 'high' };
    return { label: 'MEDIUM', className: 'medium' };
  }

  async function latestEvent() {
    const response = await fetch(`${apiBase}/api/v1/events?limit=1`);
    if (!response.ok) throw new Error(`Event lookup failed: ${response.status}`);
    const events = await response.json();
    return events?.at(-1)?.data || null;
  }

  async function openForAsset(assetId) {
    root.classList.add('visible');
    body.innerHTML = '<div class="dispatch-empty">CALCULATING RESPONSE RECOMMENDATION…</div>';
    try {
      const data = await latestEvent();
      const assets = data?.incident?.assets || [];
      const asset = assets.find(item => item.asset_id === assetId);
      if (!asset) throw new Error('Asset not found in latest incident');

      const team = chooseTeam(asset);
      const priority = priorityFor(asset);
      body.innerHTML = `
        <div class="dispatch-incident-strip"><span>INCIDENT</span><strong>${esc(data.alert_type || 'LINE BREACH')}</strong><em>${esc(data.segment || 'DEMO SECTOR')} · KM ${Number(data.km_marker || 0).toFixed(1)}</em></div>
        <section class="dispatch-asset">
          <div class="dispatch-status ${priority.className}">${priority.label} PRIORITY</div>
          <h3>${esc(asset.name)}</h3>
          <p>${esc(asset.condition)}</p>
        </section>
        <section class="dispatch-team-card">
          <div class="dispatch-section-label">NEAREST SUITABLE RESPONSE UNIT</div>
          <h3>${esc(team.name)}</h3>
          <span class="dispatch-team-type">${esc(team.type)}</span>
          <div class="dispatch-kpis">
            <div><small>DISTANCE</small><strong>${team.distance.toFixed(1)} KM</strong></div>
            <div><small>EST. ARRIVAL</small><strong>${team.eta} MIN</strong></div>
            <div><small>STATUS</small><strong>${esc(team.availability)}</strong></div>
          </div>
        </section>
        <section class="dispatch-action-card">
          <div class="dispatch-section-label">RECOMMENDED ACTION</div>
          <p>${esc(team.action)}</p>
          <div class="dispatch-sequence"><span>1</span> Secure <span>2</span> Verify <span>3</span> Report</div>
        </section>
        <button class="dispatch-primary" id="dispatch-confirm" type="button">DISPATCH RESPONSE · DEMO</button>
        <button class="dispatch-secondary" id="dispatch-reassign" type="button">VIEW OTHER RESPONSE UNITS</button>
        <div class="dispatch-footnote">Prototype recommendation only. No real field team or Transnet control system is contacted.</div>
      `;

      body.querySelector('#dispatch-confirm').addEventListener('click', () => {
        const button = body.querySelector('#dispatch-confirm');
        button.textContent = '✓ RESPONSE DISPATCH QUEUED';
        button.classList.add('queued');
        body.querySelector('.dispatch-footnote').textContent = 'Demo action recorded locally. Next step: complete the response and close the incident.';

        if (!body.querySelector('#dispatch-complete')) {
          const complete = document.createElement('button');
          complete.id = 'dispatch-complete';
          complete.type = 'button';
          complete.className = 'dispatch-secondary dispatch-complete';
          complete.textContent = 'COMPLETE RESPONSE → CLOSE INCIDENT';
          complete.addEventListener('click', () => {
            if (window.RailWatchResolution?.openForIncident) {
              window.RailWatchResolution.openForIncident(data, asset, team);
            }
          });
          button.insertAdjacentElement('afterend', complete);
        }
      });

      body.querySelector('#dispatch-reassign').addEventListener('click', () => {
        const next = teams[(teams.indexOf(team) + 1) % teams.length];
        body.querySelector('.dispatch-team-card h3').textContent = next.name;
        body.querySelector('.dispatch-team-type').textContent = next.type;
      });
    } catch (error) {
      body.innerHTML = `<div class="dispatch-empty">Unable to calculate the demo response.<br/><small>${esc(error.message)}</small></div>`;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action="dispatched"]');
    if (!button) return;
    openForAsset(button.dataset.id);
  });

  window.RailWatchDispatch = { openForAsset };
})();
