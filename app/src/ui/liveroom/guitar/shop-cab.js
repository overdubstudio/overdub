// The cab and its mics [ui; the guitar room's SHOP stream] (docs/research/GUITAR-ROOM.md §2.9; the second mock's
// shot-2-cab-zoom and 03c: "click the cab and it zooms into the cab builder with mics"). A cab drawn from its speakers,
// the mics standing in front of its grille, and the cab builder: which cab, each mic's type, where it is on the cone,
// how far back, its angle, a second mic blended in. Every control is a param of the real amp on your stack (amp.*: cab,
// mic, micpos, micdist, micang, mic2, mic2pos, mic2dist, mic2ang, blend, flip; the Half Stack: its measured CAB),
// turned through R.rig.turn: both guitars, by you, a drag one undo step. Which cone a mic is on, and where around
// it, is the room's (R.gr.shop.mics): the sound is the distance from the dust cap.
//
//   cabView(cabId, w, h, { mini, open, ir, label }) -> { el, cones: [{ x, y, r }], w, h }   a cab, w x h, its
//       speakers in a grid (an odd cab, the Fridge, the Box, the Telephone, the Horn, in its own clothes)
//   placeMics(cab, view, { R, slot, drag }) -> [el]     the mics of a CabView (shop-data.js cabOf) on a drawn cab;
//       drag: they can be dragged across the cones (the camera's close, or the panel's small cab)
//   fader({ label, min, max, value, log, step, fmt, cls, onInput(v, commit) }) -> { el, set(v) }   an ARIA slider:
//       drag, arrows (Shift: fine), Page Up/Down, Home/End; the room draws no range input
//   drawSide(canvas, view)                              the mics from the side: the baffle, a speaker in profile, each
//       mic at its distance and angle, a ruler in inches
//   cabPanel(R, host, { where: 'stage' | 'shop', saveRow }) -> { render(), refresh(), dispose() }
//       the cab builder in a camera panel (the stage's cab zoom, R.panel('cab'); the try-out corner's, R.panel(
//       'tryout-cab')); refresh() after the rig changed (keeps a drag in hand)

import { h } from '../../dom.js';
import { CABS, MICS, MIC_IDS, GUITAR_CABS, BASS_CABS, cabBox, cabOf, cabIndex, whereOnCone, onCone, inches } from './shop-data.js';
import { SAY } from './shop-say.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt1 = (v) => (+v).toFixed(1);
const place = (el, x, y, w, hh) => { el.style.left = x + 'px'; el.style.top = y + 'px'; if (w != null) el.style.width = w + 'px'; if (hh != null) el.style.height = hh + 'px'; return el; };

/* ------------------------------------------------------------------------------------------------ the cab */
export function cabView(id, w, hh, { mini = false, open = false, ir = false, label = null } = {}) {
  const c = CABS[id] || CABS.v412;
  const el = h(`div.grs-cab${c.odd ? '.odd-' + c.odd : ''}${mini ? '.mini' : ''}${open ? '.open' : ''}${ir ? '.ir' : ''}`, { dataset: { cab: id } });
  place(el, 0, 0, w, hh);
  const gr = h('div.cab-gr'), cones = h('div.cab-cones');
  const n = c.n || 1, cols = n >= 2 ? 2 : 1, rows = Math.ceil(n / cols);
  const gw = w - 40, gh = hh - 52;
  const r = Math.min(gw / cols, gh / rows) * 0.44;
  const list = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const ccx = (gw / cols) * (col + 0.5), ccy = (gh / rows) * (row + 0.5);
    cones.append(place(h('div.cone'), ccx - r, ccy - r, r * 2, r * 2));
    list.push({ x: 20 + ccx, y: 22 + ccy, r });
  }
  gr.append(cones, h('div.cab-cloth'));
  el.append(gr, h('span.cab-logo', c.odd === 'fridge' ? 'Coldspot' : c.odd === 'box' ? 'THIS SIDE UP' : 'CLAWD-O-TONE'), h('span.cab-name', label || c.name));
  if (!c.odd) {
    for (const k of ['tl', 'tr', 'bl', 'br']) el.append(h(`i.cab-corner.${k}`));
    el.append(h('i.cab-caster', { style: { left: '26px' } }), h('i.cab-caster', { style: { right: '26px' } }));
  }
  return { el, cones: list, w, h: hh };
}

/* ------------------------------------------------------------------------------------------------ the mics */
const micTag = (m, i) => `${i ? 'Mic 2: ' : ''}${MICS[m.type]?.name || 'Mic'}, ${whereOnCone(m.pos)}, ${inches(m.dist)}`;
const KEYS = [{ type: 'mic', pos: 'micpos', dist: 'micdist', ang: 'micang' }, { type: 'mic2', pos: 'mic2pos', dist: 'mic2dist', ang: 'mic2ang' }];
// where a mic is around its cone: the room's, not the song's (the sound is the distance from the cap)
function spot(R, i, cab) {
  const S = R.gr.shop;
  if (!Array.isArray(S.mics)) S.mics = [];
  if (!S.mics[i]) S.mics[i] = { cone: Math.min(i, cab.cones.length - 1), ang: i ? -0.6 : -2.4 };
  S.mics[i].cone = Math.min(S.mics[i].cone, cab.cones.length - 1);
  return S.mics[i];
}
function position(el, m, sp, cab) {
  const c = cab.cones[sp.cone] || cab.cones[0], r = clamp(m.pos, 0, 1.35) * c.r;
  const x = c.x + Math.cos(sp.ang) * r, y = c.y + Math.sin(sp.ang) * r;
  place(el, x, y);
  el.querySelector('.mic-stand').style.height = Math.max(0, cab.h - y + 6) / (el._sc || 1) + 'px';
  el.querySelector('.mic-tag').textContent = el._tag;
  for (const [k, cn] of [...cab.el.querySelectorAll('.cone')].entries()) cn.classList.toggle('hot', k === sp.cone && el.classList.contains('dragging'));
}
export function placeMics(cab, view, { R, slot, drag = false, onSay = null }) {
  for (const old of cab.el.querySelectorAll('.grs-mic')) old.remove();
  const out = [];
  if (!view || view.kind !== 'clawd') return out;
  [view.mic1, view.mic2].forEach((m, i) => {
    if (!m) return;
    const sp = spot(R, i, cab);
    const el = h(`div.grs-mic.t-${m.type}${i ? '.m2' : ''}`, { dataset: { mic: String(i + 1) } },
      h('i.mic-stand'),
      h('i.mic-body', { title: drag ? `${MICS[m.type]?.name}: drag it across the cone` : '' }),
      h('span.mic-tag'));
    el._sc = clamp(1.25 - Math.log2(m.dist + 1) * 0.12, 0.7, 1.2) * Math.min(1, cab.w / 400);
    el.style.transform = `scale(${el._sc.toFixed(3)})`;
    el._tag = micTag(m, i);
    cab.el.append(el);
    position(el, m, sp, cab);
    out.push(el);
    if (!drag) return;
    const body = el.querySelector('.mic-body');
    let live = { ...m };
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      body.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      R.gr.shop.dragging = true;
      const move = (ev) => {
        const b = cab.el.getBoundingClientRect(), s = b.width / cab.w || 1;
        const lx = (ev.clientX - b.left) / s, ly = (ev.clientY - b.top) / s;
        let best = null;
        cab.cones.forEach((c, ci) => { const dx = lx - c.x, dy = ly - c.y, d = Math.hypot(dx, dy); if (!best || d < best.d) best = { ci, dx, dy, d, r: c.r }; });
        sp.cone = best.ci; sp.ang = Math.atan2(best.dy, best.dx);
        live = { ...live, pos: Math.round(clamp(best.d / best.r, 0, 1.35) * 100) / 100 };
        el._tag = micTag(live, i);
        position(el, live, sp, cab);
        R.rig.turn(slot, KEYS[i].pos, live.pos, { commit: false });
      };
      const up = () => {
        body.removeEventListener('pointermove', move); body.removeEventListener('pointerup', up); body.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        R.gr.shop.dragging = false;
        for (const cn of cab.el.querySelectorAll('.cone')) cn.classList.remove('hot');
        R.rig.turn(slot, KEYS[i].pos, live.pos, { commit: true });
        onSay?.(SAY.micMoved({ mic: i ? 'Mic 2' : MICS[live.type]?.name || 'The mic', where: onCone(live.pos), dist: inches(live.dist), tone: live.pos < 0.4 ? 'brighter' : live.pos > 0.82 ? 'darker' : 'rounder' }));
      };
      body.addEventListener('pointermove', move); body.addEventListener('pointerup', up); body.addEventListener('pointercancel', up);
    });
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------ a fader */
export function fader({ label, min, max, value, log = false, step = 0, fmt = fmt1, cls = '', onInput }) {
  const toPos = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p) => { const x = clamp(p, 0, 1); let v = log ? min * Math.pow(max / min, x) : min + x * (max - min); if (step) v = Math.round(v / step) * step; return Math.round(v * 1000) / 1000; };
  const fill = h('i'), knob = h('b');
  const el = h(`div.grs-fader${cls ? '.' + cls : ''}`, { role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, fill, knob);
  let v = value;
  const draw = () => { const p = clamp(toPos(v), 0, 1) * 100; fill.style.width = p + '%'; knob.style.left = p + '%'; el.setAttribute('aria-valuenow', String(v)); el.setAttribute('aria-valuetext', fmt(v)); };
  const put = (x, commit) => { v = clamp(x, min, max); draw(); onInput?.(v, commit); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    const at = (ev) => { const b = el.getBoundingClientRect(); return fromPos((ev.clientX - b.left) / (b.width || 1)); };
    put(at(e), false);
    const mv = (ev) => put(at(ev), false);
    const up = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); put(at(ev), true); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const p = toPos(v), d = e.shiftKey ? 0.01 : 0.04;
    const to = { ArrowRight: p + d, ArrowUp: p + d, ArrowLeft: p - d, ArrowDown: p - d, PageUp: p + 0.2, PageDown: p - 0.2, Home: 0, End: 1 }[e.key];
    if (to == null) return;
    e.preventDefault(); e.stopPropagation();
    put(fromPos(to), true);
  });
  draw();
  return { el, set(x) { if (!Number.isFinite(+x)) return; v = +x; draw(); } };
}

/* ------------------------------------------------------------------------------------------------ from the side */
const PPI = 19, GX = 120, CY = 136;
export function drawSide(cv, view) {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0b090d'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, GX - 8, H);
  g.fillStyle = '#3a3936'; g.fillRect(GX - 14, 10, 8, H - 20);
  g.fillStyle = '#c9c4b4'; g.fillRect(GX - 4, 10, 4, H - 20);
  g.strokeStyle = '#6a6a74'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(GX - 14, CY - 6 * PPI); g.lineTo(GX - 80, CY - 1.6 * PPI); g.lineTo(GX - 80, CY + 1.6 * PPI); g.lineTo(GX - 14, CY + 6 * PPI); g.stroke();
  g.fillStyle = '#2a2927'; g.beginPath(); g.moveTo(GX - 16, CY - 5.6 * PPI); g.quadraticCurveTo(GX - 50, CY - 2 * PPI, GX - 70, CY - 1.2 * PPI); g.lineTo(GX - 70, CY + 1.2 * PPI); g.quadraticCurveTo(GX - 50, CY + 2 * PPI, GX - 16, CY + 5.6 * PPI); g.closePath(); g.fill();
  g.fillStyle = '#55534e'; g.beginPath(); g.ellipse(GX - 64, CY, 10, 1.1 * PPI, 0, -Math.PI / 2, Math.PI / 2); g.fill();
  g.fillStyle = '#7a7266'; g.font = '600 22px "Atkinson Hyperlegible Next", sans-serif';
  for (let i = 0; i <= 30; i++) { const x = GX + i * PPI; if (x > W - 10) break; g.fillRect(x, H - 26, 2, i % 6 ? 6 : 12); if (i % 6 === 0 && i) g.fillText(i + '″', x - 12, H - 32); }
  g.fillRect(GX, H - 20, W - GX - 10, 1);
  if (!view || view.kind !== 'clawd') return;
  [view.mic1, view.mic2].forEach((m, i) => {
    if (!m) return;
    const x = GX + Math.min(m.dist, 30) * PPI, y = CY + (i ? 1 : -1) * Math.max(0.12, Math.min(m.pos, 1.2)) * 4.4 * PPI;
    const a = (m.ang * Math.PI) / 180 * (i ? -1 : 1);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = i ? '#ffc85a' : '#d8d2c0'; g.fillRect(0, -0.65 * PPI, 6 * PPI, 1.3 * PPI);
    g.fillStyle = '#6a6a74'; g.fillRect(-0.4 * PPI, -0.75 * PPI, 1.2 * PPI, 1.5 * PPI);
    g.restore();
    g.strokeStyle = i ? '#ffc85a88' : '#d8d2c088'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(GX, y); g.lineTo(x - 0.5 * PPI, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = i ? '#ffc85a' : '#e8e0cc'; g.font = '700 25px "Atkinson Hyperlegible Next", sans-serif';
    g.fillText(`${i ? 'Mic 2' : 'Mic 1'}: ${inches(m.dist)} back, ${Math.round(m.ang)}°`, Math.min(x, W - 290), y + (i ? 48 : -24));
  });
}
const distOf = (x) => clamp((x - GX) / PPI, 0.5, 24);

/* ------------------------------------------------------------------------------------------------ a radio group of chips */
function chips(label, items, { cls = '', cur, onPick }) {
  const g = h(`div.grs-chips${cls ? '.' + cls : ''}`, { role: 'radiogroup', 'aria-label': label });
  for (const it of items) {
    g.append(h('button.grs-chip', { type: 'button', role: 'radio', 'aria-checked': String(it.id === cur), title: it.title || '', onclick: () => onPick(it.id) }, it.name));
  }
  // (arrows move along the group: the room leaves a focused radio group its arrows)
  g.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
    const bs = [...g.querySelectorAll('button')], i = bs.indexOf(/** @type {any} */ (document.activeElement));
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    bs[(i + d + bs.length) % bs.length].focus();
  });
  return g;
}

/* ------------------------------------------------------------------------------------------------ the cab builder */
export function cabPanel(R, host, { where = 'stage', saveRow = null } = {}) {
  let shape = '', parts = null;
  const amp = () => { const r = R.rig.now(); return r?.amp ? { slot: r.amp.slot, link: r.chain[r.amp.slot] } : null; };
  const turn = (slot, key, v, commit = true) => R.rig.turn(slot, key, v, { commit });
  const say = (t) => R.say(t);
  function render() {
    const a = amp();
    const view = a ? cabOf(a.link) : null;
    shape = keyOf(a, view);
    parts = { faders: {}, mini: null, side: null, outs: {} };
    host.replaceChildren();
    host.classList.add('grs-panel');
    if (!a || !view) {
      host.append(h('div.kind', 'The cab · your stack'), h('h2.grs-disp', 'No amp'), h('p', SAY.noAmp()),
        h('div.row', h('button.grs-b', { type: 'button', onclick: () => R.press('shop:wall') }, 'The amp wall', h('kbd', 'A'))));
      return;
    }
    if (view.kind === 'stack') {
      host.append(h('div.kind', 'The cab · your stack'), h('h2.grs-disp', view.cabName), h('p', view.cabBlurb),
        h('p.note', `The ${view.amp}’s cabs are measured: each one a 4x12 and its mics as the engineer left them. A Claw’d-o-Matic head off the wall has mics you can move.`),
        h('h3', 'Which cab'),
        chips('Which cab', view.opts.map((name, i) => ({ id: i, name })), { cls: 'grs-cablist', cur: view.index, onPick: (i) => { if (turn(a.slot, 'cab', i).ok) say(SAY.stackCab({ cab: view.opts[i] })); } }));
      if (saveRow) host.append(saveRow());
      return;
    }
    const mini = where === 'stage';
    host.append(h('div.kind', 'The cab · your stack'), h('h2.grs-disp', view.cabName), h('p', view.cabBlurb ? view.cabBlurb + '.' : ''),
      h('p.note', mini ? 'From the front: drag a mic across a cone. At the cap it’s bright; out toward the edge it’s darker.' : 'You’re at the grille. Drag a mic across a cone: at the cap it’s bright, out toward the edge it’s darker.'));
    if (mini) {
      const box = cabBox(view.shown), w = 372, hh = Math.round(box.h * (w / box.w));
      const wrap = h('div.grs-front', { style: { height: hh + 'px' } });
      const cab = cabView(view.shown, w, hh, { mini: true, label: view.cab === 'own' ? 'Its own' : null });
      wrap.append(cab.el);
      host.append(wrap);
      parts.mini = cab;
      placeMics(cab, view, { R, slot: a.slot, drag: true, onSay: say });
    }
    const pick = (id) => {
      const i = cabIndex(id);
      if (turn(a.slot, 'cab', i).ok) say(SAY.cab({ cab: id === 'own' ? `${view.amp}’s own cab` : CABS[id].name, amp: view.amp, blurb: CABS[id]?.blurb || '' }));
    };
    host.append(h('h3', 'Which cab'),
      chips('Which cab', GUITAR_CABS.map((id) => ({ id, name: id === 'own' ? 'Its own' : CABS[id].name, title: CABS[id]?.blurb || '' })), { cls: 'grs-cablist', cur: view.cab, onPick: pick }),
      h('p.note', 'Bass cabs:'),
      chips('Bass cabs', BASS_CABS.map((id) => ({ id, name: CABS[id].name, title: CABS[id].blurb })), { cls: 'grs-cablist', cur: view.cab, onPick: pick }));
    const side = h('canvas.grs-side', { width: 744, height: 300, 'aria-label': 'The mics from the side: drag to set how far back the nearest one stands' });
    parts.side = side;
    host.append(h('h3', 'From the side'), side);
    drawSide(side, view);
    // dragging on the side view moves the nearest mic back and forth
    side.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const v = cabOf(amp()?.link);
      if (!v || v.kind !== 'clawd') return;
      e.preventDefault(); side.setPointerCapture(e.pointerId);
      const at = (ev) => { const b = side.getBoundingClientRect(); return { x: (ev.clientX - b.left) * (side.width / b.width), y: (ev.clientY - b.top) * (side.height / b.height) }; };
      const p0 = at(e), i = v.mic2 && p0.y > CY ? 1 : 0;
      const key = KEYS[i].dist;
      let d = Math.round(distOf(p0.x) * 10) / 10;
      turn(a.slot, key, d, false);
      const mv = (ev) => { d = Math.round(distOf(at(ev).x) * 10) / 10; turn(a.slot, key, d, false); };
      const up = () => {
        side.removeEventListener('pointermove', mv); side.removeEventListener('pointerup', up); side.removeEventListener('pointercancel', up);
        turn(a.slot, key, d, true);
        say(SAY.micMoved({ mic: i ? 'Mic 2' : 'Mic 1', where: onCone((i ? v.mic2 : v.mic1).pos), dist: inches(d), tone: d < 2 ? 'close, and the lows come up' : d > 8 ? 'the room comes in' : 'a little air' }));
      };
      side.addEventListener('pointermove', mv); side.addEventListener('pointerup', up); side.addEventListener('pointercancel', up);
    });
    const micRows = (m, i) => {
      const k = KEYS[i];
      const pos = fader({ label: `Mic ${i + 1}: where on the cone`, min: 0, max: 1.35, value: m.pos, step: 0.01, fmt: (v) => `${(+v).toFixed(2)} ${whereOnCone(v)}`, cls: i ? 'm2' : '', onInput: (v, c) => { setOut(`${i}pos`, v.toFixed(2)); turn(a.slot, k.pos, v, c); if (c) say(SAY.micMoved({ mic: `Mic ${i + 1}`, where: onCone(v), dist: inches(m.dist), tone: v < 0.4 ? 'brighter' : v > 0.82 ? 'darker' : 'rounder' })); } });
      const dist = fader({ label: `Mic ${i + 1}: distance from the grille`, min: 0.5, max: 24, value: m.dist, log: true, step: 0.1, fmt: inches, cls: i ? 'm2' : '', onInput: (v, c) => { setOut(`${i}dist`, inches(v)); turn(a.slot, k.dist, v, c); if (c) say(SAY.micMoved({ mic: `Mic ${i + 1}`, where: onCone(m.pos), dist: inches(v), tone: v < 2 ? 'close, and the lows come up' : v > 8 ? 'the room comes in' : 'a little air' })); } });
      const ang = fader({ label: `Mic ${i + 1}: angle off axis`, min: 0, max: 60, value: m.ang, step: 1, fmt: (v) => Math.round(v) + '°', cls: i ? 'm2' : '', onInput: (v, c) => { setOut(`${i}ang`, Math.round(v) + '°'); turn(a.slot, k.ang, v, c); if (c) say(SAY.micAngle({ mic: `Mic ${i + 1}`, ang: Math.round(v), tone: v > 20 ? 'darker' : 'a touch darker' })); } });
      parts.faders[`${i}pos`] = pos; parts.faders[`${i}dist`] = dist; parts.faders[`${i}ang`] = ang;
      const out = (id, t) => (parts.outs[id] = h('output', t));
      return [
        chips(`Mic ${i + 1}`, MIC_IDS.map((id) => ({ id, name: MICS[id].name, title: MICS[id].blurb })), { cur: m.type, onPick: (id) => { if (turn(a.slot, k.type, MIC_IDS.indexOf(id) + (i ? 1 : 0)).ok) say(SAY.mic({ mic: MICS[id].name, blurb: MICS[id].blurb.charAt(0).toLowerCase() + MICS[id].blurb.slice(1) })); } }),
        h('p.note', MICS[m.type]?.blurb ? MICS[m.type].blurb + '.' : ''),
        h('div.row', h('span.lab', 'On the cone'), pos.el, out(`${i}pos`, m.pos.toFixed(2))),
        h('div.row', h('span.lab', 'Distance'), dist.el, out(`${i}dist`, inches(m.dist))),
        h('div.row', h('span.lab', 'Angle'), ang.el, out(`${i}ang`, Math.round(m.ang) + '°')),
      ];
    };
    const setOut = (id, t) => { if (parts.outs[id]) parts.outs[id].textContent = t; };
    host.append(h('h3', 'Mic 1'), ...micRows(view.mic1, 0), h('h3', 'Mic 2'));
    if (view.mic2) {
      const m2 = view.mic2;
      const blend = fader({ label: 'Blend: 0 all mic 1, 10 all mic 2', min: 0, max: 10, value: m2.blend, step: 0.1, fmt: fmt1, cls: 'm2', onInput: (v, c) => { setOut('blend', fmt1(v)); turn(a.slot, 'blend', v, c); if (c) say(SAY.blend({ blend: fmt1(v), tone: v < 4.95 ? 'mostly mic 1' : v > 5.05 ? 'mostly mic 2' : 'even' })); } });
      parts.faders.blend = blend;
      host.append(...micRows(m2, 1),
        h('div.row', h('span.lab', 'Blend'), blend.el, (parts.outs.blend = h('output', fmt1(m2.blend)))),
        h('div.row', h('span.lab', 'Phase'), h('button.grs-chip', { type: 'button', 'aria-pressed': String(m2.flip), onclick: () => { if (turn(a.slot, 'flip', m2.flip ? 0 : 1).ok) say(SAY.flip({ on: !m2.flip })); } }, m2.flip ? 'Flipped' : 'Normal')),
        h('div.row', h('button.grs-b', { type: 'button', onclick: () => { if (turn(a.slot, 'mic2', 0).ok) say(SAY.mic2Off()); } }, 'Take mic 2 away')));
    } else {
      host.append(h('div.row', h('button.grs-b', { type: 'button', onclick: () => {
        // a ribbon on the next cone, half and half (one step: the mic and its blend)
        const sp = R.gr.shop.mics || (R.gr.shop.mics = []);
        sp[1] = { cone: Math.min(1, (CABS[view.shown]?.n || 1) - 1), ang: -0.6 };
        if (R.rig.turn(a.slot, 'mic2', 1 + MIC_IDS.indexOf('ribbon'), { commit: true }).ok) say(SAY.mic2On({ mic: MICS.ribbon.name }));
      } }, 'Put up a second mic')));
    }
    if (saveRow) host.append(saveRow());
  }
  function keyOf(a, v) {
    if (!a || !v) return 'none';
    return JSON.stringify([a.link.device, v.kind, v.index, v.mic1?.type, v.mic2?.type || null, v.mic2?.flip || false]);
  }
  function refresh() {
    const a = amp();
    const view = a ? cabOf(a.link) : null;
    if (!parts || keyOf(a, view) !== shape) { if (!R.gr.shop.dragging) render(); return; }
    if (!view || view.kind !== 'clawd') return;
    const set = (id, v) => parts.faders[id]?.set(v);
    set('0pos', view.mic1.pos); set('0dist', view.mic1.dist); set('0ang', view.mic1.ang);
    const outs = parts.outs, t = (id, s) => { if (outs[id]) outs[id].textContent = s; };
    t('0pos', view.mic1.pos.toFixed(2)); t('0dist', inches(view.mic1.dist)); t('0ang', Math.round(view.mic1.ang) + '°');
    if (view.mic2) {
      set('1pos', view.mic2.pos); set('1dist', view.mic2.dist); set('1ang', view.mic2.ang); set('blend', view.mic2.blend);
      t('1pos', view.mic2.pos.toFixed(2)); t('1dist', inches(view.mic2.dist)); t('1ang', Math.round(view.mic2.ang) + '°'); t('blend', fmt1(view.mic2.blend));
    }
    if (parts.side) drawSide(parts.side, view);
    if (parts.mini && !R.gr.shop.dragging) placeMics(parts.mini, view, { R, slot: a.slot, drag: true, onSay: say });
  }
  return { render, refresh, dispose() { host.replaceChildren(); parts = null; } };
}
