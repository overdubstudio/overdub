// The guitar amps' kernel engine (devices/builtin/amp-voiced.js) against what it stands on: its tone stack from a
// netlist against Half Stack's closed form (tmbAnalog), its biquads against the Web Audio formulas the gear's designed
// cabs were voiced on (plugCabNet.resp), and its cab maths (ampCabNet: the cab, the mics, their room taps, the trims)
// against the gear's own plugCabNet, number for number, for every amp and a spread of settings; the measured cabs'
// trims (voicings.js AMP_IR_ENERGY) against plugCabNet's with the bank in (when it's here: tools/fetch-kits.js). How
// they sound is measured in tools/guitar-test.js (4d) and tools/amp-voices.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ampStack,
  tmbNet,
  potLin,
  potAud,
  waCoefs,
  ampCabWeights,
  ampCabResp,
  ampCabNet,
  jamesNet,
  bilin,
} from '../../app/src/devices/builtin/amp-voiced.js';
import { tmbAnalog, CABS_HASH, CAB_IDS as IR_IDS } from '../../app/src/devices/builtin/amp-lib.js';
import { gear } from '../../app/src/devices/guitar/index.js';
import { ampVoice, cabTables, ampSettings, CAB_IDS, MIC_IDS, ampDevice } from '../../app/src/devices/guitar/amps.js';
import { AMP_VOICINGS } from '../../app/src/devices/guitar/voicings.js';
import { paramValues } from '../../app/src/devices/registry.js';

const SR = 48000;
// |H(jw)|^2 in dB of a polynomial ratio in s (coefficients from s^0)
const mag = (b, a, f) => {
  const w = 2 * Math.PI * f;
  let nr = 0,
    ni = 0,
    dr = 0,
    di = 0;
  for (let j = 0; j < Math.max(b.length, a.length); j++) {
    const p = Math.pow(w, j),
      re = [1, 0, -1, 0][j % 4] * p,
      im = [0, 1, 0, -1][j % 4] * p;
    nr += (b[j] || 0) * re;
    ni += (b[j] || 0) * im;
    dr += (a[j] || 0) * re;
    di += (a[j] || 0) * im;
  }
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
};
// a seeded generator (0..1)
const rng = (seed) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};

describe('the tone stack from its netlist', () => {
  test("the TMB is Half Stack's tmbAnalog to 1e-6 dB at every knob setting", () => {
    const s = ampStack(tmbNet({ R1: 250e3, R2: 1e6, R3: 25e3, R4: 47e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 })),
      B = new Float64Array(4),
      A = new Float64Array(4),
      o = new Float64Array(6);
    assert.equal(s.order, 3);
    let worst = 0;
    for (const bass of [0, 1, 2.5, 5, 7.5, 10])
      for (const mid of [0, 2, 5, 8, 10])
        for (const tr of [0, 3, 6, 10]) {
          s.analog({ t: potLin(tr), m: potLin(mid), l: potAud(bass) }, B, A);
          tmbAnalog(bass, mid, tr, o);
          for (const f of [20, 60, 200, 700, 2000, 6000, 15000])
            worst = Math.max(worst, Math.abs(mag(B, A, f) - mag([0, o[0], o[1], o[2]], [1, o[3], o[4], o[5]], f)));
        }
    assert.ok(worst < 1e-6, `worst ${worst} dB`);
  });
  test('a first-order RC low-pass comes out as 1 / (1 + sRC)', () => {
    const s = ampStack({
        nodes: ['o'],
        out: 'o',
        parts: [
          ['R', 'in', 'o', () => 10e3],
          ['C', 'o', 'gnd', () => 100e-9],
        ],
      }),
      B = new Float64Array(2),
      A = new Float64Array(2);
    s.analog({}, B, A);
    assert.ok(
      Math.abs(B[0] - 1) < 1e-9 && Math.abs(B[1]) < 1e-12 && Math.abs(A[1] - 1e-3) < 1e-12,
      `${[...B]} / ${[...A]}`,
    );
  });
});

describe('the other tone stacks', () => {
  test('the bilinear transform at any order is the TMB’s written-out third-order one', () => {
    const s = ampStack(tmbNet({ R1: 250e3, R2: 1e6, R3: 25e3, R4: 47e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 })),
      B = new Float64Array(4),
      A = new Float64Array(4),
      GB = new Float64Array(4),
      GA = new Float64Array(4);
    s.analog({ t: potLin(6), m: potLin(5.5), l: potAud(5) }, B, A);
    const c = 2 * 192000,
      c2 = c * c,
      c3 = c2 * c;
    const B0 = B[0] + B[1] * c + B[2] * c2 + B[3] * c3,
      B1 = 3 * B[0] + B[1] * c - B[2] * c2 - 3 * B[3] * c3,
      B2 = 3 * B[0] - B[1] * c - B[2] * c2 + 3 * B[3] * c3,
      B3 = B[0] - B[1] * c + B[2] * c2 - B[3] * c3;
    const A0 = 1 + A[1] * c + A[2] * c2 + A[3] * c3,
      A1 = 3 + A[1] * c - A[2] * c2 - 3 * A[3] * c3,
      A2 = 3 - A[1] * c - A[2] * c2 + 3 * A[3] * c3,
      A3 = 1 - A[1] * c + A[2] * c2 - A[3] * c3;
    bilin(B, A, 3, c, GB, GA);
    const want = [B0 / A0, B1 / A0, B2 / A0, B3 / A0, 1, A1 / A0, A2 / A0, A3 / A0],
      got = [...GB, ...GA];
    for (let i = 0; i < 8; i++)
      assert.ok(Math.abs(got[i] - want[i]) <= 1e-12 * Math.max(1, Math.abs(want[i])), `${i}: ${got[i]} vs ${want[i]}`);
  });
  test('the James stack: TREBLE lifts the top, BASS the bottom, MIDDLE the middle', () => {
    const s = ampStack(
        jamesNet({
          R1: 250e3,
          R2: 1e6,
          R3: 25e3,
          R4: 100e3,
          R5: 220e3,
          R6: 4.7e3,
          RL: 1e6,
          C1: 220e-12,
          C2: 4.7e-9,
          C3: 4.7e-9,
          C4: 47e-9,
        }),
      ),
      B = new Float64Array(5),
      A = new Float64Array(5);
    assert.equal(s.order, 4);
    const at = (t, m, b, f) => {
      s.analog({ t: potLin(t), m: potLin(m), l: potAud(b) }, B, A);
      return mag(B, A, f);
    };
    assert.ok(at(10, 5, 5, 8000) - at(0, 5, 5, 8000) > 20, 'treble');
    assert.ok(at(5, 5, 10, 50) - at(5, 5, 0, 50) > 15, 'bass');
    assert.ok(at(5, 10, 5, 250) - at(5, 0, 5, 250) > 3, 'middle');
    for (const f of [20, 200, 2000, 20000])
      assert.ok(Number.isFinite(at(10, 10, 10, f)) && Number.isFinite(at(0, 0, 0, f)), 'finite at the ends');
  });
});

describe("the cab maths are the gear's", () => {
  test('a biquad chain responds as plugCabNet.resp has Web Audio respond', () => {
    const W = ampCabWeights(gear.PLUG_AMP_SPEC.punk, SR, gear.PLUG_AMPS.punk.cab),
      o = new Float64Array(5),
      H = new Float64Array(W.N * 2);
    const R = rng(7),
      types = ['lowpass', 'highpass', 'peaking', 'lowshelf', 'highshelf'];
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      const list = Array.from({ length: 3 }, () => [
        types[Math.floor(R() * 5)],
        30 + R() * 15000,
        R() * 3,
        R() * 24 - 12,
      ]);
      ampCabResp(list, SR, W, o, H);
      for (let i = 0; i < W.N; i += 7) {
        const [re, im] = gear.plugCabNet.resp.chain(list, W.f[i], SR);
        worst = Math.max(worst, Math.abs(10 * Math.log10((H[2 * i] ** 2 + H[2 * i + 1] ** 2) / (re * re + im * im))));
      }
    }
    assert.ok(worst < 1e-9, `worst ${worst} dB`);
    // (the identities Web Audio has at the ends: a low-pass at Nyquist, a high-pass at 0, a bell or shelf at 0 dB)
    for (const q of [
      ['lowpass', SR / 2, 0, 0],
      ['highpass', 0, 0, 0],
      ['peaking', 900, 1, 0],
      ['highshelf', 3000, 0, 0],
    ])
      assert.deepEqual([...waCoefs(q[0], q[1], q[2], q[3], SR, o)], [1, 0, 0, 0, 0]);
  });
  test('every amp, every designed cab and a spread of mics: the same filters, taps, delays, levels and trim as plugCabNet', () => {
    const T = cabTables(),
      R = rng(11);
    let n = 0,
      worstTrim = 0;
    for (const id of Object.keys(gear.PLUG_AMPS)) {
      const V = ampVoice(id, {}),
        W = ampCabWeights(V.spec, SR, V.cab),
        def = ampDevice(id, { os: 4 });
      for (let k = 0; k < 24; k++) {
        const v = paramValues(def, {
          cab: k < 2 ? 0 : Math.floor(R() * CAB_IDS.length),
          mic: Math.floor(R() * MIC_IDS.length),
          micpos: Math.round(R() * 135) / 100,
          micdist: 0.5 + R() * 23.5,
          micang: Math.round(R() * 60),
          mic2: k % 3 ? Math.floor(R() * (MIC_IDS.length + 1)) : 0,
          mic2pos: Math.round(R() * 135) / 100,
          mic2dist: 0.5 + R() * 23.5,
          mic2ang: Math.round(R() * 60),
          blend: R() * 10,
          flip: R() < 0.5 ? 1 : 0,
          ...(k === 0 ? { mic: MIC_IDS.indexOf('dyn'), micpos: 0.3, micdist: 1, micang: 0, mic2: 0 } : {}),
        });
        const P = ampSettings(id, v),
          old = gear.plugCabNet(id, P, SR),
          got = ampCabNet(V, T, v, SR, W, () => false);
        if (old.ir != null) {
          assert.equal(got.kind, 'wire', `${id} ${JSON.stringify(v)}`);
          n++;
          continue;
        }
        assert.equal(got.kind === 'net', !!old.custom, `${id} ${JSON.stringify(P)}`);
        if (!old.custom) {
          n++;
          continue;
        }
        assert.deepEqual(got.cab, old.cab);
        assert.equal(got.mics.length, old.mics.length);
        got.mics.forEach((m, i) => {
          const o = old.mics[i];
          assert.deepEqual(m.f, o.f, `${id} mic ${i + 1}'s filters`);
          assert.deepEqual(m.taps, o.taps, `${id} mic ${i + 1}'s taps`);
          assert.equal(m.delay, o.delay);
          assert.equal(m.gain, o.gain);
        });
        worstTrim = Math.max(worstTrim, Math.abs(got.trim - old.trim));
        n++;
      }
    }
    assert.ok(n > 600 && worstTrim < 1e-9, `${n} settings, worst trim ${worstTrim} dB`);
  });
  const bankFile = new URL(`../../app/kits/${CABS_HASH.slice(7)}.odk`, import.meta.url);
  test('the measured cabs: the trims the kernel works out are plugCabNet’s', {
    skip: !fs.existsSync(bankFile) && 'the cab bank is not in app/kits (node tools/fetch-kits.js)',
  }, async () => {
    const { dataFor } = await import('../../app/src/engine/node/data.js');
    const GI = await import('../../app/src/devices/guitar/gear/index.js');
    GI.useCabBank(dataFor({ cabs: CABS_HASH }).cabs);
    try {
      const T = cabTables();
      let worst = 0;
      for (const id of Object.keys(gear.PLUG_AMPS)) {
        const V = ampVoice(id, {}),
          W = ampCabWeights(V.spec, SR, V.cab),
          def = ampDevice(id, { os: 4 });
        for (const cab of IR_IDS) {
          const v = paramValues(def, { cab: CAB_IDS.indexOf(cab) }),
            old = gear.plugCabNet(id, ampSettings(id, v), SR),
            got = ampCabNet(V, T, v, SR, W, () => true);
          assert.equal(got.kind, 'ir');
          assert.equal(got.ir, old.ir);
          worst = Math.max(worst, Math.abs(got.trim - old.trim));
        }
      }
      assert.ok(worst < 1e-5, `worst ${worst} dB`);
    } finally {
      GI.useCabBank();
    }
  });
});

describe('the kernel amps', () => {
  test('are every amp: each has a voicing, a kernel and no graph build, and none is a device file', () => {
    for (const id of Object.keys(gear.PLUG_AMPS)) {
      assert.ok(AMP_VOICINGS[id], `${id} has a voicing`);
      const d = ampDevice(id);
      assert.equal(typeof d.kernel, 'string', id);
      assert.equal(d.build, undefined, id);
      assert.equal(d.exportable, false, id);
    }
    assert.equal(gear.plugAmp, undefined, 'the graph amp is retired');
  });
  test('every fitted value is inside the physical limits the fit was given (tools/amp-fit.js freeValues)', async () => {
    const { freeValues } = await import('../../tools/amp-fit.js');
    for (const [id, V] of Object.entries(AMP_VOICINGS)) {
      for (const [name, get, , , , lo, hi] of freeValues(structuredClone(V)))
        assert.ok(get() >= lo - 1e-6 && get() <= hi + 1e-6, `${id} ${name} ${get()} outside ${lo}..${hi}`);
      assert.equal(V.pot[1], 0, `${id}: a pot full up passes all of it`);
    }
  });
});
