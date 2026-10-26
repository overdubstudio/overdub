// @ts-check
// The room's lines: kitchen [copy; stream D, the kitchen table] (docs/research/LIVE-ROOM-MODE.md §10). What the house says through
// the talkback, one line each, in BRAND's voice (§10.1, and never §10.2's list). tools/liveroom/checks-copy.js reads
// every lines/*.js file.
//
// Frozen (§14.2):
//   LINES: { [id]: { text(vars) -> string, once? } }   once: said once per song (ui/liveroom/prefs.js said/mark keeps
//          it from coming back after a reload). Ids are unique across every lines/*.js file.

export const LINES = {};
