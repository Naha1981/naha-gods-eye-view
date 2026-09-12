(() => {
  const q = new URLSearchParams(location.search);
  const apiBase = (q.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
  const ingestKey = q.get('ingest') || '';
  let current = null;
  let timer = null;
  let operatorToken = '';

  const panel = document.createElement('section');
  panel.id = 'railwatch-ops-assurance';
  panel.setAttribute('aria-label', 'RailWatch operator assurance');
  panel.innerHTML = `<div class="ops-head"><span class="ops-title">OPERATOR ASSURANCE</span><span class="ops-badge" id="ops-health">CHECKING</span></div><div class="ops-body"><div class="ops-grid"><div class="ops-cell"><span>STAGE</span><strong id="ops-stage">DETECT</strong></div><div class="ops-cell"><span>ESCALATION</span><strong id="ops-rule">—</strong></div><div class="ops-cell"><span>ACK SLA</span><strong id="ops-ack">—</strong></div><div class="ops-cell"><span>DISPATCH SLA</span><strong id="ops-dispatch">—</strong></div></div><div class="ops-timeline" id="ops-timeline"><div class="ops-event ops-muted">Waiting for an incident…</div></div><div class="ops-actions"><button data-action="ACKNOWLEDGE">ACK</button><button data-action="VERIFY">VERIFY</button><button data-action="DISPATCH">DISPATCH</button><button data-action="RESOLVE">RESOLVE</button><button data-action="PROVE">PROVE</button><button id="ops-replay">REPLAY</button></div><div class="ops-foot"><span id="ops-store">Storage: checking…</span><br><span>Deterministic rules are advisory workflow logic. Demo data is not certified rail-control data.</span></div></div>`;
  document.body.appendChild(panel);

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmt = seconds => seconds <= 0 ? 'DUE' : `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${Math.floor(seconds % 60).toString().padStart(2,'0')}`;

  async function refreshHealth(){
    try{
      const response = await fetch(`${apiBase}/api/v1/operations/health`, {cache:'no-store'});
      const data = await response.json();
      $('ops-health').textContent = data.status === 'ok' ? 'ONLINE' : 'DEGRADED';
      const capabilities = data.capabilities || {};
      $('ops-store').textContent = `Ops: ${data.service} · Signed: ${capabilities.signed_telemetry ? 'ON' : 'OFF'} · RBAC: ${capabilities.rbac ? 'ON' : 'OFF'} · Audit: ${capabilities.server_audit ? 'ON' : 'OFF'} · Redis: ${capabilities.redis_event_bus ? 'ON' : 'READY'}`;
    }catch(e){ $('ops-health').textContent = 'OFFLINE'; $('ops-store').textContent = 'Operations API unavailable'; }
  }

  async function refreshIncident(){
    if(!current) return;
    try{
      const [slaRes, replayRes] = await Promise.all([
        fetch(`${apiBase}/api/v1/incidents/${encodeURIComponent(current.event_id)}/sla`, {cache:'no-store'}),
        fetch(`${apiBase}/api/v1/incidents/${encodeURIComponent(current.event_id)}/replay`, {cache:'no-store'})
      ]);
      const sla = await slaRes.json();
      const replay = await replayRes.json();
      $('ops-stage').textContent = String(sla.stage || current.severity || 'DETECT');
      $('ops-rule').textContent = current.operations?.rules?.recommended_escalation || replay.rules?.recommended_escalation || 'STANDARD';
      $('ops-ack').textContent = fmt(Number(sla.milestones?.ACK?.remaining_seconds ?? 0));
      $('ops-dispatch').textContent = fmt(Number(sla.milestones?.DISPATCH?.remaining_seconds ?? 0));
      $('ops-timeline').innerHTML = (replay.timeline || []).map(item => `<div class="ops-event"><b>${esc(item.action)}</b> · ${esc(item.actor)}<br><span class="ops-muted">${esc(new Date(item.timestamp).toLocaleTimeString())}</span></div>`).join('') || '<div class="ops-event ops-muted">No timeline yet.</div>';
    }catch(e){}
  }

  async function getOperatorToken(){
    if(operatorToken) return operatorToken;
    try{
      const headers = ingestKey ? {'x-railwatch-key': ingestKey} : {};
      const response = await fetch(`${apiBase}/api/v1/auth/demo-token?role=controller&operator=demo-controller`, {method:'POST', headers});
      if(!response.ok) return '';
      const data = await response.json(); operatorToken = data.token || ''; return operatorToken;
    }catch(e){ return ''; }
  }

  async function performAction(action){
    if(!current) return;
    const token = await getOperatorToken();
    if(!token){ $('ops-health').textContent='DEMO AUTH UNAVAILABLE'; return; }
    try{
      const response = await fetch(`${apiBase}/api/v1/incidents/${encodeURIComponent(current.event_id)}/action`, {method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${token}`}, body:JSON.stringify({action})});
      if(response.ok){ document.dispatchEvent(new CustomEvent('railwatch:audit',{detail:{action:`OPERATOR_${action}`,event_id:current.event_id,actor:'demo-controller',timestamp:new Date().toISOString()}})); await refreshIncident(); }
    }catch(e){}
  }

  panel.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => performAction(button.dataset.action)));
  $('ops-replay').addEventListener('click', async () => { if(current) { await refreshIncident(); $('ops-timeline').scrollTop = $('ops-timeline').scrollHeight; } });
  document.addEventListener('railwatch:incident', event => { current = event.detail; clearInterval(timer); refreshIncident(); timer = setInterval(refreshIncident, 1000); });
  document.addEventListener('railwatch:stage', refreshIncident);
  refreshHealth();
  setInterval(refreshHealth, 15000);
})();