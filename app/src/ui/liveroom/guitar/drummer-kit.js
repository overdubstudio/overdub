// The kit on the riser [ui; the guitar room's DRUMMER stream] (design/mock/guitar-room-2/room-pixels.js drawKit; docs/
// BRAND.md "The live room": pixels for the room, no people, no red pixel). Its own canvas with bigger pixels than the
// walls' (KIT.px world units each): it's the thing on the riser people look at. The hits move it (the kick's head
// pumps, the snare jumps, the hats close, the crash tips), the drummer's sticks cross over the snare while they count
// you in, the count's number on the kick head, the kit's samples still coming in written there too.
//
//   KIT = { px: 6, w: 100, h: 56, cx: 50, base: 50, x: 540, y: 160 }   the canvas in kit pixels and where it stands
//                                    (world: 540..1140, 160..496; the feet on the riser's top at 460)
//   createKit(el) -> { canvas, draw(s), dispose() }   s: { kick, snare, hat, crash, tom (0..1 envelopes), count (the
//                                    count's number, or null), tap (0..1: a stick click just now), loading (0..1 or
//                                    null), reduced }
//   hitsAt(track, beat, spb) -> { kick, snare, hat, crash, tom }   the envelopes at a beat from a drum track's notes
//                                    (1 on the hit, falling over about 120 ms; core/liveroom view.js's rule)

import { kit } from '../pixels/gear.js';
import { line, glow } from '../pixels/paint.js';
import { LOOK } from '../pixels/scenes.js';

export const KIT = Object.freeze({ px: 6, w: 100, h: 56, cx: 50, base: 50, x: 540, y: 160 });

const PIECE = { 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 39: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 46: 'hat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'crash', 53: 'crash', 59: 'crash', 41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom' };
const DECAY = 0.12;
export function hitsAt(track, beat, spb) {
  const out = { kick: 0, snare: 0, hat: 0, crash: 0, tom: 0 };
  if (!track || beat == null) return out;
  for (const c of track.clips || []) {
    if (c.mute || c.kind !== 'notes' || beat < c.start - 1e-6 || beat > c.start + c.length + 0.5) continue;
    for (const n of c.notes || []) {
      const at = c.start + n.t, ago = (beat - at) * spb;
      if (ago < 0 || ago > 0.5 || at > c.start + c.length + 1e-6) continue;
      const k = PIECE[n.p];
      if (!k) continue;
      const e = Math.min(1, (n.v ?? 0.8) * 1.3) * Math.exp(-ago / DECAY);
      if (e > out[k]) out[k] = e;
    }
  }
  return out;
}

export function createKit(el) {
  const cv = document.createElement('canvas');
  cv.className = 'grd-kit';
  cv.width = KIT.w; cv.height = KIT.h;
  Object.assign(cv.style, { left: KIT.x + 'px', top: KIT.y + 'px', width: KIT.w * KIT.px + 'px', height: KIT.h * KIT.px + 'px' });
  cv.setAttribute('aria-hidden', 'true');
  el.append(cv);
  const g = cv.getContext('2d');
  let last = '';
  return {
    canvas: cv,
    draw(s) {
      // (nothing moved: nothing drawn; the frame asks every tick)
      const q = (x) => Math.round((x || 0) * 20);
      const key = [q(s.kick), q(s.snare), q(s.hat), q(s.crash), q(s.tom), s.count ?? '', q(s.tap), s.loading == null ? '' : Math.floor(s.loading * 100), s.reduced ? 1 : 0].join();
      if (key === last || !g) return;
      last = key;
      g.clearRect(0, 0, cv.width, cv.height);
      const L = { ...LOOK.metal }, cx0 = KIT.cx, base = KIT.base;
      kit(g, cx0, base, L, s, { double: true, name: s.count != null ? '' : 'VOID' });
      const cx = cx0 - 24, cy = base - 40;
      if (s.count != null) {
        // the sticks crossed over the snare, clicking
        const tap = s.reduced ? 0 : s.tap || 0, o = Math.round(tap * 2);
        line(g, cx - 10, cy - 8 + o, cx + 6, cy + 4, '#e8dcc0'); line(g, cx + 10, cy - 8 + o, cx - 6, cy + 4, '#e8dcc0');
        if (tap > 0.5) glow(g, cx, cy + 1, 4, '#fff2c0', tap * 0.8);
      } else {
        // resting on the floor tom
        line(g, cx0 + 18, base - 22, cx0 + 30, base - 26, '#c9b98a');
        line(g, cx0 + 19, base - 21, cx0 + 31, base - 24, '#c9b98a');
      }
    },
    dispose() { cv.remove(); },
  };
}
