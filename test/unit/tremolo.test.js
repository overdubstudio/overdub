// Ceiling Fan (core.tremolo): registered last among the effects, its params, level-matched at its defaults, DEPTH 0 the
// input, TREMOLO moving the sides together and PAN opposite, a square that doesn't click, SYNC on the beat,
// deterministic, every extreme finite, its presets, and the device check clean.
import { test } from 'node:test';
import { EFFECTS } from '../../app/src/devices/builtin/index.js';
import { DIV_LABELS } from '../../app/src/devices/builtin/lib.js';
import { getDevice, presetParams } from '../../app/src/devices/registry.js';
import { diStrum as diMono, drumLoop, program, stereo } from '../../app/src/audio/testsignals.js';
import { measure } from '../../app/src/audio/measure.js';
import { checkDeviceNode } from '../../app/src/engine/node/check.js';
import { run } from '../../tools/amp-scenes.js';
import { T } from './_t.js';

const ok = T.ok;
const SR = 48000;
const def = getDevice('core.tremolo');
// the DI strum is mono: both sides the same
const diStrum = (secs) => stereo(diMono(secs));
const keys = ['rate', 'sync', 'depth', 'shape', 'mode'];

const peak = (...xs) => {
  let p = 0;
  for (const x of xs) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
const sine = (secs, hz = 1000, db = -12) => {
  const n = Math.round(secs * SR),
    a = Math.pow(10, db / 20),
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / SR);
  return x;
};
const dc = (secs, v = 0.5) => new Float32Array(Math.round(secs * SR)).fill(v);
// RMS in 10 ms windows, skipping the first 0.1 s
const env = (x) => {
  const w = SR / 100,
    out = [];
  for (let s = Math.round(0.1 * SR); s + w <= x.length; s += w) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += x[i] * x[i];
    out.push(Math.sqrt(e / w));
  }
  return out;
};
const corr = (a, b) => {
  const n = a.length,
    ma = a.reduce((s, v) => s + v, 0) / n,
    mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0,
    saa = 0,
    sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};
const spanDb = (e) => 20 * Math.log10(Math.max(...e) / Math.max(1e-9, Math.min(...e)));
// the mean absolute level of x over [a, b) seconds
const mean = (x, a, b) => {
  let s = 0;
  const i0 = Math.round(a * SR),
    i1 = Math.round(b * SR);
  for (let i = i0; i < i1; i++) s += Math.abs(x[i]);
  return s / (i1 - i0);
};

test('registered: an effect called Ceiling Fan, the last of EFFECTS, after Echo Chamber', () => {
  ok(
    def && def.kind === 'effect' && def.name === 'Ceiling Fan' && def.cat === 'mod',
    'core.tremolo is the Ceiling Fan effect, cat mod',
  );
  ok(EFFECTS[EFFECTS.length - 1].id === 'core.tremolo', 'it is the last entry of EFFECTS');
  ok(EFFECTS[EFFECTS.length - 2].id === 'core.rooms', 'Echo Chamber is just before it: no existing effect moved');
  if (getDevice('core.clipper').source === 'builtin')
    ok(def.source === 'builtin', `its source is builtin (${def.source})`);
  ok(def.blurb.length <= 60, `its blurb is at most 60 characters (${def.blurb.length})`);
});

test('params: rate, sync, depth, shape, mode, a stompbox face', () => {
  ok(def.params.map((p) => p.key).join() === keys.join(), `the keys are ${def.params.map((p) => p.key).join(', ')}`);
  const by = Object.fromEntries(def.params.map((p) => [p.key, p]));
  ok(by.shape.opts.join() === 'SINE,TRIANGLE,SQUARE', 'SHAPE is SINE, TRIANGLE, SQUARE');
  ok(by.mode.opts.join() === 'TREMOLO,PAN', 'MODE is TREMOLO, PAN');
  ok(by.sync.opts.join() === ['FREE', ...DIV_LABELS].join(), 'SYNC is FREE then the note lengths');
  ok(
    by.rate.unit === 'Hz' && by.rate.min === 0.1 && by.rate.max === 20 && by.rate.def === 4.5,
    'RATE is 0.1-20 Hz, 4.5 by default',
  );
  ok(def.params.length <= 6, `${def.params.length} params (a stompbox: six or fewer)`);
});

test('level at defaults: within 1.5 LU of the dry signal on the strum, the drums and the program, true peak <= -1 dBTP', () => {
  for (const [name, sig] of [
    ['DI strum', diStrum()],
    ['drum loop', drumLoop()],
    ['program', program(8, SR)],
  ]) {
    const [L, R] = run(def, {}, sig.channels[0], sig.channels[1]);
    const dry = measure(sig),
      wet = measure({ sr: SR, channels: [L, R] });
    const d = wet.lufs - dry.lufs;
    ok(Math.abs(d) <= 1.5, `${name}: ${d.toFixed(2)} LU against bypass`);
    ok(wet.truePeak <= -1, `${name}: true peak ${wet.truePeak} dBTP`);
  }
});

test('DEPTH 0 is the input, sample for sample', () => {
  const s = diStrum(2);
  for (const shape of [0, 1, 2])
    for (const mode of [0, 1]) {
      const [L, R] = run(def, { depth: 0, shape, mode }, s.channels[0], s.channels[1]);
      let same = true;
      for (let i = 0; i < L.length; i++) if (L[i] !== s.channels[0][i] || R[i] !== s.channels[1][i]) same = false;
      ok(same, `shape ${shape}, mode ${mode}: the output is the input`);
    }
});

test('TREMOLO moves the two sides together, PAN moves them opposite', () => {
  const x = sine(2);
  for (const shape of [0, 1, 2]) {
    const [tL, tR] = run(def, { depth: 1, rate: 2, shape, mode: 0 }, x, x);
    const ct = corr(env(tL), env(tR));
    ok(ct > 0.95, `shape ${shape} TREMOLO: L and R envelopes correlate ${ct.toFixed(3)}`);
    const [pL, pR] = run(def, { depth: 1, rate: 2, shape, mode: 1 }, x, x);
    const eL = env(pL),
      eR = env(pR),
      cp = corr(eL, eR);
    ok(cp < -0.95, `shape ${shape} PAN: L and R envelopes correlate ${cp.toFixed(3)}`);
    ok(
      spanDb(eL) > 12 && spanDb(eR) > 12,
      `shape ${shape} PAN: each side spans ${spanDb(eL).toFixed(1)} / ${spanDb(eR).toFixed(1)} dB`,
    );
  }
});

test('the square chops without a click, and so do SHAPE and MODE switched mid-render', () => {
  const x = dc(2);
  const steps = (L, R) => {
    let st = 0;
    for (const y of [L, R]) for (let i = 1; i < y.length; i++) st = Math.max(st, Math.abs(y[i] - y[i - 1]));
    return st;
  };
  const swing = (y) => {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = Math.round(0.2 * SR); i < y.length; i++) {
      lo = Math.min(lo, y[i]);
      hi = Math.max(hi, y[i]);
    }
    return hi - lo;
  };
  const p = { shape: 'SQUARE', depth: 1, rate: 8 };
  const [L, R] = run(def, { ...p, shape: 2 }, x, x);
  ok(steps(L, R) < 0.02, `largest sample-to-sample step ${steps(L, R).toFixed(4)}`);
  ok(swing(L) > 0.5, `the swing between loud and quiet is ${swing(L).toFixed(3)}`);
  const sched = (s) =>
    s >= 0.5 && s < 1
      ? { depth: 1, rate: 8, shape: 0, mode: 1 }
      : s >= 1
        ? { depth: 1, rate: 8, shape: 2, mode: 0 }
        : null;
  const [sL, sR] = run(def, { depth: 1, rate: 8, shape: 2, mode: 0 }, x, x, { sched });
  ok(steps(sL, sR) < 0.02, `switching SHAPE and MODE mid-render: largest step ${steps(sL, sR).toFixed(4)}`);
});

test('SYNC follows the song tempo: 1/4 is one cycle a beat at 120 bpm, 1/2 two beats; FREE follows RATE', () => {
  const x = dc(3),
    q = DIV_LABELS.indexOf('1/4') + 1,
    hf = DIV_LABELS.indexOf('1/2') + 1;
  const [L] = run(def, { depth: 1, shape: 2, sync: q }, x, x);
  const loud = 0.25,
    quiet = 0.05;
  ok(
    mean(L, 0.05, 0.2) > loud && mean(L, 0.3, 0.45) < quiet && mean(L, 0.55, 0.7) > loud,
    `1/4: loud ${mean(L, 0.05, 0.2).toFixed(3)}, quiet ${mean(L, 0.3, 0.45).toFixed(3)}, loud ${mean(L, 0.55, 0.7).toFixed(3)}`,
  );
  const [H] = run(def, { depth: 1, shape: 2, sync: hf }, x, x);
  ok(
    mean(H, 0.05, 0.45) > loud && mean(H, 0.55, 0.95) < quiet && mean(H, 1.05, 1.45) > loud,
    `1/2: loud ${mean(H, 0.05, 0.45).toFixed(3)}, quiet ${mean(H, 0.55, 0.95).toFixed(3)}, loud ${mean(H, 1.05, 1.45).toFixed(3)}`,
  );
  const [F] = run(def, { depth: 1, shape: 2, sync: 0, rate: 4 }, x, x);
  ok(
    mean(F, 0.02, 0.1) > loud && mean(F, 0.15, 0.23) < quiet && mean(F, 0.27, 0.35) > loud,
    `FREE at 4 Hz: loud ${mean(F, 0.02, 0.1).toFixed(3)}, quiet ${mean(F, 0.15, 0.23).toFixed(3)}, loud ${mean(F, 0.27, 0.35).toFixed(3)}`,
  );
});

test('deterministic: two renders of the strum at defaults are bit-identical', () => {
  const s = diStrum(4);
  const [a, b] = run(def, {}, s.channels[0], s.channels[1]),
    [c, d] = run(def, {}, s.channels[0], s.channels[1]);
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== c[i] || b[i] !== d[i]) same = false;
  ok(same, 'the same samples');
});

test('extremes: every param at its min and its max, all at min, all at max: finite, peak at most 1.5 x the input', () => {
  // (the loudest point of a cycle is mk x (a + h): at DEPTH 1, 1.41 on the square, 1.63 on the sine and 1.73 on the
  // triangle, the level matching's price; on the strum the gain's peaks and the signal's rarely meet, about 1.3 x)
  const s = diStrum(3),
    inPk = peak(...s.channels);
  const lo = Object.fromEntries(def.params.map((p) => [p.key, p.min])),
    hi = Object.fromEntries(def.params.map((p) => [p.key, p.max]));
  const sets = [
    ['all at min', lo],
    ['all at max', hi],
  ];
  for (const p of def.params) sets.push([`${p.key} min`, { [p.key]: p.min }], [`${p.key} max`, { [p.key]: p.max }]);
  for (const [name, params] of sets) {
    const [L, R] = run(def, params, s.channels[0], s.channels[1]);
    let fin = true;
    for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) fin = false;
    const pk = peak(L, R);
    ok(fin, `${name}: finite`);
    ok(pk <= inPk * 1.5, `${name}: peak ${(pk / inPk).toFixed(3)} x the input's`);
  }
});

test('presets: each resolves and renders finite', () => {
  const s = diStrum(2);
  for (const name of ['Surf amp', 'Eighth chop', 'Slow sway']) {
    const p = presetParams('core.tremolo', name);
    ok(p && keys.every((k) => Number.isFinite(p[k])), `${name} resolves to ${JSON.stringify(p)}`);
    const [L, R] = run(def, p, s.channels[0], s.channels[1]);
    ok(L.every(Number.isFinite) && R.every(Number.isFinite) && peak(L, R) > 0, `${name}: renders finite`);
  }
  const ch = presetParams('core.tremolo', 'Eighth chop');
  ok(ch.sync === DIV_LABELS.indexOf('1/8') + 1 && ch.shape === 2, 'switch labels in a preset resolve to their indices');
});

test('the device check passes with no warnings', { timeout: 120000 }, async () => {
  const r = await checkDeviceNode(def, { quick: true });
  ok(r.ok, `checkDevice ok${r.ok ? '' : ': ' + r.errors.join('; ')}`);
  ok(r.warnings.length === 0, `no warnings${r.warnings.length ? ': ' + r.warnings.join('; ') : ''}`);
});
