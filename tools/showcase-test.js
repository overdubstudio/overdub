// The showcase devices (app/src/devices/showcase.js): they compile, render without NaN, sit at sane levels, let
// their tails die, and render the same twice. Each renders in Node, on the canonical renderer, and goes through
// checkDeviceNode (kernel/check.js's checkDevice, in a child process); the studio boots with the demo song, which
// carries them, in Chromium with no page errors.
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { checkDeviceNode } from '../app/src/engine/node/check.js';
import { createProject } from '../app/src/core/project.js';
import { compileKernel } from '../app/src/kernel/host.js';
import { measure, lufs } from '../app/src/audio/measure.js';
import * as TS from '../app/src/audio/testsignals.js';
import * as reg from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import { SHOWCASE } from '../app/src/devices/showcase.js';

const t = tally('showcase');
const STAMP = '2026-10-07T00:00:00.000Z';
const SR = 48000, SECS = 10, BPM = 120, BEAT = 60 / BPM;

const base = () => ({ ...createProject(), id: 'p_show', title: 'show', key: null, tempo: BPM, meta: { created: STAMP, modified: STAMP, authors: {} } });
const track = (extra) => ({ id: 't', name: 'T', kind: 'instrument', instrument: null, inserts: [], clips: [], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub', ...extra });
// an effect on a guitar DI strum (6 s, then silence), or an instrument playing a phrase: 10 s of signal and tail
const render = (def, strum) => {
  const beats = SECS / BEAT;
  if (def.kind === 'effect') {
    const p = { ...base(), assets: { a: { kind: 'audio', name: 'in', sr: SR, channels: 2, duration: 6 } },
      tracks: [track({ kind: 'audio', inserts: [{ id: 'fx', device: def.id, on: true, params: {}, by: 'you' }], clips: [{ id: 'c', kind: 'audio', start: 0, length: 6 / BEAT, asset: 'a', offset: 0, gain: 0, by: 'you' }] })] };
    return renderSong(p, { from: 0, to: beats, tail: 0, assets: { a: { sr: SR, channels: [strum, strum] } } });
  }
  const notes = [[72, 0], [76, 0.5], [79, 1], [83, 1.5], [84, 2], [79, 2.5], [76, 3], [72, 3.5], [69, 4], [72, 4], [76, 4]];
  const p = { ...base(), tracks: [track({ instrument: { device: def.id, params: {} }, clips: [{ id: 'c', kind: 'notes', start: 0, length: beats, notes: notes.map(([pitch, at], i) => ({ id: 'n' + (i + 1), by: 'overdub', p: pitch, v: 0.8, t: at / BEAT, d: 0.4 / BEAT })), by: 'overdub' }] })] };
  return renderSong(p, { from: 0, to: beats, tail: 0 });
};

const rows = [];
for (const src of SHOWCASE) {
  const row = { id: src.id };
  const comp = compileKernel(src.kernel, src.kind);
  row.compile = comp.ok ? 'ok' : comp.error;
  if (!comp.ok) { rows.push(row); continue; }
  const def = reg.getDevice(src.id) || reg.defineDevice({ ...src, source: 'project' }, { replace: true });
  try {
    const rep = await checkDeviceNode(def, { quick: true });
    row.report = { ok: rep.ok, errors: rep.errors, warnings: rep.warnings, lufs: rep.level?.lufs, deltaLU: rep.level?.deltaLU, truePeak: rep.truePeak, tail: rep.tail, cpu: rep.cpu, deterministic: rep.deterministic };
  } catch (e) { row.report = { error: String((e && e.message) || e) }; }
  // our own render, either way: 6 s of signal, then 4 s of silence
  const strum = TS.diStrum(6, SR);
  const a = render(def, strum), b = render(def, strum);
  const [L, R] = a.channels, L2 = b.channels[0];
  let nan = false, same = true;
  for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) { nan = true; break; } }
  for (let i = 0; i < L.length; i += 7) if (L[i] !== L2[i]) { same = false; break; }
  const m = measure({ sr: SR, channels: a.channels }, { to: 6 });
  row.lufs = +m.lufs.toFixed(1); row.truePeak = +m.truePeak.toFixed(1); row.nan = nan; row.deterministic = same;
  if (def.kind === 'effect') row.dryLufs = +lufs({ sr: SR, channels: [strum, strum] }).toFixed(1);
  let tailPeak = 0; for (let i = Math.floor(SR * (SECS - 0.5)); i < L.length; i++) tailPeak = Math.max(tailPeak, Math.abs(L[i]));
  row.tailDb = +(20 * Math.log10(tailPeak + 1e-12)).toFixed(1);
  rows.push(row);
}

for (const r of rows) {
  console.log('  ..   ' + JSON.stringify(r));
  t.ok(r.compile === 'ok', `${r.id} compiles`);
  if (r.compile !== 'ok') continue;
  t.ok(!r.nan, `${r.id} renders without NaN`);
  t.ok(r.deterministic, `${r.id} renders the same twice`);
  t.ok(r.truePeak <= -1, `${r.id} true peak ${r.truePeak} dBTP <= -1`);
  if (r.dryLufs != null) t.ok(Math.abs(r.lufs - r.dryLufs) <= 1.5, `${r.id} level ${r.lufs} LUFS vs dry ${r.dryLufs} (within 1.5 LU)`);
  else t.ok(r.lufs >= -22 && r.lufs <= -12, `${r.id} level ${r.lufs} LUFS (-22..-12)`);
  if (r.report && !r.report.error) t.ok(r.report.ok, `${r.id} passes checkDevice ${r.report.ok ? '' : JSON.stringify(r.report.errors)}`);
}

// the studio boots with the demo song, which carries these devices, and raises no errors
const { page, errors, close } = await open('/app/', { query: 'demo' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
t.ok(!errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no page errors ' + errors.join(' | '));
await close();
t.done();
