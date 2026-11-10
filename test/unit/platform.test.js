// The instrument platform's Node half: expression into kernels (kernel/expr.js, KernelCore), note data, the MIDI
// wheels and pedal (input/midi.js) and registry presets. Moved intact from tools/platform-test.js; core.guitar's
// renders (CPU budget included), the 100-instrument bit-identity sweep, the render of every preset (each about 10 s),
// the agent tools and the browser stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelCore, kernelCompiler } from '../../app/src/kernel/worklet.js';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { noteExpr, normCurve, chanExpr } from '../../app/src/kernel/expr.js';
import { kernelSpecs } from '../../app/src/kernel/host.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { createProject, cleanProject } from '../../app/src/core/project.js';
import { normNote } from '../../app/src/core/music.js';
import { createStore } from '../../app/src/core/store.js';
import * as registry from '../../app/src/devices/registry.js';
import { installMidiEnv } from './helpers/midi-env.js';

const SR = 48000,
  Q = 128,
  BEAT = 0.5;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const cents = (f, ref) => 1200 * Math.log2(f / ref);

const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
function core(source, { kind = 'instrument', poly = 4, def = null, params = {} } = {}) {
  const posts = [];
  const specs = def ? kernelSpecs(def) : [];
  const values = def ? registry.paramValues(def, params) : {};
  const c = new K(
    { source, kind, params: specs, values, poly, seed: 7, transport: { bpm: 120, playing: true, beat: 0, time: 0 } },
    (m) => posts.push(m),
  );
  c.posts = posts;
  return c;
}
// run a core for `frames`, messages posted at their block (a block ahead, as the Node renderer posts them)
function run(c, frames, msgs = []) {
  const n = Math.ceil(frames / Q) * Q,
    L = new Float32Array(n),
    R = new Float32Array(n),
    bl = new Float32Array(Q),
    br = new Float32Array(Q);
  const q = msgs.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
  let mi = 0;
  for (let f0 = 0; f0 < n; f0 += Q) {
    while (mi < q.length && Math.round((q[mi].time || 0) * SR) < f0 + 2 * Q) c.msg(q[mi++]);
    c.block(null, null, bl, br, f0);
    L.set(bl, f0);
    R.set(br, f0);
  }
  return { L, R };
}
const song = (device, notes, { params = {}, beats = 8, tempo = 120 } = {}) => ({
  ...createProject(),
  id: 'p_plat',
  title: 'platform',
  tempo,
  key: null,
  tracks: [
    {
      id: 't_plat',
      name: 'Inst',
      kind: 'instrument',
      instrument: { device, params },
      inserts: [],
      clips: [
        {
          id: 'c_plat',
          kind: 'notes',
          start: 0,
          length: beats,
          notes: notes.map((n, i) => ({ id: 'n' + (i + 1), v: 0.8, ...n })),
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
  ],
});
// notes in seconds -> the canonical render
function play(device, notes, params = {}, secs = 4, tail = 0.5, from = 0) {
  const beats = Math.ceil(secs / BEAT);
  const t0 = performance.now();
  const r = renderSong(
    song(
      device,
      notes.map((n) => ({ ...n, t: n.t / BEAT, d: n.d / BEAT })),
      { params, beats },
    ),
    { from, to: beats, tail },
  );
  r.ms = performance.now() - t0;
  return r;
}
function goertzel(x, a, len, f) {
  const w = (2 * Math.PI * f) / SR,
    c = 2 * Math.cos(w);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < len; i++) {
    const s = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1))) + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) * 4) / len;
}
function peakFreq(x, a, len, f, span = 0.03) {
  let best = 0,
    bf = f;
  for (let k = -80; k <= 80; k++) {
    const ff = f * (1 + (span * k) / 80),
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  const step = (f * span) / 80;
  for (let k = -20; k <= 20; k++) {
    const ff = bf + (step * k) / 20,
      m = goertzel(x, a, len, ff);
    if (m > best) {
      best = m;
      bf = ff;
    }
  }
  return bf;
}

test('expression: the kernel core', () => {
  // a probe: each voice adds its t.bend to L and t.mod to R; process adds 1000 x the channel's sustain to R
  const probe = (poly) => `({ poly: ${poly}, create() { return {
    voice() { let rel = false; return {
      start() { rel = false; }, release() { rel = true; },
      render(L, R, n, p, t) { if (rel) return false; for (let i = 0; i < n; i++) { L[i] += t.bend; R[i] += t.mod; } return true; },
    }; },
    process(L, R, n, p, t) { if (t.sustain) for (let i = 0; i < n; i++) R[i] += 1000; },
  }; } })`;
  const PROBE = probe(4);
  // a note's own curve: 0 -> 2 semitones over 10 ms, mod 0.25 throughout
  let c = core(PROBE);
  let o = run(c, 2048, [{ type: 'on', p: 60, v: 0.8, time: 0, x: { bend: [0, 0, 0.01, 2], mod: 0.25 } }]);
  const want = (f) => 2 * Math.min(1, f / 480);
  const atBlocks = [0, 128, 256, 384, 512, 1024].map((f) => [o.L[f], want(f)]);
  assert.ok(
    atBlocks.every(([g, w]) => near(g, w, 1e-6)),
    `a note's bend curve is evaluated at each block start: ${atBlocks.map(([g]) => fmt(g, 3)).join(' ')} st (want ${atBlocks.map(([, w]) => fmt(w, 3)).join(' ')})`,
  );
  assert.ok(
    near(o.R[700], 0.25, 1e-7) && o.L[127] === o.L[0],
    `t.mod is the note's 0.25; t stays put inside a block (${fmt(o.R[700], 3)})`,
  );
  // the channel adds, from its frame (the block is split there), and process sees the channel's alone
  c = core(PROBE);
  o = run(c, 2048, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'expr', bend: -3, mod: 0.5, time: 300 / SR },
  ]);
  assert.ok(
    o.L[299] === 1 && o.L[300] === -2 && near(o.R[300], 0.5, 1e-7) && o.R[299] === 0,
    `instance.expr lands on its frame: bend ${o.L[299]} -> ${o.L[300]} st (channel -3 plus the note's +1), mod ${o.R[299]} -> ${fmt(o.R[300], 2)} at frame 300`,
  );
  c = core(PROBE);
  o = run(c, 1024, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { mod: 0.8 } },
    { type: 'expr', mod: 0.5, time: 0 },
  ]);
  assert.ok(near(o.R[10], 1, 1e-7), `t.mod is the channel's plus the note's, clamped to 1 (${fmt(o.R[10], 3)})`);
  assert.ok(
    chanExpr({ bend: 99, mod: -1, sustain: 1 }).bend === 48 &&
      chanExpr({ mod: -1 }).mod === 0 &&
      chanExpr({ sustain: 1 }).sustain === true,
    'channel values are clamped: bend +-48 st, mod 0..1, sustain a boolean',
  );
  // the pedal: a note-off while it is down is held until it lifts; process sees t.sustain
  c = core(PROBE);
  o = run(c, 4096, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'expr', sustain: true, time: 300 / SR },
    { type: 'off', p: 60, time: 500 / SR },
    { type: 'expr', sustain: false, time: 2000 / SR },
  ]);
  // (process runs once a block, after its events: it sees the pedal from the block it went down in)
  assert.ok(
    o.R[255] === 0 && o.R[256] === 1000 && o.L[1999] === 1 && o.L[2000] === 0 && o.R[2100] === 0,
    `sustain: the note-off at frame 500 waits for the pedal; it lifts at 2000 and the note goes there (voice ${o.L[1999]} -> ${o.L[2000]}; process saw t.sustain from the block holding frame 300)`,
  );
  c = core(probe(2));
  o = run(c, 4096, [
    { type: 'on', p: 60, v: 0.8, time: 0, x: { bend: 1 } },
    { type: 'on', p: 62, v: 0.8, time: 0, x: { bend: 2 } },
    { type: 'expr', sustain: true, time: 0 },
    { type: 'off', p: 60, time: 256 / SR },
    { type: 'on', p: 64, v: 0.8, time: 512 / SR, x: { bend: 4 } },
  ]);
  // poly 2: the third note steals; the pedal-held note (60, bend 1) goes before the key still down (62, bend 2)
  assert.ok(
    o.L[400] === 3 && o.L[2000] === 6,
    `a pedal-held voice is stolen before a held key: ${o.L[400]} -> ${o.L[2000]} (62 and 64 left, 60 stolen)`,
  );
  c = core(PROBE);
  o = run(c, 2048, [
    { type: 'on', p: 60, v: 0.8, time: 0 },
    { type: 'expr', sustain: true, time: 0 },
    { type: 'alloff', time: 256 / SR },
  ]);
  assert.ok(
    o.R[300] === 1000 && o.L[300] === 0 && c.cur.voices.every((s) => !s.alive),
    'all-off releases every voice, the pedal-held ones too',
  );
  // a kernel that never heard of it: t has the fields, at rest
  c = core(
    `({ create() { return { voice() { return { start() {}, release() {}, render(L, R, n, p, t) { L[0] += (t.bend === 0 && t.mod === 0 && t.sustain === false) ? 1 : -1; return false; } }; } }; } })`,
  );
  o = run(c, 256, [{ type: 'on', p: 60, v: 0.8, time: 0 }]);
  assert.ok(o.L[0] === 1, 't = { bpm, playing, beat, bend: 0, mod: 0, sustain: false } when nobody moves a wheel');
  assert.ok(!c.posts.some((m) => m.type === 'error'), 'no errors from the probes');
});
test('expression: note data', () => {
  assert.ok(
    normCurve(0, -48, 48) === undefined && normCurve(2.123456, -48, 48) === 2.1235 && normCurve(60, -48, 48) === 48,
    'a constant bend: 0 is stored as nothing, values rounded and clamped',
  );
  const c = normCurve(
    [
      [1, 2],
      [0, 0],
      ['x', 1],
      [0.5, 9],
    ],
    -2,
    2,
  );
  assert.ok(
    JSON.stringify(c) === '[[0,0],[0.5,2],[1,2]]',
    `a curve is sorted, clamped and cleaned: ${JSON.stringify(c)}`,
  );
  assert.ok(
    normCurve(
      [
        [0, 0],
        [1, 0],
      ],
      -48,
      48,
    ) === undefined,
    'a curve that never leaves 0 is stored as nothing',
  );
  const n = normNote({
    p: 'E4',
    t: 0,
    d: 1,
    bend: [
      [0, 0],
      [0.5, 1],
    ],
    mod: 0.3,
  });
  assert.ok(
    JSON.stringify(n.bend) === '[[0,0],[0.5,1]]' && n.mod === 0.3,
    `normNote keeps bend and mod: ${JSON.stringify({ bend: n.bend, mod: n.mod })}`,
  );
  assert.ok(
    !('bend' in normNote({ p: 60, t: 0, bend: 0 })),
    'a note without expression stays as it was (no new fields)',
  );
  const x = noteExpr(
    {
      bend: [
        [0, 0],
        [1, 2],
      ],
      mod: 0.5,
    },
    0.5,
  );
  assert.ok(
    JSON.stringify(x) === '{"bend":[0,0,0.5,2],"mod":0.5}',
    `noteExpr: beats to seconds at 120 BPM ${JSON.stringify(x)}`,
  );
  const xc = noteExpr(
    {
      bend: [
        [0, 0],
        [1, 2],
      ],
    },
    0.5,
    0.5,
  );
  assert.ok(
    JSON.stringify(xc.bend) === '[-0.25,0,0.25,2]',
    `a chased note's curve starts where the note is: ${JSON.stringify(xc.bend)}`,
  );
  assert.ok(noteExpr({ p: 60 }, 0.5) === null, 'a plain note sends no expression');
  // through the store: notes.add keeps it, undo removes it
  const store = createStore(cleanProject(song('core.guitar', [], { beats: 4 })), { getDevice: registry.getDevice });
  const r = store.dispatch(
    {
      type: 'notes.add',
      track: 't_plat',
      clip: 'c_plat',
      notes: [
        {
          p: 57,
          t: 0,
          d: 2,
          bend: [
            [0, 0],
            [1, 2],
          ],
          mod: 0.2,
        },
      ],
    },
    { by: 'claude' },
  );
  const got = store.get().tracks[0].clips[0].notes[0];
  assert.ok(
    r.ok && JSON.stringify(got.bend) === '[[0,0],[1,2]]' && got.mod === 0.2,
    `notes.add (an agent's) keeps a note's bend and mod: ${JSON.stringify({ bend: got.bend, mod: got.mod })}`,
  );
  // the Node render plays it: a held bend to +2 lands on B3 from A3; mod 1 makes vibrato
  const bent = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 2,
        bend: [
          [0, 0],
          [0.5, 2],
        ],
      },
    ],
    {},
    2,
    0,
  );
  const f = peakFreq(bent.channels[0], Math.round(0.6 * SR), 16384, mtof(59));
  assert.ok(
    near(cents(f, mtof(59)), 0, 3),
    `the canonical render bends: A3 with a bend curve to +2 sounds at B3 ${fmt(cents(f, mtof(59)), 2)} cents after it`,
  );
  const pb = play('core.poly', [{ p: 57, t: 0, d: 2, bend: -12 }], {}, 2, 0);
  const fp = peakFreq(pb.channels[0], Math.round(0.4 * SR), 16384, mtof(45));
  assert.ok(
    near(cents(fp, mtof(45)), 0, 8),
    `core.poly follows a note's bend: A3 bent -12 sounds at A2 (${fmt(cents(fp, mtof(45)), 1)} cents, its oscillators drift a little)`,
  );
  // chased from mid-note: the curve is where the note is, not at its start
  const whole = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 3,
        bend: [
          [0, 0],
          [2, 4],
        ],
      },
    ],
    {},
    3,
    0,
  );
  const chased = play(
    'core.guitar',
    [
      {
        p: 57,
        t: 0,
        d: 3,
        bend: [
          [0, 0],
          [2, 4],
        ],
      },
    ],
    {},
    3,
    0,
    4,
  ); // from beat 4 (2 s): bend 4 already
  const fw = peakFreq(whole.channels[0], Math.round(2.05 * SR), 8192, mtof(61)),
    fc = peakFreq(chased.channels[0], Math.round(0.05 * SR), 8192, mtof(61));
  assert.ok(
    near(cents(fw, mtof(61)), 0, 5) && near(cents(fc, mtof(61)), 0, 5),
    `a render from mid-note starts the bend where it is: ${fmt(cents(fc, mtof(61)), 1)} cents from C#4 (the whole render: ${fmt(cents(fw, mtof(61)), 1)})`,
  );
});
test('MIDI: wheels and the pedal', async () => {
  const mem = installMidiEnv();
  const { createMidi } = await import('../../app/src/input/midi.js');
  const got = [],
    notes = [];
  const input = {
    emit() {},
    noteOn: (src, p, v) => notes.push(['on', p, v]),
    noteOff: (src, p) => notes.push(['off', p]),
    expr: (src, x) => got.push(x),
  };
  const midi = createMidi({ ui: {} }, input);
  midi.message([0xe0, 0x00, 0x40]); // centre
  midi.message([0xe0, 0x7f, 0x7f]); // full up
  midi.message([0xe0, 0x00, 0x00]); // full down
  assert.ok(
    got[0].bend === 0 && got[1].bend === 2 && got[2].bend === -2 && midi.state.bendRange === 2,
    `the bend wheel: centre 0, full up +${got[1].bend}, full down ${got[2].bend} st (range ${midi.state.bendRange})`,
  );
  midi.message([0xb0, 101, 0]);
  midi.message([0xb0, 100, 0]);
  midi.message([0xb0, 6, 12]);
  assert.ok(
    midi.state.bendRange === 12 && got[got.length - 1].bend === -12,
    `RPN 0 sets the bend range to 12, and the held bend follows (${got[got.length - 1].bend})`,
  );
  midi.setBendRange(7);
  assert.ok(
    midi.state.bendRange === 7 && JSON.parse(mem.get('overdub:midi')).bendRange === 7,
    'midi.setBendRange(7) is kept for next time',
  );
  got.length = 0;
  midi.message([0xb0, 1, 64]);
  midi.message([0xb0, 33, 127]);
  assert.ok(
    near(got[0].mod, (64 * 128) / 16383, 1e-3) && near(got[1].mod, (64 * 128 + 127) / 16383, 1e-3),
    `the mod wheel: CC 1 ${fmt(got[0].mod, 3)}, with CC 33's fine bits ${fmt(got[1].mod, 4)}`,
  );
  got.length = 0;
  notes.length = 0;
  midi.message([0x90, 60, 100]);
  midi.message([0xb0, 64, 127]);
  midi.message([0x80, 60, 0]);
  const heldOk = got.length === 1 && got[0].sustain === true && !notes.some((n) => n[0] === 'off');
  midi.message([0xb0, 64, 0]);
  assert.ok(
    heldOk && got[1].sustain === false && notes[notes.length - 1][0] === 'off',
    `the pedal reaches the instrument (sustain ${got[0] && got[0].sustain} then ${got[1] && got[1].sustain}) and still holds the key until it lifts`,
  );
  got.length = 0;
  midi.message([0xe0, 0x7f, 0x7f]);
  midi.message([0xb0, 121, 0]);
  const last = got[got.length - 1];
  assert.ok(
    last.bend === 0 && last.mod === 0 && midi.state.bend === 0 && midi.state.mod === 0,
    'CC 121 puts the wheels back to rest',
  );
});
test('presets: checked, filled in, clamped, by label, and every new built-in has some', () => {
  const P = (presets) =>
    registry.normPresets('you.test', presets, [
      { key: 'tone', min: 0, max: 1, def: 0.5, step: 0 },
      { key: 'mode', opts: ['A', 'B', 'C'], min: 0, max: 2, def: 0, step: 1 },
      { key: 'n', min: 1, max: 9, def: 3, step: 2 },
    ]);
  const p = P([{ name: '  Dark  room ', params: { tone: -4, mode: 'c', n: 6 } }]);
  assert.ok(
    JSON.stringify(p) === '[{"name":"Dark room","params":{"tone":0,"mode":2,"n":7}}]',
    `a preset is filled in, clamped, snapped, and a switch is named by its label: ${JSON.stringify(p)}`,
  );
  const throws = (x, re) => {
    try {
      P(x);
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  assert.ok(
    throws([{ name: 'X', params: { cutoff: 1 } }], /sets "cutoff", which is not a param/),
    'a preset that sets an unknown param is refused, naming it',
  );
  assert.ok(
    throws(
      [
        { name: 'X', params: {} },
        { name: 'x', params: {} },
      ],
      /two presets are called/,
    ),
    'two presets of one name (any case) are refused',
  );
  assert.ok(
    throws([{ name: 'X', params: { mode: 'Z' } }], /one of A, B, C/) &&
      throws([{ name: '', params: {} }], /needs a name/),
    'a bad switch label and a missing name are refused with what to do',
  );
  assert.ok(
    registry.normPresets('x', undefined, []).length === 0 && registry.getDevice('core.poly').presets.length === 0,
    'a device without presets has none (older defs need no change)',
  );
  const g = registry.getDevice('core.guitar');
  assert.ok(
    registry.presetParams(g, 'nylon').body === 1 && registry.presetParams('core.guitar', 'Nope') === null,
    'presetParams finds one by name in any case',
  );
  const NEW = ['core.piano', 'core.organ', 'core.strings', 'core.bassguitar', 'core.guitar'];
  const counts = NEW.map((id) => [id, (registry.getDevice(id)?.presets || []).length]);
  assert.ok(
    counts.every(([, n]) => n >= 2),
    `the new built-ins carry presets: ${counts.map(([id, n]) => `${id} ${n}`).join(', ')}`,
  );
  // (list_devices / get_device and instrument.set with a preset's params stay in tools/platform-test.js)
});
