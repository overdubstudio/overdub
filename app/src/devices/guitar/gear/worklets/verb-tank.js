// The 'verb-tank' worklet (pedals/00-classic.js, the reverbs' tank in ../code.js: Deep Trench, Lobster Plate, Kraken Hall, Halo Jelly, Frostbite Crab): the processor source the code builds, byte for byte below this line; change both together (tools/guitar-test.js)
// The 'verb-tank' worklet (pedals/00-classic.js, the reverbs' tank in ../code.js: Deep Trench, Lobster Plate, Kraken Hall, Halo Jelly, Frostbite Crab): the processor source the code builds, byte for byte below this line; change both together (tools/guitar-test.js)
class VerbTank extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const P = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [P('decay', 2, 0.05, 40), P('hf', 0.8, 0.05, 1), P('shim', 0, 0, 2), P('ratio', 2, 0.5, 4), P('space', 0, 0, 1)];
  }
  constructor(o) {
    super();
    const q = (o && o.processorOptions) || {}, sr = sampleRate, hall = q.algo === 'hall';
    let s = (q.seed >>> 0) || 1;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    // The tank: N sections of [modulated allpass, delay, allpass, delay], each feeding the next round a loop. A plate is
    // Dattorro's figure eight (two sections, his lengths at 29761 Hz); a hall is a ring of four, two of them his.
    const SEC = hall ? [[672, 4453, 1800, 3720], [908, 4217, 2656, 3163], [764, 4021, 2103, 3449], [1021, 4639, 1567, 2851]] : [[672, 4453, 1800, 3720], [908, 4217, 2656, 3163]];
    const k = (sr / 29761) * (q.scale || 1), N = SEC.length, ex = ((q.mod == null ? 0.5 : q.mod) * sr) / 1000;
    // the input diffusers: Dattorro's four and two more (longer in a hall: its slower build)
    const DIF = hall ? [142, 107, 379, 277, 811, 1123] : [142, 107, 379, 277, 233, 311], DG = [0.7, 0.7, 0.65, 0.65, 0.6, 0.6];
    const pre = Math.max(1, Math.round((q.pre || 0) * sr)), erMax = Math.round(0.16 * sr), EL = [Math.round(0.0071 * sr), Math.round(0.0097 * sr)];
    const len = (i, j) => Math.max(4, Math.round(SEC[i][j] * k));
    // every line in one buffer, each a power of two long: the pre-delay (the early reflections tap it), the diffusers,
    // the sections' lines, the two early allpasses
    const lens = [pre + erMax + 4];
    for (const d of DIF) lens.push(Math.max(1, Math.round(d * k)));
    for (let i = 0; i < N; i++) for (let j = 0; j < 4; j++) lens.push(len(i, j) + (j === 0 ? Math.ceil(2 * ex) + 4 : 0));
    lens.push(EL[0], EL[1]);
    const off = new Int32Array(lens.length), msk = new Int32Array(lens.length), at = (i, j) => 1 + DIF.length + i * 4 + j;
    let tot = 0;
    lens.forEach((L, i) => { const n = 1 << Math.ceil(Math.log2(L + 1)); off[i] = tot; msk[i] = n - 1; tot += n; });
    this.B = new Float32Array(tot); this.w = 0; this.pre = pre; this.ex = ex; this.N = N; this.nd = DIF.length;
    this.pO = off[0]; this.pM = msk[0];
    this.dO = Int32Array.from(DIF, (_, i) => off[1 + i]); this.dM = Int32Array.from(DIF, (_, i) => msk[1 + i]);
    this.dL = Int32Array.from(DIF, (d) => Math.max(1, Math.round(d * k))); this.dG = Float64Array.from(DIF, (_, i) => DG[i]);
    this.so = new Int32Array(N * 4); this.sm = new Int32Array(N * 4); this.sl = new Int32Array(N * 4);
    for (let i = 0; i < N; i++) for (let j = 0; j < 4; j++) { this.so[i * 4 + j] = off[at(i, j)]; this.sm[i * 4 + j] = msk[at(i, j)]; this.sl[i * 4 + j] = len(i, j); }
    const e0 = lens.length - 2;
    this.eg = q.early || 0; this.eD = Int32Array.from(EL); this.eO = Int32Array.from([off[e0], off[e0 + 1]]); this.eM = Int32Array.from([msk[e0], msk[e0 + 1]]);
    // the output taps, Dattorro's (as fractions of their lines: a hall's four sections are read the same way, the odd
    // ones like his right half): [line, where, sign] for the left from the odd sections and less the even, and the right
    // the other way about. Offset, mask, delay and gain each.
    const LP = [[1, 0.0631, 1], [1, 0.7052, 1], [2, 0.7203, -1], [3, 0.6311, 1]], LN = [[1, 0.4469, -1], [2, 0.1039, -1], [3, 0.2866, -1]];
    const RP = [[1, 0.0793, 1], [1, 0.8145, 1], [2, 0.6822, -1], [3, 0.7185, 1]], RN = [[1, 0.5006, -1], [2, 0.1261, -1], [3, 0.0383, -1]];
    const taps = (pos, neg, odd) => {
      const t = [];
      for (let i = 0; i < N; i++) for (const [j, f, sg] of (i & 1) === odd ? pos : neg) t.push([off[at(i, j)], msk[at(i, j)], Math.max(1, Math.round(f * len(i, j))), (sg * 0.6) / Math.sqrt(N / 2)]);
      return t;
    };
    const T = taps(LP, LN, 1).concat(taps(RP, RN, 0));
    this.nL = T.length / 2;
    this.tO = Int32Array.from(T, (t) => t[0]); this.tM = Int32Array.from(T, (t) => t[1]); this.tD = Int32Array.from(T, (t) => t[2]); this.tG0 = Float64Array.from(T, (t) => t[3]);
    // what DECAY sets, in one array (ramped as one): each line's loss, each tap's, each section's damping coefficient
    const nK = N * 5 + T.length;
    this.K = new Float64Array(nK); this.Kt = new Float64Array(nK); this.Ks = new Float64Array(nK); this.T = -1; this.hf = -1;
    this.lg = this.K.subarray(0, N * 4); this.tG = this.K.subarray(N * 4, N * 4 + T.length); this.da = this.K.subarray(N * 4 + T.length);
    // the modulation: each section's first allpass swings through 0..2ex samples longer, two slow sines at seeded
    // rates and phases (phasors turned a block at a time; the delay moves in a straight line across the block)
    this.mc = new Float64Array(N * 2); this.ms = new Float64Array(N * 2); this.rc = new Float64Array(N * 2); this.rs = new Float64Array(N * 2); this.md = new Float64Array(N);
    const rate = q.rate || 0.8;
    for (let i = 0; i < N * 2; i++) {
      const ph = rnd() * 6.283185307, w = (6.283185307 * rate * (i & 1 ? 0.37 + 0.2 * rnd() : 0.8 + 0.4 * rnd()) * 128) / sr;
      this.mc[i] = Math.cos(ph); this.ms[i] = Math.sin(ph); this.rc[i] = Math.cos(w); this.rs[i] = Math.sin(w);
    }
    for (let i = 0; i < N; i++) this.md[i] = ex * (1 + 0.7 * this.ms[i * 2] + 0.3 * this.ms[i * 2 + 1]);
    this.lp = new Float64Array(N); this.fb = new Float64Array(N);
    this.inj = Float64Array.from(SEC, (_, i) => (hall && i & 1 ? 0 : 1)); // (a plate feeds both halves, a hall every other section)
    this.bw = q.bw || 0; this.bz = 0; this.out = q.out == null ? 1 : q.out;
    // early reflections: ten taps off the pre-delay, alternating sides, for each SPACE (0 and 1), crossfaded
    this.er = null;
    if (q.er) {
      const er = new Float64Array(60);
      for (let sp = 0; sp < 2; sp++) for (let e = 0; e < 10; e++) {
        const t = 0.006 + (e + 0.5 + (rnd() * 2 - 1) * 0.4) * (sp ? 0.012 : 0.0075), g = q.er * Math.exp(-e * 0.22) * (rnd() < 0.5 ? -1 : 1), b = sp * 30 + e * 3;
        er[b] = pre + Math.min(erMax, Math.round(t * sr)); er[b + 1] = e & 1 ? 0.4 * g : g; er[b + 2] = e & 1 ? g : 0.4 * g;
      }
      this.er = er;
    }
    // the shimmer: the tank's sum through a two-tap pitch shifter (taps half a 70 ms window apart, each under a
    // parabolic window), 400 Hz up and 7 kHz down, softly limited, and back into the tank's input
    this.sh = q.shimmer ? new Float32Array(8192) : null; this.sw = 0; this.sph = 0; this.SW = Math.round(0.07 * sr);
    this.hp = 0; this.l1 = 0; this.l2 = 0; this.shOut = 0;
    this.hpc = 1 - Math.exp((-6.283185307 * 400) / sr); this.lpc = 1 - Math.exp((-6.283185307 * 7000) / sr);
    this.sp = -1; this.sg = 0; this.quiet = 0; this.idle = true;
  }
  process(ins, outs, p) {
    const oL = outs[0][0], oR = outs[0][1] || outs[0][0], x = ins[0] && ins[0][0], n = oL.length;
    let inPk = 0;
    if (x) for (let i = 0; i < n; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > inPk) inPk = v; }
    if (this.idle) { if (inPk < 1e-9) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; } this.idle = false; this.quiet = 0; }
    const N = this.N, B = this.B, nd = this.nd, dO = this.dO, dM = this.dM, dL = this.dL, dG = this.dG, pO = this.pO, pM = this.pM, pre = this.pre;
    const so = this.so, sm = this.sm, sl = this.sl, md = this.md, lp = this.lp, fb = this.fb, inj = this.inj, ex = this.ex;
    const lg = this.lg, dA = this.da, tO = this.tO, tM = this.tM, tD = this.tD, tG = this.tG, nL = this.nL, nT = nL * 2, er = this.er, sh = this.sh, eg = this.eg, eO = this.eO, eM = this.eM, eD = this.eD;
    // DECAY is a T60 in seconds: every line takes the loss of its own length (a signal is 60 dB down after T60 of
    // lines, whichever way it went round), and each tap the loss of how far along its line it reads, so the tail falls
    // from the first echo however short it is against the tank. The highs: each section's damping one-pole (Jot's)
    // brings the loss at Nyquist to 60 dB in hf * T60. A block that DECAY moves in ramps them all, sample by sample, and
    // a step (a preset, a lane) glides there over about 20 ms, in its logarithm, a block at a time.
    const Tw = p.decay[0], hw = p.hf[0], K = this.K, Kt = this.Kt, Ks = this.Ks, nK = K.length;
    let T = this.T < 0 ? Tw : this.T * Math.pow(Tw / this.T, 0.15), hf = this.hf < 0 ? hw : this.hf + (hw - this.hf) * 0.15, ramp = false;
    if (Math.abs(T / Tw - 1) < 1e-3) T = Tw;
    if (Math.abs(hf - hw) < 1e-3) hf = hw;
    if (T !== this.T || hf !== this.hf) {
      const c = -6.907755279 / (T * sampleRate), tG0 = this.tG0;
      for (let i = 0; i < N * 4; i++) Kt[i] = Math.exp(c * (sl[i] + (i & 3 ? 0 : ex)));
      for (let t = 0; t < nT; t++) Kt[N * 4 + t] = tG0[t] * Math.exp(c * tD[t]);
      for (let s = 0; s < N; s++) { const qn = Math.exp(c * (sl[s * 4] + ex + sl[s * 4 + 1] + sl[s * 4 + 2] + sl[s * 4 + 3]) * (1 / hf - 1)); Kt[N * 4 + nT + s] = 1 - (1 - qn) / (1 + qn); }
      if (this.T < 0) K.set(Kt);
      else { for (let j = 0; j < nK; j++) Ks[j] = (Kt[j] - K[j]) / n; ramp = true; }
      this.T = T; this.hf = hf;
    }
    if (this.sp < 0) { this.sp = p.space[0]; this.sg = p.shim[0]; }
    const sp1 = this.sp + (p.space[0] - this.sp) * 0.1, sg1 = p.shim[0], spS = (sp1 - this.sp) / n, sgS = (sg1 - this.sg) / n;
    let sp = this.sp, sg = this.sg;
    const SW = this.SW, step = (1 - p.ratio[0]) / SW, bwc = 1 - this.bw, hpc = this.hpc, lpc = this.lpc, out = this.out;
    const mc = this.mc, ms = this.ms, rc = this.rc, rs = this.rs, mdS = this.mdS || (this.mdS = new Float64Array(N));
    for (let i = 0; i < N * 2; i++) { const c = mc[i], si = ms[i], m = 1 / Math.sqrt(c * c + si * si); mc[i] = (c * rc[i] - si * rs[i]) * m; ms[i] = (si * rc[i] + c * rs[i]) * m; }
    for (let s = 0; s < N; s++) mdS[s] = (ex * (1 + 0.7 * ms[s * 2] + 0.3 * ms[s * 2 + 1]) - md[s]) / n;
    let w = this.w, bz = this.bz, sph = this.sph, sw = this.sw, hp = this.hp, l1 = this.l1, l2 = this.l2, shOut = this.shOut, outPk = 0;
    for (let i = 0; i < n; i++) {
      sp += spS; sg += sgS;
      if (ramp) for (let j = 0; j < nK; j++) K[j] += Ks[j];
      // the pre-delay, the input's bandwidth (a one-pole), the diffusers
      B[pO + (w & pM)] = x ? x[i] : 0;
      let d = B[pO + ((w - pre) & pM)] + shOut;
      bz += bwc * (d - bz); d = bz;
      for (let j = 0; j < nd; j++) {
        const o = dO[j], m = dM[j], z = B[o + ((w - dL[j]) & m)], v = d - dG[j] * z;
        B[o + (w & m)] = v; d = z + dG[j] * v;
      }
      // early: the diffused input itself, through a short allpass of its own on each side
      let yl = 0, yr = 0;
      if (eg) {
        let o = eO[0], m = eM[0], z = B[o + ((w - eD[0]) & m)], v = d - 0.6 * z;
        B[o + (w & m)] = v; yl = eg * (z + 0.6 * v);
        o = eO[1]; m = eM[1]; z = B[o + ((w - eD[1]) & m)]; v = d - 0.6 * z;
        B[o + (w & m)] = v; yr = eg * (z + 0.6 * v);
      }
      // the tank: each section takes the diffused input (if it's one that does) and the section before's output
      for (let s = 0; s < N; s++) { const h = s * 4 + 3; fb[s] = lg[h] * B[so[h] + ((w - sl[h]) & sm[h])]; }
      for (let s = 0; s < N; s++) {
        const h = s * 4;
        // the modulated allpass (Dattorro's decay diffusion 1, -0.7), read between samples (cubic: Catmull-Rom)
        const r = sl[h] + (md[s] += mdS[s]), ri = r | 0, f = r - ri, o0 = so[h], k0 = sm[h], b0 = w - ri;
        const y0 = B[o0 + ((b0 + 1) & k0)], y1 = B[o0 + (b0 & k0)], y2 = B[o0 + ((b0 - 1) & k0)], y3 = B[o0 + ((b0 - 2) & k0)];
        const z0 = lg[h] * (y1 + f * (0.5 * (y2 - y0) + f * (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3 + f * (1.5 * (y1 - y2) + 0.5 * (y3 - y0)))));
        let v = inj[s] * d + fb[s === 0 ? N - 1 : s - 1] + 0.7 * z0;
        B[o0 + (w & k0)] = v;
        // its delay, the damping, the decay
        const o1 = so[h + 1], k1 = sm[h + 1];
        B[o1 + (w & k1)] = z0 - 0.7 * v;
        const ls = lp[s] + dA[s] * (lg[h + 1] * B[o1 + ((w - sl[h + 1]) & k1)] - lp[s]);
        lp[s] = ls;
        // the second allpass (decay diffusion 2, 0.5), into the delay that feeds the next section
        const o2 = so[h + 2], k2 = sm[h + 2], z2 = lg[h + 2] * B[o2 + ((w - sl[h + 2]) & k2)];
        v = ls - 0.5 * z2;
        B[o2 + (w & k2)] = v;
        B[so[h + 3] + (w & sm[h + 3])] = z2 + 0.5 * v;
      }
      for (let t = 0; t < nL; t++) yl += tG[t] * B[tO[t] + ((w - tD[t]) & tM[t])];
      for (let t = nL; t < nT; t++) yr += tG[t] * B[tO[t] + ((w - tD[t]) & tM[t])];
      if (er) {
        // (one set, or both while SPACE crossfades)
        const s0 = 1 - sp, e0 = sp > 0.9999 ? 30 : 0, e1 = sp < 1e-4 ? 30 : 60;
        for (let e = e0; e < e1; e += 3) {
          const v = B[pO + ((w - er[e]) & pM)] * (e < 30 ? s0 : sp);
          yl += v * er[e + 1]; yr += v * er[e + 2];
        }
      }
      // the shimmer: (L + R) / 2 into the shifter; its taps read at ratio times speed, each faded in and out as it jumps
      if (sh) {
        sh[sw] = 0.5 * (yl + yr);
        sph += step; sph -= Math.floor(sph);
        const q2 = sph + 0.5 - Math.floor(sph + 0.5);
        const r1 = sw - 2 - sph * SW, i1 = Math.floor(r1), f1 = r1 - i1, x1 = sh[i1 & 8191], x2 = sh[(i1 + 1) & 8191];
        const r2 = sw - 2 - q2 * SW, i2 = Math.floor(r2), f2 = r2 - i2, x3 = sh[i2 & 8191], x4 = sh[(i2 + 1) & 8191];
        let z = (x1 + (x2 - x1) * f1) * sph * (1 - sph) * 4 + (x3 + (x4 - x3) * f2) * q2 * (1 - q2) * 4;
        hp += hpc * (z - hp); z -= hp; // (400 Hz up: z less its low-pass)
        l1 += lpc * (z - l1); l2 += lpc * (l1 - l2); // (7 kHz down, twice)
        z = l2 * sg;
        shOut = z > 1.5 ? 1 : z < -1.5 ? -1 : z - 0.148148148 * z * z * z; // (a cubic soft limit: flat at ±1)
        sw = (sw + 1) & 8191;
      }
      yl *= out; yr *= out;
      oL[i] = yl; oR[i] = yr;
      const pk = (yl < 0 ? -yl : yl) + (yr < 0 ? -yr : yr);
      if (pk > outPk) outPk = pk;
      w = (w + 1) & 0x3fffffff;
    }
    if (ramp) K.set(Kt);
    this.sp = sp1; this.sg = sg1;
    this.w = w; this.bz = bz; this.sph = sph; this.sw = sw; this.hp = hp; this.l1 = l1; this.l2 = l2; this.shOut = shOut;
    // idle: no input, and the tail under -120 dB for a quarter of a second: cleared, and silent at no cost till played
    if (inPk < 1e-9 && outPk < 1e-6) {
      if (++this.quiet * n > 0.25 * sampleRate) { this.B.fill(0); if (sh) sh.fill(0); lp.fill(0); this.bz = this.hp = this.l1 = this.l2 = this.shOut = 0; this.idle = true; }
    } else this.quiet = 0;
    return true;
  }
}
registerProcessor('verb-tank', VerbTank);