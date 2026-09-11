(() => {
  const ROOT_ID = 'railwatch-intelligence-panel';
  const DEMO = {
    camera: 'DEMO-CAM-0142',
    cameraStatus: 'ONLINE',
    detection: 'SUSPICIOUS ACTIVITY',
    evidence: '02:14:38 SAST',
    confidence: 'DEMO',
    source: 'SIMULATED',
    risk: 86,
    riskLevel: 'HIGH',
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function currentAssetType() {
    const assetLabel = [...document.querySelectorAll('.incident-popover .popover-grid span')]
      .find(el => el.textContent.trim() === 'ASSET');
    return assetLabel?.parentElement?.querySelector('strong')?.textContent?.trim() || 'RAIL INFRASTRUCTURE';
  }

  function currentHistorySignal() {
    const rows = document.querySelectorAll('.incident-history-row');
    if (!rows.length) return 'NO PRIOR CASE IN CURRENT SESSION';
    return `${rows.length} DEMO CASE${rows.length === 1 ? '' : 'S'} IN CURRENT SESSION`;
  }

  function buildIncidentPanel() {
    const popover = document.getElementById('incident-popover');
    if (!popover || !popover.classList.contains('visible')) return;
    if (!popover.querySelector('.popover-critical')) return;
    if (popover.querySelector(`#${ROOT_ID}`)) return;

    const heading = popover.querySelector('h2')?.textContent?.trim() || 'Rail infrastructure incident';
    const assetType = currentAssetType();
    const historySignal = currentHistorySignal();

    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'rw-intelligence-panel';
    root.setAttribute('aria-label', 'RailWatch intelligence summary');
    root.innerHTML = `
      <div class="rw-intel-header">
        <div>
          <div class="rw-intel-kicker">INTELLIGENCE LAYER · DEMO</div>
          <h3>Incident intelligence</h3>
        </div>
        <span class="rw-intel-badge">RULE-FIRST</span>
      </div>

      <div class="rw-intel-cctv">
        <div class="rw-intel-section-title">CCTV VERIFICATION</div>
        <div class="rw-intel-cctv-grid">
          <div><span>CAMERA</span><strong>${esc(DEMO.camera)}</strong></div>
          <div><span>STATUS</span><strong class="good">${esc(DEMO.cameraStatus)}</strong></div>
          <div><span>DETECTION</span><strong class="warning">${esc(DEMO.detection)}</strong></div>
          <div><span>EVIDENCE</span><strong>${esc(DEMO.evidence)}</strong></div>
          <div><span>CONFIDENCE</span><strong>${esc(DEMO.confidence)}</strong></div>
          <div><span>SOURCE</span><strong>${esc(DEMO.source)}</strong></div>
        </div>
        <button type="button" class="operator-btn rw-intel-cctv-button" data-action="cctv">OPEN VISUAL EVIDENCE</button>
      </div>

      <div class="rw-intel-risk">
        <div class="rw-intel-section-title">GEO RISK ENGINE · DEMONSTRATION</div>
        <div class="rw-intel-risk-top">
          <div class="rw-intel-risk-number"><strong>${DEMO.risk}</strong><span>/ 100</span></div>
          <div><b>${esc(DEMO.riskLevel)} RISK</b><span>Transparent rule-based scoring</span></div>
        </div>
        <div class="rw-intel-risk-bar"><span style="width:${DEMO.risk}%"></span></div>
        <div class="rw-intel-rules">
          <div><span>Incident severity</span><b>+30</b></div>
          <div><span>Critical asset proximity · ${esc(assetType)}</span><b>+24</b></div>
          <div><span>Three monitored assets in zone</span><b>+12</b></div>
          <div><span>Freight corridor sensitivity</span><b>+10</b></div>
          <div><span>Potential operational interruption</span><b>+10</b></div>
        </div>
        <div class="rw-intel-footnote">DEMO RULE ENGINE · NOT A PREDICTIVE ML MODEL · WEIGHTS ARE EXPLAINABLE PROTOTYPE VALUES</div>
      </div>

      <div class="rw-intel-context">
        <div class="rw-intel-section-title">GEOSPATIAL + OPERATIONAL CONTEXT</div>
        <div class="rw-intel-context-grid">
          <div><span>LOCATION</span><strong>${esc(heading)}</strong></div>
          <div><span>NETWORK</span><strong>SCHEMATIC RAIL CORRIDOR</strong></div>
          <div><span>ASSET ZONE</span><strong>3 MONITORED ASSETS</strong></div>
          <div><span>OPERATING IMPACT</span><strong>VERIFY TRAIN MOVEMENT BEFORE DISPATCH</strong></div>
        </div>
      </div>

      <div class="rw-intel-response">
        <div class="rw-intel-section-title">RECOMMENDED RESPONSE · HUMAN APPROVAL</div>
        <div class="rw-intel-action-primary"><span>PRIORITY ACTION</span><strong>VERIFY → THEN DISPATCH</strong></div>
        <div class="rw-intel-response-steps">
          <div><b>1</b><span>Acknowledge incident</span><em>OPERATOR</em></div>
          <div><b>2</b><span>Review CCTV evidence</span><em>OPERATOR</em></div>
          <div><b>3</b><span>Verify train movement / operating impact</span><em>OPERATOR</em></div>
          <div><b>4</b><span>Dispatch field response if verified</span><em>OPERATOR</em></div>
        </div>
        <div class="rw-intel-footnote">No autonomous signalling, train movement, or field dispatch is performed by this prototype.</div>
      </div>

      <div class="rw-intel-history">
        <div class="rw-intel-section-title">INCIDENT HISTORY SIGNAL</div>
        <div class="rw-intel-history-grid">
          <div><span>SESSION HISTORY</span><strong>${esc(historySignal)}</strong></div>
          <div><span>VALIDATED PATTERN</span><strong>NOT ESTABLISHED IN DEMO</strong></div>
        </div>
        <div class="rw-intel-footnote">Production version can correlate retained incidents, maintenance records, CCTV evidence and infrastructure history.</div>
      </div>

      <div class="rw-intel-chain">
        <div class="rw-intel-section-title">EVIDENCE CHAIN</div>
        <div class="rw-intel-chain-grid">
          <span class="done">SIGNAL</span><i>→</i><span class="done">LOCATION</span><i>→</i><span class="done">ASSET</span><i>→</i><span class="current">VERIFICATION</span><i>→</i><span>RESPONSE</span><i>→</i><span>PROOF</span>
        </div>
      </div>

      <div class="rw-intel-agent">
        <div class="rw-intel-section-title">GEOAGENT · DECISION SUPPORT</div>
        <p><b>Why this incident is high priority:</b> The event is critical, sits on a monitored freight corridor, overlaps three infrastructure assets and presents a potential line interruption. The safest next step is human verification before field response.</p>
        <div class="rw-intel-sources"><span>GIS · DEMO</span><span>ASSET REGISTRY · DEMO</span><span>CCTV · SIMULATED</span><span>INCIDENT HISTORY · SESSION</span></div>
        <div class="rw-intel-footnote">Reasoning is demonstrative and human-reviewable. The production intelligence layer can replace these demo signals with authorised operational sources and validated models.</div>
      </div>
    `;

    const footer = popover.querySelector('.popover-foot');
    (footer ? footer.before(root) : popover.appendChild(root));
  }

  function enhance() {
    if (!document.getElementById('incident-popover')?.classList.contains('visible')) return;
    window.requestAnimationFrame(buildIncidentPanel);
  }

  const popover = document.getElementById('incident-popover');
  if (!popover) return;

  const observer = new MutationObserver(enhance);
  observer.observe(popover, { childList: true, subtree: true, characterData: true });
  document.addEventListener('railwatch:intelligence-refresh', enhance);
  enhance();
})();
