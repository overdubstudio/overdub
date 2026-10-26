// The kitchen table [ui; stream D fills it in] (docs/research/LIVE-ROOM-MODE.md §2.5, §6): the paper, the work tape
// and the players. It adds the 'kitchen' screen to the registry (ui/liveroom/screens.js) when it's imported, and
// records through the deck (ui/liveroom/deck.js).
//
// Until stream D lands, the screen is its name.

import { h } from '../dom.js';
import { screens } from './screens.js';

screens.add({
  id: 'kitchen',
  mount(el) {
    el.append(h('h1.lr-h.disp', 'The kitchen table'));
    return { frame() {}, unmount() { el.replaceChildren(); } };
  },
});
