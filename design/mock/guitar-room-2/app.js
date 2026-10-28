// The guitar room, second mock (design/mock/guitar-room-2/; the design is docs/research/GUITAR-ROOM.md, with this
// round's changes to §2.1, §2.2 and §2.9). The screen is the stage seen from the front: your amp head on your cab, your
// board along the front at full size, the drummer's riser, the tape machine and the door to the shop. Going closer is
// the camera dollying in (the head, the cab's grille and its mics, the drummer's book, the board, the tuner, the tape);
// Esc steps back out. The shop is a room through the door: the amp wall in labelled sections and the pedal case by
// type, with your stack standing in the try-out corner at stage size the whole time. Getting started happens in the
// room: the camera goes to each thing, the engineer's slate beside it, a pool of light on it.
//
// No sound and no mic: the meters, the tuner, the drummer and the tape are fake state moved by one animation loop. The
// gear is the studio's real faces (app/src/ui/faces.js) of the real devices (app/src/devices/guitar/gear/), crisp in front of the
// pixel rooms (./room-pixels.js). window.mock.go(id) jumps to a screen (the Screens menu does the same).

import { renderFace, AMP_LOOK_IDS, hashId } from '/app/src/ui/faces.js';
import { paramValues } from '/app/src/devices/registry.js';
import { evaluate as evalLooks } from '/app/src/devices/guitar/gear/looks.js';
import { gear } from '/app/src/devices/guitar/gear/index.js';
import {
  getDevice, ampsBySection, pedalsByCat, typeWord, toneWord, CAT_WORD, RANK, inLoop, CABS, MICS, MIC_IDS, GUITAR_CABS, cabBox,
  whereOnCone, onCone, inches, HOUSE, TUNER, TUNINGS, gridOf, library, PINS, GUIDE, riffShape,
} from './data.js';
import { sizeRoom, sizePlain, drawStage, drawStageLive, drawKit, drawShop, drawDock, STAGE, SHOP, KIT, PX } from './room-pixels.js';

/* ================================================================================================ helpers */
const $ = (id) => document.getElementById(id);
function h(sel, attrs, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
// put kids (nested arrays, nulls and all) into an element: replaceChildren() would print an array as text
function append(el, kids) { for (const k of [kids].flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k)); return el; }
function fill(el, ...kids) { el.replaceChildren(); return append(el, kids); }
const kbd = (t) => h('kbd', t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = () => performance.now();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const place = (el, x, y, w, hh) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (w != null) el.style.width = w + 'px'; if (hh != null) el.style.height = hh + 'px'; return el; };
const fmt1 = (v) => Number(v).toFixed(1);
const minus = (n) => String(n).replace('-', '−');
const sentence = (s) => { s = String(s || '').toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const LOOKS = evalLooks({ FONTS: { dirt: '"Rubik Dirt", Impact, "Arial Black", sans-serif', pixel: 'Silkscreen, ui-monospace, monospace' }, PLUG_AMPS: gear.PLUG_AMPS });
const ampLookId = (d) => (d.look?.amp && LOOKS.AMP_LOOKS[d.look.amp] ? d.look.amp : d.amp && LOOKS.AMP_LOOKS[d.amp] ? d.amp : AMP_LOOK_IDS[hashId(d.id) % AMP_LOOK_IDS.length]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GLIDE = REDUCED ? 30 : 660;

/* ================================================================================================ state */
const LIB = library();
let uidN = 1;
const uid = () => 'u' + uidN++;
function fresh() {
  return {
    place: 'stage', cam: 'stage', area: 'wall', caseCat: 'drive',
    amp: HOUSE.amp, ampOn: true, ampParams: { ...HOUSE.ampParams },
    cab: JSON.parse(JSON.stringify(HOUSE.cab)),
    board: HOUSE.board.map((b) => ({ ...b, uid: uid(), params: {} })),
    changed: false,
    tempo: 132, tuning: 'dropc',
    drummer: { on: false, t0: 0, pin: 0, next: null },
    pins: PINS.map((p) => ({ ...p, grid: gridOf(LIB.byId.get(p.id) || GUIDE), edited: false })),
    plugged: true, plugT: 1, ring: false, iface: 'Scarlett Solo USB', input: 'Input 2', gainDb: -8.5, latency: 11,
    tuner: { on: false, str: 0, cents: -24, done: [], hold: 0 },
    gs: null, gsPaused: null, tour: 0,
    riffs: [], parts: [],
    talk: { text: 'The club’s stack is up: Kraken on a 4x12, a gate and a treble booster in front. Space starts the drummer.', by: null, at: now() },
    look: null, book: { style: 'modernmetal' }, drawer: false, talking: false,
    tape: null, freeze: null, count: null,
  };
}
let S = fresh();
function say(text, by = null) { S.talk = { text, by, at: now() }; renderStrip(); }
const boardItem = (u) => S.board.find((b) => b.uid === u);
const pedalsOnly = () => S.board.filter((b) => b.device !== 'tuner');
const ampDef = () => getDevice(S.amp);
const cabName = () => (CABS[S.cab.cab] || CABS.v412).name;

/* ================================================================================================ the camera */
// Two cameras: one on the world you're in (the stage, or the shop's walls), and one on your rig while it stands in the
// shop's try-out corner (the dock), which stays put while the shop pans behind it.
const view = $('view');
const WORLDS = { stage: { el: $('stage'), w: STAGE.w, h: STAGE.h }, shop: { el: $('shop'), w: SHOP.w, h: SHOP.h } };
const cam = { s: 1, x: 0, y: 0 };
const W = () => WORLDS[S.place];
function vsize() { return { w: view.clientWidth, h: view.clientHeight }; }
// frame a world rect into the view, leaving room for a panel or a slate at a side, or a sheet at the bottom
function frameRect(R, { right = 0, left = 0, top = 0, bottom = 0, pad = 24, maxS = 4.2, ax = 0.5, ay = 0.5 } = {}) {
  const { w, h: hh } = vsize(), aw = w - right - left - pad * 2, ah = hh - bottom - top - pad * 2;
  const s = Math.min(aw / R.w, ah / R.h, maxS);
  return { s, x: left + pad + (aw - R.w * s) * ax - R.x * s, y: top + pad + (ah - R.h * s) * ay - R.y * s };
}
function overview(R) {
  const { w, h: hh } = vsize(), s = Math.min(w / R.w, hh / R.h);
  return { s, x: (w - R.w * s) / 2 - R.x * s, y: (hh - R.h * s) / 2 - R.y * s };
}
function moveEl(el, c, glide) {
  el.classList.toggle('glide', glide && !REDUCED);
  el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
}
function setCam(c, glide = true) { moveEl(W().el, c, glide); Object.assign(cam, c); }
const dockCam = { s: 1, x: 0, y: 0 };
function setDock(c, glide = true) { moveEl($('dock'), c, glide); Object.assign(dockCam, c); }
// a world rect -> the screen (the view's own coordinates), with the camera where it's going
const toView = (R) => ({ x: cam.x + R.x * cam.s, y: cam.y + R.y * cam.s, w: R.w * cam.s, h: R.h * cam.s });
// an element's box in its host's units (the stage world, or the dock), wherever the camera is right now
function hostScale(host) { return host.getBoundingClientRect().width / host._w; }
function worldBox(el) {
  const host = el.closest('.world, .dock'), wr = host.getBoundingClientRect(), s = wr.width / host._w, r = el.getBoundingClientRect();
  return { x: (r.left - wr.left) / s, y: (r.top - wr.top) / s, w: r.width / s, h: r.height / s };
}

/* ================================================================================================ the faces */
const FACES = new Map();
// a real face, cached by key
function face(key, def, values, on, opts = {}) {
  let f = FACES.get(key);
  if (!f || f.def !== def) {
    f?.face.destroy?.();
    f = { def, face: renderFace(def, values, { on, size: opts.size || 'full', onParam: opts.onParam, onToggle: opts.onToggle }) };
    FACES.set(key, f);
  } else f.face.update(values, on);
  return f.face;
}
// the room's tuner pedal (not a Claw'd-o-Matic pedal, so it's drawn here)
function tunerFace(key) {
  const f = FACES.get(key);
  if (f) return f.face;
  const el = h('div.tuner',
    h('div.tn-win', h('div.tn-leds', Array.from({ length: 15 }, (_, i) => h('i' + (i === 7 ? '.mid' : '')))), h('div.tn-note', '–'), h('span.tn-str', ''), h('span.tn-cents', '')),
    h('div.tn-name', h('b', TUNER.name), h('small', TUNER.kindLabel)),
    h('div.tn-mute', h('i'), 'MUTE'),
    h('button.tn-sw', { type: 'button', 'aria-label': 'Tuna Fork tuner: stomp on or off', onclick: (e) => { e.stopPropagation(); tuner(); } }));
  const api = { el, update() {
    const t = S.tuner, on = t.on, tn = TUNINGS.find((x) => x.id === S.tuning);
    el.classList.toggle('on', on);
    const leds = el.querySelectorAll('.tn-leds i'), c = clamp(Math.round(t.cents / 6.5), -7, 7);
    leds.forEach((l, i) => l.classList.toggle('on', on && (i === 7 + c || (Math.abs(c) <= 0 && Math.abs(i - 7) <= 1))));
    const note = el.querySelector('.tn-note');
    note.textContent = on ? tn.notes[t.str] : '–';
    note.classList.toggle('in', on && Math.abs(t.cents) < 3);
    el.querySelector('.tn-str').textContent = on ? `STRING ${6 - t.str}` : '';
    el.querySelector('.tn-cents').textContent = on ? `${t.cents > 0 ? '+' : t.cents < -0.5 ? '−' : ''}${Math.abs(Math.round(t.cents))}¢` : '';
  } };
  FACES.set(key, { def: null, face: api });
  return api;
}

/* ================================================================================================ the rig */
// One builder for your stack wherever it stands (the stage, the shop's try-out corner): the head on its cab, the mics in
// front, the board along the front, and the cables between them. g: { cx, floor, headZ, cabZ, board: {x, y, w, h}, pedZ, keys }
function buildRig(host, key, g) {
  host.querySelectorAll('.rigpart').forEach((n) => n.remove());
  const out = { slots: [] };
  // the cab, standing on the floor
  const box = cabBox(S.cab.cab), cw = box.w * g.cabZ, ch = box.h * g.cabZ, cx = g.cx - cw / 2, cy = g.floor - ch;
  const cab = buildCab(S.cab.cab, cw, ch);
  place(cab, cx, cy, cw, ch); cab.classList.add('rigpart', 'zoomable');
  cab.addEventListener('click', (e) => { if (e.target.closest('.mic') && cab.classList.contains('open')) return; zoom(key === 'shop' ? 'tryout-cab' : 'cab'); });
  host.append(cab);
  out.cab = { x: cx, y: cy, w: cw, h: ch, el: cab };
  // the head, sat on top of it (the face's compact form is the head alone)
  const def = ampDef();
  const f = face(key + ':amp:' + S.amp, def, paramValues(def, S.ampParams), S.ampOn, { size: 'compact',
    onParam: (k, v, { commit }) => { S.ampParams[k] = v; if (commit) { changed(); say(`${sentence(def.params.find((p) => p.key === k)?.label || k)} ${fmt1(v)} on ${def.name}. This song’s copy; Save to rack keeps it.`); } },
    onToggle: (on) => { S.ampOn = on; say(on ? `${def.name} is back in.` : `${def.name} bypassed: you’re hearing the board and the cab.`); } });
  const head = h('div.head.rigpart.zoomable', { dataset: { amp: S.amp } });
  const wrap = h('div', { style: `width:420px;transform:scale(${g.headZ});transform-origin:0 0` }, f.el);
  head.append(wrap);
  host.append(head);
  const nh = f.el.offsetHeight || 128, hw = 420 * g.headZ, hh = nh * g.headZ;
  place(head, g.cx - hw / 2, cy - hh + 2, hw, hh);
  head.addEventListener('click', (e) => { if (e.target.closest('.kn, button, input, select')) return; zoom(key === 'shop' ? 'tryout-head' : 'head'); });
  out.head = { x: g.cx - hw / 2, y: cy - hh + 2, w: hw, h: hh, el: head, face: f };
  // its input, at the left end of the panel (the compact face has no jacks of its own)
  const hj = h('div.jack.rigpart' + (S.plugged ? '.lit' : ''));
  out.hin = { x: out.head.x + hw * 0.045, y: out.head.y + hh * 0.7 };
  place(hj, out.hin.x - 5, out.hin.y - 5); host.append(hj);
  // the input meter, on the head (stage only)
  if (key === 'stage') {
    const leds = h('span.leds', Array.from({ length: 24 }, (_, i) => { const db = -60 + i * 2.5; return h('i' + (db >= -12 && db < -6 ? '.win' : db >= -3 ? '.hot' : '')); }), h('span.win-mark', { style: `left:${(48 / 60) * 24 * 7}px;width:${2.4 * 7 - 2}px` }));
    const m = h('div.inmeter.rigpart', { id: 'inmeter' }, 'INPUT', leds, h('span.db', { id: 'indb' }, '–'));
    place(m, out.head.x + 14, out.head.y - 30);
    host.append(m);
    out.meter = m;
  }
  // mics, in front of the grille
  out.mics = [];
  [S.cab.mic, S.cab.mic2].filter(Boolean).forEach((m, i) => { const el = buildMic(m, i, out.cab, host); host.append(el); out.mics.push(el); });
  // the board
  const B = g.board;
  const board = h('div.board.rigpart' + (S.cam === 'board' && key === 'stage' ? '.editing' : ''), h('div.board-rail'));
  place(board, B.x, B.y, B.w, B.h);
  board.addEventListener('click', (e) => { if (key === 'stage' && (e.target === board || e.target.classList.contains('board-rail'))) zoom('board'); });
  host.append(board);
  out.board = { ...B, el: board };
  // pedals: measured at their natural size, then set down in signal order (the loop's after the amp), as big as the
  // board's height allows, and spread along it
  const items = S.board.map((b) => {
    const isT = b.device === 'tuner';
    const d = isT ? null : getDevice(b.device);
    const fc = isT ? tunerFace(key + ':tuner') : face(key + ':' + b.uid, d, paramValues(d, b.params), b.on, {
      onParam: (k, v, { commit }) => { b.params[k] = v; if (commit) { changed(); say(`${d.name}: ${(d.params.find((p) => p.key === k)?.label || k).toLowerCase()} ${fmt1(v)}. This song’s copy.`); } },
      onToggle: () => stompUid(b.uid) });
    return { b, d, fc, isT };
  });
  const tmp = h('div', { style: 'position:absolute;left:-9999px;top:0;visibility:hidden' });
  host.append(tmp);
  for (const it of items) { tmp.append(it.fc.el); it.nw = it.fc.el.offsetWidth || 120; it.nh = it.fc.el.offsetHeight || 182; }
  const inner = B.h - 34, addW = key === 'shop' ? 96 : 120, hasLoop = items.some((it) => it.d && inLoop(it.d)), loopGap = hasLoop ? 40 : 0;
  const widthAt = (zz) => items.reduce((a, it) => a + it.nw * Math.min(zz, (inner - 6) / it.nh), 0);
  const fixed = 24 * 2 + loopGap + addW + 16;
  let z = g.pedZ, gap = 18;
  while (widthAt(z) + gap * items.length + fixed > B.w && z > 0.3) z -= 0.02;
  gap = Math.min(gap + (B.w - (widthAt(z) + gap * items.length + fixed)) / (items.length + 1), 72);
  let x = B.x + 24 + gap / 2, n = 0, loopAt = null;
  items.forEach((it) => {
    if (it.d && inLoop(it.d) && loopAt == null) { loopAt = x - gap / 2 + 6; x += loopGap; }
    const zz = Math.min(z, (inner - 6) / it.nh), w = it.nw * zz, hh2 = it.nh * zz;
    const y = B.y + B.h - 26 - hh2;
    if (!it.isT) n++;
    const k = it.isT ? 'T' : String(n);
    const slot = h('div.slot.rigpart' + (it.b.on || it.isT ? '' : '.off'), { dataset: { uid: it.b.uid } },
      h('div.face', { style: `transform:scale(${zz})` }, it.fc.el),
      g.keys ? h('span.keycap', { style: `top:${hh2 + 6}px` }, k, h('b', (it.isT ? S.tuner.on : it.b.on) ? 'on' : 'off')) : null,
      it.isT ? null : h('button.rm', { type: 'button', title: `Take ${it.d.name} off the board`, 'aria-label': `Take ${it.d.name} off the board`, onclick: (e) => { e.stopPropagation(); removePedal(it.b.uid); } }, '×'));
    place(slot, x, y, w, hh2);
    slot.addEventListener('click', (e) => { if (e.target.closest('.kn, button, input, select, .pd-sw')) return; if (key === 'stage' && S.cam === 'stage') zoom(it.isT ? 'tuner' : 'board'); });
    host.append(slot);
    out.slots.push({ uid: it.b.uid, x, y, w, h: hh2, el: slot, b: it.b, d: it.d });
    // its hang tag, shown when you're close to the board
    if (key === 'stage') {
      const t = it.isT
        ? h('div.btag.rigpart', h('small', 'Tuner · mutes while on'), h('b', TUNER.name), h('div', TUNER.blurb + '.'), h('div.nod', `Tips its hat to ${TUNER.nod}.`),
          h('div.mv', h('button', { type: 'button', onclick: () => zoom('tuner') }, 'Tunings'), h('span.fix', 'Always first')))
        : h('div.btag.rigpart', h('small', `${typeWord(it.d)} · ${CAT_WORD[it.d.pedalCat] || ''}`), h('b', it.d.name), h('div', it.d.blurb), h('div.nod', `Tips its hat to ${it.d.nod}.`),
          h('div.mv', h('button', { type: 'button', 'aria-label': `Move ${it.d.name} earlier`, onclick: () => movePedal(it.b.uid, -1) }, '←'), h('button', { type: 'button', 'aria-label': `Move ${it.d.name} later`, onclick: () => movePedal(it.b.uid, 1) }, '→'), h('button', { type: 'button', onclick: () => removePedal(it.b.uid) }, 'Back in the case')));
      t.dataset.cx = x + w / 2;
      host.append(t);
    }
    x += w + gap;
  });
  tmp.remove();
  let right = -1e9;
  out.tagTop = 1e9;
  const tagBase = Math.min(...out.slots.map((q) => q.y)) - 14;
  for (const t of host.querySelectorAll('.btag')) { const tw = 164, tx = Math.max(+t.dataset.cx - tw / 2, right + 8); place(t, tx, 0, tw); const th = t.offsetHeight || 150; t.style.top = tagBase - th + 'px'; out.tagTop = Math.min(out.tagTop, tagBase - th); right = tx + tw; }
  if (loopAt != null) { const lm = h('div.loop-mark.rigpart', h('span', 'AMP’S LOOP')); place(lm, loopAt, B.y, null, B.h); host.append(lm); }
  const addH = Math.min(150, inner - 10);
  const add = h('button.addslot.rigpart', { type: 'button', onclick: () => (key === 'shop' ? turn('case') : enterShop('case')) }, h('b', '+ Pedal'), h('small', key === 'shop' ? 'from the case' : 'from the shop'));
  const ax = Math.min(x + 6, B.x + B.w - addW - 16);
  place(add, ax, B.y + B.h - 26 - addH, addW, addH);
  host.append(add);
  out.add = { x: ax, y: B.y + B.h - 26 - addH, w: addW, h: addH, el: add };
  // the jack the guitar goes into (the first pedal's input): lit once the plug's all the way in
  const first = out.slots[0];
  if (first) {
    const lit = S.plugged && S.plugT >= 1;
    const j = h('div.jack.rigpart' + (lit ? '.lit' : '') + (lit && S.ring ? '.ring' : ''), { id: key + '-jack' });
    place(j, first.x - 7, first.y + first.h * 0.32); host.append(j);
    out.jack = { x: first.x - 2, y: first.y + first.h * 0.32 + 5 };
  }
  return out;
}
function buildCab(id, w, hh) {
  const c = CABS[id] || CABS.v412;
  const el = h('div.cab' + (c.odd ? '.odd-' + c.odd : ''), { dataset: { cab: id } });
  const gr = h('div.cab-gr'), cones = h('div.cab-cones');
  // the speakers, in the box's grid
  const n = c.n || 1, cols = n >= 8 ? 2 : n === 4 ? 2 : n === 2 ? 2 : 1, rows = Math.ceil(n / cols);
  const gw = w - 40, gh = hh - 52;
  const r = Math.min(gw / cols, gh / rows) * 0.44;
  const coneList = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const ccx = (gw / cols) * (col + 0.5), ccy = (gh / rows) * (row + 0.5);
    const cone = h('div.cone');
    place(cone, ccx - r, ccy - r, r * 2, r * 2);
    cones.append(cone);
    coneList.push({ x: 20 + ccx, y: 22 + ccy, r });
  }
  gr.append(cones, h('div.cab-cloth'));
  append(el, [gr, h('span.cab-logo', c.odd === 'fridge' ? 'Coldspot' : c.odd === 'box' ? 'THIS SIDE UP' : 'CLAWD-O-TONE'), h('span.cab-name', c.name),
    c.odd ? null : ['tl', 'tr', 'bl', 'br'].map((k) => h('i.cab-corner.' + k)), c.odd ? null : [h('i.cab-caster', { style: 'left:26px' }), h('i.cab-caster', { style: 'right:26px' })]]);
  el._cones = coneList;
  if (S.cam === 'cab' || S.cam === 'tryout-cab') el.classList.add('open');
  return el;
}
// a mic in front of the grille: its place on its cone from pos (cone radii from the dust cap) and an angle
function buildMic(m, i, cab, host) {
  const el = h('div.mic.rigpart.t-' + m.type + (i ? '.m2' : ''), { dataset: { i } },
    h('i.mic-stand'),
    h('i.mic-body', { title: `${MICS[m.type].name}: drag it across the cone` }),
    h('span.mic-tag', micTag(m, i)));
  el._sc = clamp(1.25 - Math.log2(m.dist + 1) * 0.12, 0.7, 1.2) * Math.min(1, cab.w / 400);
  el.style.transform = `scale(${el._sc})`;
  positionMic(el, m, cab);
  // drag (only when you're close to the cab)
  el.querySelector('.mic-body').addEventListener('pointerdown', (e) => {
    if (!cab.el.classList.contains('open')) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.add('dragging');
    const body = e.currentTarget; body.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const wb = host.getBoundingClientRect(), s = hostScale(host);
      const wx = (ev.clientX - wb.left) / s, wy = (ev.clientY - wb.top) / s;
      // the nearest cone, and where on it
      let best = null;
      cab.el._cones.forEach((c, ci) => { const dx = wx - (cab.x + c.x), dy = wy - (cab.y + c.y), d = Math.hypot(dx, dy); if (!best || d < best.d) best = { ci, dx, dy, d, r: c.r }; });
      m.cone = best.ci; m.pos = Math.round(clamp(best.d / best.r, 0, 1.35) * 100) / 100; m._ang = Math.atan2(best.dy, best.dx);
      positionMic(el, m, cab);
      el.querySelector('.mic-tag').textContent = micTag(m, i);
      cab.el.querySelectorAll('.cone').forEach((c, ci) => c.classList.toggle('hot', ci === m.cone));
      const o = $('mic' + i + 'where'); if (o) { o.textContent = sentence(onCone(m.pos)); o.nextSibling.textContent = m.pos.toFixed(2); }
      drawSide();
    };
    const up = () => { el.classList.remove('dragging'); body.removeEventListener('pointermove', move); body.removeEventListener('pointerup', up); changed(); say(`${MICS[m.type].name} ${onCone(m.pos)}, ${inches(m.dist)} back. ${m.pos < 0.4 ? 'Brighter' : m.pos > 0.82 ? 'Darker' : 'Rounder'}; this song’s copy.`); };
    body.addEventListener('pointermove', move); body.addEventListener('pointerup', up);
  });
  return el;
}
const micTag = (m, i) => `${i ? 'Mic 2: ' : ''}${MICS[m.type].name}, ${whereOnCone(m.pos)}, ${inches(m.dist)}`;
function positionMic(el, m, cab) {
  const c = cab.el._cones[Math.min(cab.el._cones.length - 1, m.cone || 0)], ang = m._ang ?? 0, r = m.pos * c.r;
  const x = cab.x + c.x + Math.cos(ang) * r, y = cab.y + c.y + Math.sin(ang) * r;
  place(el, x, y);
  el.querySelector('.mic-stand').style.height = (cab.y + cab.h - y + 6) / (el._sc || 1) + 'px';
}

function svgLayer(id) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'cables'); s.id = id; return s; }
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

// the cables: the guitar into the first pedal (a real plug on its end), pedal to pedal, up the cab's side to the head's
// input, and the amp's loop
function drawCables(svg, rig, worldW) {
  if (!svg || !rig) return;
  const ns = 'http://www.w3.org/2000/svg';
  const X = -480, Y = -120, Wd = worldW + 960, Hd = 804 + 240;
  svg.setAttribute('viewBox', `${X} ${Y} ${Wd} ${Hd}`);
  place(svg, X, Y, Wd, Hd);
  svg.replaceChildren();
  const el = (tag, at) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); svg.append(e); return e; };
  const path = (d, lit) => { for (const [w, c] of [[8, '#050506'], [4, lit ? '#6a5a3a' : '#26262c']]) el('path', { d, fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round' }); };
  const slots = rig.slots, pre = slots.filter((s) => !s.d || !inLoop(s.d)), post = slots.filter((s) => s.d && inLoop(s.d));
  const sideY = (s) => s.y + s.h * 0.32 + 5;
  // the guitar: from off the stage to a plug in the first pedal's input; or the plug lying on the floor
  if (slots[0]) {
    const j = rig.jack, bb = rig.board.y + rig.board.h;
    const X0c = Math.max(X, rig.board.x - 300);
    if (S.plugged) {
      const px = j.x - 2 - 120 * (1 - ease(S.plugT)), py = j.y;
      path(`M ${X0c} ${bb + 30} C ${px - 240} ${bb + 10}, ${px - 110} ${py + 30}, ${px - 50} ${py}`, S.gs?.step === 'plug');
      plug(px, py, S.plugT < 1);
    } else {
      path(`M ${X0c} ${bb + 30} C ${X0c + 200} ${bb + 20}, ${j.x - 160} ${bb + 4}, ${j.x - 100} ${bb - 12}`, true);
      plug(j.x - 60, bb - 12, true);
    }
  }
  function plug(px, py, tip) {
    // a quarter-inch plug: its barrel, the collar, and (until it's in) the tip
    el('path', { d: `M ${px - 52} ${py - 4} L ${px - 36} ${py - 6} L ${px - 36} ${py + 6} L ${px - 52} ${py + 4} Z`, fill: '#141418', stroke: '#050506', 'stroke-width': 1.5 });
    el('rect', { x: px - 37, y: py - 7.5, width: 28, height: 15, rx: 3, fill: '#c4c4cc', stroke: '#050506', 'stroke-width': 1.5 });
    el('rect', { x: px - 35, y: py - 5.5, width: 24, height: 2.5, rx: 1, fill: '#f0f0f4' });
    el('rect', { x: px - 10, y: py - 5, width: 9, height: 10, fill: '#8a8a92', stroke: '#050506', 'stroke-width': 1 });
    if (tip) { el('rect', { x: px - 1, y: py - 2.5, width: 12, height: 5, fill: '#d8d2c0' }); el('rect', { x: px + 8, y: py - 3, width: 4, height: 6, rx: 2, fill: '#e8e0cc' }); }
  }
  for (let i = 0; i + 1 < pre.length; i++) { const a = pre[i], b = pre[i + 1], ya = sideY(a), yb = sideY(b); path(`M ${a.x + a.w + 2} ${ya} C ${a.x + a.w + 14} ${ya - 26}, ${b.x - 12} ${yb - 26}, ${b.x - 2} ${yb}`); }
  // the last pre-amp pedal up the cab's left side to the head's input
  const head = rig.head, cab = rig.cab, last = pre[pre.length - 1];
  const hin = rig.hin, lx = Math.min(cab.x, head.x) - 14;
  if (last) { const ya = sideY(last); path(`M ${last.x + last.w + 2} ${ya} C ${last.x + last.w + 30} ${ya - 60}, ${lx - 12} ${cab.y + cab.h + 20}, ${lx} ${cab.y + cab.h - 40} L ${lx} ${hin.y + 40} C ${lx} ${hin.y + 10}, ${hin.x - 20} ${hin.y}, ${hin.x - 2} ${hin.y}`); }
  // the loop: out of the head's back, down the cab's right side, through the loop pedals, and back
  if (post.length) {
    const sx = head.x + head.w - 6, sy = head.y + head.h * 0.5, f = post[0], l = post[post.length - 1];
    path(`M ${sx} ${sy} C ${cab.x + cab.w + 18} ${sy}, ${cab.x + cab.w + 14} ${sy + 30}, ${cab.x + cab.w + 14} ${sy + 60} L ${cab.x + cab.w + 14} ${cab.y + cab.h - 30} C ${cab.x + cab.w + 14} ${cab.y + cab.h + 30}, ${f.x - 40} ${sideY(f)}, ${f.x - 2} ${sideY(f)}`);
    for (let i = 0; i + 1 < post.length; i++) { const a = post[i], b = post[i + 1], ya = sideY(a), yb = sideY(b); path(`M ${a.x + a.w + 2} ${ya} C ${a.x + a.w + 14} ${ya - 26}, ${b.x - 12} ${yb - 26}, ${b.x - 2} ${yb}`); }
    path(`M ${l.x + l.w + 2} ${sideY(l)} C ${l.x + l.w + 40} ${sideY(l) - 90}, ${cab.x + cab.w + 26} ${cab.y + cab.h}, ${cab.x + cab.w + 24} ${cab.y + cab.h - 40} L ${cab.x + cab.w + 24} ${sy + 50} C ${cab.x + cab.w + 24} ${sy + 14}, ${sx + 10} ${sy + 10}, ${sx - 4} ${sy + 10}`);
  }
}

/* ================================================================================================ the stage */
// world units: the stack stands at the left; the board runs the stage's width along the front
const ST = { cx: 308, floor: 540, headZ: 1.18, cabZ: 1, pedZ: 1.14, board: { x: 16, y: 556, w: 1408, h: 248 } };
let stageRig = null, gBg = null, gLive = null, gKit = null;
function buildStage() {
  const el = $('stage');
  el.replaceChildren();
  place(el, 0, 0, STAGE.w, STAGE.h); el._w = STAGE.w;
  const bg = h('canvas.bg'), live = h('canvas.live'), kitcv = h('canvas.kitcv');
  el.append(bg, live, kitcv);
  gBg = sizeRoom(bg, STAGE.w, STAGE.h); gLive = sizeRoom(live, STAGE.w, STAGE.h);
  gKit = sizePlain(kitcv, KIT.w * KIT.px, KIT.h * KIT.px, KIT.px); place(kitcv, KIT.x, KIT.y);
  drawStage(gBg, { doorHover: false });
  el.append(svgLayer('cables'));
  // the hotspots: the kit (the drummer's book), the tape machine, the door
  const P = (v) => v * PX;
  const kitHot = h('button.hot.zoomable', { type: 'button', 'aria-label': 'The kit: open the drummer’s book (K)', dataset: { say: 'The drummer’s book  K' }, onclick: () => zoom('kit') });
  place(kitHot, 584, 188, 520, 270); el.append(kitHot);
  const tapeHot = h('button.hot.zoomable', { type: 'button', 'aria-label': 'The tape machine: the last minute (G)', dataset: { say: 'The last minute of tape  G' }, onclick: () => openTape() });
  place(tapeHot, P(STAGE.tape.x) - 6, P(STAGE.tape.y) - 6, P(STAGE.tape.w) + 12, 180); el.append(tapeHot);
  const D = STAGE.door;
  const doorHot = h('button.hot', { type: 'button', 'aria-label': 'The door to the shop (S)', dataset: { say: 'The shop  S' }, onclick: () => enterShop('wall'),
    onmouseenter: () => drawStage(gBg, { doorHover: true }), onmouseleave: () => drawStage(gBg, { doorHover: false }) });
  place(doorHot, P(D.x), P(D.y) - 72, P(D.w), P(D.h) + 72); el.append(doorHot);
  // the riser's front: the transport, the pinned beats, and the book's ribbon
  const R = STAGE.riser;
  const tp = h('div.transport', { id: 'transport', style: '--w:176px' },
    h('button.tp-go', { type: 'button', onclick: () => drummer() }, h('i'), 'DRUMMER', kbd('Space')),
    h('span.tp-tempo', h('button', { type: 'button', 'aria-label': 'Slower', onclick: () => tempo(-1) }, '←'), h('b', { id: 'tpbpm' }, String(S.tempo)), h('button', { type: 'button', 'aria-label': 'Faster', onclick: () => tempo(1) }, '→'), h('small', 'BPM'), h('span.tp-bar', { id: 'tpbar' }, 'BAR –')),
    h('span.tp-beat', { id: 'tpbeat' }, ''));
  place(tp, P(R.x) + 8, P(R.y) + 8, 176, 84);
  el.append(tp);
  el.append(h('div', { id: 'cards' }));
  const bm = h('button.bookmark', { type: 'button', onclick: () => zoom('kit') }, 'The book  ', kbd('K'));
  place(bm, P(R.x + R.w) - 100, P(R.y) - 28);
  el.append(bm);
  renderStageRig();
  renderCards();
}
function renderStageRig() {
  const el = $('stage');
  stageRig = buildRig(el, 'stage', { ...ST, keys: true });
  drawCables(el.querySelector('#cables'), stageRig, STAGE.w);
  if (S.cam === 'cab') stageRig.cab.el.classList.add('open');
}
function renderCards() {
  const el = $('cards'), R = STAGE.riser, x0 = R.x * PX + 192, y0 = R.y * PX + 8, cw = 60, gap = 6;
  if (!el) return;
  fill(el, S.pins.slice(0, 5).map((p, i) => {
    const g = p.grid;
    const b = h('button.bcard' + (S.drummer.next === i ? '.next' : ''), { type: 'button', 'aria-pressed': String(S.drummer.pin === i), title: (LIB.byId.get(p.id) || GUIDE).name + (p.edited ? ' (edited)' : ''), onclick: () => setPin(i) },
      h('span.mini', ['top', 'snare', 'kick'].map((r) => g[r].map((v) => h('i' + (v ? '.h' + v : ''))))),
      h('b', p.short), h('small', p.edited ? 'edited' : p.id === GUIDE.id ? 'house' : (LIB.byId.get(p.id)?.part || '')));
    place(b, x0 + i * (cw + gap), y0, cw, 84);
    return b;
  }));
}

/* ================================================================================================ the shop */
// The shop's walls pan behind the dock: your stack in the try-out corner at the right, your board along the front, at
// stage size. The dock is measured from the view (dock units: the view at k px per unit, 802 units tall).
const CORNER_W = 500, BOARD_H = 204;
function dockGeo() {
  const { w, h: hh } = vsize(), k = clamp(hh / 802, 0.8, 1.3), dw = w / k, dh = hh / k;
  const board = { x: 12, y: dh - BOARD_H - 4, w: dw - 24, h: BOARD_H };
  return { k, dw, dh, cornerX: dw - CORNER_W, board, boardY: board.y, cx: dw - CORNER_W / 2 + 4, floor: board.y - 14, headZ: 1.1, cabZ: 0.9, pedZ: 0.9 };
}
let shopRig = null, gShop = null, gDock = null, shopLayout = null, DG = null;
function buildShop() {
  const el = $('shop');
  el.replaceChildren();
  place(el, 0, 0, SHOP.w, SHOP.h); el._w = SHOP.w;
  const bg = h('canvas.bg');
  el.append(bg);
  gShop = sizeRoom(bg, SHOP.w, SHOP.h);
  shopLayout = { amps: [], pedals: [], plates: [], signs: [], shelves: [], shelvesIn: [] };
  // the amp wall: two bands of sections, each with its sign and shelves, every amp with its name plate
  const secs = ampsBySection(), by = Object.fromEntries(secs.map((s) => [s.tone, s]));
  const colW = 108, x0 = SHOP.wall.x, bands = [{ y: 14, secs: [['clean', 3], ['crunch', 2], ['weird', 3]] }, { y: 304, secs: [['high', 5], ['bass', 3]] }];
  for (const band of bands) {
    let col = 0;
    for (const [tone, cols] of band.secs) {
      const sec = by[tone], sx = x0 + col * colW, sw = cols * colW;
      shopLayout.signs.push({ label: sec.label, x: sx + 4, y: band.y, w: sw - 8 });
      for (let r = 0; r < 2; r++) shopLayout.shelves.push({ x: sx + 2, y: band.y + 62 + r * 116 + 68, w: sw - 4 });
      sec.amps.forEach((d, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const slot = ampSlot(d, sec);
        place(slot, sx + c * colW + 3, band.y + 62 + r * 116, colW - 6, 104);
        el.append(slot);
        shopLayout.amps.push(slot);
      });
      col += cols;
    }
  }
  for (const s of shopLayout.amps) { const e = s.querySelector('.ewf'), hh = e.offsetHeight; if (hh > 62) e.style.transform = `scale(${62 / hh})`; }
  // the door back to the stage
  const D = SHOP.door;
  const door = h('button.hot.below', { type: 'button', 'aria-label': 'The door back to the stage (Esc)', dataset: { say: 'Back to the stage  Esc' }, onclick: () => leaveShop() });
  place(door, D.x, D.y, D.w, D.h); el.append(door);
  // the case: a column of drawer plates (the categories), and the chosen one's pedals on the shelves beside it
  const C = SHOP.case;
  pedalsByCat().forEach((cat, i) => {
    const pl = h('button.plate-cat', { type: 'button', dataset: { cat: cat.cat }, 'aria-pressed': String(cat.cat === S.caseCat), onclick: () => showCat(cat.cat) }, h('span', cat.word), h('small', String(cat.pedals.length)));
    place(pl, C.x + 10, C.y + 14 + i * 48, 156, 40);
    el.append(pl);
    shopLayout.plates.push(pl);
  });
  renderCase();
  buildDock();
}
// the case's shelves: one category at a time, each pedal at about twice the size it was, with its name plate and type
function renderCase() {
  const el = $('shop'), C = SHOP.case, cat = pedalsByCat().find((c) => c.cat === S.caseCat);
  el.querySelectorAll('.ped-slot, .case-head').forEach((n) => n.remove());
  shopLayout.pedals = [];
  shopLayout.plates.forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.cat === S.caseCat)));
  const x0 = C.x + 186, w = C.x + C.w - 10 - x0, top = C.y + 86, availH = C.y + C.h - 12 - top;
  const head = h('div.case-head', h('h3.disp', cat.word), h('span', `${cat.pedals.length} pedal${cat.pedals.length === 1 ? '' : 's'}. ${cat.line}`));
  place(head, x0 + 8, C.y + 12, w - 16); el.append(head);
  const cols = cat.pedals.length > 15 ? 6 : 5, rows = Math.max(1, Math.ceil(cat.pedals.length / cols)), cw = w / cols, chh = Math.min(rows === 1 ? 250 : 176, availH / rows), fh = chh - 64, fw = cw - 22;
  const tmp = h('div', { style: 'position:absolute;left:-9999px;top:0;visibility:hidden' });
  el.append(tmp);
  shopLayout.shelvesIn = [];
  for (let r = 0; r < rows; r++) shopLayout.shelvesIn.push({ y: top + r * chh + fh + 4 });
  cat.pedals.forEach((d, i) => {
    const f = renderFace(d, paramValues(d, {}), { size: 'full', on: true });
    tmp.append(f.el);
    const nw = f.el.offsetWidth || 132, nh = f.el.offsetHeight || 196, z = Math.min(fw / nw, fh / nh, 0.85);
    const slot = h('button.ped-slot', { type: 'button', dataset: { id: d.id }, 'aria-label': `${d.name}, ${typeWord(d).toLowerCase()}: ${d.blurb}` },
      h('span.pbox', { style: `height:${fh}px` }, h('span.face', { style: `width:${nw * z}px;height:${nh * z}px` }, h('span', { style: `display:block;transform:scale(${z});transform-origin:0 0;width:${nw}px` }, f.el))),
      h('span.pname', d.name), h('span.ptype', typeWord(d)));
    const c = i % cols, r = Math.floor(i / cols);
    place(slot, x0 + c * cw + 3, top + r * chh, cw - 6, chh - 4);
    wireLook(slot, () => ({ kind: 'pedal', d }));
    slot.addEventListener('click', () => { if (S.cam !== 'case') return turn('case'); takePedal(d.id, slot); });
    el.append(slot);
    shopLayout.pedals.push(slot);
  });
  tmp.remove();
  markTaken();
  drawShop(gShop, shopLayout);
}
function showCat(cat, focus = false) {
  if (S.cam !== 'case') turn('case');
  if (cat === S.caseCat) return;
  S.caseCat = cat; renderCase();
  if (focus) shopLayout.plates.find((p) => p.dataset.cat === cat)?.focus();
}
function ampSlot(d, sec) {
  const am = h('span.am', { style: `width:${d.amp === 'di' ? 64 : 80}px` }, h('i.am-top', h('i.am-pn', h('i'), h('i'), h('i'), h('i'), h('i.am-jw'))), h('i.am-cab', h('i.am-gr', h('i.am-face', h('i'), h('i')), h('i.am-lgw', h('b.am-lg', d.name)))));
  LOOKS.ampPaint(am, ampLookId(d));
  am.setAttribute('aria-hidden', 'true');
  const slot = h('button.amp-slot', { type: 'button', dataset: { id: d.id }, 'aria-label': `${d.name}, ${sec.word.toLowerCase()} amp: ${d.blurb}` }, h('span.ampbox', h('span.ewf', am)), h('span.plate', d.name));
  wireLook(slot, () => ({ kind: 'amp', d, sec }));
  slot.addEventListener('click', () => { if (S.cam !== 'wall') return turn('wall'); takeAmp(d.id, slot); });
  return slot;
}
// the dock: the corner's backdrop, your stack and your board, measured to the view
function buildDock() {
  const dk = $('dock');
  DG = dockGeo();
  dk.replaceChildren();
  place(dk, 0, 0, DG.dw, DG.dh); dk._w = DG.dw;
  const bg = h('canvas.dockbg');
  dk.append(bg);
  gDock = sizePlain(bg, DG.dw, DG.dh);
  drawDock(gDock, DG);
  dk.append(svgLayer('shopcables'));
  renderShopRig();
}
function renderShopRig() {
  const dk = $('dock');
  shopRig = buildRig(dk, 'shop', { ...DG, keys: true });
  drawCables(dk.querySelector('#shopcables'), shopRig, DG.dw);
  if (S.cam === 'tryout-cab') shopRig.cab.el.classList.add('open');
  markTaken();
}
function markTaken() {
  if (!shopLayout) return;
  for (const s of shopLayout.amps) s.classList.toggle('taken', s.dataset.id === S.amp);
  const on = new Set(pedalsOnly().map((b) => b.device));
  for (const s of shopLayout.pedals) s.classList.toggle('taken', on.has(s.dataset.id));
}
// looking at a thing: its card while it's hovered or focused
function wireLook(slot, info) {
  const on = () => { S.look = { el: slot, ...info() }; slot.classList.add('look'); showCard(); };
  const off = () => { slot.classList.remove('look'); if (S.look?.el === slot) { S.look = null; showCard(); } };
  slot.addEventListener('mouseenter', on); slot.addEventListener('focus', on);
  slot.addEventListener('mouseleave', off); slot.addEventListener('blur', off);
}
function showCard() {
  const card = $('idcard');
  const L = S.look;
  if (!L || !L.el.isConnected) { card.classList.remove('on'); return; }
  const d = L.d;
  if (L.kind === 'amp') {
    const mine = d.id === S.amp;
    card.className = 'idcard';
    fill(card, h('div.in', h('span.sec', L.sec.label), h('h3.disp', d.name), h('p', d.blurb), h('p.nod', `In the spirit of ${d.nod}.`),
      h('div.do', mine ? 'On your stack now.' : ['Click or ', kbd('Enter'), ' to carry it to your stack and play through it'])));
  } else {
    const mine = pedalsOnly().some((b) => b.device === d.id);
    card.className = 'idcard tag';
    fill(card, h('div.in', h('span.sec', `${CAT_WORD[d.pedalCat] || d.pedalCat} · ${typeWord(d)}`), h('h3.disp', d.name), h('p', d.blurb), h('p.nod', `Tips its hat to ${d.nod}.`),
      h('div.do', mine ? ['On your board. ', kbd('Enter'), ' puts it back in the case'] : ['Click or ', kbd('Enter'), ` to put it on your board${inLoop(d) ? ', in the amp’s loop' : ', before the amp'}`])));
  }
  const r = L.el.getBoundingClientRect(), vr = view.getBoundingClientRect();
  const cw = 300, chh = card.offsetHeight || 190, limit = S.place === 'shop' ? DG.cornerX * DG.k : vr.width;
  let x = r.right - vr.left + 12, y = r.top - vr.top - 8;
  if (x + cw > limit - 8) x = r.left - vr.left - cw - 12;
  y = clamp(y, 10, vr.height - chh - 10);
  place(card, x, y);
  card.classList.add('on');
}
// carrying something from the shop into your rig: a ghost flies from where it was to where it goes
function carry(fromEl, toEl, then) {
  const r = fromEl.getBoundingClientRect(), t = toEl.getBoundingClientRect();
  const g = fromEl.cloneNode(true);
  g.classList.add('ghost'); g.classList.remove('look', 'taken');
  Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0 });
  document.body.append(g);
  const sx = Math.min(2, (t.width / r.width) * 0.7), tx = t.left + t.width * 0.15 - r.left, ty = t.top + t.height * 0.1 - r.top;
  requestAnimationFrame(() => requestAnimationFrame(() => { g.style.transform = `translate(${tx}px, ${ty}px) scale(${sx})`; g.style.opacity = '0.25'; }));
  setTimeout(() => { g.remove(); then(); }, REDUCED ? 10 : 560);
}
function takeAmp(id, slot) {
  if (id === S.amp) { say(`${getDevice(id).name} is already on your stack.`); return; }
  const was = ampDef();
  carry(slot.querySelector('.am') || slot, shopRig.head.el, () => {
    S.amp = id; S.ampParams = {}; S.ampOn = true; changed();
    renderShopRig(); flash(shopRig.head.el);
    const d = ampDef();
    say(`${d.name} is on your ${cabName()}: you’re playing through it. ${was.name}’s back on the wall, under ${toneWord(was.tone || 'high')}.`);
    S.look && showCard();
  });
}
function takePedal(id, slot) {
  const at = S.board.findIndex((b) => b.device === id);
  const d = getDevice(id);
  if (at >= 0) { removePedal(S.board[at].uid); return; }
  if (pedalsOnly().length >= 8) { say('Eight pedals is a full board. Put one back first.'); return; }
  carry(slot.querySelector('.face') || slot, shopRig.add.el, () => {
    const b = { device: id, on: true, uid: uid(), params: {} };
    // in signal order: after the last pedal of its rank or lower (Claw'd-o-Matic's rule)
    const r = RANK[d.pedalCat] ?? 3;
    let i = 1;
    S.board.forEach((x, k) => { if (x.device === 'tuner') return; if ((RANK[getDevice(x.device)?.pedalCat] ?? 3) <= r) i = k + 1; });
    S.board.splice(i, 0, b);
    changed();
    renderShopRig();
    const s = shopRig.slots.find((x) => x.uid === b.uid); s && flash(s.el);
    const pos = pedalsOnly().findIndex((x) => x.uid === b.uid) + 1;
    say(`${d.name} is on your board, ${ordinal(pos)}${inLoop(d) ? ', in the amp’s loop' : ', before the amp'}. You’re playing through it.`);
    S.look && showCard();
  });
}
const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][n - 1] || n + 'th';
function flash(el) { el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); }
function removePedal(u) {
  const i = S.board.findIndex((b) => b.uid === u);
  if (i < 0) return;
  const d = getDevice(S.board[i].device);
  S.board.splice(i, 1); changed();
  rebuildRigs();
  say(`${d.name} is back in the case, under ${CAT_WORD[d.pedalCat]}.`);
  S.look && showCard();
}
function movePedal(u, dir) {
  const i = S.board.findIndex((b) => b.uid === u), j = i + dir;
  if (i < 0 || j < 1 || j >= S.board.length) return;
  [S.board[i], S.board[j]] = [S.board[j], S.board[i]];
  changed(); rebuildRigs();
  const d = getDevice(S.board[j].device);
  say(`${d.name} moved ${dir < 0 ? 'earlier' : 'later'} in the chain.`);
}
function rebuildRigs() {
  // a rebuild keeps the knob your hand is on: stomping 3 mid-turn doesn't drop the gain knob's focus
  const lab = document.activeElement?.getAttribute?.('aria-label');
  if (S.place === 'stage') { renderStageRig(); if (S.cam !== 'stage' && S.cam !== 'gs') zoom(S.cam, false); }
  else renderShopRig();
  if (lab) [...document.querySelectorAll('[role=slider]')].find((n) => n.getAttribute('aria-label') === lab)?.focus({ preventScroll: true });
}

/* ================================================================================================ moving about */
const bookW = () => Math.round(clamp(vsize().w * 0.54, 600, 820));
const tunerSlot = () => stageRig.slots.find((q) => q.b.device === 'tuner');
const pad = (b, l, t, r, bt) => ({ x: b.x - l, y: b.y - t, w: b.w + l + r, h: b.h + t + bt });
const ZOOMS = {
  head: () => ({ R: { x: stageRig.head.x - 30, y: stageRig.head.y - 46, w: stageRig.head.w + 60, h: stageRig.head.h + 46 + 230 }, right: 340 }),
  cab: () => ({ R: pad(stageRig.cab, 60, 30, 60, 26), right: 420 }),
  kit: () => ({ R: { x: 556, y: 176, w: 560, h: 386 }, right: bookW() + 28, pad: 14 }),
  board: () => { const s = stageRig.slots, x = Math.min(...s.map((q) => q.x)) - 30, x2 = stageRig.add.x + stageRig.add.w + 24, y = stageRig.tagTop - 14; return { R: { x, y, w: x2 - x, h: 804 - y }, pad: 12, ay: 1 }; },
  tuner: () => ({ R: pad(tunerSlot(), 50, 40, 50, 40), right: 380, left: S.gs ? 400 : 0 }),
  tape: () => ({ R: { x: STAGE.tape.x * PX - 14, y: STAGE.tape.y * PX - 12, w: STAGE.tape.w * PX + 28, h: 196 }, bottom: tapeH() + 16, pad: 18 }),
  'tryout-head': () => ({ R: { x: shopRig.head.x - 24, y: shopRig.head.y - 30, w: shopRig.head.w + 48, h: shopRig.head.h + 30 + 200 }, right: 340 }),
  'tryout-cab': () => ({ R: pad(shopRig.cab, 40, 24, 40, 24), right: 420 }),
};
const tapeH = () => Math.round(vsize().h * 0.42);
const SHOP_CAMS = ['wall', 'case', 'tryout-head', 'tryout-cab'];
// the shop's walls framed into what the dock leaves: left of the corner, above the board
function shopFrame(area) {
  const k = DG.k, right = CORNER_W * k, bottom = (DG.dh - DG.board.y + 8) * k;
  const R = area === 'case' ? { x: SHOP.case.x - 14, y: SHOP.case.y - 10, w: SHOP.case.w + 28, h: SHOP.case.h + 20 } : { x: 8, y: 6, w: SHOP.wall.x + SHOP.wall.w - 4, h: 582 };
  return frameRect(R, { right, bottom, pad: 14, ax: area === 'case' ? 0 : 1 });
}
function zoom(to, glide = true) {
  if (S.place === 'stage' && SHOP_CAMS.includes(to)) return;
  if (S.place === 'shop' && !SHOP_CAMS.includes(to)) return;
  if (S.gs && to !== 'tuner') pauseGS(true);
  S.cam = to;
  document.body.classList.toggle('zoom-board', to === 'board');
  if (stageRig) { stageRig.cab.el.classList.toggle('open', to === 'cab'); stageRig.board.el.classList.toggle('editing', to === 'board'); }
  if (shopRig) shopRig.cab.el.classList.toggle('open', to === 'tryout-cab');
  $('stage').classList.toggle('cab-open', to === 'cab'); $('dock').classList.toggle('cab-open', to === 'tryout-cab');
  if (S.place === 'stage') {
    const z = ZOOMS[to];
    if (!z) setCam(overview({ x: 0, y: 0, w: STAGE.w, h: STAGE.h }), glide);
    else { const o = z(); setCam(frameRect(o.R, { right: o.right || 0, left: o.left || 0, bottom: o.bottom || 0, pad: o.pad ?? 24, ay: o.ay ?? 0.5 }), glide); }
  } else if (to === 'wall' || to === 'case') {
    S.area = to;
    setCam(shopFrame(to), glide); setDock({ s: DG.k, x: 0, y: 0 }, glide);
  } else { const o = ZOOMS[to](); setDock(frameRect(o.R, { right: o.right, pad: 24 }), glide); }
  $('stage').classList.toggle('zoomed', S.place === 'stage' && to !== 'stage');
  $('view').classList.toggle('dock-close', S.place === 'shop' && to.startsWith('tryout'));
  renderPanel(); renderBook(); renderWhere(); renderBack();
  if (to !== 'wall' && to !== 'case') { S.look = null; showCard(); }
}
function back() {
  if ($('screenmenu').hidden === false) { closeMenu(); return; }
  if (S.talking) { S.talking = false; renderStrip(); return; }
  if (S.drawer) { S.drawer = false; renderStrip(); return; }
  if (S.gs) { pauseGS(); return; }
  if (S.tape) { closeTape(); return; }
  if (S.place === 'shop') {
    if (S.cam.startsWith('tryout')) return zoom(S.area);
    return leaveShop();
  }
  if (S.cam === 'tuner' && S.tuner.on) { tuner(false); return; }
  if (S.cam !== 'stage') zoom('stage');
}
const doorFrame = () => frameRect({ x: STAGE.door.x * PX - 10, y: STAGE.door.y * PX - 20, w: STAGE.door.w * PX + 20, h: STAGE.door.h * PX + 30 }, { maxS: 2.6 });
function enterShop(area = 'wall') {
  if (S.place === 'shop') { turn(area); return; }
  if (S.tuner.on) tuner(false);
  if (S.gs) pauseGS(true);
  // walk to the door, through it, and into the shop
  setCam(doorFrame());
  setTimeout(() => $('fade').classList.add('on'), REDUCED ? 0 : 380);
  setTimeout(() => {
    S.place = 'shop'; $('stage').hidden = true; $('shop').hidden = false; $('dock').hidden = false;
    buildShop();
    S.cam = area; S.area = area;
    setCam(frameRect({ x: SHOP.door.x - 20, y: SHOP.door.y - 20, w: SHOP.door.w + 40, h: SHOP.door.h + 40 }, { maxS: 2.2 }), false);
    $('fade').classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => zoom(area)));
    say('The shop. Whatever you take off the wall or out of the case goes onto your stack in the corner. A: amps, P: pedals.');
  }, REDUCED ? 30 : 600);
}
function leaveShop() {
  setCam(frameRect({ x: SHOP.door.x - 20, y: SHOP.door.y - 20, w: SHOP.door.w + 40, h: SHOP.door.h + 40 }, { maxS: 2.2 }));
  setTimeout(() => $('fade').classList.add('on'), REDUCED ? 0 : 320);
  setTimeout(() => {
    S.place = 'stage'; $('shop').hidden = true; $('dock').hidden = true; $('stage').hidden = false;
    $('view').classList.remove('dock-close');
    S.cam = 'stage'; S.look = null; showCard();
    renderStageRig();
    setCam(doorFrame(), false);
    $('fade').classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => zoom('stage')));
    const a = ampDef();
    say(`Back on stage with ${a.name} on your ${cabName()} and ${pedalsOnly().length} pedals on the board${S.changed ? ': this song’s copy. Save to rack keeps it' : ''}.`);
  }, REDUCED ? 30 : 540);
}
function turn(area) {
  if (S.place !== 'shop') return enterShop(area);
  // what had focus on the other side doesn't keep it: arrows and Enter act where you're looking
  const a = document.activeElement;
  if (a && (a.classList.contains('amp-slot') || a.classList.contains('ped-slot') || a.classList.contains('plate-cat'))) a.blur();
  zoom(area);
}

/* ================================================================================================ the panels beside a zoom */
function renderPanel() {
  const p = $('panel');
  const kind = S.cam === 'tryout-head' ? 'head' : S.cam === 'tryout-cab' ? 'cab' : S.cam;
  if (!['head', 'cab', 'tuner'].includes(kind)) { p.classList.remove('on'); p.hidden = true; return; }
  p.hidden = false;
  p.style.setProperty('--pw', (kind === 'cab' ? 420 : kind === 'tuner' ? 380 : 340) + 'px');
  if (kind === 'head') {
    const d = ampDef();
    fill(p, h('div.kind', `${toneWord(d.tone || 'high')} amp · your stack`), h('h2.disp', d.name), h('p', d.blurb), h('p.nod', `In the spirit of ${d.nod}.`),
      h('p.note', 'Drag a knob up or down (Shift for fine), scroll it, or focus it and use the arrow keys; its name and value show large while you do. Double-click puts it back. Changes go to this song’s copy of the stack.'),
      h('h3', 'Somewhere else'),
      h('div.row', h('button.b', { type: 'button', onclick: () => zoom(S.place === 'shop' ? 'tryout-cab' : 'cab') }, 'The cab and its mics', kbd('C'))),
      S.place === 'shop' ? null : h('div.row', h('button.b', { type: 'button', onclick: () => enterShop('wall') }, 'Another amp: the shop', kbd('S'))),
      saveRow());
  } else if (kind === 'cab') {
    const c = CABS[S.cab.cab], m = S.cab.mic, m2 = S.cab.mic2;
    const micRow = (mm, i) => [
      h('div.chips', MIC_IDS.map((id) => h('button.chip', { type: 'button', 'aria-pressed': String(mm.type === id), onclick: () => { mm.type = id; changed(); rebuildRigs(); renderPanel(); say(`${MICS[id].name} on the cab now. ${MICS[id].blurb}.`); } }, MICS[id].name))),
      h('p.note', MICS[mm.type].blurb + '.'),
      h('div.row', h('label', 'On the cone'), h('span', { style: 'flex:1', id: 'mic' + i + 'where' }, sentence(onCone(mm.pos))), h('output', mm.pos.toFixed(2))),
      h('div.row', h('label', 'Distance'), h('input', { type: 'range', min: 0, max: 100, value: Math.round((Math.log(mm.dist / 0.5) / Math.log(48)) * 100), 'aria-label': 'Distance from the grille', oninput: (e) => { mm.dist = Math.round(0.5 * Math.pow(48, e.target.value / 100) * 10) / 10; e.target.nextSibling.textContent = inches(mm.dist); drawSide(); }, onchange: () => { changed(); rebuildRigs(); say(`${MICS[mm.type].name} ${inches(mm.dist)} back: ${mm.dist < 2 ? 'close, and the lows come up' : mm.dist > 8 ? 'the room comes in' : 'a little air'}.`); } }), h('output', inches(mm.dist))),
      h('div.row', h('label', 'Angle'), h('input', { type: 'range', min: 0, max: 60, value: mm.ang, 'aria-label': 'Angle off axis', oninput: (e) => { mm.ang = +e.target.value; e.target.nextSibling.textContent = mm.ang + '°'; drawSide(); }, onchange: () => { changed(); say(`${MICS[mm.type].name} ${mm.ang}° off axis: ${mm.ang > 20 ? 'darker' : 'a touch darker'}.`); } }), h('output', mm.ang + '°')),
    ];
    const side = h('canvas.sideview', { width: 744, height: 330, id: 'sideview', 'aria-label': 'The mics from the side: their distance from the grille and their angle' });
    fill(p, h('div.kind', 'The cab · your stack'), h('h2.disp', c.name), h('p', c.blurb + '.'),
      h('p.note', 'You’re at the grille. Drag a mic across a cone: at the cap it’s bright, out toward the edge it’s darker.'),
      h('h3', 'Which cab'),
      h('div.cablist', GUITAR_CABS.map((id) => h('button.chip', { type: 'button', 'aria-pressed': String(S.cab.cab === id), onclick: () => { S.cab.cab = id; S.cab.mic.cone = 0; if (S.cab.mic2) S.cab.mic2.cone = Math.min(1, (CABS[id].n || 1) - 1); changed(); rebuildRigs(); renderPanel(); say(`${CABS[id].name} under ${ampDef().name}. ${CABS[id].blurb}.`); } }, CABS[id].name))),
      h('h3', 'From the side'), side,
      h('h3', 'Mic 1'), micRow(m, 0),
      h('h3', 'Mic 2'),
      m2 ? [micRow(m2, 1),
        h('div.row', h('label', 'Blend'), h('input', { type: 'range', min: 0, max: 10, step: 0.1, value: m2.blend, 'aria-label': 'Blend: 0 all mic 1, 10 all mic 2', oninput: (e) => { m2.blend = +e.target.value; e.target.nextSibling.textContent = fmt1(m2.blend); }, onchange: () => { changed(); say(`Blend ${fmt1(m2.blend)}: ${m2.blend < 5 ? 'mostly mic 1' : m2.blend > 5 ? 'mostly mic 2' : 'even'}.`); } }), h('output', fmt1(m2.blend))),
        h('div.row', h('label', 'Phase'), h('button.chip', { type: 'button', 'aria-pressed': String(!!m2.flip), onclick: () => { m2.flip = !m2.flip; changed(); renderPanel(); say(m2.flip ? 'Mic 2’s phase flipped: listen for the low end thinning or filling.' : 'Mic 2’s phase back to normal.'); } }, m2.flip ? 'Flipped' : 'Normal')),
        h('div.row', h('button.b', { type: 'button', onclick: () => { S.cab.mic2 = null; changed(); rebuildRigs(); renderPanel(); say('Mic 2 is off the cab.'); } }, 'Take mic 2 away'))]
        : h('div.row', h('button.b', { type: 'button', onclick: addMic2 }, 'Put up a second mic')),
      saveRow());
    drawSide();
  } else if (kind === 'tuner') {
    const t = S.tuner, tn = TUNINGS.find((x) => x.id === S.tuning);
    fill(p, h('div.kind', 'Tuner · first on your board'), h('h2.disp', TUNER.name), h('p', t.on ? 'It’s on, so you’re muted. Play each open string on its own and let it ring.' : 'Stomp it to tune. It mutes you while it’s on, like the one on your floor at home.'),
      h('div.strings', { id: 'strings' }, tn.notes.map((n, i) => h('span' + (t.done.includes(i) ? '.ok' : t.on && t.str === i ? '.now' : ''), n, h('small', String(6 - i))))),
      h('p.verdict', { id: 'tunesay' }, tunerWords()),
      h('h3', 'Tuning'),
      h('div.chips', TUNINGS.map((x) => h('button.chip', { type: 'button', 'aria-pressed': String(S.tuning === x.id), onclick: () => { S.tuning = x.id; S.tuner.done = []; S.tuner.str = 0; S.tuner.cents = -22; renderPanel(); say(`${x.name}: ${x.notes.join(' ')}, low to high.`); } }, x.name))),
      h('p.note', 'Low Tide, in the shop’s case under Pitch, drops the whole guitar without touching a peg.'),
      h('div.row', { style: 'margin-top:16px' }, h('button.b' + (t.on ? '.b-go' : ''), { type: 'button', onclick: () => tuner() }, t.on ? 'Stomp it off' : 'Stomp it on', kbd('T'))));
  }
  requestAnimationFrame(() => p.classList.add('on'));
}
function addMic2() { S.cab.mic2 = { type: 'ribbon', pos: 0.62, dist: 1, ang: 0, cone: Math.min(1, (CABS[S.cab.cab].n || 1) - 1), blend: 5, flip: false, _ang: -0.6 }; changed(); rebuildRigs(); renderPanel(); say('A ribbon on the next cone, blended half and half. Drag it where you like.'); }
function saveRow() {
  return h('div.row', { style: 'margin-top:18px' }, h('button.b', { type: 'button', disabled: !S.changed || null, onclick: () => { S.changed = false; say('Saved to the rack as “Club stack, ' + ampDef().name + '”. Any song can load it.'); renderPanel(); } }, 'Save to rack', kbd('⌘S')), h('span.note', S.changed ? 'Changed: this song’s copy' : 'Nothing changed'));
}
// the cab's side view, drawn to scale: the baffle, a 12″ speaker in profile, and each mic at its distance and angle
function drawSide() {
  const cv = $('sideview');
  if (!cv) return;
  const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height, cy = 150, ppi = 19, gx = 120; // 19 px an inch; the grille at gx
  g.clearRect(0, 0, W2, H2);
  g.fillStyle = '#0b090d'; g.fillRect(0, 0, W2, H2);
  // the cab's inside, the baffle and the cloth
  g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, gx - 8, H2);
  g.fillStyle = '#3a3936'; g.fillRect(gx - 14, 10, 8, H2 - 20);
  g.fillStyle = '#c9c4b4'; g.fillRect(gx - 4, 10, 4, H2 - 20);
  // the speaker in profile: its basket, the cone and the dust cap
  g.strokeStyle = '#6a6a74'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(gx - 14, cy - 6 * ppi); g.lineTo(gx - 80, cy - 1.6 * ppi); g.lineTo(gx - 80, cy + 1.6 * ppi); g.lineTo(gx - 14, cy + 6 * ppi); g.stroke();
  g.fillStyle = '#2a2927'; g.beginPath(); g.moveTo(gx - 16, cy - 5.6 * ppi); g.quadraticCurveTo(gx - 50, cy - 2 * ppi, gx - 70, cy - 1.2 * ppi); g.lineTo(gx - 70, cy + 1.2 * ppi); g.quadraticCurveTo(gx - 50, cy + 2 * ppi, gx - 16, cy + 5.6 * ppi); g.closePath(); g.fill();
  g.fillStyle = '#55534e'; g.beginPath(); g.ellipse(gx - 64, cy, 10, 1.1 * ppi, 0, -Math.PI / 2, Math.PI / 2); g.fill();
  // the ruler: inches from the grille
  g.fillStyle = '#7a7266'; g.font = '600 22px Atkinson Hyperlegible Next, sans-serif';
  for (let i = 0; i <= 30; i++) { const x = gx + i * ppi; if (x > W2 - 10) break; g.fillRect(x, H2 - 26, 2, i % 6 ? 6 : 12); if (i % 6 === 0 && i) g.fillText(i + '″', x - 12, H2 - 32); }
  g.fillRect(gx, H2 - 20, W2 - gx - 10, 1);
  // the mics: a 57-ish body, 6″ long and 1.3″ wide, its capsule at the distance, aimed by the angle, at its height on the cone
  [S.cab.mic, S.cab.mic2].filter(Boolean).forEach((m, i) => {
    const x = gx + Math.min(m.dist, 30) * ppi, y = cy + (i ? 1 : -1) * Math.max(0.12, Math.min(m.pos, 1.2)) * 5 * ppi;
    const a = (m.ang * Math.PI) / 180 * (i ? -1 : 1);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = i ? '#ffc85a' : '#d8d2c0'; g.fillRect(0, -0.65 * ppi, 6 * ppi, 1.3 * ppi);
    g.fillStyle = '#6a6a74'; g.fillRect(-0.4 * ppi, -0.75 * ppi, 1.2 * ppi, 1.5 * ppi);
    g.restore();
    g.strokeStyle = i ? '#ffc85a88' : '#d8d2c088'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(gx, y); g.lineTo(x - 0.5 * ppi, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = i ? '#ffc85a' : '#e8e0cc'; g.font = '700 26px Atkinson Hyperlegible Next, sans-serif';
    g.fillText(`${i ? 'Mic 2' : 'Mic 1'}: ${inches(m.dist)} back, ${m.ang}°`, Math.min(x, W2 - 300), y + (i ? 52 : -28));
  });
}

/* ================================================================================================ the drummer's book */
function renderBook() {
  const book = $('book');
  if (S.cam !== 'kit') { book.classList.remove('on'); setTimeout(() => { if (S.cam !== 'kit') book.hidden = true; }, 300); return; }
  book.hidden = false;
  book.style.setProperty('--bw', bookW() + 'px');
  const styles = LIB.styles, st = styles.find((x) => x.id === S.book.style) || styles[0];
  const editGrid = (p) => h('div.egrid', ['top', 'snare', 'kick'].map((row) => [h('span', row === 'top' ? cap(p.grid.topName || 'hat') : cap(row)),
    p.grid[row].map((v, k) => h('button' + (v ? '.h' + v : ''), { type: 'button', 'aria-label': `${p.short}: ${row} step ${k + 1}, ${['off', 'hit', 'accent'][v]}`, onclick: () => { p.grid[row][k] = (v + 1) % 3; p.edited = true; renderBook(); renderCards(); } }))]));
  const pinsPage = h('div.page',
    h('h2.disp', 'On the riser'),
    h('p.sub', 'The beats on the riser’s cards, yours to rename, edit and reorder. Click a step to add a hit, again for an accent, again to clear it.'),
    S.pins.map((p, i) => h('div.pin' + (S.drummer.pin === i ? '.playing' : ''),
      h('div.nm', h('input.short', { value: p.short, 'aria-label': 'Its name on the riser', maxlength: 12, onchange: (e) => { p.short = e.target.value || p.short; renderCards(); } }), h('span.from', `${(LIB.byId.get(p.id) || GUIDE).name}${p.edited ? ', edited' : ''}`)),
      h('div.acts', h('button', { type: 'button', onclick: () => setPin(i) }, S.drummer.pin === i ? 'Playing' : 'Play'), h('button', { type: 'button', 'aria-label': 'Earlier', onclick: () => { if (i > 0) { [S.pins[i - 1], S.pins[i]] = [S.pins[i], S.pins[i - 1]]; fixPin(i, i - 1); renderBook(); renderCards(); } } }, '↑'),
        h('button', { type: 'button', 'aria-label': 'Later', onclick: () => { if (i < S.pins.length - 1) { [S.pins[i + 1], S.pins[i]] = [S.pins[i], S.pins[i + 1]]; fixPin(i, i + 1); renderBook(); renderCards(); } } }, '↓'),
        h('button', { type: 'button', onclick: () => { if (S.pins.length > 1) { S.pins.splice(i, 1); if (S.drummer.pin >= S.pins.length) S.drummer.pin = 0; renderBook(); renderCards(); say(`${p.short} is off the riser. It’s still in the book.`); } } }, 'Unpin')),
      editGrid(p))),
    S.pins.length < 5 ? h('p.sub', `Room for ${5 - S.pins.length} more on the riser: pin one from the book.`) : h('p.sub', 'The riser holds five. Unpin one to make room.'));
  const parts = ['intro', 'verse', 'chorus', 'bridge', 'half', 'fill', 'ending'];
  const PL = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', half: 'Half-time', fill: 'Fills', ending: 'Endings' };
  const libPage = h('div.page',
    h('h2.disp', 'Every groove'),
    h('p.sub', `${LIB.count} grooves in ${styles.length} styles. Play one now, or pin it to the riser.`),
    h('div.tabs', styles.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === st.id), onclick: () => { S.book.style = x.id; renderBook(); } }, x.name))),
    h('p.sub', { style: 'margin-top:0' }, st.blurb ? st.blurb[0].toUpperCase() + st.blurb.slice(1) + '.' : '', tempoText(st)),
    parts.map((part) => { const gs = st.grooves.filter((g) => g.part === part); if (!gs.length) return null; return [h('h3', PL[part]), gs.map((g) => {
      const pinned = S.pins.findIndex((p) => p.id === g.id), grid = gridOf(g), bars = g.bars ?? g.length / 4;
      return h('div.gv' + (pinned >= 0 ? '.on' : ''), h('div.nm', g.name, h('small', `${bars} bar${bars === 1 ? '' : 's'}`)),
        h('div.acts', h('button', { type: 'button', onclick: () => playGroove(g) }, 'Play now'), pinned >= 0 ? h('button', { type: 'button', disabled: true }, 'On the riser') : h('button', { type: 'button', onclick: () => { if (S.pins.length >= 5) { say('The riser holds five. Unpin one first.'); return; } S.pins.push({ id: g.id, short: shortName(g.name), grid: gridOf(g), edited: false }); renderBook(); renderCards(); say(`${g.name} is pinned to the riser as “${shortName(g.name)}”.`); } }, 'Pin')),
        h('div.vmini', ['top', 'snare', 'kick'].map((r) => grid[r].map((v) => h('i' + (v ? '.h' + v : ''))))));
    })]; }));
  fill(book, pinsPage, libPage);
  requestAnimationFrame(() => book.classList.add('on'));
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const tempoText = (st) => { const t = st.tempo; if (!t) return ''; const lo = Array.isArray(t) ? t[0] : t.lo ?? t.min ?? t, hi = Array.isArray(t) ? t[1] : t.hi ?? t.max; return ` Played at ${lo}${hi && hi !== lo ? '–' + hi : ''} BPM.`; };
const shortName = (n) => n.split(/[,:]/)[0].split(' ').slice(0, 2).join(' ').slice(0, 12);
function fixPin(a, b) { if (S.drummer.pin === a) S.drummer.pin = b; else if (S.drummer.pin === b) S.drummer.pin = a; }
function playGroove(g) {
  let i = S.pins.findIndex((p) => p.id === g.id);
  if (i < 0) { S.pins.push({ id: g.id, short: shortName(g.name), grid: gridOf(g), edited: false, temp: true }); i = S.pins.length - 1; }
  setPin(i);
}

/* ================================================================================================ the drummer, the tempo, stomps */
function drummer(on = !S.drummer.on) {
  S.drummer.on = on; S.drummer.t0 = now(); S.drummer.next = null;
  const p = S.pins[S.drummer.pin];
  say(on ? `${p.short} at ${S.tempo}. The tape’s rolling: click the machine, or G, for what you just played.` : 'Drummer’s stopped. The tape kept it.');
  renderTransport();
}
function setPin(i) {
  if (!S.pins[i]) return;
  const p = S.pins[i];
  if (S.drummer.on && S.drummer.pin !== i) { S.drummer.next = i; say(`${p.short} at the next bar.`); }
  else { S.drummer.pin = i; S.drummer.next = null; say(`${p.short} it is${S.drummer.on ? '' : '. Space starts the drummer'}.`); }
  renderCards(); renderTransport(); if (S.cam === 'kit') renderBook();
}
function tempo(d) { S.tempo = clamp(S.tempo + d, 40, 260); renderTransport(); say(`${S.tempo} BPM.`); }
function renderTransport() {
  const tp = $('transport');
  if (!tp) return;
  tp.classList.toggle('on', S.drummer.on);
  $('tpbpm').textContent = String(S.tempo);
  const p = S.pins[S.drummer.pin];
  $('tpbeat').textContent = (LIB.byId.get(p.id) || GUIDE).name + (p.edited ? ' (edited)' : '');
}
function stompUid(u) {
  const b = boardItem(u);
  if (!b) return;
  if (b.device === 'tuner') return tuner();
  b.on = !b.on;
  say(`${getDevice(b.device).name} ${b.on ? 'on' : 'off'}.`);
  rebuildRigs();
}
function stomp(n) { const b = pedalsOnly()[n - 1]; if (b) stompUid(b.uid); }
function tuner(on = !S.tuner.on) {
  S.tuner.on = on;
  const tn = TUNINGS.find((x) => x.id === S.tuning);
  if (on) { if (S.tuner.done.length >= 6) S.tuner.done = []; S.tuner.str = S.tuner.done.length; S.tuner.cents = -22 - Math.random() * 6; }
  rebuildRigs();
  if (S.place === 'stage') {
    if (on && S.cam !== 'tuner') zoom('tuner');
    else if (!on && S.cam === 'tuner') { if (S.gs) gsCam(); else zoom('stage'); }
  }
  renderPanel();
  say(on ? `Tuner’s on: you’re muted. Play the ${tn.notes[S.tuner.str]} string (${6 - S.tuner.str}) on its own and let it ring.` : 'Tuner’s off. You’re back on.');
  if (S.gs?.step === 'tune') { if (!on) S.gs.tuned = true; renderCallout(); setTimeout(renderSpot, GLIDE); }
}
function tunerWords() {
  const t = S.tuner, tn = TUNINGS.find((x) => x.id === S.tuning);
  if (!t.on) return t.done.length >= 6 ? `All six in tune for ${tn.name}.` : '';
  if (t.done.length >= 6) return `All six in tune for ${tn.name}. Stomp it off.`;
  const c = Math.round(t.cents);
  return `${tn.notes[t.str]} string (${6 - t.str}): ${Math.abs(c) < 3 ? 'in tune' : c < 0 ? `${-c} cents flat` : `${c} cents sharp`}.`;
}
function changed() { S.changed = true; }

/* ================================================================================================ the tape */
function openTape() {
  if (S.place !== 'stage') return;
  S.tape = { bars: 33, sel: [29, 33], seed: 4242, snap: true };
  zoom('tape');
  renderTape();
}
function closeTape() { S.tape = null; renderTape(); zoom('stage'); }
function renderTape() {
  const el = $('tapesheet');
  if (!S.tape) { el.classList.remove('on'); setTimeout(() => { if (!S.tape) el.hidden = true; }, 300); return; }
  el.hidden = false;
  el.style.height = tapeH() + 'px';
  const T = S.tape, cv = h('canvas', { id: 'tapecv' });
  const len = T.sel[1] - T.sel[0];
  fill(el,
    h('div.hd', h('h2.disp', 'The last minute'), h('span.t3', `${T.bars} bars at ${S.tempo}, through ${ampDef().name}. The last ${len} bars are picked: Enter keeps them as a riff.`)),
    cv,
    h('div.ft', h('button.b.b-go', { type: 'button', onclick: keepRiff }, `Keep bars ${T.sel[0] + 1}–${T.sel[1]} as a riff`, kbd('Enter')), h('button.b', { type: 'button', onclick: () => { T.snap = !T.snap; renderTape(); } }, T.snap ? 'Snap to bars: on' : 'Snap to bars: off'), h('span', 'Drag the ends to trim.'), h('span.gap'), h('button.b', { type: 'button', onclick: closeTape }, 'Close', kbd('Esc'))));
  requestAnimationFrame(() => { el.classList.add('on'); drawTape(cv); });
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(), b = ((e.clientX - r.left) / r.width) * T.bars; drag = Math.abs(b - T.sel[0]) < Math.abs(b - T.sel[1]) ? 0 : 1; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (drag == null) return; const r = cv.getBoundingClientRect(); let b = clamp(((e.clientX - r.left) / r.width) * T.bars, 0, T.bars); if (T.snap) b = Math.round(b); T.sel[drag] = b; if (T.sel[0] > T.sel[1] - 0.25) T.sel[drag] = drag ? T.sel[0] + 0.25 : T.sel[1] - 0.25; drawTape(cv); });
  cv.addEventListener('pointerup', () => { drag = null; renderTape(); });
}
function drawTape(cv) {
  const T = S.tape, r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const g = cv.getContext('2d'), w = cv.width, hh = cv.height;
  const cols = Math.round(w / (3 * d)), raw = riffShape(T.seed, T.bars, cols), shape = raw.map((v, i) => Math.max(v, raw[i - 1] || 0, raw[i + 1] || 0) * 0.85 + 0.04);
  g.fillStyle = '#0b090d'; g.fillRect(0, 0, w, hh);
  const x0 = (T.sel[0] / T.bars) * w, x1 = (T.sel[1] / T.bars) * w;
  g.fillStyle = '#f1dc8a1c'; g.fillRect(x0, 0, x1 - x0, hh);
  for (let b = 0; b <= T.bars; b++) { const x = Math.round((b / T.bars) * w); g.fillStyle = '#2f2b25'; g.fillRect(x, 0, 1, hh); if (b < T.bars) { g.fillStyle = '#9a8f7c'; g.font = `${11 * d}px Atkinson Hyperlegible Mono, monospace`; g.fillText(String(b + 1), x + 4 * d, 14 * d); } }
  const mid = hh / 2 + 8 * d, A = hh * 0.36;
  const wave = () => { g.beginPath(); g.moveTo(0, mid); shape.forEach((v, i) => g.lineTo((i / (cols - 1)) * w, mid - v * A)); for (let i = cols - 1; i >= 0; i--) g.lineTo((i / (cols - 1)) * w, mid + shape[i] * A); g.closePath(); };
  g.fillStyle = '#6e6352'; wave(); g.fill();
  g.save(); g.beginPath(); g.rect(x0, 0, x1 - x0, hh); g.clip(); g.fillStyle = '#f4ead6'; wave(); g.fill(); g.restore();
  for (const x of [x0, x1]) { g.fillStyle = '#f1dc8a'; g.fillRect(x - d, 0, 2 * d, hh); g.fillRect(x - 5 * d, hh - 16 * d, 10 * d, 16 * d); }
}
function keepRiff() {
  const T = S.tape, n = S.riffs.length + 1, bars = T.sel[1] - T.sel[0];
  S.riffs.push({ name: `Riff ${n}`, bars, tempo: S.tempo, amp: ampDef().name, seed: T.seed + n });
  closeTape();
  say(`Riff ${n} is in the tray: ${bars} bars at ${S.tempo}, through ${ampDef().name}. It loops when you press it.`);
}

/* ================================================================================================ Getting started, in the room */
// Each step moves the camera to what it's about, puts the engineer's slate beside it (never over it) and a pool of
// light on it. Esc pauses; the Getting started button picks it up where it stopped.
const GS = [{ id: 'plug', label: 'Plug in' }, { id: 'tune', label: 'Tune' }, { id: 'time', label: 'Timing' }, { id: 'sound', label: 'Your sound' }, { id: 'tour', label: 'Tour' }];
const KITR = { x: 556, y: 176, w: 560, h: 386 };
const TOUR = [
  { at: () => stageRig.head, frame: () => ({ x: stageRig.head.x - 40, y: stageRig.head.y - 60, w: stageRig.head.w + 80, h: stageRig.head.h + 200 }), side: 'right', title: 'Your amp', text: 'Kraken, sitting on your cab. Every knob turns right here; click the amp to get close.' },
  { at: () => stageRig.cab, frame: () => pad(stageRig.cab, 50, 40, 50, 30), side: 'right', title: 'Your cab', text: 'A closed 4x12 with a dynamic mic on it. Click it and you’re at the grille, moving the mics.' },
  { at: () => ({ ...stageRig.board }), frame: () => ({ x: 0, y: 380, w: 1440, h: 424 }), side: 'top', title: 'Your board', text: 'In signal order, left to right; the loop pedals sit after the amp. 1 to 4 stomp them, T is the tuner. Hover a knob for its name and value.' },
  { at: () => KITR, frame: () => KITR, side: 'right', title: 'The drummer', text: 'Space starts and stops. The cards on the riser are your beats; click the kit for the book with every groove.' },
  { at: () => ({ x: STAGE.tape.x * PX, y: STAGE.tape.y * PX, w: STAGE.tape.w * PX, h: 300 }), frame: () => ({ x: 1040, y: 200, w: 300, h: 380 }), side: 'left', title: 'The tape', text: 'Always rolling, quietly. Click it, or G, for the last minute, and keep what you liked as a riff.' },
  { at: () => ({ x: STAGE.door.x * PX, y: STAGE.door.y * PX - 70, w: STAGE.door.w * PX, h: STAGE.door.h * PX + 70 }), frame: () => ({ x: 1150, y: 120, w: 300, h: 450 }), side: 'left', title: 'The shop', text: 'Every amp and pedal, on the wall and in the case. Click the door, or S.' },
  { at: 'strip', frame: () => ({ x: 0, y: 0, w: 1440, h: 804 }), side: 'top', title: 'Riffs and the part line', text: 'Along the bottom, with the talkback. Claude answers through it.' },
];
function gsShot(step = S.gs?.step) {
  if (step === 'plug') return S.gs?.close ? { R: (() => { const f = stageRig.slots[0]; return { x: f.x - 190, y: f.y - 40, w: f.w + 250, h: f.h + 80 }; })(), side: 'right' } : { R: { x: -30, y: 0, w: 680, h: 804 }, side: 'right' };
  if (step === 'tune') return { R: pad(tunerSlot(), 150, 170, 280, 40), side: 'right' };
  if (step === 'time') return { R: KITR, side: 'right' };
  if (step === 'sound') return { R: { x: 0, y: 0, w: 1440, h: 804 }, side: 'right' };
  if (step === 'tour') { const t = TOUR[S.tour]; return { R: t.frame(), side: t.side }; }
  return { R: { x: 0, y: 0, w: 1440, h: 804 }, side: 'right' };
}
const SLATE_W = 380;
function gsCam(glide = true) {
  if (!S.gs || S.place !== 'stage') return;
  S.cam = 'gs';
  $('stage').classList.add('zoomed');
  const { R, side } = gsShot();
  const co = $('callout'), top = side === 'top' ? (co.offsetHeight || 200) + 24 : 0;
  setCam(frameRect(R, { right: side === 'right' ? SLATE_W : 0, left: side === 'left' ? SLATE_W : 0, top, pad: 20 }), glide);
  renderPanel(); renderBook(); renderWhere(); renderBack();
  sp().hidden = true;
  setTimeout(renderSpot, glide ? GLIDE : 30);
}
const sp = () => $('spot');
function startGS(step = 'plug') {
  if (S.place === 'shop') { leaveShop(); setTimeout(() => startGS(step), 700); return; }
  if (S.tape) closeTape();
  S.gs = { step, sub: 0 }; S.gsPaused = null;
  if (step === 'plug') { S.plugged = false; S.plugT = 0; S.gainDb = -19; rebuildRigs(); }
  if (step === 'tour') S.tour = 0;
  renderCallout(); gsCam();
}
function gsNext(skip = false) {
  const i = GS.findIndex((s) => s.id === S.gs.step);
  if (S.gs.step === 'tour' && !skip && S.tour < TOUR.length - 1) { S.tour++; renderCallout(); gsCam(); return; }
  if (S.tuner.on) { S.tuner.on = false; rebuildRigs(); }
  if (i >= GS.length - 1 || (S.gs.step === 'tour' && skip)) return endGS();
  S.gs = { step: GS[i + 1].id, sub: 0 };
  if (S.gs.step === 'tour') S.tour = 0;
  if (!S.plugged || S.plugT < 1) { S.plugged = true; S.plugT = 1; S.gainDb = -8.5; rebuildRigs(); }
  renderCallout(); gsCam();
}
function endGS() {
  S.gs = null; S.gsPaused = null; $('callout').hidden = true; sp().hidden = true;
  if (S.place === 'stage') zoom('stage');
  say('You’re set up. Space starts the drummer; the tape’s already rolling.');
}
function pauseGS(quiet = false) {
  if (!S.gs) return;
  S.gsPaused = S.gs.step; S.gs = null;
  $('callout').hidden = true; sp().hidden = true;
  if (S.tuner.on) { S.tuner.on = false; rebuildRigs(); }
  if (!S.plugged || S.plugT < 1) { S.plugged = true; S.plugT = 1; S.gainDb = -8.5; rebuildRigs(); }
  if (!quiet) { zoom('stage'); say('Getting started is paused. The button up top picks it up where you left off.'); }
  renderGsBtn();
}
function renderGsBtn() { $('gsbtn').textContent = S.gsPaused ? 'Getting started: carry on' : 'Getting started'; }
function targetsOf() {
  if (!S.gs) return [];
  const st = S.gs.step;
  if (st === 'plug') { const first = stageRig.slots[0]; return [{ x: first.x - 120, y: first.y + 10, w: first.w + 120, h: first.h + 20 }, stageRig.meter ? worldBox(stageRig.meter) : null].filter(Boolean); }
  if (st === 'tune') return S.cam === 'tuner' ? [] : [pad(tunerSlot(), 6, 6, 6, 24)];
  if (st === 'time') return [{ x: 590, y: 196, w: 500, h: 268 }];
  if (st === 'sound') return [pad(stageRig.head, 6, 30, 6, 0), pad(stageRig.cab, 6, 0, 6, 6), { x: STAGE.door.x * PX - 4, y: STAGE.door.y * PX - 70, w: STAGE.door.w * PX + 8, h: STAGE.door.h * PX + 74 }];
  if (st === 'tour') { const t = TOUR[S.tour].at; return t === 'strip' ? ['strip'] : [t()]; }
  return [];
}
// the engineer's spotlight: a tight pool on each thing, the rest of the room dimmed
function renderSpot() {
  const el = sp();
  if (!S.gs || S.place !== 'stage' || S.cam === 'tuner') { el.hidden = true; return; }
  const { w, h: hh } = vsize();
  const ts = targetsOf().map((t) => (t === 'strip' ? { x: 0, y: hh - 4, w, h: 30 } : toView(t)));
  el.hidden = false;
  const holes = ts.map((r) => `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w * 0.56 + 10}" ry="${r.h * 0.56 + 10}" fill="#000"/>`).join('');
  const rims = ts.map((r) => `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w * 0.56 + 10}" ry="${r.h * 0.56 + 10}" fill="url(#pool)"/>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none"><defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
    <radialGradient id="pool"><stop offset=".6" stop-color="#ffc85a" stop-opacity="0"/><stop offset="1" stop-color="#ffc85a" stop-opacity=".1"/></radialGradient>
    <mask id="m"><rect width="${w}" height="${hh}" fill="#fff"/><g filter="url(#soft)">${holes}</g></mask></defs>
    <rect width="${w}" height="${hh}" fill="#07060a" fill-opacity=".66" mask="url(#m)"/>${rims}</svg>`;
}
function renderCallout() {
  const co = $('callout');
  if (!S.gs) { co.hidden = true; return; }
  co.hidden = false;
  const st = S.gs.step, idx = GS.findIndex((s) => s.id === st);
  const steps = h('div.steps', GS.map((s, i) => h('span' + (i < idx ? '.done' : i === idx ? '.now' : ''), h('i'), s.label)));
  const skip = h('button.b.skip', { type: 'button', onclick: () => gsNext(true) }, st === 'tour' ? 'End the tour' : 'Skip');
  let body = [];
  if (st === 'plug') {
    const pl = S.plugged;
    body = [h('h2.disp', 'Plug in'),
      pl ? h('p', 'The cable’s in the tuner’s input and its jack is lit. Strum hard and watch the meter on the amp: the amber window is −12 to −6 dBFS.')
        : h('p', 'Pick your interface and the input your guitar’s in. The cable goes into the first pedal on your board, the tuner.'),
      pl ? null : h('div.fields', h('label', 'Interface', h('select', { onchange: (e) => (S.iface = e.target.value) }, ['Scarlett Solo USB', 'MacBook Pro Microphone'].map((x) => h('option', { selected: x === S.iface || null }, x)))),
        h('label', 'Input', h('select', { onchange: (e) => (S.input = e.target.value) }, ['Input 1', 'Input 2'].map((x) => h('option', { selected: x === S.input || null }, x))))),
      pl ? h('p.verdict', { id: 'plugsay' }, plugWords()) : null,
      pl ? h('p.small', 'The gain knob on your interface sets this, not anything in here.') : null,
      h('div.acts', pl ? h('button.b.b-go', { type: 'button', disabled: S.gainDb < -12 || null, onclick: () => gsNext() }, 'Next: tune') : h('button.b.b-go', { type: 'button', onclick: plugIn }, 'Plug in'), skip)];
  } else if (st === 'tune') {
    const tn = TUNINGS.find((x) => x.id === S.tuning), close = S.tuner.on;
    body = [h('h2.disp', 'Tune'), h('p', S.gs.tuned ? `All six in tune for ${tn.name}.` : close ? 'Play each open string on its own and let it ring; it lights when it’s in. Stomp it off when they’re all lit.' : `Stomp the tuner, first on your board (or T). It mutes you while it’s on and reads one string at a time, low to high. You’re set for ${tn.name}; drop tunings are a click away.`),
      h('div.acts', S.gs.tuned ? h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Next: timing') : close ? h('button.b.b-go', { type: 'button', onclick: () => tuner(false) }, 'Stomp it off', kbd('T')) : h('button.b.b-go', { type: 'button', onclick: () => tuner(true) }, 'Stomp the tuner', kbd('T')), skip)];
  } else if (st === 'time') {
    const c = S.count, done = S.gs.timed;
    body = [h('h2.disp', 'Timing'), h('p', done ? `Round trip: ${S.latency} ms. Takes land on the beat now. Remembered for ${S.iface}, ${S.input.toLowerCase()}.` : 'Your interface and the browser add a little delay. The drummer clicks their sticks eight times; strum once on each, and takes land right on the beat.'),
      h('div.timeline', Array.from({ length: 8 }, (_, i) => h('i', { style: `left:${6 + i * 12.5}%` })), (S.gs.strums || []).map((ms, i) => h('b', { style: `left:calc(${6 + i * 12.5}% + ${ms * 0.5}px)` }))),
      h('p.small', c != null ? `Click ${c} of 8.` : done ? 'Eight strums, each about 11 ms behind the click: that’s the round trip, now taken off.' : 'Get your hand ready.'),
      h('div.acts', done ? h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Next: your sound') : h('button.b.b-go', { type: 'button', disabled: c != null || null, onclick: countEight }, 'Count me in'), skip)];
  } else if (st === 'sound') {
    body = [h('h2.disp', 'Your sound'), h('p', `That’s the club’s stack: ${ampDef().name} on a ${cabName()}, a gate and a treble booster in front. Play through it.`), h('p', 'Anything else is in the shop, through that door: amps on the wall by sound, pedals in the case by type.'),
      h('div.acts.one', h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Keep this one'), h('button.b', { type: 'button', onclick: () => { gsNext(); endGS(); enterShop('wall'); } }, 'Through the door', kbd('S')), skip)];
  } else if (st === 'tour') {
    const t = TOUR[S.tour];
    body = [h('h2.disp', t.title), h('p', t.text), h('p.small', `${S.tour + 1} of ${TOUR.length}`),
      h('div.acts', S.tour > 0 ? h('button.b', { type: 'button', onclick: () => { S.tour--; renderCallout(); gsCam(); } }, 'Back') : null, h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, S.tour === TOUR.length - 1 ? 'Done' : 'Next'), skip)];
  }
  fill(co, steps, body, h('p.esc', kbd('Esc'), ' pauses this; the Getting started button carries on.'));
  const side = S.cam === 'tuner' ? 'left' : gsShot().side;
  co.className = 'callout at-' + side;
}
function plugWords() {
  const db = Math.round(S.gainDb - 0.4);
  return db < -12 ? `Peaks at ${minus(db)} dBFS: a little low. Turn the interface’s gain up a touch.` : db > -6 ? `Peaks at ${minus(db)} dBFS: too hot. Back the interface’s gain off.` : `Peaks at ${minus(db)} dBFS: right in the window.`;
}
// plugging in: the camera goes in close on the tuner's input, the plug slides home and the jack lights, then the
// camera comes back out to the meter on the amp while you strum
function plugIn() {
  S.plugged = true; S.plugT = 0; S.gainDb = -19; S.gs.close = true;
  rebuildRigs(); renderCallout(); gsCam();
  const t0 = now() + (REDUCED ? 0 : 640), dur = REDUCED ? 1 : 520;
  const step = () => {
    if (S.gs?.step !== 'plug') return;
    S.plugT = clamp((now() - t0) / dur, 0, 1);
    drawCables($('cables'), stageRig, STAGE.w);
    if (S.plugT < 1) return requestAnimationFrame(step);
    S.ring = true; rebuildRigs();
    say(`${S.iface}, ${S.input.toLowerCase()}: the cable’s in. Strum.`);
    setTimeout(() => { S.ring = false; }, 1600);
  };
  requestAnimationFrame(step);
  setTimeout(() => { if (S.gs?.step === 'plug') { S.gs.close = false; S.gainDb = -14.5; renderCallout(); gsCam(); } }, REDUCED ? 600 : 2100);
  setTimeout(() => { if (S.gs?.step === 'plug') { S.gainDb = -8.5; renderCallout(); say('Peaks at −9 dBFS: right in the window.'); } }, REDUCED ? 1200 : 3600);
}
function countEight() {
  S.count = 0; S.gs.strums = [];
  const beat = 60000 / S.tempo;
  for (let i = 1; i <= 8; i++) setTimeout(() => { if (!S.gs) return; S.count = i; S.tapAt = now(); S.gs.strums.push(9 + Math.round(Math.random() * 5)); renderCallout(); }, i * beat);
  setTimeout(() => { S.count = null; if (!S.gs) return; S.gs.timed = true; renderCallout(); say(`Round trip: ${S.latency} ms, taken off every take from now on.`); }, 9 * beat + 200);
  renderCallout();
}

/* ================================================================================================ a knob's name and value, large */
// The faces print their knob labels small, as the real pedals do; hovering, dragging or focusing a knob shows its name
// and value large above it, as Claw'd-o-Matic does.
let ktKnob = null;
function ownerName(kn) {
  const slot = kn.closest('.slot');
  if (slot) { const b = boardItem(slot.dataset.uid); return b ? getDevice(b.device)?.name : ''; }
  return kn.closest('.head') ? ampDef().name : '';
}
function showKt() {
  const t = $('kntip');
  if (!ktKnob || !ktKnob.isConnected) { t.classList.remove('on'); ktKnob = null; return; }
  const l = ktKnob.querySelector('.kn-l')?.textContent || '', v = ktKnob.querySelector('.kn-v')?.textContent || '';
  fill(t, h('small', ownerName(ktKnob)), h('span', sentence(l)), h('b', minus(v)));
  const r = ktKnob.getBoundingClientRect(), vr = view.getBoundingClientRect(), tw = t.offsetWidth || 160;
  place(t, clamp(r.left + r.width / 2 - vr.left - tw / 2, 8, vr.width - tw - 8), Math.max(8, r.top - vr.top - (t.offsetHeight || 54) - 10));
  t.classList.add('on');
}
const rigKnob = (el) => { const kn = el?.closest?.('.kn'); return kn && kn.closest('.slot, .head') ? kn : null; };
document.addEventListener('pointerover', (e) => { const kn = rigKnob(e.target); if (kn) { ktKnob = kn; showKt(); } });
document.addEventListener('focusin', (e) => { const kn = rigKnob(e.target); if (kn) { ktKnob = kn; showKt(); } });
function keepKt() { if (ktKnob && !(ktKnob.matches(':hover') || ktKnob.classList.contains('drag') || ktKnob.contains(document.activeElement))) { ktKnob = null; } showKt(); }

/* ================================================================================================ the frame: where you are, the strip, the way back */
function renderWhere() {
  const el = $('where');
  const Z = { head: 'Your amp', cab: 'Your cab’s grille', kit: 'The drummer’s book', board: 'Your board', tuner: 'The tuner', tape: 'The tape machine', gs: 'Getting started', wall: 'The amp wall', case: 'The pedal case', 'tryout-head': 'Your amp', 'tryout-cab': 'Your cab’s grille' };
  const crumbs = [h('button', { type: 'button', onclick: () => { if (S.place === 'shop') leaveShop(); else if (!S.gs) zoom('stage'); } }, 'The metal club')];
  if (S.place === 'stage') crumbs.push(h('span.sep', '/'), S.cam === 'stage' ? h('b', 'The stage') : h('button', { type: 'button', onclick: () => back() }, 'The stage'));
  else { crumbs.push(h('span.sep', '/'), S.cam.startsWith('tryout') ? h('button', { type: 'button', onclick: () => zoom(S.area) }, 'The shop') : h('b', 'The shop')); if (S.cam.startsWith('tryout')) crumbs.push(h('span.sep', '/'), h('b', Z[S.cam])); }
  if (S.place === 'stage' && S.cam !== 'stage') crumbs.push(h('span.sep', '/'), h('b', Z[S.cam] || S.cam));
  fill(el, crumbs);
}
// one way back, in the bar, saying where it goes; and in the shop, the way to turn
function renderBack() {
  const b = $('backout');
  let label = null;
  if (S.place === 'stage') label = S.cam !== 'stage' && S.cam !== 'gs' ? 'Step back' : null;
  else label = S.cam.startsWith('tryout') ? 'Step back' : 'Back to the stage';
  b.hidden = !label;
  if (label) fill(b, label, kbd('Esc'));
  b.onclick = back;
  const t = $('turns');
  t.hidden = S.place !== 'shop';
  if (S.place === 'shop') fill(t,
    h('button.tbtn', { type: 'button', 'aria-pressed': String(S.cam === 'wall'), onclick: () => turn('wall') }, 'Amp wall', kbd('A')),
    h('button.tbtn', { type: 'button', 'aria-pressed': String(S.cam === 'case'), onclick: () => turn('case') }, 'Pedal case', kbd('P')));
}
function renderStrip() {
  const st = $('strip');
  const t = S.talk, isFresh = now() - t.at < 4000;
  const drawer = h('div.drawer' + (S.drawer ? '.on' : ''),
    h('div', h('h4', 'Riffs', h('span', `${S.riffs.length} this session, 166 in the library`)),
      S.riffs.length ? S.riffs.map((r) => { const c = h('canvas', { width: 240, height: 52 }); requestAnimationFrame(() => { const g = c.getContext('2d'), s = riffShape(r.seed, r.bars, 120); g.fillStyle = '#cbc0aa'; s.forEach((v, i) => g.fillRect(i * 2, 26 - v * 22, 1.4, v * 44)); }); return h('div.riff', c, h('b', r.name), h('span.t3', `${r.bars} bars, ${r.tempo}`)); }) : h('p.t3', 'Riffs you keep off the tape land here. Click the tape machine, or G.')),
    h('div', h('h4', 'The part line', h('span', S.parts.length ? `${S.parts.length} parts` : 'empty')), h('div.partline', S.parts.length ? S.parts.map((p) => h('div.part', h('b', p.name), h('div.t3', `${p.bars} bars`))) : 'Drop a riff here, or press R to record a part.')));
  fill(st,
    h('div.tb', h('i.lamp' + (isFresh ? '.on' : '')), S.talking ? h('input.talkin', { id: 'talkin', placeholder: 'Ask Claude through the glass: “give me a beat that’s more thrash”', onkeydown: (e) => { if (e.key === 'Enter') { ask(e.target.value); e.preventDefault(); } if (e.key === 'Escape') { S.talking = false; renderStrip(); } e.stopPropagation(); } })
      : h('span.line', t.by === 'claude' ? [h('span.by-agent', 'Claude'), ' '] : null, t.text)),
    h('button.chipbtn', { type: 'button', onclick: () => { S.talking = true; renderStrip(); setTimeout(() => $('talkin')?.focus(), 10); } }, 'Talk to Claude', kbd('/')),
    h('button.chipbtn', { type: 'button', onclick: () => { S.drawer = !S.drawer; renderStrip(); } }, h('b', 'Riffs'), String(S.riffs.length), h('span.t3', '·'), h('b', 'Part line'), S.parts.length ? String(S.parts.length) : 'empty', S.drawer ? '▾' : '▴'),
    drawer);
}
function ask(text) {
  S.talking = false; say(`You: “${text}”`, null);
  setTimeout(() => {
    if (/thrash|beat|drum|faster|groove/i.test(text)) {
      const i = S.pins.findIndex((p) => /gallop/i.test(p.short));
      setPin(i >= 0 ? i : 2);
      say('Gallop from your riser, at the next bar: double kick under the ride. ⌘Z puts the guide back.', 'claude');
    } else if (/tight|chug|gate/i.test(text)) {
      say('Snapper’s threshold up to −52 dB and Kraken’s bass down a hair, on this song’s copy. ⌘Z undoes both.', 'claude');
    } else say('I can swap the beat, change a knob, grab the last riff off the tape or name the parts. Which?', 'claude');
  }, 700);
}

/* ================================================================================================ keys */
// grabbing a knob gives it the keys, so the arrows nudge what your hand is on rather than the tempo
addEventListener('pointerdown', (e) => { const kn = e.target.closest?.('[role=slider], .kn [tabindex]'); if (kn) kn.focus({ preventScroll: true }); }, true);
addEventListener('keydown', (e) => {
  const tgt = e.target;
  if ((tgt instanceof HTMLInputElement && tgt.type !== 'range') || tgt instanceof HTMLSelectElement || tgt instanceof HTMLTextAreaElement) { if (e.key === 'Escape') tgt.blur(); return; }
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); back(); return; }
  if (e.metaKey && k === 's') { e.preventDefault(); if (S.changed) { S.changed = false; say('Saved to the rack. Any song can load it.'); renderPanel(); } return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // a focused knob (or range) takes only its own keys: arrows, Page Up/Down, Home, End. Everything else is the room's.
  if ((tgt.closest?.('.kn') || tgt.type === 'range') && /^(Arrow|Page|Home|End)/.test(k)) return;
  if (S.tape && k === 'Enter') { e.preventDefault(); keepRiff(); return; }
  if (k === ' ') { e.preventDefault(); drummer(); return; }
  if (k === '/') { e.preventDefault(); S.talking = true; renderStrip(); setTimeout(() => $('talkin')?.focus(), 10); return; }
  if (/^[1-8]$/.test(k)) { stomp(+k); return; }
  if (S.place === 'shop') {
    const lk = k.toLowerCase();
    if (lk === 'a') return turn('wall');
    if (lk === 'p') return turn('case');
    if (lk === 't') return tuner();
    if (lk === 'h') return zoom('tryout-head');
    if (lk === 'c') return zoom('tryout-cab');
    if (S.cam === 'case' && (k === '[' || k === ']')) { const cats = shopLayout.plates.map((p) => p.dataset.cat), i = cats.indexOf(S.caseCat); showCat(cats[(i + (k === ']' ? 1 : cats.length - 1)) % cats.length], tgt.classList?.contains('plate-cat')); return; }
    if (!k.startsWith('Arrow')) return;
    e.preventDefault();
    if (S.cam === 'wall') { if (tgt.classList?.contains('amp-slot')) spatial(tgt, k, shopLayout.amps); else shopLayout.amps[0]?.focus(); return; }
    if (S.cam === 'case') {
      if (tgt.classList?.contains('plate-cat')) {
        const i = shopLayout.plates.indexOf(tgt);
        if (k === 'ArrowDown' || k === 'ArrowUp') { const n = shopLayout.plates[clamp(i + (k === 'ArrowDown' ? 1 : -1), 0, shopLayout.plates.length - 1)]; showCat(n.dataset.cat); n.focus(); }
        else if (k === 'ArrowRight') shopLayout.pedals[0]?.focus();
        return;
      }
      if (tgt.classList?.contains('ped-slot')) { if (!spatial(tgt, k, shopLayout.pedals) && k === 'ArrowLeft') shopLayout.plates.find((p) => p.dataset.cat === S.caseCat)?.focus(); return; }
      shopLayout.pedals[0]?.focus();
    }
    return;
  }
  if (S.gs) { if (k.toLowerCase() === 't' && S.gs.step === 'tune') tuner(); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); tempo(-1); return; }
  if (k === 'ArrowRight') { e.preventDefault(); tempo(1); return; }
  const map = { h: () => zoom('head'), c: () => zoom('cab'), k: () => zoom('kit'), b: () => zoom('board'), t: () => tuner(), g: () => openTape(), s: () => enterShop('wall') };
  const f = map[k.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
});
// the nearest item in a direction, among the ones you're looking at
function spatial(from, key, list) {
  const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null;
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const ok = key === 'ArrowRight' ? dx > 4 && Math.abs(dy) < a.height * 0.6 : key === 'ArrowLeft' ? dx < -4 && Math.abs(dy) < a.height * 0.6 : key === 'ArrowDown' ? dy > 4 : dy < -4;
    if (!ok) continue;
    const d = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 0.6;
    if (!best || d < best.d) best = { el, d };
  }
  best?.el.focus();
  return !!best;
}

/* ================================================================================================ the loop: fake signals */
const CHUG = 'X.xx.xX.x.xxX.x.';
function envOf(row, st) { const i = Math.floor(st); for (let k = 0; k < 16; k++) { const s = i - k; if (s < 0) break; const v = row[((s % 16) + 16) % 16]; if (v) return (v === 2 ? 1 : 0.75) * Math.exp(-(st - s) * 1.7); } return 0; }
let lastBar = null;
function frame(t) {
  requestAnimationFrame(frame);
  const tt = S.freeze ?? t;
  const d = S.drummer, run = d.on;
  const beat = run ? ((tt - d.t0) * S.tempo) / 60000 : 0;
  const bar = run ? Math.floor(beat / 4) + 1 : null;
  if (run && bar !== lastBar && d.next != null) { d.pin = d.next; d.next = null; renderCards(); renderTransport(); }
  lastBar = bar;
  const p = S.pins[d.pin], st = beat * 4;
  const hits = run ? { kick: envOf(p.grid.kick, st), snare: envOf(p.grid.snare, st), hat: /hat|ride/.test(p.grid.topName) ? envOf(p.grid.top, st) : 0, crash: /crash|china/.test(p.grid.topName) ? envOf(p.grid.top, st) * 0.7 : 0, tom: envOf(p.grid.toms, st) } : { kick: 0, snare: 0, hat: 0, crash: 0, tom: 0 };
  // your guitar: a palm-muted chug with the drummer, a strum now and then without
  let gtr = 0;
  if (S.plugged && S.plugT >= 1) {
    if (run) { const i = Math.floor(st); for (let k = 0; k < 8; k++) { const s = i - k; if (s < 0) break; const c = CHUG[((s % 16) + 16) % 16]; if (c !== '.') { gtr = (c === 'X' ? 0.95 : 0.7) * Math.exp(-(st - s) * 1.1); break; } } }
    else { const q = tt % 2600; gtr = q < 1400 ? 0.85 * Math.exp(-q / 420) : 0.02; }
  }
  const muted = S.tuner.on;
  // the tuner: the needle settles onto each string in turn, and the talkback says which
  if (S.tuner.on) {
    const T = S.tuner, tn = TUNINGS.find((x) => x.id === S.tuning);
    if (T.done.length < 6 && !T.still) {
      T.cents += (0 - T.cents) * 0.025 + (Math.random() - 0.5) * 0.9;
      if (Math.abs(T.cents) < 2.5) {
        T.hold += 1;
        if (T.hold > 30) {
          T.done.push(T.str); T.hold = 0;
          if (T.done.length >= 6) say(`All six in tune for ${tn.name}. Stomp it off.`);
          else { const was = tn.notes[T.str]; T.str = Math.min(5, T.str + 1); say(`${was} string’s in. Now the ${tn.notes[T.str]} (string ${6 - T.str}).`); }
          T.cents = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16);
          if (S.cam === 'tuner') renderPanel();
        }
      } else T.hold = 0;
    }
    FACES.get((S.place === 'stage' ? 'stage' : 'shop') + ':tuner')?.face.update();
    const ts = $('tunesay'); if (ts) ts.textContent = tunerWords();
  }
  if (S.place === 'stage' && stageRig) {
    stageRig.head.face.meter(muted || !S.ampOn ? 0 : gtr);
    // the input meter: peaks from the interface's gain
    const lv = gtr > 0.03 ? S.gainDb + 20 * Math.log10(gtr) : -80;
    const m = stageRig.meter;
    if (m) {
      const leds = m.querySelectorAll('.leds i');
      leds.forEach((l, i) => l.classList.toggle('on', -60 + i * 2.5 <= lv));
      if (lv >= (m._peak ?? -80) || now() - (m._at || 0) > 1600) { m._peak = Math.max(lv, (m._peak ?? -80) - 0.6); if (lv >= m._peak) m._at = now(); }
      $('indb').textContent = m._peak > -60 ? `${minus(Math.round(m._peak))} dBFS` : '–';
      m.classList.toggle('lit', S.gs?.step === 'plug' && S.plugged);
    }
    if (gLive) {
      const tap = S.tapAt ? Math.max(0, 1 - (now() - S.tapAt) / 180) : 0;
      const live = { ...hits, reduced: REDUCED, count: S.count, tap, rolling: S.plugged, spin: (tt / 1000) * 2.2, bar, input: muted ? 0 : gtr, hot: S.tape != null };
      drawStageLive(gLive, live); drawKit(gKit, live);
    }
    const tb = $('tpbar'); if (tb) tb.textContent = bar ? `BAR ${bar}` : 'BAR –';
  }
  if (S.place === 'shop' && shopRig) shopRig.head.face.meter(muted ? 0 : gtr);
  if (ktKnob) keepKt();
}

/* ================================================================================================ the screens */
const SCREENS = [
  ['Getting started', [['gs-plug', 'Plug in: pick the input'], ['gs-plug-jack', 'Plug in: the plug in the jack, close'], ['gs-plug-in', 'Plug in: the meter in the window'], ['gs-tune', 'Tune: the tuner on the floor'], ['gs-tune-on', 'Tune: stomped, close up'], ['gs-time', 'Timing: eight clicks'], ['gs-time-done', 'Timing: measured'], ['gs-sound', 'Your sound: the door'], ['gs-tour-board', 'The tour: your board'], ['gs-tour-kit', 'The tour: the drummer'], ['gs-tour-door', 'The tour: the shop door']]],
  ['The stage', [['stage', 'The stage, quiet'], ['stage-jam', 'Jamming: the drummer on'], ['stage-knob', 'Turning a knob: its value, large'], ['drawer', 'Riffs and the part line open']]],
  ['Closer', [['zoom-head', 'Your amp'], ['zoom-cab', 'Your cab: the mics'], ['zoom-cab-2', 'Your cab: a second mic'], ['zoom-kit', 'The drummer’s book'], ['zoom-board', 'Your board'], ['zoom-tuner', 'The tuner'], ['tape', 'The tape machine: the last minute']]],
  ['The shop', [['shop-wall', 'The amp wall'], ['shop-look-amp', 'Looking at an amp'], ['shop-case', 'The pedal case: drive'], ['shop-look-pedal', 'Looking at a pedal'], ['shop-case-mod', 'The pedal case: modulation, the fullest drawer'], ['shop-after', 'Megalodon and Clam Shut carried in'], ['shop-tryout', 'The try-out corner: your amp, closer'], ['shop-tryout-cab', 'The try-out corner: your cab']]],
];
function renderMenu() {
  const m = $('screenmenu');
  fill(m, SCREENS.map(([title, list]) => [h('h4', title), list.map(([id, label]) => h('li', h('button', { type: 'button', onclick: () => { closeMenu(); go(id); } }, label)))]));
}
function closeMenu() { $('screenmenu').hidden = true; $('screensbtn').setAttribute('aria-expanded', 'false'); }
$('screensbtn').addEventListener('click', () => { const m = $('screenmenu'); m.hidden = !m.hidden; $('screensbtn').setAttribute('aria-expanded', String(!m.hidden)); });
$('gsbtn').addEventListener('click', () => startGS(S.gsPaused || 'plug'));
addEventListener('click', (e) => { if (!e.target.closest('#screens')) closeMenu(); });

async function reset() {
  for (const f of FACES.values()) f.face.destroy?.();
  FACES.clear();
  S = fresh();
  ktKnob = null; showKt();
  $('callout').hidden = true; sp().hidden = true; $('tapesheet').hidden = true; $('book').hidden = true;
  $('shop').hidden = true; $('dock').hidden = true; $('stage').hidden = false; $('view').classList.remove('dock-close');
  S.place = 'stage'; S.cam = 'stage';
  buildStage();
  zoom('stage', false);
  renderStrip(); renderTransport(); renderGsBtn();
}
async function go(id) {
  await reset();
  const jam = () => { S.drummer.on = true; S.drummer.t0 = now() - (7 * 4 + 1.3) * (60000 / S.tempo); renderTransport(); };
  const shop = async (area) => { enterShop(area); await wait(1500); };
  const find = (list, id2) => list.find((s) => s.dataset.id === id2);
  switch (id) {
    case 'stage': break;
    case 'stage-jam': jam(); S.drummer.pin = 1; renderCards(); renderTransport(); say('Djent at 132. The tape’s rolling: click the machine, or G, for what you just played.'); break;
    case 'stage-knob': { S.ampParams.gain = 7.4; stageRig.head.face.update(paramValues(ampDef(), S.ampParams), S.ampOn); const kn = stageRig.head.el.querySelector('.kn'); ktKnob = kn; kn.classList.add('drag'); showKt(); say('Gain 7.4 on Kraken. This song’s copy; Save to rack keeps it.'); break; }
    case 'drawer': S.riffs = [{ name: 'Riff 1', bars: 4, tempo: 132, seed: 11 }, { name: 'Riff 2', bars: 2, tempo: 132, seed: 12 }]; S.drawer = true; renderStrip(); break;
    case 'gs-plug': startGS('plug'); break;
    case 'gs-plug-jack': startGS('plug'); S.plugged = true; S.plugT = 1; S.ring = true; S.gs.close = true; rebuildRigs(); renderCallout(); gsCam(false); break;
    case 'gs-plug-in': startGS('plug'); S.plugged = true; S.plugT = 1; S.gainDb = -8.5; rebuildRigs(); renderCallout(); gsCam(false); break;
    case 'gs-tune': startGS('tune'); break;
    case 'gs-tune-on': startGS('tune'); tuner(true); Object.assign(S.tuner, { done: [0, 1], str: 2, cents: -9, still: true }); renderPanel(); renderCallout(); say(tunerWords()); break;
    case 'gs-time': startGS('time'); S.count = 5; S.tapAt = now(); S.gs.strums = [10, 12, 9, 11, 13]; renderCallout(); break;
    case 'gs-time-done': startGS('time'); S.gs.strums = [10, 12, 9, 11, 13, 10, 12, 11]; S.gs.timed = true; renderCallout(); break;
    case 'gs-sound': startGS('sound'); break;
    case 'gs-tour-board': startGS('tour'); S.tour = 2; renderCallout(); gsCam(false); break;
    case 'gs-tour-kit': startGS('tour'); S.tour = 3; renderCallout(); gsCam(false); break;
    case 'gs-tour-door': startGS('tour'); S.tour = 5; renderCallout(); gsCam(false); break;
    case 'zoom-head': zoom('head'); break;
    case 'zoom-cab': zoom('cab'); break;
    case 'zoom-cab-2': S.cab.mic._ang = -2.4; S.cab.mic.pos = 0.34; addMic2(); zoom('cab'); break;
    case 'zoom-kit': jam(); zoom('kit'); break;
    case 'zoom-board': zoom('board'); break;
    case 'zoom-tuner': tuner(true); Object.assign(S.tuner, { done: [0, 1, 2], str: 3, cents: 6, still: true }); renderPanel(); say(tunerWords()); break;
    case 'tape': jam(); openTape(); break;
    case 'shop-wall': await shop('wall'); break;
    case 'shop-look-amp': await shop('wall'); find(shopLayout.amps, 'amp.metal')?.focus(); break;
    case 'shop-case': await shop('case'); break;
    case 'shop-case-mod': await shop('case'); showCat('mod'); break;
    case 'shop-look-pedal': await shop('case'); showCat('dynamics'); find(shopLayout.pedals, 'pedal.squish')?.focus(); break;
    case 'shop-after': await shop('wall'); takeAmp('amp.metal', find(shopLayout.amps, 'amp.metal')); await wait(700); turn('case'); showCat('dynamics'); await wait(700); takePedal('pedal.clamshut', find(shopLayout.pedals, 'pedal.clamshut')); await wait(700); break;
    case 'shop-tryout': await shop('wall'); zoom('tryout-head'); break;
    case 'shop-tryout-cab': await shop('wall'); zoom('tryout-cab'); break;
  }
}

/* ================================================================================================ start */
renderMenu();
buildStage();
zoom('stage', false);
renderStrip(); renderTransport();
addEventListener('resize', () => {
  if (S.place === 'shop') { buildDock(); zoom(S.cam, false); }
  else if (S.cam === 'gs') gsCam(false);
  else zoom(S.cam, false);
  if (S.tape) renderTape();
});
requestAnimationFrame(frame);
window.mock = { go, get state() { return S; }, zoom, startGS };
