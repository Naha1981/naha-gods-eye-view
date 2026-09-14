(() => {
  const STAGES = ['DETECT','LOCATE','VERIFY','RESPOND','RESOLVE','PROVE'];
  const WORKSPACES = [
    ['incident-popover','INCIDENT'], ['.asset-operator','ASSET'], ['#railwatch-cctv-overlay','CCTV'],
    ['.dispatch-intelligence','RESPONSE'], ['.resolution-intelligence','RESOLUTION'], ['.evidence-ledger','CASE LEDGER'],
    ['.audit-feed-panel','ACTIVITY'], ['.incident-history','HISTORY'], ['.whatsapp-panel','WHATSAPP'], ['.ai-intelligence-panel','AI INTELLIGENCE']
  ];
  let currentStage = 'DETECT';
  let currentIncident = null;
  let previousWorkspace = null;
  let fullscreenRoot = null;
  let lastJourneyAction = '';

  const root = document.createElement('aside');
  root.className = 'rw-journey-guide visible';
  root.setAttribute('aria-label', 'RailWatch guided operator journey');
  root.innerHTML = `
    <header class="rw-journey-head">
      <div><div class="rw-journey-step" id="rwj-step">STEP 1 OF 6 · DETECT</div><div class="rw-journey-title" id="rwj-title">Start the demonstration</div></div>
      <div class="rw-journey-progress" id="rwj-progress"></div>
      <button class="rw-journey-dismiss" id="rwj-dismiss" type="button" aria-label="Hide guided journey">×</button>
    </header>
    <div class="rw-journey-body">
      <p id="rwj-copy"></p>
      <div class="rw-journey-next"><strong id="rwj-next"></strong><span id="rwj-next-detail"></span></div>
      <div class="rw-journey-actions" id="rwj-actions"></div>
      <div class="rw-journey-note" id="rwj-note"></div>
    </div>`;
  document.body.appendChild(root);

  const stepEl = root.querySelector('#rwj-step');
  const titleEl = root.querySelector('#rwj-title');
  const copyEl = root.querySelector('#rwj-copy');
  const nextEl = root.querySelector('#rwj-next');
  const nextDetailEl = root.querySelector('#rwj-next-detail');
  const actionsEl = root.querySelector('#rwj-actions');
  const noteEl = root.querySelector('#rwj-note');
  const progressEl = root.querySelector('#rwj-progress');

  progressEl.innerHTML = STAGES.map((stage, index) => `<span class="rw-journey-dot" data-index="${index}" title="${stage}"></span>`).join('');

  const specs = {
    DETECT: {
      title: 'Start with a simulated line breach',
      copy: 'This is the starting point. RailWatch creates a demo incident, places it on the map and opens the incident workspace.',
      next: '1. SIMULATE LINE BREACH', detail: 'Creates the incident and moves you to LOCATE.',
      note: 'The demonstration is synthetic and not authoritative railway control data.'
    },
    LOCATE: {
      title: 'Locate the incident and choose the asset',
      copy: 'Read the incident location, KM marker and nearby infrastructure. Select the asset you want the operator to verify.',
      next: '2. SELECT A NEARBY ASSET', detail: 'Opens the asset intelligence window.',
      note: 'The map remains the situational context; the window is the operator work surface.'
    },
    VERIFY: {
      title: 'Verify before responding',
      copy: 'Review the asset evidence, open the simulated CCTV surface and confirm the visual check. RailWatch keeps the operator in control.',
      next: '3. VERIFY THE EVIDENCE', detail: 'Use CCTV or mark the asset field-verified.',
      note: 'Do not dispatch until the evidence has been reviewed.'
    },
    RESPOND: {
      title: 'Review the recommended response',
      copy: 'RailWatch turns the verified incident into a response recommendation: suitable response unit, distance, ETA and recommended action.',
      next: '4. REVIEW → DISPATCH RESPONSE', detail: 'The recommendation window opens and requires operator approval.',
      note: 'The prototype does not contact a real field team.'
    },
    RESOLVE: {
      title: 'Complete and close the incident',
      copy: 'After dispatch is queued, complete the response and move into incident resolution. This is the hand-off from action to proof.',
      next: '5. COMPLETE RESPONSE → CLOSE INCIDENT', detail: 'Opens the resolution window and prepares the case for proof.',
      note: 'The response is recorded as a demo workflow action.'
    },
    PROVE: {
      title: 'View the report and preserve proof',
      copy: 'The journey ends with a readable incident report. View it first, then save/download the report. The case ledger remains available as supporting evidence.',
      next: '6. VIEW INCIDENT REPORT', detail: 'Opens the final report; use SAVE / DOWNLOAD REPORT there.',
      note: 'You can also open CASE LEDGER to inspect the evidence chain before finishing.'
    }
  };

  function setVisible(visible) { root.classList.toggle('visible', visible); }
  function stageIndex() { return STAGES.indexOf(currentStage); }
  function clearTargets() { document.querySelectorAll('.rw-journey-target,.rw-journey-target-soft').forEach(el => el.classList.remove('rw-journey-target','rw-journey-target-soft')); }
  function target(selector, soft = false) {
    const el = document.querySelector(selector);
    if (!el) return null;
    el.classList.add(soft ? 'rw-journey-target-soft' : 'rw-journey-target');
    return el;
  }
  function clickSelector(selector) {
    const el = document.querySelector(selector);
    if (el && !el.disabled) { el.click(); return true; }
    return false;
  }
  function currentIncidentReady() { return Boolean(currentIncident?.event_id); }

  function renderStage() {
    const spec = specs[currentStage];
    if (!spec) return;
    const idx = stageIndex();
    stepEl.textContent = `STEP ${idx + 1} OF ${STAGES.length} · ${currentStage}`;
    titleEl.textContent = spec.title;
    copyEl.textContent = spec.copy;
    nextEl.textContent = spec.next;
    nextDetailEl.textContent = spec.detail;
    noteEl.textContent = spec.note;
    progressEl.querySelectorAll('.rw-journey-dot').forEach((dot, i) => {
      dot.classList.toggle('done', i < idx);
      dot.classList.toggle('current', i === idx);
    });
    actionsEl.innerHTML = '';

    const actions = [];
    if (currentStage === 'DETECT') actions.push(['primary','SIMULATE LINE BREACH',() => clickSelector('#demo-alert')]);
    if (currentStage === 'LOCATE') actions.push(['primary','SELECT FIRST ASSET',() => clickSelector('.incident-popover .asset-select')]);
    if (currentStage === 'VERIFY') {
      actions.push(['primary','VIEW CCTV',() => clickSelector('[data-action="cctv"]')]);
      actions.push(['','MARK VERIFIED',() => clickSelector('[data-action="verify"]')]);
    }
    if (currentStage === 'RESPOND') actions.push(['primary','OPEN RESPONSE PLAN',() => clickSelector('.dispatch-access-btn')]);
    if (currentStage === 'RESOLVE') actions.push(['primary','COMPLETE RESPONSE',() => clickSelector('#dispatch-complete')]);
    if (currentStage === 'PROVE') {
      actions.push(['primary','VIEW INCIDENT REPORT',() => clickSelector('#view-report')]);
      actions.push(['','OPEN CASE LEDGER',() => window.RailWatchWorkspace?.open('ledger')]);
    }
    actions.forEach(([kind,label,fn]) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = kind || ''; button.textContent = label;
      button.addEventListener('click', () => { lastJourneyAction = label; fn(); });
      actionsEl.appendChild(button);
    });

    clearTargets();
    if (currentStage === 'DETECT') target('#demo-alert');
    if (currentStage === 'LOCATE') target('.incident-popover .asset-select');
    if (currentStage === 'VERIFY') target('.incident-popover [data-action="cctv"], .incident-popover [data-action="verify"]', true);
    if (currentStage === 'RESPOND') target('.incident-popover .dispatch-access-btn');
    if (currentStage === 'RESOLVE') target('#dispatch-complete');
    if (currentStage === 'PROVE') target('#view-report');
  }

  function advance(stage) {
    if (!STAGES.includes(stage)) return;
    const to = STAGES.indexOf(stage);
    if (to < stageIndex()) return;
    currentStage = stage;
    renderStage();
    setVisible(true);
  }

  function workspaceRoot(type) {
    const entry = WORKSPACES.find(([selector]) => selector === type || document.querySelector(selector)?.dataset?.rwWorkspaceType === type);
    if (type === 'incident') return document.getElementById('incident-popover');
    if (type === 'activity') return document.querySelector('.audit-feed-panel');
    if (type === 'ledger') return document.querySelector('.evidence-ledger');
    if (type === 'history') return document.querySelector('.incident-history');
    if (type === 'asset') return document.querySelector('.asset-operator');
    if (type === 'cctv') return document.querySelector('#railwatch-cctv-overlay');
    if (type === 'dispatch') return document.querySelector('.dispatch-intelligence');
    if (type === 'resolution') return document.querySelector('.resolution-intelligence');
    if (type === 'whatsapp') return document.querySelector('.whatsapp-panel');
    if (type === 'ai') return document.querySelector('.ai-intelligence-panel');
    return entry ? document.querySelector(entry[0]) : null;
  }

  function workspaceLabel(type) {
    const found = [['incident','INCIDENT'],['activity','ACTIVITY'],['ledger','CASE LEDGER'],['history','HISTORY'],['asset','ASSET'],['cctv','CCTV'],['dispatch','RESPONSE'],['resolution','RESOLUTION'],['whatsapp','WHATSAPP'],['ai','AI INTELLIGENCE']].find(item => item[0] === type);
    return found?.[1] || String(type || 'WORKSPACE').toUpperCase();
  }

  function decorateWorkspace(rootNode, type) {
    if (!rootNode || rootNode.querySelector(':scope > .rw-workspace-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'rw-workspace-toolbar';
    toolbar.innerHTML = `<span class="rw-journey-step">${workspaceLabel(type)}</span><span class="rw-toolbar-spacer"></span><button type="button" data-rwj-minimize>MINIMIZE</button><button type="button" data-rwj-fullscreen class="primary">FULL SCREEN</button>`;
    rootNode.insertBefore(toolbar, rootNode.firstChild);
    toolbar.querySelector('[data-rwj-minimize]').addEventListener('click', () => minimize(rootNode, type));
    toolbar.querySelector('[data-rwj-fullscreen]').addEventListener('click', () => toggleFullscreen(rootNode));
  }

  function renderDock() {
    let dock = document.querySelector('.rw-workspace-dock');
    if (!dock) { dock = document.createElement('nav'); dock.className = 'rw-workspace-dock'; dock.setAttribute('aria-label','Minimized workspaces'); document.body.appendChild(dock); }
    dock.innerHTML = '';
    document.querySelectorAll('.rw-workspace-minimized[data-rw-workspace-type]').forEach(node => {
      const type = node.dataset.rwWorkspaceType;
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = `OPEN ${workspaceLabel(type)}`;
      button.addEventListener('click', () => restoreWorkspace(type));
      dock.appendChild(button);
    });
  }

  function registerWorkspaceNodes() {
    [['#incident-popover','incident'],['.audit-feed-panel','activity'],['.evidence-ledger','ledger'],['.incident-history','history'],['.asset-operator','asset'],['#railwatch-cctv-overlay','cctv'],['.dispatch-intelligence','dispatch'],['.resolution-intelligence','resolution'],['.whatsapp-panel','whatsapp'],['.ai-intelligence-panel','ai']].forEach(([selector,type]) => {
      const node = document.querySelector(selector);
      if (node) { node.dataset.rwWorkspaceType = type; decorateWorkspace(node, type); }
    });
  }

  function minimize(node, type) {
    if (!node) return;
    if (fullscreenRoot === node) toggleFullscreen(node);
    node.classList.remove('rw-workspace-active','visible');
    node.classList.add('rw-workspace-minimized');
    renderDock();
    document.body.classList.remove('rw-workspace-open');
  }

  function restoreWorkspace(type) {
    const node = workspaceRoot(type);
    if (!node) return false;
    node.classList.remove('rw-workspace-minimized');
    if (window.RailWatchWorkspace?.open) return window.RailWatchWorkspace.open(type);
    node.classList.add('visible','rw-workspace-active');
    return true;
  }

  function toggleFullscreen(node) {
    if (!node) return;
    if (fullscreenRoot && fullscreenRoot !== node) fullscreenRoot.classList.remove('rw-workspace-fullscreen');
    const entering = !node.classList.contains('rw-workspace-fullscreen');
    node.classList.toggle('rw-workspace-fullscreen', entering);
    fullscreenRoot = entering ? node : null;
    document.body.classList.toggle('rw-journey-fullscreen', entering);
    const button = node.querySelector('[data-rwj-fullscreen]');
    if (button) button.textContent = entering ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
  }

  function onWorkspaceOpened(type) {
    registerWorkspaceNodes();
    const now = workspaceRoot(type);
    if (previousWorkspace && previousWorkspace !== now && document.body.contains(previousWorkspace)) {
      previousWorkspace.classList.remove('rw-workspace-active','visible');
      previousWorkspace.classList.add('rw-workspace-minimized');
    }
    document.querySelectorAll('.rw-workspace-minimized').forEach(node => { if (node === now) node.classList.remove('rw-workspace-minimized'); });
    previousWorkspace = now;
    renderDock();
    if (type === 'whatsapp') {
      setVisible(false);
      requestAnimationFrame(() => {
        const body = document.querySelector('.whatsapp-panel');
        body?.querySelector('#wa-bootstrap, #wa-connect, #wa-pair, #wa-refresh')?.classList.add('rw-journey-target-soft');
      });
      return;
    }
    if (type === 'ai') {
      setVisible(false);
      requestAnimationFrame(() => window.RailWatchAI?.refreshStatus());
      return;
    }
    if (type === 'incident') { advance('LOCATE'); return; }
    if (type === 'asset') { advance('VERIFY'); return; }
    if (type === 'dispatch') { advance('RESPOND'); return; }
    if (type === 'resolution') { advance('RESOLVE'); return; }
  }

  document.addEventListener('railwatch:incident', event => { currentIncident = event.detail || null; advance('LOCATE'); });
  document.addEventListener('railwatch:stage', event => {
    const stage = event.detail?.stage;
    if (stage === 'DETECT' && !currentIncidentReady()) currentStage = 'DETECT';
    if (stage) advance(stage);
  });
  document.addEventListener('railwatch:workspace-opened', event => onWorkspaceOpened(event.detail?.type));

  document.addEventListener('click', event => {
    const el = event.target.closest('button,[role="button"]');
    if (!el) return;
    if (el.id === 'demo-alert') setTimeout(() => advance('LOCATE'), 250);
    if (el.matches('.asset-select')) setTimeout(() => advance('VERIFY'), 120);
    if (el.matches('[data-action="cctv"],[data-action="verify"],[data-action="cctv"]')) setTimeout(() => advance('VERIFY'), 120);
    if (el.id === 'cctv-verified' || el.matches('.dispatch-access-btn')) setTimeout(() => advance('RESPOND'), 160);
    if (el.id === 'dispatch-confirm') setTimeout(() => advance('RESOLVE'), 180);
    if (el.id === 'dispatch-complete') setTimeout(() => advance('RESOLVE'), 100);
    if (el.id === 'close-incident') setTimeout(() => advance('PROVE'), 180);
    if (el.id === 'view-report') { lastJourneyAction = 'VIEW INCIDENT REPORT'; setVisible(false); }
  }, true);

  root.querySelector('#rwj-dismiss').addEventListener('click', () => { setVisible(false); clearTargets(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fullscreenRoot) { toggleFullscreen(fullscreenRoot); return; }
    if (event.key === 'Escape') { setVisible(false); clearTargets(); }
  });

  const observer = new MutationObserver(() => registerWorkspaceNodes());
  observer.observe(document.body, { childList: true, subtree: true });
  registerWorkspaceNodes();
  renderStage();
})();
