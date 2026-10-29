// The stage's pixels [ui; the guitar room's ROOM stream] (docs/BRAND.md "The live room"; the second mock's
// design/mock/guitar-room-2/room-pixels.js, which this carries into the app). Everything around the gear: the painted
// brick back wall, the truss and its lamps, the banner over the kit, the boards of the stage floor, the riser's top
// and carpeted front, the tape machine on its road case, the shop's door under NO STAIRWAY, and the flyers a wide
// window shows. The gear itself is not drawn here: it's the studio's real faces (ui/faces.js), crisp in front.
//
// Drawn with the live room's brushes (../pixels/paint.js) and nothing else: fillStyle '#rrggbb', globalAlpha and
// fillRect at whole pixels, so a Node check draws the same pixels into a buffer (tools/liveroom/checks-room.js). No
// red pixel (red is the record light's), no people.
//
// Coordinates are room pixels (PX = 4 world units, ./layout.js), the core's top-left at 0, 0; the room runs on past
// the core by MARGIN on every side (a wide window, the camera moving). A canvas holds the core plus its margins, so
// each draw goes through shifted(g, ox, oy), which moves every fillRect by the margin.
//
//   PIX = { w, h, floorY, riser, banner, tape, door }   where things stand, in room pixels (world = x PX)
//   KIT = { px, w, h, cx, base, x, y }                  the kit's own canvas: bigger pixels (6 world units), world x, y
//   TAPE = { x, y, w, h }                               the tape machine's live canvas, room pixels on the core
//   shifted(g, ox, oy) -> g'                            a context whose fillRects land ox, oy pixels over
//   drawStage(g, { doorHover })                         the room, once (and again when the door's hovered)
//   drawTape(g, { rolling, bar, input, hot, spin, reduced })   the machine: reels turning while the tape rolls, the
//                                                       bar counter in leader green, the input's little lamps
//   drawKit(g, { kick, snare, hat, crash, tom, count, tap, reduced })   the club's double-kick kit, sticks resting on
//                                                       the floor tom, or crossed over the snare while they count

import { rect, px, disc, oval, ring, line, alpha, glow, dither, rnd, text, textWidth } from '../pixels/paint.js';
import { kit } from '../pixels/gear.js';
import { LOOK } from '../pixels/scenes.js';
import { PX, MARGIN, STAGE } from './layout.js';

const LAMP = '#ffc85a', LAMP_HI = '#ffe2a0', LAMP_OFF = '#4a3a22', GREEN = '#d9f36a', GREEN_OFF = '#4a5228', BONE = '#d8d2c0';
const W = STAGE.w / PX, H = STAGE.h / PX;           // 360 x 201
const X0 = -MARGIN.x / PX, Y0 = -MARGIN.y / PX;     // the margins' far edges

export const PIX = Object.freeze({
  w: W, h: H,
  floorY: 130,                                        // the stage floor (world 520)
  riser: Object.freeze({ x: 140, y: 115, w: 138, h: 24 }),     // world 560..1112, 460..556
  banner: Object.freeze({ x: 166, y: 12, w: 86, h: 15 }),      // world 664..1008, 48..108
  tape: Object.freeze({ x: 279, y: 62, w: 32, h: 77 }),        // world 1116..1244, 248..556
  door: Object.freeze({ x: 316, y: 60, w: 36, h: 79 }),        // world 1264..1408, 240..556
});
export const KIT = Object.freeze({ px: 6, w: 100, h: 56, cx: 50, base: 50, x: 540, y: 160 });
export const TAPE = Object.freeze({ x: PIX.tape.x, y: PIX.tape.y, w: PIX.tape.w, h: 42 });

// a context that draws ox, oy pixels over (the brushes only set fillStyle and globalAlpha and call fillRect)
export function shifted(g, ox, oy) {
  return {
    get fillStyle() { return g.fillStyle; }, set fillStyle(c) { g.fillStyle = c; },
    get globalAlpha() { return g.globalAlpha; }, set globalAlpha(a) { g.globalAlpha = a; },
    fillRect(x, y, w, h) { g.fillRect(x + ox, y + oy, w, h); },
  };
}

// signs: the room's 3 x 5 letters, but N, M and W five wide (in three they read as H and a backwards N)
const WIDE = { N: ['10001', '11001', '10101', '10011', '10001'], M: ['10001', '11011', '10101', '10001', '10001'], W: ['10001', '10001', '10101', '10101', '01010'] };
export const signWidth = (str, k = 1, sp = k) => [...String(str).toUpperCase()].reduce((a, ch) => a + (WIDE[ch] ? 5 : 3) * k + sp, 0) - sp;
export function sign(g, str, x, y, c, k = 1, sp = k) {
  let cx = x;
  for (const ch of String(str).toUpperCase()) {
    if (WIDE[ch]) { WIDE[ch].forEach((row, j) => [...row].forEach((b, i) => { if (b === '1') rect(g, cx + i * k, y + j * k, k, k, c); })); cx += 5 * k + sp; }
    else { if (ch !== ' ') text(g, ch, cx, y, c, k); cx += 3 * k + sp; }
  }
}

export function drawStage(g, view = {}) {
  const R = rnd(7);
  // the back wall: painted black brick, a little violet in the black
  rect(g, X0, Y0, W - 2 * X0, H - 2 * Y0, '#120f16');
  for (let y = Y0 + 2; y < PIX.floorY; y += 6) {
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
  const lit = (x) => x > 0 && x < W;
  for (const x of lamps) alpha(g, lit(x) ? 0.07 : 0.035, () => { for (let y = 14; y < PIX.floorY + 10; y++) { const half = Math.round(3 + (y - 14) * 0.32); rect(g, x - half, y, half * 2, 1, LAMP); } });
  for (const x of lamps) {
    rect(g, x - 1, 8, 3, 2, '#2a2a32');
    rect(g, x - 3, 10, 7, 5, '#24242c'); rect(g, x - 3, 10, 7, 1, '#3c3c46');
    rect(g, x - 2, 14, 5, 1, lit(x) ? LAMP : LAMP_OFF);
    if (lit(x)) glow(g, x, 15, 3, LAMP_HI, 0.5);
  }
  // the banner on the truss over the kit: the club's name, slim
  const B = PIX.banner;
  rect(g, B.x + 6, 8, 1, B.y - 8, '#3a3a44'); rect(g, B.x + B.w - 7, 8, 1, B.y - 8, '#3a3a44');
  rect(g, B.x, B.y, B.w, B.h, '#1d1a22');
  for (let i = 0; i < B.w; i += 7) rect(g, B.x + i, B.y + B.h, 4, 1, '#1d1a22');
  dither(g, B.x, B.y, B.w, B.h, '#221e28', 4);
  const word = 'VOID', k = 2, tw = textWidth(word, k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2) + 1, B.y + 3, '#0b090e', k);
  text(g, word, B.x + Math.floor((B.w - tw) / 2), B.y + 2, BONE, k);
  // the side walls' flyers (a wide window shows them): whimsy on the walls, wholly off screen at 1440 wide
  flyer(g, -34, 30, 26, 34, '#c9b98a', ['DOOM', 'NIGHT', 'THU'], '#16130f');
  flyer(g, -31, 74, 22, 28, '#4a6a8a', ['OPEN', 'MIC'], '#e8e0cc');
  flyer(g, 366, 34, 26, 30, '#c9b98a', ['VOID', 'TUES'], '#16130f');
  flyer(g, 369, 74, 22, 34, '#6a8a5a', ['LOAD', 'IN', 'BACK'], '#e8e0cc');
  // the stage floor: boards running across, gaffer marks, the lamps' pools
  const F = PIX.floorY;
  rect(g, X0, F, W - 2 * X0, H - F - Y0, '#2a2019');
  for (let y = F; y < H - Y0; y += 5) {
    rect(g, X0, y, W - 2 * X0, 1, '#1e1712');
    for (let x = X0 + ((y * 7) % 31); x < W - X0; x += 31 + ((y * 3) % 17)) rect(g, x, y + 1, 1, 4, '#1e1712');
  }
  alpha(g, 0.18, () => { for (const x of lamps) if (lit(x)) oval(g, x, F + 14, 24, 6, LAMP); });
  rect(g, 40, F + 8, 6, 1, '#c9b98a'); rect(g, 330, F + 6, 1, 6, '#c9b98a');
  // the riser: its top edge and its carpeted front (the drummer's plate and the beat cards are screwed to it)
  const Rz = PIX.riser;
  rect(g, Rz.x - 2, Rz.y - 2, Rz.w + 4, 3, '#4a3c30'); rect(g, Rz.x - 2, Rz.y - 2, Rz.w + 4, 1, '#6a5644');
  rect(g, Rz.x, Rz.y + 1, Rz.w, Rz.h, '#1f1d22'); dither(g, Rz.x, Rz.y + 1, Rz.w, Rz.h, '#26232a');
  rect(g, Rz.x, Rz.y + Rz.h, Rz.w, 1, '#0e0c10');
  // the tape machine's road case, the door and its sign
  roadCase(g, PIX.tape.x - 1, 104, PIX.tape.w + 2, 35);
  door(g, PIX.door, view);
  const sw = signWidth('NO STAIRWAY') + 6, sx = Math.min(PIX.door.x + Math.floor((PIX.door.w - sw) / 2), W - 4 - sw);
  rect(g, sx, 43, sw, 10, '#e8e0cc'); rect(g, sx, 52, sw, 1, '#9a917e');
  rect(g, sx + 4, 40, 1, 3, '#77736c'); rect(g, sx + sw - 5, 40, 1, 3, '#77736c');
  sign(g, 'NO STAIRWAY', sx + 3, 45, '#16130f');
  // the stack's shadow on the floor under the cab, and the board's
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
  alpha(g, view.doorHover ? 0.8 : 0.5, () => { rect(g, D.x + 12, D.y + 12, 3, 2, LAMP); rect(g, D.x + 18, D.y + 12, 3, 2, LAMP); });
  // a sign on it: the shop, through here
  rect(g, D.x + 7, D.y + 30, D.w - 14, 8, '#c9b98a'); sign(g, 'SHOP', D.x + Math.floor((D.w - signWidth('SHOP')) / 2), D.y + 31, '#16130f');
  // the push bar and the light under the door
  rect(g, D.x + 3, D.y + 44, D.w - 6, 2, '#8a8a96'); rect(g, D.x + 3, D.y + 44, D.w - 6, 1, '#c4c4d0');
  alpha(g, view.doorHover ? 0.9 : 0.55, () => rect(g, D.x + 1, D.y + D.h - 1, D.w - 2, 1, LAMP));
  if (view.doorHover) alpha(g, 0.2, () => rect(g, D.x - 6, D.y + D.h, D.w + 12, 3, LAMP));
}

// The tape machine, on its own small canvas (TAPE; 0, 0 is its top-left): two reels, the tape between them, the bar
// counter and the input's lamps. s: { rolling, bar, input (0..1), hot (the camera or the sheet is on it), spin
// (radians), reduced }
export function drawTape(g, s = {}) {
  const w = TAPE.w;
  rect(g, 0, 0, w, 42, '#2b2723'); rect(g, 0, 0, w, 1, '#4a443c'); rect(g, 0, 41, w, 1, '#141210');
  for (const rx of [8, w - 9]) {
    const ry = 10;
    disc(g, rx, ry, 7, '#6e6a62'); disc(g, rx, ry, 6, '#3a2516'); ring(g, rx, ry, 6, '#8c8478');
    const a = s.rolling && !s.reduced ? s.spin || 0 : 0;
    for (let i = 0; i < 3; i++) {
      const t = a + (i * Math.PI * 2) / 3;
      line(g, rx + Math.round(Math.cos(t) * 2), ry + Math.round(Math.sin(t) * 2), rx + Math.round(Math.cos(t) * 5), ry + Math.round(Math.sin(t) * 5), '#8c8478');
    }
    disc(g, rx, ry, 1, '#cfc6b4');
  }
  line(g, 8, 17, 13, 22, '#3a2516'); line(g, w - 9, 17, w - 14, 22, '#3a2516');
  rect(g, 12, 21, w - 24, 3, '#cfc6b4');
  // the counter: the band's bar, in leader green while it rolls
  rect(g, 3, 26, w - 6, 7, '#0f1410');
  const bar = Number.isFinite(s.bar) ? `BAR ${Math.max(0, Math.min(999, s.bar))}` : 'BAR -';
  text(g, bar, Math.floor((w - textWidth(bar)) / 2), 27, s.rolling ? GREEN : GREEN_OFF);
  // the input's lamps, and the rolling lamp
  const n = Math.round(Math.max(0, Math.min(1, s.input || 0)) * 10);
  for (let i = 0; i < 10; i++) rect(g, 4 + i * 2, 35, 1, 2, i < n ? (i > 7 ? LAMP : GREEN) : '#2f3a26');
  rect(g, w - 6, 35, 2, 2, s.rolling ? GREEN : GREEN_OFF);
  if (s.hot) alpha(g, 0.6, () => { rect(g, 0, 0, w, 1, LAMP); rect(g, 0, 41, w, 1, LAMP); rect(g, 0, 0, 1, 42, LAMP); rect(g, w - 1, 0, 1, 42, LAMP); });
}

// The kit, on its own canvas (KIT): sticks crossed over the snare while they count, resting on the floor tom otherwise
export function drawKit(g, s = {}) {
  const P = { ...LOOK.metal }, cx0 = KIT.cx, base = KIT.base;
  const q = { kick: s.kick || 0, snare: s.snare || 0, hat: s.hat || 0, crash: s.crash || 0, tom: s.tom || 0, reduced: !!s.reduced, count: s.count ?? null };
  kit(g, cx0, base, P, q, { double: true, name: q.count != null ? '' : 'VOID' });
  const cx = cx0 - 24, cy = base - 40;
  if (q.count != null) {
    const tap = s.tap || 0, o = Math.round(tap * 2);
    line(g, cx - 10, cy - 8 + o, cx + 6, cy + 4, '#e8dcc0'); line(g, cx + 10, cy - 8 + o, cx - 6, cy + 4, '#e8dcc0');
    if (tap > 0.5) glow(g, cx, cy + 1, 4, '#fff2c0', tap * 0.8);
  } else {
    line(g, cx0 + 18, base - 22, cx0 + 30, base - 26, '#c9b98a');
    line(g, cx0 + 19, base - 21, cx0 + 31, base - 24, '#c9b98a');
  }
}
