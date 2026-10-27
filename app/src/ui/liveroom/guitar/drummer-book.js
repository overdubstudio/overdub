// The drummer's book [ui; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.7; design/mock/guitar-
// room-2/ shot 03d-zoom-kit-the-book; AJ on the first mock: "a deeper groove library from there, with the main-screen
// few editable"). The kit's zoom (K, or a click on the kit): two cream pages in R.panel('kit').
//   On the riser   the riser's cards: each one's name (yours to change), the groove it came from, Play, ↑ ↓ to reorder,
//                  Unpin, Back to the book's (an edited card), and its bar as a grid to edit (a step: a hit, again an
//                  accent, again a rest); the count-in into each take, on or off (⇧K)
//   Every groove   the library's styles as tabs (the metal club's shelf first), each style's grooves by part: Play now
//                  (the drummer plays it, nothing in the song changes until you pin it) and Pin
// Every change is the drummer's action (./drummer.js act), one step by you; the book draws from the song and the room's
// state, never holds its own copy: it's drawn again when what it shows changes, and not while you type a card's name.
//
//   createBook({ el, act, look }) -> { render(), frame(), dispose() }
//     act: { pick(id), audition(groove id), pin(groove id), unpin(id), move(id, ±1), rename(id, name), step(id, row,
//       k), reset(id), countIn() }
//     look(): { riser: riserOf(p), beat, playing, audition, step (the step heard now, or null), countIn, max }

import { h } from '../../dom.js';
import { library } from '../../../core/grooves.js';
import { GUIDE_ID } from '../../../core/liveroom/guitar/beats.js';
import { rowsOf, miniOf, shelves } from '../../../core/liveroom/guitar/beats-grid.js';

const bars = (g) => { const n = Math.round((g.bars ?? g.length / 4) * 100) / 100; return `${n} bar${n === 1 ? '' : 's'}`; };
const tempoText = (st) => { const t = st.tempo; return Array.isArray(t) && t.length === 2 ? ` Played at ${t[0]}–${t[1]} BPM.` : ''; };
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : '');

export function createBook({ el, act, look }) {
  let style = shelves()[0]?.id || null;
  let drawn = '', nowAt = '';
  const book = h('div.grd-book');
  el.replaceChildren(book);
  el.setAttribute('aria-label', 'The drummer’s book');

  function pinsPage(v) {
    const page = h('section.grd-page', { dataset: { page: 'riser' } },
      h('h2', 'On the riser'),
      h('p.grd-sub', 'The beats on the riser’s cards: rename them, reorder them, edit their bar. Click a step for a hit, again for an accent, again to clear it.'),
      h('div.grd-count', 'Count-in before each take',
        h('button', { type: 'button', 'aria-pressed': String(!!v.countIn), dataset: { k: 'countin' }, onclick: () => act.countIn() }, v.countIn ? 'On' : 'Off'), h('kbd', '⇧K')));
    v.riser.forEach((c, i) => {
      const playing = v.beat === `pin:${c.id}` && !v.audition;
      const name = h('input.grd-short', { type: 'text', value: c.name, maxlength: 24, 'aria-label': `Card ${i + 1}’s name on the riser`, dataset: { k: `name:${c.id}` },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = c.name; e.currentTarget.blur(); }
        },
        onchange: (e) => { const t = e.currentTarget.value.trim(); if (t && t !== c.name) act.rename(c.id, t); else e.currentTarget.value = c.name; } });
      const rows = c.g ? rowsOf(c.g) : [];
      const grid = h('div.grd-grid', rows.map((r) => [h('span', { title: r.label }, r.label), r.cells.map((x, k) => h('button' + (x ? '.h' + x : '') + (k % 4 === 0 ? '.grd-q' : ''), {
        type: 'button', dataset: { k: `step:${c.id}:${r.row}:${k}`, step: String(k) },
        'aria-label': `${c.name}: ${r.label}, step ${k + 1}, ${['a rest', 'a hit', 'an accent'][x]}`,
        onclick: () => act.step(c.id, r.row, k),
      }))]));
      page.append(h('div.grd-pin', { dataset: { playing: playing ? '1' : '', pin: c.id } },
        h('div.grd-nm', h('div.grd-name', name), h('span.grd-from', `${c.groove === GUIDE_ID ? 'The room’s guide beat' : c.label}${c.edited ? ', edited' : ''}`)),
        h('div.grd-acts',
          h('button', { type: 'button', dataset: { k: `play:${c.id}` }, onclick: () => act.pick(c.id) }, playing ? (v.playing ? 'Playing' : 'Picked') : 'Play'),
          h('button', { type: 'button', 'aria-label': `${c.name}: earlier on the riser`, disabled: i === 0, dataset: { k: `up:${c.id}` }, onclick: () => act.move(c.id, -1) }, '↑'),
          h('button', { type: 'button', 'aria-label': `${c.name}: later on the riser`, disabled: i === v.riser.length - 1, dataset: { k: `down:${c.id}` }, onclick: () => act.move(c.id, 1) }, '↓'),
          c.edited ? h('button', { type: 'button', dataset: { k: `reset:${c.id}` }, onclick: () => act.reset(c.id) }, 'As written') : null,
          h('button', { type: 'button', disabled: v.riser.length <= 1, dataset: { k: `unpin:${c.id}` }, onclick: () => act.unpin(c.id) }, 'Unpin')),
        grid));
    });
    const room = v.max - v.riser.length;
    page.append(h('p.grd-sub', room > 0 ? `Room for ${room} more on the riser: pin one from the book.` : `The riser holds ${v.max}. Unpin one to make room.`));
    return page;
  }

  function libPage(v) {
    const all = shelves(), st = all.find((x) => x.id === style) || all[0];
    const count = library().grooves.length;
    const page = h('section.grd-page', { dataset: { page: 'book' } },
      h('h2', 'Every groove'),
      h('p.grd-sub', `${count} grooves in ${all.length} styles. Play one now, or pin it to the riser.`),
      h('div.grd-tabs', { 'aria-label': 'Styles' }, all.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === st.id), dataset: { k: `style:${x.id}` }, onclick: () => { style = x.id; render(true); } }, x.name))));
    if (!st) return page;
    page.append(h('p.grd-sub', { style: 'margin-top:0' }, sentence(st.blurb), tempoText(st)));
    for (const part of st.parts) {
      page.append(h('h3', part.label));
      for (const g of part.grooves) {
        const pinned = v.riser.find((c) => c.groove === g.id && !c.edited) || null;
        const playing = v.playing && (v.audition === g.id || (!v.audition && pinned && v.beat === `pin:${pinned.id}`));
        page.append(h('div.grd-gv', { dataset: { on: pinned ? '1' : '', playing: playing ? '1' : '', groove: g.id } },
          h('div.grd-gn', g.name, h('small', bars(g))),
          h('div.grd-acts',
            h('button', { type: 'button', dataset: { k: `try:${g.id}` }, onclick: () => act.audition(g.id) }, playing ? 'Playing' : 'Play now'),
            pinned ? h('button', { type: 'button', disabled: true }, 'On the riser') : h('button', { type: 'button', dataset: { k: `pin:${g.id}` }, onclick: () => act.pin(g.id) }, 'Pin')),
          h('span.grd-vmini', (() => { const m = miniOf(g); return ['top', 'snare', 'kick'].map((r) => m[r].map((x) => h('i' + (x ? '.h' + x : '')))); })())));
      }
    }
    return page;
  }

  function render(force = false) {
    if (el.hidden && !force) return;
    const v = look();
    const key = JSON.stringify([v.riser.map((c) => [c.id, c.name, c.groove, c.edited, c.edited ? JSON.stringify(c.g?.hits?.map((x) => [x.t, x.row, x.v])) : '']), v.beat, v.playing, v.audition, v.countIn, style]);
    if (!force && key === drawn) return;
    // (a card's name being typed: drawn again once it's done)
    const a = document.activeElement;
    if (a && book.contains(a) && a.tagName === 'INPUT') return;
    drawn = key;
    nowAt = '';
    const keep = [...book.querySelectorAll('.grd-page')].map((x) => x.scrollTop);
    const focusK = a && book.contains(a) ? a.dataset?.k : null;
    book.replaceChildren(pinsPage(v), libPage(v));
    [...book.querySelectorAll('.grd-page')].forEach((x, i) => { x.scrollTop = keep[i] || 0; });
    if (focusK) book.querySelector(`[data-k="${CSS.escape(focusK)}"]`)?.focus({ preventScroll: true });
  }

  return {
    render,
    frame() {
      if (el.hidden) return;
      render();
      // the step heard now, under the card that's playing (drawn by hand: the pages aren't drawn again for it)
      const v = look(), pin = v.playing && !v.audition && typeof v.beat === 'string' && v.beat.startsWith('pin:') ? v.beat.slice(4) : null;
      const want = pin != null && v.step != null ? `${pin}:${v.step}` : '';
      if (want === nowAt) return;
      nowAt = want;
      for (const b of book.querySelectorAll('.grd-grid button[data-now="1"]')) b.dataset.now = '';
      if (want) for (const b of book.querySelectorAll(`.grd-pin[data-pin="${CSS.escape(pin)}"] .grd-grid button[data-step="${v.step}"]`)) b.dataset.now = '1';
    },
    dispose() { book.remove(); },
  };
}
