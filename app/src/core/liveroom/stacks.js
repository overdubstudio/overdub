// @ts-check
// Stacks [core; guitar room] (docs/research/GUITAR-ROOM.md §2.2, §2.9, §4.3): a guitar chain as data, read off a track
// and put back on one. Pure: no DOM, no storage (the rack that keeps stacks across songs is ui/liveroom/rack-db.js).
//
// A stack is the guitar's gear in signal order: pedals, the amp (its cab and mics are the amp's own params: core.stack's
// CAB; a Guitar Studio amp's cab, mic, micpos, micdist, micang, mic2...), a separate cab (core.cab) and pedals after it.
//   Stack = { name, chain: [Link], amp: deviceId | null }      Link = { device, params: { [key]: number | string }, on }
// On a track, the stack is the run of inserts from the first piece of gear to the last (gear: GEAR below, or any device
// whose cat is 'amp'), and whatever sits between them (a core.drive between two pedals is on the floor too). Inserts
// before or after the run (the room's Slide Rule EQ, a compressor) aren't the stack's and stay where they are.
//
// The song keeps its own copy: the track's inserts are the copy, and every edit on the stage is an insert.set on them
// (the store's ops, each with its inverse). Loading a stack is ops on the song only; the rack is never written by it.
//
//   isGear(deviceId, getDevice?) -> bool          pedal.*, amp.*, cab.*, core.stack, core.cab, or a device of cat 'amp'
//   gearSpan(track, getDevice?) -> { from, to } | null   the stack's run in the track's inserts (indices, inclusive)
//   stackOf(track, { getDevice, name }?) -> Stack | null   the track's stack, copied (what Save to rack keeps)
//   cleanChain(chain) -> [Link] | null            a chain as it's kept: plain data, ids and keys checked, at most 32 links
//   cleanStack(x) -> Stack | null                 { name, chain } (or a bare chain), checked; amp filled in
//   ampOf(chain) -> deviceId | null               the first link that is an amp (amp.*, core.stack)
//   chainKey(chain) -> string                     a short hash of a chain (device, on, params; order matters): two
//                                                 chains with the same key sound the same
//   sameChain(a, b) -> bool
//   matchStack(chain, stacks) -> stack | null     the first stack in a list whose chain is this one (the rack's "Modern
//                                                 wall", or null: edited since, or never saved)
//   loadOps(track, stack, { getDevice }?) -> { ops, label, by: 'you', replaced: [insertIds] }
//       the ops that put a stack on a track (dispatch them with { by, label }): insert.remove for each insert in the
//       track's current run, then insert.add for each link at the run's place (the top of the chain when the track
//       has no gear). One transaction, one undo step; each op has its exact inverse in core/ops.js. The stack is
//       copied, so the song's copy and the rack's never share an object.
//   houseStacks(placeId) -> [Stack & { id, house: true }]   the place's own stacks (core/liveroom/places.js RIGS:
//       Half Stack at the place's settings), strong defaults that are never stored and can't be renamed or deleted

import { PLACES, RIGS, rigChain, rigLabel, placeOf } from './places.js';

export const CHAIN_MAX = 32;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const GEAR_CORE = new Set(['core.stack', 'core.cab']);
const AMP_CORE = new Set(['core.stack']);

export function isGear(device, getDevice = null) {
  if (typeof device !== 'string') return false;
  if (/^(pedal|amp|cab)\./.test(device) || GEAR_CORE.has(device)) return true;
  if (typeof getDevice === 'function') {
    try { const d = getDevice(device); if (d && d.cat === 'amp' && d.kind === 'effect') return true; } catch { /* not known */ }
  }
  return false;
}

export function gearSpan(track, getDevice = null) {
  const ins = isObj(track) && Array.isArray(track.inserts) ? track.inserts : [];
  let from = -1, to = -1;
  ins.forEach((fx, i) => { if (fx && isGear(fx.device, getDevice)) { if (from < 0) from = i; to = i; } });
  return from < 0 ? null : { from, to };
}

function cleanParams(params) {
  const out = {};
  if (!isObj(params)) return out;
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (!KEY_RE.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.length <= 64) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
  }
  return out;
}

export function cleanChain(chain) {
  if (!Array.isArray(chain)) return null;
  const out = [];
  for (const l of chain) {
    if (!isObj(l) || typeof l.device !== 'string' || !ID_RE.test(l.device)) return null;
    out.push({ device: l.device, params: cleanParams(l.params), on: l.on !== false });
    if (out.length > CHAIN_MAX) return null;
  }
  return out;
}

export function ampOf(chain) {
  for (const l of Array.isArray(chain) ? chain : []) if (l && (/^amp\./.test(l.device) || AMP_CORE.has(l.device))) return l.device;
  return null;
}

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '');

export function cleanStack(x) {
  const chain = cleanChain(Array.isArray(x) ? x : isObj(x) ? x.chain : null);
  if (!chain) return null;
  return { name: cleanText(isObj(x) ? x.name : '', 100) || defaultName(chain), chain, amp: ampOf(chain) };
}

// a stack with no name is called after its amp ("Half Stack"), or "Pedals" when it has none
function defaultName(chain) {
  const amp = ampOf(chain);
  if (amp === 'core.stack') return 'Half Stack';
  if (amp) return amp.slice(4).replace(/[-_.]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return chain.length ? 'Pedals' : 'Straight in';
}

export function stackOf(track, { getDevice = null, name = '' } = {}) {
  const span = gearSpan(track, getDevice);
  if (!span) return null;
  const chain = cleanChain(track.inserts.slice(span.from, span.to + 1).map((fx) => ({ device: fx.device, params: fx.params, on: fx.on })));
  return chain ? { name: cleanText(name, 100) || defaultName(chain), chain, amp: ampOf(chain) } : null;
}

// FNV-1a over a canonical text of the chain (params sorted by key, numbers to 6 places)
export function chainKey(chain) {
  const c = cleanChain(chain) || [];
  const num = (v) => (typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : JSON.stringify(v));
  const text = c.map((l) => `${l.device}|${l.on ? 1 : 0}|${Object.keys(l.params).sort().map((k) => k + '=' + num(l.params[k])).join(',')}`).join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return c.length + ':' + h.toString(36);
}
export const sameChain = (a, b) => chainKey(a) === chainKey(b);
export function matchStack(chain, stacks) {
  const k = chainKey(chain);
  for (const s of Array.isArray(stacks) ? stacks : []) if (s && Array.isArray(s.chain) && chainKey(s.chain) === k) return s;
  return null;
}

export function loadOps(track, stack, { getDevice = null } = {}) {
  if (!isObj(track) || typeof track.id !== 'string') throw new Error('loadOps: give the track (store.track(id))');
  const s = cleanStack(stack);
  if (!s) throw new Error('loadOps: give a stack, { name, chain: [{ device, params, on }] }');
  const span = gearSpan(track, getDevice);
  const ins = track.inserts || [];
  const replaced = span ? ins.slice(span.from, span.to + 1).map((fx) => fx.id) : [];
  const at = span ? span.from : 0;
  const ops = replaced.map((id) => ({ type: 'insert.remove', track: track.id, insert: id }));
  s.chain.forEach((l, k) => ops.push({ type: 'insert.add', track: track.id, index: at + k, insert: { device: l.device, params: { ...l.params }, on: l.on } }));
  return { ops, label: `Stack: ${s.name}`, by: 'you', replaced };
}

export function houseStacks(placeId) {
  const place = placeOf(placeId) || PLACES.metal;
  return (place.rigs || []).filter((r) => RIGS[r]).map((r) => {
    const chain = cleanChain(rigChain(r, 'L'));
    return { id: 'house.' + place.id + '.' + r, house: true, name: rigLabel(r), chain, amp: ampOf(chain), place: place.id, rig: r };
  });
}
