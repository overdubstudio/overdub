// The beat window: Start a song's click view (ui/start.js), the take's bars and nothing else. A count-in column (the
// numeral 4 3 2 1 in display italic, "Come in on 1." under it in pencil), then the window: a ruler of beats, a row per
// drum, the fold so far (what plays under you, kept from the rounds before), this round's hits as you play them, the
// playhead in leader green and a cream ball that hops beat to beat. Everything moves with the transport: the ball, the
// playhead and the numeral are read from the engine's beat in frame(now), never from a timer. With reduced motion there
// is no ball and no hop: the current beat's cell on the ruler lights in reverse print instead.
//
//   mountBeatWindow(el, { rows, meter, bars = 2, ball = true, countIn = true, clock }) -> { hit(row, beat),
//     setFold(notes), clear(), frame(now), state() }
//   rows: [{ id, label, p }] top to bottom; meter: [n, d] (or beats per bar); clock() -> { beat (the song's, looping),
//   grid (the take's: beats from bar 1, below 0 in the count-in, never wrapping), playing } (the engine's).
//   hit(row, beat): a hit at that grid beat (drawn in its round while that round plays). setFold(notes [{ p, t }]): the
//   fold so far, in loop beats. frame(now) draws; state() -> { ball: { x, y, beat } | null, cell, numeral, counting,
//   open, round, barPx, lab, length } (what the last frame drew: start-test reads it).
//
// At least 160 px a bar (the window's min-width): the take's two bars fit a 390 px phone with the count-in over the
// window's left (the column folds into an overlay under 640 px).

import { h, css, canvas, tok } from './dom.js';

export const OPEN = -0.25;   // a hit this early on the 1 (a sixteenth) counts as on it: the window opens here
const BALL = 18, HOP = 24;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountBeatWindow(el, { rows = [], meter = [4, 4], bars = 2, ball = true, countIn = true, clock = () => ({ beat: null, grid: null, playing: false }) } = {}) {
  css('beatwindow', CSS);
  const bpb = Array.isArray(meter) ? (meter[0] * 4) / meter[1] : +meter || 4;
  const L = bars * bpb;
  const num = h('span.bw-num.disp', { 'aria-hidden': 'true' }, '');
  const come = h('span.bw-come.t3', '');
  const col = h('div.bw-count', { role: 'status', 'aria-live': 'polite' }, num, come);
  const win = canvas('bw-win');
  const root = h('div.bw' + (countIn ? '' : '.bw-nocount'), countIn ? col : null, h('div.bw-wrap', win.cv));
  el.replaceChildren(root);
  let hits = [], fold = [];
  let last = { ball: null, cell: null, numeral: null, counting: false, open: false, round: 0, barPx: 0, lab: 0, length: L };
  let said = '';

  function frame() {
    if (!root.isConnected) return;
    win.fit();
    const g = win.g, W = win.w, H = win.h;
    g.clearRect(0, 0, W, H);
    const c = clock() || {};
    const playing = !!c.playing && Number.isFinite(c.grid);
    const grid = playing ? c.grid : null;
    const counting = playing && grid < 0;
    const lowMotion = reduced();
    const ind = W < 420 ? 0 : 12, lab = W < 420 ? 36 : 64, padR = 2, inner = Math.max(1, W - lab - padR);
    const x = (b) => lab + (b / L) * inner;
    const top = ball && !lowMotion ? BALL + HOP + 4 : 6, rulerH = 22, rowsTop = top + rulerH, rowH = Math.max(18, (H - rowsTop - 2) / Math.max(1, rows.length));
    const line = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text2 = tok('--text-2'), text3 = tok('--text-3'), accent = tok('--accent'), bg = tok('--bg');
    const font = tok('--font-ui') || 'sans-serif';
    // the loop beat now (the song's beat inside the window), and the round you're in
    const lb = playing && !counting ? (((c.beat ?? grid) % L) + L) % L : null;
    const round = playing && !counting ? Math.floor(grid / L) : 0;
    // the ruler: beat numbers, a dot on each sixteenth; the current beat's cell in reverse print (reduced motion)
    const cur = lb == null ? null : Math.floor(lb + 1e-6);
    g.textBaseline = 'middle';
    for (let s = 0; s < L * 4; s++) {
      const b = s / 4, xx = x(b);
      if (s % 4 === 0) {
        const beatN = (Math.floor(b) % bpb) + 1;
        if (lowMotion && cur === Math.floor(b)) { g.fillStyle = text; g.fillRect(Math.round(xx), top, Math.round(x(b + 1) - xx), rulerH); }
        g.fillStyle = lowMotion && cur === Math.floor(b) ? bg : beatN === 1 ? text : text2;
        g.font = `${beatN === 1 ? 700 : 600} 12px ${font}`;
        g.fillText(String(beatN), Math.round(xx) + 4, top + rulerH / 2);
      } else {
        g.fillStyle = text3;
        g.fillRect(Math.round(xx) + 2, top + rulerH / 2, 2, 2);
      }
    }
    // the rows: a hairline under each, the label in pencil
    g.font = `600 11px ${font}`;
    rows.forEach((r, i) => {
      g.fillStyle = text3; g.fillText(r.label, ind, rowsTop + rowH * (i + 0.5));
      g.fillStyle = line; g.fillRect(lab, Math.round(rowsTop + rowH * (i + 1)) - 1, inner, 1);
    });
    // beat lines (hairline), bar lines (--line-2, 2 px)
    for (let b = 0; b <= L; b++) {
      const xx = Math.round(x(b));
      g.fillStyle = b % bpb === 0 ? line2 : line;
      g.fillRect(b === L ? xx - 2 : xx, top, b % bpb === 0 ? 2 : 1, H - top);
    }
    // the fold so far: a block in the cell each kept hit is in (it plays under you)
    const cw = Math.max(4, inner / (L * 4) - 3);
    const rowOf = new Map(rows.map((r, i) => [r.p, i]));
    g.fillStyle = text3;
    for (const n of fold) {
      const i = rowOf.get(n.p);
      if (i == null) continue;
      g.fillRect(Math.round(x(n.t)) + 2, rowsTop + rowH * i + rowH * 0.28, cw, rowH * 0.44);
    }
    // this round's hits, cream, where you played them
    g.fillStyle = text;
    let mine = 0;
    for (const hit of hits) {
      if (!playing || counting || Math.floor((hit.beat - OPEN) / L) !== round) continue;
      const i = rows.findIndex((r) => r.id === hit.row);
      if (i < 0) continue;
      const b = Math.max(0, hit.beat - round * L);
      g.fillRect(Math.round(x(b)) - 1, rowsTop + rowH * i + rowH * 0.18, 3, rowH * 0.64);
      mine++;
    }
    // the playhead, leader green
    if (lb != null) { g.fillStyle = accent; g.fillRect(Math.round(x(lb)), rowsTop, 2, H - rowsTop); }
    // the ball: 18 px cream, hopping beat to beat on the engine's beat (its height is the beat's fraction)
    let bl = null;
    if (ball && !lowMotion && lb != null) {
      const f = lb - Math.floor(lb), bx = x(lb), by = top - BALL / 2 - 2 - HOP * Math.sin(Math.PI * f);
      g.fillStyle = text; g.beginPath(); g.arc(bx, by, BALL / 2, 0, Math.PI * 2); g.fill();
      bl = { x: Math.round(bx * 10) / 10, y: Math.round(by * 10) / 10, beat: c.beat };
    }
    // the count-in: 4 3 2 1, then nothing (the window is open)
    const numeral = counting ? String(Math.max(1, Math.min(bpb, Math.ceil(-grid - 1e-6)))) : null;
    if (countIn) {
      if (num.textContent !== (numeral || '')) num.textContent = numeral || '';
      const w = counting ? 'Come in on 1.' : '';
      if (come.textContent !== w) come.textContent = w;
      root.classList.toggle('bw-counting', counting);
      const sayNow = counting ? numeral : '';
      if (sayNow !== said) { said = sayNow; col.setAttribute('aria-label', counting ? `${numeral}. Come in on 1.` : ''); }
    }
    last = { ball: bl, cell: lowMotion ? cur : null, numeral, counting, open: playing && grid >= OPEN, round, barPx: Math.round((inner / bars) * 10) / 10, lab, length: L, hits: mine, fold: fold.length, inner };
  }

  return {
    hit(row, beat) { if (Number.isFinite(beat)) hits.push({ row, beat }); if (hits.length > 512) hits = hits.slice(-256); },
    setFold(notes) { fold = (notes || []).map((n) => ({ p: n.p, t: n.t })); },
    clear() { hits = []; fold = []; },
    frame,
    state: () => ({ ...last }),
    el: root,
  };
}

const CSS = `
.bw { display: grid; grid-template-columns: minmax(120px, 160px) minmax(0, 1fr); align-items: stretch; border-top: var(--rule); border-bottom: var(--rule); }
.bw.bw-nocount { grid-template-columns: minmax(0, 1fr); }
.bw-count { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-right: var(--rule); padding: 6px 8px; min-height: 0; }
.bw-num { font-size: 140px; line-height: .9; color: var(--text); min-height: 126px; font-variant-numeric: tabular-nums; }
.bw-come { font-size: 13px; min-height: 18px; }
.bw-wrap { position: relative; min-width: 356px; }
.bw-win { display: block; width: 100%; height: clamp(170px, 26vh, 230px); }
@media (max-width: 640px) {
  .bw { grid-template-columns: minmax(0, 1fr); position: relative; }
  .bw-count { position: absolute; inset: 0; z-index: 1; border-right: 0; background: var(--bg); pointer-events: none; visibility: hidden; }
  .bw.bw-counting .bw-count { visibility: visible; }
  .bw-num { font-size: 120px; min-height: 108px; }
  .bw-wrap { min-width: 0; }
}
`;
