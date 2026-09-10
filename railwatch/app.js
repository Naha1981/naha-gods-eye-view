const params = new URLSearchParams(location.search);
const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/v1/c2-stream';

const viewer = new Cesium.Viewer('map', {
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  navigationHelpButton: false,
  sceneModePicker: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  terrain: undefined,
});

viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({
  url: 'https://tile.openstreetmap.org/'
}));
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(28.0473, -26.2041, 850000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-70), roll: 0 }
});

const feed = document.getElementById('alert-feed');
const alertCount = document.getElementById('alert-count');
const clientCount = document.getElementById('client-count');
const wsDot = document.getElementById('ws-dot');
const wsLabel = document.getElementById('ws-label');
const activeIds = new Set();

function addAlert(data) {
  const [lat, lon] = data.location;
  activeIds.add(data.event_id);
  alertCount.textContent = String(activeIds.size);

  viewer.entities.removeById(data.event_id);
  viewer.entities.add({
    id: data.event_id,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, data.elevation_m || 0),
    point: {
      pixelSize: 18,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: data.target_label,
      font: '700 13px monospace',
      showBackground: true,
      backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.75),
      fillColor: Cesium.Color.WHITE,
      outlineWidth: 0,
      pixelOffset: new Cesium.Cartesian2(0, -32),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, data.camera_preset.range_meters),
    orientation: {
      heading: Cesium.Math.toRadians(data.camera_preset.heading),
      pitch: Cesium.Math.toRadians(data.camera_preset.pitch),
      roll: 0,
    },
    duration: 2.0,
  });

  const row = document.createElement('article');
  row.className = 'alert';
  row.innerHTML = `
    <div class="alert-severity">${escapeHtml(data.severity)}</div>
    <strong>${escapeHtml(data.segment)} · KM ${Number(data.km_marker).toFixed(1)}</strong>
    <span>${escapeHtml(data.alert_type)} · ${escapeHtml(data.sensor_id)}</span>
  `;
  feed.prepend(row);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function connect() {
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    wsDot.classList.add('online');
    wsLabel.textContent = 'CONNECTED';
    ws.send('hello');
  };
  ws.onclose = () => {
    wsDot.classList.remove('online');
    wsLabel.textContent = 'RECONNECTING';
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.action === 'TRIGGER_ALARM') addAlert(message.data);
    } catch (error) {
      console.error('RailWatch message error', error);
    }
  };
}

async function refreshHealth() {
  try {
    const res = await fetch(`${apiBase}/healthz`);
    const data = await res.json();
    clientCount.textContent = String(data.connections);
  } catch {
    clientCount.textContent = '—';
  }
}

document.getElementById('demo-alert').addEventListener('click', async () => {
  const button = document.getElementById('demo-alert');
  button.disabled = true;
  try {
    const res = await fetch(`${apiBase}/api/v1/demo/line-breach`, { method: 'POST' });
    if (!res.ok) throw new Error(`Demo request failed: ${res.status}`);
  } catch (error) {
    console.error(error);
    wsLabel.textContent = 'DEMO ERROR';
  } finally {
    setTimeout(() => { button.disabled = false; }, 1000);
  }
});

connect();
refreshHealth();
setInterval(refreshHealth, 3000);
