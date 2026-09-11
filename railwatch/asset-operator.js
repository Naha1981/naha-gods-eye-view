const assetParams = new URLSearchParams(location.search);
const assetApiBase = (assetParams.get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const assetWsUrl = assetApiBase.replace(/^http/, 'ws') + '/ws/v1/c2-stream';

const state = {
  incident: null,
  assets: [],
  filter: 'ALL',
  actions: new Map(),
};

const root = document.createElement('aside');
root.className = 'asset-operator';
root.setAttribute('aria-label', 'Asset intelligence');
root.innerHTML = `
  <header class="asset-operator-header">
    <span class="asset-operator-kicker">OPERATOR LAYER · DEMO</span>
    <div class="asset-operator-title">
      <h2>Asset intelligence</h2>
      <span id="asset-corridor">WAITING FOR EVENT</span>
    </div>
    <div class="asset-operator-summary">
      <div><small>ASSETS</small><strong id="asset-total">0</strong></div>
      <div><small>PRIORITY</small><strong id="asset-priority">0</strong></div>
      <div><small>VERIFIED</small><strong id="asset-verified">0</strong></div>
    </div>
  </header>
  <div class="asset-operator-event" id="asset-event">Run a line-breach simulation to populate the operator layer.</div>
  <nav class="asset-operator-filters" aria-label="Asset filters">
    <button class="asset-operator-filter active" data-filter="ALL">ALL</button>
    <button class="asset-operator-filter" data-filter="PRIORITY">PRIORITY</button>
    <button class="asset-operator-filter" data-filter="UNVERIFIED">UNVERIFIED</button>
  </nav>
  <section class="asset-operator-list" id="asset-list"></section>
  <footer class="asset-operator-footer">PROTOTYPE ACTIONS · NO FIELD DISPATCH IS SENT FROM THIS DEMO</footer>
`;
document.body.appendChild(root);

const totalEl = document.getElementById('asset-total');
const priorityEl = document.getElementById('asset-priority');
const verifiedEl = document.getElementById('asset-verified');
const corridorEl = document.getElementById('asset-corridor');
const eventEl = document.getElementById('asset-event');
const listEl = document.getElementById('asset-list');

const toast = document.createElement('div');
toast.className = 'asset-action-toast';
document.body.appendChild(toast);
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function priorityScore(asset) {
  const status = String(asset.status || '').toUpperCase();
  if (status === 'ALERT') return 3;
  if (status === 'UNKNOWN') return 2;
  return 1;
}

function actionFor(asset) {
  return state.actions.get(asset.asset_id) || { verified: false, dispatched: false };
}

function setAction(asset, key) {
  const current = actionFor(asset);
  current[key] = !current[key];
  state.actions.set(asset.asset_id, current);
  render();
  const verb = key === 'verified' ? (current.verified ? 'VERIFIED' : 'UNVERIFIED') : (current.dispatched ? 'DISPATCH QUEUED' : 'DISPATCH CLEARED');
  showToast(`${asset.asset_type} · ${verb} · DEMO ONLY`);
}

function focusAsset(asset) {
  try {
    if (typeof viewer !== 'undefined' && viewer?.camera) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(asset.longitude, asset.latitude, 900),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-52), roll: 0 },
        duration: 1.15,
      });
    }
  } catch (error) {
    console.debug('Asset focus unavailable', error);
  }
  showToast(`${asset.asset_type} · ${Number(asset.distance_km || 0).toFixed(1)} KM FROM INCIDENT`);
}

function filteredAssets() {
  const sorted = [...state.assets].sort((a, b) => {
    const score = priorityScore(b) - priorityScore(a);
    return score || Number(a.distance_km || 0) - Number(b.distance_km || 0);
  });
  if (state.filter === 'PRIORITY') return sorted.filter(a => priorityScore(a) >= 2);
  if (state.filter === 'UNVERIFIED') return sorted.filter(a => !actionFor(a).verified);
  return sorted;
}

function render() {
  const priorityCount = state.assets.filter(a => priorityScore(a) >= 2).length;
  const verifiedCount = state.assets.filter(a => actionFor(a).verified).length;
  totalEl.textContent = String(state.assets.length);
  priorityEl.textContent = String(priorityCount);
  verifiedEl.textContent = String(verifiedCount);
  corridorEl.textContent = state.incident?.corridor || 'WAITING FOR EVENT';

  if (!state.assets.length) {
    listEl.innerHTML = '<div class="asset-operator-empty">NO ASSETS AVAILABLE<br/>WAITING FOR AN INCIDENT SIGNAL</div>';
    return;
  }

  const assets = filteredAssets();
  if (!assets.length) {
    listEl.innerHTML = '<div class="asset-operator-empty">NO ASSETS MATCH THIS FILTER</div>';
    return;
  }

  listEl.innerHTML = assets.map(asset => {
    const actions = actionFor(asset);
    const status = String(asset.status || 'UNKNOWN').toUpperCase();
    const statusClass = status.toLowerCase();
    const priority = priorityScore(asset) >= 2 ? ' priority' : '';
    return `
      <article class="asset-card${priority}">
        <div class="asset-card-head">
          <span class="asset-card-type">${escapeAsset(asset.asset_type)}</span>
          <span class="asset-card-status ${statusClass}">${escapeAsset(status)}</span>
        </div>
        <div class="asset-card-name">${escapeAsset(asset.name)}</div>
        <div class="asset-card-condition">${escapeAsset(asset.condition)}</div>
        <div class="asset-card-meta"><span>${Number(asset.distance_km || 0).toFixed(1)} KM FROM INCIDENT</span><span>${actions.verified ? 'FIELD CHECKED' : 'NOT VERIFIED'}</span></div>
        <div class="asset-card-actions">
          <button data-action="focus" data-id="${escapeAsset(asset.asset_id)}">FOCUS</button>
          <button data-action="verified" data-id="${escapeAsset(asset.asset_id)}" class="${actions.verified ? 'selected' : ''}">${actions.verified ? 'VERIFIED' : 'VERIFY'}</button>
          <button data-action="dispatched" data-id="${escapeAsset(asset.asset_id)}" class="${actions.dispatched ? 'selected' : ''}">${actions.dispatched ? 'QUEUED' : 'DISPATCH'}</button>
        </div>
      </article>`;
  }).join('');
}

function escapeAsset(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function ingest(data) {
  if (!data?.incident) return;
  state.incident = data;
  state.assets = Array.isArray(data.incident.assets) ? data.incident.assets : [];
  corridorEl.textContent = data.corridor || data.segment || 'INCIDENT';
  eventEl.innerHTML = `<strong>${escapeAsset(data.alert_type || 'LINE_BREACH')}</strong> · ${escapeAsset(data.segment || 'Unknown segment')} · KM ${Number(data.km_marker || 0).toFixed(1)}<br>${escapeAsset(data.incident.operational_impact || 'Impact assessment pending')}`;
  render();
}

document.querySelectorAll('.asset-operator-filter').forEach(button => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('.asset-operator-filter').forEach(item => item.classList.toggle('active', item === button));
    render();
  });
});

listEl.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const asset = state.assets.find(item => item.asset_id === button.dataset.id);
  if (!asset) return;
  if (button.dataset.action === 'focus') focusAsset(asset);
  if (button.dataset.action === 'verified') setAction(asset, 'verified');
  if (button.dataset.action === 'dispatched') setAction(asset, 'dispatched');
});

async function hydrateRecentEvent() {
  try {
    const response = await fetch(`${assetApiBase}/api/v1/events?limit=1`);
    if (!response.ok) return;
    const events = await response.json();
    const latest = events?.at(-1)?.data;
    if (latest) ingest(latest);
  } catch (error) {
    console.debug('Recent event hydration unavailable', error);
  }
}

function connectAssetStream() {
  const ws = new WebSocket(assetWsUrl);
  ws.onopen = () => ws.send('asset-operator');
  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.action === 'TRIGGER_ALARM') ingest(message.data);
    } catch (error) {
      console.debug('Asset operator stream error', error);
    }
  };
  ws.onclose = () => setTimeout(connectAssetStream, 1800);
}

render();
hydrateRecentEvent();
connectAssetStream();
