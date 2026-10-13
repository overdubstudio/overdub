// The analysis cache (spec 0014 R12): results kept in IndexedDB ('overdub-analysis', beside 'overdub-assets') by the
// input's SHA-256 and ANALYZER_VERSION, so the same recording is analysed once. The song keeps only the conclusions
// (toOps.js); the cache is a convenience, and when IndexedDB is refused (private windows, file://, Node) it lives in
// memory for the session.
//
//   const cache = createAnalysisCache({ idb? })   idb: an IDBFactory (default globalThis.indexedDB), null for memory
//   await cache.get(key) -> result | null ; await cache.put(key, result) ; await cache.mode() -> 'idb' | 'memory'
//   await inputKey({ sr, mix?, stems? }) -> '<sha-256 hex>:<ANALYZER_VERSION>'
import { ANALYZER_VERSION } from './index.js';

export const DB = 'overdub-analysis', STORE = 'results', VERSION = 1;

function openDB(idb) {
  return new Promise((resolve) => {
    try {
      if (!idb) return resolve(null);
      const rq = idb.open(DB, VERSION);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(STORE, mode), rq = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(rq ? rq.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

export function createAnalysisCache({ idb = globalThis.indexedDB } = {}) {
  const mem = new Map();
  let dbp = null;
  const db = () => (dbp || (dbp = openDB(idb)));
  return {
    async mode() { return (await db()) ? 'idb' : 'memory'; },
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      const d = await db();
      if (!d) return null;
      try { const v = await tx(d, 'readonly', (s) => s.get(key)); if (v) mem.set(key, v); return v || null; } catch { return null; }
    },
    async put(key, value) {
      mem.set(key, value);
      const d = await db();
      if (d) { try { await tx(d, 'readwrite', (s) => s.put(value, key)); } catch { /* memory only */ } }
    },
  };
}

// The input's fingerprint: its sample rate, then each signal (mix, then the stems by name) as 32-bit floats.
export async function inputKey({ sr, mix, stems = {} }) {
  const parts = [new TextEncoder().encode(`sr=${sr};`)];
  const add = (name, x) => {
    if (x == null) return;
    const chs = ArrayBuffer.isView(x) ? [x] : x;
    parts.push(new TextEncoder().encode(`${name}:${chs.length};`));
    for (const c of chs) { const f = c instanceof Float32Array ? c : Float32Array.from(c); parts.push(new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); }
  };
  add('mix', mix);
  for (const k of ['vocals', 'drums', 'bass', 'other']) add(k, stems[k]);
  let n = 0;
  for (const p of parts) n += p.length;
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('') + ':' + ANALYZER_VERSION;
}
