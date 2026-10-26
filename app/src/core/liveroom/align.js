// @ts-check
// Lining the paper's chords up with a work tape [core; stream D fills it in] (docs/research/LIVE-ROOM-MODE.md §6.4):
// only the change points between the paper's own chords are read, so nothing plays a chord the paper doesn't have.
//
// Frozen (§14.2):
//   alignChords(chroma, beats, chords, opts) -> [{ chord, beat, sure }]
//       chroma: per-frame 12-bin chroma of the tape; beats: the tape's beat times (s); chords: the paper's chord
//       symbols in order; sure: false where the read couldn't place a change (it is drawn dotted until heard)
//
// Until stream D lands, nothing is aligned.

export function alignChords(chroma, beats, chords, opts = {}) {
  return [];
}
