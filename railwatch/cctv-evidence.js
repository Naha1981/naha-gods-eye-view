(() => {
  const VIDEO_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7a/Transnet_diesel_locomotives-and-goods-train_crossing_road_and_entering_station_South_Africa.webm/Transnet_diesel_locomotives-and-goods-train_crossing_road_and_entering_station_South_Africa.webm.360p.webm';
  const SOURCE_URL = 'https://commons.wikimedia.org/wiki/File:Transnet_diesel_locomotives-and-goods-train_crossing_road_and_entering_station_South_Africa.webm';
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
          <video id="rw-cctv-video" controls autoplay muted loop playsinline preload="metadata">
            <source src="${VIDEO_URL}" type="video/webm" />
          </video>
          <div class="rw-cctv-badge">DEMO EVIDENCE</div>
          <div class="rw-cctv-rec">● RECORDING REFERENCE</div>
          <div class="rw-cctv-overlayline"><span id="rw-cctv-location">RAIL CORRIDOR</span><span id="rw-cctv-time">--:--:-- SAST</span></div>
        </div>
        <div class="rw-cctv-caption"><span class="positive">VIDEO AVAILABLE</span><span>OPERATOR VIEW · VISUAL VERIFICATION</span></div>
        <div class="rw-cctv-grid">
          <div class="rw-cctv-kpi high"><span>INCIDENT</span><strong id="rw-cctv-incident">CRITICAL</strong></div>
          <div class="rw-cctv-kpi high"><span>CAMERA</span><strong id="rw-cctv-camera">CAM-DEMO</strong></div>
          <div class="rw-cctv-kpi medium"><span>ASSET</span><strong id="rw-cctv-asset">TRACK</strong></div>
          <div class="rw-cctv-kpi good"><span>FEED STATE</span><strong>AVAILABLE</strong></div>
        </div>
        <div class="rw-cctv-note"><b>What the operator is seeing:</b> the video is real South African Transnet rail footage used as a visual reference for this prototype. It is intentionally labelled as <b>demo reference footage</b>; production would replace this source with an authorised live/recorded CCTV adapter.</div>
        <div class="rw-cctv-source">Source: Wikimedia Commons · CC BY-SA 4.0 · <a href="${SOURCE_URL}" target="_blank" rel="noreferrer">view source and licence</a></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#rw-cctv-close').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    return overlay;
  }

  function nowSast() {
    return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ' SAST';
  }

  function open(button) {
    const root = ensureOverlay();
    const video = root.querySelector('#rw-cctv-video');
    root.querySelector('#rw-cctv-title').textContent = 'CCTV evidence · visual verification';
    root.querySelector('#rw-cctv-camera').textContent = 'CAM-DEMO-17';
    root.querySelector('#rw-cctv-asset').textContent = (document.querySelector('.incident-popover h2')?.textContent || 'RAIL ASSET').slice(0, 24).toUpperCase();
    root.querySelector('#rw-cctv-location').textContent = 'ERMelo · RICHARDS BAY DEMO SECTOR';
    root.querySelector('#rw-cctv-time').textContent = nowSast();
    root.classList.add('visible');
    video.currentTime = 0;
    video.play().catch(() => {});
  }

  function close() {
    if (!overlay) return;
    const video = overlay.querySelector('#rw-cctv-video');
    video.pause();
    overlay.classList.remove('visible');
  }

  // Capture the existing VIEW CCTV EVIDENCE action before RailWatch's demo-only handler.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.operator-btn[data-action="cctv"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(button);
  }, true);

  // Escape closes the evidence viewer.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
})();
