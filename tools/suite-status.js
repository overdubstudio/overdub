// What a run of tools/run-all.js may say about a commit on GitHub (`--post`): the commit status "suites", which a pull
// request shows beside CI's checks. The suites workflow (.github/workflows/suites.yml) is that check for every push to
// a branch here; --post is for a run on another machine, and says the same about that exact commit.
//
//   suiteStatus({ results, only, dirty, sha, host }) -> { ok: true, state, description } | { ok: false, why }
//
// Only a full run (no suites named) of a clean tree says anything: a run that left suites out, or ran edits that
// aren't in the commit, would vouch for code nobody pushed. A run with a failing suite says "failure", so the pull
// request shows the last run, good or bad. A real-time suite that failed beside others and passed when run again alone
// (run-all marks it retried) counts as passed, and the description names it, so a check that keeps needing it is seen.

export const CONTEXT = 'suites';

// The suites whose checks hold to the wall clock (live meters, the scheduler), which can miss with three suites sharing
// the machine: run-all gives these, and only these, a second go alone. Everywhere else a failure is a wrong result, and
// a wrong result that shows up once is still wrong: it stops the run. Adding a suite here hides its intermittent
// failures from a live deploy, so fix the check first.
export const REAL_TIME = new Set(['jam-test.js']);
export const mayRetry = (file) => REAL_TIME.has(file);

export function suiteStatus({ results, only = [], dirty = false, sha = '', host = '' }) {
  if (only.length) return { ok: false, why: `only a full run is posted (this one named ${only.join(', ')})` };
  if (dirty) return { ok: false, why: 'the working tree has changes the commit doesn’t: commit them and run again' };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, why: 'no commit to post to' };
  if (!results.length) return { ok: false, why: 'no suites ran' };
  const bad = results.filter((r) => r.code !== 0);
  const checks = results.reduce((s, r) => s + r.oks + r.fails, 0);
  const on = host ? ` on ${host}` : '';
  const names = (rs) => `${rs.map((r) => r.file.replace(/-test\.js$/, '')).slice(0, 4).join(', ')}${rs.length > 4 ? '…' : ''}`;
  const again = results.filter((r) => r.retried && r.code === 0);
  const description = bad.length
    ? `${bad.length} of ${results.length} suites failed: ${names(bad)}${on}`
    : `${results.length}/${results.length} suites, ${checks} checks${again.length ? `, retried alone: ${names(again)}` : ''}${on}`;
  // GitHub keeps 140 characters of a status's description
  return { ok: true, state: bad.length ? 'failure' : 'success', description: description.slice(0, 140) };
}

// The lines of a failed suite worth printing: its FAIL lines first, then anything else that reads as an error. A passing
// check is left out even when it says "no page errors", or twelve of those would use up the list before the FAIL.
export function failureLines(out, max = 12) {
  const lines = out.split('\n');
  const fails = lines.filter((l) => /^\s*FAIL /.test(l));
  const others = lines.filter((l) => /FAIL|Error|error/.test(l) && !/^\s*(FAIL|ok) /.test(l));
  return [...fails, ...others].slice(0, max);
}
