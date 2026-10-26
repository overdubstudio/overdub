// The pixels' brushes [ui; stream E] (docs/research/LIVE-ROOM-MODE.md §3.19): everything a room is drawn with. Each
// one sets fillStyle and globalAlpha and calls fillRect at whole pixels, and nothing else, so the same calls draw into
// a browser's canvas or a Node check's buffer (tools/liveroom/checks-pixels.js) and give the same pixels. Colours are
// always '#rrggbb'; a softer colour is a globalAlpha over what's there, never an rgba() string.
//
//   rect(g, x, y, w, h, c)          a filled box, rounded to whole pixels
//   px(g, x, y, c)                  one pixel
//   disc(g, cx, cy, r, c), oval(g, cx, cy, rx, ry, c), ring(g, cx, cy, r, c)
//   line(g, x0, y0, x1, y1, c)      a one-pixel line (Bresenham)
//   glow(g, cx, cy, r, c, a)        a lamp's light: three discs at rising alpha
//   alpha(g, a, fn)                 fn drawn at globalAlpha a (put back after)
//   dither(g, x, y, w, h, c, step)  every other pixel of a box (step 4: every fourth)
//   shade(c, amt)                   a colour toward white (+) or black (-)
//   mix(a, b, t)                    a colour between two
//   rnd(seed)                       a small seeded random, so the same bricks come out every time
//   hash(str)                       a string's 32-bit seed
//   text(g, str, x, y, c, k), textWidth(str, k)   the 3 x 5 pixel font (capitals, digits and a little punctuation)
//   clamp01(x)                      a level made safe: a number in 0..1 (anything else is 0)
//   W, H                            the scene's size, 256 x 144

export const W = 256, H = 144;

export const rect = (g, x, y, w, h, c) => {
  const x0 = Math.round(x), y0 = Math.round(y), w0 = Math.round(w), h0 = Math.round(h);
  if (w0 <= 0 || h0 <= 0) return;
  g.fillStyle = c;
  g.fillRect(x0, y0, w0, h0);
};
export const px = (g, x, y, c) => rect(g, x, y, 1, 1, c);

export function disc(g, cx, cy, r, c) {
  g.fillStyle = c;
  const x = Math.round(cx), y0 = Math.round(cy), R = Math.max(0, Math.round(r));
  for (let y = -R; y <= R; y++) {
    const w = Math.floor(Math.sqrt(R * R - y * y) + 0.35);
    g.fillRect(x - w, y0 + y, 2 * w + 1, 1);
  }
}
export function oval(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  const x = Math.round(cx), y0 = Math.round(cy), RX = Math.max(0, Math.round(rx)), RY = Math.max(0, Math.round(ry));
  if (!RY) { g.fillRect(x - RX, y0, 2 * RX + 1, 1); return; }
  for (let y = -RY; y <= RY; y++) {
    const w = Math.floor(RX * Math.sqrt(Math.max(0, 1 - (y * y) / (RY * RY))) + 0.35);
    g.fillRect(x - w, y0 + y, 2 * w + 1, 1);
  }
}
// a circle's edge, one pixel wide
export function ring(g, cx, cy, r, c) {
  g.fillStyle = c;
  const x0 = Math.round(cx), y0 = Math.round(cy), R = Math.max(1, Math.round(r));
  let x = R, y = 0, e = 1 - R;
  while (x >= y) {
    for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) g.fillRect(x0 + a, y0 + b, 1, 1);
    y++;
    if (e < 0) e += 2 * y + 1;
    else { x--; e += 2 * (y - x) + 1; }
  }
}
export function line(g, x0, y0, x1, y1, c) {
  g.fillStyle = c;
  let x = Math.round(x0), y = Math.round(y0);
  const X = Math.round(x1), Y = Math.round(y1), dx = Math.abs(X - x), dy = -Math.abs(Y - y), sx = x < X ? 1 : -1, sy = y < Y ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 512; n++) {
    g.fillRect(x, y, 1, 1);
    if (x === X && y === Y) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x += sx; }
    if (e2 <= dx) { e += dx; y += sy; }
  }
}
export function alpha(g, a, fn) {
  const was = g.globalAlpha;
  g.globalAlpha = Math.max(0, Math.min(1, a));
  try { fn(); } finally { g.globalAlpha = was; }
}
export function glow(g, cx, cy, r, c, a) {
  if (!(a > 0.01)) return;
  for (let k = 3; k >= 1; k--) alpha(g, Math.min(1, a * 0.22 * (4 - k)), () => disc(g, cx, cy, Math.round((r * k) / 3), c));
}
export function dither(g, x, y, w, h, c, step = 2) {
  g.fillStyle = c;
  const X = Math.round(x), Y = Math.round(y);
  for (let j = 0; j < h; j++) for (let i = (j * (step === 2 ? 1 : 2)) % step; i < w; i += step) g.fillRect(X + i, Y + j, 1, 1);
}

const HEX = /^#([0-9a-f]{6})$/i;
const rgbOf = (c) => { const m = HEX.exec(c); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hexOf = (r, g, b) => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
export function shade(c, amt) {
  const [r, g, b] = rgbOf(c), f = (v) => (amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  return hexOf(f(r), f(g), f(b));
}
export function mix(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b), u = Math.max(0, Math.min(1, t));
  return hexOf(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
}
export function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export const clamp01 = (x) => (typeof x === 'number' && x > 0 ? Math.min(1, x) : 0);

// a 3 x 5 font: rows of three, top to bottom
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', "'": '010010000000000',
  '/': '001001010100100', '#': '101111101111101', '&': '010101010101011', '!': '010010010000010', ',': '000000000010100',
  '?': '110001010000010', '(': '010100100100010', ')': '010001001001010', '+': '000010111010000', '×': '000101010101000',
};
// (letters the font doesn't have, folded to ones it does)
const FOLD = { 'À': 'A', 'Á': 'A', 'Â': 'A', 'Ä': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Í': 'I', 'Ï': 'I', 'Ó': 'O', 'Ö': 'O', 'Ô': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N', 'Ç': 'C', '♭': 'B', '♯': '#', '’': "'", '‘': "'", '–': '-', '—': '-' };
export const glyphs = (str) => [...String(str).toUpperCase()].map((ch) => FOLD[ch] || ch);
export function text(g, str, x, y, c, k = 1) {
  g.fillStyle = c;
  let cx = Math.round(x);
  const Y = Math.round(y);
  for (const ch of glyphs(str)) {
    const f = FONT[ch];
    if (f) for (let i = 0; i < 15; i++) if (f[i] === '1') g.fillRect(cx + (i % 3) * k, Y + Math.floor(i / 3) * k, k, k);
    cx += 4 * k;
  }
}
export const textWidth = (str, k = 1) => Math.max(0, glyphs(str).length * 4 * k - k);
export const hasGlyph = (ch) => !!FONT[ch];
