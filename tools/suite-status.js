// What a run of tools/run-all.js may say about a commit on GitHub (`--post`): the commit status "suites", which a pull
// request shows beside CI's checks. CI runs the unit tests and static checks; the browser and render suites run on a
// developer's machine before merging, and this is how the pull request knows they did, on that exact commit.
//
//   suiteStatus({ results, only, dirty, sha, host }) -> { ok: true, state, description } | { ok: false, why }
//
// Only a full run (no suites named) of a clean tree says anything: a run that left suites out, or ran edits that
// aren't in the commit, would vouch for code nobody pushed. A run with a failing suite says "failure", so the pull
// request shows the last run, good or bad.

export const CONTEXT = 'suites';

export function suiteStatus({ results, only = [], dirty = false, sha = '', host = '' }) {
  if (only.length) return { ok: false, why: `only a full run is posted (this one named ${only.join(', ')})` };
  if (dirty) return { ok: false, why: 'the working tree has changes the commit doesn’t: commit them and run again' };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, why: 'no commit to post to' };
  if (!results.length) return { ok: false, why: 'no suites ran' };
  const bad = results.filter((r) => r.code !== 0);
  const checks = results.reduce((s, r) => s + r.oks + r.fails, 0);
  const on = host ? ` on ${host}` : '';
  const description = bad.length
    ? `${bad.length} of ${results.length} suites failed: ${bad.map((r) => r.file.replace(/-test\.js$/, '')).slice(0, 4).join(', ')}${bad.length > 4 ? '…' : ''}${on}`
    : `${results.length}/${results.length} suites, ${checks} checks${on}`;
  // GitHub keeps 140 characters of a status's description
  return { ok: true, state: bad.length ? 'failure' : 'success', description: description.slice(0, 140) };
}
