// Checks for OverdubBench (tools/bench/, docs/BENCH.md): the scorers discriminate and repeat.
// Every task has a hand-made solution (tools/bench/oracles/<task>.json) that scores at least 0.9, the do-nothing
// baseline scores under 0.5, the near misses (oracles/near-misses/) score under 0.5, a run replayed from an MCP
// tool-call log scores what its ops score, and every score comes out the same twice: fresh renders, fresh random ids.
// The sandbox checks (Node --permission child processes: run.js and render.js reading only what they need) stay in
// tools/bench-test.js. The oracles' scores are in bench-oracles-1..4.test.js (test/unit/_bench.js says why).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadTask,
  listTasks,
  startSong,
  applyOps,
  transactionsOf,
  CHECK_KINDS,
  HERE,
} from '../../tools/bench/score.js';
import { T, read, run, SHARDS, shardOf } from './_bench.js';

const ids = listTasks();
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
  const ops = run(loadTask('device-dotted-echo'), o);
  T.ok(
    !s.error && !ops.error && s.score === ops.score,
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
test('every task has a file that scores it', () => {
  const files = fs.readdirSync(import.meta.dirname).filter((f) => /^bench-oracles-\d+\.test\.js$/.test(f));
  const want = Array.from({ length: SHARDS }, (_, i) => `bench-oracles-${i + 1}.test.js`);
  T.ok(
    JSON.stringify(files.sort()) === JSON.stringify(want),
    `the oracles' files are ${want.join(', ')} (found ${files.join(', ')})`,
  );
  for (const f of want) {
    const n = +f.match(/\d+/)[0];
    T.ok(
      fs.readFileSync(path.join(import.meta.dirname, f), 'utf8').includes(`oracleTests(${n - 1})`),
      `${f} scores shard ${n}`,
    );
  }
  T.ok(
    ids.every((id) => shardOf(id, ids) >= 0 && shardOf(id, ids) < SHARDS),
    `each of the ${ids.length} tasks falls to one of them`,
  );
});
