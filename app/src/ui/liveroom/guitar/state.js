// @ts-check
// The guitar room's state [ui; the guitar room's foundation, frozen] (docs/ARCHITECTURE.md "The guitar room"). What the
// room holds beside the song lives here, in ui.state.liveRoom.gr, never in the DOM (CLAUDE.md: "State lives in the
// store or ui.state"); the song itself is the store's, changed only through store.dispatch. Each stream writes only
// its own keys (the owner is named on each), and reads any.
//
//   createState() -> gr   a fresh state, put at ui.state.liveRoom.gr by the screen when it mounts
//   gr = {
//     world: 'stage' | 'shop'                       [camera] which room you're in
//     cam: target id                                [camera] where the camera is: 'stage', 'head', 'cab', 'kit',
//                                                   'board', 'tuner', 'tape'; in the shop 'shop' (its overview),
//                                                   'wall', 'case', 'tryout-head', 'tryout-cab'
//     trail: [target id]                            [camera] the way back, newest last
//     overlay: null | 'gs' | 'review' | 'talk' | 'tape' | 'library'   [whoever opened it] what has the keys above
//                                                   the room (./keys.js contextOf); one at a time: open one by
//                                                   R.overlay(id), close by R.overlay(null) (./index.js)
//     drawer: false                                 [tape, takes] the riffs and the part line are up over the board
//     slot: null | n                                [room] the piece of gear in focus (its slot in the rig, core/
//                                                   liveroom/guitar/rig.js), for the head's and the board's zooms
//     tuner: { on: false }                          [start] the tuner pedal: on holds the monitor (audio.hold('tuner'))
//     monitorSide: null | track id                  [takes] the side a take records, while it isn't Guitar L: the
//                                                   monitor plays through it (./index.js's monitorVia resolver)
//     jam: { on: false, release: null }             [drummer] the drummer is playing past the song's end (release: the
//                                                   jam's store.preview release)
//     take: null | { section, side, clip, track, txn, from, to, landed }   [takes] the take in review
//     tape: { open: false, sel: null, snap: true }  [tape] the last minute's sheet and its selection (frames)
//     shop: { area: 'wall' | 'case', cat: pedalCat, look: device id | null }   [shop] where you are in the shop
//     gs: { step: null | 'plug' | 'tune' | 'time' | 'sound' | 'tour', tour: 0 }   [start] Getting started
//     talk: { open: false }                         [tape] the talkback's field
//     said: {}                                      [any] once-per-visit flags (line ids) for the room's own lines
//   }
// The room's run is ui.state.liveRoom.run, as the live room's: 'idle' | 'count' | 'take' | 'play' (the song from a
// part) | 'jam' (the drummer past the end); app.liveRoom.busy() is true through 'count' and 'take'. The selected part
// card is ui.state.liveRoom.card (a section id), the side ui.state.liveRoom.side ('L' | 'R'), as before.

export function createState() {
  return {
    world: 'stage',
    cam: 'stage',
    trail: [],
    overlay: null,
    drawer: false,
    slot: null,
    tuner: { on: false },
    monitorSide: null,
    jam: { on: false, release: null },
    take: null,
    tape: { open: false, sel: null, snap: true },
    shop: { area: 'wall', cat: 'dynamics', look: null },
    gs: { step: null, tour: 0 },
    talk: { open: false },
    said: {},
  };
}
