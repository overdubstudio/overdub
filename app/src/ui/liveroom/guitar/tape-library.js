// The riff library [ui; the guitar room's TAPE stream] (docs/research/GUITAR-ROOM.md §2.4; design/mock/guitar-room/
// 07a-07c). Every riff you've kept, across every song, in this browser (ui/liveroom/riffs-db.js: IndexedDB
// 'overdub-riffs'), over the whole view (R.sheet('library'), the overlay 'library'). Built for thousands: a page of
// rows at a time (riffs-db list, newest first, its next token as you scroll), never a riff's audio until you hear it.
// Search (the name and the song's title), the songs down the side (riffs-db facets), tuning, tempo, when, starred.
// A riff: put it on the part line (Enter, or a double click), hear it round and round through your rig, star it, name
// it, or take it out of the library (Put it back brings it in again, as it was).
//
//   createLibrary(R, { hear, tray }) -> lib
//     lib.open() -> Promise<{ ok }>     lib.close() -> bool     lib.isOpen() -> bool
//     lib.filter(patch) -> Promise      set the filter ({ q, song, tuning, tempo, when, starred }) and list again
//     lib.select(id)                    the riff in the detail pane      lib.selected() -> Row | null
//     lib.rows() -> [Row]               what's listed      lib.frame(now), lib.dispose()

import { h, tok } from '../../dom.js';
import * as riffs from '../riffs-db.js';
import { TUNINGS } from '../../../core/fretboard.js';
import { TAPE_LINES as T_, bars as nBars, secs } from './tape-lines.js';
import { drawPeaks, SESSION } from './tape-tray.js';

const kbd = (k) => h('kbd', k);
const PAGE = 80;
const DAY = 86400000;
const TEMPOS = [['slow', 'under 100', [20, 99.99]], ['mid', '100 to 139', [100, 139.99]], ['fast', '140 and up', [140, 400]]];
const WHENS = [['today', 'today', 1], ['week', 'this week', 7], ['month', 'this month', 31]];
const tuningName = (id) => TUNINGS[id]?.name || id || 'Standard';
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function when(at) {
  const now = Date.now(), d = new Date(at);
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at >= dayStart(now)) return `today, ${hm}`;
  if (at >= dayStart(now) - DAY) return `yesterday, ${hm}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}
function group(at) {
  const now = Date.now();
  if (at >= SESSION) return 'This session';
  if (at >= dayStart(now)) return 'Earlier today';
  if (at >= dayStart(now) - DAY) return 'Yesterday';
  if (at >= dayStart(now) - 6 * DAY) return 'This week';
  if (at >= dayStart(now) - 30 * DAY) return 'This month';
  return 'Before that';
}
// (replaceChildren with what h() takes: nulls skipped, arrays flattened)
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(2).filter((k) => k != null && k !== false));
const keyText = (k) => (k ? `${k.root} ${k.scale || ''}`.trim() + (k.sure ? '' : '?') : '—');

export function createLibrary(R, { hear, tray }) {
  const el = R.sheet('library');
  el.classList.add('gr-lb');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'The riff library');
  const F = { q: '', song: null, tuning: null, tempo: null, when: null, starred: false };
  let open = false, rows = [], next = null, loading = false, sel = null, facets = null, gone = null, renaming = false, seq = 0;

  /* ---------------------------------------------------------------- the frame */
  const count = h('span.gr-lb-count');
  const q = h('input.gr-lb-q', { type: 'search', placeholder: 'Search names and songs', 'aria-label': 'Search the riffs', autocomplete: 'off', spellcheck: false, 'data-typing': '' });
  let qT = 0;
  q.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => filter({ q: q.value }), 140); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (q.value) { q.value = ''; filter({ q: '' }); } else list.focus({ preventScroll: true }); }
    else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); list.focus({ preventScroll: true }); }
  });
  const filters = h('div.gr-lb-filters');
  const songs = h('nav.gr-lb-songs', { 'aria-label': 'Songs' });
  const list = h('div.gr-lb-list', { role: 'listbox', tabindex: 0, 'aria-label': 'Riffs' });
  const detail = h('aside.gr-lb-detail');
  const goneBar = h('div.gr-lb-gone', { hidden: true });
  el.replaceChildren(
    h('div.gr-lb-head', h('h2.gr-lb-h2', 'Riffs'), count, h('span.gr-gap'), h('label.gr-lb-search', h('span.gr-lb-glass', { 'aria-hidden': 'true' }, '⌕'), q),
      h('button.btn.gr-lb-back', { type: 'button', onclick: () => R.press('back') }, 'Back to the stage', kbd('Esc'))),
    filters, songs, h('div.gr-lb-mid', goneBar, list), detail);

  /* ---------------------------------------------------------------- listing */
  function query(after = null) {
    const w = F.when ? WHENS.find((x) => x[0] === F.when) : null;
    return {
      q: F.q, song: F.song, tuning: F.tuning, starred: F.starred, limit: PAGE, after,
      ...(F.tempo ? { tempo: TEMPOS.find((x) => x[0] === F.tempo)[2] } : {}),
      ...(w ? { from: w[2] === 1 ? dayStart(Date.now()) : Date.now() - w[2] * DAY } : {}),
    };
  }
  async function load(more = false) {
    const my = ++seq;
    loading = true;
    let page;
    try { page = await riffs.list(query(more ? next : null)); } catch (e) { console.error('library: list', e); page = { rows: [], next: null }; }
    loading = false;
    if (my !== seq || !open) return;
    // (a page more is added under the rows already drawn: a library of thousands, scrolled, isn't drawn again each page)
    const had = more ? rows.length : 0;
    rows = more ? [...rows, ...page.rows] : page.rows;
    next = page.next;
    if (more && had) { appendRows(had); return; }
    if (!sel || !rows.some((r) => r.id === sel)) sel = rows[0]?.id || null;
    renderList();
    renderDetail();
  }
  async function loadFacets() {
    try { facets = await riffs.facets(); } catch { facets = null; }
    if (open) { renderFilters(); renderSongs(); renderCount(); }
  }
  async function filter(patch = {}) {
    Object.assign(F, patch);
    renderFilters(); renderSongs();
    await load(false);
    renderCount();
  }

  /* ---------------------------------------------------------------- drawing */
  function renderCount() {
    const total = facets?.total ?? 0, nSongs = facets?.songs?.length ?? 0;
    const filtered = F.q || F.song !== null || F.tuning || F.tempo || F.when || F.starred;
    count.textContent = filtered ? `${rows.length}${next ? '+' : ''} of ${total} riffs` : `${total} riff${total === 1 ? '' : 's'}, from ${nSongs} song${nSongs === 1 ? '' : 's'}`;
  }
  const chip = (label, on, fn) => h('button.btn.btn-txt.gr-lb-chip', { type: 'button', 'aria-pressed': String(!!on), onclick: fn }, label);
  function renderFilters() {
    const tunings = (facets?.tunings || []).slice(0, 6);
    fill(filters,
      tunings.length > 1 ? h('span.gr-lb-f', h('span', 'Tuning'), tunings.map((t) => chip(tuningName(t.id), F.tuning === t.id, () => filter({ tuning: F.tuning === t.id ? null : t.id })))) : null,
      h('span.gr-lb-f', h('span', 'Tempo'), TEMPOS.map(([id, label]) => chip(label, F.tempo === id, () => filter({ tempo: F.tempo === id ? null : id })))),
      h('span.gr-lb-f', h('span', 'When'), WHENS.map(([id, label]) => chip(label, F.when === id, () => filter({ when: F.when === id ? null : id })))),
      h('span.gr-lb-f', chip('★ starred', F.starred, () => filter({ starred: !F.starred }))));
  }
  function renderSongs() {
    const here = R.store.get().id;
    const ss = facets?.songs || [];
    const mine = ss.find((s) => s.id === here);
    const btn = (id, label, n) => h('button.gr-lb-song', { type: 'button', 'aria-pressed': String(F.song === id), onclick: () => filter({ song: id }) }, h('span', label), n != null ? h('span.gr-lb-n', String(n)) : null);
    fill(songs, h('h3', 'Songs'),
      btn(null, 'Every song', facets?.total ?? null),
      mine ? btn(mine.id, mine.title ? `This song: ${mine.title}` : 'This song', mine.count) : null,
      ss.filter((s) => s.id !== here).map((s) => btn(s.id, s.title || 'A song with no name yet', s.count)));
  }
  function row(r) {
    const cv = h('canvas.gr-lb-wv', { 'aria-hidden': 'true' });
    const el2 = h('div.gr-lb-row', { role: 'option', id: `gr-lb-${r.id}`, 'aria-selected': String(r.id === sel), dataset: { riff: r.id }, onclick: () => select(r.id), ondblclick: () => put(r.id) },
      h('span.gr-lb-st', r.starred ? '★' : ''), h('span.gr-lb-nm', r.name),
      h('span.gr-lb-sg', r.song === R.store.get().id ? 'this song' : r.songTitle || h('span.gr-t3', 'no name yet')),
      cv, h('span.gr-lb-num', nBars(Math.round(r.bars * 4) / 4)), h('span.gr-lb-num', String(Math.round(r.tempo))),
      h('span.gr-lb-tn', tuningName(r.tuning)), h('span.gr-lb-key' + (r.key && !r.key.sure ? '.gr-t3' : ''), keyText(r.key)), h('span.gr-lb-stk', r.stack?.name || r.stack?.amp || ''));
    requestAnimationFrame(() => drawPeaks(cv, r.peaks, { color: r.id === sel ? tok('--bg') || '#141210' : tok('--text-3') || '#9a8f7c' }));
    return el2;
  }
  // the rows from i on, with a group's heading where the group changes
  function rowsFrom(i) {
    const kids = [];
    let g = i > 0 ? group(rows[i - 1].at) : null;
    for (const r of rows.slice(i)) {
      const gg = group(r.at);
      if (gg !== g) { g = gg; kids.push(h('div.gr-lb-grp', { role: 'presentation' }, gg)); }
      kids.push(row(r));
    }
    return kids;
  }
  const moreEl = () => h('div.gr-lb-more', { 'aria-hidden': 'true' }, 'More below…');
  function appendRows(i) {
    list.querySelector('.gr-lb-more')?.remove();
    list.append(...rowsFrom(i), ...(next ? [moreEl()] : []));
    renderCount();
  }
  function renderList() {
    const kids = [h('div.gr-lb-th', ['', 'Name', 'Song', '', 'Length', 'BPM', 'Tuning', 'Key', 'Stack'].map((t) => h('span', t))), ...rowsFrom(0)];
    if (!rows.length) kids.push(h('p.gr-lb-empty', loading ? 'Reading the library…' : (facets?.total ? 'No riff matches. Clear a filter, or search for something shorter.' : 'No riffs yet. Play something you like on the stage, then G keeps it off the tape.')));
    if (next) kids.push(moreEl());
    list.replaceChildren(...kids);
    list.setAttribute('aria-activedescendant', sel ? `gr-lb-${sel}` : '');
    list.querySelector('.gr-lb-row[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function renderDetail() {
    const r = rows.find((x) => x.id === sel);
    if (!r) { detail.replaceChildren(); return; }
    const cv = h('canvas.gr-lb-big', { 'aria-hidden': 'true' });
    const name = renaming
      ? h('input.gr-lb-rename', { type: 'text', value: r.name, 'aria-label': 'The riff’s name', maxlength: 100, 'data-typing': '' })
      : h('h2.gr-lb-dn', r.name);
    if (renaming) {
      name.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); await rename(r.id, name.value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renaming = false; renderDetail(); list.focus({ preventScroll: true }); }
      });
      requestAnimationFrame(() => { name.focus(); name.select(); });
    }
    const playing = hear.key === r.id;
    detail.replaceChildren(
      h('h3', r.song === R.store.get().id ? 'From this song' : r.songTitle ? `From ${r.songTitle}` : 'From a song with no name yet'),
      name, cv,
      h('dl.gr-lb-facts',
        h('dt', 'Length'), h('dd', `${nBars(Math.round(r.bars * 4) / 4)}, ${secs((r.beats * 60) / r.tempo)}`),
        h('dt', 'Tempo'), h('dd', `${Math.round(r.tempo * 10) / 10} BPM`),
        h('dt', 'Tuning'), h('dd', tuningName(r.tuning)),
        h('dt', 'Key'), h('dd', r.key ? [keyText(r.key).replace(/\?$/, ''), h('span.gr-t3', r.key.sure ? '' : ' (read, not sure)')] : h('span.gr-t3', 'not read')),
        h('dt', 'Stack'), h('dd', r.stack?.name || r.stack?.amp || h('span.gr-t3', 'straight in')),
        h('dt', 'Kept'), h('dd', when(r.at))),
      h('div.gr-lb-acts',
        h('button.btn.btn-go.gr-lb-put', { type: 'button', onclick: () => put(r.id) }, h('span', 'Put it on the part line'), kbd('Enter')),
        h('button.btn.gr-lb-hear', { type: 'button', 'aria-pressed': String(playing), onclick: () => hearIt(r) }, h('span', playing ? 'Stop' : 'Hear it, round and round'), kbd('Space')),
        h('button.btn', { type: 'button', 'aria-pressed': String(!!r.starred), onclick: () => star(r) }, r.starred ? 'Unstar' : 'Star'),
        h('button.btn', { type: 'button', onclick: () => { renaming = true; renderDetail(); } }, 'Rename', kbd('F2')),
        h('button.btn.gr-lb-del', { type: 'button', onclick: () => remove(r) }, 'Take it out of the library')),
      h('p.gr-lb-hint', kbd('↑'), kbd('↓'), ' move through the list. The key is read off the riff, so it can be off.'));
    requestAnimationFrame(() => drawPeaks(cv, r.peaks, { color: tok('--text-2') || '#cbc0aa', step: 3, bar: 2 }));
  }

  /* ---------------------------------------------------------------- what you do to a riff */
  function select(id) {
    if (!rows.some((r) => r.id === id)) return;
    sel = id; renaming = false;
    for (const x of list.querySelectorAll('.gr-lb-row')) {
      const on = x.dataset.riff === id;
      if ((x.getAttribute('aria-selected') === 'true') !== on) {
        x.setAttribute('aria-selected', String(on));
        const r = rows.find((y) => y.id === x.dataset.riff);
        drawPeaks(x.querySelector('canvas'), r?.peaks, { color: on ? tok('--bg') || '#141210' : tok('--text-3') || '#9a8f7c' });
      }
    }
    list.setAttribute('aria-activedescendant', `gr-lb-${id}`);
    list.querySelector('.gr-lb-row[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    renderDetail();
  }
  async function put(id) {
    const r = rows.find((x) => x.id === id);
    if (!r) return { ok: false };
    close();
    R.drawer(true);
    return tray.place(r);
  }
  async function hearIt(r) {
    if (hear.key === r.id) hear.stop();
    else {
      const buf = await riffs.buffer(r.id);
      if (buf && open) { const from = r.offset || 0; if (await hear.play(r.id, { buffer: buf, from, to: from + (r.beats * 60) / r.tempo })) R.say(T_.hear({ name: r.name })); }
    }
    renderDetail();
  }
  async function star(r) {
    const u = await riffs.star(r.id, !r.starred);
    if (u.ok) { rows = rows.map((x) => (x.id === r.id ? u.row : x)); renderList(); renderDetail(); loadFacets(); }
  }
  async function rename(id, name) {
    const u = await riffs.rename(id, name);
    renaming = false;
    if (u.ok) { rows = rows.map((x) => (x.id === id ? u.row : x)); R.say(T_.renamed({ name: u.row.name })); tray.refresh(); }
    renderList(); renderDetail();
    list.focus({ preventScroll: true });
  }
  async function remove(r) {
    if (hear.key === r.id) hear.stop();
    const whole = await riffs.remove(r.id);
    if (!whole) return;
    gone = whole;
    const i = rows.findIndex((x) => x.id === r.id);
    rows = rows.filter((x) => x.id !== r.id);
    sel = rows[Math.min(i, rows.length - 1)]?.id || null;
    goneBar.hidden = false;
    goneBar.replaceChildren(h('span', `${r.name} is out of the library.`), h('button.btn', { type: 'button', onclick: () => putBack() }, 'Put it back'));
    R.say(T_.gone({ name: r.name }));
    renderList(); renderDetail(); loadFacets(); tray.refresh();
  }
  async function putBack() {
    if (!gone) return;
    const w = gone; gone = null;
    goneBar.hidden = true;
    const res = await riffs.restore(w);
    if (res.ok) { R.say(T_.back({ name: w.row.name })); sel = w.row.id; await load(false); loadFacets(); tray.refresh(); }
  }
  list.addEventListener('keydown', (e) => {
    if (renaming) return;
    const i = rows.findIndex((r) => r.id === sel);
    const go = (j) => {
      e.preventDefault();
      if (rows.length) select(rows[Math.max(0, Math.min(rows.length - 1, j))].id);
      // (the keys page on too: near the end of what's listed, the next page comes)
      if (next && !loading && j >= rows.length - 10) load(true);
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'PageDown') go(i + 10);
    else if (e.key === 'PageUp') go(i - 10);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if ((e.key === 'Enter' || e.key === 'NumpadEnter') && sel) { e.preventDefault(); e.stopPropagation(); put(sel); }
    else if (e.key === 'F2' && sel) { e.preventDefault(); renaming = true; renderDetail(); }
    // (a list keeps Space, the shell's rule: here it hears the riff)
    else if (e.key === ' ' && sel) { e.preventDefault(); const r = rows.find((x) => x.id === sel); if (r) hearIt(r); }
  });
  list.addEventListener('scroll', () => { if (next && !loading && list.scrollTop + list.clientHeight > list.scrollHeight - 300) load(true); });

  /* ---------------------------------------------------------------- open, close */
  function fit() { el.style.height = `${R.el.view.clientHeight}px`; }
  async function openIt() {
    if (open) return { ok: true };
    open = true;
    renaming = false; gone = null; goneBar.hidden = true;
    fit();
    R.overlay('library');
    renderFilters(); renderSongs(); renderCount();
    rows = []; renderList();
    setTimeout(() => { if (open) list.focus({ preventScroll: true }); }, 0);
    await Promise.all([loadFacets(), load(false)]);
    renderCount();
    return { ok: true };
  }
  function close() {
    if (!open) return false;
    open = false;
    if (hear.key && rows.some((r) => r.id === hear.key)) hear.stop();
    if (R.gr.overlay === 'library') R.overlay(null);
    return true;
  }
  let lastFit = 0;
  return {
    open: openIt, close, filter, select,
    isOpen: () => open,
    rows: () => rows.slice(),
    selected: () => rows.find((r) => r.id === sel) || null,
    frame(now) { if (open && now - lastFit > 250) { lastFit = now; if (Math.abs(el.clientHeight - R.el.view.clientHeight) > 1) fit(); } },
    dispose() { open = false; clearTimeout(qT); },
  };
}
