// The tape machine, the riffs, and Claude on the talkback [ui; the guitar room's TAPE stream] (docs/research/
// GUITAR-ROOM.md §2.3, §2.4, §2.16; design/mock/guitar-room-2/ shot 03g-the-tape and 02d-riffs-and-part-line, and the
// first mock, design/mock/guitar-room/, for the tray, the library and Claude: 03a-03c, 07a-07c, 09a-09c).
//
// The tape stream owns the tape zoom (R.overlay('tape') and its sheet, R.sheet('tape'), under the camera on the
// machine: the last minute, app.input.tape: its span, peaks, lines, select and grab; snap to bar lines, R.gprefs snap:
// ./tape-sheet.js), the riff tray (R.el.drawer.tray: core/liveroom/riffs.js, ui/liveroom/riffs-db.js: ./tape-tray.js),
// the library (R.overlay('library'), R.sheet('library'): ./tape-library.js), riffs onto the part line (the takes
// stream's place), and Claude in the talkback (R.el.strip.talk holds the live room's talkback: / opens its field,
// R.overlay('talk'), R.sheet('talk'); an agent acts through ops, signed and undoable, and what it says goes to the
// room: R.say: ./talk-room.js). Hearing a riff plays it through the rig (./tape-hear.js). The words are
// ./tape-lines.js's, the look ./tape-style.js's.
//
// The tape rolls while the room is up: this starts app.input.tape as the screen mounts (it fills once the input is
// open, through every reopen) and stops it as it goes, if it started it.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'tape', 'riff:keep', 'snap', 'riffs', 'library', 'talk'
//     back() -> bool                          Esc: the talk field, then the library, then the tape's sheet
//     frame(now), unmount()
//     riffs() -> Promise<[riff]>              the tray's riffs (riffs-db.js list)
//     grab() -> Promise<{ ok, riff?, error? }>   the selection off the tape, as a riff in the tray
//   }
// And beside those (for the other streams and the checks):
//     place(riff, { at }) -> Promise<{ ok, error? }>   a riff onto the part line, through R.parts.takes.place (at: the
//                                             part line's index; default after the selected part, with `after`, its id)
//     claude() -> { here, inApp, provider, outside: [name] }   who's on the talkback (the header can say so)
//     sheet, tray, library, talk              the pieces (their headers say what each does)
// Bus: 'tape:grab' ({ riff }: a riff went in the tray), 'tape:drag' ({ riff, x, y, over, at, phase }: a riff dragged
// over the part line; the part line may light the gap at `at`).

import { css } from '../../dom.js';
import * as riffsDb from '../riffs-db.js';
import { rigTracks } from '../../../core/liveroom/guitar/rig.js';
import { CSS } from './tape-style.js';
import { createHear } from './tape-hear.js';
import { createTapeSheet } from './tape-sheet.js';
import { createTray, SESSION } from './tape-tray.js';
import { createLibrary } from './tape-library.js';
import { createTalk } from './talk-room.js';

export function mount(R) {
  css('gr-tape', CSS);
  const app = R.app;
  // the rolling tape: on while the room is up
  const tape = app.input?.tape || null;
  let started = false;
  try { if (tape && !tape.state.rolling) { tape.start(); started = true; } } catch (e) { console.error('guitar room: the tape', e); }

  // (heard through the guitar the monitor plays through: Guitar L, or the side a take moved it to)
  const hear = createHear({ app, track: () => rigTracks(R.store.get())[0] || null });
  const tray = createTray(R, { hear });
  const sheet = createTapeSheet(R, { hear, onKept: () => { tray.refresh(); if (!R.gr.drawer) R.drawer(true); } });
  const library = createLibrary(R, { hear, tray });
  const talk = createTalk(R, { tray });

  const offs = [];
  // the camera and the sheet move together: on the machine, the sheet's up; off it, it's down
  offs.push(R.on('cam', (d) => {
    if (d.to === 'tape' && !sheet.isOpen() && R.gr.overlay !== 'talk') sheet.open();
    else if (d.from === 'tape' && d.to !== 'tape' && sheet.isOpen()) sheet.close({ camera: false });
  }));
  // another overlay took the keys (a take landed, Getting started): what was up here is down
  offs.push(R.on('overlay', ({ id }) => {
    if (id !== 'tape' && id !== 'talk' && sheet.isOpen()) sheet.close({ camera: id == null });
    if (id !== 'library' && id !== 'talk' && library.isOpen()) library.close();
    if (id !== 'talk' && talk.isOpen()) talk.close();
  }));
  offs.push(R.on('drawer', ({ open }) => { if (open) tray.refresh(); else if (hear.key && hear.key !== 'tape') hear.stop(); }));
  // a take starting: nothing of ours plays over it
  let wasBusy = false;

  const ok = (r) => r || { ok: true };
  return {
    press(id) {
      switch (id) {
        case 'tape':
          if (sheet.isOpen()) { sheet.close(); return { ok: true }; }
          sheet.open();
          return { ok: true };
        case 'riff:keep':
          if (!sheet.isOpen() && R.gr.overlay !== null) return { ok: false, error: 'Open the tape first: G.' };
          sheet.keep().then((r) => { if (!r.ok && r.error) R.say(r.error); });
          return { ok: true };
        case 'snap':
          sheet.snap();
          return { ok: true };
        case 'riffs':
          if (library.isOpen()) library.close();
          if (sheet.isOpen()) { sheet.close(); R.drawer(true); return { ok: true }; }
          R.drawer();
          return { ok: true };
        case 'library':
          if (library.isOpen()) { library.close(); return { ok: true }; }
          if (sheet.isOpen()) sheet.close();
          library.open();
          return { ok: true };
        case 'talk':
          return ok(talk.open());
        default:
          return false;
      }
    },
    back() {
      if (talk.isOpen()) return talk.close();
      if (library.isOpen()) return library.close();
      if (sheet.isOpen()) return sheet.close();
      if (hear.key) { hear.stop(); return true; }
      if (R.gr.drawer) { R.drawer(false); return true; }
      return false;
    },
    frame(now) {
      const busy = R.busy();
      if (busy && !wasBusy) { hear.stop(); if (sheet.isOpen()) sheet.close(); if (library.isOpen()) library.close(); }
      wasBusy = busy;
      sheet.frame(now);
      tray.frame(now);
      library.frame(now);
      talk.frame(now);
    },
    unmount() {
      for (const o of offs.splice(0)) { try { o(); } catch { /* gone */ } }
      hear.dispose();
      talk.dispose();
      library.dispose();
      sheet.dispose();
      tray.dispose();
      if (started) { try { tape.stop(); } catch { /* fine */ } }
    },
    async riffs() {
      try { return (await riffsDb.list({ from: SESSION, limit: 100 })).rows; } catch { return []; }
    },
    grab: () => sheet.keep(),
    place: (riff, o = {}) => tray.place(riff, o),
    claude: () => talk.who(),
    sheet, tray, library, talk,
  };
}
