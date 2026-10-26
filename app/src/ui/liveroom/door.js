// The door [ui; stream F fills it in] (docs/research/LIVE-ROOM-MODE.md §2.1, §3.1, §3.2): Where are we playing? The
// places as crops of their rooms (ui/liveroom/pixels drawCrop), 1-4 to pick, and a song the house made. It adds the
// 'door' screen to the registry (ui/liveroom/screens.js) when it's imported.
//
// Until stream F lands, the door is its question.

import { h } from '../dom.js';
import { screens } from './screens.js';

screens.add({
  id: 'door',
  mount(el) {
    el.append(h('h1.lr-h.disp', 'Where are we playing?'));
    return { frame() {}, unmount() { el.replaceChildren(); } };
  },
});
