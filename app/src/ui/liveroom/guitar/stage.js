// The stage room [ui; the guitar room's ROOM stream] (docs/research/GUITAR-ROOM.md §2.2, §2.3, §2.9; the blueprint is
// the second mock, design/mock/guitar-room-2/, shots 02a-02d, 03a, 03e). The screen IS the stage, seen from the
// front: the pixel room around crisp, real gear at a usable size. This stream draws:
//   - the room in pixels (./room-pixels.js) into R.el.stage.pixels: brick, the truss and its lamps, the banner, the
//     floor, the riser, the tape machine on its road case (its reels turn while the tape rolls, its counter shows the
//     band's bar), the kit (the drummer stream drives its hits and sticks: kit() below), the door under NO STAIRWAY;
//   - the rig from the real chain (R.rig.now(), ./bind.js) into R.el.stage.gear: ONE stack, the head on its cab, the
//     studio's real faces (ui/faces.js). A knob is R.rig.turn (a drag coalesces into one step), the head's power and a
//     pedal's footswitch R.rig.stomp, a drag along the board R.rig.move, the tags' arrows too, × and "Back in the
//     case" R.rig.remove, the + pedal R.press('pedal:add') (the shop's case). Every change is one undo step by you on
//     both guitars (./bind.js); the drawing follows the song (R.on('rig')), whoever changed it;
//   - the mics in front of the grille (the amp's MIC, POSITION, MIC 2 ...: dragged across a cone when the camera's at
//     the cab, R.rig.turn POSITION; the cab builder's panel is the shop stream's);
//   - Tuna Fork, the room's tuner, first on the board (its footswitch presses 'tuner': the start stream's; it shows
//     R.gr.tuner: on, and the reading the start stream puts there, R.gr.tuner.reading { note, octave, cents (as
//     shown), string (its number), inTune, held, input }: the one Tuna Fork on the stage; the start stream draws none);
//   - the input meter on the head (input/level.js, on app.input.audio.samples(): the −12 to −6 dBFS window lit), the
//     cable and its plug into the first jack (in while the input's open);
//   - the hotspots (R.el.stage.hot): the kit (the drummer's book), the tape machine ('tape'), the door ('shop'); and
//     the board's hang tags (up when the camera's at the board);
//   - the head's panel (R.panel('head')); a knob's name and value large while your hand is on it;
//   - the header's own (R.el.tools: the way back, and who's on the talkback when Claude is connected: the tape
//     stream's claude()) and the strip's (R.el.strip.tools: the riffs and the part line). Getting started's button is
//     the start stream's, Talk to Claude the tape stream's (in the strip's talkback).
// It re-registers the camera's stage targets head, cab, board and tuner with the drawn gear's boxes (the kit's and the
// tape's stay their streams'). No <select> and no range input anywhere: a face's menu becomes a button (./room-rig.js
// noSelects), and the keys are ./keys.js's alone (this declares none).
//
// Frozen (the other streams call these):
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'stomp:<1-8>', 'slot:<n>', 'pedal:add'
//     back() -> bool                          Esc: lets go of a pedal being dragged (put back where it was)
//     frame(now)
//     unmount()
//     rect(name) -> { x, y, w, h } | null     a drawn thing's box in stage world units: 'head', 'cab', 'board', 'meter',
//                                             'jack', 'tuner' (the tuner pedal's place on the board), 'kit', 'riser',
//                                             'banner', 'tape', 'door', or 'slot:<n>' (a piece of gear by its rig slot);
//                                             ./layout.js REGIONS until it's drawn
//     el(name) -> Element | null              the element drawn for one of those (Getting started points at it)
//   }
// Added (new, for the drummer and the checks; nothing frozen changed):
//     kit(state | null)                       the kit's hits and sticks: { kick, snare, hat, crash, tom (0..1, a hit's
//                                             ring), count (a number on the front head while the sticks count; null),
//                                             tap (0..1: the sticks just clicked) }; null: the kit at rest. The
//                                             drummer stream calls it from its frame. A drummer that draws its own kit
//                                             (a canvas with data-kit in R.el.stage.riser) hides this one.
//     redraw()                                draw the rig again from the song (the checks; a font that loaded late)

import { h, css } from '../../dom.js';
import { renderFace, valueText } from '../../faces.js';
import { normParam, listDevices } from '../../../devices/registry.js';
import { createLevel, WINDOW } from '../../../input/level.js';
import { beatsPerBar } from '../../../core/music.js';
import { sameChain } from '../../../core/stacks.js';
import { CLUB_STACK } from '../../../core/liveroom/guitar/setup.js';
import { REGIONS, PX, MARGIN, STAGE } from './layout.js';
import { PIX, KIT, TAPE, shifted, drawStage, drawTape, drawKit } from './room-pixels.js';
import { cabOf, micsOf, buildCab, buildMic, placeMic, tunerFace, noSelects, syncPicks, drawCables, onCone, inches } from './room-rig.js';
import { CSS } from './room-style.js';

// world units: the stack stands at the left; the board runs the stage's width along the front
const ST = { cx: 308, floor: 540, headW: 420, headZ: 1.18, pedZ: 1.14 };
const BOARD = REGIONS.board;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const minus = (s) => String(s).replace(/-/g, '−');
const sentence = (s) => { s = String(s || '').toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const kbd = (t) => h('kbd', t);
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const CAT_WORD = { dynamics: 'Dynamics', filter: 'Filter & wah', pitch: 'Pitch', drive: 'Drive', fuzz: 'Fuzz', synth: 'Synth', mod: 'Modulation', time: 'Delay', ambient: 'Ambient', glitch: 'Glitch', utility: 'Utility' };
const TONE_WORD = { clean: 'Clean amp', crunch: 'Crunch amp', high: 'High gain amp', weird: 'Weird amp', bass: 'Bass amp' };
const typeWord = (d) => sentence(d?.kindLabel || '');
// a tag's small line: what it is, then its shelf in the case when that says something new ('Delay · in time', not '... · Delay')
const kindOf = (d) => { const t = typeWord(d), c = d?.pedalCat && CAT_WORD[d.pedalCat]; return c && !t.toLowerCase().includes(c.toLowerCase()) ? (t ? `${t} · ${c}` : c) : t; };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(R) {
  css('gr-room', CSS);
  const G = R.el.stage;
  const app = R.app;
  // (the room's own, beside the song: where each mic is drawn on the grille, which isn't a param)
  const mine = (R.gr.room ||= { mics: [{ cone: 0, ang: -0.8 }, { cone: 1, ang: -2.3 }] });
  const offs = [];
  const boxes = new Map();     // name -> { x, y, w, h } (world units)
  const els = new Map();       // name -> Element
  let built = null;            // what's drawn: { key, head, cab, slots, ... }
  let kitState = null, dragging = null, alive = true;

  /* ------------------------------------------------------------------------------------------- the pixels */
  const bg = h('canvas.gr-r-bg', { 'aria-hidden': 'true' });
  bg.width = (STAGE.w + MARGIN.x * 2) / PX; bg.height = (STAGE.h + MARGIN.y * 2) / PX;
  Object.assign(bg.style, { left: -MARGIN.x + 'px', top: -MARGIN.y + 'px', width: STAGE.w + MARGIN.x * 2 + 'px', height: STAGE.h + MARGIN.y * 2 + 'px' });
  const kitCv = h('canvas.gr-r-kit', { 'aria-hidden': 'true' });
  kitCv.width = KIT.w; kitCv.height = KIT.h;
  Object.assign(kitCv.style, { left: KIT.x + 'px', top: KIT.y + 'px', width: KIT.w * KIT.px + 'px', height: KIT.h * KIT.px + 'px' });
  const tapeCv = h('canvas.gr-r-tape', { 'aria-hidden': 'true' });
  tapeCv.width = TAPE.w; tapeCv.height = TAPE.h;
  Object.assign(tapeCv.style, { left: TAPE.x * PX + 'px', top: TAPE.y * PX + 'px', width: TAPE.w * PX + 'px', height: TAPE.h * PX + 'px' });
  G.pixels.append(bg, kitCv, tapeCv);
  const gBg = bg.getContext('2d'), gKit = kitCv.getContext('2d'), gTape = tapeCv.getContext('2d');
  let doorHover = false;
  function paintRoom() {
    gBg.clearRect(0, 0, bg.width, bg.height);
    drawStage(shifted(gBg, MARGIN.x / PX, MARGIN.y / PX), { doorHover });
  }
  paintRoom();
  const P = (r) => ({ x: r.x * PX, y: r.y * PX, w: r.w * PX, h: r.h * PX });
  boxes.set('banner', P(PIX.banner));
  boxes.set('riser', P(PIX.riser));
  boxes.set('tape', { x: PIX.tape.x * PX, y: PIX.tape.y * PX, w: PIX.tape.w * PX, h: PIX.tape.h * PX });
  boxes.set('door', P(PIX.door));
  boxes.set('kit', { x: 584, y: 188, w: 520, h: 270 });

  /* ------------------------------------------------------------------------------------------- the hotspots */
  function hot(name, label, say, id, r, extra = {}) {
    const b = h('button.gr-r-hot', { type: 'button', 'aria-label': label, dataset: { hot: name, say }, onclick: () => R.press(id), style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`, ...extra });
    G.hot.append(b);
    els.set(name, b);
    return b;
  }
  hot('kit', 'The kit: the drummer’s book (K)', 'The drummer’s book  K', 'cam:kit', boxes.get('kit'));
  const tapeR = boxes.get('tape');
  hot('tape', 'The tape machine: the last minute (G)', 'The last minute of tape  G', 'tape', { x: tapeR.x - 6, y: tapeR.y - 6, w: tapeR.w + 12, h: 180 });
  const doorR = boxes.get('door');
  hot('door', 'The door to the shop (S)', 'The shop  S', 'shop', { x: doorR.x, y: doorR.y - 72, w: doorR.w, h: doorR.h + 72 }, {
    onmouseenter: () => { doorHover = true; paintRoom(); }, onmouseleave: () => { doorHover = false; paintRoom(); },
    onfocus: () => { doorHover = true; paintRoom(); }, onblur: () => { doorHover = false; paintRoom(); },
  });
  // (the pixel-only things Getting started may point at: a box with nothing in it)
  for (const name of ['banner', 'riser']) {
    const r = boxes.get(name), m = h('i.gr-r-mark', { 'aria-hidden': 'true', dataset: { mark: name }, style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` });
    G.hot.append(m);
    els.set(name, m);
  }

  /* ------------------------------------------------------------------------------------------- the rig */
  const faces = new Map();     // key -> face
  const meas = () => { const m = h('div', { style: 'position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none;contain:layout' }); document.body.append(m); return m; };
  const say = (text) => { try { R.say(text); } catch { /* the talkback's business */ } };
  const defOf = (slot) => R.rig.def(slot);
  const paramOf = (def, key) => { const p = (def?.params || def?.knobs || []).find((x) => (x.key || x.id) === key); return p ? normParam(p) : null; };
  // what makes the drawing change shape (not a knob, not a stomp: those update the faces in place)
  const shapeOf = (rig) => {
    if (!rig) return 'none';
    const amp = rig.amp ? { ...rig.amp, params: R.rig.values(rig.amp.slot) } : null;
    return [rig.slots.map((s) => s.device).join(','), amp ? cabOf(amp).id + ':' + micsOf(amp.params).length : ''].join('|');
  };
  const tuner = tunerFace({ onStomp: () => R.press('tuner') });

  function clearRig() {
    for (const f of faces.values()) { try { f.destroy(); } catch { /* gone */ } }
    faces.clear();
    G.gear.replaceChildren();
    for (const t of G.hot.querySelectorAll('.gr-r-tag')) t.remove();
    for (const k of [...boxes.keys()]) if (/^(head|cab|board|meter|jack|tuner|slot:)/.test(k)) boxes.delete(k);
    for (const k of [...els.keys()]) if (/^(head|cab|board|meter|jack|tuner|slot:)/.test(k)) els.delete(k);
  }

  // the hand's place across a new drawing (a move, a pedal off, an undo): the same control on the same piece of gear,
  // so a tag's arrows can be pressed again and again, and a knob keeps the keys it had
  const FOCUSABLE = 'button, [role=slider], [tabindex]:not([tabindex="-1"])';
  let lastBy = 'key';
  const byPointer = () => { lastBy = 'pointer'; }, byKey = () => { lastBy = 'key'; };
  document.addEventListener('pointerdown', byPointer, true);
  document.addEventListener('keydown', byKey, true);
  offs.push(() => { document.removeEventListener('pointerdown', byPointer, true); document.removeEventListener('keydown', byKey, true); });
  function focusOf() {
    const a = document.activeElement;
    if (!a || !(G.gear.contains(a) || G.hot.contains(a))) return null;
    // (a button the mouse pressed gives the keys back to the room, ui/liveroom/index.js: only one the keys pressed is
    // followed; a knob keeps the focus a grab gave it)
    if (a.matches('button') && lastBy === 'pointer') return null;
    const box = a.closest('.gr-r-head, .gr-r-slot, .gr-r-tag, .gr-r-add');
    if (!box) return null;
    const where = box.classList.contains('gr-r-head') ? 'head' : box.classList.contains('gr-r-slot') ? 'slot' : box.classList.contains('gr-r-tag') ? 'tag' : 'add';
    return { where, device: box.dataset.tuner ? 'tuner' : box.dataset.device || '', idx: [...box.querySelectorAll(FOCUSABLE)].indexOf(a) };
  }
  function refocus(f) {
    if (!f || !built) return;
    const box = f.where === 'head' ? built.head?.el : f.where === 'add' ? built.add?.el
      : f.where === 'slot' ? built.slots.find((q) => (q.tuner ? 'tuner' : q.s.device) === f.device)?.el
        : [...G.hot.querySelectorAll('.gr-r-tag')].find((t) => t.dataset.device === f.device);
    if (!box) return;
    const list = box.matches(FOCUSABLE) ? [box] : [...box.querySelectorAll(FOCUSABLE)];
    (list[f.idx] || list[0])?.focus?.({ preventScroll: true });
  }

  function build() {
    const rig = R.rig.now();
    const before = built?.devices || null;
    const hand = focusOf();
    clearRig();
    built = { key: shapeOf(rig), rig, slots: [], devices: rig ? rig.slots.map((s) => s.device) : [] };
    if (!rig) return;
    const tmp = meas();
    try {
      /* the cab, standing on the floor, and the head sat on it */
      if (rig.amp) {
        const aSlot = rig.amp.slot, aDef = defOf(aSlot), values = R.rig.values(aSlot);
        const cab = cabOf({ device: rig.amp.device, params: values });
        const cw = cab.box.w, ch = cab.box.h, cx = ST.cx - cw / 2, cy = ST.floor - ch;
        const cabEl = buildCab(cab, cw, ch);
        place(cabEl, cx, cy, cw, ch);
        cabEl.addEventListener('click', (e) => { if (e.target.closest('.gr-r-mic') || R.gr.cam === 'cab') return; R.press('cam:cab'); });
        G.gear.append(cabEl);
        built.cab = { x: cx, y: cy, w: cw, h: ch, el: cabEl, info: cab };
        boxes.set('cab', { x: cx, y: cy, w: cw, h: ch }); els.set('cab', cabEl);
        if (aDef) {
          const f = renderFace(aDef, values, { on: rig.amp.on, size: 'compact',
            onParam: (k, v, { commit }) => turn(aSlot, k, v, commit),
            onToggle: (on) => stomp(aSlot, on) });
          faces.set('amp', f);
          noSelects(f.el, aDef.name);
          const wrap = h('div', { style: `width:${ST.headW}px;transform:scale(${ST.headZ});transform-origin:0 0` }, f.el);
          tmp.append(wrap);
          const nh = f.el.offsetHeight || 128, hw = ST.headW * ST.headZ, hh = nh * ST.headZ;
          const head = h('div.gr-r-head', { dataset: { amp: rig.amp.device } }, wrap);
          head.addEventListener('click', (e) => { if (e.target.closest('.kn, button, [role=slider], .gr-r-pick')) return; if (R.gr.cam !== 'head') R.press('cam:head'); });
          place(head, ST.cx - hw / 2, cy - hh + 2, hw, hh);
          G.gear.append(head);
          built.head = { x: ST.cx - hw / 2, y: cy - hh + 2, w: hw, h: hh, el: head, face: f, slot: aSlot };
          boxes.set('head', { x: built.head.x, y: built.head.y, w: hw, h: hh }); els.set('head', head);
          boxes.set(`slot:${aSlot}`, boxes.get('head')); els.set(`slot:${aSlot}`, head);
          if (before && !before.includes(rig.amp.device)) flash(head);
        }
        const hd = built.head || { x: ST.cx - 248, y: cy - 150, w: 496, h: 150 };
        // its input, at the left end of the panel (the compact face has no jacks of its own)
        built.hin = { x: hd.x + hd.w * 0.045, y: hd.y + hd.h * 0.7 };
        // the input meter, on the head
        const leds = Array.from({ length: 24 }, (_, i) => { const db = -60 + i * 2.5; return h('i' + (db >= WINDOW.lo && db < WINDOW.hi ? '.gr-r-win' : db >= -3 ? '.gr-r-over' : '')); });
        const dbEl = h('span.gr-r-db', '–');
        const lo = ((WINDOW.lo + 60) / 2.5) * 7, hi = ((WINDOW.hi + 60) / 2.5) * 7;
        const meter = h('div.gr-r-meter', { role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': -60, 'aria-valuemax': 0 }, 'INPUT', h('span.gr-r-leds', leds, h('span.gr-r-winmark', { style: `left:${lo}px;width:${hi - lo - 2}px` })), dbEl);
        tmp.append(meter);
        const mw = meter.offsetWidth || 292, mh = meter.offsetHeight || 24;
        place(meter, hd.x + 14, hd.y - 30);
        G.gear.append(meter);
        built.meter = { el: meter, leds, db: dbEl, n: -1, text: '' };
        boxes.set('meter', { x: hd.x + 14, y: hd.y - 30, w: mw, h: mh }); els.set('meter', meter);
        // the mics, in front of the grille
        built.mics = micsOf(values).map((m, i) => { const el = buildMic(i); G.gear.append(el); wireMic(el, i); return el; });
        placeMics(values);
      }

      /* the board, its pedals in signal order (the loop's after the amp), as big as its height allows */
      const board = h('div.gr-r-board', h('i.gr-r-rail'));
      place(board, BOARD.x, BOARD.y, BOARD.w, BOARD.h);
      board.addEventListener('click', (e) => { if (e.target === board || e.target.classList.contains('gr-r-rail')) R.press('cam:board'); });
      G.gear.append(board);
      boxes.set('board', { ...BOARD }); els.set('board', board);
      const ampSlot = rig.amp ? rig.amp.slot : Infinity;
      const items = [{ tuner: true, fc: tuner }, ...rig.board.map((s) => {
        const d = defOf(s.slot);
        if (!d) return null;
        const f = renderFace(d, R.rig.values(s.slot), { on: s.on, onParam: (k, v, { commit }) => turn(s.slot, k, v, commit), onToggle: (on) => stomp(s.slot, on) });
        faces.set('slot:' + s.slot, f);
        noSelects(f.el, d.name);
        return { s, d, fc: f, loop: s.slot > ampSlot };
      }).filter(Boolean)];
      for (const it of items) { tmp.append(it.fc.el); it.nw = it.fc.el.offsetWidth || 120; it.nh = it.fc.el.offsetHeight || 182; }
      const inner = BOARD.h - 34, addW = 120, hasLoop = items.some((it) => it.loop), loopGap = hasLoop ? 40 : 0;
      const widthAt = (z) => items.reduce((a, it) => a + it.nw * Math.min(z, (inner - 6) / it.nh), 0);
      const fixed = 48 + loopGap + addW + 16;
      let z = ST.pedZ, gap = 18;
      while (widthAt(z) + gap * items.length + fixed > BOARD.w && z > 0.3) z -= 0.02;
      gap = Math.min(gap + (BOARD.w - (widthAt(z) + gap * items.length + fixed)) / (items.length + 1), 72);
      let x = BOARD.x + 24 + gap / 2, n = 0, loopAt = null;
      for (const it of items) {
        if (it.loop && loopAt == null) { loopAt = x - gap / 2 + 6; x += loopGap; }
        const zz = Math.min(z, (inner - 6) / it.nh), w = it.nw * zz, hh = it.nh * zz, y = BOARD.y + BOARD.h - 26 - hh;
        if (!it.tuner) n++;
        const key = it.tuner ? 'U' : String(n);
        const cap = h('span.gr-r-keycap', { style: `top:${hh + 6}px` }, key, h('b', ''));
        const slot = h('div.gr-r-slot', { dataset: it.tuner ? { tuner: '1' } : { slot: String(it.s.slot), device: it.s.device } },
          h('div.gr-r-face', { style: `transform:scale(${zz})` }, it.fc.el), cap,
          it.tuner ? null : h('button.gr-r-rm', { type: 'button', title: `Take ${it.d.name} off the board`, 'aria-label': `Take ${it.d.name} off the board`, onclick: (e) => { e.stopPropagation(); remove(it.s.slot); } }, '×'));
        place(slot, x, y, w, hh);
        G.gear.append(slot);
        const rec = { x, y, w, h: hh, el: slot, cap, tuner: !!it.tuner, s: it.s || null, d: it.d || null, loop: !!it.loop, n: it.tuner ? 0 : n, face: it.fc };
        built.slots.push(rec);
        wireSlot(rec);
        if (it.tuner) { boxes.set('tuner', { x, y, w, h: hh }); els.set('tuner', slot); }
        else {
          boxes.set(`slot:${it.s.slot}`, { x, y, w, h: hh }); els.set(`slot:${it.s.slot}`, slot);
          if (before && !before.includes(it.s.device)) flash(slot);
        }
        x += w + gap;
      }
      built.loopAt = loopAt;
      if (loopAt != null) { const lm = h('div.gr-r-loop', h('span', 'AMP’S LOOP')); place(lm, loopAt, BOARD.y, null, BOARD.h); G.gear.append(lm); }
      const addH = Math.min(150, inner - 10), ax = Math.min(x + 6, BOARD.x + BOARD.w - addW - 16);
      const add = h('button.gr-r-add', { type: 'button', 'aria-label': 'Add a pedal: the shop’s pedal case', onclick: () => R.press('pedal:add') }, h('b', '+ Pedal'), h('small', 'from the shop'));
      place(add, ax, BOARD.y + BOARD.h - 26 - addH, addW, addH);
      G.gear.append(add);
      built.add = { x: ax, y: BOARD.y + BOARD.h - 26 - addH, w: addW, h: addH, el: add };
      // the jack the guitar goes into: the first pedal's input
      const first = built.slots[0];
      const jack = h('div.gr-r-jack');
      place(jack, first.x - 7, first.y + first.h * 0.32);
      G.gear.append(jack);
      built.jack = { x: first.x - 2, y: first.y + first.h * 0.32 + 5, el: jack };
      boxes.set('jack', { x: first.x - 40, y: first.y + first.h * 0.32 - 12, w: 52, h: 24 }); els.set('jack', jack);
      // the board's hang tags, measured, then set in a row above the pedals
      const tagBase = Math.min(...built.slots.map((q) => q.y)) - 14;
      const tags = built.slots.map((q) => { const t = tagOf(q); tmp.append(t); return { q, t, th: t.offsetHeight || 150 }; });
      let right = -1e9;
      built.tagTop = 1e9;
      for (const { q, t, th } of tags) {
        const tx = Math.max(q.x + q.w / 2 - 82, right + 8);
        place(t, tx, tagBase - th, 164);
        G.hot.append(t);
        right = tx + 164;
        built.tagTop = Math.min(built.tagTop, tagBase - th);
      }
      // the cables
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gr-r-cables');
      svg.setAttribute('aria-hidden', 'true');
      G.gear.prepend(svg);
      built.svg = svg;
      built.plugKey = '';
    } finally {
      tmp.remove();
    }
    update(rig);
    refocus(hand);
  }

  function place(el, x, y, w, hh) {
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (w != null) el.style.width = w + 'px';
    if (hh != null) el.style.height = hh + 'px';
    return el;
  }
  function flash(el) { el.classList.remove('gr-r-fresh'); void el.offsetWidth; el.classList.add('gr-r-fresh'); setTimeout(() => el.classList.remove('gr-r-fresh'), 1500); }

  // the faces, the keycaps and the mics as the song has them now (a knob, a stomp, an undo: no new drawing)
  function update(rig = R.rig.now()) {
    if (!built || !rig) return;
    if (built.head && rig.amp) {
      const v = R.rig.values(rig.amp.slot);
      built.head.face.update(v, rig.amp.on);
      syncPicks(built.head.el);
      placeMics(v);
    }
    for (const q of built.slots) {
      if (q.tuner) { setCap(q, !!R.gr.tuner?.on); continue; }
      const s = rig.slots[q.s.slot];
      if (!s) continue;
      q.face.update(R.rig.values(s.slot), s.on);
      syncPicks(q.el);
      q.el.classList.toggle('gr-r-off', !s.on);
      setCap(q, s.on);
    }
    markSlot();
    built.plugKey = '';
    renderPanel();
  }
  function markSlot() { if (built) for (const q of built.slots) q.el.classList.toggle('gr-r-focus', !q.tuner && R.gr.slot != null && R.gr.slot === q.s.slot); }
  function setCap(q, on) { const b = q.cap.lastChild; const t = on ? 'on' : 'off'; if (b.textContent !== t) b.textContent = t; q.cap.classList.toggle('gr-r-k-off', !on); q.el.classList.toggle('gr-r-off', !on && !q.tuner); }

  function placeMics(values) {
    if (!built?.cab || !built.mics) return;
    const mics = micsOf(values);
    const cabBox = { ...built.cab };
    built.mics.forEach((el, i) => {
      const m = mics[i];
      el.hidden = !m;
      if (!m) return;
      const at = mine.mics[i] || { cone: i, ang: -0.8 };
      if (at.cone >= (built.cab.el._cones || []).length) at.cone = 0;
      placeMic(el, m, at, cabBox);
    });
  }
  // a mic dragged across the grille (close up, at the cab): its cone and its place on it (POSITION, MIC 2's POS 2)
  function wireMic(el, i) {
    const body = el.querySelector('.gr-r-mic-body');
    body.addEventListener('pointerdown', (e) => {
      if (R.gr.cam !== 'cab' || !built?.cab || !built.head) return;
      e.preventDefault(); e.stopPropagation();
      body.setPointerCapture(e.pointerId);
      const slot = built.head.slot, key = i ? 'mic2pos' : 'micpos';
      let last = null;
      const move = (ev) => {
        const vr = R.el.view.getBoundingClientRect(), w = R.camera.toWorld({ x: ev.clientX - vr.left, y: ev.clientY - vr.top });
        let best = null;
        (built.cab.el._cones || []).forEach((c, ci) => { const dx = w.x - (built.cab.x + c.x), dy = w.y - (built.cab.y + c.y), d = Math.hypot(dx, dy); if (!best || d < best.d) best = { ci, dx, dy, d, r: c.r }; });
        if (!best) return;
        mine.mics[i] = { cone: best.ci, ang: Math.atan2(best.dy, best.dx) };
        const pos = Math.round(clamp(best.d / best.r, 0, 1.35) * 100) / 100;
        built.cab.el.querySelectorAll('.gr-r-cone').forEach((c, ci) => c.classList.toggle('gr-on', ci === best.ci));
        if (pos !== last) { last = pos; R.rig.turn(slot, key, pos, { commit: false }); }
        placeMics(R.rig.values(slot));
      };
      const up = () => {
        body.removeEventListener('pointermove', move); body.removeEventListener('pointerup', up); body.removeEventListener('pointercancel', up);
        built?.cab?.el.querySelectorAll('.gr-r-cone').forEach((c) => c.classList.remove('gr-on'));
        if (last == null) return;
        const m = micsOf(R.rig.values(slot))[i];
        if (m) say(`${i ? 'Mic 2: ' : ''}${m.name} ${onCone(m.pos)}, ${inches(m.dist)} back. ${m.pos < 0.4 ? 'Brighter' : m.pos > 0.82 ? 'Darker' : 'Rounder'}; this song’s copy.`);
      };
      body.addEventListener('pointermove', move); body.addEventListener('pointerup', up); body.addEventListener('pointercancel', up);
    });
  }

  /* ------------------------------------------------------------------------------------------- turning, stomping, moving */
  function nameOf(slot) { return defOf(slot)?.name || 'That'; }
  function turn(slot, key, value, commit) {
    const r = R.rig.turn(slot, key, value, { commit });
    if (!r.ok) { if (commit) say(r.error); return; }
    if (!commit) return;
    const d = defOf(slot), p = paramOf(d, key);
    const word = p ? sentence(p.label || key) : key, val = p ? minus(valueText(p, value)) : String(value);
    const isAmp = R.rig.now()?.amp?.slot === slot;
    say(isAmp ? `${word} ${val} on ${d?.name || 'the amp'}. This song’s copy; Save to rack keeps it.` : `${d?.name || 'The pedal'}: ${word.toLowerCase()} ${val}. This song’s copy.`);
  }
  function stomp(slot, on) {
    const r = R.rig.stomp(slot, on);
    if (!r.ok) { say(r.error); return r; }
    const s = R.rig.now()?.slots[slot];
    if (s) say(s.kind === 'amp' ? (s.on ? `${nameOf(slot)} is back in.` : `${nameOf(slot)} bypassed, and its cab with it: you’re hearing the pedals alone.`) : `${nameOf(slot)} ${s.on ? 'on' : 'off'}.`);
    return r;
  }
  function move(from, to) {
    const d = nameOf(from), rig0 = R.rig.now();
    const r = R.rig.move(from, to);
    if (!r.ok) { say(r.error); return r; }
    const rig = R.rig.now(), s = rig?.slots.find((x) => x.device === rig0?.slots[from]?.device && x.slot === to);
    const pos = s ? rig.board.findIndex((b) => b.slot === s.slot) + 1 : 0;
    const loop = rig?.amp && s ? s.slot > rig.amp.slot : false;
    say(pos ? `${d} is ${ORD[pos - 1] || pos + 'th'} on the board${loop ? ', in the amp’s loop' : ', before the amp'}.` : `${d} moved.`);
    return r;
  }
  function remove(slot) {
    const d = defOf(slot);
    const r = R.rig.remove(slot);
    if (!r.ok) { say(r.error); return r; }
    say(`${d?.name || 'The pedal'} is back in the case${d?.pedalCat && CAT_WORD[d.pedalCat] ? `, under ${CAT_WORD[d.pedalCat]}` : ''}. ⌘Z puts it back.`);
    return r;
  }

  // a pedal's slot: click (close up), the footswitch is the face's own; drag along the board to move it
  function wireSlot(q) {
    q.el.addEventListener('click', (e) => {
      if (q.dragged) { q.dragged = false; return; }
      if (e.target.closest('.kn, button, [role=slider], .gr-r-pick, .pd-sw')) return;
      if (R.gr.cam === 'stage') R.press(q.tuner ? 'cam:tuner' : 'cam:board');
    });
    if (q.tuner) return;
    q.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.kn, button, [role=slider], .gr-r-pick, .pd-sw, input')) return;
      const x0 = e.clientX, s = R.camera.now().s || 1, left = q.x;
      let on = false;
      const mv = (ev) => {
        const dx = (ev.clientX - x0) / s;
        if (!on && Math.abs(ev.clientX - x0) < 6) return;
        if (!on) { on = true; q.el.setPointerCapture?.(e.pointerId); q.el.classList.add('gr-r-drag'); dragging = { q, left }; }
        // (Esc let go of it: back() put it back, and it stays there till the button comes up)
        if (dragging?.q !== q) return;
        q.el.style.left = clamp(left + dx, BOARD.x, BOARD.x + BOARD.w - q.w) + 'px';
        q.at = left + dx + q.w / 2;
      };
      const end = (ev) => {
        q.el.removeEventListener('pointermove', mv); q.el.removeEventListener('pointerup', end); q.el.removeEventListener('pointercancel', end);
        if (!on) return;
        q.dragged = true;
        q.el.classList.remove('gr-r-drag');
        const was = dragging;
        dragging = null;
        if (!was || ev.type === 'pointercancel') { q.el.style.left = left + 'px'; return; }
        const to = dropAt(q, q.at);
        if (to == null || to === q.s.slot) { q.el.classList.add('gr-r-slide'); q.el.style.left = left + 'px'; setTimeout(() => q.el.classList.remove('gr-r-slide'), 200); return; }
        const r = move(q.s.slot, to);
        if (!r.ok) q.el.style.left = left + 'px';
      };
      q.el.addEventListener('pointermove', mv); q.el.addEventListener('pointerup', end); q.el.addEventListener('pointercancel', end);
    });
  }
  // where a dragged pedal lands, as a slot in the run: before the amp, or (right of the loop mark) in its loop
  function dropAt(q, cx) {
    const rig = R.rig.now();
    if (!rig) return null;
    const others = built.slots.filter((o) => !o.tuner && o !== q);
    const k = others.filter((o) => o.x + o.w / 2 < cx).length;
    const a = others.filter((o) => !o.loop).length;
    if (!rig.amp) return clamp(k, 0, rig.slots.length - 1);
    // the run without the dragged pedal: the pre-amp pedals, the amp, the loop's
    // (with nothing in the loop there's no mark: a pedal goes in the loop from the shop, or by its tag's →)
    const inLoop = built.loopAt != null && cx > built.loopAt;
    const t = inLoop ? Math.max(k, a) + 1 : Math.min(k, a);
    return clamp(t, 0, rig.slots.length - 1);
  }

  // a hang tag: what it is, what it tips its hat to, and moving it (the keys' way to do what a drag does)
  function tagOf(q) {
    if (q.tuner) {
      return h('div.gr-r-tag', { dataset: { device: 'tuner' } }, h('small', 'Tuner · mutes while on'), h('b', 'Tuna Fork'), h('div', 'Reads one open string at a time, low to high; mutes you while it’s on.'),
        h('div.gr-r-nod', 'Tips its hat to the strobe and needle tuners at the front of every board.'),
        h('div.gr-r-mv', h('button', { type: 'button', onclick: () => R.press('cam:tuner') }, 'Tunings'), h('span.gr-r-fix', 'Always first')));
    }
    const d = q.d, s = q.s;
    return h('div.gr-r-tag', { dataset: { slot: String(s.slot), device: s.device } },
      h('small', kindOf(d)), h('b', d.name),
      d.blurb ? h('div', d.blurb) : null, d.nod ? h('div.gr-r-nod', `Tips its hat to ${d.nod}.`) : null,
      h('div.gr-r-mv',
        h('button', { type: 'button', 'aria-label': `Move ${d.name} earlier`, onclick: () => move(s.slot, s.slot - 1) }, '←'),
        h('button', { type: 'button', 'aria-label': `Move ${d.name} later`, onclick: () => move(s.slot, s.slot + 1) }, '→'),
        h('button', { type: 'button', onclick: () => remove(s.slot) }, 'Back in the case')));
  }

  /* ------------------------------------------------------------------------------------------- the camera's targets */
  const pad = (b, l, t, r, bt) => ({ x: b.x - l, y: b.y - t, w: b.w + l + r, h: b.h + t + bt });
  const T = {
    head: { rect: () => { const hd = boxes.get('head') || REGIONS.head, m = boxes.get('meter') || REGIONS.meter; const y = Math.min(hd.y, m.y) - 16; return { x: hd.x - 30, y, w: hd.w + 60, h: hd.y + hd.h - y + 230 }; }, right: 340 },
    cab: { rect: () => pad(boxes.get('cab') || REGIONS.cab, 60, 30, 60, 26), right: 420 },
    board: { rect: () => {
      if (!built?.slots.length) return pad(REGIONS.board, 0, 14, 0, 0);
      const x = Math.min(...built.slots.map((q) => q.x)) - 30, x2 = (built.add ? built.add.x + built.add.w : BOARD.x + BOARD.w) + 24, y = Math.min(built.tagTop || BOARD.y, BOARD.y) - 14;
      return { x, y, w: x2 - x, h: STAGE.h - y };
    }, pad: 12, ay: 1 },
    tuner: { rect: () => pad(boxes.get('tuner') || REGIONS.tuner, 50, 40, 50, 40), right: 380 },
  };
  for (const [id, t] of Object.entries(T)) offs.push(R.camera.target(id, { world: 'stage', ...t }));

  /* ------------------------------------------------------------------------------------------- the head's panel */
  const panel = R.panel('head');
  panel.classList.add('gr-r-panel');
  let panelKey = '';
  function renderPanel() {
    const rig = R.rig.now(), amp = rig?.amp, d = amp ? defOf(amp.slot) : null;
    const changed = rig && R.store.get()?.room?.stack?.id === CLUB_STACK.id ? !sameChain(rig.chain, CLUB_STACK.chain) : null;
    const key = [amp?.device, changed].join('|');
    if (key === panelKey) return;
    panelKey = key;
    panel.replaceChildren();
    if (!d) { const n = listDevices().filter((x) => /^amp\./.test(x.id)).length; panel.append(h('p', `There’s no amp on the rig. The shop’s amp wall has ${n}: S.`)); return; }
    panel.append(
      h('div.gr-r-kind', `${TONE_WORD[d.tone] || 'Amp'} · your stack`),
      h('h2.disp', d.name),
      d.blurb ? h('p', d.blurb) : null,
      d.nod ? h('p.gr-r-nod', `In the spirit of ${d.nod}.`) : null,
      h('p.gr-r-note', 'Drag a knob up or down (Shift for fine), scroll it, or focus it and use the arrow keys. Double-click puts it back. Changes go to this song’s copy of the stack.'),
      h('h3', 'Somewhere else'),
      h('div.gr-r-row', h('button.gr-r-b', { type: 'button', onclick: () => R.press('cam:cab') }, 'The cab and its mics', kbd('C'))),
      h('div.gr-r-row', h('button.gr-r-b', { type: 'button', onclick: () => R.press('shop') }, 'Another amp: the shop', kbd('S'))),
      h('div.gr-r-row', { style: 'margin-top:18px' }, h('button.gr-r-b', { type: 'button', onclick: () => R.press('save') }, 'Save to rack'),
        h('span.gr-r-note', changed == null ? 'Edits go to this song’s copy' : changed ? 'Changed: this song’s copy' : 'The club’s stack, as it came')));
  }

  /* ------------------------------------------------------------------------------------------- the header's keys and the strip's */
  const backBtn = h('button.gr-r-back', { type: 'button', hidden: true, onclick: () => R.press('back') }, h('span', 'Step back'), kbd('Esc'));
  // (Getting started's button is the start stream's, beside these; Talk to Claude is the tape stream's, in the strip's
  // talkback: one of each)
  const whoName = h('b.by.by-agent', 'Claude');
  const who = h('span.gr-r-who', { hidden: true, title: 'Claude is connected: / talks to it through the glass' }, h('i', { 'aria-hidden': 'true' }), whoName, ' on the talkback');
  R.el.tools.append(backBtn, who);
  let whoAt = -1e9;
  function renderWho(now) {
    if (now - whoAt < 1000) return;
    whoAt = now;
    let w = null;
    try { w = R.parts.tape?.claude?.() || null; } catch { w = null; }
    const here = !!w?.here, name = w?.inApp || !w?.outside?.length ? 'Claude' : String(w.outside[0]);
    if (who.hidden === here) who.hidden = !here;
    if (whoName.textContent !== name) whoName.textContent = name;
  }
  function renderBack() {
    const shop = R.gr.world === 'shop', away = R.gr.cam !== R.gr.world;
    backBtn.hidden = !shop && !away;
    backBtn.firstChild.textContent = shop && !away ? 'Back to the stage' : 'Step back';
  }
  renderBack();
  const riffN = h('span', '0'), partN = h('span', 'empty'), caret = h('span.gr-r-dim', '▴');
  const drawerBtn = h('button.gr-r-chip', { type: 'button', 'aria-label': 'The riffs and the part line (L)', onclick: () => R.press('riffs') }, h('b', 'Riffs'), riffN, h('span.gr-r-dim', '·'), h('b', 'Part line'), partN, caret);
  R.el.strip.tools.append(drawerBtn);
  let riffCount = 0;
  async function countRiffs() {
    try { const list = await R.parts.tape?.riffs?.(); if (alive && Array.isArray(list)) { riffCount = list.length; renderStrip(); } } catch { /* the tape's business */ }
  }
  function renderStrip() {
    const parts = (R.store.get()?.sections || []).length;
    riffN.textContent = String(riffCount);
    partN.textContent = parts ? String(parts) : 'empty';
    caret.textContent = R.gr.drawer ? '▾' : '▴';
    drawerBtn.setAttribute('aria-expanded', String(!!R.gr.drawer));
  }
  renderStrip();
  setTimeout(countRiffs, 0);

  /* ------------------------------------------------------------------------------------------- a knob, large, while your hand's on it */
  const tip = h('div.gr-r-kntip', { 'aria-hidden': 'true' }, h('small'), h('span'), h('b'));
  R.el.view.append(tip);
  let tipKnob = null;
  const rigKnob = (t) => { const kn = t?.closest?.('.kn'); return kn && kn.closest('.gr-r-head, .gr-r-slot') ? kn : null; };
  function showTip() {
    if (!tipKnob || !tipKnob.isConnected) { tip.classList.remove('gr-on'); tipKnob = null; return; }
    const owner = tipKnob.closest('.gr-r-head') ? built?.head && defOf(built.head.slot)?.name : (() => { const s = tipKnob.closest('.gr-r-slot'); return s?.dataset.slot != null ? nameOf(+s.dataset.slot) : ''; })();
    const dial = tipKnob.querySelector('[role=slider]');
    const l = tipKnob.querySelector('.kn-l')?.textContent || '', v = dial?.getAttribute('aria-valuetext') || tipKnob.querySelector('.kn-v')?.textContent || '';
    tip.children[0].textContent = owner || '';
    tip.children[1].textContent = sentence(l);
    tip.children[2].textContent = minus(v);
    const r = tipKnob.getBoundingClientRect(), vr = R.el.view.getBoundingClientRect(), tw = tip.offsetWidth || 160;
    tip.style.left = clamp(r.left + r.width / 2 - vr.left - tw / 2, 8, vr.width - tw - 8) + 'px';
    tip.style.top = Math.max(8, r.top - vr.top - (tip.offsetHeight || 54) - 10) + 'px';
    tip.classList.add('gr-on');
  }
  const keepTip = () => { if (tipKnob && !(tipKnob.matches(':hover') || tipKnob.classList.contains('drag') || tipKnob.contains(document.activeElement))) tipKnob = null; showTip(); };
  const onOver = (e) => { const kn = rigKnob(e.target); if (kn) { tipKnob = kn; showTip(); } };
  R.el.root.addEventListener('pointerover', onOver);
  R.el.root.addEventListener('focusin', onOver);
  offs.push(() => { R.el.root.removeEventListener('pointerover', onOver); R.el.root.removeEventListener('focusin', onOver); });

  /* ------------------------------------------------------------------------------------------- following the song and the room */
  offs.push(R.on('rig', (rig) => { if (shapeOf(rig) !== built?.key) build(); else update(rig); }));
  // (the piece of gear in focus is for the head's and the board's zooms: back on the stage, or in the shop, it's let go)
  offs.push(R.on('cam', (d) => {
    if (d?.to !== 'head' && d?.to !== 'board') R.gr.slot = null;
    // (a knob the hand left focused doesn't follow the camera: its big name and value would hang over the next view)
    const a = document.activeElement;
    if (a && a !== document.body && R.el.stage.gear.contains(a) && !(d?.to === 'head' && built?.head?.el?.contains(a)) && !(d?.to === 'board' && a.closest?.('.gr-r-slot'))) a.blur?.();
    renderBack(); markSlot(); keepTip();
  }));
  offs.push(R.on('drawer', () => { renderStrip(); countRiffs(); }));
  for (const e of ['tape:grab', 'tape:riff', 'tape:riffs']) offs.push(R.on(e, () => countRiffs()));
  if (R.store.on) { const off = R.store.on('change', () => { renderStrip(); renderPanel(); }); if (typeof off === 'function') offs.push(off); }
  build();
  // the rig in a line, once a visit (on a first visit Getting started has the room's first words)
  function rigLine() {
    const rig = R.rig.now();
    if (!rig?.amp) return '';
    const name = R.store.get()?.room?.stack?.name || 'Your stack', cab = built?.cab?.info;
    const an = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
    const front = rig.board.filter((s) => s.on && s.slot < rig.amp.slot).map((s) => typeWord(defOf(s.slot)).toLowerCase()).filter(Boolean).map(an);
    const list = front.length > 1 ? `${front.slice(0, -1).join(', ')} and ${front.at(-1)}` : front[0] || '';
    return `${name} is up: ${nameOf(rig.amp.slot)} on ${cab ? an(`${cab.n}x${cab.size}`) : 'its cab'}${list ? `, ${list} in front` : ''}. Space starts the drummer.`;
  }
  setTimeout(() => {
    if (!alive || R.gr.said['room.stack'] || !R.gprefs.get().gs?.done) return;
    R.gr.said['room.stack'] = true;
    const t = rigLine();
    if (t) say(t);
  }, 0);
  // (the faces' fonts may land after the first measure: draw once more when they have)
  try { document.fonts?.ready?.then(() => { if (alive) build(); }); } catch { /* fine */ }

  /* ------------------------------------------------------------------------------------------- each frame */
  const level = createLevel();
  let plug = { on: null, t: 1, at: 0 }, tapeKey = '', kitKey = '', lastTape = 0;
  function frameMeter(now) {
    const audio = app.input?.audio;
    const open = !!audio?.state?.open;
    let smp = null;
    if (open) { try { smp = audio.samples?.(); } catch { smp = null; } }
    const st = level.push(smp?.buf || 0, now);
    const m = built?.meter;
    const db = open && smp ? st.db : -100, hold = open && smp ? st.hold : -100;
    if (m) {
      const n = m.leds.reduce((a, _, i) => a + (-60 + i * 2.5 <= db ? 1 : 0), 0);
      if (n !== m.n) { m.n = n; m.leds.forEach((l, i) => l.classList.toggle('gr-on', i < n)); }
      const text = !open ? 'no input' : hold > -60 ? `${minus(Math.round(hold))} dBFS` : '–';
      if (text !== m.text) { m.text = text; m.db.textContent = text; m.el.setAttribute('aria-valuenow', String(Math.round(Math.max(-60, hold)))); m.el.setAttribute('aria-valuetext', text); }
      m.el.classList.toggle('gr-r-lit', R.gr.gs?.step === 'plug');
    }
    const muted = !!R.gr.tuner?.on;
    built?.head?.face.meter(muted ? 0 : clamp((db + 60) / 60, 0, 1));
    return { open, level: clamp((db + 60) / 60, 0, 1) };
  }
  function framePlug(now, open) {
    if (!built?.svg) return;
    if (plug.on !== open) {
      const was = plug.on;
      plug = { on: open, t: was === false && open && !reducedMotion() ? 0 : 1, at: now };
      if (was === false && open) { built.jack.el.classList.add('gr-r-ring'); setTimeout(() => built?.jack?.el.classList.remove('gr-r-ring'), 2200); }
    }
    if (plug.t < 1) plug.t = clamp((now - plug.at) / 420, 0, 1);
    const lit = R.gr.gs?.step === 'plug';
    const key = [open, plug.t.toFixed(2), lit, built.key].join('|');
    if (key === built.plugKey) return;
    built.plugKey = key;
    built.jack.el.classList.toggle('gr-on', open && plug.t >= 1);
    const geo = { slots: built.slots, jack: built.jack, head: built.head, cab: built.cab, hin: built.hin, board: BOARD, worldW: STAGE.w };
    drawCables(built.svg, geo, { plugged: open, plugT: plug.t, lit });
  }
  function frameTape(now, input) {
    const tape = app.input?.tape, eng = app.engine;
    const rolling = !!tape?.state?.rolling;
    let bar = null;
    if (eng?.playing && Number.isFinite(eng.beat)) bar = Math.floor(eng.beat / beatsPerBar(R.store.get()?.meter)) + 1;
    const hotT = R.gr.cam === 'tape' || R.gr.overlay === 'tape', reduced = reducedMotion();
    const spinning = rolling && !reduced;
    const key = [rolling, bar, Math.round(input * 10), hotT, reduced].join('|');
    if (key === tapeKey && (!spinning || now - lastTape < 33)) return;
    tapeKey = key; lastTape = now;
    gTape.clearRect(0, 0, tapeCv.width, tapeCv.height);
    drawTape(gTape, { rolling, bar, input, hot: hotT, spin: (now / 1000) * 2.2, reduced });
  }
  function frameKit() {
    const theirs = !!G.riser.querySelector('canvas[data-kit]');
    kitCv.hidden = theirs;
    if (theirs) return;
    const s = { ...(kitState || {}), reduced: reducedMotion() };
    const key = JSON.stringify(s);
    if (key === kitKey) return;
    kitKey = key;
    gKit.clearRect(0, 0, kitCv.width, kitCv.height);
    drawKit(gKit, s);
  }
  function frameTuner() {
    const t = R.gr.tuner || {}, rd = t.reading || {};
    tuner.update({ on: !!t.on, input: rd.input, note: rd.note ?? rd.name ?? null, octave: rd.octave ?? null, cents: Number.isFinite(rd.cents) ? rd.cents : null, string: rd.string?.number ?? rd.string ?? null, inTune: !!rd.inTune, held: !!rd.held });
    const q = built?.slots?.[0];
    if (q?.tuner) setCap(q, !!t.on);
  }

  return {
    press(id) {
      const m = /^stomp:([1-8])$/.exec(id);
      if (m) {
        const n = Number(m[1]), b = R.rig.now()?.board[n - 1];
        if (!b) return { ok: false, error: `There’s no pedal ${n} on the board.` };
        return stomp(b.slot);
      }
      const s = /^slot:(\d+)$/.exec(id);
      if (s) {
        const n = Number(s[1]), rig = R.rig.now(), sl = rig?.slots[n];
        if (!sl) return { ok: false, error: `There’s nothing at ${n + 1} on the rig.` };
        R.gr.slot = n;
        if (R.gr.world === 'stage') R.camera.zoomTo(sl.kind === 'amp' ? 'head' : 'board');
        update(rig);
        const el = els.get(`slot:${n}`), f = el?.querySelector('[role=slider], .pd-sw');
        f?.focus?.({ preventScroll: true });
        return { ok: true };
      }
      if (id === 'pedal:add') {
        const r = R.press('shop:case');
        return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'The shop’s pedal case isn’t open.' };
      }
      return false;
    },
    back() {
      if (!dragging) return false;
      const { q, left } = dragging;
      dragging = null;
      q.el.classList.remove('gr-r-drag');
      q.el.style.left = left + 'px';
      q.dragged = true;
      return true;
    },
    frame(now) {
      if (!alive) return;
      const { open, level: lv } = frameMeter(now);
      framePlug(now, open);
      frameTape(now, R.gr.tuner?.on ? 0 : lv);
      frameKit();
      frameTuner();
      renderWho(now);
      if (tipKnob) keepTip();
    },
    unmount() {
      alive = false;
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      clearRig();
      G.pixels.replaceChildren();
      G.hot.replaceChildren();
      tip.remove();
      panel.replaceChildren();
      backBtn.remove(); who.remove(); drawerBtn.remove();
    },
    rect: (name) => { const b = boxes.get(name) || REGIONS[name]; return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null; },
    el: (name) => els.get(name) || null,
    kit(state) { kitState = state && typeof state === 'object' ? { ...state } : null; },
    redraw() { build(); },
  };
}
