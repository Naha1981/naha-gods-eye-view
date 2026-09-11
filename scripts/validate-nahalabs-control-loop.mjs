import { readFile } from 'node:fs/promises';

const manifestPath = new URL('./nahalabs-control-loop.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const required = [
  ['verification.local_smoke', manifest.verification?.local_smoke],
  ['verification.monitor', manifest.verification?.monitor],
  ['verification.monitor_selftest', manifest.verification?.monitor_selftest],
  ['verification.production_smoke', manifest.verification?.production_smoke],
  ['verification.deployment_workflow', manifest.verification?.deployment_workflow],
  ['verification.health_workflow', manifest.verification?.health_workflow],
  ['service.health_url', manifest.service?.health_url],
  ['service.production_api_url', manifest.service?.production_api_url],
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

console.log('NahaLabs control-loop manifest PASS');
console.log(`  service: ${manifest.service.name}`);
console.log(`  health: ${manifest.service.health_url}`);
console.log(`  local smoke: ${manifest.verification.local_smoke}`);
console.log(`  production smoke: ${manifest.verification.production_smoke}`);
console.log(`  deployment workflow: ${manifest.verification.deployment_workflow}`);
console.log(`  health workflow: ${manifest.verification.health_workflow}`);
console.log(`  rules: ${manifest.rules.length}`);
