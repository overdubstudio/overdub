// tools/suite-status.js: what `node tools/run-all.js --post` may say about a commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT, suiteStatus } from '../../tools/suite-status.js';

const SHA = 'a'.repeat(40);
const pass = (file, oks = 10) => ({ file, code: 0, oks, fails: 0 });
const fail = (file, oks = 9, fails = 1) => ({ file, code: 1, oks, fails });

test('a full, clean run that passed: success, with the counts and the machine', () => {
  const st = suiteStatus({
    results: [pass('rooms-test.js', 69), pass('kernel-test.js', 99)],
    sha: SHA,
    host: 'ghastly',
  });
  assert.deepEqual(st, { ok: true, state: 'success', description: '2/2 suites, 168 checks on ghastly' });
  assert.equal(CONTEXT, 'suites');
});

test('a failing suite posts failure and names it, so the pull request shows the last run good or bad', () => {
  const st = suiteStatus({ results: [pass('studio-test.js'), fail('rooms-test.js', 38, 4)], sha: SHA });
  assert.deepEqual(st, { ok: true, state: 'failure', description: '1 of 2 suites failed: rooms' });
  // a crash (non-zero exit, no FAIL line) is a failure too
  assert.equal(suiteStatus({ results: [{ file: 'x-test.js', code: 1, oks: 3, fails: 0 }], sha: SHA }).state, 'failure');
});

test('it never vouches for code nobody pushed, or for part of the suite', () => {
  const results = [pass('studio-test.js')];
  assert.match(suiteStatus({ results, sha: SHA, only: ['rooms'] }).why, /only a full run/);
  assert.match(suiteStatus({ results, sha: SHA, dirty: true }).why, /working tree has changes/);
  assert.match(suiteStatus({ results, sha: '' }).why, /no commit/);
  assert.match(suiteStatus({ results, sha: 'HEAD' }).why, /no commit/);
  assert.match(suiteStatus({ results: [], sha: SHA }).why, /no suites ran/);
  for (const st of [suiteStatus({ results, sha: SHA, only: ['x'] }), suiteStatus({ results, sha: SHA, dirty: true })])
    assert.equal(st.ok, false);
});

test('the description fits GitHub’s 140 characters, however many suites fail', () => {
  const many = Array.from({ length: 40 }, (_, i) => fail(`a-very-long-suite-name-number-${i}-test.js`));
  const st = suiteStatus({ results: many, sha: SHA, host: 'h'.repeat(80) });
  assert.equal(st.state, 'failure');
  assert.ok(
    st.description.length <= 140 &&
      st.description.startsWith('40 of 40 suites failed: a-very-long-suite-name-number-0, '),
  );
});

test('a suite that passed when run again alone counts, and is named', () => {
  const st = suiteStatus({
    results: [pass('studio-test.js'), { ...pass('jam-test.js', 168), retried: true }],
    sha: SHA,
    host: 'mbp',
  });
  assert.deepEqual(st, {
    ok: true,
    state: 'success',
    description: '2/2 suites, 178 checks, retried alone: jam on mbp',
  });
  // one that failed again is a failure, retried or not
  const twice = suiteStatus({ results: [pass('studio-test.js'), { ...fail('jam-test.js'), retried: true }], sha: SHA });
  assert.deepEqual(twice, { ok: true, state: 'failure', description: '1 of 2 suites failed: jam' });
});
