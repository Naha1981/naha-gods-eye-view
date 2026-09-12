import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'railwatch', 'control-room-status.js');

/**
 * Regression contract for the incident-ingest race fixed in 9dde5d2.
 * Re-ingesting the latest incident (including background hydration) must not
 * move a control-room workflow backwards after an operator has advanced it.
 */
test('control-room stage updates are monotonic by default', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /let currentStage = ['"]DETECT['"]/);
  assert.match(source, /const stageIndex = \{ DETECT: 0, LOCATE: 1, VERIFY: 2, RESPOND: 3, RESOLVE: 4, PROVE: 5 \}/);
  assert.match(source, /function updateStage\(stage, allowRegression = false\)/);
  assert.match(source, /if \(!allowRegression && stageIndex\[stage\] < stageIndex\[currentStage\]\) return;/);
  assert.match(source, /currentStage = stage;/);
  assert.match(source, /updateStage\('DETECT'\);/);
});
