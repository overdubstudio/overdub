// @ts-check
// The paper [core; stream D fills it in] (docs/research/LIVE-ROOM-MODE.md §6.1): the kitchen table's words and chords
// as people write them, in and out. The song keeps the sheet (core/liveroom/model.js, the sheet.* ops); this reads and
// writes its text.
//
// Frozen (§14.2):
//   parseSheet(text) -> { v, capo?, time?, notes?, sections }   ChordPro or chords over words, as pasted
//   formatSheet(sheet, { as: 'chordpro' | 'text' }) -> text
//   lineParts(text) -> [{ text, chord }]   a line in pieces: each [bracketed] chord with the words after it
//   soundingKey(sheet, p) -> { root, scale } | null   the key it sounds in: the shapes plus the capo (the song's key)
//   transposeChord(sym, semis) -> sym   a chord symbol moved (one that doesn't parse is kept as it is)
//
// Until stream D lands, nothing is read: a pasted sheet is empty, and a line is one piece.

export function parseSheet(text) {
  return { v: 1, sections: [] };
}
export function formatSheet(sheet, { as = 'text' } = {}) {
  return '';
}
export function lineParts(text) {
  return [{ text: String(text ?? ''), chord: null }];
}
export function soundingKey(sheet, p) {
  return (p && p.key) || null;
}
export function transposeChord(sym, semis) {
  return sym;
}
