(() => {
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
  const root = document.createElement('aside');
  root.className = 'ai-intelligence-panel';
  root.setAttribute('aria-label', 'RailWatch AI intelligence');
  root.innerHTML = `
    <header class="ai-intelligence-head">
      <div>
        <span class="ai-kicker">NAHALLM · OPERATOR INTELLIGENCE</span>
        <h2>AI Intelligence</h2>
        <p>Use AI to understand the incident, challenge assumptions and prepare a management summary. Human operators remain responsible for decisions.</p>
      </div>
      <button class="ai-close" type="button" aria-label="Close AI intelligence">×</button>
    </header>
    <div class="ai-status" id="ai-status">Checking NahaLLM gateway…</div>
    <div class="ai-intelligence-actions">
      <button id="ai-brief" class="primary" type="button" disabled>GENERATE INCIDENT BRIEF</button>
      <button id="ai-challenge" type="button" disabled>CHALLENGE DECISION</button>
      <button id="ai-summary" type="button" disabled>PREPARE MANAGEMENT SUMMARY</button>
    </div>
    <div id="ai-result" class="ai-result empty">Simulate an incident first. AI analysis will appear here after you select the active case.</div>
    <div id="ai-meta" class="ai-meta"></div>
    <div class="ai-boundary">AI output is decision support, not a signalling instruction or autonomous dispatch decision. Demo GIS, CCTV and asset data remain synthetic unless a future authoritative adapter is connected.</div>
  `;
  document.body.appendChild(root);

  const $ = selector => root.querySelector(selector);
  const status = $('#ai-status');
  const result = $('#ai-result');
  const meta = $('#ai-meta');
  const buttons = ['#ai-brief', '#ai-challenge', '#ai-summary'].map(selector => $(selector));
  let currentIncidentId = '';

  function setMessage(text, kind = '') {
    status.textContent = text;
    status.className = `ai-status${kind ? ` ${kind}` : ''}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, { method: options.method || 'GET', headers: options.headers || {} });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { detail: text }; }
    if (!response.ok) throw new Error(body.detail || body.message || `HTTP ${response.status}`);
    return body;
  }

  async function refreshStatus() {
    try {
      const data = await request('/api/v1/ai/status');
      const configured = Boolean(data.configured);
      setMessage(configured ? `NahaLLM ready · ${data.model}` : 'NahaLLM is not configured on the RailWatch server.', configured ? 'ready' : 'warn');
      buttons.forEach(button => { button.disabled = !configured || !currentIncidentId; });
    } catch (error) {
      setMessage(error.message || 'NahaLLM status unavailable.', 'warn');
      buttons.forEach(button => { button.disabled = true; });
    }
  }

  async function run(feature, button, label) {
    if (!currentIncidentId) return;
    const original = button.textContent;
    buttons.forEach(item => { item.disabled = true; });
    button.textContent = `${label}…`;
    result.className = 'ai-result';
    result.textContent = 'NahaLLM is analysing the current incident…';
    meta.textContent = '';
    try {
      const data = await request(`/api/v1/ai/incident/${encodeURIComponent(currentIncidentId)}/${feature}`, { method: 'POST' });
      result.textContent = data.text || 'No AI output returned.';
      meta.textContent = [data.provider ? `Provider: ${data.provider}` : '', data.model ? `Model alias: ${data.model}` : '', data.request_id ? `Request: ${data.request_id}` : ''].filter(Boolean).join(' · ');
      setMessage('AI analysis complete · human review required.', 'ready');
      document.dispatchEvent(new CustomEvent('railwatch:audit', { detail: { action: 'AI_ANALYSIS_GENERATED', detail: `${data.feature || feature} · ${currentIncidentId}`, source: 'nahallm' } }));
    } catch (error) {
      result.className = 'ai-result empty';
      result.textContent = error.message || 'AI analysis unavailable.';
      setMessage('AI request failed; existing RailWatch workflow remains available.', 'warn');
    } finally {
      buttons.forEach(item => { item.disabled = !currentIncidentId; });
      button.textContent = original;
    }
  }

  $('#ai-brief').addEventListener('click', event => run('brief', event.currentTarget, 'GENERATING BRIEF'));
  $('#ai-challenge').addEventListener('click', event => run('challenge', event.currentTarget, 'CHALLENGING DECISION'));
  $('#ai-summary').addEventListener('click', event => run('summary', event.currentTarget, 'PREPARING SUMMARY'));
  $('.ai-close').addEventListener('click', () => window.RailWatchWorkspace?.close());

  document.addEventListener('railwatch:incident', event => {
    currentIncidentId = String(event.detail?.event_id || '');
    buttons.forEach(button => { button.disabled = !currentIncidentId; });
    if (currentIncidentId) {
      result.className = 'ai-result empty';
      result.textContent = 'Incident loaded. Choose an AI function above.';
    }
  });

  window.RailWatchAI = { refreshStatus };
  document.addEventListener('railwatch:workspace-opened', event => {
    if (event.detail?.type === 'ai') refreshStatus();
  });
  refreshStatus();
})();
