// The part line [ui; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.5; design/mock/guitar-room/
// shots 04a-04g, 05g; AJ: insert anywhere, drag to reorder, delete any card including the last, play from any part).
// The cards in the drawer (R.el.drawer.parts), drawn from the song (./parts-plans.js partLine) and the selected card
// (ui.state.liveRoom.card), never from state of their own: the stream's ./takes.js re-renders it when either changes.
// It decides nothing: a click, a drag, a key or the × hands the stream an action.
//
//   createPartLine(R, on) -> { el, render(model), frame(beat), dropAt(x, y, { final, kind }), dragging(), dispose() }
//     on = { pick(id | 'new'), play(id), remove(id), move(id, to), rename(id, name), add(at), other(), key(id) }
//     model = { line (partLine), sel (section id | 'new' | null), beats: { [section]: name }, canOther, song }
//     dropAt(clientX, clientY, { final, kind: 'part' | 'riff', id }) -> index | null   where a card or a riff dropped
//       there lands on the line (0: before the first part), lighting that gap while it's not final; the riff tray's
//       drag asks it too (the tape stream's), then calls R.parts.takes.place(riff, { at })
//
// The lane is a role=listbox (the room's key table leaves a focused list its arrows, Home and End: ← → pick a card,
// ↑ ↓ the take that plays, Home and End the first and the last; Enter stays the room's, play from the card); each card
// a role=option. Space never presses one (it's the transport's everywhere, the shell's rule). No <select>, no range.

import { h } from '../../dom.js';
import { byline } from '../../dom.js';
import { takesIn } from './parts-plans.js';

const plural = (n, w) => `${Math.round(n * 10) / 10} ${w}${Math.abs(n - 1) < 1e-6 ? '' : 's'}`;
const kbd = (t) => h('kbd.grt-k', t);

export function createPartLine(R, on) {
  const head = h('div.grt-row');
  const lane = h('div.grt-lane', { role: 'listbox', tabindex: 0, 'aria-label': 'The part line', 'aria-orientation': 'horizontal' });
  const el = h('section.grt-parts', { 'aria-label': 'The part line' }, head, lane);
  let model = null;
  let drag = null;      // { id, el, ghost, x0, y0, started, pid }
  const waves = new Map();   // clip key -> Float32Array (peaks) | 'loading'

  /* ------------------------------------------------------------------------------------------- the cards */
  function waveOf(c) {
    if (!c) return null;
    const key = `${c.asset}:${c.start}:${c.length}:${c.offset || 0}`;
    const got = waves.get(key);
    if (got && got !== 'loading') return got;
    if (got === 'loading') return null;
    const eng = R.app.engine;
    const buf = eng?.assets?.peek?.(c.asset);
    if (buf) { const w = peaks(buf, c, R.store.get().tempo); waves.set(key, w); return w; }
    waves.set(key, 'loading');
    Promise.resolve(eng?.assets?.get?.(c.asset)).then((b) => { waves.set(key, b ? peaks(b, c, R.store.get().tempo) : new Float32Array(0)); if (model) render(model); }, () => waves.set(key, new Float32Array(0)));
    return null;
  }
  function card(c, i) {
    const p = model.song;
    const L = takesIn(p, { section: c.id, side: 'L' }), Rt = takesIn(p, { section: c.id, side: 'R' });
    const pick = Math.max(0, L.findIndex((x) => !x.mute));
    const tk = L.length ? `take ${pick + 1} of ${L.length}` : 'no take yet';
    const sel = model.sel === c.id;
    const sub = [];
    if (c.by) sub.push(h('span', 'by ', byline(c.by, { app: R.app })), ' · ');
    sub.push(model.beats[c.id] || 'The guide beat');
    const cv = h('canvas', { width: 180, height: 30, 'aria-hidden': 'true' });
    const x = h('button.grt-x', { type: 'button', 'aria-label': `Delete ${c.name}`, title: 'Delete it (⌘Z puts it back)', onclick: (e) => { e.stopPropagation(); on.remove(c.id); } }, '×');
    const nm = h('span.grt-cn', { title: 'Double-click to name it' }, c.name);
    const el2 = h('div.grt-card', { role: 'option', 'aria-selected': sel ? 'true' : 'false', tabindex: -1, id: `grt-card-${c.id}`, dataset: { part: c.id, i: String(i) },
      'aria-label': `${c.name}, ${plural(c.bars, 'bar')}, ${tk}` },
    h('div.grt-in', nm, h('span.grt-cm', `${plural(c.bars, 'bar')} · ${tk}`, L.length > 1 && sel ? ' ↑↓' : ''), h('span.grt-cs', sub)),
    h('div.grt-sides', { 'aria-hidden': 'true' }, h('i' + (L.length ? '.grt-on' : ''), 'L'), h('i' + (Rt.length ? '.grt-on' : ''), 'R')),
    x, cv);
    const w = waveOf(L[pick] || Rt.find((y) => !y.mute) || null);
    paint(cv, w);
    nm.addEventListener('dblclick', (e) => { e.stopPropagation(); rename(el2, c); });
    el2.addEventListener('pointerdown', (e) => down(e, c.id, el2));
    return el2;
  }
  function paint(cv, w) {
    const g = cv.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(el);
    g.clearRect(0, 0, cv.width, cv.height);
    const mid = cv.height / 2;
    if (!w || !w.length) { g.fillStyle = css.getPropertyValue('--line-2').trim() || '#46413a'; g.fillRect(0, mid, cv.width, 1); return; }
    g.fillStyle = css.getPropertyValue('--text-3').trim() || '#9a8f7c';
    const cols = Math.floor(cv.width / 2);
    for (let i = 0; i < cols; i++) {
      const v = w[Math.min(w.length - 1, Math.floor((i / cols) * w.length))] || 0;
      const a = Math.max(0.5, v * (mid - 1));
      g.fillRect(i * 2, Math.round(mid - a), 1.5, Math.max(1, Math.round(a * 2)));
    }
  }
  function rename(cardEl, c) {
    if (cardEl.querySelector('input')) return;
    const input = h('input.grt-rename', { type: 'text', value: c.name, maxlength: 40, 'aria-label': `A name for ${c.name}`, autocomplete: 'off', dataset: { typing: '1' } });
    let closed = false;
    const done = (ok) => { if (closed) return; closed = true; const v = input.value.trim(); input.remove(); if (ok && v && v !== c.name) on.rename(c.id, v); else if (model) render(model); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    cardEl.append(input);
    input.focus();
    input.select();
  }

  function render(m) {
    model = m;
    // (not under a drag, nor while a name's being typed on a card: the card stays till it's done)
    if (drag?.started || lane.querySelector('input.grt-rename')) return;
    const { line, sel } = m;
    const n = line.parts.length;
    const bars = line.parts.reduce((a, c) => a + c.bars, 0);
    const secs = (bars * line.bpb * 60) / (line.tempo || 120);
    const selCard = line.parts.find((c) => c.id === sel);
    head.replaceChildren(...[
      h('span.grt-name', 'The part line'),
      h('span', n ? `${plural(n, 'part')}, ${plural(bars, 'bar')}, ${Math.round(secs)} s` : 'empty'),
      h('span.grt-gap'),
      m.canOther ? h('button.grt-txt', { type: 'button', onclick: () => on.other() }, 'The other side', kbd('D')) : null,
      selCard ? h('span.grt-help', kbd('Enter'), 'play from the selected part') : null,
      n ? h('span.grt-help', kbd('Home'), 'from the top') : null,
      n ? h('span.grt-help', kbd('N'), 'a new part', kbd('⇧N'), 'before') : h('span.grt-help', kbd('N'), 'a new part'),
    ].filter(Boolean));
    const kids = [];
    if (!n) {
      kids.push(h('div.grt-empty', { dataset: { drop: '0' }, role: 'option', 'aria-selected': sel === 'new' ? 'true' : 'false', onclick: () => on.pick('new') },
        h('span', 'Drop a riff here, or press ', h('b', 'R'), ' to record a part.')));
    } else {
      kids.push(h('div.grt-gap', { dataset: { drop: '0' } }));
      line.parts.forEach((c, i) => { kids.push(card(c, i)); kids.push(h('div.grt-gap', { dataset: { drop: String(i + 1) } })); });
      kids.push(h('button.grt-add', { type: 'button', role: 'option', 'aria-selected': sel === 'new' ? 'true' : 'false', dataset: { part: 'new' }, onclick: () => on.pick('new'), title: 'R records a new part at the end' }, '+ New part', kbd('R')));
    }
    lane.replaceChildren(...kids);
    const a = sel ? lane.querySelector(`[data-part="${CSS.escape(sel)}"]`) : null;
    if (a) { lane.setAttribute('aria-activedescendant', a.id || ''); a.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } else lane.removeAttribute('aria-activedescendant');
  }

  // the playhead on the card it's in
  let headEl = null;
  function frame(beat) {
    if (!model) return;
    const c = beat == null ? null : model.line.parts.find((x) => beat >= x.start && beat < x.start + x.length);
    const host = c ? lane.querySelector(`.grt-card[data-part="${CSS.escape(c.id)}"]`) : null;
    if (!host) { headEl?.remove(); headEl = null; return; }
    if (!headEl) headEl = h('i.grt-head', { 'aria-hidden': 'true' });
    if (headEl.parentElement !== host) host.append(headEl);
    headEl.style.left = `${Math.max(0, Math.min(1, (beat - c.start) / c.length)) * 100}%`;
  }

  /* ------------------------------------------------------------------------------------------- dragging */
  function down(e, id, cardEl) {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    drag = { id, el: cardEl, ghost: null, x0: e.clientX, y0: e.clientY, started: false, pid: e.pointerId };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  function move(e) {
    if (!drag) return;
    if (!drag.started && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    if (!drag.started) {
      drag.started = true;
      drag.el.classList.add('grt-dragging');
      const g = drag.el.cloneNode(true);
      g.classList.remove('grt-dragging');
      g.classList.add('grt-ghost');
      const r = drag.el.getBoundingClientRect();
      g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
      document.body.append(g);
      drag.ghost = g;
    }
    drag.ghost.style.left = e.clientX - 40 + 'px';
    drag.ghost.style.top = e.clientY - 30 + 'px';
    dropAt(e.clientX, e.clientY, { kind: 'part', id: drag.id });
  }
  function up(e) {
    const d = drag;
    end();
    if (!d) return;
    if (!d.started) { on.pick(d.id); lane.focus({ preventScroll: true }); return; }
    const at = dropAt(e.clientX, e.clientY, { final: true, kind: 'part', id: d.id });
    if (at != null) on.move(d.id, at);
    else if (model) render(model);
  }
  function cancel() { end(); if (model) render(model); }
  function end() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    if (drag) { drag.ghost?.remove(); drag.el.classList.remove('grt-dragging'); }
    drag = null;
    for (const g of lane.querySelectorAll('.grt-hot')) g.classList.remove('grt-hot');
  }
  function dropAt(x, y, { final = false, kind = 'riff', id = null } = {}) {
    for (const g of lane.querySelectorAll('.grt-hot')) g.classList.remove('grt-hot');
    if (!lane.isConnected || !lane.offsetParent) return null;
    const r = lane.getBoundingClientRect();
    if (y < r.top - 30 || y > r.bottom + 30 || x < r.left - 20 || x > r.right + 20) return null;
    const cards = [...lane.querySelectorAll('.grt-card')];
    if (!cards.length) { if (!final) lane.querySelector('.grt-empty')?.classList.add('grt-hot'); return 0; }
    let at = cards.length;
    for (let i = 0; i < cards.length; i++) { const cr = cards[i].getBoundingClientRect(); if (x < cr.left + cr.width / 2) { at = i; break; } }
    if (kind === 'part') { const from = cards.findIndex((c) => c.dataset.part === id); if (at === from || at === from + 1) return null; }
    if (!final) lane.querySelector(`.grt-gap[data-drop="${at}"]`)?.classList.add('grt-hot');
    return at;
  }

  /* ------------------------------------------------------------------------------------------- the list's own keys */
  // (Space is the one key a focused listbox keeps from the shell (its rule, OWNS_SPACE: the shell would stop it before
  // here otherwise), so the lane hands it to the room itself: Space stops the song or starts the drummer with the part
  // line focused too. Enter isn't the list's: the room's key table has it ('play': from the selected card) and the
  // shell runs that first, in the capture phase; handled here too it would start the song and stop it again. Whether
  // a key was marked on its way here says nothing: the live room's holds mark keys they do nothing with)
  lane.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) R.press('space'); return; }
    if (!model || e.metaKey || e.ctrlKey || e.altKey) return;
    const ps = model.line.parts, i = ps.findIndex((c) => c.id === model.sel);
    const go = (j) => { e.preventDefault(); e.stopPropagation(); if (j === 'new') on.pick('new'); else if (ps[j]) on.pick(ps[j].id); };
    if (e.key === 'ArrowLeft') go(i < 0 ? ps.length - 1 : Math.max(0, i - 1));
    else if (e.key === 'ArrowRight') go(i < 0 ? 'new' : i + 1 >= ps.length ? 'new' : i + 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go('new');
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); on.key(e.key === 'ArrowUp' ? 'take:up' : 'take:down'); }
  });

  return { el, render, frame, dropAt, dragging: () => !!drag?.started, dispose() { end(); headEl?.remove(); } };
}

// the clip's peaks, 90 columns over its whole length (its ring too), each the column's peak, square-rooted so a quiet
// take still shows
function peaks(buf, c, tempo) {
  const n = 90, out = new Float32Array(n);
  const data = buf?.getChannelData ? buf.getChannelData(0) : buf?.channels?.[0];
  if (!data) return out;
  const sr = buf.sampleRate || buf.sr || 48000, spb = 60 / (tempo || 120);
  const a = Math.max(0, Math.floor((c.offset || 0) * sr)), b = Math.min(data.length, a + Math.floor(c.length * spb * sr));
  const step = Math.max(1, Math.floor((b - a) / n));
  let top = 1e-9;
  for (let i = 0; i < n; i++) {
    let pk = 0;
    for (let j = a + i * step, e = Math.min(b, j + step); j < e; j += 4) { const x = Math.abs(data[j]); if (x > pk) pk = x; }
    out[i] = pk; if (pk > top) top = pk;
  }
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / top);
  return out;
}
