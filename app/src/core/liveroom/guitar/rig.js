// @ts-check
// The guitar room's rig [core; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §2.2, §2.9; AJ's
// notes on the second mock: ONE stack, both sides tracked on the same rig). Pure: no DOM, no store; every function
// reads the song and returns ops for one store.dispatch by you, each op with its exact inverse (core/ops.js).
//
// The room has one stack. On a track it's the gear run (core/liveroom/stacks.js gearSpan: from the first pedal or amp
// to the last), and the room keeps it the same on every guitar track it has (room.tracks guitarL and guitarR; 'guitar'
// at the held blues bar): every edit is planned on all of them in one step, so the other side always plays through the
// rig you hear. Guitar L is the one the room reads. Inserts outside the run (the room's Slide Rule EQ after it) are
// left where they are. The tuner pedal on the board (Tuna Fork) is the room's own, not an insert: it isn't here.
//
//   rigTracks(p) -> [trackId]                          the room's guitar tracks that exist, Guitar L first
//   rigOf(p) -> Rig | null                             what the room shows: null when the room has no guitar track
//     Rig = { track, tracks, chain: [Link], slots: [Slot], amp: Slot | null, board: [Slot], loop: [Slot], same }
//       track    Guitar L's id (the track the room reads)          tracks: every rig track, L first
//       chain    the run as a stack's chain (core/liveroom/stacks.js Link: { device, params, on })
//       slots    the run, in signal order: Slot = { slot (0-based in the run), insert (L's insert id), ids: { [track]:
//                insert id } (the same slot on each rig track whose run lines up, device for device), device, params,
//                on, kind: 'pedal' | 'amp' | 'cab' | 'other' }
//       amp      the first amp in the run (core.stack, amp.*, a device of cat 'amp')
//       board    the pedals (every slot but the amp and a cab), in signal order: the numbers 1-8 stomp, in this order
//       loop     the board's pedals after the amp (the amp's effects loop: delays and reverbs)
//       same     every rig track's run is L's, device for device and value for value
//   planChain(p, chain, { label }) -> { ops, label, reason: 'room:rig' }
//       makes the run on every rig track exactly `chain` (a stack's chain), in as few ops as it takes
//       (core/stacks.js planStacks: what lines up stays and is set in place, so the engine glides it). [] when it
//       already is. With no gear on a track, the chain goes in at the top. This is the one way the rig changes; the
//       edits below each make the chain and call it.
//   planTurn(p, { slot, params })     a knob (or several) on one piece of gear: params { key: value }
//   planStomp(p, { slot, on })        on or off (on: undefined flips it)
//   planMove(p, { from, to })         a piece of gear moved to another place in the run (drag to reorder)
//   planAdd(p, { link, at })          a piece of gear added at slot `at` (default: where its kind goes, rankAt)
//   planRemove(p, { slot })           a piece of gear taken off
//   planSwap(p, { stack | chain, label })   the whole run swapped for a stack (the shop's carry, the rack's load)
//   planSync(p)                       the other sides made L's again (after the control room changed one)
//     each -> { ops, label, reason: 'room:rig' } (ops [] when nothing changes), dispatched by the caller:
//     store.dispatch(ops, { by: 'you', label, reason, coalesce }) (a knob drag coalesces: coalesceKey(slot, key))
//   rankAt(rig, deviceId) -> slot index   where a pedal goes when it's carried in (Claw'd-o-Matic's order: dynamics,
//       filter, pitch, drive, fuzz before the amp; modulation, delay, ambient after it, in the loop)
//   coalesceKey(slot, key) -> 'rig:<slot>:<key>'
//   PEDAL_RANK                                         that order, by the pedal's pedalCat

import { getDevice } from '../../../devices/registry.js';
import { gearSpan, isGear, cleanChain } from '../stacks.js';
import { planStacks } from '../../stacks.js';
import { roomOf } from '../model.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const GUITAR_ROLES = ['guitarL', 'guitarR', 'guitar'];
const REASON = 'room:rig';
const none = (label = '') => ({ ops: [], label, reason: REASON });

// Claw'd-o-Matic's pedal order (pedals.js PEDAL_RANK): lower goes earlier; mod and up go after the amp
export const PEDAL_RANK = Object.freeze({ dynamics: 0, utility: 0.5, filter: 1, pitch: 2, synth: 2.5, drive: 3, fuzz: 4, glitch: 4.5, mod: 5, time: 6, ambient: 7 });
const LOOP_RANK = 5;

const defOf = (id) => { try { return getDevice(id); } catch { return null; } };
function kindOf(device) {
  if (device === 'core.cab' || /^cab\./.test(device)) return 'cab';
  if (device === 'core.stack' || /^amp\./.test(device)) return 'amp';
  const d = defOf(device);
  if (d && d.cat === 'amp') return 'amp';
  if (/^pedal\./.test(device) || isGear(device, getDevice)) return 'pedal';
  return 'other';
}

export function rigTracks(p) {
  const room = roomOf(p);
  const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  const ids = isObj(room?.tracks) ? room.tracks : {};
  const out = [];
  for (const role of GUITAR_ROLES) {
    const id = ids[role];
    if (typeof id === 'string' && tracks.some((t) => t.id === id && t.kind === 'audio') && !out.includes(id)) out.push(id);
  }
  return out;
}

const trackOf = (p, id) => (p?.tracks || []).find((t) => t.id === id) || null;
function runOf(t) {
  const span = gearSpan(t, getDevice);
  return span ? (t.inserts || []).slice(span.from, span.to + 1) : [];
}
const linkOf = (fx) => ({ device: String(fx.device), params: clone(fx.params || {}), on: fx.on !== false });

export function rigOf(p) {
  const tracks = rigTracks(p);
  if (!tracks.length) return null;
  const L = trackOf(p, tracks[0]);
  const run = runOf(L);
  const others = tracks.slice(1).map((id) => ({ id, run: runOf(trackOf(p, id)) }));
  const chain = cleanChain(run.map(linkOf)) || [];
  const slots = run.map((fx, i) => {
    const ids = { [L.id]: fx.id };
    for (const o of others) if (o.run.length === run.length && o.run[i]?.device === fx.device) ids[o.id] = o.run[i].id;
    return { slot: i, insert: fx.id, ids, device: String(fx.device), params: clone(fx.params || {}), on: fx.on !== false, kind: kindOf(String(fx.device)) };
  });
  const amp = slots.find((s) => s.kind === 'amp') || null;
  const board = slots.filter((s) => s.kind === 'pedal' || s.kind === 'other');
  const loop = amp ? board.filter((s) => s.slot > amp.slot) : [];
  const key = JSON.stringify(chain);
  const same = others.every((o) => JSON.stringify(cleanChain(o.run.map(linkOf)) || []) === key);
  return { track: L.id, tracks, chain, slots, amp, board, loop, same };
}

// the whole chain of a track with its run swapped for `chain` (inserts outside the run as they are)
function fullChain(t, chain) {
  const ins = t.inserts || [];
  const span = gearSpan(t, getDevice);
  const before = span ? ins.slice(0, span.from) : [];
  const after = span ? ins.slice(span.to + 1) : ins;
  // (no gear yet: the chain goes in at the top, ahead of the room's EQ)
  return [...before.map(linkOf), ...chain.map((l) => ({ device: l.device, params: clone(l.params || {}), on: l.on !== false })), ...after.map(linkOf)];
}

export function planChain(p, chain, { label = '' } = {}) {
  const want = cleanChain(chain);
  if (!want) return { ...none(label), error: 'a chain is [{ device, params, on }]' };
  const tracks = rigTracks(p);
  if (!tracks.length) return { ...none(label), error: 'There’s no guitar in this room.' };
  const plan = planStacks(p, tracks.map((id) => ({ track: id, stack: { chain: fullChain(trackOf(p, id), want) } })));
  return { ops: plan.ops, label: label || 'The rig', reason: REASON };
}

const nameOf = (device) => defOf(device)?.name || device;
const paramLabel = (device, key) => defOf(device)?.params?.find((q) => q.key === key)?.label || key;
function edit(p, fn, label) {
  const rig = rigOf(p);
  if (!rig) return { ...none(label), error: 'There’s no guitar in this room.' };
  const chain = clone(rig.chain);
  const err = fn(chain, rig);
  if (typeof err === 'string') return { ...none(label), error: err };
  return planChain(p, chain, { label });
}
const inRange = (chain, slot) => Number.isInteger(slot) && slot >= 0 && slot < chain.length;

export function planTurn(p, { slot, params } = /** @type {any} */ ({})) {
  const rig = rigOf(p);
  const s = rig?.slots[slot];
  const keys = isObj(params) ? Object.keys(params) : [];
  const label = s ? `${nameOf(s.device)}${keys.length === 1 ? ' ' + String(paramLabel(s.device, keys[0])).toLowerCase() : ''}` : 'A knob';
  return edit(p, (chain) => {
    if (!inRange(chain, slot)) return `There’s no piece of gear ${slot + 1} on the rig.`;
    if (!keys.length) return 'Turn which knob?';
    Object.assign(chain[slot].params, params);
  }, label);
}

export function planStomp(p, { slot, on } = /** @type {any} */ ({})) {
  const rig = rigOf(p);
  const s = rig?.slots[slot];
  const next = on === undefined ? !(s?.on) : !!on;
  return edit(p, (chain) => {
    if (!inRange(chain, slot)) return `There’s no pedal ${slot + 1} on the board.`;
    chain[slot].on = next;
  }, s ? `${nameOf(s.device)} ${next ? 'on' : 'off'}` : 'Stomp');
}

export function planMove(p, { from, to } = /** @type {any} */ ({})) {
  const rig = rigOf(p);
  const s = rig?.slots[from];
  return edit(p, (chain) => {
    if (!inRange(chain, from)) return `There’s nothing at ${from + 1} on the rig.`;
    const t = Math.max(0, Math.min(chain.length - 1, Number.isInteger(to) ? to : from));
    if (t === from) return;
    const [l] = chain.splice(from, 1);
    chain.splice(t, 0, l);
  }, s ? `Moved ${nameOf(s.device)}` : 'Moved a pedal');
}

export function rankAt(rig, device) {
  const chain = rig?.slots || [];
  const def = defOf(device);
  const kind = kindOf(device);
  if (kind === 'amp' || kind === 'cab') return rig?.amp ? rig.amp.slot : 0;
  const r = PEDAL_RANK[def?.pedalCat] ?? 3;
  const amp = rig?.amp ? rig.amp.slot : chain.length;
  // before the amp unless it belongs in the loop; after the last pedal ranked at or under it
  if (r >= LOOP_RANK && rig?.amp) {
    let at = amp + 1;
    for (const s of chain) if (s.slot > amp && (PEDAL_RANK[defOf(s.device)?.pedalCat] ?? 3) <= r) at = s.slot + 1;
    return at;
  }
  let at = 0;
  for (const s of chain) if (s.slot < amp && (PEDAL_RANK[defOf(s.device)?.pedalCat] ?? 3) <= r) at = s.slot + 1;
  return Math.min(at, amp);
}

export function planAdd(p, { link, at } = /** @type {any} */ ({})) {
  const l = cleanChain([link])?.[0];
  if (!l) return { ...none(), error: 'Add what? A link is { device, params, on }.' };
  const rig = rigOf(p);
  const where = Number.isInteger(at) ? at : rankAt(rig, l.device);
  return edit(p, (chain) => { chain.splice(Math.max(0, Math.min(chain.length, where)), 0, l); }, `${nameOf(l.device)} on the board`);
}

export function planRemove(p, { slot } = /** @type {any} */ ({})) {
  const rig = rigOf(p);
  const s = rig?.slots[slot];
  return edit(p, (chain) => {
    if (!inRange(chain, slot)) return `There’s nothing at ${slot + 1} on the rig.`;
    chain.splice(slot, 1);
  }, s ? `${nameOf(s.device)} off the board` : 'Took a pedal off');
}

export function planSwap(p, { stack = null, chain = null, label = '' } = {}) {
  const c = chain || (isObj(stack) ? stack.chain : Array.isArray(stack) ? stack : null);
  return planChain(p, c, { label: label || (isObj(stack) && typeof stack.name === 'string' && stack.name) || 'The rig' });
}

export function planSync(p) {
  const rig = rigOf(p);
  if (!rig) return none();
  if (rig.same) return none('The other side on your rig');
  return planChain(p, rig.chain, { label: 'The other side on your rig' });
}

export const coalesceKey = (slot, key) => `rig:${slot}:${key}`;
