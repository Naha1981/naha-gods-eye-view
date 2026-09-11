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
const incidentPopover = document.getElementById('incident-popover');
const activeIds = new Set();

function addAlert(data) {
  const [lat, lon] = data.location;
  const elevation = Number(data.elevation_m || 0);
  activeIds.add(data.event_id);
  alertCount.textContent = String(activeIds.size);

  viewer.entities.removeById(`${data.event_id}-hazard`);
  viewer.entities.removeById(`${data.event_id}-ring-1`);
  viewer.entities.removeById(`${data.event_id}-ring-2`);
  viewer.entities.removeById(`${data.event_id}-ring-3`);

  const hazardPosition = Cesium.Cartesian3.fromDegrees(lon, lat, elevation + 6);
  const incident = data.incident || {};
  const hazardEntity = viewer.entities.add({
    id: `${data.event_id}-hazard`,
    position: hazardPosition,
    point: {
      pixelSize: 22,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `⚠ CRITICAL · ${data.alert_type}`,
      font: '800 13px ui-monospace, SFMono-Regular, Menlo, monospace',
      showBackground: true,
      backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.82),
      fillColor: Cesium.Color.WHITE,
      outlineWidth: 0,
      pixelOffset: new Cesium.Cartesian2(0, -38),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  hazardEntity.railwatchData = data;

  // Concentric warning rings make the breach readable at a glance.
  [70, 130, 210].forEach((radius, index) => {
    const ring = viewer.entities.add({
      id: `${data.event_id}-ring-${index + 1}`,
      position: hazardPosition,
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        height: elevation + 2,
        material: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.035),
        outline: true,
        outlineColor: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.72 - index * 0.14),
        outlineWidth: index === 0 ? 4 : 2,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    ring.railwatchData = data;
  });

  // Put the camera above the incident and explicitly look at the breach center.
  const center = Cesium.BoundingSphere.fromPoints([
    hazardPosition,
    Cesium.Cartesian3.fromDegrees(lon, lat, elevation + 20),
  ]);
  viewer.camera.flyToBoundingSphere(center, {
    duration: 2.0,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(data.camera_preset.heading),
      Cesium.Math.toRadians(data.camera_preset.pitch),
      Number(data.camera_preset.range_meters || 420),
    ),
  });

  const row = document.createElement('article');
  row.className = 'alert';
  row.innerHTML = `
    <div class="alert-severity">${escapeHtml(data.severity)}</div>
    <strong>${escapeHtml(data.segment)} · KM ${Number(data.km_marker).toFixed(1)}</strong>
    <span>${escapeHtml(data.alert_type)} · ${escapeHtml(data.sensor_id)}</span>
    <small>${escapeHtml(incident.asset_type || 'Asset details pending')}</small>
  `;
  row.addEventListener('mouseenter', () => showIncident(data, window.innerWidth - 360, 170));
  row.addEventListener('mouseleave', hideIncident);
  feed.prepend(row);
}

function showIncident(data, x, y) {
  const incident = data.incident || {};
  incidentPopover.innerHTML = `
    <div class="popover-critical">● ${escapeHtml(data.severity)} INCIDENT</div>
    <h2>${escapeHtml(incident.location_name || data.segment)}</h2>
    <div class="popover-grid">
      <div><span>ALERT</span><strong>${escapeHtml(data.alert_type)}</strong></div>
      <div><span>KM MARKER</span><strong>${Number(data.km_marker).toFixed(1)}</strong></div>
      <div><span>SENSOR</span><strong>${escapeHtml(data.sensor_id)}</strong></div>
      <div><span>ASSET</span><strong>${escapeHtml(incident.asset_type || 'Unknown')}</strong></div>
    </div>
    <p><b>Condition</b><br>${escapeHtml(incident.asset_condition || 'Assessment pending')}</p>
    <p><b>Operational impact</b><br>${escapeHtml(incident.operational_impact || 'Impact assessment pending')}</p>
    <p><b>Recommended action</b><br>${escapeHtml(incident.recommended_action || 'Verify with field operations')}</p>
  `;
  incidentPopover.style.left = `${Math.min(Math.max(16, x), window.innerWidth - 380)}px`;
  incidentPopover.style.top = `${Math.min(Math.max(90, y), window.innerHeight - 300)}px`;
  incidentPopover.classList.add('visible');
}

function hideIncident() {
  incidentPopover.classList.remove('visible');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

const hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
hoverHandler.setInputAction((movement) => {
  const picked = viewer.scene.pick(movement.endPosition);
  if (Cesium.defined(picked) && picked.id?.railwatchData) {
    showIncident(picked.id.railwatchData, movement.endPosition.x + 18, movement.endPosition.y + 18);
    viewer.scene.canvas.style.cursor = 'crosshair';
  } else {
    hideIncident();
    viewer.scene.canvas.style.cursor = 'default';
  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

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
