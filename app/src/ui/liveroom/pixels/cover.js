// The tape box's cover [ui; stream E] (docs/research/LIVE-ROOM-MODE.md §3.13): Claw'd-o-Matic's starburst, drawn from
// the song. One spike per bar, each as long as that bar is full; the palette seeded by the title, the key and the
// tempo, so a song keeps its cover and two songs rarely share one. Drawn with ./paint.js's calls only (fillStyle and
// fillRect, the pixels of a row merged into one rect), inside the size it's given and nowhere else.
//
//   drawCoverArt(g, cover, { w, h })
//       cover: { title, key, tempo, bars } (core/liveroom/label.js labelOf(p).cover). bars: each bar's fill in 0..1
//       (an array), or how many bars (a number; their lengths then come from the seed). Anything missing is a blank
//       tape's cover: sixteen spikes on the house's ground.

import { hash, rnd, clamp01 } from './paint.js';

// grounds and the inks that read on each (BRAND's track inks, the riso inks, cream and graphite; never red)
const DARK = ['#16130f', '#1d2b44', '#2e2140', '#24311f', '#2a241c', '#22385e'];
const LIGHT = ['#f4ead6', '#d9c8a4', '#e8dcc0'];
const ON_DARK = ['#dcb45e', '#a8c470', '#95c6a8', '#a2a6c6', '#b69cd8', '#e68ba8', '#f1dc8a', '#ffe800', '#ff48b0', '#f4ead6', '#d9f36a'];
const ON_LIGHT = ['#0078bf', '#00a95c', '#22385e', '#16130f', '#ff48b0', '#2e2140', '#4c4336'];
const MAX_BARS = 256;

export function paletteOf(cover) {
  const c = cover && typeof cover === 'object' ? cover : {};
  const seed = hash(`${c.title ?? ''}|${c.key ?? ''}|${c.tempo ?? ''}`), R = rnd(seed);
  const light = R() < 0.3, ground = (light ? LIGHT : DARK)[Math.floor(R() * (light ? LIGHT : DARK).length)];
  const inks = (light ? ON_LIGHT : ON_DARK).slice();
  const a = inks.splice(Math.floor(R() * inks.length), 1)[0], b = inks.splice(Math.floor(R() * inks.length), 1)[0];
  return { seed, ground, a, b };
}

export function barsOf(cover, seed) {
  const c = cover && typeof cover === 'object' ? cover : {};
  if (Array.isArray(c.bars) && c.bars.length) return c.bars.slice(0, MAX_BARS).map((x) => clamp01(Number(x)));
  const n = Number.isFinite(c.bars) && c.bars >= 1 ? Math.min(MAX_BARS, Math.floor(c.bars)) : 16, R = rnd(seed ^ 0x9e3779b9);
  return Array.from({ length: n }, () => 0.35 + R() * 0.65);
}

export function drawCoverArt(g, cover, size) {
  const w = Math.max(4, Math.min(512, Math.round(size?.w) || 128)), h = Math.max(4, Math.min(512, Math.round(size?.h) || 80));
  const pal = paletteOf(cover), bars = barsOf(cover, pal.seed), n = bars.length;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, reach = Math.hypot(w, h) / 2, r0 = Math.max(2, Math.min(w, h) * 0.2);
  const step = (Math.PI * 2) / n, base = Math.min(3, ((Math.PI * r0) / n) * 0.55);
  const lens = bars.map((v) => r0 + 2 + (reach - r0 - 2) * (0.3 + 0.7 * v));
  g.globalAlpha = 1;
  g.fillStyle = pal.ground;
  g.fillRect(0, 0, w, h);
  // each pixel: the spike it's nearest, and whether it's inside that spike's wedge
  const colorAt = (x, y) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r <= r0) return r <= r0 * 0.35 ? pal.ground : pal.b;
    const th = Math.atan2(dy, dx) + Math.PI / 2, k = ((Math.round(th / step) % n) + n) % n;
    const off = Math.abs(Math.atan2(Math.sin(th - k * step), Math.cos(th - k * step))) * r, L = lens[k];
    if (r > L) return null;
    return off <= base * (1 - (r - r0) / (L - r0)) + 0.5 ? (k % 2 ? pal.b : pal.a) : null;
  };
  for (let y = 0; y < h; y++) {
    let run = null, from = 0;
    for (let x = 0; x <= w; x++) {
      const c = x < w ? colorAt(x, y) : null;
      if (c === run) continue;
      if (run) { g.fillStyle = run; g.fillRect(from, y, x - from, 1); }
      run = c; from = x;
    }
  }
}
