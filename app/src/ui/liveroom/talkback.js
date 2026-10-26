// The talkback [ui; stream C owns it after the foundation] (docs/research/LIVE-ROOM-MODE.md §3.16): the strip under
// the stage the room speaks through. A small square lamp that lights when a line is new, the line itself (two
// sentences at most), and a polite live region that reads it. The house speaks unsigned; an agent's line carries its
// byline in its ink (ui/dom.js byline), as everywhere.
//
//   createTalkback({ app }) -> { el, say(text, { by }), frame(now), clear() }
//       say: the line now ('overdub', the house, by default); frame dims the lamp a few seconds after; clear empties it

import { h, byline } from '../dom.js';

const LIT_MS = 4000;

export function createTalkback({ app = null } = {}) {
  const lamp = h('i.lr-tb-lamp', { 'aria-hidden': 'true' });
  const by = h('span.lr-tb-by');
  const line = h('span.lr-tb-line');
  const el = h('div.lr-talkback', lamp, h('p.lr-tb-text', { role: 'status', 'aria-live': 'polite' }, by, line));
  let litAt = -Infinity;
  return {
    el,
    say(text, { by: who = 'overdub' } = {}) {
      const sign = who && who !== 'overdub' ? byline(who, { app }) : null;
      by.replaceChildren(...(sign ? [sign, ' '] : []));
      line.textContent = String(text ?? '');
      lamp.classList.add('lr-on');
      litAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    },
    frame(now) {
      if (now - litAt > LIT_MS && lamp.classList.contains('lr-on')) lamp.classList.remove('lr-on');
    },
    clear() { by.replaceChildren(); line.textContent = ''; lamp.classList.remove('lr-on'); },
  };
}
