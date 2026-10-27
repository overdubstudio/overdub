// The guitar room, second mock (design/mock/guitar-room-2/; the design is docs/research/GUITAR-ROOM.md, with this
// round's changes to §2.1, §2.2 and §2.9). The screen is the stage seen from the front: your amp head on your cab, your
// board along the front at full size, the drummer's riser, the tape machine and the door to the shop. Going closer is
// the camera dollying in (the head, the cab's grille and its mics, the drummer's book, the board, the tuner); Esc steps
// back out. The shop is a room through the door: the amp wall in labelled sections, the pedals in a glass case by type,
// your stack in the try-out corner. Getting started happens in the room, under the engineer's spotlight.
//
// No sound and no mic: the meters, the tuner, the drummer and the tape are fake state moved by one animation loop. The
// gear is the studio's real faces (app/src/ui/faces.js) of the real devices (app/vendor/clawd/), crisp in front of the
// pixel rooms (./room-pixels.js). window.mock.go(id) jumps to a screen (the Screens menu does the same).

import { renderFace, AMP_LOOK_IDS, hashId } from '/app/src/ui/faces.js';
import { paramValues } from '/app/src/devices/registry.js';
import { evaluate as evalLooks } from '/app/src/devices/guitar/looks.gen.js';
import { clawd } from '/app/src/devices/guitar/clawd.js';
import {
  getDevice, ampsBySection, pedalsByShelf, toneWord, CAT_WORD, RANK, inLoop, CABS, MICS, MIC_IDS, GUITAR_CABS, cabBox, whereOnCone, inches,
  HOUSE, TUNER, TUNINGS, gridOf, library, PINS, GUIDE, riffShape,
} from './data.js';
import { sizeRoom, drawStage, drawStageLive, drawShop, STAGE, SHOP, PX } from './room-pixels.js';

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
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const kbd = (t) => h('kbd', t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = () => performance.now();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const place = (el, x, y, w, hh) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (w != null) el.style.width = w + 'px'; if (hh != null) el.style.height = hh + 'px'; return el; };
const fmt1 = (v) => Number(v).toFixed(1);
const minus = (n) => String(n).replace('-', '−');
const LOOKS = evalLooks({ FONTS: { dirt: '"Rubik Dirt", Impact, "Arial Black", sans-serif', pixel: 'Silkscreen, ui-monospace, monospace' }, PLUG_AMPS: clawd.PLUG_AMPS });
const ampLookId = (d) => (d.look?.amp && LOOKS.AMP_LOOKS[d.look.amp] ? d.look.amp : d.amp && LOOKS.AMP_LOOKS[d.amp] ? d.amp : AMP_LOOK_IDS[hashId(d.id) % AMP_LOOK_IDS.length]);
const nameOf = (id) => (id === 'tuner' ? TUNER.name : getDevice(id)?.name || id);

/* ================================================================================================ state */
const LIB = library();
let uidN = 1;
const uid = () => 'u' + uidN++;
function fresh() {
  return {
    place: 'stage', cam: 'stage',
    amp: HOUSE.amp, ampOn: true, ampParams: { ...HOUSE.ampParams },
    cab: JSON.parse(JSON.stringify(HOUSE.cab)),
    board: HOUSE.board.map((b) => ({ ...b, uid: uid(), params: {} })),
    changed: false,
    tempo: 132, tuning: 'dropc',
    drummer: { on: false, t0: 0, pin: 0, next: null },
    pins: PINS.map((p) => ({ ...p, grid: gridOf(LIB.byId.get(p.id) || GUIDE), edited: false })),
    plugged: true, iface: 'Scarlett Solo USB', input: 'Input 2', gainDb: -8.5, latency: 11,
    tuner: { on: false, str: 0, cents: -24, done: [], hold: 0 },
    gs: null, tour: 0,
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
const view = $('view');
const WORLDS = { stage: { el: $('stage'), w: STAGE.w, h: STAGE.h }, shop: { el: $('shop'), w: SHOP.w, h: SHOP.h } };
const cam = { s: 1, x: 0, y: 0 };
const W = () => WORLDS[S.place];
function vsize() { return { w: view.clientWidth, h: view.clientHeight }; }
// frame a world rect into the view, leaving room for a panel on the right or a sheet at the bottom
function frameRect(R, { right = 0, bottom = 0, pad = 24, maxS = 4.2 } = {}) {
  const { w, h: hh } = vsize(), aw = w - right - pad * 2, ah = hh - bottom - pad * 2;
  const s = Math.min(aw / R.w, ah / R.h, maxS);
  return { s, x: pad + (aw - R.w * s) / 2 - R.x * s, y: pad + (ah - R.h * s) / 2 - R.y * s };
}
function overview(R) {
  const { w, h: hh } = vsize(), s = Math.min(w / R.w, hh / R.h);
  return { s, x: (w - R.w * s) / 2 - R.x * s, y: (hh - R.h * s) / 2 - R.y * s };
}
function setCam(c, glide = true) {
  const el = W().el;
  el.classList.toggle('glide', glide && !REDUCED);
  el.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
  Object.assign(cam, c);
}
// a world rect -> the screen (the view's own coordinates), with the camera where it's going
const toView = (R) => ({ x: cam.x + R.x * cam.s, y: cam.y + R.y * cam.s, w: R.w * cam.s, h: R.h * cam.s });
// an element's box in world units, wherever the camera is right now
function worldBox(el) {
  const wr = W().el.getBoundingClientRect(), s = wr.width / W().w, r = el.getBoundingClientRect();
  return { x: (r.left - wr.left) / s, y: (r.top - wr.top) / s, w: r.width / s, h: r.height / s };
}

/* ================================================================================================ the faces */
const FACES = new Map();
// a real face, cached by key; `natural` is its unscaled size
function face(key, def, values, on, opts = {}) {
  let f = FACES.get(key);
  if (!f || f.def !== def) {
    f?.face.destroy();
    f = { def, face: renderFace(def, values, { on, size: opts.size || 'full', onParam: opts.onParam, onToggle: opts.onToggle }) };
    FACES.set(key, f);
  } else f.face.update(values, on);
  return f.face;
}
// the room's tuner pedal
function tunerFace(key) {
  let f = FACES.get(key);
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
    el.querySelector('.tn-cents').textContent = on ? `${t.cents > 0 ? '+' : ''}${Math.round(t.cents)}¢` : '';
  } };
  FACES.set(key, { def: null, face: api });
  return api;
}

/* ================================================================================================ the rig */
// One builder for your stack wherever it stands (the stage, the try-out corner): the head on its cab, the mics in front,
// the board along the front, and the cables between them. g: { cx, floor, headZ, cabZ, board: {x, y, w, h}, pedZ, keys }
function buildRig(host, key, g) {
  host.querySelectorAll('.rigpart').forEach((n) => n.remove());
  const out = { slots: [] };
  // the cab, standing on the floor
  const box = cabBox(S.cab.cab), cw = box.w * g.cabZ, ch = box.h * g.cabZ, cx = g.cx - cw / 2, cy = g.floor - ch;
  const cab = buildCab(S.cab.cab, cw, ch, key);
  place(cab, cx, cy, cw, ch); cab.classList.add('rigpart', 'zoomable');
  cab.addEventListener('click', (e) => { if (e.target.closest('.mic') && cab.classList.contains('open')) return; if (S.place === 'stage' || key === 'shop') zoom('cab'); });
  host.append(cab);
  out.cab = { x: cx, y: cy, w: cw, h: ch, el: cab };
  // the head, sat on top of it (the face's compact form is the head alone)
  const def = ampDef();
  const f = face(key + ':amp:' + S.amp, def, paramValues(def, S.ampParams), S.ampOn, { size: 'compact',
    onParam: (k, v, { commit }) => { S.ampParams[k] = v; if (commit) { changed(); if (S.cam === 'head' || S.cam === 'tryout-head') renderPanel(); say(`${def.params.find((p) => p.key === k)?.label?.[0] + (def.params.find((p) => p.key === k)?.label || k).slice(1).toLowerCase()} ${fmt1(v)} on ${def.name}. This song’s copy; Save to rack keeps it.`); syncFaces(key); } },
    onToggle: (on) => { S.ampOn = on; say(on ? `${def.name} is back in.` : `${def.name} bypassed: you’re hearing the board and the cab.`); syncFaces(key); } });
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
  const mics = [S.cab.mic, S.cab.mic2].filter(Boolean);
  mics.forEach((m, i) => { const el = buildMic(m, i, out.cab, key); host.append(el); out.mics.push(el); });
  // the board
  const B = g.board;
  const board = h('div.board.rigpart' + (S.cam === 'board' && key === 'stage' ? '.editing' : ''), h('div.board-rail'));
  place(board, B.x, B.y, B.w, B.h);
  board.addEventListener('click', (e) => { if (e.target === board || e.target.classList.contains('board-rail')) zoom(key === 'shop' ? 'tryout' : 'board'); });
  host.append(board);
  out.board = { ...B, el: board };
  // pedals: measured at their natural size, then set down in signal order (the loop's after the amp)
  const items = S.board.map((b) => {
    const isT = b.device === 'tuner';
    const d = isT ? null : getDevice(b.device);
    const fc = isT ? tunerFace(key + ':tuner') : face(key + ':' + b.uid, d, paramValues(d, b.params), b.on, {
      onParam: (k, v, { commit }) => { b.params[k] = v; if (commit) { changed(); say(`${d.name}: ${(d.params.find((p) => p.key === k)?.label || k).toLowerCase()} ${fmt1(v)}. This song’s copy.`); syncFaces(key); } },
      onToggle: () => stompUid(b.uid) });
    return { b, d, fc };
  });
  const tmp = h('div', { style: 'position:absolute;left:-9999px;top:0;visibility:hidden' });
  host.append(tmp);
  for (const it of items) { tmp.append(it.fc.el); it.nw = it.fc.el.offsetWidth || 120; it.nh = it.fc.el.offsetHeight || 182; }
  const inner = B.h - 34, gap = g.gap ?? 22, loopGap = key === 'shop' ? 30 : 46, addW = key === 'shop' ? 64 : 110;
  let z = g.pedZ;
  const span = (zz) => items.reduce((a, it) => a + it.nw * Math.min(zz, (inner - 6) / it.nh) + gap, 0) + loopGap + addW + 40;
  while (span(z) > B.w && z > 0.3) z -= 0.02;
  let x = B.x + 22, n = 0, loopAt = null;
  items.forEach((it, i) => {
    if (it.d && inLoop(it.d) && loopAt == null) { loopAt = x + 4; x += loopGap; }
    const zz = Math.min(z, (inner - 6) / it.nh), w = it.nw * zz, hh2 = it.nh * zz;
    const y = B.y + B.h - 26 - hh2;
    const isT = it.b.device === 'tuner';
    if (!isT) n++;
    const k = isT ? 'T' : String(n);
    const slot = h('div.slot.rigpart' + (it.b.on || isT ? '' : '.off'), { dataset: { uid: it.b.uid } },
      h('div.face', { style: `transform:scale(${zz})` }, it.fc.el),
      g.keys ? h('span.keycap', { style: `top:${hh2 + 6}px` }, k, isT ? h('b', S.tuner.on ? 'on' : 'off') : h('b', it.b.on ? 'on' : 'off')) : null,
      isT ? null : h('button.rm', { type: 'button', title: `Take ${it.d.name} off the board`, 'aria-label': `Take ${it.d.name} off the board`, onclick: (e) => { e.stopPropagation(); removePedal(it.b.uid); } }, '×'));
    place(slot, x, y, w, hh2);
    slot.addEventListener('click', (e) => { if (e.target.closest('.kn, button, input, select, .pd-sw')) return; if (key === 'stage' && S.cam === 'stage') zoom(isT ? 'tuner' : 'board'); });
    host.append(slot);
    out.slots.push({ uid: it.b.uid, x, y, w, h: hh2, el: slot, b: it.b, d: it.d });
    // its hang tag, shown when you're close to the board
    if (key === 'stage' && !isT) {
      const t = h('div.btag.rigpart', h('small', `${it.d.kindLabel} · ${CAT_WORD[it.d.pedalCat] || ''}`), h('b', it.d.name), h('div', it.d.blurb), h('div.nod', `Tips its hat to ${it.d.nod}.`),
        h('div.mv', h('button', { type: 'button', 'aria-label': `Move ${it.d.name} earlier`, onclick: () => movePedal(it.b.uid, -1) }, '←'), h('button', { type: 'button', 'aria-label': `Move ${it.d.name} later`, onclick: () => movePedal(it.b.uid, 1) }, '→'), h('button', { type: 'button', onclick: () => removePedal(it.b.uid) }, 'Off the board')));
      t.dataset.cx = x + w / 2; t.dataset.y = y;
      host.append(t);
    }
    x += w + gap;
  });
  tmp.remove();
  let right = -1e9;
  const tagBase = Math.min(...out.slots.map((q) => q.y)) - 14;
  for (const t of host.querySelectorAll('.btag')) { const tw = 158, tx = Math.max(+t.dataset.cx - tw / 2, right + 8); place(t, tx, tagBase - (t.offsetHeight || 150), tw); right = tx + tw; }
  if (loopAt != null) { const lm = h('div.loop-mark.rigpart', h('span', 'AMP’S LOOP')); place(lm, loopAt, B.y, null, B.h); host.append(lm); }
  const add = h('button.addslot.rigpart', { type: 'button', onclick: () => (key === 'shop' ? turn('case') : enterShop('case')) }, key === 'shop' ? '+ the case' : '+ pedal (the shop’s case)');
  place(add, x + 6, B.y + B.h - 26 - 150 * Math.min(1, z / 0.9), addW, 150 * Math.min(1, z / 0.9));
  host.append(add);
  out.add = { x: x + 6, y: B.y + 20, w: addW, h: 150, el: add };
  // the jack the guitar goes into (the first pedal's input)
  const first = out.slots[0];
  if (first) { const j = h('div.jack.rigpart' + (S.plugged ? '.lit' : ''), { id: key + '-jack' }); place(j, first.x - 6, first.y + first.h * 0.32); host.append(j); out.jack = { x: first.x - 1, y: first.y + first.h * 0.32 + 5 }; }
  return out;
}
function buildCab(id, w, hh, key) {
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
  el.append(gr, h('span.cab-logo', c.odd === 'fridge' ? 'Coldspot' : c.odd === 'box' ? 'THIS SIDE UP' : 'CLAWD-O-TONE'), h('span.cab-name', c.name),
    ...(c.odd ? [] : ['tl', 'tr', 'bl', 'br'].map((k) => h('i.cab-corner.' + k))), ...(c.odd ? [] : [h('i.cab-caster', { style: 'left:26px' }), h('i.cab-caster', { style: 'right:26px' })]));
  el._cones = coneList;
  if (S.cam === 'cab' || S.cam === 'tryout-cab') el.classList.add('open');
  return el;
}
// a mic in front of the grille: its place on its cone from pos (cone radii from the dust cap) and which side
function micPoint(m, cab) {
  const cones = cab.el._cones, cone = cones[Math.min(cones.length - 1, m.cone || 0)];
  const s = cab.w / (cabBox(S.cab.cab).w);
  return { x: cab.x + (cone.x + (m.side || 1) * m.pos * cone.r) , y: cab.y + cone.y - (m.up || 0) * cone.r, r: cone.r, s };
}
function buildMic(m, i, cab, key) {
  const p = micPoint(m, cab);
  const el = h('div.mic.rigpart.t-' + m.type + (i ? '.m2' : ''), { dataset: { i } },
    h('i.mic-stand'),
    h('i.mic-body', { title: `${MICS[m.type].name}: drag it across the cone` }),
    h('span.mic-tag', `${i ? 'Mic 2: ' : ''}${MICS[m.type].name}, ${whereOnCone(m.pos)}, ${inches(m.dist)}`));
  place(el, p.x, p.y);
  el._sc = clamp(1.25 - Math.log2(m.dist + 1) * 0.12, 0.7, 1.2) * Math.min(1, cab.w / 400);
  el.style.transform = `scale(${el._sc})`;
  el.querySelector('.mic-stand').style.height = (cab.y + cab.h - p.y + 6) / el._sc + 'px';
  // drag (only when you're close to the cab)
  el.querySelector('.mic-body').addEventListener('pointerdown', (e) => {
    if (!cab.el.classList.contains('open')) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.add('dragging');
    const body = e.currentTarget; body.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const wb = W().el.getBoundingClientRect(), s = wb.width / W().w;
      const wx = (ev.clientX - wb.left) / s, wy = (ev.clientY - wb.top) / s;
      // the nearest cone, and where on it
      let best = null;
      cab.el._cones.forEach((c, ci) => { const dx = wx - (cab.x + c.x), dy = wy - (cab.y + c.y), d = Math.hypot(dx, dy); if (!best || d < best.d) best = { ci, dx, dy, d, r: c.r }; });
      m.cone = best.ci; m.pos = Math.round(clamp(best.d / best.r, 0, 1.35) * 100) / 100; m.side = best.dx < 0 ? -1 : 1; m.up = clamp(-best.dy / best.r, -1.3, 1.3);
      m.pos = Math.round(clamp(Math.hypot(best.dx, best.dy) / best.r, 0, 1.35) * 100) / 100;
      // keep the drawn point where the pointer is (pos measured along the drag)
      const ang = Math.atan2(best.dy, best.dx);
      m.side = 1; m.up = 0; m._ang = ang;
      positionMic(el, m, cab);
      el.querySelector('.mic-tag').textContent = `${i ? 'Mic 2: ' : ''}${MICS[m.type].name}, ${whereOnCone(m.pos)}, ${inches(m.dist)}`;
      cab.el.querySelectorAll('.cone').forEach((c, ci) => c.classList.toggle('hot', ci === m.cone));
      if (S.cam === 'cab' || S.cam === 'tryout-cab') renderPanel();
    };
    const up = () => { el.classList.remove('dragging'); body.removeEventListener('pointermove', move); body.removeEventListener('pointerup', up); changed(); say(`${MICS[m.type].name} on the ${whereOnCone(m.pos)}, ${inches(m.dist)} back. ${m.pos < 0.4 ? 'Brighter' : m.pos > 0.82 ? 'Darker' : 'Rounder'}; this song’s copy.`); };
    body.addEventListener('pointermove', move); body.addEventListener('pointerup', up);
  });
  if (m._ang != null) positionMic(el, m, cab);
  return el;
}
function positionMic(el, m, cab) {
  const c = cab.el._cones[m.cone || 0], ang = m._ang ?? 0, r = m.pos * c.r;
  const x = cab.x + c.x + Math.cos(ang) * r, y = cab.y + c.y + Math.sin(ang) * r;
  place(el, x, y);
  el.querySelector('.mic-stand').style.height = (cab.y + cab.h - y + 6) / (el._sc || 1) + 'px';
}
function syncFaces(key) { /* the other rig shows the same values next time it's built */ }

function svgLayer(id) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'cables'); s.id = id; return s; }

/* ================================================================================================ the stage */
const ST = { cx: 308, floor: 552, headZ: 1.18, cabZ: 1, pedZ: 0.92, board: { x: 26, y: 584, w: 1392, h: 216 } };
let stageRig = null, gBg = null, gLive = null;
function buildStage() {
  const el = $('stage');
  el.replaceChildren();
  place(el, 0, 0, STAGE.w, STAGE.h);
  const bg = h('canvas.bg'), live = h('canvas.live');
  el.append(bg, live);
  gBg = sizeRoom(bg, STAGE.w, STAGE.h); gLive = sizeRoom(live, STAGE.w, STAGE.h);
  drawStage(gBg, { doorHover: false });
  el.append(svgLayer('cables'));
  // the hotspots: the kit (the drummer's book), the tape machine, the door
  const P = (v) => v * PX;
  const kitHot = h('button.hot.zoomable', { type: 'button', 'aria-label': 'The kit: open the drummer’s book (K)', dataset: { say: 'The drummer’s book  K' }, onclick: () => zoom('kit') });
  place(kitHot, 650, 268, 400, 192); el.append(kitHot);
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
  const cards = h('div', { id: 'cards' });
  el.append(cards);
  const bm = h('button.bookmark', { type: 'button', onclick: () => zoom('kit') }, 'The book  ', kbd('K'));
  place(bm, P(R.x + R.w) - 92, P(R.y) - 26);
  el.append(bm);
  renderStageRig();
  renderCards();
}
function renderStageRig() {
  const el = $('stage');
  stageRig = buildRig(el, 'stage', { cx: ST.cx, floor: ST.floor, headZ: ST.headZ, cabZ: ST.cabZ, board: ST.board, pedZ: ST.pedZ, keys: true });
  drawCables(el.querySelector('#cables'), stageRig, 'stage');
  if (S.cam === 'cab') stageRig.cab.el.classList.add('open');
}
function renderCards() {
  const el = $('cards'), R = STAGE.riser, x0 = R.x * PX + 196, y0 = R.y * PX + 8, cw = 56, gap = 5;
  el.replaceChildren(...S.pins.slice(0, 5).map((p, i) => {
    const g = p.grid;
    const b = h('button.bcard' + (S.drummer.next === i ? '.next' : ''), { type: 'button', 'aria-pressed': String(S.drummer.pin === i), title: (LIB.byId.get(p.id) || GUIDE).name + (p.edited ? ' (edited)' : ''), onclick: () => setPin(i) },
      h('span.mini', ['top', 'snare', 'kick'].map((r) => g[r].map((v) => h('i' + (v ? '.h' + v : ''))))),
      h('b', p.short), h('small', p.edited ? 'edited' : p.id === GUIDE.id ? 'the room’s' : (LIB.byId.get(p.id)?.part || '')));
    place(b, x0 + i * (cw + gap), y0, cw, 84);
    return b;
  }));
}
// the cables: the guitar into the first pedal, pedal to pedal, up the cab's side to the head's input, and the loop
function drawCables(svg, rig, key) {
  if (!svg || !rig) return;
  const ns = 'http://www.w3.org/2000/svg';
  const box = W().el === svg.closest('.world') ? null : null;
  const X = -480, Y = -120, Wd = (key === 'stage' ? STAGE.w : SHOP.w) + 960, Hd = 804 + 240;
  svg.setAttribute('viewBox', `${X} ${Y} ${Wd} ${Hd}`);
  place(svg, X, Y, Wd, Hd);
  svg.replaceChildren();
  const path = (d, lit) => {
    for (const [w, c] of [[8, '#050506'], [4, lit ? '#6a5a3a' : '#26262c']]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', c); p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round'); svg.append(p); }
  };
  const slots = rig.slots, pre = slots.filter((s) => !s.d || !inLoop(s.d)), post = slots.filter((s) => s.d && inLoop(s.d));
  const sideY = (s) => s.y + s.h * 0.32 + 5;
  // the guitar: from off the stage into the first pedal's input; or lying on the floor, unplugged
  if (slots[0]) {
    const j = { x: slots[0].x - 1, y: sideY(slots[0]) };
    const X0c = key === 'shop' ? rig.board.x - 80 : X;
    if (S.plugged) path(`M ${X0c} ${rig.board.y + rig.board.h + 30} C ${j.x - 220} ${rig.board.y + rig.board.h + 10}, ${j.x - 60} ${j.y + 60}, ${j.x - 4} ${j.y}`, S.gs?.step === 'plug');
    else path(`M ${X} ${rig.board.y + rig.board.h + 30} C ${X + 200} ${rig.board.y + rig.board.h + 20}, ${j.x - 140} ${rig.board.y + rig.board.h + 4}, ${j.x - 70} ${rig.board.y + rig.board.h - 12}`, true);
    if (!S.plugged) { const p = document.createElementNS(ns, 'rect'); p.setAttribute('x', j.x - 76); p.setAttribute('y', rig.board.y + rig.board.h - 17); p.setAttribute('width', 26); p.setAttribute('height', 10); p.setAttribute('rx', 2); p.setAttribute('fill', '#b8b8c0'); svg.append(p); }
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

/* ================================================================================================ the shop */
let shopRig = null, gShop = null, shopLayout = null;
const SHOPG = { cx: 1196, floor: 636, headZ: 0.9, cabZ: 0.8, pedZ: 0.6, board: { x: 848, y: 648, w: 588, h: 154 }, door: { x: 856, y: 330, w: 92, h: 306 } };
function buildShop() {
  const el = $('shop');
  el.replaceChildren();
  place(el, 0, 0, SHOP.w, SHOP.h);
  const bg = h('canvas.bg');
  el.append(bg);
  gShop = sizeRoom(bg, SHOP.w, SHOP.h);
  el.append(svgLayer('shopcables'));
  // the amp wall: two bands of sections, each with its sign and shelves
  const secs = ampsBySection(), by = Object.fromEntries(secs.map((s) => [s.tone, s]));
  const colW = 98, x0 = 26, bands = [{ y: 56, secs: [['clean', 3], ['crunch', 2], ['weird', 3]] }, { y: 350, secs: [['high', 5], ['bass', 3]] }];
  const signs = [], shelves = [];
  shopLayout = { amps: [], pedals: [] };
  for (const band of bands) {
    let col = 0;
    for (const [tone, cols] of band.secs) {
      const sec = by[tone], sx = x0 + col * colW, sw = cols * colW;
      signs.push({ label: sec.label, x: sx + 6, y: band.y, w: sw - 12 });
      for (let r = 0; r < 2; r++) shelves.push({ x: sx + 4, y: band.y + 64 + r * 122 + 92, w: sw - 8 });
      sec.amps.forEach((d, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const slot = ampSlot(d, sec);
        place(slot, sx + c * colW + 3, band.y + 64 + r * 122, colW - 6, 92);
        el.append(slot);
        shopLayout.amps.push(slot);
      });
      col += cols;
    }
  }
  // every amp in the same box, standing on its shelf
  for (const s of shopLayout.amps) { const e = s.querySelector('.ewf'), hh = e.offsetHeight; if (hh > 62) { e.style.transform = `scale(${62 / hh})`; } }
  // the try-out corner: the door back to the stage, your stack, and the ways to turn
  const D = SHOPG.door;
  const door = h('button.hot', { type: 'button', 'aria-label': 'The door back to the stage (Esc)', dataset: { say: 'The stage  Esc' }, onclick: () => leaveShop() });
  place(door, D.x, D.y, D.w, D.h); el.append(door);
  const toWall = h('button.turn', { type: 'button', onclick: () => turn('wall') }, '← The amp wall', kbd('A'));
  const toCase = h('button.turn', { type: 'button', onclick: () => turn('case') }, 'The pedal case →', kbd('P'));
  place(toWall, 950, 172); place(toCase, 1222, 172);
  const toStage = h('button.turn', { type: 'button', onclick: () => leaveShop() }, '← The stage', kbd('Esc'));
  place(toStage, D.x - 2, D.y - 54);
  el.append(toWall, toCase, toStage);
  // the case: shelves of pedals by type, labelled, behind glass
  const caseBox = { x: 1478, y: 112, w: 944, h: 604 };
  const shelvesP = pedalsByShelf(), pitch = 50, rowH = caseBox.h / shelvesP.length;
  const tmp = h('div', { style: 'position:absolute;left:-9999px;top:0;visibility:hidden' });
  el.append(tmp);
  shelvesP.forEach((groups, r) => {
    const y = caseBox.y + r * rowH;
    let x = caseBox.x + 12;
    for (const grp of groups) {
      const lab = h('span.case-label', grp.word.toUpperCase(), h('small', String(grp.pedals.length)));
      place(lab, x, y + 6); el.append(lab);
      for (const d of grp.pedals) {
        const f = renderFace(d, paramValues(d, {}), { size: 'full', on: true });
        tmp.append(f.el);
        const nw = f.el.offsetWidth || 132, nh = f.el.offsetHeight || 196, z = Math.min(44 / nw, 56 / nh);
        const slot = h('button.ped-slot', { type: 'button', dataset: { id: d.id }, 'aria-label': `${d.name}, ${d.kindLabel.toLowerCase()}: ${d.blurb}` }, h('div.face', { style: `width:${nw * z}px;height:${nh * z}px` }, h('div', { style: `transform:scale(${z});transform-origin:0 0;width:${nw}px` }, f.el)));
        place(slot, x + (pitch - 44) / 2, y + rowH - 10 - 58, 44, 58);
        wireLook(slot, () => ({ kind: 'pedal', d }));
        slot.addEventListener('click', () => takePedal(d.id, slot));
        el.append(slot);
        shopLayout.pedals.push(slot);
        x += pitch;
      }
      x += 16;
    }
    const sh = h('div.case-shelf'); place(sh, caseBox.x + 4, y + rowH - 10, caseBox.w - 8); el.append(sh);
  });
  tmp.remove();
  drawShop(gShop, { signs, shelves, caseBox, door: D });
  renderShopRig();
}
function ampSlot(d, sec) {
  const am = h('span.am', { style: `width:${d.amp === 'di' ? 64 : 80}px` }, h('i.am-top', h('i.am-pn', h('i'), h('i'), h('i'), h('i'), h('i.am-jw'))), h('i.am-cab', h('i.am-gr', h('i.am-face', h('i'), h('i')), h('i.am-lgw', h('b.am-lg', d.name)))));
  LOOKS.ampPaint(am, ampLookId(d));
  am.setAttribute('aria-hidden', 'true');
  const slot = h('button.amp-slot', { type: 'button', dataset: { id: d.id }, 'aria-label': `${d.name}, ${sec.word.toLowerCase()} amp: ${d.blurb}` }, h('span.ampbox', h('span.ewf', am)), h('span.plate', d.name));
  wireLook(slot, () => ({ kind: 'amp', d, sec }));
  slot.addEventListener('click', () => takeAmp(d.id, slot));
  return slot;
}
function renderShopRig() {
  const el = $('shop');
  el.classList.add('tryout');
  shopRig = buildRig(el, 'shop', { ...SHOPG, keys: false, gap: 12 });
  drawCables(el.querySelector('#shopcables'), shopRig, 'shop');
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
  if (!L) { card.classList.remove('on'); return; }
  const d = L.d;
  if (L.kind === 'amp') {
    const mine = d.id === S.amp;
    card.className = 'idcard';
    card.replaceChildren(h('div.in', h('span.sec', L.sec.label), h('h3.disp', d.name), h('p', d.blurb), h('p.nod', `In the spirit of ${d.nod}.`),
      h('div.do', mine ? 'On your stack now.' : ['Click or ', kbd('Enter'), ' to carry it to your stack and play through it'])));
  } else {
    const mine = pedalsOnly().some((b) => b.device === d.id);
    card.className = 'idcard tag';
    card.replaceChildren(h('div.in', h('span.sec', `${CAT_WORD[d.pedalCat] || d.pedalCat} · ${d.kindLabel}`), h('h3.disp', d.name), h('p', d.blurb), h('p.nod', `Tips its hat to ${d.nod}.`),
      h('div.do', mine ? ['On your board. ', kbd('Enter'), ' takes it off'] : ['Click or ', kbd('Enter'), ` to put it on your board${inLoop(d) ? ', in the amp’s loop' : ', before the amp'}`])));
  }
  const r = L.el.getBoundingClientRect(), vr = view.getBoundingClientRect();
  const cw = 300, chh = card.offsetHeight || 190;
  let x = r.right - vr.left + 14, y = r.top - vr.top - 8;
  if (x + cw > vr.width - 10) x = r.left - vr.left - cw - 14;
  y = clamp(y, 10, vr.height - chh - 10);
  place(card, x, y);
  card.classList.add('on');
}
// carrying something from the shop into your rig: a ghost flies from where it was to where it goes
function carry(fromEl, toBox, then) {
  const r = fromEl.getBoundingClientRect();
  const g = fromEl.cloneNode(true);
  g.classList.add('ghost'); g.classList.remove('look', 'taken');
  Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0 });
  document.body.append(g);
  const t = toView(toBox), vr = view.getBoundingClientRect();
  const sx = (t.w / r.width) * 0.8, tx = vr.left + t.x + t.w * 0.1 - r.left, ty = vr.top + t.y + t.h * 0.1 - r.top;
  requestAnimationFrame(() => requestAnimationFrame(() => { g.style.transform = `translate(${tx}px, ${ty}px) scale(${sx})`; g.style.opacity = '0.2'; }));
  setTimeout(() => { g.remove(); then(); }, REDUCED ? 10 : 560);
}
function takeAmp(id, slot) {
  if (id === S.amp) { say(`${getDevice(id).name} is already on your stack.`); return; }
  const was = ampDef();
  carry(slot.querySelector('.am') || slot, shopRig.head, () => {
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
  if (at >= 0) { const u = S.board[at].uid; removePedal(u); return; }
  if (pedalsOnly().length >= 8) { say('Eight pedals is a full board. Take one off first.'); return; }
  carry(slot.querySelector('.face') || slot, shopRig.add, () => {
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
  if (S.place === 'stage') { renderStageRig(); if (S.cam !== 'stage') zoom(S.cam, false); }
  else renderShopRig();
}

/* ================================================================================================ moving about */
const ZOOMS = {
  head: () => ({ R: pad(stageRig.head, 34, 70, 34, 30), right: 380 }),
  cab: () => ({ R: pad(stageRig.cab, 60, 30, 60, 26), right: 420 }),
  kit: () => ({ R: { x: 592, y: 230, w: 520, h: 340 }, right: Math.min(980, vsize().w - 330) + 28 }),
  board: () => { const s = stageRig.slots; const x = Math.min(...s.map((q) => q.x)) - 30, x2 = Math.max(...s.map((q) => q.x + q.w)) + 30; return { R: { x, y: 360, w: x2 - x, h: 444 }, right: 0, pad: 10 }; },
  tuner: () => { const t = stageRig.slots.find((q) => q.b.device === 'tuner'); return { R: pad(t, 50, 40, 50, 40), right: 380 }; },
  tape: () => ({ R: { x: STAGE.tape.x * PX - 60, y: STAGE.tape.y * PX - 40, w: STAGE.tape.w * PX + 120, h: 360 }, bottom: vsize().h * 0.48 }),
  wall: () => ({ R: { x: 0, y: 0, w: 1440, h: 804 }, over: true }),
  case: () => ({ R: { x: 940, y: 0, w: 1500, h: 804 }, over: true }),
  tryout: () => ({ R: { x: 844, y: 150, w: 596, h: 654 }, right: 360, pad: 16 }),
  'tryout-head': () => ({ R: pad(shopRig.head, 24, 30, 24, 24), right: 380 }),
  'tryout-cab': () => ({ R: pad(shopRig.cab, 40, 24, 40, 24), right: 420 }),
};
const pad = (b, l, t, r, bt) => ({ x: b.x - l, y: b.y - t, w: b.w + l + r, h: b.h + t + bt });
function zoom(to, glide = true) {
  if (S.place === 'stage' && ['wall', 'case', 'tryout', 'tryout-head', 'tryout-cab'].includes(to)) return;
  S.cam = to;
  document.body.classList.toggle('zoom-board', to === 'board');
  if (stageRig) { stageRig.cab.el.classList.toggle('open', to === 'cab'); stageRig.board.el.classList.toggle('editing', to === 'board'); }
  if (shopRig) shopRig.cab.el.classList.toggle('open', to === 'tryout-cab');
  const z = ZOOMS[to];
  if (!z) { setCam(overview({ x: 0, y: 0, w: STAGE.w, h: STAGE.h }), glide); }
  else { const o = z(); setCam(o.over ? overview(o.R) : frameRect(o.R, { right: o.right || 0, bottom: o.bottom || 0, pad: o.pad ?? 24 }), glide); }
  $('stage').classList.toggle('zoomed', S.place === 'stage' && to !== 'stage');
  renderPanel(); renderBook(); renderWhere(); renderBack();
  if (S.gs) setTimeout(renderSpot, glide ? 660 : 30);
  if (to !== 'wall' && to !== 'case') { S.look = null; showCard(); }
}
function back() {
  if ($('screenmenu').hidden === false) { closeMenu(); return; }
  if (S.talking) { S.talking = false; renderStrip(); return; }
  if (S.drawer) { S.drawer = false; renderStrip(); return; }
  if (S.tape) { closeTape(); return; }
  if (S.place === 'shop') {
    if (S.cam === 'tryout-head' || S.cam === 'tryout-cab') return zoom('tryout');
    if (S.cam === 'tryout') return zoom('wall');
    return leaveShop();
  }
  if (S.cam === 'tuner' && S.tuner.on) { tuner(false); }
  if (S.cam !== 'stage') zoom('stage');
}
function enterShop(area = 'wall') {
  if (S.place === 'shop') { turn(area); return; }
  if (S.tuner.on) tuner(false);
  // walk to the door, through it, and into the shop
  setCam(frameRect({ x: STAGE.door.x * PX - 10, y: STAGE.door.y * PX - 20, w: STAGE.door.w * PX + 20, h: STAGE.door.h * PX + 30 }, { maxS: 2.6 }));
  setTimeout(() => $('fade').classList.add('on'), REDUCED ? 0 : 380);
  setTimeout(() => {
    S.place = 'shop'; $('stage').hidden = true; $('shop').hidden = false;
    buildShop();
    S.cam = 'tryout';
    setCam(frameRect(ZOOMS.tryout().R, { pad: 16 }), false);
    $('fade').classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => zoom(area)));
    say(`The shop. Your stack’s in the corner; the amps are on the wall by sound, the pedals in the case by type. Click anything to play through it.`);
    S.gs && renderSpot();
  }, REDUCED ? 30 : 600);
}
function leaveShop() {
  setCam(frameRect(SHOPG.door, { maxS: 2.2 }));
  setTimeout(() => $('fade').classList.add('on'), REDUCED ? 0 : 320);
  setTimeout(() => {
    S.place = 'stage'; $('shop').hidden = true; $('stage').hidden = false;
    S.cam = 'stage'; S.look = null; showCard();
    renderStageRig();
    setCam(frameRect({ x: STAGE.door.x * PX - 10, y: STAGE.door.y * PX - 20, w: STAGE.door.w * PX + 20, h: STAGE.door.h * PX + 30 }, { maxS: 2.6 }), false);
    $('fade').classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => zoom('stage')));
    const a = ampDef();
    say(`Back on stage with ${a.name} on your ${cabName()} and ${pedalsOnly().length} pedals on the board${S.changed ? ': this song’s copy. Save to rack keeps it' : ''}.`);
  }, REDUCED ? 30 : 540);
}
function turn(area) { if (S.place !== 'shop') return enterShop(area); zoom(area); }

/* ================================================================================================ the panels beside a zoom */
function renderPanel() {
  const p = $('panel');
  const kind = S.cam === 'tryout-head' ? 'head' : S.cam === 'tryout-cab' ? 'cab' : S.cam;
  if (!['head', 'cab', 'tuner', 'tryout'].includes(kind)) { p.classList.remove('on'); p.hidden = true; return; }
  p.hidden = false;
  p.style.setProperty('--pw', (kind === 'cab' ? 420 : kind === 'tryout' ? 360 : 380) + 'px');
  if (kind === 'head') {
    const d = ampDef();
    p.replaceChildren(h('div.kind', `${toneWord(d.tone || 'high')} amp · your stack`), h('h2.disp', d.name), h('p', d.blurb), h('p.nod', `In the spirit of ${d.nod}.`),
      h('h3', 'The knobs'),
      h('p.note', 'Drag a knob up or down (Shift for fine), or focus it and use the arrow keys. Double-click puts it back. Every change goes to this song’s copy of the stack.'),
      ...d.params.filter((q) => q.group !== 'cab').map((q) => h('div.row', h('label', q.label[0] + q.label.slice(1).toLowerCase()), h('span.t2', { style: 'flex:1' }), h('output', fmt1(S.ampParams[q.key] ?? q.def)))),
      h('h3', 'Somewhere else'),
      h('div.row', h('button.b', { type: 'button', onclick: () => zoom(S.place === 'shop' ? 'tryout-cab' : 'cab') }, 'The cab and its mics', kbd('C'))),
      h('div.row', h('button.b', { type: 'button', onclick: () => enterShop('wall') }, 'Another amp: the wall', kbd('S'))),
      saveRow(), h('div.esc', h('button.b', { type: 'button', onclick: back }, 'Step back', kbd('Esc'))));
  } else if (kind === 'cab') {
    const c = CABS[S.cab.cab], m = S.cab.mic, m2 = S.cab.mic2;
    const micRow = (mm, i) => [
      h('div.chips', MIC_IDS.map((id) => h('button.chip', { type: 'button', 'aria-pressed': String(mm.type === id), onclick: () => { mm.type = id; changed(); rebuildRigs(); say(`${MICS[id].name} on the cab now. ${MICS[id].blurb}.`); } }, MICS[id].name))),
      h('p.note', MICS[mm.type].blurb + '.'),
      h('div.row', h('label', 'On the cone'), h('span', { style: 'flex:1' }, whereOnCone(mm.pos)), h('output', mm.pos.toFixed(2))),
      h('div.row', h('label', 'Distance'), h('input', { type: 'range', min: 0, max: 100, value: Math.round((Math.log(mm.dist / 0.5) / Math.log(48)) * 100), 'aria-label': 'Distance from the grille', oninput: (e) => { mm.dist = Math.round(0.5 * Math.pow(48, e.target.value / 100) * 10) / 10; e.target.nextSibling.textContent = inches(mm.dist); drawSide(); }, onchange: () => { changed(); rebuildRigs(); say(`${MICS[mm.type].name} ${inches(mm.dist)} back: ${mm.dist < 2 ? 'close, and the lows come up' : mm.dist > 8 ? 'the room comes in' : 'a little air'}.`); } }), h('output', inches(mm.dist))),
      h('div.row', h('label', 'Angle'), h('input', { type: 'range', min: 0, max: 60, value: mm.ang, 'aria-label': 'Angle off axis', oninput: (e) => { mm.ang = +e.target.value; e.target.nextSibling.textContent = mm.ang + '°'; drawSide(); }, onchange: () => { changed(); say(`${MICS[mm.type].name} ${mm.ang}° off axis: ${mm.ang > 20 ? 'darker' : 'a touch darker'}.`); } }), h('output', mm.ang + '°')),
    ];
    const side = h('canvas.sideview', { width: 680, height: 184, id: 'sideview', 'aria-hidden': 'true' });
    p.replaceChildren(h('div.kind', 'The cab · your stack'), h('h2.disp', c.name), h('p', c.blurb + '.'),
      h('p.note', 'You’re at the grille. Drag a mic across a cone: at the cap it’s bright, out toward the edge it’s darker.'),
      h('h3', 'Which cab'),
      h('div.cablist', GUITAR_CABS.map((id) => h('button.chip', { type: 'button', 'aria-pressed': String(S.cab.cab === id), onclick: () => { S.cab.cab = id; S.cab.mic.cone = 0; if (S.cab.mic2) S.cab.mic2.cone = Math.min(1, (CABS[id].n || 1) - 1); changed(); rebuildRigs(); say(`${CABS[id].name} under ${ampDef().name}. ${CABS[id].blurb}.`); } }, CABS[id].name))),
      h('h3', 'Mic 1'), ...micRow(m, 0),
      h('div.row', { style: 'margin-top:4px' }, h('span.note', 'From the side'), h('span', { style: 'flex:1' })), side,
      h('h3', 'Mic 2'),
      m2 ? [...micRow(m2, 1),
        h('div.row', h('label', 'Blend'), h('input', { type: 'range', min: 0, max: 10, step: 0.1, value: m2.blend, 'aria-label': 'Blend: 0 all mic 1, 10 all mic 2', oninput: (e) => { m2.blend = +e.target.value; e.target.nextSibling.textContent = fmt1(m2.blend); }, onchange: () => { changed(); say(`Blend ${fmt1(m2.blend)}: ${m2.blend < 5 ? 'mostly mic 1' : m2.blend > 5 ? 'mostly mic 2' : 'even'}.`); } }), h('output', fmt1(m2.blend))),
        h('div.row', h('label', 'Phase'), h('button.chip', { type: 'button', 'aria-pressed': String(!!m2.flip), onclick: () => { m2.flip = !m2.flip; changed(); renderPanel(); say(m2.flip ? 'Mic 2’s phase flipped: listen for the low end thinning or filling.' : 'Mic 2’s phase back to normal.'); } }, m2.flip ? 'Flipped' : 'Normal')),
        h('div.row', h('button.b', { type: 'button', onclick: () => { S.cab.mic2 = null; changed(); rebuildRigs(); renderPanel(); say('Mic 2 is off the cab.'); } }, 'Take mic 2 away'))]
        : h('div.row', h('button.b', { type: 'button', onclick: () => { S.cab.mic2 = { type: 'ribbon', pos: 0.62, dist: 1, ang: 0, cone: Math.min(1, (CABS[S.cab.cab].n || 1) - 1), blend: 5, flip: false }; changed(); rebuildRigs(); renderPanel(); say('A ribbon on the next cone, blended half and half. Drag it where you like.'); } }, 'Put up a second mic')),
      saveRow(), h('div.esc', h('button.b', { type: 'button', onclick: back }, 'Step back', kbd('Esc'))));
    drawSide();
  } else if (kind === 'tuner') {
    const t = S.tuner, tn = TUNINGS.find((x) => x.id === S.tuning);
    p.replaceChildren(h('div.kind', 'Tuner · first on your board'), h('h2.disp', TUNER.name), h('p', t.on ? 'It’s on, so you’re muted. Play each open string on its own and let it ring.' : 'Stomp it to tune. It mutes you while it’s on, like the one on your floor at home.'),
      h('div.strings', { id: 'strings' }, tn.notes.map((n, i) => h('span' + (t.done.includes(i) ? '.ok' : t.on && t.str === i ? '.now' : ''), n, h('small', String(6 - i))))),
      h('p.verdict', { id: 'tunesay' }, tunerWords()),
      h('h3', 'Tuning'),
      h('div.chips', TUNINGS.map((x) => h('button.chip', { type: 'button', 'aria-pressed': String(S.tuning === x.id), onclick: () => { S.tuning = x.id; S.tuner.done = []; S.tuner.str = 0; S.tuner.cents = -22; renderPanel(); say(`${x.name}: ${x.notes.join(' ')}, low to high.`); } }, x.name))),
      h('p.note', 'Low Tide, in the case under Pitch, drops the whole guitar without touching a peg.'),
      h('div.esc', h('button.b' + (t.on ? '.b-go' : ''), { type: 'button', onclick: () => tuner() }, t.on ? 'Stomp it off' : 'Stomp it on', kbd('T')), ' ', h('button.b', { type: 'button', onclick: back }, 'Step back', kbd('Esc'))));
  } else if (kind === 'tryout') {
    const d = ampDef();
    p.replaceChildren(h('div.kind', 'Your stack · this song’s copy'), h('h2.disp', 'In the corner'), h('p', 'Everything here is live: you’re playing through it. Turn anything.'),
      h('h3', 'In signal order'),
      ...S.board.filter((b) => b.device !== 'tuner' && !inLoop(getDevice(b.device))).map((b) => chainRow(getDevice(b.device), b)),
      chainRow(d, null, `${toneWord(d.tone || 'high')} amp`),
      h('div.row', h('span', { style: 'width:10px' }), h('span.t2', `${cabName()}, ${MICS[S.cab.mic.type].name} on the ${whereOnCone(S.cab.mic.pos)}`), h('span.gap'), h('button.b', { type: 'button', onclick: () => zoom('tryout-cab') }, 'Mics')),
      ...S.board.filter((b) => b.device !== 'tuner' && inLoop(getDevice(b.device))).map((b) => chainRow(getDevice(b.device), b, 'in the loop')),
      saveRow(), h('div.esc', h('button.b', { type: 'button', onclick: back }, 'Step back', kbd('Esc'))));
  }
  requestAnimationFrame(() => p.classList.add('on'));
}
function chainRow(d, b, note) {
  return h('div.row', h('span', { style: `width:10px;height:10px;flex:none;border-radius:50%;background:${b ? (b.on ? 'var(--lamp)' : 'var(--line-2)') : 'var(--accent-2)'}` }),
    h('div', { style: 'flex:1;min-width:0' }, h('b', d.name), ' ', h('span.t3', note || d.kindLabel.toLowerCase())),
    b ? h('button.b', { type: 'button', onclick: () => removePedal(b.uid), style: 'min-height:28px' }, 'Back') : null);
}
function saveRow() {
  return h('div.row', { style: 'margin-top:16px' }, h('button.b' + (S.changed ? '' : ''), { type: 'button', disabled: !S.changed || null, onclick: () => { S.changed = false; say('Saved to the rack as “Club stack, ' + ampDef().name + '”. Any song can load it.'); renderPanel(); } }, 'Save to rack', kbd('⌘S')), h('span.note', S.changed ? 'Changed: this song’s copy' : 'Nothing changed'));
}
// the cab's side view: the grille, and the mic at its distance and angle
function drawSide() {
  const cv = $('sideview');
  if (!cv) return;
  const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height;
  g.clearRect(0, 0, W2, H2);
  g.fillStyle = '#1b1b1f'; g.fillRect(0, 10, 60, H2 - 20);
  g.fillStyle = '#c9c4b4'; g.fillRect(60, 10, 4, H2 - 20);
  g.fillStyle = '#3a3936'; g.fillRect(40, 30, 20, H2 - 60);
  const mics = [S.cab.mic, S.cab.mic2].filter(Boolean);
  mics.forEach((m, i) => {
    const x = 70 + (Math.log(m.dist / 0.5 + 1) / Math.log(49)) * (W2 - 160), y = H2 / 2 + (i ? 34 : -10);
    g.save(); g.translate(x, y); g.rotate(-(m.ang * Math.PI) / 180 * (i ? -1 : 1));
    g.fillStyle = i ? '#4cc3ff' : '#d8d2c0'; g.fillRect(0, -9, 70, 18); g.fillStyle = '#6a6a74'; g.fillRect(-12, -11, 14, 22);
    g.restore();
    g.fillStyle = '#9a8f7c'; g.font = '22px Atkinson Hyperlegible Next, sans-serif'; g.fillText(inches(m.dist), x + 6, y + (i ? 40 : -18));
  });
}

/* ================================================================================================ the drummer's book */
function renderBook() {
  const book = $('book');
  if (S.cam !== 'kit') { book.classList.remove('on'); setTimeout(() => { if (S.cam !== 'kit') book.hidden = true; }, 300); return; }
  book.hidden = false;
  const styles = LIB.styles, st = styles.find((x) => x.id === S.book.style) || styles[0];
  const editGrid = (p, i) => h('div.egrid', ['top', 'snare', 'kick'].map((row) => [h('span', row === 'top' ? cap(p.grid.topName || 'hat') : cap(row)),
    p.grid[row].map((v, k) => h('button' + (v ? '.h' + v : ''), { type: 'button', 'aria-label': `${p.short}: ${row} step ${k + 1}, ${['off', 'hit', 'accent'][v]}`, onclick: () => { p.grid[row][k] = (v + 1) % 3; p.edited = true; renderBook(); renderCards(); } }))]));
  const pinsPage = h('div.page',
    h('h2.disp', 'On the riser'),
    h('p.sub', 'The beats on the riser’s cards, yours to rename, edit and reorder. Click a step to add a hit, again for an accent, again to clear it.'),
    S.pins.map((p, i) => h('div.pin' + (S.drummer.pin === i ? '.playing' : ''),
      h('div.nm', h('input.short', { value: p.short, 'aria-label': 'Its name on the riser', maxlength: 12, onchange: (e) => { p.short = e.target.value || p.short; renderCards(); } }), h('span.from', `${(LIB.byId.get(p.id) || GUIDE).name}${p.edited ? ', edited' : ''}`)),
      h('div.acts', h('button', { type: 'button', onclick: () => setPin(i) }, S.drummer.pin === i ? 'Playing' : 'Play'), h('button', { type: 'button', 'aria-label': 'Earlier', onclick: () => { if (i > 0) { [S.pins[i - 1], S.pins[i]] = [S.pins[i], S.pins[i - 1]]; fixPin(i, i - 1); renderBook(); renderCards(); } } }, '↑'),
        h('button', { type: 'button', 'aria-label': 'Later', onclick: () => { if (i < S.pins.length - 1) { [S.pins[i + 1], S.pins[i]] = [S.pins[i], S.pins[i + 1]]; fixPin(i, i + 1); renderBook(); renderCards(); } } }, '↓'),
        h('button', { type: 'button', onclick: () => { if (S.pins.length > 1) { S.pins.splice(i, 1); if (S.drummer.pin >= S.pins.length) S.drummer.pin = 0; renderBook(); renderCards(); say(`${p.short} is off the riser. It’s still in the book.`); } } }, 'Unpin')),
      editGrid(p, i))),
    S.pins.length < 5 ? h('p.sub', `Room for ${5 - S.pins.length} more on the riser: pin one from the book.`) : h('p.sub', 'The riser holds five. Unpin one to make room.'));
  const parts = ['intro', 'verse', 'chorus', 'bridge', 'half', 'fill', 'ending'];
  const PL = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', half: 'Half-time', fill: 'Fills', ending: 'Endings' };
  const libPage = h('div.page',
    h('h2.disp', 'Every groove'),
    h('p.sub', `${LIB.count} grooves in ${styles.length} styles. Play one now, or pin it to the riser.`),
    h('div.tabs', styles.map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === st.id), onclick: () => { S.book.style = x.id; renderBook(); } }, x.name))),
    h('p.sub', { style: 'margin-top:0' }, st.blurb ? st.blurb[0].toUpperCase() + st.blurb.slice(1) + '.' : '', tempoText(st)),
    parts.map((part) => { const gs = st.grooves.filter((g) => g.part === part); if (!gs.length) return null; return [h('h3', PL[part]), gs.map((g) => {
      const pinned = S.pins.findIndex((p) => p.id === g.id), grid = gridOf(g);
      return h('div.gv' + (pinned >= 0 ? '.on' : ''), h('div.nm', g.name, h('small', `${g.bars ?? g.length / 4} bar${(g.bars ?? g.length / 4) === 1 ? '' : 's'}`)),
        h('div.acts', h('button', { type: 'button', onclick: () => { playGroove(g); } }, 'Play now'), pinned >= 0 ? h('button', { type: 'button', disabled: true }, 'On the riser') : h('button', { type: 'button', onclick: () => { if (S.pins.length >= 5) { say('The riser holds five. Unpin one first.'); return; } S.pins.push({ id: g.id, short: shortName(g.name), grid: gridOf(g), edited: false }); renderBook(); renderCards(); say(`${g.name} is pinned to the riser as “${shortName(g.name)}”.`); } }, 'Pin')),
        h('div.vmini', ['top', 'snare', 'kick'].map((r) => grid[r].map((v) => h('i' + (v ? '.h' + v : ''))))));
    })]; }));
  book.replaceChildren(pinsPage, libPage, h('button.b.close', { type: 'button', onclick: back }, 'Close the book', kbd('Esc')));
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
  const d = getDevice(b.device);
  say(`${d.name} ${b.on ? 'on' : 'off'}.`);
  rebuildRigs();
}
function stomp(n) { const b = pedalsOnly()[n - 1]; if (b) stompUid(b.uid); }
function tuner(on = !S.tuner.on) {
  S.tuner.on = on;
  if (on) { S.tuner.str = S.tuner.done.length >= 6 ? 0 : S.tuner.str; S.tuner.cents = -22 - Math.random() * 6; if (S.tuner.done.length >= 6) S.tuner.done = []; }
  if (S.place === 'stage') {
    rebuildRigs();
    if (on && S.cam !== 'tuner') zoom('tuner');
    else if (!on && S.cam === 'tuner') zoom('stage');
  }
  renderPanel();
  say(on ? 'Tuner’s on: you’re muted. Play the low string first.' : 'Tuner’s off. You’re back on.');
  if (S.gs?.step === 'tune') { if (!on) S.gs.tuned = true; renderCallout(); setTimeout(renderSpot, 700); }
}
function tunerWords() {
  const t = S.tuner, tn = TUNINGS.find((x) => x.id === S.tuning);
  if (!t.on) return t.done.length >= 6 ? `All six in tune for ${tn.name}.` : '';
  if (t.done.length >= 6) return `All six in tune for ${tn.name}. Stomp it off.`;
  const c = Math.round(t.cents);
  return `${tn.notes[t.str]} (string ${6 - t.str}): ${Math.abs(c) < 3 ? 'in tune' : c < 0 ? `${-c} cents flat` : `${c} cents sharp`}.`;
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
  const T = S.tape, cv = h('canvas', { id: 'tapecv' });
  const len = T.sel[1] - T.sel[0];
  el.replaceChildren(
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
const GS = [{ id: 'plug', label: 'Plug in' }, { id: 'tune', label: 'Tune' }, { id: 'time', label: 'Timing' }, { id: 'sound', label: 'Your sound' }, { id: 'tour', label: 'Tour' }];
const TOUR = [
  { at: () => stageRig.head, title: 'Your amp', text: 'Kraken, sitting on your cab. Every knob turns right here; click the amp to get close.' },
  { at: () => stageRig.cab, title: 'Your cab', text: 'A closed 4x12 with a dynamic mic on it. Click it and you’re at the grille, moving the mics.' },
  { at: () => ({ ...stageRig.board, h: stageRig.board.h }), title: 'Your board', text: 'In signal order, left to right: the loop pedals sit after the amp. 1 to 4 stomp them; T is the tuner.' },
  { at: () => ({ x: 600, y: 270, w: 504, h: 290 }), title: 'The drummer', text: 'Space starts and stops. The cards on the riser are your beats; click the kit for the book with every groove.' },
  { at: () => ({ x: STAGE.tape.x * PX, y: STAGE.tape.y * PX, w: STAGE.tape.w * PX, h: 300 }), title: 'The tape', text: 'Always rolling, quietly. Click it, or G, for the last minute, and keep what you liked as a riff.' },
  { at: () => ({ x: STAGE.door.x * PX, y: STAGE.door.y * PX - 70, w: STAGE.door.w * PX, h: STAGE.door.h * PX + 70 }), title: 'The shop', text: 'Every amp and pedal, on the wall and in the case. Click the door, or S.' },
  { at: 'strip', title: 'Riffs and the part line', text: 'Along the bottom, with the talkback. Claude answers through it.' },
];
function startGS(step = 'plug') {
  if (S.place === 'shop') { leaveShop(); setTimeout(() => startGS(step), 700); return; }
  if (S.cam !== 'stage') zoom('stage', false);
  S.gs = { step, sub: 0 };
  if (step === 'plug') { S.plugged = false; S.gainDb = -19; rebuildRigs(); }
  if (step === 'tour') S.tour = 0;
  renderCallout(); renderSpot();
}
function gsNext(skip = false) {
  const i = GS.findIndex((s) => s.id === S.gs.step);
  if (S.gs.step === 'tour' && !skip && S.tour < TOUR.length - 1) { S.tour++; renderCallout(); renderSpot(); return; }
  if (S.tuner.on) tuner(false);
  if (i >= GS.length - 1 || (S.gs.step === 'tour' && skip)) return endGS();
  S.gs = { step: GS[i + 1].id, sub: 0 };
  if (S.gs.step === 'tour') S.tour = 0;
  if (!S.plugged) { S.plugged = true; S.gainDb = -8.5; rebuildRigs(); }
  if (S.cam !== 'stage') zoom('stage');
  renderCallout(); setTimeout(renderSpot, 40);
}
function endGS() {
  S.gs = null; $('callout').hidden = true; $('spot').hidden = true;
  if (S.cam !== 'stage') zoom('stage');
  say('You’re set up. Space starts the drummer; the tape’s already rolling.');
}
function targetsOf() {
  if (!S.gs) return [];
  const st = S.gs.step;
  if (st === 'plug') {
    const first = stageRig.slots[0];
    return [{ x: first.x - 150, y: first.y - 20, w: first.w + 170, h: first.h + 50 }, stageRig.meter ? worldBox(stageRig.meter) : null].filter(Boolean);
  }
  if (st === 'tune') { const t = stageRig.slots.find((q) => q.b.device === 'tuner'); return S.cam === 'tuner' ? [] : [pad(t, 10, 10, 10, 30)]; }
  if (st === 'time') return [{ x: 600, y: 250, w: 504, h: 310 }];
  if (st === 'sound') return [pad(stageRig.head, 10, 40, 10, 0), pad(stageRig.cab, 10, 0, 10, 10), { x: STAGE.door.x * PX - 10, y: STAGE.door.y * PX - 76, w: STAGE.door.w * PX + 20, h: STAGE.door.h * PX + 80 }];
  if (st === 'tour') { const t = TOUR[S.tour].at; return t === 'strip' ? ['strip'] : [pad(t(), 16, 16, 16, 16)]; }
  return [];
}
function renderSpot() {
  const sp = $('spot');
  if (!S.gs || S.place !== 'stage' || (S.gs.step === 'tune' && S.cam === 'tuner')) { sp.hidden = true; positionCallout(); return; }
  const { w, h: hh } = vsize();
  const ts = targetsOf().map((t) => (t === 'strip' ? { x: 0, y: hh - 6, w, h: 40 } : toView(t)));
  sp.hidden = false;
  const holes = ts.map((r, i) => `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w * 0.62 + 10}" ry="${r.h * 0.62 + 10}" fill="#000"/>`).join('');
  const beams = ts.filter((r) => r.y > 30).map((r) => `<polygon points="${r.x + r.w / 2 - 14},0 ${r.x + r.w / 2 + 14},0 ${r.x + r.w * 1.05},${r.y + r.h / 2} ${r.x - r.w * 0.05},${r.y + r.h / 2}" fill="url(#beam)"/>`).join('');
  sp.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none"><defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc85a" stop-opacity=".16"/><stop offset="1" stop-color="#ffc85a" stop-opacity=".02"/></linearGradient>
    <mask id="m"><rect width="${w}" height="${hh}" fill="#fff"/><g filter="url(#soft)">${holes}</g></mask></defs>
    <rect width="${w}" height="${hh}" fill="#07060a" fill-opacity=".72" mask="url(#m)"/>${beams}</svg>`;
  positionCallout(ts[0]);
}
function renderCallout() {
  const co = $('callout');
  if (!S.gs) { co.hidden = true; return; }
  co.hidden = false;
  const st = S.gs.step, idx = GS.findIndex((s) => s.id === st);
  const steps = h('div.steps', GS.map((s, i) => h('span' + (i < idx ? '.done' : i === idx ? '.now' : ''), h('i'), s.label)));
  const skip = h('button.b.skip', { type: 'button', onclick: () => gsNext(true) }, st === 'tour' ? 'End the tour' : 'Skip this');
  let body = [];
  if (st === 'plug') {
    const pl = S.plugged, db = Math.round(S.gainDb - 0.4);
    body = [h('h2.disp', 'Plug in'),
      pl ? h('p', 'The cable’s in the tuner’s input and its jack is lit. Strum hard and watch the meter on the amp: the amber window is −12 to −6 dBFS.')
        : h('p', 'Your guitar goes into your interface. Pick it and the input the guitar’s on, and the cable goes into the first pedal on your board.'),
      pl ? null : h('div.fields', h('label', 'Interface', h('select', { onchange: (e) => (S.iface = e.target.value) }, ['Scarlett Solo USB', 'MacBook Pro Microphone'].map((x) => h('option', { selected: x === S.iface || null }, x)))),
        h('label', 'Input', h('select', { onchange: (e) => (S.input = e.target.value) }, ['Input 1', 'Input 2'].map((x) => h('option', { selected: x === S.input || null }, x))))),
      pl ? h('p.verdict', { id: 'plugsay' }, plugWords()) : null,
      pl ? h('p.small', 'The gain knob on your interface sets this, not anything in here.') : null,
      h('div.acts', pl ? h('button.b.b-go', { type: 'button', disabled: S.gainDb < -12 || null, onclick: () => gsNext() }, 'Next: tune') : h('button.b.b-go', { type: 'button', onclick: plugIn }, 'Plug in'), skip)];
  } else if (st === 'tune') {
    const tn = TUNINGS.find((x) => x.id === S.tuning);
    const close = S.tuner.on;
    body = [h('h2.disp', 'Tune'), h('p', S.gs.tuned ? `All six in tune for ${tn.name}.` : close ? 'Play each open string on its own and let it ring; it lights when it’s in. Stomp it off when they’re all lit.' : `Stomp the tuner, first on your board (or T). It mutes you while it’s on. It reads the low string first; you’re set for ${tn.name}, and drop tunings are a click away.`),
      h('div.acts', S.gs.tuned ? h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Next: timing') : close ? h('button.b.b-go', { type: 'button', onclick: () => tuner(false) }, 'Stomp it off', kbd('T')) : h('button.b.b-go', { type: 'button', onclick: () => tuner(true) }, 'Stomp the tuner', kbd('T')), skip)];
  } else if (st === 'time') {
    const c = S.count, done = S.gs.timed;
    body = [h('h2.disp', 'Timing'), h('p', done ? `Round trip: ${S.latency} ms. Takes land on the beat now. Remembered for ${S.iface}, ${S.input.toLowerCase()}.` : 'Your interface and the browser add a little delay. The drummer clicks eight; strum on each one, once, and takes land right on the beat.'),
      h('div.timeline', Array.from({ length: 8 }, (_, i) => h('i', { style: `left:${6 + i * 12.5}%` })), (S.gs.strums || []).map((ms, i) => h('b', { style: `left:calc(${6 + i * 12.5}% + ${ms * 0.5}px)` }))),
      h('p.small', c != null ? `Click ${c} of 8.` : done ? 'Eight strums, each about 11 ms behind the click: that’s the round trip, now taken off.' : 'Get your hand ready.'),
      h('div.acts', done ? h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Next: your sound') : h('button.b.b-go', { type: 'button', disabled: c != null || null, onclick: countEight }, 'Count me in'), skip)];
  } else if (st === 'sound') {
    body = [h('h2.disp', 'Your sound'), h('p', `That’s the club’s stack: ${ampDef().name} on a ${cabName()}, a gate and a treble booster in front. Play through it.`), h('p', 'Anything else is in the shop, through that door: amps on the wall by sound, pedals in the case by type.'),
      h('div.acts', h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, 'Keep this one'), h('button.b', { type: 'button', onclick: () => { gsNext(); setTimeout(() => endGS(), 10); enterShop('wall'); } }, 'Through the door', kbd('S')), skip)];
  } else if (st === 'tour') {
    const t = TOUR[S.tour];
    body = [h('h2.disp', t.title), h('p', t.text), h('p.small', `${S.tour + 1} of ${TOUR.length}`),
      h('div.acts', S.tour > 0 ? h('button.b', { type: 'button', onclick: () => { S.tour--; renderCallout(); renderSpot(); } }, 'Back') : null, h('button.b.b-go', { type: 'button', onclick: () => gsNext() }, S.tour === TOUR.length - 1 ? 'Done' : 'Next'), skip)];
  }
  co.replaceChildren(steps, ...body.filter(Boolean));
  positionCallout(lastSpot);
}
let lastSpot = null;
function positionCallout(r) {
  const co = $('callout');
  if (co.hidden) return;
  if (r) lastSpot = r;
  r = r || lastSpot;
  const { w, h: hh } = vsize(), cw = 360, ch = co.offsetHeight || 240;
  co.classList.remove('up', 'side');
  if (!r || (S.gs?.step === 'tune' && S.cam === 'tuner')) { co.classList.add('side'); place(co, 24, hh - ch - 24); return; }
  let x = clamp(r.x + r.w / 2 - 60, 16, w - cw - 16), y = r.y + r.h + 22;
  if (y + ch > hh - 10) { y = r.y - ch - 22; co.classList.add('up'); }
  if (y < 10) { co.classList.add('side'); y = clamp(r.y, 10, hh - ch - 10); x = r.x + r.w + 24 + cw < w ? r.x + r.w + 24 : Math.max(16, r.x - cw - 24); }
  co.style.setProperty('--ax', clamp(r.x + r.w / 2 - x - 7, 16, cw - 30) + 'px');
  place(co, x, y);
}
function plugWords() {
  const db = Math.round(S.gainDb - 0.4);
  return db < -12 ? `Peaks at ${minus(db)} dBFS: a little low. Turn the interface’s gain up a touch.` : db > -6 ? `Peaks at ${minus(db)} dBFS: too hot. Back the interface’s gain off.` : `Peaks at ${minus(db)} dBFS: right in the window.`;
}
function plugIn() {
  S.plugged = true; S.gainDb = -19;
  rebuildRigs();
  flash(stageRig.slots[0].el);
  say(`${S.iface}, ${S.input.toLowerCase()}: the cable’s in. Strum.`);
  renderCallout(); renderSpot();
  // a fake turn of the interface's gain knob: low, then in the window
  setTimeout(() => { if (S.gs?.step === 'plug') { S.gainDb = -14.5; renderCallout(); } }, 1600);
  setTimeout(() => { if (S.gs?.step === 'plug') { S.gainDb = -8.5; renderCallout(); say('Peaks at −9 dBFS: right in the window.'); } }, 3200);
}
function countEight() {
  S.count = 0; S.gs.strums = [];
  const beat = 60000 / S.tempo;
  for (let i = 1; i <= 8; i++) setTimeout(() => { S.count = i; S.tapAt = now(); S.gs.strums.push(9 + Math.round(Math.random() * 5)); renderCallout(); }, i * beat);
  setTimeout(() => { S.count = null; S.gs.timed = true; renderCallout(); say(`Round trip: ${S.latency} ms, taken off every take from now on.`); }, 9 * beat + 200);
  renderCallout();
}

/* ================================================================================================ the frame: where you are, the strip, the way back */
function renderWhere() {
  const el = $('where');
  const Z = { head: 'Your amp', cab: 'Your cab’s grille', kit: 'The drummer’s book', board: 'Your board', tuner: 'The tuner', tape: 'The tape machine', wall: 'The amp wall', case: 'The pedal case', tryout: 'The try-out corner', 'tryout-head': 'Your amp', 'tryout-cab': 'Your cab’s grille' };
  const crumbs = [h('button', { type: 'button', onclick: () => { if (S.place === 'shop') leaveShop(); else zoom('stage'); } }, 'The metal club')];
  if (S.place === 'stage') crumbs.push(h('span.sep', '/'), S.cam === 'stage' ? h('b', 'The stage') : h('button', { type: 'button', onclick: () => zoom('stage') }, 'The stage'));
  else crumbs.push(h('span.sep', '/'), h('button', { type: 'button', onclick: () => zoom('wall') }, 'The shop'));
  if (S.cam !== 'stage') crumbs.push(h('span.sep', '/'), h('b', Z[S.cam] || S.cam));
  el.replaceChildren(...crumbs);
}
function renderBack() {
  const b = $('backout');
  const show = S.place === 'stage' ? S.cam !== 'stage' && S.cam !== 'kit' : S.cam.startsWith('tryout');
  b.hidden = !show;
  b.replaceChildren('Step back', kbd('Esc'));
  b.onclick = back;
}
function renderStrip() {
  const st = $('strip');
  const t = S.talk, fresh = now() - t.at < 4000;
  const drawer = h('div.drawer' + (S.drawer ? '.on' : ''),
    h('div', h('h4', 'Riffs', h('span', `${S.riffs.length} this session, 166 in the library`)),
      S.riffs.length ? S.riffs.map((r) => { const c = h('canvas', { width: 240, height: 52 }); requestAnimationFrame(() => { const g = c.getContext('2d'), s = riffShape(r.seed, r.bars, 120); g.fillStyle = '#cbc0aa'; s.forEach((v, i) => g.fillRect(i * 2, 26 - v * 22, 1.4, v * 44)); }); return h('div.riff', c, h('b', r.name), h('span.t3', `${r.bars} bars, ${r.tempo}`)); }) : h('p.t3', 'Riffs you keep off the tape land here. Click the tape machine, or G.')),
    h('div', h('h4', 'The part line', h('span', S.parts.length ? `${S.parts.length} parts` : 'empty')), h('div.partline', S.parts.length ? S.parts.map((p) => h('div.part', h('b', p.name), h('div.t3', `${p.bars} bars`))) : 'Drop a riff here, or press R to record a part.')));
  st.replaceChildren(
    h('div.tb', h('i.lamp' + (fresh ? '.on' : '')), S.talking ? h('input.talkin', { id: 'talkin', placeholder: 'Ask Claude through the glass: “give me a beat that’s more thrash”', onkeydown: (e) => { if (e.key === 'Enter') { ask(e.target.value); e.preventDefault(); } if (e.key === 'Escape') { S.talking = false; renderStrip(); } e.stopPropagation(); } })
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
addEventListener('keydown', (e) => {
  const tgt = e.target;
  if (tgt instanceof HTMLInputElement && tgt.type !== 'range' || tgt instanceof HTMLSelectElement || tgt instanceof HTMLTextAreaElement) { if (e.key === 'Escape') tgt.blur(); return; }
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); back(); return; }
  if (e.metaKey && k === 's') { e.preventDefault(); if (S.changed) { S.changed = false; say('Saved to the rack. Any song can load it.'); renderPanel(); } return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.tape && k === 'Enter') { e.preventDefault(); keepRiff(); return; }
  if (k === ' ') { e.preventDefault(); drummer(); return; }
  if (k === '/') { e.preventDefault(); S.talking = true; renderStrip(); setTimeout(() => $('talkin')?.focus(), 10); return; }
  if (S.place === 'shop') {
    if (k === 'a' || k === 'A') return turn('wall');
    if (k === 'p' || k === 'P') return turn('case');
    if (k.startsWith('Arrow') && (tgt.classList?.contains('amp-slot') || tgt.classList?.contains('ped-slot'))) { e.preventDefault(); spatial(tgt, k); return; }
    if (k.startsWith('Arrow') && (S.cam === 'wall' || S.cam === 'case')) { e.preventDefault(); (S.cam === 'wall' ? shopLayout.amps : shopLayout.pedals)[0]?.focus(); return; }
    return;
  }
  if (tgt.closest?.('.kn')) return; // a knob takes its own arrows
  if (k === 'ArrowLeft') { e.preventDefault(); tempo(-1); return; }
  if (k === 'ArrowRight') { e.preventDefault(); tempo(1); return; }
  if (/^[1-8]$/.test(k)) { stomp(+k); return; }
  const map = { h: () => zoom('head'), c: () => zoom('cab'), k: () => zoom('kit'), b: () => zoom('board'), t: () => tuner(), g: () => openTape(), s: () => enterShop('wall') };
  const f = map[k.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
});
function spatial(from, key) {
  const list = from.classList.contains('amp-slot') ? shopLayout.amps : shopLayout.pedals;
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
  if (S.plugged) {
    if (run) { const i = Math.floor(st); for (let k = 0; k < 8; k++) { const s = i - k; if (s < 0) break; const c = CHUG[((s % 16) + 16) % 16]; if (c !== '.') { gtr = (c === 'X' ? 0.95 : 0.7) * Math.exp(-(st - s) * 1.1); break; } } }
    else { const q = tt % 2600; gtr = q < 1400 ? 0.85 * Math.exp(-q / 420) : 0.02; }
  }
  const muted = S.tuner.on;
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
    // the tuner: the needle settles onto each string in turn
    if (S.tuner.on) {
      const T = S.tuner;
      if (T.done.length < 6) {
        T.cents += (0 - T.cents) * 0.025 + (Math.random() - 0.5) * 0.9;
        if (Math.abs(T.cents) < 2.5) { T.hold += 1; if (T.hold > 30) { T.done.push(T.str); T.hold = 0; T.str = Math.min(5, T.str + 1); T.cents = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16); if (S.cam === 'tuner') renderPanel(); } }
        else T.hold = 0;
      }
      const tf = FACES.get('stage:tuner'); tf?.face.update();
      const ts = $('tunesay'); if (ts) ts.textContent = tunerWords();
    }
    if (gLive) {
      const tap = S.tapAt ? Math.max(0, 1 - (now() - S.tapAt) / 180) : 0;
      drawStageLive(gLive, { ...hits, reduced: REDUCED, count: S.count, tap, rolling: S.plugged, spin: (tt / 1000) * 2.2, bar, input: muted ? 0 : gtr, hot: S.tape != null });
    }
    const tb = $('tpbar'); if (tb) tb.textContent = bar ? `BAR ${bar}` : 'BAR –';
  }
  if (S.place === 'shop' && shopRig) shopRig.head.face.meter(gtr);
}

/* ================================================================================================ the screens */
const SCREENS = [
  ['Getting started', [['gs-plug', 'Plug in: pick the input'], ['gs-plug-in', 'Plug in: in the window'], ['gs-tune', 'Tune: the tuner on the floor'], ['gs-tune-on', 'Tune: stomped, close up'], ['gs-time', 'Timing: eight clicks'], ['gs-time-done', 'Timing: measured'], ['gs-sound', 'Your sound: the door'], ['gs-tour-board', 'The tour: your board'], ['gs-tour-kit', 'The tour: the drummer']]],
  ['The stage', [['stage', 'The stage, quiet'], ['stage-jam', 'Jamming: the drummer on'], ['drawer', 'Riffs and the part line open']]],
  ['Closer', [['zoom-head', 'Your amp'], ['zoom-cab', 'Your cab: the mics'], ['zoom-cab-2', 'Your cab: a second mic'], ['zoom-kit', 'The drummer’s book'], ['zoom-board', 'Your board'], ['zoom-tuner', 'The tuner'], ['tape', 'The tape machine: the last minute']]],
  ['The shop', [['shop-wall', 'The amp wall'], ['shop-look-amp', 'Looking at an amp'], ['shop-case', 'The pedal case'], ['shop-look-pedal', 'Looking at a pedal'], ['shop-after', 'Megalodon carried in'], ['shop-tryout', 'The try-out corner']]],
];
function renderMenu() {
  const m = $('screenmenu');
  m.replaceChildren(...SCREENS.flatMap(([title, list]) => [h('h4', title), ...list.map(([id, label]) => h('li', h('button', { type: 'button', onclick: () => { closeMenu(); go(id); } }, label)))]));
}
function closeMenu() { $('screenmenu').hidden = true; $('screensbtn').setAttribute('aria-expanded', 'false'); }
$('screensbtn').addEventListener('click', () => { const m = $('screenmenu'); m.hidden = !m.hidden; $('screensbtn').setAttribute('aria-expanded', String(!m.hidden)); });
$('gsbtn').addEventListener('click', () => startGS('plug'));
addEventListener('click', (e) => { if (!e.target.closest('#screens')) closeMenu(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function reset() {
  for (const f of FACES.values()) f.face.destroy?.();
  FACES.clear();
  S = fresh();
  $('callout').hidden = true; $('spot').hidden = true; $('tapesheet').hidden = true; $('book').hidden = true;
  if (!$('shop').hidden) { $('shop').hidden = true; $('stage').hidden = false; }
  S.place = 'stage'; S.cam = 'stage';
  buildStage();
  zoom('stage', false);
  renderStrip(); renderTransport();
}
async function go(id) {
  await reset();
  const jam = () => { S.drummer.on = true; S.drummer.t0 = now() - (7 * 4 + 1.3) * (60000 / S.tempo); renderTransport(); };
  const shop = async (area) => { enterShop(area); await wait(1400); };
  switch (id) {
    case 'stage': break;
    case 'stage-jam': jam(); setPin(1); S.drummer.pin = 1; renderCards(); renderTransport(); say('Djent at 132. The tape’s rolling: click the machine, or G, for what you just played.'); break;
    case 'drawer': S.riffs = [{ name: 'Riff 1', bars: 4, tempo: 132, seed: 11 }, { name: 'Riff 2', bars: 2, tempo: 132, seed: 12 }]; S.drawer = true; renderStrip(); break;
    case 'gs-plug': startGS('plug'); break;
    case 'gs-plug-in': startGS('plug'); S.plugged = true; S.gainDb = -8.5; rebuildRigs(); renderCallout(); renderSpot(); break;
    case 'gs-tune': startGS('tune'); break;
    case 'gs-tune-on': startGS('tune'); tuner(true); S.tuner.done = [0, 1]; S.tuner.str = 2; S.tuner.cents = -9; await wait(700); renderPanel(); break;
    case 'gs-time': startGS('time'); S.count = 5; S.tapAt = now(); S.gs.strums = [10, 12, 9, 11, 13]; renderCallout(); renderSpot(); break;
    case 'gs-time-done': startGS('time'); S.gs.strums = [10, 12, 9, 11, 13, 10, 12, 11]; S.gs.timed = true; renderCallout(); renderSpot(); break;
    case 'gs-sound': startGS('sound'); break;
    case 'gs-tour-board': startGS('tour'); S.tour = 2; renderCallout(); renderSpot(); break;
    case 'gs-tour-kit': startGS('tour'); S.tour = 3; renderCallout(); renderSpot(); break;
    case 'zoom-head': zoom('head'); break;
    case 'zoom-cab': zoom('cab'); break;
    case 'zoom-cab-2': S.cab.mic2 = { type: 'ribbon', pos: 0.62, dist: 1, ang: 0, cone: 1, blend: 5, flip: false }; S.cab.mic._ang = -2.4; S.cab.mic.pos = 0.34; rebuildRigs(); zoom('cab'); break;
    case 'zoom-kit': jam(); zoom('kit'); break;
    case 'zoom-board': zoom('board'); break;
    case 'zoom-tuner': tuner(true); S.tuner.done = [0, 1, 2]; S.tuner.str = 3; S.tuner.cents = 6; break;
    case 'tape': jam(); openTape(); break;
    case 'shop-wall': await shop('wall'); break;
    case 'shop-look-amp': await shop('wall'); lookAt(shopLayout.amps.find((s) => s.dataset.id === 'amp.metal')); break;
    case 'shop-case': await shop('case'); break;
    case 'shop-look-pedal': await shop('case'); lookAt(shopLayout.pedals.find((s) => s.dataset.id === 'pedal.squish')); break;
    case 'shop-after': await shop('wall'); takeAmp('amp.metal', shopLayout.amps.find((s) => s.dataset.id === 'amp.metal')); await wait(700); takePedal('pedal.clamshut', shopLayout.pedals.find((s) => s.dataset.id === 'pedal.clamshut')); await wait(700); break;
    case 'shop-tryout': await shop('wall'); zoom('tryout'); break;
  }
}
function lookAt(el) { if (!el) return; el.focus(); }

/* ================================================================================================ start */
renderMenu();
buildStage();
zoom('stage', false);
renderStrip(); renderTransport();
addEventListener('resize', () => { zoom(S.cam, false); if (S.gs) renderSpot(); });
requestAnimationFrame(frame);
window.mock = { go, get state() { return S; }, zoom, startGS };
