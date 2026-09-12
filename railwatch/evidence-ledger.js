(() => {
  const STORAGE_KEY = 'railwatch:evidence-ledger:v1';
  const MAX_ENTRIES = 24;
  const root = document.createElement('aside');
  root.className = 'evidence-ledger';
  root.setAttribute('aria-label', 'Incident evidence ledger');
  root.innerHTML = `
    <header class="evidence-ledger-head">
      <div><span class="evidence-ledger-kicker">EVIDENCE INTELLIGENCE · DEMO</span><h2>Case evidence ledger</h2></div>
      <button class="evidence-ledger-close" type="button" aria-label="Close evidence ledger">×</button>
    </header>
    <div class="evidence-ledger-summary">
      <div><small>CASE</small><strong id="ledger-case">NO ACTIVE CASE</strong></div>
      <div><small>INTEGRITY</small><strong id="ledger-integrity">UNSEALED</strong></div>
      <div><small>RECORDS</small><strong id="ledger-count">0</strong></div>
    </div>
    <div class="evidence-ledger-headline" id="ledger-headline">Waiting for an incident signal.</div>
    <div class="evidence-ledger-chain" id="ledger-chain" aria-live="polite"></div>
    <div class="evidence-ledger-actions">
      <button id="ledger-seal" type="button" disabled>SEAL EVIDENCE</button>
      <button id="ledger-export" type="button" disabled>EXPORT CASE JSON</button>
    </div>
    <footer class="evidence-ledger-foot">HASHED IN BROWSER · DEMO CASE · NOT AN AUTHORITATIVE CHAIN-OF-CUSTODY RECORD</footer>
  `;
  document.body.appendChild(root);

  const caseEl = root.querySelector('#ledger-case');
  const integrityEl = root.querySelector('#ledger-integrity');
  const countEl = root.querySelector('#ledger-count');
  const headlineEl = root.querySelector('#ledger-headline');
  const chainEl = root.querySelector('#ledger-chain');
  const sealButton = root.querySelector('#ledger-seal');
  const exportButton = root.querySelector('#ledger-export');
  const closeButton = root.querySelector('.evidence-ledger-close');

  let currentCase = null;
  let entries = [];
  let sealed = false;
  let queue = Promise.resolve();

  function esc(value) {
    return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[ch]));
  }

  function shortHash(hash) {
    return hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : 'pending';
  }

  async function sha256(value) {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto unavailable');
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function persist() {
    if (!currentCase) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ currentCase, entries, sealed }));
    } catch (_) {
      // Session storage is an enhancement, not a workflow dependency.
    }
  }

  function render() {
    caseEl.textContent = currentCase?.eventId || 'NO ACTIVE CASE';
    integrityEl.textContent = sealed ? 'SEALED' : (entries.length ? 'UNSEALED' : 'UNSEEDED');
    integrityEl.classList.toggle('sealed', sealed);
    countEl.textContent = String(entries.length);
    headlineEl.textContent = entries.length
      ? `${entries.at(-1).stage} · ${entries.at(-1).kind} · ${shortHash(entries.at(-1).hash)}`
      : 'Waiting for an incident signal.';
    chainEl.innerHTML = entries.length ? entries.map((entry, index) => `
      <article class="evidence-ledger-entry ${entry.stage.toLowerCase()} ${entry.kind === 'PROOF' ? 'proof' : ''}">
        <span class="evidence-ledger-index">${index + 1}</span>
        <div>
          <strong>${esc(entry.stage)} <em>${esc(entry.kind)}</em></strong>
          <p>${esc(entry.detail)}</p>
          <small>${esc(entry.timestamp)} · ${esc(shortHash(entry.hash))}</small>
        </div>
      </article>`).join('') : '<div class="evidence-ledger-empty">No evidence recorded yet.</div>';
    sealButton.disabled = !currentCase || !entries.length || sealed;
    exportButton.disabled = !currentCase || !entries.length;
    root.classList.toggle('has-case', Boolean(currentCase));
    root.classList.toggle('is-sealed', sealed);
  }

  function saveAndRender() {
    persist();
    render();
  }

  function enqueueEntry(stage, kind, detail, options = {}) {
    queue = queue.then(async () => {
      if (!currentCase || sealed || entries.length >= MAX_ENTRIES) return;
      const timestamp = new Date().toISOString();
      const previousHash = entries.at(-1)?.hash || 'GENESIS';
      const material = [previousHash, currentCase.eventId, stage, kind, detail, timestamp].join('|');
      let hash = '';
      try {
        hash = await sha256(material);
      } catch (_) {
        hash = '';
      }
      entries.push({
        stage,
        kind,
        detail,
        timestamp,
        previousHash,
        hash,
        source: options.source || 'operator-ui',
      });
      saveAndRender();
      root.classList.add('visible');
    });
    return queue;
  }

  function startCase(data) {
    if (!data?.event_id) return;
    if (currentCase?.eventId === data.event_id) return;
    currentCase = {
      eventId: String(data.event_id),
      alertType: String(data.alert_type || 'LINE_BREACH'),
      severity: String(data.severity || 'CRITICAL'),
      segment: String(data.segment || 'Demo sector'),
      kmMarker: Number(data.km_marker || 0),
      sensorId: String(data.sensor_id || 'DEMO SENSOR'),
      startedAt: new Date().toISOString(),
    };
    entries = [];
    sealed = false;
    saveAndRender();
    root.classList.add('visible');
    enqueueEntry('DETECT', 'SIGNAL', `${currentCase.alertType} received from ${currentCase.sensorId}`, { source: 'telemetry' });
    enqueueEntry('LOCATE', 'LOCATION', `${currentCase.segment} · KM ${currentCase.kmMarker.toFixed(1)}`, { source: 'schematic-gis' });
  }

  function exportCase() {
    if (!currentCase || !entries.length) return;
    const payload = {
      schema_version: '1.0',
      demo: true,
      case: currentCase,
      sealed,
      evidence_count: entries.length,
      chain_head: entries.at(-1)?.hash || null,
      entries,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `railwatch-case-${currentCase.eventId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.dispatchEvent(new CustomEvent('railwatch:audit', { detail: { action: 'EVIDENCE_EXPORTED', detail: currentCase.eventId, source: 'evidence-ledger' } }));
  }

  sealButton.addEventListener('click', async () => {
    if (!currentCase || sealed) return;
    await enqueueEntry('PROVE', 'PROOF', 'Evidence package sealed by operator; chain head recorded for this demo case', { source: 'operator' });
    sealed = true;
    saveAndRender();
    document.dispatchEvent(new CustomEvent('railwatch:stage', { detail: { stage: 'PROVE', source: 'evidence-ledger' } }));
    document.dispatchEvent(new CustomEvent('railwatch:audit', { detail: { action: 'EVIDENCE_SEALED', detail: `${currentCase.eventId} · ${entries.at(-1)?.hash || 'unavailable hash'}`, source: 'evidence-ledger' } }));
  });

  exportButton.addEventListener('click', exportCase);
  closeButton.addEventListener('click', () => root.classList.remove('visible'));

  document.addEventListener('railwatch:incident', event => startCase(event.detail));
  document.addEventListener('railwatch:stage', event => {
    const stage = event.detail?.stage;
    if (!stage || !currentCase || sealed) return;
    const details = {
      LOCATE: 'Incident positioned and mapped',
      VERIFY: 'Evidence verification stage entered',
      RESPOND: 'Response workflow entered',
      RESOLVE: 'Response completed; case ready for proof',
      PROVE: 'Proof stage entered',
    };
    if (details[stage]) enqueueEntry(stage, 'STAGE', details[stage]);
  });

  document.addEventListener('click', event => {
    const el = event.target.closest('button, [role="button"]');
    if (!el || !currentCase || sealed) return;
    if (el.matches('.asset-select')) enqueueEntry('VERIFY', 'ASSET', 'Infrastructure asset selected for verification');
    if (el.matches('[data-action="cctv"]')) enqueueEntry('VERIFY', 'CCTV', 'Visual evidence surface opened for operator review');
    if (el.id === 'cctv-verified') enqueueEntry('VERIFY', 'CONFIRM', 'Operator confirmed visual check');
    if (el.matches('.dispatch-access-btn')) enqueueEntry('RESPOND', 'REVIEW', 'Response recommendation opened for operator approval');
    if (el.id === 'dispatch-confirm') enqueueEntry('RESPOND', 'DISPATCH', 'Demo response queued after operator approval');
    if (el.id === 'close-incident') enqueueEntry('RESOLVE', 'CLOSE', 'Operator closed the incident workflow');
    if (el.id === 'view-report') enqueueEntry('PROVE', 'REPORT', 'Incident evidence report opened');
  });

  try {
    const restored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (restored?.currentCase?.eventId && Array.isArray(restored.entries)) {
      currentCase = restored.currentCase;
      entries = restored.entries.slice(-MAX_ENTRIES);
      sealed = Boolean(restored.sealed);
    }
  } catch (_) {
    // Ignore unavailable or malformed session state.
  }

  render();
  window.RailWatchEvidence = {
    getCase: () => ({ currentCase, entries: [...entries], sealed }),
    add: enqueueEntry,
    exportCase,
  };
})();
