(() => {
  let currentIncident = null;
  let acknowledged = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>\'\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function renderButton(data) {
    const root = document.getElementById('incident-popover');
    if (!root || !data?.incident || root.querySelector('[data-acknowledge-incident]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.acknowledgeIncident = 'true';
    button.className = 'operator-btn incident-acknowledge';
    button.textContent = acknowledged ? '✓ INCIDENT ACKNOWLEDGED' : 'ACKNOWLEDGE INCIDENT';
    button.addEventListener('click', () => {
      acknowledged = true;
      button.textContent = '✓ INCIDENT ACKNOWLEDGED';
      button.classList.add('acknowledged');
      document.dispatchEvent(new CustomEvent('railwatch:incident-acknowledged', { detail: { eventId: data.event_id } }));
      window.RailWatchStageProgress?.advance('LOCATE');
    });
    const firstAction = root.querySelector('.asset-list') || root.querySelector('.popover-grid');
    if (firstAction) firstAction.insertAdjacentElement('afterend', button);
  }

  document.addEventListener('railwatch:incident', event => {
    currentIncident = event.detail;
    acknowledged = false;
    setTimeout(() => renderButton(currentIncident), 0);
  });

  const observer = new MutationObserver(() => {
    if (currentIncident) renderButton(currentIncident);
  });
  const popover = document.getElementById('incident-popover');
  if (popover) observer.observe(popover, { childList: true, subtree: true });

  window.RailWatchAcknowledgement = {
    acknowledge() {
      if (currentIncident) {
        acknowledged = true;
        document.dispatchEvent(new CustomEvent('railwatch:incident-acknowledged', { detail: { eventId: currentIncident.event_id } }));
      }
    },
  };
})();
