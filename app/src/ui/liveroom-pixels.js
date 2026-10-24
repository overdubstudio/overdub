// The live room's pictures [ui, a prototype: ?room]: the places as pixel rooms with their gear (your amp, the kit, the
// bass amp, a tape deck that is always rolling), and the instruments you can bring. No people: the band is the gear,
// and the gear moves with the real sound (your amp's cone with your level, the kick's head on the kick, the cymbals on
// their hits, the bass cone with the bass). Drawn on a 256 x 144 canvas, scaled up whole pixels at a time.
//
//   W, H                                  the room's size in pixels
//   drawRoom(g, place, S, t)              one frame of a place. S: { on, amp, hit, kick, snare, hat, crash, tom, bass,
//                                         band, rolling, counter (s), heard } (levels and hit envelopes, 0..1); t: seconds
//   drawThing(g, kind, { dim })           an instrument on a 64 x 64 canvas: 'electric' | 'acoustic' | 'keys' | 'voice'
//   drawTape(g, { label, sub, t })        the tape box: a cassette on a 128 x 80 canvas with its label written on

export const W = 256, H = 144;

/* ------------------------------------------------------------------------------------------------ primitives */
const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const px = (g, x, y, c) => rect(g, x, y, 1, 1, c);
function disc(g, cx, cy, r, c) {
  g.fillStyle = c;
  for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y) + 0.35); g.fillRect(Math.round(cx - w), Math.round(cy + y), 2 * w + 1, 1); }
}
function oval(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  for (let y = -ry; y <= ry; y++) { const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + 0.35); g.fillRect(Math.round(cx - w), Math.round(cy + y), 2 * w + 1, 1); }
}
function glow(g, cx, cy, r, c, a) {
  if (!(a > 0.01)) return;
  const was = g.globalAlpha;
  for (let k = 3; k >= 1; k--) { g.globalAlpha = Math.min(1, a * 0.22 * (4 - k)); disc(g, cx, cy, Math.round((r * k) / 3), c); }
  g.globalAlpha = was;
}
function alpha(g, a, fn) { const was = g.globalAlpha; g.globalAlpha = a; try { fn(); } finally { g.globalAlpha = was; } }
// a checkerboard of c over the rect, every other pixel (or every fourth: sparse)
function dither(g, x, y, w, h, c, sparse = false) {
  g.fillStyle = c;
  for (let j = 0; j < h; j++) for (let i = (j % 2); i < w; i += sparse ? 4 : 2) g.fillRect(x + i + (sparse && j % 4 >= 2 ? 2 : 0), y + j, 1, 1);
}
// a tiny seeded random: the same room every time
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// a 3x5 font: rows of three, top to bottom
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', "'": '010010000000000',
  '/': '001001010100100', '#': '101111101111101', '&': '010101010101011', '!': '010010010000010',
};
export function text(g, str, x, y, c, k = 1) {
  g.fillStyle = c;
  let cx = Math.round(x);
  for (const ch of String(str).toUpperCase()) {
    const f = FONT[ch];
    if (f) for (let i = 0; i < 15; i++) if (f[i] === '1') g.fillRect(cx + (i % 3) * k, Math.round(y) + Math.floor(i / 3) * k, k, k);
    cx += 4 * k;
  }
}
export const textWidth = (str, k = 1) => Math.max(0, String(str).length * 4 * k - k);

/* ------------------------------------------------------------------------------------------------ the gear */
// your amp: a combo (w x h), its cone breathing with your level, the pilot lamp on while you're plugged in
function combo(g, x, y, w, h, P, S, t) {
  const shake = S.hit > 0.55 ? Math.round(Math.sin(t * 90) * S.hit) : 0;
  x += shake;
  rect(g, x, y + h, w, 2, 'rgba(0,0,0,.35)');                     // its shadow on the floor
  rect(g, x, y, w, h, P.tolex);
  rect(g, x, y, w, 1, P.tolexHi); rect(g, x, y, 1, h, P.tolexHi);
  rect(g, x + w - 1, y, 1, h, P.tolexLo); rect(g, x, y + h - 1, w, 1, P.tolexLo);
  // the panel: knobs and the jewel
  rect(g, x + 2, y + 2, w - 4, 5, P.panel);
  for (let i = 0; i < 5; i++) { rect(g, x + 5 + i * 5, y + 3, 2, 2, P.knob); px(g, x + 5 + i * 5, y + 3, '#fff8'); }
  const lamp = S.on ? '#ff5a3c' : '#5a2a22';
  rect(g, x + w - 7, y + 3, 3, 3, lamp);
  if (S.on) glow(g, x + w - 6, y + 4, 4, '#ff7a4c', 0.5 + S.amp * 0.5);
  // the grille and the cone behind it
  const gx = x + 3, gy = y + 9, gw = w - 6, gh = h - 12;
  rect(g, gx, gy, gw, gh, P.grille);
  const cx = gx + gw / 2, cy = gy + gh / 2, r = Math.min(gw, gh) / 2 - 2;
  const push = Math.round(S.amp * 1.8 + S.hit);
  disc(g, cx, cy, Math.round(r) + (push > 1 ? 1 : 0), P.cone);
  disc(g, cx, cy, Math.round(r * 0.55), shadeTo(P.cone, S.amp * 0.5));
  disc(g, cx, cy, Math.max(2, Math.round(r * 0.22) + (push > 0 ? 1 : 0)), P.cap);
  alpha(g, 0.55, () => dither(g, gx, gy, gw, gh, P.grilleHi));
  // the badge
  rect(g, x + w / 2 - 5, y + h - 6, 10, 2, P.badge);
}
// a stack: a head on two 4x12 cabinets
function stack(g, x, y, P, S, t) {
  const shake = S.hit > 0.55 ? Math.round(Math.sin(t * 90) * S.hit) : 0;
  x += shake;
  rect(g, x - 1, y + 90, 60, 2, 'rgba(0,0,0,.4)');
  // the head
  rect(g, x + 2, y, 54, 14, P.tolex); rect(g, x + 2, y, 54, 1, P.tolexHi);
  rect(g, x + 5, y + 3, 48, 7, P.panel);
  for (let i = 0; i < 8; i++) { rect(g, x + 8 + i * 5, y + 5, 2, 2, P.knob); }
  rect(g, x + 49, y + 5, 2, 2, S.on ? '#ff5a3c' : '#5a2a22');
  if (S.on) { glow(g, x + 50, y + 6, 4, '#ff7a4c', 0.55 + S.amp * 0.45); alpha(g, 0.25 + S.amp * 0.35, () => rect(g, x + 6, y + 11, 46, 1, '#ff9a4c')); }
  for (const [cy0] of [[y + 15], [y + 52]]) {
    rect(g, x, cy0, 58, 37, P.tolex); rect(g, x, cy0, 58, 1, P.tolexHi); rect(g, x, cy0 + 36, 58, 1, P.tolexLo);
    rect(g, x + 3, cy0 + 3, 52, 31, P.grille);
    const push = Math.round(S.amp * 1.5 + S.hit);
    for (const [dx, dy] of [[16, 10], [42, 10], [16, 26], [42, 26]]) {
      disc(g, x + dx, cy0 + dy, 6 + (push > 1 ? 1 : 0), P.cone);
      disc(g, x + dx, cy0 + dy, 2 + (push > 0 ? 1 : 0), P.cap);
    }
    alpha(g, 0.5, () => dither(g, x + 3, cy0 + 3, 52, 31, P.grilleHi));
  }
}
// the bass rig: a head on a cabinet of small speakers (fridge) or one big one (combo)
function bassRig(g, x, y, w, h, P, S, kind) {
  rect(g, x - 1, y + h, w + 2, 2, 'rgba(0,0,0,.35)');
  if (kind === 'fridge') {
    rect(g, x + 2, y - 10, w - 4, 9, P.tolex); rect(g, x + 4, y - 8, w - 8, 4, P.panel);
    rect(g, x + w - 9, y - 7, 2, 2, S.band ? '#7fd36b' : '#2d4a2a');
  }
  rect(g, x, y, w, h, P.tolex); rect(g, x, y, w, 1, P.tolexHi); rect(g, x + w - 1, y, 1, h, P.tolexLo);
  rect(g, x + 3, y + 3, w - 6, h - 6, P.grille);
  const push = Math.round(S.bass * 2);
  if (kind === 'fridge') {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) {
      const cx = x + 3 + ((w - 6) * (col * 2 + 1)) / 4, cy = y + 3 + ((h - 6) * (row * 2 + 1)) / 8;
      disc(g, cx, cy, 4 + (push > 1 ? 1 : 0), P.cone); disc(g, cx, cy, 1 + (push > 0 ? 1 : 0), P.cap);
    }
  } else {
    const r = Math.min(w, h) / 2 - 5;
    disc(g, x + w / 2, y + h / 2 + 2, Math.round(r) + (push > 1 ? 1 : 0), P.cone);
    disc(g, x + w / 2, y + h / 2 + 2, Math.round(r * 0.3) + (push > 0 ? 1 : 0), P.cap);
    rect(g, x + 4, y + 4, w - 8, 3, P.panel);
    rect(g, x + w - 8, y + 5, 2, 1, S.band ? '#7fd36b' : '#2d4a2a');
  }
  alpha(g, 0.45, () => dither(g, x + 3, y + 3, w - 6, h - 6, P.grilleHi));
}
// the kit: a kick (or two) with the band's name on its head, toms, a snare, hats, a crash and a ride on stands
function kit(g, cx, base, P, S, t, { double = false, name = '' } = {}) {
  const metal = '#c9b98a', metalHi = '#f4e6b0', stand = '#77736c';
  const k = S.kick, sn = S.snare, hh = S.hat, cr = S.crash;
  // stands first (behind)
  rect(g, cx - 36, base - 30, 1, 30, stand); rect(g, cx - 22, base - 40, 1, 40, stand); rect(g, cx + 30, base - 34, 1, 34, stand);
  // the crash: tips on a hit
  const tilt = Math.round(Math.sin(t * 22) * cr * 2);
  oval(g, cx - 22, base - 42 + tilt, 12, 2, metal); rect(g, cx - 32, base - 43 + tilt, 20, 1, metalHi);
  if (cr > 0.05) glow(g, cx - 22, base - 42, 10, '#fff2c0', cr * 0.6);
  // the ride
  oval(g, cx + 30, base - 36, 13, 2, metal); rect(g, cx + 22, base - 37, 16, 1, metalHi);
  // the hats: the top one closes on each hit
  oval(g, cx - 36, base - 30, 8, 1, metal);
  oval(g, cx - 36, base - 33 + Math.round(hh * 2), 8, 1, metalHi);
  // rack toms
  for (const [dx, r] of [[-7, 6], [9, 6]]) {
    rect(g, cx + dx - r, base - 34, r * 2 + 1, 7, P.shell);
    rect(g, cx + dx - r, base - 34, r * 2 + 1, 1, P.shellHi);
    oval(g, cx + dx, base - 34, r, 2, '#e8e0cc');
    if (S.tom > 0.05) alpha(g, S.tom * 0.7, () => oval(g, cx + dx, base - 34, r, 2, '#fffbe8'));
  }
  // the floor tom
  rect(g, cx + 18, base - 20, 13, 18, P.shell); rect(g, cx + 18, base - 20, 13, 1, P.shellHi);
  oval(g, cx + 24, base - 20, 6, 2, '#e8e0cc');
  rect(g, cx + 19, base - 2, 1, 2, stand); rect(g, cx + 29, base - 2, 1, 2, stand);
  // the snare: its head lights on a hit
  rect(g, cx - 30, base - 22, 13, 5, P.shell); rect(g, cx - 30, base - 22, 13, 1, metalHi);
  oval(g, cx - 24, base - 23 - Math.round(sn), 6, 2, sn > 0.05 ? '#fffbe8' : '#e8e0cc');
  rect(g, cx - 25, base - 17, 1, 17, stand);
  // the kick(s): the head pumps
  const kicks = double ? [cx - 8, cx + 10] : [cx];
  kicks.forEach((kx, i) => {
    const r = (double ? 12 : 14) + (k > 0.5 ? 1 : 0);
    const ky = base - r - 1;
    disc(g, kx, ky, r + 1, P.hoop);
    // the hoop's shine, upper left (a dark head needs it to read as a drum)
    if (P.hoopHi) for (let a = 3.5; a < 4.9; a += 0.08) px(g, Math.round(kx + Math.cos(a) * (r + 0.6)), Math.round(ky + Math.sin(a) * (r + 0.6)), P.hoopHi);
    disc(g, kx, ky, r, k > 0.1 ? shadeTo(P.head, -0.25 * k) : P.head);
    disc(g, kx, ky, r - 2, k > 0.1 ? shadeTo(P.headIn, -0.25 * k) : P.headIn);
    if (i === kicks.length - 1 || !double) {
      const label = name, lw = textWidth(label);
      if (lw <= r * 2 - 2) text(g, label, kx - lw / 2, ky - 2, P.headInk);
      else { const [a, b] = splitTwo(label); text(g, a, kx - textWidth(a) / 2, ky - 5, P.headInk); text(g, b, kx - textWidth(b) / 2, ky + 1, P.headInk); }
    }
    rect(g, kx - r + 2, base - 1, 2, 1, stand); rect(g, kx + r - 3, base - 1, 2, 1, stand);
  });
}
function splitTwo(s) { const w = String(s).split(' '); if (w.length < 2) return [s, '']; const h = Math.ceil(w.length / 2); return [w.slice(0, h).join(' '), w.slice(h).join(' ')]; }
// the tape deck: two reels turning while the tape rolls, and the counter
function deck(g, x, y, S, t) {
  rect(g, x, y, 26, 18, '#2b2723'); rect(g, x, y, 26, 1, '#4a443c');
  const ang = S.rolling ? t * 4 : 0;
  for (const rx of [x + 7, x + 19]) {
    disc(g, rx, y + 7, 5, '#8c8478'); disc(g, rx, y + 7, 4, '#3d372f'); disc(g, rx, y + 7, 1, '#cfc6b4');
    for (let s = 0; s < 3; s++) { const a = ang + (s * Math.PI * 2) / 3; px(g, rx + Math.round(Math.cos(a) * 3), y + 7 + Math.round(Math.sin(a) * 3), '#cfc6b4'); }
  }
  rect(g, x + 7, y + 2, 12, 1, '#5b3a22');   // (the tape between them)
  const secs = Math.max(0, Math.floor(S.counter || 0));
  const mm = String(Math.floor(secs / 60) % 100).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  rect(g, x + 4, y + 13, 18, 4, '#111');
  text(g, mm.slice(-1) + ':' + ss, x + 5, y + 13, S.rolling ? '#d9f36a' : '#5f6a3a');
  // the lamp says it's rolling, never red: there is no red light here
  rect(g, x + 23, y + 3, 2, 2, S.rolling ? '#d9f36a' : '#3a3f26');
}
function crate(g, x, y, w, h, c) {
  rect(g, x, y, w, h, c);
  for (let j = 2; j < h; j += 4) rect(g, x + 1, y + j, w - 2, 1, shadeTo(c, -0.35));
  rect(g, x, y, w, 1, shadeTo(c, 0.25));
}
// a colour moved toward white (+) or black (-)
function shadeTo(hex, amt) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = ch((n >> 16) & 255), gg = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}

/* ------------------------------------------------------------------------------------------------ the places */
const LOOK = {
  basement: {
    tolex: '#26262a', tolexHi: '#3c3c42', tolexLo: '#141416', panel: '#9c9a92', knob: '#1a1a1a', grille: '#55524c', grilleHi: '#6e6a62', cone: '#2a2724', cap: '#4a453f', badge: '#d8d2c0',
    shell: '#b8322a', shellHi: '#e0574c', hoop: '#3a3a3a', head: '#e8e0cc', headIn: '#efe6cf', headInk: '#b8322a',
  },
  metal: {
    tolex: '#121214', tolexHi: '#2a2a30', tolexLo: '#000000', panel: '#2c2c32', knob: '#bdbdc4', grille: '#1e1e22', grilleHi: '#34343a', cone: '#0c0c0e', cap: '#26262a', badge: '#9a9aa4',
    shell: '#2a2a33', shellHi: '#5a5a6a', hoop: '#8a8a96', hoopHi: '#c4c4d0', head: '#1a1a20', headIn: '#202028', headInk: '#d0202a',
  },
  bluesbar: {
    tolex: '#c9a66b', tolexHi: '#e2c48a', tolexLo: '#8c6c3c', panel: '#2b2219', knob: '#e9dfc4', grille: '#5e2620', grilleHi: '#7a3a30', cone: '#3a1a14', cap: '#5a3428', badge: '#e9dfc4',
    shell: '#6b4a2b', shellHi: '#9a7148', hoop: '#c9b98a', head: '#efe3c4', headIn: '#f4ead2', headInk: '#3a2414',
  },
};

function basementBack(g, t, S) {
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
  // a high window, the street's light in it
  rect(g, 176, 16, 34, 18, '#26292e'); rect(g, 178, 18, 30, 14, '#1d2b44'); alpha(g, 0.5, () => dither(g, 178, 18, 30, 14, '#3a5578', true)); rect(g, 192, 18, 1, 14, '#26292e');
  // flyers, in riso inks
  const ink = ['#ff48b0', '#0078bf', '#ffe800', '#00a95c'];
  [[120, 30, 14, 18, 0], [138, 26, 12, 16, 1], [222, 40, 13, 17, 2], [100, 44, 11, 14, 3]].forEach(([x, y, w, h, i]) => {
    rect(g, x, y, w, h, ink[i]); alpha(g, 0.35, () => rect(g, x + 2, y + 1, w, h, ink[(i + 1) % 4]));
    for (let j = 4; j < h - 2; j += 3) rect(g, x + 2, y + j, w - 4 - ((j * 7) % 5), 1, '#1a1a1a');
    rect(g, x + w / 2 - 1, y - 1, 3, 2, '#d8d2c0');   // (the tape)
  });
  // the water heater
  rect(g, 70, 40, 16, 56, '#9aa0a6'); rect(g, 70, 40, 16, 2, '#c4c9ce'); rect(g, 71, 42, 2, 54, '#b8bdc2'); rect(g, 76, 34, 4, 6, '#b87333');
  rect(g, 74, 82, 8, 6, '#6a7076'); px(g, 77, 84, '#ff7a3a');
  // the floor, and a rug under the kit
  rect(g, 0, 96, W, 48, '#33363b');
  for (let x = 0; x < W; x += 37) rect(g, x, 110 + ((x * 3) % 17), 9, 1, '#2a2c30');
  rect(g, 84, 106, 104, 22, '#8a3324'); rect(g, 86, 108, 100, 18, '#a8432f');
  for (let x = 90; x < 184; x += 8) { rect(g, x, 112, 4, 2, '#d7743f'); rect(g, x + 4, 120, 4, 2, '#d7743f'); }
}
function basementFront(g, t, S) {
  // the bare bulb, swinging a little on the kick
  const sway = Math.round(Math.sin(t * 3) * (0.5 + S.kick * 1.5));
  rect(g, 100 + sway, 7, 1, 18, '#1a1a1a');
  glow(g, 100 + sway, 27, 26, '#ffd98a', 0.32 + S.kick * 0.18);
  disc(g, 100 + sway, 27, 3, '#fff1c2'); px(g, 99 + sway, 26, '#ffffff');
}
function metalBack(g, t, S) {
  rect(g, 0, 0, W, 96, '#0d0b10');
  // the backdrop and its name
  rect(g, 70, 12, 116, 52, '#1b1820'); rect(g, 70, 12, 116, 1, '#2a2630');
  const nm = 'VOID', k = 4, w = textWidth(nm, k);
  text(g, nm, 128 - w / 2 + 2, 24 + 2, '#3a0a0e', k);
  text(g, nm, 128 - w / 2, 24, '#d0202a', k);
  alpha(g, 0.25 + S.snare * 0.3, () => text(g, nm, 128 - w / 2, 24, '#ff6a5a', k));
  // the truss and its cans
  rect(g, 0, 0, W, 6, '#2a2a30'); for (let x = 0; x < W; x += 8) { px(g, x + 1, 1, '#4a4a52'); px(g, x + 3, 3, '#4a4a52'); px(g, x + 5, 1, '#4a4a52'); }
  // the floor: the stage, and its edge
  rect(g, 0, 96, W, 48, '#17141b');
  for (let y = 100; y < 128; y += 6) rect(g, 0, y, W, 1, '#1f1b24');
  rect(g, 0, 128, W, 2, '#3a3440'); rect(g, 0, 130, W, 14, '#0a090c');
}
function metalFront(g, t, S) {
  // the lights: beams down through the haze, harder on the snare, white on a crash
  const cans = [24, 76, 128, 180, 232];
  cans.forEach((x, i) => {
    rect(g, x - 3, 5, 7, 6, '#202024'); rect(g, x - 2, 10, 5, 1, '#5a5a62');
    const col = S.crash > 0.3 ? '#fff0e0' : i % 2 ? '#8a3cff' : '#ff3030';
    const a = 0.06 + S.snare * 0.16 + S.crash * 0.18 + S.amp * 0.05;
    alpha(g, a, () => { g.fillStyle = col; g.beginPath(); g.moveTo(x - 2, 11); g.lineTo(x + 3, 11); g.lineTo(x + 22, 128); g.lineTo(x - 21, 128); g.closePath(); g.fill(); });
  });
  // haze
  const d = Math.round(t * 6) % 8;
  alpha(g, 0.16, () => { for (let y = 104; y < 128; y += 2) for (let x = ((y >> 1) % 2) * 2 - d; x < W; x += 8) rect(g, x, y, 4, 1, '#8a7aa8'); });
  // wedges at the stage's edge
  for (const x of [34, 206]) { rect(g, x, 120, 18, 8, '#1c1c20'); rect(g, x + 2, 121, 14, 4, '#2a2a30'); }
}
function barBack(g, t, S) {
  // wood panelling, a chair rail, the wainscot
  rect(g, 0, 0, W, 96, '#5a3a26');
  for (let x = 0; x < W; x += 8) { rect(g, x, 0, 1, 96, '#3e2717'); if ((x / 8) % 2) rect(g, x + 1, 0, 7, 96, '#64412b'); }
  rect(g, 0, 64, W, 3, '#3e2717'); rect(g, 0, 67, W, 29, '#4a2e1c');
  // a picture on the wall
  rect(g, 26, 20, 28, 22, '#2a1a10'); rect(g, 28, 22, 24, 18, '#3c4c5a'); rect(g, 28, 34, 24, 6, '#5a4a32'); disc(g, 44, 28, 3, '#c9a24a');
  // the neon: BLUES, pink, with a flicker
  const fl = (Math.sin(t * 13) + Math.sin(t * 31)) > 1.6 ? 0.45 : 1;
  const nm = 'BLUES', k = 2, w = textWidth(nm, k), nx = 178 - w / 2;
  glow(g, 178, 30, 24, '#ff5fa2', 0.22 * fl);
  text(g, nm, nx, 25, fl > 0.5 ? '#ff8cc0' : '#a8426e', k);
  // string lights, warm, breathing with the band
  for (let x = 4; x < W; x += 12) {
    const y = 6 + Math.round(8 * Math.sin((x / W) * Math.PI));
    rect(g, x, y - 2, 1, 2, '#2a1a10');
    disc(g, x, y + 1, 1, '#ffd27a'); glow(g, x, y + 1, 5, '#ffc45a', 0.18 + S.kick * 0.12);
  }
  // the floor: planks
  rect(g, 0, 96, W, 48, '#3a2618');
  for (let y = 100; y < 144; y += 5) rect(g, 0, y, W, 1, '#2e1e12');
  for (let y = 100, i = 0; y < 144; y += 5, i++) for (let x = (i * 23) % 40; x < W; x += 40) rect(g, x, y, 1, 5, '#2e1e12');
  oval(g, 136, 116, 52, 10, '#5a2a22'); oval(g, 136, 116, 48, 8, '#6b3428');
}
function barFront(g) {
  // the chair your amp sits on
  rect(g, 14, 98, 46, 3, '#6b4a2b'); rect(g, 16, 101, 2, 14, '#4a321c'); rect(g, 56, 101, 2, 14, '#4a321c');
}

export function drawRoom(g, place, S = {}, t = 0) {
  const s = { on: false, amp: 0, hit: 0, kick: 0, snare: 0, hat: 0, crash: 0, tom: 0, bass: 0, band: false, rolling: false, counter: 0, heard: 0, ...S };
  const id = LOOK[place] ? place : 'metal', P = LOOK[id];
  g.imageSmoothingEnabled = false;
  if (id === 'basement') {
    basementBack(g, t, s);
    combo(g, 14, 64, 44, 38, P, s, t); crate(g, 12, 102, 48, 10, '#2a5f9e');
    kit(g, 136, 112, P, s, t, { name: 'SUMP PUMP' });
    bassRig(g, 192, 62, 34, 46, P, s, 'combo');
    crate(g, 226, 100, 28, 12, '#2a5f9e'); deck(g, 227, 82, s, t);
    basementFront(g, t, s);
  } else if (id === 'metal') {
    metalBack(g, t, s);
    stack(g, 8, 18, P, s, t);
    kit(g, 136, 114, P, s, t, { double: true, name: 'VOID' });
    bassRig(g, 192, 44, 36, 64, P, s, 'fridge');
    crate(g, 228, 104, 26, 10, '#3a3a40'); deck(g, 228, 86, s, t);
    metalFront(g, t, s);
  } else {
    barBack(g, t, s);
    barFront(g);
    combo(g, 14, 62, 46, 36, P, s, t);
    kit(g, 136, 112, P, s, t, { name: 'LAST CALL' });
    bassRig(g, 194, 66, 32, 40, P, s, 'combo');
    crate(g, 228, 100, 26, 12, '#6b4a2b'); deck(g, 228, 82, s, t);
  }
  // heard it: the room leans in (a warm wash for a moment)
  if (s.heard > 0.02) alpha(g, s.heard * 0.18, () => rect(g, 0, 0, W, H, '#ffe9b0'));
}

/* ------------------------------------------------------------------------------------------------ what you bring */
export function drawThing(g, kind, { dim = false } = {}) {
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 64, 64);
  const ink = (c) => (dim ? shadeTo(c, -0.55) : c);
  if (kind === 'electric') {
    // the neck, the headstock and its tuners
    rect(g, 30, 4, 5, 9, ink('#3a2a1a')); for (let y = 5; y < 12; y += 2) { px(g, 29, y, ink('#d8d2c0')); px(g, 35, y, ink('#d8d2c0')); }
    rect(g, 31, 12, 3, 26, ink('#e0b878')); for (let y = 15; y < 38; y += 3) rect(g, 31, y, 3, 1, ink('#9c8a6a'));
    // the body: a double cutaway, in red
    const body = (x, y) => {
      const lo = (x - 32) ** 2 + (y - 49) ** 2 <= 169;
      const up = ((x - 32) / 10) ** 2 + ((y - 38) / 9) ** 2 <= 1;
      const hornL = ((x - 24) / 4) ** 2 + ((y - 31) / 6) ** 2 <= 1, hornR = ((x - 40) / 4) ** 2 + ((y - 29) / 7) ** 2 <= 1;
      return (lo || up || hornL || hornR) && (x - 32) ** 2 + (y - 27) ** 2 > 36;
    };
    for (let y = 20; y < 62; y++) for (let x = 14; x < 50; x++) {
      if (!body(x, y)) continue;
      const edge = !body(x - 1, y) || !body(x + 1, y) || !body(x, y - 1) || !body(x, y + 1);
      const hi = (x - 28) ** 2 + (y - 44) ** 2 < 30;
      px(g, x, y, ink(edge ? '#6e1a14' : hi ? '#ff6a5a' : '#d23a32'));
    }
    // the guard, pickups, bridge, knobs
    for (let y = 40; y < 56; y++) for (let x = 24; x < 38; x++) if (((x - 30) / 8) ** 2 + ((y - 47) / 8) ** 2 <= 1 && body(x, y)) px(g, x, y, ink('#efe6cf'));
    rect(g, 29, 41, 7, 2, ink('#1a1a1a')); rect(g, 29, 46, 7, 2, ink('#1a1a1a')); rect(g, 28, 52, 9, 2, ink('#b8b8b8'));
    rect(g, 31, 38, 3, 16, ink('#e0b878')); rect(g, 31, 41, 3, 2, ink('#1a1a1a')); rect(g, 31, 46, 3, 2, ink('#1a1a1a'));
    for (let s2 = 0; s2 < 3; s2++) px(g, 32 + (s2 - 1), 13, ink('#ffffff'));
    rect(g, 32, 13, 1, 40, ink('#efe6cf'));
    disc(g, 41, 53, 1, ink('#d8d2c0')); disc(g, 44, 49, 1, ink('#d8d2c0'));
  } else if (kind === 'acoustic') {
    rect(g, 30, 4, 5, 9, ink('#3a2a1a')); for (let y = 5; y < 12; y += 2) { px(g, 29, y, ink('#d8d2c0')); px(g, 35, y, ink('#d8d2c0')); }
    rect(g, 31, 12, 3, 22, ink('#6a4024')); for (let y = 15; y < 34; y += 3) rect(g, 31, y, 3, 1, ink('#c9b98a'));
    const body = (x, y) => ((x - 32) / 10) ** 2 + ((y - 36) / 9) ** 2 <= 1 || ((x - 32) / 14) ** 2 + ((y - 50) / 11) ** 2 <= 1;
    for (let y = 26; y < 62; y++) for (let x = 16; x < 48; x++) {
      if (!body(x, y)) continue;
      const edge = !body(x - 1, y) || !body(x + 1, y) || !body(x, y - 1) || !body(x, y + 1);
      px(g, x, y, ink(edge ? '#5a3a1e' : (x + y) % 9 === 0 ? '#d9b072' : '#e8c58a'));
    }
    disc(g, 32, 40, 5, ink('#c9a06a')); disc(g, 32, 40, 4, ink('#2a1a10'));
    rect(g, 26, 51, 13, 3, ink('#3a2414'));
    rect(g, 32, 13, 1, 38, ink('#efe6cf'));
  } else if (kind === 'keys') {
    rect(g, 6, 22, 52, 24, ink('#2a2a2e')); rect(g, 6, 22, 52, 1, ink('#46464c'));
    rect(g, 9, 25, 46, 3, ink('#16130f')); for (let i = 0; i < 6; i++) disc(g, 12 + i * 4, 26, 1, ink('#d9f36a'));
    for (let i = 0; i < 11; i++) rect(g, 9 + i * 4 + (i ? 0 : 0), 30, 3, 14, ink('#f4ead6'));
    for (const i of [0, 1, 3, 4, 5, 7, 8]) rect(g, 11 + i * 4, 30, 2, 8, ink('#16130f'));
  } else if (kind === 'voice') {
    for (let y = 8; y < 30; y++) for (let x = 22; x < 42; x++) {
      if (((x - 32) / 9) ** 2 + ((y - 18) / 10) ** 2 > 1) continue;
      px(g, x, y, ink((x + y) % 2 ? '#b8b8b8' : '#8a8a8a'));
    }
    rect(g, 23, 26, 18, 3, ink('#d8d2c0'));
    rect(g, 28, 29, 8, 20, ink('#2a2a2e')); rect(g, 28, 29, 1, 20, ink('#46464c'));
    rect(g, 31, 49, 2, 10, ink('#1a1a1a')); rect(g, 22, 58, 20, 2, ink('#1a1a1a'));
  }
}

/* ------------------------------------------------------------------------------------------------ the tape box */
export function drawTape(g, { label = 'TAKE 1', sub = '', t = 0 } = {}) {
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 128, 80);
  // the shell
  rect(g, 4, 6, 120, 70, '#1e1c1a'); rect(g, 4, 6, 120, 1, '#3a3632'); rect(g, 6, 8, 116, 66, '#26231f');
  // the label, cream, written on in grease pencil
  rect(g, 12, 12, 104, 34, '#f4ead6'); rect(g, 12, 12, 104, 6, '#d9f36a');
  text(g, label, 16, 13, '#16130f');
  const lines = String(sub).toUpperCase().split('\n');
  lines.slice(0, 3).forEach((ln, i) => text(g, ln.slice(0, 25), 16, 22 + i * 7, '#4c4336'));
  // the window and its reels
  rect(g, 34, 50, 60, 16, '#100e0c');
  for (const rx of [48, 80]) {
    disc(g, rx, 58, 7, '#5b3a22'); disc(g, rx, 58, 4, '#cfc6b4'); disc(g, rx, 58, 2, '#26231f');
    for (let s = 0; s < 3; s++) { const a = t * 3 + (s * Math.PI * 2) / 3; px(g, rx + Math.round(Math.cos(a) * 3), 58 + Math.round(Math.sin(a) * 3), '#26231f'); }
  }
  for (const x of [14, 108]) disc(g, x, 68, 2, '#3a3632');
}
