// @ts-check
// The room's own memory in this browser [ui; frozen] (docs/research/LIVE-ROOM-MODE.md §9.6): overdub:room in
// localStorage (the key is forever), { v: 1, side: 'room' | 'control', place, outputs: { [output label]: 'headphones'
// | 'speakers' }, said: { [song id]: [line ids] } }. said keeps the once-only lines from coming back after a reload, for
// the last 50 songs, without writing a step into the song. It's read again on every call, so two tabs agree; with
// storage blocked, unreadable or full it works for the page load, in memory. Keys a newer studio writes are kept.
//
// Frozen (§14.2):
//   prefs.get() -> { v, side, place, outputs, said }   a copy (side and place null until set)
//   prefs.set(patch) -> the same, after   side ('room' | 'control' | null), place (a place id | null) and outputs
//                                          (merged: an output set to null is forgotten); a value that isn't one of
//                                          those keeps what was there. said is mark's alone
//   prefs.said(song, id) -> bool   whether the line was said for that song (a song, or its id)
//   prefs.mark(song, id)           say that it was: the song becomes the newest of the 50 kept
//   prefs.key                      'overdub:room'

const KEY = 'overdub:room';
const SONGS = 50;
const PLACE = /^[a-z][a-z0-9-]{0,31}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const fresh = () => ({ v: 1, side: null, place: null, outputs: {}, said: {} });

// what's stored, cleaned: a side and a place as words, outputs as words, said as lists of ids (the newest song last)
function clean(x) {
  const out = fresh();
  if (!isObj(x)) return out;
  if (x.side === 'room' || x.side === 'control') out.side = x.side;
  if (typeof x.place === 'string' && PLACE.test(x.place)) out.place = x.place;
  if (isObj(x.outputs)) for (const [k, v] of Object.entries(x.outputs)) if (k.length <= 200 && (v === 'headphones' || v === 'speakers')) out.outputs[k] = v;
  if (isObj(x.said)) {
    for (const [song, ids] of Object.entries(x.said).slice(-SONGS)) {
      if (!song || song.length > 64 || song === '__proto__' || !Array.isArray(ids)) continue;
      out.said[song] = [...new Set(ids.filter((id) => typeof id === 'string' && id.length <= 64))].slice(-200);
    }
  }
  for (const [k, v] of Object.entries(x)) if (!(k in out) && k !== '__proto__') out[k] = v;
  return out;
}

let mem = null, memOnly = false;
function storage() { try { return globalThis.localStorage || null; } catch { return null; } }
// (storage blocked or missing: this page load's memory; what's stored but unreadable: nothing remembered)
function read() {
  if (!memOnly) {
    let s;
    try { const st = storage(); if (st) s = st.getItem(KEY); } catch { s = undefined; }
    if (s !== undefined) {
      let x = null;
      try { x = s ? JSON.parse(s) : null; } catch { x = null; }
      return (mem = clean(x));
    }
  }
  return mem || (mem = fresh());
}
function write(next) {
  mem = next;
  try {
    const st = storage();
    if (st) { st.setItem(KEY, JSON.stringify(next)); memOnly = false; }
  } catch { memOnly = true; /* blocked or full: this page load remembers it */ }
}
// (a song's id is whatever its file says: 'constructor' is a song like any other, never Object's; '__proto__', which
// setting a key can't make, is never remembered)
const songKey = (song) => String((isObj(song) ? song.id : song) || '');
const copy = (x) => JSON.parse(JSON.stringify(x));

export const prefs = {
  key: KEY,
  get() { return copy(read()); },
  set(patch = {}) {
    const cur = read(), p = isObj(patch) ? patch : {}, next = { ...cur };
    if (p.side === null || p.side === 'room' || p.side === 'control') next.side = p.side;
    if (p.place === null || (typeof p.place === 'string' && PLACE.test(p.place))) next.place = p.place;
    if (isObj(p.outputs)) {
      const o = { ...cur.outputs };
      for (const [k, v] of Object.entries(p.outputs)) { if (v === null) delete o[k]; else o[k] = v; }
      next.outputs = o;
    }
    for (const [k, v] of Object.entries(p)) if (!['v', 'side', 'place', 'outputs', 'said', '__proto__'].includes(k)) next[k] = v;
    write(clean(next));
    return prefs.get();
  },
  said(song, id) {
    const said = read().said, key = songKey(song);
    return Object.hasOwn(said, key) && said[key].includes(id);
  },
  mark(song, id) {
    const key = songKey(song);
    if (!key || key.length > 64 || key === '__proto__' || typeof id !== 'string' || !id) return;
    const cur = read(), said = { ...cur.said }, list = Object.hasOwn(said, key) ? said[key] : [];
    delete said[key];
    said[key] = list.includes(id) ? list : [...list, id];
    const keys = Object.keys(said);
    for (const k of keys.slice(0, Math.max(0, keys.length - SONGS))) delete said[k];
    write(clean({ ...cur, said }));
  },
};
