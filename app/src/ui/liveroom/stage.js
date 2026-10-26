// The stage [ui; stream C fills it in] (docs/research/LIVE-ROOM-MODE.md §3.3-§3.12): the place in pixels with its
// gear, the soundcheck's lamps on it, the setlist under it and the talkback; where the takes are played. It adds the
// 'stage' screen to the registry (ui/liveroom/screens.js) when it's imported.
//
// Until stream C lands, the stage is the place's scene (ui/liveroom/pixels) and its name.

import { h } from '../dom.js';
import { screens } from './screens.js';
import { NAMES } from '../../core/liveroom/model.js';
import { W, H } from './pixels/index.js';

const title = (place) => {
  const n = NAMES.place[place];
  return n ? n[0].toUpperCase() + n.slice(1) : 'The stage';
};

screens.add({
  id: 'stage',
  mount(el, ctx) {
    const view = ctx.view();
    const cv = h('canvas.lr-scene', { width: W, height: H, 'aria-hidden': 'true' });
    el.append(h('h1.lr-h.disp', title(view.place)), cv);
    const g = cv.getContext('2d');
    return {
      frame(now) { if (g) ctx.scene.draw(g, ctx.view(), now); },
      unmount() { el.replaceChildren(); },
    };
  },
});
