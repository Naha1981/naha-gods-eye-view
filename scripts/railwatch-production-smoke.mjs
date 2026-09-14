import assert from 'node:assert/strict';

const baseUrl = (process.env.RAILWATCH_API_URL || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
const timeoutMs = Number(process.env.RAILWATCH_PROD_SMOKE_TIMEOUT_MS || 15000);

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(options.headers || {}) },
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) {}
    return { response, body, text };
  } finally {
    clearTimeout(timer);
  }
}

try {
  const health = await request('/healthz');
  assert.equal(health.response.status, 200, `healthz returned HTTP ${health.response.status}`);
  assert.equal(health.body?.status, 'ok');
  assert.equal(health.body?.service, 'railwatch-telemetry');
  assert.ok(health.body?.build?.commit, 'healthz missing build commit');

  const whatsappHealth = await request('/api/v1/whatsapp/health');
  assert.equal(whatsappHealth.response.status, 200, `WhatsApp health returned HTTP ${whatsappHealth.response.status}`);
  assert.equal(whatsappHealth.body?.appId, 'railwatch');

  const eventsBefore = await request('/api/v1/events?limit=1');
  assert.equal(eventsBefore.response.status, 200);
  assert.ok(Array.isArray(eventsBefore.body), 'events endpoint did not return an array');

  const demo = await request('/api/v1/demo/line-breach', { method: 'POST' });
  assert.equal(demo.response.status, 202, `demo endpoint returned HTTP ${demo.response.status}`);
  assert.equal(demo.body?.status, 'accepted');
  assert.ok(demo.body?.event_id, 'demo response missing event_id');

  const eventsAfter = await request('/api/v1/events?limit=1');
  assert.equal(eventsAfter.response.status, 200);
  const latest = eventsAfter.body?.at(-1)?.data;
  assert.equal(latest?.event_id, demo.body.event_id, 'accepted demo event not visible in recent events');
  assert.equal(latest?.alert_type, 'LINE_BREACH');
  assert.equal(latest?.severity, 'CRITICAL');
  assert.ok(Array.isArray(latest?.incident?.assets) && latest.incident.assets.length >= 3, 'incident asset package missing');

  const session = await request('/api/v1/whatsapp/session');
  assert.equal(session.response.status, 200, `demo operator session returned HTTP ${session.response.status}`);
  assert.ok(session.body?.token, 'demo operator session missing token');
  assert.ok(session.body?.tenant, 'demo operator session missing tenant');
  const auth = { authorization: `Bearer ${session.body.token}` };

  const timelineBefore = await request(`/api/v1/incidents/${encodeURIComponent(demo.body.event_id)}/timeline`, { headers: auth });
  assert.equal(timelineBefore.response.status, 200);
  assert.equal(timelineBefore.body?.tenant, session.body.tenant);
  assert.equal(timelineBefore.body?.stage, 'DETECT');

  for (const [action, expectedStage] of [
    ['ACKNOWLEDGE', 'VERIFY'],
    ['DISPATCH', 'RESPOND'],
    ['RESOLVE', 'RESOLVE'],
    ['PROVE', 'PROVE'],
  ]) {
    const result = await request(`/api/v1/incidents/${encodeURIComponent(demo.body.event_id)}/action`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ action, note: 'Automated production smoke verification' }),
    });
    assert.equal(result.response.status, 200, `${action} returned HTTP ${result.response.status}`);
    assert.equal(result.body?.stage, expectedStage, `${action} did not advance to ${expectedStage}`);
  }

  const replay = await request(`/api/v1/incidents/${encodeURIComponent(demo.body.event_id)}/replay`, { headers: auth });
  assert.equal(replay.response.status, 200);
  assert.ok(replay.body?.timeline?.length >= 5, 'incident replay does not contain the full smoke timeline');

  console.log('RailWatch production smoke PASS');
  console.log(`  base: ${baseUrl}`);
  console.log(`  build: ${health.body.build.commit}`);
  console.log(`  branch: ${health.body.build.branch}`);
  console.log(`  demo event: ${demo.body.event_id}`);
  console.log(`  tenant: ${session.body.tenant}`);
  console.log('  health contract ✓');
  console.log('  WhatsApp health contract ✓');
  console.log('  events contract ✓');
  console.log('  demo ingest ✓');
  console.log('  tenant-scoped incident ✓');
  console.log('  operator action loop ✓');
  console.log('  incident replay ✓');
} catch (error) {
  console.error(`RAILWATCH PRODUCTION SMOKE FAIL: ${error?.message || error}`);
  process.exitCode = 1;
}
