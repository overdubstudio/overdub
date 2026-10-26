// @ts-check
// The room's ops [core] (docs/research/LIVE-ROOM-MODE.md §9.2), registered in core/ops.js OPS from ROOM_OPS. Each is
// (p, op, ctx) -> { inverse: [ops], created? }, as every op is, and keeps the song's room canonical
// (core/liveroom/model.js ORDER), so an inverse puts back exactly what was there, the order of its keys included.
//
//   room.set       { patch: { place?, rig?, tuning?, finish?, master?, mic?, tracks?, takes?, managed? } }
//                  whole values; null deletes a key (an empty map too); makes the room ({ v: 1 }) when the song has
//                  none. { clear: true } takes the whole room out.
//                  -> inverse: room.set with each key's old value (null where it was absent), or { clear: true } when
//                     the song had no room
//   room.part.set  { section, patch: { feel?, busy?, loud?, reps?, oneSide?, drop?, sheet?, learned? } }
//                  merged into room.parts[section] (null deletes a key; a part left with none goes, and so does an
//                  empty parts); makes the room when the song has none. { section, remove: true } takes the part out.
//                  -> inverse: the old values, or { section, remove: true } when the section had no part
//
//   place: PLACE_IDS · rig: RIG_IDS · tuning: a core/fretboard.js TUNINGS id ("drop-c"; any id of its shape, so a song
//   can name one a newer studio knows) · finish: a FINISHES id · master: a clip (the kitchen's take the band follows) ·
//   mic: 'one' | 'two' · tracks: { role: track } (ROLES) · takes: { clip: { capo 0-11, bpm 20-400, onMaster } } ·
//   managed: { track | 'master': { gain -96..24 dB, pan -1..1, chain (a short hash, 64 characters at most) } }
//   feel: FEEL_IDS · busy, loud: -1, 0 or 1 · reps: 1-4 · oneSide, drop: true or false · sheet: a sheet section ·
//   learned: { from (the clip it was learned from), thin (the read was thin) }
// Track, clip, section and sheet section ids may be $refs made earlier in the same dispatch; a track is also found
// by its name. false and capo 0 are stored as no key (as clip.set stores mute and capo). Undo, redo and reverts
// (ctx.restore) put back what was there without holding it to these rules or to the song: a track it names may have
// gone since. Internal forms, for inverses only: room.set { _restore, _at } and room.part.set { section, _restore, _at }.

import { PLACE_IDS, RIG_IDS, FINISHES, FEEL_IDS, ROLES, ORDER, putKey, placeKey } from './model.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
// (what isn't plain text: control characters and bidi overrides or isolates, core/project.js plainText's rule)
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const isWord = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
const isRef = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && !/[\u0000-\u001f]/.test(v) && !UNSAFE.has(v);
const list = (xs) => xs.join(', ');
const SET_KEYS = ['place', 'rig', 'tuning', 'finish', 'master', 'mic', 'tracks', 'takes', 'managed'];
const ALL_FINISHES = [...new Set(Object.values(FINISHES).flat())];

function resolve(ctx, id) {
  if (typeof id === 'string' && id.startsWith('$')) {
    const r = ctx.refs && ctx.refs[id.slice(1)];
    if (!r) throw new Error(`unknown reference ${id} (refs are made by ref: "name" on an earlier op in the same call)`);
    return r;
  }
  return id;
}
function trackId(p, ctx, ref, what) {
  const id = resolve(ctx, ref);
  const t = p.tracks.find((x) => x.id === id) || p.tracks.find((x) => String(x.name).toLowerCase() === String(id).toLowerCase());
  if (!t) throw new Error(`${what} names no track: "${id}" (tracks: ${p.tracks.map((x) => `${x.id} "${x.name}"`).join(', ') || 'none'})`);
  return t.id;
}
function clipId(p, ctx, ref, what) {
  const id = resolve(ctx, ref);
  for (const t of p.tracks) for (const c of t.clips) if (c.id === id) return c.id;
  throw new Error(`${what} names no clip: "${id}"`);
}
// A map an op sets whole: an object, or null; {} is null (no key).
function mapArg(v, what) {
  if (!isObj(v)) throw new Error(`${what} is an object (or null to take it out)`);
  return Object.keys(v).length ? v : null;
}

// A room key's value as the song keeps it (checked), or null to delete it.
function roomValue(p, ctx, k, v) {
  if (v === null) return null;
  if (ctx.restore) return clone(v);
  switch (k) {
    case 'place': if (!PLACE_IDS.includes(v)) throw new Error(`place is one of ${list(PLACE_IDS)}`); return v;
    case 'rig': if (!RIG_IDS.includes(v)) throw new Error(`rig is one of ${list(RIG_IDS)}`); return v;
    case 'tuning': if (!isWord(v)) throw new Error('tuning is a tuning id like "drop-d" or "standard" (core/fretboard.js TUNINGS)'); return v;
    case 'finish': if (!ALL_FINISHES.includes(v)) throw new Error(`finish is one of ${Object.entries(FINISHES).map(([pl, fs]) => `${fs.join('/')} (${pl})`).join(', ')}`); return v;
    case 'mic': if (v !== 'one' && v !== 'two') throw new Error('mic is "one" (one mic hears the guitar and the voice) or "two" (a mic and a pickup)'); return v;
    case 'master': return clipId(p, ctx, v, 'master');
    case 'tracks': {
      const m = mapArg(v, 'tracks');
      if (!m) return null;
      const out = {};
      for (const [role, ref] of Object.entries(m)) {
        if (!ROLES.includes(role)) throw new Error(`tracks: "${role}" isn't a role (roles: ${list(ROLES)})`);
        out[role] = trackId(p, ctx, ref, `tracks.${role}`);
      }
      return out;
    }
    case 'takes': {
      const m = mapArg(v, 'takes');
      if (!m) return null;
      const out = {};
      for (const [ref, e] of Object.entries(m)) {
        const id = clipId(p, ctx, ref, 'takes');
        if (!isObj(e)) throw new Error(`takes.${id} is { capo?, bpm?, onMaster? }`);
        const x = {};
        for (const [kk, vv] of Object.entries(e)) {
          if (!ORDER.take.includes(kk)) throw new Error(`a take is { capo, bpm, onMaster }: not "${kk}"`);
          if (kk === 'capo' && !(Number.isInteger(vv) && vv >= 0 && vv <= 11)) throw new Error('a take\'s capo is the fret it sits at, 0 (none) to 11');
          if (kk === 'bpm' && !(fin(vv) && vv >= 20 && vv <= 400)) throw new Error('a take\'s bpm is 20..400');
          if (kk === 'onMaster' && typeof vv !== 'boolean') throw new Error('onMaster is true or false');
        }
        for (const kk of ORDER.take) if (e[kk] != null && e[kk] !== false && e[kk] !== 0) x[kk] = e[kk];
        if (Object.keys(x).length) out[id] = x;
      }
      return Object.keys(out).length ? out : null;
    }
    case 'managed': {
      const m = mapArg(v, 'managed');
      if (!m) return null;
      const out = {};
      for (const [ref, e] of Object.entries(m)) {
        const id = ref === 'master' ? 'master' : trackId(p, ctx, ref, 'managed');
        if (!isObj(e)) throw new Error(`managed.${id} is { gain?, pan?, chain? }`);
        const x = {};
        for (const [kk, vv] of Object.entries(e)) {
          if (!ORDER.managed.includes(kk)) throw new Error(`managed is { gain, pan, chain } per track: not "${kk}"`);
          if (kk === 'gain' && !(fin(vv) && vv >= -96 && vv <= 24)) throw new Error('managed gain is in dB, -96..24');
          if (kk === 'pan' && !(fin(vv) && vv >= -1 && vv <= 1)) throw new Error('managed pan is -1..1');
          // (plain text, as the song keeps it: a character cleanRoom takes out would change it on the next load)
          if (kk === 'chain' && !(typeof vv === 'string' && vv.length <= 64 && !UNSEEN.test(vv))) throw new Error('managed chain is a short hash (plain text, 64 characters at most)');
        }
        for (const kk of ORDER.managed) if (e[kk] != null) x[kk] = e[kk];
        if (Object.keys(x).length) out[id] = x;
      }
      return Object.keys(out).length ? out : null;
    }
  }
  throw new Error(`room.set can't change "${k}" (${list(SET_KEYS)})`);
}

// A part key's value as the song keeps it (checked), or null to delete it.
function partValue(p, ctx, k, v) {
  if (v === null) return null;
  if (ctx.restore) return clone(v);
  switch (k) {
    case 'feel': if (!FEEL_IDS.includes(v)) throw new Error(`feel is one of ${list(FEEL_IDS)}`); return v;
    case 'busy': case 'loud': if (v !== -1 && v !== 0 && v !== 1) throw new Error(`${k} is -1, 0 or 1 (${k === 'busy' ? 'simpler, as it is, busier' : 'softer, as it is, louder'})`); return v;
    case 'reps': if (!(Number.isInteger(v) && v >= 1 && v <= 4)) throw new Error('reps is how many times the part plays its riff, 1 to 4'); return v;
    case 'oneSide': case 'drop': if (typeof v !== 'boolean') throw new Error(`${k} is true or false`); return v || null;
    case 'sheet': {
      const id = resolve(ctx, v);
      const secs = isObj(p.sheet) && Array.isArray(p.sheet.sections) ? p.sheet.sections : [];
      if (!secs.some((s) => s.id === id)) throw new Error(`sheet names no section of the sheet: "${id}" (the sheet's: ${secs.map((s) => `${s.id} "${s.name}"`).join(', ') || 'none'})`);
      return id;
    }
    case 'learned': {
      if (!isObj(v)) throw new Error('learned is { from?, thin? } (or null)');
      const x = {};
      for (const [kk, vv] of Object.entries(v)) {
        if (kk === 'from') { const id = resolve(ctx, vv); if (!isRef(id)) throw new Error('learned.from is the id of the clip the band learned from'); x.from = id; }
        else if (kk === 'thin') { if (typeof vv !== 'boolean') throw new Error('learned.thin is true or false'); x.thin = vv; }
        else throw new Error(`learned is { from, thin }: not "${kk}"`);
      }
      return Object.keys(x).length ? { ...(x.from != null ? { from: x.from } : {}), ...(x.thin != null ? { thin: x.thin } : {}) } : null;
    }
  }
  throw new Error(`room.part.set can't change "${k}" (${list(ORDER.part)})`);
}

// The section a part is for: by id, $ref or name. A restore may name one that has gone since.
function partSection(p, ctx, ref) {
  const id = resolve(ctx, isObj(ref) ? ref.id : ref);
  if (!isRef(id)) throw new Error('which section? section: "<section id>" (or its name, or a $ref)');
  const sec = p.sections.find((s) => s.id === id) || p.sections.find((s) => String(s.name).toLowerCase() === id.toLowerCase());
  if (sec) return sec.id;
  if (ctx.restore) return id;
  throw new Error(`no section "${id}" (sections: ${p.sections.map((s) => `${s.id} "${s.name}"`).join(', ') || 'none'})`);
}
const keysOf = (patch, what, ok) => {
  if (!isObj(patch) || !Object.keys(patch).length) throw new Error(`${what} takes patch: { ${ok.join(', ')} } (any of them; null deletes one)`);
  return Object.entries(patch);
};

export const ROOM_OPS = {
  'room.set'(p, op, ctx) {
    if (op._restore !== undefined) {
      if (isObj(p.room)) throw new Error('the song has a room already');
      placeKey(p, 'room', clone(op._restore), op._at);
      return { inverse: [{ type: 'room.set', clear: true }] };
    }
    if (op.clear === true) {
      if (!isObj(p.room)) throw new Error('the song has no room to clear');
      const at = Object.keys(p).indexOf('room'), old = p.room;
      delete p.room;
      return { inverse: [{ type: 'room.set', _restore: old, _at: at }] };
    }
    const next = keysOf(op.patch, 'room.set', SET_KEYS).map(([k, v]) => {
      if (!SET_KEYS.includes(k)) throw new Error(`room.set can't change "${k}" (${list(SET_KEYS)}; or clear: true)`);
      return [k, roomValue(p, ctx, k, v)];
    });
    const made = !isObj(p.room);
    if (made) p.room = { v: 1 };
    const room = p.room, inv = {};
    for (const [k, v] of next) {
      // (the old value leaves the song, so the inverse can hold it as it is)
      inv[k] = Object.hasOwn(room, k) ? room[k] : null;
      if (v === null) delete room[k]; else putKey(room, k, v, ORDER.room);
    }
    return { inverse: [made ? { type: 'room.set', clear: true } : { type: 'room.set', patch: inv }] };
  },

  'room.part.set'(p, op, ctx) {
    const id = partSection(p, ctx, op.section);
    if (op._restore !== undefined) {
      if (!isObj(p.room)) p.room = { v: 1 };
      if (!isObj(p.room.parts)) putKey(p.room, 'parts', {}, ORDER.room);
      if (Object.hasOwn(p.room.parts, id)) throw new Error(`section ${id} has a part already`);
      placeKey(p.room.parts, id, clone(op._restore), op._at);
      return { inverse: [{ type: 'room.part.set', section: id, remove: true }] };
    }
    if (op.remove === true) {
      const parts = isObj(p.room) ? p.room.parts : null;
      if (!isObj(parts) || !Object.hasOwn(parts, id)) throw new Error(`section ${id} has no part to remove`);
      const at = Object.keys(parts).indexOf(id), old = parts[id];
      delete parts[id];
      if (!Object.keys(parts).length) delete p.room.parts;
      return { inverse: [{ type: 'room.part.set', section: id, _restore: old, _at: at }] };
    }
    const next = keysOf(op.patch, 'room.part.set', ORDER.part).map(([k, v]) => {
      if (!ORDER.part.includes(k)) throw new Error(`room.part.set can't change "${k}" (${list(ORDER.part)}; or remove: true)`);
      return [k, partValue(p, ctx, k, v)];
    });
    const made = !isObj(p.room);
    if (made) p.room = { v: 1 };
    const room = p.room;
    if (!isObj(room.parts)) putKey(room, 'parts', {}, ORDER.room);
    const parts = room.parts, had = Object.hasOwn(parts, id) && isObj(parts[id]);
    const at = had ? Object.keys(parts).indexOf(id) : -1, before = had ? clone(parts[id]) : null;
    if (!had) parts[id] = {};
    const entry = parts[id], inv = {};
    for (const [k, v] of next) {
      inv[k] = Object.hasOwn(entry, k) ? entry[k] : null;
      if (v === null) delete entry[k]; else putKey(entry, k, v, ORDER.part);
    }
    if (!Object.keys(entry).length) {
      // a part left with nothing in it goes (and the room's parts with it, when it was the last)
      delete parts[id];
      if (!Object.keys(parts).length) delete room.parts;
      if (made) { delete p.room; return { inverse: [] }; }
      return { inverse: had ? [{ type: 'room.part.set', section: id, _restore: before, _at: at }] : [] };
    }
    if (made) return { inverse: [{ type: 'room.set', clear: true }] };
    if (!had) return { inverse: [{ type: 'room.part.set', section: id, remove: true }] };
    return { inverse: [{ type: 'room.part.set', section: id, patch: inv }] };
  },
};
