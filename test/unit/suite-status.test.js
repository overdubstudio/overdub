// tools/suite-status.js: the lines of a failed suite that run-all prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureLines } from '../../tools/suite-status.js';

test('failureLines: a passing check that mentions errors never crowds out a FAIL', () => {
  const noise = Array.from({ length: 20 }, (_, i) => `ok ${i}: no page errors`);
  const out = [...noise, 'TypeError: late', '  FAIL the one that matters', 'ok after'].join('\n');
  assert.deepEqual(failureLines(out), ['  FAIL the one that matters', 'TypeError: late']);
});

test('failureLines: FAIL lines come first and the list stops at the limit', () => {
  const out = ['boom error', ...Array.from({ length: 15 }, (_, i) => `FAIL ${i}`)].join('\n');
  const got = failureLines(out);
  assert.equal(got.length, 12);
  assert.equal(got[0], 'FAIL 0');
  assert.ok(!got.includes('boom error'));
  assert.deepEqual(failureLines('all fine\nok 1'), []);
});
