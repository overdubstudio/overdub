// The setlist [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.6, §3.8-§3.10, §3.18): the song's parts as cards in
// start order, taped to the stage floor under it, each with its name, its length, the drummer's feel, its two side
// lamps (L R), its take's envelope and, when an agent or a guest made it, a byline. An empty part is a dashed card;
// the End is a small tab of the band's after the last card; + Next part after it. On a phone the row is a list of
// 64 px rows. A tap selects a card; a tap on the selected one, or its ⋯, opens its menu (./menu.js). The row scrolls
// sideways inside itself; the page never does. Drawn from the view each time it changes, never held in the DOM.
//
//   createSetlist({ app, onPick(id), onMenu(id, anchor), onNext() }) -> { el, update(view, { card, playing, rec, next }),
//       head(id, frac), unmount() }   rec: { name, bars } while a new part's first take is going down (a dashed card
//       for it at the end, its bars counting); next: whether + Next part is there (not before the first take, nor once
//       the song is laid out: N still makes one)

import { h, byline } from '../dom.js';
import { NAMES } from '../../core/liveroom/model.js';
import { envelope } from './view.js';

const W_ENV = 148, H_ENV = 16, STEPS = 74;
const barsWords = (n) => `${Math.round(n * 100) / 100} bar${n === 1 ? '' : 's'}`;

export function createSetlist({ app = null, onPick = () => {}, onMenu = () => {}, onNext = () => {} } = {}) {
  const row = h('div.lr-cards', { role: 'group', 'aria-label': 'The setlist' });
  const el = h('div.lr-setlist', row);
  let key = '';
  const envs = new Map();
  // (an envelope whose recording isn't in yet, a song just loaded: drawn when it comes in)
  let pending = [];
  function envOf(clipId) {
    if (!clipId) return null;
    if (envs.has(clipId)) return envs.get(clipId);
    const found = app?.store?.findClip?.(clipId);
    const buf = found?.clip?.asset ? app?.engine?.assets?.peek?.(found.clip.asset) : null;
    if (!buf) return null;
    const p = app.store.get();
    const secs = (found.clip.length * 60) / (p.tempo || 120);
    const e = envelope(buf, STEPS, { from: +found.clip.offset || 0, secs });
    envs.set(clipId, e);
    return e;
  }
  function strip(cv, e) {
    const g = cv.getContext?.('2d');
    if (!g) return;
    g.clearRect(0, 0, W_ENV, H_ENV);
    g.fillStyle = getComputedStyle(cv).color || '#888';
    const w = W_ENV / STEPS;
    for (let i = 0; i < STEPS; i++) { const y = Math.max(1, Math.round((e ? e[i] : 0.06) * H_ENV)); g.fillRect(Math.floor(i * w), H_ENV - y, Math.max(1, Math.floor(w) - 0), y); }
  }
  function card(c, view, sel, playing) {
    const reps = c.part?.reps > 1 ? `×${c.part.reps} · ` : '';
    const feel = c.part?.feel ? NAMES.feel[c.part.feel] || c.part.feel : '';
    const L = c.takes.L.length || c.takes.lead.length, R = c.takes.R.length;
    const single = view.place === 'bluesbar' || view.place === 'kitchen';
    const lamps = single ? null : h('span.lr-sides', { 'aria-hidden': 'true' }, h('i.lr-sidelamp', { class: L ? 'lr-on' : '' }, 'L'), h('i.lr-sidelamp', { class: R ? 'lr-on' : '' }, 'R'));
    const words = `${c.name}, ${reps ? `twice, ` : ''}${barsWords(c.bars)}${feel ? `, ${feel}` : ''}${c.empty ? ', empty' : single ? '' : `, ${L ? 'left in' : 'no left'}, ${R ? 'right in' : 'no right'}`}`;
    const cv = h('canvas.lr-env', { width: W_ENV, height: H_ENV, 'aria-hidden': 'true' });
    const main = h('button.lr-card-main', {
      type: 'button', 'aria-pressed': sel ? 'true' : 'false', 'aria-label': words,
      onclick: (e) => { if (sel) onMenu(c.id, e.currentTarget); else onPick(c.id); },
    },
    h('span.lr-card-name.disp', c.name, c.by ? [' ', byline(c.by, { app })] : null),
    h('span.lr-card-meta.mono', `${reps}${barsWords(c.bars)}`),
    h('span.lr-card-feel', c.empty ? 'empty' : feel || ' '),
    lamps,
    c.empty ? null : cv);
    const more = h('button.lr-card-more', { type: 'button', 'aria-label': `${c.name}: its menu`, title: 'Its menu', onclick: (e) => { onPick(c.id); onMenu(c.id, e.currentTarget); } }, '⋯');
    const box = h('div.lr-card', { dataset: { card: c.id }, class: `${c.empty ? 'lr-empty' : ''}${sel ? ' lr-sel' : ''}${playing ? ' lr-playing' : ''}` }, main, more, h('i.lr-card-head', { 'aria-hidden': 'true' }));
    if (!c.empty) {
      const id = c.playing.L || c.playing.R, e = envOf(id);
      strip(cv, e);
      if (!e && id) pending.push({ cv, id });
    }
    return box;
  }
  function update(view, { card: sel = null, playing = null, rec = null, next = true } = {}) {
    if (pending.length) pending = pending.filter((x) => { const e = envOf(x.id); if (e && x.cv.isConnected) strip(x.cv, e); return !e && x.cv.isConnected; });
    const k = JSON.stringify([view.shape, view.cards.map((c) => [c.id, c.name, c.part, c.takes, c.by]), sel, playing, view.place, rec, next]);
    if (k === key) return;
    key = k;
    pending = [];
    const kids = [];
    for (const c of view.cards) {
      if (c.end) kids.push(h('button.lr-end', { type: 'button', dataset: { card: c.id }, class: sel === c.id ? 'lr-sel' : '', 'aria-label': `The end, ${barsWords(c.bars)}: the band's`, onclick: () => onPick(c.id) }, 'End'));
      else kids.push(card(c, view, sel === c.id, playing === c.id));
    }
    // (the part going down now: a dashed card at the end, its bars counting, before it's a part)
    if (rec) {
      const at = view.cards.findIndex((c) => c.end);
      kids.splice(at < 0 ? kids.length : at, 0, h('div.lr-card.lr-empty.lr-rec', { 'aria-label': `${rec.name}, on tape` },
        h('div.lr-card-main', h('span.lr-card-name.disp', rec.name), h('span.lr-card-meta.mono', rec.bars ? barsWords(rec.bars) : 'counting in'), h('span.lr-card-feel', 'on tape'))));
    }
    if (next && !rec) kids.push(h('button.lr-next', { type: 'button', onclick: () => onNext() }, '+ Next part'));
    // (the row is drawn again: a card that had the keyboard's focus keeps it, on its new self)
    const had = row.contains(document.activeElement) ? document.activeElement : null;
    const was = had ? { card: had.closest('[data-card]')?.dataset.card || null, cls: ['lr-card-main', 'lr-card-more', 'lr-end', 'lr-next'].find((k) => had.classList.contains(k)) || null } : null;
    row.replaceChildren(...kids);
    if (was?.cls) {
      const sel = was.card ? `[data-card="${CSS.escape(was.card)}"]` : '';
      const back = was.cls === 'lr-end' || was.cls === 'lr-next' ? row.querySelector(`.${was.cls}`) : row.querySelector(`${sel} .${was.cls}`);
      try { back?.focus({ preventScroll: true }); } catch { /* fine */ }
    }
    const s = row.querySelector('.lr-sel');
    if (s?.scrollIntoView) { try { s.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ok */ } }
  }
  // the playhead on the playing card: a leader-green line, moved without redrawing the row
  function head(id, frac) {
    for (const x of row.querySelectorAll('.lr-card-head')) x.style.display = 'none';
    if (!id) return;
    const c = row.querySelector(`.lr-card[data-card="${CSS.escape(id)}"] .lr-card-head`);
    if (c) { c.style.display = 'block'; c.style.left = `${Math.max(0, Math.min(1, frac)) * 100}%`; }
  }
  return { el, update, head, unmount() { row.replaceChildren(); envs.clear(); key = ''; }, forget(id) { envs.delete(id); } };
}
