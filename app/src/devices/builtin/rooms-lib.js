// @ts-check
// Echo Chamber's room tail, filters, taps and late convolution (core.rooms, intent 0006 "Real Rooms"): kernel text the
// device pastes into its
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
//   roomGen(sr, fft), genStart, genFill, genLift            the taps a room plays, at a DECAY (further down)
//   roomLate(fft, B, maxP, E), lateBegin, latePlan, lateProcess   the room's taps past the first E (further down)
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
//   T60s: fit.t60 = [low, mid, high] in seconds, times DECAY (0.5 to 2), or (given tref) the room's own T30s there
// times DECAY away from 1 (see set); DAMP (0 to 1) scales the high band's by (1 - 0.65 damp) and the mid band's by
// (1 - 0.25 damp).
//   Out: a low shelf at 250 Hz, a bell at 1.5 kHz and a high shelf at 6 kHz (fit.eq = [low, mid, high] dB, plus lift's
// dB), then fit.g (times lift's gain).
//
//   const tail = roomTail(sr, { maxScale = 1.6, maxD = 0.25 s in frames })   everything allocated here
//   tail.set(fit, decay, damp, lift, tref)   a room's fit, any time; makes no arrays (a new scale moves the lines: the
//                                    device prepares a second path for that, R23). lift (roomGen's genLift) and tref
//                                    (the room's T30 at 125 Hz, 1 kHz, 8 kHz) are for DECAY: both may be left out
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
  const T500 = tanOf(500), T4K = tanOf(4000), O = [tanOf(63), tanOf(1414), tanOf(sr > 40000 ? 16000 : 0.4 * sr)];
  // DECAY on a band's T60 t: t times it; or, given the room's own T30 r there (set's tref), the room's T30 times it, as
  // the measured part is bent (roomGen), so that DECAY 2 is twice the room's decay time and not twice the tail's (the
  // tail is fitted to the room's last 20 dB, which can fall slower than its T30). From t at 1 to r at 1.2 (or 1 / 1.2)
  // and beyond, smoothly: at 1 the tail starts 40 dB down, where the change is inaudible.
  const tail = {
    set(fit, decay, damp, lift, tref) {
      const dc = decay > 0 ? decay : 1, dm = damp < 0 ? 0 : damp > 1 ? 1 : damp;
      const sc = fit.scale < 0.4 ? 0.4 : fit.scale > maxScale ? maxScale : fit.scale;
      let tl = fit.t60[0] * dc, tm = fit.t60[1] * dc, th = fit.t60[2] * dc;
      if (tref && dc !== 1) {
        const q = dc > 1 ? dc : 1 / dc, w = q >= 1.2 ? 1 : (q - 1) * 5;
        tl = (fit.t60[0] + (tref[0] - fit.t60[0]) * w) * dc; tm = (fit.t60[1] + (tref[1] - fit.t60[1]) * w) * dc; th = (fit.t60[2] + (tref[2] - fit.t60[2]) * w) * dc;
      }
      tm *= 1 - 0.25 * dm; th *= 1 - 0.65 * dm;
      for (let i = 0; i < N; i++) {
        const L = Math.round(BASE[i] * sc * k);
        len[i] = L;
        // each band's loop gain at its own frequency (63 Hz, 1.4 kHz, 16 kHz): the shelves' skirts overlap, so the
        // three gains are corrected against the loop's actual response there, three times over (from 9% off at
        // 1.4 kHz to under 0.1%)
        // (each band's loop gain dexp(-3 ln 10 len / (T60 sr)); the shelves' magnitudes at a frequency whose prewarped
        // value is o (bilinear: s = j o): a low shelf with DC gain A and corner W is (A W + s) / (W + s), a high shelf
        // with top gain A is (W + A s) / (W + s). Written out, not helpers: the device's two tails share this
        // function's compiled code, and a call to either one's own helper closure would throw it away each time the
        // other came by)
        const t0 = dexp(-3 * Math.LN10 * L / (tl * sr)), t1 = dexp(-3 * Math.LN10 * L / (tm * sr)), t2 = dexp(-3 * Math.LN10 * L / (th * sr));
        let gl = t0, gmid = t1, gh = t2, al = 1, ah = 1, W1 = 1, W2 = 1;
        for (let it = 0; it < 4; it++) {
          al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
          const o0 = O[0], o1 = O[1], o2 = O[2];
          const m0 = gmid * Math.sqrt((al * al * W1 * W1 + o0 * o0) / (W1 * W1 + o0 * o0)) * Math.sqrt((W2 * W2 + ah * ah * o0 * o0) / (W2 * W2 + o0 * o0));
          const m1 = gmid * Math.sqrt((al * al * W1 * W1 + o1 * o1) / (W1 * W1 + o1 * o1)) * Math.sqrt((W2 * W2 + ah * ah * o1 * o1) / (W2 * W2 + o1 * o1));
          const m2 = gmid * Math.sqrt((al * al * W1 * W1 + o2 * o2) / (W1 * W1 + o2 * o2)) * Math.sqrt((W2 * W2 + ah * ah * o2 * o2) / (W2 * W2 + o2 * o2));
          gl *= t0 / m0; gmid *= t1 / m1; gh *= t2 / m2;
        }
        al = gl / gmid; ah = gh / gmid; W1 = T500 / Math.sqrt(al); W2 = T4K * Math.sqrt(ah);
        gm[i] = gmid;
        // a first-order low shelf, DC gain gl / gmid, its middle at 500 Hz; a high shelf, top gain gh / gmid, at 4 kHz
        lsA[i] = al - 1; lsG[i] = W1 / (1 + W1);
        hsA[i] = ah - 1; hsG[i] = W2 / (1 + W2);
      }
      D = fit.D < 1 ? 1 : fit.D > maxD ? maxD : Math.round(fit.D);
      // (lift: DECAY's envelope at the seam, from roomGen.lift: the gain times lift[0], the EQ's three gains plus
      // lift[1..3] dB, so the tail takes over at the level the enveloped room hands it)
      g = lift ? fit.g * lift[0] : fit.g;
      roomSvfSet(sr, 1, 250, 0.707, lift ? fit.eq[0] + lift[1] : fit.eq[0], ec, 0);
      roomSvfSet(sr, 2, 1500, 0.7, lift ? fit.eq[1] + lift[2] : fit.eq[1], ec, 7);
      roomSvfSet(sr, 3, 6000, 0.707, lift ? fit.eq[2] + lift[3] : fit.eq[2], ec, 14);
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

// THE TAPS (roomGen). What a room's convolution plays, made in order, an ear at a time, straight from the bank: the
// 16- or 24-bit IR times its gain (at another host rate, resampled linearly, and scaled by the rates' ratio so it
// carries the same energy). DECAY bends it: at 1 the taps are the IR itself; otherwise every frequency's decay is
// stretched by DECAY over its own measured time: the IR goes through a short-time transform (frames of fft.n points,
// Hann windows, a quarter frame apart) and each frame's bins are multiplied by 10^(-3 t (1 / DECAY - 1) / T(f)), t the
// frame's centre, T(f) the room's T30 at that frequency (its octaves' values, 125 Hz to 8 kHz, with 1 / T straight
// between them), at most GMAX (LIFT dB), then back and overlapped. The gains run from frame to frame by a factor per bin
// (the factors from the series, a few dexp a start), so the same doubles on every engine.
//
// State and functions, not closures: the device keeps two of these (its two wet paths), and one function for both keeps
// every call to it the same call, which the engine compiles once (a closure each would be two functions to it, and code
// compiled for one is thrown away when the other comes by).
//
//   const g = roomGen(sr, fft)       fft = dsp.fft(1024) (the frames); everything allocated here
//   genStart(g, a, b, frames, gain, step, t30, decay)   a, b: the ears (Int16Array or Int32Array), `frames` long at the
//                                    bank's rate; the taps are x * gain; step: the bank's rate over the host's; t30: the
//                                    room's T30 at 125, 250, 500, 1k, 2k, 4k and 8 kHz (s, a Float64Array of 7)
//   genFill(g, c, out, o, n)         the next n taps (n <= 4096) of ear c (0 left, 1 right) into out[o ..] (each ear
//                                    keeps its place)
//   genLift(g, t, over, out)         DECAY's envelope t seconds in, for the tail (roomTail.set's lift): out[0] the gain
//                                    at 1 kHz; out[1], out[2], out[3] at 250 Hz, 1 kHz and 4 kHz over it, in dB. over
//                                    (dB, low, mid, high, or null): how far the tail stands over the room just past the
//                                    cut, where its fit couldn't bring it down (a band that has died away there); a
//                                    boost takes that much less, so the tail takes over at the bent room's level
//
// A DECAY over 1 lifts each bin by at most LIFT dB (GMAX): Aula's last seconds at DECAY 2 would be lifted by over 100
// dB, and every dB of the tail's own misfit there with them. 30 dB is a band's first 30 dB at DECAY 2, its T30 range
// (-5 to -35 dB) bent nearly all the way; below, it keeps its own slope.
const GEN_LIFT = 30, GEN_GMAX = 31.622776601683793;
export function roomGen(sr, F) {
  const N = F.n, K = (N >> 1) + 1, win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * dcos(2 * Math.PI * i / N);
  // S: per ear c at 4 c, 0 the next frame, 1 the taps given; V: 0 the gain, 1 the step, 2 frames (at the bank's rate),
  // 3 flat (DECAY 1), 4 DECAY, 5 sr
  const S = new Float64Array(8), V = new Float64Array(6);
  V[5] = sr;
  return { F, N, H: N >> 2, K, win, A: null, B: null, S, V, T: new Float64Array(7),
    ring0: new Float64Array(8192), ring1: new Float64Array(8192), G0: new Float64Array(K), G1: new Float64Array(K), Rk: new Float64Array(K),
    fr: new Float64Array(N), Xr: new Float64Array(K), Xi: new Float64Array(K), y: new Float64Array(N) };
}
export function genStart(g, a, b, frames, gain, step, t30, decay) {
  const V = g.V, T = g.T, Rk = g.Rk, K = g.K, sr = V[5];
  g.A = a; g.B = b;
  V[0] = step === 1 ? gain : gain * step; V[1] = step; V[2] = frames; V[3] = decay === 1 ? 1 : 0; V[4] = decay;
  for (let i = 0; i < 7; i++) T[i] = t30[i] > 0.05 ? t30[i] : 0.05;
  g.S.fill(0); g.ring0.fill(0); g.ring1.fill(0); g.G0.fill(1); g.G1.fill(1);
  if (decay === 1) return;
  // the factor a frame (H taps), bin by bin: exp(kap / T(f)), 1 / T straight from octave to octave, so across an
  // octave the factor runs geometrically from bin to bin
  const kap = -3 * 2.302585092994046 * g.H * (1 / decay - 1) / sr, df = sr / g.N;
  let k = 0;
  const r0 = dexp(kap / T[0]);
  for (; k < K && k * df < 125; k++) Rk[k] = r0;
  for (let o = 0; o < 6; o++) {
    const f0 = 125 * (1 << o), f1 = 2 * f0, u0 = 1 / T[o], sl = (1 / T[o + 1] - u0) / (f1 - f0);
    if (k >= K || k * df >= f1) continue;
    let r = dexp(kap * (u0 + sl * (k * df - f0)));
    const q = dexp(kap * sl * df);
    for (; k < K && k * df < f1; k++) { Rk[k] = r; r *= q; }
  }
  const r6 = dexp(kap / T[6]);
  for (; k < K; k++) Rk[k] = r6;
}
export function genFill(g, c, out, o, n) {
  const S = g.S, V = g.V, b = 4 * c, e = S[b + 1], x = c ? g.B : g.A, gn = V[0], st = V[1], M = V[2];
  if (V[3] === 1) {
    for (let i = 0; i < n; i++) {
      const m = e + i;
      let v = 0;
      if (st === 1) v = m < M ? x[m] * gn : 0;
      else { const q = m * st, j = Math.floor(q), f = q - j, a0 = j < M ? x[j] : 0, a1 = j + 1 < M ? x[j + 1] : 0; v = (a0 + (a1 - a0) * f) * gn; }
      out[o + i] = v;
    }
    S[b + 1] = e + n;
    return;
  }
  // frame f of the ear: input taps (f - 3) H .. (f + 1) H, windowed; each bin times its gain (1 until the frames'
  // centres pass 0, then times its factor a frame, to GMAX at most); back, half (four Hann windows a quarter apart sum
  // to 2), into the ring. Tap m is whole once frame floor(m / H) + 3 is in.
  const N = g.N, H = g.H, K = g.K, win = g.win, fr = g.fr, Xr = g.Xr, Xi = g.Xi, y = g.y, Rk = g.Rk, G = c ? g.G1 : g.G0, R = c ? g.ring1 : g.ring0;
  const need = Math.floor((e + n - 1) / H) + 3;
  let f = S[b];
  for (; f <= need; f++) {
    const n0 = (f - 3) * H;
    for (let i = 0; i < N; i++) {
      const m = n0 + i;
      let v = 0;
      if (m >= 0) {
        if (st === 1) v = m < M ? x[m] * gn : 0;
        else { const q = m * st, j = Math.floor(q), fq = q - j, a0 = j < M ? x[j] : 0, a1 = j + 1 < M ? x[j + 1] : 0; v = (a0 + (a1 - a0) * fq) * gn; }
      }
      fr[i] = v * win[i];
    }
    g.F.forward(fr, Xr, Xi);
    if (f >= 2) for (let k = 0; k < K; k++) { const gk = G[k] * Rk[k]; G[k] = gk > GEN_GMAX ? GEN_GMAX : gk; }
    for (let k = 0; k < K; k++) { Xr[k] *= G[k]; Xi[k] *= G[k]; }
    g.F.inverse(Xr, Xi, y);
    for (let i = 0; i < N; i++) { const m = n0 + i; if (m >= 0) R[m & 8191] += y[i] * 0.5; }
  }
  S[b] = f;
  for (let i = 0; i < n; i++) { const q = (e + i) & 8191; out[o + i] = R[q]; R[q] = 0; }
  S[b + 1] = e + n;
}
export function genLift(g, t, over, out) {
  const V = g.V, T = g.T, k = -60 * t * (1 / V[4] - 1);
  let lo = k / T[1], mid = k / T[3], hi = k / T[5];
  if (lo > GEN_LIFT) lo = GEN_LIFT;
  if (mid > GEN_LIFT) mid = GEN_LIFT;
  if (hi > GEN_LIFT) hi = GEN_LIFT;
  // (a boost, less what the tail already stands over the room)
  if (over) {
    if (lo > 0 && over[0] > 0) lo -= over[0] < lo ? over[0] : lo;
    if (mid > 0 && over[1] > 0) mid -= over[1] < mid ? over[1] : mid;
    if (hi > 0 && over[2] > 0) hi -= over[2] < hi ? over[2] : hi;
  }
  out[0] = dexp(mid * 2.302585092994046 / 20); out[1] = lo - mid; out[2] = 0; out[3] = hi - mid;
}

// THE LATE PART (roomLate). The room's taps from E on (E >= 2 B - 128; the device's first E taps play through
// dsp.convolver), by uniformly partitioned overlap-save in blocks of B (FFTs of 2 B points: dsp.fft), with each block's
// work spread over its B / 128 quanta, so no quantum carries all of it: the quantum a block of input completes, its
// spectrum; then a slice of the bins' products a quantum; the last two, the inverse transforms, an ear each. It can wait
// that long because its first tap is E frames in: a block's output isn't due until a block after its input completes.
// The output is the taps from E on convolved with the input, 128 + E frames late, so it lands in step with
// dsp.convolver's (whose latency is its 128-frame head). The partitions' spectra are made one at a time (latePlan), so
// a new room is planned across quanta, well before the input reaches each partition. Its spectra are kept as float32
// (a partition's products are summed in doubles): half the memory, and the same numbers on every engine. State and
// functions, as roomGen's.
//
//   const L = roomLate(fft, B, maxP, E)   fft = dsp.fft(2 B); room for maxP partitions; everything allocated here
//   lateBegin(L, n)                  a new room of n taps from E: history and output silent, n / B partitions used
//   latePlan(L, c, p, frame)         partition p of ear c from frame (2 B doubles: its B taps, then B zeros)
//   lateProcess(L, x, outL, outR, n) x mono in; ADDS n frames to outL and outR; allocates nothing
export function roomLate(F, B, maxP, E) {
  const N = 2 * B, K = B + 1, P = maxP > 0 ? maxP : 1, HN = 4 * B;
  return { F, B, N, K, Q: B >> 7, P, E, HM: HN - 1,
    hr0: new Float32Array(P * K), hi0: new Float32Array(P * K), hr1: new Float32Array(P * K), hi1: new Float32Array(P * K),
    xr: new Float32Array(P * K), xi: new Float32Array(P * K),
    hist: new Float64Array(HN), o0: new Float64Array(HN), o1: new Float64Array(HN),
    fr: new Float64Array(N), tr: new Float64Array(K), ti: new Float64Array(K), out: new Float64Array(N),
    yr0: new Float64Array(K), yi0: new Float64Array(K), yr1: new Float64Array(K), yi1: new Float64Array(K),
    // T: 0 the time (frames since begin); I: 0 partitions used, 1 blocks taken, 2 the newest block's slot
    T: new Float64Array(1), I: new Int32Array(3) };
}
export function lateBegin(L, n) {
  const I = L.I, u = n > 0 ? Math.ceil(n / L.B) : 0;
  L.T[0] = 0; I[0] = u < L.P ? u : L.P; I[1] = 0; I[2] = 0;
  L.hist.fill(0); L.o0.fill(0); L.o1.fill(0);
}
export function latePlan(L, c, p, frame) {
  const tr = L.tr, ti = L.ti, K = L.K, Hr = c ? L.hr1 : L.hr0, Hi = c ? L.hi1 : L.hi0, o = p * K;
  L.F.forward(frame, tr, ti);
  for (let k = 0; k < K; k++) { Hr[o + k] = tr[k]; Hi[o + k] = ti[k]; }
}
// the quantum s of the block cycle, at time t
function lateStep(L, s, t) {
  const I = L.I, K = L.K, P = L.P, B = L.B, Q = L.Q, CH = Q - 3, HM = L.HM;
  if (s === 0) {
    const N = L.N, fr = L.fr, hist = L.hist, tr = L.tr, ti = L.ti, xr = L.xr, xi = L.xi;
    for (let j = 0; j < N; j++) fr[j] = hist[(t - N + j) & HM];
    L.F.forward(fr, tr, ti);
    const sl = I[1] % P, o = sl * K;
    for (let k = 0; k < K; k++) { xr[o + k] = tr[k]; xi[o + k] = ti[k]; }
    I[2] = sl; I[1]++;
    return;
  }
  const u = I[0], f = I[1], lim = f < u ? f : u;
  if (!lim) return;
  if (s <= CH) {
    const k0 = Math.floor((s - 1) * K / CH), k1 = Math.floor(s * K / CH);
    const xr = L.xr, xi = L.xi, hr0 = L.hr0, hi0 = L.hi0, hr1 = L.hr1, hi1 = L.hi1, yr0 = L.yr0, yi0 = L.yi0, yr1 = L.yr1, yi1 = L.yi1;
    for (let k = k0; k < k1; k++) { yr0[k] = 0; yi0[k] = 0; yr1[k] = 0; yi1[k] = 0; }
    for (let p = 0; p < lim; p++) {
      let sl = I[2] - p; if (sl < 0) sl += P;
      const xo = sl * K, ho = p * K;
      for (let k = k0; k < k1; k++) {
        const ar = xr[xo + k], ai = xi[xo + k], br = hr0[ho + k], bi = hi0[ho + k], cr = hr1[ho + k], ci = hi1[ho + k];
        yr0[k] += ar * br - ai * bi;
        yi0[k] += ar * bi + ai * br;
        yr1[k] += ar * cr - ai * ci;
        yi1[k] += ar * ci + ai * cr;
      }
    }
    return;
  }
  const c = s - (Q - 2), R = c ? L.o1 : L.o0, out = L.out;
  L.F.inverse(c ? L.yr1 : L.yr0, c ? L.yi1 : L.yi0, out);
  // (this block's input completed s quanta ago, at t - 128 s: its first output frame is due B frames before that, plus
  // E + 128)
  const due = t - 128 * s - B + L.E + 128;
  for (let i = 0; i < B; i++) R[(due + i) & HM] += out[B + i];
}
export function lateProcess(L, x, outL, outR, n) {
  // (a room with no taps past E: nothing to do)
  if (!L.I[0]) return;
  const hist = L.hist, o0 = L.o0, o1 = L.o1, HM = L.HM, B = L.B, Q1 = L.Q - 1;
  let t = L.T[0];
  for (let i = 0; i < n; i++) {
    if ((t & 127) === 0 && t >= B) lateStep(L, (t >> 7) & Q1, t);
    const q = t & HM;
    hist[q] = x[i];
    outL[i] += o0[q]; outR[i] += o1[q]; o0[q] = 0; o1[q] = 0;
    t++;
  }
  L.T[0] = t;
}

// the kernel text: the series, then these, in this order (a kernel pastes ROOM_TAIL after lib.js's LIB, whose names
// it doesn't reuse: svf, onepole, glide and coef there are built on Math.exp and Math.tan)
export const ROOM_TAIL = [SERIES, roomSvfSet, roomPole, roomGlide, roomTail, `const GEN_LIFT = ${GEN_LIFT}, GEN_GMAX = ${GEN_GMAX};`, roomGen, genStart, genFill, genLift, roomLate, lateBegin, latePlan, lateStep, lateProcess].map(String).join('\n');

// ---------------------------------------------------------------------------------------------- the rooms and the bank
// The ROOM switch's table, append-only: [label, bank, the room's id in that bank]. An index is a room forever (a song
// stores the index): a room is added at the end, never reordered, reused or renamed. The kernel pastes it as JSON.
export const ROOMS = [
  ['AULA', 'aachen', 'aachen.aula-3m'],
  ['AULA FAR', 'aachen', 'aachen.aula-10m'],
  ['LECTURE', 'aachen', 'aachen.lecture-5m'],
  ['STAIRS', 'aachen', 'aachen.stairway-2m'],
  ['OFFICE', 'aachen', 'aachen.office-2m'],
  ['MEETING', 'aachen', 'aachen.meeting-2m'],
];
export const ROOM_LABELS = ROOMS.map((r) => r[0]);
// the `aachen` bank (node tools/fetch-kits.js air-rooms builds it: tools/kits/air-rooms.js). Frozen once it ships: a
// better fit is a new room in a new bank, never a changed one
export const ROOMS_HASH = 'sha256-a2ac012d554fc16d36e2d87207fe859249bb7b6957295a374040c5866729bdb1';
// what the rack and the pickers say while the bank is on its way, or isn't on this server (ui/rack.js dataLine): the
// effect passes its input through meanwhile
export const ROOMS_SAYS = {
  loading: ['Loading rooms…', 'Loading its rooms: the sound passes dry until they’re in'],
  missing: ['No rooms here', 'Its rooms aren’t on this server, so the sound passes dry'],
};
// the bank's meta.credit, as the card prints it: source text, unsigned (tools/rooms-test.js holds it to the header)
export const ROOMS_CREDIT = 'Rooms measured by RWTH Aachen University (AIR 1.4, MIT).';
// What the card and the agents say about each room, from the bank's header (tools/kits/air-rooms.js roomInfo writes it;
// tools/rooms-test.js holds it to the decoded header, field by field): its label and id, what it is, how far from the
// source the ears were (m), its T30 at 500 Hz, 1 kHz and 2 kHz and its EDT at 1 kHz (s, measured from the full IR),
// and its early cut (s)
export const ROOM_INFO = [
  { label: 'AULA', id: 'aachen.aula-3m', name: 'Aula Carolina', place: 'Aachen', what: 'a former church', distance: 3, t30: [4.203, 3.176, 2.665], edt: 2.642, tx: 6.74 },
  { label: 'AULA FAR', id: 'aachen.aula-10m', name: 'Aula Carolina', place: 'Aachen', what: 'a former church', distance: 10, t30: [4.261, 3.168, 2.697], edt: 2.958, tx: 6.92 },
  { label: 'LECTURE', id: 'aachen.lecture-5m', name: 'Lecture room', place: 'Aachen', what: 'a lecture room', distance: 5.56, t30: [0.855, 0.882, 0.918], edt: 0.77, tx: 0.61 },
  { label: 'STAIRS', id: 'aachen.stairway-2m', name: 'Stairway', place: 'Aachen', what: 'a stairwell', distance: 2, t30: [1.336, 1.174, 1.044], edt: 0.707, tx: 0.85 },
  { label: 'OFFICE', id: 'aachen.office-2m', name: 'Office', place: 'Aachen', what: 'an office', distance: 2, t30: [0.633, 0.492, 0.419], edt: 0.461, tx: 0.5 },
  { label: 'MEETING', id: 'aachen.meeting-2m', name: 'Meeting room', place: 'Aachen', what: 'a meeting room', distance: 1.9, t30: [0.383, 0.343, 0.309], edt: 0.223, tx: 0.31 },
];
