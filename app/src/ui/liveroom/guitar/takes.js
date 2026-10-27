// Takes and the part line [ui; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.11-§2.13;
// design/mock/guitar-room/ shot-take-landed.png, shot-recording.png). A STUB until the takes stream builds it.
//
// The takes stream owns the recording view (R.el.over), the count-in into a part (the drummer's countIn), recording on
// the deck (R.deck.take({ tailFrom }): the ring past the part is its tail), take review (R.overlay('review'), R.gr.take:
// the clip's trim handles, core/project.js clip.trim; Keep / Toss / Again; ↑↓ the takes), the other side with the same
// rig and hearing both, hear-back, and the part line (R.el.drawer.parts: insert, drag, delete, play from, Home;
// core/liveroom/plans.js; measurePair's line). It sets R.run(...) ('count', 'take', 'play') and moves the monitor to
// the side it records (app.input.audio.monitorVia).
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'record', 'again', 'stop', 'keep', 'toss', 'side', 'hear', 'home', 'play',
//                                             'take:up', 'take:down', 'card:<id>' | 'card:prev' | 'card:next',
//                                             'part:new', 'part:before', 'part:remove', 'part:left', 'part:right'
//     back() -> bool                          Esc: a take running is tossed (as Esc in rec), review closes (the take
//                                             kept as it is), the part line's drag lets go
//     frame(now), unmount()
//     inReview() -> bool                      a take is waiting on Keep / Toss
//     part() -> section id | null             the part the next take is for (ui.state.liveRoom.card)
//     place(riff, { at }) -> { ok, error? }   a riff from the tape (the tape stream's) onto the part line as a part
//   }

const MINE = new Set(['record', 'again', 'stop', 'keep', 'toss', 'side', 'hear', 'home', 'play', 'take:up', 'take:down']);

export function mount(R) {
  const notYet = { ok: false, error: 'Takes aren’t built yet.' };
  return {
    press(id) {
      if (id === 'stop' && (R.app.engine?.state?.playing || R.run() === 'play')) { try { R.app.engine.stop(); } catch { /* fine */ } R.run('idle'); return { ok: true }; }
      return MINE.has(id) || /^(card|part):/.test(id) ? notYet : false;
    },
    back: () => false,
    frame() {},
    unmount() {},
    inReview: () => false,
    part: () => R.L.card || null,
    place: () => notYet,
  };
}
