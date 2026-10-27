// The shop [ui; the guitar room's SHOP stream] (docs/research/GUITAR-ROOM.md §2.9; design/mock/guitar-room-2/
// shot 04a-04h, and the first mock's 08 shots for the rack). Through the door under NO STAIRWAY: a magical guitar
// center you browse by looking. The amp wall in sections by tone (CLEAN, CRUNCH, WEIRD, HIGH GAIN, BASS), each amp a
// little amp on its shelf with a brass name plate; the pedal case in drawers by type, each pedal at size with its tag;
// the rack of saved stacks; your stack big in the try-out corner (the head on its cab, the mics on the grille) and
// your board along the front. Look at a thing and its card says who it is; hold your look a moment and you hear it
// (a preview: store.preview, nothing in History, taken back when you look away); a click or Enter carries it into
// your rig and you're playing through it. Everything that changes the song goes through R.rig (./bind.js: both
// guitars, by you, one undo step, refused during a take) or store.dispatch by you (the song's room.stack, joined to
// the swap that loaded it, so a load is one step). Nothing saves to the rack unless you press Save to rack.
//
// It owns the shop world (R.el.shop: pixels, wall, case, corner, hot, and a rack layer of its own), the camera targets
// 'wall', 'case', 'rack' (the shop at a glance: the area changes, the camera stays) and 'tryout-head', 'tryout-cab'
// (the drawn head and cab, closer), the panels R.panel('tryout-head'), R.panel('tryout-cab') and the stage's cab zoom
// R.panel('cab') (the cab builder, ./shop-cab.js), R.gr.shop, and room.set { stack }.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'shop:wall', 'shop:case', 'shop:head', 'shop:cab', 'cat:prev', 'cat:next',
//                                             'save', 'rack'
//     back() -> bool                          Esc in the shop: a name being typed, then a try (the camera does the rest:
//                                             the try-out corner back to the wall or the case, then the stage)
//     frame(now), unmount()
//     carry(what) -> { ok, error? }           what: { stack } (a whole stack: an amp and its pedals; with a rack id
//                                             the song's room.stack names it, without one it names none) or { link }
//                                             (one pedal, { device, params, on }, or an amp: it takes the amp's place,
//                                             on your cab): into the rig, one undo step
//   press('save') opens the name field where you are (the stack's plate, the rack's sheet, the cab builder); from
//   anywhere else it goes to the rack first
//     save(name) -> Promise<{ ok, id?, error? }>   the rig as it is now into the rack
//   }
//   and, beside the frozen API:
//     load(id) -> Promise<{ ok, error? }>     a rack stack (yours, the house's, the club's 'house.metal.club') onto both
//                                             guitars and the song's room.stack, one step
//     tryOn(device) -> bool, release()        hear an amp or a pedal without keeping it (the try-out); release puts the
//                                             rig back
//     area() -> 'wall' | 'case' | 'rack'
//     changed() -> bool                       the rig isn't the rack stack it came from (room.stack) any more
//
// R.gr.shop (./state.js): { area, cat, look } and the stream's own: trying (device id | null), mics ([{ cone, ang }]:
// where each mic stands around its cone), dragging, sel (the rack's selected stack id), removed (a stack taken off the
// rack, for Put it back), base ({ id, chain } the stack room.stack names).

import { h, css } from '../../dom.js';
import { renderFace, injectFaceCss, AMP_LOOK_IDS, hashId } from '../../faces.js';
import { evaluate as evalLooks } from '../../../devices/guitar/looks.gen.js';
import { clawd } from '../../../devices/guitar/index.js';
import { paramValues } from '../../../devices/registry.js';
import { planSwap, planAdd } from '../../../core/liveroom/guitar/rig.js';
import { CLUB_STACK } from '../../../core/liveroom/guitar/setup.js';
import { sameChain } from '../../../core/liveroom/stacks.js';
import { roomOf } from '../../../core/liveroom/model.js';
import * as rack from '../rack-db.js';
import { SHOP } from './layout.js';
import { CSS as SHOP_CSS } from './shop-style.js';
import { SHOPL, sizeShop, drawShop } from './shop-pixels.js';
import { cabView, placeMics, cabPanel } from './shop-cab.js';
import { SAY } from './shop-say.js';
import {
  ampsBySection, pedalsByCat, typeWord, toneWord, toneOf, CAT_WORD, inLoop, ordinal, isAmp, cabBox, cabOf, carriedAmp, describeStack,
} from './shop-data.js';

const FONTS = { dirt: '"Rubik Dirt", Impact, "Arial Black", sans-serif', pixel: 'Silkscreen, ui-monospace, monospace' };
let LOOKS = null;
const looks = () => (LOOKS ||= evalLooks({ FONTS, PLUG_AMPS: clawd.PLUG_AMPS }));
const ampLookId = (d) => { const L = looks(); return d.look?.amp && L.AMP_LOOKS[d.look.amp] ? d.look.amp : d.amp && L.AMP_LOOKS[d.amp] ? d.amp : AMP_LOOK_IDS[hashId(d.id) % AMP_LOOK_IDS.length]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const place = (el, x, y, w, hh) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (w != null) el.style.width = w + 'px'; if (hh != null) el.style.height = hh + 'px'; return el; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const AREAS = ['wall', 'case', 'rack'];
const SHOP_CAMS = ['shop', 'wall', 'case', 'rack', 'tryout-head', 'tryout-cab'];
const DWELL = 650;          // ms a look is held before you hear the thing
const BOARD_MAX = 8;        // the keys 1-8
const HOUSE_IDS = [CLUB_STACK.id, 'house.metal.modern', 'house.metal.djent', 'house.metal.thrash'];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const kbd = (t) => h('kbd', t);
// (the Half Stack's cab is a menu of eight on its own face: on the head it's left to the cab builder, so the head
// draws no select)
const headDef = (d) => (d.id === 'core.stack' ? { ...d, params: d.params.map((p) => (p.key === 'cab' ? { ...p, group: 'cab' } : p)) } : d);

export function mount(R) {
  css('gr-shop', SHOP_CSS);
  injectFaceCss();
  const { store } = R;
  const S = R.gr.shop;
  Object.assign(S, { area: AREAS.includes(S.area) ? S.area : 'wall', cat: S.cat || 'dynamics', look: null, trying: null, mics: S.mics || [], dragging: false, sel: null, removed: null, base: null });
  const E = R.el.shop;
  const rackLayer = h('div.grs-layer.grs-rackl', { hidden: true });
  E.world.insertBefore(rackLayer, E.corner);
  for (const l of [E.wall, E.case, E.corner, E.hot]) l.classList.add('grs');
  rackLayer.classList.add('grs');
  const offs = [];
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const say = (text) => { try { R.say(text); } catch (e) { console.error('shop say', e); } };
  // (a stand-off element in the room to measure faces in before they're placed)
  const tmp = h('div', { style: { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', pointerEvents: 'none' }, 'aria-hidden': 'true' });
  R.el.root.append(tmp);

  /* --------------------------------------------------------------------------------------- the rig, read */
  const rigNow = () => R.rig.now();
  const room = () => roomOf(store.get()) || {};
  const ampLink = () => { const r = rigNow(); return r?.amp ? r.chain[r.amp.slot] : null; };
  const pedalsOn = () => (rigNow()?.board || []);
  function changed() {
    const r = rigNow(), st = room().stack;
    if (!r) return false;
    if (!st) return true;
    if (!S.base || S.base.id !== st.id) return false;
    return !sameChain(r.chain, S.base.chain);
  }
  async function loadBase() {
    const st = room().stack;
    if (!st) { S.base = null; return; }
    if (S.base?.id === st.id) return;
    const s = await rack.get(st.id);
    if (room().stack?.id !== st.id) return;
    S.base = s ? { id: st.id, chain: s.chain, name: s.name } : null;
    drawPlate();
  }

  /* --------------------------------------------------------------------------------------- the world */
  const cv = h('canvas');
  E.pixels.append(cv);
  const g = sizeShop(cv);
  let built = false;
  const wallLayout = { signs: [], shelves: [] };
  const caseShelves = [];
  const drawPixels = () => drawShop(g, { area: S.area, signs: wallLayout.signs, shelves: wallLayout.shelves, caseShelves });
  drawPixels();

  // the bar along the ceiling, the door, the card
  const bar = h('div.grs-bar', { role: 'toolbar', 'aria-label': 'The shop' },
    h('button', { type: 'button', dataset: { go: 'stage' }, onclick: () => R.press('shop') }, '← The stage', kbd('S')),
    h('button', { type: 'button', dataset: { go: 'wall' }, onclick: () => R.press('shop:wall') }, 'Amp wall', kbd('A')),
    h('button', { type: 'button', dataset: { go: 'case' }, onclick: () => R.press('shop:case') }, 'Pedal case', kbd('P')),
    h('button', { type: 'button', dataset: { go: 'rack' }, onclick: () => R.press('rack') }, 'The rack'));
  place(bar, SHOPL.bar.x, SHOPL.bar.y);
  const D = SHOPL.door;
  const door = place(h('button.grs-door', { type: 'button', 'aria-label': 'The door back to the stage', dataset: { say: 'Back to the stage  S' }, onclick: () => R.press('shop') }), D.x, D.y, D.w, D.h);
  const card = h('div.grs-card', { 'aria-hidden': 'true' });
  E.hot.append(bar, door, card);
  const markBar = () => { for (const b of bar.querySelectorAll('[data-go]')) b.setAttribute('aria-pressed', String(b.dataset.go === S.area && AREAS.includes(R.gr.cam))); };

  function showArea(a) {
    if (!AREAS.includes(a)) return;
    const was = S.area;
    S.area = a;
    E.wall.hidden = a !== 'wall'; E.case.hidden = a !== 'case'; rackLayer.hidden = a !== 'rack';
    if (was !== a) {
      // (focus doesn't stay on the far side of the shop: arrows and Enter act where you're looking)
      const f = document.activeElement;
      if (f && (E.wall.contains(f) || E.case.contains(f) || rackLayer.contains(f))) /** @type {HTMLElement} */ (f).blur();
      unlook();
    }
    if (a === 'rack') renderRack();
    drawPixels();
    markBar();
  }

  /* --------------------------------------------------------------------------------------- looking, trying */
  let dwell = null;
  function lookAt(slot, info) {
    S.look = info.d.id;
    for (const s of E.world.querySelectorAll('.look')) s.classList.remove('look');
    slot.classList.add('look');
    showCard(slot, info);
    clearTimeout(dwell);
    dwell = later(() => { if (S.look === info.d.id && slot.isConnected && slot.classList.contains('look')) { tryOn(info.d.id); showCard(slot, info); } }, DWELL);
  }
  function unlook(slot = null) {
    if (slot) slot.classList.remove('look');
    if (slot && S.look && slot.dataset.id !== S.look) return;
    clearTimeout(dwell);
    S.look = null;
    card.classList.remove('on');
    release();
  }
  function wireLook(slot, info) {
    slot.addEventListener('mouseenter', () => lookAt(slot, info()));
    slot.addEventListener('focus', () => lookAt(slot, info()));
    slot.addEventListener('mouseleave', () => { if (document.activeElement !== slot) unlook(slot); });
    slot.addEventListener('blur', () => { if (!slot.matches(':hover')) unlook(slot); });
  }
  function showCard(slot, info) {
    const d = info.d;
    const hearing = S.trying === d.id;
    if (info.kind === 'amp') {
      const mine = ampLink()?.device === d.id && !hearing;
      card.className = 'grs-card';
      card.replaceChildren(h('div.in', h('span.sec', info.sec.label), h('h3.grs-disp', d.name), h('p', d.blurb || ''), d.nod ? h('p.nod', `In the spirit of ${d.nod}.`) : null,
        h('div.do', mine ? 'On your stack now.' : ['Click or ', kbd('Enter'), ' to carry it to your stack and play through it']),
        hearing ? h('span.hear', 'You’re hearing it now. Look away and your stack is back.') : null));
    } else {
      const on = pedalsOn().some((b) => b.device === d.id) && !hearing;
      card.className = 'grs-card tag';
      card.replaceChildren(h('div.in', h('span.sec', `${CAT_WORD[d.pedalCat] || 'Pedal'} · ${typeWord(d)}`), h('h3.grs-disp', d.name), h('p', d.blurb || ''), d.nod ? h('p.nod', `Tips its hat to ${d.nod}.`) : null,
        h('div.do', on ? ['On your board. ', kbd('Enter'), ' puts it back in the case'] : ['Click or ', kbd('Enter'), ` to put it on your board${inLoop(d) ? ', in the amp’s loop' : ', before the amp'}`]),
        hearing ? h('span.hear', 'You’re hearing it now. Look away and it’s back in the case.') : null));
    }
    // beside the thing, inside the wall's side of the shop
    const x0 = parseFloat(slot.style.left), y0 = parseFloat(slot.style.top), w = parseFloat(slot.style.width) || 100;
    const cw = 300, ch = card.offsetHeight || 190;
    let x = x0 + w + 10;
    if (x + cw > SHOPL.corner.x - 6) x = x0 - cw - 10;
    const y = clamp(y0 - 6, 70, SHOPL.board.y - ch - 6);
    place(card, Math.max(SHOPL.area.x - 120, x), y);
    card.classList.add('on');
  }
  // the try-out: the rig as it would be, heard and drawn, never kept
  let tried = null;
  function tryOn(device) {
    release();
    if (R.busy() || !rigNow()) return false;
    let plan = null;
    if (isAmp(device)) {
      if (ampLink()?.device === device) return false;
      plan = planSwap(store.get(), { chain: chainWithAmp(device), label: 'Trying an amp' });
    } else {
      if (pedalsOn().some((b) => b.device === device) || pedalsOn().length >= BOARD_MAX) return false;
      plan = planAdd(store.get(), { link: { device, params: {}, on: true } });
    }
    if (!plan || plan.error || !plan.ops.length) return false;
    S.trying = device;   // (before the preview: the corner redraws as it lands, and says it's a try)
    const p = store.preview(plan.ops, { by: 'you' });
    if (!p.ok) { S.trying = null; return false; }
    tried = { device, release: p.release };
    for (const s of E.world.querySelectorAll(`[data-id="${CSS.escape(device)}"]`)) s.classList.add('trying');
    return true;
  }
  // (drop: a song loaded over the try took it with it; there's nothing to put back)
  function release({ drop = false } = {}) {
    if (!tried) return;
    const t = tried;
    tried = null;
    S.trying = null;
    for (const s of E.world.querySelectorAll('.trying')) s.classList.remove('trying');
    if (drop) return;
    try { t.release(); } catch (e) { console.error('shop: the try-out', e); }
  }
  // (anything you do while something's being tried: the try goes first, so a stomp, a knob or ⌘Z acts on your own rig,
  // never on the try; a key that only moves your look, or a click on the thing to carry it, keeps it till then)
  const QUIET = new Set(['Shift', 'Alt', 'Control', 'Meta', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ']);
  const beforeKey = (e) => { if (tried && (!QUIET.has(e.key) || e.metaKey || e.ctrlKey)) release(); };
  const beforePoint = (e) => { if (tried && !(e.target instanceof Element && e.target.closest('.grs-amp, .grs-ped'))) release(); };
  window.addEventListener('keydown', beforeKey, true);
  window.addEventListener('pointerdown', beforePoint, true);
  offs.push(() => { window.removeEventListener('keydown', beforeKey, true); window.removeEventListener('pointerdown', beforePoint, true); });

  /* --------------------------------------------------------------------------------------- the amp wall */
  const ampSlots = [];
  function buildWall() {
    const A = SHOPL.area;
    const secs = ampsBySection(), by = Object.fromEntries(secs.map((s) => [s.tone, s]));
    const colW = A.w / 8;
    const bands = [{ y: A.y, secs: [['clean', 3], ['crunch', 2], ['weird', 3]] }, { y: A.y + 244, secs: [['high', 5], ['bass', 3]] }];
    const list = h('div', { role: 'listbox', 'aria-label': 'The amp wall: every amp, by its sound', 'aria-orientation': 'horizontal' });
    list.style.position = 'absolute'; list.style.inset = '0';
    for (const band of bands) {
      let col = 0;
      for (const [tone, cols] of band.secs) {
        const sec = by[tone], sx = A.x + col * colW, sw = cols * colW;
        wallLayout.signs.push({ label: sec.label, x: sx + 4, y: band.y, w: sw - 8 });
        for (let r = 0; r < 2; r++) wallLayout.shelves.push({ x: sx + 2, y: band.y + 60 + r * 92 + 64, w: sw - 4 });
        sec.amps.forEach((d, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const slot = ampSlot(d, sec);
          place(slot, sx + c * colW + 3, band.y + 60 + r * 92, colW - 6, 88);
          slot.dataset.col = String(col + c); slot.dataset.row = String((band.y > A.y ? 2 : 0) + r);
          list.append(slot);
          ampSlots.push(slot);
        });
        col += cols;
      }
    }
    E.wall.append(list);
    list.addEventListener('keydown', (e) => gridKeys(e, ampSlots));
    // (each little amp scaled to its shelf)
    for (const s of ampSlots) {
      const e = s.querySelector('.ewf');
      tmp.append(e);
      const hh = e.offsetHeight;
      s.querySelector('.ampbox').append(e);
      if (hh > 60) e.style.transform = `scale(${(60 / hh).toFixed(3)})`;
    }
  }
  function ampSlot(d, sec) {
    const am = h('span.am', { style: { width: (d.amp === 'di' ? 64 : 80) + 'px' } },
      h('i.am-top', h('i.am-pn', h('i'), h('i'), h('i'), h('i'), h('i.am-jw'))),
      h('i.am-cab', h('i.am-gr', h('i.am-face', h('i'), h('i')), h('i.am-lgw', h('b.am-lg', d.name)))));
    looks().ampPaint(am, ampLookId(d));
    am.setAttribute('aria-hidden', 'true');
    const slot = h('button.grs-amp', { type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', dataset: { id: d.id }, 'aria-label': `${d.name}, ${sec.word.toLowerCase()} amp: ${d.blurb || ''}` },
      h('span.ampbox', h('span.ewf', am)), h('span.grs-plate', d.name));
    wireLook(slot, () => ({ kind: 'amp', d, sec }));
    slot.addEventListener('click', () => carryAmp(d.id, slot));
    return slot;
  }
  // arrows among a grid of slots (a focused list keeps its arrows: ./keys.js)
  function gridKeys(e, slots) {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    const at = slots.indexOf(/** @type {any} */ (document.activeElement));
    if (at < 0) return;
    e.preventDefault(); e.stopPropagation();
    const pos = (s) => ({ x: parseFloat(s.style.left) + parseFloat(s.style.width) / 2, y: parseFloat(s.style.top) + parseFloat(s.style.height) / 2 });
    const a = pos(slots[at]);
    let best = null;
    for (const s of slots) {
      if (s === slots[at] || !s.isConnected) continue;
      const b = pos(s), dx = b.x - a.x, dy = b.y - a.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dir[0] ? dy : dx);
      const score = along + across * 2.5;
      if (!best || score < best.score) best = { s, score };
    }
    if (best) { rove(slots, best.s); best.s.focus({ preventScroll: true }); }
  }
  function rove(slots, on) { for (const s of slots) { s.tabIndex = s === on ? 0 : -1; s.setAttribute('aria-selected', String(s === on)); } }

  /* --------------------------------------------------------------------------------------- the pedal case */
  const CATS = pedalsByCat();
  let pedSlots = [];
  const catTabs = h('div.grs-cats', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'The pedal case’s drawers' });
  const caseHead = h('div.grs-case-head');
  const caseList = h('div', { role: 'listbox', 'aria-label': 'Pedals', style: { position: 'absolute', inset: '0' } });
  function buildCase() {
    const A = SHOPL.area;
    for (const c of CATS) {
      const t = h('button.grs-cat', { type: 'button', role: 'tab', dataset: { cat: c.cat }, 'aria-selected': String(c.cat === S.cat), tabindex: c.cat === S.cat ? '0' : '-1', onclick: () => showCat(c.cat) }, h('span', c.word), h('small', String(c.pedals.length)));
      catTabs.append(t);
    }
    place(catTabs, A.x + 6, A.y + 10, 160);
    catTabs.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      const i = CATS.findIndex((c) => c.cat === S.cat), next = CATS[(i + d + CATS.length) % CATS.length].cat;
      showCat(next);
      catTabs.querySelector(`[data-cat="${next}"]`)?.focus();
    });
    caseList.addEventListener('keydown', (e) => gridKeys(e, pedSlots));
    E.case.append(catTabs, caseHead, caseList);
    renderCase();
  }
  function renderCase() {
    const A = SHOPL.area, cat = CATS.find((c) => c.cat === S.cat) || CATS[0];
    for (const t of catTabs.children) { const on = /** @type {HTMLElement} */ (t).dataset.cat === cat.cat; t.setAttribute('aria-selected', String(on)); /** @type {HTMLElement} */ (t).tabIndex = on ? 0 : -1; }
    const x0 = A.x + 190, w = A.x + A.w - 6 - x0, top = A.y + 66, availH = A.y + A.h - 4 - top;
    caseHead.replaceChildren(h('h3.grs-disp', cat.word), h('span', `${cat.pedals.length} pedal${cat.pedals.length === 1 ? '' : 's'}. ${cat.line}`));
    place(caseHead, x0 + 6, A.y + 12, w - 12);
    caseList.setAttribute('aria-label', `${cat.word}: ${cat.pedals.length} pedals`);
    caseList.replaceChildren();
    caseShelves.length = 0;
    const cols = cat.pedals.length > 15 ? 6 : 5, rows = Math.max(1, Math.ceil(cat.pedals.length / cols));
    const cw = w / cols, chh = Math.min(rows === 1 ? 236 : 150, availH / rows), fh = chh - 44, fw = cw - 14;
    for (let r = 0; r < rows; r++) caseShelves.push({ x: x0, y: top + r * chh + fh + 3, w });
    pedSlots = cat.pedals.map((d, i) => {
      const f = renderFace(d, paramValues(d, {}), { size: 'full', on: true });
      tmp.append(f.el);
      const nw = f.el.offsetWidth || 132, nh = f.el.offsetHeight || 196, z = Math.min(fw / nw, fh / nh, 0.9);
      const slot = h('button.grs-ped', { type: 'button', role: 'option', 'aria-selected': 'false', tabindex: i ? '-1' : '0', dataset: { id: d.id }, 'aria-label': `${d.name}, ${typeWord(d).toLowerCase()}: ${d.blurb || ''}` },
        h('span.pbox', { style: { height: fh + 'px' } }, h('span.face', { style: { width: nw * z + 'px', height: nh * z + 'px' } }, h('span', { style: { display: 'block', transform: `scale(${z.toFixed(3)})`, transformOrigin: '0 0', width: nw + 'px' } }, f.el))),
        h('span.pname', d.name), h('span.ptype', typeWord(d)));
      const c = i % cols, r = Math.floor(i / cols);
      place(slot, x0 + c * cw + 3, top + r * chh, cw - 6, chh - 4);
      wireLook(slot, () => ({ kind: 'pedal', d }));
      slot.addEventListener('click', () => carryPedal(d.id, slot));
      caseList.append(slot);
      return slot;
    });
    markTaken();
    if (S.area === 'case') drawPixels();
  }
  function showCat(cat) {
    if (!CATS.some((c) => c.cat === cat)) return;
    if (S.area !== 'case') R.camera.zoomTo('case', { push: !inShop() });
    if (cat === S.cat) return;
    S.cat = cat;
    unlook();
    renderCase();
  }

  /* --------------------------------------------------------------------------------------- the rack */
  let rackList = [];
  async function renderRack() {
    const mine = await rack.list();
    const house = await Promise.all(HOUSE_IDS.map((id) => rack.get(id)));
    rackList = [...house.filter(Boolean), ...mine];
    const A = SHOPL.area, live = room().stack?.id || null, ch = changed();
    const cab = h('div.grs-rack', { role: 'listbox', 'aria-label': 'The rack: saved stacks' });
    place(cab, A.x, A.y + 6, 330, A.h - 6);
    const unit = (s) => {
      const amp = s.chain.find((l) => isAmp(l.device));
      const b = h(`button.grs-unit${s.house ? '.house' : ''}${s.id === live && !ch ? '.live' : ''}`, { type: 'button', role: 'option', 'aria-selected': String(s.id === S.sel), tabindex: s.id === (S.sel || live) ? '0' : '-1', dataset: { id: s.id }, 'aria-label': `${s.name}: ${describeStack(s.chain)}` },
        h('i.led'), h('span.tape', s.name), h('small', amp ? (R.getDevice(amp.device)?.name || '') : ''));
      b.addEventListener('focus', () => { S.sel = s.id; for (const u of cab.querySelectorAll('.grs-unit')) u.setAttribute('aria-selected', String(u === b)); drawSheet(); });
      b.addEventListener('mouseenter', () => { S.sel = s.id; for (const u of cab.querySelectorAll('.grs-unit')) u.setAttribute('aria-selected', String(u === b)); drawSheet(); });
      b.addEventListener('click', () => load(s.id));
      return b;
    };
    cab.append(h('h4', 'The house’s'), ...rackList.filter((s) => s.house).map(unit), h('h4', mine.length ? 'Yours' : 'Yours: none yet'), ...mine.map(unit));
    cab.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
      const us = [...cab.querySelectorAll('.grs-unit')], i = us.indexOf(/** @type {any} */ (document.activeElement));
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      const n = us[clamp(i + d, 0, us.length - 1)];
      for (const u of us) /** @type {HTMLElement} */ (u).tabIndex = u === n ? 0 : -1;
      /** @type {HTMLElement} */ (n).focus();
    });
    if (!S.sel || !rackList.some((s) => s.id === S.sel)) S.sel = live && rackList.some((s) => s.id === live) ? live : rackList[0]?.id || null;
    const had = rackLayer.contains(document.activeElement) ? /** @type {HTMLElement} */ (document.activeElement).dataset.id : null;
    rackLayer.replaceChildren(cab, sheet);
    if (had) /** @type {HTMLElement|null} */ (cab.querySelector(`[data-id="${CSS.escape(had)}"]`))?.focus({ preventScroll: true });
    drawSheet();
  }
  const sheet = h('div.grs-sheet');
  let naming = null;   // { kind: 'save' | 'rename', id? }
  function drawSheet() {
    const A = SHOPL.area;
    place(sheet, A.x + 350, A.y + 6, A.w - 350, A.h - 6);
    const s = rackList.find((x) => x.id === S.sel) || null;
    const kids = [];
    if (s) {
      const amp = s.chain.find((l) => isAmp(l.device));
      kids.push(h('div.kind', s.house ? 'A stack of the house’s' : 'A stack of yours'), h('h3.grs-disp', s.name), h('p', describeStack(s.chain) + '.'),
        h('ol', s.chain.map((l) => {
          const d = R.getDevice(l.device), v = l.device === amp?.device ? cabOf(l) : null;
          return h(`li${l.on === false ? '.off' : ''}`, d?.name || l.device, ' ', h('small', isAmp(l.device) ? `· ${toneWord(toneOf(d)).toLowerCase()} amp${v?.kind === 'clawd' ? `, ${v.cabName}` : ''}` : `· ${typeWord(d).toLowerCase()}${l.on === false ? ', off' : ''}`));
        })),
        s.house ? h('p.note', 'The house’s stacks stay as they are. Load one, change it, and Save to rack keeps your own.') : h('p.note', `Saved${s.songTitle ? ` from ${s.songTitle}` : ''}${s.modified ? `, ${new Date(s.modified).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}.`));
      if (naming?.kind === 'rename' && naming.id === s.id) kids.push(nameField(s.name, (nm) => doRename(s.id, nm), 'Rename'));
      else {
        kids.push(h('div.acts',
          h('button.grs-b.go', { type: 'button', onclick: () => load(s.id) }, room().stack?.id === s.id && !changed() ? 'Loaded' : 'Load it', kbd('Enter')),
          s.house ? null : h('button.grs-b', { type: 'button', onclick: () => { naming = { kind: 'rename', id: s.id }; drawSheet(); } }, 'Rename'),
          s.house ? null : h('button.grs-b', { type: 'button', onclick: () => doRemove(s.id) }, 'Take it off the rack')));
      }
    }
    if (S.removed) kids.push(h('p.note', `${S.removed.name} is off the rack.`), h('div.acts', h('button.grs-b', { type: 'button', onclick: () => doRestore() }, 'Put it back')));
    kids.push(h('h4', { style: { margin: '18px 0 4px', font: '600 13px/1.2 var(--font-ui)' } }, 'Your stack now'), h('p', describeStack(rigNow()?.chain || []) + '.'), saveRow({ dark: true }));
    sheet.replaceChildren(...kids);
  }

  /* --------------------------------------------------------------------------------------- the try-out corner */
  const C = SHOPL.corner;
  const plate = h('div.grs-stackplate');
  const boxes = { head: null, cab: null };
  let headFace = null;
  function drawPlate() {
    const st = room().stack, ch = changed();
    const tryName = S.trying ? R.getDevice(S.trying)?.name : null;
    const kids = [h('small', 'Your stack'), h('b', st?.name || 'Your own'), h('span', tryName ? `Trying ${tryName}: look away and it’s gone` : ch ? (st ? 'Changed from the rack’s: this song’s copy' : 'This song’s own: not on the rack') : 'As it is on the rack')];
    kids.push(saveRow({ plate: true }));
    plate.replaceChildren(...kids);
    place(plate, C.x + 14, C.y + 22, C.w - 28);
  }
  function saveRow({ plate: inPlate = false, dark = false } = {}) {
    if (naming?.kind === 'save') return nameField(defaultName(), (nm) => save(nm).then(() => {}), 'Save', dark);
    const st = room().stack, yours = st && /^st_/.test(st.id), ch = changed();
    const acts = h(inPlate ? 'div.acts' : 'div.acts');
    acts.append(h('button.grs-b', { type: 'button', dataset: { act: 'save' }, onclick: () => R.press('save') }, 'Save to rack'));
    if (yours && ch) acts.append(h('button.grs-b', { type: 'button', onclick: () => saveOver(st.id) }, `Update ${st.name}`));
    return inPlate ? acts : h('div.row', acts);
  }
  function nameField(value, done, verb, _dark = false) {
    const input = h('input', { type: 'text', value, maxlength: '100', 'aria-label': 'The stack’s name on the rack', 'data-typing': '' });
    const ok = () => { const nm = input.value.trim(); if (!nm) return; naming = null; done(nm); };
    const cancel = () => { naming = null; drawPlate(); if (S.area === 'rack') drawSheet(); refreshPanels(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    const row = h('div.grs-name', input, h('button.grs-b.go', { type: 'button', onclick: ok }, verb), h('button.grs-b', { type: 'button', onclick: cancel }, 'Cancel'));
    later(() => { if (input.isConnected) { input.focus(); input.select(); } }, 30);
    return row;
  }
  function defaultName() {
    const a = ampLink();
    const base = a ? `${R.getDevice(a.device)?.name || 'My'} stack` : 'Pedals';
    const taken = new Set(rackList.map((s) => s.name));
    let n = base, k = 2;
    while (taken.has(n)) n = `${base} ${k++}`;
    return n;
  }
  // (the head and the cab are kept, not rebuilt, while the same amp and cab stand there: a knob or a mic in the hand is
  // moved by every step it sends, and an element taken out of the page mid-drag loses the pointer, so the drag stops)
  let cabObj = null, cabKey = '', headEl = null, noHead = null;
  function drawCorner() {
    const r = rigNow();
    const a = r?.amp ? r.chain[r.amp.slot] : null;
    const view = a ? cabOf(a) : null;
    drawPlate();
    if (!plate.isConnected) E.corner.append(plate);
    const floor = SHOPL.floorY - 6, cx = C.x + C.w / 2;
    const shown = view?.kind === 'clawd' ? view.shown : 'v412';
    const box = cabBox(shown), z = Math.min(400 / box.w, 300 / box.h, 0.9);
    const cw = Math.round(box.w * z), chh = Math.round(box.h * z);
    const open = R.gr.cam === 'tryout-cab', ir = view?.kind === 'stack', label = view?.kind === 'stack' ? view.cabName : view?.cab === 'own' ? `${view.amp}’s own` : null;
    const key = JSON.stringify([shown, cw, chh, open, ir, label]);
    if (key !== cabKey || !cabObj?.el.isConnected) {
      cabObj?.el.remove();
      const cab = cabView(shown, cw, chh, { open, ir, label });
      place(cab.el, cx - cw / 2, floor - chh);
      cab.el.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('.grs-mic') || R.gr.cam === 'tryout-cab') return; R.press('shop:cab'); });
      cab.el.setAttribute('aria-label', 'Your cab: go closer (C)');
      E.corner.append(cab.el);
      cabObj = cab; cabKey = key;
    }
    boxes.cab = { x: cx - cw / 2, y: floor - chh, w: cw, h: chh };
    // (a mic in the hand places itself; the rest stand where the song has them)
    if (!S.dragging) placeMics(cabObj, view, { R, slot: r?.amp?.slot, drag: open, onSay: say });
    // the head on top of it (the face's compact form is the head alone), its knobs the real amp's
    const headW = clamp(cw + 16, 340, 430), hz = headW / 420;
    if (a) {
      noHead?.remove(); noHead = null;
      const d = R.getDevice(a.device);
      if (!headFace || headFace.device !== a.device) {
        headFace?.face.destroy();
        headEl?.remove(); headEl = null;
        const slot = () => rigNow()?.amp?.slot;
        const f = renderFace(headDef(d), paramValues(d, a.params), { size: 'compact', on: a.on !== false,
          onParam: (k, v, { commit }) => { const s = slot(); if (s != null) R.rig.turn(s, k, v, { commit }); },
          onToggle: (on) => { const s = slot(); if (s != null) R.rig.stomp(s, on); } });
        headFace = { device: a.device, face: f, nh: 0 };
      } else headFace.face.update(paramValues(d, a.params), a.on !== false);
      if (!headEl) {
        const wrap = h('div.grs-headwrap', { style: { width: '420px', transformOrigin: '0 0' } }, headFace.face.el);
        headEl = h('div.grs-head', { dataset: { amp: a.device } }, wrap);
        tmp.append(headEl);
        headFace.nh = headFace.face.el.offsetHeight || 128;
        headEl.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('.kn, button, [role=slider], .ms')) return; if (R.gr.cam !== 'tryout-head') R.press('shop:head'); });
        E.corner.append(headEl);
      }
      /** @type {HTMLElement} */ (headEl.firstChild).style.transform = `scale(${hz.toFixed(4)})`;
      const hh = headFace.nh * hz;
      place(headEl, cx - headW / 2, floor - chh - hh + 2, headW, hh);
      boxes.head = { x: cx - headW / 2, y: floor - chh - hh + 2, w: headW, h: hh, el: headEl };
    } else {
      headFace?.face.destroy(); headFace = null;
      headEl?.remove(); headEl = null;
      if (!noHead) { noHead = h('button.grs-nohead', { type: 'button', onclick: () => R.press('shop:wall') }, 'No amp on your stack. Take one off the wall.'); E.corner.append(noHead); }
      place(noHead, cx - 170, floor - chh - 110, 340, 100);
      boxes.head = { x: cx - 170, y: floor - chh - 110, w: 340, h: 100, el: noHead };
    }
  }

  /* --------------------------------------------------------------------------------------- the board along the front */
  const boardEl = h('div.grs-board', h('div.rail'));
  const faces = new Map();   // insert id -> { device, face }
  let boardSlots = [];
  let boardKey = '';
  function drawBoard(force = false) {
    const r = rigNow();
    const B = SHOPL.board;
    if (!boardEl.isConnected) { place(boardEl, B.x, B.y, B.w, B.h); E.corner.append(boardEl); }
    const items = (r?.slots || []).filter((s) => s.kind !== 'cab');
    const key = JSON.stringify(items.map((s) => [s.insert, s.device]));
    if (!force && key === boardKey) {
      // the same pedals in the same order: their knobs and switches where the song has them
      for (const s of items) {
        if (s.kind === 'amp') continue;
        const f = faces.get(s.insert), d = R.getDevice(s.device);
        if (f && d) f.face.update(paramValues(d, s.params), s.on);
        const el = boardSlots.find((b) => b.insert === s.insert)?.el;
        if (el) { el.classList.toggle('off', !s.on); const kc = el.querySelector('.keycap b'); if (kc) kc.textContent = s.on ? 'on' : 'off'; }
      }
      return;
    }
    boardKey = key;
    E.corner.querySelectorAll('.grs-slot, .grs-loop, .grs-add, .grs-drop').forEach((n) => n.remove());
    for (const [id, f] of faces) if (!items.some((s) => s.insert === id && s.device === f.device)) { f.face.destroy(); faces.delete(id); }
    const peds = items.filter((s) => s.kind !== 'amp');
    const measured = peds.map((s) => {
      const d = R.getDevice(s.device);
      let f = faces.get(s.insert);
      if (!f) {
        const slotOf = () => rigNow()?.slots.find((x) => x.insert === s.insert)?.slot;
        f = { device: s.device, face: renderFace(d, paramValues(d, s.params), { size: 'full', on: s.on,
          onParam: (k, v, { commit }) => { const n = slotOf(); if (n != null) R.rig.turn(n, k, v, { commit }); },
          onToggle: (on) => { const n = slotOf(); if (n != null) R.rig.stomp(n, on); } }) };
        faces.set(s.insert, f);
      } else f.face.update(paramValues(d, s.params), s.on);
      tmp.append(f.face.el);
      return { s, d, f, nw: f.face.el.offsetWidth || 120, nh: f.face.el.offsetHeight || 182 };
    });
    const inner = B.h - 34, addW = 110, ampAt = r?.amp ? r.amp.slot : null;
    const hasLoop = ampAt != null && peds.some((p) => p.slot > ampAt);
    const loopGap = hasLoop ? 36 : 0;
    const widthAt = (zz) => measured.reduce((a2, it) => a2 + it.nw * Math.min(zz, (inner - 6) / it.nh), 0);
    const fixed = 24 * 2 + loopGap + addW + 16;
    let z = 0.95, gap = 18;
    while (widthAt(z) + gap * measured.length + fixed > B.w && z > 0.3) z -= 0.02;
    gap = Math.min(gap + (B.w - (widthAt(z) + gap * measured.length + fixed)) / (measured.length + 1), 64);
    let x = B.x + 24 + gap / 2, loopX = null;
    boardSlots = [];
    measured.forEach((it, n) => {
      if (ampAt != null && it.s.slot > ampAt && loopX == null) { loopX = x - gap / 2 + 4; x += loopGap; }
      const zz = Math.min(z, (inner - 6) / it.nh), w = it.nw * zz, hh = it.nh * zz, y = B.y + B.h - 26 - hh;
      const el = h(`div.grs-slot${it.s.on ? '' : '.off'}`, { dataset: { insert: it.s.insert, device: it.s.device } },
        h('div.face', { style: { transform: `scale(${zz.toFixed(4)})` } }, it.f.face.el),
        h('span.keycap', { style: { top: hh + 6 + 'px' } }, String(n + 1), h('b', it.s.on ? 'on' : 'off')),
        h('button.rm', { type: 'button', title: `Put ${it.d.name} back in the case`, 'aria-label': `Put ${it.d.name} back in the case`, onclick: (e) => { e.stopPropagation(); takeOff(it.s.insert); } }, '×'));
      place(el, x, y, w, hh);
      dragToMove(el, it.s.insert);
      E.corner.append(el);
      boardSlots.push({ insert: it.s.insert, el, x, w, y, h: hh, slot: it.s.slot });
      x += w + gap;
    });
    if (loopX != null) { const lm = place(h('div.grs-loop', h('span', 'AMP’S LOOP')), loopX, B.y + 4, null, B.h - 30); E.corner.append(lm); }
    const addH = Math.min(140, inner - 10);
    const add = h('button.grs-add', { type: 'button', onclick: () => R.press('shop:case') }, h('b', '+ Pedal'), h('small', 'from the case'));
    place(add, Math.min(x + 6, B.x + B.w - addW - 16), B.y + B.h - 26 - addH, addW, addH);
    E.corner.append(add);
  }
  // drag a pedal along the board to move it in the chain (past the loop line: into the amp's loop)
  function dragToMove(el, insert) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || /** @type {HTMLElement} */ (e.target).closest('button, [role=slider], .kn, .ms, input')) return;
      const x0 = e.clientX;
      let moving = false, to = null;
      const marker = h('div.grs-drop');
      const scale = () => { const b = E.world.getBoundingClientRect(); return b.width / SHOP.w || 1; };
      const mv = (ev) => {
        const dx = (ev.clientX - x0) / scale();
        if (!moving && Math.abs(dx) < 6) return;
        if (!moving) { moving = true; el.setPointerCapture(ev.pointerId); el.classList.add('dragging'); E.corner.append(marker); }
        el.style.transform = `translateX(${dx}px)`;
        const me = boardSlots.find((b) => b.insert === insert);
        if (!me) return;
        const cx = me.x + me.w / 2 + dx;
        to = dropAt(insert, cx);
        const B = SHOPL.board;
        place(marker, to.x - 2, B.y + 14, null, B.h - 44);
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('lostpointercapture', up);
        marker.remove();
        if (!moving) return;
        moving = false;
        el.classList.remove('dragging'); el.style.transform = '';
        if (!el.isConnected) return;   // (the board was drawn again under the hand: someone else moved it)
        const r = rigNow(), from = r?.slots.find((s) => s.insert === insert)?.slot;
        if (to && from != null && to.index !== from) {
          const res = R.rig.move(from, to.index);
          if (!res.ok) say(res.error);
        }
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    });
  }
  // where a dragged pedal lands: the slot index in the chain after it's lifted out, and the x of the gap
  function dropAt(insert, cx) {
    const r = rigNow();
    const run = (r?.slots || []).filter((s) => s.insert !== insert);
    const drawn = boardSlots.filter((b) => b.insert !== insert);
    const ampAt = r?.amp ? run.findIndex((s) => s.insert === r.amp.insert) : -1;
    let index = run.length, x = drawn.length ? drawn.at(-1).x + drawn.at(-1).w + 9 : SHOPL.board.x + 30;
    for (const b of drawn) {
      if (cx < b.x + b.w / 2) { index = run.findIndex((s) => s.insert === b.insert); x = b.x - 9; break; }
    }
    // (left of the loop line: before the amp)
    const loop = E.corner.querySelector('.grs-loop');
    if (ampAt >= 0 && loop) {
      const lx = parseFloat(/** @type {HTMLElement} */ (loop).style.left);
      if (cx < lx && index > ampAt) { index = ampAt; x = lx - 9; } else if (cx >= lx && index <= ampAt) { index = ampAt + 1; x = lx + 9; }
    }
    return { index, x };
  }
  function takeOff(insert) {
    const r = rigNow(), s = r?.slots.find((x) => x.insert === insert);
    if (!s) return;
    const d = R.getDevice(s.device);
    const res = R.rig.remove(s.slot);
    if (!res.ok) { say(res.error); return; }
    say(SAY.pedalOff({ name: d?.name || 'The pedal', cat: CAT_WORD[d?.pedalCat] || 'its drawer' }));
  }

  /* --------------------------------------------------------------------------------------- carrying things in */
  function chainWithAmp(device) {
    const r = rigNow();
    const chain = clone(r?.chain || []);
    if (r?.amp) chain[r.amp.slot] = carriedAmp(device, chain[r.amp.slot]);
    else {
      const at = chain.findIndex((l) => inLoop(R.getDevice(l.device)));
      chain.splice(at < 0 ? chain.length : at, 0, carriedAmp(device, null));
    }
    return chain;
  }
  function ghost(fromEl, toEl, then) {
    if (!fromEl || !toEl || reduced()) { then(); return; }
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) { then(); return; }
    const gh = /** @type {HTMLElement} */ (fromEl.cloneNode(true));
    gh.classList.add('grs-ghost');
    Object.assign(gh.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', transform: 'none' });
    document.body.append(gh);
    const sx = Math.min(2, (b.width / a.width) * 0.6);
    requestAnimationFrame(() => requestAnimationFrame(() => { gh.style.transform = `translate(${b.left + b.width * 0.2 - a.left}px, ${b.top + b.height * 0.1 - a.top}px) scale(${sx})`; gh.style.opacity = '0.2'; }));
    later(() => { gh.remove(); }, 600);
    then();
  }
  const flash = (el) => { if (!el) return; el.classList.remove('grs-fresh'); void el.offsetWidth; el.classList.add('grs-fresh'); };
  function carryAmp(device, fromEl = null) {
    release();
    const r = rigNow();
    const d = R.getDevice(device);
    if (!d) return { ok: false, error: `There’s no amp ${device} in the shop.` };
    if (!r) return { ok: false, error: 'There’s no guitar in this room.' };
    const was = r.amp ? R.getDevice(r.amp.device) : null;
    if (was?.id === device) { say(SAY.ampAlready({ name: d.name })); return { ok: true }; }
    const res = R.rig.swap({ chain: chainWithAmp(device) }, { label: `${d.name} on the stack` });
    if (!res.ok) { say(res.error); return res; }
    ghost(fromEl?.querySelector('.ewf') || fromEl, boxes.head?.el, () => {});
    const v = cabOf(ampLink());
    say(SAY.ampOn({ name: d.name, cab: v?.kind === 'clawd' ? (v.cab === 'own' ? 'its own cab' : `your ${v.cabName}`) : 'its measured cab', was: was?.name || '', sec: toneWord(toneOf(was)).toLowerCase() }));
    later(() => flash(boxes.head?.el), 30);
    return res;
  }
  function carryPedal(device, fromEl = null, link = null) {
    release();
    const r = rigNow();
    const d = R.getDevice(device);
    if (!d || !r) return { ok: false, error: d ? 'There’s no guitar in this room.' : `There’s no pedal ${device} in the shop.` };
    const on = r.board.find((b) => b.device === device);
    if (on && !link) { takeOff(on.insert); return { ok: true }; }
    if (r.board.length >= BOARD_MAX) { say(SAY.boardFull()); return { ok: false, error: SAY.boardFull() }; }
    const res = R.rig.add(link || { device, params: {}, on: true });
    if (!res.ok) { say(res.error); return res; }
    const now = rigNow(), at = now.board.findIndex((b) => b.device === device && !r.board.some((o) => o.insert === b.insert));
    ghost(fromEl?.querySelector('.face') || fromEl, boardEl, () => {});
    say(SAY.pedalOn({ name: d.name, nth: ordinal(at + 1), loop: now.amp ? now.board[at]?.slot > now.amp.slot : false }));
    later(() => flash(boardSlots.find((b) => b.insert === now.board[at]?.insert)?.el.querySelector('.face')), 30);
    return res;
  }
  function carry(what) {
    if (what?.stack) return loadStack(what.stack, what.stack.id || null);
    const l = what?.link;
    if (l && typeof l.device === 'string') return isAmp(l.device) ? carryAmp(l.device) : carryPedal(l.device, null, { device: l.device, params: l.params || {}, on: l.on !== false });
    return { ok: false, error: 'Carry a stack or a pedal.' };
  }
  // a stack onto both guitars, and the song's room.stack, one step
  function loadStack(stack, id = null) {
    release();
    const name = String(stack?.name || 'The stack').trim().slice(0, 100) || 'The stack';
    const label = `Stack: ${name}`;
    const res = R.rig.swap({ name, chain: stack.chain }, { label });
    if (!res.ok) { say(res.error); return res; }
    const st = room().stack;
    // (the song names the rack stack its chain came from; a stack that isn't on the rack leaves it naming none)
    const ref = id && /^[A-Za-z0-9._-]{1,64}$/.test(id) ? { id, name } : null;
    if (ref ? st?.id !== id || st?.name !== name : !!st) {
      const d = store.dispatch([{ type: 'room.set', patch: { stack: ref } }], { by: 'you', label, reason: 'room:rig', join: res.txn?.id || null });
      if (!d.ok) console.error('shop: room.stack', d.error);
    }
    S.base = ref ? { id, chain: clone(stack.chain), name } : null;
    say(SAY.stackUp({ name, said: describeStack(stack.chain) }));
    later(() => flash(boxes.head?.el), 30);
    return { ok: true, txn: res.txn };
  }
  async function load(id) {
    const s = await rack.get(id);
    if (!s) return { ok: false, error: `There’s no stack ${id} on the rack.` };
    const r = loadStack(s, id);
    if (S.area === 'rack') renderRack();
    return r;
  }

  /* --------------------------------------------------------------------------------------- the rack: save, rename, remove */
  async function save(name) {
    const r = rigNow();
    if (!r || !r.chain.length) return { ok: false, error: 'There’s nothing on your stack to save.' };
    const nm = String(name || defaultName()).trim().slice(0, 100);
    const out = await rack.save({ name: nm, chain: r.chain }, { name: nm, song: store.get() });
    if (!out.ok) { say(out.error); return out; }
    const d = store.dispatch([{ type: 'room.set', patch: { stack: { id: out.id, name: out.stack.name } } }], { by: 'you', label: `Saved to the rack: ${out.stack.name}`, reason: 'room:rig' });
    if (!d.ok) console.error('shop: room.stack', d.error);
    S.base = { id: out.id, chain: clone(out.stack.chain), name: out.stack.name };
    S.sel = out.id;
    naming = null;
    say(out.note ? `${SAY.saved({ name: out.stack.name })} ${out.note}` : SAY.saved({ name: out.stack.name }));
    drawPlate(); refreshPanels();
    if (S.area === 'rack') renderRack();
    return { ok: true, id: out.id };
  }
  async function saveOver(id) {
    const r = rigNow();
    if (!r) return;
    const out = await rack.save({ chain: r.chain }, { id });
    if (!out.ok) { say(out.error); return; }
    S.base = { id, chain: clone(out.stack.chain), name: out.stack.name };
    say(SAY.savedOver({ name: out.stack.name }));
    drawPlate(); refreshPanels();
    if (S.area === 'rack') renderRack();
  }
  async function doRename(id, nm) {
    const out = await rack.rename(id, nm);
    if (!out.ok) { say(out.error); return; }
    if (room().stack?.id === id) store.dispatch([{ type: 'room.set', patch: { stack: { id, name: out.stack.name } } }], { by: 'you', label: `The stack is ${out.stack.name}`, reason: 'room:rig' });
    say(SAY.renamed({ name: out.stack.name }));
    renderRack(); drawPlate();
  }
  async function doRemove(id) {
    const gone = await rack.remove(id);
    if (!gone) return;
    S.removed = gone;
    S.sel = null;
    say(SAY.removed({ name: gone.name }));
    renderRack();
  }
  async function doRestore() {
    const s = S.removed;
    if (!s) return;
    const out = await rack.restore(s);
    S.removed = null;
    if (out.ok) { S.sel = s.id; say(SAY.restored({ name: s.name })); }
    renderRack();
  }

  /* --------------------------------------------------------------------------------------- the panels: the head, the cab builder */
  const headPanel = R.panel('tryout-head');
  const shopCab = cabPanel(R, R.panel('tryout-cab'), { where: 'shop', saveRow: () => saveRow() });
  const stageCab = cabPanel(R, R.panel('cab'), { where: 'stage', saveRow: () => saveRow() });
  function drawHeadPanel() {
    const a = ampLink(), d = a ? R.getDevice(a.device) : null;
    headPanel.classList.add('grs-panel');
    if (!d) { headPanel.replaceChildren(h('div.kind', 'Your stack'), h('h2.grs-disp', 'No amp'), h('p', SAY.noAmp()), h('div.row', h('button.grs-b', { type: 'button', onclick: () => R.press('shop:wall') }, 'The amp wall', kbd('A')))); return; }
    headPanel.replaceChildren(
      h('div.kind', `${toneWord(toneOf(d))} amp · your stack`), h('h2.grs-disp', d.name), h('p', d.blurb || ''), d.nod ? h('p.nod', `In the spirit of ${d.nod}.`) : null,
      h('p.note', 'Drag a knob up or down (Shift for fine), scroll it, or focus it and use the arrow keys. Double-click puts it back. Changes go to this song’s copy of the stack.'),
      h('h3', 'Somewhere else'),
      h('div.row', h('button.grs-b', { type: 'button', onclick: () => R.press('shop:cab') }, 'The cab and its mics', kbd('C'))),
      h('div.row', h('button.grs-b', { type: 'button', onclick: () => R.press('shop:wall') }, 'Another amp: the wall', kbd('A'))),
      saveRow());
  }
  function refreshPanels() {
    const at = R.gr.cam;
    if (at === 'tryout-head') drawHeadPanel();
    else if (at === 'tryout-cab') shopCab.render();
    else if (at === 'cab') stageCab.render();
  }

  /* --------------------------------------------------------------------------------------- the camera */
  const all = () => ({ x: 0, y: 0, w: SHOP.w, h: SHOP.h });
  for (const id of AREAS) offs.push(R.camera.target(id, { world: 'shop', rect: all, pad: 0 }));
  offs.push(R.camera.target('tryout-head', { world: 'shop', rect: () => { const b = boxes.head || { x: C.x + 30, y: 160, w: 410, h: 130 }; return { x: b.x - 24, y: b.y - 30, w: b.w + 48, h: b.h + 30 + 200 }; }, right: 432 }));
  offs.push(R.camera.target('tryout-cab', { world: 'shop', rect: () => { const b = boxes.cab || { x: C.x + 35, y: 300, w: 400, h: 270 }; return { x: b.x - 40, y: b.y - 24, w: b.w + 80, h: b.h + 48 }; }, right: 444 }));
  const inShop = () => R.gr.world === 'shop';
  function ensureBuilt() {
    if (built) return;
    built = true;
    buildWall(); buildCase();
    E.corner.append(plate);
    drawCorner(); drawBoard(true);
    showArea(S.area);
    loadBase();
  }
  let lastWorld = R.gr.world;
  offs.push(R.on('cam', (d) => {
    if (d.world === 'shop') {
      ensureBuilt();
      if (AREAS.includes(d.to)) showArea(d.to);
      else if (d.to === 'shop') showArea(S.area);
      // close to the cab: the mics come out from behind the cloth, and they move
      drawCorner();
      if (d.to === 'tryout-head') drawHeadPanel();
      if (d.to === 'tryout-cab') shopCab.render();
      if (!AREAS.includes(d.to)) unlook();
      markBar();
      if (lastWorld !== 'shop') {
        if (!R.gr.said['shop.enter']) { R.gr.said['shop.enter'] = true; say(SAY.enter()); }
        loadBase();
      }
    } else {
      if (lastWorld === 'shop') {
        unlook();
        // (Put it back lasts while you're in the shop: SAY.removed)
        S.removed = null;
        naming = null;
        // (back on the stage: the way back never leads into the shop again)
        const t = R.gr.trail;
        if (Array.isArray(t)) for (let i = t.length - 1; i >= 0; i--) if (SHOP_CAMS.includes(t[i])) t.splice(i, 1);
        const r = rigNow(), a = r?.amp ? R.getDevice(r.amp.device) : null, v = cabOf(ampLink());
        say(SAY.leave({ amp: a ? `${a.name}${v?.kind === 'clawd' ? ` on ${v.cab === 'own' ? 'its own cab' : 'a ' + v.cabName}` : ''}` : 'no amp', pedals: r?.board.length || 0, changed: changed() }));
      }
      if (d.to === 'cab') stageCab.render();
    }
    lastWorld = d.world;
  }));
  offs.push(R.on('rig', () => {
    if (!built && R.gr.cam !== 'cab') return;
    if (R.gr.cam === 'cab') stageCab.refresh();
    if (!built) return;
    loadBase();
    drawCorner(); drawBoard(); markTaken();
    if (R.gr.cam === 'tryout-cab') shopCab.refresh();
    if (R.gr.cam === 'tryout-head') drawHeadPanel();
    if (S.area === 'rack' && inShop()) drawSheet();
  }));
  // (the song's stack changed by an undo or another author: the plate follows)
  // (and a step anyone takes while something's being tried ends the try: the song moved under it)
  const offStore = store.on('change', (e) => {
    if (e.kind === 'preview') return;
    if (tried) release({ drop: e.kind === 'load' });
    if (built && e.ops?.some((o) => o.type === 'room.set')) { loadBase(); drawPlate(); }
  });
  offs.push(offStore);
  // a take starting: nothing is being tried
  offs.push(R.on('press', (e) => { if (tried && (e.id === 'record' || e.id === 'again' || e.id === 'side')) release(); }));

  function markTaken() {
    const amp = ampLink()?.device;
    for (const s of ampSlots) s.classList.toggle('taken', s.dataset.id === amp && S.trying !== amp);
    const on = new Set(pedalsOn().map((b) => b.device));
    for (const s of pedSlots) s.classList.toggle('taken', on.has(s.dataset.id) && S.trying !== s.dataset.id);
  }

  /* --------------------------------------------------------------------------------------- actions */
  function goArea(a) {
    if (inShop()) return { ok: R.camera.zoomTo(a, { push: false }) };
    return { ok: R.camera.zoomTo(a) };
  }
  function press(id) {
    switch (id) {
      case 'shop:wall': return goArea('wall');
      case 'shop:case': return goArea('case');
      case 'rack': return goArea('rack');
      case 'shop:head': return { ok: R.camera.zoomTo('tryout-head') };
      case 'shop:cab': return { ok: R.camera.zoomTo('tryout-cab') };
      case 'cat:prev': case 'cat:next': {
        const i = CATS.findIndex((c) => c.cat === S.cat), d = id === 'cat:next' ? 1 : -1;
        if (!inShop() || S.area !== 'case' || R.gr.cam !== 'case') { goArea('case'); if (!built) return { ok: true }; }
        showCat(CATS[(i + d + CATS.length) % CATS.length].cat);
        return { ok: true };
      }
      case 'save': {
        if (!rigNow()) return { ok: false, error: 'There’s no guitar in this room.' };
        naming = { kind: 'save' };
        // (the name field is on the stack's plate, the rack's sheet and the cab builder: from anywhere else, the rack)
        if (!inShop() && R.gr.cam !== 'cab') return goArea('rack');
        drawPlate(); refreshPanels();
        if (S.area === 'rack' && inShop()) drawSheet();
        return { ok: true };
      }
      default: return false;
    }
  }
  function back() {
    if (naming) { naming = null; drawPlate(); refreshPanels(); if (S.area === 'rack' && inShop()) drawSheet(); return true; }
    if (tried) release();
    return false;
  }

  return {
    press,
    back,
    frame() {},
    unmount() {
      release();
      clearTimeout(dwell);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      for (const f of faces.values()) f.face.destroy();
      faces.clear();
      headFace?.face.destroy();
      shopCab.dispose(); stageCab.dispose();
      tmp.remove(); rackLayer.remove();
      for (const l of [E.wall, E.case, E.corner, E.hot, E.pixels]) l.replaceChildren();
      for (const gh of document.querySelectorAll('.grs-ghost')) gh.remove();
    },
    carry,
    save,
    load,
    tryOn,
    release,
    area: () => S.area,
    changed,
  };
}
