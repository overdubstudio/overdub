// The shelf [ui; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §3.13): the room's songs as tape boxes
// (ui/liveroom/shelf-db.js, core/liveroom/label.js, ui/liveroom/pixels drawCover). It adds the 'shelf' screen to the
// registry (ui/liveroom/screens.js) when it's imported.
//
// Until stream F lands, the shelf is its name.

import { h } from '../dom.js';
import { screens } from './screens.js';

screens.add({
  id: 'shelf',
  mount(el) {
    el.append(h('h1.lr-h.disp', 'The shelf'));
    return { frame() {}, unmount() { el.replaceChildren(); } };
  },
});
