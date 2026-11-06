// Checks for OverdubBench (tools/bench/, docs/BENCH.md): the sandbox. The scorers (the tasks, oracles, baselines, near
// misses, an MCP run replayed, determinism) are test/unit/bench.test.js.
//   node tools/bench-test.js
// A submission's kernels run sandboxed (the oracle scores the same there, a kernel that reaches for process can't write a file or
// start a program), and a rendered song's kernels read only what rendering needs.
import fs from 'node:fs';
import path from 'node:path';
import { loadTask, startSong, applyOps, scoreTask, HERE } from './bench/score.js';
import { tally } from './pw.js';

const T = tally('bench');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const run = (task, input, opts) => {
  const start = startSong(task);
  const r = applyOps(start, input);
  if (!r.ok) return { error: r.error };
  return scoreTask(task, r.song, { start, ...opts });
};

// The in-process score the sandboxed run must match.
const first = { 'device-rumble-filter': run(loadTask('device-rumble-filter'), read(path.join(HERE, 'oracles', 'device-rumble-filter.json'))) };

/* ================================================================== a submission's kernels run sandboxed */
// Scoring an ops log runs its kernels in Node. run.js scores a file from outside in a sandbox (tools/node-permissions.js): the
// oracle scores the same there, and a kernel that reaches for `process` to write a file or start a program can't.
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-bench-'));
  const runJs = path.join(HERE, 'run.js');
  const score = (file) => {
    const r = spawnSync(process.execPath, [runJs, 'device-rumble-filter', file, '--json'], { encoding: 'utf8', env: { ...process.env, OVERDUB_TRUST_KERNELS: '' } });
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { error: (r.stderr || r.stdout || '').slice(0, 200) }; }
  };
  const o = read(path.join(HERE, 'oracles', 'device-rumble-filter.json'));
  const okFile = path.join(tmp, 'oracle-copy.json');
  fs.writeFileSync(okFile, JSON.stringify(o));
  const fine = score(okFile);
  T.ok(!fine.error && fine.score === first['device-rumble-filter'].score, `an ops log from outside is scored in the sandbox, and scores what it scores in-process (${fine.score})`);
  const pwned = path.join(tmp, 'pwned.txt'), ran = path.join(tmp, 'ran.txt');
  const evil = JSON.parse(JSON.stringify(o));
  const grab = `try { [].constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(pwned)}, "pwned"); } catch (e) {} ` +
    `try { [].constructor.constructor("return process")().getBuiltinModule("child_process").execFileSync("/usr/bin/touch", [${JSON.stringify(ran)}]); } catch (e) {} `;
  evil.ops[0].device.kernel = evil.ops[0].device.kernel.replace('create({ sr, dsp }) {', 'create({ sr, dsp }) { ' + grab);
  const evilFile = path.join(tmp, 'evil.json');
  fs.writeFileSync(evilFile, JSON.stringify(evil));
  const res = score(evilFile);
  T.ok(evil.ops[0].device.kernel.includes('getBuiltinModule') && !fs.existsSync(pwned) && !fs.existsSync(ran) && !res.error, `a kernel that tries to write a file and start a program does neither (scored ${res.score?.toFixed?.(3)})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ================================================================== a rendered song's kernels read only what rendering needs */
// `node tools/render.js their-song.json` ran the song's kernels with the whole checkout readable: .git, deploy/,
// .claude/ and the rest. Now the sandbox reads app/, the script and the song. The kernel says what it could read on
// stderr; app/ is the control (it ran, and what rendering needs is still there).
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const REPO = path.resolve(HERE, '../..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-render-'));
  const git = path.join(REPO, '.git');
  const outside = [fs.existsSync(git) && fs.statSync(git).isDirectory() ? path.join(git, 'HEAD') : git, path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'deploy/deploy.sh'), path.join(REPO, 'tools/golden.json')].filter((f) => fs.existsSync(f));
  const inside = path.join(REPO, 'app/index.html');
  const kernel = `({ create() { const P = [].constructor.constructor("return process")(), fs = P.getBuiltinModule("fs"); for (const f of ${JSON.stringify([...outside, inside])}) { let r; try { r = "read " + fs.readFileSync(f).length; } catch (e) { r = "denied " + (e.code || e.name); } P.stderr.write("probe " + f + " " + r + "\\n"); } return { voice() { return { start() {}, release() {}, render() { return false; } }; } }; } })`;
  const song = { title: 'Reach', tempo: 120, meter: [4, 4], sections: [], master: { inserts: [] },
    devices: { 'guest.reach': { id: 'guest.reach', name: 'Reach', kind: 'instrument', by: 'guest:x', params: [], kernel } },
    tracks: [{ id: 't1', name: 'Reach', kind: 'instrument', instrument: { device: 'guest.reach', params: {} }, inserts: [], clips: [{ id: 'c1', start: 0, length: 4, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }] }] }] };
  const file = path.join(tmp, 'their-song.json');
  fs.writeFileSync(file, JSON.stringify(song));
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools/render.js'), file, '--to', '4', '--tail', '0.1', '--json'], { encoding: 'utf8', env: { ...process.env, OVERDUB_TRUST_KERNELS: '' } });
  const said = Object.fromEntries((r.stderr || '').split('\n').filter((l) => l.startsWith('probe ')).map((l) => { const m = /^probe (.+) (read \d+|denied \S+)$/.exec(l); return m ? [m[1], m[2]] : [l, '?']; }));
  const leaked = outside.filter((f) => !/^denied/.test(said[f] || ''));
  T.ok(r.status === 0 && fs.existsSync(path.join(tmp, 'their-song.wav')) && /^read/.test(said[inside] || '') && outside.length >= 3 && !leaked.length,
    `a kernel in a rendered song reads app/ (${said[inside] || 'never ran'}) and none of ${outside.map((f) => path.relative(REPO, f)).join(', ')}${leaked.length ? `; it read ${leaked.map((f) => path.relative(REPO, f)).join(', ')}` : ''} (exit ${r.status})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

T.done();
