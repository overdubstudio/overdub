// The room in pixels [ui; stream E fills it in] (docs/research/LIVE-ROOM-MODE.md §3.3, §3.18, §3.19): each place as
// a 256 x 144 room with its gear and the console ledge along its bottom, the door's crops of them, the tape box's
// cover, and the part of the scene the stage shows. Drawn with fillStyle, fillRect and globalAlpha only (the scenes in
// ./scenes.js, the prototype's), so a Node check draws them into a buffer; the stage scales the canvas up a whole
// number of pixels at a time (image-rendering: pixelated).
//
// Frozen (§14.2):
//   W 256, H 144                 the scene's size, in scene pixels
//   LEDGE 14                     the console ledge: the strip along the bottom of every scene (its tape counter, two
//                                VU needles, the talkback lamp); a click on it is the glass (§3.15)
//   sceneOf(place) -> { draw(g, view, now) }   a place's scene: draw paints one frame (g: a 2D context on a W x H
//                                canvas; view: the room's view, core/liveroom/session.js readRoom; now: ms)
//   drawCrop(g, place, size)     a door card's crop of a place's room, size: { w, h } in scene pixels
//   drawCover(g, cover, size)    a tape box's cover (core/liveroom/label.js labelOf(p).cover), size: { w, h }
//   windowFor(view) -> { x, y, w, h }   the part of the scene the stage shows for a view, in scene pixels
//
// Until stream E lands: the prototype's rooms, idle (the kitchen's is the room's dark), a crop is the middle of a
// room, a cover is the prototype's tape box, and the window is the whole scene.

import { W, H, drawRoom, drawTape } from './scenes.js';

export { W, H };
export const LEDGE = 14;

const ROOMS = new Set(['basement', 'metal', 'bluesbar']);
const DARK = '#16130f';

export function sceneOf(place) {
  const id = ROOMS.has(place) ? place : null;
  return {
    draw(g, view, now = 0) {
      if (id) drawRoom(g, id, {}, now / 1000);
      else { g.fillStyle = DARK; g.fillRect(0, 0, W, H); }
    },
  };
}

// (a context that draws a part of the scene: the scenes set fillStyle and globalAlpha and call fillRect, so a crop
// is those calls moved by (dx, dy) and cut to the size. The metal club's light beams are paths, the prototype's one
// exception: a crop leaves them out)
const NONE = () => {};
function cropOf(g, dx, dy, w, h) {
  return {
    beginPath: NONE, moveTo: NONE, lineTo: NONE, closePath: NONE, fill: NONE, clearRect: NONE,
    get fillStyle() { return g.fillStyle; },
    set fillStyle(c) { g.fillStyle = c; },
    get globalAlpha() { return g.globalAlpha; },
    set globalAlpha(a) { g.globalAlpha = a; },
    set imageSmoothingEnabled(v) { g.imageSmoothingEnabled = v; },
    fillRect(x, y, rw, rh) {
      const x0 = Math.max(0, x - dx), y0 = Math.max(0, y - dy), x1 = Math.min(w, x - dx + rw), y1 = Math.min(h, y - dy + rh);
      if (x1 > x0 && y1 > y0) g.fillRect(x0, y0, x1 - x0, y1 - y0);
    },
  };
}

export function drawCrop(g, place, size = { w: 128, h: 96 }) {
  const w = Math.max(1, Math.min(W, Math.round(size?.w || 128))), h = Math.max(1, Math.min(H, Math.round(size?.h || 96)));
  const dx = Math.round((W - w) / 2), dy = H - h;
  sceneOf(place).draw(/** @type {any} */ (cropOf(g, dx, dy, w, h)), null, 0);
}

// (the prototype's tape box is 128 x 80, whatever the size)
export function drawCover(g, cover, size = { w: 128, h: 80 }) {
  const c = cover && typeof cover === 'object' ? cover : {};
  drawTape(g, { label: String(c.title || 'UNTITLED').slice(0, 25), sub: String(c.slate || '') });
}

export function windowFor(view) {
  return { x: 0, y: 0, w: W, h: H };
}
