// @ts-check
// Stacks [core] (docs/research/GUITAR-ROOM.md §2.2, §2.9, §4.3): a guitar's whole chain as one thing, and swapping a
// track's chain to one in a single undo step. A stack is the pedals before the amp, the amp (its cab, mics and
// knobs are its own params), and the pedals after it, each with its params and whether it's on, in signal order:
//   stack = { name?, chain: [{ device, params, on }] }   (a bare chain array is taken as { chain })
// Where stacks come from: the live room's rigs (core/liveroom/places.js guitarChain), Claw'd-o-Matic's presets
// (devices/guitar/rigs.js RIGS[].chain), a track's own chain (stackOf), and later the stack rack (saved stacks).
// Pure: no DOM, no engine, no dispatch except swapStack's one store.dispatch.
//
//   stackOf(track) -> { chain }                    a copy of a track's chain as a stack (ids, keys and bylines dropped)
//   sameChain(a, b) -> boolean                     the same devices in the same order, each on or off alike, every
//                                                  param equal (a param left out is its device's default)
//   planStack(p, { track, stack }) -> { ops, track, kept, set, added, removed }
//       the ops that make the track's chain exactly the stack, as few as it takes: the inserts whose devices line up
//       with the stack's (the longest run in common, in order) stay and are set in place (insert.set with the params
//       that differ, a param the stack leaves out back to its default, and on); the rest go (insert.remove) and the
//       stack's others are added where they belong (insert.add). An insert that stays keeps its id, so the engine's
//       strip keeps its built instance and only glides its params (no rebuild, no gap); a device that changes is
//       built beside the playing chain and swapped in under the strip's dip (engine/strip.js), so the old chain
//       plays until the new one is ready, and never both at once. Each op has its exact inverse (core/ops.js), so
//       the step undoes exactly. ops is [] when the track already has that stack. Throws on an unknown track.
//       kept / set / added / removed: counts (set: kept inserts whose params or on changed)
//   planStacks(p, [{ track, stack }]) -> { ops, tracks: [planStack's result] }   several tracks in one step (the
//       live room's two sides, the Jam room's two guitars)
//   swapStack(store, { track | tracks: [{ track, stack }], stack, by = 'you', label, reason = 'stack', ops: extra = [] })
//       -> { ok, txn, ops, error? }   plans and dispatches it as one undo step by `by` (extra: ops joined to the same
//       step, e.g. the live room's room.set { rig }). Nothing to change: { ok: true, txn: null, ops: [] }.
// The caller decides when a swap is allowed (the live room hides its switcher during a take; the Jam room refuses a
// track that's recording). After a swap, engine.settled() resolves when the strip plays the new chain.

import { getDevice } from '../devices/registry.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** @typedef {{ device: string, params?: Record<string, any>, on?: boolean }} Link */
/** @typedef {{ name?: string, chain: Link[] }} Stack */

/** @param {any} s @returns {Link[]} */
function chainOf(s) {
  const list = Array.isArray(s) ? s : isObj(s) && Array.isArray(s.chain) ? s.chain : null;
  if (!list) throw new Error('a stack is { chain: [{ device, params, on }] }');
  return list.map((x, i) => {
    if (!isObj(x) || typeof x.device !== 'string' || !x.device) throw new Error(`the stack's link ${i + 1} has no device`);
    return { device: x.device, params: isObj(x.params) ? { ...x.params } : {}, on: x.on !== false };
  });
}

/** @param {any} track @returns {Stack} */
export function stackOf(track) {
  return { chain: (track?.inserts || []).map((x) => ({ device: String(x.device), params: clone(x.params || {}), on: x.on !== false })) };
}

// a stored param's value as a number where it can be (a switch stored by its label, 'ON', is its index), for equality
function paramValue(def, key, v) {
  const p = def?.params?.find((q) => q.key === key);
  if (v == null) v = p ? p.def ?? (p.opts ? 0 : p.min ?? 0) : null;
  if (typeof v === 'string' && p?.opts) { const i = p.opts.findIndex((o) => String(o).toLowerCase() === v.toLowerCase()); if (i >= 0) return i; }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
const sameValue = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 : a === b);
function sameParams(device, a = {}, b = {}) {
  const def = getDevice(device);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!sameValue(paramValue(def, k, a[k]), paramValue(def, k, b[k]))) return false;
  return true;
}

export function sameChain(a, b) {
  const x = chainOf(a), y = chainOf(b);
  return x.length === y.length && x.every((l, i) => l.device === y[i].device && l.on === y[i].on && sameParams(l.device, l.params, y[i].params));
}

// the longest run of devices the two chains share, in order: [[i (in have), j (in want)], ...]
function common(have, want) {
  const n = have.length, m = want.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = have[i] === want[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (have[i] === want[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out;
}

export function planStack(p, { track, stack }) {
  const want = chainOf(stack);
  const t = track === 'master' ? { id: 'master', inserts: p.master?.inserts || [] } : (p.tracks || []).find((x) => x.id === track || x.name === track);
  if (!t) throw new Error(`no track "${track}"`);
  const have = t.inserts || [];
  const pairs = common(have.map((x) => String(x.device)), want.map((x) => x.device));
  const keptAt = new Map(pairs.map(([i, j]) => [i, j])), placed = new Set(pairs.map(([, j]) => j));
  /** @type {any[]} */
  const ops = [];
  let set = 0;
  // what goes, from the end (each remove's inverse puts it back at its index)
  for (let i = have.length - 1; i >= 0; i--) if (!keptAt.has(i)) ops.push({ type: 'insert.remove', track: t.id, insert: have[i].id });
  // what's added, in the order it sits: everything before it is already in place by then
  want.forEach((l, j) => { if (!placed.has(j)) ops.push({ type: 'insert.add', track: t.id, index: j, insert: { device: l.device, params: clone(l.params), on: l.on } }); });
  // what stays, set in place: the params that differ (one the stack leaves out back to its default: null), and on
  for (const [i, j] of pairs) {
    const x = have[i], l = want[j], def = getDevice(l.device), cur = x.params || {}, patch = {};
    for (const k of Object.keys(cur)) if (!(k in l.params)) patch[k] = null;
    for (const [k, v] of Object.entries(l.params)) if (!(k in cur) || !sameValue(paramValue(def, k, cur[k]), paramValue(def, k, v)) || typeof cur[k] !== typeof v) patch[k] = v;
    const on = (x.on !== false) !== l.on;
    if (Object.keys(patch).length || on) {
      ops.push({ type: 'insert.set', track: t.id, insert: x.id, patch: { ...(Object.keys(patch).length ? { params: patch } : {}), ...(on ? { on: l.on } : {}) } });
      set++;
    }
  }
  return { ops, track: t.id, kept: pairs.length, set, added: want.length - pairs.length, removed: have.length - pairs.length };
}

export function planStacks(p, list) {
  const tracks = (list || []).map((x) => planStack(p, x));
  return { ops: tracks.flatMap((x) => x.ops), tracks };
}

export function swapStack(store, { track = null, tracks = null, stack = null, by = 'you', label = '', reason = 'stack', ops: extra = [] } = {}) {
  let plan;
  try { plan = planStacks(store.get(), tracks || [{ track, stack }]); } catch (e) { return { ok: false, error: String(e?.message || e), ops: [] }; }
  const ops = [...plan.ops, ...(extra || [])];
  if (!ops.length) return { ok: true, txn: null, ops: [] };
  const name = label || (isObj(stack) && stack.name) || 'Swap the chain';
  const r = store.dispatch(ops, { by, label: name, reason });
  return r.ok ? { ok: true, txn: r.txn, ops } : { ok: false, error: r.error, ops };
}
