// The drummer [ui; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.7, §2.8; design/mock/
// guitar-room-2/shot-3-kit-book.png). A STUB until the drummer stream builds it.
//
// The drummer stream owns the riser (R.el.stage.riser: the drummer's plate with Space, the tempo and tap, the beat cards
// pinned on it from the song's room.pins), the kit zoom's book (R.panel('kit'): the grooves to pin, a card's bar to
// edit; core/liveroom/guitar/beats.js beatOps/pinOps, room.set { beat, pins }), the jam (Space on the stage: the
// drummer plays the room's beat round until Space again, through store.preview, released on stop: R.gr.jam; ops jamOps),
// the guide beat as the default, no bass, and the count-in voice (R.gprefs countIn; the takes stream asks for it).
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'drummer', 'tempo:<±n>', 'tap', 'beat:prev', 'beat:next', 'beat:<n>',
//                                             'countin'
//     back() -> bool                          Esc: the book's open card, then the jam
//     frame(now), unmount()
//     playing() -> bool                       the jam is on
//     stop() -> void                          stop the jam (the takes stream calls it before a count-in)
//     countIn({ bars, bpm, at }) -> Promise<void>   the drummer counts you in (sticks and the voice), resolving on the
//                                             downbeat (the takes stream's record waits on it; with countIn off, at once)
//   }

export function mount(R) {
  const notYet = { ok: false, error: 'The drummer isn’t built yet.' };
  const mine = (id) => id === 'drummer' || id === 'tap' || id === 'countin' || /^(tempo|beat):/.test(id);
  return {
    press: (id) => (mine(id) ? notYet : false),
    back: () => false,
    frame() {},
    unmount() {},
    playing: () => false,
    stop() {},
    countIn: async () => {},
  };
}
