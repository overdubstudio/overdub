// The jobs cache (spec 0014 R19): finished results kept in IndexedDB ('overdub-jobs', beside 'overdub-assets' and
// 'overdub-analysis') by the input's SHA-256, the model's id and the model's version, so the same song is never split
// twice. The song keeps its own copy of what a job made (assets, R20); this is a convenience, and when IndexedDB is
// refused (private windows, file://, Node) it lives in memory for the session.
//
//   const cache = createJobsCache({ idb? })   idb: an IDBFactory (default globalThis.indexedDB), null for memory
//   await cache.get(key) -> result | null ; await cache.put(key, result) ; await cache.mode() -> 'idb' | 'memory'
//   await inputHash({ sr, channels }) -> sha-256 hex of the rate and every channel as 32-bit floats
//   await jobKey(kind, input, model) -> '<kind>:<input sha-256>:<model id>:<model version>'

export const DB = 'overdub-jobs', STORE = 'results', VERSION = 1;

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

export function createJobsCache({ idb = globalThis.indexedDB } = {}) {
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

export const channelsOf = (input) => (ArrayBuffer.isView(input.channels) ? [input.channels] : input.channels || []);

export async function inputHash(input) {
  const chs = channelsOf(input), enc = new TextEncoder();
  const parts = [enc.encode(`sr=${input.sr};channels=${chs.length};`)];
  for (const c of chs) { const f = c instanceof Float32Array ? c : Float32Array.from(c); parts.push(new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); }
  let n = 0;
  for (const p of parts) n += p.length;
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function jobKey(kind, input, model) {
  return `${kind}:${await inputHash(input)}:${model.id}:${model.version}`;
}
