// The guitar amps' engine: Half Stack's (amp-lib.js), generalised into voicings. Each amp.* that has moved onto it is a
// kernel (devices/guitar/amps.js) whose source is this text, the cab's (AMP_CAB, below) and its voicing (devices/
// guitar/voicings.js): its circuit's stages in order, its tone stack's own parts, its power amp and its cab.
// Half Stack keeps its own text (amp-lib.js AMP_LIB), byte for byte.
//
// Kernel source: these functions' own text (`${fn}`) is pasted into the amps' kernels, so they are plain, self-contained
// and never reformatted (biome.jsonc).
//
//   ampStack(net)  a passive tone stack from its netlist: H(s) = N(s) / D(s) exactly, by nodal analysis. The nodal
//                  matrix Y(s) = G + sC of a network with k capacitors has det Y a polynomial of degree <= k in s, and
//                  by Cramer's rule the output's numerator (det Y with the output's column replaced by the source's)
//                  one too; each is evaluated at k + 1 real points (s / W0 = 0.5, 1, 2, ...) and interpolated. net:
//                  { nodes: [...] (the unknowns; 'in' is the source, 'gnd' ground), out, parts: [[kind 'R' | 'C', a,
//                  b, value(k)]] }, k the knobs { t, m, l } (each 0..1, tapered). .analog(k, B, A) fills B, A with
//                  b0.. and a0.. (a0 = 1) in real s; .order is k.
//   tmbNet(c)      the Fender / Marshall TMB (Yeh & Smith's Bassman circuit, as Half Stack's closed form): C1 the
//                  treble cap, C2 the bass cap, C3 the mid cap, R1 the treble pot, R2 the bass pot (a rheostat), R3 the
//                  mid pot (C3 on its wiper), R4 the slope resistor. It matches tmbAnalog to 1e-9 dB (test/unit).
//   potLin, potAud a pot's position (knob 0..10 -> 0..1) with a whisker at each end: linear, or an audio taper (Half
//                  Stack's bass)
//   waCoefs(type, f0, Q, G, sr, o)  a Web Audio BiquadFilterNode's coefficients, the spec's formulas (lowpass and
//                  highpass Q in dB; shelves at S = 1): o = [b0, b1, b2, a1, a2], a0 = 1. The gear's designed cabs, mics
//                  and presence were voiced on these.
//
// AMP_VOICED (kernel text; needs lib.js's prelude) defines makeVoiced(sr, dsp, V) -> { latency, set(P), tick(x) }: one
// host-rate sample in, the amp before its cab out. V, the voicing:
//   os       2 or 4: the oversampling the stages run at (a clean amp needs less)
//   hp       the input's coupling high-pass (Hz, second order, Butterworth)
//   tight    [Hz, dB <= 0]: a low shelf before the first stage (its cathode bypass cap, partial), or null
//   chain    the stages in order, at the oversampled rate:
//              ['tri', g, bias, K, hp, lp]  a triode (Half Stack's: inverting, biased, a firm knee where the grid
//                                           conducts, a softer cutoff out to -K, first-order ADAA) driven g times its
//                                           input, then its coupling high-pass and Miller low-pass (Hz)
//              ['pot']                      the GAIN pot, pot = [dB at 0, dB at 10]; with bright = [pF, ohms] a bright
//                                           cap across its top (strong turned down, gone at full, as on the real one)
//              ['stack']                    the tone stack: stack = { R1, R2, R3, R4, C1, C2, C3 } (the TMB)
//              ['gain', dB]                 a fixed gain (a cathode follower, a stack's insertion loss made up)
//   pw, sag  the power amp: drive (dB) into a symmetric soft clip whose headroom sag (0..1) lowers on sustained loud
//            playing (the supply's envelope, 8 ms in, 180 ms out), made up after so small signals pass at unity
//   xf       [hp, lp]: the output transformer's band (Hz), at the oversampled rate (what the stages make up there
//            never reaches the decimator's edge)
//   depth    [Hz, dB >= 0]: the speaker's resonance through the feedback loop, a bell (or null)
//   pres     [Hz, dB a step]: PRESENCE, a high shelf, (presence - 5) * step dB (the graph amps': 1.6)
// What the stages invert is turned back at the end, so an amp is in phase with its DI.
import { cabSin, cabResample } from './amp-lib.js';

export function ampStack(net) {
  const N = net.nodes.length, idx = (n) => (n === 'in' ? -1 : n === 'gnd' ? -2 : net.nodes.indexOf(n)), out = idx(net.out);
  const parts = net.parts.map((p) => [p[0] === 'C' ? 1 : 0, idx(p[1]), idx(p[2]), p[3]]);
  let nC = 0;
  for (const p of parts) nC += p[0];
  const K = nC + 1, W0 = 2 * Math.PI * 1000;
  const Y = new Float64Array(N * N), B = new Float64Array(N), M = new Float64Array(N * N), save = new Float64Array(N), vals = new Float64Array(parts.length);
  const S = new Float64Array(K), dn = new Float64Array(K), nm = new Float64Array(K), cd = new Float64Array(K), cn = new Float64Array(K);
  const V = new Float64Array(K * K), A = new Float64Array(K * K), b = new Float64Array(K);
  for (let k = 0; k < K; k++) S[k] = 0.5 * Math.pow(2, k);
  // det by Gaussian elimination with partial pivoting (on a copy)
  const det = () => {
    for (let i = 0; i < N * N; i++) M[i] = Y[i];
    let d = 1;
    for (let c = 0; c < N; c++) {
      let p = c, best = Math.abs(M[c * N + c]);
      for (let r = c + 1; r < N; r++) { const v = Math.abs(M[r * N + c]); if (v > best) { best = v; p = r; } }
      if (best === 0) return 0;
      if (p !== c) { for (let j = 0; j < N; j++) { const t = M[c * N + j]; M[c * N + j] = M[p * N + j]; M[p * N + j] = t; } d = -d; }
      const piv = M[c * N + c];
      d *= piv;
      for (let r = c + 1; r < N; r++) { const f = M[r * N + c] / piv; if (f) for (let j = c; j < N; j++) M[r * N + j] -= f * M[c * N + j]; }
    }
    return d;
  };
  const fill = (s) => {
    Y.fill(0); B.fill(0);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], a = p[1], c = p[2], y = p[0] ? s * vals[i] : 1 / vals[i];
      if (a >= 0) Y[a * N + a] += y;
      if (c >= 0) Y[c * N + c] += y;
      if (a >= 0 && c >= 0) { Y[a * N + c] -= y; Y[c * N + a] -= y; }
      // the source: a known voltage at 'in' puts its current on the right-hand side
      if (a === -1 && c >= 0) B[c] += y;
      if (c === -1 && a >= 0) B[a] += y;
    }
  };
  // the polynomial through (S[k], y[k]): sum_j c_j S_k^j = y_k (Vandermonde, by elimination)
  for (let r = 0; r < K; r++) for (let j = 0; j < K; j++) V[r * K + j] = Math.pow(S[r], j);
  const interp = (y, c) => {
    for (let i = 0; i < K * K; i++) A[i] = V[i];
    for (let i = 0; i < K; i++) b[i] = y[i];
    for (let col = 0; col < K; col++) {
      let p = col;
      for (let r = col + 1; r < K; r++) if (Math.abs(A[r * K + col]) > Math.abs(A[p * K + col])) p = r;
      if (p !== col) { for (let j = 0; j < K; j++) { const t = A[col * K + j]; A[col * K + j] = A[p * K + j]; A[p * K + j] = t; } const t = b[col]; b[col] = b[p]; b[p] = t; }
      for (let r = col + 1; r < K; r++) { const f = A[r * K + col] / A[col * K + col]; for (let j = col; j < K; j++) A[r * K + j] -= f * A[col * K + j]; b[r] -= f * b[col]; }
    }
    for (let r = K - 1; r >= 0; r--) { let s = b[r]; for (let j = r + 1; j < K; j++) s -= A[r * K + j] * c[j]; c[r] = s / A[r * K + r]; }
  };
  return {
    order: nC,
    analog(kn, outB, outA) {
      for (let i = 0; i < parts.length; i++) vals[i] = parts[i][3](kn);
      for (let k = 0; k < K; k++) {
        fill(S[k] * W0);
        dn[k] = det();
        for (let r = 0; r < N; r++) { save[r] = Y[r * N + out]; Y[r * N + out] = B[r]; }
        nm[k] = det();
        for (let r = 0; r < N; r++) Y[r * N + out] = save[r];
      }
      interp(dn, cd); interp(nm, cn);
      const a0 = cd[0];
      let w = 1;
      for (let j = 0; j < K; j++) { outA[j] = cd[j] / a0 / w; outB[j] = cn[j] / a0 / w; w *= W0; }
    },
  };
}
export function tmbNet(c) {
  const R1 = c.R1, R2 = c.R2, R3 = c.R3, R4 = c.R4, C1 = c.C1, C2 = c.C2, C3 = c.C3;
  return {
    nodes: ['tt', 'o', 'tb', 'mt', 'mw', 'sl'], out: 'o',
    parts: [
      ['C', 'in', 'tt', () => C1],
      ['R', 'tt', 'o', (k) => R1 * (1 - k.t)],
      ['R', 'o', 'tb', (k) => R1 * k.t],
      ['R', 'tb', 'mt', (k) => R2 * k.l],
      ['R', 'mt', 'mw', (k) => R3 * (1 - k.m)],
      ['R', 'mw', 'gnd', (k) => R3 * k.m],
      ['R', 'in', 'sl', () => R4],
      ['C', 'sl', 'tb', () => C2],
      ['C', 'sl', 'mw', () => C3],
    ],
  };
}
export function potLin(v) { const k = v < 0 ? 0 : v > 10 ? 1 : v / 10; return 0.001 + 0.998 * k; }
export function potAud(v) { const k = v < 0 ? 0 : v > 10 ? 1 : v / 10; return 0.001 + 0.999 * (Math.exp(3.4 * k) - 1) / (Math.exp(3.4) - 1); }
export function waCoefs(type, f0, Q, G, sr, o) {
  const ny = sr / 2;
  if ((type === 'lowpass' && f0 >= ny) || (type === 'highpass' && f0 <= 0) || ((type === 'peaking' || type === 'lowshelf' || type === 'highshelf') && !G)) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 0; return o;
  }
  const w0 = 2 * Math.PI * Math.min(Math.max(f0, 0), ny) / sr, cs = Math.cos(w0), sn = Math.sin(w0), A = Math.pow(10, G / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass' || type === 'highpass') {
    const al = sn / (2 * Math.pow(10, Q / 20)), s = type === 'lowpass' ? 1 - cs : 1 + cs;
    b0 = s / 2; b1 = type === 'lowpass' ? s : -s; b2 = s / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else if (type === 'peaking') {
    const al = sn / (2 * Q);
    b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
  } else {
    const al = (sn / 2) * Math.SQRT2, q = 2 * Math.sqrt(A) * al;
    if (type === 'lowshelf') { b0 = A * (A + 1 - (A - 1) * cs + q); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - q); a0 = A + 1 + (A - 1) * cs + q; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - q; }
    else { b0 = A * (A + 1 + (A - 1) * cs + q); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - q); a0 = A + 1 - (A - 1) * cs + q; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - q; }
  }
  o[0] = b0 / a0; o[1] = b1 / a0; o[2] = b2 / a0; o[3] = a1 / a0; o[4] = a2 / a0;
  return o;
}

export const AMP_VOICED = String.raw`
${ampStack}
${tmbNet}
${potLin}
${potAud}
${waCoefs}
// a biquad (transposed direct form II) whose coefficients are set from waCoefs' array
function biquad() {
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  return {
    set(o) { b0 = o[0]; b1 = o[1]; b2 = o[2]; a1 = o[3]; a2 = o[4]; },
    tick(x) { const y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; },
    flush() { if (z1 < 1e-30 && z1 > -1e-30 && z2 < 1e-30 && z2 > -1e-30) z1 = z2 = 0; },
    reset() { z1 = z2 = 0; },
  };
}
// The stages at rate fs (the oversampled rate); the host's rate for what follows the power amp. set(P) once a block;
// tick(x) per oversampled sample; post(y) per host sample.
function voiced(V, fs, host) {
  const k1p = (fc) => 1 - Math.exp(-TAU * Math.min(fc, 0.45 * fs) / fs);
  const fl = (v) => (v < 1e-30 && v > -1e-30 ? 0 : v);
  // Half Stack's triode, and its first-order antiderivative anti-aliasing (each starts at rest at its bias)
  const tri = (u, n) => u / Math.sqrt(1 + u * u * (u >= 0 ? 1 : n));
  function adaa(n, b) {
    let u1 = b, F1 = b >= 0 ? Math.sqrt(1 + b * b) - 1 : (Math.sqrt(1 + n * b * b) - 1) / n;
    return (u) => {
      const F = u >= 0 ? Math.sqrt(1 + u * u) - 1 : (Math.sqrt(1 + n * u * u) - 1) / n, d = u - u1;
      const y = d > 1e-7 || d < -1e-7 ? (F - F1) / d : tri(0.5 * (u + u1), n);
      u1 = u; F1 = F;
      return y;
    };
  }
  // GAIN: the pot (glided per sample, 2 ms) and its bright cap (a first-order shelf, by the bilinear transform)
  let pot = 1, sPot = 1, bz = 0, bb0 = 1, bb1 = 0, ba1 = 0, first = true;
  const kS = 1 - Math.exp(-1 / (0.002 * fs));
  // the tone stack, third order (transposed direct form II), its coefficients set per block when a knob moved
  const solver = V.stack ? ampStack(tmbNet(V.stack)) : null, SB = new Float64Array(4), SA = new Float64Array(4);
  let t0 = 1, t1 = 0, t2 = 0, t3 = 0, ta1 = 0, ta2 = 0, ta3 = 0, z1 = 0, z2 = 0, z3 = 0, lb = NaN, lm = NaN, lt = NaN;
  const steps = [], flush = [];
  let inv = 1;
  for (const b of V.chain) {
    if (b[0] === 'tri') {
      const g = b[1], B = b[2], n = 1 / (b[3] * b[3]), s = adaa(n, B), T = tri(B, n), kc = k1p(b[4]), km = k1p(b[5]);
      let c = 0, m = 0;
      steps.push((x) => { const y = T - s(g * x + B); c += kc * (y - c); m += km * (y - c - m); return m; });
      flush.push(() => { c = fl(c); m = fl(m); });
      inv = -inv;
    } else if (b[0] === 'pot') steps.push((x) => { const y = bb0 * x + bz; bz = bb1 * x - ba1 * y; return y * sPot; });
    else if (b[0] === 'stack') steps.push((v) => { const z = t0 * v + z1; z1 = t1 * v - ta1 * z + z2; z2 = t2 * v - ta2 * z + z3; z3 = t3 * v - ta3 * z; return z; });
    else if (b[0] === 'gain') { const g = dbg(b[1]); steps.push((x) => x * g); }
  }
  const NS = steps.length;
  // the power amp: a DC block, then the drive into a symmetric soft clip whose headroom sag lowers
  const pwIn = dbg(V.pw), pwOut = 1 / pwIn, sagAmt = V.sag * 0.45 / 1.5, eA = 1 - Math.exp(-1 / (0.008 * fs)), eR = 1 - Math.exp(-1 / (0.18 * fs));
  const s4 = adaa(1, 0), OS = Math.round(fs / host), kDc = k1p(8), kOh = k1p(V.xf[0]), kOl = k1p(V.xf[1]);
  let env = 0, h = 1, ih = 1, hn = 0, dc = 0, oh = 0, ol = 0;
  // at the host's rate: depth and presence
  const co = new Float64Array(5), dep = biquad(), pres = biquad();
  let lastP = NaN;
  if (V.depth && V.depth[1]) dep.set(waCoefs('peaking', V.depth[0], 0.8, V.depth[1], host, co));
  return {
    set(P) {
      const g = clamp(P.gain, 0, 10), dB = V.pot[0] + (V.pot[1] - V.pot[0]) * g / 10;
      pot = dbg(dB);
      if (V.bright) {
        // the pot's track is R, its wiper a (the linear share below it that gives this attenuation): Ru = R (1 - a) above,
        // Rl = R a below, the cap C across Ru. H(s) = (Rl + s Ru Rl C) / (Rl + Ru + s Ru Rl C), its DC gain a carried by sPot
        const R = V.bright[1], C = V.bright[0] * 1e-12, a = clamp(pot, 1e-4, 0.9999), Ru = R * (1 - a), Rl = R * a, c = 2 * fs;
        const nb0 = Rl + c * Ru * Rl * C, nb1 = Rl - c * Ru * Rl * C, na0 = Rl + Ru + c * Ru * Rl * C, na1 = Rl + Ru - c * Ru * Rl * C;
        bb0 = nb0 / na0 / a; bb1 = nb1 / na0 / a; ba1 = na1 / na0;
      }
      if (first) { sPot = pot; first = false; }
      if (solver && (P.bass !== lb || P.mid !== lm || P.treble !== lt)) {
        lb = P.bass; lm = P.mid; lt = P.treble;
        solver.analog({ t: potLin(lt), m: potLin(lm), l: potAud(lb) }, SB, SA);
        // bilinear: s = c (1 - 1/z) / (1 + 1/z), c = 2 fs
        const c = 2 * fs, c2 = c * c, c3 = c2 * c, b0 = SB[0], b1 = SB[1], b2 = SB[2], b3 = SB[3], a1 = SA[1], a2 = SA[2], a3 = SA[3];
        const B0 = b0 + b1 * c + b2 * c2 + b3 * c3, B1 = 3 * b0 + b1 * c - b2 * c2 - 3 * b3 * c3, B2 = 3 * b0 - b1 * c - b2 * c2 + 3 * b3 * c3, B3 = b0 - b1 * c + b2 * c2 - b3 * c3;
        const A0 = 1 + a1 * c + a2 * c2 + a3 * c3, A1 = 3 + a1 * c - a2 * c2 - 3 * a3 * c3, A2 = 3 - a1 * c - a2 * c2 + 3 * a3 * c3, A3 = 1 - a1 * c + a2 * c2 - a3 * c3;
        t0 = B0 / A0; t1 = B1 / A0; t2 = B2 / A0; t3 = B3 / A0; ta1 = A1 / A0; ta2 = A2 / A0; ta3 = A3 / A0;
      }
      if (P.presence !== lastP) { lastP = P.presence; pres.set(waCoefs('highshelf', V.pres[0], 0, (clamp(P.presence, 0, 10) - 5) * V.pres[1], host, co)); }
      // (a long silence decays the state toward subnormals, which some CPUs crawl through)
      for (let i = 0; i < flush.length; i++) flush[i]();
      bz = fl(bz); dc = fl(dc); env = fl(env); oh = fl(oh); ol = fl(ol);
      if (fl(z1) === 0 && fl(z2) === 0 && fl(z3) === 0) z1 = z2 = z3 = 0;
      dep.flush(); pres.flush();
    },
    tick(x) {
      sPot += kS * (pot - sPot);
      let y = x;
      for (let i = 0; i < NS; i++) y = steps[i](y);
      dc += kDc * (y - dc);
      y = (y - dc) * pwIn;
      const a = y < 0 ? -y : y;
      env += (a > env ? eA : eR) * (a - env);
      if (--hn <= 0) { hn = OS; h = 1 - sagAmt * (env > 1.5 ? 1.5 : env); ih = 1 / h; }
      y = h * s4(y * ih) * pwOut;
      oh += kOh * (y - oh); ol += kOl * (y - oh - ol);
      return ol;
    },
    post(y) { return pres.tick(dep.tick(y)) * inv; },
  };
}
function makeVoiced(sr, dsp, V) {
  const OSF = V.os === 2 ? 2 : 4, os = OSF === 2 ? dsp.oversample2x() : dsp.oversample4x(), c = voiced(V, sr * OSF, sr), tick = (u) => c.tick(u);
  const hp = svf(sr).set(V.hp, 0.7071), tight = V.tight && V.tight[1] ? svf(sr).shelfLo(V.tight[0], 0.7071, V.tight[1]) : null;
  return {
    latency: Math.ceil(os.latency),
    set(P) { c.set(P); },
    tick(x) {
      hp.tick(x);
      let u = hp.hp;
      if (tight) u = tight.eq(u);
      if (u < 1e-30 && u > -1e-30) u = 0;
      return c.post(os.process(u, tick));
    },
  };
}
`;

// The cab, as the gear's amps had it (devices/guitar/gear/code.js plugAmp and plugCabNet), in the kernel:
//   ampCabWeights(spec, sr, cab)  what a cab's trim weighs it by: 480 points log-spaced from 40 Hz to 16 kHz, the amp's
//                  spectrum before its cab (spec: half-octave dB, the gear's PLUG_AMP_SPEC) through K-weighting, and the
//                  amp's own designed cab's energy over them (e0)
//   ampCabNet(V, T, P, sr, W, has)  what plays at the amp.* params P, as plugCabNet works it out, number for number:
//                  { kind: 'wire', cab } the amp's own designed cab and the mic it was voiced with (the straight wire;
//                  also a measured cab while the bank isn't here: has(i) false); { kind: 'ir', ir, trim } a measured
//                  cab (the bank's IR ir); { kind: 'net', cab, mics: [{ f: seven filters [type, Hz, Q, dB], taps: [[s,
//                  gain] x 4], delay (s), gain }], trim } a designed cab with its mics. key: what changes only by a
//                  crossfade (the cab, the mics' types, the second mic and its polarity); the rest (where the mics are,
//                  the blend) moves in place. T: the cabs (CAB_IDS' order: null for 'own', else { n, size, back, slap,
//                  lv, cab, ir }), the mics (MIC_IDS' order) and the two default mics (md, md2: { type, x, dist, ang,
//                  blend }); V: the amp's own cab (cab), its box ([n, size, back]), its IR trims (irE: 10 log10 of each
//                  IR's weighted energy, irLv: its nudge)
export function ampCabWeights(spec, sr, cab) {
  const N = 480, f = new Float64Array(N), w = new Float64Array(N), c1 = new Float64Array(N), s1 = new Float64Array(N), c2 = new Float64Array(N), s2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = 40 * Math.pow(400, i / (N - 1)), b = Math.max(0, Math.min(spec.length - 1, 2 * Math.log2(x / 40))), j = Math.min(spec.length - 2, Math.floor(b));
    f[i] = x;
    const g = Math.pow(10, (spec[j] + (spec[j + 1] - spec[j]) * (b - j)) / 10), k = (1 + 1.5 / (1 + Math.pow(1500 / x, 2))) / (1 + Math.pow(60 / x, 4));
    w[i] = g * k;
    const om = (2 * Math.PI * x) / sr;
    c1[i] = Math.cos(om); s1[i] = -Math.sin(om); c2[i] = Math.cos(2 * om); s2[i] = -Math.sin(2 * om);
  }
  const W = { N, f, w, c1, s1, c2, s2, e0: 0 };
  const o = new Float64Array(5), H = new Float64Array(N * 2);
  ampCabResp(cabFilters(cab), sr, W, o, H);
  let e0 = 0;
  for (let i = 0; i < N; i++) e0 += w[i] * (H[2 * i] * H[2 * i] + H[2 * i + 1] * H[2 * i + 1]);
  W.e0 = e0;
  return W;
}
// a designed cab's six filters, as the gear's plugAmp sets them
export function cabFilters(cb) {
  return [['highpass', cb[0], 0.7, 0], ['peaking', cb[1][0], cb[1][1], cb[1][2]], ['peaking', cb[2][0], cb[2][1], cb[2][2]], ['peaking', cb[3][0], cb[3][1], cb[3][2]],
    ['lowpass', cb[4][0], cb[4][1], 0], ['lowpass', cb[5], 0.6, 0]];
}
// the complex response of a chain of Web Audio biquads ([type, Hz, Q, dB]) at W's frequencies, into H (re, im pairs)
export function ampCabResp(list, sr, W, o, H) {
  for (let i = 0; i < W.N; i++) { H[2 * i] = 1; H[2 * i + 1] = 0; }
  for (const q of list) {
    waCoefs(q[0], q[1], q[2], q[3], sr, o);
    if (o[0] === 1 && !o[1] && !o[2] && !o[3] && !o[4]) continue;
    const b0 = o[0], b1 = o[1], b2 = o[2], a1 = o[3], a2 = o[4];
    for (let i = 0; i < W.N; i++) {
      const c1 = W.c1[i], s1 = W.s1[i], c2 = W.c2[i], s2 = W.s2[i];
      const nr = b0 + b1 * c1 + b2 * c2, ni = b1 * s1 + b2 * s2, dr = 1 + a1 * c1 + a2 * c2, di = a1 * s1 + a2 * s2, dd = dr * dr + di * di;
      const hr = (nr * dr + ni * di) / dd, hi = (ni * dr - nr * di) / dd, r = H[2 * i], m = H[2 * i + 1];
      H[2 * i] = r * hr - m * hi; H[2 * i + 1] = r * hi + m * hr;
    }
  }
  return H;
}
export function ampCabNet(V, T, P, sr, W, has) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d), r3 = (v) => Math.round(v * 1000) / 1000;
  const ci = Math.round(P.cab), C = ci >= 0 && ci < T.cabs.length ? T.cabs[ci] : null;
  if (C && C.ir != null) {
    if (has(C.ir)) return { kind: 'ir', key: 'ir' + C.ir, ir: C.ir, trim: Math.max(-12, Math.min(12, 10 * Math.log10(W.e0) - V.irE[C.ir] + (V.irLv || 0))) };
    return { kind: 'wire', key: 'wire', cab: V.cab, trim: 0 };
  }
  const mic = (t, x, dist, ang, D) => ({ type: t >= 0 && t < T.mics.length ? t : D.type, x: r3(num(x, -1.35, 1.35, D.x)), dist: r3(num(dist, 0.5, 24, D.dist)), ang: r3(num(ang, 0, 60, D.ang)) });
  const d1 = mic(Math.round(P.mic), P.micpos, P.micdist, P.micang, T.md), t2 = Math.round(P.mic2);
  const d2 = t2 > 0 ? mic(t2 - 1, P.mic2pos, P.mic2dist, P.mic2ang, T.md2) : null;
  if (!C && !d2 && d1.type === T.md.type && d1.x === T.md.x && d1.dist === T.md.dist && d1.ang === T.md.ang) return { kind: 'wire', key: 'wire', cab: V.cab, trim: 0 };
  const box = C ? C : { n: V.box[0], size: V.box[1], back: V.box[2], lv: 0 }, cab = C ? C.cab : V.cab;
  const one = (m) => {
    const M = T.mics[m.type], r = Math.min(1.35, Math.abs(m.x)), a = Math.min(60, m.ang) / 45;
    // on the cone: brightest on the dustcap, darker and fuller toward the edge (off the cone: dark and thin)
    let shelf = r < 0.3 ? (5 * (0.3 - r)) / 0.3 : -(r - 0.3) * 8, pres = r < 0.3 ? (3 * (0.3 - r)) / 0.3 : -(r - 0.3) * 3.5;
    let body = Math.max(0, Math.min(1, r) - 0.3) * 3.5, lo = r > 1 ? -(r - 1) * 6 : 0;
    // off axis: darker; far back: the speaker's beam narrows onto the axis less (a little darker), and less proximity
    shelf -= a * 3.5; pres -= a * 1.5;
    const air = -a * 4, d = m.dist, prox = (x) => 11 / (1 + x / 1.2);
    lo += M.prox * (prox(d) - prox(1));
    if (d > 1) { shelf -= (1.2 * Math.log2(d)) / Math.log2(24); lo -= (4.5 * Math.log2(d)) / Math.log2(24); }
    const fs = 2500 * Math.sqrt(12 / box.size);
    const f = [['lowshelf', 200, 0, lo + M.lo], ['peaking', M.body[0], M.body[1], body + M.body[2]], ['peaking', M.pres[0], M.pres[1], pres + M.pres[2]],
      ['highshelf', fs, 0, shelf], ['highshelf', 9000, 0, air + M.air], ['highpass', M.hp ? M.hp[0] : 0, M.hp ? M.hp[1] : 0, 0], ['lowpass', M.lp ? M.lp[0] : sr / 2, M.lp ? M.lp[1] : 0, 0]];
    // the room: the floor bounce, a far wall 2.6 m off, an open back's rear wave off the wall behind it, a stadium's slap
    const D = d * 0.0254 + 0.01, path = (x) => Math.sqrt(D * D + x * x);
    const taps = [[(path(0.8) - D) / 343, (0.3 * M.room * D) / path(0.8)], [(path(2.6) - D) / 343, (0.3 * M.room * D) / path(2.6)],
      [box.back === 'open' ? 1.3 / 343 : 0, box.back === 'open' ? (-0.5 * M.room * D) / (D + 1.3) : 0], box.slap ? [box.slap[0] / 1000, box.slap[1]] : [0, 0]];
    return { f, taps, D, delay: 0, gain: 1 };
  };
  const m1 = one(d1), mics = [m1];
  let key = 'net' + ci + ':' + d1.type;
  if (d2) {
    const m2 = one(d2), b = num(P.blend, 0, 10, T.md2.blend) / 10, lag = (m2.D - m1.D) / 343, flip = Math.round(P.flip) === 1;
    m1.gain = 1 - b; m2.gain = (flip ? -1 : 1) * b;
    m1.delay = Math.max(0, -lag); m2.delay = Math.max(0, lag);
    mics.push(m2);
    key += ':' + d2.type + (flip ? 'f' : '');
  }
  // the trim: the amp's own cab against this, weighted by what the amp puts into it
  const o = new Float64Array(5), Hc = ampCabResp(cabFilters(cab), sr, W, o, new Float64Array(W.N * 2)), Hm = new Float64Array(W.N * 2);
  const re = new Float64Array(W.N), im = new Float64Array(W.N);
  for (const m of mics) {
    ampCabResp(m.f, sr, W, o, Hm);
    for (let i = 0; i < W.N; i++) {
      const f = W.f[i];
      let mr = Hm[2 * i], mi = Hm[2 * i + 1], tr = 1, ti = 0;
      for (const [t, g] of m.taps) if (g) { tr += g * Math.cos(-2 * Math.PI * f * t); ti += g * Math.sin(-2 * Math.PI * f * t); }
      const xr = mr * tr - mi * ti, xi = mr * ti + mi * tr;
      mr = xr; mi = xi;
      const dr = Math.cos(-2 * Math.PI * f * m.delay), di = Math.sin(-2 * Math.PI * f * m.delay);
      re[i] += m.gain * (mr * dr - mi * di); im[i] += m.gain * (mr * di + mi * dr);
    }
  }
  let e1 = 0;
  for (let i = 0; i < W.N; i++) e1 += W.w[i] * (Hc[2 * i] * Hc[2 * i] + Hc[2 * i + 1] * Hc[2 * i + 1]) * (re[i] * re[i] + im[i] * im[i]);
  const trim = Math.max(-12, Math.min(12, 10 * Math.log10(W.e0 / Math.max(e1, 1e-12)) + (box.lv || 0)));
  return { kind: 'net', key, cab, mics, trim };
}

// AMP_CAB (kernel text; after AMP_VOICED) defines makeAmpCab(sr, dsp, bank, V, T) -> { set(P), process(x, n) (in place) }:
// the measured IRs through dsp.convolver (direct: 128, so no latency), or a designed cab's six filters (and its mics:
// each an align delay, seven filters and four room taps, delays read linearly as a DelayNode reads them). A change of
// what plays (ampCabNet's key) crossfades over 30 ms, linearly (two cabs on one signal are nearly in phase); the rest
// moves in place, a trim or a mic's level gliding (20 ms). Without the bank a measured cab plays the amp's own designed
// cab (the wire).
export const AMP_CAB = String.raw`
${cabSin}
${cabResample}
${cabFilters}
${ampCabWeights}
${ampCabResp}
${ampCabNet}
function ampDesigned(sr) {
  const co = new Float64Array(5), cabF = [biquad(), biquad(), biquad(), biquad(), biquad(), biquad()], kG = 1 - Math.exp(-1 / (0.02 * sr));
  const AL = Math.ceil(0.011 * sr) + 2, TL = Math.ceil(0.25 * sr) + 2;
  const mk = () => ({ f: [biquad(), biquad(), biquad(), biquad(), biquad(), biquad(), biquad()], ab: new Float64Array(AL), tb: new Float64Array(TL), ap: 0, tp: 0,
    delay: 0, tt: new Float64Array(4), tg: new Float64Array(4), gain: 0, g: 0, on: false });
  const mics = [mk(), mk()];
  let wire = true, trim = 1, sTrim = 1;
  // a delay line read d samples back (linearly between samples)
  const read = (b, p, d, L) => { const i = Math.floor(d), fr = d - i; let a = p - i; if (a < 0) a += L; let c = a - 1; if (c < 0) c += L; return b[a] + (b[c] - b[a]) * fr; };
  return {
    load(N, snap) {
      const cf = cabFilters(N.cab);
      for (let i = 0; i < 6; i++) cabF[i].set(waCoefs(cf[i][0], cf[i][1], cf[i][2], cf[i][3], sr, co));
      wire = N.kind !== 'net';
      trim = dbg(N.trim);
      for (let m = 0; m < 2; m++) {
        const M = mics[m], X = wire ? null : N.mics[m];
        M.on = !!X; M.gain = X ? X.gain : 0;
        if (snap) M.g = M.gain;
        if (!X) continue;
        for (let i = 0; i < 7; i++) M.f[i].set(waCoefs(X.f[i][0], X.f[i][1], X.f[i][2], X.f[i][3], sr, co));
        M.delay = X.delay * sr;
        for (let i = 0; i < 4; i++) { M.tt[i] = X.taps[i][0] * sr; M.tg[i] = X.taps[i][1]; }
      }
      if (snap) sTrim = trim;
    },
    reset() {
      for (const f of cabF) f.reset();
      for (const M of mics) { for (const f of M.f) f.reset(); M.ab.fill(0); M.tb.fill(0); M.ap = 0; M.tp = 0; }
    },
    flush() { for (const f of cabF) f.flush(); for (const M of mics) for (const f of M.f) f.flush(); },
    process(x, n) {
      for (let k = 0; k < n; k++) {
        let c = x[k];
        for (let i = 0; i < 6; i++) c = cabF[i].tick(c);
        sTrim += kG * (trim - sTrim);
        if (wire) { x[k] = c * sTrim; continue; }
        let y = 0;
        for (let m = 0; m < 2; m++) {
          const M = mics[m];
          M.g += kG * (M.gain - M.g);
          if (!M.on && M.g < 1e-9 && M.g > -1e-9) continue;
          if (++M.ap === AL) M.ap = 0;
          M.ab[M.ap] = c;
          let v = M.delay > 0 ? read(M.ab, M.ap, M.delay, AL) : c;
          for (let i = 0; i < 7; i++) v = M.f[i].tick(v);
          if (++M.tp === TL) M.tp = 0;
          M.tb[M.tp] = v;
          let s = v;
          for (let i = 0; i < 4; i++) if (M.tg[i]) s += M.tg[i] * (M.tt[i] > 0 ? read(M.tb, M.tp, M.tt[i], TL) : v);
          y += M.g * s;
        }
        x[k] = y * sTrim;
      }
    },
  };
}
function makeAmpCab(sr, dsp, bank, V, T) {
  const W = ampCabWeights(V.spec, sr, V.cab), CAB_N = 6;
  // the bank's taps (each x / 8388608 * gain), at another host rate resampled the first time each is chosen
  const src = [], taps = [], rate = bank && bank.samples && bank.sr > 0 ? bank.sr : 0;
  let cap = 0;
  if (rate) {
    for (let i = 0; i < CAB_N; i++) {
      const s = bank.samples[i];
      src.push(s || null); taps.push(null);
      if (!s) continue;
      const c = s.ch[0], g = (+s.gain || 1) / 8388608;
      cap = Math.max(cap, Math.ceil(c.length * Math.max(1, sr / rate)) + 1);
      if (rate === sr) { const h = new Float64Array(c.length); for (let k = 0; k < h.length; k++) h[k] = c[k] * g; taps[i] = h; }
    }
  }
  const has = (i) => i >= 0 && i < CAB_N && !!src[i];
  const tapsOf = (i) => taps[i] || (taps[i] = cabResample(src[i].ch[0], (+src[i].gain || 1) / 8388608, rate, sr));
  const conv = cap ? [dsp.convolver(new Float64Array(cap), { direct: 128 }), dsp.convolver(new Float64Array(cap), { direct: 128 })] : null;
  const des = [ampDesigned(sr), ampDesigned(sr)], irG = new Float64Array(2), irS = new Float64Array(2), kG = 1 - Math.exp(-1 / (0.02 * sr));
  // what plays: [kind (0 designed, 1 IR), engine 0 or 1, key], and the one fading out
  let cur = null, prev = null, fade = 0, last = '';
  const FADE = Math.round(0.03 * sr);
  let A = new Float64Array(128), B = new Float64Array(128);
  const run = (s, x, n) => {
    if (s[0] === 0) { des[s[1]].process(x, n); return; }
    const j = s[1];
    conv[j].process(x, x, null, n);
    for (let k = 0; k < n; k++) { irS[j] += kG * (irG[j] - irS[j]); x[k] *= irS[j]; }
  };
  return {
    set(P) {
      const sig = P.cab + ',' + P.mic + ',' + P.micpos + ',' + P.micdist + ',' + P.micang + ',' + P.mic2 + ',' + P.mic2pos + ',' + P.mic2dist + ',' + P.mic2ang + ',' + P.blend + ',' + P.flip;
      if (sig === last) { for (const d of des) d.flush(); return; }
      last = sig;
      const N = ampCabNet(V, T, P, sr, W, has), kind = N.kind === 'ir' ? 1 : 0;
      if (cur && cur[2] === N.key) {
        if (kind === 0) des[cur[1]].load(N, false); else irG[cur[1]] = dbg(N.trim);
        return;
      }
      // a new one: on the engine the one playing isn't using, from silence
      const j = cur && cur[0] === kind ? 1 - cur[1] : prev && prev[0] === kind && fade > 0 ? 1 - prev[1] : 0;
      if (kind === 0) { des[j].reset(); des[j].load(N, true); }
      else { conv[j].reset(); conv[j].set(tapsOf(N.ir)); irG[j] = irS[j] = dbg(N.trim); }
      if (!cur) { cur = [kind, j, N.key]; return; }
      prev = cur; cur = [kind, j, N.key]; fade = FADE;
    },
    process(x, n) {
      if (fade <= 0) { run(cur, x, n); return; }
      if (A.length < n) { A = new Float64Array(n); B = new Float64Array(n); }
      for (let i = 0; i < n; i++) { A[i] = x[i]; B[i] = x[i]; }
      run(cur, A, n); run(prev, B, n);
      for (let i = 0; i < n; i++) {
        const g = fade > 0 ? fade / FADE : 0;
        if (fade > 0) fade--;
        x[i] = A[i] + (B[i] - A[i]) * g;
      }
    },
  };
}
`;
