// Sending [ui; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §3.14): the mix as a file, and the whole song
// with its recordings as a zip a room opens again. It adds the 'send' screen to the registry (ui/liveroom/screens.js)
// when it's imported; the stage opens it with app.liveRoom.open({ screen: 'send' }).
//
// Frozen (§14.2):
//   sendMix(app) -> Promise of { ok, error? }    the finished mix (ui/export.js), shared or saved
//   sendSong(app) -> Promise of { ok, error? }   the song and its takes, a zip
//
// Until stream F lands, nothing is sent.

import { h } from '../dom.js';
import { screens } from './screens.js';

export async function sendMix(app) {
  return { ok: false, error: 'Sending the mix isn’t in this build yet.' };
}
export async function sendSong(app) {
  return { ok: false, error: 'Sending the song isn’t in this build yet.' };
}

screens.add({
  id: 'send',
  mount(el) {
    el.append(h('h1.lr-h.disp', 'Send'));
    return { frame() {}, unmount() { el.replaceChildren(); } };
  },
});
