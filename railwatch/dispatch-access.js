(() => {
  const observeRoot = document.getElementById('incident-popover');
  if (!observeRoot) return;

  let lastAssetId = null;

  function getCurrentAssetId() {
    const heading = observeRoot.querySelector('h2');
    const asset = window.__railwatchCurrentIncident?.incident?.assets || [];
    if (!heading || !asset.length) return null;
    const name = heading.textContent.trim();
    return asset.find(item => item.name === name)?.asset_id || null;
  }

  function addDispatchAction() {
    const heading = observeRoot.querySelector('h2');
    const evidence = observeRoot.querySelector('.evidence-card');
    if (!heading || !evidence) return;
    if (!observeRoot.querySelector('[data-dispatch-access]')) {
      const id = getCurrentAssetId() || lastAssetId;
      if (!id) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'operator-btn dispatch-access-btn';
      button.dataset.dispatchAccess = 'true';
      button.textContent = 'DISPATCH RESPONSE';
      button.addEventListener('click', () => {
        if (window.RailWatchDispatch?.openForAsset) {
          window.RailWatchDispatch.openForAsset(id);
        }
      });
      evidence.appendChild(button);
      lastAssetId = id;
    }
  }

  function rememberIncident() {
    try {
      const text = observeRoot.textContent || '';
      if (!text.includes('ASSET INTELLIGENCE')) return;
      addDispatchAction();
    } catch (_) {}
  }

  const observer = new MutationObserver(() => setTimeout(rememberIncident, 0));
  observer.observe(observeRoot, { childList: true, subtree: true });
})();
