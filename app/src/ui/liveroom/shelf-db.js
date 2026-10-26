// The shelf's store [ui; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §9.6): IndexedDB overdub-shelf (the
// name is forever), one record per room song, { id, song, at, title, place, finished, bytes }, written on the room's
// autosave beside overdub:project.
//
// Frozen (§14.2), each a Promise:
//   put(record) -> stored (bool)   list() -> [records], newest first   get(id) -> record | null   remove(id) -> removed
//
// Until stream F lands, nothing is stored.

export async function put(record) { return false; }
export async function list() { return []; }
export async function get(id) { return null; }
export async function remove(id) { return false; }
