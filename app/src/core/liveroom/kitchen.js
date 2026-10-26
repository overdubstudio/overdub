// @ts-check
// The kitchen table [core; stream D fills it in] (docs/research/LIVE-ROOM-MODE.md §6): a voice and a guitar on one or
// two mics, the paper's chords, the players who come in under a work tape. Pure plans, each -> { ops, label, reason }
// for one store.dispatch (§9.3).
//
// Frozen (§14.2):
//   kitchenSetup({ mic }) -> { tempo, meter, grid, count, tracks, master, feels, form, names }   the kitchen's
//                            places.js setupOf: the take track (or Voice and Guitar, mic 'two'), the players' tracks
//   planRead(p, { take, sheet })          the kitchen's sections, the Chords track and its clips (the house's)
//   planTime(p, { take, reading })        tempo.map from the chosen reading, the band re-timed
//   planPlayer(p, { player, section })    a player's track (once) and clip
//   planMaster(p, { clip })               room.set { master }, the time from that take, the band re-timed
//   planKitchenFinish(p, { finish })      the kitchen's finishes: bare, warm, close
//   offeredKitchen(view, run) -> { id, label, key } | null   the kitchen's offered move (core/liveroom/session.js
//                            offered hands it on)
//
// Until stream D lands, the setup is empty and the plans are inert.

const none = () => ({ ops: [], label: '', reason: '' });

export function kitchenSetup({ mic = 'one' } = {}) {
  return { tempo: null, meter: [4, 4], grid: 4, count: { beats: 0, voice: 'none' }, tracks: [], master: [], feels: [], form: [], names: {} };
}
export function planRead(p, { take = null, sheet = null } = {}) { return none(); }
export function planTime(p, { take = null, reading = null } = {}) { return none(); }
export function planPlayer(p, { player = null, section = null } = {}) { return none(); }
export function planMaster(p, { clip = null } = {}) { return none(); }
export function planKitchenFinish(p, { finish = null } = {}) { return none(); }
export function offeredKitchen(view, run) { return null; }
