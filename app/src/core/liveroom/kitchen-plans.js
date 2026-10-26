// @ts-check
// (kitchen.js is the frozen seam, §14.2: seven of these names.)
// The kitchen table [core] (docs/research/LIVE-ROOM-MODE.md §6): a voice and a guitar on one or two mics, the paper's
// chords, the players who come in under a work tape. Pure plans, each -> { ops, label, reason } for one
// store.dispatch (§9.3); no DOM, no Math.random (the players' notes are seeded from the song).
//
// Frozen (§14.2):
//   kitchenSetup({ mic }) -> { tempo, meter, grid, count, tracks, master, feels, form, names }   the kitchen's
//       places.js setupOf. tracks: [{ role, name, kind: 'audio', inserts: [{ device, params, on }], gain, pan,
//       input: { device, channel } }] (the take track, or Voice and Guitar with mic 'two'; the players' tracks are
//       made by planPlayer, once, when a player is kept); master: the Bare finish's inserts; count: no count at all
//       (voice 'none': the work tape); names: each role's track name
//   planRead(p, { take, sheet })          (take.counted: a take counted in, on the song's grid already: no time read)
//       the house's read of a work tape: the song's sections from the paper as the
//       take played it, room.parts[s].sheet, a muted Chords track with one clip per chord, the take's trim, the sounding
//       key, room.takes. take: { track, clip, read } (read: tape.js readTape's { result, chroma, level }); sheet: the
//       paper (the song's when left out). With no tempo map from this take yet, the found reading's grid comes first.
//       Also returns { chords: [{ section, name, chords: [sym] }], form: [{ section, name, times }], unknown: [sym],
//       moves (free time over a fifth of the take), skipped: [names] }
//   planTime(p, { take, reading })        the time you kept: the meter, tempo.map from the reading (audio/analyze/
//       toOps.js's form: anchors, the clip, clipStart), the take placed on it, and the band re-timed (the read, the
//       players' clips) on the new grid. reading: a reading id ('found', 'double', 'half', 'downbeat') or one of
//       take.read.result.readings
//   planPlayer(p, { player, section, free? })    a player's track (once, at its level) and its clip in each section
//       given (a section id, a list, or left out: where the player is offered, offerSections). The step is yours, its
//       clip the house's. free: the master take's free time (its read's result.free, seconds), where the player rests
//       (the song keeps no read, so whoever holds it passes it)
//   planMaster(p, { clip, read })         room.set master; with that take's read, the time and the band from it
//   planKitchenFinish(p, { finish })      the master's chain for a finish (bare, warm, close) and room.set finish
//   offeredKitchen(view, run) -> { id, label, key } | null   the kitchen's offered move (§7.4: Start the tape -> the
//       read's question -> the next player's offer -> Again -> Hear it all)
// And:
//   PLAYERS, PLAYER_ORDER, FEEL_GROOVES, TAKE_LEVEL      the band and where the take sits
//   kitchenOps(p, { mic }) -> { ops, label, reason }     the setup as ops (planPlace may use it whole): the tracks,
//       room.set { place, mic, finish, tracks }, the master's chain, and the kitchen's tempo on a song with nothing in it
//   offerSections(p, player) -> [section ids]            where a player is offered: the shaker the choruses, the cajón
//       the verses, the bass from the first chorus on, the strings the bridge (none without one)
//   chordsTimeline(p) -> [{ a, b, chord, name }]         the Chords track as sounding chords, in song beats
//   playerNotes(p, player, section, { free }) -> notes   what a player plays over a section (beats from its start)
//   finishChain(finish) -> [{ device, params, on }]
//   takeName(p, n, { capo, bpm }) -> 'Paper Moon · take 1 · capo 2'
//   after(p, ops) -> p'                                    a copy of the song with ops applied (nothing dispatched)
//   fromTakeOps(p, { take, capo }) -> { ops, label, reason, line }   a blank paper written from the take's own chords
//       (chords-only lines under section headings, the house's), in the shapes the capo gives

import { readChord, sheetChords, transposeChord, soundingKey, shapesKey, keyName, keyOfChords } from './sheet-text.js';
import { alignChords, formOf, timeWords } from './tape.js';
import { roomOf, sheetOf, NAMES } from './model.js';
import { beatsPerBar, mapSec, mapBeat, parsePc } from '../music.js';
import { getGroove, realize } from '../grooves.js';
import { bassLine, voice, genericRows, strongOffsets } from '../arrange.js';
import { QUALITIES } from '../jam.js';
import { rng } from '../transforms.js';
import { createStore } from '../store.js';

const HOUSE = 'overdub';
const EPS = 1e-6;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const none = () => ({ ops: [], label: '', reason: '' });

/* ------------------------------------------------------------------------------------------------ the chains */
// Slide Rule's band types by index (core.eq8): BELL 0, LOW SHELF 1, HIGH SHELF 2, LOW CUT 12 3, LOW CUT 24 4
const EQ_TYPE = { bell: 0, lowshelf: 1, highshelf: 2, lowcut: 3, lowcut24: 4 };
function eq(bands, out = 0) {
  const P = {};
  bands.forEach((b, i) => {
    const n = i + 1;
    P[`b${n}_on`] = 1; P[`b${n}_type`] = EQ_TYPE[b.type]; P[`b${n}_freq`] = b.freq; P[`b${n}_gain`] = b.gain || 0; P[`b${n}_q`] = b.q || 0.9;
  });
  P.out_gain = out;
  return { device: 'core.eq8', params: P, on: true };
}
// Squeeze Box on a take: 2-3 dB on the strum's peaks once Slide Rule has trimmed it to INTO (measured,
// tools/liveroom/checks-kitchen.js)
const takeComp = () => ({ device: 'core.comp', params: { threshold: -19, ratio: 2.5, attack: 12, release: 140, knee: 6, auto: 0, makeup: 2.5, mix: 1 }, on: true });
// the small Echo Chamber: the meeting room, 12% wet (the place is the reverb)
const room = () => ({ device: 'core.rooms', params: { room: 5, predelay: 8, decay: 0.8, damp: 0.3, lowcut: 180, width: 0.8, mix: 0.12 }, on: true });
// where Slide Rule trims a take to (integrated loudness into Squeeze Box), and where the take comes out after its chain
export const INTO = -18;
export const TAKE_LEVEL = -17;
const trimFor = (level) => (Number.isFinite(level) ? Math.round(clamp(INTO - level, -18, 18) * 10) / 10 : 0);

export function finishChain(finish = 'bare') {
  const glue = { device: 'core.comp', params: { threshold: -20, ratio: 1.6, attack: 30, release: 200, knee: 6, auto: 0, makeup: 2.5, mix: 1 }, on: true };
  const limit = (gain) => ({ device: 'core.limiter', params: { gain, ceiling: -1, release: 120 }, on: true });
  if (finish === 'warm') return [glue, { device: 'core.clipper', params: { drive: 2, ceiling: -1.5, knee: 0.6, shape: 1, output: -1, mix: 100 }, on: true }, limit(0)];
  if (finish === 'close') return [eq([{ type: 'bell', freq: 4000, gain: 2, q: 0.7 }]), glue, limit(3)];
  return [glue, limit(0)];
}

/* ------------------------------------------------------------------------------------------------ the band */
// The players (§6.5): each one's device and preset, its role and track name, how far under the take it sits (LU), and
// the fader that puts it there with the take at TAKE_LEVEL (measured on the canonical render: checks-kitchen.js).
export const PLAYERS = {
  shaker: { id: 'shaker', role: 'shaker', name: 'Shaker', device: 'core.handkit', params: { shakers_level: 4, bells_level: -3 }, under: -12, gain: 0.5, pan: 0.25, color: 'var(--c-1)' },
  cajon: { id: 'cajon', role: 'cajon', name: 'Cajón', device: 'core.handkit', params: {}, under: -12, gain: -10, pan: -0.1, color: 'var(--c-4)' },
  bass: { id: 'bass', role: 'kbass', name: 'Bass', device: 'core.bassguitar', params: { style: 0, tone: 0.3, pickup: 0.2 }, under: -9, gain: -8.2, pan: 0, color: 'var(--c-5)' },
  strings: { id: 'strings', role: 'strings', name: 'Strings', device: 'core.strings', params: { attack: 0.5, release: 1.2, bright: 0.4, vibrato: 0.35, ensemble: 0.6, width: 0.7, hall: 0.35 }, under: -14, gain: -13.6, pan: 0, color: 'var(--c-2)' },
};
export const PLAYER_ORDER = ['shaker', 'cajon', 'bass', 'strings'];
// the feels' grooves (core/grooves.js): pop for the first two, country from 90
export const FEEL_GROOVES = { eighths: 'pop/eighths', pushpull: 'pop/push-and-pull', boomchick: 'country/boom-chick', train: 'country/train-beat' };
const KITCHEN_FEELS = ['eighths', 'pushpull', 'boomchick', 'train'];

const NAMES_OF = { take: 'Guitar & voice', voice: 'Voice', kguitar: 'Guitar', shaker: 'Shaker', cajon: 'Cajón', kbass: 'Bass', strings: 'Strings', chords: 'Chords' };

export function kitchenSetup({ mic = 'one' } = {}) {
  const tracks = mic === 'two'
    ? [
        { role: 'voice', name: NAMES_OF.voice, kind: 'audio', inserts: [eq([{ type: 'lowcut', freq: 100 }]), takeComp(), room()], gain: 0, pan: 0, input: { device: 'default', channel: 1 } },
        { role: 'kguitar', name: NAMES_OF.kguitar, kind: 'audio', inserts: [eq([{ type: 'lowcut', freq: 80 }, { type: 'bell', freq: 250, gain: -3 }, { type: 'bell', freq: 5000, gain: 2, q: 0.7 }]), takeComp()], gain: -2, pan: 0, input: { device: 'default', channel: 2 } },
      ]
    : [{ role: 'take', name: NAMES_OF.take, kind: 'audio', inserts: [eq([{ type: 'lowcut', freq: 80 }, { type: 'bell', freq: 250, gain: -2 }]), takeComp(), room()], gain: 0, pan: 0, input: { device: 'default', channel: 1 } }];
  return { tempo: 84, meter: [4, 4], grid: 4, count: { beats: 0, voice: 'none' }, tracks, master: finishChain('bare'), feels: KITCHEN_FEELS.slice(), form: [], names: { ...NAMES_OF } };
}

export function kitchenOps(p, { mic = 'one' } = {}) {
  const S = kitchenSetup({ mic });
  const ops = [], roles = {};
  const R = roomOf(p) || {};
  const have = isObj(R.tracks) ? R.tracks : {};
  // (a song with nothing in it yet starts at the kitchen's tempo, the one Count me in offers)
  const fresh = !p.tempoMap && !(p.tracks || []).some((t) => (t.clips || []).length);
  if (fresh && p.tempo !== S.tempo) ops.push({ type: 'project.set', patch: { tempo: S.tempo } });
  for (const t of S.tracks) {
    if (have[t.role] && (p.tracks || []).some((x) => x.id === have[t.role])) { roles[t.role] = have[t.role]; continue; }
    const { role, ...track } = t;
    ops.push({ type: 'track.add', ref: role, track: { ...track, inserts: track.inserts.map((fx) => ({ ...fx, by: HOUSE })), by: HOUSE } });
    roles[role] = `$${role}`;
  }
  for (const fx of p.master?.inserts || []) if (fx.by === HOUSE) ops.push({ type: 'insert.remove', track: 'master', insert: fx.id });
  for (const fx of S.master) ops.push({ type: 'insert.add', track: 'master', insert: { ...fx, by: HOUSE } });
  ops.push({ type: 'room.set', patch: { place: 'kitchen', mic, finish: 'bare', tracks: { ...have, ...roles } } });
  return { ops, label: 'The kitchen table', reason: mic === 'two' ? 'a voice and a guitar on two inputs' : 'a voice and a guitar on one mic' };
}

/* ------------------------------------------------------------------------------------------------ reading the song */
const trackOf = (p, id) => (p.tracks || []).find((t) => t.id === id) || null;
const roleTrack = (p, role) => { const R = roomOf(p); const id = R && isObj(R.tracks) ? R.tracks[role] : null; return id ? trackOf(p, id) : (p.tracks || []).find((t) => t.name === NAMES_OF[role] && role === 'chords') || null; };
const clipOf = (p, id) => { for (const t of p.tracks || []) for (const c of t.clips || []) if (c.id === id) return { track: t, clip: c }; return null; };
const takeCapo = (p) => { const R = roomOf(p) || {}; const t = R.master && isObj(R.takes) ? R.takes[R.master] : null; return t && Number.isInteger(t.capo) ? t.capo : (sheetOf(p)?.capo || 0); };
const sectionsOfSong = (p) => (p.sections || []).slice().sort((a, b) => a.start - b.start);
const partOf = (p, sid) => { const R = roomOf(p); return R && isObj(R.parts) && isObj(R.parts[sid]) ? R.parts[sid] : null; };

// the Chords track's clips as the chords that sound (its name is the shape; the take's capo moves it)
export function chordsTimeline(p) {
  const t = roleTrack(p, 'chords');
  if (!t) return [];
  const capo = takeCapo(p);
  // (a Nashville number is read in the key of the shapes, then moved by the capo like a letter)
  const shapes = shapesKey(sheetOf(p), p);
  const out = [];
  for (const c of (t.clips || []).slice().sort((a, b) => a.start - b.start)) {
    if (c.kind !== 'notes' || c.mute) continue;
    const sym = String(c.name || '').trim();
    const shape = readChord(sym, shapes);
    if (!shape) continue;
    const as = transposeChord(/^[A-G]/.test(sym) ? sym : shape.name, capo), sounds = readChord(as);
    // (the sounding chord keeps the capo's spelling: Bb, not A#)
    const heard = sounds ? { ...sounds, name: as } : shape;
    out.push({ a: c.start, b: c.start + c.length, chord: heard, name: sym });
  }
  return out;
}

// segs for arrange.js's part builders, over [start, start + length), beats from start; a span with no chord is a seg
// with no bass note and no pitches (the bass and the strings rest there)
function segsOver(p, start, length) {
  const tl = chordsTimeline(p).filter((s) => s.b > start + EPS && s.a < start + length - EPS);
  const segs = [];
  let at = 0, prev = null;
  const rest = (a, b) => ({ a: r4(a), b: r4(b), chord: { root: 0, triad: [0, 4, 7], quality: '' }, pcs: [], avoid: [], bassPc: null, change: true, name: null });
  for (const s of tl) {
    const a = Math.max(0, s.a - start), b = Math.min(length, s.b - start);
    if (a > at + EPS) segs.push(rest(at, a));
    const Q = QUALITIES[s.chord.quality] || QUALITIES[''];
    const r = s.chord.root;
    const triad = [r, (r + (Q.iv[1] ?? 4)) % 12, (r + (Q.iv.find((x) => x === 6 || x === 7 || x === 8) ?? 7)) % 12];
    segs.push({ a: r4(a), b: r4(b), chord: { root: r, triad, quality: s.chord.quality }, pcs: [...new Set(Q.iv.slice(0, 4).map((i) => (r + i) % 12))], avoid: [], bassPc: s.chord.bass ?? r, change: !prev || prev.name !== s.name, name: s.chord.name });
    prev = s;
    at = b;
  }
  if (at < length - EPS) segs.push(rest(at, length));
  return segs;
}

// The free spans of the master's time (song beats), where the players rest. free: the master take's free time, seconds
// into its recording as the analyser read it (its read's result.free). The song doesn't keep a read (room.takes is
// { capo, bpm, onMaster }), so whoever holds the read passes it: the kitchen screen, and planRead from its take.
// A counted take has none: it's on the grid by construction.
function freeBeats(p, f) {
  const R = roomOf(p) || {};
  const m = p.tempoMap;
  if (!Array.isArray(f) || !f.length || !R.master || !m || !Array.isArray(m.anchors) || m.anchors.length < 2) return [];
  const c = clipOf(p, R.master);
  const s0 = c ? mapSec(m.anchors, c.clip.start) - (+c.clip.offset || 0) : 0;
  return f.map(([t0, t1]) => [mapBeat(m.anchors, s0 + t0), mapBeat(m.anchors, s0 + t1)]);
}

const feelOf = (p, sid) => { const f = partOf(p, sid)?.feel; return KITCHEN_FEELS.includes(f) ? f : (p.tempo || 84) >= 100 ? 'boomchick' : 'eighths'; };
const seedOf = (p, player, sid) => `${p.id || p.title || 'song'}:${player}:${sid}`;

// the shaker's and the cajón's rows, a bar at a time, for a meter the groove library isn't in (3/4, 6/8)
function rowsNotes(rows, pitchOf, bars, bpb, S16, R) {
  const out = [];
  const step = bpb / S16;
  for (let k = 0; k < bars; k++) {
    for (const [row, s] of Object.entries(rows)) {
      const p = pitchOf(row);
      if (p == null) continue;
      [...s].forEach((ch, i) => { if (ch !== '.') out.push({ p, t: r4(k * bpb + i * step), d: r4(step), v: r4(clamp((ch === 'X' ? 0.9 : ch === 'x' ? 0.72 : 0.5) * (1 + (R() - 0.5) * 0.12), 0.1, 1)) }); });
    }
  }
  return out;
}

export function playerNotes(p, player, section, { free = null } = {}) {
  const P = PLAYERS[player];
  const sec = typeof section === 'string' ? (p.sections || []).find((s) => s.id === section) : section;
  if (!P || !sec) return [];
  const meter = p.meter || [4, 4], bpb = beatsPerBar(meter), length = sec.length, bars = Math.ceil(length / bpb - EPS);
  const S16 = Math.round(bpb * 4);
  const R = rng(/** @type {any} */ (seedOf(p, player, sec.id)));
  const four = meter[0] === 4 && meter[1] === 4;
  let notes = [];
  if (player === 'shaker' || player === 'cajon') {
    const feel = feelOf(p, sec.id), gid = FEEL_GROOVES[feel];
    if (four && getGroove(gid)) {
      const all = realize(getGroove(gid), { tempo: p.tempo || 84, seed: R() * 1e9 >>> 0, length, human: 1 });
      if (player === 'shaker') notes = feel === 'train' ? all.filter((n) => n.p === 38).map((n) => ({ ...n, p: 42 })) : all.filter((n) => n.p === 42 || n.p === 44 || n.p === 46).map((n) => ({ ...n, p: 42 }));
      else notes = all.filter((n) => n.p === 36 || (n.p === 38 && (feel !== 'train' || Math.abs(n.t - Math.round(n.t)) < 0.01 && Math.round(n.t) % 2 === 1)));
    } else {
      const rows = genericRows('pop', meter, S16);
      notes = rowsNotes(rows, (row) => (player === 'shaker' ? (row === 'hat' ? 42 : null) : row === 'kick' ? 36 : row === 'snare' ? 38 : null), bars, bpb, S16, R);
    }
  } else if (player === 'bass') {
    const segs = segsOver(p, sec.start, length);
    const segAt = (t) => segs.find((s) => t >= s.a - EPS && t < s.b - EPS) || segs[segs.length - 1];
    const key = p.key && p.key.root ? { root: p.key.root, scale: /minor/.test(p.key.scale) ? 'minor' : 'major' } : { root: 'C', scale: 'major' };
    const S = { bass: { mode: 'half', line: ['R', '5'], approach: 'add', legato: 0.92, range: [28, 47] } };
    const kickSteps = Array.from({ length: bars }, () => []);
    notes = bassLine(S, segs, kickSteps, { k0: 0, bpb, S16, start: 0, length, gridAt: (k, st) => r4(k * bpb + st * (bpb / S16)), segAt, hk: key, R, meter });
  } else if (player === 'strings') {
    let prev = null;
    for (const s of segsOver(p, sec.start, length)) {
      if (!s.pcs.length) continue;
      const v = voice(s.pcs.slice(0, 3), [55, 76], prev, null);
      prev = v;
      for (const pitch of v) notes.push({ p: pitch, t: s.a, d: r4(s.b - s.a), v: 0.55 });
    }
  }
  // nothing where the time moves (the free spans), nothing past the section
  const rests = freeBeats(p, free).map(([a, b]) => [a - sec.start, b - sec.start]);
  return notes
    .filter((n) => n.t > -EPS && n.t < length - EPS && !rests.some(([a, b]) => n.t >= a - EPS && n.t < b - EPS))
    .map((n) => ({ p: n.p, t: r4(Math.max(0, n.t)), d: r4(Math.max(1 / 32, Math.min(n.d, length - n.t))), v: r4(clamp(n.v, 0.05, 1)), by: HOUSE }))
    .sort((a, b) => a.t - b.t || a.p - b.p);
}

/* ------------------------------------------------------------------------------------------------ where players go */
const sheetName = (p, sid) => {
  const ss = partOf(p, sid)?.sheet;
  const sh = sheetOf(p);
  const s = ss && sh ? sh.sections.find((x) => x.id === ss) : null;
  return (s ? s.name : (p.sections || []).find((x) => x.id === sid)?.name) || '';
};
export function offerSections(p, player) {
  const secs = sectionsOfSong(p);
  const is = (s, re) => re.test(sheetName(p, s.id) || s.name);
  if (player === 'shaker') return secs.filter((s) => is(s, /^chorus/i)).map((s) => s.id);
  if (player === 'cajon') return secs.filter((s) => is(s, /^verse/i)).map((s) => s.id);
  if (player === 'bass') { const i = secs.findIndex((s) => is(s, /^chorus/i)); return i < 0 ? secs.map((s) => s.id) : secs.slice(i).map((s) => s.id); }
  if (player === 'strings') return secs.filter((s) => is(s, /^bridge/i)).map((s) => s.id);
  return [];
}
// the words for where it is: "the chorus", "the verses", "from the first chorus", "the bridge"
export function whereWords(p, player, ids) {
  const names = [...new Set(ids.map((id) => (sheetName(p, id) || '').replace(/\s+\d+$/, '').toLowerCase()))];
  if (player === 'bass' && ids.length > 1) return 'from the first chorus';
  if (names.length === 1) return `the ${names[0]}${ids.length > 1 && player === 'cajon' ? 's' : ''}`;
  return names.map((n) => `the ${n}`).join(' and ');
}

/* ------------------------------------------------------------------------------------------------ the read */
const readingOf = (result, reading) => (isObj(reading) ? reading : (result?.readings || []).find((r) => r.id === (reading || 'found')) || result?.readings?.[0] || null);

// the grid ops for a reading (audio/analyze/toOps.js gridOps's form): the meter, the map, the take placed on it
function gridOps(p, R, take) {
  /** @type {any[]} */
  const ops = [];
  if (beatsPerBar(p.meter || [4, 4]) !== R.bpb) ops.push({ type: 'project.set', patch: { meter: [R.bpb, 4] } });
  ops.push({ type: 'tempo.map', map: { anchors: R.anchors.map((a) => ({ beat: a.beat, sec: a.sec })), clip: take.clip, clipStart: R.start } });
  const c = clipOf(p, take.clip);
  const dur = Number(take.read?.result?.duration);
  if (c) {
    const s0 = mapSec(R.anchors, R.start);
    const len = Number.isFinite(dur) && dur > 0 ? r4(mapBeat(R.anchors, s0 + dur - (+c.clip.offset || 0)) - R.start) : null;
    ops.push({ type: 'clip.set', track: c.track.id, clip: c.clip.id, patch: { start: R.start, ...(len && len > 0 ? { length: len } : {}) } });
  }
  return ops;
}
// a throwaway copy of the song with ops applied (the plans read the grid they make before the step is taken)
export function after(p, ops) {
  if (!ops.length) return p;
  const s = createStore(structuredClone(p));
  const r = s.dispatch(ops, { by: HOUSE });
  if (!r.ok) throw new Error(r.error || 'the kitchen could not plan that');
  return s.get();
}

// the beats of the song's grid over a take: song beats (integers) and where each falls in the recording (seconds)
// (a counted take is on the song's grid by construction: with no tempo map, the song's tempo from beat 0)
function takeBeats(p, take) {
  const m = p.tempoMap, c = clipOf(p, take.clip);
  if (!c) return null;
  const spb = 60 / (+p.tempo || 120);
  const A = m && Array.isArray(m.anchors) && m.anchors.length >= 2 ? m.anchors : [{ beat: 0, sec: 0 }, { beat: 1, sec: spb }];
  const s0 = mapSec(A, c.clip.start) - (+c.clip.offset || 0);
  const dur = Number(take.read?.result?.duration) || 0;
  const b0 = Math.ceil(c.clip.start - EPS), b1 = Math.floor(mapBeat(A, s0 + dur) + EPS);
  const beats = [], secs = [];
  for (let b = b0; b <= b1; b++) { beats.push(b); secs.push(mapSec(A, b) - s0); }
  return { beats, secs, s0 };
}

const VOICING = [48, 67];
function chordVoicing(ch, prev) { const Q = QUALITIES[ch.quality] || QUALITIES['']; return voice([...new Set(Q.iv.slice(0, 4).map((i) => (ch.root + i) % 12))], /** @type {[number, number]} */ (VOICING), prev, null); }

// The house's read of the take onto the song's grid (planRead without the grid ops): the sections, the Chords
// track and clips, the parts' sheet sections, the trim, the key, the take's record, the kept players re-laid.
function readOps(p, take, sheet) {
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const grid = takeBeats(p, take);
  const res = take.read?.result;
  if (!grid || !res) return null;
  const sc = sheetChords(sheet, p);
  const phase = ((-grid.beats[0] % bpb) + bpb) % bpb;
  const changes = alignChords(take.read.chroma, grid.secs, sc, { bpb, phase });
  const passes = formOf(changes, grid.secs);
  const ops = [];
  const R = roomOf(p) || {};
  const oldSecs = sectionsOfSong(p);
  const fromRead = oldSecs.filter((s) => partOf(p, s.id)?.sheet);
  // the kept players: by the sheet section each played in
  const kept = {};
  for (const id of PLAYER_ORDER) {
    const t = roleTrack(p, PLAYERS[id].role);
    if (!t) continue;
    const where = new Set();
    for (const c of t.clips || []) {
      if (c.by !== HOUSE) continue;
      const s = oldSecs.find((x) => c.start >= x.start - 0.25 && c.start < x.start + x.length - 0.25);
      if (s && partOf(p, s.id)?.sheet) where.add(partOf(p, s.id).sheet);
      ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
    }
    if (where.size) kept[id] = { track: t.id, where };
  }
  for (const s of fromRead) { ops.push({ type: 'room.part.set', section: s.id, remove: true }); ops.push({ type: 'section.remove', section: s.id }); }
  // the Chords track (muted: it's the band's chart, not a part), its old clips out
  let chordsRef = null;
  const ct = roleTrack(p, 'chords');
  if (ct) { for (const c of ct.clips || []) if (c.by === HOUSE) ops.push({ type: 'clip.remove', track: ct.id, clip: c.id }); chordsRef = ct.id; }
  else {
    ops.push({ type: 'track.add', ref: 'kchords', track: { name: NAMES_OF.chords, kind: 'instrument', instrument: { device: 'core.keys', params: { voice: 1, bright: 0.4 } }, gain: -14, mute: true, by: HOUSE } });
    chordsRef = '$kchords';
  }
  // the chords, as clips at sounding pitch
  const at = (i) => grid.beats[Math.min(i, grid.beats.length - 1)];
  const endBeat = grid.beats[grid.beats.length - 1] + 1;
  let prevV = null;
  const named = [];
  changes.forEach((c, i) => {
    if (c.chord == null) return;
    const a = at(c.beat), b = i + 1 < changes.length ? at(changes[i + 1].beat) : endBeat;
    if (b <= a) return;
    const ch = readChord(c.sounding);
    const v = ch ? chordVoicing(ch, prevV) : [];
    prevV = v.length ? v : prevV;
    ops.push({ type: 'clip.add', track: chordsRef, clip: { kind: 'notes', start: a, length: b - a, name: c.chord, by: HOUSE, notes: v.map((pp) => ({ p: pp, t: 0, d: r4(b - a), v: 0.6, by: HOUSE })) } });
    named.push(c);
  });
  // the sections, as played: one a pass, named from the paper, on the bar line
  const snap = (b) => { const k = Math.round(b / bpb) * bpb; return Math.abs(k - b) <= 1 ? k : b; };
  const made = [];
  passes.forEach((ps, i) => {
    const a = snap(at(ps.from)), b = snap(ps.to >= grid.beats.length ? endBeat : at(ps.to));
    if (b - a < 1) return;
    const ref = `ks${i}`;
    ops.push({ type: 'section.add', ref, section: { name: ps.name || 'Verse', start: a, length: b - a } });
    if (ps.section) ops.push({ type: 'room.part.set', section: `$${ref}`, patch: { sheet: ps.section } });
    made.push({ ref, a, b, sheet: ps.section, name: ps.name });
  });
  // the kept players, back in the sections of the sheet sections they were in (planned on the song as it will be)
  const tm = { ops: [], made };
  // the take's trim: Slide Rule's out gain puts it at INTO into Squeeze Box
  const tt = trackOf(p, clipOf(p, take.clip)?.track.id);
  const eqIns = tt ? (tt.inserts || []).find((fx) => fx.device === 'core.eq8') : null;
  if (eqIns && Number.isFinite(take.read.level)) ops.push({ type: 'insert.set', track: tt.id, insert: eqIns.id, patch: { params: { out_gain: trimFor(take.read.level) } } });
  // the song's key: the sounding one
  const k = soundingKey(sheet, p);
  if (k && (!p.key || p.key.root !== k.root || p.key.scale !== k.scale)) ops.push({ type: 'project.set', patch: { key: k } });
  // the take's record (its capo, its tempo, where its time is free) and the master
  const Rd = readingOf(res, null);
  const takes = { ...(isObj(R.takes) ? R.takes : {}) };
  takes[take.clip] = { ...(takes[take.clip] || {}), capo: Number.isInteger(sheet?.capo) ? sheet.capo : 0, bpm: Math.round(p.tempo || Rd?.tempo || 84) };
  ops.push({ type: 'room.set', patch: { takes, ...(R.master ? {} : { master: take.clip }), tracks: { ...(isObj(R.tracks) ? R.tracks : {}), chords: chordsRef } } });
  return { ops, changes: named, passes, made, kept, tm };
}

function summarize(p, sheet, changes, passes) {
  const bySec = new Map();
  for (const c of changes) { if (!bySec.has(c.section)) bySec.set(c.section, { section: c.section, name: c.name, chords: [] }); const e = bySec.get(c.section); if (!e.chords.includes(c.chord)) e.chords.push(c.chord); }
  const form = [];
  for (let i = 0; i < passes.length; i++) {
    let n = 1;
    while (i + n < passes.length && passes[i + n].section === passes[i].section) n++;
    if (n > 1) form.push({ section: passes[i].section, name: passes[i].name, times: n, at: i });
    i += n - 1;
  }
  const playedIds = new Set(passes.map((x) => x.section));
  const skipped = (sheet?.sections || []).filter((s) => !playedIds.has(s.id) && sheetChords({ ...sheet, sections: [s] }, p)[0].chords.some((c) => c.chord)).map((s) => s.name);
  const unknown = [];
  for (const s of sheetChords(sheet, p)) for (const c of s.chords) if (!c.chord && !unknown.includes(c.sym)) unknown.push(c.sym);
  return { chords: [...bySec.values()], form, skipped, unknown };
}

// the take's free time, when it's the master the players follow (a counted take has none)
const takeFree = (q, take) => (!take.counted && roomOf(q)?.master === take.clip && Array.isArray(take.read?.result?.free) ? take.read.result.free : null);
function playersOps(q, kept, made, free = null) {
  const ops = [];
  for (const [id, k] of Object.entries(kept)) {
    for (const m of made) {
      if (!k.where.has(m.sheet)) continue;
      const sec = (q.sections || []).find((s) => Math.abs(s.start - m.a) < EPS && Math.abs(s.start + s.length - m.b) < EPS);
      if (!sec) continue;
      const notes = playerNotes(q, id, sec, { free });
      if (notes.length) ops.push({ type: 'clip.add', track: k.track, clip: { kind: 'notes', start: sec.start, length: sec.length, name: `${PLAYERS[id].name} · ${sec.name}`, by: HOUSE, notes } });
    }
  }
  return ops;
}

export function planRead(p, { take = null, sheet = null } = {}) {
  if (!take || !take.read || !take.read.result) return none();
  const paper = sheet || sheetOf(p);
  if (!paper) return none();
  const c = clipOf(p, take.clip);
  if (!c) return none();
  const R = readingOf(take.read.result, take.reading || null);
  // (a counted take keeps the song's grid: nothing about its time is read)
  const pre = take.counted || (p.tempoMap && p.tempoMap.clip === take.clip) ? [] : R ? gridOps(p, R, take) : [];
  const p1 = after(p, pre);
  const r = readOps(p1, take, paper);
  if (!r) return none();
  const p2 = after(p1, r.ops);
  const ops = [...pre, ...r.ops, ...playersOps(p2, r.kept, r.made, takeFree(p2, take))];
  const sum = summarize(p, paper, r.changes, r.passes);
  const tw = take.counted ? null : timeWords(take.read.result, R);
  const n = takeNumber(p, take.clip);
  return { ops, label: `The band read take ${n}`, reason: 'sections and chords from the paper, lined up with the take', ...sum, moves: !!tw && tw.free > 0.2, time: tw };
}

export function planTime(p, { take = null, reading = null } = {}) {
  if (!take || !take.read || !take.read.result) return none();
  const R = readingOf(take.read.result, reading);
  if (!R || !clipOf(p, take.clip)) return none();
  const ops = gridOps(p, R, take);
  const p1 = after(p, ops);
  // the band re-timed: when the song has the read of this take, it's read again on the new grid
  const hasRead = sectionsOfSong(p).some((s) => partOf(p, s.id)?.sheet) || !!roleTrack(p, 'chords');
  const paper = sheetOf(p);
  if (hasRead && paper) {
    const r = readOps(p1, take, paper);
    if (r) { const p2 = after(p1, r.ops); ops.push(...r.ops, ...playersOps(p2, r.kept, r.made, takeFree(p2, take))); }
  } else {
    const Rm = roomOf(p) || {};
    const takes = { ...(isObj(Rm.takes) ? Rm.takes : {}) };
    takes[take.clip] = { ...(takes[take.clip] || {}), bpm: Math.round(R.tempo), ...(Number.isInteger(paper?.capo) ? { capo: paper.capo } : {}) };
    ops.push({ type: 'room.set', patch: { takes, ...(Rm.master ? {} : { master: take.clip }) } });
  }
  const tw = timeWords(take.read.result, R);
  const words = { found: 'On the beat', double: 'Twice as fast', half: 'Half as fast', downbeat: 'The 1’s a beat later', twothirds: 'In three' }[R.id] || 'The time';
  return { ops, label: `${words}: around ${Math.round(R.tempo)}`, reason: `the time from take ${takeNumber(p, take.clip)}`, moves: !!tw && tw.free > 0.2, time: tw };
}

export function planPlayer(p, { player = null, section = null, free = null } = {}) {
  const P = PLAYERS[player];
  if (!P) return none();
  const ids = section == null ? offerSections(p, player) : Array.isArray(section) ? section : [section];
  const secs = ids.map((id) => (p.sections || []).find((s) => s.id === id || s.name === id)).filter(Boolean);
  if (!secs.length) return none();
  const ops = [];
  let t = roleTrack(p, P.role), ref = t ? t.id : null;
  const Rm = roomOf(p) || {};
  if (!t) {
    ops.push({ type: 'track.add', ref: `k${player}`, track: { name: P.name, kind: 'instrument', instrument: { device: P.device, params: { ...P.params } }, gain: P.gain, pan: P.pan, by: HOUSE } });
    ref = `$k${player}`;
    ops.push({ type: 'room.set', patch: { tracks: { ...(isObj(Rm.tracks) ? Rm.tracks : {}), [P.role]: ref } } });
  }
  for (const s of secs) {
    // (a player already in that section is played again, not doubled)
    if (t) for (const c of t.clips || []) if (c.start < s.start + s.length - EPS && c.start + c.length > s.start + EPS) ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
    const notes = playerNotes(p, player, s, { free });
    if (notes.length) ops.push({ type: 'clip.add', track: ref, clip: { kind: 'notes', start: s.start, length: s.length, name: `${P.name} · ${s.name}`, by: HOUSE, notes } });
  }
  const where = whereWords(p, player, secs.map((s) => s.id));
  return { ops, label: `${P.name} in ${where}`.replace(' in from', ' from'), reason: `${P.name.toLowerCase()} kept; it follows your time`, where };
}

export function planMaster(p, { clip = null, read = null } = {}) {
  const c = clipOf(p, clip);
  if (!c) return none();
  const ops = [{ type: 'room.set', patch: { master: clip } }];
  let tempo = null;
  if (read && read.result) {
    const take = { track: c.track.id, clip, read };
    const p0 = after(p, ops);
    const t = planTime(p0, { take, reading: 'found' });
    ops.push(...t.ops);
    tempo = Math.round(readingOf(read.result, 'found')?.tempo || 0) || null;
  }
  const n = takeNumber(p, clip);
  return { ops, label: `Take ${n} is the master`, reason: tempo ? `the band follows it, around ${tempo}` : 'the band follows it', tempo };
}

export function planKitchenFinish(p, { finish = null } = {}) {
  if (!['bare', 'warm', 'close'].includes(finish)) return none();
  const ops = [];
  const own = new Set(['core.comp', 'core.limiter', 'core.clipper', 'core.eq8']);
  for (const fx of p.master?.inserts || []) if (fx.by === HOUSE && own.has(fx.device)) ops.push({ type: 'insert.remove', track: 'master', insert: fx.id });
  for (const fx of finishChain(finish)) ops.push({ type: 'insert.add', track: 'master', insert: { ...fx, by: HOUSE } });
  ops.push({ type: 'room.set', patch: { finish } });
  return { ops, label: NAMES.finish[finish], reason: `the ${NAMES.finish[finish].toLowerCase()} finish` };
}

/* ------------------------------------------------------------------------------------------------ takes */
export function takeNumber(p, clip) {
  const c = clipOf(p, clip);
  if (!c) return 1;
  const list = (c.track.clips || []).filter((x) => x.kind === 'audio').sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const named = /take (\d+)/i.exec(c.clip.name || '');
  return named ? +named[1] : Math.max(1, list.findIndex((x) => x.id === clip) + 1);
}
export function takeName(p, n, { capo = null, bpm = null } = {}) {
  const title = p.title && p.title !== 'Untitled' ? p.title : 'Work tape';
  return [title, `take ${n}`, ...(capo ? [`capo ${capo}`] : []), ...(bpm ? [String(Math.round(bpm))] : [])].join(' · ');
}

/* ------------------------------------------------------------------------------------------------ a paper from the take */
// The take's own chords (the analyser's, which nobody plays until they're on the paper), written as chords-only lines
// in bars, a section a heading, in the shapes the capo gives. capo: the capo the musician picked (0: as they sound).
export function fromTakeOps(p, { take = null, capo = 0 } = {}) {
  const res = take?.read?.result;
  if (!res || !Array.isArray(res.chords) || !res.chords.length) return { ...none(), line: null };
  const bpb = res.bpb || 4;
  const secs = Array.isArray(res.sections) && res.sections.length ? res.sections : [{ name: 'Verse', start: res.chords[0].start, length: res.chords[res.chords.length - 1].end - res.chords[0].start }];
  const ops = [];
  const sheet = sheetOf(p);
  for (const s of sheet?.sections || []) if (!s.lines.some((l) => l.text.trim())) ops.push({ type: 'sheet.section.remove', section: s.id });
  if (capo !== (sheet?.capo || 0)) ops.push({ type: 'sheet.set', patch: { capo } });
  const seen = new Map();
  let first = null;
  const names = { A: 'Verse', B: 'Chorus', C: 'Bridge', D: 'Bridge 2' };
  for (const s of secs) {
    const bars = [];
    for (let b = s.start; b < s.start + s.length - EPS; b += bpb) {
      const inBar = res.chords.filter((c) => c.end > b + EPS && c.start < b + bpb - EPS).map((c) => transposeChord(c.name, -capo));
      const uniq = inBar.filter((x, i) => x !== inBar[i - 1]);
      bars.push(uniq.length ? uniq.slice(0, 2).join(' ') : '%');
    }
    const text = bars.length ? `| ${bars.join(' | ')} |` : '';
    const label = names[String(s.name).replace(/\W.*$/, '')] || String(s.name || 'Verse');
    const key = text;
    if (seen.has(key) || !text) continue;
    seen.set(key, label);
    const lines = [];
    for (let i = 0; i < text.length; ) { let j = Math.min(text.length, i + 180); if (j < text.length) j = text.lastIndexOf('|', j) + 1 || j; lines.push({ text: (i ? '| ' : '') + text.slice(i, j).replace(/^\|\s*/, '').trim() }); i = j; }
    ops.push({ type: 'sheet.section.add', section: { name: [...seen.values()].filter((v) => v === label).length > 1 ? `${label} ${[...seen.values()].filter((v) => v === label).length}` : label, lines: lines.map((l) => ({ text: l.text.startsWith('|') ? l.text : `| ${l.text}` })) } });
    if (!first) first = { label, chords: [...new Set(res.chords.filter((c) => c.start >= s.start && c.start < s.start + s.length).map((c) => transposeChord(c.name, -capo)))].slice(0, 4) };
  }
  const line = first ? `${first.chords.join('–')} in the ${first.label.toLowerCase()}` : null;
  return { ops, label: 'The chords from the take', reason: 'chords-only lines to write the words under', line };
}

/* ------------------------------------------------------------------------------------------------ the offered move */
// run: the kitchen screen's state the song doesn't hold: { rolling, playing, reading, takes (how many), ask: 'time'
// | 'chords' | 'form' | null, offer: a player being offered | null, done: [players offered or kept], again (Again was
// offered), heard (heard top to bottom since the last change) }
export function offeredKitchen(view, run) {
  const r = isObj(run) ? run : {};
  if (r.rolling) return { id: 'stop', label: 'That’s a take', key: 'Space' };
  if (r.reading) return null;
  // (the read's question and a player's offer are heard as they're asked: keeping it is the move, not stopping it)
  if (r.takes && r.ask === 'time') return { id: 'time', label: 'On the beat', key: 'Space' };
  if (r.takes && r.ask === 'form') return { id: 'form', label: 'Write it that way', key: 'Space' };
  if (r.takes && r.offer) return { id: 'keep', label: 'Keep it', key: 'Space' };
  if (r.playing) return { id: 'stop', label: 'Stop', key: 'Space' };
  if (!r.takes) return { id: 'tape', label: 'Start the tape', key: 'Space' };
  const cards = Array.isArray(view?.cards) ? view.cards : [];
  const done = new Set(Array.isArray(r.done) ? r.done : []);
  const hasBridge = cards.some((c) => /^bridge/i.test(String(c.name || '')));
  for (const id of PLAYER_ORDER) {
    if (done.has(id) || (id === 'strings' && !hasBridge)) continue;
    const label = { shaker: 'A shaker in the chorus', cajon: 'The cajón under the verses', bass: 'The bass from the first chorus', strings: 'Strings in the bridge' }[id];
    return { id: `offer.${id}`, label, key: 'Space' };
  }
  if (!r.again) return { id: 'again', label: 'Again', key: 'Space' };
  return { id: 'hear', label: 'Hear it all', key: 'Space' };
}

// The words for the read and the chords lines, for the screen (lines/kitchen.js takes them as vars)
export function chordsWords(sum) {
  const first = (sum?.chords || [])[0];
  if (!first) return null;
  return { chords: first.chords.join(', '), section: String(first.name || 'verse').replace(/\s+\d+$/, '').toLowerCase() };
}
export { keyName, keyOfChords, parsePc, strongOffsets };
