const params = new URLSearchParams(location.search);
const apiBase = (params.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/v1/c2-stream';

const viewer = new Cesium.Viewer('map', {
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
  homeButton: false, navigationHelpButton: false, sceneModePicker: false,
  fullscreenButton: false, infoBox: false, selectionIndicator: false, terrain: undefined,
});
viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
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
const corridorEntities = [];
let currentIncident = null;

const corridorRoutes = [
  { name: 'NORTHCOR', points: [[-26.52,29.99],[-26.15,29.98],[-25.70,30.10],[-25.40,30.20],[-28.00,32.05],[-28.78,32.04]], width: 5 },
  { name: 'NORTHEASTCOR', points: [[-22.36,29.33],[-23.90,29.45],[-25.00,30.38],[-26.15,28.99],[-25.94,29.60],[-28.78,32.04]], width: 4 },
  { name: 'CENTRALCOR', points: [[-26.20,28.05],[-26.95,27.10],[-27.38,26.65],[-27.90,25.86],[-28.70,25.53]], width: 4 },
  { name: 'CONTAINERCOR', points: [[-26.20,28.05],[-26.55,27.95],[-27.55,28.05],[-28.50,29.00],[-29.86,30.98]], width: 6 },
  { name: 'CAPECOR', points: [[-27.20,25.20],[-29.12,26.22],[-29.62,25.47],[-31.90,26.90],[-33.92,18.42],[-33.96,25.60]], width: 4 },
  { name: 'ORECOR', points: [[-28.70,21.25],[-29.60,22.74],[-30.65,24.20],[-31.92,25.00],[-32.10,25.64]], width: 7 },
];

function buildCorridorLayer() {
  corridorRoutes.forEach(route => {
    const positions = route.points.map(([lat, lon]) => Cesium.Cartesian3.fromDegrees(lon, lat, 55));
    const line = viewer.entities.add({
      id: `corridor-${route.name}`,
      polyline: { positions, width: route.width, material: Cesium.Color.fromAlpha(Cesium.Color.LIME, 0.58), clampToGround: true },
    });
    line.railwatchCorridor = route.name;
    corridorEntities.push(line);
    const mid = route.points[Math.floor(route.points.length / 2)];
    const label = viewer.entities.add({
      id: `corridor-label-${route.name}`,
      position: Cesium.Cartesian3.fromDegrees(mid[1], mid[0], 120),
      label: {
        text: route.name, font: '800 11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: Cesium.Color.WHITE, showBackground: true,
        backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.62),
        pixelOffset: new Cesium.Cartesian2(0, -6), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    label.railwatchCorridor = route.name;
    corridorEntities.push(label);
  });
}
buildCorridorLayer();

function assetProfile(asset) {
  const type = String(asset.asset_type || '').toUpperCase();
  if (type.includes('SIGNALLING')) return {
    priority: 'HIGH', confidence: 'HIGH', verification: 'PENDING',
    evidence: 'Sensor anomaly + mapped asset proximity', camera: 'CAM-DEMO-17',
    freshness: '2 min ago', history: ['08:04 · Sensor anomaly detected', '08:05 · Asset linked to incident', '08:06 · Field verification pending']
  };
  if (type.includes('TELECOMMUNICATION')) return {
    priority: 'MEDIUM', confidence: 'MEDIUM', verification: 'UNVERIFIED',
    evidence: 'Mapped asset inside incident radius', camera: 'CAM-DEMO-19',
    freshness: '4 min ago', history: ['07:58 · Last healthy heartbeat', '08:05 · Incident proximity raised', '08:06 · Verification not started']
  };
  return {
    priority: 'HIGH', confidence: 'MEDIUM', verification: 'PENDING',
    evidence: 'Incident geometry overlaps track asset', camera: 'CAM-DEMO-18',
    freshness: '1 min ago', history: ['08:03 · Track section normal', '08:05 · Breach raised nearby', '08:06 · Field inspection required']
  };
}

function addIncidentAssets(data) {
  const assets = data.incident?.assets || [];
  assets.forEach(asset => {
    const id = `${data.event_id}-asset-${asset.asset_id}`;
    viewer.entities.removeById(id);
    const profile = assetProfile(asset);
    const entity = viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(asset.longitude, asset.latitude, Number(data.elevation_m || 0) + 8),
      point: {
        pixelSize: profile.priority === 'HIGH' ? 14 : 11,
        color: profile.verification === 'UNVERIFIED' ? Cesium.Color.YELLOW : Cesium.Color.ORANGE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${asset.asset_type} · ${asset.distance_km.toFixed(1)} km`,
        font: '700 10px ui-monospace, SFMono-Regular, Menlo, monospace', showBackground: true,
        backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.7), fillColor: Cesium.Color.WHITE,
        pixelOffset: new Cesium.Cartesian2(12, 0), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entity.railwatchData = data;
    entity.railwatchAsset = asset;
  });
}

function addAlert(data) {
  const [lat, lon] = data.location;
  const elevation = Number(data.elevation_m || 0);
  activeIds.add(data.event_id);
  alertCount.textContent = String(activeIds.size);
  ['hazard','ring-1','ring-2','ring-3'].forEach(suffix => viewer.entities.removeById(`${data.event_id}-${suffix}`));
  const hazardPosition = Cesium.Cartesian3.fromDegrees(lon, lat, elevation + 6);
  const incident = data.incident || {};
  const hazardEntity = viewer.entities.add({
    id: `${data.event_id}-hazard`, position: hazardPosition,
    point: { pixelSize: 22, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: `⚠ CRITICAL · ${data.alert_type}`, font: '800 13px ui-monospace, SFMono-Regular, Menlo, monospace', showBackground: true,
      backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.82), fillColor: Cesium.Color.WHITE, outlineWidth: 0,
      pixelOffset: new Cesium.Cartesian2(0, -38), disableDepthTestDistance: Number.POSITIVE_INFINITY }
  });
  hazardEntity.railwatchData = data;
  [70,130,210].forEach((radius,index) => {
    const ring = viewer.entities.add({
      id: `${data.event_id}-ring-${index+1}`, position: hazardPosition,
      ellipse: { semiMajorAxis: radius, semiMinorAxis: radius, height: elevation + 2, material: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.035),
        outline: true, outlineColor: Cesium.Color.fromAlpha(Cesium.Color.RED, 0.72-index*0.14), outlineWidth: index===0?4:2, classificationType: Cesium.ClassificationType.BOTH }
    });
    ring.railwatchData = data;
  });
  addIncidentAssets(data);
  currentIncident = data;
  viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints([hazardPosition, Cesium.Cartesian3.fromDegrees(lon,lat,elevation+20)]), {
    duration: 2, offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(data.camera_preset.heading), Cesium.Math.toRadians(data.camera_preset.pitch), Number(data.camera_preset.range_meters || 420))
  });
  const row = document.createElement('article');
  row.className='alert';
  row.innerHTML=`<div class="alert-severity">${escapeHtml(data.severity)}</div><strong>${escapeHtml(data.segment)} · KM ${Number(data.km_marker).toFixed(1)}</strong><span>${escapeHtml(data.alert_type)} · ${escapeHtml(data.sensor_id)}</span><small>${escapeHtml(incident.asset_type || 'Asset details pending')} · ${(incident.assets || []).length} nearby assets</small>`;
  row.addEventListener('mouseenter',()=>showIncident(data));
  feed.prepend(row);
}

function renderAssetRows(data) {
  const assets = data.incident?.assets || [];
  return assets.length ? `<div class="asset-list"><div class="asset-list-title">NEARBY INFRASTRUCTURE · SELECT AN ASSET</div>${assets.map((asset,index)=>{
    const p=assetProfile(asset);
    return `<button class="asset-row asset-select" type="button" data-asset-index="${index}"><div><strong>${escapeHtml(asset.asset_type)}</strong><span>${escapeHtml(asset.name)}</span></div><b>${p.priority} · ${Number(asset.distance_km).toFixed(1)} km</b></button>`;
  }).join('')}</div>` : '';
}

function showAssetDetail(data, asset) {
  const p = assetProfile(asset);
  incidentPopover.innerHTML = `
    <button class="back-to-incident" type="button" id="back-to-incident">← BACK TO INCIDENT</button>
    <div class="popover-critical">● ASSET INTELLIGENCE · ${escapeHtml(p.priority)}</div>
    <h2>${escapeHtml(asset.name)}</h2>
    <div class="popover-grid">
      <div><span>TYPE</span><strong>${escapeHtml(asset.asset_type)}</strong></div>
      <div><span>DISTANCE</span><strong>${Number(asset.distance_km).toFixed(1)} KM</strong></div>
      <div><span>VERIFICATION</span><strong>${escapeHtml(p.verification)}</strong></div>
      <div><span>CONFIDENCE</span><strong>${escapeHtml(p.confidence)}</strong></div>
    </div>
    <div class="evidence-card"><div class="asset-list-title">EVIDENCE</div><strong>${escapeHtml(p.evidence)}</strong><span>Source freshness: ${escapeHtml(p.freshness)} · Demo evidence record</span><button type="button" class="operator-btn" data-action="cctv">VIEW CCTV EVIDENCE</button></div>
    <div class="evidence-card"><div class="asset-list-title">VERIFICATION</div><strong>${escapeHtml(asset.condition)}</strong><span>Current state: ${escapeHtml(p.verification)}</span><button type="button" class="operator-btn" data-action="verify">MARK FIELD VERIFIED</button></div>
    <div class="history-card"><div class="asset-list-title">RESPONSE HISTORY</div>${p.history.map(item=>`<div class="history-row">${escapeHtml(item)}</div>`).join('')}</div>
    <div class="popover-foot">DEMO WORKFLOW · NOT AUTHORITATIVE FIELD OR CCTV DATA</div>`;
  incidentPopover.classList.add('visible');
  document.getElementById('back-to-incident').addEventListener('click',()=>showIncident(data));
  incidentPopover.querySelector('[data-action="cctv"]').addEventListener('click',()=>showCctvEvidence(data,asset,p));
  incidentPopover.querySelector('[data-action="verify"]').addEventListener('click',()=>markVerified(data,asset));
}

function showCctvEvidence(data, asset, p) {
  incidentPopover.innerHTML = `<button class="back-to-incident" type="button" id="back-to-asset">← BACK TO ASSET</button><div class="popover-critical">● CCTV VERIFICATION · DEMO</div><h2>${escapeHtml(p.camera)} · ${escapeHtml(asset.asset_type)}</h2><div class="cctv-frame"><div class="cctv-scan">SIMULATED LIVE FRAME</div><div class="cctv-crosshair">+</div><div class="cctv-caption">${escapeHtml(asset.name)} · ${escapeHtml(p.freshness)}</div></div><p><b>Operator note</b><br>CCTV evidence is represented as a prototype verification surface. A production adapter can supply HLS/WebRTC camera feeds and recorded clips.</p><button type="button" class="operator-btn" id="cctv-verified">CONFIRM VISUAL CHECK</button>`;
  incidentPopover.classList.add('visible');
  document.getElementById('back-to-asset').addEventListener('click',()=>showAssetDetail(data,asset));
  document.getElementById('cctv-verified').addEventListener('click',()=>{
    asset.demoVerification='VERIFIED';
    showAssetDetail(data,asset);
    toast('Visual check recorded in demo response history');
  });
}

function markVerified(data, asset) {
  asset.demoVerification='VERIFIED';
  showAssetDetail(data,asset);
  toast('Field verification recorded in demo workflow');
}

function showIncident(data) {
  currentIncident=data;
  const incident=data.incident||{};
  const assets=incident.assets||[];
  incidentPopover.innerHTML=`<div class="popover-critical">● ${escapeHtml(data.severity)} INCIDENT</div><h2>${escapeHtml(incident.location_name||data.segment)}</h2><div class="popover-grid"><div><span>ALERT</span><strong>${escapeHtml(data.alert_type)}</strong></div><div><span>KM MARKER</span><strong>${Number(data.km_marker).toFixed(1)}</strong></div><div><span>SENSOR</span><strong>${escapeHtml(data.sensor_id)}</strong></div><div><span>ASSET</span><strong>${escapeHtml(incident.asset_type||'Unknown')}</strong></div></div>${renderAssetRows(data)}<p><b>Condition</b><br>${escapeHtml(incident.asset_condition||'Assessment pending')}</p><p><b>Operational impact</b><br>${escapeHtml(incident.operational_impact||'Impact assessment pending')}</p><p><b>Recommended action</b><br>${escapeHtml(incident.recommended_action||'Verify with field operations')}</p><div class="popover-foot">${escapeHtml(incident.data_classification||'DEMO · NOT AUTHORITATIVE GIS')}</div>`;
  incidentPopover.classList.add('visible');
  incidentPopover.querySelectorAll('.asset-select').forEach(btn=>btn.addEventListener('click',()=>showAssetDetail(data,assets[Number(btn.dataset.assetIndex)])));
}

function hideIncident(){ /* keep operator panel open while pointer is inside it */ }
function toast(message){ wsLabel.textContent=message.toUpperCase(); setTimeout(()=>{ if(wsDot.classList.contains('online')) wsLabel.textContent='CONNECTED'; },2200); }
function escapeHtml(value){ return String(value??'').replace(/[&<>'\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }

const hoverHandler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
hoverHandler.setInputAction((movement)=>{
  const picked=viewer.scene.pick(movement.endPosition);
  if(Cesium.defined(picked)&&picked.id?.railwatchData){
    showIncident(picked.id.railwatchData);
    viewer.scene.canvas.style.cursor=picked.id.railwatchAsset?'pointer':'crosshair';
  } else if(!incidentPopover.matches(':hover')) {
    incidentPopover.classList.remove('visible');
    viewer.scene.canvas.style.cursor='default';
  }
},Cesium.ScreenSpaceEventType.MOUSE_MOVE);

function connect(){
  const ws=new WebSocket(wsUrl);
  ws.onopen=()=>{wsDot.classList.add('online');wsLabel.textContent='CONNECTED';ws.send('hello');};
  ws.onclose=()=>{wsDot.classList.remove('online');wsLabel.textContent='RECONNECTING';setTimeout(connect,1500);};
  ws.onerror=()=>ws.close();
  ws.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.action==='TRIGGER_ALARM')addAlert(message.data);}catch(error){console.error('RailWatch message error',error);}};
}

async function refreshHealth(){
  try{const res=await fetch(`${apiBase}/healthz`);const data=await res.json();clientCount.textContent=String(data.connections);}catch{clientCount.textContent='—';}
}

document.getElementById('demo-alert').addEventListener('click',async()=>{
  const button=document.getElementById('demo-alert');button.disabled=true;
  try{const res=await fetch(`${apiBase}/api/v1/demo/line-breach`,{method:'POST'});if(!res.ok)throw new Error(`Demo request failed: ${res.status}`);}catch(error){console.error(error);wsLabel.textContent='DEMO ERROR';}
  finally{setTimeout(()=>{button.disabled=false;},1000);}
});

incidentPopover.addEventListener('mouseenter',()=>{viewer.scene.canvas.style.cursor='default';});
incidentPopover.addEventListener('mouseleave',()=>{if(currentIncident) viewer.scene.canvas.style.cursor='default';});
connect();refreshHealth();setInterval(refreshHealth,3000);
