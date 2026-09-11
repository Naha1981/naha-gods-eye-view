import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'railwatch-telemetry',
      connections: 0,
      events: 0,
      demo_mode: true,
      build: { commit: 'WRONG-COMMIT', branch: 'main', instance: 'selftest' },
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;

try {
  const child = spawn(process.execPath, ['scripts/railwatch-monitor.mjs'], {
    env: {
      ...process.env,
      RAILWATCH_API_URL: `http://127.0.0.1:${port}`,
      EXPECTED_RENDER_COMMIT: 'EXPECTED-COMMIT',
      RAILWATCH_MONITOR_TIMEOUT_MS: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const [result] = await once(child, 'close');

  const output = `${stdout}\n${stderr}`;
  assert.equal(result, 1, `monitor unexpectedly passed:\n${output}`);
  assert.match(output, /deployment drift detected/i);
  console.log('RailWatch monitor self-test PASS');
  console.log('  synthetic deployment drift detected ✓');
} finally {
  server.close();
}
