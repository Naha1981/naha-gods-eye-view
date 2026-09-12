import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('evidence ledger exposes sealed chain and export contract', async () => {
  const source = await read('railwatch/evidence-ledger.js');

  assert.match(source, /const STORAGE_KEY = ['"]railwatch:evidence-ledger:v1['"]/);
  assert.match(source, /crypto\.subtle\.digest\(['"]SHA-256['"]/);
  assert.match(source, /const previousHash = entries\.at\(-1\)\?\.hash \|\| ['"]GENESIS['"]/);
  assert.match(source, /sealButton\.addEventListener\(['"]click['"]/);
  assert.match(source, /EVIDENCE_SEALED/);
  assert.match(source, /application\/json/);
  assert.match(source, /railwatch-case-\$\{currentCase\.eventId\}\.json/);
});

test('control room publishes one-way incident and stage events', async () => {
  const source = await read('railwatch/control-room-status.js');

  assert.match(source, /function ingest\(data, announce = true\)/);
  assert.match(source, /if \(announce\) emit\(['"]railwatch:incident['"], data\)/);
  assert.match(source, /function updateStage\(stage, allowRegression = false, announce = true\)/);
  assert.match(source, /if \(announce\) emit\(['"]railwatch:stage['"]/);
  assert.match(source, /document\.addEventListener\(['"]railwatch:incident['"], event => ingest\(event\.detail, false\)\)/);
  assert.match(source, /function setResolutionStage\(stage\) \{\n    updateStage\(stage, false, false\);/);
});
