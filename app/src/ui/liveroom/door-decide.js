// @ts-check
// Which side of the glass a load opens on [ui; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §2.1, §9.6).
// Pure: app/src/main.js asks it before the shell is built, and sets data-room on <html> when it says 'room' (the
// anti-flash rule in app/style/app.css keeps the studio out of sight until the room is up).
//
// Frozen (§14.2):
//   decideDoor({ search, hash, saved, room, webdriver }) -> { side: 'room' | 'control', song: 'new' | 'saved' | 'demo' |
//       'shared' }
//       search, hash: location's; saved: whether this browser has a saved song (main.js passes true or false);
//       room: ui/liveroom/prefs.js prefs.get(); webdriver: navigator.webdriver
//
// Until stream F lands, it opens today's first screens, plus ?room: the room on a new song, even under
// navigator.webdriver (the room's own door for checks). A share link is always the control room's.

export function decideDoor({ search = '', hash = '', saved = false, room = null, webdriver = false } = {}) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch { q = new URLSearchParams(); }
  if (/[#&]s=/.test(hash || '')) return { side: 'control', song: 'shared' };
  if (q.has('room')) return { side: 'room', song: 'new' };
  if (q.has('new')) return { side: 'control', song: 'new' };
  if (q.has('demo')) return { side: 'control', song: 'demo' };
  return { side: 'control', song: saved ? 'saved' : 'demo' };
}
