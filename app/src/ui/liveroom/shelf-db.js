// @ts-check
// The shelf's store [ui; stream F] (docs/research/LIVE-ROOM-MODE.md §9.6): IndexedDB overdub-shelf (the name is
// forever), one record per room song, { id, song, at, title, place, finished, bytes }, written on the room's autosave
// beside overdub:project (ui/liveroom/shelf.js keep). Recent songs stay the control room's (ui/export.js).
//
// Frozen (§14.2), each a Promise:
//   put(record) -> stored (bool)   list() -> [records], newest first   get(id) -> record | null   remove(id) -> removed
//
//   record: id (the song's id), song (the project, as the store has it), at (ms: when it was kept), title, place (a
//   place id), finished (every part has its takes), bytes (its recordings, as the asset store keeps them). Fields a
//   newer studio adds are kept. A record that isn't one (no id, no song) is refused.
// When IndexedDB is refused (a private window, file://, blocked storage) the records live in this page's memory, as the
// asset store's do (engine/assets.js): the shelf still works for the visit, and says nothing it can't keep.
// DB 'overdub-shelf', version 1, store 'songs' (keyPath 'id').

const DB = 'overdub-shelf', STORE = 'songs', VERSION = 1;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const mem = new Map();
let dbp = null, dead = false;

function openDB() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const rq = indexedDB.open(DB, VERSION);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = () => {
        const db = rq.result;
        // (another tab upgrading the store: this one lets go, and comes back on the next call)
        db.onversionchange = () => { try { db.close(); } catch { /* ok */ } dbp = null; };
        resolve(db);
      };
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
const db = () => (dead ? Promise.resolve(null) : dbp || (dbp = openDB().then((d) => { if (!d) dead = true; return d; })));

function tx(d, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      const rq = fn(s);
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

// a record as it's kept: plain data (the song is the store's, so it's copied), its numbers finite
function clean(r) {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id || r.id.length > 64 || !isObj(r.song) || !Array.isArray(r.song.tracks)) return null;
  let out;
  try { out = JSON.parse(JSON.stringify(r)); } catch { return null; }
  out.at = Number.isFinite(r.at) ? r.at : Date.now();
  out.title = typeof r.title === 'string' ? r.title.slice(0, 200) : String(r.song.title || 'Untitled').slice(0, 200);
  out.place = typeof r.place === 'string' ? r.place : null;
  out.finished = !!r.finished;
  out.bytes = Number.isFinite(r.bytes) && r.bytes > 0 ? Math.round(r.bytes) : 0;
  return out;
}
const newest = (a, b) => (b.at || 0) - (a.at || 0) || String(a.id).localeCompare(String(b.id));

export async function put(record) {
  const r = clean(record);
  if (!r) return false;
  const d = await db();
  if (!d) { mem.set(r.id, r); return true; }
  try { await tx(d, 'readwrite', (s) => s.put(r)); return true; } catch (e) {
    // (full, or gone: this visit keeps it)
    console.warn('overdub shelf: could not keep', r.id, e && e.message);
    mem.set(r.id, r);
    return false;
  }
}

export async function list() {
  const out = new Map();
  const d = await db();
  if (d) {
    try { for (const r of (await tx(d, 'readonly', (s) => s.getAll())) || []) if (r && r.id) out.set(r.id, r); } catch { /* memory only */ }
  }
  for (const [id, r] of mem) if (!out.has(id) || (out.get(id).at || 0) < (r.at || 0)) out.set(id, r);
  return [...out.values()].sort(newest);
}

export async function get(id) {
  if (typeof id !== 'string' || !id) return null;
  const d = await db();
  let r = null;
  if (d) { try { r = (await tx(d, 'readonly', (s) => s.get(id))) || null; } catch { r = null; } }
  const m = mem.get(id) || null;
  return m && (!r || (m.at || 0) >= (r.at || 0)) ? m : r;
}

export async function remove(id) {
  if (typeof id !== 'string' || !id) return false;
  const had = mem.delete(id);
  const d = await db();
  if (!d) return had;
  try {
    const was = await tx(d, 'readonly', (s) => s.getKey(id));
    if (was === undefined) return had;
    await tx(d, 'readwrite', (s) => s.delete(id));
    return true;
  } catch { return had; }
}
