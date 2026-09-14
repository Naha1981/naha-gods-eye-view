(() => {
  const selector = '.whatsapp-panel';
  let root = null;

  function ensure() {
    const panel = document.querySelector(selector);
    if (!panel || panel.querySelector('.rw-wa-journey')) return panel?.querySelector('.rw-wa-journey') || null;
    root = document.createElement('section');
    root.className = 'rw-wa-journey';
    root.setAttribute('aria-label', 'Guided WhatsApp setup');
    root.innerHTML = `
      <div class="rw-wa-journey-head"><span>WHATSAPP SETUP · GUIDED</span><strong id="rw-wa-step">1 / 4</strong></div>
      <div class="rw-wa-journey-title" id="rw-wa-title">Create or load the WhatsApp account</div>
      <p id="rw-wa-copy">Use the existing operator account. RailWatch does not handle WhatsApp credentials directly.</p>
      <div class="rw-wa-journey-steps" id="rw-wa-steps">
        <span class="active">1 Account</span><span>2 Pair</span><span>3 Confirm</span><span>4 Test alert</span>
      </div>
      <div class="rw-wa-journey-actions" id="rw-wa-actions"></div>`;
    panel.insertBefore(root, panel.querySelector('.whatsapp-status-grid') || panel.firstChild);
    return root;
  }

  function button(id, label, primary = false) {
    const el = document.querySelector(id);
    if (!el) return null;
    el.classList.add('rw-wa-focus');
    const b = document.createElement('button');
    b.type = 'button'; b.className = primary ? 'primary' : ''; b.textContent = label;
    b.addEventListener('click', () => el.click());
    return b;
  }

  function update() {
    const panel = document.querySelector(selector);
    const guide = ensure();
    if (!panel || !guide) return;
    const account = panel.querySelector('#wa-account-status')?.textContent?.trim().toUpperCase() || '';
    const code = !panel.querySelector('#wa-code')?.hidden;
    const connected = account === 'CONNECTED' || account.includes('CONNECTED');
    let step = 1;
    let title = 'Create or load the WhatsApp account';
    let copy = 'Use the existing operator account. RailWatch does not handle WhatsApp credentials directly.';
    let buttons = [];
    panel.querySelectorAll('.rw-wa-focus').forEach(el => el.classList.remove('rw-wa-focus'));

    if (!account || account === 'NOT CREATED') {
      step = 1; title = 'Create or load the WhatsApp account'; copy = 'Start here. This creates or loads the authorised account record used by the existing NahaLabs WhatsApp Operator.';
      const b = button('#wa-bootstrap','CREATE / LOAD ACCOUNT',true); if (b) buttons.push(b);
    } else if (account.includes('READY TO PAIR') || account === 'NOT PAIRED') {
      step = 2; title = 'Start pairing'; copy = 'Start the pairing session, then choose QR pairing or the phone-number pairing flow.';
      const b = button('#wa-connect','START PAIRING',true); if (b) buttons.push(b);
    } else if (!connected && code) {
      step = 3; title = 'Finish pairing on the owner’s phone'; copy = 'Scan the QR shown below or enter the short-lived pairing code from WhatsApp → Linked Devices. Stay on this screen until connected.';
    } else if (!connected) {
      step = 3; title = 'Finish pairing on the owner’s phone'; copy = 'Use the QR below, or enter the owner’s international-format number to request a pairing code.';
    } else {
      step = 4; title = 'Test the incident channel'; copy = 'The WhatsApp number is connected. When an incident is active, use SEND INCIDENT ALERT to test outbound notification.';
      const b = button('#wa-notify','SEND INCIDENT ALERT',true); if (b && !b.disabled) buttons.push(b);
      const refresh = button('#wa-refresh','REFRESH STATUS'); if (refresh) buttons.push(refresh);
    }

    guide.querySelector('#rw-wa-step').textContent = `${step} / 4`;
    guide.querySelector('#rw-wa-title').textContent = title;
    guide.querySelector('#rw-wa-copy').textContent = copy;
    guide.querySelectorAll('.rw-wa-journey-steps span').forEach((el,i) => { el.classList.toggle('active', i === step-1); el.classList.toggle('done', i < step-1); });
    const actions = guide.querySelector('#rw-wa-actions'); actions.innerHTML = ''; buttons.forEach(b => actions.appendChild(b));
  }

  document.addEventListener('railwatch:workspace-opened', event => {
    if (event.detail?.type !== 'whatsapp') return;
    ensure(); update();
    setTimeout(update, 250);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.whatsapp-panel button,input')) setTimeout(update, 180);
  });
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden','class'] });
  setTimeout(update, 500);
})();
