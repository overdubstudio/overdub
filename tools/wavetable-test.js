// Light Table (core.wavetable), the wavetable synth (docs/research/LIGHT-TABLE.md). Nobody building it can listen, so
// every claim is measured, on the canonical Node render (app/src/engine/node/render.js) unless it says otherwise:
//
//   the device    (test/unit/wavetable.test.js) 117 params, each with a role and a meaning, in prefixed groups; 40 presets across the families;
//                 no product names in its copy
//   the tables    (test/unit/wavetable.test.js) one source: the kernel carries wavetables.js's lightTables verbatim, and what plays is what the page
//                 draws (a rendered cycle against LT.frame); every frame finite and peak-normalised; each band limit
//                 empty above its harmonics; the closed-form spectra (pulse, sync, steps) against the waves themselves;
//                 a table's memory and build time
//   band limits   high notes have nothing between their harmonics (plain tables at C7 and C8; the warps at C6); and
//                 the same check catches a kernel patched to read the full-band table at every pitch
//   unison        SPREAD takes the left-right correlation down
//   filters       each type does what it says, by its spectrum
//   LFO sync      a synced LFO's edges land on the beat (FREE, two tempos) and on the note (RETRIG)
//   the matrix    each of the 8 slots moves its destination; each of the 39 destinations moves the sound
//   no clicks     a position sweep, a table switch, a warp switch, a filter switch and a unison change, each mid-note,
//                 never step further in a sample than the waves on either side do
//   voicing       MONO's note stack, LEGATO without retriggering, glide time
//   determinism   two renders bit-identical (with S&H and per-note RANDOM in play)
//   presets       each near -16 LUFS (-18.5..-13.5) on the test phrase (the basses on the bass phrase), true peak at or
//                 under -1 dBTP; under a tenth of each one's energy below 35 Hz, and each bass with a body (30% or more
//                 in 100 Hz-2 kHz, its 500 Hz-2 kHz band within 20 dB of its 0-60 Hz band); no NaN anywhere at the
//                 extremes
//   allocation    a long render collects no more garbage than a kernel that does nothing (with the same params)
//   CPU, memory   16 held notes at the defaults within budget (scaled to an idle core); one instance's buffers
//
// Then the device check (kernel/check.js, run by checkDeviceNode in a child process), full at the defaults and quick on
// every preset. The face is in tools/wavetable-ui-test.js.
//   node tools/wavetable-test.js        CPU=0 skips the timing; GC=0 the allocation count
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tally } from './pw.js';
import { getDevice } from '../app/src/devices/registry.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure } from '../app/src/audio/measure.js';
import { phrase, bassPhrase, PHRASE_BEATS } from '../app/src/audio/testsignals.js';
import { DESTS, BASS_PRESETS } from '../app/src/devices/builtin/wavetable.js';
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { kernelSpecs } from '../app/src/kernel/host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const t = tally('wavetable');
import { TABLE_NAMES } from '../app/src/devices/builtin/wavetables.js';
import { ID, SR, BEAT, LT, def, mtof, dB, fmt, T, CLEAN, project, play, held } from '../test/unit/_wavetable-kit.js';

// (run as a child of the allocation check, with --trace-gc: the kernel through the worklet's own KernelCore, notes
// held, 20,000 blocks after a warm-up; 'null' is a kernel that does nothing, given the same params)
if (process.env.LT_GC_CHILD) {
  const which = process.env.LT_GC_CHILD;
  const NULL = '({ poly: 8, create() { return { voice() { let v = 0; return { start() { v = 1; }, release() { v = 0; }, render(L, R, n) { return v > 0; } }; }, process(L, R, n) {} }; } })';
  const values = { ...(def.presets.find((p) => p.name === (which === 'null' ? 'First Light' : which)) || def.presets[0]).params };
  const KC = kernelCore(SR, makeDsp(SR), kernelCompiler);
  const core = new KC({ source: which === 'null' ? NULL : def.kernel, kind: 'instrument', params: kernelSpecs(def), values, seed: 3, transport: { bpm: 120, playing: true, beat: 0, time: 0 } }, () => {});
  for (const [k, p] of [48, 55, 60, 64, 67, 71].entries()) core.msg({ type: 'on', p, v: 0.8, time: 0.01 + k * 0.003 });
  const L = new Float32Array(128), R = new Float32Array(128);
  let f = 0;
  for (let b = 0; b < 3000; b++) { core.block(null, null, L, R, f); f += 128; }
  console.log('STEADY-START');
  for (let b = 0; b < 20000; b++) { core.block(null, null, L, R, f); f += 128; }
  console.log('STEADY-END');
  process.exit(0);
}
// (run as a child of the memory check, with --expose-gc: three instances made in a fresh process, between two
// collections, so the garbage of the renders before them can't land in the measurement)
if (process.env.LT_MEM_CHILD) {
  const KC = kernelCore(SR, makeDsp(SR), kernelCompiler), keep = [];
  globalThis.gc?.();
  const before = process.memoryUsage().arrayBuffers;
  for (let i = 0; i < 3; i++) keep.push(new KC({ source: def.kernel, kind: 'instrument', params: kernelSpecs(def), values: {}, seed: i + 1 }, () => {}));
  globalThis.gc?.();
  console.log(`LT-MEM ${(process.memoryUsage().arrayBuffers - before) / keep.length / 1e6}`);
  process.exit(0);
}

const hash = (a) => crypto.createHash('sha1').update(Buffer.from(a.L.buffer)).update(Buffer.from(a.R.buffer)).digest('hex');
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const k = i + j + h, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi;
        const x = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = x;
      }
    }
  }
}
// power spectrum of x[at..at+N) through a Hann window
function power(x, at, N = 16384) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  fft(re, im);
  const P = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return P;
}
const band = (P, lo, hi, N = 16384) => { let s = 0; for (let k = Math.max(1, Math.floor(lo * N / SR)); k <= Math.min(P.length - 1, Math.ceil(hi * N / SR)); k++) s += P[k]; return 10 * Math.log10(s + 1e-30); };
function centroid(x, at, N = 4096) { const P = power(x, at, N); let a = 0, b = 0; for (let k = 1; k < P.length; k++) { a += k * P[k]; b += P[k]; } return b > 1e-30 ? a / b * SR / N : 0; }
function rms(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }
// the worst energy between the harmonics of f0 (below fmax), against the strongest harmonic, in dB
function aliasOf(x, f0, at = Math.round(0.4 * SR), fmax = 20000) {
  const N = 16384, P = power(x, at, N), bin = SR / N;
  let ref = 0, worst = 0;
  for (let k = 0; k < P.length; k++) {
    const f = k * bin, h = f / f0, near = Math.abs(h - Math.round(h)) * f0 < 0.006 * f + 6 * bin || f < 20;
    if (near && f >= f0 - 3 * bin) ref = Math.max(ref, P[k]); else if (!near && f < fmax) worst = Math.max(worst, P[k]);
  }
  return 10 * Math.log10(worst / ref + 1e-30);
}
// the pitch (MIDI) in [t0, t1) s, from the zero crossings of a low-passed copy
function pitchAt(x, t0, t1) { const a = Math.round(t0 * SR), b = Math.round(t1 * SR); let lp = 0, prev = 0, first = -1, last = -1, n = 0; for (let i = a; i < b; i++) { lp += (x[i] - lp) * 0.05; if (prev <= 0 && lp > 0) { if (first < 0) first = i; last = i; n++; } prev = lp; } return n > 1 ? 69 + 12 * Math.log2((n - 1) * SR / (last - first) / 440) : NaN; }
// each band's share of the energy (%), from the whole of x's spectrum averaged (Hann, N points, half overlapped)
function shares(x, edges, N = 1 << 15) {
  const P = new Float64Array(N / 2);
  for (let at = 0; at + N <= x.length; at += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[at + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bin = SR / N; let tot = 0; for (let k = 1; k < N / 2; k++) tot += P[k];
  return edges.map(([a, b]) => { let s = 0; for (let k = Math.max(1, Math.ceil(a / bin)); k < Math.min(N / 2, b / bin); k++) s += P[k]; return 100 * s / (tot || 1); });
}
// the largest step from one sample to the next in [a, b)
function maxStep(x, a = 0, b = x.length) { let m = 0; for (let i = Math.max(1, a); i < b; i++) { const d = Math.abs(x[i] - x[i - 1]); if (d > m) m = d; } return m; }
function corr(L, R, a, b) { let sl = 0, sr = 0, sll = 0, srr = 0, slr = 0; const n = b - a; for (let i = a; i < b; i++) { sl += L[i]; sr += R[i]; sll += L[i] * L[i]; srr += R[i] * R[i]; slr += L[i] * R[i]; } const cov = slr / n - sl * sr / n / n, vl = sll / n - sl * sl / n / n, vr = srr / n - sr * sr / n / n; return cov / Math.sqrt(vl * vr + 1e-30); }

/* ------------------------------------------------------------------------------------------------ band limits */
console.log('band limits: nothing between the harmonics up high');
{
  const al = (p, params, cyc = 1) => aliasOf(play(held(p), { ...CLEAN, ...params }, 1.5).m, mtof(p) / cyc);
  const plain = [['saw C7', 96, { a_table: 'BASIC', a_pos: 2 / 3 }], ['saw C8', 108, { a_table: 'BASIC', a_pos: 2 / 3 }], ['square C8', 108, { a_table: 'BASIC', a_pos: 1 }],
    ['PULSE C7', 96, { a_table: 'PULSE', a_pos: 0.7 }], ['SYNC C7', 96, { a_table: 'SYNC', a_pos: 1 }], ['GRIT C7', 96, { a_table: 'GRIT', a_pos: 1 }], ['CHIP C7', 96, { a_table: 'CHIP', a_pos: 0 }],
    ['HARMONICS C7', 96, { a_table: 'HARMONICS', a_pos: 1 }], ['BELL C7', 96, { a_table: 'BELL', a_pos: 1 }, 4], ['ORGAN C7', 96, { a_table: 'ORGAN', a_pos: 1 }, 2]]
    .map(([name, p, params, c]) => [name, al(p, params, c || 1)]);
  t.ok(plain.every(([, v]) => v <= -60), `the tables at C7 and C8: ${plain.map(([n, v]) => `${n} ${fmt(v)}`).join(', ')} dB (want <= -60)`);
  const warps = [['BEND 1', { a_warp: 'BEND', a_warp_amt: 1 }, -55], ['MIRROR 1', { a_warp: 'MIRROR', a_warp_amt: 1 }, -55], ['PW 0.5', { a_warp: 'PW', a_warp_amt: 0.5 }, -55], ['SYNC 0.7', { a_warp: 'SYNC', a_warp_amt: 0.7 }, -42]]
    .map(([name, params, lim]) => [name, al(84, { a_table: 'BASIC', a_pos: 2 / 3, ...params }), lim]);
  t.ok(warps.every(([, v, lim]) => v <= lim), `the warps on a saw at C6: ${warps.map(([n, v, lim]) => `${n} ${fmt(v)} (<= ${lim})`).join(', ')} dB`);
  // and the check bites: the same kernel made to read the full-band table at every pitch aliases at C7
  const naive = { ...def, id: 'test.lt-naive', kernel: def.kernel.replace('mip() { const dt = sh.mt;', 'mip() { return 0; const dt = sh.mt;') };
  const { defineDevice } = await import('../app/src/devices/registry.js');
  defineDevice(naive, { replace: true });
  const nv = aliasOf(play(held(96), { ...CLEAN, a_table: 'BASIC', a_pos: 2 / 3 }, 1.5, { device: 'test.lt-naive' }).m, mtof(96));
  t.ok(nv > -45, `the check would catch it: reading the full-band table at C7 aliases at ${fmt(nv)} dB`);
}

/* ------------------------------------------------------------------------------------------------ unison */
console.log('unison: spread widens');
{
  const chord = [57, 64, 69].map((p) => ({ p, t: 0, d: 1.5 }));
  const c = (params) => { const a = play(chord, { ...CLEAN, a_table: 'BASIC', a_pos: 2 / 3, a_detune: 0.35, ...params }, 1.5); return corr(a.L, a.R, Math.round(0.3 * SR), Math.round(1.4 * SR)); };
  const one = c({ a_unison: 1, a_spread: 1 }), seven = c({ a_unison: 7, a_spread: 1 }), narrow = c({ a_unison: 7, a_spread: 0 });
  t.ok(one > 0.98 && narrow > 0.98 && seven < 0.75, `left-right correlation: one voice ${fmt(one, 3)}, seven voices unspread ${fmt(narrow, 3)}, seven spread ${fmt(seven, 3)} (want > 0.98, > 0.98, < 0.75)`);
}

/* ------------------------------------------------------------------------------------------------ filters */
console.log('filters: each type by its spectrum');
{
  const src = { ...CLEAN, a_table: 'BASIC', a_pos: 2 / 3 }, at = Math.round(0.5 * SR);
  const spec = (params, p = 33) => power(play(held(p, 1.5), { ...src, ...params }, 1.5).m, at);
  const open = spec({});
  const f = (type, extra = {}) => spec({ flt_type: type, flt_cutoff: 1000, flt_res: 0.3, ...extra });
  const lp12 = f('LP12'), lp24 = f('LP24'), hp = f('HP'), bp = f('BP'), notch = f('NOTCH', { flt_res: 0.5 });
  const d = (P, lo, hi) => band(P, lo, hi) - band(open, lo, hi);
  t.ok(d(lp12, 3500, 7000) < -18 && Math.abs(d(lp12, 60, 400)) < 3, `LP12 takes ${fmt(d(lp12, 3500, 7000))} dB off 3.5-7 kHz, ${fmt(d(lp12, 60, 400))} dB off the lows`);
  t.ok(d(lp24, 3500, 7000) < d(lp12, 3500, 7000) - 12 && Math.abs(d(lp24, 60, 400)) < 4, `LP24 is steeper: ${fmt(d(lp24, 3500, 7000))} dB at 3.5-7 kHz (LP12 ${fmt(d(lp12, 3500, 7000))})`);
  t.ok(d(hp, 50, 250) < -18 && Math.abs(d(hp, 3500, 7000)) < 3, `HP takes ${fmt(d(hp, 50, 250))} dB off 50-250 Hz, ${fmt(d(hp, 3500, 7000))} dB off the highs`);
  t.ok(d(bp, 50, 250) < -15 && d(bp, 4000, 8000) < -15 && d(bp, 800, 1250) > d(bp, 50, 250) + 15, `BP keeps 0.8-1.25 kHz (${fmt(d(bp, 800, 1250))} dB) over the lows (${fmt(d(bp, 50, 250))}) and highs (${fmt(d(bp, 4000, 8000))})`);
  // NOTCH: the harmonics nearest 1 kHz against the open voice (A1: harmonics of 55 Hz), the rest left alone
  const h = (P, f0) => band(P, f0 - 8, f0 + 8);
  const near = (h(notch, 990) - h(open, 990)), far = Math.max(Math.abs(h(notch, 330) - h(open, 330)), Math.abs(h(notch, 3300) - h(open, 3300)));
  t.ok(near < -15 && far < 3, `NOTCH: ${fmt(near)} dB at 990 Hz, within ${fmt(far)} dB at 330 Hz and 3.3 kHz`);
  // COMB: noise through it, peaks at the cutoff's multiples and dips between
  const cb = power(play(held(60, 1.5), { ...CLEAN, a_level: 0, noise_level: 0.8, noise_color: 1, flt_type: 'COMB', flt_cutoff: 400, flt_res: 0.8, flt_key: 0 }, 1.5).m, at);
  let pk = 0, dip = 0; for (let k = 1; k <= 8; k++) { pk += h(cb, 400 * k); dip += h(cb, 400 * (k + 0.5)); }
  t.ok((pk - dip) / 8 > 10, `COMB rings at the cutoff's multiples: peaks ${fmt((pk - dip) / 8)} dB over the dips between (400 Hz, noise in)`);
  // FORMANT: the cutoff picks the vowel (U O A E I between 150 Hz and 6 kHz); the loudest harmonic of A2 sits on its
  // first formant (350, 400, 600, 400, 250 Hz)
  const F1 = [350, 400, 600, 400, 250], got = [0, 0.25, 0.5, 0.75, 1].map((v) => {
    const P = spec({ flt_type: 'FORMANT', flt_cutoff: 150 * Math.pow(40, v), flt_res: 0.5 }, 45);
    let bf = 0, bv = -Infinity; for (let k = 2; k * 110 < 3500; k++) { const e = h(P, k * 110); if (e > bv) { bv = e; bf = k * 110; } }
    return bf;
  });
  t.ok(got.every((f, i) => Math.abs(f / F1[i] - 1) <= 0.25), `FORMANT: the loudest harmonic follows the vowel's first formant, U O A E I: ${got.join(', ')} Hz (want ${F1.join(', ')}, within 25%)`);
}

/* ------------------------------------------------------------------------------------------------ LFO sync */
console.log('LFO sync: on the beat');
{
  // a square LFO on AMP at -1: silent while it is up (the first half of each beat), loud while down
  const gate = { ...CLEAN, a_table: 'BASIC', a_pos: 0, lfo1_shape: 'SQUARE', lfo1_sync: '1/4', m1_src: 'LFO1', m1_dst: 'AMP', m1_amt: -1, fx_verb_mix: 0 };
  // where the sound comes in: an envelope (|x| through a 1 ms one-pole) crossing half its top, re-armed below a fifth
  const edges = (x, from, to) => {
    const k = 1 - Math.exp(-1 / (0.001 * SR)), env = new Float64Array(to - from);
    let e = 0; for (let i = from; i < to; i++) { e += (Math.abs(x[i]) - e) * k; env[i - from] = e; }
    let top = 0; for (const v of env) top = Math.max(top, v);
    const out = []; let armed = true;
    for (let i = 0; i < env.length; i++) { if (armed && env[i] >= top / 2) { out.push((from + i) / SR); armed = false; } else if (!armed && env[i] < top / 5) armed = true; }
    return out;
  };
  const list = (a) => a.slice(0, 4).map((g) => fmt(g, 3)).join(', ') + (a.length > 4 ? ` (+${a.length - 4})` : '');
  const worst = (got, want) => Math.max(...want.map((w) => Math.min(...got.map((g) => Math.abs(g - w)))));
  for (const tempo of [120, 97]) {
    const beat = 60 / tempo, a = play(held(81, 4 * beat + 0.1), { ...gate, lfo1_mode: 'FREE' }, 4 * beat + 0.1, { tempo, tail: 0 });
    const got = edges(a.m, 0, Math.round(4 * beat * SR)), want = [0.5, 1.5, 2.5, 3.5].map((b) => b * beat);
    t.ok(got.length === 4 && worst(got, want) < 0.006, `FREE at 1/4, ${tempo} bpm: the sound comes in at ${list(got)} s, each within ${fmt(worst(got, want) * 1000)} ms of the half-beat (${list(want)})`);
  }
  const start = 0.31, a = play([{ p: 81, t: start, d: 2 }], { ...gate, lfo1_mode: 'RETRIG' }, 2.4, { tail: 0 });
  const got = edges(a.m, Math.round(start * SR), Math.round(2.3 * SR)), want = [0.5, 1.5, 2.5, 3.5].map((b) => start + b * BEAT);
  t.ok(got.length === 4 && worst(got, want) < 0.006, `RETRIG: the LFO starts with the note (at ${start} s, off the beat): in at ${list(got)} s, within ${fmt(worst(got, want) * 1000)} ms of the note's half-beats`);
}

/* ------------------------------------------------------------------------------------------------ the matrix */
console.log('the matrix: every slot, every destination');
{
  const base = { ...CLEAN, a_table: 'BASIC', a_pos: 2 / 3, flt_type: 'LP24', flt_cutoff: 400 };
  const cen = (params) => { const a = play(held(45, 1), { ...base, ...params }, 1); return centroid(a.m, Math.round(0.4 * SR)); };
  const slots = [];
  for (let n = 1; n <= 8; n++) { const s = { [`m${n}_src`]: 'MACRO 1', [`m${n}_dst`]: 'CUTOFF', [`m${n}_amt`]: 0.4 }; slots.push(cen({ ...s, macro1: 1 }) / cen({ ...s, macro1: 0 })); }
  t.ok(slots.every((x) => x > 1.5), `each of the 8 slots, MACRO 1 -> CUTOFF, opens the filter: centroid x${slots.map((x) => fmt(x, 2)).join(' x')}`);
  // every destination moves the sound: slot 1 (MACRO 1, amount +0.6) at macro 0 against macro 1, in a voice where
  // that destination is heard (an LFO's rate needs the LFO in use; a slot's amount needs that slot routed)
  const scene = (d) => {
    const s = { ...base, flt_cutoff: 2000, a_level: 0.6, m1_src: 'MACRO 1', m1_dst: d, m1_amt: 0.6 };
    if (/^B /.test(d)) Object.assign(s, { a_level: 0, b_level: 0.6, b_oct: 0, b_table: 'BASIC', b_pos: 0.3 });
    if (/WARP/.test(d)) Object.assign(s, { a_warp: 'SYNC', b_warp: 'SYNC' });
    if (/DETUNE/.test(d)) Object.assign(s, { a_unison: 4, b_unison: 4, a_detune: 0, b_detune: 0 });
    if (/LEVEL/.test(d)) Object.assign(s, { a_level: 0.3, b_level: /^B/.test(d) ? 0.3 : 0 });
    if (d === 'SUB LEVEL') Object.assign(s, { sub_level: 0 });
    if (d === 'NOISE LEVEL') Object.assign(s, { noise_level: 0 });
    const lr = /^LFO(\d) RATE/.exec(d);
    if (lr) Object.assign(s, { [`lfo${lr[1]}_shape`]: 'SINE', [`lfo${lr[1]}_rate`]: 3, [`lfo${lr[1]}_mode`]: 'RETRIG', m2_src: `LFO${lr[1]}`, m2_dst: 'CUTOFF', m2_amt: 0.3 });
    const ma = /^M(\d) AMT/.exec(d);
    if (ma) { const n = +ma[1] === 1 ? 2 : 1; Object.assign(s, { m1_src: 'OFF', m1_dst: 'OFF', [`m${n}_src`]: 'MACRO 1', [`m${n}_dst`]: d, [`m${n}_amt`]: 0.6, [`m${ma[1]}_src`]: 'MACRO 2', [`m${ma[1]}_dst`]: 'CUTOFF', [`m${ma[1]}_amt`]: 0, macro2: 1 }); }
    if (d === 'CHORUS MIX') Object.assign(s, { fx_chorus_depth: 0.8 });
    if (d === 'DRIVE MIX') Object.assign(s, { fx_drive: 0.6, fx_drive_mix: 0 });
    return s;
  };
  const dead = [];
  for (const d of DESTS.slice(1)) {
    const s = scene(d), a = play(held(57, 1), { ...s, macro1: 0 }, 1, { tail: 0.4 }), b = play(held(57, 1), { ...s, macro1: 1 }, 1, { tail: 0.4 });
    let num = 0; for (let i = 0; i < a.L.length; i++) num += (a.L[i] - b.L[i]) ** 2 + (a.R[i] - b.R[i]) ** 2;
    const rel = Math.sqrt(num / 2 / a.L.length) / Math.max(rms(a.L), rms(b.L), 1e-9);
    if (!(rel > 0.02)) dead.push(`${d} ${fmt(rel, 3)}`);
  }
  t.ok(!dead.length, `each of the ${DESTS.length - 1} destinations moves the sound (MACRO 1 at 0 against 1: more than 2% of the signal changes)${dead.length ? ': not ' + dead.join(', ') : ''}`);
  // and they move it the right way: PITCH up an octave at +0.5, PAN to the right
  const pit = pitchAt(play(held(45, 1), { ...CLEAN, a_table: 'BASIC', a_pos: 0, m1_src: 'MACRO 1', m1_dst: 'PITCH', m1_amt: 0.5, macro1: 1 }, 1).m, 0.3, 0.8);
  const pan = play(held(57, 1), { ...CLEAN, m1_src: 'MACRO 1', m1_dst: 'PAN', m1_amt: 0.5, macro1: 1 }, 1);
  t.ok(Math.abs(pit - 57) < 0.1 && rms(pan.R) > 30 * rms(pan.L), `PITCH +0.5 is an octave (A2 plays at ${fmt(pit, 2)}, A3 is 57); PAN +0.5 puts it hard right (L ${fmt(dB(rms(pan.L)) - dB(rms(pan.R)))} dB)`);
}

/* ------------------------------------------------------------------------------------------------ no clicks */
console.log('no clicks: sweeps and switches mid-note');
{
  // a change mid-note never steps further in one sample than the waves on either side of it do
  const P0 = { ...CLEAN, a_table: 'GROWL', a_pos: 0, flt_type: 'LP24', flt_cutoff: 6000 };
  const lane = (key, pts) => ({ [key]: { points: pts.map(([t, v]) => ({ t, v })), by: 'overdub' } });
  const at = (a, s0, s1) => maxStep(a.L, Math.round(s0 * SR), Math.round(s1 * SR));
  const cases = [
    ['a position sweep (GROWL 0 to 1 in 0.1 s)', P0, lane('a_pos', [[0.8, 0], [1.0, 1]]), [{ a_pos: 0 }, { a_pos: 0.25 }, { a_pos: 0.5 }, { a_pos: 0.75 }, { a_pos: 1 }]],
    ['a table switch (GROWL to FM)', { ...P0, a_pos: 0.6 }, lane('a_table', [[0, T('GROWL')], [1, T('GROWL')], [1, T('FM')]]), [{ a_table: 'GROWL', a_pos: 0.6 }, { a_table: 'FM', a_pos: 0.6 }]],
    ['a warp switch (BEND to SYNC)', { ...P0, a_pos: 0.4, a_warp: 'BEND', a_warp_amt: 0.6 }, lane('a_warp', [[0, 2], [1, 2], [1, 1]]), [{ a_pos: 0.4, a_warp: 'BEND', a_warp_amt: 0.6 }, { a_pos: 0.4, a_warp: 'SYNC', a_warp_amt: 0.6 }]],
    ['a filter switch (LP24 to HP)', { ...P0, a_pos: 0.4, flt_cutoff: 800 }, lane('flt_type', [[0, 1], [1, 1], [1, 2]]), [{ a_pos: 0.4, flt_cutoff: 800 }, { a_pos: 0.4, flt_cutoff: 800, flt_type: 'HP' }]],
    ['unison 1 to 8', { ...P0, a_pos: 0.4 }, lane('a_unison', [[0, 1], [1, 1], [1, 8]]), [{ a_pos: 0.4 }, { a_pos: 0.4, a_unison: 8 }]],
    ['a drive shape switch (TANH to FOLD, DRIVE 0.6)', { ...P0, a_pos: 0.4, fx_drive: 0.6 }, lane('fx_dist', [[0, 0], [1, 0], [1, 2]]), [{ a_pos: 0.4, fx_drive: 0.6 }, { a_pos: 0.4, fx_drive: 0.6, fx_dist: 2 }]],
    ['a drive shape switch (HARD to RECTIFY, DRIVE 0.6)', { ...P0, a_pos: 0.4, fx_drive: 0.6, fx_dist: 1 }, lane('fx_dist', [[0, 1], [1, 1], [1, 4]]), [{ a_pos: 0.4, fx_drive: 0.6, fx_dist: 1 }, { a_pos: 0.4, fx_drive: 0.6, fx_dist: 4 }]],
  ];
  const res = cases.map(([name, params, auto, statics]) => {
    const a = play(held(45, 1.5), params, 1.5, { auto, tail: 0 }), change = at(a, 0.35, 0.6);
    const ref = Math.max(...statics.map((s) => at(play(held(45, 1.5), { ...params, ...s }, 1.5, { tail: 0 }), 0.35, 0.6)));
    return [name, change / ref];
  });
  t.ok(res.every(([, r]) => r < 1.15), `the largest one-sample step through each change, against the waves either side: ${res.map(([n, r]) => `${n} x${fmt(r, 2)}`).join('; ')} (want < 1.15)`);
}

/* ------------------------------------------------------------------------------------------------ voicing */
console.log('voicing: mono, legato, glide');
{
  const base = { ...CLEAN, a_table: 'BASIC', a_pos: 0, env1_release: 0.05 };
  const notes = [{ p: 60, t: 0, d: 2 }, { p: 64, t: 0.5, d: 0.5 }, { p: 67, t: 1.5, d: 1 }];
  const at = [0.3, 0.7, 1.2, 1.7, 2.2], want = [60, 64, 60, 67, 67];
  const tr = play(notes, { ...base, voice_mode: 'MONO' }, 2.6).m;
  const got = at.map((s) => pitchAt(tr, s, s + 0.15));
  t.ok(got.every((g, i) => Math.abs(g - want[i]) < 0.3), `MONO keeps a note stack: ${got.map((g) => fmt(g, 1)).join(', ')} at ${at.join(', ')} s (want ${want.join(', ')}: back to the held C4 when E4 lets go)`);
  // LEGATO doesn't retrigger: the filter envelope (a fast pluck on the cutoff) opens again on MONO's second note only
  // (brightness as the centroid over the pitch: a fifth up is 1.5 times the centroid by itself)
  const pl = { ...base, a_pos: 2 / 3, flt_type: 'LP24', flt_cutoff: 300, flt_env: 0.8, env2_attack: 0.001, env2_decay: 0.15, env2_sustain: 0 };
  const two = [{ p: 48, t: 0, d: 1 }, { p: 55, t: 0.6, d: 0.8 }];
  const jump = (mode) => { const x = play(two, { ...pl, voice_mode: mode }, 1.6).m; return centroid(x, Math.round(0.605 * SR), 1024) / centroid(x, Math.round(0.56 * SR), 1024) / Math.pow(2, 7 / 12); };
  const jm = jump('MONO'), jl = jump('LEGATO');
  t.ok(jm > 1.25 && jl < 1.1, `the second, overlapping note, brightness over pitch: MONO retriggers the filter envelope (x${fmt(jm, 2)}), LEGATO slides on without it (x${fmt(jl, 2)})`);
  const g = play([{ p: 48, t: 0, d: 1 }, { p: 55, t: 0.5, d: 1 }], { ...base, voice_mode: 'LEGATO', voice_glide: 200 }, 1.6).m;
  const mid = pitchAt(g, 0.58, 0.62), end = pitchAt(g, 0.72, 0.8);
  t.ok(mid > 49.5 && mid < 53.5 && Math.abs(end - 55) < 0.3, `GLIDE 200 ms: ${fmt(mid, 2)} a tenth of a second in, ${fmt(end, 2)} after it (C3 to G3)`);
}

/* ------------------------------------------------------------------------------------------------ determinism, presets, extremes */
console.log('determinism, the presets, the extremes');
const PH = phrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
const BPH = bassPhrase().map((n) => ({ p: n.p, v: n.v, t: n.t * BEAT, d: n.d * BEAT }));
{
  const leak = def.presets.find((p) => p.name === 'Light Leak').params, motion = def.presets.find((p) => p.name === 'Stop Motion').params;
  const same = [{}, leak, motion].every((p) => hash(play(PH.slice(0, 30), p, 8, { tail: 1 })) === hash(play(PH.slice(0, 30), p, 8, { tail: 1 })));
  t.ok(same, 'two renders are bit-identical (the defaults, and two presets with S&H and per-note RANDOM in play)');
  const rows = def.presets.map((pr) => {
    const bass = BASS_PRESETS.includes(pr.name);
    const a = play(bass ? BPH : PH, pr.params, PHRASE_BEATS * BEAT, { tail: 2 }), m = measure(a.r);
    let nan = 0; for (const c of a.r.channels) for (const x of c) if (!Number.isFinite(x)) nan++;
    const [low, body] = shares(a.m, [[0, 35], [100, 2000]]);
    return { name: pr.name, lufs: m.lufs, tp: m.truePeak, nan, bass, low, body, mid: m.bands ? m.bands.mid - m.bands.sub : NaN };
  });
  const off = rows.filter((r) => !(r.lufs >= -18.5 && r.lufs <= -13.5) || r.tp > -1 || r.nan);
  t.ok(!off.length, `every preset near -16 LUFS with true peaks at or under -1 dBTP: ${rows.map((r) => `${r.name} ${fmt(r.lufs)}/${fmt(r.tp)}`).join(', ')}${off.length ? ' | OFF: ' + off.map((r) => r.name).join(', ') : ''}`);
  // The low end. Played where bass lines sit (A1, F1, C2, G1), a sub an octave down is at 22-33 Hz: felt on a big
  // system, gone on a laptop, and barely read by LUFS, so a preset levelled by LUFS with its weight there plays quiet
  // everywhere else. No preset keeps a tenth of its energy below 35 Hz, and each bass has a body small speakers play:
  // 30% or more of its energy in 100 Hz-2 kHz, and its 500 Hz-2 kHz band within 20 dB of its 0-60 Hz band
  const basses = rows.filter((r) => r.bass), deep = rows.filter((r) => !(r.low < 10));
  t.ok(!deep.length, `every preset keeps under a tenth of its energy below 35 Hz on its phrase: the basses ${basses.map((r) => `${r.name} ${fmt(r.low)}%`).join(', ')}; the rest ${fmt(Math.max(...rows.filter((r) => !r.bass).map((r) => r.low)))}% at most${deep.length ? ' | OFF: ' + deep.map((r) => `${r.name} ${fmt(r.low)}%`).join(', ') : ''}`);
  // (a sub is the exception, on purpose: its job is the octave a small speaker can't play; tools/bassmusic-test.js
  // holds the subs to being clean and mono instead)
  const isSub = (name) => (def.presets.find((p) => p.name === name).tags || []).includes('sub');
  const thin = basses.filter((r) => !isSub(r.name) && !(r.body >= 30 && r.mid >= -20));
  t.ok(!thin.length, `the basses have a body small speakers play: ${basses.map((r) => `${r.name} ${fmt(r.body, 0)}% in 100 Hz-2 kHz, 500 Hz-2 kHz at ${fmt(r.mid)} dB to the 0-60 Hz band`).join('; ')} (want 30% or more, and -20 dB or closer)${thin.length ? ' | OFF: ' + thin.map((r) => r.name).join(', ') : ''}`);
  // the extremes: every param at its min, at its max, and the worst corners together
  const all = (pick) => Object.fromEntries(def.params.map((p) => [p.key, pick(p)]));
  const loud = { a_unison: 8, b_unison: 8, a_level: 1, b_level: 1, a_warp: 'FM', a_warp_amt: 1, b_warp: 'FM', b_warp_amt: 1, sub_level: 1, noise_level: 1, flt_type: 'COMB', flt_res: 1, flt_drive: 1, fx_drive: 1, fx_delay_fb: 0.9, fx_delay_mix: 1, fx_verb_mix: 1, voice_level: 6 };
  for (let n = 1; n <= 8; n++) Object.assign(loud, { [`m${n}_src`]: 'RANDOM', [`m${n}_dst`]: DESTS[n * 4], [`m${n}_amt`]: 1 });
  const ex = PH.slice(0, 20).concat([{ p: 21, t: 1.6, d: 0.5, v: 1 }, { p: 108, t: 1.7, d: 0.5, v: 1 }]);
  const cases = [['all at min', all((p) => p.min)], ['all at max', all((p) => p.max)], ['the loud corner', loud], ['PW and SYNC at their ends at C8', { ...CLEAN, a_warp: 'PW', a_warp_amt: 1, b_level: 1, b_warp: 'SYNC', b_warp_amt: 1 }]];
  const ok = cases.map(([name, params]) => { const a = play(name.startsWith('PW') ? [{ p: 108, t: 0, d: 1, v: 1 }] : ex, params, 3, { tail: 1 }); let nan = 0, pk = 0; for (const c of [a.L, a.R]) for (const x of c) { if (!Number.isFinite(x)) nan++; else pk = Math.max(pk, Math.abs(x)); } return [name, nan, pk]; });
  t.ok(ok.every(([, nan, pk]) => !nan && pk <= 0.9), `no NaN and nothing past the output's ceiling at the extremes: ${ok.map(([n, nan, pk]) => `${n} ${nan ? nan + ' NaN' : fmt(dB(pk)) + ' dBFS'}`).join(', ')}`);
}

/* ------------------------------------------------------------------------------------------------ allocation */
if (process.env.GC !== '0') {
  console.log('allocation: a long render');
  // the kernel run directly (the worklet's own KernelCore), notes held, 20,000 blocks after a warm-up, with --trace-gc:
  // Light Table against a kernel that does nothing, given the same params (the host's own work is in both)
  const child = (which) => {
    const r = spawnSync(process.execPath, ['--trace-gc', path.join(HERE, 'wavetable-test.js')], { env: { ...process.env, LT_GC_CHILD: which }, encoding: 'utf8', maxBuffer: 1 << 26 });
    const lines = r.stdout.split('\n'), a = lines.indexOf('STEADY-START'), b = lines.indexOf('STEADY-END');
    return a < 0 || b < 0 ? NaN : lines.slice(a + 1, b).filter((l) => /Scavenge|Mark-Compact|Mark-sweep/.test(l)).length;
  };
  const base = child('null'), first = child('First Light'), flare = child('Lens Flare'), leak = child('Light Leak');
  t.ok(first <= base + 1 && flare <= base + 1 && leak <= base + 1, `garbage collections over 53 s of audio: a do-nothing kernel ${base}, First Light ${first}, Lens Flare ${flare}, Light Leak ${leak} (the kernel adds none)`);
}

/* ------------------------------------------------------------------------------------------------ table build time */
// (wall clock, so here: this runner retries a suite alone when load made it fail; test/unit has no retry)
if (process.env.CPU !== '0') {
  console.log('table build time');
  let ms = 0;
  for (let ti = 0; ti < TABLE_NAMES.length; ti++) {
    const st = LT.store(),
      t0 = performance.now();
    st.start(ti, 0.5);
    while (st.step());
    ms = Math.max(ms, performance.now() - t0);
  }
  t.ok(ms < 60, `a whole table builds in ${ms.toFixed(1)} ms (49 frames x 11 band limits; the kernel spreads it, four frames a block)`);
}

/* ------------------------------------------------------------------------------------------------ CPU and memory */
if (process.env.CPU !== '0') {
  console.log('CPU and memory');
  const ms = (id, params, n) => { const b = 8, p = project(Array.from({ length: n }, (_, k) => ({ p: 48 + 2 * k, t: 0, d: b, v: 0.8 })), params, b, { device: id }); const t0 = performance.now(); renderSong(p, { from: 0, to: b, tail: 0 }); return (performance.now() - t0) / 4000 * 100; };
  let ref = Infinity; const best = { def: Infinity, uni: Infinity, flare: Infinity };
  const flare = def.presets.find((p) => p.name === 'Lens Flare').params;
  for (let round = 0; round < 3; round++) {
    ref = Math.min(ref, ms('core.keys', { voice: 1 }, 16));
    best.def = Math.min(best.def, ms(ID, {}, 16));
    best.uni = Math.min(best.uni, ms(ID, { a_unison: 8, b_unison: 8, b_level: 0.5 }, 8));
    best.flare = Math.min(best.flare, ms(ID, flare, 16));
  }
  const scale = 2.1 / ref; // the reference's idle cost (Lamp Tines GRAND, 16 voices), as tools/instruments3-test.js scales
  t.note(`the reference (Lamp Tines GRAND, 16 voices) took ${fmt(ref, 2)}% here; figures scaled to an idle core`);
  t.ok(best.def * scale <= 8, `16 held notes at the defaults (8 sounding: poly 8): ${fmt(best.def * scale, 2)}% of a core (budget 8%)`);
  t.note(`8 notes with both oscillators at unison 8: ${fmt(best.uni * scale, 2)}% of a core; Lens Flare (7 + 3 voices, chorus, delay, room), 16 held: ${fmt(best.flare * scale, 2)}%`);
  // one instance's buffers: four table stores, the delay lines, the voices (measured in a fresh process: here, a
  // collection of the renders' buffers above could land between the two readings and make it negative)
  const r = spawnSync(process.execPath, ['--expose-gc', path.join(HERE, 'wavetable-test.js')], { env: { ...process.env, LT_MEM_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 24 });
  const mb = +(/LT-MEM (\S+)/.exec(r.stdout || '') || [])[1];
  t.ok(mb > 1 && mb < 32, `one instance holds ${fmt(mb, 1)} MB of buffers (want under 32)`);
}

/* ------------------------------------------------------------------------------------------------ the device check */
// (in a child process: checkDeviceNode gives checkDevice's answer; Chromium's worklet runs only the defaults, in
// tools/sounds-test.js (checkDevice, warnings only noted); the presets are not run there. The face, a control for each
// param at 390 px, is tools/wavetable-ui-test.js)
{
  console.log('the device check (Node)');
  const { checkDeviceNode } = await import('../app/src/engine/node/check.js');
  const { summarize } = await import('../app/src/kernel/check.js');
  const def = getDevice('core.wavetable');
  const r = await checkDeviceNode(def);
  t.ok(r.ok, `checkDevice (full) at the defaults: ${summarize(r)}`);
  t.ok(!r.warnings.length, `no check warnings${r.warnings.length ? ': ' + r.warnings.join(' | ') : ''}`);
  t.ok(!(r.extremes && r.extremes.failed && r.extremes.failed.length), 'every param at its min and its max renders (the check\'s 230 extreme cases)');
  const presets = [];
  for (const pr of def.presets) {
    const rep = await checkDeviceNode({ ...def, params: def.params.map((p) => ({ ...p, def: pr.params[p.key] })) }, { quick: true });
    presets.push({ name: pr.name, ok: rep.ok, errors: rep.errors, cpu: rep.cpu && rep.cpu.pct });
  }
  const bad = presets.filter((p) => !p.ok);
  t.ok(!bad.length, `checkDevice (quick) passes on all ${presets.length} presets (cpu ${Math.min(...presets.map((p) => p.cpu))}-${Math.max(...presets.map((p) => p.cpu))}% of real time)${bad.length ? ': ' + bad.map((p) => p.name + ': ' + p.errors.join('; ')).join(' | ') : ''}`);
}
t.done();
