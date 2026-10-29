// The guitar room, as a clickable mock (docs/research/GUITAR-ROOM.md §5). No sound, no mic: the meter, the tuner, the
// drummer, the tape and every take are fake state, moved by one requestAnimationFrame loop. The stage is the room's
// real pixel scene (app/src/ui/liveroom/pixels/), the pedals and amps are the Guitar Studio's real devices drawn by the
// studio's real faces (app/src/ui/faces.js), and the shop is new pixel art in the same brushes (./shop-pixels.js).
// window.mock.go(n) jumps to one of §5's nine screens (the corner menu does the same); the flow also plays through.

import { sceneOf } from '/app/src/ui/liveroom/pixels/index.js';
import '/app/src/devices/guitar/index.js';
import { getDevice, paramValues, presetParams } from '/app/src/devices/registry.js';
import { renderFace, colorsOf } from '/app/src/ui/faces.js';
import STACK from '/app/src/devices/builtin/stack.js';
import { BEATS, beatById, HOUSE_STACKS, MINE_STACKS, BEFORE_AMP, makeLibrary, songsOf, when, riffShape, rng, hash } from './data.js';
import { drawShop, drawCabRoom, hotspots, AMP_LOOKS, CONES, MIC_SPOTS, micWhere, inches, CAB, SIDE } from './shop-pixels.js';

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
const by = (who) => (!who || who === 'overdub' ? null : h('span.by.' + (who === 'you' ? 'by-human' : 'by-agent'), who === 'you' ? 'you' : 'Claude'));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const now = () => performance.now();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtBars = (b) => (Math.abs(b - Math.round(b)) < 0.01 ? String(Math.round(b)) : b.toFixed(1).replace(/\.0$/, ''));
const plural = (n, w) => `${fmtBars(n)} ${w}${Math.abs(n - 1) < 0.01 ? '' : 's'}`;
const secsOf = (bars, tempo) => (bars * 4 * 60) / tempo;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
function sizeCanvas(c) { const r = c.getBoundingClientRect(), d = dpr(); const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d)); if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; } return { w, h: hh, d }; }
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = {};
function colors() { for (const k of ['bg', 'bg-2', 'bg-3', 'line', 'line-2', 'text', 'text-2', 'text-3', 'accent', 'accent-2', 'agent', 'human', 'rec']) C[k] = css('--' + k); C.lamp = '#ffc85a'; }

/* ================================================================================================ the state */
const STACK_FEW = { ...STACK, params: STACK.params.filter((p) => ['gain', 'bass', 'mid', 'treble', 'presence'].includes(p.key)) };
let uidN = 1;
const uid = (p) => `${p}${uidN++}`;
function stackFrom(def) {
  return {
    id: def.id, name: def.name, amp: def.amp, setting: def.setting || null, changed: false, by: def.by || null,
    ampParams: def.amp === 'core.stack' ? { ...presetParams(STACK, def.setting || 'Modern') } : {},
    chain: def.chain.map((c) => (c.amp ? { amp: true, uid: uid('a') } : { device: c.device, on: c.on, uid: uid('p'), params: {} })),
    cab: { cab: def.amp === 'core.stack' ? 'Modern 4x12' : 'Its own', mic: { id: 'dyn', x: 59 + 9, y: 46 - 4, dist: 1 } },
  };
}
const LIB = makeLibrary(166);
let S;
function fresh() {
  return {
    screen: 'stage', claude: true, tempo: 132, tuning: 'Drop C', key: 'C minor',
    drummer: { on: false, t0: 0, beat: 'guide', by: null },
    play: null, stack: stackFrom(HOUSE_STACKS[0]), rack: [...HOUSE_STACKS, ...MINE_STACKS].map((s) => ({ ...s, tag: TAGS[s.id] })),
    loaded: 'tight', riffs: [], riffN: 1, parts: [], sel: null, selRiff: null, loopRiff: null,
    talk: { text: '', by: 'overdub', at: 0, asked: null }, talking: false, thinking: false,
    ob: null, tour: null, tuner: false, sheet: null, pending: null, rec: null, menu: null,
    shop: { look: null, room: 'floor', naming: false, name: '' },
    lib: { q: '', song: undefined, tuning: null, tempo: null, when: null, starred: false, sel: null, renaming: false },
    undo: [], taps: [],
  };
}
const TAGS = { tight: 'TIGHT', djent: 'DJENT', scooped: 'SCOOPED', thrash: 'THRASH', doom: 'DOOM', british: 'BRITISH', 'mine-basement': 'BSMT', 'mine-lead': 'LEAD' };

function say(text, who = 'overdub', asked = null) { S.talk = { text, by: who, at: now(), asked }; renderTalk(); }
function snapshot(label) {
  S.undo.push({ label, data: JSON.stringify({ parts: S.parts, riffs: S.riffs, drummer: { beat: S.drummer.beat, by: S.drummer.by }, stack: S.stack, sel: S.sel, rack: S.rack, loaded: S.loaded, tempo: S.tempo }) });
  if (S.undo.length > 60) S.undo.shift();
}
function undo() {
  const u = S.undo.pop();
  if (!u) { say('Nothing to undo.'); return; }
  const d = JSON.parse(u.data);
  Object.assign(S, { parts: d.parts, riffs: d.riffs, stack: d.stack, sel: d.sel, rack: d.rack, loaded: d.loaded, tempo: d.tempo });
  S.drummer.beat = d.drummer.beat; S.drummer.by = d.drummer.by;
  faces.clear();
  say(`Undone: ${u.label}.`);
  render();
}

/* ================================================================================================ fake signals */
// the drummer's hits from the beat's pattern at a beat position (16ths), each an envelope that decays
function hitsAt(beat, b) {
  const st = beat * 4, i = Math.floor(st);
  const env = (row) => { for (let k = 0; k < 16; k++) { const s = i - k; if (s < 0) break; const c = row[((s % 16) + 16) % 16]; if (c !== '.') return (c === 'X' ? 1 : 0.8) * Math.exp(-(st - s) * 1.7); } return 0; };
  const top = env(b.hat);
  return { kick: env(b.kick), snare: env(b.snare), hat: b.top === 'hat' || b.top === 'ride' ? top : 0, crash: b.top === 'crash' || b.top === 'china' ? top * 0.7 : 0 };
}
// your guitar: a palm-muted chug on the sixteenths while the drummer plays, a strum every few seconds when it doesn't
const CHUG = 'X.xx.xX.x.xxX.x.';
function guitarAt(beat) {
  const st = beat * 4, i = Math.floor(st);
  for (let k = 0; k < 8; k++) { const s = i - k; if (s < 0) break; const c = CHUG[((s % 16) + 16) % 16]; if (c !== '.') return (c === 'X' ? 0.95 : 0.7) * Math.exp(-(st - s) * 1.1); }
  return 0.05;
}
const idleStrum = (t) => { const p = t % 2600; return p < 1400 ? 0.8 * Math.exp(-p / 420) : 0; };
const beatNow = (t = now()) => (S.drummer.on ? ((t - S.drummer.t0) * S.tempo) / 60000 : 0);

/* ================================================================================================ the device faces */
const faces = new Map();
function faceOf(key, def, values, on, opts = {}) {
  let f = faces.get(key);
  if (!f || f.def !== def) {
    f = { def, face: renderFace(def, values, { on, size: 'compact', ...opts }) };
    faces.set(key, f);
  } else f.face.update(values, on);
  return f.face.el;
}
const ampDef = (st) => (st.amp === 'core.stack' ? STACK_FEW : getDevice(st.amp));
const ampName = (st) => (st.amp === 'core.stack' ? `Half Stack${st.setting ? ', ' + st.setting : ''}` : getDevice(st.amp)?.name || st.amp);
// (an amp's face is as wide as what it sits in, up to 470 px: the wrapper gives it that width, then zooms)
function zoomed(el, z) { const w = h('div.zoom', el); w.style.zoom = String(z); if (el.classList.contains('ewf-ampface')) w.style.width = '470px'; return w; }

/* ================================================================================================ layout */
const GUT = 24;
function fit() {
  const sideMin = 440;
  const byW = Math.floor((innerWidth - GUT * 3 - sideMin) / 256), byH = Math.floor((innerHeight - 300) / 144);
  const k = clamp(Math.min(byW, byH), 2, 4);
  document.documentElement.style.setProperty('--scene-w', 256 * k + 'px');
  document.documentElement.style.setProperty('--scene-h', 144 * k + 'px');
  // the shop has no side column and no tape under it: it takes a size up when the window has room
  const ks = clamp(Math.min(Math.floor((innerWidth - GUT * 3 - 330) / 256), Math.floor((innerHeight - 290) / 144)), 2, 4);
  document.documentElement.style.setProperty('--shop-w', 256 * ks + 'px');
  document.documentElement.style.setProperty('--shop-h', 144 * ks + 'px');
  S && render();
}

/* ================================================================================================ render: everything */
function render() {
  $('presence').className = 'gr-presence' + (S.claude ? ' on' : '');
  $('presence').replaceChildren(h('i'), S.claude ? h('span', h('span.by.by-agent', 'Claude'), ' is on the talkback') : 'The house engineer is on the talkback');
  $('where').textContent = S.screen === 'shop' ? 'The live room · The shop' : 'The live room · The metal club';
  $('stage').hidden = false;
  renderSide(); renderTalk(); renderBottom(); renderOver();
  renderSheet(); renderRec(); renderLib(); renderShop(); renderFloating(); renderScreens();
}

/* ---------------------------------------------------------------- the side: readout, drummer, floor */
function renderSide() {
  const side = $('side');
  const b = beatById(S.drummer.beat);
  const bar = S.drummer.on ? Math.floor(beatNow() / 4) + 1 : null;
  const ro = h('div.ro',
    h('span.ro-tempo', h('button.step', { type: 'button', 'aria-label': 'Slower', onclick: () => tempo(-1) }, '←'), h('b', String(S.tempo)), h('button.step', { type: 'button', 'aria-label': 'Faster', onclick: () => tempo(1) }, '→'), h('span.unit', ' BPM'), kbd('T'), h('span.t3', ' taps')),
    h('span.ro-sep'), h('span', S.tuning), h('span.t3', `${S.key} (read)`),
    h('span.ro-sep'), h('button.b-txt', { type: 'button', onclick: () => { S.tuner = !S.tuner; render(); } }, 'Tuner'), kbd('U'),
    h('span.gr-gap'), h('span.ro-bar', { id: 'robar' }, bar ? `BAR ${bar}` : ''));
  const grid = (beat) => h('div.grid', ['hat', 'snare', 'kick'].map((row) => [...beat[row]].map((c, i) => h('i' + (c === 'X' ? '.X' : c === 'x' ? '.x' : ''), { dataset: { i } }))));
  const drummer = h('section.drummer', { id: 'drummer' },
    h('h3.sec-h', h('span.name', 'The drummer'), h('span', 'a guide beat, yours to swap'), h('span.gap'), h('span', kbd('B'), ' next beat')),
    h('div.beat-now', h('span.name', b.name), S.drummer.by && S.drummer.by !== 'you' ? h('span', 'by ', by(S.drummer.by)) : null, h('span.note', b.note)),
    h('div.beats', BEATS.map((x) => h('button.beat', { type: 'button', 'aria-pressed': String(x.id === S.drummer.beat), title: x.name, onclick: () => setBeat(x.id) }, grid(x), h('span.bn', x.short)))),
    h('div.beats-axis', h('span', 'simpler'), h('span'), h('span'), h('span'), h('span', { style: 'text-align:right' }, 'busier'), h('span', { style: 'text-align:right' }, 'heavier')));
  const run = S.drummer.on || S.play;
  const primary = h('div.primary-row',
    h('button.b.b-go.b-big', { type: 'button', onclick: () => space() }, run ? (S.play ? 'Stop' : 'Stop the drummer') : 'Start the drummer', kbd('Space')));
  side.replaceChildren(ro, drummer, primary, renderFloor());
  fitFloor();
}
function renderFloor() {
  const st = S.stack;
  const board = h('div.board', { id: 'board' });
  let n = 0;
  st.chain.forEach((c, i) => {
    if (c.amp) {
      const def = ampDef(st), vals = st.amp === 'core.stack' ? st.ampParams : paramValues(def, st.ampParams);
      const el = faceOf('floor-amp-' + st.amp, def, vals, true, { onParam: (k, v, { commit }) => { st.ampParams[k] = v; if (commit) { changed(`${k === 'gain' ? 'Gain' : k[0].toUpperCase() + k.slice(1)} ${Number(v).toFixed(1)} on this song’s copy. Save to rack keeps it.`); } } });
      board.append(h('div.slot.amp', { dataset: { i } }, zoomed(el, 0.74), h('span.stomp', ampName(st))));
      return;
    }
    const def = getDevice(c.device);
    if (!def) return;
    n++;
    const k = n;
    const el = faceOf('floor-' + c.uid, def, paramValues(def, c.params), c.on, { onToggle: () => stomp(k) });
    const slot = h('div.slot' + (c.on ? '' : '.off'), { dataset: { i, uid: c.uid } }, zoomed(el, 1), h('button.stomp', { type: 'button', onclick: () => stomp(k) }, kbd(String(k)), c.on ? 'on' : 'off'));
    board.append(slot);
  });
  board.append(h('button.addpedal', { type: 'button', id: 'addpedal', onclick: (e) => { S.menu = S.menu ? null : 'add'; renderFloating(e.currentTarget); } }, '+ pedal'));
  return h('section.floor', { id: 'floor' },
    h('h3.sec-h', h('span.name', 'The floor'), h('span', S.stack.changed ? 'this song’s copy, changed' : 'this song’s copy of ' + st.name), h('span.gap'),
      st.changed ? h('button.b-txt', { type: 'button', onclick: () => saveToRack() }, 'Save to rack') : null, st.changed ? kbd('⌘S') : null),
    board,
    h('div.floor-foot', h('span', kbd('1'), '–', kbd(String(Math.max(1, n))), ' stomp'), h('span.hint', 'drag a knob, or focus it and use the arrows'), h('span.gap'), h('button.b-txt', { type: 'button', onclick: () => openShop() }, 'Build one in the shop'), kbd('S')));
}
function fitFloor() {
  const board = $('board');
  if (!board) return;
  // shrink every face by the same factor until the row fits the board (zoom changes layout, so measure again)
  for (let n = 0; n < 4 && board.scrollWidth > board.clientWidth + 1; n++) {
    const k = (board.clientWidth - 8) / board.scrollWidth;
    for (const z of board.querySelectorAll('.zoom')) z.style.zoom = String(parseFloat(z.style.zoom) * k);
  }
}

/* ---------------------------------------------------------------- the talkback */
function renderTalk() {
  const st = $('shoptb');
  if (st) st.replaceChildren(h('i.lamp' + (now() - S.talk.at < 4000 ? '.on' : '')), h('p', { role: 'status' }, S.talk.text ? [by(S.talk.by), S.talk.by !== 'overdub' ? ' ' : '', S.talk.text] : h('span.t3', 'The engineer’s quiet.')));
  const tb = $('tb');
  const lit = now() - S.talk.at < 4000;
  const rows = [];
  if (S.talking) {
    const field = h('input.tb-field', { id: 'tbfield', type: 'text', placeholder: 'Talk to Claude', 'aria-label': 'Talk to Claude', autocomplete: 'off', value: S.talkDraft || '' });
    field.addEventListener('input', () => { S.talkDraft = field.value; });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ask(field.value); }
      if (e.key === 'Escape') { e.preventDefault(); S.talking = false; render(); }
    });
    rows.push(h('div.tb-row', h('i.lamp.on', { style: 'background: var(--agent); box-shadow: none' }), h('div.tb-form', field, h('button.b', { type: 'button', onclick: () => ask(field.value) }, 'Send', kbd('Enter')))));
    rows.push(h('div.tb-ideas', h('span.t3', 'For example:'), ['Give me a beat that’s more thrash.', 'Make my tone like the record.', 'Grab that last riff.', 'Name these parts.'].map((q) => h('button.b-txt', { type: 'button', onclick: () => ask(q) }, q))));
    tb.replaceChildren(...rows);
    requestAnimationFrame(() => { const f = $('tbfield'); if (f && document.activeElement !== f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } });
    return;
  }
  if (S.talk.asked) rows.push(h('p.tb-asked', by('you'), ': ', S.talk.asked));
  const line = h('p.tb-line', { role: 'status', 'aria-live': 'polite' }, S.thinking ? h('span.t3', 'Claude is on it…') : [by(S.talk.by), S.talk.by !== 'overdub' ? ' ' : '', S.talk.text]);
  rows.push(h('div.tb-row', h('i.lamp' + (lit ? '.on' : ''), { id: 'tblamp' }), line, h('span.gr-gap'), S.claude ? h('button.b-txt', { type: 'button', onclick: () => openTalk() }, 'Talk to Claude') : null, S.claude ? kbd('/') : null));
  tb.replaceChildren(...rows);
}

/* ---------------------------------------------------------------- the bottom: tape line, tray, part line */
function renderBottom() {
  const bottom = $('bottom');
  const tape = h('button.tape', { type: 'button', id: 'tape', onclick: () => openTape(), 'aria-label': 'The tape: open the last minute' },
    h('canvas', { id: 'tapeline' }), h('span.tl', 'the tape, the last minute', kbd('G'), 'that was the one'));
  // the tray: this session's riffs first; the library a press away
  const tray = h('section.tray', { id: 'tray' },
    h('div.row-h', h('span.name', 'Riffs'), h('span', S.riffs.length ? 'this session' : ''), h('span.gap'), h('button.b-txt', { type: 'button', onclick: () => openLib() }, `All ${LIB.length + S.riffs.length}`), kbd('L')),
    h('div.lane', { id: 'traylane' }, S.riffs.length ? S.riffs.map((r) => riffCard(r)) : h('p.empty', 'Riffs you grab land here. Play something you like, then press ', h('b', 'G'), ' to grab it off the tape.')));
  // the part line
  const sel = S.parts.find((p) => p.id === S.sel);
  const lane = h('div.lane', { id: 'partlane' });
  if (!S.parts.length) {
    lane.append(h('div.empty-slot' + (S.sel === 'new' ? '.hot' : ''), { dataset: { drop: '0' }, onclick: () => { S.sel = 'new'; render(); } }, h('p.empty', 'Drop a riff here, or press ', h('b', 'R'), ' to record a part.')));
  } else {
    lane.append(h('div.gap-slot', { dataset: { drop: '0' } }));
    S.parts.forEach((p, i) => { lane.append(partCard(p, i)); lane.append(h('div.gap-slot', { dataset: { drop: String(i + 1) } })); });
    lane.append(h('button.addpart' + (S.sel === 'new' ? '.sel' : ''), { type: 'button', style: S.sel === 'new' ? 'border-color: var(--text); color: var(--text)' : '', onclick: () => { S.sel = 'new'; render(); } }, '+ New part', kbd('R')));
  }
  const total = S.parts.reduce((s, p) => s + p.bars, 0);
  const parts = h('section.parts', { id: 'parts' },
    h('div.row-h', h('span.name', 'The part line'), h('span', S.parts.length ? `${S.parts.length} part${S.parts.length > 1 ? 's' : ''}, ${total} bars, ${Math.round(secsOf(total, S.tempo))} s` : 'empty'), h('span.gap'),
      sel && sel.takes.L.length && !sel.takes.R.length ? h('button.b-txt', { type: 'button', onclick: () => otherSide() }, 'The other side') : null, sel && sel.takes.L.length && !sel.takes.R.length ? kbd('D') : null,
      S.parts.length ? h('span', kbd('Enter'), ' play from the selected part ', kbd('Home'), ' from the top') : null),
    lane);
  bottom.replaceChildren(tape, tray, parts);
  drawTapeLine();
  for (const c of bottom.querySelectorAll('canvas.wave')) drawMini(c);
}
function riffCard(r) {
  const el = h('div.card.riff' + (S.selRiff === r.id ? '.sel' : '') + (r.isNew ? '.new' : ''), { dataset: { riff: r.id }, tabindex: 0, role: 'button', 'aria-label': `${r.name}: ${r.bars} bars at ${r.tempo}` },
    h('div.c-in', h('span.c-name', r.name), h('span.c-meta', `${plural(r.bars, 'bar')} · ${r.tempo}`), h('span.c-sub', r.tuning, ', ', r.by === 'claude' ? h('span', 'grabbed by ', by('claude')) : 'off the tape')),
    h('canvas.wave', { dataset: { seed: r.seed, bars: r.bars, style: r.style } }),
    S.loopRiff === r.id ? h('i.loop', { id: 'riffloop' }) : null);
  r.isNew = false;
  dragSource(el, { kind: 'riff', id: r.id });
  return el;
}
function partCard(p, i) {
  const side = 'L', takes = p.takes[side], pick = p.pick[side];
  const tk = takes.length ? `take ${pick + 1} of ${takes.length}` : 'no take yet';
  const el = h('div.card' + (S.sel === p.id ? '.sel' : ''), { dataset: { part: p.id }, tabindex: 0, role: 'button', 'aria-label': `${p.name}, ${p.bars} bars` },
    h('div.c-in',
      h('span.c-name', p.name),
      h('span.c-meta', `${plural(p.bars, 'bar')} · ${tk}`, takes.length > 1 && S.sel === p.id ? h('span.t3', ' ↑↓') : null),
      h('span.c-sub', p.namedBy ? h('span', 'named by ', by(p.namedBy), ' · ') : null, beatById(p.beat || S.drummer.beat).name)),
    h('div.sides', h('i' + (p.takes.L.length ? '.on' : ''), 'L'), h('i' + (p.takes.R.length ? '.on' : ''), 'R')),
    h('button.x', { type: 'button', 'aria-label': `Delete ${p.name}`, onclick: (e) => { e.stopPropagation(); delPart(p.id); } }, '×'),
    h('canvas.wave', { dataset: { seed: (takes[pick]?.seed) || hash(p.id), bars: p.bars, style: takes.length ? 'chug' : 'none' } }));
  dragSource(el, { kind: 'part', id: p.id });
  return el;
}
function drawMini(c) {
  const { w, h: hh } = sizeCanvas(c), g = c.getContext('2d');
  g.clearRect(0, 0, w, hh);
  const style = c.dataset.style;
  if (style === 'none') { g.fillStyle = C['line-2']; g.fillRect(0, hh / 2, w, 1); return; }
  const cols = Math.floor(w / 2), shape = riffShape(Number(c.dataset.seed), Number(c.dataset.bars) || 4, cols, style);
  g.fillStyle = c.dataset.color || C['text-3'];
  for (let i = 0; i < cols; i++) { const v = Math.max(0.04, shape[i]) * (hh / 2 - 1); g.fillRect(i * 2, Math.round(hh / 2 - v), 1.5, Math.max(1, Math.round(v * 2))); }
}

/* ---------------------------------------------------------------- the tape */
// the last minute of the tape as the drummer's bars: what you played, where (the mock's story: a few ideas, then the
// one at the end)
const TAPE_STORY = [[0, 4, 'chug', 0.6], [5, 12, 'gallop', 0.85], [14, 18, 'open', 0.8], [19, 22, 'lead', 0.5], [24, 28, 'chug', 0.9]];
function tapeRange() {
  const nowBar = S.drummer.on ? beatNow() / 4 : S.tapeNow || 33;
  return { b0: nowBar - (60 * S.tempo) / 240, b1: nowBar, nowBar };
}
function tapeLevel(rel, cols, b0) {
  // rel: bars since the tape's start; what's on it at that point
  const out = new Float32Array(cols);
  const r = rng(77);
  for (const [s, e, style, a] of storyFor(b0)) {
    const shape = riffShape(9000 + s, e - s, Math.max(4, Math.round(((e - s) / rel) * cols)), style);
    const c0 = Math.round(((s) / rel) * cols);
    for (let i = 0; i < shape.length && c0 + i < cols; i++) if (c0 + i >= 0) out[c0 + i] = shape[i] * a;
  }
  for (let i = 0; i < cols; i++) out[i] = Math.max(out[i], 0.02 + r() * 0.025);
  return out;
}
// the story placed so that its last idea ends a little before now, in tape bars from the left edge
function storyFor() { const span = (60 * S.tempo) / 240, end = span - 1.2, last = TAPE_STORY[TAPE_STORY.length - 1][1]; return TAPE_STORY.map(([s, e, st, a]) => [s + end - last, e + end - last, st, a]); }
function lastIdea() { const st = storyFor(), [s, e] = st[st.length - 1]; const { b0 } = tapeRange(); return [Math.floor(b0 + s + 0.001), Math.round(b0 + e)]; }
function drawTapeLine() {
  const c = $('tapeline');
  if (!c) return;
  const { w, h: hh } = sizeCanvas(c), g = c.getContext('2d');
  g.clearRect(0, 0, w, hh);
  const span = (60 * S.tempo) / 240, cols = Math.floor(w / 3), lv = tapeLevel(span, cols);
  g.fillStyle = C['text-3'];
  g.fillRect(0, Math.round(hh / 2), w, 1);
  for (let i = 0; i < cols; i++) { const v = lv[i] * (hh / 2 - 1); if (v > 1) g.fillRect(i * 3, Math.round(hh / 2 - v), 2, Math.round(v * 2)); }
}

/* ---------------------------------------------------------------- the stage's overlays: Getting started, the tuner, the tour */
const STEPS = [{ id: 'plug', t: 'Plug in' }, { id: 'tune', t: 'Tune' }, { id: 'time', t: 'Timing' }, { id: 'sound', t: 'Your sound' }, { id: 'tour', t: 'Tour' }];
const TUNINGS = { 'E standard': ['E', 'A', 'D', 'G', 'B', 'E'], 'Drop D': ['D', 'A', 'D', 'G', 'B', 'E'], 'D standard': ['D', 'G', 'C', 'F', 'A', 'D'], 'Drop C': ['C', 'G', 'C', 'F', 'A', 'D'], 'C standard': ['C', 'F', 'Bb', 'Eb', 'G', 'C'], 'Drop B': ['B', 'F#', 'B', 'E', 'G#', 'C#'] };
function renderOver() {
  const over = $('over');
  const kids = [];
  if (S.tuner || S.ob?.step === 1) kids.push(tunerEl());
  if (S.ob && S.ob.step < 4) kids.push(obCard());
  over.replaceChildren(...kids);
  renderTour();
}
function obCard() {
  const o = S.ob, st = STEPS[o.step];
  const body = [];
  if (st.id === 'plug') {
    body.push(h('p', 'Plug your guitar into the interface. Pick the input and the channel it’s on, then strum and watch the meter.'),
      h('div.ob-row',
        h('label.ob-f', 'Input', h('select.sel', { 'aria-label': 'Audio input' }, h('option', 'Scarlett Solo USB'), h('option', 'MacBook Pro Microphone'))),
        h('label.ob-f', 'Channel', h('select.sel', { 'aria-label': 'Channel' }, h('option', 'Input 1'), h('option', { selected: true }, 'Input 2 (instrument)'), h('option', 'Both')))),
      h('div', h('div.meter', { id: 'obmeter' }, h('i.win', { style: `left:${(48 / 60) * 100}%; width:${(6 / 60) * 100}%` }), h('i.lvl', { id: 'oblvl', style: 'width:100%; transform: scaleX(0)' }), h('i.hold', { id: 'obhold' })),
        h('div.scale', [[-60, '−60'], [-24, '−24'], [-12, '−12'], [-6, '−6'], [0, '0']].map(([d, t]) => h('span', { style: `left:${((d + 60) / 60) * 100}%${d === 0 ? '; transform: translateX(-100%)' : d === -60 ? '; transform: none' : ''}` }, t)))),
      h('p.verdict', { id: 'obverdict', 'aria-live': 'polite' }, ''),
      h('div.gainknob', h('button.dial', { type: 'button', 'aria-label': 'The interface’s gain knob: press to turn it up a little', style: `--rot:${-130 + o.gain * 260}deg; --halo:${o.gainHalo || '#46413a'}`, class: 'dial', onclick: () => { o.gain = clamp(o.gain + 0.08, 0, 1); renderOver(); } }),
        h('span', 'The gain knob on the Solo sets this, not anything in here. Its ring goes green on a good strum; turn it down if the ring ever lights past that. ', h('span.t2', '(Press the knob to turn it.)'))));
  } else if (st.id === 'tune') {
    const strs = TUNINGS[S.tuning];
    body.push(h('p', 'Play each open string and let it ring, the low one first. The tuner’s big, on the stage. A string lights here once it’s in.'),
      h('div.tunings', Object.keys(TUNINGS).map((t) => h('button.b-txt', { type: 'button', 'aria-pressed': String(t === S.tuning), onclick: () => { S.tuning = t; o.strings = 0; o.tuneT0 = now(); renderOver(); renderSide(); } }, t))),
      h('div.strs', strs.map((n, i) => h('span.str' + (i < o.strings ? '.ok' : i === o.strings ? '.now' : ''), h('b', n), h('small', String(6 - i))))),
      h('p.verdict', { id: 'obtune' }, o.strings >= 6 ? 'All six are in. On to timing.' : o.strings ? `${strs[o.strings - 1]} is in. ${6 - o.strings} to go.` : `Low ${strs[0]} first.`));
  } else if (st.id === 'time') {
    body.push(h('p', 'The interface and the browser add a little delay. Strum on each of eight clicks, once, and riffs and takes land on the beat.'),
      h('div.clicks', { id: 'obclicks' }, Array.from({ length: 8 }, (_, i) => h('i' + (i < (o.clicks || 0) ? '.hit' : '')))),
      h('div.lat', h('b', o.measured ? `${o.measured} ms` : '–'), h('span.t3', o.measured ? 'measured for the Scarlett Solo USB, input 2, and remembered' : 'round trip, not measured yet')),
      h('div.ob-row', h('button.b', { type: 'button', onclick: () => calibrate() }, o.measured ? 'Measure again' : 'Strum along: eight clicks')));
  } else if (st.id === 'sound') {
    body.push(h('p', 'Four stacks to start from. Press one and play through it; the floor changes with it.'),
      h('div.stackpick', HOUSE_STACKS.slice(0, 4).map((s) => h('button.sp', { type: 'button', 'aria-pressed': String(S.loaded === s.id), onclick: () => { loadStack(s.id); renderOver(); } }, h('b', s.name), h('span', s.blurb)))),
      h('p.small', 'Or build your own in the shop, down to the mics on the cab: ', h('button.b-txt', { type: 'button', onclick: () => { S.ob = null; openShop(); } }, 'the shop'), ' ', kbd('S')));
  }
  const last = o.step === 3;
  return h('section.ob.float', { role: 'dialog', 'aria-labelledby': 'obh' },
    h('div.ob-top', h('ol.ob-steps', STEPS.map((s, i) => h('li', h('button', { type: 'button', class: o.done?.[i] ? 'done' : '', 'aria-current': i === o.step ? 'step' : 'false', onclick: () => obGo(i) }, h('i.lamp'), s.t)))),
      h('button.ob-x', { type: 'button', 'aria-label': 'Close Getting started (Esc)', onclick: () => obClose() }, '×')),
    h('h2', { id: 'obh' }, ['Plug in', 'Tune up', 'Line up your timing', 'Pick a sound'][o.step]),
    body,
    h('div.ob-foot', h('button.b-txt', { type: 'button', onclick: () => obClose(true) }, 'Don’t show again'), h('span.gap'),
      o.step ? h('button.b', { type: 'button', onclick: () => obGo(o.step - 1) }, 'Back') : null,
      last ? null : h('button.b', { type: 'button', onclick: () => obGo(o.step + 1, true) }, 'Skip'),
      h('button.b.b-go', { type: 'button', onclick: () => obNext() }, last ? 'The tour' : 'Next', kbd('Enter'))));
}
function tunerEl() {
  const strs = TUNINGS[S.tuning], i = Math.min(5, S.ob?.strings || 0), name = strs[i];
  const oct = [2, 2, 3, 3, 3, 4][i];
  return h('div.tuner', { id: 'tuner', 'aria-label': 'The tuner' },
    h('div.note', { id: 'tunernote' }, name, h('sub', String(oct))),
    h('div.dialsvg', { html: `<svg viewBox="0 0 264 70"><g fill="none" stroke="#46413a" stroke-width="2">${Array.from({ length: 21 }, (_, k) => { const a = (-60 + k * 6) * Math.PI / 180, r1 = k % 5 ? 52 : 46; return `<line x1="${132 + Math.sin(a) * r1}" y1="${66 - Math.cos(a) * r1}" x2="${132 + Math.sin(a) * 58}" y2="${66 - Math.cos(a) * 58}" ${k === 10 ? 'stroke="#f4ead6"' : ''}/>`; }).join('')}</g><line id="needle" x1="132" y1="66" x2="132" y2="10" stroke="#ffc85a" stroke-width="3"/><circle cx="132" cy="66" r="4" fill="#ffc85a"/></svg>` }),
    h('div.cents', { id: 'tunercents' }, '–'),
    S.ob ? null : h('button.b-txt', { type: 'button', onclick: () => { S.tuner = false; render(); } }, 'Close the tuner'));
}

/* the tour: five spots, one line each */
const TOUR = [
  { at: 'floor', t: 'The floor', say: 'Your stack’s pedals and the amp’s knobs. 1 to 9 stomp them. Changes stay with this song; Save to rack keeps them as a stack.' },
  { at: 'drummer', t: 'The drummer', say: 'A guide beat at the club’s tempo. Space starts it; B, or a press on the strip, swaps the beat at the next bar.' },
  { at: 'tape', t: 'The tape', say: 'Always rolling, quietly: the last minute of what you played. G opens it with the last few bars picked. Enter keeps them as a riff.' },
  { at: 'parts', t: 'The part line', say: 'A song is riffs in a row. Drag a riff here, or pick a part and press R to record it.' },
  { at: 'tb', t: 'The glass', say: 'The talkback. The engineer says what went in; when Claude’s connected it’s Claude, and / talks back.' },
];
function renderTour() {
  document.querySelectorAll('.spot, .bub').forEach((e) => e.remove());
  if (S.tour == null) return;
  const s = TOUR[S.tour], el = $(s.at);
  if (!el) return;
  const r = el.getBoundingClientRect(), pad = 6;
  const spot = h('div.spot', { style: `left:${r.left - pad}px; top:${r.top - pad}px; width:${r.width + pad * 2}px; height:${r.height + pad * 2}px` });
  const bub = h('div.bub.float', { role: 'dialog', 'aria-labelledby': 'bubh' },
    h('span.t3', `${S.tour + 1} of ${TOUR.length}`), h('h3', { id: 'bubh' }, s.t), h('p', s.say),
    h('div.ob-foot', h('button.b-txt', { type: 'button', onclick: () => tourEnd() }, 'End the tour'), h('span.gap'),
      S.tour ? h('button.b', { type: 'button', onclick: () => { S.tour--; renderTour(); } }, 'Back') : null,
      h('button.b.b-go', { type: 'button', onclick: () => tourNext() }, S.tour === TOUR.length - 1 ? 'Done' : 'Next', kbd('Enter'))));
  document.body.append(spot, bub);
  const bw = 340, bh = bub.offsetHeight;
  let top = r.bottom + 14, left = clamp(r.left + r.width / 2 - bw / 2, 12, innerWidth - bw - 12);
  if (top + bh > innerHeight - 10) top = r.top - bh - 14;
  if (top < 10) { top = clamp(r.top + 20, 10, innerHeight - bh - 10); left = r.left > innerWidth / 2 ? r.left - bw - 20 : r.right + 20; }
  bub.style.top = top + 'px'; bub.style.left = left + 'px';
}

/* ---------------------------------------------------------------- floating: the + pedal menu */
const ADD_PICKS = ['pedal.hydra', 'pedal.moray', 'pedal.coral', 'pedal.whammerhead', 'pedal.octopus', 'pedal.tapecrab', 'pedal.lobsterplate', 'pedal.krakenhall', 'pedal.jetray', 'pedal.doubledory'];
function renderFloating(anchor) {
  const fl = $('floating');
  if (S.menu !== 'add') { fl.replaceChildren(); return; }
  const said = h('p.said', { id: 'addsaid' }, 'Look at one to read what it does. A press puts it on the floor, after what’s there.');
  const grid = h('div.grid', ADD_PICKS.map((id) => {
    const def = getDevice(id);
    const face = renderFace(def, paramValues(def, {}), { on: true, size: 'compact' }).el;
    const show = () => { said.replaceChildren(h('b', def.name), h('span.t2', ': ' + (def.blurb || ''))); };
    return h('button.pick', { type: 'button', onmouseenter: show, onfocus: show, onclick: () => { addPedal(id); S.menu = null; renderFloating(); } }, zoomed(face, 0.5), def.name);
  }));
  const a = (anchor || $('addpedal'))?.getBoundingClientRect() || { left: 600, top: 400 };
  const menu = h('div.menu.float.addmenu', { role: 'dialog', 'aria-label': 'Add a pedal' }, said, grid,
    h('p', 'The whole counter is in the shop: ', h('button.b-txt', { type: 'button', onclick: () => { S.menu = null; openShop('counter'); } }, 'the shop'), ' ', kbd('S'), '. ', kbd('Esc'), ' closes this.'));
  fl.replaceChildren(menu);
  const mw = 452, mh = menu.offsetHeight;
  menu.style.left = clamp(a.left - mw + 80, 12, innerWidth - mw - 12) + 'px';
  menu.style.top = clamp(a.top - mh - 10, 60, innerHeight - mh - 10) + 'px';
}

/* ---------------------------------------------------------------- the sheets: the tape opened, a take landed */
function renderSheet() {
  const el = $('sheet');
  if (S.sheet === 'tape') return el.replaceChildren(tapeSheet());
  if (S.sheet === 'take' && S.pending) return el.replaceChildren(takeSheet());
  el.replaceChildren();
}
function tapeSheet() {
  const T = S.tape, { b0, b1 } = tapeRange();
  const len = T.b - T.a;
  const wrap = h('div.tl-wrap', { id: 'tlwrap' }, h('canvas', { id: 'tlcanvas' }),
    h('div.handle', { id: 'hA', role: 'slider', 'aria-label': 'Start', tabindex: 0 }, h('span', 'in')), h('div.handle.end', { id: 'hB', role: 'slider', 'aria-label': 'End', tabindex: 0 }, h('span', 'out')));
  const sheet = h('section.sheet.float', { role: 'dialog', 'aria-labelledby': 'tapeh' },
    h('div.sheet-h', h('h2', { id: 'tapeh' }, 'That was the one'), h('span.meta', { id: 'tapemeta' }, `bars ${fmtBars(T.a)} to ${fmtBars(T.b)} · ${plural(len, 'bar')} · ${secsOf(len, S.tempo).toFixed(1)} s`),
      h('span.gap'), h('span.t3', `the last minute, on the drummer’s bars, ${Math.floor(b0) + 1} to ${Math.floor(b1)}`)),
    wrap,
    h('div.sheet-foot',
      h('button.b.b-go', { type: 'button', onclick: () => keepRiff() }, 'Keep it as a riff', kbd('Enter')),
      h('button.b', { type: 'button', onclick: () => { S.tape.preview = S.tape.preview ? null : now(); renderSheet(); } }, S.tape.preview ? 'Stop' : 'Hear it, round and round', kbd('Space')),
      h('button.tog', { type: 'button', 'aria-pressed': String(T.snap), onclick: () => { T.snap = !T.snap; if (T.snap) { T.a = Math.round(T.a); T.b = Math.max(T.a + 1, Math.round(T.b)); } renderSheet(); } }, h('i.lamp'), 'Snap to bars', kbd('N')),
      h('span.note', kbd('←'), kbd('→'), ' move it a bar ', kbd('⇧←'), kbd('⇧→'), ' longer or shorter. Drag the ends.'),
      h('span.gap'), h('button.b', { type: 'button', onclick: () => closeSheet() }, 'Close', kbd('Esc'))));
  requestAnimationFrame(() => { drawTape(); bindHandles('tape'); });
  return sheet;
}
function takeSheet() {
  const P = S.pending, part = S.parts.find((p) => p.id === P.partId), i = S.parts.indexOf(part), next = S.parts[i + 1];
  const ring = P.out - part.bars;
  const wrap = h('div.tl-wrap', { id: 'tlwrap', style: P.side === 'R' ? 'height: 208px' : '' }, h('canvas', { id: 'tlcanvas' }),
    h('div.handle', { id: 'hA', role: 'slider', 'aria-label': 'In', tabindex: 0 }, h('span', 'in')), h('div.handle.end', { id: 'hB', role: 'slider', 'aria-label': 'Out', tabindex: 0 }, h('span', 'out')));
  const head = P.side === 'R'
    ? `The other side is in: ${P.pair.avg} ms from your left on average, ${P.pair.max} at most.`
    : P.stopAt < part.bars ? `You stopped in bar ${Math.floor(P.stopAt) + 1} of ${part.bars}; the rest of the part keeps what it had.`
    : `${plural(part.bars, 'bar')}${ring > 0.05 ? `, and ${plural(ring, 'bar')} rang past ${next ? 'into ' + next.name : 'the end'}` : ''}. You stopped ${fmtBars(P.stopAt - part.bars)} bar${Math.abs(P.stopAt - part.bars - 1) < 0.05 ? '' : 's'} past the end; it’s all on the take.`;
  const kept = part.takes[P.side];
  return h('section.sheet.float', { role: 'dialog', 'aria-labelledby': 'takeh' },
    h('div.sheet-h', h('h2', { id: 'takeh' }, `${part.name}${P.side === 'R' ? ', the other side' : ''}: take ${P.take.n}`), h('span.meta', head), h('span.gap'),
      P.hear ? h('span.t3', 'playing it back once · any key stops it') : null),
    wrap,
    h('div.sheet-foot',
      h('button.b.b-go', { type: 'button', onclick: () => keepTake() }, 'Keep', kbd('Enter')),
      h('button.b', { type: 'button', onclick: () => tossTake() }, 'Toss', kbd('⌫')),
      h('button.b', { type: 'button', onclick: () => again() }, 'Again', kbd('R')),
      h('span.note', 'The out handle sits where the last note died. Drag it back to cut the tail.'),
      h('span.gap'),
      kept.length ? h('span.takes-list', 'kept: ', kept.map((t, k) => h(k === part.pick[P.side] ? 'b' : 'span', `take ${t.n}`))) : h('span.takes-list', 'no kept takes yet')));
}
// the bar grid: numbered bars, the beat ticks, the waveform; for a take, the parts along the top and the overlap
function drawTape() {
  const c = $('tlcanvas');
  if (!c) return;
  const { w, h: hh, d } = sizeCanvas(c), g = c.getContext('2d');
  g.clearRect(0, 0, w, hh);
  const T = S.tape, { b0, b1 } = tapeRange(), X = (bar) => ((bar - b0) / (b1 - b0)) * w;
  const top = 22 * d, mid = top + (hh - top) / 2, amp = (hh - top) / 2 - 8 * d;
  // the selection: grease pencil
  g.fillStyle = C['accent-2']; g.globalAlpha = 0.14; g.fillRect(X(T.a), top, X(T.b) - X(T.a), hh - top); g.globalAlpha = 1;
  // bars and beats
  g.font = `${11 * d}px ${css('--font-mono')}`; g.textBaseline = 'top';
  for (let b = Math.ceil(b0 * 4) / 4; b <= b1; b += 0.25) {
    const x = Math.round(X(b)), whole = Math.abs(b - Math.round(b)) < 0.001;
    g.fillStyle = whole ? C['line-2'] : C.line; g.fillRect(x, whole ? top - 4 * d : top, 1, hh - top);
    if (whole && Math.round(b) % 2 === 0 && x < w - 44 * d) { g.fillStyle = C['text-3']; g.fillText(String(Math.round(b)), x + 3 * d, 4 * d); }
  }
  // what's on it
  const span = b1 - b0, cols = Math.floor(w / (3 * d)), lv = tapeLevel(span, cols);
  for (let i = 0; i < cols; i++) {
    const bar = b0 + ((i + 0.5) / cols) * span, inSel = bar >= T.a && bar <= T.b;
    g.fillStyle = inSel ? C.text : C['text-3'];
    const v = Math.max(1, lv[i] * amp);
    g.fillRect(i * 3 * d, Math.round(mid - v), 2 * d, Math.round(v * 2));
  }
  // now, and the preview's playhead
  g.fillStyle = C['text-2']; g.fillRect(w - 2 * d, top, 2 * d, hh - top);
  g.fillStyle = C['text-3']; g.textAlign = 'right'; g.fillText('now', w - 6 * d, 4 * d); g.textAlign = 'left';
  if (T.preview) {
    const len = T.b - T.a, t = ((now() - T.preview) * S.tempo) / 240000;
    const x = X(T.a + (t % len));
    g.fillStyle = C.accent; g.fillRect(Math.round(x), top - 4 * d, 2 * d, hh - top + 4 * d);
  }
  placeHandles(X(T.a) / d, X(T.b) / d, `${fmtBars(T.a)}`, `${fmtBars(T.b)}`);
}
function placeHandles(xa, xb, la, lb) {
  const A = $('hA'), B = $('hB');
  if (!A || !B) return;
  A.style.left = xa + 'px'; B.style.left = xb + 'px';
  A.querySelector('span').textContent = 'in ' + la; B.querySelector('span').textContent = 'out ' + lb;
}
function takeLayout() {
  const P = S.pending, part = S.parts.find((p) => p.id === P.partId), i = S.parts.indexOf(part);
  const starts = []; let acc = 0; for (const p of S.parts) { starts.push(acc); acc += p.bars; }
  const s0 = starts[i], b0 = s0 - 1, b1 = s0 + Math.max(part.bars + 3, P.stopAt + 1);
  return { P, part, i, starts, s0, b0, b1 };
}
function drawTake() {
  const c = $('tlcanvas');
  if (!c || !S.pending) return;
  const { w, h: hh, d } = sizeCanvas(c), g = c.getContext('2d');
  const { P, part, starts, s0, b0, b1 } = takeLayout();
  const X = (bar) => ((bar - b0) / (b1 - b0)) * w;
  g.clearRect(0, 0, w, hh);
  const top = 30 * d;
  // the parts along the top, the one you played highlighted
  g.font = `600 ${12 * d}px ${css('--font-ui')}`; g.textBaseline = 'middle';
  S.parts.forEach((p, k) => {
    const x0 = X(starts[k]), x1 = X(starts[k] + p.bars);
    if (x1 < 0 || x0 > w) return;
    g.fillStyle = p.id === part.id ? C.text : C['bg-3']; g.fillRect(x0 + 1, 2 * d, x1 - x0 - 2, 22 * d);
    g.fillStyle = p.id === part.id ? C.bg : C['text-2']; g.fillText(p.name, Math.max(x0, 0) + 8 * d, 13 * d);
  });
  // bars and beats
  g.font = `${11 * d}px ${css('--font-mono')}`; g.textBaseline = 'top';
  for (let b = Math.ceil(b0 * 4) / 4; b <= b1; b += 0.25) {
    const x = Math.round(X(b)), whole = Math.abs(b - Math.round(b)) < 0.001;
    g.fillStyle = whole ? C['line-2'] : C.line; g.fillRect(x, top, 1, hh - top);
    if (whole) { g.fillStyle = C['text-3']; g.fillText(String(Math.round(b - s0) + 1), x + 3 * d, top + 3 * d); }
  }
  // the part's end, and the overlap past it: the tail rings under the next part
  const xe = X(s0 + part.bars);
  g.fillStyle = C.text; g.fillRect(Math.round(xe), top, 2 * d, hh - top);
  const xo = X(s0 + P.out);
  if (xo > xe + 2) {
    g.save(); g.beginPath(); g.rect(xe, top, xo - xe, hh - top); g.clip();
    g.strokeStyle = C['line-2']; g.lineWidth = d;
    for (let x = xe - hh; x < xo + hh; x += 9 * d) { g.beginPath(); g.moveTo(x, hh); g.lineTo(x + (hh - top), top); g.stroke(); }
    g.restore();
    g.fillStyle = C['text-2']; g.font = `${12 * d}px ${css('--font-ui')}`; g.textBaseline = 'bottom';
    const nx = S.parts[S.parts.indexOf(part) + 1];
    g.fillText(`rings under ${nx ? nx.name : 'the end'}`, xe + 6 * d, hh - 6 * d);
  }
  // the waveforms: your left take (dim) when this is the other side, then this take
  const lanes = P.side === 'R' ? [['L', top + 18 * d, (hh - top - 26 * d) / 2], ['R', top + 18 * d + (hh - top - 26 * d) / 2, (hh - top - 26 * d) / 2]] : [['L', top + 18 * d, hh - top - 26 * d]];
  for (const [side, y0, lh] of lanes) {
    const mine = side === P.side, mid = y0 + lh / 2, amp = lh / 2 - 3 * d;
    const len = mine ? P.stopAt : part.bars + 0.6;
    const cols = Math.floor((X(s0 + len) - X(s0)) / (3 * d));
    const shape = riffShape(mine ? P.take.seed : 4242, Math.max(1, Math.ceil(len)), Math.max(1, cols), 'chug');
    for (let k = 0; k < cols; k++) {
      const bar = (k / cols) * len;
      // played to just past the end, then the last chord rings and dies
      let v = bar <= part.bars + 0.25 ? shape[k] : bar <= P.ringEnd ? 0.85 * Math.exp(-(bar - part.bars - 0.25) * 2.4) : 0.015;
      const inside = bar >= P.in && bar <= P.out;
      g.fillStyle = !mine ? C['text-3'] : inside ? C.text : C['line-2'];
      v = Math.max(1, v * amp);
      g.fillRect(X(s0) + k * 3 * d, Math.round(mid - v), 2 * d, Math.round(v * 2));
    }
    g.fillStyle = C['text-3']; g.font = `${11 * d}px ${css('--font-mono')}`; g.textBaseline = 'top';
    g.fillText(side === 'L' ? (P.side === 'R' ? 'L  your kept take' : '') : 'R  this take', 6 * d, y0);
  }
  // hearing it back once
  if (P.hear) {
    const t = ((now() - P.hear) * S.tempo) / 240000 + P.in;
    if (t > P.out) { P.hear = null; renderSheet(); }
    else { g.fillStyle = C.accent; g.fillRect(Math.round(X(s0 + t)), top - 4 * d, 2 * d, hh - top + 4 * d); }
  }
  placeHandles(X(s0 + P.in) / d, xo / d, `bar ${fmtBars(P.in + 1)}`, `${fmtBars(P.out - part.bars) > 0 ? '+' + fmtBars(P.out - part.bars) + ' past' : 'the end'}`);
}
// dragging the handles: the tape's in and out (snapped to bars unless snap is off), or a take's (in: free; out: back
// over the tail, never past where you stopped)
function bindHandles(kind) {
  const wrap = $('tlwrap');
  if (!wrap) return;
  for (const id of ['hA', 'hB']) {
    const el = $(id);
    el.onpointerdown = (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = wrap.getBoundingClientRect(), f = clamp((ev.clientX - r.left) / r.width, 0, 1);
        if (kind === 'tape') {
          const { b0, b1 } = tapeRange(); let bar = b0 + f * (b1 - b0);
          if (S.tape.snap) bar = Math.round(bar);
          if (id === 'hA') S.tape.a = Math.min(bar, S.tape.b - (S.tape.snap ? 1 : 0.25)); else S.tape.b = Math.max(bar, S.tape.a + (S.tape.snap ? 1 : 0.25));
          const m = $('tapemeta'), len = S.tape.b - S.tape.a;
          if (m) m.textContent = `bars ${fmtBars(S.tape.a)} to ${fmtBars(S.tape.b)} · ${plural(len, 'bar')} · ${secsOf(len, S.tempo).toFixed(1)} s`;
          drawTape();
        } else {
          const { s0, b0, b1, part } = takeLayout(), P = S.pending;
          let bar = b0 + f * (b1 - b0) - s0;
          bar = Math.round(bar * 16) / 16;
          if (id === 'hA') P.in = clamp(bar, -0.5, P.out - 1); else P.out = clamp(bar, Math.max(P.in + 1, part.bars - 0.5), P.ringEnd);
          drawTake();
        }
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    };
  }
}

/* ---------------------------------------------------------------- recording */
function renderRec() {
  const el = $('rec'), R = S.rec;
  if (!R) { el.replaceChildren(); return; }
  const part = S.parts.find((p) => p.id === R.partId);
  const kids = [];
  if (R.phase === 'count') {
    const prev = S.parts[S.parts.indexOf(part) - 1];
    kids.push(h('div.rec-top', h('i.lamp.on'), h('span', R.side === 'R' ? 'Counting in: the other side. Your left take is in your left ear.' : prev ? `Counting in over the end of ${prev.name}` : 'Counting in')),
      h('p.rec-part', part.name), h('div.rec-count', { id: 'reccount' }, '1'),
      h('p.rec-note', 'The metronome counts one bar. The parts around it play.'));
  } else {
    kids.push(h('div.rec-top', h('i.lamp.red'), h('span', `Recording ${R.side === 'R' ? 'the other side, ' : ''}take ${R.n}`)),
      h('p.rec-part', part.name + (R.side === 'R' ? ', the other side' : '')),
      h('div.rec-bar', { id: 'recbar' }, ''),
      h('div.rec-strip', h('canvas', { id: 'recstrip' })));
  }
  kids.push(h('div.rec-keys',
    h('div.rk' + (R.phase === 'count' ? '.dim' : ''), kbd('Space'), 'Stop'),
    h('div.rk', kbd('R'), 'Start again'),
    h('div.rk', kbd('Esc'), 'Toss it')));
  kids.push(h('p.rec-note', 'It doesn’t stop itself at the part’s end. Play past it if you like: you trim afterwards.'));
  el.replaceChildren(h('div.rec', { role: 'dialog', 'aria-label': 'Recording' }, kids));
}
function drawRec(t) {
  const R = S.rec;
  if (!R || R.phase !== 'rec') return;
  const part = S.parts.find((p) => p.id === R.partId);
  const el = (t - R.t0) * S.tempo / 240000 + (R.skip || 0);
  const bar = Math.floor(el) + 1;
  const b = $('recbar');
  if (b) {
    const past = bar - part.bars;
    b.replaceChildren(...(past > 0 ? [h('span', `Bar ${bar} `), h('span.past', `· ${past} past the end, still recording`)] : [h('span', `Bar ${bar} `), h('span.of', `of ${part.bars}`)]));
  }
  const c = $('recstrip');
  if (!c) return;
  const { w, h: hh, d } = sizeCanvas(c), g = c.getContext('2d');
  const span = Math.max(part.bars + 2, Math.ceil(el) + 1), X = (b2) => (b2 / span) * w;
  g.clearRect(0, 0, w, hh);
  for (let k = 0; k <= span; k++) { g.fillStyle = k === part.bars ? C.text : C['line-2']; g.fillRect(Math.round(X(k)), 0, k === part.bars ? 2 * d : 1, hh); }
  g.fillStyle = C['text-3']; g.font = `${11 * d}px ${css('--font-mono')}`; g.textBaseline = 'top'; g.fillText('the part’s end', X(part.bars) + 5 * d, 2 * d);
  const cols = Math.floor(X(el) / (3 * d)), shape = riffShape(R.seed, Math.max(1, Math.ceil(span)), Math.floor(w / (3 * d)), 'chug');
  for (let k = 0; k < cols; k++) {
    const bb = (k * 3 * d / w) * span;
    let v = bb <= part.bars + 0.25 ? shape[k] : 0.85 * Math.exp(-(bb - part.bars - 0.25) * 2.4) + 0.015;
    v = Math.max(1, v * (hh / 2 - 4 * d));
    g.fillStyle = C.text; g.fillRect(k * 3 * d, Math.round(hh / 2 - v), 2 * d, Math.round(v * 2));
  }
  g.fillStyle = C.rec; g.fillRect(Math.round(X(el)), 0, 2 * d, hh);
}

/* ---------------------------------------------------------------- the riff library */
function libRows() {
  const L = S.lib, q = L.q.trim().toLowerCase();
  const all = [...S.riffs.map((r) => ({ ...r, session: true })), ...LIB];
  return all.filter((r) => {
    if (L.song !== undefined && (L.song === '' ? r.song : r.song !== L.song)) return false;
    if (L.tuning && r.tuning !== L.tuning) return false;
    if (L.tempo && !(L.tempo === 'slow' ? r.tempo < 100 : L.tempo === 'mid' ? r.tempo >= 100 && r.tempo < 140 : r.tempo >= 140)) return false;
    if (L.when) { const days = (Date.now() - r.at) / 86400000, lim = { today: 1.5, week: 9, month: 33 }[L.when]; const age = (new Date(2026, 9, 26, 23).getTime() - r.at) / 86400000; if (age > lim) return false; void days; }
    if (L.starred && !r.starred) return false;
    if (q && !`${r.name} ${r.song || 'no song yet'} ${r.tuning} ${r.key} ${r.stack} ${r.tempo}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderLib() {
  const el = $('lib');
  el.hidden = S.screen !== 'lib';
  if (el.hidden) { el.replaceChildren(); return; }
  const L = S.lib, rows = libRows();
  if (!rows.some((r) => r.id === L.sel)) L.sel = rows[0]?.id || null;
  const songs = songsOf([...S.riffs, ...LIB]);
  const fl = (label, key, opts) => h('span.f', h('span', label), opts.map(([v, t]) => h('button.b-txt', { type: 'button', 'aria-pressed': String(L[key] === v), onclick: () => { L[key] = L[key] === v ? null : v; renderLib(); } }, t)));
  const search = h('label.search', h('span.t3', '⌕'), h('input', { id: 'libq', type: 'search', placeholder: 'Search names, songs, stacks', 'aria-label': 'Search riffs', value: L.q, autocomplete: 'off' }), kbd('/'));
  search.querySelector('input').addEventListener('input', (e) => { L.q = e.target.value; renderLibList(); });
  search.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.blur(); } if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.target.blur(); } });
  const head = h('div.lib-head', h('h2', 'Riffs'), h('span.count', { id: 'libcount' }), h('span.gap'), search, h('button.b', { type: 'button', onclick: () => closeLib() }, 'Back to the stage', kbd('Esc')),
    h('div.filters',
      fl('Tuning', 'tuning', [['Drop C', 'Drop C'], ['Drop D', 'Drop D'], ['Drop B', 'Drop B'], ['D standard', 'D standard'], ['E standard', 'E standard']]),
      fl('Tempo', 'tempo', [['slow', 'under 100'], ['mid', '100 to 139'], ['fast', '140 and up']]),
      fl('When', 'when', [['today', 'today'], ['week', 'this week'], ['month', 'this month']]),
      h('span.f', h('button.b-txt', { type: 'button', 'aria-pressed': String(L.starred), onclick: () => { L.starred = !L.starred; renderLib(); } }, '★ starred'))));
  const songList = h('nav.lib-songs', h('h3', 'Songs'),
    h('button.song', { type: 'button', 'aria-pressed': String(L.song === undefined), onclick: () => { L.song = undefined; renderLib(); } }, h('span', 'Every song'), h('span.n', String(LIB.length + S.riffs.length))),
    songs.map(([s, n]) => h('button.song', { type: 'button', 'aria-pressed': String(L.song === s), onclick: () => { L.song = s; renderLib(); } }, h('span', s || 'No song yet'), h('span.n', String(n)))));
  el.replaceChildren(head, songList, h('div.lib-list', { id: 'liblist' }), h('aside.lib-detail', { id: 'libdetail' }));
  renderLibList();
}
function renderLibList() {
  const L = S.lib, rows = libRows(), list = $('liblist');
  if (!list) return;
  if (!rows.some((r) => r.id === L.sel)) L.sel = rows[0]?.id || null;
  $('libcount').textContent = `${rows.length} of ${LIB.length + S.riffs.length} riffs, from ${songsOf([...S.riffs, ...LIB]).filter(([s]) => s).length} songs`;
  const tb = h('tbody');
  let grp = null;
  for (const r of rows) {
    const g = r.session ? 'This session' : when(r.at).startsWith('today') ? 'Earlier today' : when(r.at).startsWith('yesterday') ? 'Yesterday' : (Date.now(), r.at > new Date(2026, 9, 19).getTime() ? 'This week' : r.at > new Date(2026, 8, 26).getTime() ? 'This month' : 'Before that');
    if (g !== grp) { grp = g; tb.append(h('tr.grp', h('td', { colspan: 10 }, g))); }
    tb.append(h('tr' + (r.id === L.sel ? '.sel' : ''), { dataset: { id: r.id }, onclick: () => { L.sel = r.id; renderLibList(); }, ondblclick: () => libDrop(r.id) },
      h('td.st', r.starred ? '★' : ''),
      h('td.nm', r.name, r.by === 'claude' ? h('span', { style: 'font-weight:400' }, ' ', by('claude')) : null),
      h('td', r.song ? r.song : h('span.t3', 'no song yet')),
      h('td.wv', h('canvas.wave', { dataset: { seed: r.seed, bars: r.bars, style: r.style, color: r.id === L.sel ? C.bg : C['text-3'] } })),
      h('td.num', `${r.bars} bar${r.bars > 1 ? 's' : ''}`), h('td.num', `${r.tempo}`), h('td', r.tuning), h('td', h('span' + (r.keySure ? '' : '.t3'), r.key + (r.keySure ? '' : '?'))),
      h('td.t2.stk', r.stack)));
  }
  const table = h('table.rows', h('thead', h('tr', ['', 'Name', 'Song', '', 'Length', 'BPM', 'Tuning', 'Key', 'Stack'].map((t, i) => h('th' + (i === 3 ? '.wv' : ''), t)))), tb);
  list.replaceChildren(rows.length ? table : h('p.empty', { style: 'padding: 20px 8px' }, 'No riff matches. Clear a filter, or search for something shorter.'));
  for (const c of list.querySelectorAll('canvas.wave')) drawMini(c);
  list.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  renderLibDetail();
}
function renderLibDetail() {
  const L = S.lib, d = $('libdetail'), r = [...S.riffs, ...LIB].find((x) => x.id === L.sel);
  if (!d) return;
  if (!r) { d.replaceChildren(); return; }
  const name = h('h2.dn', { id: 'libname', contenteditable: L.renaming ? 'true' : 'false', spellcheck: 'false' }, r.name);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (e.key === 'Enter') { r.name = name.textContent.trim() || r.name; say(`Renamed: ${r.name}.`); } L.renaming = false; renderLibList(); } });
  const cv = h('canvas.wave', { dataset: { seed: r.seed, bars: r.bars, style: r.style, color: C['text-2'] } });
  d.replaceChildren(h('h3', r.song ? `From ${r.song}` : 'No song yet'), name, cv,
    h('dl.facts',
      h('dt', 'Length'), h('dd', `${r.bars} bar${r.bars > 1 ? 's' : ''}, ${r.secs.toFixed(1)} s`),
      h('dt', 'Tempo'), h('dd', `${r.tempo} BPM`), h('dt', 'Tuning'), h('dd', r.tuning),
      h('dt', 'Key'), h('dd', r.key, h('span.t3', r.keySure ? ' (read)' : ' (read, not sure)')),
      h('dt', 'Stack'), h('dd', r.stack), h('dt', 'When'), h('dd', when(r.at)),
      h('dt', 'Grabbed by'), h('dd', by(r.by || 'you'))),
    h('div.acts',
      h('button.b.b-go', { type: 'button', onclick: () => libDrop(r.id) }, 'Put it on the part line', kbd('Enter')),
      h('button.b', { type: 'button', onclick: () => { L.preview = L.preview === r.id ? null : r.id; say(L.preview ? `Playing ${r.name}, round and round.` : 'Stopped.'); renderLibDetail(); } }, L.preview === r.id ? 'Stop' : 'Hear it', kbd('Space')),
      h('button.b', { type: 'button', onclick: () => { r.starred = !r.starred; renderLibList(); } }, r.starred ? 'Unstar' : 'Star', kbd('*')),
      h('button.b', { type: 'button', onclick: () => { L.renaming = true; renderLibDetail(); requestAnimationFrame(() => { const n = $('libname'); n.focus(); getSelection().selectAllChildren(n); }); } }, 'Rename', kbd('F2'))),
    h('p.t3', { style: 'margin:0; font-size: 13px' }, kbd('↑'), kbd('↓'), ' move through the list. The key is read from the riff, so it can be wrong.'));
  drawMini(cv);
  if (L.renaming) requestAnimationFrame(() => $('libname')?.focus());
}

/* ---------------------------------------------------------------- the shop */
const SHOP = { canvas: null, g: null, spots: [] };
function renderShop() {
  const el = $('shop');
  el.hidden = S.screen !== 'shop';
  if (el.hidden) { el.replaceChildren(); return; }
  const sh = S.shop;
  const canvas = h('canvas', { width: 256, height: 144, 'aria-hidden': 'true', id: 'shopcanvas' });
  const spots = h('div.spots', { id: 'spots' });
  const scene = h('section.shop-scene', { 'aria-label': sh.room === 'mics' ? 'The cab room' : 'The shop' }, canvas, sh.room === 'mics' ? null : spots);
  el.replaceChildren(scene, h('section.look', { id: 'look' }), h('section.chain', { id: 'chain' }));
  SHOP.canvas = canvas; SHOP.g = canvas.getContext('2d');
  if (sh.room === 'mics') bindMic(canvas);
  else {
    SHOP.spots = hotspots(S.rack);
    const k = canvas.getBoundingClientRect().width / 256 || 3;
    for (const s of SHOP.spots) {
      const key = `${s.kind}:${s.id}`, inChain = s.kind === 'amp' ? S.stack.amp === s.id : s.kind === 'pedal' ? S.stack.chain.some((c) => c.device === s.id) : s.kind === 'stack' ? S.loaded === s.id : false;
      const b = h('button.hs' + (sh.look === key ? '.look' : '') + (inChain ? '.in' : ''), { type: 'button', dataset: { key }, 'aria-label': spotName(s), style: `left:${s.x * k}px; top:${s.y * k}px; width:${s.w * k}px; height:${s.h * k}px` });
      b.addEventListener('mouseenter', () => look(key));
      b.addEventListener('focus', () => look(key));
      b.addEventListener('click', () => { look(key); take(key); });
      spots.append(b);
    }
  }
  renderLook(); renderChain(); drawShopFrame();
}
function spotName(s) {
  if (s.kind === 'amp') return s.id === 'core.stack' ? 'Half Stack' : getDevice(s.id)?.name || s.id;
  if (s.kind === 'pedal') return getDevice(s.id)?.name || s.id;
  if (s.kind === 'stack') return S.rack.find((x) => x.id === s.id)?.name || s.id;
  return 'The cab room';
}
function look(key) {
  if (S.shop.look === key) return;
  S.shop.look = key;
  for (const b of document.querySelectorAll('.hs')) b.classList.toggle('look', b.dataset.key === key);
  renderLook();
}
// what you're looking at, and under it the talkback's last line (the shop has no stage, so no glass of its own)
function renderLook() {
  const el = $('look');
  if (!el) return;
  lookInner(el);
  const amp = el.querySelector('.look-face .zoom');
  if (amp?.firstElementChild?.classList.contains('ewf-ampface')) amp.style.zoom = String(Math.min(0.95, (el.clientWidth - 4) / 470));
  el.append(h('div.shop-tb', { id: 'shoptb' }));
  renderTalk();
}
function lookInner(el) {
  const sh = S.shop;
  if (sh.room === 'mics') return renderMicLook(el);
  const key = sh.look;
  if (!key) {
    el.replaceChildren(h('p.look-kind', 'The shop'), h('h2', 'Look around'),
      h('p.blurb', 'Amps on the wall, pedals in the counter, saved stacks in the rack, and the cab room through the door. Point at anything to see it; press it to play through it.'),
      h('ul.look-list', h('li', kbd('←'), kbd('→'), kbd('↑'), kbd('↓'), h('span', 'look along the wall, the counter and the rack')), h('li', kbd('Enter'), h('span', 'put what you’re looking at in your stack')), h('li', kbd('Space'), h('span', 'the drummer, so you can play while you shop')), h('li', kbd('Esc'), h('span', 'back to the stage, with the stack on the floor'))));
    return;
  }
  const [kind, id] = key.split(':');
  if (kind === 'amp') {
    const half = id === 'core.stack', def = half ? STACK_FEW : getDevice(id), cur = S.stack.amp === id;
    const vals = half ? presetParams(STACK, 'Modern') : paramValues(def, {});
    const face = renderFace(def, vals, { on: true, size: 'compact' }).el;
    el.replaceChildren(h('p.look-kind', half ? 'An amp: the club’s own, Half Stack' : 'An amp on the wall'), h('h2', half ? 'Half Stack' : def.name),
      h('p.blurb', half ? 'A modern high-gain head on a 4x12: five settings, from Modern to Doom.' : def.blurb), h('p.nod', half ? 'the room’s own amp; it renders exactly as heard' : def.nod || ''),
      h('div.look-face', zoomed(face, 0.95)),
      h('div.acts', cur ? h('span.t2', 'It’s the amp in your stack now. Its knobs are on the floor, and here.') : h('button.b.b-go', { type: 'button', onclick: () => take(key) }, 'Play through it', kbd('Enter'))));
  } else if (kind === 'pedal') {
    const def = getDevice(id), on = S.stack.chain.find((c) => c.device === id);
    const face = renderFace(def, paramValues(def, {}), { on: true, size: 'compact' }).el;
    el.replaceChildren(h('p.look-kind', `A pedal in the counter: ${def.cat}`), h('h2', def.name), h('p.blurb', def.blurb), h('p.nod', def.nod || ''),
      h('div.look-face', zoomed(face, 1)),
      h('div.acts', on ? h('button.b', { type: 'button', onclick: () => take(key) }, 'Take it off the floor', kbd('Enter')) : h('button.b.b-go', { type: 'button', onclick: () => take(key) }, BEFORE_AMP.test(def.cat) ? 'Put it before the amp' : 'Put it after the amp', kbd('Enter'))));
  } else if (kind === 'stack') {
    const st = S.rack.find((s) => s.id === id);
    el.replaceChildren(h('p.look-kind', st.by ? h('span', 'A stack you saved, by ', by('you')) : 'A stack in the rack: one of the house’s'), h('h2', st.name), h('p.blurb', st.blurb),
      h('ul.look-list', st.chain.map((c) => h('li', h('span.mono', c.amp ? 'amp' : getDevice(c.device)?.cat || ''), h('span', c.amp ? (st.amp === 'core.stack' ? `Half Stack, ${st.setting}` : getDevice(st.amp)?.name) : getDevice(c.device)?.name || c.device), c.on === false ? h('span.t3', 'off') : null))),
      h('div.acts', S.loaded === id && !S.stack.changed ? h('span.t2', 'Loaded: it’s on the floor now.') : h('button.b.b-go', { type: 'button', onclick: () => take(key) }, 'Load it', kbd('Enter'))));
  } else {
    el.replaceChildren(h('p.look-kind', 'A door'), h('h2', 'The cab room'), h('p.blurb', 'Where the mics are. Pick the mic, put it on the cone, set how far back it stands. For people who live in here.'),
      h('p.nod', `Now: ${micLine()}`),
      h('div.acts', h('button.b.b-go', { type: 'button', onclick: () => take(key) }, 'Go in', kbd('Enter'))));
  }
}
function renderChain() {
  const el = $('chain');
  if (!el) return;
  const st = S.stack, row = h('div.chain-row', { id: 'chainrow' });
  st.chain.forEach((c, i) => {
    if (i) row.append(h('span.arrow', '→'));
    if (c.amp) {
      const def = ampDef(st), vals = st.amp === 'core.stack' ? st.ampParams : paramValues(def, st.ampParams);
      row.append(h('div.slot.amp', { dataset: { i } }, zoomed(faceOf('chain-amp-' + st.amp, def, vals, true, { onParam: (k, v, { commit }) => { st.ampParams[k] = v; if (commit) changed(`${k} ${Number(v).toFixed(1)} on this song’s copy.`); } }), 0.55), h('span.stomp', ampName(st))));
      row.append(h('span.arrow', '→'));
      row.append(h('button.cabchip', { type: 'button', onclick: () => { S.shop.room = 'mics'; renderShop(); } }, h('b', cabName(st)), h('span', `${MIC_NAMES[st.cab.mic.id]}, ${micWhere(st.cab.mic).words}, ${inches(st.cab.mic.dist)}`), h('span.t2', 'Mics on the cab →')));
      return;
    }
    const def = getDevice(c.device);
    const slot = h('div.slot' + (c.on ? '' : '.off'), { dataset: { i, uid: c.uid } }, zoomed(faceOf('chain-' + c.uid, def, paramValues(def, c.params), c.on, { onToggle: (on) => { c.on = on; changed(`${def.name} ${on ? 'on' : 'off'}.`); } }), 0.7),
      h('span.stomp', def.name, h('button.b-txt', { type: 'button', 'aria-label': `Take ${def.name} off`, onclick: () => removePedal(c.uid), style: 'margin-left:6px; text-decoration: none' }, '×')));
    chainDrag(slot, c.uid);
    row.append(slot);
  });
  const foot = h('div.chain-foot',
    h('span.sec-h', h('span.name', 'Your stack'), h('span', st.changed ? 'changed: this song’s copy' : st.name)),
    h('span.t3', { style: 'font-size:13px' }, 'Drag a pedal to move it in the chain.'), h('span.gap'),
    S.shop.naming ? h('form.namebox', { onsubmit: (e) => { e.preventDefault(); doSave(e.target.querySelector('input').value); } },
      h('input', { id: 'rackname', type: 'text', value: S.shop.name, 'aria-label': 'The stack’s name', autocomplete: 'off' }), h('button.b.b-go', { type: 'submit' }, 'Save', kbd('Enter')), h('button.b', { type: 'button', onclick: () => { S.shop.naming = false; renderChain(); } }, 'Cancel'))
      : h('button.b.b-go', { type: 'button', onclick: () => saveToRack() }, 'Save to rack', kbd('⌘S')),
    h('button.b', { type: 'button', onclick: () => closeShop() }, 'Back to the stage', kbd('Esc')));
  el.replaceChildren(foot, row);
  if (S.shop.naming) requestAnimationFrame(() => { const f = $('rackname'); if (f && document.activeElement !== f) { f.focus(); f.select(); } });
}
const MIC_NAMES = { dyn: 'Dynamic', ribbon: 'Ribbon', cond: 'Condenser', crystal: 'Crystal' };
const MIC_BLURBS = { dyn: 'The dynamic mic on every amp on earth: mids that cut', ribbon: 'Dark, smooth, big low end; hears the room behind it too', cond: 'A large-diaphragm condenser: open and airy; hears every corner', crystal: 'A cheap old crystal mic: thin, honky, lo-fi' };
function renderMicLook(el) {
  const m = S.stack.cab.mic, w = micWhere(m), lookMic = S.shop.lookMic || m.id;
  const range = h('input', { type: 'range', min: 0, max: 100, value: String(Math.round((Math.log(m.dist / 0.5) / Math.log(48)) * 100)), 'aria-label': 'Distance from the grille' });
  range.addEventListener('input', () => { m.dist = Math.round(0.5 * Math.pow(48, range.value / 100) * 10) / 10; $('micdist').textContent = inches(m.dist); drawShopFrame(); $('micnow').textContent = micLine(); });
  range.addEventListener('change', () => changed(`${MIC_NAMES[m.id]} ${inches(m.dist)} back from the grille.`));
  el.replaceChildren(h('p.look-kind', 'The cab room, through the door'), h('h2', 'Mics on the cab'),
    h('p.blurb', { id: 'micnow' }, micLine()),
    h('p.nod', `${MIC_NAMES[lookMic]}: ${MIC_BLURBS[lookMic]}. ${lookMic !== m.id ? 'Press it to put it up.' : 'It’s the one up.'}`),
    h('div.micrange', h('span', 'Distance'), range, h('b.mono', { id: 'micdist' }, inches(m.dist))),
    h('p.hint', `Drag the mic over a cone: at the cap it’s bright, out toward the edge it’s darker. It’s on cone ${w.cone + 1} of 4.`),
    h('div.acts', h('button.b', { type: 'button', onclick: () => { S.shop.room = 'floor'; renderShop(); } }, 'Back to the shop floor', kbd('Esc'))));
}
const micLine = () => { const m = S.stack.cab.mic, w = micWhere(m); return `${MIC_NAMES[m.id]} on the ${cabName(S.stack)}, ${w.words}, ${inches(m.dist)} back.`; };
const cabName = (st) => (st.amp === 'core.stack' ? 'Modern 4x12' : `${getDevice(st.amp)?.name || 'amp'}’s own cab`);
function bindMic(canvas) {
  canvas.style.cursor = 'grab';
  const toScene = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 256, y: ((e.clientY - r.top) / r.height) * 144 }; };
  canvas.addEventListener('pointerdown', (e) => {
    const p = toScene(e), m = S.stack.cab.mic;
    const spot = MIC_SPOTS.find((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h);
    if (spot) { m.id = spot.id; S.shop.lookMic = spot.id; changed(`${MIC_NAMES[spot.id]} up on the cab.`); renderLook(); drawShopFrame(); return; }
    if (p.x < CAB.x - 6 || p.x > CAB.x + CAB.w + 6 || p.y < CAB.y - 6 || p.y > CAB.y + CAB.h + 6) return;
    canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
    const move = (ev) => { const q = toScene(ev); m.x = Math.round(clamp(q.x, CAB.x + 4, CAB.x + CAB.w - 4)); m.y = Math.round(clamp(q.y, CAB.y + 4, CAB.y + CAB.h - 4)); $('micnow').textContent = micLine(); drawShopFrame(); };
    move(e);
    const up = () => { canvas.style.cursor = 'grab'; canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); changed(`The mic’s at the ${micWhere(m).words} now.`); renderLook(); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
  });
  canvas.addEventListener('pointermove', (e) => { if (e.buttons) return; const p = toScene(e); const spot = MIC_SPOTS.find((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h); if ((spot?.id || null) !== (S.shop.hoverMic || null)) { S.shop.hoverMic = spot?.id || null; if (spot) { S.shop.lookMic = spot.id; renderLook(); } } });
}
function drawShopFrame(t = now()) {
  if (S.screen !== 'shop' || !SHOP.g) return;
  const g = SHOP.g;
  if (S.shop.room === 'mics') { drawCabRoom(g, { mic: S.stack.cab.mic, cone: micWhere(S.stack.cab.mic).cone }); return; }
  const inChain = new Set([S.stack.amp, ...S.stack.chain.filter((c) => c.device).map((c) => c.device)]);
  const colorsMap = {};
  for (const s of SHOP.spots) if (s.kind === 'pedal') { const d = getDevice(s.id); colorsMap[s.id] = d ? normHex(colorsOf(d).color) : '#5a5a62'; }
  drawShop(g, { inChain, loaded: S.stack.changed ? null : S.loaded, colors: colorsMap, stacks: S.rack, level: S.drummer.on ? guitarAt(beatNow(t)) : idleStrum(t) * 0.6, reduced: REDUCED });
}
const normHex = (c) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || ''); if (!m) return '#5a5a62'; const x = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1]; return '#' + x.toLowerCase(); };

/* ---------------------------------------------------------------- the screens menu */
const SCREENS = [
  'Walk in: Getting started', 'The stage, jamming', 'That was the one: the tape', 'The part line: drag, insert, reorder, delete', 'Recording a part', 'The other side, then both',
  'The riff library', 'The shop', 'Claude on the talkback',
];
function renderScreens() {
  const el = $('screens');
  const open = !!S.screensOpen;
  el.replaceChildren(...[h('button', { type: 'button', 'aria-expanded': String(open), onclick: () => { S.screensOpen = !open; renderScreens(); } }, open ? 'Close' : 'Screens'),
    open ? h('div.float', { role: 'menu' }, SCREENS.map((t, i) => h('button', { type: 'button', role: 'menuitem', onclick: () => { S.screensOpen = false; go(i + 1); } }, h('span.n', String(i + 1)), t)), h('hr'),
      h('button.tog', { type: 'button', 'aria-pressed': String(S.claude), onclick: () => { S.claude = !S.claude; render(); } }, h('i.lamp'), 'Claude is connected')) : null].filter(Boolean));
}

/* ================================================================================================ actions */
function space() {
  if (S.play) { S.play = null; S.drummer.on = false; say('Stopped.'); render(); return; }
  if (S.drummer.on) { S.drummer.on = false; S.tapeNow = beatNow() / 4; say('The drummer’s stopped. The tape’s still got the last minute.'); render(); return; }
  S.drummer.on = true; S.drummer.t0 = now();
  say(`${beatById(S.drummer.beat).name} at ${S.tempo}. The tape’s rolling: G grabs what you just played.`);
  render();
}
function tempo(d) { S.tempo = clamp(S.tempo + d, 60, 240); renderSide(); say(`The drummer’s at ${S.tempo}.`); }
function tap() {
  const t = now(); S.taps = S.taps.filter((x) => t - x < 2500); S.taps.push(t);
  if (S.taps.length >= 4) { const gaps = S.taps.slice(1).map((x, i) => x - S.taps[i]); const avg = gaps.reduce((a, b) => a + b) / gaps.length; S.tempo = clamp(Math.round(60000 / avg), 60, 240); say(`Tapped: ${S.tempo}.`); S.taps = []; renderSide(); }
  else say(`Tap ${S.taps.length} of 4.`);
}
function setBeat(id, who = 'you') {
  if (id === S.drummer.beat) return;
  snapshot(`the beat back to ${beatById(S.drummer.beat).name}`);
  S.drummer.beat = id; S.drummer.by = who;
  if (who === 'you') say(`${beatById(id).name}${S.drummer.on ? ', from the next bar' : ''}.`);
  renderSide(); renderBottom();
}
function nextBeat(d = 1) { const i = BEATS.findIndex((b) => b.id === S.drummer.beat); setBeat(BEATS[(i + d + BEATS.length) % BEATS.length].id); }
function stomp(n) {
  const peds = S.stack.chain.filter((c) => !c.amp);
  const c = peds[n - 1];
  if (!c) return;
  c.on = !c.on;
  const def = getDevice(c.device);
  changed(`${def.name} ${c.on ? 'on' : 'off'}.`, true);
  renderSide();
}
function changed(line, quiet) { S.stack.changed = true; say(line); if (!quiet) { renderSide(); if (S.screen === 'shop') { renderChain(); } } }
function addPedal(id) {
  snapshot(`${getDevice(id).name} off the floor`);
  const def = getDevice(id), c = { device: id, on: true, uid: uid('p'), params: {} };
  const ai = S.stack.chain.findIndex((x) => x.amp);
  if (BEFORE_AMP.test(def.cat)) S.stack.chain.splice(ai, 0, c); else S.stack.chain.push(c);
  S.stack.changed = true;
  say(`${def.name} is on the floor, ${BEFORE_AMP.test(def.cat) ? 'before' : 'after'} the amp. You’re playing through it.`);
  renderSide(); if (S.screen === 'shop') { renderChain(); drawShopFrame(); renderLook(); }
}
function removePedal(u) {
  const c = S.stack.chain.find((x) => x.uid === u);
  if (!c) return;
  snapshot(`${getDevice(c.device).name} back on the floor`);
  S.stack.chain = S.stack.chain.filter((x) => x.uid !== u); S.stack.changed = true;
  say(`${getDevice(c.device).name} is off the floor. ⌘Z puts it back.`);
  renderSide(); if (S.screen === 'shop') { renderChain(); drawShopFrame(); renderLook(); for (const b of document.querySelectorAll('.hs')) b.classList.toggle('in', b.dataset.key === `pedal:${c.device}` ? false : b.classList.contains('in')); }
}
function loadStack(id) {
  const def = S.rack.find((s) => s.id === id);
  if (!def) return;
  snapshot(`${S.stack.name} back on the floor`);
  S.stack = stackFrom(def); S.loaded = id;
  say(`${def.name} is on the floor: ${def.chain.map((c) => (c.amp ? (def.amp === 'core.stack' ? 'Half Stack' : getDevice(def.amp).name) : getDevice(c.device)?.name)).join(', ')}.`);
  render();
}
function saveToRack() {
  if (S.screen !== 'shop') { openShop(); }
  S.shop.naming = true; S.shop.name = S.stack.changed ? `${S.stack.name}, mine` : S.stack.name;
  renderChain();
}
function doSave(name) {
  name = (name || '').trim() || 'My stack';
  snapshot(`${name} out of the rack`);
  const id = 'mine-' + Date.now().toString(36);
  const st = JSON.parse(JSON.stringify(S.stack));
  S.rack.push({ id, name, blurb: 'Saved today, from this song', amp: st.amp, setting: st.setting, by: 'you', tag: name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ')[0].slice(0, 7), chain: st.chain.map((c) => (c.amp ? { amp: true } : { device: c.device, on: c.on })) });
  S.loaded = id; S.stack.name = name; S.stack.changed = false; S.stack.id = id; S.shop.naming = false;
  say(`Saved to the rack as ${name}. Any song can load it.`);
  renderShop(); renderSide();
}
function take(key) {
  const [kind, id] = key.split(':');
  if (kind === 'amp') {
    if (S.stack.amp === id) return;
    snapshot(`${ampName(S.stack)} back on the floor`);
    S.stack.amp = id; S.stack.setting = id === 'core.stack' ? 'Modern' : null; S.stack.ampParams = id === 'core.stack' ? { ...presetParams(STACK, 'Modern') } : {};
    S.stack.changed = true;
    say(`${ampName(S.stack)} is your amp now. You’re playing through it.`);
  } else if (kind === 'pedal') {
    const c = S.stack.chain.find((x) => x.device === id);
    if (c) { removePedal(c.uid); return; }
    addPedal(id); return;
  } else if (kind === 'stack') { loadStack(id); }
  else { S.shop.room = 'mics'; renderShop(); return; }
  renderShop(); renderSide();
}
function openShop(focus) {
  S.menu = null; renderFloating();
  S.screen = 'shop'; S.shop.room = 'floor';
  if (focus === 'counter') S.shop.look = 'pedal:pedal.hydra';
  render();
  if (focus === 'counter') requestAnimationFrame(() => document.querySelector('.hs[data-key="pedal:pedal.hydra"]')?.focus());
}
function closeShop() {
  if (S.shop.naming) { S.shop.naming = false; renderChain(); return; }
  if (S.shop.room === 'mics') { S.shop.room = 'floor'; renderShop(); return; }
  S.screen = 'stage';
  say(`Back on the stage with ${S.stack.changed ? 'your changed stack' : S.stack.name} on the floor: ${ampName(S.stack)}${S.stack.chain.filter((c) => !c.amp).length ? ' and ' + S.stack.chain.filter((c) => !c.amp).map((c) => getDevice(c.device)?.name).join(', ') : ''}.`);
  render();
}
function openLib() { S.screen = 'lib'; S.menu = null; render(); }
function closeLib() { S.screen = 'stage'; S.lib.preview = null; render(); }
function libDrop(id) {
  const r = [...S.riffs, ...LIB].find((x) => x.id === id);
  if (!r) return;
  const at = S.sel && S.sel !== 'new' ? S.parts.findIndex((p) => p.id === S.sel) + 1 : S.parts.length;
  S.screen = 'stage';
  dropRiff(r, at);
  render();
}

/* the tape and riffs */
function openTape() {
  if (S.rec) return;
  const [a, b] = lastIdea();
  S.tape = { a, b, snap: true, preview: null };
  S.sheet = 'tape';
  S.tapeNow = S.drummer.on ? beatNow() / 4 : S.tapeNow;
  say(`The last minute, on the drummer’s bars. Bars ${a} to ${b} are picked: the last you played. Enter keeps them.`);
  render();
}
function closeSheet() { S.sheet = null; S.tape = null; render(); }
function keepRiff(who = 'you') {
  const T = S.tape || (() => { const [a, b] = lastIdea(); return { a, b }; })();
  snapshot(`Riff ${S.riffN} out of the tray`);
  const bars = Math.round((T.b - T.a) * 4) / 4;
  const r = { id: 'riff-' + S.riffN, name: `Riff ${S.riffN}`, bars, tempo: S.tempo, tuning: S.tuning, key: S.key, keySure: true, secs: secsOf(bars, S.tempo), stack: S.stack.name, at: Date.now(), song: null, starred: false, by: who, style: 'chug', seed: 31337 + S.riffN * 101, isNew: true };
  S.riffN++;
  S.riffs.unshift(r); S.loopRiff = r.id; S.selRiff = r.id; r.loopT0 = now();
  S.sheet = null; S.tape = null;
  if (who === 'you') say(`${r.name} is in the tray: ${plural(bars, 'bar')} at ${S.tempo}, ${S.tuning}. It’s looping; drag it to the part line.`);
  render();
  return r;
}
function dropRiff(r, at) {
  snapshot(`${r.name}’s part off the part line`);
  const p = { id: 'part-' + uid(''), name: r.name, bars: r.bars, riff: r.id, beat: S.drummer.beat, takes: { L: [{ n: 1, seed: r.seed, from: 'riff' }], R: [] }, pick: { L: 0, R: 0 }, count: 1 };
  S.parts.splice(at, 0, p);
  S.sel = p.id;
  const nb = S.parts[at + 1], pv = S.parts[at - 1];
  say(`${r.name} is a part now: ${plural(r.bars, 'bar')}${nb ? `, before ${nb.name}` : pv ? `, after ${pv.name}` : ''}. Its take is the riff; R records over it.`);
}
function movePart(id, to) {
  const i = S.parts.findIndex((p) => p.id === id);
  if (i < 0) return;
  snapshot(`${S.parts[i].name} back where it was`);
  const [p] = S.parts.splice(i, 1);
  const j = to > i ? to - 1 : to;
  S.parts.splice(j, 0, p);
  const nb = S.parts[j + 1], pv = S.parts[j - 1];
  say(`Moved ${p.name} ${nb ? 'before ' + nb.name : pv ? 'after ' + pv.name : ''}.`);
  render();
}
function delPart(id) {
  const i = S.parts.findIndex((p) => p.id === id);
  if (i < 0) return;
  const p = S.parts[i];
  snapshot(`${p.name} back on the part line`);
  S.parts.splice(i, 1);
  S.sel = S.parts[Math.min(i, S.parts.length - 1)]?.id || null;
  say(S.parts.length ? `${p.name} is off the part line. ⌘Z brings it back.` : `The part line’s empty. ⌘Z brings ${p.name} back.`);
  render();
}
function selStep(d) {
  if (!S.parts.length) return;
  const i = S.parts.findIndex((p) => p.id === S.sel);
  const j = clamp((i < 0 ? (d > 0 ? -1 : S.parts.length) : i) + d, 0, S.parts.length - 1);
  S.sel = S.parts[j].id; renderBottom();
}
function pickTake(d) {
  const p = S.parts.find((x) => x.id === S.sel);
  if (!p || p.takes.L.length < 2) return;
  p.pick.L = (p.pick.L + d + p.takes.L.length) % p.takes.L.length;
  say(`${p.name}: take ${p.takes.L[p.pick.L].n} plays.`);
  renderBottom();
}
function playFrom(i) {
  if (!S.parts.length) return;
  S.play = { from: i, t0: now() };
  S.drummer.on = true; S.drummer.t0 = now();
  say(`Playing from ${S.parts[i].name}.`);
  render();
}

/* recording */
function record(side = 'L') {
  if (S.sheet === 'tape') closeSheet();
  let part = S.parts.find((p) => p.id === S.sel);
  if (!part) {
    // an empty slot: a new part, a reasonable 4 bars
    snapshot('the new part');
    part = { id: 'part-' + uid(''), name: `Part ${S.parts.length + 1}`, bars: 4, beat: S.drummer.beat, takes: { L: [], R: [] }, pick: { L: 0, R: 0 }, count: 0 };
    S.parts.push(part); S.sel = part.id;
  }
  const n = side === 'R' ? (part.countR = (part.countR || 0) + 1) : (part.count = (part.count || 0) + 1);
  S.rec = { phase: 'count', partId: part.id, side, t0: now(), n, seed: 5000 + part.count * 17 + (side === 'R' ? 3 : 0) };
  S.play = null; S.drummer.on = true; S.drummer.t0 = now();
  render();
}
function stopRec() {
  const R = S.rec, part = S.parts.find((p) => p.id === R.partId);
  const el = ((now() - R.t0) * S.tempo) / 240000 + (R.skip || 0);
  const stopAt = Math.max(0.5, Math.round(el * 16) / 16);
  const ringEnd = Math.min(stopAt, part.bars + 1.5);
  S.rec = null; S.drummer.on = false;
  S.pending = { partId: part.id, side: R.side, stopAt, in: 0, ringEnd, out: Math.max(Math.min(stopAt, part.bars), ringEnd), take: { n: R.n, seed: R.seed, by: 'you' }, hear: REDUCED ? null : now(), pair: R.side === 'R' ? { avg: 6, max: 14 } : null };
  S.sheet = 'take';
  const ring = S.pending.out - part.bars, nx = S.parts[S.parts.indexOf(part) + 1];
  say(R.side === 'R' ? `The other side is in: ${S.pending.pair.avg} ms from your left on average, ${S.pending.pair.max} at most. Keep it?` : stopAt < part.bars ? `Take ${R.n} is in: you stopped in bar ${Math.floor(stopAt) + 1} of ${part.bars}. Keep it?` : `Take ${R.n} is in: ${plural(part.bars, 'bar')}${ring > 0.05 ? `, and ${plural(ring, 'bar')} rang ${nx ? 'into ' + nx.name : 'past the end'}` : ''}. Keep it?`);
  render();
}
function restartRec() { const R = S.rec; S.rec = { ...R, phase: 'count', t0: now(), skip: 0 }; S.drummer.t0 = now(); say('From the top: counting you back in.'); render(); }
function tossRec() { const R = S.rec; S.rec = null; S.drummer.on = false; say(`Tossed take ${R.n}. The tape still has it.`); render(); }
function keepTake() {
  const P = S.pending, part = S.parts.find((p) => p.id === P.partId);
  snapshot(`take ${P.take.n} un-kept`);
  part.takes[P.side].push({ ...P.take, in: P.in, out: P.out });
  part.pick[P.side] = part.takes[P.side].length - 1;
  S.pending = null; S.sheet = null;
  if (P.side === 'R') {
    say(`Kept. Both sides of ${part.name}, wide.`);
    playFrom(S.parts.indexOf(part)); S.wideUntil = now() + 12000;
    return;
  }
  say(`Kept. ${part.name} has ${part.takes.L.length} take${part.takes.L.length > 1 ? 's' : ''}; ↑ ↓ picks one. D for the other side.`);
  render();
}
function tossTake() { const P = S.pending; S.pending = null; S.sheet = null; say(`Tossed take ${P.take.n}. It’s gone from the song; the tape still has it.`); render(); }
function again() { const P = S.pending; S.pending = null; S.sheet = null; S.sel = P.partId; record(P.side); }
function otherSide() {
  const p = S.parts.find((x) => x.id === S.sel);
  if (!p || !p.takes.L.length) { say('Pick a part with a kept take first; the other side plays against it.'); return; }
  record('R');
}

/* Getting started */
function obGo(i, skipped) {
  const o = S.ob;
  if (!skipped && i > o.step) o.done[o.step] = true;
  if (i >= 4) { o.step = 4; S.tour = 0; S.tuner = false; renderOver(); return; }
  o.step = clamp(i, 0, 4);
  if (o.step === 1) { o.strings = 0; o.tuneT0 = now(); }
  renderOver();
}
function obNext() { obGo(S.ob.step + 1); }
function obClose(never) { S.ob = null; S.tuner = false; say(never ? 'Getting started is in the menu if you want it again. Space starts the drummer.' : 'Space starts the drummer at 132. Getting started picks up where you left it.'); render(); }
function calibrate() { const o = S.ob; o.clicks = 0; o.measured = null; o.calT0 = now(); renderOver(); }
function tourNext() { if (S.tour >= TOUR.length - 1) return tourEnd(); S.tour++; renderTour(); }
function tourEnd() { S.tour = null; S.ob = null; renderTour(); say('You’re set. Space starts the drummer at 132; play, and G grabs what you liked.'); render(); }

/* Claude */
function openTalk() { if (!S.claude) { say('Nobody’s on the other side of the glass. Connect Claude from the control room.'); return; } S.talking = true; S.talkDraft = S.talkDraft || ''; renderTalk(); }
function ask(q) {
  q = (q || '').trim();
  S.talking = false; S.talkDraft = '';
  if (!q) { renderTalk(); return; }
  S.thinking = true; S.talk = { ...S.talk, asked: q, at: now() };
  renderTalk();
  setTimeout(() => { S.thinking = false; answer(q); }, REDUCED ? 0 : 900);
}
function answer(q) {
  const t = q.toLowerCase();
  if (/thrash|beat|drum/.test(t)) {
    setBeat('gallop', 'claude');
    say('The drummer’s on Double-kick gallop now, at 132. A d-beat wants 160 or more: say if you want the tempo up. ⌘Z puts the old beat back.', 'claude', q);
  } else if (/grab|riff/.test(t)) {
    const [a, b] = lastIdea(); S.tape = { a, b, snap: true };
    const r = keepRiff('claude');
    say(`Grabbed bars ${a} to ${b} off the tape: ${r.name}, ${plural(r.bars, 'bar')}, in the tray. ⌘Z takes it back out.`, 'claude', q);
  } else if (/name/.test(t)) {
    if (!S.parts.length) { say('There are no parts to name yet. Drop a riff on the part line first.', 'claude', q); return; }
    snapshot('the parts’ old names');
    const names = S.parts.length === 1 ? ['Verse'] : S.parts.length === 2 ? ['Intro', 'Verse'] : ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'];
    S.parts.forEach((p, i) => { p.name = names[i] || `Part ${i + 1}`; p.namedBy = 'claude'; });
    say(`Named them ${S.parts.map((p) => p.name).join(', ').replace(/, ([^,]*)$/, ' and $1')}, from where they sit. ⌘Z puts the old names back.`, 'claude', q);
  } else if (/tone|record|sound/.test(t)) {
    say('Which record? Name it, and I’ll set the stack close; you judge it by ear.', 'claude', q);
  } else say('I can swap the beat, grab a riff off the tape, name parts or set a stack. Which one?', 'claude', q);
  render();
}

/* ================================================================================================ dragging: riffs and parts onto the part line, pedals in the chain */
let drag = null;
function dragSource(el, what) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let started = false, ghost = null;
    const move = (ev) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!started) {
        started = true; drag = what; el.classList.add('dragging');
        ghost = el.cloneNode(true); ghost.classList.add('ghost'); ghost.classList.remove('dragging');
        const r = el.getBoundingClientRect(); ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
        document.body.append(ghost);
        for (const c of ghost.querySelectorAll('canvas')) drawMini(c);
      }
      ghost.style.left = ev.clientX - 40 + 'px'; ghost.style.top = ev.clientY - 30 + 'px';
      hotDrop(ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!started) { click(what); return; }
      ghost?.remove(); el.classList.remove('dragging');
      const at = hotDrop(ev.clientX, ev.clientY, true);
      drag = null;
      if (at == null) { renderBottom(); return; }
      if (what.kind === 'riff') { dropRiff(S.riffs.find((r) => r.id === what.id), at); render(); } else movePart(what.id, at);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.activeElement === el && what.kind === 'riff') { e.preventDefault(); e.stopPropagation(); dropRiff(S.riffs.find((r) => r.id === what.id), S.sel && S.sel !== 'new' ? S.parts.findIndex((p) => p.id === S.sel) + 1 : S.parts.length); render(); } });
}
function click(what) {
  if (what.kind === 'riff') { S.selRiff = what.id; S.loopRiff = S.loopRiff === what.id ? null : what.id; const r = S.riffs.find((x) => x.id === what.id); r.loopT0 = now(); say(S.loopRiff ? `${r.name}, round and round. Drag it to the part line.` : `${r.name} stopped.`); renderBottom(); }
  else { S.sel = what.id; renderBottom(); }
}
// where a drop would land on the part line: an index, with its gap lit
function hotDrop(x, y, final) {
  const lane = $('partlane');
  if (!lane) return null;
  const r = lane.getBoundingClientRect();
  for (const g of lane.querySelectorAll('.gap-slot, .empty-slot')) g.classList.remove('hot');
  if (y < r.top - 30 || y > r.bottom + 30 || x < r.left - 20 || x > r.right + 20) return null;
  const cards = [...lane.querySelectorAll('.card')];
  if (!cards.length) { const e = lane.querySelector('.empty-slot'); e?.classList.add('hot'); return 0; }
  let at = cards.length;
  for (let i = 0; i < cards.length; i++) { const cr = cards[i].getBoundingClientRect(); if (x < cr.left + cr.width / 2) { at = i; break; } }
  if (drag?.kind === 'part') { const from = S.parts.findIndex((p) => p.id === drag.id); if (at === from || at === from + 1) return final ? null : null; }
  if (!final) lane.querySelector(`.gap-slot[data-drop="${at}"]`)?.classList.add('hot');
  return at;
}
function chainDrag(slot, u) {
  slot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, [role="slider"], .knob, .ewf-knob, input, select')) return;
    const x0 = e.clientX;
    let started = false;
    const move = (ev) => { if (!started && Math.abs(ev.clientX - x0) < 6) return; started = true; slot.classList.add('dragging'); slot.style.transform = `translateX(${ev.clientX - x0}px)`; };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      slot.style.transform = ''; slot.classList.remove('dragging');
      if (!started) return;
      const slots = [...$('chainrow').querySelectorAll('.slot')];
      const order = slots.map((s) => ({ uid: s.dataset.uid || 'amp', x: s === slot ? ev.clientX : s.getBoundingClientRect().left + s.getBoundingClientRect().width / 2 }));
      order.sort((a, b) => a.x - b.x);
      const st = S.stack, byUid = new Map(st.chain.map((c) => [c.uid, c])), amp = st.chain.find((c) => c.amp);
      const next = order.map((o) => (o.uid === 'amp' ? amp : byUid.get(o.uid)));
      if (next.map((c) => c.uid).join() === st.chain.map((c) => c.uid).join()) return;
      snapshot('the chain’s old order');
      st.chain = next; st.changed = true;
      const c = byUid.get(u), i = next.indexOf(c), def = getDevice(c.device);
      say(`${def.name} moved: ${next[i - 1] ? 'after ' + (next[i - 1].amp ? 'the amp' : getDevice(next[i - 1].device).name) : 'first in the chain'}.`);
      renderChain(); renderSide();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
}

/* ================================================================================================ keys */
const isTyping = (t) => t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
function onKey(e) {
  if (isTyping(e.target)) return;
  const k = e.key, mod = e.metaKey || e.ctrlKey;
  if (e.target?.getAttribute?.('role') === 'slider' && /^Arrow|^Page|^Home$|^End$/.test(k) && !e.target.classList.contains('handle')) return;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && (k === 'z' || k === 'Z') && !S.rec) { done(); undo(); return; }
  if (mod && (k === 's' || k === 'S')) { done(); saveToRack(); return; }
  if (mod || e.altKey && !/^Arrow/.test(k)) return;
  // the recording view: nothing else takes a key
  if (S.rec) {
    done();
    if (k === ' ' && S.rec.phase === 'rec') stopRec();
    else if (k === 'r' || k === 'R') restartRec();
    else if (k === 'Escape') tossRec();
    return;
  }
  if (S.screensOpen && k === 'Escape') { done(); S.screensOpen = false; renderScreens(); return; }
  if (S.menu) { if (k === 'Escape') { done(); S.menu = null; renderFloating(); } return; }
  // a take landed: hearing it back stops on any press
  if (S.sheet === 'take' && S.pending) {
    if (S.pending.hear) { S.pending.hear = null; renderSheet(); }
    if (k === 'Enter') { done(); keepTake(); }
    else if (k === 'Backspace' || k === 'Delete' || k === 'Escape') { done(); tossTake(); }
    else if (k === 'r' || k === 'R') { done(); again(); }
    else if (k === ' ') { done(); S.pending.hear = S.pending.hear ? null : now(); renderSheet(); }
    return;
  }
  if (S.sheet === 'tape') {
    const T = S.tape, step = T.snap ? 1 : 0.25;
    if (k === 'Enter') { done(); keepRiff(); }
    else if (k === 'Escape') { done(); closeSheet(); }
    else if (k === ' ') { done(); T.preview = T.preview ? null : now(); renderSheet(); }
    else if (k === 'n' || k === 'N') { done(); T.snap = !T.snap; renderSheet(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      done(); const d = k === 'ArrowLeft' ? -step : step, { b0, b1 } = tapeRange();
      if (e.shiftKey) T.b = clamp(T.b + d, T.a + step, b1); else if (T.a + d >= b0 && T.b + d <= b1) { T.a += d; T.b += d; }
      renderSheet();
    }
    return;
  }
  if (S.screen === 'lib') return libKey(e, k, done);
  if (S.screen === 'shop') return shopKey(e, k, done);
  if (S.talking) return;
  if (S.tour != null) { if (k === 'Enter') { done(); tourNext(); return; } if (k === 'Escape') { done(); tourEnd(); return; } }
  if (S.ob && S.ob.step < 4) {
    if (k === 'Enter') { done(); obNext(); return; }
    if (k === 'Escape') { done(); obClose(); return; }
    if (S.ob.step === 0 && (k === 'ArrowUp' || k === 'ArrowDown')) { done(); S.ob.gain = clamp(S.ob.gain + (k === 'ArrowUp' ? 0.08 : -0.08), 0, 1); renderOver(); return; }
  }
  stageKey(e, k, done);
}
function stageKey(e, k, done) {
  if (S.play && !['ArrowUp', 'ArrowDown', 'Shift', 'Meta', 'Control', 'Alt'].includes(k) && k !== ' ') { /* a press while playing: Space stops it, Esc too */ }
  if (/^[1-9]$/.test(k)) { done(); stomp(Number(k)); return; }
  if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { done(); const i = S.parts.findIndex((p) => p.id === S.sel); if (i >= 0) movePart(S.sel, k === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(S.parts.length, i + 2)); return; }
  switch (k) {
    case ' ': done(); space(); return;
    case 'ArrowLeft': done(); tempo(-1); return;
    case 'ArrowRight': done(); tempo(1); return;
    case 'ArrowUp': done(); pickTake(-1); return;
    case 'ArrowDown': done(); pickTake(1); return;
    case 't': case 'T': done(); tap(); return;
    case 'b': case 'B': done(); nextBeat(e.shiftKey ? -1 : 1); return;
    case 'g': case 'G': done(); openTape(); return;
    case 'l': case 'L': done(); openLib(); return;
    case 's': case 'S': done(); openShop(); return;
    case 'u': case 'U': done(); S.tuner = !S.tuner; renderOver(); return;
    case 'r': case 'R': done(); record('L'); return;
    case 'd': case 'D': done(); otherSide(); return;
    case '[': done(); selStep(-1); return;
    case ']': done(); selStep(1); return;
    case 'Home': done(); playFrom(0); return;
    case 'Enter': {
      if (document.activeElement?.matches?.('.card.riff')) return;
      done(); const i = S.parts.findIndex((p) => p.id === S.sel); if (i >= 0) playFrom(i); else if (S.parts.length) playFrom(0); return;
    }
    case 'Backspace': case 'Delete': if (S.sel && S.sel !== 'new') { done(); delPart(S.sel); } return;
    case '/': if (S.claude) { done(); openTalk(); } return;
    case 'Escape': done(); if (S.tuner) { S.tuner = false; renderOver(); } else if (S.play) space(); else if (S.sel) { S.sel = null; renderBottom(); } return;
  }
}
function libKey(e, k, done) {
  const L = S.lib, rows = libRows(), i = rows.findIndex((r) => r.id === L.sel), r = rows[i];
  if (L.renaming) return;
  if (k === 'Escape') { done(); closeLib(); }
  else if (k === '/') { done(); $('libq')?.focus(); }
  else if (k === 'ArrowDown' || k === 'ArrowUp') { done(); const j = clamp(i + (k === 'ArrowDown' ? 1 : -1), 0, rows.length - 1); L.sel = rows[j]?.id; renderLibList(); }
  else if (k === 'Enter' && r) { done(); libDrop(r.id); }
  else if (k === ' ' && r) { done(); L.preview = L.preview === r.id ? null : r.id; say(L.preview ? `Playing ${r.name}, round and round.` : 'Stopped.'); renderLibDetail(); }
  else if (k === '*' && r) { done(); r.starred = !r.starred; renderLibList(); }
  else if (k === 'F2' && r) { done(); L.renaming = true; renderLibDetail(); requestAnimationFrame(() => { const n = $('libname'); n.focus(); getSelection().selectAllChildren(n); }); }
}
function shopKey(e, k, done) {
  const sh = S.shop;
  if (k === 'Escape') { done(); closeShop(); return; }
  if (k === ' ') { done(); space(); return; }
  if (/^[1-9]$/.test(k)) { done(); stomp(Number(k)); renderChain(); return; }
  if (sh.room === 'mics') return;
  if (k === 'Enter' && sh.look) { done(); take(sh.look); return; }
  if (/^Arrow/.test(k)) {
    done();
    const spots = SHOP.spots, cur = spots.find((s) => `${s.kind}:${s.id}` === sh.look);
    if (!cur) { look(`amp:${spots[0].id}`); focusSpot(); return; }
    const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null, bs = Infinity;
    for (const s of spots) {
      if (s === cur) continue;
      const sx = s.x + s.w / 2 - cx, sy = s.y + s.h / 2 - cy, along = sx * dx + sy * dy;
      if (along <= 1) continue;
      const across = Math.abs(dx ? sy : sx), score = along + across * 2.2;
      if (score < bs) { bs = score; best = s; }
    }
    if (best) { look(`${best.kind}:${best.id}`); focusSpot(); }
  }
}
function focusSpot() { document.querySelector(`.hs[data-key="${CSS.escape(S.shop.look)}"]`)?.focus({ preventScroll: true }); }

/* ================================================================================================ the loop */
const scene = sceneOf('metal');
let sceneG = null;
function frame(t) {
  requestAnimationFrame(frame);
  const beat = beatNow(t), bt = beatById(S.drummer.beat);
  const drums = S.drummer.on ? hitsAt(beat, bt) : { kick: 0, snare: 0, hat: 0, crash: 0 };
  const playing = S.drummer.on || S.rec;
  let input = 0;
  if (S.ob?.step === 0) input = idleStrum(t) * (0.25 + S.ob.gain * 0.8);
  else if (S.rec?.phase === 'rec') { const part = S.parts.find((p) => p.id === S.rec.partId), el = ((t - S.rec.t0) * S.tempo) / 240000; input = el <= part.bars + 0.25 ? guitarAt(beat) : 0.85 * Math.exp(-(el - part.bars - 0.25) * 2.4); }
  else if (playing && !S.play) input = guitarAt(beat);
  else if (!S.play) input = idleStrum(t) * 0.5;
  // playing the part line back: your takes in the amps, the right one too when there's a right side
  let L = 0, R = 0, wide = false;
  if (S.play) {
    const bars = beat / 4; let acc = 0, cur = null;
    for (let i = S.play.from; i < S.parts.length; i++) { if (bars < acc + S.parts[i].bars) { cur = S.parts[i]; break; } acc += S.parts[i].bars; }
    if (!cur) { S.play = null; S.drummer.on = false; say('That’s the end of the part line.'); render(); }
    else { const g2 = guitarAt(beat); L = cur.takes.L.length ? g2 : 0; R = cur.takes.R.length ? g2 * 0.95 : 0; wide = !!cur.takes.R.length; S.playAt = { id: cur.id, f: (bars - acc) / cur.bars }; }
  }
  // the count: the kick head's number
  let count = null;
  if (S.rec?.phase === 'count') {
    const b = ((t - S.rec.t0) * S.tempo) / 60000;
    if (b >= 4) { S.rec.phase = 'rec'; S.rec.t0 = t; renderRec(); }
    else { count = Math.floor(b) + 1; const c = $('reccount'); if (c && c.textContent !== String(count)) c.textContent = String(count); }
  }
  // the scene
  if (S.screen === 'stage' || S.rec) {
    if (!sceneG) sceneG = $('scene').getContext('2d');
    const anyR = S.parts.some((p) => p.takes.R.length);
    scene.draw(sceneG, {
      place: 'metal',
      live: { input, L, R, kick: drums.kick, snare: drums.snare, hat: drums.hat, crash: drums.crash, master: [Math.max(input, L, drums.kick * 0.7), Math.max(input * (S.rec?.side === 'R' ? 1 : 0.9), R, drums.kick * 0.7)] },
      run: S.rec ? (S.rec.phase === 'count' ? 'count' : 'take') : S.play ? 'play' : S.drummer.on ? 'loop' : '',
      rolling: true, beat: S.drummer.on ? beat : 0, bar: S.drummer.on ? Math.floor(Math.max(0, beat) / 4) + 1 : null, count,
      plugged: true, side: S.rec?.side || 'L', doubled: anyR || S.rec?.side === 'R' || wide, talk: t - S.talk.at < 4000, reduced: REDUCED,
    }, t);
  }
  // the side's bar counter and the beat strip's step
  const rb = $('robar'); if (rb) { const txt = S.drummer.on ? `BAR ${Math.floor(beat / 4) + 1}` : ''; if (rb.textContent !== txt) rb.textContent = txt; }
  const step = S.drummer.on ? Math.floor(beat * 4) % 16 : -1;
  if (step !== frame.step) { frame.step = step; for (const i of document.querySelectorAll('.beat[aria-pressed="true"] .grid i.now')) i.classList.remove('now'); if (step >= 0) for (const i of document.querySelectorAll(`.beat[aria-pressed="true"] .grid i[data-i="${step}"]`)) i.classList.add('now'); }
  // the talkback lamp dims a few seconds after a line
  const lamp = $('tblamp'); if (lamp) lamp.classList.toggle('on', t - S.talk.at < 4000);
  // Getting started's live bits
  if (S.ob?.step === 0) obMeter(t, input);
  if (S.ob?.step === 1 || S.tuner) tunerFrame(t);
  if (S.ob?.step === 2 && S.ob.calT0) calFrame(t);
  // the playhead on the part line, a riff's loop in the tray
  partHead();
  const lp = $('riffloop');
  if (lp && S.loopRiff) { const r = S.riffs.find((x) => x.id === S.loopRiff); if (r) { const f = (((t - (r.loopT0 || 0)) * S.tempo) / 240000 / r.bars) % 1; lp.style.width = `${f * 138}px`; } }
  if (S.sheet === 'tape' && S.tape?.preview) drawTape();
  if (S.sheet === 'take' && S.pending?.hear) drawTake();
  if (S.rec?.phase === 'rec') drawRec(t);
  if (S.screen === 'shop' && (t - (frame.shopT || 0) > 60)) { frame.shopT = t; drawShopFrame(t); }
}
function partHead() {
  const old = document.querySelector('#partlane .head');
  if (!S.play || !S.playAt) { old?.remove(); return; }
  const card = document.querySelector(`#partlane .card[data-part="${S.playAt.id}"]`);
  if (!card) return;
  let hd = card.querySelector('.head');
  if (!hd) { old?.remove(); hd = h('i.head'); card.append(hd); }
  hd.style.left = `${clamp(S.playAt.f, 0, 1) * 100}%`;
}
function obMeter(t, input) {
  const o = S.ob;
  const db = input > 0.001 ? -60 + (20 * Math.log10(input) + 60) * 1 : -60;
  const peakDb = -34 + o.gain * 36;
  const lvl = $('oblvl'), hold = $('obhold'), v = $('obverdict');
  if (!lvl) return;
  const cur = input > 0.01 ? peakDb + 20 * Math.log10(Math.max(0.001, input / (0.25 + o.gain * 0.8))) : -60;
  void db;
  lvl.style.transform = `scaleX(${clamp((cur + 60) / 60, 0, 1)})`;
  hold.style.left = `${clamp((peakDb + 60) / 60, 0, 1) * 100}%`;
  const pk = Math.round(peakDb);
  const [txt, cls, halo] = peakDb > -4 ? [`Hot (${pk} dBFS): a touch down on the gain knob.`, '', '#ffd166'] : peakDb >= -12 ? [`Right in the window (${pk} dBFS). Sounds good.`, 'ok', '#8fdca0'] : peakDb >= -24 ? [`A little low (${pk} dBFS): nudge the gain knob on the Solo up.`, '', '#46413a'] : [`Too quiet (${pk} dBFS): turn the gain knob up.`, '', '#46413a'];
  if (v.textContent !== txt) { v.textContent = txt; v.className = 'verdict ' + cls; const d = document.querySelector('.gainknob .dial'); if (d) d.style.setProperty('--halo', halo); o.gainHalo = halo; }
}
function tunerFrame(t) {
  const o = S.ob || { strings: 0, tuneT0: 0 };
  const strs = TUNINGS[S.tuning];
  if (S.ob && !o.tuneT0) o.tuneT0 = t;
  const el = (t - (o.tuneT0 || 0)) / 1000;
  // each string: it comes in from flat, wobbles, settles; in after about two and a half seconds
  const cents = S.ob ? Math.round((-28 * Math.exp(-el * 1.2) + Math.sin(el * 7) * 3 * Math.exp(-el * 0.8))) : Math.round(Math.sin(t / 700) * 4);
  const n = $('needle');
  if (n) n.setAttribute('transform', `rotate(${clamp(cents * 1.2, -60, 60)} 132 66)`);
  const c = $('tunercents');
  if (c) { const txt = Math.abs(cents) <= 2 ? 'in tune' : `${cents > 0 ? '+' : '−'}${Math.abs(cents)} cents`; if (c.textContent !== txt) { c.textContent = txt; c.className = 'cents' + (Math.abs(cents) <= 2 ? ' ok' : ''); } }
  if (S.ob && el > 2.6 && o.strings < 6) { o.strings++; o.tuneT0 = t; renderOver(); }
  void strs;
}
function calFrame(t) {
  const o = S.ob, k = Math.floor((t - o.calT0) / 600);
  if (k !== o.clicks && k <= 8) { o.clicks = k; if (k === 8) { o.measured = 23; o.calT0 = 0; o.done[2] = true; } renderOver(); }
}

/* ================================================================================================ the screens: canned states */
function base() {
  faces.clear();
  S = fresh();
  S.talk = { text: 'The drummer’s at 132: ← → moves it, T taps it. Space and you’re in.', by: 'overdub', at: now() - 5000, asked: null };
}
function riffAt(n, bars, style = 'chug', ago = 0) {
  return { id: 'riff-' + n, name: `Riff ${n}`, bars, tempo: 132, tuning: 'Drop C', key: 'C minor', keySure: true, secs: secsOf(bars, 132), stack: 'Tight and modern', at: Date.now() - ago * 60000, song: null, starred: false, by: 'you', style, seed: 31337 + n * 101 };
}
function partOf(r, extra = {}) { return { id: 'part-' + r.id, name: r.name, bars: r.bars, riff: r.id, beat: 'djentq', takes: { L: [{ n: 1, seed: r.seed, from: 'riff' }], R: [] }, pick: { L: 0, R: 0 }, count: 1, ...extra }; }
function go(n) {
  base();
  const t = now();
  if (n === 1) { S.ob = { step: 0, done: {}, gain: 0.42, strings: 0 }; S.talk = { text: '', by: 'overdub', at: 0 }; }
  if (n === 2) { S.drummer = { on: true, t0: t - (7 * 4 * 60000) / 132, beat: 'guide', by: null }; say('Guide beat at 132. The tape’s rolling: G grabs what you just played.'); S.talk.at = t - 1500; }
  if (n === 3) { S.drummer = { on: true, t0: t - (38.4 * 4 * 60000) / 132, beat: 'djentq', by: null }; S.riffs = [riffAt(3, 2, 'gallop', 9), riffAt(2, 2, 'open', 14)]; S.riffN = 4; render(); openTape(); return; }
  if (n === 4) {
    const r4 = riffAt(4, 4, 'chug', 1), r3 = riffAt(3, 2, 'gallop', 9), r2 = riffAt(2, 2, 'open', 14), r1 = riffAt(1, 4, 'chug', 26);
    S.riffs = [r4, r3, r2, r1]; S.riffN = 5; S.parts = [partOf(r4)]; S.sel = S.parts[0].id; S.drummer.beat = 'djentq';
    say('Riff 4 is a part now: 4 bars. Drag another riff before it for an intro, or after it.');
  }
  if (n === 5 || n === 6 || n === 9) {
    const r4 = riffAt(4, 4, 'chug', 1), r3 = riffAt(3, 2, 'gallop', 9), r2 = riffAt(2, 2, 'open', 14), r1 = riffAt(1, 4, 'chug', 26);
    S.riffs = [r4, r3, r2, r1]; S.riffN = 5; S.drummer.beat = 'djentq';
    S.parts = [partOf(r2), partOf(r4), partOf(r1)]; S.sel = S.parts[1].id;
    if (n === 5) { render(); record('L'); return; }
    if (n === 6) { const p = S.parts[1]; p.takes.L.push({ n: 2, seed: 5051 }); p.pick.L = 1; p.count = 2; render(); record('R'); S.rec.phase = 'rec'; S.rec.t0 = now() - (1.6 * 240000) / S.tempo; render(); return; }
    if (n === 9) { S.parts[1].takes.L.push({ n: 2, seed: 5051 }); S.parts[1].pick.L = 1; S.drummer = { on: true, t0: t - (12 * 4 * 60000) / 132, beat: 'djentq', by: null }; say('Kept. Riff 4 has 2 takes; ↑ ↓ picks one. D for the other side.'); S.talk.at = t - 6000; render(); openTalk(); S.talkDraft = 'Give me a beat that’s more thrash.'; renderTalk(); return; }
  }
  if (n === 7) { S.riffs = [riffAt(4, 4, 'chug', 1), riffAt(3, 2, 'gallop', 9)]; S.riffN = 5; S.screen = 'lib'; }
  if (n === 8) { S.drummer = { on: true, t0: t - (3 * 4 * 60000) / 132, beat: 'djentq', by: null }; S.screen = 'shop'; S.shop.look = 'amp:amp.metal'; say('The shop. Look at anything; a press puts it in your stack while you play.'); }
  render();
  if (n === 1) requestAnimationFrame(() => document.querySelector('.ob .b-go')?.focus({ preventScroll: true }));
}

/* ================================================================================================ start */
document.querySelector('.gr-top').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'shop') S.screen === 'shop' ? closeShop() : openShop();
  if (b.dataset.act === 'lib') S.screen === 'lib' ? closeLib() : openLib();
  if (b.dataset.act === 'control') say('The control room is the studio itself; this mock stays in the live room.');
});
window.addEventListener('keydown', onKey, true);
window.addEventListener('resize', () => fit());
document.addEventListener('pointerdown', (e) => {
  if (S.menu && !e.target.closest('.menu, #addpedal')) { S.menu = null; renderFloating(); }
  if (S.screensOpen && !e.target.closest('.screens')) { S.screensOpen = false; renderScreens(); }
});
colors();
const start = Number((location.hash.match(/^#(\d)$/) || [])[1]) || 1;
go(start);
fit();
requestAnimationFrame(frame);
window.mock = { go, get S() { return S; }, render, stopRec, keepTake, keepRiff, dropRiff, openTalk, ask, record, otherSide };
