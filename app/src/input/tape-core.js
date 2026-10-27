// @ts-check
// The rolling tape's pure parts [input] (docs/research/GUITAR-ROOM.md §1.4, §2.3, §4.3): the transport's grid as the
// tape saw it, the default selection ("that was the one"), the 16-bit samples and the ops that keep a grabbed riff.
// No audio graph and no DOM: test/unit/tape.test.js runs them on synthetic input. input/tape.js is the live tape.
//
//   createGrid({ cap }) -> grid      the beat grid along the audio clock, as linear pieces: { ta, tb (s, the audio
//       clock's scheduled time), ga (the grid beat at ta: beats since the transport's run began, continuous through
//       loop wraps), spb, so (song beat = grid beat + so), bpb, gen (engine.gen: the run) }
//     grid.mark({ t, on, gen, g, s, spb, bpb, t0, g0, ls, le })   the transport read at scheduled time t: playing past
//         its start (on), the grid and song beats there, seconds per beat there, beats per bar, where the run began
//         (t0, g0) and the loop (ls, le: song beats, NaN when off). A mark on the line the last one drew extends its
//         piece; a tempo change starts one where the two lines meet, a loop wrap where the song beat reached the loop's
//         end, a new run from its start. Marks come a few times a second and at every transport event.
//     grid.at(t) -> { g, s, spb, bpb, gen } | null     the grid at scheduled time t (null: nothing playing there)
//     grid.timeOf(s, near) -> t | null                  where song beat s fell (or falls: the playing run runs on), in
//                                                       the run playing at `near`, the occurrence nearest it
//     grid.lines(t0, t1, every?) -> [{ t, s, bar, beat, gen }]   the bar lines in [t0, t1) (every: 1 for every beat;
//                                                       bar is 1-based from song beat 0, the count-in's bars are 0 and
//                                                       under; beat is the beat in its bar, 0 on a bar line)
//     grid.pieces() -> [piece]   grid.prune(t)   (pieces that end before t go)   grid.clear()
//   defaultSelection({ onsets, sr, head, at, frameOf, level }) -> Selection | null
//       a starting selection, never a decision: the last phrase played (attacks closer than a bar or so, with sound
//       between), snapped to its bar lines when the band played under it: from the bar its first attack is in (an
//       attack a sixteenth early for a line is the line's), to the line after its last bar (a lone hit on the next
//       downbeat, after two bars or more, is the ending, not a bar). Over four bars, the shortest length (1, 2, 4 or 8
//       bars, never under 2) whose last pass matches the pass before it (the attacks on the sixteenth grid), else the
//       last four. With no band under it: from just before the first attack to where the last one has rung out, at
//       most 16 s. onsets: attack frames; at(f) -> { s, gen, spb, bpb } | null; frameOf(s, nearFrame) -> frame | null;
//       level(f0, f1) -> the loudest sample there (0..1).
//       Selection = { from, to (frames; to may still be ahead of head: the bar isn't over), snapped, beats: { from, to }
//         | null, bars, bar (the first one's number), why ('repeat' | 'phrase' | 'last' | 'free'), phrase: { from, to }
//         (its first and last attack), onsets (how many in the selection), gen }
//   riffOps(grab, { track, at, name, by }) -> ops   the ops that put a grabbed riff on an audio track at song beat `at`
//       (where its first bar line goes; default where it was played): asset.add (the song names its recording) and an
//       audio clip with the lead before the line. One dispatch, one undo step; the tape never dispatches.
//   pcm16(x) -> v ; unpcm16(v) -> x ; fromPcm16(Int16Array, out?) -> Float32Array    the tape's 16 bits (the worklet's
//       rule: Chromium's for a 16-bit file, so a 16-bit source comes back to the sample)
//   BIN (frames per peak bin: the worklet's), SECONDS ({ def: 60, min: 15, max: 300 })

export const BIN = 256;
export const SECONDS = { def: 60, min: 15, max: 300 };

export const pcm16 = (/** @type {number} */ x) => (x < 0 ? (x <= -1 ? -32768 : Math.round(x * 32768)) : x >= 1 ? 32767 : Math.round(x * 32767));
export const unpcm16 = (/** @type {number} */ v) => (v < 0 ? v / 32768 : v / 32767);
/** @param {Int16Array} d @param {Float32Array} [out] */
export function fromPcm16(d, out) {
  const y = out && out.length >= d.length ? out : new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) { const v = d[i]; y[i] = v < 0 ? v / 32768 : v / 32767; }
  return y;
}

const EPS = 1e-9;
const F = 7;   // a piece: ta, tb, ga, spb, so, bpb, gen

/**
 * @typedef {{ t: number, on: boolean, gen?: number, g?: number, s?: number, spb?: number, bpb?: number, t0?: number, g0?: number, ls?: number, le?: number }} Mark
 */
export function createGrid({ cap = 1024 } = {}) {
  let buf = new Float64Array(cap * F), n = 0, first = 0, open = false;
  /** @type {Mark | null} */
  let last = null;
  const off = (/** @type {number} */ k) => ((first + k) % cap) * F;
  function push(ta, ga, spb, so, bpb, gen, tb) {
    if (n === cap) { first = (first + 1) % cap; n--; }
    const o = off(n);
    buf[o] = ta; buf[o + 1] = tb; buf[o + 2] = ga; buf[o + 3] = spb; buf[o + 4] = so; buf[o + 5] = bpb; buf[o + 6] = gen;
    n++;
  }
  // how far past its last mark the playing piece reaches (the frames since the last read, and a bar line just ahead)
  const AHEAD = 30;
  const reach = (k, ahead) => buf[off(k) + 1] + (open && k === n - 1 ? ahead : 0);
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);

  /** @param {Mark} m */
  function mark(m) {
    if (!m || !fin(m.t)) return;
    if (last && m.t < last.t - EPS) return;
    if (!m.on || !fin(m.g) || !fin(m.s) || !(m.spb > 0)) {
      if (open && n) { const o = off(n - 1); buf[o + 1] = Math.max(buf[o + 1], m.t); }
      open = false; last = { ...m, on: false };
      return;
    }
    const bpb = m.bpb > 0 ? m.bpb : 4, gen = fin(m.gen) ? m.gen : 0, so = m.s - m.g;
    const o = n ? off(n - 1) : -1;
    if (!open || o < 0 || buf[o + 6] !== gen) {
      // a new run: from its start when that's still ahead of what the last piece covers, else from here
      const t0 = fin(m.t0) && m.t0 <= m.t + EPS ? m.t0 : m.t;
      // (the run before played on until this one began, or until this read)
      if (open && o >= 0) buf[o + 1] = Math.max(buf[o + 1], Math.min(m.t, t0));
      const ta = Math.max(t0, o >= 0 ? buf[o + 1] : -Infinity);
      push(ta, m.g - (m.t - ta) / m.spb, m.spb, so, bpb, gen, m.t);
      open = true; last = m;
      return;
    }
    const ta = buf[o], tb = buf[o + 1], ga = buf[o + 2], spb = buf[o + 3], so0 = buf[o + 4];
    const sameT = Math.abs(m.spb - spb) <= 1e-9 * spb, sameS = Math.abs(so - so0) < 1e-6;
    const onLine = Math.abs(m.g - (ga + (m.t - ta) / spb)) < 1e-6;
    if (sameT && sameS && onLine && bpb === buf[o + 5]) { buf[o + 1] = m.t; last = m; return; }
    let tc = m.t, gc = m.g;
    if (!sameT && sameS) {
      // the tempo: where the old line meets the new one (between the two reads)
      const a = 1 / spb, b = 1 / m.spb;
      tc = Math.abs(a - b) > 1e-12 ? (m.g - m.t * b - ga + ta * a) / (a - b) : m.t;
      if (!(tc >= tb)) tc = tb;
      if (!(tc <= m.t)) tc = m.t;
      gc = m.g - (m.t - tc) / m.spb;
    } else if (sameT && !sameS && onLine) {
      // a loop wrap: where the song beat reached the loop's end (or, read after it, left its start)
      const le = last && fin(last.le) ? last.le : NaN, ls = fin(m.ls) ? m.ls : NaN;
      const gw = fin(le) ? le - so0 : fin(ls) ? m.g - (m.s - ls) : NaN;
      const tw = ta + (gw - ga) * spb;
      if (fin(tw) && tw >= tb - 1e-6 && tw <= m.t + 1e-6) { tc = tw; gc = gw; }
    }
    buf[o + 1] = tc;
    push(tc, gc, m.spb, so, bpb, gen, m.t);
    last = m;
  }

  function at(/** @type {number} */ t) {
    for (let k = n - 1; k >= 0; k--) {
      const o = off(k);
      if (buf[o] > t + EPS) continue;
      if (t > reach(k, 0.5) + EPS) return null;
      const g = buf[o + 2] + (t - buf[o]) / buf[o + 3];
      return { g, s: g + buf[o + 4], spb: buf[o + 3], bpb: buf[o + 5], gen: buf[o + 6] };
    }
    return null;
  }

  function timeOf(/** @type {number} */ s, /** @type {number} */ near) {
    const here = at(near), gen = here ? here.gen : null;
    let best = null, bd = Infinity;
    for (let k = n - 1; k >= 0; k--) {
      const o = off(k);
      if (gen != null && buf[o + 6] !== gen) { if (best != null) break; continue; }
      const t = buf[o] + (s - buf[o + 4] - buf[o + 2]) * buf[o + 3];
      if (t < buf[o] - 1e-7 || t > reach(k, AHEAD) + 1e-7) continue;
      const d = Math.abs(t - near);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function lines(/** @type {number} */ t0, /** @type {number} */ t1, every = 0) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const o = off(k), ta = buf[o], tb = reach(k, AHEAD), bpb = buf[o + 5], step = every > 0 ? every : bpb;
      const a = Math.max(ta, t0), b = Math.min(tb, t1);
      if (!(b > a)) continue;
      const ga = buf[o + 2], spb = buf[o + 3], so = buf[o + 4];
      const sA = ga + (a - ta) / spb + so, sB = ga + (b - ta) / spb + so;
      for (let j = Math.ceil(sA / step - 1e-9); j * step < sB - 1e-9; j++) {
        const s = j * step, t = ta + (s - so - ga) * spb;
        if (t < a - 1e-9 || t >= b) continue;
        // (a line a piece starts on is the one before's too: once)
        if (out.length && Math.abs(out[out.length - 1].t - t) < 1e-7) continue;
        const bar = Math.floor(s / bpb + 1e-9);
        out.push({ t, s, bar: bar + 1, beat: Math.round((s - bar * bpb) * 1e6) / 1e6, gen: buf[o + 6] });
      }
    }
    return out;
  }

  return {
    mark,
    at,
    timeOf,
    lines,
    get open() { return open; },
    pieces() { const out = []; for (let k = 0; k < n; k++) { const o = off(k); out.push({ ta: buf[o], tb: buf[o + 1], ga: buf[o + 2], spb: buf[o + 3], so: buf[o + 4], bpb: buf[o + 5], gen: buf[o + 6] }); } return out; },
    prune(/** @type {number} */ t) { while (n > 1 && buf[off(0) + 1] < t) { first = (first + 1) % cap; n--; } },
    clear() { n = 0; first = 0; open = false; last = null; },
    resize(/** @type {number} */ c) {
      const keep = this.pieces().slice(-c);
      cap = Math.max(16, c); buf = new Float64Array(cap * F); n = 0; first = 0;
      for (const p of keep) push(p.ta, p.ga, p.spb, p.so, p.bpb, p.gen, p.tb);
    },
  };
}

/* ---------------------------------------------------------------------------------- the default selection */
const EARLY = 0.25;   // beats: an attack this much before a line is on it

/**
 * @param {{ onsets: number[], sr: number, head: number, at?: (f: number) => ({ s: number, gen: number, spb: number, bpb: number } | null),
 *   frameOf?: (s: number, near: number) => (number | null), level?: (f0: number, f1: number) => number, maxFree?: number }} o
 */
export function defaultSelection({ onsets, sr, head, at = () => null, frameOf = () => null, level = () => 0, maxFree = 16 }) {
  const on = (onsets || []).filter((f) => Number.isFinite(f) && f < head).sort((a, b) => a - b);
  if (!on.length || !(sr > 0)) return null;
  const pos = on.map((f) => at(f));
  // the floor: -48 dBFS, or 40 dB under the loudest of the last attacks, whichever is higher
  let loud = 0;
  for (let i = Math.max(0, on.length - 64); i < on.length; i++) loud = Math.max(loud, level(on[i], on[i] + Math.round(0.1 * sr)));
  const floor = Math.max(0.004, loud * 0.01);
  const W = Math.round(0.05 * sr);
  // a stretch of at least `need` frames under the floor in [a, b)
  const quiet = (a, b, need) => {
    let run = 0;
    for (let f = a; f < b; f += W) { if (level(f, Math.min(b, f + W)) < floor) { run += W; if (run >= need) return true; } else run = 0; }
    return false;
  };
  // the last phrase: back from the last attack while the gaps are short, or long with sound in them
  let k = on.length - 1;
  while (k > 0) {
    const a = on[k - 1], b = on[k], x = pos[k - 1], y = pos[k], dt = (b - a) / sr;
    if ((x ? x.gen : null) !== (y ? y.gen : null)) break;
    const bar = x ? x.bpb * x.spb : 2;
    if (dt >= Math.max(4 * bar, 8)) break;
    if (dt >= Math.max(0.9 * bar, 1.2) && quiet(a + Math.round(0.25 * sr), b, Math.round(0.4 * sr))) break;
    k--;
  }
  const p0 = on[k], p1 = on[on.length - 1], A = pos[k], B = pos[on.length - 1];
  const count = (f0, f1) => on.filter((f) => f >= f0 && f < f1).length;
  if (A && B && A.gen === B.gen) {
    const bpb = B.bpb, ss = pos.slice(k).filter((x) => x && x.gen === B.gen).map((x) => x.s);
    let start = Math.floor((A.s + EARLY) / bpb) * bpb;
    const lastBar = Math.floor((B.s + EARLY) / bpb) * bpb;
    let end = lastBar + bpb;
    const inLast = ss.filter((s) => s + EARLY >= lastBar);
    if (inLast.length === 1 && B.s + EARLY - lastBar < 1 && lastBar - start >= 2 * bpb - 1e-9) end = lastBar;
    let bars = Math.round((end - start) / bpb), why = 'phrase';
    if (bars > 4) {
      const steps = ss.map((s) => Math.round((s - start) * 4));
      const spanQ = (q0, q1) => steps.filter((q) => q >= q0 && q < q1).map((q) => q - q0);
      let pick = 0;
      for (const L of [1, 2, 4, 8]) {
        if (2 * L > bars) break;
        const e = bars * bpb * 4, len = L * bpb * 4;
        if (similar(spanQ(e - len, e), spanQ(e - 2 * len, e - len)) >= 0.75) { pick = L; break; }
      }
      const L = pick ? Math.max(2, pick) : 4;
      why = pick ? 'repeat' : 'last';
      start = end - L * bpb;
      bars = L;
    }
    const spb = B.spb;
    const from = frameOf(start, Math.round(p1 - (B.s - start) * spb * sr));
    const to = frameOf(end, Math.round(p1 + (end - B.s) * spb * sr));
    if (from != null && to != null && to > from) {
      return { from: Math.round(from), to: Math.round(to), snapped: true, beats: { from: start, to: end }, bars, bar: Math.round(start / bpb) + 1, why, phrase: { from: p0, to: p1 }, onsets: count(from, to), gen: B.gen };
    }
  }
  // free time: from just before the first attack (at most maxFree s back) to where the last has rung out
  let a = p0;
  if ((p1 - a) / sr > maxFree) a = on.find((f) => f >= p1 - maxFree * sr) ?? p1;
  const from = Math.max(0, a - Math.round(0.02 * sr));
  let to = Math.min(head, p1 + Math.round(4 * sr));
  const need = Math.round(0.3 * sr);
  for (let f = p1 + Math.round(0.1 * sr), run = 0; f < to; f += W) {
    if (level(f, f + W) < floor) { run += W; if (run >= need) { to = Math.min(to, f - run + W + W); break; } } else run = 0;
  }
  return { from, to: Math.max(to, Math.min(head, p1 + W)), snapped: false, beats: null, bars: null, bar: null, why: 'free', phrase: { from: p0, to: p1 }, onsets: count(from, to + 1), gen: null };
}

// how alike two passes' attacks are: matched within a sixteenth, as a share of both (0..1)
function similar(/** @type {number[]} */ a, /** @type {number[]} */ b) {
  if (!a.length && !b.length) return 0;
  const used = new Set();
  let m = 0;
  for (const x of a) {
    for (let j = 0; j < b.length; j++) if (!used.has(j) && Math.abs(b[j] - x) <= 1) { used.add(j); m++; break; }
  }
  return (2 * m) / (a.length + b.length);
}

/* ---------------------------------------------------------------------------------- keeping a riff */
const r6 = (/** @type {number} */ x) => Math.round(x * 1e6) / 1e6;
/**
 * @param {{ asset: { id: string, kind: string, name: string, sr: number, channels: number, duration: number }, seconds: number, lead: number,
 *   place: { start: number, from: number, length: number, bpm: number } | null }} g
 * @param {{ track: string, at?: number, name?: string, by?: string, spb?: number }} o
 */
export function riffOps(g, { track, at = undefined, name = undefined, by = undefined, spb = undefined }) {
  if (!g || !g.asset || !track) throw new Error('riffOps(grab, { track, at }): a grab and an audio track');
  const pl = g.place;
  const sp = pl ? 60 / pl.bpm : spb;
  if (!(sp > 0)) throw new Error('riffOps: a grab played in free time needs spb (seconds per beat) to be placed');
  const lineAt = at != null && Number.isFinite(+at) ? +at : pl ? pl.from : 0;
  const leadBeats = pl ? pl.from - pl.start : (g.lead || 0) / sp;
  let start = lineAt - leadBeats, offset = 0, length = pl ? pl.length : g.seconds / sp;
  // (never before the song's beat 0: the lead under it is left in the asset)
  if (start < 0) { offset = -start * sp; length += start; start = 0; }
  /** @type {Record<string, any>} */
  const clip = { kind: 'audio', start: r6(start), length: r6(Math.max(1e-3, length)), asset: g.asset.id, offset: r6(offset), gain: 0 };
  if (name) clip.name = name;
  if (by) clip.by = by;
  return [{ type: 'asset.add', asset: { ...g.asset } }, { type: 'clip.add', track, clip }];
}
