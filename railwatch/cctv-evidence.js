(() => {
  const VIDEO_MP4_URL = 'https://www.openbeelden.nl/files/55/55145.55131.WEEKNUMMER393-HRE0002A506.mp4';
  const VIDEO_WEBM_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7a/Transnet_diesel_locomotives-and-goods-train_crossing_road_and_entering_station_South_Africa.webm/Transnet_diesel_locomotives-and-goods-train_crossing_road_and_entering_station_South_Africa.webm.360p.webm';
  const SOURCE_URL = 'https://www.openbeelden.nl/media/55132/Opening_van_de_spoorwegtentoonstelling.en';
  let overlay;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'railwatch-cctv-overlay';
    overlay.innerHTML = `
      <div class="rw-cctv-modal" role="dialog" aria-modal="true" aria-label="CCTV evidence viewer">
        <div class="rw-cctv-head">
          <div>
            <div class="rw-cctv-eyebrow">EVIDENCE VIEWER · RAILWATCH</div>
            <div class="rw-cctv-title" id="rw-cctv-title">Camera evidence</div>
            <div class="rw-cctv-sub" id="rw-cctv-sub">DEMO REFERENCE FOOTAGE · NOT A LIVE TRANSNET CAMERA</div>
          </div>
          <button class="rw-cctv-close" id="rw-cctv-close" type="button">CLOSE</button>
        </div>
        <div class="rw-cctv-stage">
          <video id="rw-cctv-video" controls autoplay muted loop playsinline preload="auto" poster="https://www.openbeelden.nl/images/598912/vlcsnap-208355.png">
            <source src="${VIDEO_MP4_URL}" type="video/mp4" />
            <source src="${VIDEO_WEBM_URL}" type="video/webm" />
            Your browser could not load the CCTV reference video.
          </video>
          <div class="rw-cctv-badge">DEMO EVIDENCE</div>
          <div class="rw-cctv-rec">● RECORDING REFERENCE</div>
          <div class="rw-cctv-overlayline"><span id="rw-cctv-location">RAIL CORRIDOR</span><span id="rw-cctv-time">--:--:-- SAST</span></div>
          <div class="rw-cctv-feed-status" id="rw-cctv-feed-status">LOADING VIDEO…</div>
        </div>
        <div class="rw-cctv-caption"><span class="positive" id="rw-cctv-availability">VIDEO LOADING</span><span>OPERATOR VIEW · VISUAL VERIFICATION</span></div>
        <div class="rw-cctv-grid">
          <div class="rw-cctv-kpi high"><span>INCIDENT</span><strong id="rw-cctv-incident">CRITICAL</strong></div>
          <div class="rw-cctv-kpi high"><span>CAMERA</span><strong id="rw-cctv-camera">CAM-DEMO</strong></div>
          <div class="rw-cctv-kpi medium"><span>ASSET</span><strong id="rw-cctv-asset">TRACK</strong></div>
          <div class="rw-cctv-kpi good"><span>FEED STATE</span><strong id="rw-cctv-feed-state">LOADING</strong></div>
        </div>
        <div class="rw-cctv-note"><b>Demo note:</b> this is recorded railway reference footage for the prototype, not a live Transnet security camera. Production would replace it with an authorised HLS/WebRTC CCTV feed or recorded clip.</div>
        <div class="rw-cctv-source">Source: Open Beelden · Public Domain Mark · <a href="${SOURCE_URL}" target="_blank" rel="noreferrer">view source and licence</a></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rw-cctv-close').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    const video = overlay.querySelector('#rw-cctv-video');
    video.addEventListener('playing', () => {
      overlay.querySelector('#rw-cctv-feed-status').textContent = '● PLAYING REFERENCE FEED';
      overlay.querySelector('#rw-cctv-feed-state').textContent = 'PLAYING';
      overlay.querySelector('#rw-cctv-availability').textContent = 'VIDEO PLAYING';
      overlay.querySelector('#rw-cctv-availability').className = 'positive';
    });
    video.addEventListener('canplay', () => {
      overlay.querySelector('#rw-cctv-feed-status').textContent = 'READY · CLICK PLAY IF NEEDED';
      overlay.querySelector('#rw-cctv-feed-state').textContent = 'READY';
      overlay.querySelector('#rw-cctv-availability').textContent = 'VIDEO READY';
    });
    video.addEventListener('error', () => {
      overlay.querySelector('#rw-cctv-feed-status').textContent = 'VIDEO SOURCE UNAVAILABLE';
      overlay.querySelector('#rw-cctv-feed-state').textContent = 'UNAVAILABLE';
      overlay.querySelector('#rw-cctv-availability').textContent = 'FEED ERROR';
      overlay.querySelector('#rw-cctv-availability').className = 'warning';
    });
    return overlay;
  }

  function nowSast() {
    return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' SAST';
  }

  function open() {
    const root = ensureOverlay();
    const video = root.querySelector('#rw-cctv-video');
    root.querySelector('#rw-cctv-title').textContent = 'CCTV evidence · visual verification';
    root.querySelector('#rw-cctv-camera').textContent = 'CAM-DEMO-17';
    root.querySelector('#rw-cctv-asset').textContent = (document.querySelector('.incident-popover h2')?.textContent || 'RAIL ASSET').slice(0, 24).toUpperCase();
    root.querySelector('#rw-cctv-location').textContent = 'RAIL CORRIDOR · DEMO SECTOR';
    root.querySelector('#rw-cctv-time').textContent = nowSast();
    root.classList.add('visible');
    video.load();
    video.currentTime = 0;
    video.play().catch(() => {});
  }

  function close() {
    if (!overlay) return;
    const video = overlay.querySelector('#rw-cctv-video');
    video.pause();
    overlay.classList.remove('visible');
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.operator-btn[data-action="cctv"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
})();
