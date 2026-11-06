// Slide Rule (core.eq8), the eight-band EQ you drag over a live spectrum: the kernel (app/src/devices/builtin/eq8.js),
// its filter math (eq8-curve.js, shared with the window) and the banded plan agents' adjust uses (app/src/agent/lexicon.js
// eqPlan). In Node, through the KernelCore the AudioWorklet runs (the canonical path): the def (keys, roles, descs,
// presets, the hidden solo) and the kernel carrying the shared functions as source; at its defaults the input comes out
// sample for sample; every band type's measured response (an impulse, its DFT at test frequencies) matches the shared
// curve within 0.5 dB, and so do the presets' summed curves and the output gain; sweeps, jumps, on/off, shape changes,
// solo and output jumps don't click (the energy above 3 kHz on a 220 Hz sine, against a zippered biquad that does
// click); renders repeat bit for bit; auto gain's first guess is the curve's and it then matches the level; solo plays
// only the band's region; extreme settings stay finite; the CPU; the banded plan. The window, the device check and the
// agent's tools run in Chromium in tools/eq-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelCore, kernelCompiler } from '../../app/src/kernel/worklet.js';
import { kernelSpecs } from '../../app/src/kernel/host.js';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { getDevice, paramValues, presetParams } from '../../app/src/devices/registry.js';
import '../../app/src/devices/builtin/index.js';
import * as C from '../../app/src/devices/builtin/eq8-curve.js';
import { lufs } from '../../app/src/audio/measure.js';
import * as TS from '../../app/src/audio/testsignals.js';
import { eqPlan } from '../../app/src/agent/lexicon.js';

const ok = (cond, msg) => assert.ok(cond, msg);
const SR = 48000;
const def = getDevice('core.eq8');
const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
const T = { note() {} };
test('the device is a built-in effect', () => {
  ok(
    def &&
      def.kind === 'effect' &&
      def.cat === 'eq' &&
      def.name === 'Slide Rule' &&
      def.editor === 'eq8' &&
      def.source === 'builtin',
    `core.eq8 is a built-in effect, Slide Rule, naming its editor (${def?.name}, ${def?.editor})`,
  );
});
test('the device: keys, roles, presets', () => {
  const keys = def.params.map((p) => p.key);
  const want = [];
  for (let n = 1; n <= 8; n++) want.push(`b${n}_on`, `b${n}_type`, `b${n}_freq`, `b${n}_gain`, `b${n}_q`);
  want.push('out_gain', 'out_auto', 'solo');
  ok(
    JSON.stringify(keys) === JSON.stringify(want),
    `its params are grouped by band, b1_on ... b8_q, then out_gain, out_auto (and the hidden solo): ${keys.length}`,
  );
  const shown = def.params.filter((p) => !p.hidden);
  ok(
    shown.every((p) => typeof p.desc === 'string' && p.desc.length >= 20),
    'every param has a desc an agent can act on',
  );
  ok(
    shown.filter((p) => !p.opts).every((p) => p.role) &&
      shown.filter((p) => p.opts).every((p) => p.key.endsWith('_on') || p.key.endsWith('_type') || p.role),
    'every continuous param has a role',
  );
  ok(
    def.params
      .filter((p) => /_freq$/.test(p.key))
      .every(
        (p, i) =>
          p.def === C.EQ_PARK[i] &&
          new RegExp(`parked at ${C.EQ_PARK[i] >= 1000 ? C.EQ_PARK[i] / 1000 + ' kHz' : C.EQ_PARK[i] + ' Hz'}`).test(
            p.desc,
          ),
      ),
    'each band is parked where its desc says (60, 150, 300, 700 Hz, 1.5, 3, 6, 12 kHz)',
  );
  ok(
    /SHELF/.test(def.params.find((p) => p.key === 'b1_type').desc) &&
      /CUT/.test(def.params.find((p) => p.key === 'b1_type').desc) &&
      JSON.stringify(def.params.find((p) => p.key === 'b1_type').opts) === JSON.stringify(C.EQ_TYPES),
    'b1_type lists the shapes and what each does',
  );
  const solo = def.params.find((p) => p.key === 'solo');
  ok(
    solo.hidden && solo.auto === false && solo.def === 0 && /never in the song/.test(solo.desc),
    'solo is hidden, never automated, and says it is monitoring only',
  );
  ok(
    def.params.filter((p) => /^b\d/.test(p.key)).every((p) => p.face === false) &&
      def.params.filter((p) => /^out/.test(p.key)).every((p) => p.face !== false) &&
      typeof def.screen === 'function',
    'the face shows the curve (screen), the output and auto gain; the bands live in the window',
  );
  ok(
    def.nod && !/pro-?q|fabfilter|ableton|logic|waves|izotope|ssl|neve|api\b|pultec/i.test(def.nod + ' ' + def.blurb),
    `the nod names no trademark ("${def.nod}")`,
  );
  ok(
    def.presets.length >= 5 && def.presets.every((p) => p.blurb && p.blurb.length > 10),
    `${def.presets.length} presets, each with a blurb: ${def.presets.map((p) => p.name).join(', ')}`,
  );
  for (const name of ['Clean up the low end', 'Vocal presence', 'Air', 'Telephone', 'Kick: thump and click'])
    ok(!!presetParams(def, name), `a preset "${name}"`);
  ok(
    [C.eqSections, C.eqSoloSections, C.eqBandPow, C.eqAutoGainDb, C.eqKCoefs].every((fn) =>
      def.kernel.includes(fn.toString()),
    ),
    'the kernel runs the shared functions themselves (their source is in it): one source of truth for the sound and the curve',
  );
});

// a KernelCore with these params (jumped there, as an instance starts), and a render through it in 128-frame blocks;
// sched(t) may return new params at a block (posted as the host posts them: glided, switches snapping)
function core(params) {
  const values = paramValues(def, params),
    errs = [];
  const c = new K(
    {
      source: def.kernel,
      kind: 'effect',
      params: kernelSpecs(def),
      values,
      seed: 1,
      transport: { bpm: 120, playing: true, beat: 0, time: 0 },
    },
    (m) => {
      if (m.type === 'error') errs.push(m.message);
    },
  );
  c.msg({ type: 'params', values, jump: true });
  if (errs.length || !c.cur) throw new Error('core.eq8 did not compile: ' + errs.join('; '));
  return c;
}
function render(params, inL, inR = inL, sched = null) {
  const c = core(params),
    n = inL.length,
    oL = new Float32Array(n),
    oR = new Float32Array(n);
  const iL = new Float32Array(128),
    iR = new Float32Array(128),
    bL = new Float32Array(128),
    bR = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    const m = Math.min(128, n - f);
    iL.fill(0);
    iR.fill(0);
    iL.set(inL.subarray(f, f + m));
    iR.set(inR.subarray(f, f + m));
    const p = sched && sched(f / SR);
    if (p) c.msg({ type: 'params', values: paramValues(def, p) });
    c.block(iL, iR, bL, bR, f);
    oL.set(bL.subarray(0, m), f);
    oR.set(bR.subarray(0, m), f);
  }
  return [oL, oR];
}
const noise = (secs, seed = 7, amp = 0.5) => {
  const x = new Float32Array(Math.round(secs * SR));
  let s = seed;
  for (let i = 0; i < x.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = (s / 4294967296 - 0.5) * amp;
  }
  return x;
};
const sine = (f, secs, amp = 0.25) => {
  const x = new Float32Array(Math.round(secs * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return x;
};
// the response of an impulse at f, in dB (a DFT bin at exactly f)
const dft = (h, f) => {
  let re = 0,
    im = 0;
  const w = (2 * Math.PI * f) / SR;
  for (let i = 0; i < h.length; i++) {
    re += h[i] * Math.cos(w * i);
    im -= h[i] * Math.sin(w * i);
  }
  return 10 * Math.log10(re * re + im * im + 1e-30);
};
const TF = [20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 12500, 16000, 19000];
const impulse = (secs = 1) => {
  const x = new Float32Array(Math.round(secs * SR));
  x[0] = 1;
  return x;
};

test('at its defaults', () => {
  const x = noise(3),
    y = noise(3, 11);
  const [L, R] = render({}, x, y);
  let d = 0;
  for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(L[i] - x[i]), Math.abs(R[i] - y[i]));
  ok(
    d === 0,
    `every band off, the output gain at 0 dB: the input comes out sample for sample (largest difference ${d})`,
  );
  const prog = TS.program(8, SR),
    [pL, pR] = render({}, prog.channels[0], prog.channels[1]);
  const dl = lufs({ sr: SR, channels: [pL, pR] }) - lufs(prog);
  ok(Math.abs(dl) < 0.01, `on the test program it measures ${dl.toFixed(3)} LU from bypass`);
});

test('the measured response against the shared curve', () => {
  const cases = [];
  for (let type = 0; type < 11; type++) {
    for (const [f, g, q] of [
      [60, 9, 0.7],
      [800, -6, 1.4],
      [6000, 4, 3],
    ])
      cases.push({ type, f, g, q: type >= 1 && type <= 8 ? Math.min(q, 2) : type === 9 ? q * 3 : q });
  }
  let worst = 0,
    where = '';
  for (const k of cases) {
    const p = { b4_on: 1, b4_type: k.type, b4_freq: k.f, b4_gain: k.g, b4_q: k.q };
    const [h] = render(p, impulse());
    const st = C.eqState(paramValues(def, p), SR);
    let w = 0,
      at = 0;
    for (const f of TF) {
      const want = C.curveDb(st, f, SR);
      if (want < -60) continue;
      const e = Math.abs(dft(h, f) - want);
      if (e > w) {
        w = e;
        at = f;
      }
    }
    if (w > worst) {
      worst = w;
      where = `${C.EQ_TYPES[k.type]} at ${k.f} Hz, ${at} Hz`;
    }
    if (k.f === 800)
      ok(
        w <= 0.5,
        `${C.EQ_TYPES[k.type].toLowerCase()} at 800 Hz: within ${w.toFixed(4)} dB of the curve at ${TF.length} frequencies`,
      );
  }
  ok(
    worst <= 0.5,
    `all ${cases.length} cases (11 types at 60 Hz, 800 Hz and 6 kHz): worst ${worst.toFixed(4)} dB (${where})`,
  );
  // the presets: every band at once, and the output gain on top
  let pw = 0,
    pn = '';
  for (const pr of def.presets) {
    const p = { ...pr.params, out_auto: 0, out_gain: 2.5 };
    const [h] = render(p, impulse());
    const st = C.eqState(paramValues(def, p), SR);
    for (const f of TF) {
      const want = C.curveDb(st, f, SR) + 2.5;
      if (want < -60) continue;
      const e = Math.abs(dft(h, f) - want);
      if (e > pw) {
        pw = e;
        pn = `${pr.name} at ${f} Hz`;
      }
    }
  }
  ok(pw <= 0.5, `every preset's summed curve plus a 2.5 dB output gain: worst ${pw.toFixed(4)} dB (${pn})`);
  // a cut's corner: -3 dB at Q 1 whatever its slope, +3 dB at Q 2 (the bump a node's height sets)
  const corner = [3, 4, 5, 6, 7, 8].map((t) => [
    t,
    C.bandDb(C.eqState(paramValues(def, { b1_on: 1, b1_type: t, b1_freq: 1000, b1_q: 1 }), SR), 0, 1000, SR),
    C.bandDb(C.eqState(paramValues(def, { b1_on: 1, b1_type: t, b1_freq: 1000, b1_q: 2 }), SR), 0, 1000, SR),
  ]);
  ok(
    corner.every(([, a, b]) => Math.abs(a + 3.01) < 0.02 && Math.abs(b - 3.01) < 0.02),
    `a cut's corner sits at -3 dB with Q 1 and +3 dB with Q 2, at 12, 24 and 48 dB per octave (${corner.map(([t, a, b]) => `${C.EQ_TYPES[t]} ${a.toFixed(2)}/${b.toFixed(2)}`).join(', ')})`,
  );
  const slopes = [3, 4, 5].map((t) => {
    const st = C.eqState(paramValues(def, { b1_on: 1, b1_type: t, b1_freq: 2000 }), SR);
    return C.curveDb(st, 250, SR) - C.curveDb(st, 500, SR);
  });
  ok(
    Math.abs(slopes[0] + 12) < 0.6 && Math.abs(slopes[1] + 24) < 0.6 && Math.abs(slopes[2] + 48) < 0.6,
    `low cuts fall 12, 24 and 48 dB per octave well below the corner (${slopes.map((s) => s.toFixed(1)).join(', ')} dB between 250 and 500 Hz)`,
  );
});

test('nothing clicks', () => {
  // an 8th-order Butterworth high pass at 3 kHz (the shared low cut 48), its peak: a click is broadband, a smooth move isn't
  const residual = (y) => {
    const c = new Float64Array(20),
      ns = C.eqSections(5, 3000, 0, 1, SR, c, 0),
      out = Float64Array.from(y);
    for (let s = 0; s < ns; s++) {
      const o = s * 5;
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      for (let i = 0; i < out.length; i++) {
        const x = out[i],
          v = c[o] * x + c[o + 1] * x1 + c[o + 2] * x2 - c[o + 3] * y1 - c[o + 4] * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = v;
        out[i] = v;
      }
    }
    let pk = 0;
    for (let i = Math.round(0.05 * SR); i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
    return db(pk);
  };
  const x = sine(220, 3);
  const B = (o) => ({ b3_on: 1, b3_type: 0, b3_freq: 220, b3_gain: 0, b3_q: 1, ...o });
  const sweeps = {
    'a frequency sweep, 100 Hz to 5 kHz (+12 dB, Q 2)': [
      B({ b3_freq: 100, b3_gain: 12, b3_q: 2 }),
      (t) => B({ b3_freq: 100 * Math.pow(50, Math.min(1, t / 2)), b3_gain: 12, b3_q: 2 }),
    ],
    'a gain sweep, -24 to +24 dB at 220 Hz': [B({ b3_gain: -24 }), (t) => B({ b3_gain: -24 + 48 * Math.min(1, t) })],
    'a Q sweep, 0.3 to 12 at 220 Hz (+12 dB)': [
      B({ b3_gain: 12, b3_q: 0.3 }),
      (t) => B({ b3_gain: 12, b3_q: 0.3 * Math.pow(40, Math.min(1, t)) }),
    ],
    'jumps every 0.25 s (150 Hz to 2 kHz, +12 to -12 dB)': [
      B({ b3_freq: 150, b3_gain: 12 }),
      (t) => {
        const k = Math.floor(t / 0.25) % 2;
        return B({ b3_freq: k ? 2000 : 150, b3_gain: k ? -12 : 12 });
      },
    ],
  };
  for (const [name, [p0, sched]] of Object.entries(sweeps)) {
    const r = residual(render(p0, x, x, sched)[0]);
    ok(r < -95, `${name}: ${r.toFixed(1)} dBFS`);
  }
  const switches = {
    'a +12 dB band switched on and off every 0.3 s': [
      B({ b3_gain: 12 }),
      (t) => B({ b3_gain: 12, b3_on: Math.floor(t / 0.3) % 2 ? 0 : 1 }),
    ],
    'its shape changed every 0.3 s (bell, notch, low cut 48)': [
      B({ b3_gain: 12, b3_freq: 400 }),
      (t) => B({ b3_gain: 12, b3_freq: 400, b3_type: [0, 9, 5][Math.floor(t / 0.3) % 3] }),
    ],
    'solo in and out every 0.3 s': [
      B({ b3_gain: 6, b3_q: 2 }),
      (t) => ({ ...B({ b3_gain: 6, b3_q: 2 }), solo: Math.floor(t / 0.3) % 2 ? 3 : 0 }),
    ],
    'the output gain jumping between -12 and +12 dB': [{}, (t) => ({ out_gain: Math.floor(t / 0.25) % 2 ? 12 : -12 })],
    'auto gain switched on and off every 0.4 s (a +9 dB band)': [
      B({ b3_gain: 9, b3_freq: 300 }),
      (t) => B({ b3_gain: 9, b3_freq: 300, out_auto: Math.floor(t / 0.4) % 2 }),
    ],
  };
  for (const [name, [p0, sched]] of Object.entries(switches)) {
    const r = residual(render(p0, x, x, sched)[0]);
    ok(r < -70, `${name}: ${r.toFixed(1)} dBFS (crossfaded)`);
  }
  // the detector hears a click: the same jumps through a biquad whose coefficients step once a block, and a gain step
  const y = new Float32Array(x.length),
    c = new Float64Array(20);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let f = 0; f < x.length; f += 128) {
    const k = Math.floor(f / SR / 0.25) % 2;
    C.eqSections(0, k ? 2000 : 150, k ? -12 : 12, 1, SR, c, 0);
    for (let i = f; i < Math.min(x.length, f + 128); i++) {
      const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
  }
  const zip = residual(y),
    step = residual(Float32Array.from(x, (v, i) => (i >= SR ? v * 0.5 : v)));
  ok(
    zip > -50 && step > -65,
    `…and it hears clicks: the same jumps with stepped coefficients read ${zip.toFixed(1)} dBFS, a 6 dB gain step ${step.toFixed(1)} dBFS`,
  );
});

test('renders repeat', () => {
  const prog = TS.program(4, SR);
  const p = { ...presetParams(def, 'Vocal presence'), out_auto: 1 };
  const sched = (t) => ({ ...p, b6_freq: 3000 * Math.pow(2, Math.sin(t * 3)), b3_on: Math.floor(t / 0.7) % 2 });
  const a = render(p, prog.channels[0], prog.channels[1], sched),
    b = render(p, prog.channels[0], prog.channels[1], sched);
  ok(
    a[0].every((v, i) => v === b[0][i]) && a[1].every((v, i) => v === b[1][i]),
    'a preset with auto gain and moving bands renders bit for bit the same twice',
  );
});

test('auto gain', () => {
  // its first guess is the shared function's, from the very first sample
  const p = { b3_on: 1, b3_type: 0, b3_freq: 1000, b3_gain: 6, b3_q: 1, out_auto: 1 };
  const guess = C.autoGainFor(paramValues(def, p), SR);
  const [y] = render(p, sine(1000, 0.4)),
    [y0] = render({ ...p, out_auto: 0 }, sine(1000, 0.4));
  let a = 0,
    b0 = 0;
  for (let i = SR * 0.2; i < SR * 0.3; i++) {
    a = Math.max(a, Math.abs(y[i]));
    b0 = Math.max(b0, Math.abs(y0[i]));
  }
  ok(
    Math.abs(db(a) - db(b0) - guess) < 0.05,
    `its first guess is the curve's (eqAutoGainDb): ${guess.toFixed(2)} dB for +6 dB at 1 kHz, applied at once (measured ${(db(a) - db(b0)).toFixed(2)} dB)`,
  );
  // then it matches what plays: the last 6 s of 16 (the program looped) against the dry
  const loop = (s) => ({
    sr: SR,
    channels: s.channels.map((c) => {
      const out = new Float32Array(c.length * 2);
      out.set(c);
      out.set(c, c.length);
      return out;
    }),
  });
  const sigs = {
    program: loop(TS.program(8, SR)),
    'pink noise': loop(TS.stereo(TS.pinkNoise(8, SR))),
    'bass DI': loop(TS.stereo(TS.bassDI(8, SR))),
  };
  const moves = {
    'Vocal presence': presetParams(def, 'Vocal presence'),
    'Kick: thump and click': presetParams(def, 'Kick: thump and click'),
    'a +6 dB low shelf at 150 Hz': { b2_on: 1, b2_type: 1, b2_freq: 150, b2_gain: 6 },
    'a 24 dB low cut at 200 Hz': { b1_on: 1, b1_type: 4, b1_freq: 200 },
  };
  const rows = [];
  let worstOn = 0,
    worstOff = 0;
  for (const [mn, mp] of Object.entries(moves))
    for (const [sn, s] of Object.entries(sigs)) {
      const dry = lufs(s, { from: 10, to: 16 });
      const off =
        lufs({ sr: SR, channels: render({ ...mp, out_auto: 0 }, s.channels[0], s.channels[1]) }, { from: 10, to: 16 }) -
        dry;
      const on =
        lufs({ sr: SR, channels: render({ ...mp, out_auto: 1 }, s.channels[0], s.channels[1]) }, { from: 10, to: 16 }) -
        dry;
      worstOn = Math.max(worstOn, Math.abs(on));
      worstOff = Math.max(worstOff, Math.abs(off));
      rows.push(`${mn} on ${sn}: ${off >= 0 ? '+' : ''}${off.toFixed(2)} -> ${on >= 0 ? '+' : ''}${on.toFixed(2)} LU`);
    }
  T.note(rows.join('\n       '));
  ok(
    worstOn <= 0.5 && worstOff >= 2,
    `with auto gain on, ${rows.length} moves on three signals settle within ${worstOn.toFixed(2)} LU of the dry level (off, up to ${worstOff.toFixed(2)} LU away)`,
  );
});

test('solo', () => {
  // band 3 a bell at 1 kHz, Q 4, soloed: only the region around 1 kHz of what comes in
  const x = noise(2, 5, 0.6),
    p = { b3_on: 1, b3_type: 0, b3_freq: 1000, b3_gain: -12, b3_q: 4, solo: 3 };
  const [h] = render(p, impulse());
  const at = (f) => dft(h, f);
  ok(
    at(1000) > -0.5 && at(1000) < 0.5 && at(250) < -20 && at(4000) < -20,
    `soloing a bell plays the band pass around it, from the input (not the -12 dB cut): ${at(1000).toFixed(1)} dB at 1 kHz, ${at(250).toFixed(1)} at 250 Hz, ${at(4000).toFixed(1)} at 4 kHz`,
  );
  const [hc] = render({ b1_on: 1, b1_type: 4, b1_freq: 200, solo: 1 }, impulse());
  ok(
    dft(hc, 50) > -1 && dft(hc, 1000) < -40,
    `soloing a low cut plays what it takes away: ${dft(hc, 50).toFixed(1)} dB at 50 Hz, ${dft(hc, 1000).toFixed(1)} dB at 1 kHz`,
  );
  const [y] = render({ ...p, solo: 0 }, x),
    [ys] = render(p, x);
  ok(!y.every((v, i) => v === ys[i]), 'solo changes what comes out (the window sets it on the live device only)');
});

test('the ends of every range', () => {
  const x = noise(1, 3, 0.9);
  const cases = [];
  for (const t of [0, 1, 2, 5, 8, 9, 10])
    for (const f of [20, 20000])
      for (const q of [0.1, 24])
        cases.push({
          b1_on: 1,
          b1_type: t,
          b1_freq: f,
          b1_gain: 24,
          b1_q: q,
          b2_on: 1,
          b2_type: t,
          b2_freq: f,
          b2_gain: -24,
          b2_q: q,
        });
  let bad = 0,
    pk = 0;
  for (const p of cases) {
    const [L] = render(p, x);
    for (const v of L) {
      if (!Number.isFinite(v)) {
        bad++;
        break;
      }
      pk = Math.max(pk, Math.abs(v));
    }
  }
  ok(
    !bad && db(pk) < 40,
    `${cases.length} extreme settings (every shape at 20 Hz and 20 kHz, Q 0.1 and 24, ±24 dB) stay finite (loudest ${db(pk).toFixed(1)} dBFS)`,
  );
  // a band dragged across the whole range in a second, every block, at the most resonant settings
  const [L] = render({ b5_on: 1, b5_gain: 24, b5_q: 24 }, x, x, (t) => ({
    b5_on: 1,
    b5_gain: 24 * Math.sin(t * 37),
    b5_q: 24,
    b5_freq: 20 * Math.pow(1000, (Math.sin(t * 11) + 1) / 2),
    b5_type: Math.floor(t * 9) % 11,
  }));
  ok(L.every(Number.isFinite), 'shapes, frequencies and gains thrown about every few blocks at Q 24 stay finite');
});

test('cost', () => {
  const p = {};
  for (let b = 1; b <= 8; b++)
    Object.assign(p, { [`b${b}_on`]: 1, [`b${b}_type`]: b === 1 ? 5 : b === 8 ? 8 : 0, [`b${b}_gain`]: 3 });
  const x = sine(440, 4, 0.3);
  render({ ...p, out_auto: 1 }, x); // (warm the JIT)
  const t0 = performance.now();
  render({ ...p, out_auto: 1 }, x);
  const ms = performance.now() - t0;
  ok(
    (ms / 4000) * 100 < 5,
    `all eight bands on (two of them 48 dB cuts) with auto gain: 4 s in ${ms.toFixed(1)} ms in Node, ${(ms / 40).toFixed(2)}% of real time (the device check warns at 25%)`,
  );
});

test('agents: the banded plan adjust uses', () => {
  const mud = eqPlan('mud', 0.66, def, {}, -1);
  ok(
    mud && mud.patch.b3_on === 1 && mud.patch.b3_freq === 300 && mud.patch.b3_type === 0 && mud.patch.b3_gain === -3.3,
    `"less mud" on a fresh Slide Rule switches on band 3, a bell at 300 Hz, -3.3 dB (${JSON.stringify(mud?.patch)})`,
  );
  const air = eqPlan('air', 0.66, def, {}, 1);
  ok(
    air && air.patch.b8_type === 2 && air.patch.b8_freq === 11000 && air.patch.b8_gain > 2,
    `"more air" puts band 8 as a high shelf at 11 kHz (${JSON.stringify(air?.patch)})`,
  );
  const vp = presetParams(def, 'Vocal presence'),
    again = eqPlan('mud', 0.66, def, vp, -1);
  ok(
    again && Object.keys(again.patch).join() === 'b3_gain' && again.patch.b3_gain === -5.8,
    `on Vocal presence it deepens the 300 Hz cut already there instead (${JSON.stringify(again?.patch)})`,
  );
  const busy = {};
  for (let n = 1; n <= 8; n++) Object.assign(busy, { [`b${n}_on`]: 1, [`b${n}_type`]: 9, [`b${n}_freq`]: 100 * n });
  const none = eqPlan('mud', 0.66, def, busy, -1);
  ok(none && none.moves.length === 0, 'with every band busy elsewhere it moves nothing (adjust adds an EQ instead)');
  const top = eqPlan('mud', 0.66, getDevice('core.eq'), {}, -1);
  ok(top && top.patch.mid === -3.3 && top.patch.midf === 300, 'Top Shelf (core.eq) plans as it did');
});
