// The rooms around the gear, in pixels (docs/BRAND.md, "The live room"): walls, lights, the riser, the door, the tape
// machine, the shop's wall and case. The gear itself is not drawn here: it's the studio's real faces, crisp, standing
// in front of these pixels. One room pixel is 4 world units. Drawn with the room's own brushes
// (app/src/ui/liveroom/pixels/paint.js) and nothing else: fillRect in #rrggbb, no red pixel, no people.

import { rect, px, disc, oval, ring, line, alpha, glow, dither, shade, mix, rnd, text, textWidth } from '/app/src/ui/liveroom/pixels/paint.js';
import { kit } from '/app/src/ui/liveroom/pixels/gear.js';
import { LOOK } from '/app/src/ui/liveroom/pixels/scenes.js';

// signs: the room's 3 x 5 letters, but N, M and W five wide (in three they read as H and a backwards N)
const WIDE = { N: ['10001', '11001', '10101', '10011', '10001'], M: ['10001', '11011', '10101', '10001', '10001'], W: ['10001', '10001', '10101', '10101', '01010'] };
// (sp: the space between letters, k by default; a tight sign uses 1)
export const signWidth = (str, k = 1, sp = k) => [...String(str).toUpperCase()].reduce((a, ch) => a + (WIDE[ch] ? 5 : 3) * k + sp, 0) - sp;
export function sign(g, str, x, y, c, k = 1, sp = k) {
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    if (WIDE[ch]) { WIDE[ch].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') rect(g, cx + i * k, y + j * k, k, k, c); })); cx += 5 * k + sp; }
    else { if (ch !== ' ') text(g, ch, cx, y, c, k); cx += 3 * k + sp; }
  }
}

export const PX = 4;                 // world units per room pixel
export const MARGIN = { x: 480, y: 120 }; // the rooms run on past the core (wide screens, and the camera moving)
const LAMP = '#ffc85a', LAMP_HI = '#ffe2a0', LAMP_OFF = '#4a3a22', GREEN = '#d9f36a', GREEN_OFF = '#4a5228', BONE = '#d8d2c0';

// a canvas sized for a world `w` x `h` (world units) plus the margins; draw(g) gets pixel coordinates with the core's
// top-left at 0, 0
export function sizeRoom(cv, w, h) {
  cv.width = (w + MARGIN.x * 2) / PX; cv.height = (h + MARGIN.y * 2) / PX;
  cv.style.left = -MARGIN.x + 'px'; cv.style.top = -MARGIN.y + 'px';
  cv.style.width = w + MARGIN.x * 2 + 'px'; cv.style.height = h + MARGIN.y * 2 + 'px';
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, MARGIN.x / PX, MARGIN.y / PX);
  return g;
}
const clear = (g) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height); g.restore(); };
const X0 = -MARGIN.x / PX, Y0 = -MARGIN.y / PX;

/* ================================================================================================ the stage */
// in room pixels (world / 4): the core is 360 x 201
export const STAGE = {
  w: 1440, h: 804,
  floorY: 130,        // the stage floor starts (world 520)
  riser: { x: 140, y: 115, w: 138, h: 24 },   // its top at y, its carpeted front below (world 560..1112, 460..556)
  banner: { x: 166, y: 12, w: 86, h: 15 },    // a slim banner on the truss, over the kit
  tape: { x: 279, y: 62, w: 32, h: 77 },      // the machine on its road case (world 1116..1244, 248..556)
  door: { x: 316, y: 60, w: 36, h: 79 },      // world 1264..1408, 240..556
};
// The kit has its own canvas with bigger pixels (6 world units each, not 4): it's the thing on the riser people look at.
// Its canvas is 100 x 56 of those pixels; the kit's centre and its feet (on the riser's top) in that canvas:
export const KIT = { px: 6, w: 100, h: 56, cx: 50, base: 50, x: 540, y: 160 };   // world: 540..1140, 160..496; feet at 460


export function drawStage(g, view = {}) {
  clear(g);
  const W = 360, Hh = 201;
  const R = rnd(7);
  // the back wall: painted black brick, a little violet in the black
  rect(g, X0, Y0, W - 2 * X0, Hh - 2 * Y0, '#120f16');
  for (let y = Y0 + 2; y < STAGE.floorY; y += 6) {
    const off = ((y - Y0) / 6) % 2 ? 6 : 0;
    for (let x = X0 - 12 + off; x < W - X0; x += 12) {
      rect(g, x, y, 11, 5, R() < 0.5 ? '#17131c' : '#151119');
      if (R() < 0.15) rect(g, x + 1, y, 9, 1, '#1d1823');
    }
  }
  // the truss across the top, the lamps hung from it, and their light on the wall and the floor
  rect(g, X0, -2, W - 2 * X0, 3, '#3a3a44'); rect(g, X0, 6, W - 2 * X0, 2, '#3a3a44');
  for (let x = X0; x < W - X0; x += 4) line(g, x, 1, x + 3, 5, '#2a2a32');
  const lamps = [];
  for (let x = X0 + 18; x < W - X0; x += 44) lamps.push(x);
  for (const x of lamps) {
    const lit = x > 0 && x < W;
    alpha(g, lit ? 0.07 : 0.035, () => { for (let y = 14; y < STAGE.floorY + 10; y++) { const half = 3 + (y - 14) * 0.32; rect(g, x - half, y, half * 2, 1, LAMP); } });
  }
  for (const x of lamps) {
    rect(g, x - 1, 8, 3, 2, '#2a2a32');
    rect(g, x - 3, 10, 7, 5, '#24242c'); rect(g, x - 3, 10, 7, 1, '#3c3c46');
    rect(g, x - 2, 14, 5, 1, x > 0 && x < W ? LAMP : LAMP_OFF);
    if (x > 0 && x < W) glow(g, x, 15, 3, LAMP_HI, 0.5);
  }
  // the banner on the truss over the kit: the club's name, slim
  const B = STAGE.banner;
  rect(g, B.x + 6, 8, 1, B.y - 8, '#3a3a44'); rect(g, B.x + B.w - 7, 8, 1, B.y - 8, '#3a3a44');
  rect(g, B.x, B.y, B.w, B.h, '#1d1a22');
  for (let i = 0; i < B.w; i += 7) rect(g, B.x + i, B.y + B.h, 4, 1, '#1d1a22');
  dither(g, B.x, B.y, B.w, B.h, '#221e28', 4);
  const word = 'VOID', k = 2, tw = textWidth(word, k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2) + 1, B.y + 3, '#0b090e', k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2), B.y + 2, BONE, k);
  // the side walls' flyers (seen on a wide screen): whimsy on the walls
  // (placed to be wholly off screen at 1280 and 1440 wide, and wholly on it at 2000)
  flyer(g, -34, 30, 26, 34, '#c9b98a', ['DOOM', 'NIGHT', 'THU'], '#16130f');
  flyer(g, -31, 74, 22, 28, '#4a6a8a', ['OPEN', 'MIC'], '#e8e0cc');
  flyer(g, 366, 34, 26, 30, '#c9b98a', ['VOID', 'TUES'], '#16130f');
  flyer(g, 369, 74, 22, 34, '#6a8a5a', ['LOAD', 'IN', 'BACK'], '#e8e0cc');
  // the stage floor: boards running across, worn lighter where people stand, gaffer marks
  const F = STAGE.floorY;
  rect(g, X0, F, W - 2 * X0, Hh - F - Y0, '#2a2019');
  for (let y = F; y < Hh - Y0; y += 5) {
    rect(g, X0, y, W - 2 * X0, 1, '#1e1712');
    for (let x = X0 + ((y * 7) % 31); x < W - X0; x += 31 + ((y * 3) % 17)) rect(g, x, y + 1, 1, 4, '#1e1712');
  }
  alpha(g, 0.18, () => { for (const x of lamps) if (x > 0 && x < W) oval(g, x, F + 14, 24, 6, LAMP); });
  rect(g, F === 130 ? 40 : 0, F + 8, 6, 1, '#c9b98a'); rect(g, 330, F + 6, 1, 6, '#c9b98a');
  // the riser: its top edge and its carpeted front (the transport and the beat cards are screwed to it)
  const Rz = STAGE.riser;
  rect(g, Rz.x - 2, Rz.y - 2, Rz.w + 4, 3, '#4a3c30'); rect(g, Rz.x - 2, Rz.y - 2, Rz.w + 4, 1, '#6a5644');
  rect(g, Rz.x, Rz.y + 1, Rz.w, Rz.h, '#1f1d22'); dither(g, Rz.x, Rz.y + 1, Rz.w, Rz.h, '#26232a');
  rect(g, Rz.x, Rz.y + Rz.h, Rz.w, 1, '#0e0c10');
  // the tape machine on its road case, the door and its sign
  roadCase(g, STAGE.tape.x - 1, 104, STAGE.tape.w + 2, 35);
  door(g, STAGE.door, view);
  const sw = signWidth('NO STAIRWAY') + 6, sx = Math.min(STAGE.door.x + Math.floor((STAGE.door.w - sw) / 2), W - 4 - sw);
  rect(g, sx, 43, sw, 10, '#e8e0cc'); rect(g, sx, 52, sw, 1, '#9a917e');
  rect(g, sx + 4, 40, 1, 3, '#77736c'); rect(g, sx + sw - 5, 40, 1, 3, '#77736c');
  sign(g, 'NO STAIRWAY', sx + 3, 45, '#16130f');
  // the stack's place: a shadow on the floor under the cab, and the board's
  alpha(g, 0.45, () => { rect(g, 14, 134, 126, 3, '#000000'); rect(g, 4, 198, 352, 3, '#000000'); });
}

function flyer(g, x, y, w, h, c, lines, ink) {
  rect(g, x + 1, y + 1, w, h, '#0a080c');
  rect(g, x, y, w, h, c);
  px(g, x + Math.floor(w / 2), y + 1, '#77736c');
  lines.forEach((l, i) => text(g, l, x + Math.max(1, Math.floor((w - textWidth(l)) / 2)), y + 4 + i * 7, ink));
}
function roadCase(g, x, y, w, h) {
  rect(g, x, y, w, h, '#1a1a1e'); rect(g, x, y, w, 1, '#3a3a44');
  for (const [cx, cy] of [[x, y], [x + w - 3, y], [x, y + h - 3], [x + w - 3, y + h - 3]]) rect(g, cx, cy, 3, 3, '#77736c');
  rect(g, x, y + Math.floor(h / 2), w, 1, '#2a2a32');
  rect(g, x + Math.floor(w / 2) - 3, y + Math.floor(h / 2) - 1, 6, 3, '#77736c');
  text(g, 'VOID', x + Math.floor((w - textWidth('VOID')) / 2), y + h - 9, '#4a4a54');
}
function door(g, D, view) {
  rect(g, D.x - 3, D.y - 3, D.w + 6, D.h + 3, '#2c2630');
  rect(g, D.x, D.y, D.w, D.h, '#3e3330');
  rect(g, D.x, D.y, D.w, 1, '#56473f');
  rect(g, D.x + 4, D.y + 6, D.w - 8, 26, '#362c29'); rect(g, D.x + 4, D.y + 40, D.w - 8, 32, '#362c29');
  rect(g, D.x + 4, D.y + 6, D.w - 8, 1, '#4c3e38'); rect(g, D.x + 4, D.y + 40, D.w - 8, 1, '#4c3e38');
  // the window, with the shop's light behind it
  rect(g, D.x + 10, D.y + 10, D.w - 20, 14, '#1a1410');
  alpha(g, 0.85, () => rect(g, D.x + 11, D.y + 11, D.w - 22, 12, '#6a5228'));
  alpha(g, 0.5, () => { rect(g, D.x + 12, D.y + 12, 3, 2, LAMP); rect(g, D.x + 18, D.y + 12, 3, 2, LAMP); });
  // a sign on it: the shop, through here
  rect(g, D.x + 7, D.y + 30, D.w - 14, 8, '#c9b98a'); sign(g, 'SHOP', D.x + Math.floor((D.w - signWidth('SHOP')) / 2), D.y + 31, '#16130f');
  // the push bar and the light under the door
  rect(g, D.x + 3, D.y + 44, D.w - 6, 2, '#8a8a96'); rect(g, D.x + 3, D.y + 44, D.w - 6, 1, '#c4c4d0');
  alpha(g, view.doorHover ? 0.9 : 0.55, () => rect(g, D.x + 1, D.y + D.h - 1, D.w - 2, 1, LAMP));
  if (view.doorHover) alpha(g, 0.2, () => rect(g, D.x - 6, D.y + D.h, D.w + 12, 3, LAMP));
}

// The moving parts, every frame: the kit (with its sticks for the count), the tape machine's reels and counter
export function drawStageLive(g, s) {
  clear(g);
  tapeMachine(g, STAGE.tape, s);
}
// the kit on its own canvas (KIT): sticks crossed over the snare while they count, resting on the floor tom otherwise
export function drawKit(g, s) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const L = { ...LOOK.metal }, cx0 = KIT.cx, base = KIT.base;
  kit(g, cx0, base, L, s, { double: true, name: s.count != null ? '' : 'VOID' });
  const cx = cx0 - 24, cy = base - 40;
  if (s.count != null) {
    const tap = s.tap || 0, o = Math.round(tap * 2);
    line(g, cx - 10, cy - 8 + o, cx + 6, cy + 4, '#e8dcc0'); line(g, cx + 10, cy - 8 + o, cx - 6, cy + 4, '#e8dcc0');
    if (tap > 0.5) glow(g, cx, cy + 1, 4, '#fff2c0', tap * 0.8);
  } else {
    line(g, cx0 + 18, base - 22, cx0 + 30, base - 26, '#c9b98a');
    line(g, cx0 + 19, base - 21, cx0 + 31, base - 24, '#c9b98a');
  }
}
// a canvas of `w` x `h` world units at `k` world units per pixel, no margins
export function sizePlain(cv, w, h, k = PX) {
  cv.width = Math.ceil(w / k); cv.height = Math.ceil(h / k);
  cv.style.width = cv.width * k + 'px'; cv.style.height = cv.height * k + 'px';
  return cv.getContext('2d');
}
function tapeMachine(g, T, s) {
  const x = T.x, y = T.y;
  rect(g, x, y, T.w, 42, '#2b2723'); rect(g, x, y, T.w, 1, '#4a443c'); rect(g, x, y + 41, T.w, 1, '#141210');
  for (const [rx, dir] of [[x + 8, 1], [x + T.w - 9, 1]]) {
    const ry = y + 10;
    disc(g, rx, ry, 7, '#6e6a62'); disc(g, rx, ry, 6, '#3a2516'); ring(g, rx, ry, 6, '#8c8478');
    const a = s.rolling && !s.reduced ? dir * s.spin : 0;
    for (let i = 0; i < 3; i++) {
      const t = a + (i * Math.PI * 2) / 3;
      line(g, rx + Math.round(Math.cos(t) * 2), ry + Math.round(Math.sin(t) * 2), rx + Math.round(Math.cos(t) * 5), ry + Math.round(Math.sin(t) * 5), '#8c8478');
    }
    disc(g, rx, ry, 1, '#cfc6b4');
  }
  line(g, x + 8, y + 17, x + 13, y + 22, '#3a2516'); line(g, x + T.w - 9, y + 17, x + T.w - 14, y + 22, '#3a2516');
  rect(g, x + 12, y + 21, T.w - 24, 3, '#cfc6b4');
  // the counter: the drummer's bar, in leader green while it rolls
  rect(g, x + 3, y + 26, T.w - 6, 7, '#0f1410');
  const bar = s.bar != null ? `BAR ${s.bar}` : 'BAR -';
  text(g, bar, x + Math.floor((T.w - textWidth(bar)) / 2), y + 27, s.rolling ? GREEN : GREEN_OFF);
  // the input meter and the transport keys
  const lit = Math.round(Math.max(0, Math.min(1, s.input || 0)) * 10);
  for (let i = 0; i < 10; i++) rect(g, x + 4 + i * 2, y + 35, 1, 2, i < lit ? (i > 7 ? LAMP : GREEN) : '#2f3a26');
  rect(g, x + T.w - 6, y + 35, 2, 2, s.rolling ? GREEN : GREEN_OFF);
  if (s.hot) alpha(g, 0.35, () => { rect(g, x - 1, y - 1, T.w + 2, 1, LAMP); rect(g, x - 1, y + 42, T.w + 2, 1, LAMP); });
}

/* ================================================================================================ the shop */
// The shop's world (units): the door back to the stage 20..140, the amp wall 160..1024, the pedal case 1050..1950. Your
// stack isn't in it: it stands in the try-out corner, which stays in view while the camera pans (app.js, the dock).
export const SHOP = { w: 1960, h: 600, door: { x: 24, y: 252, w: 112, h: 336 }, wall: { x: 160, w: 864 }, case: { x: 1050, y: 30, w: 900, h: 548 }, floorY: 588 };

// signs: [{ label, x, y, w }] and shelves: [{ x, y, w }] in world units (the amp wall's sections, measured by app.js from
// where it laid them); plates: the case's drawer plates [{ x, y, w, h }]; shelvesIn: the case's shelf lines [{ y }]
export function drawShop(g, { signs = [], shelves = [], shelvesIn = [] } = {}) {
  clear(g);
  const p = (v) => v / PX;
  const W = p(SHOP.w), Hh = p(SHOP.h), F = p(SHOP.floorY), R = rnd(11);
  // the walls: warm slats behind the amps and the door, cool plaster behind the case
  const caseX = p(SHOP.case.x) - 6;
  rect(g, X0, Y0, W - 2 * X0, Hh - 2 * Y0, '#2a1f17');
  for (let x = X0; x < caseX; x += 5) { rect(g, x, Y0, 4, F - Y0, R() < 0.5 ? '#33261b' : '#2f2318'); rect(g, x + 4, Y0, 1, F - Y0, '#1f1710'); }
  rect(g, caseX, Y0, W - caseX - X0, F - Y0, '#22242a');
  dither(g, caseX, Y0, W - caseX - X0, F - Y0, '#26282f', 4);
  rect(g, caseX - 2, Y0, 5, F - Y0, '#151012'); rect(g, caseX - 1, Y0, 1, F - Y0, '#2a2226');
  // track lights along the ceiling, amber, and their light
  rect(g, X0, 0, W - 2 * X0, 2, '#3a3a44');
  for (let x = X0 + 20; x < W - X0; x += 38) {
    alpha(g, 0.05, () => { for (let y = 6; y < F; y++) { const half = 2 + (y - 6) * 0.22; rect(g, x - half, y, half * 2, 1, LAMP); } });
    rect(g, x - 2, 2, 5, 3, '#24242c'); rect(g, x - 1, 5, 3, 1, LAMP);
  }
  // the amp wall's section signs (painted boards) and its shelves
  for (const s of signs) {
    const x = p(s.x), y = p(s.y), w = p(s.w), k = 2, sp = signWidth(s.label, k) <= w - 2 ? k : 1, tw = signWidth(s.label, k, sp);
    rect(g, x, y, w, 13, '#e3d3a8'); rect(g, x, y + 12, w, 1, '#a8946a'); rect(g, x, y, w, 1, '#f4ead6');
    sign(g, s.label, x + Math.floor((w - tw) / 2), y + 2 + 1, '#a8946a', k, sp);
    sign(g, s.label, x + Math.floor((w - tw) / 2), y + 2, '#16130f', k, sp);
  }
  for (const s of shelves) {
    const x = p(s.x), y = p(s.y), w = p(s.w);
    rect(g, x, y, w, 2, '#6a4a2c'); rect(g, x, y, w, 1, '#8c6a44'); rect(g, x, y + 2, w, 1, '#1a120c');
    rect(g, x + 2, y + 3, 1, 3, '#4a3420'); rect(g, x + w - 3, y + 3, 1, 3, '#4a3420');
  }
  // the door back to the stage, with its sign
  const D = SHOP.door, d = { x: p(D.x), y: p(D.y), w: p(D.w), h: p(D.h) };
  rect(g, d.x - 3, d.y - 3, d.w + 6, d.h + 3, '#2c2630'); rect(g, d.x, d.y, d.w, d.h, '#3e3330');
  rect(g, d.x + 3, d.y + 5, d.w - 6, 22, '#362c29'); rect(g, d.x + 3, d.y + 34, d.w - 6, 40, '#362c29');
  rect(g, d.x + 6, d.y + 8, d.w - 12, 12, '#0e0b10'); alpha(g, 0.5, () => rect(g, d.x + 7, d.y + 9, d.w - 14, 10, '#2a2050'));
  alpha(g, 0.6, () => { rect(g, d.x + 9, d.y + 10, 2, 2, LAMP); rect(g, d.x + 15, d.y + 10, 2, 2, LAMP); });
  const sw2 = signWidth('STAGE') + 4; rect(g, d.x + Math.floor((d.w - sw2) / 2), d.y + 24, sw2, 7, '#c9b98a'); sign(g, 'STAGE', d.x + Math.floor((d.w - sw2) / 2) + 2, d.y + 25, '#16130f');
  rect(g, d.x + 3, d.y + 40, d.w - 6, 2, '#8a8a96'); rect(g, d.x + 3, d.y + 40, d.w - 6, 1, '#c4c4d0');
  alpha(g, 0.5, () => rect(g, d.x + 1, d.y + d.h - 1, d.w - 2, 1, LAMP));
  // the case: a wooden frame, glass with a glint, its drawer column and its shelves, a sign on top
  const C = SHOP.case, x = p(C.x), y = p(C.y), w = p(C.w), h = p(C.h);
  rect(g, x - 4, y - 4, w + 8, h + 8, '#3a2a1e'); rect(g, x - 4, y - 4, w + 8, 1, '#5a4430'); rect(g, x - 4, y + h + 3, w + 8, 1, '#1a120c');
  rect(g, x, y, w, h, '#14161a');
  rect(g, x + 44, y, 2, h, '#3a2a1e');
  for (const s of shelvesIn) { const sy = p(s.y); rect(g, x + 48, sy, w - 50, 2, '#cfe6ee'); alpha(g, 0.5, () => rect(g, x + 48, sy + 2, w - 50, 1, '#000000')); alpha(g, 0.08, () => rect(g, x + 48, sy - 30, w - 50, 30, '#e8f4ff')); }
  alpha(g, 0.06, () => { for (let i = 0; i < w + h; i += 60) for (let k = 0; k < 5; k++) line(g, x + i + k, y, x + i + k - h, y + h, '#e8f4ff'); });
  // the floor (mostly under your board)
  rect(g, X0, F, W - 2 * X0, Hh - F - Y0, '#2a2019');
  for (let yy = F; yy < Hh - Y0; yy += 5) rect(g, X0, yy, W - 2 * X0, 1, '#1e1712');
  rect(g, X0, F, W - 2 * X0, 1, '#120e10');
}

// The try-out corner, behind your stack wherever the camera is: painted brick, its sign, the rug, and the boards your
// pedalboard stands on along the front. `geo` in dock units (app.js dockGeo): { dw, dh, cornerX, boardY }
export function drawDock(g, { dw, dh, cornerX, boardY }) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const p = (v) => Math.round(v / PX), cx = p(cornerX), W = p(dw), F = p(boardY) - 4, Hh = p(dh) + 1, R = rnd(5);
  rect(g, cx, 0, W - cx, F, '#1b2224');
  for (let y = 0; y < F; y += 6) {
    const off = (y / 6) % 2 ? 6 : 0;
    for (let x = cx - 12 + off; x < W; x += 12) { const x0 = Math.max(cx, x); rect(g, x0, y, Math.min(11, W - x0, x + 11 - x0), 5, R() < 0.5 ? '#1f272a' : '#1d2427'); }
  }
  rect(g, cx - 2, 0, 5, F, '#151012'); rect(g, cx - 1, 0, 1, F, '#2a2226');
  const word = 'TRY IT HERE', tw = signWidth(word), sx = cx + Math.floor((W - cx - tw) / 2);
  rect(g, sx - 4, 8, tw + 8, 11, '#151012');
  alpha(g, 0.2, () => rect(g, sx - 5, 7, tw + 10, 13, '#c69cf0'));
  sign(g, word, sx, 11, '#c69cf0');
  alpha(g, 0.07, () => { for (let y = 22; y < F; y++) { const half = 8 + (y - 22) * 0.5; rect(g, cx + (W - cx) / 2 - half, y, half * 2, 1, LAMP); } });
  // the boards along the front, and the rug under your stack
  rect(g, 0, F, W, Hh - F, '#2a2019');
  for (let y = F; y < Hh; y += 5) { rect(g, 0, y, W, 1, '#1e1712'); for (let x = (y * 7) % 31; x < W; x += 31 + ((y * 3) % 17)) rect(g, x, y + 1, 1, 4, '#1e1712'); }
  rect(g, 0, F, W, 1, '#120e10');
  rect(g, cx + 6, F - 4, W - cx - 12, 6, '#3a2430'); rect(g, cx + 8, F - 3, W - cx - 16, 1, '#5a3a48');
}
