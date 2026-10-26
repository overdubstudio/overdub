// The four places [ui; stream E] (docs/research/LIVE-ROOM-MODE.md §2.2, §3.19): the metal club, the basement, the
// blues bar and the kitchen table as 256 x 144 rooms, with the console ledge along the bottom of each. No people: the
// band is the gear. Everything here is drawn with ./paint.js (fillStyle, fillRect and globalAlpha, at whole pixels);
// ui/liveroom/pixels/index.js is the room's door to it, and nothing else imports this file but the pixels' checks.
//
//   W, H                         the room's size
//   signalsOf(view)              the scene's signals from the room's view (index.js says what a view carries): every
//                                level in 0..1, the flags, the counter's bar, reduced motion
//   drawScene(g, place, view)    one frame of a place: a pure function of the view (the same view, the same pixels)
//   LAYOUT[place]                where its gear stands: { ampL, ampR, kit, bass, focus } as { x, y, w, h } (the
//                                phone's window frames these; the checks read them)
//   lightsOf(place)              the boxes whose pixels a level may change under reduced motion: the lamps, the amps'
//                                panel meters, the VU faces, the counter (the checks read them)
//   KICKS[place], LOOK[place]    the kick heads' words and each place's palette
//
// Nothing moves without a signal and nothing reads a clock: the reels turn with the beat while the tape rolls, a kick
// head pumps on the kick, a cone with its own level, the basement's bulb swings on the kick, the kitchen's lamp sways
// with the shaker, the blues bar's neon comes on with your first note and flickers on the snare, its LAST CALL sign
// lights on the ending. No red anywhere: amps' lamps are amber, the counter is green (BRAND: red is the record light).

import { W, H, rect, px, disc, oval, ring, line, glow, alpha, dither, rnd, text, textWidth, clamp01 } from './paint.js';
import { stack, combo, dustCover, bassRig, kit, cassette, laptop, crate, ledge, LEDGE_PARTS } from './gear.js';

export { W, H };

export const KICKS = Object.freeze({ metal: 'VOID', basement: 'SUMP PUMP', bluesbar: 'LAST CALL', kitchen: 'COOLER' });

export const LOOK = {
  metal: {
    tolex: '#121214', tolexHi: '#2a2a30', tolexLo: '#000000', panel: '#2c2c32', knob: '#bdbdc4', grille: '#1e1e22', grilleHi: '#34343a', cone: '#0c0c0e', cap: '#26262a', badge: '#9a9aa4',
    shell: '#2a2a33', shellHi: '#5a5a6a', hoop: '#8a8a96', hoopHi: '#c4c4d0', head: '#1a1a20', headIn: '#202028', headInk: '#d8d2c0',
  },
  basement: {
    tolex: '#26262a', tolexHi: '#3c3c42', tolexLo: '#141416', panel: '#9c9a92', knob: '#1a1a1a', grille: '#55524c', grilleHi: '#6e6a62', cone: '#2a2724', cap: '#4a453f', badge: '#d8d2c0',
    shell: '#355a8c', shellHi: '#5a82b4', hoop: '#3a3a3a', head: '#e8e0cc', headIn: '#efe6cf', headInk: '#22385e',
  },
  bluesbar: {
    tolex: '#c9a66b', tolexHi: '#e2c48a', tolexLo: '#8c6c3c', panel: '#2b2219', knob: '#e9dfc4', grille: '#4a3a2a', grilleHi: '#6a5640', cone: '#2a1c12', cap: '#4a3424', badge: '#e9dfc4',
    shell: '#6b4a2b', shellHi: '#9a7148', hoop: '#c9b98a', head: '#efe3c4', headIn: '#f4ead2', headInk: '#3a2414',
  },
  kitchen: { headInk: '#22385e' },
};

const box = (x, y, w, h) => Object.freeze({ x, y, w, h });
export const LAYOUT = Object.freeze({
  metal: Object.freeze({ ampL: box(34, 18, 58, 91), ampR: box(164, 18, 58, 91), kit: box(84, 70, 88, 46), bass: box(224, 38, 30, 72), focus: box(84, 12, 88, 107) }),
  basement: Object.freeze({ ampL: box(40, 64, 44, 48), ampR: box(172, 64, 44, 48), kit: box(84, 68, 88, 46), bass: box(220, 62, 34, 48), focus: box(84, 26, 88, 90) }),
  bluesbar: Object.freeze({ ampL: box(16, 60, 46, 54), ampR: box(66, 80, 26, 26), kit: box(84, 66, 88, 48), bass: box(196, 66, 32, 42), focus: box(84, 18, 88, 96) }),
  kitchen: Object.freeze({ ampL: box(52, 62, 144, 34), ampR: box(52, 62, 144, 34), kit: box(160, 96, 32, 32), bass: box(200, 56, 20, 66), focus: box(28, 26, 166, 102) }),
});

/* ------------------------------------------------------------------------------------------------ the signals */
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const ROLLING = new Set(['count', 'take', 'pass', 'double', 'punch', 'record', 'play', 'loop', 'tape']);
let reducedQuery;
function prefersReduced() {
  try {
    if (reducedQuery === undefined) reducedQuery = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    return !!reducedQuery?.matches;
  } catch { return false; }
}
const ROLE_OF = { shaker: 'shaker', cajon: 'cajon', bass: 'kbass', strings: 'strings' };

export function signalsOf(view) {
  const v = isObj(view) ? view : {}, live = isObj(v.live) ? v.live : {};
  const run = typeof v.run === 'string' ? v.run : isObj(v.run) ? String(v.run.kind ?? v.run.id ?? '') : '';
  const meter = Array.isArray(v.meter) && v.meter[0] > 0 && v.meter[1] > 0 ? v.meter : [4, 4];
  const bpb = (meter[0] * 4) / meter[1];
  const beat = Number.isFinite(v.beat) ? v.beat : 0;
  const rolling = typeof v.rolling === 'boolean' ? v.rolling : ROLLING.has(run);
  const bar = Number.isFinite(v.bar) ? Math.max(0, Math.floor(v.bar)) : Number.isFinite(v.beat) ? Math.floor(Math.max(0, v.beat) / bpb) + 1 : null;
  const cards = Array.isArray(v.cards) ? v.cards : [];
  const roles = isObj(v.roles) ? v.roles : {};
  const side = v.side === 'R' ? 'R' : 'L';
  const master = Array.isArray(live.master) ? live.master : [live.master, live.master];
  const input = clamp01(live.input);
  const count = Number.isInteger(v.count) && v.count > 0 && v.count < 100 ? v.count : null;
  const invited = {};
  for (const [k, role] of Object.entries(ROLE_OF)) invited[k] = isObj(v.invited) && typeof v.invited[k] === 'boolean' ? v.invited[k] : !!roles[role];
  const title = typeof v.title === 'string' && v.title.trim() && !/^untitled$/i.test(v.title.trim()) ? v.title.trim() : '';
  return {
    reduced: typeof v.reduced === 'boolean' ? v.reduced : prefersReduced(),
    input, L: clamp01(live.L), R: clamp01(live.R), kick: clamp01(live.kick), snare: clamp01(live.snare), hat: clamp01(live.hat),
    crash: clamp01(live.crash), tom: clamp01(live.tom), bass: clamp01(live.bass), shaker: clamp01(live.shaker), cajon: clamp01(live.cajon),
    vu: [clamp01(master[0]), clamp01(master[1] ?? master[0])],
    plugged: typeof v.plugged === 'boolean' ? v.plugged : input > 0,
    rolling, beat, bar, count, side,
    doubled: typeof v.doubled === 'boolean' ? v.doubled : side === 'R' || cards.some((c) => c?.takes?.R?.length),
    learning: typeof v.learning === 'boolean' ? v.learning : run === 'read',
    learned: cards.some((c) => Array.isArray(c?.band) && c.band.some((b) => b && b.track === roles.bass)),
    lead: !!roles.lead,
    talk: !!v.talk, ending: !!v.ending,
    heard: typeof v.heard === 'boolean' ? v.heard : cards.some((c) => c?.takes?.L?.length || c?.takes?.R?.length),
    title, invited,
  };
}

// the amps' and the bass rig's signals
const ampsOf = (s) => ({
  L: { level: Math.max(s.L, s.side !== 'R' ? s.input : 0), on: s.plugged, reduced: s.reduced },
  R: { level: Math.max(s.R, s.side === 'R' ? s.input : 0), on: s.plugged && s.doubled, reduced: s.reduced },
});
const rigOf = (s) => ({ level: s.bass, reduced: s.reduced, lamp: s.learning ? 0.9 : s.bass > 0.02 ? 0.4 + s.bass * 0.5 : s.learned ? 0.3 : s.plugged ? 0.15 : 0 });
// the beat's side: a swing goes one way on even beats and the other on odd ones
const swing = (s, amt) => (s.reduced ? 0 : Math.round(amt * 2) * (Math.floor(s.beat) % 2 ? 1 : -1));

/* ------------------------------------------------------------------------------------------------ the metal club */
function beam(g, x, top, bottom, spread, c, a) {
  alpha(g, a, () => {
    g.fillStyle = c;
    for (let y = top; y < bottom; y += 2) {
      const half = 2 + Math.round(((y - top) / (bottom - top)) * spread);
      g.fillRect(x - half, y, half * 2 + 1, 2);
    }
  });
}
function metal(g, s) {
  const P = LOOK.metal, L = LAYOUT.metal, amps = ampsOf(s);
  rect(g, 0, 0, W, 96, '#0d0b10');
  // the backdrop and its name
  rect(g, 66, 12, 124, 52, '#1b1820'); rect(g, 66, 12, 124, 1, '#2a2630'); rect(g, 66, 63, 124, 1, '#120f16');
  for (let x = 70; x < 190; x += 12) px(g, x, 14, '#5a5a62');
  const nm = KICKS.metal, k = 4, w = textWidth(nm, k), nx = 128 - Math.floor(w / 2);
  text(g, nm, nx + 2, 28, '#2e2140', k);
  text(g, nm, nx, 26, '#d8d2c0', k);
  if (!s.reduced && s.snare > 0.05) alpha(g, s.snare * 0.35, () => text(g, nm, nx, 26, '#ffffff', k));
  // the truss and its cans
  rect(g, 0, 0, W, 6, '#2a2a30');
  for (let x = 0; x < W; x += 8) { px(g, x + 1, 1, '#4a4a52'); px(g, x + 3, 3, '#4a4a52'); px(g, x + 5, 1, '#4a4a52'); }
  // the stage, its edge and the dark in front of it
  rect(g, 0, 96, W, 26, '#17141b');
  for (let y = 100; y < 122; y += 6) rect(g, 0, y, W, 1, '#1f1b24');
  rect(g, 0, 122, W, 2, '#3a3440'); rect(g, 0, 124, W, 6, '#0a090c');
  // the gear
  bassRig(g, L.bass.x, 48, 30, 60, P, rigOf(s), 'fridge');
  stack(g, L.ampL.x, L.ampL.y, P, amps.L);
  stack(g, L.ampR.x, L.ampR.y, P, amps.R);
  if (!s.doubled) dustCover(g, L.ampR.x, L.ampR.y, 58, 89);
  kit(g, 128, 114, P, s, { double: true, name: KICKS.metal });
  for (const x of [8, 230]) { rect(g, x, 114, 18, 8, '#1c1c20'); rect(g, x + 2, 115, 14, 4, '#2a2a30'); rect(g, x, 114, 18, 1, '#34343a'); }
  // the lights: beams down through the haze, harder on the snare, white on a crash (still under reduced motion)
  const hit = s.reduced ? 0 : s.snare * 0.08 + s.crash * 0.08 + s.input * 0.03;
  [24, 76, 128, 180, 232].forEach((x, i) => {
    rect(g, x - 3, 5, 7, 6, '#202024'); rect(g, x - 2, 10, 5, 1, '#5a5a62');
    const c = !s.reduced && s.crash > 0.3 ? '#fff0e0' : i % 2 ? '#8a5cff' : '#ffc070';
    beam(g, x, 11, 122, 15, c, 0.045 + hit);
  });
  // haze over the stage
  alpha(g, 0.12, () => { g.fillStyle = '#8a7aa8'; for (let y = 102; y < 122; y += 3) for (let x = (y % 2) * 6; x < W; x += 12) g.fillRect(x, y, 6, 1); });
}

/* ------------------------------------------------------------------------------------------------ the basement */
const RISO = ['#ff48b0', '#0078bf', '#ffe800', '#00a95c'];
function flyerTitle(g, title, x, y, w) {
  const words = title.toUpperCase().split(/\s+/).filter(Boolean), per = Math.floor((w + 1) / 4), lines = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (t.length <= per) cur = t;
    else { if (cur) lines.push(cur); cur = wd.slice(0, per); }
  }
  if (cur) lines.push(cur);
  lines.slice(0, 3).forEach((ln, i) => text(g, ln, x + Math.floor((w - textWidth(ln)) / 2), y + i * 7, '#16130f'));
}
function basement(g, s) {
  const P = LOOK.basement, L = LAYOUT.basement, amps = ampsOf(s);
  // cinder block, the joists, a copper pipe
  rect(g, 0, 0, W, 96, '#4b4f57');
  const R = rnd(11);
  for (let row = 0; row < 12; row++) {
    const y = 8 + row * 8, off = row % 2 ? 8 : 0;
    rect(g, 0, y, W, 1, '#3c3f46');
    for (let x = -off; x < W; x += 16) { rect(g, x, y, 1, 8, '#3c3f46'); if (R() < 0.35) alpha(g, 0.25, () => rect(g, x + 2, y + 2, 12, 5, R() < 0.5 ? '#585c64' : '#43464d')); }
  }
  rect(g, 0, 0, W, 7, '#3a2c22'); for (let x = 6; x < W; x += 24) rect(g, x, 0, 6, 8, '#2c2119');
  rect(g, 0, 10, W, 2, '#b87333'); rect(g, 0, 10, W, 1, '#d99a5c');
  // the door up to the house, and a high window with the street's light in it
  rect(g, 4, 30, 28, 66, '#3a2c22'); rect(g, 6, 32, 24, 64, '#5a4532'); rect(g, 8, 36, 20, 24, '#4e3b2b'); rect(g, 8, 64, 20, 28, '#4e3b2b'); rect(g, 26, 64, 2, 2, '#c9b98a');
  rect(g, 176, 16, 34, 18, '#26292e'); rect(g, 178, 18, 30, 14, '#1d2b44'); alpha(g, 0.5, () => dither(g, 178, 18, 30, 14, '#3a5578', 4)); rect(g, 192, 18, 1, 14, '#26292e');
  // flyers, in riso inks; the one by the door gets the song's title once it has one
  [[120, 30, 14, 18, 0], [138, 26, 12, 16, 1], [222, 40, 13, 17, 2], [100, 44, 11, 14, 3]].forEach(([x, y, w, h, i]) => {
    rect(g, x, y, w, h, RISO[i]); alpha(g, 0.35, () => rect(g, x + 2, y + 1, w - 2, h - 1, RISO[(i + 1) % 4]));
    for (let j = 4; j < h - 2; j += 3) rect(g, x + 2, y + j, w - 4 - ((j * 7) % 5), 1, '#1a1a1a');
    rect(g, x + Math.floor(w / 2) - 1, y - 1, 3, 2, '#d8d2c0');
  });
  rect(g, 36, 30, 30, 26, '#f4ead6'); rect(g, 36, 30, 30, 5, RISO[2]); rect(g, 49, 29, 4, 2, '#d8d2c0');
  if (s.title) flyerTitle(g, s.title, 37, 37, 28);
  else { text(g, 'TONIGHT', 37, 37, '#4c4336'); rect(g, 40, 45, 22, 1, '#9a8f7c'); rect(g, 40, 49, 16, 1, '#9a8f7c'); }
  // the water heater, its pilot light blue
  rect(g, 70, 40, 16, 56, '#9aa0a6'); rect(g, 70, 40, 16, 2, '#c4c9ce'); rect(g, 71, 42, 2, 54, '#b8bdc2'); rect(g, 76, 34, 4, 6, '#b87333');
  rect(g, 74, 82, 8, 6, '#6a7076'); px(g, 77, 85, '#7f9cff');
  // the floor, and a rug under the kit
  rect(g, 0, 96, W, 34, '#33363b');
  for (let x = 0; x < W; x += 37) rect(g, x, 116 + ((x * 3) % 11), 9, 1, '#2a2c30');
  rect(g, 84, 104, 104, 22, '#2c3e5c'); rect(g, 86, 106, 100, 18, '#38507a');
  for (let x = 90; x < 184; x += 8) { rect(g, x, 110, 4, 2, '#dcb45e'); rect(g, x + 4, 118, 4, 2, '#dcb45e'); }
  // the gear: a four-track on a milk crate, your amp on a crate, the kit, the other amp, the bass
  crate(g, 4, 100, 30, 12, '#2a5f9e'); cassette(g, 4, 86, s);
  combo(g, L.ampL.x, L.ampL.y, 44, 38, P, amps.L); crate(g, L.ampL.x - 2, 102, 48, 10, '#2a5f9e');
  combo(g, L.ampR.x, L.ampR.y, 44, 38, P, amps.R); crate(g, L.ampR.x - 2, 102, 48, 10, '#2a5f9e');
  if (!s.doubled) dustCover(g, L.ampR.x, L.ampR.y, 44, 38);
  kit(g, 128, 112, P, s, { name: KICKS.basement });
  bassRig(g, L.bass.x, L.bass.y, 34, 46, P, rigOf(s), 'combo');
  // the bare bulb, swinging on the kick
  const sw = swing(s, s.kick), bx = 106 + sw;
  line(g, 106, 7, bx, 24, '#1a1a1a');
  glow(g, bx, 27, 26, '#ffd98a', 0.3 + (s.reduced ? 0 : s.kick * 0.15));
  disc(g, bx, 27, 3, '#fff1c2'); px(g, bx - 1, 26, '#ffffff');
}

/* ------------------------------------------------------------------------------------------------ the blues bar */
function bluesbar(g, s) {
  const P = LOOK.bluesbar, L = LAYOUT.bluesbar, amps = ampsOf(s);
  // wood panelling, a chair rail, the wainscot
  rect(g, 0, 0, W, 96, '#5a3a26');
  for (let x = 0; x < W; x += 8) { rect(g, x, 0, 1, 96, '#3e2717'); if ((x / 8) % 2) rect(g, x + 1, 0, 7, 96, '#64412b'); }
  rect(g, 0, 64, W, 3, '#3e2717'); rect(g, 0, 67, W, 29, '#4a2e1c');
  // a picture on the wall
  rect(g, 26, 20, 28, 22, '#2a1a10'); rect(g, 28, 22, 24, 18, '#3c4c5a'); rect(g, 28, 34, 24, 6, '#5a4a32'); disc(g, 44, 28, 3, '#c9a24a');
  // the neon: BLUES, dark until your first note, flickering on the snare
  const nm = 'BLUES', k = 2, nw = textWidth(nm, k), nx = 128 - Math.floor(nw / 2);
  rect(g, nx - 3, 18, nw + 6, 14, '#2a1a12');
  if (s.heard) {
    const fl = !s.reduced && s.snare > 0.6 ? 0.5 : 1;
    glow(g, 128, 25, 22, '#d070ff', 0.22 * fl);
    text(g, nm, nx, 20, fl > 0.6 ? '#f0b0ff' : '#9a58c0', k);
  } else text(g, nm, nx, 20, '#3e2a48', k);
  // string lights, breathing with the kick
  for (let x = 4; x < W; x += 12) {
    const y = 6 + Math.round(8 * Math.sin((x / W) * Math.PI));
    rect(g, x, y - 2, 1, 2, '#2a1a10');
    disc(g, x, y + 1, 1, '#ffd27a'); glow(g, x, y + 1, 5, '#ffc45a', 0.16 + (s.reduced ? 0 : s.kick * 0.12));
  }
  // the bar: the LAST CALL sign, bottles on the back shelf, a cassette deck on the counter
  const lc = 'LAST CALL', lw = textWidth(lc), lx = 220 - Math.floor(lw / 2);
  rect(g, lx - 4, 15, lw + 8, 10, '#1a120c'); rect(g, lx - 4, 15, lw + 8, 1, '#3a2a1c');
  if (s.ending) { glow(g, 220, 20, 14, '#ffd27a', 0.35); text(g, lc, lx, 18, '#ffe2a0'); } else text(g, lc, lx, 18, '#4a3a28');
  rect(g, 186, 40, 68, 2, '#2e1e12');
  const B = ['#3a5a3a', '#7a6a3a', '#3a4a5a', '#c9a66b', '#4a3a2a'];
  for (let i = 0; i < 11; i++) { const bx = 188 + i * 6, bh = 7 + ((i * 5) % 5); rect(g, bx, 40 - bh, 4, bh, B[i % 5]); rect(g, bx + 1, 38 - bh, 2, 2, B[i % 5]); px(g, bx + 1, 42 - bh, '#e9dfc4'); }
  rect(g, 184, 62, 72, 34, '#3e2717'); rect(g, 184, 58, 72, 4, '#7a5234'); rect(g, 184, 58, 72, 1, '#9a7148');
  for (let x = 188; x < W; x += 12) rect(g, x, 66, 1, 28, '#2e1e12');
  cassette(g, 222, 44, s, { body: '#3a3028' });
  // the floor: planks, a rug under the kit
  rect(g, 0, 96, W, 34, '#3a2618');
  for (let y = 100; y < 130; y += 5) rect(g, 0, y, W, 1, '#2e1e12');
  for (let y = 100, i = 0; y < 130; y += 5, i++) for (let x = (i * 23) % 40; x < W; x += 40) rect(g, x, y, 1, 5, '#2e1e12');
  oval(g, 136, 116, 52, 10, '#2e3a26'); oval(g, 136, 116, 48, 8, '#3c4a32');
  // the chair your amp sits on, the amp, the lead's little amp beside it, the kit, the bass
  rect(g, 14, 98, 50, 3, '#6b4a2b'); rect(g, 16, 101, 2, 14, '#4a321c'); rect(g, 60, 101, 2, 14, '#4a321c');
  combo(g, L.ampL.x, L.ampL.y, 46, 38, P, amps.L);
  combo(g, L.ampR.x, L.ampR.y, 26, 24, P, { level: s.R, on: s.plugged && s.lead, reduced: s.reduced });
  kit(g, 128, 112, P, s, { name: KICKS.bluesbar });
  bassRig(g, L.bass.x, L.bass.y, 32, 40, P, rigOf(s), 'combo');
}

/* ------------------------------------------------------------------------------------------------ the kitchen table */
function acoustic(g, x, y) {
  // a guitar standing against the chair: the headstock and its pegs, the neck, the two bouts, the hole, the bridge
  rect(g, x - 2, y, 5, 7, '#3a2a1a'); for (let j = 1; j < 7; j += 2) { px(g, x - 3, y + j, '#c9b98a'); px(g, x + 3, y + j, '#c9b98a'); }
  rect(g, x - 1, y + 7, 3, 24, '#6a4024'); for (let j = 10; j < 31; j += 4) rect(g, x - 1, y + j, 3, 1, '#c9b98a');
  oval(g, x, y + 36, 7, 6, '#5a3a1e'); oval(g, x, y + 47, 10, 8, '#5a3a1e');
  oval(g, x, y + 36, 6, 5, '#e8c58a'); oval(g, x, y + 47, 9, 7, '#e8c58a');
  rect(g, x - 5, y + 41, 11, 2, '#e8c58a');
  ring(g, x, y + 39, 3, '#5a3a1e'); disc(g, x, y + 39, 2, '#2a1a10');
  rect(g, x - 3, y + 50, 7, 2, '#3a2414'); rect(g, x, y + 31, 1, 19, '#efe6cf');
}
function kitchen(g, s) {
  const L = LAYOUT.kitchen;
  // the wall, papered; a window at night
  rect(g, 0, 0, W, 96, '#4a4234');
  for (let x = 3; x < W; x += 10) rect(g, x, 0, 2, 96, '#524a3a');
  rect(g, 0, 88, W, 8, '#3a3328'); rect(g, 0, 88, W, 1, '#5a5040');
  rect(g, 14, 14, 48, 42, '#2a241c'); rect(g, 16, 16, 44, 38, '#1d2b44');
  disc(g, 48, 26, 4, '#efe6cf'); disc(g, 50, 25, 3, '#1d2b44');
  for (const [x, y] of [[22, 22], [30, 40], [40, 19], [55, 44], [26, 33]]) px(g, x, y, '#cbc0aa');
  rect(g, 37, 16, 2, 38, '#2a241c'); rect(g, 16, 34, 44, 2, '#2a241c'); rect(g, 12, 56, 52, 3, '#5a4a36');
  // a shelf with jars, and the old fridge
  rect(g, 150, 30, 44, 2, '#5a4a36');
  for (let i = 0; i < 5; i++) { const jx = 153 + i * 8; rect(g, jx, 22, 6, 8, ['#c9a66b', '#8fa880', '#d9c8a4', '#a2a6c6', '#dcb45e'][i]); rect(g, jx, 21, 6, 2, '#6e6352'); }
  rect(g, 222, 22, 32, 92, '#d8d2c0'); rect(g, 222, 22, 32, 1, '#efe6cf'); rect(g, 222, 52, 32, 1, '#9a8f7c'); rect(g, 226, 30, 2, 16, '#9a8f7c'); rect(g, 226, 58, 2, 20, '#9a8f7c');
  // the floor, in tiles
  for (let y = 96; y < 130; y += 6) for (let x = ((y / 6) % 2) * 8 - 8; x < W; x += 16) { rect(g, x, y, 8, 6, '#3a342a'); rect(g, x + 8, y, 8, 6, '#433c30'); }
  // the players the song invited: a music stand for the strings, a bass against the fridge
  if (s.invited.strings) { rect(g, 12, 70, 18, 12, '#2a2a2e'); rect(g, 14, 72, 14, 8, '#e8dcc0'); line(g, 21, 82, 21, 122, '#2a2a2e'); line(g, 21, 122, 14, 128, '#2a2a2e'); line(g, 21, 122, 28, 128, '#2a2a2e'); }
  if (s.invited.bass) {
    const bx = L.bass.x + 10;
    rect(g, bx - 2, 56, 5, 6, '#2a1a10'); rect(g, bx - 1, 62, 3, 36, '#3a2414'); for (let j = 66; j < 98; j += 5) rect(g, bx - 1, j, 3, 1, '#9a8f7c');
    oval(g, bx, 108, 8, 12, '#22385e'); oval(g, bx, 108, 7, 11, '#355a8c'); rect(g, bx - 3, 100, 7, 3, '#16130f'); rect(g, bx - 3, 112, 7, 2, '#d8d2c0');
  }
  // the table, its legs, and the chair with the guitar
  rect(g, 30, 86, 2, 40, '#3a2a1a'); rect(g, 30, 86, 20, 2, '#3a2a1a'); rect(g, 30, 100, 22, 3, '#5a4028');
  rect(g, 52, 84, 146, 8, '#7a5a3a'); rect(g, 52, 84, 146, 1, '#9a7a52'); rect(g, 52, 92, 146, 4, '#5a4028');
  for (const x of [56, 190]) rect(g, x, 96, 4, 30, '#4a3420');
  acoustic(g, 40, 60);
  // on the table: the paper (a coffee ring, a pencil), a mug, the laptop with the counter
  rect(g, 70, 85, 34, 6, '#f4ead6'); for (let j = 0; j < 3; j++) rect(g, 72, 86 + j * 2, 26 - j * 5, 1, '#9a8f7c');
  disc(g, 99, 87, 2, '#c9b08a'); disc(g, 99, 87, 1, '#f4ead6'); line(g, 74, 90, 86, 89, '#dcb45e');
  rect(g, 110, 76, 8, 9, '#355a8c'); rect(g, 118, 78, 2, 5, '#355a8c'); rect(g, 110, 76, 8, 1, '#5a82b4');
  laptop(g, 140, 60, s);
  if (s.invited.shaker) { const lift = s.reduced ? 0 : Math.round(s.shaker * 2); oval(g, 182, 82 - lift, 2, 3, '#dcb45e'); px(g, 181, 80 - lift, '#f4e6b0'); }
  // the cooler that is the cajón, its word on its side; the front gives on its hits
  const cx = L.kit.x + 2, cy = 98, give = s.reduced ? 0 : Math.round(s.cajon);
  rect(g, cx, cy, 28, 28, '#d8d2c0'); rect(g, cx, cy, 28, 6, '#355a8c'); rect(g, cx, cy, 28, 1, '#5a82b4');
  rect(g, cx + 10, cy - 2, 8, 2, '#efe6cf');
  rect(g, cx + 2, cy + 8 + give, 24, 18 - give, '#cbc0aa');
  text(g, KICKS.kitchen, cx + 3, cy + 13 + give, LOOK.kitchen.headInk);
  rect(g, cx, cy + 27, 28, 1, '#9a8f7c');
  // the lamp over the table, swaying with the shaker, and its light on the table
  const sw = swing(s, s.shaker), lx = 120 + sw;
  line(g, 120, 0, lx, 27, '#1a1a1a');
  alpha(g, 0.07, () => { g.fillStyle = '#ffe7a8'; for (let y = 36; y < 92; y += 2) { const half = 9 + Math.round((y - 36) * 0.9); g.fillRect(lx - half, y, half * 2 + 1, 2); } });
  rect(g, lx - 4, 28, 9, 2, '#4a6a4a'); rect(g, lx - 7, 30, 15, 3, '#4a6a4a'); rect(g, lx - 9, 33, 19, 2, '#5a7a5a');
  glow(g, lx, 36, 12, '#ffd98a', 0.45); disc(g, lx, 36, 2, '#fff1c2');
}

/* ------------------------------------------------------------------------------------------------ before a place */
function bare(g) {
  rect(g, 0, 0, W, 96, '#24211c');
  for (let x = 16; x < W; x += 48) { rect(g, x, 18, 32, 50, '#2f2b25'); rect(g, x, 18, 32, 1, '#46413a'); }
  rect(g, 0, 96, W, 34, '#1a1815');
  for (let y = 100; y < 130; y += 6) rect(g, 0, y, W, 1, '#24211c');
  oval(g, 128, 114, 60, 10, '#2f2b25');
}

const PLACES = { metal, basement, bluesbar, kitchen };

export function drawScene(g, place, view) {
  const s = signalsOf(view);
  g.globalAlpha = 1;
  (PLACES[place] || bare)(g, s);
  g.globalAlpha = 1;
  ledge(g, s, { reels: place === 'metal' });
}

// where the lights are: the amps' heads and panels, the bass rig's lamp, the ledge's
export function lightsOf(place) {
  const L = LAYOUT[place], out = [LEDGE_PARTS.talk, LEDGE_PARTS.counter, ...LEDGE_PARTS.vu];
  if (!L) return out;
  const grow = (b) => ({ x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 });
  if (place === 'metal') {
    for (const a of [L.ampL, L.ampR]) out.push(grow({ x: a.x + 2, y: a.y, w: 54, h: 14 }));
    out.push(grow({ x: L.bass.x + 18, y: 38, w: 6, h: 6 }));
  } else if (place === 'kitchen') {
    out.push({ x: 140, y: 60, w: 34, h: 22 });
  } else {
    for (const a of [L.ampL, L.ampR]) out.push(grow({ x: a.x, y: a.y, w: a.w, h: 10 }));
    out.push(grow({ x: L.bass.x + L.bass.w - 10, y: L.bass.y, w: 6, h: 8 }));
  }
  return out;
}
