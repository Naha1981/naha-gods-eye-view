import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer';

const DEMO_EVENT = {
  event_id: 'AGENT-QA-001',
  corridor: 'TFR-COAL-DEMO',
  segment: 'Ermelo · Richards Bay demonstration sector',
  km_marker: 142.8,
  location: [-26.5225, 29.9811],
  elevation_m: 1600,
  alert_type: 'LINE_BREACH',
  severity: 'CRITICAL',
  sensor_id: 'AGENT-QA-SENSOR',
  camera_preset: { pitch: -48, heading: 35, range_meters: 420 },
  incident: {
    location_name: 'Ermelo–Richards Bay Coal Line · Demo Sector',
    asset_type: 'Rail infrastructure / wayside equipment',
    asset_condition: 'Possible tampering or physical damage detected',
    operational_impact: 'Potential line interruption; train movement should be verified before dispatch',
    recommended_action: 'Dispatch nearest response team and verify track status via field crew / CCTV',
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
    res.end(JSON.stringify({ status: 'ok', service: 'railwatch-telemetry', connections: wss.clients.size, events: 1, demo_mode: true, build: { commit: 'agent-local', branch: 'qa', instance: 'agent' } }));
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
    res.end(JSON.stringify({ status: 'accepted', event_id: DEMO_EVENT.event_id, broadcast_connections: wss.clients.size }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server: backend });
backend.listen(0, '127.0.0.1');
await once(backend, 'listening');
const backendPort = backend.address().port;

const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4174'], {
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

const rectOverlaps = (a, b, gap = 0) => !(
  a.right + gap <= b.left ||
  a.left - gap >= b.right ||
  a.bottom + gap <= b.top ||
  a.top - gap >= b.bottom
);

const agents = [
  {
    name: 'Boot Agent',
    run: async page => {
      await page.goto(`http://127.0.0.1:4174/railwatch/?api=http://127.0.0.1:${backendPort}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('#demo-alert', { timeout: 15000 });
      assert(await page.$('.topbar'), 'dashboard header missing');
      assert(await page.$('.panel'), 'operator panel missing');
      assert(await page.$('#alert-feed'), 'alert feed missing');
      assert(await page.$('.control-room-status'), 'incident control status missing');
    },
  },
  {
    name: 'Incident Flow Agent',
    run: async page => {
      await page.click('#demo-alert');
      await page.waitForSelector('.alert', { timeout: 10000 });
      await page.evaluate(event => window.showIncident(event), DEMO_EVENT);
      await page.waitForSelector('#incident-popover.visible', { timeout: 5000 });
      const text = await page.$eval('#incident-popover', el => el.textContent || '');
      assert.match(text, /NEARBY INFRASTRUCTURE/i);
      assert.match(text, /SIGNALLING/i);
      assert.match(text, /TRACK ASSET/i);
      assert.match(text, /TELECOMMUNICATIONS/i);
      assert.match(text, /Operational impact/i);
      assert.match(text, /Recommended action/i);
      await page.click('[data-acknowledge-incident]');
      await page.waitForFunction(() => document.querySelector('.crs-stage[data-stage="LOCATE"]')?.classList.contains('active'), { timeout: 5000 });
      const operatorButton = await page.$('.asset-operator button[data-action="dispatched"][data-id="DEMO-SIG-0142"]');
      assert(operatorButton, 'core asset operator dispatch control disappeared after acknowledgement');
      const hitTested = await page.$eval('.asset-operator button[data-action="dispatched"][data-id="DEMO-SIG-0142"]', button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === button || button.contains(hit);
      });
      assert(hitTested, 'core asset operator control is blocked after acknowledgement');
    },
  },
  {
    name: 'UX Guard Agent',
    run: async page => {
      const layout = await page.evaluate(() => {
        const pop = document.querySelector('#incident-popover');
        const header = document.querySelector('.topbar');
        const left = document.querySelector('.panel');
        const feed = document.querySelector('.feed');
        const style = getComputedStyle(pop);
        const r = pop.getBoundingClientRect();
        return {
          viewport: { width: innerWidth, height: innerHeight },
          popover: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, overflowY: style.overflowY, cursor: style.cursor, display: style.display, scrollHeight: pop.scrollHeight, clientHeight: pop.clientHeight },
          header: header?.getBoundingClientRect(),
          panel: left?.getBoundingClientRect(),
          feed: feed?.getBoundingClientRect(),
        };
      });
      assert(layout.popover.left >= 0 && layout.popover.right <= layout.viewport.width, 'incident panel escapes horizontal viewport');
      assert(layout.popover.top >= 0 && layout.popover.bottom <= layout.viewport.height, 'incident panel escapes vertical viewport');
      assert.equal(layout.popover.display, 'block', 'incident panel is not visible');
      assert.equal(layout.popover.overflowY, 'auto', 'incident panel does not expose internal scrolling');
      assert.equal(layout.popover.cursor, 'default', 'incident panel cursor is not normal pointer');
      const point = await page.$eval('#incident-popover', el => {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        return { before: el.scrollTop, max: el.scrollHeight - el.clientHeight };
      });
      assert(point.max >= 0, 'incident panel has invalid scroll geometry');
      if (point.max > 0) assert(point.before > 0, 'incident panel did not scroll internally');
    },
  },
  {
    name: 'Control Room Layout Agent',
    run: async page => {
      const viewports = [
        { width: 1600, height: 1000 },
        { width: 1200, height: 900 },
        { width: 1100, height: 900 },
        { width: 700, height: 900 },
      ];
      for (const viewport of viewports) {
        await page.setViewport(viewport);
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await new Promise(resolve => setTimeout(resolve, 50));
        const geometry = await page.evaluate(() => {
          const rect = selector => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, zIndex: Number(style.zIndex) || 0, display: style.display };
          };
          return {
            viewport: { width: innerWidth, height: innerHeight },
            status: rect('.control-room-status'),
            header: rect('.topbar'),
            panel: rect('.panel'),
            feed: rect('.feed'),
          };
        });
        assert(geometry.status, `incident control missing at ${viewport.width}x${viewport.height}`);
        assert.equal(geometry.status.display, 'grid', `incident control not laid out as grid at ${viewport.width}x${viewport.height}`);
        for (const [name, other] of [['header', geometry.header], ['left panel', geometry.panel], ['alert feed', geometry.feed]]) {
          if (!other) continue;
          assert(!rectOverlaps(geometry.status, other, 1), `incident control overlaps ${name} at ${viewport.width}x${viewport.height}`);
        }
        assert(geometry.status.left >= 0 && geometry.status.right <= geometry.viewport.width, `incident control escapes horizontally at ${viewport.width}x${viewport.height}`);
        assert(geometry.status.top >= 0 && geometry.status.bottom <= geometry.viewport.height, `incident control escapes vertically at ${viewport.width}x${viewport.height}`);
      }
      await page.setViewport({ width: 1600, height: 1000 });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    },
  },
  {
    name: 'Evidence Agent',
    run: async page => {
      const text = await page.$eval('#incident-popover', el => el.textContent || '');
      for (const marker of ['INCIDENT INTELLIGENCE', 'CCTV VERIFICATION', 'GEO RISK ENGINE', 'RECOMMENDED RESPONSE', 'INCIDENT HISTORY SIGNAL', 'EVIDENCE CHAIN']) {
        assert(text.toUpperCase().includes(marker), `missing evidence marker: ${marker}`);
      }
    },
  },
  {
    name: 'Console Sentinel Agent',
    run: async page => {
      const errors = page.__railwatchErrors || [];
      assert.deepEqual(errors, [], `browser console/page errors detected: ${errors.join(' | ')}`);
    },
  },
];

try {
  await waitFor('http://127.0.0.1:4174/railwatch/');
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(), args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.__railwatchErrors = [];
    page.on('console', message => { if (message.type() === 'error') page.__railwatchErrors.push(`console: ${message.text()}`); });
    page.on('pageerror', error => page.__railwatchErrors.push(`page: ${error.message}`));

    const results = [];
    for (const agent of agents) {
      const started = Date.now();
      try {
        await agent.run(page);
        const result = { agent: agent.name, status: 'PASS', duration_ms: Date.now() - started };
        results.push(result);
        console.log(`AGENT PASS · ${agent.name} · ${result.duration_ms}ms`);
      } catch (error) {
        const result = { agent: agent.name, status: 'FAIL', duration_ms: Date.now() - started, error: error?.message || String(error) };
        results.push(result);
        console.error(`AGENT FAIL · ${agent.name} · ${result.error}`);
        throw error;
      }
    }

    const summary = { generated_at: new Date().toISOString(), viewport: { width: 1600, height: 1000 }, agents: results };
    await import('node:fs/promises').then(({ writeFile }) => writeFile('artifacts/railwatch-agentic-qa.json', JSON.stringify(summary, null, 2)));
    await page.screenshot({ path: 'artifacts/railwatch-agentic-qa.png', fullPage: true });
    console.log('RailWatch autonomous QA PASS');
    console.log('  specialized agents: boot, incident flow, UX guard, control room layout, evidence, console sentinel');
    console.log('  machine-readable evidence: artifacts/railwatch-agentic-qa.json');
    console.log('  visual evidence: artifacts/railwatch-agentic-qa.png');
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(`RAILWATCH AUTONOMOUS QA FAIL: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  vite.kill('SIGTERM');
  backend.close();
  wss.close();
}
