(() => {
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');

  const root = document.createElement('aside');
  root.className = 'whatsapp-panel';
  root.setAttribute('aria-label', 'WhatsApp operations');
  root.innerHTML = `
    <header class="whatsapp-head">
      <div>
        <span class="whatsapp-kicker">NAHALABS CHANNEL COMMAND</span>
        <h2>WhatsApp Operations</h2>
        <p>Pair the authorised operations WhatsApp account, receive incident alerts and use controlled text commands. No WhatsApp credentials are handled here.</p>
      </div>
      <button type="button" class="whatsapp-close" aria-label="Close WhatsApp operations">×</button>
    </header>
    <div class="whatsapp-status-grid">
      <div class="whatsapp-status-card"><span>OPERATOR</span><strong id="wa-operator-status">CHECKING…</strong></div>
      <div class="whatsapp-status-card"><span>ACCOUNT</span><strong id="wa-account-status">NOT PAIRED</strong></div>
      <div class="whatsapp-status-card"><span>TENANT</span><strong id="wa-tenant-status">—</strong></div>
    </div>
    <div id="wa-message" class="whatsapp-message">WhatsApp is a transport channel. The RailWatch incident engine remains the source of truth.</div>
    <div class="whatsapp-actions">
      <button id="wa-bootstrap" class="primary" type="button">CREATE / LOAD ACCOUNT</button>
      <button id="wa-connect" type="button">START PAIRING</button>
      <button id="wa-refresh" type="button">REFRESH STATUS</button>
    </div>
    <section class="whatsapp-section" id="wa-pairing-section" hidden>
      <h3>QR PAIRING</h3>
      <p>Keep this screen open while the QR refreshes. On the owner's phone: WhatsApp → Linked Devices → Link a device.</p>
      <div class="whatsapp-qr-wrap"><img id="wa-qr" alt="Current WhatsApp pairing QR code" /></div>
    </section>
    <section class="whatsapp-section" id="wa-phone-section" hidden>
      <h3>PHONE-NUMBER PAIRING</h3>
      <p>Enter the owner's international-format WhatsApp number. The pairing code is short-lived and must be entered from the owner's WhatsApp app.</p>
      <div class="whatsapp-actions">
        <input id="wa-phone" type="tel" inputmode="tel" placeholder="+27 82 123 4567" aria-label="WhatsApp phone number" style="flex:1 1 240px;min-height:40px;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:#0d1317;color:#fff;" />
        <button id="wa-pair" type="button">REQUEST CODE</button>
      </div>
      <div id="wa-code" class="whatsapp-code" hidden></div>
    </section>
    <section class="whatsapp-section">
      <h3>ACTIVE INCIDENT CHANNEL</h3>
      <p id="wa-incident-summary">No active incident selected.</p>
      <div class="whatsapp-actions"><button id="wa-notify" type="button" disabled>SEND INCIDENT ALERT</button></div>
    </section>
    <section class="whatsapp-section">
      <h3>CONTROLLED WHATSAPP COMMANDS</h3>
      <div class="whatsapp-command-card"><code>STATUS
SHOW &lt;event_id&gt;
ACKNOWLEDGE &lt;event_id&gt;
VERIFY &lt;event_id&gt;
DISPATCH &lt;event_id&gt;
RESOLVE &lt;event_id&gt;
PROVE &lt;event_id&gt;
HELP</code></div>
      <p style="margin-top:8px">Commands are authorised server-side by the RailWatch operator role and tenant. Voice-message transport is detected; transcription is a separate adapter.</p>
    </section>
  `;
  document.body.appendChild(root);

  const $ = selector => root.querySelector(selector);
  const operatorStatus = $('#wa-operator-status');
  const accountStatus = $('#wa-account-status');
  const tenantStatus = $('#wa-tenant-status');
  const message = $('#wa-message');
  const pairingSection = $('#wa-pairing-section');
  const phoneSection = $('#wa-phone-section');
  const qr = $('#wa-qr');
  const code = $('#wa-code');
  const notifyButton = $('#wa-notify');
  const incidentSummary = $('#wa-incident-summary');
  let operatorToken = '';
  let currentIncidentId = '';
  let polling = null;

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `whatsapp-message${kind ? ` ${kind}` : ''}`;
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (operatorToken) headers.set('Authorization', `Bearer ${operatorToken}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { detail: text }; }
    if (!response.ok) throw new Error(body.detail || body.message || `HTTP ${response.status}`);
    return body;
  }

  async function loadDemoSession() {
    try {
      const result = await request('/api/v1/whatsapp/session', { method: 'GET' });
      operatorToken = result.token || '';
      tenantStatus.textContent = result.tenant || '—';
      operatorStatus.textContent = operatorToken ? 'SESSION READY' : 'AUTH REQUIRED';
      operatorStatus.className = operatorToken ? 'online' : 'pending';
      return Boolean(operatorToken);
    } catch (_) {
      operatorStatus.textContent = 'AUTH REQUIRED';
      operatorStatus.className = 'pending';
      return false;
    }
  }

  async function refresh() {
    try {
      const result = await request('/api/v1/whatsapp/status');
      tenantStatus.textContent = result.tenant || result.operator?.tenant || '—';
      operatorStatus.textContent = result.configured ? 'CONFIGURED' : 'NOT CONFIGURED';
      operatorStatus.className = result.configured ? 'online' : 'pending';
      const connected = Boolean(result.paired || result.operator?.isConnected);
      accountStatus.textContent = connected ? (result.operator?.phoneNumber || 'CONNECTED') : (result.waAccountId ? 'PAIRING REQUIRED' : 'NOT CREATED');
      accountStatus.className = connected ? 'online' : 'pending';
      notifyButton.disabled = !connected || !currentIncidentId;
      if (!connected && result.waAccountId) await pollQr();
      setMessage(connected ? 'WhatsApp account connected. Incident alerts and controlled commands are ready.' : 'WhatsApp account is not connected yet.', connected ? 'success' : '');
      return result;
    } catch (error) {
      operatorStatus.textContent = 'UNAVAILABLE';
      operatorStatus.className = 'pending';
      setMessage(error.message || 'Unable to reach the RailWatch WhatsApp adapter.', 'error');
      return null;
    }
  }

  async function bootstrap() {
    try {
      const result = await request('/api/v1/whatsapp/bootstrap', { method: 'POST' });
      accountStatus.textContent = result.waAccountId ? 'READY TO PAIR' : 'NOT CREATED';
      setMessage('WhatsApp account loaded. Start pairing with QR or the phone-number flow.', 'success');
      await connect();
    } catch (error) {
      setMessage(error.message || 'Could not create/load WhatsApp account.', 'error');
    }
  }

  async function connect() {
    try {
      await request('/api/v1/whatsapp/connect', { method: 'POST' });
      pairingSection.hidden = false;
      phoneSection.hidden = false;
      setMessage('Pairing started. Waiting for the WhatsApp owner to link the device…');
      await pollQr();
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not start pairing.', 'error');
    }
  }

  async function pollQr() {
    if (polling) clearTimeout(polling);
    try {
      const data = await request('/api/v1/whatsapp/qr');
      if (data.qrCode) {
        pairingSection.hidden = false;
        qr.src = data.qrCode;
      }
      if (data.pairingCodeDisplay) {
        code.hidden = false;
        code.textContent = data.pairingCodeDisplay;
      }
      if (!data.isConnected && data.status !== 'connected') {
        polling = setTimeout(pollQr, Math.max(2000, Number(data.qrPollIntervalMs || 3000)));
      }
    } catch (_) {
      polling = setTimeout(pollQr, 4000);
    }
  }

  async function requestPairingCode() {
    const phoneNumber = $('#wa-phone').value.trim();
    if (!phoneNumber) return setMessage('Enter the business owner's international-format WhatsApp number.', 'error');
    try {
      const data = await request('/api/v1/whatsapp/pairing-code', { method: 'POST', body: JSON.stringify({ phoneNumber }) });
      phoneSection.hidden = false;
      code.hidden = false;
      code.textContent = data.pairingCodeDisplay || data.pairingCode || 'CODE PENDING';
      setMessage('Pairing code generated. Enter it from the owner's WhatsApp → Linked Devices.', 'success');
      await pollQr();
    } catch (error) {
      setMessage(error.message || 'Could not request pairing code.', 'error');
    }
  }

  async function notifyCurrentIncident() {
    if (!currentIncidentId) return;
    try {
      const result = await request(`/api/v1/whatsapp/notify/${encodeURIComponent(currentIncidentId)}`, { method: 'POST' });
      setMessage(result.sent ? `Incident alert sent to ${result.sent} configured WhatsApp recipient(s).` : `No alert was sent: ${result.status}.`, result.sent ? 'success' : '');
    } catch (error) {
      setMessage(error.message || 'Could not send incident alert.', 'error');
    }
  }

  $('#wa-bootstrap').addEventListener('click', bootstrap);
  $('#wa-connect').addEventListener('click', connect);
  $('#wa-refresh').addEventListener('click', refresh);
  $('#wa-pair').addEventListener('click', requestPairingCode);
  notifyButton.addEventListener('click', notifyCurrentIncident);
  $('.whatsapp-close').addEventListener('click', () => window.RailWatchWorkspace?.close());

  document.addEventListener('railwatch:incident', event => {
    const data = event.detail || {};
    currentIncidentId = String(data.event_id || '');
    incidentSummary.textContent = currentIncidentId
      ? `${data.severity || 'UNKNOWN'} · ${data.alert_type || 'EVENT'} · ${data.segment || 'Unknown'} · KM ${Number(data.km_marker || 0).toFixed(1)}`
      : 'No active incident selected.';
    notifyButton.disabled = !currentIncidentId || accountStatus.textContent !== 'CONNECTED';
  });

  window.RailWatchWhatsApp = { notify: notifyCurrentIncident, refresh };
  document.addEventListener('railwatch:workspace-opened', event => {
    if (event.detail?.type === 'whatsapp') {
      loadDemoSession().then(() => refresh());
    }
  });

  loadDemoSession().then(() => refresh());
})();
