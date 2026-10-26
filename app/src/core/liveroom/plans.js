// @ts-check
// The stage's plans [core; stream C fills it in] (docs/research/LIVE-ROOM-MODE.md §3, §9.3): what picking a place,
// a take, laying a song out and the card menu's moves do to the song. Pure: each -> { ops, label, reason } for one
// store.dispatch, made of existing ops (section.move is core/arrangement.js's), and never dispatches.
//
// Frozen (§14.2):
//   planPlace(p, { place, tuning })      the tempo and meter, the role tracks with their chains and faders (from
//                                        core/liveroom/places.js setupOf; the kitchen's from kitchen.js kitchenSetup),
//                                        the master finish, room.set
//   takeOps(take, { part })              the ops joined to a take's step: a new part's section.add and room.part.set,
//                                        the seams' re-trims, the End moved
//   planLayout(p)                        the place's form: copies, empty sections, their parts and their band, the End
//   planTwice(p, { section })            ×2
//   planMove(p, { section, before })     section.move, with the seams and the End
//   planShorter(p, { section, bars })    time.remove of the bars cut
//   planRemove(p, { section })           time.remove over the part
//   planEnd(p)                           the End: one bar after the last part, its ring kept
//
// Until stream C lands, the plans are inert: no ops.

const none = () => ({ ops: [], label: '', reason: '' });

export function planPlace(p, { place = null, tuning = null } = {}) { return none(); }
export function takeOps(take, { part = null } = {}) { return none(); }
export function planLayout(p) { return none(); }
export function planTwice(p, { section = null } = {}) { return none(); }
export function planMove(p, { section = null, before = null } = {}) { return none(); }
export function planShorter(p, { section = null, bars = 0 } = {}) { return none(); }
export function planRemove(p, { section = null } = {}) { return none(); }
export function planEnd(p) { return none(); }
