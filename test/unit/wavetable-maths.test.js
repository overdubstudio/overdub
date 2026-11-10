// Light Table's window (ui/editors/wavetable.js): the page's maths against the kernel's own renders (wavetable.js
// warpCycle, filterResponse, envAt): what the window draws is what plays. Moved from tools/wavetable-ui-test.js; the
// window in Chromium stays there.
import { test } from 'node:test';
import { renderSong } from '../../app/src/engine/node/render.js';
import { createProject } from '../../app/src/core/project.js';
import { getDevice } from '../../app/src/devices/registry.js';
import '../../app/src/devices/builtin/index.js';
import { tables, TABLE_NAMES } from '../../app/src/devices/builtin/wavetables.js';
import {
  WARPS,
  FILTERS,
  SYNC_BEATS,
  DELAY_BEATS,
  warpCycle,
  warpValue,
  filterResponse,
  envAt,
} from '../../app/src/devices/builtin/wavetable.js';
import { T } from './_t.js';

const ok = T.ok;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ID = 'core.wavetable',
  SR = 48000;
const def = getDevice(ID);
const LT = tables();

const vals = (params) => {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const p = def.params.find((q) => q.key === k);
    if (!p) throw new Error('no param ' + k);
    out[k] = typeof v === 'string' && p.opts ? p.opts.indexOf(v) : v;
  }
  return out;
};
function play(p, params, secs = 1) {
  const beats = Math.ceil(secs * 2);
  const proj = {
    ...createProject(),
    id: 'p_ltui',
    title: 'lt ui',
    key: null,
    tempo: 120,
    meta: { created: '2026-10-03T00:00:00.000Z', modified: '2026-10-03T00:00:00.000Z', authors: {} },
    tracks: [
      {
        id: 't1',
        name: 'LT',
        kind: 'instrument',
        instrument: { device: ID, params: vals(params) },
        inserts: [],
        clips: [
          {
            id: 'c1',
            kind: 'notes',
            start: 0,
            length: beats,
            notes: [{ id: 'n1', by: 'overdub', p, t: 0, d: secs * 2, v: 0.8 }],
            by: 'overdub',
          },
        ],
        gain: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        by: 'overdub',
      },
    ],
  };
  const r = renderSong(proj, { from: 0, to: beats, tail: 0 });
  if (r.warnings.length) throw new Error('render warnings: ' + JSON.stringify(r.warnings));
  const [L, R] = r.channels,
    m = new Float32Array(L.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
  return m;
}
test("the page's maths against the kernel: warps, filters, the envelope, the constants", () => {
  // The warps: a held A1, one oscillator, around the filter, against warpCycle on the frame the kernel reads at that
  // pitch (its band limit, the spectrum cut there) and through the output's DC blocker; then the plain frame, which the
  // same check must tell apart
  const flim = Math.min(0.6, Math.max(0.45, (SR - 20000) / SR));
  const mipOf = (dt) => {
    const x = Math.log2((1024 * dt) / flim);
    return x <= 0 ? 0 : x >= 10 ? 10 : Math.ceil(x);
  };
  const band = (ti, x, K, n = 2048) => {
    const sp = LT.spectrum(ti, x),
      g = LT.gain(ti, x),
      out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ph = (2 * Math.PI * i) / n;
      let y = 0;
      for (let k = 1; k <= K; k++) y += sp.a[k] * Math.sin(k * ph) + sp.b[k] * Math.cos(k * ph);
      out[i] = y * g;
    }
    return out;
  };
  const read = (arr) => (ph) => {
    const xx = ph * arr.length,
      k = xx | 0,
      f = xx - k;
    return arr[k % arr.length] + (arr[(k + 1) % arr.length] - arr[k % arr.length]) * f;
  };
  function corrBest(x, at, n, f0, cyc) {
    const per = Math.ceil(SR / f0),
      N = at + n + per,
      e = new Float64Array(N),
      aDc = Math.exp((-2 * Math.PI * 10) / SR);
    let x1 = 0,
      y1 = 0;
    for (let i = 0; i < N; i++) {
      const tt = (i * f0) / SR,
        v = cyc(tt - Math.floor(tt));
      y1 = v - x1 + aDc * y1;
      x1 = v;
      e[i] = y1;
    }
    let best = -1;
    for (let lag = 0; lag < per; lag++) {
      let sxy = 0,
        sxx = 0,
        syy = 0;
      for (let i = 0; i < n; i++) {
        const y = e[at + i + per - lag],
          v = x[at + i];
        sxy += v * y;
        sxx += v * v;
        syy += y * y;
      }
      best = Math.max(best, sxy / Math.sqrt(sxx * syy + 1e-30));
    }
    return best;
  }
  const CLEAN = {
    a_unison: 1,
    flt_a: 'OFF',
    fx_verb_mix: 0,
    env1_attack: 0.001,
    env1_sustain: 1,
    env1_vel: 0,
    b_level: 0,
  };
  const rows = [];
  for (const [tab, pos, warp, amt] of [
    ['BASIC', 0, 'SYNC', 0.5],
    ['VOWEL', 0.375, 'BEND', 0.9],
    ['BASIC', 1 / 3, 'PW', 0.7],
    ['BASIC', 2 / 3, 'MIRROR', 0.8],
    ['BASIC', 2 / 3, 'FM', 0.6],
  ]) {
    const ti = TABLE_NAMES.indexOf(tab),
      cycles = LT.TABLES[ti].cycles,
      note = 33,
      f0 = 440 * Math.pow(2, (note - 69) / 12),
      inc = f0 / SR;
    const mode = WARPS.indexOf(warp),
      wv = warpValue(mode, amt);
    const wf =
      mode === 1 ? wv : mode === 2 ? 1 + wv : mode === 3 ? 3.2 / Math.max(0.05, wv) : mode === 5 ? 1 + 4 * wv : 1;
    const src = band(ti, pos, LT.MK[mipOf((inc * (mode === 4 ? 1 : wf)) / cycles)]);
    const fmSrc = mode === 5 ? LT.frame(0, 0, 2048) : null;
    let drawn = warpCycle(src, mode, amt, { cycles, out: new Float32Array(4096), fm: fmSrc ? read(fmSrc) : null });
    if (mode === 4) {
      const mir = warpCycle(band(ti, pos, LT.MK[mipOf((inc * 4.5) / cycles)]), 4, 1, {
        cycles,
        out: new Float32Array(4096),
      });
      const plain = warpCycle(src, 0, 0, { cycles, out: new Float32Array(4096) });
      drawn = plain.map((y, i) => y + (mir[i] - y) * amt);
    }
    const x = play(note, {
      ...CLEAN,
      a_table: tab,
      a_pos: pos,
      a_warp: warp,
      a_warp_amt: amt,
      ...(mode === 5 ? { b_table: 'BASIC', b_pos: 0, b_oct: 0 } : {}),
    });
    const at = Math.round(0.5 * SR),
      n = Math.round((4 * cycles * SR) / f0);
    rows.push({
      warp,
      tab,
      w: corrBest(x, at, n, f0 / cycles, read(drawn)),
      p: corrBest(x, at, n, f0 / cycles, read(src)),
    });
  }
  ok(
    rows.every((r) => r.w >= 0.998 && r.w > r.p + 0.005),
    `the warps draw what plays: a rendered cycle against the page's warpCycle, ${rows.map((r) => `${r.warp} on ${r.tab} ${fmt(r.w, 4)} (plain ${fmt(r.p, 3)})`).join(', ')} (want 0.998 or more, and above the plain frame)`,
  );

  // The filters: seeded noise through each type and around it (the same noise), the ratio of the two averaged spectra in
  // third-octave bands against filterResponse, wherever the curve is above -40 dB
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let q = re[i];
        re[i] = re[j];
        re[j] = q;
        q = im[i];
        im[i] = im[j];
        im[j] = q;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const a = (-2 * Math.PI) / len,
        wr = Math.cos(a),
        wi = Math.sin(a),
        hh = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1,
          ci = 0;
        for (let j = 0; j < hh; j++) {
          const k = i + j + hh,
            vr = re[k] * cr - im[k] * ci,
            vi = re[k] * ci + im[k] * cr;
          re[k] = re[i + j] - vr;
          im[k] = im[i + j] - vi;
          re[i + j] += vr;
          im[i + j] += vi;
          const q = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = q;
        }
      }
    }
  };
  const welch = (x, from, to, N = 4096) => {
    const P = new Float64Array(N / 2);
    let c = 0;
    for (let at = from; at + N <= to; at += N / 2) {
      const re = new Float64Array(N),
        im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      fft(re, im);
      for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      c++;
    }
    for (let k = 0; k < N / 2; k++) P[k] /= c;
    return P;
  };
  const NOISE = {
    a_level: 0,
    b_level: 0,
    noise_level: 1,
    noise_color: 1,
    flt_key: 0,
    flt_env: 0,
    flt_vel: 0,
    flt_drive: 0,
    fx_verb_mix: 0,
    env1_attack: 0.001,
    env1_sustain: 1,
    env1_vel: 0,
  };
  const errs = [];
  for (const [type, fc, res] of [
    ['LP24', 1500, 0.7],
    ['BP', 1000, 0.5],
    ['NOTCH', 990, 0.2],
    ['COMB', 400, 0.6],
    ['FORMANT', 2500, 0.6],
  ]) {
    const ty = FILTERS.indexOf(type),
      yes = play(60, { ...NOISE, flt_type: type, flt_cutoff: fc, flt_res: res, flt_noise: 'ON' }, 2),
      no = play(60, { ...NOISE, flt_type: type, flt_cutoff: fc, flt_res: res, flt_noise: 'OFF' }, 2);
    const a = Math.round(0.3 * SR),
      b = Math.round(1.9 * SR),
      Py = welch(yes, a, b),
      Pn = welch(no, a, b),
      bin = SR / 4096;
    let worst = 0;
    for (let f = 40; f <= 16000; f *= Math.pow(2, 1 / 3)) {
      const lo = Math.max(1, Math.floor(f / Math.pow(2, 1 / 6) / bin)),
        hi = Math.ceil((f * Math.pow(2, 1 / 6)) / bin);
      let sy = 0,
        sn = 0;
      const freqs = [];
      for (let k = lo; k <= hi; k++) {
        sy += Py[k];
        sn += Pn[k];
        freqs.push(k * bin);
      }
      const want =
        10 *
        Math.log10(filterResponse(ty, fc, res, freqs).reduce((s, d) => s + Math.pow(10, d / 10), 0) / freqs.length);
      if (want > -40) worst = Math.max(worst, Math.abs(10 * Math.log10(sy / sn) - want));
    }
    errs.push([type, worst]);
  }
  ok(
    errs.every(([, e]) => e <= 1),
    `the filter's curve is its response: noise through each type against filterResponse, worst third-octave error ${errs.map(([ty, e]) => `${ty} ${fmt(e, 2)}`).join(', ')} dB (want 1 dB or less)`,
  );

  // The envelope: a 1 kHz sine with a slow, bent attack and a decay, its level every 10 ms against envAt
  const E = { attack: 0.3, decay: 0.25, sustain: 0.4, release: 0.3, curve: -0.6 };
  const x = play(
    83,
    {
      a_unison: 1,
      a_table: 'BASIC',
      a_pos: 0,
      flt_a: 'OFF',
      fx_verb_mix: 0,
      env1_vel: 0,
      env1_attack: E.attack,
      env1_decay: E.decay,
      env1_sustain: E.sustain,
      env1_release: E.release,
      env1_curve: E.curve,
    },
    1.2,
  );
  const level = (t0) => {
    const a = Math.round(t0 * SR) - 120,
      b = a + 240;
    let pk = 0;
    for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(x[i] || 0));
    return pk;
  };
  const peak = level(E.attack);
  let worstEnv = 0;
  for (let tt = 0.03; tt < 0.8; tt += 0.01) worstEnv = Math.max(worstEnv, Math.abs(level(tt) / peak - envAt(E, tt).v));
  ok(
    worstEnv < 0.03,
    `the drawn envelope is the kernel's: a rendered attack (curve -0.6) and decay against envAt, worst ${fmt(worstEnv * 100, 1)}% off over 0.8 s (want under 3%)`,
  );
  // and the page's constants are the kernel's own
  const lit = (name) => {
    const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(def.kernel);
    return m ? new Function('return ' + m[1])() : null;
  };
  const near = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  ok(
    near(lit('SYNC_BEATS'), SYNC_BEATS) && near(lit('DELAY_BEATS'), DELAY_BEATS),
    "the page's SYNC_BEATS and DELAY_BEATS are the kernel's",
  );
  ok(
    def.editor === 'wavetable' && def.source === 'builtin',
    `Light Table names its own window (editor: "${def.editor}")`,
  );
});
