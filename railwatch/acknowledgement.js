(() => {
  let currentIncident = null;
  let acknowledged = false;

  function renderButton(data) {
    const root = document.getElementById('incident-popover');
    if (!root || !data?.incident) return;
    if (root.querySelector('[data-acknowledge-incident]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.acknowledgeIncident = 'true';
    button.className = 'operator-btn incident-acknowledge';
    button.textContent = acknowledged ? '✓ INCIDENT ACKNOWLEDGED' : 'ACKNOWLEDGE INCIDENT';

    button.addEventListener('click', () => {
      acknowledged = true;
      button.textContent = '✓ INCIDENT ACKNOWLEDGED';
      button.classList.add('acknowledged');
      document.dispatchEvent(new CustomEvent('railwatch:incident-acknowledged', {
        detail: { eventId: data.event_id || null }
      }));
      window.RailWatchStageProgress?.advance('LOCATE');
    });

    const anchor = root.querySelector('.asset-list') || root.querySelector('.popover-grid');
    if (anchor) anchor.insertAdjacentElement('afterend', button);
  }

  function inspectIncidentView() {
    const root = document.getElementById('incident-popover');
    if (!root) return;

    const critical = root.querySelector('.popover-critical');
    const text = critical?.textContent || '';
    const isIncidentView = text.includes('INCIDENT') && !text.includes('ASSET INTELLIGENCE') && !text.includes('CCTV VERIFICATION');

    if (isIncidentView && window.RailWatchCurrentIncident) {
      currentIncident = window.RailWatchCurrentIncident;
      renderButton(currentIncident);
    }
  }

  const observer = new MutationObserver(() => setTimeout(inspectIncidentView, 0));
  const popover = document.getElementById('incident-popover');
  if (popover) observer.observe(popover, { childList: true, subtree: true });

  setTimeout(inspectIncidentView, 0);

  window.RailWatchAcknowledgement = {
    setIncident(data) {
      currentIncident = data || null;
      acknowledged = false;
      setTimeout(() => renderButton(currentIncident), 0);
    },
    acknowledge() {
      if (!currentIncident) return;
      acknowledged = true;
      document.dispatchEvent(new CustomEvent('railwatch:incident-acknowledged', {
        detail: { eventId: currentIncident.event_id || null }
      }));
    },
  };
})();
