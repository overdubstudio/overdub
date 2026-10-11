// The tempogram (spec 0014 R13): the onset envelope's autocorrelation in 8 s windows every 1 s, over periods from
// 50 to 220 BPM, weighed by a log-Gaussian prior centred on 120 BPM (an octave either side is one spread). The beat
// period through the song is a Viterbi path over the windows (a step in tempo costs by its size in octaves, so the
// path follows a drifting player but doesn't jump an octave). A window whose autocorrelation at the path's period is
// weak (salience under FREE_SALIENCE) is free time: no pulse to follow there.
//
//   tempogram(env, fps) -> { windows: [{ t (s, the window's centre), lag (frames, refined), bpm, salience }], lagLo,
//                            lagHi, strength(lagFrames) -> the song's prior-free autocorrelation at that period,
//                            global: { lag, bpm }, octave: { half, double, triplet } (each the song's autocorrelation
//                            at that period against the found one's) }
// Pure, Float64.

export const WIN_S = 8, HOP_S = 1, BPM_LO = 50, BPM_HI = 220, PRIOR_BPM = 120, PRIOR_OCT = 1;
export const FREE_SALIENCE = 0.12;

export function tempogram(env, fps) {
  const n = env.length, W = Math.round(WIN_S * fps), H = Math.round(HOP_S * fps);
  const lagLo = Math.floor((60 * fps) / BPM_HI), lagHi = Math.ceil((60 * fps) / BPM_LO);
  const L = lagHi - lagLo + 1;
  const prior = new Float64Array(L);
  for (let j = 0; j < L; j++) { const o = Math.log2((60 * fps) / (lagLo + j) / PRIOR_BPM) / PRIOR_OCT; prior[j] = Math.exp(-0.5 * o * o); }
  const starts = [];
  if (n <= W) starts.push(0);
  else for (let s = 0; s + W <= n; s += H) starts.push(s);
  if (n > W && starts[starts.length - 1] + W < n) starts.push(n - W);
  const acf = [], song = new Float64Array(2 * lagHi + 2);
  for (const s of starts) {
    const e = Math.min(n, s + W);
    let mean = 0;
    for (let i = s; i < e; i++) mean += env[i];
    mean /= Math.max(1, e - s);
    let z = 0;
    for (let i = s; i < e; i++) z += (env[i] - mean) * (env[i] - mean);
    const r = new Float64Array(2 * lagHi + 2);
    for (let lag = 1; lag < r.length && lag < e - s; lag++) {
      let x = 0;
      for (let i = s; i + lag < e; i++) x += (env[i] - mean) * (env[i + lag] - mean);
      // (an unbiased estimate: the sum over fewer pairs at a longer lag, scaled back up)
      r[lag] = z > 1e-12 ? (x / z) * ((e - s) / (e - s - lag)) : 0;
    }
    acf.push(r);
    for (let lag = 0; lag < r.length; lag++) song[lag] += r[lag];
  }
  for (let lag = 0; lag < song.length; lag++) song[lag] /= starts.length;
  // each window's score per period: the autocorrelation at the period plus half of it at twice the period (a beat
  // whose bars also line up), weighed by the prior
  const score = (r, lag) => Math.max(0, r[lag]) + 0.5 * Math.max(0, r[2 * lag] || 0);
  const emit = acf.map((r) => {
    const e = new Float64Array(L);
    for (let j = 0; j < L; j++) e[j] = Math.log(1e-4 + prior[j] * score(r, lagLo + j));
    return e;
  });
  // the path: Viterbi, a step costing its size in octaves (squared)
  const STEP = 60;
  let cost = Float64Array.from(emit[0], (v) => -v);
  const back = [];
  const lj = new Float64Array(L);
  for (let j = 0; j < L; j++) lj[j] = Math.log2(lagLo + j);
  for (let w = 1; w < emit.length; w++) {
    const nc = new Float64Array(L), bk = new Int32Array(L);
    for (let j = 0; j < L; j++) {
      let best = Infinity, bi = j;
      const k0 = Math.max(0, j - 12), k1 = Math.min(L - 1, j + 12);
      for (let k = k0; k <= k1; k++) { const d = lj[j] - lj[k], c = cost[k] + STEP * d * d; if (c < best) { best = c; bi = k; } }
      // (a jump farther than 12 lags is allowed, at its full price, from the cheapest state)
      nc[j] = best - emit[w][j]; bk[j] = bi;
    }
    let gi = 0;
    for (let k = 1; k < L; k++) if (cost[k] < cost[gi]) gi = k;
    for (let j = 0; j < L; j++) { const d = lj[j] - lj[gi], c = cost[gi] + STEP * d * d - emit[w][j]; if (c < nc[j]) { nc[j] = c; bk[j] = gi; } }
    cost = nc; back.push(bk);
  }
  let s = 0;
  for (let j = 1; j < L; j++) if (cost[j] < cost[s]) s = j;
  const path = new Array(emit.length);
  for (let w = emit.length - 1; w >= 0; w--) { path[w] = s; if (w > 0) s = back[w - 1][s]; }
  const refine = (r, lag) => {
    const a = r[lag - 1] ?? r[lag], b = r[lag], c = r[lag + 1] ?? r[lag], den = a - 2 * b + c;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return lag + d;
  };
  const windows = starts.map((st, w) => {
    const lag0 = lagLo + path[w], r = acf[w];
    // salience: the strongest of the period and its neighbours (a drifting window smears its peak a little)
    const sal = Math.max(r[lag0 - 1] || 0, r[lag0], r[lag0 + 1] || 0);
    const lag = refine(r, lag0);
    return { t: (st + Math.min(n, st + W)) / 2 / fps, lag, bpm: (60 * fps) / lag, salience: sal };
  });
  // the song's period: the median over the windows with a pulse (all of them when none has one)
  const pulsed = windows.filter((w) => w.salience >= FREE_SALIENCE);
  const lags = (pulsed.length ? pulsed : windows).map((w) => w.lag).sort((a, b) => a - b);
  const gl = lags.length ? lags[lags.length >> 1] : (60 * fps) / PRIOR_BPM;
  const at = (lag) => { const i = Math.floor(lag), f = lag - i; return (song[i] || 0) * (1 - f) + (song[i + 1] || 0) * f; };
  const base = Math.max(1e-9, at(gl));
  return {
    windows, lagLo, lagHi, fps,
    strength: at,
    global: { lag: gl, bpm: (60 * fps) / gl },
    octave: { half: at(2 * gl) / base, double: at(gl / 2) / base, triplet: at(1.5 * gl) / base },
    // the same, as the tempo was chosen (the prior and the bar's echo): how close the slower and faster readings came
    rival: (() => {
      const sc = (lag) => { const o = Math.log2((60 * fps) / lag / PRIOR_BPM) / PRIOR_OCT; return Math.exp(-0.5 * o * o) * (Math.max(0, at(lag)) + 0.5 * Math.max(0, at(2 * lag))); };
      const me = Math.max(1e-9, sc(gl));
      return { half: sc(2 * gl) / me, double: sc(gl / 2) / me };
    })(),
  };
}

// The period (frames) at time t: the windows' periods, linearly between their centres.
export function periodAt(tg, t) {
  const ws = tg.windows;
  if (!ws.length) return tg.global.lag;
  if (t <= ws[0].t) return ws[0].lag;
  if (t >= ws[ws.length - 1].t) return ws[ws.length - 1].lag;
  let lo = 0, hi = ws.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ws[m].t <= t) lo = m; else hi = m; }
  const a = ws[lo], b = ws[hi], f = (t - a.t) / (b.t - a.t);
  return a.lag + (b.lag - a.lag) * f;
}
