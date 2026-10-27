// Getting started, and the tuner [ui; the guitar room's START stream] (docs/research/GUITAR-ROOM.md §2.1, §2.10). A
// STUB until the start stream builds it.
//
// The start stream owns Getting started in the room, on the gauges (ui/gauges/{level,tuner,timing}.js): plug in (the
// jack and the meter's window: input/level.js), tune (the Tuna Fork pedal: input/tuner.js, the monitor muted while it's
// on: R.gr.tuner, audio.monitor), timing (input/calibrate.js), your sound (the club's stack), and the tour. Once, then
// skippable and re-openable (R.gprefs gs); its slate is R.el.callout, its spotlight R.el.stage.spot, and the room's
// rect(name)/el(name) say where to point. The tuner pedal's zoom is R.panel('tuner') (the camera target 'tuner').
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'gs', 'gs:next', 'gs:skip', 'tuner'
//     back() -> bool                          Esc: Getting started steps back or closes; the tuner's zoom
//     frame(now), unmount()
//     open(step?) -> void                     Getting started from a step ('plug' | 'tune' | 'time' | 'sound' | 'tour')
//     done() -> bool                          finished or skipped (R.gprefs.get().gs.done)
//     tuner(on?) -> bool                      the tuner pedal on or off (no arg: flip); on mutes the monitor
//   }

export function mount(R) {
  const notYet = { ok: false, error: 'Getting started isn’t built yet.' };
  return {
    press: (id) => (id === 'gs' || id === 'gs:next' || id === 'gs:skip' || id === 'tuner' ? notYet : false),
    back: () => false,
    frame() {},
    unmount() {},
    open() {},
    done: () => !!R.gprefs.get().gs.done,
    tuner: () => false,
  };
}
