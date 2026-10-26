// @ts-check
// The live room's part of the song [core] (docs/research/LIVE-ROOM-MODE.md §9): the ids that are forever, the caps,
// and the cleaners a loaded song's two room fields go through (core/project.js cleanProject). Pure; it imports nothing
// from core/project.js (which imports it), so either can load first.
//
//   PLACE_IDS, RIG_IDS, FINISHES (each place's), FEEL_IDS, ROLES     ids, forever. A song can name one this version
//                                                                    doesn't know (a newer one): it is kept
//   NAMES.place / feel / finish / rig                                what each is called in a sentence
//   ORDER.room / part / take / managed / sheet / section / line      each object's known keys in the order the song
//                                                                    keeps them (any others after, as they came)
//   ROOM_LIMITS                                                      the caps (project.js LIMITS holds them too)
//   putKey(obj, key, value, order), placeKey(obj, key, value, at)    set a key where the song keeps it (the ops use
//                                                                    them, so an inverse restores key order too)
//   cleanRoom(x, { tracks, sections, warn }) -> room | null          a loaded room, canonical: ids as strings, finite
//       numbers, roles naming tracks the song has, parts naming its sections, takes and the master naming its clips,
//       unknown keys kept, within the caps. tracks, sections: the song's (arrays of { id }, or of ids); left out, ids
//       aren't checked against them. warn({ kind, message }): what was cut on the way
//   cleanSheet(x, { warn }) -> sheet | null                          a loaded sheet, canonical: plain text, lines
//       signed (an unsigned line is 'you', as an unsigned track is), every id made unique, within the caps
//   roomOf(p), partOf(p, section), sheetOf(p)                        the song's room, a section's part (an id or a
//                                                                    section), the song's sheet: each null when absent
//
// The two fields (§9.1):
//   room:  { v: 1, place, rig, tuning, finish, master, mic, tracks: { role: trackId }, parts: { sectionId: { feel,
//            busy, loud, reps, oneSide, drop, sheet, learned: { from, thin } } }, takes: { clipId: { capo, bpm,
//            onMaster } }, managed: { trackId | 'master': { gain, pan, chain } } }
//   sheet: { v: 1, capo, time: [n, d], notes, sections: [{ id: 'ss_…', name, lines: [{ id: 'sl_…', text, by }] }] }
// A false flag (oneSide, drop, onMaster) and capo 0 are kept as no key at all, the way clip.set keeps mute and capo; an
// empty map (tracks, parts, takes, managed) is no key either.

import { validMeter } from '../music.js';

const deep = (x) => Object.freeze(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Object.freeze(v)])));

// Places: the three electric rooms and the kitchen table.
export const PLACE_IDS = Object.freeze(['metal', 'basement', 'bluesbar', 'kitchen']);
// The amp's settings (core/liveroom/places.js RIGS).
export const RIG_IDS = Object.freeze(['modern', 'djent', 'thrash', 'hardrock', 'crunch', 'edge']);
// Each place's finishes, in the order the room offers them.
export const FINISHES = deep({ metal: ['tight', 'loud', 'room'], basement: ['raw', 'loud', 'room'], bluesbar: ['bar', 'close', 'loud'], kitchen: ['bare', 'warm', 'close'] });
// The drummer's feels (§4.4, §5, §6): the words behind the menu's names.
export const FEEL_IDS = Object.freeze(['chugs', 'gallop', 'threes', 'open', 'china', 'halftime', 'stops', 'toms', 'build', 'blast', 'dbeat', 'straight', 'skank', 'floortoms', 'shuffle', 'double', 'ride', 'slow', 'eighths', 'pushpull', 'boomchick', 'train']);
// The tracks a room names by what they do (room.tracks: role -> track id).
export const ROLES = Object.freeze(['guitarL', 'guitarR', 'guitar', 'lead', 'drums', 'bass', 'heard', 'bassYours', 'take', 'voice', 'kguitar', 'shaker', 'cajon', 'kbass', 'strings', 'chords']);

export const NAMES = deep({
  place: { metal: 'the metal club', basement: 'the basement', bluesbar: 'the blues bar', kitchen: 'the kitchen table' },
  feel: {
    chugs: 'Your chugs', gallop: 'Gallop', threes: 'In threes', open: 'Open', china: 'On the china', halftime: 'Half time', stops: 'Stops', toms: 'Toms', build: 'Build',
    blast: 'Blast', dbeat: 'D-beat', straight: 'Straight', skank: 'Skank', floortoms: 'Floor toms', shuffle: 'Shuffle', double: 'Double', ride: 'Ride', slow: 'Slow',
    eighths: 'Eighths', pushpull: 'Push and pull', boomchick: 'Boom-chick', train: 'Train beat',
  },
  finish: { tight: 'Tight', loud: 'Loud', room: 'Room', raw: 'Raw', bar: 'Bar', close: 'Close', bare: 'Bare', warm: 'Warm' },
  rig: { modern: 'Modern', djent: 'Djent', thrash: 'Thrash', hardrock: 'Hard rock', crunch: 'Crunch', edge: 'Edge of breakup' },
});

export const ORDER = deep({
  room: ['v', 'place', 'rig', 'tuning', 'finish', 'master', 'mic', 'tracks', 'parts', 'takes', 'managed'],
  part: ['feel', 'busy', 'loud', 'reps', 'oneSide', 'drop', 'sheet', 'learned'],
  take: ['capo', 'bpm', 'onMaster'],
  managed: ['gain', 'pan', 'chain'],
  sheet: ['v', 'capo', 'time', 'notes', 'sections'],
  section: ['id', 'name', 'lines'],
  line: ['id', 'text', 'by'],
});

// sheetChars counts the sheet's words: its lines, its sections' names and its notes.
export const ROOM_LIMITS = Object.freeze({ sheetSections: 64, sheetLines: 400, sheetChars: 24000, lineChars: 200, notesChars: 2000, nameChars: 100, roomParts: 512, roomBytes: 65536 });

/* ------------------------------------------------------------------------------------------------ text and ids */
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// (keys a parsed song can carry that would reach the prototype if copied onto an object)
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const safe = (k) => !UNSAFE.has(k);
// What a person reads is plain text: no control characters and no bidi overrides or isolates (core/project.js
// plainText, the same rule; the notes keep their line breaks).
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const UNSEEN_KEEP_LINES = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const plain = (s) => String(s).replace(UNSEEN, '');
const plainLines = (s) => String(s).replace(/\r\n?/g, '\n').replace(UNSEEN_KEEP_LINES, '');
// (cut without splitting a character in two: an emoji is two UTF-16 units)
const cut = (s, max) => { if (s.length <= max) return s; const out = s.slice(0, max); return /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out; };
// A place, rig, tuning, finish or feel id: lowercase, digits and hyphens.
const isWord = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
// A role: camelCase (guitarL, bassYours).
const isRole = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(v) && safe(v);
// An id the song uses for a track, clip or section (whatever made it: a file can bring its own).
const isRef = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && !/[\u0000-\u001f]/.test(v) && safe(v);
// An id the sheet makes for its sections and lines.
const isSheetId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) && safe(v);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const json = (x) => { try { return JSON.parse(JSON.stringify(x)); } catch { return undefined; } };

function idSet(list) {
  if (list == null) return null;
  const out = new Set();
  for (const x of list instanceof Set ? [...list] : Array.isArray(list) ? list : []) {
    if (typeof x === 'string') out.add(x);
    else if (isObj(x) && typeof x.id === 'string') out.add(x.id);
  }
  return out;
}
function clipSet(tracks) {
  if (!Array.isArray(tracks)) return null;
  const out = new Set();
  for (const t of tracks) for (const c of (isObj(t) && Array.isArray(t.clips) ? t.clips : [])) if (isObj(c) && typeof c.id === 'string') out.add(c.id);
  return out;
}
// The known keys in their order, then any others as they came (JSON values, kept for a newer reader).
function ordered(known, order, from) {
  const out = {};
  for (const k of order) if (known[k] !== undefined) out[k] = known[k];
  if (isObj(from)) for (const [k, v] of Object.entries(from)) if (!order.includes(k) && safe(k)) { const j = json(v); if (j !== undefined) out[k] = j; }
  return out;
}
const say = (warn) => warn || ((w) => console.warn('overdub:', w.message));

/* ------------------------------------------------------------------------------------------------ the room */
function cleanPart(e) {
  if (!isObj(e)) return null;
  const k = {};
  if (isWord(e.feel)) k.feel = e.feel;
  for (const s of ['busy', 'loud']) if (e[s] === -1 || e[s] === 0 || e[s] === 1) k[s] = e[s];
  if (Number.isInteger(e.reps) && e.reps >= 1 && e.reps <= 4) k.reps = e.reps;
  for (const s of ['oneSide', 'drop']) if (e[s] === true) k[s] = true;
  if (isSheetId(e.sheet)) k.sheet = e.sheet;
  if (isObj(e.learned)) {
    const l = {};
    if (isRef(e.learned.from)) l.from = e.learned.from;
    if (e.learned.thin === true || e.learned.thin === false) l.thin = e.learned.thin;
    const lo = ordered(l, ['from', 'thin'], e.learned);
    if (Object.keys(lo).length) k.learned = lo;
  }
  const out = ordered(k, ORDER.part, e);
  return Object.keys(out).length ? out : null;
}
function cleanTake(e) {
  if (!isObj(e)) return null;
  const k = {};
  if (Number.isInteger(e.capo) && e.capo >= 1 && e.capo <= 11) k.capo = e.capo;
  if (fin(e.bpm) && e.bpm >= 20 && e.bpm <= 400) k.bpm = e.bpm;
  if (e.onMaster === true) k.onMaster = true;
  const out = ordered(k, ORDER.take, e);
  return Object.keys(out).length ? out : null;
}
function cleanManaged(e) {
  if (!isObj(e)) return null;
  const k = {};
  if (fin(e.gain) && e.gain >= -96 && e.gain <= 24) k.gain = e.gain;
  if (fin(e.pan) && e.pan >= -1 && e.pan <= 1) k.pan = e.pan;
  if (typeof e.chain === 'string' && e.chain.length <= 64) k.chain = plain(e.chain);
  const out = ordered(k, ORDER.managed, e);
  return Object.keys(out).length ? out : null;
}
// A map of id -> entry: entries whose id passes `ok` and that clean to something.
function cleanMap(x, ok, fn) {
  if (!isObj(x)) return undefined;
  const out = {};
  for (const [id, e] of Object.entries(x)) { if (!isRef(id) || !ok(id)) continue; const c = fn(e); if (c) out[id] = c; }
  return Object.keys(out).length ? out : undefined;
}

export function cleanRoom(x, { tracks = null, sections = null, warn = null } = {}) {
  if (!isObj(x)) { if (x != null) say(warn)({ kind: 'room', message: 'the song\'s room was not an object: it was left out' }); return null; }
  const trackIds = idSet(tracks), sectionIds = idSet(sections), clipIds = clipSet(tracks);
  const has = (set) => (id) => !set || set.has(id);
  const k = { v: Number.isInteger(x.v) && x.v >= 1 ? x.v : 1 };
  for (const s of ['place', 'rig', 'tuning', 'finish']) if (isWord(x[s])) k[s] = x[s];
  if (isRef(x.master) && has(clipIds)(x.master)) k.master = x.master;
  if (x.mic === 'one' || x.mic === 'two') k.mic = x.mic;
  if (isObj(x.tracks)) {
    const t = {};
    for (const [role, id] of Object.entries(x.tracks)) if (isRole(role) && isRef(id) && has(trackIds)(id)) t[role] = id;
    if (Object.keys(t).length) k.tracks = t;
  }
  k.parts = cleanMap(x.parts, has(sectionIds), cleanPart);
  k.takes = cleanMap(x.takes, has(clipIds), cleanTake);
  k.managed = cleanMap(x.managed, (id) => id === 'master' || has(trackIds)(id), cleanManaged);
  const out = ordered(k, ORDER.room, x);
  // the caps: parts, then the whole room as JSON (what goes first: unknown keys and roles, then the last entries of the
  // maps, the known roles last)
  if (out.parts && Object.keys(out.parts).length > ROOM_LIMITS.roomParts) {
    const ids = Object.keys(out.parts);
    for (const id of ids.slice(ROOM_LIMITS.roomParts)) delete out.parts[id];
    say(warn)({ kind: 'room', message: `the room named ${ids.length} parts; it keeps the first ${ROOM_LIMITS.roomParts}` });
  }
  fitRoom(out, warn);
  return out;
}
function fitRoom(out, warn) {
  let size = JSON.stringify(out).length;
  if (size <= ROOM_LIMITS.roomBytes) return;
  const was = size;
  for (const k of Object.keys(out)) if (!ORDER.room.includes(k)) delete out[k];
  size = JSON.stringify(out).length;
  // (any camelCase role naming a real track is kept, so the roles can be most of a room)
  const steps = [{ m: 'tracks', only: (role) => !ROLES.includes(role) }, { m: 'managed' }, { m: 'takes' }, { m: 'parts' }, { m: 'tracks' }];
  for (const { m, only } of steps) {
    if (size <= ROOM_LIMITS.roomBytes || !out[m]) continue;
    const ids = Object.keys(out[m]);
    for (let i = ids.length - 1; i >= 0 && size > ROOM_LIMITS.roomBytes; i--) {
      if (only && !only(ids[i])) continue;
      size -= JSON.stringify(ids[i]).length + JSON.stringify(out[m][ids[i]]).length + 2;
      delete out[m][ids[i]];
    }
    if (!Object.keys(out[m]).length) delete out[m];
    size = JSON.stringify(out).length;
  }
  say(warn)({ kind: 'room', message: `the room was ${Math.ceil(was / 1024)} KB as JSON; it keeps ${Math.ceil(size / 1024)} KB (a room holds up to ${ROOM_LIMITS.roomBytes / 1024} KB)` });
}

/* ------------------------------------------------------------------------------------------------ the sheet */
export function cleanSheet(x, { warn = null } = {}) {
  if (!isObj(x)) { if (x != null) say(warn)({ kind: 'sheet', message: 'the song\'s sheet was not an object: it was left out' }); return null; }
  const k = { v: Number.isInteger(x.v) && x.v >= 1 ? x.v : 1 };
  if (Number.isInteger(x.capo) && x.capo >= 1 && x.capo <= 11) k.capo = x.capo;
  if (validMeter(x.time)) k.time = [x.time[0], x.time[1]];
  let chars = 0;
  if (typeof x.notes === 'string') { const n = cut(plainLines(x.notes), ROOM_LIMITS.notesChars); if (n) { k.notes = n; chars += n.length; } }
  const used = new Set();
  const mint = (prefix, n) => { let id = `${prefix}_${n.toString(36)}`; for (let j = 2; used.has(id); j++) id = `${prefix}_${n.toString(36)}_${j}`; used.add(id); return id; };
  const take = (v) => (isSheetId(v) && !used.has(v) ? (used.add(v), v) : null);
  const secs = [], dropped = { sections: 0, lines: 0 };
  let lines = 0, n = 0, full = false, stopped = false;
  const list = Array.isArray(x.sections) ? x.sections.filter(isObj) : [];
  for (const s of list) {
    if (stopped || secs.length >= ROOM_LIMITS.sheetSections) { dropped.sections++; continue; }
    const name = cut(plain(typeof s.name === 'string' ? s.name : typeof s.name === 'number' && Number.isFinite(s.name) ? String(s.name) : ''), ROOM_LIMITS.nameChars) || 'Section';
    // (a name counts toward the characters too: the first that doesn't fit goes, and every section after it)
    if (chars + name.length > ROOM_LIMITS.sheetChars) { stopped = full = true; dropped.sections++; continue; }
    const sec = { id: take(s.id) || mint('ss', secs.length), name, lines: [] };
    chars += name.length;
    for (const l of Array.isArray(s.lines) ? s.lines.filter(isObj) : []) {
      const text = cut(plain(typeof l.text === 'string' ? l.text : ''), ROOM_LIMITS.lineChars);
      // (past a cap every later line goes too: the sheet stops there rather than skipping one and keeping the next)
      if (full || lines >= ROOM_LIMITS.sheetLines || chars + text.length > ROOM_LIMITS.sheetChars) { full = true; dropped.lines++; continue; }
      const by = typeof l.by === 'string' && l.by && l.by.length <= 64 ? l.by : 'you';
      sec.lines.push(ordered({ id: take(l.id) || mint('sl', n), text, by }, ORDER.line, l));
      lines++; n++; chars += text.length;
    }
    secs.push(ordered(sec, ORDER.section, s));
  }
  if (dropped.sections || dropped.lines) {
    const what = [dropped.sections && `${dropped.sections} section${dropped.sections === 1 ? '' : 's'}`, dropped.lines && `${dropped.lines} line${dropped.lines === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
    say(warn)({ kind: 'sheet', message: `the sheet was past its caps (${ROOM_LIMITS.sheetSections} sections, ${ROOM_LIMITS.sheetLines} lines, ${ROOM_LIMITS.sheetChars.toLocaleString('en-US')} characters): ${what} left out` });
  }
  k.sections = secs;
  return ordered(k, ORDER.sheet, x);
}

/* ------------------------------------------------------------------------------------------------ key order */
// The ops keep the room and the sheet canonical, so an inverse puts back exactly what was there (keys in their order
// too: a song's JSON is what History and the checks compare).
// placeKey(obj, key, value, at): obj[key] = value as its at-th key (the end when at is past it); the same object.
export function placeKey(obj, key, value, at) {
  const keys = Object.keys(obj);
  if (!(Number.isInteger(at) && at >= 0 && at < keys.length)) { obj[key] = value; return obj; }
  const tail = keys.slice(at).map((k) => [k, obj[k]]);
  for (const [k] of tail) delete obj[k];
  obj[key] = value;
  for (const [k, v] of tail) if (k !== key) obj[k] = v;
  return obj;
}
// putKey(obj, key, value, order): set it, a new key going where `order` puts it (before the first key that comes after
// it there, or any key `order` doesn't know); a key already there stays where it is.
export function putKey(obj, key, value, order) {
  if (Object.hasOwn(obj, key)) { obj[key] = value; return obj; }
  const rank = order.indexOf(key);
  const at = Object.keys(obj).findIndex((k) => { const r = order.indexOf(k); return r < 0 || r > rank; });
  return placeKey(obj, key, value, at);
}

/* ------------------------------------------------------------------------------------------------ readers */
export const roomOf = (p) => (isObj(p) && isObj(p.room) ? p.room : null);
export function partOf(p, section) {
  const id = isObj(section) ? section.id : section;
  const parts = roomOf(p)?.parts;
  return typeof id === 'string' && isObj(parts) && Object.hasOwn(parts, id) && isObj(parts[id]) ? parts[id] : null;
}
export const sheetOf = (p) => (isObj(p) && isObj(p.sheet) ? p.sheet : null);
