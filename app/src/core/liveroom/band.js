// @ts-check
// The band [core; stream B fills it in] (docs/research/LIVE-ROOM-MODE.md §4.3-§4.5, §5): the drummer and the bass
// learning a part from the read of your take, the feels you direct them with, the finish on the master, and the bass
// you play yourself. Pure plans: each returns ops for one store.dispatch, made of existing ops (§9.3), with the step's
// label and its reason, and never dispatches.
//
// Frozen (§14.2), each -> { ops, label, reason }:
//   guideOps(p, { section, from, bars, feel })     the pass's preview band: the part's feel with the kick on each bar's
//                                                  1, from the part's start (dispatched as store.preview, never kept)
//   planLearn(p, { section, read })                the muted notes, the drums and the bass from a read
//                                                  (core/liveroom/read.js), room.part.set { learned }: the house's step
//   planFeel(p, { section, feel, busy, loud })     room.part.set and the part's drum clip
//   planFinish(p, { finish })                      the master's inserts and room.set { finish, managed }
//   planBassYours(p, { section })                  the bass part handed to you (bassYours)
// Kept from the prototype (a seam addition, §14.2):
//   bandFor(place, riff, { from, length, seed }) -> { drums, bass, from, length }   the notes of the place's band under
//       a riff: its grooves in 8-bar phrases (the twelve-bar at the blues bar) with a fill to end each and a crash to
//       start the next; the metal club's kick on your chugs (the chug rule: a note within 5 semitones of the riff's
//       lowest, or unpitched); the bass doubling the riff an octave down (metal), on its notes in eighths (punk) or
//       walking the boogie through the changes (blues). riff: { n (beats), bpm, root (pitch class), notes: [{ t (beats
//       from the 1), p (MIDI, null unpitched), d }] }; null is the place's own groove and tempo with no bass.
//
// Until stream B lands, the plans are inert: no ops.

import { realize, getGroove } from '../grooves.js';
import { placeOf } from './places.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const none = () => ({ ops: [], label: '', reason: '' });

export function guideOps(p, { section = null, from = 0, bars = 0, feel = null } = {}) { return none(); }
export function planLearn(p, { section = null, read = null } = {}) { return none(); }
export function planFeel(p, { section = null, feel = null, busy = 0, loud = 0 } = {}) { return none(); }
export function planFinish(p, { finish = null } = {}) { return none(); }
export function planBassYours(p, { section = null } = {}) { return none(); }

/* ------------------------------------------------------------------------------------------------ the band's notes */
const fold = (p, lo, hi) => { let x = Math.round(p); while (x > hi) x -= 12; while (x < lo) x += 12; return x; };
const CRASH = 49, KICKS = new Set([35, 36]);
const phraseOf = (P) => (P.form ? P.form.length * 4 : 32);

export function bandFor(place, riff, { from = 0, length = 128, seed = 1 } = {}) {
  const P = placeOf(place), bpm = riff?.bpm || P.prefer, n = riff?.n || 4;
  const drums = [], bass = [];
  const D = P.drums, phrase = phraseOf(P);
  const fillLen = getGroove(D.fill)?.length || 1;
  // the riff's low notes (the chugs): where the metal club's kick goes (a riff with no notes has none to follow: the
  // groove's own kick, and the bass on the root)
  const rn = riff?.notes || [], follow = !!(D.follow && riff && rn.length);
  const lowP = rn.filter((x) => x.p != null).reduce((m, x) => Math.min(m, x.p), Infinity);
  const chugs = rn.filter((x) => x.p == null || x.p <= lowP + 5);
  for (let k = 0, s = 0; s < length - EPS; k++, s += phrase) {
    const len = Math.min(phrase, length - s), body = Math.max(0, len - (len === phrase ? fillLen : 0));
    const groove = k % 2 === 0 ? D.verse : D.chorus;
    for (const x of realize(groove, { tempo: bpm, seed: seed * 101 + k, length: body })) {
      if (follow && KICKS.has(x.p)) continue;
      drums.push({ ...x, t: r4(s + x.t) });
    }
    if (follow) {
      for (let c = 0; c < body - EPS; c += n) for (const x of chugs) {
        const t = c + x.t;
        if (t < body - EPS) drums.push({ p: 36, t: r4(s + t), d: 0.25, v: Math.abs(x.t) < EPS ? 0.98 : 0.84 });
      }
    }
    if (body < len - EPS) for (const x of realize(D.fill, { tempo: bpm, seed: seed * 101 + k, length: fillLen })) drums.push({ ...x, t: r4(s + body + x.t) });
    drums.push({ p: CRASH, t: r4(s), d: 1, v: 0.92 });
    if (!drums.some((x) => KICKS.has(x.p) && Math.abs(x.t - s) < 0.02)) drums.push({ p: 36, t: r4(s), d: 0.25, v: 0.95 });
  }
  // the bass
  const B = P.bass, root = riff ? riff.root : 4, rootP = fold(root + 24, 28, 39);
  const mode = B.mode === 'double' && !rn.length ? 'eighths' : B.mode;
  if (riff) {
    for (let s = 0; s < length - EPS; s += n) {
      const bar0 = Math.floor(s / 4);
      if (mode === 'double') {
        rn.forEach((x, i) => {
          const t = s + x.t;
          if (t >= length - EPS) return;
          const p = x.p == null ? rootP : fold(x.p - 12, 28, 47);
          bass.push({ p, t: r4(t), d: r4(Math.min(x.d, 1) * 0.85), v: i === 0 ? 0.95 : 0.84 });
        });
      } else if (mode === 'eighths') {
        for (let e = 0; e < n - EPS; e += 0.5) {
          const t = s + e;
          if (t >= length - EPS) break;
          const at = [...rn].reverse().find((x) => x.t <= e + EPS) || rn[0];
          const p = !at || at.p == null ? rootP : fold(at.p - 12, 28, 47);
          bass.push({ p, t: r4(t), d: 0.42, v: Math.abs(e - Math.round(e)) < EPS ? 0.92 : 0.78 });
        }
      } else if (mode === 'boogie') {
        // the boogie through the twelve-bar: R 3 5 6 b7 6 5 3 on the shuffle's long-short eighths
        const ivs = [0, 4, 7, 9, 10, 9, 7, 4], at = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
        for (let b = 0; b * 4 < n - EPS; b++) {
          const bar = bar0 + b, step = P.form[((bar % P.form.length) + P.form.length) % P.form.length];
          const r = fold(root + step + 24, 28, 40);
          at.forEach((x, j) => {
            const t = s + b * 4 + x;
            if (t < length - EPS) bass.push({ p: r + ivs[j], t: r4(t), d: j % 2 ? 0.3 : 0.6, v: j % 2 ? 0.72 : 0.9 });
          });
        }
      }
    }
  }
  const byT = (a, b) => a.t - b.t || a.p - b.p;
  return { drums: drums.filter((x) => x.t >= 0 && x.t < length - EPS).sort(byT), bass: bass.sort(byT), from, length };
}
