// @ts-check
// Songs in your Overdub account (agent/cloud.js, the service's songs module), the parts with no page in them: which
// song on screen is which song in the account (the link), what a song's recordings are, and the saver that keeps a
// linked song saved there. ui/songs.js draws all of it.
//
//   const links = songLinks(storage)   localStorage overdub:cloud-song: { [project id]: { songId, rev, savedAt } }
//   links.get(pid) -> { songId, rev, savedAt } | null / links.set(pid, link) / links.drop(pid)
//   links.dropSong(songId)             every song on this browser linked to that one (it was deleted)
//   songAssets(doc) -> [asset id]      the recordings a song uses: its audio clips', doc.assets' keys, the reference's
//   savedAgo(ms, now) -> 'just now' | '2 min ago' | '3 h ago' | '4 d ago'
//   jsonBytes(doc) -> the size of its JSON in bytes, as the service counts it (maxBytes)
//
//   const saver = createSaver({ cloud, links, getDoc, delay, maxBytes, onState, timers })
//   saver.changed()          the song on screen changed: it saves `delay` ms later (5 s), when it's linked
//   saver.flush(doc?)        save now what's waiting (the tab is hidden; doc: a song being replaced, as it was)
//   saver.state              { status, pid, savedAt, error, current }: status 'idle' | 'waiting' | 'saving' | 'saved' |
//                            'conflict' (current: the newer row) | 'blocked' (no Plus, signed out, too big, gone) |
//                            'error' (the service or the network: the next change tries again)
//   saver.clear(pid?)        a conflict or a block settled (the newer one opened, yours kept as a new song, signed in)
//
// A conflict is never settled here: the person picks (ui/songs.js). Nothing saves over a newer save.

const LINK_KEY = 'overdub:cloud-song';
const LINKS_MAX = 200;

/** @typedef {{ songId: string, rev: number, savedAt: number }} Link */
/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void }} Storage */

/** @param {Storage | null} storage */
export function songLinks(storage) {
  /** @returns {Record<string, Link>} */
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(LINK_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  };
  /** @param {Record<string, Link>} all */
  const write = (all) => {
    // the oldest saves go first past LINKS_MAX (a link is only a pointer: the song stays in the account)
    const keys = Object.keys(all);
    if (keys.length > LINKS_MAX) for (const k of keys.sort((a, b) => (all[a].savedAt || 0) - (all[b].savedAt || 0)).slice(0, keys.length - LINKS_MAX)) delete all[k];
    try { storage?.setItem(LINK_KEY, JSON.stringify(all)); } catch { /* storage full or blocked: linked for this visit */ }
  };
  let mem = read();
  const ok = (l) => !!l && typeof l.songId === 'string' && Number.isFinite(l.rev);
  return {
    /** @param {string} pid @returns {Link | null} */
    get(pid) { mem = read(); const l = mem[pid]; return ok(l) ? l : null; },
    /** @param {string} pid @param {Link} l */
    set(pid, l) { mem = read(); mem[pid] = { songId: l.songId, rev: Number(l.rev), savedAt: Number(l.savedAt) || 0 }; write(mem); },
    /** @param {string} pid */
    drop(pid) { mem = read(); if (pid in mem) { delete mem[pid]; write(mem); } },
    /** @param {string} songId */
    dropSong(songId) { mem = read(); let n = 0; for (const [k, l] of Object.entries(mem)) if (l?.songId === songId) { delete mem[k]; n++; } if (n) write(mem); return n; },
  };
}

/** @param {any} doc @returns {string[]} */
export function songAssets(doc) {
  const out = new Set();
  for (const t of Array.isArray(doc?.tracks) ? doc.tracks : []) for (const c of Array.isArray(t?.clips) ? t.clips : []) if (c && typeof c.asset === 'string' && c.asset) out.add(c.asset);
  if (doc?.assets && typeof doc.assets === 'object') for (const k of Object.keys(doc.assets)) out.add(k);
  if (typeof doc?.reference?.asset === 'string' && doc.reference.asset) out.add(doc.reference.asset);
  return [...out];
}

/** @param {number} ms @param {number} [now] */
export function savedAgo(ms, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

/** @param {any} doc */
export const jsonBytes = (doc) => new TextEncoder().encode(JSON.stringify(doc)).length;

// the answers that stop saving until something changes (the person signs in, gets Plus, picks a way out)
const BLOCKS = new Set(['songs_need_plus', 'not_signed_in', 'song_too_large', 'song_not_found']);

/**
 * @param {{ cloud: { saveSong(id: string, doc: any, baseRev: number): Promise<any> }, links: ReturnType<typeof songLinks>,
 *   getDoc: () => any, delay?: number, maxBytes?: number | (() => number), onState?: (s: any) => void,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout } }} o
 */
export function createSaver({ cloud, links, getDoc, delay = 5000, maxBytes = 0, onState = () => {}, timers = globalThis }) {
  /** @type {any} */
  let timer = 0;
  /** @type {Promise<void> | null} */
  let inflight = null;
  let again = null;   // a song that changed while a save was out: saved after it
  /** @type {{ status: string, pid: string | null, savedAt: number, error: any, current: any }} */
  let state = { status: 'idle', pid: null, savedAt: 0, error: null, current: null };
  const held = new Map();   // pid -> the conflict or block that stops it saving
  const set = (s) => { state = { status: 'idle', pid: null, savedAt: 0, error: null, current: null, ...s }; try { onState(state); } catch (e) { console.error('cloud songs', e); } };
  const limit = () => (typeof maxBytes === 'function' ? maxBytes() : maxBytes) || 0;

  function changed() {
    const doc = getDoc();
    const l = doc && links.get(doc.id);
    if (!l) return;
    if (held.has(doc.id)) return;   // nothing more until the person settles it
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = 0; run(null); }, delay);
    set({ status: 'waiting', pid: doc.id, savedAt: l.savedAt });
  }
  /** @param {any} [snapshot] */
  function flush(snapshot = null) {
    if (!timer) return inflight || Promise.resolve();   // nothing waiting (a snapshot alone is no reason to save)
    timers.clearTimeout(timer); timer = 0;
    return run(snapshot);
  }
  /** @param {any} snapshot @returns {Promise<void>} */
  function run(snapshot) {
    if (inflight) {
      // one save at a time per page: the newest state goes once this one's in
      again = snapshot || again || true;
      return inflight.then(() => undefined);
    }
    const doc = snapshot || getDoc();
    const pid = doc?.id;
    const l = pid && links.get(pid);
    if (!l || held.has(pid)) return Promise.resolve();
    const bytes = limit() ? jsonBytes(doc) : 0;
    if (limit() && bytes > limit()) {
      const error = { code: 'song_too_large', message: `Too big for a cloud save: ${mb(bytes)} of ${mb(limit())}.`, details: { bytes, max: limit() } };
      held.set(pid, error);
      set({ status: 'blocked', pid, savedAt: l.savedAt, error });
      return Promise.resolve();
    }
    set({ status: 'saving', pid, savedAt: l.savedAt });
    inflight = (async () => {
      try {
        const song = await cloud.saveSong(l.songId, doc, l.rev);
        const savedAt = Number(song?.savedAt) || Date.now();
        links.set(pid, { songId: song?.songId || l.songId, rev: Number(song?.rev) || l.rev + 1, savedAt });
        set({ status: timer || again ? 'waiting' : 'saved', pid, savedAt });   // (changed again while it was out)
      } catch (e) {
        const code = e?.code || '';
        if (code === 'song_conflict') {
          held.set(pid, e);
          set({ status: 'conflict', pid, savedAt: l.savedAt, error: e, current: e.details?.current || null });
        } else if (BLOCKS.has(code) || e?.status === 401) {
          held.set(pid, e);
          set({ status: 'blocked', pid, savedAt: l.savedAt, error: e });
        } else set({ status: 'error', pid, savedAt: l.savedAt, error: e });
      }
    })();
    return inflight.finally(() => {
      inflight = null;
      const next = again;
      again = null;
      if (next) return run(next === true ? null : next);
    });
  }
  return {
    changed,
    flush,
    get state() { return state; },
    held: (pid) => held.get(pid) || null,
    /** @param {string} [pid] */
    clear(pid) {
      if (pid) held.delete(pid); else held.clear();
      const doc = getDoc(), l = doc && links.get(doc.id);
      set(l ? { status: 'saved', pid: doc.id, savedAt: l.savedAt } : { status: 'idle' });
    },
  };
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
