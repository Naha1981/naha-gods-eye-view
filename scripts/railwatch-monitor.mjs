import process from 'node:process';

const baseUrl = (process.env.RAILWATCH_API_URL || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const expectedCommit = (process.env.EXPECTED_RENDER_COMMIT || '').trim();
const timeoutMs = Number(process.env.RAILWATCH_MONITOR_TIMEOUT_MS || 15000);

const started = performance.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

function fail(message) {
  console.error(`RAILWATCH MONITOR FAIL: ${message}`);
  process.exitCode = 1;
}

try {
  const response = await fetch(`${baseUrl}/healthz`, {
    signal: controller.signal,
    headers: { 'accept': 'application/json' },
  });

  const elapsedMs = Math.round(performance.now() - started);
  const bodyText = await response.text();

  if (!response.ok) {
    fail(`healthz returned HTTP ${response.status} after ${elapsedMs}ms`);
    console.error(bodyText.slice(0, 500));
  } else {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      fail('healthz returned non-JSON content');
      body = null;
    }

    if (body) {
      if (body.status !== 'ok' || body.service !== 'railwatch-telemetry') {
        fail(`unexpected health contract: ${JSON.stringify(body)}`);
      }

      const commit = body.build?.commit || 'unknown';
      const branch = body.build?.branch || 'unknown';
      const instance = body.build?.instance || 'unknown';

      console.log(`RAILWATCH HEALTH OK · ${elapsedMs}ms`);
      console.log(`  service: ${body.service}`);
      console.log(`  build: ${commit}`);
      console.log(`  branch: ${branch}`);
      console.log(`  instance: ${instance}`);
      console.log(`  connections: ${body.connections}`);
      console.log(`  events: ${body.events}`);
      console.log(`  demo_mode: ${body.demo_mode}`);

      if (expectedCommit && commit !== expectedCommit) {
        fail(`deployment drift detected: expected ${expectedCommit}, Render is serving ${commit}`);
      }
    }
  }
} catch (error) {
  const detail = error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error?.message || String(error);
  fail(`unable to reach ${baseUrl}/healthz · ${detail}`);
} finally {
  clearTimeout(timer);
}
