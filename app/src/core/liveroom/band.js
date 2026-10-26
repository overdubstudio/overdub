// @ts-check
// The band [core] (docs/research/LIVE-ROOM-MODE.md §4.3-§4.5, §5): the drummer and the bass learning a part from the
// read of your take, the feels you direct them with, the finish on the master, and the bass you play yourself. Pure
// plans: each returns ops for one store.dispatch, made of existing ops (§9.3), with the step's label and its reason,
// and never dispatches. The same song, read and feel give the same band (seeded: `<section>:<feel>:<guide clip>`).
//
// Frozen (§14.2), each -> { ops, label, reason } (and a few words more for the room's lines, below):
//   guideOps(p, { section, from, bars, feel })     the pass's preview band: the part's feel with the kick on each bar's
//                                                  1 and the bass out, from `from` for `bars` (dispatched as
//                                                  store.preview, never kept): the house's clips there muted
//   planLearn(p, { section, read })                the house's step, reason room:learn:<section>: the read's notes on
//                                                  Riff (as heard), the drums and the bass from the read (only the
//                                                  house's untouched clips replaced), Guitar L's pan lane,
//                                                  room.part.set { feel, learned } (the song's key is the take's step:
//                                                  plans.js takeOps sets it from read.key)
//                                                  -> also { thin, kicks, bass, feel }
//   planFeel(p, { section, feel, busy, loud, force })   room.part.set and the part's drums (and the bass, which sits on
//                                                  the kick), signed by the house inside a step by you; from the part's
//                                                  Riff (as heard) clip. A drum clip someone else changed is theirs:
//                                                  -> { ops: [], edited: true } unless force
//   planFinish(p, { finish })                      the master's inserts, its clean end, the drums' Drum Riser for the
//                                                  finish, room.set { finish, managed.master } (the kitchen's is
//                                                  kitchen.js planKitchenFinish)
//   planBassYours(p, { section })                  Bass (yours) (an audio track into Y Cable Modern, armed) and the
//                                                  house's bass muted in the part, a step by you
// Kept from the prototype (a seam addition, §14.2):
//   bandFor(place, riff, { from, length, seed }) -> { drums, bass, from, length }   the notes of the place's band under
//       a riff: its grooves in 8-bar phrases (the twelve-bar at the blues bar) with a fill to end each and a crash to
//       start the next; the metal club's kick on your chugs; the bass doubling the riff an octave down (metal), on its
//       notes in eighths (punk) or walking the boogie through the changes (blues). riff: { n (beats), bpm, root (pitch
//       class), notes: [{ t (beats from the 1), p (MIDI, null unpitched), d }] }; null is the place's own groove.
// Also here (seam additions), for the stage, the checks and the bench:
//   bandNotes(p, section, { feel, busy, loud, riff, seed }) -> { drums, bass, groove, fills, kicks }   a part's band
//       (notes from the part's 1): riff as read.js gives one (notes with t on the grid and ms, chugs, roots, low,
//       thin) or null (the groove's own kick, the bass waiting). The End (a part named End, Outro, Ending) plays the
//       place's ending hit and the bass its root
//   riffIn(p, section) -> riff | null   a part's riff read back from its Riff (as heard) clip (read.js riffOf): its
//       notes as planLearn wrote them, where you played them, a palm mute (unpitched) on the floor at a velocity under
//       MUTE_V (0.35: DI Box plays a note under it palm-muted), a pitched note at MUTE_V or over
//   defaultFeel(p, section) -> a feel id   the part's feel, else the first its place offers for it
//   HOUSE_RULES: the kick's clamp (ms) and the bass's range

import { realize, getGroove, familyOf } from '../grooves.js';
import { beatsPerBar, parsePc } from '../music.js';
import { TUNINGS } from '../fretboard.js';
import { roomOf, partOf, NAMES, FINISHES } from './model.js';
import { placeOf, grooveOf, follows, fillsOf, feelsOf, partKey, finishChain, finishBus, chainHash, bandTracks } from './places.js';
import { riffOf } from './read.js';
import { roleTrack, panLaneOps } from './double.js';
import DRUMBUS from '../../devices/builtin/drumbus.js';
import BASSRIG from '../../devices/builtin/bassrig.js';
import { presetParams } from '../../devices/registry.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const none = () => ({ ops: [], label: '', reason: '' });
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const HOUSE = 'overdub';
export const MUTE_V = 0.35;
export const HOUSE_RULES = { kickMs: 15, bassLo: 23, bassHi: 47, eighthsOver: 150, quartersOver: 190 };
// How hard the drummer plays (Simpler · Busier, Softer · Louder; §4.4): every hit over a ghost's (0.4) scaled, a ghost
// left a ghost, held under the house rules' full (a fill's first hit at 1, the rest at 0.95). The house plays at TOUCH;
// each step is about 2 LU on the drums alone, measured (tools/liveroom/checks-band.js): Louder is the house rules'
// own touch, Softer as far under, Busier and Simpler with the fills, the kicks and the ghost notes they add or take.
export const TOUCH = { base: 0.72, loud: { '-1': 0.7, 1: 1.3 }, busy: { '-1': 0.88, 1: 1.25 } };
function touch(drums, busy, loud) {
  const k = TOUCH.base * (TOUCH.loud[loud] ?? 1) * (TOUCH.busy[busy] ?? 1);
  return drums.map((n) => (n.v <= 0.4 + EPS ? n : { ...n, v: r4(clamp(n.v * k, 0.41, n.v >= 0.999 ? 1 : 0.95)) }));
}
const KICKS = new Set([35, 36]), CRASH = 49, HAT = 42, SNARE = 38;
const SWAP = new Set([49, 57, 51, 59, 53, 55]);   // the crashes and the ride: Softer plays the hats instead

/* ------------------------------------------------------------------------------------------------ the song's parts */
const sectionOf = (p, s) => (isObj(s) ? (p?.sections || []).find((x) => x.id === s.id) || s : (p?.sections || []).find((x) => x.id === s) || null);
const sorted = (p) => (p?.sections || []).slice().sort((a, b) => a.start - b.start);
const overlaps = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start) > 0.05;
const within = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start) > 0.25;
const placeId = (p) => { const r = roomOf(p); return r && r.place && r.place !== 'kitchen' ? placeOf(r.place).id : 'metal'; };
// still the house's: made by it and every note in it its own
export const isHouse = (c) => c.by === HOUSE && (c.kind !== 'notes' || (c.notes || []).every((n) => (n.by ?? c.by) === HOUSE));
// the take playing on the left side in a part: the guide the band learns from
export function guideOf(p, s) {
  const t = roleTrack(p, 'guitarL') || roleTrack(p, 'guitar');
  if (!t || !s) return null;
  const on = t.clips.filter((c) => c.kind === 'audio' && !c.mute && within(c, s));
  return on.length ? on[on.length - 1].id : null;
}
export function defaultFeel(p, s) {
  const part = partOf(p, s);
  if (part?.feel) return part.feel;
  return feelsOf(placeId(p), s?.name, p?.tempo)[0] || null;
}
const nextOf = (p, s) => sorted(p).find((x) => x.id !== s.id && Math.abs(x.start - (s.start + s.length)) < EPS) || null;

/* ------------------------------------------------------------------------------------------------ a part's riff */
// The part's Riff (as heard) clip read back: its notes (where you played them) on the place's grid, with the ms each
// sat off it, looped over the part when the clip is shorter (a ×2 part repeats its riff).
export function riffIn(p, section) {
  const s = sectionOf(p, section), t = roleTrack(p, 'heard');
  if (!s || !t) return null;
  const c = t.clips.filter((x) => x.kind === 'notes' && overlaps(x, s)).sort((a, b) => a.start - b.start)[0];
  if (!c) return null;
  const span = Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start);
  const learned = partOf(p, s)?.learned;
  return heardRiff(p, s, c.notes.map((n) => ({ ...n, t: c.start + n.t - s.start })), span, learned && typeof learned.thin === 'boolean' ? learned.thin : null);
}
// the riff from heard notes (t from the part's 1, where they were played), looped over the part
function heardRiff(p, s, heard, span, thin = null) {
  const P = placeOf(placeId(p)), spb = 60 / (p.tempo || 120), step = 1 / P.grid;
  const raw = heard.map((n) => { const mute = (n.v ?? 0.8) < MUTE_V; return { t: n.t, p: mute ? null : n.p, d: n.d, v: n.v ?? 0.8, db: mute ? (n.v - 0.22) * 50 : (n.v - 0.7) * 20 }; })
    .filter((n) => n.t > -step * 0.5 && n.t < span - step * 0.5);
  const period = span >= s.length - EPS ? s.length : Math.max(step, span);
  const notes = [], seen = new Set();
  for (let k = 0; k * period < s.length - EPS; k++) {
    for (const n of raw) {
      const g = Math.round(n.t / step) * step, at = g + k * period;
      if (at < -EPS || at >= s.length - EPS || seen.has(Math.round(at * 1000))) continue;
      seen.add(Math.round(at * 1000));
      notes.push({ t: r4(at), p: n.p, d: n.d, v: n.v, db: Math.round(n.db * 10) / 10, ms: Math.round((n.t - g) * spb * 10000) / 10 });
    }
  }
  notes.sort((a, b) => a.t - b.t);
  const r = riffOf(notes, { beats: Math.round(s.length) });
  return { notes, chugs: r.chugs, roots: r.roots, low: r.low, thin: thin ?? (notes.length < 8 || !r.roots.some((x) => x != null)) };
}

/* ------------------------------------------------------------------------------------------------ the band's notes */
const RANK = { intro: 0, half: 1, bridge: 1, verse: 2, prechorus: 2, outro: 2, chorus: 3 };
// a pitch class at or over `lo`, folded by octaves into the bass's range (B0-B2): an octave down when it lands over the
// top, never another note
const pitchIn = (pc, lo) => {
  let x = lo + ((((pc - lo) % 12) + 12) % 12);
  while (x > HOUSE_RULES.bassHi) x -= 12;
  while (x < HOUSE_RULES.bassLo) x += 12;
  return x;
};
function keyRoot(p) {
  const k = p?.key;
  const pc = k && typeof k === 'object' ? parsePc(k.root) : typeof k === 'string' ? parsePc(k.split(/\s/)[0]) : NaN;
  return Number.isFinite(pc) ? pc : null;
}
// the bottom of the bass's octave: the riff's lowest note an octave down (B0 at the lowest: Roundwound is a five-string)
function bassFloor(p, riff) {
  if (riff && riff.low != null) return Math.max(HOUSE_RULES.bassLo, riff.low - 12);
  const t = TUNINGS[roomOf(p)?.tuning];
  return t ? Math.max(HOUSE_RULES.bassLo, t.strings[0] - 12) : 28;
}
// a seeded wobble for the notes the room writes itself (the grooves have their own)
function wobble(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

export function bandNotes(p, section, { feel = null, busy = 0, loud = 0, riff = null, seed = null } = {}) {
  const s = sectionOf(p, section);
  if (!s) return { drums: [], bass: [], groove: null, fills: [], kicks: 0 };
  const P = placeOf(placeId(p)), tempo = p.tempo || P.prefer, bpb = beatsPerBar(p.meter || [4, 4]), len = s.length, spb = 60 / tempo;
  const part = partKey(s.name), F = fillsOf(P.id, tempo), W = wobble(String(seed ?? s.id));
  const B = HOUSE_RULES;
  /* the End: the place's ending hit, the bass its root */
  if (part === 'outro') {
    const eg = getGroove(F.ending), off = eg ? Math.max(0, eg.length - len) : 0;
    const drums = eg ? realize(eg.id, { tempo, seed: String(seed ?? s.id), length: Math.min(len, eg.length), offset: off, rules: 'band' }) : [];
    if (!drums.some((n) => n.t < 0.06 && n.p === CRASH)) drums.push({ p: CRASH, t: 0, d: 1, v: 0.95 });
    if (!drums.some((n) => n.t < 0.06 && KICKS.has(n.p))) drums.push({ p: 36, t: 0, d: 0.25, v: 0.95 });
    const root = keyRoot(p) ?? riff?.roots?.find((r) => r != null) ?? null;
    const bass = root == null ? [] : [{ p: pitchIn(root, bassFloor(p, riff)), t: 0, d: r4(Math.min(len, bpb) - 0.05), v: 0.9 }];
    return { drums: touch(drums.sort((a, b) => a.t - b.t || a.p - b.p), 0, 0), bass, groove: F.ending, fills: [], kicks: 0 };
  }
  const want = feel && grooveOf(P.id, feel, tempo) ? feel : feelsOf(P.id, s.name, tempo)[0];
  const gid = (want && grooveOf(P.id, want, tempo)) || P.drums.verse;
  const sd = String(seed ?? `${s.id}:${want}`);
  /* the fills: one at each phrase's end (8 bars; Busier 4; the blues bar's twelve, its turnaround), and into the next
     part by how it moves (a bar going up, two beats coming down, one between equals); Simpler none. Into a part with
     its drop on, the drummer stops for the last beat */
  const next = nextOf(p, s), drop = !!(next && partOf(p, next)?.drop);
  const fills = [];
  const fillAt = (gidF, end) => { const g = getGroove(gidF); if (g && g.length < len - EPS && end - g.length > -EPS) fills.push({ groove: g.id, from: r4(end - g.length), to: r4(end) }); };
  const silentFrom = drop ? len - 1 : len;
  if (drop) fillAt(F.drop, silentFrom);
  else if (busy >= 0 && next) {
    const into = partKey(next.name), up = (RANK[into] ?? 2) - (RANK[part] ?? 2);
    // (into a breakdown, round the kit into the drop, its drop on or off)
    fillAt(P.id === 'bluesbar' ? F.bar : into === 'half' ? F.drop : up > 0 ? (len >= 4 * bpb ? F.bar : F.two) : up < 0 ? F.two : F.one, len);
  }
  if (busy >= 0) {
    const phrase = (P.id === 'bluesbar' ? 12 : busy > 0 ? 4 : 8) * bpb;
    for (let e = phrase; e < len - EPS; e += phrase) fillAt(P.id === 'bluesbar' ? F.bar : F.one, e);
  }
  const inFill = (t) => fills.some((f) => t >= f.from - EPS && t < f.to - EPS);
  /* the groove, then the fills over it */
  let drums = realize(gid, { tempo, seed: sd, length: len, rules: 'band' }).filter((n) => !inFill(n.t));
  fills.forEach((f, i) => { for (const n of realize(f.groove, { tempo, seed: `${sd}:fill${i}`, length: f.to - f.from, rules: 'band' })) drums.push({ ...n, t: r4(n.t + f.from) }); });
  /* the kick on your chugs (a feel that follows, a read that isn't thin): where you picked each one, within 15 ms of
     its grid point, one per grid point; Simpler only the first of each run */
  let kicks = 0;
  const useRiff = riff && !riff.thin && Array.isArray(riff.chugs) && riff.chugs.length;
  let hits = [];
  if (useRiff) {
    const step = 1 / P.grid;
    hits = riff.chugs.filter((c) => c.t >= -EPS && c.t < silentFrom - EPS);
    // Simpler: the kick on the accents, the first chug of each run within a beat and the loud ones
    const loudDb = median(hits.map((c) => c.db).filter(Number.isFinite));
    const accent = (c) => Math.abs(c.t / bpb - Math.round(c.t / bpb)) < EPS || (loudDb != null && Number.isFinite(c.db) && c.db >= loudDb + 6);
    hits = hits.map((c) => ({ ...c, accent: accent(c) }));
    if (busy < 0) hits = hits.filter((c) => c.accent || !hits.some((o) => o.t < c.t - EPS && c.t - o.t <= step + EPS && Math.floor(o.t + EPS) === Math.floor(c.t + EPS)));
    hits = hits.map((c) => ({ ...c, at: r4(clamp(c.t + (clamp(c.ms || 0, -B.kickMs, B.kickMs) / 1000) / spb, 0, len - 1 / 64)) }));
  }
  if (useRiff && P.drums.follow && follows(want)) {
    drums = drums.filter((n) => !(KICKS.has(n.p) && !inFill(n.t)));
    for (const c of hits) {
      if (inFill(c.t)) continue;
      drums.push({ p: 36, t: c.at, d: 0.25, v: r4(c.accent ? 0.95 : 0.82 * (0.97 + 0.06 * W())) });
      kicks++;
    }
  }
  /* Busier: ghost notes on the snare before each backbeat */
  if (busy > 0) {
    for (const n of drums.filter((x) => x.p === SNARE && x.v >= 0.8 && !inFill(x.t))) {
      const t = r4(n.t - 0.25);
      if (t > 0 && !drums.some((x) => familyOf(x.p) === 'snare' && Math.abs(x.t - t) < 0.1)) drums.push({ p: SNARE, t, d: 0.125, v: r4(0.18 + 0.12 * W()) });
    }
  }
  /* Softer · Louder: the hats for the crash and the ride; a crash on every bar's 1 */
  if (loud < 0) drums = drums.map((n) => ({ ...n, p: SWAP.has(n.p) && !(n.t < 0.06) ? HAT : n.p }));
  if (loud > 0) {
    for (let b = bpb; b < silentFrom - EPS; b += bpb) {
      if (inFill(b)) continue;
      drums = drums.filter((n) => !(Math.abs(n.t - b) < 0.06 && (familyOf(n.p) === 'hat' || familyOf(n.p) === 'ride')));
      if (!drums.some((n) => n.p === CRASH && Math.abs(n.t - b) < 0.06)) drums.push({ p: CRASH, t: b, d: 1, v: 0.9 });
    }
  }
  /* the part's 1: a crash and the kick (the hand leaves the hats for it) */
  drums = drums.filter((n) => !(n.t < 0.06 && (familyOf(n.p) === 'hat' || familyOf(n.p) === 'ride')));
  if (!drums.some((n) => n.t < 0.06 && n.p === CRASH)) drums.push({ p: CRASH, t: 0, d: 1, v: 0.95 });
  if (!drums.some((n) => n.t < 0.06 && KICKS.has(n.p))) drums.push({ p: 36, t: 0, d: 0.25, v: 0.95 });
  drums = drums.filter((n) => n.t < silentFrom - EPS && n.t >= 0).sort((a, b) => a.t - b.t || a.p - b.p);
  drums = touch(drums, busy, loud);
  /* the bass */
  const bass = bassNotes(p, s, { P, riff: useRiff ? riff : null, hits, tempo, len, bpb, silentFrom });
  return { drums, bass, groove: gid, fills, kicks, feel: want };
}

function bassNotes(p, s, { P, riff, hits, tempo, len, bpb, silentFrom }) {
  const out = [], B = HOUSE_RULES;
  const rootAt = (t) => (riff ? riff.roots[clamp(Math.floor(t + EPS), 0, riff.roots.length - 1)] : null);
  // where the riff sounds: the bass rests wherever you rest for a beat or more
  const sounding = (a, b) => !!riff && riff.notes.some((n) => n.t < b - EPS && n.t + n.d > a + EPS);
  if (P.bass.mode === 'roots') {
    if (!riff) return out;
    const lo = bassFloor(p, riff);
    // simpler when fast: runs of sixteenths become eighths over 150 BPM, quarters over 190
    let at = hits.map((c) => ({ t: c.t, at: c.at, v: c.v ?? 0.8, d: (riff.notes.find((n) => Math.abs(n.t - c.t) < EPS) || {}).d || 0.25 }));
    const grain = tempo > B.quartersOver ? 1 : tempo > B.eighthsOver ? 0.5 : 0;
    if (grain) at = at.filter((c) => { const off = Math.abs(c.t / grain - Math.round(c.t / grain)) > EPS; return !(off && at.some((o) => o.t < c.t - EPS && c.t - o.t < grain + EPS)); });
    at.forEach((c, i) => {
      const pc = rootAt(c.t);
      if (pc == null) return;
      const nextT = i + 1 < at.length ? at[i + 1].t : silentFrom;
      const end = c.t + c.d, rest = nextT - end >= 1 - EPS && !sounding(end, nextT);
      const d = r4(Math.max(0.2, rest ? c.d : nextT - c.t - 0.03));
      const accent = Math.abs(c.t / bpb - Math.round(c.t / bpb)) < EPS || c.v >= 0.99;
      out.push({ p: pitchIn(pc, lo), t: c.at, d: Math.min(d, r4(len - c.at - 0.01)), v: accent ? 0.92 : 0.8 });
    });
    return out;
  }
  if (P.bass.mode === 'eighths') {
    if (!riff) return out;
    const lo = bassFloor(p, riff);
    for (let e = 0; e < silentFrom - EPS; e += 0.5) {
      const b = Math.floor(e + EPS);
      if (!sounding(b, b + 1)) continue;
      const pc = rootAt(e);
      if (pc != null) out.push({ p: pitchIn(pc, lo), t: r4(e), d: 0.42, v: Math.abs(e - Math.round(e)) < EPS ? 0.92 : 0.78 });
    }
    return out;
  }
  if (P.bass.mode === 'boogie') {
    // the boogie through the twelve-bar from the song's key (chosen before the count), R 3 5 6 b7 6 5 3 on the
    // shuffle's long-short eighths
    const root = keyRoot(p) ?? riff?.roots?.find((r) => r != null) ?? null;
    if (root == null) return out;
    const ivs = [0, 4, 7, 9, 10, 9, 7, 4], at = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
    for (let bar = 0; bar * bpb < silentFrom - EPS; bar++) {
      const step = P.form[bar % P.form.length], r = pitchIn((root + step) % 12, 28);
      at.forEach((x, j) => { const t = bar * bpb + x; if (t < silentFrom - EPS) out.push({ p: r + ivs[j], t: r4(t), d: j % 2 ? 0.3 : 0.6, v: j % 2 ? 0.72 : 0.9 }); });
    }
    return out;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the role tracks */
// A role's track, or the ops that make it (from its place's setup) and its room.set tracks entry, gathered so a plan
// names all the roles it made in one room.set.
function roles(p) {
  const made = {}, ops = [];
  const get = (role) => {
    const t = roleTrack(p, role);
    if (t) return t.id;
    if (made[role]) return made[role];
    const P = placeOf(placeId(p)), bt = bandTracks(P.id);
    const def = role === 'drums' ? bt.drums : role === 'bass' ? bt.bass : role === 'heard' ? { name: 'Riff (as heard)', kind: 'instrument', color: 'var(--c-6)', instrument: { device: 'core.guitar', params: { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 6, mute: 1 } }, inserts: [], gain: 0, pan: 0, mute: true, by: HOUSE } : null;
    if (!def) return null;
    const { role: _r, later: _l, ...track } = /** @type {any} */ (def);
    ops.push({ type: 'track.add', ref: `room_${role}`, track });
    made[role] = `$room_${role}`;
    return made[role];
  };
  const finish = () => {
    if (!Object.keys(made).length) return [];
    const room = roomOf(p);
    return [{ type: 'room.set', patch: { tracks: { ...(isObj(room?.tracks) ? room.tracks : {}), ...made } } }];
  };
  return { get, ops, finish, made };
}

// Ops that put `notes` on a role's track over the part: the house's own clips there go (split at the part's edges
// when they run past them); a clip anyone else made or changed stays, and then nothing is written. -> { ops, kept }
function replaceOps(p, trackId, s, notes, { name = 'Band', force = false, mute = false } = {}) {
  const t = (p.tracks || []).find((x) => x.id === trackId);
  const ops = [];
  const here = t ? t.clips.filter((c) => overlaps(c, s)) : [];
  if (!force && here.some((c) => !isHouse(c))) return { ops: [], kept: true };
  let n = 0;
  for (const c of here) {
    const a = c.start, b = c.start + c.length, s0 = s.start, s1 = s.start + s.length;
    if (a >= s0 - EPS && b <= s1 + EPS) { ops.push({ type: 'clip.remove', track: trackId, clip: c.id }); continue; }
    // (a clip across the part's edges: cut there, and only the piece inside goes)
    let inside = c.id;
    if (a < s0 - EPS) { const ref = `cut_${c.id}_${n++}`; ops.push({ type: 'clip.split', track: trackId, clip: c.id, at: s0, ref }); inside = `$${ref}`; }
    if (b > s1 + EPS) { ops.push({ type: 'clip.split', track: trackId, clip: inside, at: s1, ref: `cut_${c.id}_${n++}` }); }
    ops.push({ type: 'clip.remove', track: trackId, clip: inside });
  }
  if (notes.length) ops.push({ type: 'clip.add', track: trackId, clip: { kind: 'notes', start: s.start, length: s.length, name, by: HOUSE, ...(mute ? { mute: true } : {}), notes: notes.map((x) => ({ p: x.p, t: x.t, d: x.d, v: x.v, by: HOUSE })) } });
  return { ops, kept: false };
}

/* ------------------------------------------------------------------------------------------------ the plans */
export function guideOps(p, { section = null, from = 0, bars = 0, feel = null } = {}) {
  const s = section ? sectionOf(p, section) : null;
  const P = placeOf(placeId(p)), tempo = p.tempo || P.prefer, bpb = beatsPerBar(p.meter || [4, 4]);
  const start = s ? s.start : from, n = Math.max(1, Math.round(bars || (s ? s.length / bpb : 8)));
  const len = n * bpb, name = s ? s.name : P.parts[0];
  const want = feel && grooveOf(P.id, feel, tempo) ? feel : feelsOf(P.id, name, tempo)[0];
  const gid = (want && grooveOf(P.id, want, tempo)) || P.drums.verse;
  // time, with the kick only on each bar's 1 (a drummer who hasn't heard the riff), a crash to start
  let drums = realize(gid, { tempo, seed: `guide:${s ? s.id : start}:${want}`, length: len, rules: 'band' }).filter((x) => !KICKS.has(x.p));
  drums = drums.filter((x) => !(x.t < 0.06 && (familyOf(x.p) === 'hat' || familyOf(x.p) === 'ride')));
  for (let b = 0; b < len - EPS; b += bpb) drums.push({ p: 36, t: b, d: 0.25, v: b === 0 ? 0.95 : 0.9 });
  drums.push({ p: CRASH, t: 0, d: 1, v: 0.92 });
  drums.sort((a, b) => a.t - b.t || a.p - b.p);
  const R = roles(p), ops = [];
  const drumsId = R.get('drums');
  const span = { start, length: len };
  // the house's band there sits out while you play (a preview: nothing of this is kept)
  for (const role of ['drums', 'bass']) {
    const t = roleTrack(p, role);
    if (t) for (const c of t.clips) if (overlaps(c, span) && !c.mute) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { mute: true } });
  }
  ops.push({ type: 'clip.add', track: drumsId, clip: { kind: 'notes', start, length: len, name: 'Time', by: HOUSE, notes: drums.map((x) => ({ ...x, by: HOUSE })) } });
  return { ops: [...R.ops, ...ops, ...R.finish()], label: 'The band keeps time', reason: `room:guide:${s ? s.id : start}`, feel: want };
}

export function planLearn(p, { section = null, read = null } = {}) {
  const s = sectionOf(p, section);
  if (!s || !read) return none();
  const P = placeOf(placeId(p)), tempo = p.tempo || P.prefer, spb = 60 / tempo, part = partOf(p, s) || {};
  const R = roles(p), ops = [];
  const heard = R.get('heard'), drumsId = R.get('drums'), bassId = R.get('bass');
  // the riff as heard: every note where you played it (its grid point and its ms), its velocity its level against the
  // part's; an unpitched one (a palm mute: rhythm) on the floor under MUTE_V, as DI Box plays a palm mute, so it reads
  // back as rhythm (riffIn)
  const floorP = read.low ?? 40;
  const notes = (read.notes || []).filter((n) => n.t >= -EPS && n.t < s.length - EPS).map((n) => {
    const v = n.v ?? 0.8;
    return { p: n.p ?? floorP, t: r4(Math.max(0, n.t + ((n.ms || 0) / 1000) / spb)), d: r4(Math.max(0.05, Math.min(n.d, s.length - n.t))), v: r4(n.p == null ? clamp(0.22 + (v - 0.7) * 0.4, 0.1, 0.34) : clamp(v, MUTE_V, 1)) };
  });
  const hp = replaceOps(p, heard.startsWith('$') ? '' : heard, s, notes, { name: 'As heard' });
  if (heard.startsWith('$')) ops.push({ type: 'clip.add', track: heard, clip: { kind: 'notes', start: s.start, length: s.length, name: 'As heard', by: HOUSE, notes: notes.map((x) => ({ ...x, by: HOUSE })) } });
  else ops.push(...hp.ops);
  const guide = guideOf(p, s);
  const feel = part.feel || feelsOf(P.id, s.name, tempo)[0] || null;
  // (the band from the riff as the clip now holds it, so learning it and choosing a feel later play the same band)
  const riff = heardRiff(p, s, notes, s.length, !!read.thin);
  const band = bandNotes(p, s, { feel, busy: part.busy || 0, loud: part.loud || 0, riff, seed: `${s.id}:${feel}:${guide || 'none'}` });
  const put = (id, ns, name) => {
    if (id.startsWith('$')) { if (ns.length) ops.push({ type: 'clip.add', track: id, clip: { kind: 'notes', start: s.start, length: s.length, name, by: HOUSE, notes: ns.map((x) => ({ ...x, by: HOUSE })) } }); return false; }
    const r = replaceOps(p, id, s, ns, { name });
    ops.push(...r.ops);
    return r.kept;
  };
  const keptDrums = put(drumsId, band.drums, `${NAMES.feel[band.feel] || 'Drums'}`);
  const keptBass = put(bassId, band.bass, 'Bass');
  const learned = { ...(guide ? { from: guide } : {}), thin: !!read.thin };
  ops.push({ type: 'room.part.set', section: s.id, patch: { ...(part.feel ? {} : feel ? { feel } : {}), learned } });
  ops.push(...R.finish());
  ops.push(...panLaneOps(p));
  // (the role tracks first, then what goes on them)
  return {
    ops: [...R.ops, ...ops], label: `The band learned the ${String(s.name).toLowerCase()}`, reason: `room:learn:${s.id}`,
    thin: !!read.thin, kicks: band.kicks, bass: band.bass.length > 0, feel: band.feel, kept: { drums: keptDrums, bass: keptBass },
  };
}

export function planFeel(p, { section = null, feel = null, busy = 0, loud = 0, force = false } = {}) {
  const s = sectionOf(p, section);
  if (!s) return none();
  const P = placeOf(placeId(p)), tempo = p.tempo || P.prefer, part = partOf(p, s) || {};
  const f = feel && grooveOf(P.id, feel, tempo) ? feel : part.feel || feelsOf(P.id, s.name, tempo)[0];
  const bz = clamp(Math.round(busy || 0), -1, 1), ld = clamp(Math.round(loud || 0), -1, 1);
  const R = roles(p), ops = [];
  const drumsId = R.get('drums'), bassId = R.get('bass');
  const dt = roleTrack(p, 'drums');
  if (!force && dt && dt.clips.some((c) => overlaps(c, s) && !isHouse(c))) return { ops: [], label: '', reason: '', edited: true };
  const riff = riffIn(p, s), guide = guideOf(p, s);
  const band = bandNotes(p, s, { feel: f, busy: bz, loud: ld, riff, seed: `${s.id}:${f}:${guide || 'none'}` });
  const put = (id, ns, name) => {
    if (id.startsWith('$')) { if (ns.length) ops.push({ type: 'clip.add', track: id, clip: { kind: 'notes', start: s.start, length: s.length, name, by: HOUSE, notes: ns.map((x) => ({ ...x, by: HOUSE })) } }); return; }
    ops.push(...replaceOps(p, id, s, ns, { name, force: id === drumsId && force }).ops);
  };
  put(drumsId, band.drums, NAMES.feel[band.feel] || 'Drums');
  put(bassId, band.bass, 'Bass');
  ops.push({ type: 'room.part.set', section: s.id, patch: { feel: band.feel || null, busy: bz || null, loud: ld || null } });
  ops.push(...R.finish());
  const what = [NAMES.feel[band.feel], bz < 0 ? 'simpler' : bz > 0 ? 'busier' : null, ld < 0 ? 'softer' : ld > 0 ? 'louder' : null].filter(Boolean).join(', ');
  return { ops: [...R.ops, ...ops], label: `${what} on the ${String(s.name).toLowerCase()}`, reason: `room:feel:${s.id}`, feel: band.feel, kicks: band.kicks };
}

export function planFinish(p, { finish = null } = {}) {
  const room = roomOf(p), P = placeOf(placeId(p));
  if (room?.place === 'kitchen') return none();
  const id = finishId(P.id, finish);
  const chain = finishChain(P.id, id);
  const ops = [];
  for (const fx of p.master?.inserts || []) ops.push({ type: 'insert.remove', track: 'master', insert: fx.id });
  for (const fx of chain) ops.push({ type: 'insert.add', track: 'master', insert: { device: fx.device, params: { ...fx.params }, on: fx.on !== false } });
  if (p.master?.clip !== 'clean') ops.push({ type: 'master.set', patch: { clip: 'clean' } });
  // the drums' Drum Riser for the finish (the Room finishes open the kit)
  const dt = roleTrack(p, 'drums'), busName = finishBus(P.id, id);
  const bus = dt?.inserts?.find((x) => x.device === 'core.drumbus');
  if (bus && busName) {
    const want = presetParams(DRUMBUS, busName) || {};
    if (Object.keys(want).some((k) => bus.params?.[k] !== want[k])) ops.push({ type: 'insert.set', track: dt.id, insert: bus.id, patch: { params: want } });
  }
  const managed = { ...(isObj(room?.managed) ? room.managed : {}), master: { ...(isObj(room?.managed?.master) ? room.managed.master : {}), chain: chainHash(chain) } };
  ops.push({ type: 'room.set', patch: { finish: id, managed } });
  return { ops, label: `${NAMES.finish?.[id] || id} on the master`, reason: 'room:finish', finish: id };
}
const finishId = (place, f) => (FINISHES[place].includes(f) ? f : FINISHES[place][0]);

export function planBassYours(p, { section = null } = {}) {
  const s = sectionOf(p, section);
  if (!s) return none();
  const ops = [], room = roomOf(p);
  let id = roleTrack(p, 'bassYours')?.id || null;
  if (!id) {
    const bt = roleTrack(p, 'bass');
    ops.push({ type: 'track.add', ref: 'room_bassYours', track: { name: 'Bass (yours)', kind: 'audio', color: 'var(--c-5)', inserts: [{ device: 'core.bassrig', params: presetParams(BASSRIG, 'Modern') || {}, on: true }], gain: bt ? bt.gain : -3.5, pan: 0, arm: true, by: 'you' } });
    ops.push({ type: 'room.set', patch: { tracks: { ...(isObj(room?.tracks) ? room.tracks : {}), bassYours: '$room_bassYours' } } });
    id = '$room_bassYours';
  } else if (!roleTrack(p, 'bassYours').arm) ops.push({ type: 'track.set', track: id, patch: { arm: true } });
  for (const role of ['guitarL', 'guitarR', 'guitar']) { const t = roleTrack(p, role); if (t?.arm) ops.push({ type: 'track.set', track: t.id, patch: { arm: false } }); }
  // the house's bass sits out in the part (muted, not removed)
  const b = roleTrack(p, 'bass');
  if (b) for (const c of b.clips) if (overlaps(c, s) && !c.mute) ops.push({ type: 'clip.set', track: b.id, clip: c.id, patch: { mute: true } });
  return { ops, label: `Your bass on the ${String(s.name).toLowerCase()}`, reason: `room:bass:${s.id}` };
}

/* ------------------------------------------------------------------------------------------------ the prototype's band */
const fold = (p, lo, hi) => { let x = Math.round(p); while (x > hi) x -= 12; while (x < lo) x += 12; return x; };
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
  const Bm = P.bass, root = riff ? riff.root : 4, rootP = fold(root + 24, 28, 39);
  const mode = Bm.mode === 'roots' ? (rn.length ? 'double' : 'eighths') : Bm.mode;
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
