// The live room [ui; stream C owns it after the foundation] (docs/research/LIVE-ROOM-MODE.md §2, §3, §9.6, §14): the
// room in front of the glass, a screen over the whole studio. This module is where the streams meet: the studio's
// Live room key (a panel in the top bar, whose frame is the room's), the overlay over an inert studio, one screen at a
// time from the registry (./screens.js; each screen module adds itself when it's imported, below), ui.state.liveRoom,
// the studio's single keys held while the room is open, and a plain talkback (./talkback.js).
//
// Frozen (§14.2):
//   default (app)      installs it, and opens it over the studio at load when main.js's door says so (app.door.side
//                      'room': ui/liveroom/door-decide.js)
//   app.liveRoom = {
//     isOpen()             the room is over the studio
//     busy()               a count, a take or a read is running (song-changing agent tools wait, §3.16)
//     open({ screen })     opens it on that screen: by default the stage when the song has a room, else the door
//     close()              through the glass, to the control room; the song isn't changed
//     say(text, { by })    a line in the talkback: the house's ('overdub', the default) unsigned, an agent's signed
//     selection()          { screen, card, side, menu }: what the room has selected (an agent acts on it)
//     press(id)            one of the room's actions by id, as its key or button presses it: the mounted screen's
//                          press(id) first, then the room's own ('glass'); -> { ok, error? }
//     on(evt, fn) -> off   'open', 'close', 'screen' ({ screen }), 'say' ({ text, by }), 'press' ({ id, ok })
//   }
//   screens            ./screens.js's registry, re-exported
//   a screen's ctx = { app, ui, store, deck, view(), say(lineId, vars), prefs, scene }
//       deck: ./deck.js createDeck(app), one per page. view(): core/liveroom/session.js readRoom of the song as it is
//       now. say(lineId, vars): a line of core/liveroom/lines/*.js by id, in the talkback (a once-only line is said once
//       per song: ./prefs.js said and mark); -> whether it was said. prefs: ./prefs.js. scene: the room's place's scene
//       (./pixels sceneOf).
//
// ui.state.liveRoom = { open, screen: 'door' | 'stage' | 'shelf' | 'send' | 'kitchen', card, menu, run: 'idle' | 'count'
//   | 'take' | 'learn' | 'play', side: 'L' | 'R' } (not ui.state.room, which is the Jam room's)
//
// While the room is open the studio under it is inert and doesn't paint (ui.covered = 'liveroom', ui/shell.js), focus
// stays in the room (ui.state.focus 'liveroom'), and the studio's keys are held, as on Start a song's stage: a screen
// adds its own in mount with ui.keys.add({ first: true, when, group: 'Live room' }), so they're tried before the holds
// and never held themselves. ⌘Z, ⇧⌘Z, ⌘Y, ⌘S, ⌘O, ? and ⇧Esc keep the studio's meaning. Opening the room closes
// Start a song's stage (a take played there stays in Takes). main.js sets data-room on <html> for a load that opens
// here, and app/style/app.css keeps the studio out of sight until the room has mounted, which clears it.

import { h, css } from '../dom.js';
import { screens } from './screens.js';
import { CSS } from './style.js';
import { createTalkback } from './talkback.js';
import { createDeck } from './deck.js';
import { prefs } from './prefs.js';
import { sceneOf } from './pixels/index.js';
import { readRoom } from '../../core/liveroom/session.js';
import { roomOf } from '../../core/liveroom/model.js';
import { LINES as SOUNDCHECK } from '../../core/liveroom/lines/soundcheck.js';
import { LINES as DOUBLE } from '../../core/liveroom/lines/double.js';
import { LINES as STAGE } from '../../core/liveroom/lines/stage.js';
import { LINES as GLASS } from '../../core/liveroom/lines/glass.js';
import { LINES as KITCHEN } from '../../core/liveroom/lines/kitchen.js';
import { LINES as DOOR } from '../../core/liveroom/lines/door.js';
import { LINES as SHELF } from '../../core/liveroom/lines/shelf.js';
// the screens, each adding itself to the registry
import './door.js';
import './stage.js';
import './kitchen.js';
import './shelf.js';
import './send.js';

export { screens };

const LINES = { ...SOUNDCHECK, ...DOUBLE, ...STAGE, ...GLASS, ...KITCHEN, ...DOOR, ...SHELF };
const BUSY = new Set(['count', 'take', 'learn']);

// The studio's keys the room holds while it's open: every key the studio declares (code and mods, in any mode) but
// these, which keep the studio's meaning on both sides of the glass: ⌘Z ⇧⌘Z ⌘Y (undo is one History), ⌘S ⌘O, ? (the
// keys) and ⇧Esc (all off). A key the studio doesn't declare is left undeclared.
const KEEP = new Set(['mod+KeyZ', 'mod+shift+KeyZ', 'mod+KeyY', 'mod+KeyS', 'mod+KeyO', 'shift+Slash', 'shift+Escape']);
const sig = (k) => `${k.mod ? k.mod + '+' : ''}${k.key}`;

export default function installLiveRoom(app) {
  const { ui, store } = app;
  css('liveroom', CSS);

  const L = (ui.state.liveRoom = { open: false, screen: null, card: null, menu: null, run: 'idle', side: 'L' });
  const fns = new Map();
  const emit = (t, d) => { for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('liveroom listener', t, e); } } };
  const on = (t, fn) => { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t)?.delete(fn); };

  const deck = createDeck(app);
  const talkback = createTalkback({ app });

  // the room's view of the song, read again after a change
  let viewed = null, stale = true;
  store.on('change', () => { stale = true; });
  const view = () => { if (stale || !viewed) { viewed = readRoom(store.get()); stale = false; } return viewed; };
  let sceneFor = null, scene = null;
  const sceneNow = () => { const pl = view().place || null; if (!scene || sceneFor !== pl) { sceneFor = pl; scene = sceneOf(pl); } return scene; };

  const say = (text, { by = 'overdub' } = {}) => {
    talkback.say(text, { by });
    emit('say', { text: String(text ?? ''), by });
  };
  // a line of the room's by id (core/liveroom/lines/*.js); a once-only one is said once per song
  function sayLine(id, vars = {}) {
    const line = Object.hasOwn(LINES, id) ? LINES[id] : null;
    if (!line || typeof line.text !== 'function') { console.warn(`overdub: the room has no line "${id}"`); return false; }
    const song = store.get();
    if (line.once && prefs.said(song, id)) return false;
    let text = '';
    try { text = String(line.text(vars || {}) ?? ''); } catch (e) { console.error('liveroom line', id, e); return false; }
    if (!text) return false;
    say(text);
    if (line.once) prefs.mark(song, id);
    return true;
  }
  const ctx = { app, ui, store, deck, view, say: sayLine, prefs, get scene() { return sceneNow(); } };

  /* ------------------------------------------------------------------------------------------- the overlay */
  let el = null, body = null, current = null, opener = null, focusWas = null, wasInert = null, watcher = null, openedOnce = false;
  // what's under the room: the page's other top elements but the toasts and a dialog (the keys sheet, ?, comes up over
  // the room and is the person's to use)
  const dialog = (c) => c.matches?.('[role=dialog], [aria-modal=true]');
  const under = () => [...document.body.children].filter((c) => c !== el && !c.classList.contains('ew-toasts') && !dialog(c));
  function holdUnder() {
    wasInert = new Map(under().map((c) => [c, c.inert]));
    for (const c of wasInert.keys()) c.inert = true;
    // (what comes in under it while it's up, a panel's pill or sheet, is held too)
    watcher = new MutationObserver((ms) => {
      for (const m of ms) for (const c of m.addedNodes) {
        if (c.nodeType !== 1 || c === el || wasInert.has(c) || c.classList.contains('ew-toasts') || dialog(c)) continue;
        wasInert.set(c, c.inert);
        c.inert = true;
      }
    });
    watcher.observe(document.body, { childList: true });
  }
  function releaseUnder() {
    watcher?.disconnect();
    watcher = null;
    for (const [c, was] of wasInert || []) c.inert = was;
    wasInert = null;
  }
  function build() {
    if (el) return;
    body = h('div.lr-body');
    // a region over an inert studio, as Start a song's stage is (not an aria-modal dialog: the shell leaves a modal's
    // keys to the modal, and the room's keys are ui.keys like everyone's)
    el = h('section.lr', { role: 'region', 'aria-label': 'The live room', tabindex: -1, hidden: true },
      h('header.lr-top',
        h('span.lr-brand.disp-s', 'Overdub'), h('span.lr-where', 'The live room'), h('span.lr-gap'),
        h('button.btn.btn-txt.lr-glass', { type: 'button', onclick: () => close() }, 'Control room →')),
      body, talkback.el);
    document.body.append(el);
  }
  function unmountScreen() {
    const was = current;
    current = null;
    if (was?.view?.unmount) { try { was.view.unmount(); } catch (e) { console.error('liveroom unmount', was.id, e); } }
    body?.replaceChildren();
  }
  function go(id) {
    const def = screens.get(id) || screens.get('door');
    unmountScreen();
    const box = h('div.lr-screen', { dataset: { screen: def ? def.id : id } });
    body.append(box);
    L.screen = def ? def.id : id;
    if (el) el.dataset.screen = L.screen;
    if (def) {
      try { current = { id: def.id, view: def.mount(box, ctx) || {} }; } catch (e) { console.error('liveroom mount', def.id, e); current = { id: def.id, view: {} }; }
    }
    emit('screen', { screen: L.screen });
  }
  function open({ screen = null } = {}) {
    build();
    const first = !L.open;
    if (first) {
      // Start a song's stage gives way (a take played there stays in Takes)
      if (app.start?.step) { try { app.start.close({ quiet: true }); } catch (e) { console.error('liveroom: closing Start a song', e); } }
      opener = document.activeElement;
      holdUnder();
      focusWas = ui.state.focus;
      ui.state.focus = 'liveroom';
      ui.covered = 'liveroom';
      hold(true);
      L.open = true;
      openedOnce = true;
      el.hidden = false;
      showKey();
    }
    const want = screen || (L.screen && !first ? L.screen : roomOf(store.get()) ? 'stage' : 'door');
    if (first || want !== L.screen || !current) go(want);
    delete document.documentElement.dataset.room;
    try { prefs.set({ side: 'room' }); } catch { /* storage: fine */ }
    if (first) {
      setTimeout(() => { if (L.open && el && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); }, 0);
      emit('open', { screen: L.screen });
    }
    return true;
  }
  function close() {
    if (!L.open) return false;
    unmountScreen();
    L.open = false;
    L.menu = null;
    el.hidden = true;
    unhold();
    releaseUnder();
    if (ui.covered === 'liveroom') ui.covered = null;
    if (ui.state.focus === 'liveroom') ui.state.focus = focusWas ?? null;
    delete document.documentElement.dataset.room;
    try { prefs.set({ side: 'control' }); } catch { /* storage: fine */ }
    try { if (opener?.isConnected) opener.focus({ preventScroll: true }); } catch { /* ok */ }
    opener = null;
    ui.fitTop?.(true);
    emit('close', {});
    return true;
  }
  function press(id) {
    let r = null;
    if (L.open && current?.view?.press) {
      try { r = current.view.press(id); } catch (e) { console.error('liveroom press', id, e); r = { ok: false, error: String(e?.message || e) }; }
    }
    if (r == null || r === false) {
      if (id === 'glass') r = L.open ? (close(), { ok: true }) : (open(), { ok: true });
      else r = { ok: false, error: L.open ? `Nothing in the room is called ${id}.` : 'The live room isn’t open.' };
    }
    if (r === true) r = { ok: true };
    emit('press', { id, ok: !!r.ok });
    return r;
  }

  /* ------------------------------------------------------------------------------------------- the panel and the loop */
  // The studio's Live room key, in the top bar before Song: on a song with a room, and for the rest of the page once
  // the room has been open. Registered when it's first needed, so a song with no room has the top bar it always had.
  let key = null, panelEl = null;
  const wanted = () => openedOnce || !!roomOf(store.get());
  function showKey() {
    if (!key && wanted()) {
      ui.panel({
        id: 'liveroom', region: 'top', title: 'Live room',
        mount(m) {
          panelEl = m;
          key = h('button.btn.lr-key', { type: 'button', title: 'Back to the live room', onclick: () => open() }, 'Live room');
          m.append(key);
          return { frame };
        },
      });
    }
    if (panelEl) { const show = wanted(); panelEl.hidden = !show; panelEl.style.display = show ? '' : 'none'; }
  }
  store.on('change', (e) => { if (e?.kind === 'load' || key || roomOf(store.get())) showKey(); });
  function frame(now) {
    if (!L.open) return;
    if (current?.view?.frame) {
      try { current.view.frame(now); } catch (e) { console.error('liveroom frame', current.id, e); current.view.frame = null; }
    }
    talkback.frame(now);
  }

  /* ------------------------------------------------------------------------------------------- the held keys */
  // Declared while the room is open, and only then: on opening, ahead of every key the studio has (its modes too), and
  // the screen's own come in ahead of them as it mounts (first: true, in the group 'Live room'); a room open while the
  // studio is still loading holds the later modules' keys at 'ready', behind every mode. A global key is held as one,
  // so it's held in a field too. (A dialog over the room, the keys sheet, keeps its keys: Esc closes it.)
  const isOpen = () => L.open;
  const holding = () => L.open && !document.querySelector('body > [aria-modal=true]:not(.ew-region)');
  const held = new Map();
  function hold(first) {
    const want = new Map();
    for (const k of ui.keys.list()) {
      const s = sig(k);
      if (k.group === 'Live room' || KEEP.has(s) || held.has(s)) continue;
      want.set(s, { key: k.key, mod: k.mod || null, global: !!k.global || !!want.get(s)?.global });
    }
    for (const [s, k] of want) held.set(s, ui.keys.add({ ...k, first, hidden: true, when: holding, run: () => {}, label: 'Held while the live room is open', group: 'Live room' }));
  }
  function unhold() { for (const off of held.values()) off(); held.clear(); }
  ui.on?.('ready', () => { if (L.open) hold(false); });

  app.liveRoom = {
    isOpen,
    busy: () => L.open && BUSY.has(L.run),
    open: (o) => open(o || {}),
    close,
    say,
    selection: () => ({ screen: L.open ? L.screen : null, card: L.card, side: L.side, menu: L.menu }),
    press,
    on,
  };

  showKey();
  if (app.door?.side === 'room') open({});
  return app.liveRoom;
}
