// @ts-check
// Which side of the glass a load opens on [ui; stream F] (docs/research/LIVE-ROOM-MODE.md §2.1, §9.6). Pure:
// app/src/main.js asks it before the shell is built, and sets data-room on <html> when it says 'room' (the anti-flash
// rule in app/style/app.css keeps the studio out of sight until the room is up).
//
// Frozen (§14.2):
//   decideDoor({ search, hash, saved, room, webdriver }) -> { side: 'room' | 'control', song: 'new' | 'saved' | 'demo' |
//       'shared' }
//       search, hash: location's; saved: the song this browser saved, as main.js read it: false (none, or one that
//       can't be read), true (one, its fields unknown: read as having no room) or { room, blank } (whether it has a
//       room field; whether it's untitled with nothing on any track); room: ui/liveroom/prefs.js prefs.get();
//       webdriver: navigator.webdriver
//       song: 'new' a blank song; 'saved' the one saved here; 'demo' the control room's own way in (?demo=<id>, or
//       with nothing saved, Night Shift; the simple view's blank sheet); 'shared' the share link's
//
// The table (§2.1), in the order it's read:
//   a share link (#s=)                          the control room, the link's song: someone else's, never the room's
//   ?room                                       the room on a new song, even under navigator.webdriver (its checks)
//   under navigator.webdriver, anything else    the control room, as before the room: ?new and ?studio a new song,
//                                               ?demo the demo, a saved song, else the demo
//   ?demo, ?new&device=, ?studio, and the       the control room (?studio and ?new&device= on a new song)
//   control room's own (?device, ?jam, ?flip,
//   ?view, ?coach, ?community)
//   ?new                                        the room on a new song (its door)
//   a saved song with a room, last on the       the room, on that song
//   room's side (or never through the glass)
//   a blank saved song, last on the room's      the room, on that song (its door: a reload before a place is picked)
//   side
//   a saved song otherwise                      the control room, on that song
//   nothing saved (a first visit)               the room's door, on a new song

const CONTROL = ['device', 'jam', 'flip', 'view', 'coach', 'community'];

/**
 * @param {{ search?: string, hash?: string, saved?: boolean | { room?: boolean, blank?: boolean }, room?: any, webdriver?: boolean }} [o]
 * @returns {{ side: 'room' | 'control', song: 'new' | 'saved' | 'demo' | 'shared' }}
 */
export function decideDoor({ search = '', hash = '', saved = false, room = null, webdriver = false } = {}) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch { q = new URLSearchParams(); }
  if (/[#&]s=/.test(hash || '')) return { side: 'control', song: 'shared' };
  if (q.has('room')) return { side: 'room', song: 'new' };
  const has = !!saved;
  const so = typeof saved === 'object' && saved ? saved : null;
  const hasRoom = !!so && !!so.room;
  const fallback = has ? 'saved' : 'demo';
  if (webdriver) {
    if (q.has('new') || q.has('studio')) return { side: 'control', song: 'new' };
    if (q.has('demo')) return { side: 'control', song: 'demo' };
    return { side: 'control', song: fallback };
  }
  if (q.has('demo')) return { side: 'control', song: 'demo' };
  if (q.has('studio') || (q.has('new') && q.has('device'))) return { side: 'control', song: 'new' };
  if (CONTROL.some((k) => q.has(k))) return { side: 'control', song: fallback };
  if (q.has('new')) return { side: 'room', song: 'new' };
  if (hasRoom) return { side: room && room.side === 'control' ? 'control' : 'room', song: 'saved' };
  if (so && so.blank && room && room.side === 'room') return { side: 'room', song: 'saved' };
  if (has) return { side: 'control', song: 'saved' };
  return { side: 'room', song: 'new' };
}
