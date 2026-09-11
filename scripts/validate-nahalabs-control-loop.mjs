import { readFile } from 'node:fs/promises';

const manifestPath = new URL('./nahalabs-control-loop.json', import.meta.url);
const policyPath = new URL('./nahalabs-recovery-policy.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const policy = JSON.parse(await readFile(policyPath, 'utf8'));

const required = [
  ['verification.local_smoke', manifest.verification?.local_smoke],
  ['verification.monitor', manifest.verification?.monitor],
  ['verification.monitor_selftest', manifest.verification?.monitor_selftest],
  ['verification.production_smoke', manifest.verification?.production_smoke],
  ['verification.deployment_workflow', manifest.verification?.deployment_workflow],
  ['verification.health_workflow', manifest.verification?.health_workflow],
  ['service.health_url', manifest.service?.health_url],
  ['service.production_api_url', manifest.service?.production_api_url],
  ['recovery.policy', manifest.recovery?.policy],
];

const missing = required.filter(([, value]) => !String(value || '').trim());
if (missing.length) {
  console.error('NahaLabs control-loop manifest invalid. Missing:');
  for (const [name] of missing) console.error(`- ${name}`);
  process.exit(1);
}

if (manifest.schema_version !== '1.0') {
  throw new Error(`Unsupported control-loop schema: ${manifest.schema_version}`);
}

if (policy.schema_version !== '1.0') {
  throw new Error(`Unsupported recovery-policy schema: ${policy.schema_version}`);
}

if (!Number.isInteger(policy.defaults?.health_attempts) || policy.defaults.health_attempts < 1 || policy.defaults.health_attempts > 5) {
  throw new Error('Recovery policy health_attempts must be an integer from 1 to 5');
}

if (!Array.isArray(policy.defaults?.retry_delays_ms) || policy.defaults.retry_delays_ms.some(value => !Number.isInteger(value) || value < 0)) {
  throw new Error('Recovery policy retry_delays_ms must contain non-negative integers');
}

if (!policy.escalation || !policy.allowed_automatic_recovery?.length || !policy.forbidden_automatic_actions?.length) {
  throw new Error('Recovery policy must define recovery actions, forbidden actions and escalation');
}

console.log('NahaLabs control-loop manifest PASS');
console.log(`  service: ${manifest.service.name}`);
console.log(`  health: ${manifest.service.health_url}`);
console.log(`  local smoke: ${manifest.verification.local_smoke}`);
console.log(`  production smoke: ${manifest.verification.production_smoke}`);
console.log(`  deployment workflow: ${manifest.verification.deployment_workflow}`);
console.log(`  health workflow: ${manifest.verification.health_workflow}`);
console.log(`  recovery attempts: ${policy.defaults.health_attempts}`);
console.log(`  rules: ${manifest.rules.length}`);
