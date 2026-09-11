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
    <div class="resolution-body"><div class="resolution-empty">Complete the response workflow to close and document the incident.</div></div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.resolution-body');
  root.querySelector('.resolution-close').addEventListener('click', () => root.classList.remove('visible'));

  function esc(value) {
    return String(value ?? '').replace(/[&<>\'\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }
  function emitAudit(action, detail) {
    document.dispatchEvent(new CustomEvent('railwatch:audit', { detail: { action, detail, source: 'operator-resolution-demo', timestamp: new Date().toISOString() } }));
  }
  function riskFactors() {
    return [
      ['Incident severity', '+30'],
      ['Critical asset proximity', '+24'],
      ['Three monitored assets in zone', '+12'],
      ['Freight corridor sensitivity', '+10'],
      ['Potential operational interruption', '+10'],
    ];
  }
  function buildReportHtml(data, asset, team, stamp, closed) {
    const status = closed ? 'INCIDENT CLOSED · EVIDENCE PRESERVED' : 'RESPONSE COMPLETE · READY TO CLOSE';
    const assetName = asset?.name || 'Selected infrastructure asset';
    const teamName = team?.name || 'Assigned response unit';
    const factors = riskFactors().map(([label, value]) => `<tr><td>${esc(label)}</td><td><b>${esc(value)}</b></td></tr>`).join('');
    const evidence = [
      ['SIGNAL', data?.alert_type || 'LINE_BREACH', 'SIMULATED / DEMO'],
      ['LOCATION', `${data?.segment || 'Demo sector'} · KM ${Number(data?.km_marker || 0).toFixed(1)}`, 'SCHEMATIC GIS · DEMO'],
      ['ASSET', assetName, 'DEMO ASSET REGISTRY'],
      ['VERIFICATION', 'Operator evidence review completed', 'HUMAN OPERATOR'],
      ['RESPONSE', teamName, 'DEMO DISPATCH WORKFLOW'],
      ['PROOF', status, 'OPERATOR CLOSURE'],
    ].map(([stage, value, source]) => `<tr><td><b>${esc(stage)}</b></td><td>${esc(value)}</td><td>${esc(source)}</td></tr>`).join('');
    const proofPayload = JSON.stringify({ event_id: data?.event_id || 'DEMO', alert_type: data?.alert_type || 'LINE_BREACH', km_marker: Number(data?.km_marker || 0), asset: assetName, team: teamName, status });
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RailWatch Incident Report</title><style>
      body{font-family:Arial,sans-serif;padding:36px;color:#162028;max-width:980px;margin:auto;background:#fff;line-height:1.45}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.12em;color:#64727a}.meta{color:#66727a;margin:4px 0 24px}h1{margin:0 0 4px}.box{border:1px solid #d8e0e5;border-radius:8px;padding:16px;margin:12px 0}.label{font-size:11px;color:#68757d;font-weight:800;letter-spacing:.08em;margin-bottom:7px}.ok{color:#167642;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kv{border:1px solid #e1e7ea;padding:10px;border-radius:6px}.kv small{display:block;color:#68757d;font-weight:800;font-size:10px;letter-spacing:.08em}.kv b{display:block;margin-top:3px}.table{width:100%;border-collapse:collapse}.table td{border-top:1px solid #e4e9ec;padding:8px;text-align:left;vertical-align:top}.note{font-size:12px;color:#66727a}.report-actions{display:flex;gap:10px;margin:0 0 24px;padding:12px;background:#f3f6f8;border:1px solid #d8e0e5;border-radius:8px}.report-actions button{border:1px solid #b9c7cf;background:#162028;color:#fff;border-radius:6px;padding:10px 14px;font-weight:800;cursor:pointer}.report-actions button.secondary{background:#fff;color:#162028}@media(max-width:700px){.grid{grid-template-columns:1fr}}@media print{body{padding:0}.report-actions{display:none}.box{break-inside:avoid}}
    </style></head><body>
      <div class="report-actions"><button onclick="window.print()">PRINT REPORT</button><button class="secondary" onclick="downloadReport()">SAVE / DOWNLOAD REPORT</button></div>
      <div class="eyebrow">NAHALABS · RAILWATCH COMMAND CENTER</div>
      <h1>Incident Evidence Report</h1>
      <div class="meta">DEMO · NOT AN AUTHORITATIVE TRANSNET RECORD</div>
      <div class="box"><div class="label">CASE IDENTITY</div><div class="grid">
        <div class="kv"><small>INCIDENT ID</small><b>${esc(data?.event_id || 'DEMO-INCIDENT')}</b></div>
        <div class="kv"><small>SEVERITY</small><b>${esc(data?.severity || 'CRITICAL')}</b></div>
        <div class="kv"><small>ALERT TYPE</small><b>${esc(data?.alert_type || 'LINE BREACH')}</b></div>
        <div class="kv"><small>SENSOR</small><b>${esc(data?.sensor_id || 'DEMO SENSOR')}</b></div>
        <div class="kv"><small>LOCATION</small><b>${esc(data?.incident?.location_name || data?.segment || 'Demo sector')}</b></div>
        <div class="kv"><small>KM MARKER</small><b>${Number(data?.km_marker || 0).toFixed(1)}</b></div>
      </div></div>
      <div class="box"><div class="label">FINAL STATUS</div><div class="ok">${esc(status)}</div></div>
      <div class="box"><div class="label">RISK DECISION · RULE-FIRST DEMO</div><div class="grid"><div class="kv"><small>RISK SCORE</small><b>86 / 100 · HIGH RISK</b></div><div class="kv"><small>OPERATING IMPACT</small><b>Verify train movement before dispatch</b></div></div><table class="table"><tbody>${factors}</tbody></table><p class="note">Weights are explainable prototype values. This is not a predictive ML model.</p></div>
      <div class="box"><div class="label">EVIDENCE CHAIN</div><table class="table"><thead><tr><td><b>STAGE</b></td><td><b>RECORD</b></td><td><b>PROVENANCE</b></td></tr></thead><tbody>${evidence}</tbody></table></div>
      <div class="box"><div class="label">OPERATOR ACTIONS</div><div class="grid"><div class="kv"><small>ACKNOWLEDGEMENT</small><b>INCIDENT ACKNOWLEDGED</b></div><div class="kv"><small>VERIFICATION</small><b>ASSET / CCTV DEMO REVIEW</b></div><div class="kv"><small>DISPATCH</small><b>${esc(teamName)}</b></div><div class="kv"><small>CLOSURE</small><b>${closed ? 'OPERATOR CLOSED' : 'PENDING CLOSE'}</b></div></div></div>
      <div class="box"><div class="label">PROVENANCE & SAFETY BOUNDARY</div><p class="note">CCTV is simulated reference evidence. Network geometry is schematic. Asset records are demo records. No autonomous signalling, train movement, or field dispatch is performed by this prototype. Production deployment would attach authenticated source identifiers, timestamps, operator identity, integrity metadata, field reports, and authoritative GIS/network records.</p></div>
      <div class="box"><div class="label">REPORT</div><div class="grid"><div class="kv"><small>GENERATED</small><b>${esc(stamp)}</b></div><div class="kv"><small>RESPONSE UNIT</small><b>${esc(teamName)}</b></div></div></div>
      <div class="note">Prototype report generated locally by NahaLabs RailWatch Command Center.</div>
      <script>const proof=${JSON.stringify(proofPayload)};function downloadReport(){const doc='<!doctype html>'+document.documentElement.outerHTML.replace(/<script>[\\s\\S]*?<\\/script>/g,'');const blob=new Blob([doc],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='railwatch-incident-report.html';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}</script>
    </body></html>`;
  }

  function openForIncident(data, asset, team) {
    root.classList.add('visible');
    const stamp = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const assetName = asset?.name || 'Selected infrastructure asset';
    const teamName = team?.name || 'Assigned response unit';
    let closed = false;
    body.innerHTML = `
      <section class="resolution-status closed-ready"><span>INCIDENT STATUS</span><strong>RESPONSE COMPLETE · READY TO CLOSE</strong></section>
      <section class="resolution-summary"><div><small>INCIDENT</small><strong>${esc(data?.alert_type || 'LINE BREACH')}</strong></div><div><small>LOCATION</small><strong>${esc(data?.segment || 'Demo sector')} · KM ${Number(data?.km_marker || 0).toFixed(1)}</strong></div><div><small>ASSET</small><strong>${esc(assetName)}</strong></div><div><small>RESPONSE UNIT</small><strong>${esc(teamName)}</strong></div></section>
      <section class="resolution-timeline"><div class="resolution-section-label">RESPONSE TIMELINE</div><div class="resolution-event"><b>DETECTED</b><span>Line-breach signal received · ${esc(stamp)}</span></div><div class="resolution-event"><b>LOCATED</b><span>Incident positioned at KM ${Number(data?.km_marker || 0).toFixed(1)}</span></div><div class="resolution-event"><b>VERIFIED</b><span>Asset reviewed via demo evidence workflow</span></div><div class="resolution-event"><b>DISPATCHED</b><span>${esc(teamName)} response queued</span></div><div class="resolution-event"><b>RESOLVED</b><span>Awaiting operator confirmation to close case</span></div></section>
      <section class="resolution-evidence"><div class="resolution-section-label">EVIDENCE CAPTURED</div><div class="evidence-chip-row"><span>✓ SENSOR EVENT</span><span>✓ ASSET RECORD</span><span>✓ CCTV DEMO</span><span>✓ RESPONSE ACTION</span></div><p>Prototype evidence trail. Production deployment would attach authenticated sensor records, field reports, CCTV references and operator audit events.</p></section>
      <button class="resolution-primary" id="close-incident" type="button">CLOSE INCIDENT · DEMO</button><button class="resolution-secondary" id="view-report" type="button">VIEW INCIDENT REPORT</button>`;

    body.querySelector('#close-incident').addEventListener('click', () => {
      closed = true;
      const status = body.querySelector('.resolution-status');
      status.classList.remove('closed-ready'); status.classList.add('closed');
      status.querySelector('strong').textContent = 'INCIDENT CLOSED · EVIDENCE PRESERVED';
      body.querySelector('.resolution-event:last-child span').textContent = 'Incident closed by operator · evidence package recorded';
      const button = body.querySelector('#close-incident'); button.textContent = '✓ INCIDENT CLOSED'; button.disabled = true;
      const proof = document.createElement('div'); proof.className = 'resolution-proof-ready'; proof.innerHTML = '<strong>PROOF PACKAGE READY</strong><span>Timeline, evidence references and operator closure are recorded for this demo case.</span>'; button.insertAdjacentElement('afterend', proof);
      emitAudit('INCIDENT_CLOSED', `${data?.alert_type || 'LINE BREACH'} · ${assetName} · ${teamName}`);
    });
    body.querySelector('#view-report').addEventListener('click', () => { const report = window.open('', '_blank', 'width=980,height=820'); if (!report) return; report.document.open(); report.document.write(buildReportHtml(data, asset, team, stamp, closed)); report.document.close(); emitAudit('INCIDENT_REPORT_VIEWED', assetName); });
    emitAudit('RESOLUTION_OPENED', `${assetName} · ${teamName}`);
  }
  window.RailWatchResolution = { openForIncident };
})();
