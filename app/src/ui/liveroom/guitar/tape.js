// The tape machine, the riffs, and Claude on the talkback [ui; the guitar room's TAPE stream] (docs/research/
// GUITAR-ROOM.md §2.14-§2.16; design/mock/guitar-room-2/ shot-5-tape.png). A STUB until the tape stream builds it.
//
// The tape stream owns the tape zoom (R.panel('tape') and R.overlay('tape'): the last minute, app.input.tape: its
// span, peaks, lines, select and grab; snap to bar lines, R.gprefs snap), the riff tray (R.el.drawer.tray:
// core/liveroom/riffs.js, ui/liveroom/riffs-db.js), the library (R.overlay('library')), riffs onto the part line (the
// takes stream's place), and Claude in the talkback (R.el.strip.talk holds the live room's talkback: / opens its field,
// R.overlay('talk'); an agent acts through ops, signed and undoable, and what it says goes to the room: R.say).
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'tape', 'riff:keep', 'snap', 'riffs', 'library', 'talk'
//     back() -> bool                          Esc: the talk field, then the library, then the tape's sheet
//     frame(now), unmount()
//     riffs() -> Promise<[riff]>              the tray's riffs (riffs-db.js list)
//     grab() -> Promise<{ ok, riff?, error? }>   the selection off the tape, as a riff in the tray
//   }

export function mount(R) {
  const notYet = { ok: false, error: 'The tape machine isn’t built yet.' };
  return {
    press(id) {
      if (id === 'riffs') { R.drawer(); return { ok: true }; }
      return ['tape', 'riff:keep', 'snap', 'library', 'talk'].includes(id) ? notYet : false;
    },
    back: () => false,
    frame() {},
    unmount() {},
    riffs: async () => [],
    grab: async () => notYet,
  };
}
