// @ts-check
// The other side [core; stream B fills it in] (docs/research/LIVE-ROOM-MODE.md §3.7, §4.7): the double. Pure plans,
// each -> { ops, label, reason } for one store.dispatch, made of existing ops (§9.3).
//
// Frozen (§14.2):
//   planDouble(p, { section })               arming Guitar R (and its chain the first time), the pans and the pan lane
//                                            (the house's step)
//   planUseAsRight(p, { section, clip })     a take of the left side used as the right
//
// Until stream B lands, the plans are inert: no ops.

const none = () => ({ ops: [], label: '', reason: '' });

export function planDouble(p, { section = null } = {}) { return none(); }
export function planUseAsRight(p, { section = null, clip = null } = {}) { return none(); }
