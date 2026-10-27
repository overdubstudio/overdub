// The stage room [ui; the guitar room's ROOM stream] (docs/research/GUITAR-ROOM.md §2.2, §2.3; design/mock/guitar-room-2/
// shot-1-stage.png, shot-2-cab-zoom.png). A STUB until the room stream builds it: it outlines the regions and gives the
// camera's targets a hotspot each, so the screen works end to end.
//
// The room stream owns: the pixel room (walls, lights, the club's pixels, into R.el.stage.pixels), the rig drawn from
// the real chain at real size (R.rig.now(): the head with its knobs, the cab, the pedals on the board; a knob is
// R.rig.turn, a footswitch R.rig.stomp, a drag on the board R.rig.move, the + pedal R.press('pedal:add'), into
// R.el.stage.gear), the meter and the cable (input/level.js), the head and board zooms (R.panel('head'),
// R.panel('board')), the door and the tape machine as objects (hotspots: R.press('shop'), R.press('cam:tape')), the
// bottom strip's shell (R.el.strip.tools) and the header's own keys (R.el.tools). It re-registers the camera targets
// with the drawn gear's boxes (R.camera.target(id, { world: 'stage', rect })).
//
// Frozen (the other streams call these):
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'stomp:<1-8>', 'slot:<n>', 'pedal:add'
//     back() -> bool                          Esc: closes what the room has open (a knob's readout, a pedal's menu)
//     frame(now)
//     unmount()
//     rect(name) -> { x, y, w, h } | null     a drawn thing's box in stage world units: 'head', 'cab', 'board', 'meter',
//                                             'jack', 'tuner' (the tuner pedal's place on the board), 'kit', 'riser',
//                                             'banner', 'tape', 'door', or 'slot:<n>' (a piece of gear by its rig slot);
//                                             ./layout.js REGIONS until it's drawn
//     el(name) -> Element | null              the element drawn for one of those (Getting started points at it)
//   }

import { h } from '../../dom.js';
import { REGIONS } from './layout.js';

export function mount(R) {
  const boxes = new Map();
  for (const [name, r] of Object.entries(REGIONS)) {
    const b = h('div.gr-stub', { dataset: { region: name }, style: `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border:1px dashed rgba(255,255,255,.18);color:rgba(255,255,255,.4);font:12px/1.2 var(--font-mono);padding:4px;box-sizing:border-box` }, name);
    R.el.stage.gear.append(b);
    boxes.set(name, b);
  }
  // a hotspot per camera target, and the door
  const hot = (name, label, id) => {
    const r = REGIONS[name];
    const b = h('button.gr-hotspot', { type: 'button', 'aria-label': label, dataset: { hot: name }, onclick: () => R.press(id), style: `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:transparent;border:0;cursor:zoom-in` });
    R.el.stage.hot.append(b);
  };
  hot('head', 'The head: go closer', 'cam:head');
  hot('cab', 'The cab: go closer', 'cam:cab');
  hot('kit', 'The drummer’s book: go closer', 'cam:kit');
  hot('tape', 'The tape machine', 'tape');
  hot('door', 'The door to the shop', 'shop');
  return {
    press(id) {
      const m = /^stomp:([1-8])$/.exec(id);
      if (m) return R.rig.stompN(Number(m[1]));
      const s = /^slot:(\d+)$/.exec(id);
      if (s) { R.gr.slot = Number(s[1]); return { ok: true }; }
      if (id === 'pedal:add') return { ok: false, error: 'The + pedal isn’t built yet.' };
      return false;
    },
    back: () => false,
    frame() {},
    unmount() { R.el.stage.gear.replaceChildren(); R.el.stage.hot.replaceChildren(); },
    rect: (name) => (REGIONS[name] ? { ...REGIONS[name] } : null),
    el: (name) => boxes.get(name) || null,
  };
}
