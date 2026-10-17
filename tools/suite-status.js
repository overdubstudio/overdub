// What a run of tools/run-all.js may say about a commit on GitHub (`--post`): the commit status "suites", which a pull
// request shows beside CI's checks. CI runs the unit tests and static checks; the browser and render suites run on a
// developer's machine before merging, and this is how the pull request knows they did, on that exact commit.
//
//   suiteStatus({ results, only, dirty, sha, host }) -> { ok: true, state, description } | { ok: false, why }
//
// Only a full run (no suites named) of a clean tree says anything: a run that left suites out, or ran edits that
// aren't in the commit, would vouch for code nobody pushed. A run with a failing suite says "failure", so the pull
// request shows the last run, good or bad. A suite that failed beside others and passed when run again alone (run-all
// marks it retried) counts as passed, and the description names it, so a check that keeps needing it is seen.

export const CONTEXT = 'suites';

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
