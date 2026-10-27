// @ts-check
// The gear bound to the song [ui; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §2.2, §2.9). How
// a piece of gear the room draws (a knob on the head, a pedal's footswitch, the board's order) reads and changes the
// real device on the guitar tracks. It reads the song (core/liveroom/guitar/rig.js rigOf) and writes only through
// store.dispatch, by you, each change one undo step (a knob's drag coalesces into one: store.dispatch's coalesce), on
// every guitar track at once (ONE stack: both sides). Edits go to this song's copy; nothing is saved to the rack
// unless you say so (the shop's Save to rack; ⌘S stays the studio's).
//
//   createRigBinding({ store, getDevice, busy }) -> rig
//     busy() -> bool: a take is running (swaps, adds, removes and moves wait for it; a knob and a stomp don't: the take
//       records your dry guitar, the rig is how you hear it)
//   rig.now() -> Rig | null           core/liveroom/guitar/rig.js rigOf, read again after each change to the song
//   rig.def(slot) -> device def | null        the registry's def (ui/faces.js renderFace takes it)
//   rig.values(slot) -> { key: value }        every param's value (devices/registry.js paramValues: stored, else
//                                             the default), what a face shows
//   rig.turn(slot, key, value, { commit }) -> { ok, error? }
//       a knob: insert.set on every guitar track, coalesced while the hand is on it ({ commit: false } from a drag;
//       commit: true ends it, ui/faces.js onParam's)
//   rig.stomp(slot, on?) -> { ok, error? }    a footswitch (on undefined: flip)
//   rig.stompN(n) -> { ok, error? }           the board's pedal n (1-8, the keys), in board order
//   rig.move(from, to) / rig.add(link, at?) / rig.remove(slot) -> { ok, error? }   drag to reorder, + pedal, take off
//   rig.swap(stack, { label }) -> { ok, error? }   the whole run for a stack (the shop's carry, the rack's load)
//   rig.sync() -> { ok }                      the other sides made L's again (they drifted: the control room)
//   rig.on('change', fn(rig)) -> off          the rig changed (any author's step, an undo, a load)
//   rig.dispose()

import { rigOf, planTurn, planStomp, planMove, planAdd, planRemove, planSwap, planSync, coalesceKey } from '../../../core/liveroom/guitar/rig.js';
import { paramValues } from '../../../devices/registry.js';

export function createRigBinding({ store, getDevice, busy = () => false }) {
  let cached = null, stale = true;
  const fns = new Set();
  const offStore = store.on('change', () => {
    stale = true;
    const before = cached;
    const after = now();
    if (JSON.stringify(before?.chain || null) !== JSON.stringify(after?.chain || null) || before?.track !== after?.track) {
      for (const fn of fns) { try { fn(after); } catch (e) { console.error('rig listener', e); } }
    }
  });
  function now() {
    if (stale) { try { cached = rigOf(store.get()); } catch (e) { console.error('the rig', e); cached = null; } stale = false; }
    return cached;
  }
  const def = (slot) => { const s = now()?.slots[slot]; return s ? getDevice(s.device) || null : null; };
  function send(plan, { coalesce = null, guard = false } = {}) {
    if (plan.error) return { ok: false, error: plan.error };
    if (guard && busy()) return { ok: false, error: 'The rig changes once the take is in.' };
    if (!plan.ops.length) return { ok: true, txn: null };
    const r = store.dispatch(plan.ops, { by: 'you', label: plan.label, reason: plan.reason, coalesce });
    return r.ok ? { ok: true, txn: r.txn } : { ok: false, error: r.error };
  }
  return {
    now,
    def,
    values(slot) { const s = now()?.slots[slot], d = def(slot); return s && d ? paramValues(d, s.params) : {}; },
    turn(slot, key, value, { commit: _commit = true } = {}) {
      return send(planTurn(store.get(), { slot, params: { [key]: value } }), { coalesce: coalesceKey(slot, key) });
    },
    stomp(slot, on) { return send(planStomp(store.get(), { slot, on })); },
    stompN(n) {
      const b = now()?.board[n - 1];
      return b ? send(planStomp(store.get(), { slot: b.slot })) : { ok: false, error: `There’s no pedal ${n} on the board.` };
    },
    move(from, to) { return send(planMove(store.get(), { from, to }), { guard: true }); },
    add(link, at) { return send(planAdd(store.get(), { link, at }), { guard: true }); },
    remove(slot) { return send(planRemove(store.get(), { slot }), { guard: true }); },
    swap(stack, { label = '' } = {}) { return send(planSwap(store.get(), { stack, label }), { guard: true }); },
    sync() { return send(planSync(store.get()), { guard: true }); },
    on(evt, fn) { if (evt !== 'change') return () => {}; fns.add(fn); return () => fns.delete(fn); },
    dispose() { offStore?.(); fns.clear(); },
  };
}
