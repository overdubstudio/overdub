// @ts-check
// Lining the paper's chords up with a work tape [core] (docs/research/LIVE-ROOM-MODE.md §6.4): the sheet wins the
// chords, the take wins the time. Nothing recognises a chord here: the paper's own chords, in its order with the capo
// applied, are lined up with the take's chroma, so only the change points are read. A chord lasts a beat or more,
// changes prefer bar lines and half bars, a whole section may be played again, played after another, or left out, and
// a beat where nothing like a chord sounds is no chord at all (nothing plays a chord the paper doesn't have). Pure and
// deterministic (Float64, fixed order).
//
// Frozen (§14.2):
//   alignChords(chroma, beats, chords, opts) -> [{ chord, beat, sure, ... }]
//       chroma: the take's chroma (audio/analyze/chroma.js chromaOf's { treble, bass }, or tapeChroma's frames: {
//       treble: { fps, data }, bass: { fps, data } }); beats: the take's beat times (s, from the take's start; one more
//       than the beats read, or the last lasts as long as the one before it); chords: the paper's chords in order: a
//       list of symbols, or sheet.js sheetChords' sections ([{ section, name, chords: [{ sym, chord }] }]);
//       opts: { bpb (4), phase (the index of a beat on a bar line, 0) }.
//       -> the changes, in order: { chord: the symbol as written (null: no chord from here), sounding (its name as
//       it sounds), beat (an index into beats), sure (false where the take couldn't place it: drawn dotted until heard),
//       section (the sheet section's id), pass (which time through that section, from 0), at (the chord's place in its
//       section), first (a section starts here) }
// And:
//   formOf(changes, beats) -> [{ section, name?, pass, from, to }]   the sections as played (beat indexes, to exclusive)
//   beatChroma(chroma, beats) -> { treble: [12-vectors], bass: [...], energy: [per beat] }
//   readTape(samples, sr) -> { result, chroma, level, peak }   the analyser's reading of a take (audio/analyze: beats,
//       the tempo map's readings, free time, the key and its own chords), the chroma alignChords lines the paper up with,
//       and the take's integrated loudness (LUFS) and peak (dBFS)
//   readTapeInWorker(samples, sr) -> Promise of the same, off the main thread (tape-worker.js; on this thread where
//       there's no Worker)
//   timeWords(result, reading) -> { tempo, lo, hi, free (share of the take in free time) }   for the room's line

import { analyze } from '../../audio/analyze/index.js';
import { chromaOf } from '../../audio/analyze/chroma.js';
import { resample, downmix } from '../../audio/analyze/resample.js';
import { readChord } from './sheet.js';
import { QUALITIES } from '../jam.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/* ------------------------------------------------------------------------------------------------ chroma per beat */
// a chroma track's frames as running sums, so a beat's chroma is two lookups
function cumOf(track) {
  if (track && typeof track.sum === 'function') return { sum: track.sum };
  const fps = track.fps, data = track.data, frames = Math.floor(data.length / 12);
  const cum = new Float64Array((frames + 1) * 12);
  for (let f = 0; f < frames; f++) for (let p = 0; p < 12; p++) cum[(f + 1) * 12 + p] = cum[f * 12 + p] + data[f * 12 + p];
  return {
    sum(t0, t1) {
      const a = Math.max(0, Math.min(frames, Math.ceil(t0 * fps - 1e-9))), b = Math.max(a, Math.min(frames, Math.ceil(t1 * fps - 1e-9)));
      const out = new Float64Array(12);
      for (let p = 0; p < 12; p++) out[p] = cum[b * 12 + p] - cum[a * 12 + p];
      return out;
    },
  };
}
const spanOf = (beats, i) => {
  const a = beats[i];
  const b = i + 1 < beats.length ? beats[i + 1] : a + (i > 0 ? a - beats[i - 1] : 0.5);
  return [a, b];
};
export function beatChroma(chroma, beats) {
  const T = cumOf(chroma.treble), B = cumOf(chroma.bass);
  const treble = [], bass = [], energy = [];
  for (let i = 0; i < beats.length; i++) {
    const [a, b] = spanOf(beats, i);
    const t = T.sum(a, b), q = B.sum(a, b);
    let e = 0;
    for (let p = 0; p < 12; p++) e += t[p];
    treble.push(t); bass.push(q); energy.push(e / Math.max(1e-6, b - a));
  }
  return { treble, bass, energy };
}

/* ------------------------------------------------------------------------------------------------ the model */
// A chord's template: its tones, the root and the third a little more than the rest.
function template(ch) {
  const T = new Float64Array(12), iv = (QUALITIES[ch.quality] || QUALITIES['']).iv;
  iv.forEach((x, j) => { const pc = (ch.root + x) % 12; T[pc] = Math.max(T[pc], j === 0 ? 1 : j === 1 ? 0.9 : j === 2 ? 0.75 : 0.5); });
  let n = 0;
  for (let p = 0; p < 12; p++) n += T[p] * T[p];
  n = Math.sqrt(n) || 1;
  for (let p = 0; p < 12; p++) T[p] /= n;
  return T;
}
// A beat's treble chroma, compressed (the square root) and to unit length: a sung note is one strong pitch class over
// the strum's spread of chord tones, and compressed it can't outvote the chord
function unit(v) {
  let n = 0;
  const c = Array.from(v, (x) => Math.sqrt(Math.max(0, x)));
  for (let p = 0; p < 12; p++) n += c[p] * c[p];
  n = Math.sqrt(n);
  return n > 0 ? c.map((x) => x / n) : null;
}
// how well a beat's chroma fits a chord: the treble against the template, and the bass (40-250 Hz, the guitar's low
// strings, under a voice) against it too, with the chord's bass note on top. The bass weighs as much as the treble:
// a voice singing over the strum fills the treble with one note, and never reaches down there
function fitOf(tv, bv, T, bassPc, root) {
  if (!tv) return 0;
  let s = 0;
  for (let p = 0; p < 12; p++) s += tv[p] * T[p];
  const bu = unit(bv);
  let sb = 0, bmax = 0;
  if (bu) for (let p = 0; p < 12; p++) { sb += bu[p] * T[p]; bmax = Math.max(bmax, bu[p]); }
  const bs = bmax > 0 ? Math.max(bu[bassPc], 0.6 * bu[root]) / bmax : 0;
  return W_TREBLE * s + W_BASS * sb + W_NOTE * bs;
}
const W_TREBLE = 0.55, W_BASS = 0.45, W_NOTE = 0.2;

// The costs, in units of one beat's fit (a fit runs about 0.5 for a wrong chord to 1.2 for a right one).
const W = 5;                                   // a beat's fit, weighted against the moves
const MOVE = { bar: 0.4, half: 2.4, beat: 4.5 };   // a change on a bar line, a half bar, any other beat
const SECTION = { next: 0.6, again: 1.2, back: 1.4, skip: 2.6, offBar: 6 };   // into a section: the next, the same one again, one before, one past the next; not on a bar line
const NONE = { fit: 0.58, into: 1.2, out: 2, mid: 5, margin: 0.05 };   // no chord: its fit, starting a section from it, ending one into it, stopping mid-section; how far a chord off the paper must fit over it

export function alignChords(chroma, beats, chords, opts = {}) {
  const bpb = Math.max(1, Math.round(opts.bpb || 4)), phase = Math.round(opts.phase || 0);
  const B = Array.isArray(beats) ? beats.length : 0;
  if (!B || !chroma) return [];
  // the paper as sections of playable chords (a symbol nobody can read is left out: nobody plays it)
  /** @type {any[]} */
  const secs = (Array.isArray(chords) && chords.length && isObj(chords[0]) && Array.isArray(chords[0].chords) ? chords : [{ section: null, name: null, chords: (chords || []).map((sym) => ({ sym, chord: readChord(sym) })) }])
    .map((s, si) => ({ id: s.section ?? null, name: s.name ?? null, si, chords: (s.chords || []).filter((c) => c && c.chord).map((c) => ({ sym: c.sym, chord: c.chord, T: template(c.chord) })) }))
    .filter((s) => s.chords.length);
  // sections with the same chords in the same order are one in the model (a second verse is the verse again), and
  // each time through it is the next of them on the paper: Verse 1, then Verse 2
  const groups = [];
  for (const s of secs) {
    const sig = s.chords.map((c) => c.chord.name).join(' ');
    const g = groups.find((x) => x.sig === sig);
    if (g) g.members.push({ id: s.id, name: s.name });
    else groups.push({ ...s, si: groups.length, sig, members: [{ id: s.id, name: s.name }] });
  }
  secs.length = 0;
  secs.push(...groups);
  if (!secs.length) return [];
  // the states: every chord of every section in order, then no chord
  const states = [];
  for (const s of secs) s.chords.forEach((c, k) => states.push({ s: s.si, k, last: k === s.chords.length - 1, c, sec: s }));
  const N = states.length, NC = N;
  const first = new Map(), lastOf = new Map();
  states.forEach((st, i) => { if (st.k === 0) first.set(st.s, i); if (st.last) lastOf.set(st.s, i); });
  const order = secs.map((s) => s.si);
  // what each beat sounds like
  const bc = beatChroma(chroma, beats);
  const med = bc.energy.slice().sort((a, b) => a - b)[Math.floor(B / 2)] || 1e-9;
  // the chords that aren't on the paper: the triads that share at most one note with every chord it has. When one of
  // them fits a beat clearly, something else is playing there (a chord the paper doesn't have): no chord
  const paperPcs = states.map((st) => new Set((QUALITIES[st.c.chord.quality] || QUALITIES['']).iv.map((x) => (st.c.chord.root + x) % 12)));
  const foreign = [];
  for (let r = 0; r < 12; r++) for (const q of ['', 'm']) {
    const pcs = (QUALITIES[q].iv).map((x) => (r + x) % 12);
    if (paperPcs.every((P) => pcs.filter((x) => P.has(x)).length <= 1)) foreign.push({ root: r, T: template({ root: r, quality: q }) });
  }
  const fit = new Float64Array(B * (N + 1));
  for (let b = 0; b < B; b++) {
    const tv = unit(bc.treble[b]), bv = bc.bass[b], quiet = Math.min(1, bc.energy[b] / (0.25 * med));
    for (let i = 0; i < N; i++) { const c = states[i].c.chord; fit[b * (N + 1) + i] = fitOf(tv, bv, states[i].c.T, c.bass ?? c.root, c.root) * quiet; }
    let other = 0;
    for (const f of foreign) other = Math.max(other, fitOf(tv, bv, f.T, f.root, f.root) * quiet);
    fit[b * (N + 1) + NC] = Math.max(NONE.fit + 0.6 * (1 - quiet), other - NONE.margin);
  }
  const posOf = (b) => ((((b - phase) % bpb) + bpb) % bpb);
  const moveCost = (b) => { const q = posOf(b); return q === 0 ? MOVE.bar : bpb % 2 === 0 && q === bpb / 2 ? MOVE.half : MOVE.beat; };
  const intoCost = (from, to, b) => {
    const a = order.indexOf(from), z = order.indexOf(to);
    const base = z === a + 1 ? SECTION.next : z === a ? SECTION.again : z < a ? SECTION.back : SECTION.skip + 0.6 * (z - a - 2);
    return base + (posOf(b) === 0 ? 0 : SECTION.offBar);
  };
  // Viterbi, forward only within a section
  const INF = 1e18;
  let cost = new Float64Array(N + 1).fill(INF);
  const back = new Int32Array(B * (N + 1)).fill(-1);
  for (let i = 0; i < N; i++) if (states[i].k === 0) cost[i] = (order.indexOf(states[i].s) === 0 ? 0 : SECTION.skip) + (posOf(0) === 0 ? 0 : SECTION.offBar) - W * fit[i];
  cost[NC] = -W * fit[NC];
  for (let b = 1; b < B; b++) {
    const next = new Float64Array(N + 1).fill(INF), row = b * (N + 1);
    const put = (to, from, c) => { if (c < next[to] - 1e-12) { next[to] = c; back[row + to] = from; } };
    for (let i = 0; i < N; i++) {
      if (cost[i] >= INF) continue;
      const st = states[i];
      put(i, i, cost[i]);
      if (!st.last) put(i + 1, i, cost[i] + moveCost(b));
      else {
        for (const s of order) put(first.get(s), i, cost[i] + intoCost(st.s, s, b));
        put(NC, i, cost[i] + NONE.out);
      }
      if (!st.last) put(NC, i, cost[i] + NONE.mid);
    }
    if (cost[NC] < INF) {
      put(NC, NC, cost[NC]);
      for (const s of order) put(first.get(s), NC, cost[NC] + NONE.into + (posOf(b) === 0 ? 0 : SECTION.offBar));
    }
    for (let i = 0; i <= N; i++) if (next[i] < INF) next[i] -= W * fit[row + i];
    cost = next;
  }
  let at = 0;
  for (let i = 1; i <= N; i++) if (cost[i] < cost[at]) at = i;
  const path = new Int32Array(B);
  for (let b = B - 1; b >= 0; b--) { path[b] = at; at = b > 0 ? back[b * (N + 1) + at] : at; }
  // the path as changes: a new chord, a new section, or no chord
  const out = [], passes = new Map();
  let prev = -1;
  for (let b = 0; b < B; b++) {
    const i = path[b];
    if (i === prev) continue;
    const was = prev;
    prev = i;
    if (i === NC) { out.push({ chord: null, sounding: null, beat: b, sure: true, section: null, pass: null, at: null, first: false }); continue; }
    const st = states[i];
    const firstOf = st.k === 0 && (was === NC || was === -1 || states[was].last);
    if (firstOf) passes.set(st.s, (passes.get(st.s) ?? -1) + 1);
    const n = passes.get(st.s) ?? 0, ms = st.sec.members, m = ms[n % ms.length];
    const pass = Math.floor(n / ms.length);
    // (the same chord carried over a line, or from one section into the next, isn't a change, but a section start is)
    if (!firstOf && was >= 0 && was !== NC && states[was].c.chord.name === st.c.chord.name) continue;
    out.push({ chord: st.c.sym, sounding: st.c.chord.name, beat: b, sure: true, section: m.id, name: m.name, pass, at: st.k, first: firstOf, _g: st.sec });
  }
  // sure: the chord fits its beats clearly better than the others its section has
  for (let j = 0; j < out.length; j++) {
    const ch = out[j];
    if (ch.chord == null) continue;
    const end = j + 1 < out.length ? out[j + 1].beat : B;
    const sec = ch._g || secs[0];
    const mine = sec.chords.find((c) => c.sym === ch.chord);
    let margin = 0, n = 0;
    for (let b = ch.beat; b < end; b++) {
      const tv = unit(bc.treble[b]);
      if (!tv) continue;
      const own = fitOf(tv, bc.bass[b], mine.T, mine.chord.bass ?? mine.chord.root, mine.chord.root);
      let other = -Infinity;
      for (const c of sec.chords) if (c.chord.name !== mine.chord.name) other = Math.max(other, fitOf(tv, bc.bass[b], c.T, c.chord.bass ?? c.chord.root, c.chord.root));
      margin += own - (other === -Infinity ? own - 0.2 : other);
      n++;
    }
    ch.sure = n > 0 && margin / n > 0.04;
  }
  for (const ch of out) delete ch._g;
  return out;
}

// the sections as played: each pass of a sheet section, from its first chord to where the next pass (or no chord)
// begins
export function formOf(changes, beats) {
  const out = [];
  const B = Array.isArray(beats) ? beats.length : Infinity;
  for (const c of changes) {
    if (c.chord != null && c.first) out.push({ section: c.section, name: c.name ?? null, pass: c.pass, from: c.beat, to: B });
    else if (c.chord == null && out.length && out[out.length - 1].to === B) out[out.length - 1].to = c.beat;
    if (c.chord != null && c.first && out.length > 1 && out[out.length - 2].to === B) out[out.length - 2].to = c.beat;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ reading a tape */
const LUFS_GATE = -70;
// integrated loudness (BS.1770, mono: K-weighted, 400 ms blocks, the absolute and relative gates)
function loudness(x, sr) {
  // K-weighting: the high shelf and the high-pass, the standard's coefficients made for this rate
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const s = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773, K1 = Math.tan((Math.PI * f1) / sr), a1 = 1 + K1 / Q1 + K1 * K1;
  const h = [1, -2, 1, (2 * (K1 * K1 - 1)) / a1, (1 - K1 / Q1 + K1 * K1) / a1];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
  const blk = Math.round(sr * 0.1), sums = [];
  let acc = 0, n = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = s[0] * v + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    const z = h[0] * y + h[1] * u1 + h[2] * u2 - h[3] * z1 - h[4] * z2;
    u2 = u1; u1 = y; z2 = z1; z1 = z;
    acc += z * z;
    if (++n === blk) { sums.push(acc / blk); acc = 0; n = 0; }
  }
  const blocks = [];
  for (let i = 0; i + 4 <= sums.length; i++) blocks.push((sums[i] + sums[i + 1] + sums[i + 2] + sums[i + 3]) / 4);
  const L = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  const abs = blocks.filter((m) => L(m) > LUFS_GATE);
  if (!abs.length) return -Infinity;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((m) => L(m) > L(mean) - 10);
  return L(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
}
// The chroma as frames anyone can carry (a Worker's message, a check): 12 numbers a frame
function frames(track) {
  const data = new Float32Array(track.frames * 12);
  for (let f = 0; f < track.frames; f++) {
    const v = track.sum(f / track.fps, (f + 1) / track.fps);
    for (let p = 0; p < 12; p++) data[f * 12 + p] = v[p];
  }
  return { fps: track.fps, data };
}
export function tapeChroma(samples, sr) {
  const x22 = resample(downmix(samples), sr, 22050);
  const c = chromaOf(x22, 22050);
  return { tuning: c.tuning, treble: frames(c.treble), bass: frames(c.bass) };
}
export function readTape(samples, sr) {
  const x = samples instanceof Float32Array || samples instanceof Float64Array ? samples : downmix(samples);
  const result = analyze({ sr, mix: x });
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  return { result, chroma: tapeChroma(x, sr), level: Math.round(loudness(x, sr) * 100) / 100, peak: Math.round(20 * Math.log10(peak || 1e-9) * 100) / 100 };
}
export function readTapeInWorker(samples, sr) {
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => readTape(samples, sr));
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./tape-worker.js', import.meta.url), { type: 'module' }); } catch { resolve(readTape(samples, sr)); return; }
    const copy = Float32Array.from(samples);
    w.onmessage = (e) => { try { w.terminate(); } catch { /* gone */ } const m = e.data || {}; if (m.error) reject(new Error(m.error)); else resolve(m.out); };
    w.onerror = (e) => { try { w.terminate(); } catch { /* gone */ } reject(new Error('The tape reader stopped: ' + ((e && e.message) || 'unknown'))); };
    w.postMessage({ samples: copy, sr }, [copy.buffer]);
  });
}

// "around 84, drifting 80 to 88": a reading's tempo, the range its bars run in, and how much of the take is free time
export function timeWords(result, reading = 'found') {
  const R = isObj(reading) ? reading : (result?.readings || []).find((r) => r.id === reading) || result?.readings?.[0];
  if (!R) return null;
  const tempos = [];
  for (let i = 1; i < R.anchors.length; i++) {
    const a = R.anchors[i - 1], b = R.anchors[i];
    if (b.beat - a.beat <= 2 * R.bpb && b.sec > a.sec) tempos.push((60 * (b.beat - a.beat)) / (b.sec - a.sec));
  }
  tempos.sort((x, y) => x - y);
  const lo = tempos.length ? tempos[Math.floor(tempos.length * 0.05)] : R.tempo, hi = tempos.length ? tempos[Math.ceil(tempos.length * 0.95) - 1] : R.tempo;
  const free = (result.free || []).reduce((a, [x, y]) => a + (y - x), 0) / Math.max(1e-9, result.duration || 1);
  return { tempo: Math.round(R.tempo), lo: Math.round(lo), hi: Math.round(hi), free, bpb: R.bpb };
}
