(() => {
  const observeRoot = document.getElementById('incident-popover');
  if (!observeRoot) return;
  const params = new URLSearchParams(location.search);
  const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');

  async function openDispatchForVisibleAsset(button) {
    const heading = observeRoot.querySelector('h2');
    if (!heading) return;
    button.textContent = 'CALCULATING RESPONSE…';
    button.disabled = true;
    try {
      const response = await fetch(`${apiBase}/api/v1/events?limit=1`);
      if (!response.ok) throw new Error(`Event lookup failed: ${response.status}`);
      const events = await response.json();
      const data = events?.at(-1)?.data;
      const assets = data?.incident?.assets || [];
      const asset = assets.find(item => item.name === heading.textContent.trim());
      if (!asset) throw new Error('Selected asset was not found in the latest demo incident');
      if (!window.RailWatchDispatch?.openForAsset) throw new Error('Dispatch module is not ready yet');
      window.RailWatchDispatch.openForAsset(asset.asset_id);
    } catch (error) {
      button.textContent = 'DISPATCH RESPONSE';
      button.disabled = false;
      console.debug('Dispatch access unavailable', error);
    }
  }

  function addDispatchAction() {
    const heading = observeRoot.querySelector('h2');
    const evidence = observeRoot.querySelector('.evidence-card');
    const critical = observeRoot.querySelector('.popover-critical');
    if (!heading || !evidence || !critical || !critical.textContent.includes('ASSET INTELLIGENCE')) return;
    if (observeRoot.querySelector('[data-dispatch-access]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'operator-btn dispatch-access-btn';
    button.dataset.dispatchAccess = 'true';
    button.textContent = 'DISPATCH RESPONSE';
    button.addEventListener('click', () => openDispatchForVisibleAsset(button));
    evidence.appendChild(button);
  }

  const observer = new MutationObserver(() => setTimeout(addDispatchAction, 0));
  observer.observe(observeRoot, { childList: true, subtree: true });
  addDispatchAction();
})();
