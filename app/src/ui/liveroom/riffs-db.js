// @ts-check
// The riff library [ui; guitar room] (docs/research/GUITAR-ROOM.md §2.4, §4.3): every riff you keep, across every song,
// in IndexedDB 'overdub-riffs' (the name is forever). What a riff is, and the filters, are core/liveroom/riffs.js's;
// this keeps them, pages them and puts one into a song. Built for thousands: a listing reads small rows through an
// index (newest first, by song, starred or tuning), never a riff's audio; the audio is read for one riff at a time
// (a preview, or into a song).
//
//   import * as riffs from './riffs-db.js';      every call is a Promise, and none throws
//
//   add(input) -> { ok: true, id, row, where: 'disk' | 'memory', note? } | { ok: false, error }
//       keep a riff: input as cleanRiff takes it ({ audio, tempo, beats?, bars?, meter?, offset?, name?, tuning?,
//       key?, stack?, song?, starred?, notes? }). It's "Riff N" until it's named. `where` says where it went: 'memory'
//       when this browser won't keep it (the note says so, in words for the talkback)
//   list(filter) -> { rows: [Row], next: string | null }
//       a page, newest first (order: 'old' for oldest): filter { q, song, tuning, tempo: [lo, hi], from, to, starred,
//       order, limit (50; up to 500), after: the last page's next }. Rows carry their peaks, not their audio
//   get(id) -> Row & { chain, stackId } | null    one riff, with the chain it was played through
//   audio(id) -> { sr, channels: [Float32Array] } | null    its audio, as the asset store keeps a recording
//   buffer(id) -> AudioBuffer | null    the same, ready to play (a preview through the stack; in a browser only)
//   update(id, patch) -> { ok, row } | { ok: false, error }    { name?, starred?, notes?, key?, tuning? }; a key given
//       here is confirmed (sure: true)
//   rename(id, name), star(id, on = true) -> the same as update
//   remove(id) -> the whole riff { row, detail, audio } (for an undo: restore(it)) | null when there's no such riff
//   restore(whole) -> { ok, id }    puts a removed riff back as it was (same id, same time)
//   count() -> number
//   facets() -> { total, starred, songs: [{ id, title, count }], tunings: [{ id, count }] }   for the filter menus
//       (songs by title, the untitled ones last; tunings, the most used first)
//   tagSong(songId, title) -> number of riffs retagged   a song that's just been named: its riffs take the title
//       (an untitled title takes it off)
//   usage() -> { count, bytes }   what the library's audio takes on disk (and in memory), counted from the rows
//   intoSong(id, { project, track?, start?, assets? }) -> { ok: true, ops, asset, clip, beats, bars, fits, ratio,
//       tail, chain, stackName } | { ok: false, error }
//       what a part needs: the riff's audio put in the asset store (engine/assets.js; once, as 'a_<riff id>', shared by
//       every song it goes into, and still there if the riff is deleted later) and the ops for the song (dispatch them
//       with { by }): asset.add when the song doesn't describe it yet, then clip.add on `track` at `start` (beats)
//       when a track is given (ref 'riff'). fits: false when the song's tempo isn't the riff's (core/riffs.js
//       placement). chain: the stack it was played through (core/liveroom/stacks.js loadOps puts it on the track)
//   where() -> 'disk' | 'memory'      note() -> string | null   (null while riffs are kept on disk)
//
// When IndexedDB is refused, riffs live in this page's memory for the visit, and note() says so. When a write fails
// (the disk is full), that riff stays in memory and add says so; a listing merges the two.
// DB 'overdub-riffs', version 1:
//   'riffs'    keyPath 'id': the rows. Indexes: 'new' [rat, id]; 'song' [song, rat, id]; 'star' [starred, rat, id];
//              'tuning' [tuning, rat, id] (rat = -at: ascending is newest first); 'songs' song; 'tunings' tuning;
//              'bytes' bytes (usage, from the keys alone)
//   'details'  keyPath 'id': { id, chain, stackId }
//   'audio'    keyPath 'id': { id, sr, channels: [Float32Array] }

import { cleanRiff, cleanFilter, matches, pageOf, patchRow, placement, assetIdOf, songTag, tokenOf, rowKey, cmpKey } from '../../core/liveroom/riffs.js';
import { opener, done, req } from './idb.js';

const DB = 'overdub-riffs', VERSION = 1;
const NOTE_REFUSED = 'This browser won’t keep riffs between visits, so they’re here until the tab closes.';
const NOTE_FULL = 'The disk here is full, so that riff stays until the tab closes.';

const open = opener(DB, VERSION, (db) => {
  if (!db.objectStoreNames.contains('riffs')) {
    const s = db.createObjectStore('riffs', { keyPath: 'id' });
    s.createIndex('new', ['rat', 'id']);
    s.createIndex('song', ['song', 'rat', 'id']);
    s.createIndex('star', ['starred', 'rat', 'id']);
    s.createIndex('tuning', ['tuning', 'rat', 'id']);
    s.createIndex('songs', 'song');
    s.createIndex('tunings', 'tuning');
    s.createIndex('bytes', 'bytes');
  }
  if (!db.objectStoreNames.contains('details')) db.createObjectStore('details', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
});

// the visit's riffs: all of them when IndexedDB is refused, else the ones a full disk wouldn't take
const mem = { rows: new Map(), details: new Map(), audio: new Map() };
let full = false;
const STORES = ['riffs', 'details', 'audio'];
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// (a time that only moves forward, so riffs kept in one millisecond still list in the order they were kept)
let last = 0;
const stamp = () => (last = Math.max(Date.now(), last + 1));

export async function where() { return (await open()) ? 'disk' : 'memory'; }
export function note() { return open.refused ? NOTE_REFUSED : full && mem.rows.size ? NOTE_FULL : null; }

async function readRow(id) {
  if (typeof id !== 'string' || !id) return null;
  if (mem.rows.has(id)) return mem.rows.get(id);
  const d = await open();
  if (!d) return null;
  try { return (await req(d.transaction('riffs').objectStore('riffs').get(id))) || null; } catch { return null; }
}

async function write(row, detail, audio, { fresh = false } = {}) {
  const d = await open();
  if (d) {
    try {
      const tx = d.transaction(STORES, 'readwrite');
      const ok = done(tx);
      try {
        const rs = tx.objectStore('riffs');
        if (fresh) rs.add(row); else rs.put(row);
        tx.objectStore('details').put(detail);
        tx.objectStore('audio').put(audio);
      } catch (e) {
        // (all of it or none: a row never lands without its audio)
        try { tx.abort(); } catch { /* done already */ }
        await ok.catch(() => {});
        throw e;
      }
      await ok;
      mem.rows.delete(row.id); mem.details.delete(row.id); mem.audio.delete(row.id);
      return { where: 'disk' };
    } catch (e) {
      if (e && e.name === 'ConstraintError') return { clash: true };
      console.warn('overdub riffs: could not keep', row.id, e && e.message);
      full = true;
    }
  }
  mem.rows.set(row.id, row); mem.details.set(row.id, detail); mem.audio.set(row.id, audio);
  return { where: 'memory' };
}

export async function count() {
  let n = 0;
  const d = await open();
  if (d) { try { n = await req(d.transaction('riffs').objectStore('riffs').count()); } catch { /* memory only */ } }
  return n + mem.rows.size;
}

export async function add(input) {
  let n = 0;
  try { n = await count(); } catch { /* ok */ }
  for (let tries = 0; tries < 4; tries++) {
    const c = cleanRiff(input, { count: n, now: stamp() });
    if ('error' in c) return { ok: false, error: c.error };
    if (mem.rows.has(c.row.id)) continue;
    const w = await write(c.row, c.detail, c.audio, { fresh: true });
    if (w.clash) { if (input && input.id) return { ok: false, error: `there's already a riff ${input.id}` }; continue; }
    const out = { ok: true, id: c.row.id, row: c.row, where: w.where };
    const nt = note();
    if (w.where === 'memory' && nt) out.note = nt;
    return out;
  }
  return { ok: false, error: 'could not find a free id for the riff' };
}

/* ------------------------------------------------------------------------------------------------ listing */
// the index a filter reads, and the prefix its keys share
function planOf(f) {
  if (f.song !== null) return { index: 'song', prefix: [f.song] };
  if (f.starred) return { index: 'star', prefix: [1] };
  if (f.tuning !== null) return { index: 'tuning', prefix: [f.tuning] };
  return { index: 'new', prefix: [] };
}

// one page from IndexedDB: the index's keys bounded by the dates and the page token, read in batches (getAll, newest
// first) or with a cursor (oldest first), each row checked against the rest of the filter
async function idbPage(d, f) {
  const { index, prefix } = planOf(f);
  const cmp = (a, b) => indexedDB.cmp(a, b);
  let lo = [...prefix, f.to !== null ? -f.to : -Infinity], loOpen = false;
  let hi = [...prefix, f.from !== null ? -f.from : Infinity, []], hiOpen = false;
  if (f.after) {
    const k = [...prefix, f.after[0], f.after[1]];
    if (f.order === 'new' && cmp(k, lo) >= 0) { lo = k; loOpen = true; }
    if (f.order === 'old' && cmp(k, hi) <= 0) { hi = k; hiOpen = true; }
  }
  if (cmp(lo, hi) > 0) return { rows: [], more: false };
  const ix = d.transaction('riffs').objectStore('riffs').index(index);
  const want = f.limit + 1, rows = [];
  if (f.order === 'new') {
    let batch = Math.min(512, Math.max(64, want));
    for (;;) {
      const got = await req(ix.getAll(IDBKeyRange.bound(lo, hi, loOpen, hiOpen), batch));
      for (const r of got) if (matches(r, f)) { rows.push(r); if (rows.length >= want) break; }
      if (rows.length >= want || got.length < batch) break;
      const last = got[got.length - 1];
      lo = [...prefix, last.rat, last.id]; loOpen = true;
      batch = 512;
    }
  } else {
    await new Promise((resolve, reject) => {
      const rq = ix.openCursor(IDBKeyRange.bound(lo, hi, loOpen, hiOpen), 'prev');
      rq.onsuccess = () => {
        const c = rq.result;
        if (!c) return resolve(undefined);
        if (matches(c.value, f)) rows.push(c.value);
        if (rows.length >= want) return resolve(undefined);
        c.continue();
      };
      rq.onerror = () => reject(rq.error);
    });
  }
  return { rows: rows.slice(0, f.limit), more: rows.length > f.limit };
}

export async function list(filter = {}) {
  const f = cleanFilter(filter);
  let disk = { rows: [], more: false };
  const d = await open();
  if (d) { try { disk = await idbPage(d, f); } catch (e) { console.warn('overdub riffs: could not list', e && e.message); } }
  if (!mem.rows.size) return { rows: disk.rows, next: disk.more && disk.rows.length ? tokenOf(disk.rows[disk.rows.length - 1]) : null };
  // (some riffs are in memory: the two pages merged, in order, and the next page goes on after the last one shown)
  const m = pageOf([...mem.rows.values()], f);
  const dir = f.order === 'old' ? -1 : 1;
  const both = [...disk.rows, ...m.rows].sort((a, b) => dir * cmpKey(rowKey(a), rowKey(b)));
  const rows = both.slice(0, f.limit);
  const more = both.length > f.limit || disk.more || !!m.next;
  return { rows, next: more && rows.length ? tokenOf(rows[rows.length - 1]) : null };
}

export async function get(id) {
  const row = await readRow(id);
  if (!row) return null;
  let det = mem.details.get(id) || null;
  if (!det) { const d = await open(); if (d) { try { det = (await req(d.transaction('details').objectStore('details').get(id))) || null; } catch { det = null; } } }
  return { ...row, chain: det ? det.chain : null, stackId: det ? det.stackId : null };
}

export async function audio(id) {
  if (typeof id !== 'string' || !id) return null;
  const m = mem.audio.get(id);
  if (m) return { sr: m.sr, channels: m.channels };
  const d = await open();
  if (!d) return null;
  try { const a = await req(d.transaction('audio').objectStore('audio').get(id)); return a ? { sr: a.sr, channels: a.channels } : null; } catch { return null; }
}

export async function buffer(id) {
  const a = await audio(id);
  if (!a || typeof AudioBuffer === 'undefined') return null;
  const b = new AudioBuffer({ length: a.channels[0].length, numberOfChannels: a.channels.length, sampleRate: a.sr });
  a.channels.forEach((ch, i) => b.copyToChannel(ch, i));
  return b;
}

/* ------------------------------------------------------------------------------------------------ changes */
export async function update(id, patch) {
  const row = await readRow(id);
  if (!row) return { ok: false, error: `no riff ${id}` };
  const out = patchRow(row, patch);
  if ('error' in out) return { ok: false, error: out.error };
  if (mem.rows.has(id)) { mem.rows.set(id, out); return { ok: true, row: out }; }
  const d = await open();
  try {
    const tx = d.transaction('riffs', 'readwrite');
    const ok = done(tx);
    tx.objectStore('riffs').put(out);
    await ok;
    return { ok: true, row: out };
  } catch (e) { return { ok: false, error: 'could not change the riff: ' + (e && e.message) }; }
}
export const rename = (id, name) => update(id, { name });
export const star = (id, on = true) => update(id, { starred: !!on });

export async function remove(id) {
  if (typeof id !== 'string' || !id) return null;
  if (mem.rows.has(id)) {
    const whole = { row: mem.rows.get(id), detail: mem.details.get(id) || { id, chain: null, stackId: null }, audio: mem.audio.get(id) || null };
    mem.rows.delete(id); mem.details.delete(id); mem.audio.delete(id);
    return whole;
  }
  const d = await open();
  if (!d) return null;
  try {
    const tx = d.transaction(STORES, 'readwrite');
    const ok = done(tx);
    const [row, detail, au] = await Promise.all([req(tx.objectStore('riffs').get(id)), req(tx.objectStore('details').get(id)), req(tx.objectStore('audio').get(id))]);
    if (!row) { await ok; return null; }
    for (const s of STORES) tx.objectStore(s).delete(id);
    await ok;
    return { row, detail: detail || { id, chain: null, stackId: null }, audio: au || null };
  } catch (e) { console.warn('overdub riffs: could not delete', id, e && e.message); return null; }
}

export async function restore(whole) {
  if (!isObj(whole) || !isObj(whole.row) || !isObj(whole.audio) || typeof whole.row.id !== 'string') return { ok: false, error: 'restore takes what remove gave back' };
  const id = whole.row.id;
  if (await readRow(id)) return { ok: false, error: `riff ${id} is already here` };
  const w = await write(whole.row, isObj(whole.detail) ? whole.detail : { id, chain: null, stackId: null }, whole.audio);
  return { ok: true, id, where: w.where };
}

/* ------------------------------------------------------------------------------------------------ the shelf's sides */
// distinct keys of an index, each with its count (and the first value under it, when `first`)
async function distinct(d, index, first = false) {
  const ix = d.transaction('riffs').objectStore('riffs').index(index);
  const keys = [];
  await new Promise((resolve, reject) => {
    const rq = ix.openKeyCursor(null, 'nextunique');
    rq.onsuccess = () => { const c = rq.result; if (!c) return resolve(undefined); keys.push(c.key); c.continue(); };
    rq.onerror = () => reject(rq.error);
  });
  return Promise.all(keys.map(async (k) => ({ key: k, count: await req(ix.count(IDBKeyRange.only(k))), value: first ? await req(ix.get(IDBKeyRange.only(k))) : null })));
}

export async function facets() {
  const songs = new Map(), tunings = new Map();
  let total = 0, starred = 0;
  const d = await open();
  if (d) {
    try {
      const s = d.transaction('riffs').objectStore('riffs');
      total = await req(s.count());
      starred = await req(s.index('star').count(IDBKeyRange.bound([1], [1, []])));
      for (const x of await distinct(d, 'songs', true)) if (x.key) songs.set(x.key, { id: x.key, title: x.value ? x.value.songTitle : null, count: x.count });
      for (const x of await distinct(d, 'tunings')) tunings.set(x.key, { id: x.key, count: x.count });
    } catch (e) { console.warn('overdub riffs: could not count', e && e.message); }
  }
  for (const r of mem.rows.values()) {
    total++; if (r.starred) starred++;
    if (r.song) { const e = songs.get(r.song) || { id: r.song, title: r.songTitle, count: 0 }; e.count++; if (!e.title) e.title = r.songTitle; songs.set(r.song, e); }
    const t = tunings.get(r.tuning) || { id: r.tuning, count: 0 }; t.count++; tunings.set(r.tuning, t);
  }
  const byTitle = (a, b) => (a.title ? 0 : 1) - (b.title ? 0 : 1) || String(a.title || '').localeCompare(String(b.title || '')) || b.count - a.count;
  return { total, starred, songs: [...songs.values()].sort(byTitle), tunings: [...tunings.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)) };
}

export async function tagSong(songId, title) {
  if (typeof songId !== 'string' || !songId) return 0;
  const { songTitle } = songTag({ id: songId, title });
  let n = 0;
  for (const [id, r] of mem.rows) if (r.song === songId && r.songTitle !== songTitle) { mem.rows.set(id, { ...r, songTitle }); n++; }
  const d = await open();
  if (!d) return n;
  try {
    const tx = d.transaction('riffs', 'readwrite');
    const ok = done(tx);
    await new Promise((resolve, reject) => {
      const rq = tx.objectStore('riffs').index('songs').openCursor(IDBKeyRange.only(songId));
      rq.onsuccess = () => {
        const c = rq.result;
        if (!c) return resolve(undefined);
        if (c.value.songTitle !== songTitle) { c.update({ ...c.value, songTitle }); n++; }
        c.continue();
      };
      rq.onerror = () => reject(rq.error);
    });
    await ok;
  } catch (e) { console.warn('overdub riffs: could not retag', e && e.message); }
  return n;
}

export async function usage() {
  let n = 0, bytes = 0;
  const d = await open();
  if (d) {
    try {
      await new Promise((resolve, reject) => {
        const rq = d.transaction('riffs').objectStore('riffs').index('bytes').openKeyCursor();
        rq.onsuccess = () => { const c = rq.result; if (!c) return resolve(undefined); n++; bytes += Number(c.key) || 0; c.continue(); };
        rq.onerror = () => reject(rq.error);
      });
    } catch { /* memory only */ }
  }
  for (const r of mem.rows.values()) { n++; bytes += r.bytes || 0; }
  return { count: n, bytes };
}

/* ------------------------------------------------------------------------------------------------ into a song */
let pageAssets = null;
export async function intoSong(id, { project = null, track = null, start = 0, assets = null } = {}) {
  if (!isObj(project) || !Array.isArray(project.tracks)) return { ok: false, error: 'intoSong needs the song: { project: store.get() }' };
  const r = await get(id);
  if (!r) return { ok: false, error: `no riff ${id}` };
  const au = await audio(id);
  if (!au) return { ok: false, error: `riff ${id}'s audio isn't in this browser` };
  let store = assets;
  if (!store) { pageAssets = pageAssets || (await import('../../engine/assets.js')).assets; store = pageAssets; }
  const pl = placement(r, { tempo: project.tempo, start });
  try { await store.put(pl.asset.id, { sr: au.sr, channels: au.channels }); } catch (e) { return { ok: false, error: 'could not put the riff’s audio in the song: ' + (e && e.message) }; }
  const ops = [];
  if (!(project.assets && project.assets[pl.asset.id])) ops.push({ type: 'asset.add', asset: { ...pl.asset } });
  if (track) ops.push({ type: 'clip.add', track, ref: 'riff', clip: { ...pl.clip } });
  return { ok: true, ops, asset: pl.asset, clip: pl.clip, beats: pl.beats, bars: pl.bars, fits: pl.fits, ratio: pl.ratio, tail: pl.tail, chain: r.chain, stackName: r.stack ? r.stack.name : null };
}

export { assetIdOf };
