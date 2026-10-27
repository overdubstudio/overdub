// The stack's parts, drawn [ui; the guitar room's ROOM stream] (the second mock's buildCab, buildMic, tunerFace and
// drawCables, design/mock/guitar-room-2/app.js, carried into the app on the real devices). Pure DOM builders: the room
// (./stage.js) places them and wires them to the rig (./bind.js); nothing here reads the song or changes it.
//
//   cabOf(amp) -> { id, name, n, size, back, odd, box: { w, h } }   the cab under an amp slot (core/liveroom/guitar/
//       rig.js Slot): its CAB param (devices/guitar/amps.js CAB_IDS; 'own' is the cab the amp was voiced with, from
//       Claw'd-o-Matic's PLUG_AMP_BOX), and how big it stands on the stage, in world units
//   micsOf(values) -> [{ type, name, pos, dist, ang }]  the amp's mics (MIC, POSITION, DISTANCE, ANGLE; MIC 2 when on)
//   buildCab(cab, w, h) -> el (el._cones: [{ x, y, r }] in the cab's own units)   the box, its grille, its speakers
//   buildMic(i) -> el                                  a mic on its stand (placed by placeMic)
//   placeMic(el, mic, at, cab)                          at: { cone, ang } (where on the grille it's drawn: not a param)
//   tunerFace({ onStomp }) -> { el, update({ on, note, cents, string, inTune }) }   Tuna Fork, the room's own tuner
//       pedal, first on every board (not a device: the room's tuner, ./start.js's)
//   noSelects(el, name)                                 a face's menus (a switch of four or more, ui/faces.js) made
//       buttons that step through the options: the room draws no <select> (keys always land, ./keys.js)
//   syncPicks(el)                                       those buttons' words, after the face was updated
//   drawCables(svg, geo, { plugged, plugT, lit })      the guitar into the first jack (a real plug on its end),
//       pedal to pedal, up the cab's side to the head's input, and the amp's loop out and back
//   MIC_WORD, inches(d), whereOnCone(r)

import { h } from '../../dom.js';
import { clawd } from '../../../devices/guitar/clawd.js';
import { CAB_IDS, MIC_IDS } from '../../../devices/guitar/amps.js';

const { PLUG_CABS, PLUG_AMP_BOX, PLUG_MICS } = clawd;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const inches = (d) => (d < 1 ? (+d).toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '″';
export const whereOnCone = (r) => (r < 0.12 ? 'centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'cone' : r <= 1.04 ? 'cone edge' : 'off the cone');
export const MIC_WORD = Object.fromEntries(MIC_IDS.map((k) => [k, PLUG_MICS[k]?.name || k]));

function boxOf(c) {
  if (c.odd === 'fridge') return { w: 300, h: 420 };
  if (c.odd === 'box') return { w: 280, h: 210 };
  if (c.odd === 'phone') return { w: 200, h: 150 };
  if (c.odd === 'horn') return { w: 380, h: 300 };
  const n = c.n || 1, s = c.size || 12;
  if (n >= 8) return { w: 496, h: 420 };
  if (n === 4) return { w: s >= 12 ? 496 : 420, h: s >= 12 ? 330 : 300 };
  if (n === 2) return { w: s >= 12 ? 496 : 400, h: s >= 12 ? 230 : 210 };
  return { w: s >= 15 ? 340 : s >= 12 ? 320 : 260, h: s >= 15 ? 340 : s >= 12 ? 270 : 220 };
}

export function cabOf(amp) {
  const params = amp?.params || {};
  const id = CAB_IDS[Math.round(+params.cab || 0)] || 'own';
  if (id !== 'own' && PLUG_CABS[id]) {
    const c = PLUG_CABS[id];
    return { id, name: c.name, n: c.n || 1, size: c.size || 12, back: c.back || 'closed', odd: c.odd || null, box: boxOf(c) };
  }
  // the cab the amp was voiced with ([speakers, size, back]); the Half Stack and an amp without one: a closed 4x12
  const short = String(amp?.device || '').replace(/^amp\./, '');
  const [n, size, back] = PLUG_AMP_BOX?.[short] || [4, 12, 'closed'];
  // (the radio, the bitcrusher, the tape: an odd little box, drawn as the phone's)
  const odd = back === 'odd' ? 'phone' : null;
  return { id: 'own', name: `${n}x${size}, its own`, n, size, back, odd, box: boxOf({ n, size, odd }) };
}

export function micsOf(v = {}) {
  const out = [];
  const t1 = MIC_IDS[clamp(Math.round(+v.mic || 0), 0, MIC_IDS.length - 1)] || 'dyn';
  out.push({ type: t1, name: MIC_WORD[t1], pos: Number.isFinite(+v.micpos) ? +v.micpos : 0.3, dist: Number.isFinite(+v.micdist) ? +v.micdist : 1, ang: +v.micang || 0 });
  const m2 = Math.round(+v.mic2 || 0);
  if (m2 > 0 && MIC_IDS[m2 - 1]) {
    const t2 = MIC_IDS[m2 - 1];
    out.push({ type: t2, name: MIC_WORD[t2], pos: Number.isFinite(+v.mic2pos) ? +v.mic2pos : 0.62, dist: Number.isFinite(+v.mic2dist) ? +v.mic2dist : 1, ang: +v.mic2ang || 0 });
  }
  return out;
}

export function buildCab(cab, w, hh) {
  const el = h('div.gr-r-cab' + (cab.odd ? '.gr-r-odd-' + cab.odd : ''), { dataset: { cab: cab.id } });
  const grille = h('div.gr-r-grille'), cones = h('div.gr-r-cones');
  // the speakers, in the box's grid
  const n = cab.n || 1, cols = n >= 2 ? 2 : 1, rows = Math.ceil(n / cols);
  const gw = w - 40, gh = hh - 52, r = Math.min(gw / cols, gh / rows) * 0.44;
  const list = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols), ccx = (gw / cols) * (col + 0.5), ccy = (gh / rows) * (row + 0.5);
    const cone = h('i.gr-r-cone', { style: `left:${ccx - r}px;top:${ccy - r}px;width:${r * 2}px;height:${r * 2}px` });
    cones.append(cone);
    list.push({ x: 20 + ccx, y: 22 + ccy, r });
  }
  grille.append(cones, h('i.gr-r-cloth'));
  el.append(grille, h('span.gr-r-cab-logo', cab.odd === 'fridge' ? 'Coldspot' : cab.odd === 'box' ? 'THIS SIDE UP' : 'CLAWD-O-TONE'), h('span.gr-r-cab-name', cab.name));
  if (!cab.odd) {
    for (const k of ['tl', 'tr', 'bl', 'br']) el.append(h('i.gr-r-corner.gr-r-' + k));
    el.append(h('i.gr-r-caster', { style: 'left:26px' }), h('i.gr-r-caster', { style: 'right:26px' }));
  }
  el._cones = list;
  return el;
}

export function buildMic(i) {
  return h('div.gr-r-mic' + (i ? '.gr-r-m2' : ''), { dataset: { mic: String(i) } },
    h('i.gr-r-mic-stand'),
    h('i.gr-r-mic-body', { title: 'Drag it across the cone (close up, at the cab)' }),
    h('span.gr-r-mic-tag'));
}

// a mic in front of the grille: on cone `at.cone`, `pos` cone radii from the dust cap, at angle `at.ang`
export function placeMic(el, mic, at, cab) {
  const cones = cab.el._cones || [];
  const c = cones[clamp(at.cone || 0, 0, Math.max(0, cones.length - 1))] || { x: cab.w / 2, y: cab.h / 2, r: 60 };
  const r = clamp(mic.pos, 0, 1.35) * c.r, x = cab.x + c.x + Math.cos(at.ang) * r, y = cab.y + c.y + Math.sin(at.ang) * r;
  const sc = clamp(1.25 - Math.log2(mic.dist + 1) * 0.12, 0.7, 1.2) * Math.min(1, cab.w / 400);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.transform = `scale(${sc.toFixed(3)})`;
  el.className = el.className.replace(/\bgr-r-t-\w+/g, '').trim() + ' gr-r-t-' + mic.type;
  el.querySelector('.gr-r-mic-stand').style.height = Math.max(0, (cab.y + cab.h - y + 6) / sc) + 'px';
  el.querySelector('.gr-r-mic-tag').textContent = `${el.dataset.mic === '1' ? 'Mic 2: ' : ''}${mic.name}, ${whereOnCone(mic.pos)}, ${inches(mic.dist)}`;
}

/* ------------------------------------------------------------------------------------------- Tuna Fork */
export function tunerFace({ onStomp }) {
  const leds = Array.from({ length: 15 }, (_, i) => h('i' + (i === 7 ? '.gr-r-mid' : '')));
  const note = h('div.gr-r-tn-note', '–'), str = h('span.gr-r-tn-str'), cents = h('span.gr-r-tn-cents');
  const sw = h('button.gr-r-tn-sw', { type: 'button', 'aria-label': 'Tuna Fork, the tuner: stomp it on (it mutes you) or off', 'aria-pressed': 'false', onclick: (e) => { e.stopPropagation(); onStomp(); } });
  const el = h('div.gr-r-tuner',
    h('div.gr-r-tn-win', h('div.gr-r-tn-leds', leds), note, str, cents),
    h('div.gr-r-tn-name', h('b', 'Tuna Fork'), h('small', 'TUNER · MUTE')),
    h('div.gr-r-tn-mute', h('i'), 'MUTE'),
    sw);
  let was = '';
  return {
    el,
    // t: { on, input, note, octave, cents (as shown, rounded), string (its number), inTune, held } (R.gr.tuner.reading,
    // the start stream's, beside on)
    update(t = {}) {
      const on = !!t.on, c = Number.isFinite(t.cents) ? t.cents : null;
      const key = [on, t.input, t.note, t.octave, c, t.string, t.inTune, t.held].join('|');
      if (key === was) return;
      was = key;
      el.classList.toggle('gr-on', on);
      el.classList.toggle('gr-held', on && !!t.held);
      sw.setAttribute('aria-pressed', String(on));
      const at = c == null || !t.note ? null : clamp(Math.round(c / 6.5), -7, 7);
      leds.forEach((l, i) => l.classList.toggle('gr-on', on && at != null && (i === 7 + at || (!!t.inTune && Math.abs(i - 7) <= 1))));
      note.classList.toggle('gr-in', on && !!t.note && !!t.inTune);
      if (!on) { note.textContent = '–'; str.textContent = ''; cents.textContent = ''; return; }
      if (!t.note) { note.textContent = t.input === false ? '··' : '–'; str.textContent = t.input === false ? 'NO INPUT' : ''; cents.textContent = ''; return; }
      note.replaceChildren(String(t.note), ...(t.octave != null ? [h('sub', String(t.octave))] : []));
      str.textContent = t.string ? `STRING ${t.string}` : '';
      cents.textContent = c == null ? '' : c === 0 ? '0¢' : `${c > 0 ? '+' : '−'}${Math.abs(Math.round(c))}¢`;
    },
  };
}

/* ------------------------------------------------------------------------------------------- a face's menus, as buttons */
export function noSelects(el, name = '') {
  for (const s of [...el.querySelectorAll('select')]) {
    const opts = [...s.options].map((o) => o.textContent);
    const label = s.getAttribute('aria-label') || name;
    const b = h('button.gr-r-pick', { type: 'button', title: `${label}: click for the next, Shift-click for the one before` });
    b._select = s;
    b._opts = opts;
    const step = (d) => {
      const i = (Math.round(+s.value || 0) + d + opts.length) % opts.length;
      s.value = String(i);
      s.dispatchEvent(new Event('change'));
      syncPick(b);
    };
    b.addEventListener('click', (e) => { e.stopPropagation(); step(e.shiftKey ? -1 : 1); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.setAttribute('aria-label', label);
    s.replaceWith(b);
    syncPick(b);
  }
}
function syncPick(b) { const i = Math.round(+b._select.value || 0); b.textContent = b._opts[i] ?? ''; b.setAttribute('aria-description', `${i + 1} of ${b._opts.length}`); }
export function syncPicks(el) { for (const b of el.querySelectorAll('.gr-r-pick')) if (b._select) syncPick(b); }

/* ------------------------------------------------------------------------------------------- the cables */
const NS = 'http://www.w3.org/2000/svg';
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
// geo: { slots: [{ x, y, w, h, loop }] (the tuner first), jack: { x, y }, head: { x, y, w, h }, cab: { x, y, w, h },
// hin: { x, y } (the head's input), board: { x, y, w, h }, worldW }
export function drawCables(svg, geo, { plugged = true, plugT = 1, lit = false } = {}) {
  if (!svg || !geo) return;
  const X = -480, Y = -120, Wd = geo.worldW + 960, Hd = 804 + 240;
  svg.setAttribute('viewBox', `${X} ${Y} ${Wd} ${Hd}`);
  Object.assign(svg.style, { left: X + 'px', top: Y + 'px', width: Wd + 'px', height: Hd + 'px' });
  svg.replaceChildren();
  const el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); svg.append(e); return e; };
  const path = (d, hot) => { for (const [w, c] of [[8, '#050506'], [4, hot ? '#6a5a3a' : '#26262c']]) el('path', { d, fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round' }); };
  const slots = geo.slots, pre = slots.filter((s) => !s.loop), post = slots.filter((s) => s.loop);
  const sideY = (s) => s.y + s.h * 0.32 + 5;
  function plug(px, py, tip) {
    el('path', { d: `M ${px - 52} ${py - 4} L ${px - 36} ${py - 6} L ${px - 36} ${py + 6} L ${px - 52} ${py + 4} Z`, fill: '#141418', stroke: '#050506', 'stroke-width': 1.5 });
    el('rect', { x: px - 37, y: py - 7.5, width: 28, height: 15, rx: 3, fill: '#c4c4cc', stroke: '#050506', 'stroke-width': 1.5 });
    el('rect', { x: px - 35, y: py - 5.5, width: 24, height: 2.5, rx: 1, fill: '#f0f0f4' });
    el('rect', { x: px - 10, y: py - 5, width: 9, height: 10, fill: '#8a8a92', stroke: '#050506', 'stroke-width': 1 });
    if (tip) { el('rect', { x: px - 1, y: py - 2.5, width: 12, height: 5, fill: '#d8d2c0' }); el('rect', { x: px + 8, y: py - 3, width: 4, height: 6, rx: 2, fill: '#e8e0cc' }); }
  }
  // the guitar: from off the stage to a plug in the first jack; or the plug lying on the floor
  if (slots[0] && geo.jack) {
    const j = geo.jack, bb = geo.board.y + geo.board.h, x0 = Math.max(X, geo.board.x - 300);
    if (plugged) {
      const px = j.x - 2 - 120 * (1 - ease(plugT)), py = j.y;
      path(`M ${x0} ${bb + 30} C ${px - 240} ${bb + 10}, ${px - 110} ${py + 30}, ${px - 50} ${py}`, lit);
      plug(px, py, plugT < 1);
    } else {
      path(`M ${x0} ${bb + 30} C ${x0 + 200} ${bb + 20}, ${j.x - 160} ${bb + 4}, ${j.x - 100} ${bb - 12}`, lit);
      plug(j.x - 60, bb - 12, true);
    }
  }
  for (let i = 0; i + 1 < pre.length; i++) { const a = pre[i], b = pre[i + 1], ya = sideY(a), yb = sideY(b); path(`M ${a.x + a.w + 2} ${ya} C ${a.x + a.w + 14} ${ya - 26}, ${b.x - 12} ${yb - 26}, ${b.x - 2} ${yb}`); }
  // the last pedal before the amp, up the cab's left side to the head's input
  const head = geo.head, cab = geo.cab, last = pre[pre.length - 1], hin = geo.hin;
  if (!head || !cab || !hin) return;
  const lx = Math.min(cab.x, head.x) - 14;
  if (last) { const ya = sideY(last); path(`M ${last.x + last.w + 2} ${ya} C ${last.x + last.w + 30} ${ya - 60}, ${lx - 12} ${cab.y + cab.h + 20}, ${lx} ${cab.y + cab.h - 40} L ${lx} ${hin.y + 40} C ${lx} ${hin.y + 10}, ${hin.x - 20} ${hin.y}, ${hin.x - 2} ${hin.y}`); }
  // the loop: out of the head's back, down the cab's right side, through the loop's pedals, and back
  if (post.length) {
    const sx = head.x + head.w - 6, sy = head.y + head.h * 0.5, f = post[0], l = post[post.length - 1], rx = cab.x + cab.w;
    path(`M ${sx} ${sy} C ${rx + 18} ${sy}, ${rx + 14} ${sy + 30}, ${rx + 14} ${sy + 60} L ${rx + 14} ${cab.y + cab.h - 30} C ${rx + 14} ${cab.y + cab.h + 30}, ${f.x - 40} ${sideY(f)}, ${f.x - 2} ${sideY(f)}`);
    for (let i = 0; i + 1 < post.length; i++) { const a = post[i], b = post[i + 1], ya = sideY(a), yb = sideY(b); path(`M ${a.x + a.w + 2} ${ya} C ${a.x + a.w + 14} ${ya - 26}, ${b.x - 12} ${yb - 26}, ${b.x - 2} ${yb}`); }
    path(`M ${l.x + l.w + 2} ${sideY(l)} C ${l.x + l.w + 40} ${sideY(l) - 90}, ${rx + 26} ${cab.y + cab.h}, ${rx + 24} ${cab.y + cab.h - 40} L ${rx + 24} ${sy + 50} C ${rx + 24} ${sy + 14}, ${sx + 10} ${sy + 10}, ${sx - 4} ${sy + 10}`);
  }
}
