// The guitar room [ui; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md; the blueprint is the second
// mock, design/mock/guitar-room-2/, with the first, design/mock/guitar-room/, for the takes, the tape and Claude;
// docs/ARCHITECTURE.md "The guitar room"). The live room's screen 'guitar' (./../screens.js): the metal club, rebuilt
// for the guitarist. The screen IS the stage seen from the front, everything physical a real control at a usable size,
// a camera to go closer, the shop through a door. It adds itself to the registry when it's imported.
//
// This module is where the guitar room's six streams meet, and it draws nothing of its own but the frame they draw in:
//   - the DOM slots each stream fills (R.el, below), built once on mount;
//   - the camera (./camera.js) on the two worlds (the stage and the shop), with a default target for every place it
//     goes (./layout.js REGIONS), which the streams refine;
//   - the one key table (./keys.js), and the router from an action id to the stream that implements it (OWNER);
//   - the state (./state.js, ui.state.liveRoom.gr), the gear's binding to the song (./bind.js), the room's own prefs
//     (./prefs.js), and the bus the streams talk on (R.on / R.emit);
//   - then each stream's module, mounted in ORDER with R; what it returns is its API, at R.parts[name].
//
// The streams' modules (each a stub until its stream builds it; each header is its contract):
//   ./stage.js    room     the stage room, the pixel walls and lights, the rig drawn from the real chain at real size,
//                          the board, the meter and the cable, the head and board zooms, the door and the tape machine
//                          as objects, the bottom strip's shell
//   ./shop.js     shop     the shop, the amp wall and the pedal case, the try-out corner, carrying gear in; the rack;
//                          the cab zoom's cab builder
//   ./drummer.js  drummer  the riser, the drummer's plate (Space, tempo, tap), the beat cards, the kit zoom's book,
//                          the jam
//   ./start.js    start    Getting started in the room; the tuner pedal (Tuna Fork) and its zoom
//   ./takes.js    takes    the recording view, the count-in into a part, take review, the other side, hear-back, the
//                          part line
//   ./tape.js     tape     the tape machine's zoom (the last minute), the riff tray and library, Claude on the talkback
//
// R, the room as a stream sees it (frozen):
//   R.app, R.ui, R.store, R.deck (ui/liveroom/deck.js), R.lr (the live room's screen ctx: say(lineId, vars), prefs,
//     view(), scene), R.getDevice
//   R.gr                 ui.state.liveRoom.gr (./state.js)          R.L   ui.state.liveRoom (run, card, side)
//   R.el = {
//     root, view                         the screen's element and the camera's viewport
//     stage: { world, pixels, gear, riser, hot, spot }    the stage world (STAGE w x h world units) and its layers,
//                                        back to front: the pixel room [room], the gear [room], the riser's plate and
//                                        cards [drummer], the hotspots [room], the spotlight [start]
//     shop: { world, pixels, wall, case, corner, hot }    the shop world and its layers [shop]
//     panels                             where R.panel(target) puts a zoom's side panel
//     sheets                             where R.sheet(id) puts a bottom sheet
//     drawer: { el, tray, parts }        the drawer over the board: the riff tray [tape] and the part line [takes]
//     over                               the recording view, over everything but the strip [takes]
//     callout                            Getting started's slate [start]
//     strip: { el, talk, tools }         the bottom strip: the talkback [tape] and the strip's buttons [room]
//     tools                              the header's slot for the screen's own (the way back, Getting started) [room]
//   }
//   R.camera             ./camera.js's camera on the two worlds
//   R.rig                ./bind.js's binding: the rig on the guitar tracks
//   R.gprefs             ./prefs.js
//   R.panel(target) -> el        the side panel for a camera target (made on first ask; shown while the camera's there)
//   R.sheet(id) -> el            a bottom sheet (made on first ask; shown while gr.overlay === id)
//   R.overlay(id | null)         what has the keys above the room (./keys.js contexts): sets gr.overlay, shows its
//                                sheet, emits 'overlay'
//   R.drawer(open?) -> bool      the riffs and the part line up over the board, or down (no arg: flip)
//   R.say(text, { by })          a line in the talkback (app.liveRoom.say: the house's unsigned, an agent's signed)
//   R.line(id, vars) -> bool     one of the room's lines by id (core/liveroom/lines/*.js; the live room's sayLine)
//   R.press(id) -> { ok, error? }   an action, as its key presses it (app.liveRoom.press(id) comes here too)
//   R.run(next?) -> run          ui.state.liveRoom.run, read or set ('idle' | 'count' | 'take' | 'play' | 'jam')
//   R.busy() -> bool             a count or a take is running
//   R.on(evt, fn) -> off, R.emit(evt, data)   the room's bus: 'cam' ({ to, from, world }), 'overlay' ({ id, was }),
//                                'rig' (Rig: the chain changed), 'press' ({ id, ok }), and any a stream adds (named
//                                '<stream>:<what>': 'takes:landed', 'drummer:jam', 'tape:grab')
//   R.parts = { room, shop, drummer, start, takes, tape }   each stream's API once mounted (null before)
//
// A stream's module: export function mount(R) -> { press?(id) -> { ok, error? } | false, back?() -> bool, frame?(now),
//   unmount?(), ...its API }. press: the actions it owns (OWNER below); false for one it doesn't know. back: Esc,
//   asked in BACK order (rec and review first); true when it closed something. frame: from the shell's one loop.
//
// The actions (the key table's, ./keys.js, and what app.liveRoom.press(id) takes), by owner:
//   here     'space' (by where you are: stop a take or the song, hear the take in review, else the drummer), 'back'
//            (Esc: BACK order, then the camera), 'glass' (⌘G: through to the control room), 'cam:<target>' (stage,
//            head, cab, kit, board, tuner, tape), 'shop' (through the door, and back), 'monitor' (M: hear yourself
//            through the rig, or not: input/audioin.js monitor, your decision for that input)
//
// The live path while the room is up (docs/research/AMP-PATH.md §8): the input's role is 'instrument' (audio.role), the
// monitor plays through monitorVia(() => the side a take records (gr.monitorSide) || Guitar L), asked at every sync so a
// song loaded or a track gone can't leave it pointing at nothing; any key or click wakes the audio context (audio.wake);
// the path's check speaks through the talkback (app.input.path.speaker: R.say by the house). R.remonitor() asks the
// monitor to follow gr.monitorSide now.
//   room     'stomp:<1-8>', 'slot:<n>' (focus a piece of gear), 'pedal:add' (the + pedal: the shop's case)
//   shop     'shop:wall', 'shop:case', 'shop:head', 'shop:cab', 'cat:prev', 'cat:next', 'save' (Save to rack: a button; ⌘S stays the studio's),
//            'rack' (the rack of saved stacks)
//   drummer  'drummer' (the jam on or off), 'tempo:<±n>', 'tap', 'beat:prev', 'beat:next', 'beat:<n>' (a card),
//            'countin' (⇧K)
//   start    'gs' (Getting started, again), 'gs:next', 'gs:skip', 'tuner' (U: the tuner pedal)
//   takes    'record', 'again', 'stop', 'keep', 'toss', 'side', 'hear', 'home', 'play', 'take:up', 'take:down',
//            'card:<section id>' | 'card:prev' | 'card:next', 'part:new', 'part:before', 'part:remove', 'part:left',
//            'part:right'
//   tape     'tape' (G), 'riff:keep', 'snap', 'riffs' (L: the drawer), 'library' (⇧L), 'talk' (/)

import { h, css } from '../../dom.js';
import { screens } from '../screens.js';
import { getDevice } from '../../../devices/registry.js';
import { createState } from './state.js';
import { createCamera } from './camera.js';
import { REGIONS, SHOP_REGIONS, STAGE, SHOP } from './layout.js';
import { installKeys } from './keys.js';
import { createRigBinding } from './bind.js';
import { rigTracks } from '../../../core/liveroom/guitar/rig.js';
import { gprefs } from './prefs.js';
import { CSS } from './style.js';
import * as room from './stage.js';
import * as shop from './shop.js';
import * as drummer from './drummer.js';
import * as start from './start.js';
import * as takes from './takes.js';
import * as tape from './tape.js';

export const ORDER = ['room', 'shop', 'drummer', 'start', 'takes', 'tape'];
const MODULES = { room, shop, drummer, start, takes, tape };
// Esc: who's asked first (a take before anything; then what's typed, what's open, the shop's corner)
export const BACK = ['takes', 'tape', 'start', 'shop', 'drummer', 'room'];
// an action's owner, by its id or its prefix (before ':')
export const OWNER = {
  stomp: 'room', slot: 'room', 'pedal:add': 'room',
  'shop:wall': 'shop', 'shop:case': 'shop', 'shop:head': 'shop', 'shop:cab': 'shop', 'cat:prev': 'shop', 'cat:next': 'shop', save: 'shop', rack: 'shop',
  drummer: 'drummer', tempo: 'drummer', tap: 'drummer', beat: 'drummer', countin: 'drummer',
  gs: 'start', 'gs:next': 'start', 'gs:skip': 'start', tuner: 'start',
  record: 'takes', again: 'takes', stop: 'takes', keep: 'takes', toss: 'takes', side: 'takes', hear: 'takes', home: 'takes', play: 'takes', take: 'takes', card: 'takes', part: 'takes',
  tape: 'tape', 'riff:keep': 'tape', snap: 'tape', riffs: 'tape', library: 'tape', talk: 'tape',
};
export const ownerOf = (id) => OWNER[id] || OWNER[String(id).split(':')[0]] || null;
// the camera's targets on the stage, by default (a stream re-registers its own with the drawn gear's boxes)
const pad = (r, l, t, rr, b) => ({ x: r.x - l, y: r.y - t, w: r.w + l + rr, h: r.h + t + b });
const STAGE_TARGETS = {
  head: { rect: () => ({ x: REGIONS.head.x - 30, y: REGIONS.meter.y - 10, w: REGIONS.head.w + 60, h: REGIONS.head.y + REGIONS.head.h - REGIONS.meter.y + 230 }), right: 340 },
  cab: { rect: () => pad(REGIONS.cab, 60, 30, 60, 26), right: 420 },
  kit: { rect: () => ({ x: REGIONS.kit.x + 16, y: REGIONS.kit.y + 16, w: REGIONS.kit.w - 40, h: REGIONS.riser.y + REGIONS.riser.h - REGIONS.kit.y }), right: 640, pad: 14 },
  board: { rect: () => pad(REGIONS.board, 0, 14, 0, 0), pad: 12, ay: 1 },
  tuner: { rect: () => pad(REGIONS.tuner, 50, 40, 50, 40), right: 380 },
  tape: { rect: () => pad(REGIONS.tape, 14, 12, 14, -112), bottom: 360, pad: 18 },
};
const SHOP_TARGETS = {
  wall: { rect: () => SHOP_REGIONS.wall, right: 480, pad: 14, ax: 1 },
  case: { rect: () => SHOP_REGIONS.case, right: 480, pad: 14, ax: 0 },
  'tryout-head': { rect: () => ({ x: SHOP_REGIONS.corner.x, y: SHOP_REGIONS.corner.y, w: SHOP_REGIONS.corner.w, h: 260 }), right: 340 },
  'tryout-cab': { rect: () => pad(SHOP_REGIONS.corner, 0, -200, 0, 0), right: 420 },
};
const STAGE_CAMS = ['stage', ...Object.keys(STAGE_TARGETS)];

function mountGuitar(el, ctx) {
  const { app, ui, store, deck } = ctx;
  css('gr', CSS);
  const L = ui.state.liveRoom;
  const gr = (L.gr = createState());
  const fns = new Map();
  const on = (evt, fn) => { if (!fns.has(evt)) fns.set(evt, new Set()); fns.get(evt).add(fn); return () => fns.get(evt)?.delete(fn); };
  const emit = (evt, d) => { for (const fn of fns.get(evt) || []) { try { fn(d); } catch (e) { console.error('guitar room listener', evt, e); } } };

  /* ------------------------------------------------------------------------------------------- the slots */
  const layer = (name) => h(`div.gr-layer.gr-${name}`);
  const stage = { world: h('div.gr-world', { dataset: { world: 'stage' }, 'aria-label': 'The stage' }), pixels: layer('pixels'), gear: layer('gear'), riser: layer('riser'), hot: layer('hot'), spot: layer('spot') };
  stage.world.append(stage.pixels, stage.gear, stage.riser, stage.hot, stage.spot);
  const shopEl = { world: h('div.gr-world', { dataset: { world: 'shop' }, 'aria-label': 'The shop', hidden: true }), pixels: layer('pixels'), wall: layer('wall'), case: layer('case'), corner: layer('corner'), hot: layer('hot') };
  shopEl.world.append(shopEl.pixels, shopEl.wall, shopEl.case, shopEl.corner, shopEl.hot);
  for (const [w, size] of [[stage.world, STAGE], [shopEl.world, SHOP]]) { w.style.width = size.w + 'px'; w.style.height = size.h + 'px'; }
  const panels = h('div.gr-panels');
  const sheets = h('div.gr-sheets');
  const drawer = { el: h('div.gr-drawer', { hidden: true }), tray: h('div.gr-tray'), parts: h('div.gr-parts') };
  drawer.el.append(drawer.tray, drawer.parts);
  const over = h('div.gr-over', { hidden: true });
  const callout = h('div.gr-callout', { hidden: true });
  const fade = h('div.gr-fade', { 'aria-hidden': 'true' });
  const view = h('div.gr-view', stage.world, shopEl.world, panels, sheets, drawer.el, callout, over, fade);
  const strip = { el: h('div.gr-strip'), talk: h('div.gr-strip-talk'), tools: h('div.gr-strip-tools') };
  strip.el.append(strip.talk, strip.tools);
  const root = h('div.gr', view, strip.el);
  el.append(root);
  // the header's slot (ui/liveroom/index.js), and the talkback in the strip (it goes home when the screen unmounts)
  const lrEl = el.closest('.lr');
  const tools = lrEl?.querySelector('.lr-tools') || h('span.lr-tools');
  const talkback = lrEl?.__lrTalkback || null;
  if (talkback?.el) strip.talk.append(talkback.el);

  /* ------------------------------------------------------------------------------------------- the camera */
  const camera = createCamera({ view, worlds: { stage: { el: stage.world, ...STAGE }, shop: { el: shopEl.world, ...SHOP } }, state: gr });
  for (const [id, t] of Object.entries(STAGE_TARGETS)) camera.target(id, { world: 'stage', ...t });
  for (const [id, t] of Object.entries(SHOP_TARGETS)) camera.target(id, { world: 'shop', ...t });
  const panelEls = new Map(), sheetEls = new Map();
  function panel(target) {
    if (!panelEls.has(target)) { const p = h('aside.gr-panel', { dataset: { target }, hidden: gr.cam !== target }); panels.append(p); panelEls.set(target, p); }
    return panelEls.get(target);
  }
  function sheet(id) {
    if (!sheetEls.has(id)) { const s = h('section.gr-sheet', { dataset: { sheet: id }, hidden: gr.overlay !== id }); sheets.append(s); sheetEls.set(id, s); }
    return sheetEls.get(id);
  }
  const offCam = camera.on('move', (d) => {
    for (const [t, p] of panelEls) p.hidden = t !== d.to;
    root.dataset.cam = d.to;
    root.dataset.world = d.world;
    emit('cam', d);
  });
  root.dataset.cam = gr.cam;
  root.dataset.world = gr.world;
  function overlay(id) {
    const was = gr.overlay;
    gr.overlay = id || null;
    for (const [s, x] of sheetEls) x.hidden = s !== gr.overlay;
    root.dataset.overlay = gr.overlay || '';
    if (was !== gr.overlay) emit('overlay', { id: gr.overlay, was });
    return gr.overlay;
  }
  function drawerOpen(open) {
    gr.drawer = open === undefined ? !gr.drawer : !!open;
    drawer.el.hidden = !gr.drawer;
    root.dataset.drawer = gr.drawer ? '1' : '';
    emit('drawer', { open: gr.drawer });
    return gr.drawer;
  }

  /* ------------------------------------------------------------------------------------------- the rig and the input */
  const busy = () => L.run === 'count' || L.run === 'take';
  const rig = createRigBinding({ store, getDevice, busy });
  const offRig = rig.on('change', (r) => emit('rig', r));
  // (monitoring plays through Guitar L while the room is up, as the stage did: a take on the other side moves it, the
  // takes stream's call, gr.monitorSide; asked at every sync; released when the screen goes)
  const audio = () => app.input?.audio || null;
  const monitorVia = () => gr.monitorSide || rigTracks(store.get())[0] || null;
  const monitorTo = () => { try { audio()?.monitorVia?.(monitorVia); } catch (e) { console.error('guitar room: monitorVia', e); } };
  try { audio()?.role?.('instrument'); } catch (e) { console.error('guitar room: the input', e); }
  monitorTo();
  // (the path's lines in the talkback, unsigned: the house's)
  try { app.input?.path?.speaker?.((line) => app.liveRoom?.say?.(line, { by: 'overdub' })); } catch (e) { console.error('guitar room: the path', e); }
  // any key or click in the room wakes the audio context (a browser may have paused it)
  const wake = () => { const a = audio(); if (a?.wake && a.ctx && a.ctx.state !== 'running') a.wake(); };
  root.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);

  /* ------------------------------------------------------------------------------------------- the router */
  const parts = { room: null, shop: null, drummer: null, start: null, takes: null, tape: null };
  const views = {};
  const result = (r) => (r == null || r === false ? null : r === true ? { ok: true } : r);
  function toPart(name, id) {
    const v = views[name];
    if (!v?.press) return { ok: false, error: `The ${name === 'room' ? 'stage' : name} isn’t built yet.` };
    let r;
    try { r = result(v.press(id)); } catch (e) { console.error('guitar room press', id, e); r = { ok: false, error: String(e?.message || e) }; }
    return r || { ok: false, error: `Nothing in the room is called ${id}.` };
  }
  function back() {
    for (const name of BACK) {
      const v = views[name];
      if (!v?.back) continue;
      try { if (v.back()) return { ok: true }; } catch (e) { console.error('guitar room back', name, e); }
    }
    if (camera.back()) return { ok: true };
    if (gr.world === 'shop') return { ok: camera.zoomTo('stage') };
    return { ok: false, error: 'You’re on the stage.' };
  }
  function space() {
    if (L.run === 'count' || L.run === 'take' || L.run === 'play') return toPart('takes', 'stop');
    if (gr.overlay === 'review') return toPart('takes', 'hear');
    return toPart('drummer', 'drummer');
  }
  function press(id) {
    let r;
    if (id === 'space') r = space();
    else if (id === 'back') r = back();
    else if (id === 'glass') r = busy() ? { ok: false, error: 'The control room is through the glass once the take is in.' } : (app.liveRoom.close(), { ok: true });
    else if (id === 'shop') r = { ok: gr.world === 'shop' ? camera.zoomTo('stage') : camera.zoomTo('wall') };
    else if (id === 'monitor') r = toggleMonitor();
    else if (typeof id === 'string' && id.startsWith('cam:')) {
      const t = id.slice(4);
      r = gr.world === 'stage' && STAGE_CAMS.includes(t) ? { ok: camera.zoomTo(t) } : { ok: false, error: 'The camera can’t go there from here.' };
    } else {
      const owner = ownerOf(id);
      r = owner ? toPart(owner, id) : { ok: false, error: `Nothing in the room is called ${id}.` };
    }
    emit('press', { id, ok: !!r?.ok });
    return r;
  }

  // M: monitoring on or off, by hand, for the input (opened first if it isn't: the room's way, openBest)
  function toggleMonitor() {
    const a = audio();
    if (!a) return { ok: false, error: 'There’s no input here.' };
    const on = a.monitor(!a.state.monitoring);
    if (on && !a.state.open) a.openBest?.({ role: 'instrument', capture: true })?.catch?.(() => {});
    emit('monitor', { on });
    return { ok: true };
  }

  /* ------------------------------------------------------------------------------------------- R, and the streams */
  const R = {
    app, ui, store, deck, lr: ctx, getDevice, gr, L, gprefs,
    el: { root, view, stage, shop: shopEl, panels, sheets, drawer, over, callout, strip, tools },
    camera, rig, panel, sheet, overlay, drawer: drawerOpen,
    say: (text, o = {}) => app.liveRoom?.say?.(text, o),
    remonitor: monitorTo,
    line: (id, vars) => ctx.say(id, vars),
    press,
    run: (next) => { if (next !== undefined) L.run = next; return L.run; },
    busy, on, emit, parts,
  };
  // (R on the screen's element too: the checks and a console reach the room through it)
  root.__gr = R;
  for (const name of ORDER) {
    try {
      const v = MODULES[name].mount(R) || {};
      views[name] = v;
      parts[name] = v;
    } catch (e) { console.error('guitar room: mounting', name, e); views[name] = {}; parts[name] = null; }
  }
  const offKeys = installKeys({ ui, gr: () => gr, run: () => L.run, live: () => !!L.open && L.screen === 'guitar', press: (id) => press(id) });
  camera.refit();

  return {
    press(id) {
      // (app.liveRoom.press: the room's own ids first; 'glass' falls through to the live room when the room isn't up)
      const r = press(id);
      return r && (r.ok || ownerOf(id) || /^(space|back|shop|monitor|cam:)/.test(id)) ? r : false;
    },
    where() {
      // (the camera's 'gs' target is Getting started's, ./start.js: the header reads it as that)
      const cam = gr.world === 'shop' ? 'The shop' : gr.cam === 'stage' ? 'The stage' : `The stage · ${{ head: 'the head', cab: 'the cab', kit: 'the drummer’s book', board: 'the board', tuner: 'the tuner', tape: 'the tape machine', gs: 'Getting started' }[gr.cam] || gr.cam}`;
      return `The metal club · ${cam}`;
    },
    frame(now) {
      for (const name of ORDER) {
        const v = views[name];
        if (!v?.frame) continue;
        try { v.frame(now); } catch (e) { console.error('guitar room frame', name, e); v.frame = null; }
      }
    },
    unmount() {
      offKeys();
      for (const name of [...ORDER].reverse()) { try { views[name]?.unmount?.(); } catch (e) { console.error('guitar room unmount', name, e); } }
      offCam(); offRig(); rig.dispose(); camera.dispose();
      try { app.input?.audio?.monitorVia?.(null); } catch { /* fine */ }
      try { app.input?.audio?.role?.(''); } catch { /* fine */ }
      try { app.input?.path?.speaker?.(null); } catch { /* fine */ }
      root.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
      tools.replaceChildren();
      fns.clear();
      delete root.__gr;
      delete L.gr;
    },
  };
}

screens.add({ id: 'guitar', mount: mountGuitar });
