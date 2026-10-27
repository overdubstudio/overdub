// The shop in pixels [ui; the guitar room's SHOP stream] (docs/BRAND.md "The live room"; the second mock's
// room-pixels.js drawShop and drawDock, made one room): the walls, the track lights, the amp wall's painted section
// signs and its shelves, the pedal case's frame and glass, the rack's bay, the door back to the stage, the try-out
// corner's brick, its sign and its rug, and the boards your pedalboard stands on. The gear isn't drawn here: it's the
// studio's real faces, crisp, in front of these pixels. One room pixel is PX (4) world units. Drawn with the room's
// own brushes (../pixels/paint.js: fillRect in #rrggbb), no red pixel, no people.
//
//   SHOPL                       where everything stands in the shop world (world units; ./layout.js SHOP is 1440 x 804)
//   sizeShop(canvas) -> g       the canvas sized for the shop and its margins (./layout.js MARGIN), g in room pixels
//                               with the shop's top-left at 0, 0
//   drawShop(g, { area, signs, shelves, caseShelves, doorHover })   the room, for the area that's up ('wall' | 'case' |
//                               'rack'): signs [{ label, x, y, w }] and shelves [{ x, y, w }] in world units
//   sign(g, str, x, y, c, k, sp), signWidth(str, k, sp)            the room's letters, N M W five wide

import { rect, line, alpha, dither, rnd, text } from '../pixels/paint.js';
import { SHOP, PX, MARGIN } from './layout.js';

export const SHOPL = Object.freeze({
  door: { x: 18, y: 288, w: 120, h: 304 },
  area: { x: 150, y: 84, w: 772, h: 480 },
  corner: { x: 958, y: 60, w: 470, h: 530 },
  floorY: 592,
  board: { x: 16, y: 604, w: 1408, h: 196 },
  bar: { x: 150, y: 18 },
});

const WIDE = { N: ['10001', '11001', '10101', '10011', '10001'], M: ['10001', '11011', '10101', '10001', '10001'], W: ['10001', '10001', '10101', '10101', '01010'] };
export const signWidth = (str, k = 1, sp = k) => [...String(str).toUpperCase()].reduce((a, ch) => a + (WIDE[ch] ? 5 : 3) * k + sp, 0) - sp;
export function sign(g, str, x, y, c, k = 1, sp = k) {
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    if (WIDE[ch]) { WIDE[ch].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') rect(g, cx + i * k, y + j * k, k, k, c); })); cx += 5 * k + sp; }
    else { if (ch !== ' ') text(g, ch, cx, y, c, k); cx += 3 * k + sp; }
  }
}

const LAMP = '#ffc85a';
const X0 = -MARGIN.x / PX, Y0 = -MARGIN.y / PX;

export function sizeShop(cv) {
  cv.width = (SHOP.w + MARGIN.x * 2) / PX; cv.height = (SHOP.h + MARGIN.y * 2) / PX;
  Object.assign(cv.style, { position: 'absolute', left: -MARGIN.x + 'px', top: -MARGIN.y + 'px', width: SHOP.w + MARGIN.x * 2 + 'px', height: SHOP.h + MARGIN.y * 2 + 'px' });
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, MARGIN.x / PX, MARGIN.y / PX);
  return g;
}

export function drawShop(g, { area = 'wall', signs = [], shelves = [], caseShelves = [], doorHover = false } = {}) {
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height); g.restore();
  const p = (v) => v / PX;
  const W = p(SHOP.w), Hh = p(SHOP.h), F = p(SHOPL.floorY), R = rnd(11);
  const cx = p(SHOPL.corner.x) - 2;
  // the walls: warm slats behind the amps and the door
  rect(g, X0, Y0, W - 2 * X0, Hh - 2 * Y0, '#2a1f17');
  for (let x = X0; x < cx; x += 5) { rect(g, x, Y0, 4, F - Y0, R() < 0.5 ? '#33261b' : '#2f2318'); rect(g, x + 4, Y0, 1, F - Y0, '#1f1710'); }
  // track lights along the ceiling, amber, and their light
  rect(g, X0, 0, cx - X0, 2, '#3a3a44');
  for (let x = X0 + 20; x < cx - 6; x += 38) {
    alpha(g, 0.05, () => { for (let y = 6; y < F; y++) { const half = 2 + (y - 6) * 0.22; rect(g, x - half, y, half * 2, 1, LAMP); } });
    rect(g, x - 2, 2, 5, 3, '#24242c'); rect(g, x - 1, 5, 3, 1, LAMP);
  }
  // the area: the wall's signs and shelves, the case's frame and glass, or the rack's cabinet niche
  const A = SHOPL.area, ax = p(A.x), ay = p(A.y), aw = p(A.w), ah = p(A.h);
  if (area === 'wall') {
    for (const s of signs) {
      const x = p(s.x), y = p(s.y), w = p(s.w), tw = signWidth(s.label, 1, 2), mx = x + Math.floor((w - tw) / 2);
      rect(g, mx - 6, y, tw + 12, 9, '#e3d3a8'); rect(g, mx - 6, y + 8, tw + 12, 1, '#a8946a'); rect(g, mx - 6, y, tw + 12, 1, '#f4ead6');
      rect(g, mx - 9, y + 3, 3, 1, '#a8946a'); rect(g, mx + tw + 6, y + 3, 3, 1, '#a8946a');
      rect(g, x, y + 4, mx - 9 - x, 1, '#4a3420'); rect(g, mx + tw + 9, y + 4, x + w - mx - tw - 9, 1, '#4a3420');
      sign(g, s.label, mx, y + 2, '#16130f', 1, 2);
    }
    for (const s of shelves) {
      const x = p(s.x), y = p(s.y), w = p(s.w);
      rect(g, x, y, w, 2, '#6a4a2c'); rect(g, x, y, w, 1, '#8c6a44'); rect(g, x, y + 2, w, 1, '#1a120c');
      rect(g, x + 2, y + 3, 1, 3, '#4a3420'); rect(g, x + w - 3, y + 3, 1, 3, '#4a3420');
    }
  } else if (area === 'case') {
    rect(g, ax - 4, ay - 4, aw + 8, ah + 8, '#3a2a1e'); rect(g, ax - 4, ay - 4, aw + 8, 1, '#5a4430'); rect(g, ax - 4, ay + ah + 3, aw + 8, 1, '#1a120c');
    rect(g, ax, ay, aw, ah, '#14161a');
    rect(g, ax + 44, ay, 2, ah, '#3a2a1e');
    for (const s of caseShelves) { const sy = p(s.y), sx = p(s.x), sw = p(s.w); rect(g, sx, sy, sw, 2, '#cfe6ee'); alpha(g, 0.5, () => rect(g, sx, sy + 2, sw, 1, '#000000')); alpha(g, 0.07, () => rect(g, sx, sy - 26, sw, 26, '#e8f4ff')); }
    alpha(g, 0.05, () => { for (let i = 0; i < aw + ah; i += 60) for (let k = 0; k < 5; k++) line(g, ax + 48 + i + k, ay, ax + 48 + i + k - ah, ay + ah, '#e8f4ff'); });
    // the case's sign on its top rail
    const word = 'PEDALS', tw = signWidth(word, 1);
    rect(g, ax + aw - tw - 14, ay - 12, tw + 8, 7, '#c9b98a'); rect(g, ax + aw - tw - 12, ay - 5, 1, 1, '#5a4430'); rect(g, ax + aw - 9, ay - 5, 1, 1, '#5a4430');
    sign(g, word, ax + aw - tw - 10, ay - 11, '#16130f');
  } else {
    // the rack's niche: a darker bay in the slats
    rect(g, ax - 2, ay - 2, p(330) + 4, ah + 4, '#151012');
  }
  // the door back to the stage, with its sign
  const D = SHOPL.door, d = { x: p(D.x), y: p(D.y), w: p(D.w), h: p(D.h) };
  rect(g, d.x - 3, d.y - 3, d.w + 6, d.h + 3, '#2c2630'); rect(g, d.x, d.y, d.w, d.h, '#3e3330');
  rect(g, d.x + 3, d.y + 5, d.w - 6, 22, '#362c29'); rect(g, d.x + 3, d.y + 34, d.w - 6, 40, '#362c29');
  rect(g, d.x + 6, d.y + 8, d.w - 12, 12, '#0e0b10'); alpha(g, 0.5, () => rect(g, d.x + 7, d.y + 9, d.w - 14, 10, '#2a2050'));
  alpha(g, 0.6, () => { rect(g, d.x + 9, d.y + 10, 2, 2, LAMP); rect(g, d.x + 15, d.y + 10, 2, 2, LAMP); });
  const sw2 = signWidth('STAGE') + 4; rect(g, d.x + Math.floor((d.w - sw2) / 2), d.y + 24, sw2, 7, '#c9b98a'); sign(g, 'STAGE', d.x + Math.floor((d.w - sw2) / 2) + 2, d.y + 25, '#16130f');
  rect(g, d.x + 3, d.y + 40, d.w - 6, 2, '#8a8a96'); rect(g, d.x + 3, d.y + 40, d.w - 6, 1, '#c4c4d0');
  alpha(g, doorHover ? 0.9 : 0.5, () => rect(g, d.x + 1, d.y + d.h - 1, d.w - 2, 1, LAMP));
  // NO STAIRWAY, over the door: the shop's one rule
  const nw = signWidth('STAIRWAY'), nx = d.x + Math.floor((d.w - nw) / 2);
  rect(g, nx - 3, d.y - 20, nw + 6, 16, '#e8e4d8'); rect(g, nx - 3, d.y - 5, nw + 6, 1, '#9a968c');
  sign(g, 'NO', nx + Math.floor((nw - signWidth('NO')) / 2), d.y - 18, '#16130f'); sign(g, 'STAIRWAY', nx, d.y - 11, '#16130f');
  // the try-out corner: painted brick, its sign, a lamp on it, the rug under your stack
  const cw = W - cx - X0;
  rect(g, cx, Y0, cw, F - Y0, '#1b2224');
  for (let y = Y0; y < F; y += 6) {
    const off = (Math.floor((y - Y0) / 6) % 2) ? 6 : 0;
    for (let x = cx - 12 + off; x < W - X0; x += 12) { const x0 = Math.max(cx, x); rect(g, x0, y, Math.min(11, x + 11 - x0), 5, R() < 0.5 ? '#1f272a' : '#1d2427'); }
  }
  rect(g, cx - 2, Y0, 5, F - Y0, '#151012'); rect(g, cx - 1, Y0, 1, F - Y0, '#2a2226');
  const C = SHOPL.corner, ccx = p(C.x + C.w / 2);
  const word = 'TRY IT HERE', tw = signWidth(word, 2), sx = Math.round(ccx - tw / 2);
  rect(g, sx - 5, 3, tw + 10, 15, '#151012');
  alpha(g, 0.2, () => rect(g, sx - 6, 2, tw + 12, 17, '#c69cf0'));
  sign(g, word, sx, 6, '#c69cf0', 2);
  alpha(g, 0.07, () => { for (let y = 20; y < F; y++) { const half = 10 + (y - 20) * 0.42; rect(g, ccx - half, y, half * 2, 1, LAMP); } });
  rect(g, p(C.x) + 6, F - 4, p(C.w) - 12, 6, '#3a2430'); rect(g, p(C.x) + 8, F - 3, p(C.w) - 16, 1, '#5a3a48');
  dither(g, p(C.x) + 8, F - 2, p(C.w) - 16, 3, '#2a1a22', 2);
  // the floor: boards along the front, under your pedalboard
  rect(g, X0, F, W - 2 * X0, Hh - F - Y0, '#2a2019');
  for (let y = F; y < Hh - Y0; y += 5) { rect(g, X0, y, W - 2 * X0, 1, '#1e1712'); for (let x = X0 + ((y * 7) % 31); x < W - X0; x += 31 + ((y * 3) % 17)) rect(g, x, y + 1, 1, 4, '#1e1712'); }
  rect(g, X0, F, W - 2 * X0, 1, '#120e10');
}
