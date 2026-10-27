// The riff tray [ui; the guitar room's TAPE stream] (docs/research/GUITAR-ROOM.md §2.4; design/mock/guitar-room-2/ shot
// 02d-riffs-and-part-line, design/mock/guitar-room/ 03c-riff-in-tray, 04a-riff-on-part-line). The left half of the
// drawer over the board (R.el.drawer.tray; the part line is the takes stream's, beside it): the tape as a faint line
// (the last minute, quietly: G or a click on it opens it), this session's riffs newest first (ui/liveroom/riffs-db.js:
// kept in this browser, every song's, the library a press away), each one heard round and round by a click (through
// your rig: ./tape-hear.js), dragged onto the part line, or put after the selected part with Enter. The part line's
// own place (R.parts.takes.place) makes the part: one step by you, ⌘Z takes it back out.
//
//   createTray(R, { hear }) -> tray
//     tray.refresh() -> Promise    re-read this session's riffs (after a keep, a rename, a delete)
//     tray.rows() -> [Row]         what the tray shows now
//     tray.place(row, { at }) -> Promise<{ ok, error? }>   a riff onto the part line at `at` (0 before the first part,
//                                  the parts' count after the last; default: after the selected part)
//     tray.frame(now), tray.dispose()
//   A drag over the part line emits R.emit('tape:drag', { riff, x, y, over, at, phase: 'move' | 'drop' | 'cancel' })
//   so the part line can light the gap it would land in; `at` counts the part line's cards ([data-section]) left of
//   the pointer.

import { h, tok } from '../../dom.js';
import * as riffs from '../riffs-db.js';
import { TUNINGS } from '../../../core/fretboard.js';
import { TAPE_LINES as T_, bars as nBars } from './tape-lines.js';

// this page's visit: "this session" in the tray and the library
export const SESSION = Date.now();
const kbd = (k) => h('kbd', k);

// a riff's peaks (core/liveroom/riffs.js: min then max per column, of 127) as columns in a canvas
export function drawPeaks(cv, peaks, { color = '#9a8f7c', step = 2, bar = 1.4 } = {}) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width || cv.width)), H = Math.max(1, Math.round(r.height || cv.height));
  cv.width = W * d; cv.height = H * d;
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, W, H);
  g.fillStyle = color;
  const n = peaks ? peaks.length / 2 : 0, cols = Math.floor(W / step);
  if (!n) { g.fillRect(0, Math.round(H / 2), W, 1); return; }
  let top = 1;
  for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(peaks[2 * i]), Math.abs(peaks[2 * i + 1]));
  for (let c = 0; c < cols; c++) {
    const i0 = Math.floor((c * n) / cols), i1 = Math.max(i0 + 1, Math.floor(((c + 1) * n) / cols));
    let v = 0;
    for (let i = i0; i < i1; i++) v = Math.max(v, Math.abs(peaks[2 * i]), Math.abs(peaks[2 * i + 1]));
    const a = Math.max(0.5, (v / top) * (H / 2 - 1));
    g.fillRect(c * step, Math.round(H / 2 - a), bar, Math.max(1, Math.round(a * 2)));
  }
}
export const riffMeta = (r) => `${nBars(Math.round(r.bars * 4) / 4)} · ${Math.round(r.tempo)}`;
export const riffSub = (r) => `${TUNINGS[r.tuning]?.name || 'Standard'}${r.stack?.name ? `, ${r.stack.name}` : ''}`;

export function createTray(R, { hear }) {
  const el = R.el.drawer.tray;
  el.classList.add('gr-ty');
  let rows = [], total = 0, alive = true;
  const tapeLine = h('canvas.gr-ty-line', { 'aria-hidden': 'true' });
  const tapeBtn = h('button.gr-ty-tape', { type: 'button', 'aria-label': 'The tape: the last minute (G)', onclick: () => R.press('tape') }, tapeLine, h('span.gr-ty-tl', 'the tape, the last minute', kbd('G'), 'that was the one'));
  const count = h('span.gr-ty-count');
  const allBtn = h('button.btn.btn-txt', { type: 'button', onclick: () => R.press('library') }, 'All riffs');
  const lane = h('div.gr-ty-lane', { role: 'list', 'aria-label': 'Riffs this session' });
  el.replaceChildren(tapeBtn, h('div.gr-ty-h', h('span.gr-ty-name', 'Riffs'), count, h('span.gr-gap'), allBtn, kbd('⇧L')), lane);

  async function refresh() {
    try {
      const [page, n] = await Promise.all([riffs.list({ from: SESSION, limit: 40 }), riffs.count()]);
      if (!alive) return;
      rows = page.rows; total = n;
    } catch (e) { console.error('tray: riffs', e); }
    render();
  }
  function render() {
    count.textContent = rows.length ? `${rows.length} this session, ${total} in the library` : total ? `${total} in the library` : '';
    allBtn.textContent = total ? `All ${total}` : 'All riffs';
    if (!rows.length) {
      lane.replaceChildren(h('p.gr-ty-empty', 'Riffs you keep off the tape land here. Play something you like, then ', h('b', 'G'), ' grabs it.'));
      return;
    }
    lane.replaceChildren(...rows.map(card));
  }
  function card(r) {
    const cv = h('canvas.gr-ty-wave', { 'aria-hidden': 'true' });
    const c = h('div.gr-ty-card', { role: 'listitem', tabindex: 0, dataset: { riff: r.id }, 'aria-label': `${r.name}: ${riffMeta(r)}. Click hears it; drag it to the part line, or Enter puts it after the selected part.` },
      h('span.gr-ty-cn', r.name), h('span.gr-ty-cm', riffMeta(r)), h('span.gr-ty-cs', riffSub(r)), cv, h('i.gr-ty-loop'));
    requestAnimationFrame(() => drawPeaks(cv, r.peaks, { color: tok('--text-3') || '#9a8f7c' }));
    c.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === 'NumpadEnter') && e.target === c) { e.preventDefault(); e.stopPropagation(); place(r); } });
    dragSource(c, r);
    return c;
  }

  /* ---------------------------------------------------------------- onto the part line */
  const parts = () => R.el.drawer.parts;
  function cardsOnLine() {
    const p = parts();
    return p ? [...p.querySelectorAll('[data-section]')].filter((x) => x.offsetParent && !x.closest('.gr-ty')) : [];
  }
  function atFor(x, y) {
    const p = parts();
    if (!p || p.hidden || !R.gr.drawer) return null;
    const b = p.getBoundingClientRect();
    if (!(b.width > 0) || y < b.top - 30 || y > b.bottom + 30 || x < b.left - 20 || x > b.right + 20) return null;
    return cardsOnLine().filter((c) => { const r = c.getBoundingClientRect(); return x > r.left + r.width / 2; }).length;
  }
  // after the selected part (or at the end)
  function defaultAt() {
    let v = null;
    try { v = R.lr.view(); } catch { v = null; }
    const list = v?.parts || [];
    const sel = R.parts.takes?.part?.() || R.L.card || null;
    const i = list.findIndex((c) => c.id === sel);
    return { at: i >= 0 ? i + 1 : list.length, after: i >= 0 ? list[i].id : list.length ? list[list.length - 1].id : null };
  }
  async function place(r, { at = null } = {}) {
    if (R.busy()) { R.say('The part line takes riffs once the take is in.'); return { ok: false, error: 'busy' }; }
    const takes = R.parts.takes;
    if (!takes?.place) return { ok: false, error: 'The part line isn’t up.' };
    const d = defaultAt();
    let res;
    try { res = await takes.place(r, at == null ? d : { at, after: null }); } catch (e) { res = { ok: false, error: String(e?.message || e) }; }
    if (!res?.ok && res?.error) R.say(res.error);
    return res || { ok: false };
  }
  function dragSource(c, r) {
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const x0 = e.clientX, y0 = e.clientY;
      let ghost = null, started = false;
      const move = (ev) => {
        if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!started) {
          started = true;
          c.classList.add('gr-ty-dragging');
          ghost = c.cloneNode(true);
          ghost.classList.add('gr-ty-ghost');
          const b = c.getBoundingClientRect();
          Object.assign(ghost.style, { width: b.width + 'px', height: b.height + 'px' });
          document.body.append(ghost);
          const gc = ghost.querySelector('canvas');
          if (gc) drawPeaks(gc, r.peaks, { color: tok('--text-2') || '#cbc0aa' });
        }
        ghost.style.left = ev.clientX - 40 + 'px'; ghost.style.top = ev.clientY - 30 + 'px';
        const at = atFor(ev.clientX, ev.clientY);
        R.emit('tape:drag', { riff: r, x: ev.clientX, y: ev.clientY, over: at != null, at, phase: 'move' });
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        if (!started) { if (ev.type === 'pointerup') toggleHear(r); return; }
        ghost?.remove(); c.classList.remove('gr-ty-dragging');
        const at = ev.type === 'pointerup' ? atFor(ev.clientX, ev.clientY) : null;
        R.emit('tape:drag', { riff: r, x: ev.clientX, y: ev.clientY, over: at != null, at, phase: at != null ? 'drop' : 'cancel' });
        if (at != null) place(r, { at });
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
  }
  async function toggleHear(r) {
    if (hear.key === r.id) { hear.stop(); mark(); return; }
    const buf = await riffs.buffer(r.id);
    if (!buf) { R.say(`${r.name}’s audio isn’t in this browser.`); return; }
    const from = r.offset || 0, to = from + (r.beats * 60) / r.tempo;
    if (await hear.play(r.id, { buffer: buf, from, to })) R.say(T_.hear({ name: r.name }));
    mark();
  }
  function mark() { for (const c of lane.querySelectorAll('.gr-ty-card')) c.classList.toggle('gr-ty-on', hear.key === c.dataset.riff); }

  /* ---------------------------------------------------------------- the faint line */
  let lastLine = 0;
  function drawLine() {
    const tp = R.app.input?.tape;
    const r = tapeLine.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const d = Math.min(2, window.devicePixelRatio || 1), W = Math.round(r.width), H = Math.round(r.height);
    if (tapeLine.width !== W * d || tapeLine.height !== H * d) { tapeLine.width = W * d; tapeLine.height = H * d; }
    const g = tapeLine.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = tok('--text-3') || '#9a8f7c';
    g.fillRect(0, Math.round(H / 2), W, 1);
    if (!tp?.state?.open) return;
    const sp = tp.span(), sr = tp.state.sr || 48000, len = (tp.seconds || 60) * sr;
    const from = sp.to - len, n = Math.floor(W / 3), pk = tp.peaks(from, sp.to, n);
    for (let i = 0; i < n; i++) { const v = Math.min(1, pk[i] * 1.6) * (H / 2 - 1); if (v > 0.8) g.fillRect(i * 3, Math.round(H / 2 - v), 2, Math.round(v * 2)); }
  }
  function frame(now) {
    if (!R.gr.drawer) return;
    if (now - lastLine > 100) { lastLine = now; drawLine(); }
    const pos = hear.key ? hear.pos() : null;
    for (const c of lane.querySelectorAll('.gr-ty-card')) {
      const on = hear.key === c.dataset.riff;
      c.classList.toggle('gr-ty-on', on);
      if (on && pos != null) c.querySelector('.gr-ty-loop').style.width = `calc((100% - 20px) * ${pos.toFixed(3)})`;
    }
  }
  render();
  refresh();
  return { refresh, frame, place, rows: () => rows.slice(), dispose() { alive = false; } };
}
