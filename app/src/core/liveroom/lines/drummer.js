// @ts-check
// The room's lines: the drummer [copy; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.2, §2.7;
// docs/BRAND.md: the engineer behind the glass, calm, quick, a little dry). What the house says through the talkback
// about the drummer on the riser, one line each. tools/liveroom/checks-copy.js reads every lines/*.js file.
//
//   LINES: { [id]: { text(vars) -> string, once? } }   (ids unique across every lines/*.js file)
//
//   drummer.on        { name, bpm, tape }  the jam started: the beat and the tempo, and (tape: it's rolling) where it is
//   drummer.off       {}                   the jam stopped
//   drummer.next      { name }             a card picked while the drummer plays: it comes in at the next bar
//   drummer.pick      { name, playing }    a card picked while the drummer rests
//   drummer.part      { name, part }       a card picked with a part selected: that part's drums too
//   drummer.kept      { part }             the part's drums were changed by hand: the card names the beat, the notes stay
//   drummer.tempo     { bpm }              the tempo moved
//   drummer.tempo.set {}                   the tempo can't move once a take is in
//   drummer.tap       { bpm }              a tapped tempo
//   drummer.pinned    { name }             a groove pinned to the riser
//   drummer.unpinned  { name }             a card taken off the riser
//   drummer.full      { max }              the riser is full
//   drummer.edited    { name }             a card's bar changed
//   drummer.countin   { on }               the count-in into each take, on or off
//   drummer.nokit     {}                   the room has no drums track (the control room took it out)

const plain = (s) => String(s ?? '').trim() || 'That beat';

export const LINES = {
  'drummer.on': { text: ({ name, bpm, tape }) => (tape ? `${plain(name)} at ${bpm}. The tape’s rolling: the machine, or G, for what you just played.` : `${plain(name)} at ${bpm}.`) },
  'drummer.off': { text: () => 'The drummer’s stopped. The tape kept it.' },
  'drummer.next': { text: ({ name }) => `${plain(name)} at the next bar.` },
  'drummer.pick': { text: ({ name, playing }) => (playing ? `${plain(name)} it is.` : `${plain(name)} it is. Space starts the drummer.`) },
  'drummer.part': { text: ({ name, part }) => `${plain(name)} under the ${String(part || 'part').toLowerCase()} now. ⌘Z puts the last one back.` },
  'drummer.kept': { text: ({ part }) => `The ${String(part || 'part').toLowerCase()} drums were changed by hand, so they stay as they are. The card’s beat is the room’s now.` },
  'drummer.tempo': { text: ({ bpm }) => `${bpm} BPM.` },
  'drummer.tempo.set': { text: () => 'The tempo’s set once there’s a take: the takes were played at it.' },
  'drummer.tap': { text: ({ bpm }) => `${bpm} BPM, from your taps.` },
  'drummer.pinned': { text: ({ name }) => `${plain(name)} is on the riser.` },
  'drummer.unpinned': { text: ({ name }) => `${plain(name)} is off the riser. It’s still in the book.` },
  'drummer.full': { text: ({ max }) => `The riser holds ${max}. Unpin one to make room.` },
  'drummer.edited': { text: ({ name }) => `${plain(name)} is your own now: the card plays its bar as you left it.` },
  'drummer.countin': { text: ({ on }) => (on ? 'The drummer counts you into each take.' : 'No count-in: a take starts on R.') },
  'drummer.nokit': { text: () => 'There’s no drums track in this song any more. The control room has the tracks.' },
};
