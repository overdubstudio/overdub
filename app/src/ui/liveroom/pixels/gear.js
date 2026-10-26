// The gear [ui; stream E] (docs/research/LIVE-ROOM-MODE.md §3.19): the amps, the kit, the bass rigs, the tape
// machines and the console ledge, each drawn at a position the place gives it, from the scene's signals (./scenes.js
// signalsOf). The band is the gear, and the gear moves only with a signal: a cone pushes with its own level, a kick
// head pumps on the kick, a reel turns while the tape rolls. Under reduced motion nothing changes shape or place; the
// lamps still light with their levels.
//
//   stack(g, x, y, P, amp)       a head on two 4x12s (58 x 89). amp: { level, on, reduced }
//   combo(g, x, y, w, h, P, amp) a combo, its pilot lamp and its cone
//   dustCover(g, x, y, w, h)     the cloth over the second amp until the first double
//   bassRig(g, x, y, w, h, P, rig, kind)   'fridge' (a head on eight small speakers) or 'combo'. rig: { level, lamp,
//                                reduced }; lamp 0..1, how warm its light is
//   kit(g, cx, base, P, s, { double, name })   the kit, its name on the front kick head (the count while it counts,
//                                how much of the kit is in while it loads)
//   cassette(g, x, y, s, look)   a cassette machine, its two reels turning while the tape rolls
//   reels(g, x, y, s)            the reel-to-reel on the console ledge
//   laptop(g, x, y, s)           the kitchen's laptop: the counter (or the count) and the input's level on its screen
//   crate(g, x, y, w, h, c)      a milk crate
//   ledge(g, s, { reels })       the console ledge along the bottom: the talkback lamp, the tape counter in green, two
//                                VU needles on the master
//   LEDGE_PARTS                  where the ledge's lights are, for the checks

import { W, H, rect, px, disc, oval, ring, line, glow, alpha, shade, text, textWidth, clamp01 } from './paint.js';

const LAMP = '#ffc85a', LAMP_HI = '#ffe2a0', LAMP_OFF = '#4a3a22', GREEN = '#d9f36a', GREEN_OFF = '#4a5228', INK = '#16130f';

// an amp's panel meter: eight lamps, moss to amber (the top is amber, never red)
function panelMeter(g, x, y, level) {
  const n = Math.round(level * 8);
  for (let i = 0; i < 8; i++) rect(g, x + i * 2, y, 1, 1, i < n ? (i < 6 ? '#a8c470' : LAMP) : '#2a2a24');
}
function jewel(g, x, y, on, level) {
  rect(g, x, y, 3, 3, on ? LAMP : LAMP_OFF);
  if (on) { px(g, x, y, LAMP_HI); glow(g, x + 1, y + 1, 4, LAMP, 0.4 + level * 0.6); }
}

/* ------------------------------------------------------------------------------------------------ amps */
export function stack(g, x, y, P, amp) {
  const { level = 0, on = false, reduced = false } = amp || {};
  rect(g, x - 1, y + 89, 60, 2, '#08070a');
  // the head
  rect(g, x + 2, y, 54, 14, P.tolex); rect(g, x + 2, y, 54, 1, P.tolexHi); rect(g, x + 2, y + 13, 54, 1, P.tolexLo);
  rect(g, x + 5, y + 3, 48, 8, P.panel);
  for (let i = 0; i < 6; i++) { rect(g, x + 8 + i * 5, y + 4, 2, 2, P.knob); px(g, x + 8 + i * 5, y + 4, shade(P.knob, 0.4)); }
  panelMeter(g, x + 8, y + 8, on ? level : 0);
  jewel(g, x + 48, y + 5, on, level);
  rect(g, x + 25, y + 1, 8, 1, P.badge);
  // two cabinets
  const push = reduced ? 0 : Math.round(level * 1.6);
  for (const cy0 of [y + 15, y + 52]) {
    rect(g, x, cy0, 58, 37, P.tolex); rect(g, x, cy0, 58, 1, P.tolexHi); rect(g, x, cy0 + 36, 58, 1, P.tolexLo);
    rect(g, x + 3, cy0 + 3, 52, 31, P.grille);
    for (const [dx, dy] of [[16, 10], [42, 10], [16, 26], [42, 26]]) {
      disc(g, x + dx, cy0 + dy, 6 + (push > 1 ? 1 : 0), P.cone);
      disc(g, x + dx, cy0 + dy, 2 + (push > 0 ? 1 : 0), P.cap);
    }
    alpha(g, 0.35, () => { for (let j = 4; j < 34; j += 3) rect(g, x + 3, cy0 + j, 52, 1, P.grilleHi); });
  }
}
export function combo(g, x, y, w, h, P, amp) {
  const { level = 0, on = false, reduced = false } = amp || {};
  rect(g, x, y + h, w, 2, '#0c0b09');
  rect(g, x, y, w, h, P.tolex);
  rect(g, x, y, w, 1, P.tolexHi); rect(g, x, y, 1, h, P.tolexHi);
  rect(g, x + w - 1, y, 1, h, P.tolexLo); rect(g, x, y + h - 1, w, 1, P.tolexLo);
  rect(g, x + 2, y + 2, w - 4, 6, P.panel);
  const knobs = Math.max(2, Math.floor((w - 16) / 5));
  for (let i = 0; i < knobs; i++) rect(g, x + 4 + i * 5, y + 3, 2, 2, P.knob);
  if (w >= 34) panelMeter(g, x + 4, y + 6, on ? level : 0);
  jewel(g, x + w - 7, y + 3, on, level);
  const gx = x + 3, gy = y + 10, gw = w - 6, gh = h - 13;
  rect(g, gx, gy, gw, gh, P.grille);
  const cx = gx + gw / 2, cy = gy + gh / 2, r = Math.min(gw, gh) / 2 - 2, push = reduced ? 0 : Math.round(level * 1.8);
  disc(g, cx, cy, Math.round(r) + (push > 1 ? 1 : 0), P.cone);
  disc(g, cx, cy, Math.round(r * 0.55), shade(P.cone, 0.12));
  disc(g, cx, cy, Math.max(2, Math.round(r * 0.22) + (push > 0 ? 1 : 0)), P.cap);
  alpha(g, 0.35, () => { for (let j = 1; j < gh; j += 3) rect(g, gx, gy + j, gw, 1, P.grilleHi); });
  rect(g, x + w / 2 - 5, y + h - 4, 10, 2, P.badge);
}
// a cloth over an amp: folds down it, a hem a little wider than the amp, a strip of gaffer tape on it
export function dustCover(g, x, y, w, h) {
  const c = '#6a6252', lo = '#4e4839', hi = '#857c69';
  rect(g, x - 1, y + 1, w + 2, h + 1, c);
  rect(g, x + 1, y - 1, w - 2, 2, c); rect(g, x + 2, y - 1, w - 4, 1, hi);
  for (let i = 5; i < w - 2; i += 7) { rect(g, x + i, y + 3, 1, h - 2, lo); rect(g, x + i + 1, y + 6, 1, h - 6, hi); }
  for (let i = -1; i < w + 1; i += 2) px(g, x + i, y + h + 1, lo);
  rect(g, x + w / 2 - 7, y + 10, 14, 4, '#9a917c'); rect(g, x + w / 2 - 7, y + 10, 14, 1, '#b3a991');
}

/* ------------------------------------------------------------------------------------------------ the bass rig */
export function bassRig(g, x, y, w, h, P, rig, kind) {
  const { level = 0, lamp = 0, reduced = false } = rig || {};
  rect(g, x - 1, y + h, w + 2, 2, '#0c0b09');
  const lit = (lx, ly) => {
    rect(g, lx, ly, 2, 2, lamp > 0.05 ? LAMP : LAMP_OFF);
    if (lamp > 0.05) glow(g, lx + 1, ly + 1, 4, LAMP, lamp);
  };
  if (kind === 'fridge') {
    rect(g, x + 2, y - 10, w - 4, 9, P.tolex); rect(g, x + 2, y - 10, w - 4, 1, P.tolexHi); rect(g, x + 4, y - 8, w - 8, 4, P.panel);
    for (let i = 0; i < 3; i++) rect(g, x + 6 + i * 4, y - 7, 2, 2, P.knob);
    lit(x + w - 9, y - 7);
  }
  rect(g, x, y, w, h, P.tolex); rect(g, x, y, w, 1, P.tolexHi); rect(g, x + w - 1, y, 1, h, P.tolexLo);
  rect(g, x + 3, y + 3, w - 6, h - 6, P.grille);
  const push = reduced ? 0 : Math.round(level * 2);
  if (kind === 'fridge') {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) {
      const cx = x + 3 + ((w - 6) * (col * 2 + 1)) / 4, cy = y + 3 + ((h - 6) * (row * 2 + 1)) / 8;
      disc(g, cx, cy, 4 + (push > 1 ? 1 : 0), P.cone); disc(g, cx, cy, 1 + (push > 0 ? 1 : 0), P.cap);
    }
  } else {
    rect(g, x + 4, y + 4, w - 8, 3, P.panel);
    lit(x + w - 8, y + 4);
    const r = Math.min(w, h) / 2 - 5;
    disc(g, x + w / 2, y + h / 2 + 2, Math.round(r) + (push > 1 ? 1 : 0), P.cone);
    disc(g, x + w / 2, y + h / 2 + 2, Math.round(r * 0.3) + (push > 0 ? 1 : 0), P.cap);
  }
  alpha(g, 0.3, () => { for (let j = 4; j < h - 4; j += 3) rect(g, x + 3, y + j, w - 6, 1, P.grilleHi); });
}

/* ------------------------------------------------------------------------------------------------ the kit */
const CYM = '#c9b98a', CYM_HI = '#f4e6b0', STAND = '#77736c';
export function kit(g, cx, base, P, s, { double = false, name = '' } = {}) {
  const still = s.reduced;
  const k = still ? 0 : s.kick, sn = still ? 0 : s.snare, hh = still ? 0 : s.hat, cr = still ? 0 : s.crash, tm = still ? 0 : s.tom;
  rect(g, cx - 36, base - 30, 1, 30, STAND); rect(g, cx - 22, base - 40, 1, 40, STAND); rect(g, cx + 30, base - 34, 1, 34, STAND);
  // the crash tips on a hit
  const tilt = Math.round(cr * 2);
  oval(g, cx - 22, base - 42 + tilt, 12, 2, CYM); rect(g, cx - 32, base - 43 + tilt, 20, 1, CYM_HI);
  if (cr > 0.05) glow(g, cx - 22, base - 42, 10, '#fff2c0', cr * 0.6);
  oval(g, cx + 30, base - 36, 13, 2, CYM); rect(g, cx + 22, base - 37, 16, 1, CYM_HI);
  // the hats close on each hit
  oval(g, cx - 36, base - 30, 8, 1, CYM);
  oval(g, cx - 36, base - 33 + Math.round(hh * 2), 8, 1, CYM_HI);
  for (const [dx, r] of [[-7, 6], [9, 6]]) {
    rect(g, cx + dx - r, base - 34, r * 2 + 1, 7, P.shell); rect(g, cx + dx - r, base - 34, r * 2 + 1, 1, P.shellHi);
    oval(g, cx + dx, base - 34, r, 2, tm > 0.05 ? '#fffbe8' : '#e8e0cc');
  }
  rect(g, cx + 18, base - 20, 13, 18, P.shell); rect(g, cx + 18, base - 20, 13, 1, P.shellHi);
  oval(g, cx + 24, base - 20, 6, 2, '#e8e0cc');
  rect(g, cx + 19, base - 2, 1, 2, STAND); rect(g, cx + 29, base - 2, 1, 2, STAND);
  rect(g, cx - 30, base - 22, 13, 5, P.shell); rect(g, cx - 30, base - 22, 13, 1, CYM_HI);
  oval(g, cx - 24, base - 23 - Math.round(sn), 6, 2, sn > 0.05 ? '#fffbe8' : '#e8e0cc');
  rect(g, cx - 25, base - 17, 1, 17, STAND);
  // the kick(s): the head pumps; the front one carries the name, or the count
  const kicks = double ? [cx - 9, cx + 9] : [cx];
  kicks.forEach((kx, i) => {
    const front = i === kicks.length - 1, r = (double ? 12 : 14) + (k > 0.5 ? 1 : 0), ky = base - (double ? 12 : 14) - 1;
    disc(g, kx, ky, r + 1, P.hoop);
    if (P.hoopHi) for (let a = 3.5; a < 4.9; a += 0.1) px(g, Math.round(kx + Math.cos(a) * (r + 0.6)), Math.round(ky + Math.sin(a) * (r + 0.6)), P.hoopHi);
    disc(g, kx, ky, r, k > 0.1 ? shade(P.head, -0.2 * k) : P.head);
    disc(g, kx, ky, r - 2, k > 0.1 ? shade(P.headIn, -0.2 * k) : P.headIn);
    if (front) {
      if (s.count != null) {
        const n = String(s.count), tw = textWidth(n, 2);
        text(g, n, kx - Math.floor(tw / 2), ky - 5, P.headInk, 2);
      } else if (s.loading != null) {
        const n = `${Math.floor(s.loading * 100)}%`;
        text(g, n, kx - Math.floor(textWidth(n) / 2), ky - 2, P.headInk);
      } else headName(g, name, kx, ky, r, P.headInk);
    }
    rect(g, kx - r + 2, base - 1, 2, 1, STAND); rect(g, kx + r - 3, base - 1, 2, 1, STAND);
  });
}
function headName(g, name, kx, ky, r, ink) {
  const lw = textWidth(name);
  if (lw <= r * 2 - 2) { text(g, name, kx - Math.floor(lw / 2), ky - 2, ink); return; }
  const w = String(name).split(' '), half = Math.ceil(w.length / 2), a = w.slice(0, half).join(' '), b = w.slice(half).join(' ');
  text(g, a, kx - Math.floor(textWidth(a) / 2), ky - 6, ink); text(g, b, kx - Math.floor(textWidth(b) / 2), ky, ink);
}

/* ------------------------------------------------------------------------------------------------ the tape machines */
// a reel's spokes, a quarter turn a beat while the tape rolls (still under reduced motion, or stopped)
function spokes(g, cx, cy, r, s, c, dir = 1) {
  const a = s.rolling && !s.reduced ? dir * s.beat * (Math.PI / 2) : 0;
  for (let i = 0; i < 3; i++) {
    const t = a + (i * Math.PI * 2) / 3;
    px(g, cx + Math.round(Math.cos(t) * r), cy + Math.round(Math.sin(t) * r), c);
  }
}
export function cassette(g, x, y, s, look = {}) {
  const body = look.body || '#2b2723';
  rect(g, x, y, 30, 14, body); rect(g, x, y, 30, 1, shade(body, 0.25));
  // the cassette in its window: the tape wound on two hubs
  rect(g, x + 3, y + 2, 18, 8, '#100e0c');
  rect(g, x + 4, y + 3, 16, 6, '#8c8478'); rect(g, x + 7, y + 4, 10, 4, '#100e0c');
  for (const rx of [x + 8, x + 16]) { disc(g, rx, y + 6, 2, '#4a2f1c'); spokes(g, rx, y + 6, 1, s, '#cfc6b4'); }
  for (let i = 0; i < 4; i++) rect(g, x + 4 + i * 4, y + 11, 2, 2, '#8c8478');
  rect(g, x + 24, y + 3, 3, 2, s.rolling ? GREEN : GREEN_OFF);
  rect(g, x + 23, y + 7, 5, 5, '#5a544a'); rect(g, x + 24, y + 8, 3, 3, '#8c8478');
}
export function reels(g, x, y, s) {
  rect(g, x, y + 4, 44, 6, '#2b2723'); rect(g, x, y + 4, 44, 1, '#4a443c');
  for (const rx of [x + 10, x + 34]) {
    // the flange, the tape wound on it, the hub, and three spokes that turn
    disc(g, rx, y, 8, '#6e6a62'); disc(g, rx, y, 7, '#3a2516');
    ring(g, rx, y, 7, '#8c8478');
    const a = s.rolling && !s.reduced ? s.beat * (Math.PI / 2) : 0;
    for (let i = 0; i < 3; i++) {
      const t = a + (i * Math.PI * 2) / 3;
      line(g, rx + Math.round(Math.cos(t) * 2), y + Math.round(Math.sin(t) * 2), rx + Math.round(Math.cos(t) * 6), y + Math.round(Math.sin(t) * 6), '#8c8478');
    }
    disc(g, rx, y, 1, '#cfc6b4');
  }
  line(g, x + 10, y + 8, x + 34, y + 8, '#3a2516');
  rect(g, x + 19, y + 6, 6, 2, '#cfc6b4');
}
export function laptop(g, x, y, s) {
  // the screen, its counter, and the base on the table
  rect(g, x, y, 34, 22, '#2a2a2e'); rect(g, x, y, 34, 1, '#46464c');
  rect(g, x + 2, y + 2, 30, 17, '#0f1410');
  // the count while it counts (the kitchen's kick head is a cooler), else the bar
  if (s.count != null) { const n = String(s.count); text(g, n, x + 17 - Math.floor(textWidth(n, 2) / 2), y + 3, GREEN, 2); }
  else { const bar = s.bar != null ? `BAR ${s.bar}` : 'BAR -'; text(g, bar, x + 17 - Math.floor(textWidth(bar) / 2), y + 5, s.rolling ? GREEN : GREEN_OFF); }
  // the input's level along the bottom of the screen (the mic hears you)
  const lit = Math.round(clamp01(s.input) * 12);
  for (let i = 0; i < 12; i++) rect(g, x + 4 + i * 2, y + 14, 1, 1, i < lit ? GREEN : '#2f3a26');
  rect(g, x + 28, y + 14, 2, 2, s.rolling ? GREEN : GREEN_OFF);
  rect(g, x - 2, y + 22, 38, 3, '#46464c'); rect(g, x - 2, y + 22, 38, 1, '#6a6a72');
}
export function crate(g, x, y, w, h, c) {
  rect(g, x, y, w, h, c);
  for (let j = 2; j < h; j += 4) rect(g, x + 1, y + j, w - 2, 1, shade(c, -0.35));
  rect(g, x, y, w, 1, shade(c, 0.25));
}

/* ------------------------------------------------------------------------------------------------ the console ledge */
export const LEDGE_PARTS = { talk: { x: 2, y: 131, w: 14, h: 12 }, counter: { x: 104, y: 132, w: 48, h: 11 }, vu: [{ x: 196, y: 130, w: 26, h: 14 }, { x: 226, y: 130, w: 26, h: 14 }] };
export function ledge(g, s, { reels: withReels = false } = {}) {
  const top = H - 14;
  rect(g, 0, top, W, 14, '#1d1b17');
  rect(g, 0, top, W, 1, '#5a5246'); rect(g, 0, top + 1, W, 1, '#2f2b25');
  // the talkback lamp: lit when a line is new
  rect(g, 5, top + 5, 4, 4, s.talk ? '#f1dc8a' : '#3a3426');
  if (s.talk) glow(g, 7, top + 7, 4, '#f1dc8a', 0.5);
  text(g, 'TB', 11, top + 5, '#6e6352');
  // faders, or the metal club's reel-to-reel
  if (withReels) reels(g, 22, top - 2, s);
  else for (let i = 0; i < 8; i++) { rect(g, 26 + i * 8, top + 4, 1, 8, '#0c0b09'); rect(g, 24 + i * 8, top + 6 + ((i * 5) % 4), 5, 2, '#9a8f7c'); }
  // the tape counter, in green
  const c = LEDGE_PARTS.counter;
  rect(g, c.x, c.y, c.w, c.h, '#0c0b09'); rect(g, c.x, c.y + c.h - 1, c.w, 1, '#2f2b25');
  const bar = s.bar != null ? `BAR ${s.bar}` : 'BAR -';
  text(g, bar, c.x + Math.floor((c.w - textWidth(bar)) / 2), c.y + 3, s.rolling || s.bar != null ? GREEN : GREEN_OFF);
  // two VU needles on the master; under reduced motion the needles rest and the faces light with the level
  s.vu.forEach((lv, i) => {
    const b = LEDGE_PARTS.vu[i], fx = b.x + 2, fy = b.y + 2;
    rect(g, b.x, b.y, b.w, b.h, '#0c0b09');
    rect(g, fx, fy, b.w - 4, b.h - 3, '#d8ccae');
    if (lv > 0.02) alpha(g, 0.25 + lv * 0.5, () => rect(g, fx, fy, b.w - 4, b.h - 3, '#ffe7a8'));
    for (let t = 0; t < 7; t++) px(g, fx + 3 + t * 3, fy + 2 + (t === 0 || t === 6 ? 1 : 0), t >= 5 ? '#6e6352' : INK);
    const ang = (-55 + (s.reduced ? 0 : lv * 110)) * (Math.PI / 180), pivX = fx + 11, pivY = fy + b.h - 3;
    line(g, pivX, pivY, pivX + Math.round(Math.sin(ang) * 9), pivY - Math.round(Math.cos(ang) * 9), INK);
    rect(g, pivX - 1, pivY - 1, 3, 2, '#3a3426');
  });
}
