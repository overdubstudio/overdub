// @ts-check
// The tape box's label [core; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §3.13): what a room song is
// called on the shelf and on its cover, written from the song.
//
// Frozen (§14.2):
//   labelOf(p) -> { title, slate, parts, note, cover }
//       title: the song's; slate: "METAL CLUB · DROP C · 132 · C MINOR"; parts: the parts as words; note: the
//       engineer's line on where you left it; cover: what pixels/index.js drawCover draws
//   titleDice(p) -> [three titles]   names to try for an untitled song
//
// Until stream F lands, the label is the song's title alone and there are no titles to try.

export function labelOf(p) {
  return { title: (p && typeof p.title === 'string' && p.title) || 'Untitled', slate: '', parts: [], note: '', cover: null };
}
export function titleDice(p) {
  return [];
}
