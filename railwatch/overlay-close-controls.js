(() => {
  const SECONDARY_SELECTORS = [
    '.audit-feed-panel',
    '.evidence-ledger',
    '.incident-history',
    '#railwatch-cctv-overlay',
    '.asset-operator',
    '.dispatch-intelligence',
    '.dispatch-access',
    '.resolution-intelligence',
  ];

  function addClose(root, onClose) {
    if (!root || root.querySelector(':scope > .overlay-close-control')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overlay-close-control';
    button.setAttribute('aria-label', 'Close');
    button.title = 'Close';
    button.textContent = '×';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    });
    root.appendChild(button);
  }

  function classVisible(root) {
    if (!root) return false;
    if (root.matches('.asset-operator')) return !root.classList.contains('closed');
    return root.classList.contains('visible');
  }

  function setVisible(root, visible) {
    if (!root) return;
    root.classList.toggle('rw-workspace-active', visible);
    if (root.matches('.asset-operator')) root.classList.toggle('closed', !visible);
    else root.classList.toggle('visible', visible);
  }

  function ensureScrim() {
    let scrim = document.querySelector('.rw-workspace-scrim');
    if (scrim) return scrim;
    scrim = document.createElement('div');
    scrim.className = 'rw-workspace-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    scrim.addEventListener('click', () => window.RailWatchWorkspace?.close());
    document.body.appendChild(scrim);
    return scrim;
  }

  function allOverlays() {
    return [document.getElementById('incident-popover'), ...SECONDARY_SELECTORS.flatMap(selector => [...document.querySelectorAll(selector)])]
      .filter(Boolean)
      .filter((root, index, list) => list.indexOf(root) === index);
  }

  function closeAll() {
    allOverlays().forEach(root => setVisible(root, false));
    document.body.classList.remove('rw-workspace-open');
    const scrim = document.querySelector('.rw-workspace-scrim');
    scrim?.classList.remove('visible');
  }

  function find(type) {
    if (type === 'incident') return document.getElementById('incident-popover');
    if (type === 'activity') return document.querySelector('.audit-feed-panel');
    if (type === 'ledger') return document.querySelector('.evidence-ledger');
    if (type === 'history') return document.querySelector('.incident-history');
    if (type === 'cctv') return document.querySelector('#railwatch-cctv-overlay');
    if (type === 'asset') return document.querySelector('.asset-operator');
    if (type === 'dispatch') return document.querySelector('.dispatch-intelligence');
    if (type === 'resolution') return document.querySelector('.resolution-intelligence');
    return null;
  }

  function open(type) {
    const target = find(type);
    if (!target) return false;
    allOverlays().forEach(root => { if (root !== target) setVisible(root, false); });
    setVisible(target, true);
    document.body.classList.add('rw-workspace-open');
    ensureScrim().classList.add('visible');
    target.dispatchEvent(new CustomEvent('railwatch:workspace-opened', { detail: { type } }));
    target.querySelector('button, [tabindex="0"]')?.focus?.({ preventScroll: true });
    return true;
  }

  function close() {
    closeAll();
  }

  function injectIncidentNav(incident) {
    if (!incident || incident.querySelector('.rw-workspace-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'rw-workspace-nav';
    nav.setAttribute('aria-label', 'Incident workspace');
    nav.innerHTML = `
      <span class="rw-workspace-label">CASE WORKSPACE</span>
      <div class="rw-workspace-tabs">
        <button type="button" data-rw-workspace="incident" class="active">INCIDENT</button>
        <button type="button" data-rw-workspace="activity">ACTIVITY</button>
        <button type="button" data-rw-workspace="ledger">CASE LEDGER</button>
        <button type="button" data-rw-workspace="history">HISTORY</button>
      </div>`;
    const heading = incident.querySelector('h2');
    if (heading) heading.after(nav);
    else incident.prepend(nav);
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-rw-workspace]');
      if (!button) return;
      event.preventDefault();
      nav.querySelectorAll('[data-rw-workspace]').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      open(button.dataset.rwWorkspace);
    });
  }

  function injectBackNav(root) {
    if (!root || root.matches('#incident-popover') || root.matches('#railwatch-cctv-overlay') || root.querySelector(':scope > .rw-workspace-back')) return;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'rw-workspace-back';
    back.textContent = '← BACK TO INCIDENT';
    back.addEventListener('click', event => {
      event.preventDefault();
      open('incident');
    });
    root.insertBefore(back, root.firstChild);
  }

  function wire() {
    const incident = document.getElementById('incident-popover');
    addClose(incident, close);
    injectIncidentNav(incident);

    allOverlays().filter(root => root !== incident).forEach(root => {
      injectBackNav(root);
      if (root.matches('.dispatch-intelligence')) {
        const existing = root.querySelector('#dispatch-close');
        if (existing) existing.setAttribute('aria-label', 'Close response dispatch');
      }
    });

    ensureScrim();
    if (incident && classVisible(incident)) {
      if (!incident.classList.contains('rw-workspace-active')) incident.classList.add('rw-workspace-active');
      allOverlays().forEach(root => { if (root !== incident) setVisible(root, false); });
      document.body.classList.add('rw-workspace-open');
      ensureScrim().classList.add('visible');
      return;
    }

    const activeSecondary = allOverlays().find(root => root !== incident && classVisible(root));
    if (activeSecondary) {
      activeSecondary.classList.add('rw-workspace-active');
      allOverlays().forEach(root => { if (root !== activeSecondary) root.classList.remove('rw-workspace-active'); });
      document.body.classList.add('rw-workspace-open');
      ensureScrim().classList.add('visible');
    } else {
      document.body.classList.remove('rw-workspace-open');
      ensureScrim().classList.remove('visible');
    }
  }

  window.RailWatchWorkspace = { open, close };

  document.addEventListener('railwatch:incident', () => setTimeout(() => open('incident'), 0));
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-rw-open-workspace]');
    if (button) {
      event.preventDefault();
      open(button.dataset.rwOpenWorkspace);
    }
    const cctvClose = event.target.closest('#rw-cctv-close');
    if (cctvClose) setTimeout(() => {
      const incident = find('incident');
      if (incident?.classList.contains('visible')) open('incident');
      else close();
    }, 0);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  let framePending = false;
  const observer = new MutationObserver(() => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      wire();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  wire();
})();
