(() => {
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');

  const root = document.createElement('aside');
  root.className = 'resolution-intelligence';
  root.setAttribute('aria-label', 'Incident resolution and evidence');
  root.innerHTML = `
    <header class="resolution-head">
      <div>
        <span class="resolution-kicker">RESOLVE → PROVE · DEMO</span>
        <h2>Incident resolution</h2>
      </div>
      <button class="resolution-close" type="button" aria-label="Close">×</button>
    </header>
    <div class="resolution-body">
      <div class="resolution-empty">Complete the response workflow to close and document the incident.</div>
    </div>`;
  document.body.appendChild(root);

  const body = root.querySelector('.resolution-body');
  root.querySelector('.resolution-close').addEventListener('click', () => root.classList.remove('visible'));

  function esc(value) {
    return String(value ?? '').replace(/[&<>\'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function openForIncident(data, asset, team) {
    root.classList.add('visible');
    const now = new Date();
    const stamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const assetName = asset?.name || 'Selected infrastructure asset';
    const teamName = team?.name || 'Assigned response unit';
    body.innerHTML = `
      <section class="resolution-status closed-ready">
        <span>INCIDENT STATUS</span>
        <strong>RESPONSE COMPLETE · READY TO CLOSE</strong>
      </section>
      <section class="resolution-summary">
        <div><small>INCIDENT</small><strong>${esc(data?.alert_type || 'LINE BREACH')}</strong></div>
        <div><small>LOCATION</small><strong>${esc(data?.segment || 'Demo sector')} · KM ${Number(data?.km_marker || 0).toFixed(1)}</strong></div>
        <div><small>ASSET</small><strong>${esc(assetName)}</strong></div>
        <div><small>RESPONSE UNIT</small><strong>${esc(teamName)}</strong></div>
      </section>
      <section class="resolution-timeline">
        <div class="resolution-section-label">RESPONSE TIMELINE</div>
        <div class="resolution-event"><b>DETECTED</b><span>Line-breach signal received · ${stamp}</span></div>
        <div class="resolution-event"><b>LOCATED</b><span>Incident positioned at KM ${Number(data?.km_marker || 0).toFixed(1)}</span></div>
        <div class="resolution-event"><b>VERIFIED</b><span>Asset reviewed via demo evidence workflow</span></div>
        <div class="resolution-event"><b>DISPATCHED</b><span>${esc(teamName)} response queued</span></div>
        <div class="resolution-event"><b>RESOLVED</b><span>Awaiting operator confirmation to close case</span></div>
      </section>
      <section class="resolution-evidence">
        <div class="resolution-section-label">EVIDENCE CAPTURED</div>
        <div class="evidence-chip-row">
          <span>✓ SENSOR EVENT</span><span>✓ ASSET RECORD</span><span>✓ CCTV DEMO</span><span>✓ RESPONSE ACTION</span>
        </div>
        <p>Prototype evidence trail. Production deployment would attach authenticated sensor records, field reports, CCTV references and operator audit events.</p>
      </section>
      <button class="resolution-primary" id="close-incident" type="button">CLOSE INCIDENT · DEMO</button>
      <button class="resolution-secondary" id="view-report" type="button">VIEW INCIDENT REPORT</button>
    `;

    body.querySelector('#close-incident').addEventListener('click', () => {
      body.querySelector('.resolution-status').classList.remove('closed-ready');
      body.querySelector('.resolution-status').classList.add('closed');
      body.querySelector('.resolution-status strong').textContent = 'INCIDENT CLOSED · EVIDENCE PRESERVED';
      body.querySelector('.resolution-event:last-child span').textContent = 'Incident closed by operator · evidence package recorded';
      body.querySelector('#close-incident').textContent = '✓ INCIDENT CLOSED';
      body.querySelector('#close-incident').disabled = true;
    });

    body.querySelector('#view-report').addEventListener('click', () => {
      const report = window.open('', '_blank', 'width=920,height=760');
      if (!report) return;
      report.document.write(`<!doctype html><html><head><title>RailWatch Incident Report</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#162028}h1{margin-bottom:4px}.meta{color:#66727a;margin-bottom:26px}.box{border:1px solid #d8e0e5;border-radius:8px;padding:16px;margin:12px 0}.ok{color:#167642;font-weight:800}.label{font-size:11px;color:#68757d;font-weight:800;letter-spacing:.08em}.row{margin:10px 0}.footer{margin-top:30px;font-size:12px;color:#68757d}</style></head><body><h1>RailWatch Incident Report</h1><div class="meta">DEMO · NOT AN AUTHORITATIVE TRANSNET RECORD</div><div class="box"><div class="label">INCIDENT</div><div class="row"><b>${esc(data?.alert_type || 'LINE BREACH')}</b> · ${esc(data?.segment || 'Demo sector')} · KM ${Number(data?.km_marker || 0).toFixed(1)}</div><div class="row">Asset: ${esc(assetName)}</div><div class="row">Response unit: ${esc(teamName)}</div></div><div class="box"><div class="label">STATUS</div><div class="row ok">INCIDENT CLOSED · EVIDENCE PRESERVED</div></div><div class="box"><div class="label">EVIDENCE PACKAGE</div><div class="row">Sensor event · Asset record · CCTV demo evidence · Response action · Operator closure</div></div><div class="box"><div class="label">TIMELINE</div><div class="row">Detected → Located → Verified → Dispatched → Resolved → Closed</div></div><div class="footer">Prototype report generated locally by NahaLabs RailWatch Command Center.</div></body></html>`);
      report.document.close();
    });
  }

  window.RailWatchResolution = { openForIncident };
})();
