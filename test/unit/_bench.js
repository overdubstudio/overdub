// What test/unit/bench.test.js and its bench-oracles-N.test.js files share: OverdubBench's tasks scored in this process.
// The oracles are split over SHARDS files because every score is a render and one process renders one at a time:
// node --test runs the files side by side. A task is in the shard its place in the sorted list falls to, so every
// task (and every near miss, which goes with its task) is scored in exactly one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTask, listTasks, startSong, applyOps, scoreTask, HERE } from '../../tools/bench/score.js';

export const SHARDS = 4;
export const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
export const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const strip = (s) => JSON.stringify({ ...s, checks: s.checks.map(({ label, ...c }) => c) });
export const run = (task, input, opts) => {
  const start = startSong(task);
  const r = applyOps(start, input);
  if (!r.ok) return { error: r.error };
  return scoreTask(task, r.song, { start, ...opts });
};
export const shardOf = (id, all = listTasks()) => all.indexOf(id) % SHARDS;

// the oracles, baselines, near misses and determinism of shard n (0-based)
export function oracleTests(n) {
  const all = listTasks();
  const ids = all.filter((id) => shardOf(id, all) === n);
  const first = {};
  test(`oracles, baselines, near misses (${n + 1} of ${SHARDS})`, () => {
    for (const id of ids) {
      const task = loadTask(id);
      const oracle = run(task, read(path.join(HERE, 'oracles', id + '.json')));
      const base = run(task, []);
      first[id] = oracle;
      T.ok(
        !oracle.error && oracle.score >= 0.9,
        `${id}: the oracle scores ${oracle.error ? 'nothing (' + oracle.error + ')' : oracle.score.toFixed(3)} (≥ 0.9)`,
      );
      T.ok(!base.error && base.score < 0.5, `${id}: doing nothing scores ${base.score?.toFixed(3)} (< 0.5)`);
    }
    const nearDir = path.join(HERE, 'oracles', 'near-misses');
    for (const f of fs
      .readdirSync(nearDir)
      .filter((x) => x.endsWith('.json'))
      .sort()) {
      const near = read(path.join(nearDir, f));
      if (shardOf(near.task, all) !== n) continue;
      const s = run(loadTask(near.task), near);
      T.ok(!s.error && s.score < 0.5, `near miss ${f}: ${s.score?.toFixed(3)} (< 0.5): ${near.why}`);
    }
  });
  test(`determinism (${n + 1} of ${SHARDS})`, () => {
    let same = 0,
      differ = [];
    for (const id of ids) {
      const again = run(loadTask(id), read(path.join(HERE, 'oracles', id + '.json')), { cache: false });
      if (strip(again) === strip(first[id])) same++;
      else differ.push(id);
    }
    T.ok(
      same === ids.length,
      `every oracle scores the same twice, check by check, with fresh renders and fresh ids (${same}/${ids.length}${differ.length ? '; differ: ' + differ.join(', ') : ''})`,
    );
  });
}
