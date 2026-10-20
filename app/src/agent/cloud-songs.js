// @ts-check
// Songs in your Overdub account (agent/cloud.js, the service's songs module), the parts with no page in them: which
// song on screen is which song in the account (the link), which save each copy of a song was made from (its base),
// what a song's recordings are, and the saver that keeps a linked song saved there. ui/songs.js draws all of it.
//
//   const links = songLinks(storage)   localStorage overdub:cloud-song: { ['<user id> <project id>']: { songId, rev, savedAt } }
//   links.get(uid, pid) -> { songId, rev, savedAt } | null / links.set(uid, pid, link) / links.drop(uid, pid)
//   links.dropSong(uid, songId)        every song on this browser linked to that one (it was deleted from that account)
//                                      A link says which song in the account a project id is, in that account. Its rev
//                                      is the newest save this browser has seen, for show: never a base to save from.
//   const bases = songBases(storage)   localStorage overdub:cloud-base: { ['<user id> <stamp>']: { songId, rev, at, kept? } }
//   bases.get(uid, doc | stamp) -> { songId, rev } | null    the save this copy of a song was last saved or opened at
//   docStamp(doc) -> '<project id> <meta.modified>'          a copy of a song, as it is: every change moves modified
//   songAssets(doc) -> [asset id]      the recordings a song uses: its audio clips', doc.assets' keys, the reference's
//   savedAgo(ms, now) -> 'just now' | '2 min ago' | '3 h ago' | '4 d ago'
//   jsonBytes(doc) -> the size of its JSON in bytes, as the service counts it (maxBytes)
//   songNonce() -> a createId or saveId (the service's write nonces: 8 to 64 of [A-Za-z0-9_-])
//
//   const saver = createSaver({ cloud, links, bases, getDoc, user, delay, maxBytes, onState, timers })
//   saver.loaded(doc)        a song came on screen: its base is the one recorded with that copy, never a newer one
//   saver.changed()          the song on screen changed: it saves `delay` ms later (5 s), when it's linked
//   saver.replacing(doc)     the song on screen is about to be put aside as doc (Recent songs, Undo): doc keeps its
//                            base, and what was waiting goes now, as it was
//   saver.flush(doc?)        save now what's waiting (the tab is hidden; doc: a song being replaced, as it was)
//   saver.mark() -> token    the song on screen, now (for a create or an open that comes back later)
//   saver.based(uid, token, { songId, rev })   that copy is now at that save (created, opened, kept as a new song)
//   saver.state              { status, pid, uid, songId, savedAt, error, current, doc, song, gen }: status 'idle' |
//                            'waiting' | 'saving' | 'saved' (song: the row) | 'conflict' (current: the newer row, or null
//                            when this copy's base isn't known; doc: the copy that wasn't saved) | 'blocked' (no Plus,
//                            signed out, too big, gone) | 'error' (the service or the network: the next change tries
//                            again, with the same saveId)
//   saver.clear(pid?)        a conflict or a block settled (the newer one opened, yours kept as a new song, signed in)
//
// The base travels with the copy, not with the project id: the song on screen keeps its own in memory (one per account),
// a copy put aside (overdub:previous, Recent songs, the song before Make it yours) is recorded with the base it had,
// and so is each state the local autosave (overdub:project) can hold, so a reload or an Undo picks up the right one. A
// copy whose base isn't known saves nothing and is a conflict, so the person picks. A conflict is never settled here:
// the person picks (ui/songs.js). Nothing saves over a newer save.

const LINK_KEY = 'overdub:cloud-song';
const BASE_KEY = 'overdub:cloud-base';
const LINKS_MAX = 200;
const BASES_MAX = 120;   // of each kind: kept (a copy put aside) and the trail (states of the songs on screen)
const LINES_MAX = 16;    // songs on screen this page remembers the bases of (each load is one)

/** @typedef {{ songId: string, rev: number, savedAt: number }} Link */
/** @typedef {{ songId: string, rev: number }} Base */
/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void }} Storage */

/** @param {Storage | null} storage @param {string} key */
function stored(storage, key) {
  /** @returns {Record<string, any>} */
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(key) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  };
  /** @param {Record<string, any>} all */
  const write = (all) => { try { storage?.setItem(key, JSON.stringify(all)); } catch { /* storage full or blocked: for this visit */ } };
  return { read, write };
}
// (the oldest go first past max)
const trim = (all, keys, max, when) => { if (keys.length > max) for (const k of keys.sort((a, b) => when(all[a]) - when(all[b])).slice(0, keys.length - max)) delete all[k]; };

/** @param {Storage | null} storage */
export function songLinks(storage) {
  const { read, write } = stored(storage, LINK_KEY);
  const ok = (l) => !!l && typeof l.songId === 'string' && Number.isFinite(l.rev);
  const key = (uid, pid) => (uid && pid ? `${uid} ${pid}` : '');
  const save = (all) => { trim(all, Object.keys(all), LINKS_MAX, (l) => l?.savedAt || 0); write(all); };
  return {
    /** @param {string} uid @param {string} pid @returns {Link | null} */
    get(uid, pid) { const l = read()[key(uid, pid)]; return key(uid, pid) && ok(l) ? l : null; },
    /** @param {string} uid @param {string} pid @param {Link} l */
    set(uid, pid, l) { if (!key(uid, pid)) return; const all = read(); all[key(uid, pid)] = { songId: l.songId, rev: Number(l.rev), savedAt: Number(l.savedAt) || 0 }; save(all); },
    /** @param {string} uid @param {string} pid */
    drop(uid, pid) { const all = read(), k = key(uid, pid); if (k in all) { delete all[k]; write(all); } },
    /** @param {string} uid @param {string} songId */
    dropSong(uid, songId) { const all = read(); let n = 0; for (const [k, l] of Object.entries(all)) if (k.startsWith(`${uid} `) && l?.songId === songId) { delete all[k]; n++; } if (n) write(all); return n; },
  };
}

/** @param {any} doc */
export const docStamp = (doc) => `${doc?.id || ''} ${doc?.meta?.modified || ''}`;

/** @param {Storage | null} storage */
export function songBases(storage) {
  const { read, write } = stored(storage, BASE_KEY);
  const ok = (b) => !!b && typeof b.songId === 'string' && Number.isSafeInteger(b.rev) && b.rev >= 1;
  const stampOf = (x) => (typeof x === 'string' ? x : docStamp(x));
  const key = (uid, x) => (uid ? `${uid} ${stampOf(x)}` : '');
  const save = (all) => {
    const keys = Object.keys(all);
    trim(all, keys.filter((k) => all[k]?.kept), BASES_MAX, (b) => b?.at || 0);
    trim(all, keys.filter((k) => k in all && !all[k]?.kept), BASES_MAX, (b) => b?.at || 0);
    write(all);
  };
  return {
    /** @param {string} uid @param {any} x a doc or its stamp @returns {Base | null} */
    get(uid, x) { const b = read()[key(uid, x)]; return key(uid, x) && ok(b) ? { songId: b.songId, rev: b.rev } : null; },
    /** @param {string} uid @param {any} x @param {Base} b @param {{ kept?: boolean }} [o] kept: a copy put aside */
    set(uid, x, b, { kept = false } = {}) {
      if (!key(uid, x) || !ok(b)) return;
      const all = read(), k = key(uid, x);
      all[k] = { songId: b.songId, rev: b.rev, at: Date.now(), ...(kept || all[k]?.kept ? { kept: true } : {}) };
      save(all);
    },
    /** a state of the song on screen it has moved on from (never a copy put aside) @param {string} uid @param {string} stamp */
    unset(uid, stamp) { const all = read(), k = key(uid, stamp); if (all[k] && !all[k].kept) { delete all[k]; write(all); } },
    /** @param {string} stamp @returns {[string, Base][]} every account's base for that copy */
    forStamp(stamp) { return Object.entries(read()).filter(([k, b]) => k.endsWith(` ${stamp}`) && ok(b)).map(([k, b]) => [k.slice(0, k.length - stamp.length - 1), { songId: b.songId, rev: b.rev }]); },
    /** @param {string} uid @param {string} songId */
    dropSong(uid, songId) { const all = read(); let n = 0; for (const [k, b] of Object.entries(all)) if (k.startsWith(`${uid} `) && b?.songId === songId) { delete all[k]; n++; } if (n) write(all); },
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

export const songNonce = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

// the answers that stop saving until something changes (the person signs in, gets Plus, picks a way out)
const BLOCKS = new Set(['songs_need_plus', 'not_signed_in', 'song_too_large', 'song_not_found']);

/**
 * @param {{ cloud: { saveSong(id: string, doc: any, baseRev: number, saveId?: string): Promise<any> },
 *   links: ReturnType<typeof songLinks>, bases: ReturnType<typeof songBases>, getDoc: () => any, user?: () => string,
 *   delay?: number, maxBytes?: number | (() => number), onState?: (s: any) => void,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }, nonce?: () => string }} o
 */
export function createSaver({ cloud, links, bases, getDoc, user = () => '', delay = 5000, maxBytes = 0, onState = () => {}, timers = globalThis, nonce = songNonce }) {
  /** @type {any} */
  let timer = 0;
  let waitingDoc = null;   // the song on screen when the timer was set (a load without a 'replacing' saves it as it was)
  /** @type {Promise<void> | null} */
  let inflight = null;
  // what waits to go, in order, one entry per song: 'live' (the song on screen, as it is when it goes) or a copy put
  // aside, by its stamp. Each one is sent; none drops another.
  /** @type {Map<string, { doc: any, gen: number }>} */
  const pending = new Map();
  /** @type {{ status: string, pid: string | null, uid: string, songId: string | null, savedAt: number, error: any, current: any, doc: any, song: any, gen: number }} */
  let state;
  const held = new Map();   // pid -> { error, doc, gen, songId }: the conflict or block that stops the song on screen saving
  // a save whose answer never came (the network, the service): the same one goes again, with its saveId, so a save
  // that landed is answered as a repeat (200, nothing written) and not as a conflict with itself
  /** @type {Map<string, { saveId: string, text: string }>} */
  const unsure = new Map();
  // each song that came on screen (one per load): the stamp it came at, its base in each account (resolved once, from
  // the copy it was loaded from, then moved on by its own saves only), the trail of states recorded for the autosave,
  // and the copies of it put aside
  /** @type {Map<number, { from: string, base: Map<string, Base | null>, trail: string[], aside: Set<string> }>} */
  const lines = new Map();
  let gen = 0;
  const blank = { status: 'idle', pid: null, uid: '', songId: null, savedAt: 0, error: null, current: null, doc: null, song: null, gen: 0 };
  state = { ...blank };
  const set = (s) => { state = { ...blank, gen, ...s }; try { onState(state); } catch (e) { console.error('cloud songs', e); } };
  const limit = () => (typeof maxBytes === 'function' ? maxBytes() : maxBytes) || 0;
  const same = (a, b) => !!a && !!b && a.songId === b.songId && a.rev === b.rev;

  function line(g = gen) { return lines.get(g) || null; }
  /** @param {string} uid @param {number} g @param {any} doc @returns {Base | null} */
  function baseOf(uid, g, doc) {
    const ln = line(g);
    if (!ln) return bases.get(uid, doc);
    if (!ln.base.has(uid)) ln.base.set(uid, bases.get(uid, ln.from));
    return ln.base.get(uid) || null;
  }
  // the song on screen as it is now carries its line's bases (the local autosave may hold this state on a reload)
  function trail(doc = getDoc()) {
    const ln = line();
    if (!ln || !doc || doc.id !== ln.from.slice(0, ln.from.indexOf(' '))) return;
    const st = docStamp(doc);
    let wrote = false;
    for (const [uid, b] of ln.base) if (b) { bases.set(uid, st, b); wrote = true; }
    if (!wrote || ln.trail.at(-1) === st) return;
    ln.trail.push(st);
    // two states back is gone (the autosave is 500 ms behind at most): never the one it came at, nor one put aside
    while (ln.trail.length > 2) { const old = ln.trail.shift(); if (old !== ln.from && !ln.aside.has(old)) for (const uid of ln.base.keys()) bases.unset(uid, old); }
  }

  function loaded(doc) {
    // a song replaced without a word first (not through replacing): what was waiting for it goes, as it was
    if (timer && waitingDoc) { timers.clearTimeout(timer); timer = 0; pending.delete('live'); queue(waitingDoc, gen); }
    gen++;
    const from = docStamp(doc);
    lines.set(gen, { from, base: new Map(bases.forStamp(from)), trail: [], aside: new Set() });
    for (const g of lines.keys()) if (lines.size > LINES_MAX && g !== gen) lines.delete(g);
    if (doc?.id) held.delete(doc.id);   // (a hold was about another copy; this one finds out its own way)
    waitingDoc = null;
    if (pending.size) drain();
  }

  function changed() {
    const doc = getDoc();
    if (!doc) return;
    trail(doc);
    const uid = user();
    if (!uid || held.has(doc.id)) return;   // nothing more until the person settles it
    const base = baseOf(uid, gen, doc);
    const l = links.get(uid, doc.id);
    if (!l && !base) return;
    timers.clearTimeout(timer);
    waitingDoc = doc;
    timer = timers.setTimeout(() => { timer = 0; waitingDoc = null; queue(null, gen); drain(); }, delay);
    set({ status: 'waiting', pid: doc.id, uid, savedAt: l?.savedAt || 0 });
  }
  /** @param {any} doc */
  function replacing(doc) {
    const ln = line();
    if (doc && ln) {
      const st = docStamp(doc);
      ln.aside.add(st);
      for (const [uid, b] of ln.base) if (b) bases.set(uid, st, b, { kept: true });
    }
    return flush(doc);
  }
  /** @param {any} [snapshot] */
  function flush(snapshot = null) {
    if (snapshot) {
      // the song on screen is going: what was waiting for it is this copy now
      if (!timer && !pending.has('live')) return inflight || Promise.resolve();   // (a copy alone is no reason to save)
      timers.clearTimeout(timer); timer = 0; waitingDoc = null;
      pending.delete('live');
      queue(snapshot, gen);
    } else {
      if (!timer) return inflight || Promise.resolve();   // nothing waiting
      timers.clearTimeout(timer); timer = 0; waitingDoc = null;
      queue(null, gen);
    }
    return drain();
  }
  function queue(doc, g) { pending.set(doc ? `${g} ${docStamp(doc)}` : 'live', { doc, gen: g }); }
  /** @returns {Promise<void>} */
  function drain() {
    if (inflight) return inflight;
    inflight = (async () => {
      while (pending.size) {
        const [k, e] = pending.entries().next().value;
        pending.delete(k);
        await send(e);
      }
    })().finally(() => { inflight = null; });
    return inflight;
  }

  /** @param {{ doc: any, gen: number }} e */
  async function send(e) {
    const uid = user();
    const live = !e.doc;
    const doc = live ? getDoc() : e.doc;
    const pid = doc?.id;
    if (!uid || !pid || (live && held.has(pid))) return;
    const g = live ? gen : e.gen;
    const base = baseOf(uid, g, doc);
    const l = links.get(uid, pid);
    if (!l && !base) return;
    const songId = base?.songId || l?.songId || '';
    const about = { pid, uid, songId, savedAt: l?.savedAt || 0, doc, gen: g };
    const hold = (status, error, extra = {}) => {
      if (live || g === gen) held.set(pid, { error, doc, gen: g, songId });
      set({ ...about, status, error, ...extra });
    };
    if (!base) {
      // a copy whose base isn't known (put aside before this browser kept bases, or by another account): saving it
      // could go over a newer save, so it doesn't; the person picks
      hold('conflict', { code: 'song_conflict', status: 409, message: 'This copy’s place in your account’s saves isn’t known.', details: { current: null, unknown: true } }, { current: null });
      return;
    }
    const text = JSON.stringify(doc);
    const bytes = limit() ? new TextEncoder().encode(text).length : 0;
    if (limit() && bytes > limit()) {
      hold('blocked', { code: 'song_too_large', message: `Too big for a cloud save: ${mb(bytes)} of ${mb(limit())}.`, details: { bytes, max: limit() } });
      return;
    }
    const key = `${uid} ${songId} ${base.rev}`;
    const again = unsure.get(key);
    const saveId = again?.saveId || nonce();
    const body = again ? again.text : text;
    const sentStamp = docStamp(doc);
    set({ ...about, status: 'saving' });
    try {
      const song = await cloud.saveSong(songId, JSON.parse(body), base.rev, saveId);
      unsure.delete(key);
      const next = { songId: song?.songId || songId, rev: Number(song?.rev) || base.rev + 1 };
      const savedAt = Number(song?.savedAt) || Date.now();
      advance(uid, g, base, next, sentStamp);
      const cur = links.get(uid, pid);
      if (!cur || cur.songId === next.songId) links.set(uid, pid, { songId: next.songId, rev: Math.max(next.rev, cur?.songId === next.songId ? cur.rev : 0), savedAt });
      // a repeat answered: the song had moved on since that first try, so its newest state goes too
      if (again && again.text !== text) queue(live && g === gen ? null : doc, g);
      set({ ...about, songId: next.songId, savedAt, song, doc: JSON.parse(body), status: timer || pending.size ? 'waiting' : 'saved' });   // (changed again while it was out)
    } catch (err) {
      const code = err?.code || '';
      if (code === 'song_conflict') { unsure.delete(key); hold('conflict', err, { current: err.details?.current || null }); }
      else if (code === 'song_not_found' && user() !== uid) set({ ...about, status: 'error', error: err });   // (another account's now: theirs stays)
      else if (BLOCKS.has(code) || err?.status === 401) {
        unsure.delete(key);
        if (code === 'song_not_found') { links.drop(uid, pid); bases.dropSong(uid, songId); }   // gone from that account
        hold('blocked', err);
      } else {
        unsure.set(key, { saveId, text: body });
        set({ ...about, status: 'error', error: err });
      }
    }
  }
  // a save made: every copy that stood on the base it was made from stands on the new one (the line it came from, the
  // state that went, the copies of that line put aside, and a line that came on screen from one of them)
  function advance(uid, g, sent, next, sentStamp) {
    const ln = line(g);
    const stamps = new Set([sentStamp, ...(ln ? ln.aside : [])]);
    for (const st of stamps) if (st === sentStamp || same(bases.get(uid, st), sent)) bases.set(uid, st, next);
    for (const [k, x] of lines) if ((k === g || stamps.has(x.from)) && same(x.base.get(uid), sent)) x.base.set(uid, next);
    trail();
  }

  return {
    loaded,
    changed,
    replacing,
    flush,
    get gen() { return gen; },
    get state() { return state; },
    held: (pid) => held.get(pid)?.error || null,
    conflict: (pid) => held.get(pid) || null,
    mark: () => { const doc = getDoc(); return { gen, stamp: docStamp(doc), doc }; },
    /** @param {string} uid @param {{ gen: number, stamp: string }} token @param {Base} b */
    based(uid, token, b) {
      if (!uid || !b?.songId) return;
      const base = { songId: b.songId, rev: Number(b.rev) || 1 };
      const ln = line(token.gen);
      bases.set(uid, token.stamp, base, { kept: !!ln && token.gen !== gen });
      if (ln && !(token.gen !== gen && ln.aside.size && !ln.aside.has(token.stamp))) ln.base.set(uid, base);
      for (const [k, x] of lines) if (k !== token.gen && x.from === token.stamp) x.base.set(uid, base);
      trail();
    },
    /** @param {string} [pid] */
    clear(pid) {
      if (pid) held.delete(pid); else held.clear();
      const doc = getDoc(), uid = user(), l = doc && links.get(uid, doc.id);
      set(l ? { status: 'saved', pid: doc.id, uid, songId: l.songId, savedAt: l.savedAt } : { status: 'idle' });
    },
  };
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
