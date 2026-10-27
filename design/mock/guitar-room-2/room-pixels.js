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
  riser: { x: 150, y: 115, w: 126, h: 24 },   // its top at y, its carpeted front below (world 600..1104, 460..556)
  kitCx: 213, kitBase: 116,
  banner: { x: 158, y: 18, w: 110, h: 36 },
  tape: { x: 279, y: 62, w: 32, h: 77 },      // the machine on its road case (world 1116..1244, 248..556)
  door: { x: 316, y: 60, w: 36, h: 79 },      // world 1264..1408, 240..556
};

export function drawStage(g, view = {}) {
  clear(g);
  const W = 360, Hh = 201, L = LOOK.metal;
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
  // the banner over the kit: the club's name, VOID
  const B = STAGE.banner;
  rect(g, B.x - 2, B.y - 2, B.w + 4, 2, '#3a3a44');
  rect(g, B.x, B.y, B.w, B.h, '#1d1a22');
  for (let i = 0; i < B.w; i += 9) rect(g, B.x + i, B.y + B.h, 5, 2, '#1d1a22');
  dither(g, B.x, B.y, B.w, B.h, '#221e28', 4);
  const word = 'VOID', k = 5, tw = textWidth(word, k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2) + 1, B.y + 7 + 1, '#0b090e', k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2), B.y + 7, BONE, k);
  // the side walls' flyers (seen on a wide screen): whimsy on the walls
  flyer(g, -86, 40, 26, 34, '#c9b98a', ['DOOM', 'NIGHT', 'THU'], '#16130f');
  flyer(g, -52, 52, 22, 28, '#4a6a8a', ['OPEN', 'MIC'], '#e8e0cc');
  flyer(g, -110, 70, 18, 24, '#8a7aa8', ['NO', 'SOLO', 'OVER', '5MIN'], '#16130f');
  flyer(g, 372, 36, 26, 30, '#c9b98a', ['VOID', 'TUES'], '#16130f');
  flyer(g, 404, 56, 24, 34, '#6a8a5a', ['LOAD', 'IN', 'BACK'], '#e8e0cc');
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
  const sw = signWidth('NO STAIRWAY') + 6, sx = STAGE.door.x + Math.floor((STAGE.door.w - sw) / 2);
  rect(g, sx, 43, sw, 10, '#e8e0cc'); rect(g, sx, 52, sw, 1, '#9a917e');
  rect(g, sx + 4, 40, 1, 3, '#77736c'); rect(g, sx + sw - 5, 40, 1, 3, '#77736c');
  sign(g, 'NO STAIRWAY', sx + 3, 45, '#16130f');
  // the stack's place: a shadow on the floor under the cab, and the board's
  alpha(g, 0.45, () => { rect(g, 14, 138, 126, 3, '#000000'); rect(g, 8, 196, 344, 4, '#000000'); });
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
  const L = { ...LOOK.metal };
  kit(g, STAGE.kitCx, STAGE.kitBase, L, s, { double: true, name: s.count != null ? '' : 'VOID' });
  // the sticks: two, crossed over the snare while they count; resting on the floor tom otherwise
  const cx = STAGE.kitCx - 24, cy = STAGE.kitBase - 40;
  if (s.count != null) {
    const tap = s.tap || 0, o = Math.round(tap * 2);
    line(g, cx - 10, cy - 8 + o, cx + 6, cy + 4, '#e8dcc0'); line(g, cx + 10, cy - 8 + o, cx - 6, cy + 4, '#e8dcc0');
    if (tap > 0.5) glow(g, cx, cy + 1, 4, '#fff2c0', tap * 0.8);
  } else {
    line(g, STAGE.kitCx + 18, STAGE.kitBase - 22, STAGE.kitCx + 30, STAGE.kitBase - 26, '#c9b98a');
    line(g, STAGE.kitCx + 19, STAGE.kitBase - 21, STAGE.kitCx + 31, STAGE.kitBase - 24, '#c9b98a');
  }
  tapeMachine(g, STAGE.tape, s);
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
// world layout (units): the amp wall 0..840, the try-out corner 840..1440, the pedal case 1440..2440
export const SHOP = { w: 2440, h: 804, wall: { x: 0, w: 840 }, corner: { x: 840, w: 600 }, case: { x: 1440, w: 1000 }, floorY: 640 };

// signs: [{ label, x, y, w }] in world units (the amp wall's sections, measured by app.js from where it laid them)
export function drawShop(g, { signs = [], shelves = [], caseBox = null, door: D = null } = {}) {
  clear(g);
  const p = (v) => v / PX;
  const W = p(SHOP.w), Hh = p(SHOP.h), F = p(SHOP.floorY), R = rnd(11);
  // the walls: warm slats behind the amps, painted brick in the corner, cool plaster behind the case
  rect(g, X0, Y0, W - 2 * X0, Hh - 2 * Y0, '#2a1f17');
  for (let x = X0; x < p(SHOP.corner.x); x += 5) { rect(g, x, Y0, 4, F - Y0, R() < 0.5 ? '#33261b' : '#2f2318'); rect(g, x + 4, Y0, 1, F - Y0, '#1f1710'); }
  rect(g, p(SHOP.corner.x), Y0, p(SHOP.corner.w), F - Y0, '#1b2224');
  for (let y = Y0 + 2; y < F; y += 6) {
    const off = ((y - Y0) / 6) % 2 ? 6 : 0;
    for (let x = p(SHOP.corner.x) - 12 + off; x < p(SHOP.case.x); x += 12) rect(g, Math.max(p(SHOP.corner.x), x), y, Math.min(11, p(SHOP.case.x) - Math.max(p(SHOP.corner.x), x)), 5, R() < 0.5 ? '#1f272a' : '#1d2427');
  }
  rect(g, p(SHOP.case.x), Y0, W - p(SHOP.case.x) - X0, F - Y0, '#22242a');
  dither(g, p(SHOP.case.x), Y0, W - p(SHOP.case.x) - X0, F - Y0, '#26282f', 4);
  // pillars between the three
  for (const x of [p(SHOP.corner.x) - 2, p(SHOP.case.x) - 2]) { rect(g, x, Y0, 5, F - Y0, '#151012'); rect(g, x + 1, Y0, 1, F - Y0, '#2a2226'); }
  // track lights along the ceiling, amber, and their light
  rect(g, X0, 2, W - 2 * X0, 2, '#3a3a44');
  for (let x = X0 + 20; x < W - X0; x += 38) {
    alpha(g, 0.05, () => { for (let y = 8; y < F; y++) { const half = 2 + (y - 8) * 0.22; rect(g, x - half, y, half * 2, 1, LAMP); } });
    rect(g, x - 2, 4, 5, 4, '#24242c'); rect(g, x - 1, 8, 3, 1, LAMP);
  }
  // the amp wall's section signs (painted boards) and its shelves
  for (const s of signs) {
    const x = p(s.x), y = p(s.y), w = p(s.w), k = 2, sp = signWidth(s.label, k) <= w - 4 ? k : 1, tw = signWidth(s.label, k, sp);
    rect(g, x, y, w, 13, '#e3d3a8'); rect(g, x, y + 12, w, 1, '#a8946a'); rect(g, x, y, w, 1, '#f4ead6');
    sign(g, s.label, x + Math.floor((w - tw) / 2), y + 2 + 1, '#a8946a', k, sp);
    sign(g, s.label, x + Math.floor((w - tw) / 2), y + 2, '#16130f', k, sp);
  }
  for (const s of shelves) {
    const x = p(s.x), y = p(s.y), w = p(s.w);
    rect(g, x, y, w, 2, '#6a4a2c'); rect(g, x, y, w, 1, '#8c6a44'); rect(g, x, y + 2, w, 1, '#1a120c');
    rect(g, x + 2, y + 3, 1, 3, '#4a3420'); rect(g, x + w - 3, y + 3, 1, 3, '#4a3420');
  }
  // the try-out corner: a rug, its sign, and the door back to the stage
  const cx = p(SHOP.corner.x), cw = p(SHOP.corner.w);
  const rugY = F + 2;
  rect(g, cx + 6, rugY, cw - 12, Hh - rugY - 2, '#3a2430');
  for (let i = 0; i < 4; i++) rect(g, cx + 8 + i * 2, rugY + 2 + i * 2, cw - 16 - i * 4, 1, i % 2 ? '#5a3a48' : '#2a1820');
  const word = 'TRY IT HERE', tw = signWidth(word, 2);
  rect(g, cx + Math.floor((cw - tw) / 2) - 4, 16, tw + 8, 14, '#151012');
  sign(g, word, cx + Math.floor((cw - tw) / 2), 19, '#c69cf0', 2);
  alpha(g, 0.25, () => rect(g, cx + Math.floor((cw - tw) / 2) - 6, 14, tw + 12, 18, '#c69cf0'));
  if (D) {
    const d = { x: p(D.x), y: p(D.y), w: p(D.w), h: p(D.h) };
    rect(g, d.x - 3, d.y - 3, d.w + 6, d.h + 3, '#2c2630'); rect(g, d.x, d.y, d.w, d.h, '#3e3330');
    rect(g, d.x + 3, d.y + 5, d.w - 6, 20, '#362c29'); rect(g, d.x + 3, d.y + 30, d.w - 6, 24, '#362c29');
    rect(g, d.x + 6, d.y + 8, d.w - 12, 10, '#0e0b10'); alpha(g, 0.5, () => rect(g, d.x + 7, d.y + 9, d.w - 14, 8, '#2a2050'));
    const sw2 = signWidth('STAGE') + 4; rect(g, d.x + Math.floor((d.w - sw2) / 2), d.y + 21, sw2, 7, '#c9b98a'); sign(g, 'STAGE', d.x + Math.floor((d.w - sw2) / 2) + 2, d.y + 22, '#16130f');
    rect(g, d.x + d.w - 6, d.y + 34, 2, 4, '#8a8a96');
    alpha(g, 0.5, () => rect(g, d.x + 1, d.y + d.h - 1, d.w - 2, 1, '#8a6ad0'));
  }
  // the case: a wooden base, glass with a glint, and a sign
  if (caseBox) {
    const x = p(caseBox.x), y = p(caseBox.y), w = p(caseBox.w), h = p(caseBox.h);
    rect(g, x - 3, y - 3, w + 6, h + 6, '#3a2a1e'); rect(g, x - 3, y - 3, w + 6, 1, '#5a4430');
    rect(g, x, y, w, h, '#14161a');
    alpha(g, 0.07, () => { for (let i = 0; i < w + h; i += 46) for (let k = 0; k < 6; k++) line(g, x + i + k, y, x + i + k - h, y + h, '#e8f4ff'); });
    rect(g, x - 3, y + h + 3, w + 6, F - (y + h + 3) + 8, '#2c2016'); rect(g, x - 3, y + h + 3, w + 6, 1, '#5a4430');
    for (let i = 0; i < 4; i++) rect(g, x + 4 + i * Math.floor(w / 4), y + h + 7, Math.floor(w / 4) - 8, 1, '#1a120c');
    const s = 'PEDALS', k = 3, tw2 = signWidth(s, k);
    rect(g, x + Math.floor((w - tw2) / 2) - 5, y - 26, tw2 + 10, 20, '#e3d3a8'); rect(g, x + Math.floor((w - tw2) / 2) - 5, y - 7, tw2 + 10, 1, '#a8946a');
    sign(g, s, x + Math.floor((w - tw2) / 2), y - 22, '#16130f', k);
  }
  // the floor: a music shop's checkerboard
  for (let y = F; y < Hh - Y0; y += 6) for (let x = X0 + ((y - F) / 6 % 2) * 6; x < W - X0; x += 12) { rect(g, x, y, 6, 6, '#2e2b31'); rect(g, x + 6, y, 6, 6, '#3a363d'); }
  rect(g, X0, F, W - 2 * X0, 1, '#120e10');
  rect(g, cx + 6, rugY, cw - 12, Hh - rugY - 2, '#3a2430');
  for (let i = 0; i < 4; i++) rect(g, cx + 8 + i * 2, rugY + 2 + i * 2, cw - 16 - i * 4, 1, i % 2 ? '#5a3a48' : '#2a1820');
  alpha(g, 0.5, () => rect(g, cx + 20, F - 3, cw - 40, 3, '#000000'));
}
