(() => {
  let acknowledged = false;

  function renderButton() {
    const root = document.getElementById('incident-popover');
    if (!root || root.querySelector('[data-acknowledge-incident]')) return;

    const critical = root.querySelector('.popover-critical');
    const text = critical?.textContent || '';
    const isIncidentView = text.includes('INCIDENT') && !text.includes('ASSET INTELLIGENCE') && !text.includes('CCTV VERIFICATION');
    if (!isIncidentView) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.acknowledgeIncident = 'true';
    button.className = 'operator-btn incident-acknowledge';
    button.textContent = acknowledged ? '✓ INCIDENT ACKNOWLEDGED' : 'ACKNOWLEDGE INCIDENT';

    button.addEventListener('click', () => {
      acknowledged = true;
      button.textContent = '✓ INCIDENT ACKNOWLEDGED';
      button.classList.add('acknowledged');
      document.dispatchEvent(new CustomEvent('railwatch:incident-acknowledged'));
      window.RailWatchStageProgress?.advance('LOCATE');
    });

    const anchor = root.querySelector('.asset-list') || root.querySelector('.popover-grid');
    if (anchor) anchor.insertAdjacentElement('afterend', button);
  }

  function refresh() {
    setTimeout(renderButton, 0);
  }

  const popover = document.getElementById('incident-popover');
  if (popover) {
    const observer = new MutationObserver(refresh);
    observer.observe(popover, { childList: true, subtree: true });
  }

  document.addEventListener('click', event => {
    const closeOrBack = event.target.closest('#incident-popover .back-to-incident, #incident-popover .back-to-asset, #incident-popover [data-action="cctv"]');
    if (closeOrBack) refresh();
  });

  refresh();
})();
