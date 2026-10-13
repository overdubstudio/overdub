// The key (spec 0014 R15): the song's chroma (treble and bass) against Temperley's profiles (audio/measure.js keyOf,
// profile 'temperley'), then a check against the chords found: when the best key leaves much of the chord time outside
// its scale and the runner up keeps clearly more of it inside, the runner up wins. A section gets its own key only when
// that key beats the song's on the section's own chroma by KEY_MARGIN.
//
//   keyFromChroma(chroma[12]) -> { root, scale, name, pc, confidence, all }
//   checkKey(key, chords) -> key        (chords: [{ pcs, t0, t1 }])
//   tonicKey(key, chords, { starts, bass }) -> key or its relative, by which tonic the chords and the bass lean on
//   sectionKey(chroma[12], songKey) -> name | null
//   keyName(pc, scale) -> 'Eb major', 'F# minor'
// Pure.
import { keyOf, NAMES } from '../measure.js';
import { scalePcs } from '../../core/music.js';

export const KEY_MARGIN = 0.1;
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const keyRoot = (pc, scale) => (scale === 'minor' ? MINOR_NAMES : MAJOR_NAMES)[((pc % 12) + 12) % 12];
export const keyName = (pc, scale) => `${keyRoot(pc, scale)} ${scale}`;
const r2 = (x) => Math.round(x * 100) / 100;

function fromAll(e, all) {
  const pc = NAMES.indexOf(e.root);
  return { root: keyRoot(pc, e.scale), scale: e.scale, name: keyName(pc, e.scale), pc, confidence: r2(Math.max(0, e.r)), all };
}

export function keyFromChroma(chroma) {
  let tot = 0;
  for (const v of chroma) tot += v;
  if (!(tot > 0)) return null;
  const k = keyOf(Array.from(chroma), { profile: 'temperley', all: true });
  return fromAll(k.all[0], k.all);
}

const diatonic = (key, chords) => {
  const sc = new Set(scalePcs({ root: key.root, scale: key.scale }));
  let inT = 0, all = 0;
  for (const c of chords) { const d = c.t1 - c.t0; all += d; if (c.pcs.every((p) => sc.has(p))) inT += d; }
  return all > 0 ? inT / all : 1;
};

export function checkKey(key, chords) {
  if (!key || !chords.length) return key;
  const here = diatonic(key, chords);
  if (here >= 0.7) return { ...key, diatonic: r2(here) };
  let best = key, bd = here;
  for (const e of key.all.slice(1, 4)) {
    const cand = fromAll(e, key.all), d = diatonic(cand, chords);
    if (d > bd + 0.15) { best = cand; bd = d; }
  }
  return { ...best, diatonic: r2(bd) };
}

// A key and its relative (C major, A minor) share every note: the profiles barely part them. The tonic decides: how
// long chords on each tonic sound (in its own mode), the chords that open the song and its sections and the one that
// ends it (twice as much each), and the bass's share on each tonic.
export function relativeOf(key) {
  const pc = key.scale === 'major' ? (key.pc + 9) % 12 : (key.pc + 3) % 12, scale = key.scale === 'major' ? 'minor' : 'major';
  const e = key.all.find((x) => NAMES.indexOf(x.root) === pc && x.scale === scale);
  return e ? fromAll(e, key.all) : null;
}
export function tonicKey(key, chords, { starts = [], bass = null } = {}) {
  if (!key || !chords.length) return key;
  const rel = relativeOf(key);
  if (!rel) return key;
  const ev = (k) => {
    const minor = k.scale === 'minor', on = (c) => c.root === k.pc && (c.quality === 'm') === minor;
    let e = 0, all = 0;
    for (const c of chords) { const d = c.t1 - c.t0; all += d; if (on(c)) e += d; }
    e = all > 0 ? e / all : 0;
    let first = 0;
    for (const t of starts) { const c = chords.find((x) => x.t1 > t + 0.05); if (c && on(c)) first++; }
    if (starts.length) e += (2 * first) / (starts.length + 1);
    if (on(chords[chords.length - 1])) e += 2 / (starts.length + 1);
    if (bass) { let tb = 0; for (const v of bass) tb += v; if (tb > 0) e += bass[k.pc] / tb; }
    return e;
  };
  return ev(rel) > ev(key) ? { ...rel, diatonic: key.diatonic } : key;
}

export function sectionKey(chroma, songKey) {
  if (!songKey) return null;
  const own = keyFromChroma(chroma);
  if (!own || own.name === songKey.name) return null;
  const rSong = own.all.find((e) => NAMES.indexOf(e.root) === songKey.pc && e.scale === songKey.scale);
  return rSong && own.all[0].r - rSong.r >= KEY_MARGIN ? own.name : null;
}
