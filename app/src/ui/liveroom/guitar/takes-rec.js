// The recording view [ui; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.6; design/mock/guitar-room/
// shots 05a-05c, 06a; AJ: "the recording view dims the studio, with a tasteful overlay of big controls"). In R.el.over,
// over the whole room but the strip (the talkback stays readable): the part, the count or the bar, what's coming in on
// the bar grid as it's played, and the three things a foot or one key can do, in words big enough to read from where
// you stand. Nothing on it takes a key: the room's key table holds every key but Space, R, Esc and ⌘G while a count or a
// take runs (./keys.js 'rec'); its words are buttons for a mouse too, never focused.
//
//   createRecView(R) -> { show(pass), hide(), frame(pass), shown() }
//     pass = { side, name, n (the take's number on its side), from (the part's 1, beats), bars (the part's, or null for a
//       new one), count (the count's beats, 0 for none), bpb, prev (the part before, or null), countOn }
//     frame(pass): from the shell's loop: the count's numeral or the bar, and the strip (the input's level, read now,
//       laid on the grid where the transport is: what you play, where you play it; the part's end marked)

import { h } from '../../dom.js';

export function createRecView(R) {
  const over = R.el.over;
  const lamp = h('i.grt-lampx', { 'aria-hidden': 'true' });
  const top = h('span');
  const part = h('p.grt-rec-part');
  const count = h('div.grt-rec-count', { 'aria-live': 'off' });
  const bar = h('div.grt-rec-bar', { 'aria-live': 'off' });
  const cv = h('canvas', { 'aria-hidden': 'true' });
  const strip = h('div.grt-rec-strip', cv);
  const key = (k, word, id) => h('button.grt-rk', { type: 'button', tabindex: -1, dataset: { act: id }, onpointerdown: (e) => e.preventDefault(), onclick: () => R.press(id) }, h('kbd', k), word);
  const kStop = key('Space', 'Stop', 'stop'), kAgain = key('R', 'Start again', 'again'), kToss = key('Esc', 'Toss it', 'toss');
  const note = h('p.grt-rec-note');
  const sub = h('p.grt-rec-note');
  const box = h('div.grt-rec-box', { role: 'dialog', 'aria-label': 'Recording', style: { display: 'contents' } },
    h('div.grt-rec-top', lamp, top), part, count, bar, strip, sub, h('div.grt-rec-keys', kStop, kAgain, kToss), note);
  let on = false, phase = null, cols = [], lastBeat = null, size = { w: 0, h: 0, d: 1 };

  function show(P) {
    if (!box.isConnected) over.replaceChildren(box);
    over.classList.add('grt-rec');
    over.dataset.takes = '1';
    over.hidden = false;
    on = true;
    phase = null;
    cols = [];
    lastBeat = null;
    paint(P, true);
  }
  function hide() {
    if (!on) return;
    on = false;
    over.hidden = true;
    over.classList.remove('grt-rec');
    delete over.dataset.takes;
  }
  function paint(P, force = false) {
    const e = R.app.engine;
    const b = Number.isFinite(e?.beat) ? e.beat : P.from;
    const counting = R.L.run === 'count' || !e?.playing || b < P.from - 1e-6;
    const ph = counting ? 'count' : 'take';
    if (ph !== phase || force) {
      phase = ph;
      lamp.classList.toggle('grt-recl', ph === 'take');
      const other = P.side === 'R' ? 'the other side, ' : '';
      top.textContent = ph === 'count'
        ? P.side === 'R' ? 'Counting in: the other side. Your left take is in your left ear.' : P.count && P.prev ? `Counting in over the end of ${P.prev}` : P.count ? 'Counting in' : P.prev ? `In over the end of ${P.prev}` : 'Straight in'
        : `Recording ${other}take ${P.n}`;
      part.textContent = P.name + (P.side === 'R' ? ', the other side' : '');
      count.hidden = ph !== 'count';
      bar.hidden = strip.hidden = ph !== 'take';
      kStop.classList.toggle('grt-dim', ph === 'count');
      sub.textContent = ph === 'count' ? (P.countOn ? `The metronome counts ${P.count > P.bpb ? 'two bars' : 'one bar'}. The parts around it play.` : 'The count-in is off (⇧K turns it on). The parts around it play.') : '';
      sub.hidden = !sub.textContent;
      note.textContent = 'It doesn’t stop itself at the part’s end. Play past it if you like: you trim afterwards.';
    }
    if (ph === 'count') {
      if (!e?.playing || !P.count) { count.textContent = ''; return; }
      const k = Math.floor(b - (P.from - P.count) + 1e-6);
      count.textContent = k >= 0 && k < P.count ? String((k % P.bpb) + 1) : '';
      return;
    }
    const n = Math.floor((b - P.from) / P.bpb + 1e-6) + 1;
    const past = P.bars ? n - P.bars : 0;
    bar.replaceChildren(...(P.bars && past > 0
      ? [h('span', `Bar ${n} `), h('span.grt-past', `· ${past} past the end, still recording`)]
      : P.bars ? [h('span', `Bar ${n} `), h('span.grt-of', `of ${P.bars}`)] : [h('span', `Bar ${Math.max(1, n)}`)]));
    // the strip: the input's level where the transport is
    let pk = 0;
    try { pk = R.deck.level()?.peak || 0; } catch { pk = 0; }
    if (lastBeat == null || b > lastBeat + 1e-6) { cols.push([b, pk]); lastBeat = b; if (cols.length > 6000) cols.splice(0, cols.length - 6000); }
    draw(P, b);
  }
  function draw(P, b) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    size = { w, h: hh, d };
    const g = cv.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(over);
    const C = (k, f) => css.getPropertyValue(k).trim() || f;
    g.clearRect(0, 0, w, hh);
    const el = (b - P.from) / P.bpb;
    const span = Math.max((P.bars || 4) + 2, Math.ceil(el) + 1);
    const X = (bars) => (bars / span) * w;
    for (let k = 0; k <= span; k++) {
      const end = P.bars && k === P.bars;
      g.fillStyle = end ? C('--text', '#f4ead6') : C('--line-2', '#46413a');
      g.fillRect(Math.round(X(k)), 0, end ? 2 * d : 1, hh);
    }
    if (P.bars) {
      g.fillStyle = C('--text-3', '#9a8f7c'); g.font = `${11 * d}px ${C('--font-mono', 'monospace')}`; g.textBaseline = 'top';
      g.fillText('the part’s end', X(P.bars) + 5 * d, 2 * d);
    }
    g.fillStyle = C('--text', '#f4ead6');
    const mid = hh / 2, amp = hh / 2 - 4 * d;
    let lastX = -1;
    for (const [bb, pk] of cols) {
      const x = Math.round(X((bb - P.from) / P.bpb));
      if (x < 0 || x === lastX) continue;
      lastX = x;
      const v = Math.max(1, Math.sqrt(Math.min(1, pk)) * amp);
      g.fillRect(x, Math.round(mid - v), Math.max(1, 2 * d - 1), Math.round(v * 2));
    }
    // (the take in progress: the record light's colour, the one place red is)
    g.fillStyle = C('--rec', '#ff4d4d');
    g.fillRect(Math.round(X(Math.max(0, el))), 0, 2 * d, hh);
  }
  return {
    show, hide,
    frame(P) { if (on && P) paint(P); },
    shown: () => on,
    size: () => size,
  };
}
