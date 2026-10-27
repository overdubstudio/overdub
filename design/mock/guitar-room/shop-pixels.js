// The shop and the cab room, in pixels (docs/research/GUITAR-ROOM.md §2.9): a 256 x 144 guitar shop with a wall of
// amps, a glass counter of pedals, a rack of saved stacks and a door to the cab room; and the cab room behind it, a
// 4x12 with its grille off and a mic you move over a cone. Drawn the way the room's places are
// (app/src/ui/liveroom/pixels/): fillStyle, fillRect and globalAlpha at whole pixels, '#rrggbb' colours, no red pixel
// (red is the record light), amber lamps, a violet neon. The pedals in the counter wear their real enclosure colours
// (ui/faces.js colorsOf). Every thing you can look at is a hotspot: { kind, id, x, y, w, h } in scene pixels.

import { W, H, rect, px, disc, ring, line, glow, alpha, dither, text, textWidth, shade, mix } from '/app/src/ui/liveroom/pixels/paint.js';
import { WALL, COUNTER } from './data.js';

export { W, H };
const LAMP = '#ffc85a', LAMP_OFF = '#4a3a22', CREAM = '#e8dcc0', INK = '#16130f';

// each amp's sprite: its tolex, panel, grille, knob and logo colours, and its form
const A = (form, tolex, panel, grille, knob, logo, extra = {}) => ({ form, tolex, panel, grille, knob, logo, ...extra });
export const AMP_LOOKS = {
  'core.stack': A('stack', '#1b1b1d', '#e9e4d8', '#26262a', '#c4c4cc', '#4fb3a5', { trim: '#4fb3a5' }),
  'amp.metal': A('head', '#121214', '#1e1e22', '#1a1a1e', '#9a9aa4', '#c0c4ca'),
  'amp.recto': A('head', '#2a2d32', '#141518', '#1a1c20', '#c4c8ce', '#e8ebef', { trim: '#9aa0a8' }),
  'amp.slo': A('head', '#151517', '#b8bcc4', '#202024', '#16161a', '#e8ebef'),
  'amp.friedman': A('head', '#141416', '#1a1a1c', '#222226', '#c9a24a', '#c9a24a', { trim: '#c9a24a' }),
  'amp.lead': A('head', '#2a1f33', '#18141c', '#2b2631', '#b98cff', '#d6c4ff', { trim: '#9c7ad8' }),
  'amp.brown': A('head', '#4a3020', '#d6ad45', '#3b352a', '#20170a', '#efe9dc'),
  'amp.hiwatt': A('head', '#151517', '#1c1c1e', '#2a2a2e', '#c9cdd3', '#efece4', { plate: '#efece4' }),
  'amp.clean': A('combo', '#1e1e22', '#16161a', '#9a9ea6', '#d9d4c7', '#e8ebef', { trim: '#d9d4c7' }),
  'amp.jangle': A('combo', '#e6dcc0', '#b8723a', '#4a3322', '#2a160a', '#f0c08c'),
  'amp.crunch': A('combo', '#c8a869', '#c8cacd', '#4a2e22', '#2b1d10', '#fff6e0', { tweed: true }),
  'amp.jc': A('combo', '#1a1a1c', '#c3c6cb', '#161618', '#141416', '#e8ebef'),
  'amp.dumble': A('combo', '#151517', '#b9bcc1', '#5a4a3a', '#16161a', '#e8e0cc'),
  'amp.tiny': A('mini', '#f06aa8', '#7fe0c2', '#d8558f', '#10302a', '#ffffff'),
  'amp.radio': A('radio', '#6fc0b0', '#efe6cf', '#2a3a38', '#16130f', '#efe6cf'),
  'amp.plexi': A('stack', '#1f1e21', '#d6ad45', '#3b352a', '#20170a', '#efe9dc'),
  'amp.punk': A('combo2', '#e08a64', '#1e1c20', '#1d1a1f', '#e9e4d8', '#e9e4d8', { tape: true }),
  'amp.orange': A('stack', '#e0761c', '#efe6cf', '#6a5a40', '#16130f', '#16130f'),
  'amp.bassman': A('tall', '#c8a869', '#c8cacd', '#5a4a36', '#2b1d10', '#fff6e0', { tweed: true }),
  'amp.tape': A('tape', '#2b2723', '#8c8478', '#100e0c', '#cfc6b4', '#d8ccae'),
  'amp.bit': A('bit', '#c8c8c0', '#8b9a5b', '#3a3a40', '#5a2a6a', '#3a3a40'),
};

/* ------------------------------------------------------------------------------------------------ the layout */
const COLS = 7, X0 = 8, PITCH = 22, AW = 20;
const ROW = [{ y: 24, h: 12 }, { y: 44, h: 24 }, { y: 75, h: 37 }];
const SHELF = [37, 69];
export const DOOR = { x: 166, y: 44, w: 32, h: 68 };
export const RACK = { x: 206, y: 24, w: 46, h: 88 };
const COUNTER_Y = 116, PED = { w: 10, h: 9, pitch: 13, x0: 15 };

export function hotspots(stacks) {
  const out = [];
  WALL.forEach((row, r) => row.forEach((id, c) => {
    const look = AMP_LOOKS[id] || AMP_LOOKS['amp.clean'];
    const { w, h } = spriteSize(look.form, ROW[r].h);
    const x = X0 + c * PITCH + Math.floor((AW - w) / 2), y = ROW[r].y + ROW[r].h - h;
    out.push({ kind: 'amp', id, x, y, w, h, row: r, col: c });
  }));
  COUNTER.forEach((row, r) => row.forEach((id, c) => out.push({ kind: 'pedal', id, x: PED.x0 + c * PED.pitch, y: COUNTER_Y + 3 + r * 11, w: PED.w, h: PED.h, row: 3 + r, col: c })));
  // nine slots: the house's stacks, then yours (yours win the slots when the rack is full)
  const mine = stacks.filter((s) => s.by).slice(-9), list = [...stacks.filter((s) => !s.by).slice(0, 9 - mine.length), ...mine];
  list.forEach((s, i) => out.push({ kind: 'stack', id: s.id, x: RACK.x + 3, y: RACK.y + 3 + i * 9, w: RACK.w - 6, h: 9, row: i, col: 9 }));
  out.push({ kind: 'door', id: 'door', x: DOOR.x, y: DOOR.y, w: DOOR.w, h: DOOR.h, row: 1, col: 8 });
  return out;
}
function spriteSize(form, rowH) {
  if (form === 'head') return { w: AW, h: rowH };
  if (form === 'mini') return { w: 14, h: 16 };
  if (form === 'radio') return { w: 18, h: 12 };
  if (form === 'tape') return { w: 20, h: 14 };
  if (form === 'bit') return { w: 12, h: 18 };
  return { w: AW, h: rowH };
}

/* ------------------------------------------------------------------------------------------------ the sprites */
function knobs(g, x, y, n, c, gap = 3) { for (let i = 0; i < n; i++) px(g, x + i * gap, y, c); }
function jewel(g, x, y, on) { px(g, x, y, on ? LAMP : LAMP_OFF); if (on) glow(g, x, y, 3, LAMP, 0.6); }
function grilleLines(g, x, y, w, h, c) { alpha(g, 0.35, () => { for (let j = 1; j < h; j += 2) rect(g, x, y + j, w, 1, c); }); }
function tweed(g, x, y, w, h) { alpha(g, 0.35, () => { for (let j = 0; j < h; j++) for (let i = (j % 2); i < w; i += 2) px(g, x + i, y + j, '#9c7b43'); }); }

function head(g, x, y, w, h, L, lit) {
  rect(g, x, y, w, h, L.tolex); rect(g, x, y, w, 1, shade(L.tolex, 0.25)); rect(g, x, y + h - 1, w, 1, shade(L.tolex, -0.4));
  if (L.trim) { rect(g, x, y + 1, 1, h - 2, L.trim); rect(g, x + w - 1, y + 1, 1, h - 2, L.trim); }
  rect(g, x + 2, y + 2, w - 4, Math.max(3, Math.floor(h / 2) - 1), L.grille);
  rect(g, x + Math.floor(w / 2) - 3, y + 3, 6, 1, L.logo);
  const py = y + h - 5;
  rect(g, x + 2, py, w - 4, 3, L.plate || L.panel);
  knobs(g, x + 3, py + 1, Math.floor((w - 8) / 3), L.knob);
  jewel(g, x + w - 4, py + 1, lit);
}
function cabinet(g, x, y, w, h, L, cones = 4) {
  rect(g, x, y, w, h, L.tolex); rect(g, x, y, w, 1, shade(L.tolex, 0.25)); rect(g, x, y + h - 1, w, 1, shade(L.tolex, -0.4));
  rect(g, x + 2, y + 2, w - 4, h - 4, L.grille);
  if (L.tweed) tweed(g, x, y, w, 2);
  const cx = [x + Math.floor(w / 4) + 1, x + w - Math.floor(w / 4) - 1];
  const rows = cones >= 4 ? [y + Math.floor(h / 4) + 1, y + h - Math.floor(h / 4) - 1] : [y + Math.floor(h / 2)];
  for (const yy of rows) for (const xx of cx) { disc(g, xx, yy, Math.min(4, Math.floor(h / 6)), shade(L.grille, -0.5)); px(g, xx, yy, shade(L.grille, 0.3)); }
  grilleLines(g, x + 2, y + 2, w - 4, h - 4, shade(L.grille, 0.25));
}
function combo(g, x, y, w, h, L, lit, cones = 1) {
  rect(g, x, y, w, h, L.tolex); rect(g, x, y, w, 1, shade(L.tolex, 0.25)); rect(g, x, y + h - 1, w, 1, shade(L.tolex, -0.4));
  if (L.tweed) tweed(g, x, y, w, h);
  if (L.trim) { rect(g, x + 1, y + 6, w - 2, 1, L.trim); }
  rect(g, x + 2, y + 2, w - 4, 3, L.panel);
  knobs(g, x + 3, y + 3, Math.floor((w - 8) / 3), L.knob);
  jewel(g, x + w - 4, y + 3, lit);
  const gy = y + 7, gh = h - 9;
  rect(g, x + 2, gy, w - 4, gh, L.grille);
  if (cones === 2) { for (const xx of [x + 6, x + w - 7]) { disc(g, xx, gy + Math.floor(gh / 2), 3, shade(L.grille, -0.45)); px(g, xx, gy + Math.floor(gh / 2), shade(L.grille, 0.3)); } }
  else { disc(g, x + Math.floor(w / 2), gy + Math.floor(gh / 2), Math.min(6, Math.floor(gh / 2) - 1), shade(L.grille, -0.45)); px(g, x + Math.floor(w / 2), gy + Math.floor(gh / 2), shade(L.grille, 0.3)); }
  grilleLines(g, x + 2, gy, w - 4, gh, shade(L.grille, 0.3));
  rect(g, x + Math.floor(w / 2) - 3, y + h - 3, 6, 1, L.logo);
  if (L.tape) { rect(g, x + 4, y + h - 5, 12, 2, '#d8d2c0'); }
}
function sprite(g, s, L, lit) {
  const { x, y, w, h } = s;
  rect(g, x, y + h, w, 1, '#0c0b09');
  switch (L.form) {
    case 'head': head(g, x, y, w, h, L, lit); break;
    case 'stack': { const hh = 10; head(g, x, y, w, hh, L, lit); cabinet(g, x, y + hh, w, h - hh, L, 4); break; }
    case 'tall': combo(g, x, y, w, h, L, lit, 2); break;
    case 'combo2': combo(g, x, y, w, h, L, lit, 2); break;
    case 'combo': combo(g, x, y, w, h, L, lit, 1); break;
    case 'mini': combo(g, x, y, w, h, L, lit, 1); break;
    case 'radio': {
      rect(g, x, y + 2, w, h - 2, L.tolex); rect(g, x, y + 2, w, 1, shade(L.tolex, 0.3));
      line(g, x + 3, y + 2, x + 8, y - 2, '#9a9ea6');
      for (let j = y + 4; j < y + h - 2; j += 2) for (let i = x + 2; i < x + 9; i += 2) px(g, i, j, L.grille);
      rect(g, x + 11, y + 4, 5, 3, L.panel); px(g, x + 13, y + 5, INK); disc(g, x + 13, y + 9, 1, L.panel);
      break;
    }
    case 'tape': {
      rect(g, x, y, w, h, L.tolex); rect(g, x, y, w, 1, shade(L.tolex, 0.25));
      rect(g, x + 2, y + 2, 12, 6, '#100e0c'); rect(g, x + 3, y + 3, 10, 4, L.panel); disc(g, x + 5, y + 5, 1, '#4a2f1c'); disc(g, x + 11, y + 5, 1, '#4a2f1c');
      for (let i = 0; i < 4; i++) rect(g, x + 2 + i * 3, y + 10, 2, 3, '#9a8f7c');
      px(g, x + 16, y + 3, lit ? LAMP : LAMP_OFF); rect(g, x + 15, y + 6, 3, 6, '#46413a');
      break;
    }
    case 'bit': {
      rect(g, x, y, w, h, L.tolex); rect(g, x, y, w, 1, '#e4e4dc'); rect(g, x + w - 1, y, 1, h, '#9a9a92');
      rect(g, x + 2, y + 2, w - 4, 7, '#3a3a40'); rect(g, x + 3, y + 3, w - 6, 5, L.panel);
      rect(g, x + 2, y + 12, 3, 1, '#3a3a40'); rect(g, x + 3, y + 11, 1, 3, '#3a3a40');
      px(g, x + 8, y + 11, L.knob); px(g, x + 9, y + 13, L.knob);
      for (let i = 0; i < 3; i++) px(g, x + 6 + i, y + 16, '#9a9a92');
      break;
    }
    default: combo(g, x, y, w, h, L, lit);
  }
}

// a pedal in the counter: its enclosure colour, two knobs, an LED (amber: no red pixel), a footswitch
function pedal(g, s, color, lit) {
  const { x, y, w, h } = s;
  rect(g, x, y, w, h, color); rect(g, x, y, w, 1, shade(color, 0.3)); rect(g, x, y + h - 1, w, 1, shade(color, -0.35));
  const k = lum(color) > 0.5 ? '#16130f' : '#e8e0cc';
  px(g, x + 2, y + 2, k); px(g, x + w - 3, y + 2, k);
  px(g, x + Math.floor(w / 2), y + 1, lit ? LAMP : shade(color, -0.4));
  rect(g, x + Math.floor(w / 2) - 1, y + h - 3, 2, 2, '#c9cdd3');
}
const lum = (c) => { const n = parseInt(c.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

/* ------------------------------------------------------------------------------------------------ the shop */
// view: { inChain: Set of device ids in your stack, loaded: stack id, colors: { [pedal id]: '#rrggbb' }, stacks,
//         level (0..1, your input: the amp you're playing through glows), reduced }
export function drawShop(g, view) {
  const v = view || {};
  g.globalAlpha = 1;
  // the ceiling and its track lights
  rect(g, 0, 0, W, 10, '#141217'); rect(g, 0, 8, W, 1, '#2a2630');
  // the wall: slatwall
  rect(g, 0, 10, W, 102, '#3b342c');
  for (let y = 12; y < 112; y += 5) { rect(g, 0, y, W, 1, '#2c2620'); rect(g, 0, y + 1, W, 1, '#463e34'); }
  // the floor: old carpet
  rect(g, 0, 112, W, 32, '#2a2630'); dither(g, 0, 112, W, 32, '#332e3a', 4);
  // the neon over the amps: AMPS, violet
  const nm = 'AMPS', nk = 2, nw = textWidth(nm, nk), nx = 84 - Math.floor(nw / 2);
  rect(g, nx - 4, 11, nw + 8, 13, '#1f1a22');
  glow(g, 84, 17, 20, '#d070ff', 0.2);
  text(g, nm, nx, 13, '#f0b0ff', nk);
  // shelves for the top two rows, with brackets
  for (const sy of SHELF) {
    rect(g, X0 - 3, sy, COLS * PITCH + 2, 2, '#6b4a2b'); rect(g, X0 - 3, sy, COLS * PITCH + 2, 1, '#8a6a42');
    for (let i = 0; i <= COLS; i += 2) rect(g, X0 - 2 + i * PITCH - 1, sy + 2, 1, 3, '#2a241e');
  }
  // the amps
  for (const s of hotspots(v.stacks || [])) if (s.kind === 'amp') {
    const L = AMP_LOOKS[s.id] || AMP_LOOKS['amp.clean'];
    sprite(g, s, L, v.inChain?.has(s.id));
    if (v.inChain?.has(s.id) && (v.level || 0) > 0.05 && !v.reduced) glow(g, s.x + s.w - 4, s.y + 4, 5, LAMP, v.level * 0.6);
  }
  // the sign over the door, the door to the cab room and its window
  rect(g, 165, 14, 35, 13, CREAM); rect(g, 165, 26, 35, 1, '#b8ab90'); px(g, 182, 13, '#9a9ea6');
  text(g, 'NO', 182 - 3, 15, INK); text(g, 'STAIRWAY', 167, 21, INK);
  rect(g, DOOR.x - 2, 32, DOOR.w + 4, 9, '#1f1a16'); text(g, 'CAB ROOM', DOOR.x + 1, 34, LAMP);
  rect(g, DOOR.x - 2, DOOR.y - 2, DOOR.w + 4, DOOR.h + 2, '#2a241e');
  rect(g, DOOR.x, DOOR.y, DOOR.w, DOOR.h, '#4e4034'); rect(g, DOOR.x, DOOR.y, DOOR.w, 1, '#6a5848');
  for (let j = DOOR.y + 4; j < DOOR.y + DOOR.h; j += 6) rect(g, DOOR.x + 2, j, DOOR.w - 4, 1, '#463a2e');
  // its window: the cab and a mic in there, in the room's blue-grey light
  rect(g, DOOR.x + 8, DOOR.y + 8, 16, 14, '#1f1a16'); rect(g, DOOR.x + 9, DOOR.y + 9, 14, 12, '#2a3442');
  rect(g, DOOR.x + 10, DOOR.y + 13, 8, 8, '#16161a'); disc(g, DOOR.x + 14, DOOR.y + 17, 2, '#0a0a0c');
  line(g, DOOR.x + 21, DOOR.y + 20, DOOR.x + 19, DOOR.y + 15, '#9a9ea6'); px(g, DOOR.x + 18, DOOR.y + 14, '#c9cdd3');
  rect(g, DOOR.x + 26, DOOR.y + 34, 2, 6, '#c9b98a');
  // the rack of saved stacks
  rect(g, RACK.x - 2, 12, RACK.w + 4, 9, '#1f1a16'); text(g, 'THE RACK', RACK.x + Math.floor((RACK.w - textWidth('THE RACK')) / 2), 14, CREAM);
  rect(g, RACK.x, RACK.y, RACK.w, RACK.h, '#141416'); rect(g, RACK.x, RACK.y, 2, RACK.h, '#3a3a40'); rect(g, RACK.x + RACK.w - 2, RACK.y, 2, RACK.h, '#3a3a40');
  for (let j = RACK.y + 2; j < RACK.y + RACK.h; j += 3) { px(g, RACK.x, j, '#8a8e96'); px(g, RACK.x + RACK.w - 1, j, '#8a8e96'); }
  for (const s of hotspots(v.stacks || [])) if (s.kind === 'stack') {
    const st = (v.stacks || []).find((x) => x.id === s.id), mine = st?.by === 'you';
    const face = mine ? '#3a3a42' : '#26262c';
    rect(g, s.x, s.y, s.w, s.h - 1, face); rect(g, s.x, s.y, s.w, 1, shade(face, 0.3));
    px(g, s.x + 1, s.y + 4, '#9a9ea6'); px(g, s.x + s.w - 2, s.y + 4, '#9a9ea6');
    const label = (st?.tag || st?.name || '').toUpperCase().slice(0, 7);
    rect(g, s.x + 3, s.y + 1, textWidth(label) + 4, 7, CREAM);
    text(g, label, s.x + 5, s.y + 2, INK);
    const on = v.loaded === s.id;
    px(g, s.x + s.w - 4, s.y + 4, on ? LAMP : LAMP_OFF);
    if (on) glow(g, s.x + s.w - 4, s.y + 4, 3, LAMP, 0.7);
  }
  // track lights and their light on the wall
  for (const x of [30, 84, 138, 182, 228]) {
    rect(g, x - 3, 4, 7, 5, '#24222a'); rect(g, x - 2, 8, 5, 1, LAMP);
    alpha(g, 0.05, () => { g.fillStyle = '#ffe2a0'; for (let y = 9; y < 112; y += 2) { const half = 3 + Math.round((y - 9) * 0.16); g.fillRect(x - half, y, half * 2 + 1, 2); } });
  }
  // the counter: a wood top, a glass case of pedals, a bell
  const cx0 = 11, cw = 14 * PED.pitch + 8;
  rect(g, cx0, COUNTER_Y - 3, cw, 3, '#7a5a3a'); rect(g, cx0, COUNTER_Y - 3, cw, 1, '#9a7a52');
  rect(g, cx0, COUNTER_Y, cw, 25, '#1b2428'); rect(g, cx0, COUNTER_Y, 2, 25, '#5a4028'); rect(g, cx0 + cw - 2, COUNTER_Y, 2, 25, '#5a4028');
  rect(g, cx0 + 2, COUNTER_Y + 13, cw - 4, 1, '#3a4a50');
  for (const s of hotspots(v.stacks || [])) if (s.kind === 'pedal') pedal(g, s, v.colors?.[s.id] || '#5a5a62', v.inChain?.has(s.id));
  alpha(g, 0.12, () => { for (let i = 0; i < cw; i += 9) line(g, cx0 + i, COUNTER_Y + 1, cx0 + i + 6, COUNTER_Y + 7, '#e8f4ff'); });
  rect(g, cx0, COUNTER_Y + 25, cw, 3, '#3a2a1c');
  // the bell
  rect(g, 150, COUNTER_Y - 5, 7, 2, '#c9b98a'); rect(g, 151, COUNTER_Y - 6, 5, 1, '#e8dcb0'); px(g, 153, COUNTER_Y - 7, '#9a9ea6');
  // a tag on the counter's corner: PEDALS
  rect(g, 196, COUNTER_Y + 2, 25, 8, CREAM); text(g, 'PEDALS', 197, COUNTER_Y + 4, INK);
  g.globalAlpha = 1;
}

/* ------------------------------------------------------------------------------------------------ the cab room */
// The 4x12 with its grille off, its four cones, the mic (front view) where you've put it and its heat halo, a side
// view of how far it stands off, and the mics on the wall to pick from.
export const CAB = { x: 26, y: 18, w: 132, h: 112 };
export const CONES = [[59, 46], [125, 46], [59, 102], [125, 102]].map(([x, y]) => ({ x, y, r: 24 }));
export const SIDE = { x: 176, y: 66, w: 72, h: 58 };
export const MICS = ['dyn', 'ribbon', 'cond', 'crystal'];
export const MIC_SPOTS = MICS.map((id, i) => ({ kind: 'mic', id, x: 178 + i * 18, y: 18, w: 14, h: 30 }));

function micFront(g, x, y, id, big = 1) {
  if (id === 'ribbon') { rect(g, x - 4, y - 6, 9, 13, '#c9cdd3'); rect(g, x - 3, y - 5, 7, 11, '#5a5e66'); for (let j = -4; j < 6; j += 2) rect(g, x - 3, y + j, 7, 1, '#8a8e96'); return; }
  if (id === 'cond') { rect(g, x - 3, y - 7, 7, 15, '#d8c48a'); rect(g, x - 2, y - 6, 5, 6, '#3a3a40'); dither(g, x - 2, y - 6, 5, 6, '#8a8e96'); return; }
  if (id === 'crystal') { disc(g, x, y, 4, '#9a9ea6'); disc(g, x, y, 3, '#5a5e66'); for (let i = -2; i <= 2; i += 2) rect(g, x - 2, y + i, 5, 1, '#c9cdd3'); return; }
  disc(g, x, y, 4 * big, '#2a2a2e'); disc(g, x, y, 3 * big, '#4a4a52'); dither(g, x - 2, y - 2, 5, 5, '#8a8e96');
}
function micHanging(g, s) {
  line(g, s.x + 7, s.y, s.x + 7, s.y + 4, '#5a5e66');
  const cx = s.x + 7;
  if (s.id === 'dyn') { rect(g, cx - 2, s.y + 5, 5, 6, '#4a4a52'); dither(g, cx - 2, s.y + 5, 5, 6, '#8a8e96'); rect(g, cx - 1, s.y + 11, 3, 14, '#1e1e22'); rect(g, cx - 1, s.y + 22, 3, 1, '#9a9ea6'); }
  if (s.id === 'ribbon') { rect(g, cx - 5, s.y + 5, 11, 14, '#c9cdd3'); rect(g, cx - 4, s.y + 6, 9, 12, '#5a5e66'); for (let j = 7; j < 18; j += 2) rect(g, cx - 4, s.y + j, 9, 1, '#8a8e96'); rect(g, cx - 1, s.y + 19, 3, 6, '#c9cdd3'); }
  if (s.id === 'cond') { rect(g, cx - 3, s.y + 5, 7, 20, '#d8c48a'); rect(g, cx - 2, s.y + 6, 5, 7, '#3a3a40'); dither(g, cx - 2, s.y + 6, 5, 7, '#8a8e96'); rect(g, cx - 3, s.y + 16, 7, 1, '#a8945a'); }
  if (s.id === 'crystal') { disc(g, cx, s.y + 9, 4, '#9a9ea6'); disc(g, cx, s.y + 9, 3, '#5a5e66'); rect(g, cx - 1, s.y + 13, 3, 10, '#7a6a52'); }
}
// view: { mic: { id, x, y, dist (inches) }, cone (0..3), reduced }
export function drawCabRoom(g, view) {
  const v = view || {}, m = v.mic || { id: 'dyn', x: 59 + 8, y: 46, dist: 1 };
  g.globalAlpha = 1;
  // acoustic foam: wedges
  rect(g, 0, 0, W, 130, '#26282c');
  for (let y = 0; y < 130; y += 8) for (let x = ((y / 8) % 2) * 4; x < W; x += 8) { rect(g, x, y, 4, 8, '#2e3035'); rect(g, x, y, 4, 1, '#3a3d42'); }
  rect(g, 0, 130, W, 14, '#1d1b17'); rect(g, 0, 130, W, 1, '#5a5246');
  // the cab, grille off: the baffle, the cones, their screws
  rect(g, CAB.x - 4, CAB.y - 4, CAB.w + 8, CAB.h + 8, '#141416'); rect(g, CAB.x - 4, CAB.y - 4, CAB.w + 8, 1, '#3a3a40');
  for (const [cx, cy] of [[CAB.x - 4, CAB.y - 4], [CAB.x + CAB.w - 1, CAB.y - 4], [CAB.x - 4, CAB.y + CAB.h - 1], [CAB.x + CAB.w - 1, CAB.y + CAB.h - 1]]) rect(g, cx, cy, 5, 5, '#c9cdd3');
  rect(g, CAB.x, CAB.y, CAB.w, CAB.h, '#0b0b0d');
  CONES.forEach((c, i) => {
    for (let q = 0; q < 4; q++) { const a = Math.PI / 4 + (q * Math.PI) / 2; px(g, c.x + Math.round(Math.cos(a) * (c.r + 3)), c.y + Math.round(Math.sin(a) * (c.r + 3)), '#8b8f96'); }
    disc(g, c.x, c.y, c.r + 1, '#1a1a1c'); disc(g, c.x, c.y, c.r, '#2a2826'); ring(g, c.x, c.y, c.r - 2, '#34312e');
    ring(g, c.x, c.y, Math.round(c.r * 0.7), '#302d2a'); disc(g, c.x, c.y, Math.round(c.r * 0.3), '#3e3a36'); ring(g, c.x, c.y, Math.round(c.r * 0.3), '#4a4642');
    if (i === (v.cone ?? 0)) {
      // the heat: bright at the cap, darker toward the edge
      glow(g, c.x, c.y, Math.round(c.r * 0.9), '#ffc85a', 0.22);
    }
  });
  // the stand and the mic in front of the cone, pointing in
  line(g, m.x + 2, m.y + 4, m.x + 14, m.y + 40, '#5a5e66'); line(g, m.x + 3, m.y + 4, m.x + 15, m.y + 40, '#3a3d42');
  micFront(g, m.x, m.y, m.id);
  // the side view: the cab's edge, the cone's depth, the mic stood off by its distance
  const S = SIDE;
  rect(g, S.x, S.y - 10, S.w, S.h + 10, '#1d1f23'); rect(g, S.x, S.y - 10, S.w, 1, '#3a3d42');
  text(g, 'SIDE', S.x + 3, S.y - 8, '#9a8f7c');
  rect(g, S.x + 4, S.y + 4, 6, S.h - 8, '#141416'); rect(g, S.x + 10, S.y + 18, 3, 22, '#2a2826');
  const d = Math.max(0.5, Math.min(24, m.dist || 1)), dx = Math.round(14 + (Math.log(d / 0.5) / Math.log(48)) * (S.w - 30));
  line(g, S.x + dx + 6, S.y + 29, S.x + dx + 16, S.y + S.h - 4, '#5a5e66');
  rect(g, S.x + dx, S.y + 27, 10, 4, '#2a2a2e'); rect(g, S.x + dx, S.y + 27, 3, 4, '#8a8e96');
  for (let i = 13; i < dx; i += 3) px(g, S.x + i, S.y + 29, '#ffc85a');
  // the mics on the wall
  rect(g, 174, 12, 76, 40, '#1d1f23'); rect(g, 174, 12, 76, 1, '#3a3d42'); rect(g, 176, 16, 72, 1, '#5a5e66');
  for (const s of MIC_SPOTS) micHanging(g, s);
}
// where a mic is on a cone, in words (Claw'd-o-Matic's cabWhere), and how far that is from the cap (0 centre, 1 edge)
export function micWhere(mic) {
  let best = null;
  for (const [i, c] of CONES.entries()) { const r = Math.hypot(mic.x - c.x, mic.y - c.y) / c.r; if (!best || r < best.r) best = { i, r }; }
  const r = best.r;
  const words = r < 0.12 ? 'dead centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'on the cone' : r <= 1.04 ? 'cone edge' : 'off the cone';
  return { cone: best.i, r, words };
}
export const inches = (d) => (d < 1 ? d.toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '"';
