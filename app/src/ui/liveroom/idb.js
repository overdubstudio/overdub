// @ts-check
// A small IndexedDB opener for the guitar room's stores [ui; guitar room] (ui/liveroom/riffs-db.js, rack-db.js): one
// database per store, opened once, let go when another tab upgrades it, and null (never a throw) where the browser
// refuses IndexedDB (a private window, file://, blocked site data, Node), so each store can fall back to memory.
//
//   const open = opener(name, version, upgrade(db, tx, oldVersion))
//   await open() -> IDBDatabase | null       (null for good once refused: the store says so, and keeps the visit's)
//   open.refused -> bool                     (after the first open)
//   done(tx) -> Promise                      resolves when tx completes, rejects with its error on error or abort
//   req(rq) -> Promise<result>

export function opener(name, version, upgrade) {
  let dbp = null, dead = false;
  const tryOpen = () => new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      const rq = indexedDB.open(name, version);
      rq.onupgradeneeded = (e) => { try { upgrade(rq.result, rq.transaction, e.oldVersion || 0); } catch (err) { console.warn('overdub ' + name + ': upgrade failed', err && err.message); try { rq.transaction.abort(); } catch { /* gone */ } } };
      rq.onsuccess = () => {
        const db = rq.result;
        db.onversionchange = () => { try { db.close(); } catch { /* ok */ } dbp = null; };
        resolve(db);
      };
      rq.onerror = () => resolve(null);
      rq.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  const open = () => (dead ? Promise.resolve(null) : dbp || (dbp = tryOpen().then((d) => { if (!d) { dead = true; open.refused = true; } return d; })));
  open.refused = false;
  return open;
}

export function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

export function req(rq) {
  return new Promise((resolve, reject) => {
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
