import process from 'node:process';

const baseUrl = (process.env.RAILWATCH_API_URL || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const expectedCommit = (process.env.EXPECTED_RENDER_COMMIT || '').trim();
const timeoutMs = Number(process.env.RAILWATCH_MONITOR_TIMEOUT_MS || 15000);
const maxAttempts = Number(process.env.RAILWATCH_MONITOR_ATTEMPTS || 3);
const retryDelaysMs = [1000, 3000];

function fail(message) {
  console.error(`RAILWATCH MONITOR FAIL: ${message}`);
  process.exitCode = 1;
}

async function probe() {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/healthz`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const elapsedMs = Math.round(performance.now() - started);
    const bodyText = await response.text();
    let body = null;
    try { body = JSON.parse(bodyText); } catch (_) {}
    return { response, body, bodyText, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

let lastError = null;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const { response, body, bodyText, elapsedMs } = await probe();

    if (!response.ok) {
      lastError = `healthz returned HTTP ${response.status} after ${elapsedMs}ms`;
      console.error(`RAILWATCH RETRY ${attempt}/${maxAttempts}: ${lastError}`);
      console.error(bodyText.slice(0, 500));
    } else if (!body) {
      lastError = 'healthz returned non-JSON content';
      console.error(`RAILWATCH RETRY ${attempt}/${maxAttempts}: ${lastError}`);
    } else if (body.status !== 'ok' || body.service !== 'railwatch-telemetry') {
      lastError = `unexpected health contract: ${JSON.stringify(body)}`;
      console.error(`RAILWATCH RETRY ${attempt}/${maxAttempts}: ${lastError}`);
    } else {
      const commit = body.build?.commit || 'unknown';
      const branch = body.build?.branch || 'unknown';
      const instance = body.build?.instance || 'unknown';

      console.log(`RAILWATCH HEALTH OK · ${elapsedMs}ms · attempt ${attempt}/${maxAttempts}`);
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
      process.exit(0);
    }
  } catch (error) {
    const detail = error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error?.message || String(error);
    lastError = `unable to reach ${baseUrl}/healthz · ${detail}`;
    console.error(`RAILWATCH RETRY ${attempt}/${maxAttempts}: ${lastError}`);
  }

  if (attempt < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1)));
  }
}

fail(lastError || `no successful health probe after ${maxAttempts} attempts`);
