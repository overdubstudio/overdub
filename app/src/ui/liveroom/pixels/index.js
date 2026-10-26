// The room in pixels [ui; stream E] (docs/research/LIVE-ROOM-MODE.md §3.1, §3.13, §3.18, §3.19): each place as a 256 x
// 144 room with its gear and the console ledge along its bottom, the door's crops of them, the tape box's cover, and
// the part of the scene a phone shows. Drawn with fillStyle, fillRect and globalAlpha only, at whole pixels, in
// '#rrggbb' colours (./paint.js), so a Node check draws them into a buffer and gets the browser's pixels
// (tools/liveroom/checks-pixels.js); the stage scales the canvas up a whole number of pixels at a time
// (image-rendering: pixelated).
//
// Frozen (§14.2):
//   W 256, H 144                 the scene's size, in scene pixels
//   LEDGE 14                     the console ledge: the strip along the bottom of every scene (its talkback lamp, the
//                                tape counter in green, two VU needles on the master); a click on it is the glass
//   sceneOf(place) -> { draw(g, view, now) }   a place's scene ('metal', 'basement', 'bluesbar', 'kitchen'; anything
//                                else is the bare room before a place). draw paints one whole frame over a W x H
//                                canvas from the view alone: the same view gives the same pixels, whatever `now` is
//   drawCrop(g, place, size, view?)   a door card's crop of a place's room at (0, 0), size: { w, h } in scene pixels
//                                (at most W x H), framed on the place's kit and its walls, the ledge left out while
//                                the crop is no taller than the room above it. Still, unless a view is given (a bar
//                                of the band on a focused card: the view's hits move it)
//   drawCover(g, cover, size)    a tape box's cover at (0, 0), size: { w, h } (./cover.js: the starburst, one spike per
//                                bar). cover: core/liveroom/label.js labelOf(p).cover, { title, key, tempo, bars }
//   windowFor(view) -> { x, y, w, h }   the part of the scene a phone shows (§3.18): 192 x 108 (the kitchen's strip
//                                192 x 72), framed on what the step is about (all of it, with the ledge in view when
//                                that still shows all of it: an amp's head and its lamps come first), panned there in
//                                whole pixels over 200 ms (a cut under reduced motion, or with no view.now)
//
// The view (the stage's: core/liveroom/session.js readRoom(p), plus what's live). Everything is optional; what's
// missing is quiet (nothing lit, nothing moving):
//   live: { input, L, R, kick, snare, hat, crash, tom, bass, shaker, cajon, master: [l, r] }   levels and hit envelopes
//       in 0..1 (the prototype's mapping: -48 dB is 0, -6 dB is 1; a hit is 1 on the note and decays). input: your
//       input (your amp follows it, the right one while you play the other side); L, R: each guitar side's own meter
//       (the left from Guitar L, the right from Guitar R, or the blues bar's Lead); bass: the Bass track's meter;
//       master: the master's meter per side (the ledge's VU needles)
//   run: the deck's state ('count', 'take', 'double', 'punch', 'play', 'loop', 'read', ...); rolling (boolean): the
//       tape rolls (left out: while run is any of those but 'read'); beat: the heard beat (the reels turn a quarter turn a beat while the tape rolls);
//       bar: the counter's bar (left out: from the beat); count: the count's number on the kick head while it counts;
//       loading: how much of the drummer's kit is in, 0..1, on the kick head until it is (the count waits for it)
//   side: 'L' | 'R', which side you're playing; doubled: the second amp's cover is off (left out: once a card has a
//       right take, or while you play the right); plugged: the input is open (the pilot lamps; left out: input > 0);
//       learning: the band is reading a take (the bass rig's lamp warms; left out: run 'read'); talk: a new line on the
//       talkback (the ledge's lamp); ending: the band is playing its ending (the blues bar's LAST CALL sign); heard:
//       you've played your first note (the blues bar's neon; left out: once a card has a take); title: the song's
//       title (the basement's flyer; 'Untitled' is none); invited: { shaker, cajon, bass, strings } (the kitchen's
//       players; left out: from the roles readRoom gives); reduced: prefers-reduced-motion (left out: the browser's
//       setting); focus or step: what the phone's window frames ('amp' | 'amps' | 'kit' | 'bass', or a step:
//       'soundcheck', 'double', 'feel', 'bass'); now: the frame's time in ms (only the window's pan reads it)
// Under reduced motion nothing shakes, sways, swings or pans and the reels stand still; the lamps, the panel meters,
// the VU faces and the counter still follow their signals.

import { W, H, drawScene, LAYOUT, signalsOf } from './scenes.js';
import { drawCoverArt } from './cover.js';

export { W, H };
export const LEDGE = 14;

export function sceneOf(place) {
  const id = typeof place === 'string' ? place : null;
  return {
    draw(g, view, now) {
      drawScene(g, id, view);
    },
  };
}

// A context that draws a part of the scene: the scenes set fillStyle and globalAlpha and call fillRect (nothing else),
// so a crop is those calls moved by (dx, dy) and cut to the size.
function cropOf(g, dx, dy, w, h) {
  return {
    get fillStyle() { return g.fillStyle; },
    set fillStyle(c) { g.fillStyle = c; },
    get globalAlpha() { return g.globalAlpha; },
    set globalAlpha(a) { g.globalAlpha = a; },
    fillRect(x, y, rw, rh) {
      const x0 = Math.max(0, x - dx), y0 = Math.max(0, y - dy), x1 = Math.min(w, x - dx + rw), y1 = Math.min(h, y - dy + rh);
      if (x1 > x0 && y1 > y0) g.fillRect(x0, y0, x1 - x0, y1 - y0);
    },
  };
}
const whole = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? Math.round(v) : d));
const STILL = Object.freeze({ reduced: true });

export function drawCrop(g, place, size = { w: 128, h: 96 }, view = null) {
  const w = whole(size?.w, 1, W, 128), h = whole(size?.h, 1, H, 96);
  const f = LAYOUT[place]?.focus || { x: 64, y: 20, w: 128, h: 110 };
  const room = h <= H - LEDGE ? H - LEDGE : H;
  const dx = whole(f.x + f.w / 2 - w / 2, 0, W - w, 0), dy = whole(Math.max(f.y + f.h / 2 - h / 2, f.y + f.h - h), 0, room - h, 0);
  drawScene(cropOf(g, dx, dy, w, h), place, view && typeof view === 'object' ? view : STILL);
}

export function drawCover(g, cover, size = { w: 128, h: 80 }) {
  const w = whole(size?.w, 4, 512, 128), h = whole(size?.h, 4, 512, 80);
  drawCoverArt(cropOf(g, 0, 0, w, h), cover, { w, h });
}

/* ------------------------------------------------------------------------------------------------ the phone's window */
const PHONE = Object.freeze({ w: 192, h: 108, strip: 72, pan: 200 });
const STEP_FOCUS = { soundcheck: 'amp', plug: 'amp', level: 'amp', tune: 'amp', lineup: 'amp', amp: 'amp', double: 'amps', other: 'amps', side: 'amps', feel: 'kit', drums: 'kit', count: 'kit', bass: 'bass', bassYours: 'bass' };
function targetOf(view) {
  const v = view && typeof view === 'object' ? view : {};
  const place = typeof v.place === 'string' ? v.place : null, L = LAYOUT[place];
  const kitchen = place === 'kitchen', w = PHONE.w, h = kitchen ? PHONE.strip : PHONE.h;
  const word = typeof v.focus === 'string' ? v.focus : STEP_FOCUS[v.step] || (v.side === 'R' && !kitchen ? 'amps' : null);
  let b = null;
  if (L && !kitchen) {
    if (word === 'amp') b = v.side === 'R' ? L.ampR : L.ampL;
    else if (word === 'amps') {
      const x0 = Math.min(L.ampL.x, L.ampR.x), y0 = Math.min(L.ampL.y, L.ampR.y);
      b = { x: x0, y: y0, w: Math.max(L.ampL.x + L.ampL.w, L.ampR.x + L.ampR.w) - x0, h: Math.max(L.ampL.y + L.ampL.h, L.ampR.y + L.ampR.h) - y0 };
    } else if (word === 'kit') b = L.kit;
    else if (word === 'bass') b = L.bass;
  } else if (L && kitchen && word === 'kit') b = L.kit;
  // framed on what the step is about, the ledge in view whenever that still shows all of it (the amps' heads first)
  const f = b || L?.focus || { x: 64, y: 20, w: 128, h: 110 };
  const y = b ? whole(Math.min(H - h, f.y - 4), 0, H - h, H - h) : H - h;
  return { place, x: whole(f.x + f.w / 2 - w / 2, 0, W - w, 0), y, w, h };
}
// the window on screen now: a pan from where it was to where the step wants it (state kept here, one stage at a time)
let shown = null;
const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
const at = (p, now, k) => Math.round(p.from[k] + (p.to[k] - p.from[k]) * easeOut(Math.max(0, Math.min(1, (now - p.t0) / PHONE.pan))));
export function windowFor(view) {
  const t = targetOf(view), now = Number(view?.now), out = { x: t.x, y: t.y, w: t.w, h: t.h };
  if (!Number.isFinite(now) || signalsOf(view).reduced || !shown || shown.place !== t.place || shown.w !== t.w || shown.h !== t.h || now < shown.t) {
    const n = Number.isFinite(now) ? now : 0;
    shown = { place: t.place, w: t.w, h: t.h, from: { x: t.x, y: t.y }, to: { x: t.x, y: t.y }, t0: n, t: n };
    return out;
  }
  if (t.x !== shown.to.x || t.y !== shown.to.y) shown = { ...shown, from: { x: at(shown, now, 'x'), y: at(shown, now, 'y') }, to: { x: t.x, y: t.y }, t0: now };
  shown.t = now;
  out.x = at(shown, now, 'x');
  out.y = at(shown, now, 'y');
  return out;
}
