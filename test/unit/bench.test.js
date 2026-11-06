// Checks for OverdubBench (tools/bench/, docs/BENCH.md): the scorers discriminate and repeat.
// Every task has a hand-made solution (tools/bench/oracles/<task>.json) that scores at least 0.9, the do-nothing
// baseline scores under 0.5, the near misses (oracles/near-misses/) score under 0.5, a run replayed from an MCP
// tool-call log scores what its ops score, and every score comes out the same twice: fresh renders, fresh random ids.
// The sandbox checks (Node --permission child processes: run.js and render.js reading only what they need) stay in
// tools/bench-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadTask,
  listTasks,
  startSong,
  applyOps,
  scoreTask,
  transactionsOf,
  CHECK_KINDS,
  HERE,
} from '../../tools/bench/score.js';

const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const strip = (s) => JSON.stringify({ ...s, checks: s.checks.map(({ label, ...c }) => c) });
const run = (task, input, opts) => {
  const start = startSong(task);
  const r = applyOps(start, input);
  if (!r.ok) return { error: r.error };
  return scoreTask(task, r.song, { start, ...opts });
};
const ids = listTasks();
const first = {};
test('the tasks are well formed', () => {
  T.ok(ids.length >= 12 && ids.length <= 16, `${ids.length} tasks (12-16)`);
  const fams = {};
  for (const id of ids) {
    const t = loadTask(id);
    fams[t.family] = (fams[t.family] || 0) + 1;
  }
  T.ok(
    ['mix', 'writing', 'device', 'editing'].every((f) => fams[f] >= 2),
    `every family has tasks (${Object.entries(fams)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')})`,
  );
  for (const id of ids) {
    const t = loadTask(id);
    const problems = [];
    if (t.id !== id) problems.push(`id "${t.id}" is not the file name`);
    if (!t.instruction || t.instruction.length < 40) problems.push('no instruction');
    if (!t.checks.some((c) => !c.gate)) problems.push('no scored check');
    const cids = new Set();
    for (const c of t.checks) {
      if (cids.has(c.id)) problems.push(`duplicate check id ${c.id}`);
      cids.add(c.id);
      if (!CHECK_KINDS.includes(c.kind)) problems.push(`unknown kind ${c.kind}`);
      if (!Array.isArray(c.target) || c.target.length !== 2) problems.push(`check ${c.id} has no [lo, hi] target`);
      if (!c.label) problems.push(`check ${c.id} has no label`);
    }
    let song = null;
    try {
      song = startSong(t);
    } catch (e) {
      problems.push(e.message);
    }
    // graph devices can't run in the canonical render: a task may only need kernels
    if (song)
      for (const tr of song.tracks)
        for (const x of [tr.instrument, ...tr.inserts].filter(Boolean))
          if (/^(pedal|amp)\./.test(x.device)) problems.push(`${tr.name} uses graph device ${x.device}`);
    if (!fs.existsSync(path.join(HERE, 'oracles', id + '.json'))) problems.push('no oracle');
    T.ok(
      !problems.length,
      `${id}: well formed, starting song builds, kernel devices only, has an oracle${problems.length ? ' — ' + problems.join('; ') : ''}`,
    );
  }
});
test('oracles, baselines, near misses', () => {
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
    const s = run(loadTask(near.task), near);
    T.ok(!s.error && s.score < 0.5, `near miss ${f}: ${s.score?.toFixed(3)} (< 0.5): ${near.why}`);
  }
});
test('an MCP run, replayed', () => {
  const o = read(path.join(HERE, 'oracles', 'device-dotted-echo.json'));
  const calls = {
    calls: [
      { tool: 'get_project', input: { detail: 'full' } },
      { tool: 'define_device', input: { device: o.ops[0].device, use_on: { track: 'Snaps' }, label: 'dotted echo' } },
      { tool: 'render_and_measure', input: { tracks: ['Snaps'] } },
    ],
  };
  T.ok(transactionsOf(calls).length === 1, 'a tool-call log replays apply_ops and define_device and skips the rest');
  const s = run(loadTask('device-dotted-echo'), calls);
  T.ok(
    !s.error && s.score === first['device-dotted-echo'].score,
    `define_device with use_on scores what its ops score (${s.score})`,
  );
  const bad = applyOps(startSong(loadTask('mix-bass-under-kick')), [
    { type: 'track.set', track: 'Nobody', patch: { gain: -3 } },
  ]);
  T.ok(
    !bad.ok && /no track "Nobody"/.test(bad.error),
    `ops that fail are reported, not scored (${bad.error?.slice(0, 60)}…)`,
  );
});
test('determinism', () => {
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
