// Accuracy: models built from a reference drawing must keep matching it.
// Runs scripts/reference/compare.js and checks silhouette overlap per view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const id of readdirSync('references')) {
  const dir = join('references', id);
  const refFile = join(dir, 'reference.json');
  if (!existsSync(refFile)) continue;
  const ref = JSON.parse(readFileSync(refFile, 'utf8'));
  test(`${id}: model matches its reference drawing`, () => {
    const r = spawnSync(process.execPath, ['--import', './scripts/node/register.js', 'scripts/reference/compare.js', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1));
    for (const [view, min] of Object.entries(ref.accuracy)) {
      assert.ok(report[view].iou >= min, `${view} silhouette overlap ${report[view].iou}, needs ${min}`);
    }
  });
}
