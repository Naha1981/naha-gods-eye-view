import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

const DEMO_EVENT = {
  event_id: 'WORKSPACE-QA-001',
  corridor: 'TFR-COAL-DEMO',
  segment: 'Ermelo · Richards Bay demonstration sector',
  km_marker: 142.8,
  location: [-26.5225, 29.9811],
  elevation_m: 1600,
  alert_type: 'LINE_BREACH',
  severity: 'CRITICAL',
  sensor_id: 'WORKSPACE-QA-SENSOR',
  incident: {
    location_name: 'Ermelo–Richards Bay Coal Line · Demo Sector',
    asset_type: 'Rail infrastructure / wayside equipment',
    asset_condition: 'Possible tampering or physical damage detected',
    operational_impact: 'Potential line interruption; train movement should be verified before dispatch',
    recommended_action: 'Verify train movement, review CCTV, then dispatch response if confirmed',
    data_classification: 'DEMO · NOT AUTHORITATIVE GIS',
    assets: [
      { asset_id: 'DEMO-SIG-0142', asset_type: 'SIGNALLING', name: 'Demo block signal / control point', latitude: -26.5205, longitude: 29.9781, status: 'ALERT', condition: 'Potential interference / inspection required', distance_km: 0.39 },
      { asset_id: 'DEMO-PT-0142', asset_type: 'TRACK ASSET', name: 'Demo turnout / permanent-way section', latitude: -26.5239, longitude: 29.9835, status: 'MONITOR', condition: 'Within incident zone; field verification required', distance_km: 0.30 },
      { asset_id: 'DEMO-TRL-0142', asset_type: 'TELECOMMUNICATIONS', name: 'Demo wayside telemetry cabinet', latitude: -26.5217, longitude: 29.9848, status: 'UNKNOWN', condition: 'No current health confirmation', distance_km: 0.41 },
    ],
  },
};

await mkdir('artifacts', { recursive: true });
const wsPayload = JSON.stringify({ action: 'TRIGGER_ALARM', schema_version: '1.2', data: DEMO_EVENT });

const backend = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', demo_mode: true }));
    return;
  }
  if (req.url?.startsWith('/api/v1/events')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ action: 'TRIGGER_ALARM', data: DEMO_EVENT }]));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/v1/demo/line-breach') {
    for (const client of wss.clients) if (client.readyState === 1) client.send(wsPayload);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', event_id: DEMO_EVENT.event_id }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server: backend });
backend.listen(0, '127.0.0.1');
await once(backend, 'listening');
const backendPort = backend.address().port;

const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4175'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
let viteOutput = '';
vite.stdout.on('data', chunk => { viteOutput += chunk.toString(); });
vite.stderr.on('data', chunk => { viteOutput += chunk.toString(); });

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${viteOutput}`);
}

const workspaceSelectors = [
  '#incident-popover',
  '.audit-feed-panel',
  '.evidence-ledger',
  '.incident-history',
  '#railwatch-cctv-overlay',
  '.asset-operator',
  '.dispatch-intelligence',
  '.resolution-intelligence',
];

async function visibleWorkspaceState(page) {
  return page.evaluate(selectors => {
    const visible = selector => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = getComputedStyle(el);
      const classVisible = el.matches('.asset-operator')
        ? !el.classList.contains('closed')
        : el.classList.contains('visible');
      return classVisible && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0;
    };
    return {
      visible: selectors.filter(visible),
      workspaceOpen: document.body.classList.contains('rw-workspace-open'),
      scrimVisible: Boolean(document.querySelector('.rw-workspace-scrim.visible')),
    };
  }, workspaceSelectors);
}

async function assertSingleWorkspace(page, expected) {
  const state = await visibleWorkspaceState(page);
  assert.equal(state.visible.length, 1, `expected one active workspace, got ${state.visible.join(', ') || 'none'}`);
  assert.equal(state.visible[0], expected, `expected ${expected}, got ${state.visible[0]}`);
  assert(state.workspaceOpen, 'workspace mode is not active');
  assert(state.scrimVisible, 'workspace scrim is not visible');
}

const results = [];
const errors = [];

try {
  await waitFor('http://127.0.0.1:4175/railwatch/');
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(), args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', error => errors.push(`page: ${error.message}`));

    const geometry = async viewport => {
      await page.setViewport(viewport);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await new Promise(resolve => setTimeout(resolve, 75));
      return page.evaluate(() => {
        const read = selector => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, display: getComputedStyle(el).display };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          header: read('.topbar'),
          status: read('.control-room-status'),
          panel: read('.panel'),
          feed: read('.feed'),
        };
      });
    };

    for (const viewport of [
      { width: 1600, height: 1000 },
      { width: 1200, height: 900 },
      { width: 900, height: 900 },
      { width: 700, height: 900 },
    ]) {
      const g = await geometry(viewport);
      assert(g.header && g.status, `header/status missing at ${viewport.width}x${viewport.height}`);
      assert.equal(g.status.display, 'grid', `incident control is not a grid at ${viewport.width}x${viewport.height}`);
      assert(g.status.left >= g.header.left - 1 && g.status.right <= g.header.right + 1, `incident control escapes header horizontally at ${viewport.width}x${viewport.height}`);
      assert(g.status.top >= g.header.top - 1 && g.status.bottom <= g.header.bottom + 1, `incident control escapes header vertically at ${viewport.width}x${viewport.height}`);
      if (g.panel) assert(g.panel.top >= g.header.bottom + 3, `left panel starts inside header at ${viewport.width}x${viewport.height}`);
      if (g.feed) assert(g.feed.top >= g.header.bottom + 3, `alert feed starts inside header at ${viewport.width}x${viewport.height}`);
      results.push({ agent: 'Layout Agent', viewport, status: 'PASS' });
    }

    await page.setViewport({ width: 1600, height: 1000 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForSelector('#demo-alert', { timeout: 15000 });
    await page.evaluate(event => window.showIncident(event), DEMO_EVENT);
    await page.waitForSelector('#incident-popover.visible', { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 200));
    await assertSingleWorkspace(page, '#incident-popover');
    results.push({ agent: 'Workspace Exclusivity Agent', step: 'incident-open', status: 'PASS' });

    const text = await page.$eval('#incident-popover', el => el.textContent || '');
    for (const marker of ['NEARBY INFRASTRUCTURE', 'SIGNALLING', 'TRACK ASSET', 'TELECOMMUNICATIONS', 'EVIDENCE CHAIN']) {
      assert(text.toUpperCase().includes(marker), `incident workspace missing ${marker}`);
    }
    results.push({ agent: 'Incident Content Agent', status: 'PASS' });

    await page.click('.rw-workspace-nav button[data-rw-workspace="ledger"]');
    await new Promise(resolve => setTimeout(resolve, 150));
    await assertSingleWorkspace(page, '.evidence-ledger');
    results.push({ agent: 'Workspace Exclusivity Agent', step: 'ledger-tab', status: 'PASS' });

    await page.click('.rw-workspace-back');
    await new Promise(resolve => setTimeout(resolve, 150));
    await assertSingleWorkspace(page, '#incident-popover');
    results.push({ agent: 'Workspace Navigation Agent', step: 'back-to-incident', status: 'PASS' });

    await page.click('.rw-workspace-nav button[data-rw-workspace="activity"]');
    await new Promise(resolve => setTimeout(resolve, 150));
    await assertSingleWorkspace(page, '.audit-feed-panel');
    results.push({ agent: 'Workspace Exclusivity Agent', step: 'activity-tab', status: 'PASS' });

    await page.click('.rw-workspace-back');
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 100));
    const closed = await visibleWorkspaceState(page);
    assert.equal(closed.visible.length, 0, `workspace remained visible after close: ${closed.visible.join(', ')}`);
    assert(!closed.workspaceOpen, 'workspace mode remained active after close');
    assert(!closed.scrimVisible, 'scrim remained visible after close');
    results.push({ agent: 'Workspace Close Agent', status: 'PASS' });

    assert.deepEqual(errors, [], `browser console/page errors detected: ${errors.join(' | ')}`);
    results.push({ agent: 'Console Sentinel Agent', status: 'PASS' });

    const summary = { generated_at: new Date().toISOString(), results, errors };
    await import('node:fs/promises').then(({ writeFile }) => writeFile('artifacts/railwatch-workspace-qa.json', JSON.stringify(summary, null, 2)));
    await page.screenshot({ path: 'artifacts/railwatch-workspace-qa.png', fullPage: true });
    console.log('RailWatch workspace UX QA PASS');
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(`RAILWATCH WORKSPACE UX QA FAIL: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  vite.kill('SIGTERM');
  backend.close();
  wss.close();
}
