// @ts-check
// The stack rack [ui; guitar room] (docs/research/GUITAR-ROOM.md §2.2, §2.9, §4.3): your saved stacks, used by any
// song, in IndexedDB 'overdub-rack' (the name is forever). A stack is core/liveroom/stacks.js's: a name and the guitar
// chain (pedals, the amp with its cab and mics, a cab, pedals after), in order, with every param.
//
// The song keeps its own copy (the track's inserts): tweaks on the stage change that copy, never the rack. Save to rack
// is the only thing that writes here, and loading a stack only returns ops for the song.
//
//   import * as rack from './rack-db.js';      every call is a Promise, and none throws
//
//   save(stack, { id?, name?, song? }) -> { ok: true, id, stack, where: 'disk' | 'memory', note? } | { ok: false, error }
//       stack: { name?, chain } or a bare chain (stackOf(track) gives it from the song's copy). A new stack, named
//       `name` (else the stack's own name), unless `id` names one of yours: then that stack takes this chain and keeps
//       its name (unless `name` is given) — the only way a saved stack's sound changes. song: the project (or
//       { id, title }) it was saved from, kept as its tag
//   list() -> [Stack]   every saved stack, the last changed first: { id, name, chain, amp, at, modified, song,
//       songTitle, v }
//   get(id) -> Stack | null     (a house stack's id, 'house.<place>.<rig>', gives that one: houseStacks)
//   load(id, track, { getDevice }?) -> { ok: true, ops, label, by: 'you', stack, replaced } | { ok: false, error }
//       the ops that put the stack on the track in place of its current chain (stacks.js loadOps): dispatch them with
//       { by: 'you', label }. One undo step. The rack is read, never written, and the song gets copies
//   rename(id, name) -> { ok, stack } | { ok: false, error }
//   remove(id) -> the stack as it was (for an undo: restore(it)) | null
//   restore(stack) -> { ok, id }    puts a removed stack back as it was
//   house(placeId) -> [Stack]   the place's own stacks, first on the rack's wall (never stored; can't be renamed or
//       deleted; Save to rack makes one of yours from it)
//   where() -> 'disk' | 'memory'      note() -> string | null
// When IndexedDB is refused, the rack is this page's memory for the visit, and note() says so.
// DB 'overdub-rack', version 1, store 'stacks' (keyPath 'id'; index 'modified').

import { cleanStack, loadOps, houseStacks } from '../../core/liveroom/stacks.js';
import { songTag, nameOf } from '../../core/liveroom/riffs.js';
import { newId } from '../../core/project.js';
import { opener, done, req } from './idb.js';

const DB = 'overdub-rack', VERSION = 1, STORE = 'stacks';
const NOTE_REFUSED = 'This browser won’t keep the rack between visits, so saved stacks are here until the tab closes.';
const NOTE_FULL = 'The disk here is full, so that stack stays until the tab closes.';
const STACK_V = 1;

const open = opener(DB, VERSION, (db) => {
  if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('modified', 'modified');
});
const mem = new Map();
let full = false;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// (a time that only moves forward, so two saves in one millisecond still list in the order they were made)
let last = 0;
const stamp = (floor = 0) => (last = Math.max(Date.now(), last + 1, floor + 1));
const copy = (s) => (s ? { ...s, chain: s.chain.map((l) => ({ device: l.device, params: { ...l.params }, on: l.on })) } : null);

export async function where() { return (await open()) ? 'disk' : 'memory'; }
export function note() { return open.refused ? NOTE_REFUSED : full && mem.size ? NOTE_FULL : null; }
export const house = (placeId) => houseStacks(placeId);

async function read(id) {
  if (typeof id !== 'string' || !id) return null;
  if (mem.has(id)) return mem.get(id);
  const d = await open();
  if (!d) return null;
  try { return (await req(d.transaction(STORE).objectStore(STORE).get(id))) || null; } catch { return null; }
}

async function write(rec) {
  const d = await open();
  if (d) {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      const ok = done(tx);
      try { tx.objectStore(STORE).put(rec); } catch (e) { try { tx.abort(); } catch { /* done */ } await ok.catch(() => {}); throw e; }
      await ok;
      mem.delete(rec.id);
      return 'disk';
    } catch (e) { console.warn('overdub rack: could not keep', rec.id, e && e.message); full = true; }
  }
  mem.set(rec.id, rec);
  return 'memory';
}

export async function save(stack, { id = null, name = null, song = null } = {}) {
  const s = cleanStack(stack);
  if (!s) return { ok: false, error: 'a stack is { name, chain: [{ device, params, on }] } (at most 32 pieces)' };
  const named = nameOf(name);
  let rec;
  if (id) {
    if (String(id).startsWith('house.')) return { ok: false, error: 'the house’s stacks stay as they are: save it as a new stack of yours' };
    const old = await read(id);
    if (!old) return { ok: false, error: `no stack ${id} on the rack` };
    rec = { ...old, name: named || old.name, chain: s.chain, amp: s.amp, modified: stamp(old.modified || 0) };
  } else {
    let sid = newId('st');
    while (await read(sid)) sid = newId('st');
    const tag = isObj(song) ? songTag(song) : { song: '', songTitle: null };
    const now = stamp();
    rec = { v: STACK_V, id: sid, name: named || s.name, chain: s.chain, amp: s.amp, at: now, modified: now, song: tag.song, songTitle: tag.songTitle };
  }
  const w = await write(rec);
  const out = { ok: true, id: rec.id, stack: copy(rec), where: w };
  if (w === 'memory' && note()) out.note = note();
  return out;
}

export async function list() {
  const out = new Map();
  const d = await open();
  if (d) { try { for (const r of (await req(d.transaction(STORE).objectStore(STORE).getAll())) || []) if (r && r.id) out.set(r.id, r); } catch { /* memory only */ } }
  for (const [id, r] of mem) out.set(id, r);
  return [...out.values()].sort((a, b) => (b.modified || 0) - (a.modified || 0) || String(a.id).localeCompare(String(b.id))).map(copy);
}

export async function get(id) {
  if (typeof id === 'string' && id.startsWith('house.')) {
    const place = id.split('.')[1];
    return copy(houseStacks(place).find((s) => s.id === id) || null);
  }
  return copy(await read(id));
}

export async function load(id, track, { getDevice = null } = {}) {
  const s = await get(id);
  if (!s) return { ok: false, error: `no stack ${id}` };
  try { return { ok: true, ...loadOps(track, s, { getDevice }), label: `Stack: ${s.name}`, stack: s }; } catch (e) { return { ok: false, error: e.message }; }
}

export async function rename(id, name) {
  if (typeof id === 'string' && id.startsWith('house.')) return { ok: false, error: 'the house’s stacks keep their names: save it to the rack to name your own' };
  const old = await read(id);
  if (!old) return { ok: false, error: `no stack ${id} on the rack` };
  const nm = nameOf(name);
  if (!nm) return { ok: false, error: 'a stack needs a name' };
  const rec = { ...old, name: nm, modified: stamp(old.modified || 0) };
  await write(rec);
  return { ok: true, stack: copy(rec) };
}

export async function remove(id) {
  if (typeof id !== 'string' || !id || id.startsWith('house.')) return null;
  // (a stack of yours whose change the disk wouldn't take is in memory and still on disk as it was: both go, or the
  // old one would come back on the rack)
  const m = mem.get(id) || null;
  mem.delete(id);
  const d = await open();
  if (!d) return copy(m);
  try {
    const tx = d.transaction(STORE, 'readwrite');
    const ok = done(tx);
    const r = await req(tx.objectStore(STORE).get(id));
    if (r) tx.objectStore(STORE).delete(id);
    await ok;
    return copy(m || r || null);
  } catch { return copy(m); }
}

export async function restore(stack) {
  if (!isObj(stack) || typeof stack.id !== 'string' || !/^st_[a-z0-9]{3,24}$/.test(stack.id)) return { ok: false, error: 'restore takes what remove gave back' };
  const s = cleanStack(stack);
  if (!s) return { ok: false, error: 'that isn’t a stack' };
  if (await read(stack.id)) return { ok: false, error: `stack ${stack.id} is already on the rack` };
  const rec = { ...stack, name: s.name, chain: s.chain, amp: s.amp };
  const w = await write(rec);
  return { ok: true, id: rec.id, where: w };
}
