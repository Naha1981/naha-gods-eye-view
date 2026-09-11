(() => {
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

  function wire() {
    const incident = document.getElementById('incident-popover');
    addClose(incident, () => incident?.classList.remove('visible'));

    const asset = document.querySelector('.asset-operator');
    addClose(asset, () => asset?.classList.add('closed'));

    const dispatch = document.querySelector('.dispatch-intelligence');
    if (dispatch) {
      const existing = dispatch.querySelector('#dispatch-close');
      if (existing) existing.setAttribute('aria-label', 'Close response dispatch');
    }
  }

  const observer = new MutationObserver(wire);
  observer.observe(document.body, { childList: true, subtree: true });
  wire();
})();
