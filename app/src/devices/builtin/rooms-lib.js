// @ts-check
// Echo Chamber's room tail and filters (core.rooms, intent 0006 "Real Rooms"): kernel text the device pastes into its
// source after SERIES (series.js), and the same functions imported by the tool that fits each room to it
// (tools/kits/air-rooms.js), so what the fit measures is what plays. One source, no eval: ROOM_TAIL is these
// functions' own text, as Light Table shares lightTables. They use nothing but the language, Math.sqrt, Math.round,
// Math.floor and the series (dsin, dcos, dexp): no Math.exp, sin, cos, tan, pow or log, so the numbers are the same on
// every engine (tools/rooms-test.js greps for them).
//
//   roomSvfSet(sr, kind, fc, q, dB, c, o)   lib.js's svf as coefficients in a typed array: a filter, low shelf, bell
//                                           or high shelf (the caller runs it inline)
//   roomPole(sr, fc)    a one-pole low pass's coefficient
//   roomGlide(ms, sr)   a glide's coefficient (lib.js's glide)
//   roomTail(sr, opts)  the fitted tail (below)
//
// THE TAIL (tail/1). An 8-line feedback delay network in Stairwell's family (core.verb): Householder mixing, integer
// line lengths (Stairwell's eight, scaled per room by fit.scale, 0.4 to 1.6, and by sr / 48000), no modulation. Mono
// in, delayed by fit.D frames (the fit sets D so the tail has built up by the room's early cut); stereo out, two
// different sums of the lines, so the sides are nearly uncorrelated, as a binaural room's late field is.
//   Absorption, three bands: in every loop a gain for the mid band and two first-order shelves, a low shelf at 500 Hz
// and a high shelf at 4 kHz, whose DC and top gains are the low and high bands' loop gains over the mid's. Each band's
// loop gain comes from its T60 (10^(-3 len / (T60 sr))), corrected against the loop's own response so that each band
// decays at exactly its T60 at its own frequency: 63 Hz, 1.4 kHz and 16 kHz (between them the T60 slopes smoothly from
// one to the next). Shelves multiply where one-pole band splits would add: the splits, worked out, missed the high
// band's T60 by 14% (the spec says "one-pole splits"; these are first-order shelves, the same cost).
//   T60s: fit.t60 = [low, mid, high] in seconds, times DECAY (0.5 to 2); DAMP (0 to 1) scales the high band's by
// (1 - 0.65 damp) and the mid band's by (1 - 0.25 damp).
//   Out: a low shelf at 250 Hz, a bell at 1.5 kHz and a high shelf at 6 kHz (fit.eq = [low, mid, high] dB), then fit.g.
//
//   const tail = roomTail(sr, { maxScale = 1.6, maxD = 0.25 s in frames })   everything allocated here
//   tail.set(fit, decay, damp)       a room's fit, any time; makes no arrays (a new scale moves the lines: the device
//                                    crossfades to a second tail for that, R23)
//   tail.process(x, outL, outR, n)   x mono in; writes n frames to outL and outR; allocates nothing (rooms-test)
//   tail.reset()                     silence
//
// The text of these functions is kernel source: never reformat this file (biome.jsonc lists it).
import { dsin, dcos, dexp, SERIES } from './series.js';

// The SVF's coefficients (Simper, trapezoidal, as lib.js's svf) into c[o .. o + 6]: k, a1, a2, a3, then the output
// mix m0, m1, m2 (out = m0 x + m1 bp + m2 lp). kind 0 is the plain filter (the mix gives lp; hp is x - k bp - lp),
// 1 a low shelf, 2 a bell, 3 a high shelf (db their gain). The caller runs it inline, its state in a typed array (a
// double stored in an object's field or a closure, or returned from a call that isn't inlined, is boxed on the heap):
//   v3 = x - s2, v1 = a1 s1 + a2 v3, v2 = s2 + a2 s1 + a3 v3; s1 = 2 v1 - s1, s2 = 2 v2 - s2; out m0 x + m1 v1 + m2 v2
export function roomSvfSet(sr, kind, fc, q, db, c, o) {
  const f = fc < 5 ? 5 : fc > sr * 0.49 ? sr * 0.49 : fc, wv = Math.PI * f / sr, t = dsin(wv) / dcos(wv);
  const A = kind ? dexp(db * Math.LN10 / 40) : 1;
  const g = kind === 1 ? t / Math.sqrt(A) : kind === 3 ? t * Math.sqrt(A) : t, qq = kind === 2 ? q * A : q;
  const k = 1 / (qq < 0.05 ? 0.05 : qq), a1 = 1 / (1 + g * (g + k)), a2 = g * a1;
  c[o] = k; c[o + 1] = a1; c[o + 2] = a2; c[o + 3] = g * a2;
  if (kind === 1) { c[o + 4] = 1; c[o + 5] = k * (A - 1); c[o + 6] = A * A - 1; }
  else if (kind === 2) { c[o + 4] = 1; c[o + 5] = k * (A * A - 1); c[o + 6] = 0; }
  else if (kind === 3) { c[o + 4] = A * A; c[o + 5] = k * (1 - A) * A; c[o + 6] = 1 - A * A; }
  else { c[o + 4] = 0; c[o + 5] = 0; c[o + 6] = 1; }
}
// a one-pole low pass's coefficient: y = x + (y - x) a, cut at fc
export function roomPole(sr, fc) { return dexp(-2 * Math.PI * (fc < 1 ? 1 : fc > sr * 0.49 ? sr * 0.49 : fc) / sr); }
// a glide's coefficient (lib.js's glide, coef(ms / 1000, sr)): y = x + (y - x) a per sample
export function roomGlide(ms, sr) { return ms <= 0 ? 0 : dexp(-1000 / (ms * sr)); }

export function roomTail(sr, opts) {
  const N = 8, BASE = [1031, 1327, 1523, 1801, 2111, 2437, 2741, 3089];
  const o = opts || {}, k = sr / 48000;
  const maxScale = o.maxScale || 1.6, maxD = o.maxD || Math.ceil(0.25 * sr);
  const pow2 = (x) => { let n = 1; while (n < x) n <<= 1; return n; };
  // the lines, one buffer (line i at i * LN), one write head; the input delay, its own ring
  const LN = pow2(Math.ceil(BASE[N - 1] * maxScale * k) + 4), LM = LN - 1, lines = new Float32Array(N * LN);
  const DN = pow2(maxD + 4), DM = DN - 1, din = new Float32Array(DN);
  const len = new Int32Array(N), gm = new Float64Array(N), lsA = new Float64Array(N), lsG = new Float64Array(N), hsA = new Float64Array(N), hsG = new Float64Array(N);
  const ls = new Float64Array(N), hs = new Float64Array(N), x = new Float64Array(N);
  // the output EQ: three SVFs a side (coefficients at 0, 7, 14; state at 2 f, left, and 6 + 2 f, right)
  const ec = new Float64Array(21), es = new Float64Array(12);
  let w = 0, dw = 0, D = 1, g = 0;
  const tanOf = (fc) => { const a = Math.PI * fc / sr; return dsin(a) / dcos(a); };
  const loop = (frames, t60) => dexp(-3 * Math.LN10 * frames / (t60 * sr));
  // the shelves' magnitudes at a frequency whose prewarped value is w (bilinear: s = j w): a low shelf with DC gain A
  // and corner W is (A W + s) / (W + s), a high shelf with top gain A is (W + A s) / (W + s)
  const shelfLo = (A, W, w) => Math.sqrt((A * A * W * W + w * w) / (W * W + w * w));
  const shelfHi = (A, W, w) => Math.sqrt((W * W + A * A * w * w) / (W * W + w * w));
  const T500 = tanOf(500), T4K = tanOf(4000), O = [tanOf(63), tanOf(1414), tanOf(sr > 40000 ? 16000 : 0.4 * sr)];
  const tail = {
    set(fit, decay, damp) {
      const dc = decay > 0 ? decay : 1, dm = damp < 0 ? 0 : damp > 1 ? 1 : damp;
      const sc = fit.scale < 0.4 ? 0.4 : fit.scale > maxScale ? maxScale : fit.scale;
      const tl = fit.t60[0] * dc, tm = fit.t60[1] * dc * (1 - 0.25 * dm), th = fit.t60[2] * dc * (1 - 0.65 * dm);
      for (let i = 0; i < N; i++) {
        const L = Math.round(BASE[i] * sc * k);
        len[i] = L;
        // each band's loop gain at its own frequency (63 Hz, 1.4 kHz, 16 kHz): the shelves' skirts overlap, so the
        // three gains are corrected against the loop's actual response there, three times over (from 9% off at
        // 1.4 kHz to under 0.1%)
        const t0 = loop(L, tl), t1 = loop(L, tm), t2 = loop(L, th);
        let gl = t0, gmid = t1, gh = t2, al = 1, ah = 1, W1 = 1, W2 = 1;
        for (let it = 0; it < 4; it++) {
          al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
          const m0 = gmid * shelfLo(al, W1, O[0]) * shelfHi(ah, W2, O[0]);
          const m1 = gmid * shelfLo(al, W1, O[1]) * shelfHi(ah, W2, O[1]);
          const m2 = gmid * shelfLo(al, W1, O[2]) * shelfHi(ah, W2, O[2]);
          gl *= t0 / m0; gmid *= t1 / m1; gh *= t2 / m2;
        }
        al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
        gm[i] = gmid;
        // a first-order low shelf, DC gain gl / gmid, its middle at 500 Hz; a high shelf, top gain gh / gmid, at 4 kHz
        lsA[i] = al - 1; lsG[i] = W1 / (1 + W1);
        hsA[i] = ah - 1; hsG[i] = W2 / (1 + W2);
      }
      D = fit.D < 1 ? 1 : fit.D > maxD ? maxD : Math.round(fit.D);
      g = fit.g;
      roomSvfSet(sr, 1, 250, 0.707, fit.eq[0], ec, 0);
      roomSvfSet(sr, 2, 1500, 0.7, fit.eq[1], ec, 7);
      roomSvfSet(sr, 3, 6000, 0.707, fit.eq[2], ec, 14);
      return tail;
    },
    process(inp, outL, outR, n) {
      for (let i = 0; i < n; i++) {
        din[dw] = inp[i];
        const v = din[(dw - D) & DM] * 0.5;
        dw = (dw + 1) & DM;
        let sum = 0;
        for (let li = 0; li < N; li++) {
          let y = lines[li * LN + ((w - len[li]) & LM)] * gm[li];
          // the low shelf (a TPT one-pole low pass, y + (A - 1) lp) and the high shelf (y + (A - 1) hp)
          let u = (y - ls[li]) * lsG[li], lp = u + ls[li]; ls[li] = lp + u;
          y += lsA[li] * lp;
          u = (y - hs[li]) * hsG[li]; lp = u + hs[li]; hs[li] = lp + u;
          y += hsA[li] * (y - lp);
          x[li] = y; sum += y;
        }
        sum *= 2 / N;
        for (let li = 0; li < N; li++) lines[li * LN + w] = x[li] - sum + ((li & 1) ? -v : v);
        w = (w + 1) & LM;
        const nl = x[0] - x[2] + x[4] - x[6] + 0.5 * (x[1] - x[5]);
        const nr = x[1] - x[3] + x[5] - x[7] + 0.5 * (x[2] - x[6]);
        let yl = nl, yr = nr;
        for (let f = 0; f < 3; f++) {
          const o = 7 * f, a1 = ec[o + 1], a2 = ec[o + 2], a3 = ec[o + 3], m0 = ec[o + 4], m1 = ec[o + 5], m2 = ec[o + 6];
          let p = 2 * f, s1 = es[p], s2 = es[p + 1], v3 = yl - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
          es[p] = 2 * v1 - s1; es[p + 1] = 2 * v2 - s2; yl = m0 * yl + m1 * v1 + m2 * v2;
          p += 6; s1 = es[p]; s2 = es[p + 1]; v3 = yr - s2; v1 = a1 * s1 + a2 * v3; v2 = s2 + a2 * s1 + a3 * v3;
          es[p] = 2 * v1 - s1; es[p + 1] = 2 * v2 - s2; yr = m0 * yr + m1 * v1 + m2 * v2;
        }
        outL[i] = yl * g;
        outR[i] = yr * g;
      }
    },
    reset() {
      lines.fill(0); din.fill(0); ls.fill(0); hs.fill(0); es.fill(0);
      return tail;
    },
  };
  return tail;
}

// the kernel text: the series, then these, in this order (a kernel pastes ROOM_TAIL after lib.js's LIB, whose names
// it doesn't reuse: svf, onepole, glide and coef there are built on Math.exp and Math.tan)
export const ROOM_TAIL = [SERIES, roomSvfSet, roomPole, roomGlide, roomTail].map(String).join('\n');
