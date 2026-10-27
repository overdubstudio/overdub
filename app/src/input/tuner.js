// @ts-check
// The tuner: the pitch of the open input, read steadily, with the string it's on (docs/research/GUITAR-ROOM.md §2.1,
// Getting started's Tune). Pure (no DOM, no audio graph): it takes windows of samples and gives readings, so Node
// measures it (tools/input-test.js, on Karplus-Strong strings from tools/strings.js) and any screen can draw one
// (ui/gauges/tuner.js mounts the needle and the strobe on it).
//
//   createSteadyTuner({ tuning, lo, hi, tau, attack, hold, gate }) -> tuner      tuning: an id or { strings } (the
//                                            strings it names, and the range: from a fourth under its low string),
//                                            or null (no strings named, everything down to 30 Hz: which tuning is it?)
//     tuner.push(buf, sr, t) -> reading      buf: the input's latest samples (4096 at 48 kHz, 8192 at 96: a quarter of
//                                            the window must hold the lowest period); t: seconds, rising. Read it at
//                                            20-30 times a second (ui/gauges/tuner.js does, from the frame loop)
//     tuner.reading                          the last reading (READING_NONE before the first note)
//     tuner.setTuning(idOrTuning | null)     another tuning (an id from TUNER_TUNINGS, or { strings }), or none
//     tuner.reset()
//   reading: {
//     live      a note is sounding now (false: nothing, or the last note held on the display, `held`)
//     held      the last note, kept up to `hold` s after it went quiet (a tuner shouldn't blank the moment a
//               string fades), drawn dimmed
//     hz        the pitch, smoothed (0: none)
//     midi      the same as a MIDI number with its fraction (40.07: E2, 7 cents sharp)
//     p         the nearest note (an integer MIDI number); note 'E', 'B♭'; octave 2
//     cents     how far off p, smoothed, to a tenth (null until the note has settled: a pick's attack goes sharp)
//     shown     cents as the display shows them: a whole number that moves only once the reading is 0.65 from it
//               (0.15 past the halfway), so it never flickers between two numbers
//     inTune    within ±2 cents (and stays so until it's past ±4: the lamp doesn't flicker either)
//     settled   cents are good to read (the attack is past and the reading has held)
//     string    the open string it's nearest in the tuning: { s (0 the lowest), number (6 for a six-string's low
//               one), name ('Low E', 'A', 'High E'), open (its MIDI note), cents (how far off it: -230 is more than
//               two semitones flat), near (within a semitone) } | null
//     db        the window's level (dBFS rms); floor: the noise floor it's measured, which the gate sits over
//     since     when this note began (s); conf: YIN's confidence 0..1
//   }
//
//   TUNER_TUNINGS          core/fretboard.js TUNINGS, plus drop A and the seven-string standard and drop A
//   tuningsFromLow(midi, { tunings, strings }) -> [{ id, name, strings: n }]   the standard and drop tunings whose low
//                          string is that note, in the order to ask (drop before standard from C up; standard first under
//                          it), six-string first unless strings: 7
//   guessTuning(heard, { tunings }) -> [{ id, name, hits, of }]   the tunings that fit a set of open strings heard (MIDI),
//                          best first (most heard strings in it, then fewest strings unheard)
//   stringOf(midi, tuning) -> reading.string's shape | null      noteName(midi) -> 'E♭'      tuningName(t) -> 'drop C'
//
// What makes it steady (measured in tools/input-test.js across E1 to E4, at 48 and 96 kHz, with a pick's glide, hum
// and noise):
//   - YIN (input/pitch.js, ported from Claw'd-o-Matic) on each window, in the instrument's range;
//   - a noise floor (the quietest look in the last 8 s), and a gate 10 dB over it: a string that has decayed into the
//     hum is the hum (a single coil's 60 Hz reads as B♭1), so the reading holds instead;
//   - the held note as YIN's hint: a pick that's a whole multiple of its period (a decaying A2 under hum reads A1) is
//     the note, while its own dip is nearly as clear;
//   - the attack's first 40 ms left out (the pick's edge has no period yet), a new note only on a new attack or after it
//     has held 90 ms, a median of three against single wild frames, and a smoother that starts quick (to get there),
//     calms as the note holds (tau 60 to 200 ms) and quickens while the pitch moves one way (a one-euro filter: the
//     attack's glide settling, a peg turned);
//   - cents only once the note has held three readings within 10 cents of each other.
// A look costs about 0.6 ms at 48 kHz in standard tuning (1 ms with no tuning, down to 30 Hz), 2 to 3.5 ms at 96 kHz:
// 25 looks a second is 1.5 to 9% of the main thread (measured in Node on an M-series Mac).

import { yin, ftom, rms, dbOf, median } from './pitch.js';
import { TUNINGS } from '../core/fretboard.js';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = (/** @type {number} */ m) => NAMES[((Math.round(m) % 12) + 12) % 12];
export const octaveOf = (/** @type {number} */ m) => Math.floor(Math.round(m) / 12) - 1;

/** @typedef {{ id: string, name: string, notes?: string, strings: number[] }} Tuning */
/** @type {Record<string, Tuning>} */
export const EXTRA_TUNINGS = {
  // (heavier than drop B: a six-string's drop A, and a seven-string's B standard and drop A)
  'drop-a': { id: 'drop-a', name: 'Drop A', notes: 'A E A D F# B', strings: [33, 40, 45, 50, 54, 59] },
  '7-standard': { id: '7-standard', name: 'Seven-string standard', notes: 'B E A D G B E', strings: [35, 40, 45, 50, 55, 59, 64] },
  '7-drop-a': { id: '7-drop-a', name: 'Seven-string drop A', notes: 'A E A D G B E', strings: [33, 40, 45, 50, 55, 59, 64] },
};
/** @type {Record<string, Tuning>} */
export const TUNER_TUNINGS = { ...TUNINGS, ...EXTRA_TUNINGS };

/** @param {string | Tuning | null | undefined} t @returns {Tuning} */
export function tuningOf(t) {
  if (t && typeof t === 'object' && Array.isArray(t.strings) && t.strings.length) return t;
  return TUNER_TUNINGS[String(t || '')] || TUNER_TUNINGS.standard;
}

/** @param {Tuning | null | undefined} t */
export function tuningName(t) {
  if (!t) return '';
  const n = String(t.name || t.id || '');
  if (/^standard$/i.test(n)) return `${noteName(t.strings[0])} standard`;
  if (/^seven-string /i.test(n)) return `seven-string ${tuningName({ ...t, name: n.slice(13) }).replace(/^seven-string /, '')}`;
  if (/^drop /i.test(n)) return `drop ${n.slice(5)}`;
  return n.length > 1 && n[1] === n[1].toLowerCase() && n[1] !== ' ' ? n[0].toLowerCase() + n.slice(1) : n;
}

// The string names a guitarist says: the lowest is "Low E", the highest "High E" (when both ends are the same letter)
/** @param {Tuning} t @param {number} s */
function stringName(t, s) {
  const n = t.strings.length, nm = noteName(t.strings[s]);
  const same = noteName(t.strings[0]) === noteName(t.strings[n - 1]);
  if (same && s === 0) return `Low ${nm}`;
  if (same && s === n - 1) return `High ${nm}`;
  return nm;
}

/** @param {number} midi @param {string | Tuning} tuning */
export function stringOf(midi, tuning) {
  if (!Number.isFinite(midi)) return null;
  const t = tuningOf(tuning);
  let s = 0;
  for (let i = 1; i < t.strings.length; i++) if (Math.abs(t.strings[i] - midi) < Math.abs(t.strings[s] - midi)) s = i;
  const cents = Math.round((midi - t.strings[s]) * 1000) / 10;
  if (Math.abs(cents) > 350) return null;
  return { s, number: t.strings.length - s, name: stringName(t, s), open: t.strings[s], cents, near: Math.abs(cents) <= 100 };
}

const STD = '5,5,5,4,5', DROP = '7,5,5,4,5', STD7 = '5,5,5,5,4,5', DROP7 = '7,5,5,5,4,5';
/** @param {number[]} s */
const family = (s) => { const iv = s.slice(1).map((x, i) => x - s[i]).join(','); return iv === STD || iv === STD7 ? 'standard' : iv === DROP || iv === DROP7 ? 'drop' : null; };

/** @param {number} midi @param {{ tunings?: Record<string, Tuning>, strings?: number }} [o] */
export function tuningsFromLow(midi, { tunings = TUNER_TUNINGS, strings = 6 } = {}) {
  const m = Math.round(midi), out = [];
  for (const [id, t] of Object.entries(tunings || {})) {
    const s = t && Array.isArray(t.strings) ? t.strings : null;
    if (!s || s[0] !== m) continue;
    const f = family(s);
    if (f) out.push({ id, name: tuningName({ ...t, id }), strings: s.length, drop: f === 'drop' });
  }
  // (the asked-for string count first; drop C before C standard, B standard before drop B)
  out.sort((a, b) => (Number(b.strings === strings) - Number(a.strings === strings)) || (m >= 36 ? Number(b.drop) - Number(a.drop) : Number(a.drop) - Number(b.drop)));
  return out.map(({ id, name, strings: n }) => ({ id, name, strings: n }));
}

/** @param {number[]} heard @param {{ tunings?: Record<string, Tuning> }} [o] */
export function guessTuning(heard, { tunings = TUNER_TUNINGS } = {}) {
  const hs = [...new Set((heard || []).filter(Number.isFinite).map((x) => Math.round(x)))];
  if (!hs.length) return [];
  const out = [];
  for (const [id, t] of Object.entries(tunings || {})) {
    const s = t?.strings;
    if (!Array.isArray(s)) continue;
    const hits = hs.filter((m) => s.includes(m)).length;
    if (hits === hs.length) out.push({ id, name: tuningName({ ...t, id }), hits, of: s.length, low: s[0] });
  }
  // every heard string in it; the ones whose low string was heard first, then the fewest strings, then the familiar ones
  const order = Object.keys(tunings);
  out.sort((a, b) => Number(hs.includes(b.low)) - Number(hs.includes(a.low)) || a.of - b.of || order.indexOf(a.id) - order.indexOf(b.id));
  return out.map(({ id, name, hits, of }) => ({ id, name, hits, of }));
}

export const READING_NONE = Object.freeze({ live: false, held: false, hz: 0, midi: 0, p: 0, note: '', octave: 0, cents: null, shown: null, inTune: false, settled: false, string: null, db: -120, floor: -120, since: 0, conf: 0 });

/**
 * @param {{ tuning?: string | Tuning, lo?: number, hi?: number, tau?: [number, number], speed?: number, attack?: number, hold?: number,
 *   gate?: number, minConf?: number, change?: number }} [o]
 */
export function createSteadyTuner({ tuning = 'standard', lo = null, hi = 1400, tau = [0.06, 0.2], speed = 8, attack = 0.04, hold = 1.5, gate = 10, minConf = 0.5, change = 0.09 } = {}) {
  /** @type {Tuning | null} */
  let T = tuning == null ? null : tuningOf(tuning), LO = 30;
  // the range: from a fourth under the tuning's low string (tuned down that far, it still reads; an E5 power chord's
  // common period, E1, an octave under the low E, never does), or from 30 Hz with no tuning (finding out which)
  const range = () => { LO = lo ?? (T ? 440 * 2 ** ((T.strings[0] - 5 - 69) / 12) : 30); };
  range();
  const y = /** @type {any} */ ({}), qt = 2 ** (1 / 24);
  /** @type {any} */
  let S;
  const fresh = () => ({
    last: -1, floor: -100, dbs: /** @type {{ t: number, db: number }[]} */ ([]), prev: [-120], dv: 0, attackAt: -1e9, heardAt: -1e9, since: 0, p: 0, sm: 0, cand: 0, candAt: 0,
    hist: /** @type {number[]} */ ([]), near: 0, inTune: false, shown: /** @type {number | null} */ (null), conf: 0,
    reading: /** @type {any} */ (READING_NONE),
  });
  S = fresh();
  const api = {
    get reading() { return S.reading; },
    get tuning() { return T; },
    setTuning(/** @type {string | Tuning | null} */ t) { T = t == null ? null : tuningOf(t); range(); if (S.reading.p) S.reading = { ...S.reading, string: T ? stringOf(S.reading.midi, T) : null }; },
    reset() { S = fresh(); },
    /** @param {Float32Array} buf @param {number} sr @param {number} t */
    push(buf, sr, t) {
      const dt = S.last < 0 ? 0.04 : Math.max(0.001, Math.min(0.5, t - S.last));
      S.last = t;
      const db = dbOf(rms(buf));
      // the noise floor: the quietest look of the last 8 s (the hum and hiss between notes), never digital silence (an
      // analyser not yet filled)
      if (db > -140) S.dbs.push({ t, db: Math.max(-100, db) });
      while (S.dbs.length && S.dbs[0].t < t - 8) S.dbs.shift();
      S.floor = S.dbs.length ? Math.min(...S.dbs.map((x) => x.db)) : -100;
      // a new attack: 5 dB over the quietest of the last three looks (a pluck over a string still ringing rises over
      // two of them; a swell is slower, and that's fine)
      const onset = db - Math.min(...S.prev) > 5 && db > -70 && t - S.attackAt > 0.1;
      S.prev.push(db); if (S.prev.length > 3) S.prev.shift();
      if (onset) S.attackAt = t;
      // (the floor needs a quarter second of listening first: on a cold start, hum alone would read as a note)
      const open = S.dbs.length > 0 && db > Math.max(-75, S.floor + gate) && t - S.attackAt >= attack && t - S.dbs[0].t >= 0.24;
      let heard = false;
      if (open) {
        const holding = S.p && t - S.heardAt < 0.3 && t - S.attackAt > 0.25;
        yin(buf, sr, { lo: LO / qt, hi: hi * qt, out: y, hint: holding ? 440 * 2 ** ((S.sm - 69) / 12) : 0 });
        const m = y.hz > 0 ? ftom(y.hz) : 0;
        if (m && y.conf >= minConf && m >= ftom(LO) - 0.5 && m <= ftom(hi) + 0.5) {
          heard = true;
          S.conf = y.conf;
          // a median of the last three against one wild frame (only within a note: a new attack starts again)
          if (onset || (S.hist.length && Math.abs(m - S.hist[S.hist.length - 1]) > 0.6 && t - S.attackAt < 0.2)) S.hist.length = 0;
          S.hist.push(m); if (S.hist.length > 3) S.hist.shift();
          const mm = S.hist.length >= 3 ? median(S.hist) : m;
          const q = Math.round(mm), jump = !S.p || Math.abs(mm - S.sm) > 0.6;
          if (jump) {
            // a different note: at once after an attack, else once it has held `change` s (a slide, a wrong frame)
            if (q !== S.cand) { S.cand = q; S.candAt = t; }
            if (!S.p || t - S.attackAt < 0.25 || t - S.candAt >= change) {
              S.p = q; S.sm = mm; S.dv = 0; S.since = t; S.near = 1; S.inTune = false; S.shown = null; S.hist = [mm];
            }
          } else {
            S.cand = 0;
            // quick to get there, calmer as it holds, and quick again while the pitch moves one way (a pick's attack
            // settling, a peg turned: a one-euro filter, its cutoff rising with the reading's speed)
            S.dv += (1 - Math.exp(-dt / 0.16)) * ((mm - S.sm) / dt - S.dv);
            const age = t - S.since, base = Math.min(tau[1], tau[0] + age * 0.4);
            const tc = 1 / (1 / base + 2 * Math.PI * speed * Math.abs(S.dv)), a = 1 - Math.exp(-dt / tc);
            S.sm += a * (mm - S.sm);
            // the note's name follows the reading past the half-semitone, with a little hysteresis
            if (Math.abs(S.sm - S.p) > 0.55) S.p = Math.round(S.sm);
            S.near = Math.abs(mm - S.sm) < 0.1 ? S.near + 1 : 0;
          }
          S.heardAt = t;
        }
      }
      if (!heard && S.p && t - S.heardAt > hold) { S.p = 0; S.sm = 0; S.hist.length = 0; S.inTune = false; S.shown = null; S.near = 0; }
      if (!S.p) return (S.reading = { ...READING_NONE, db, floor: S.floor });
      const live = t - S.heardAt <= 0.15, settled = live && S.near >= 3 && t - S.attackAt > 0.1;
      const cents = settled ? Math.round((S.sm - S.p) * 1000) / 10 : null;
      if (cents != null) {
        if (S.shown == null || Math.abs(cents - S.shown) > 0.65) S.shown = Math.round(cents);
        S.inTune = S.inTune ? Math.abs(cents) <= 4 : Math.abs(cents) <= 2;
      }
      // (held, or the same string picked again and not settled yet: the last numbers stay, so the cents and the lamp
      // don't blink at every pick; a new note started them afresh)
      const midi = S.sm;
      return (S.reading = {
        live, held: !live, hz: 440 * 2 ** ((midi - 69) / 12), midi, p: S.p, note: noteName(S.p), octave: octaveOf(S.p),
        cents: live ? cents : S.reading.cents, shown: S.shown, inTune: S.inTune, settled: live ? settled : S.reading.settled,
        string: T ? stringOf(midi, T) : null, db, floor: S.floor, since: S.since, conf: S.conf,
      });
    },
  };
  return api;
}

// The window a tuner wants at a sample rate: a quarter of it holds the lowest period (E1, 41 Hz, and lower: 30 Hz)
export const windowFor = (/** @type {number} */ sr) => (sr > 50000 ? 8192 : 4096);
