// Every listed model must pass the validation gate (gear on the ground, something
// behind the windows, parts mapped). See scripts/validate.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('all listed models pass npm run validate', () => {
  const r = spawnSync(process.execPath, ['--import', './scripts/node/register.js', 'scripts/validate.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.split('\n').filter(l => l.startsWith('FAIL')).join('\n'));
});

test('every texture of a detailed model is a format browsers can load', () => {
  const r = spawnSync(process.execPath, ['scripts/fix-textures.js', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});
