// A card's menu [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.9): Again, the other side, another feel, simpler or
// busier, softer or louder, ×2, round and round, its name, earlier or later, shorter, the bass yourself, remove. Each
// item has its key, and each is one undo step by the right author (the stage's press(id) does it). A menu inside the
// room's overlay, under its card: ↑ ↓ walk it, Enter or a tap picks, Esc closes it and gives focus back to the card.
//
//   menuItems(view, card, { feels, names }) -> [{ id, label, key?, group?, arg?, disabled? }]   what a card's menu
//       holds: its items in §3.9's order, the ones the place has (the double at the electric places but the blues bar,
//       Earlier only when there's a part before it); feels: the feels its place offers for it (places.js feelsOf);
//       names: the names its Name chips offer
//   openMenu({ host, anchor, title, items, onPick(item), onClose() }) -> { el, close(), focus() }

import { h } from '../dom.js';

const NAME_CHIPS = { metal: ['Chorus', 'Pre-chorus', 'Breakdown', 'Bridge'], basement: ['Chorus', 'Pre-chorus', 'Bridge', 'Verse'], bluesbar: ['Head', 'Solo', 'Turnaround', 'Ending'], kitchen: ['Verse', 'Chorus', 'Bridge', 'Intro'] };

export function menuItems(view, card, { feels = [] } = {}) {
  if (!card) return [];
  const parts = view.parts || [];
  const i = parts.findIndex((c) => c.id === card.id);
  const items = [];
  const electric = view.place !== 'kitchen';
  if (card.end) return [{ id: 'again', label: 'Again', key: 'R' }];
  items.push({ id: 'again', label: card.empty ? `Play the ${String(card.name).toLowerCase()}` : 'Again', key: 'R' });
  if (electric && view.place !== 'bluesbar' && !card.empty) items.push({ id: 'other', label: 'The other side', key: 'D' });
  if (electric) {
    if (feels.length > 1 || (feels.length && card.part?.feel !== feels[0])) items.push({ id: 'feel', label: 'Another feel', key: 'F' });
    items.push({ id: 'simpler', label: 'Simpler', group: 'busy', disabled: card.part?.busy === -1 }, { id: 'busier', label: 'Busier', group: 'busy', disabled: card.part?.busy === 1 });
    items.push({ id: 'softer', label: 'Softer', group: 'loud', disabled: card.part?.loud === -1 }, { id: 'louder', label: 'Louder', group: 'loud', disabled: card.part?.loud === 1 });
  }
  items.push({ id: 'twice', label: '×2', key: 'X' });
  if (electric) items.push({ id: 'loop', label: 'Round and round', key: 'L' });
  for (const n of NAME_CHIPS[view.place] || NAME_CHIPS.metal) if (n.toLowerCase() !== String(card.name).toLowerCase()) items.push({ id: 'name', label: n, group: 'name', arg: n });
  items.push({ id: 'name', label: 'Other…', group: 'name', arg: null });
  if (i > 0) items.push({ id: 'earlier', label: 'Earlier', key: '⌥←', group: 'move' });
  if (i >= 0 && i < parts.length - 1) items.push({ id: 'later', label: 'Later', key: '⌥→', group: 'move' });
  const bpb = view.bpb || 4, bars = Math.round(card.length / bpb);
  for (const n of [4, 2, 1]) if (n < bars && bars % n === 0) items.push({ id: 'shorter', label: `${n} bar${n === 1 ? '' : 's'}`, group: 'shorter', arg: n });
  if (electric && view.roles?.bass && !card.empty) items.push({ id: 'bassYours', label: 'Play the bass yourself' });
  items.push({ id: 'remove', label: 'Remove', key: '⌫' });
  return items;
}

const GROUPS = { busy: 'The drummer', loud: '', name: 'Name', move: '', shorter: 'Shorter: keep the first' };

export function openMenu({ host, anchor = null, title = '', items = [], onPick = () => {}, onClose = () => {} }) {
  const el = h('div.lr-menu', { role: 'menu', 'aria-label': title || 'The part', tabindex: -1 });
  let open = true;
  const buttons = [];
  let group = null, row = null;
  for (const it of items) {
    const b = h('button.lr-mi', { type: 'button', role: 'menuitem', disabled: !!it.disabled, onclick: () => pick(it) }, h('span', it.label), it.key ? h('kbd.lr-kbd', it.key) : null);
    buttons.push(b);
    if (it.group) {
      if (group !== it.group) {
        group = it.group;
        row = h('div.lr-mrow', { role: 'group', 'aria-label': GROUPS[it.group] || it.group }, GROUPS[it.group] ? h('span.lr-mlabel', GROUPS[it.group]) : null);
        el.append(row);
      }
      row.append(b);
    } else { group = null; row = null; el.append(b); }
  }
  host.append(el);
  place();
  function place() {
    if (!anchor?.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect(), m = el.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    let top = r.top - m.height - 8;
    if (top < 8) top = Math.min(vh - m.height - 8, r.bottom + 8);
    const left = Math.max(8, Math.min(vw - m.width - 8, r.left));
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${left}px`;
  }
  function pick(it) { if (it.disabled) return; close(); onPick(it); }
  function close() {
    if (!open) return;
    open = false;
    el.remove();
    document.removeEventListener('pointerdown', away, true);
    onClose();
    try { if (anchor?.isConnected) anchor.focus({ preventScroll: true }); } catch { /* ok */ }
  }
  function away(e) { if (!el.contains(e.target) && e.target !== anchor) close(); }
  el.addEventListener('keydown', (e) => {
    const live = buttons.filter((b) => !b.disabled);
    const i = live.indexOf(/** @type {any} */ (document.activeElement));
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); live[(i + 1) % live.length]?.focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); live[(i - 1 + live.length) % live.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); live[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); live[live.length - 1]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
  });
  setTimeout(() => { if (open) document.addEventListener('pointerdown', away, true); }, 0);
  const focus = () => buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  setTimeout(focus, 0);
  return { el, close, focus, get open() { return open; } };
}
