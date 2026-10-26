// The live room [ui; stream C owns it after the foundation] (docs/research/LIVE-ROOM-MODE.md §2, §3, §9.6, §14): the
// room in front of the glass, a screen over the whole studio. This module is where the streams meet: the studio's
// Live room key (a panel in the top bar, whose frame is the room's), the overlay over an inert studio, one screen at a
// time from the registry (./screens.js; each screen module adds itself when it's imported, below), ui.state.liveRoom,
// the studio's single keys held while the room is open, and a plain talkback (./talkback.js).
//
// Frozen (§14.2):
//   default (app)      installs it, and opens it over the studio at load when main.js's door says so (app.door.side
//                      'room': ui/liveroom/door-decide.js). Opened while the studio is still loading, the room covers it
//                      at once and mounts its screen when the studio is up (main.js's 'ready', after every module):
//                      a screen's mount always has the whole app, and every key the studio declares is held
//   app.liveRoom = {
//     isOpen()             the room is over the studio
//     busy()               a count, a take or a read is running (song-changing agent tools wait, §3.16)
//     open({ screen })     opens it on that screen: by default the stage when the song has a room, else the door
//     close()              through the glass, to the control room; the song isn't changed
//     say(text, { by })    a line in the talkback: the house's ('overdub', the default) unsigned, an agent's signed
//     selection()          { screen, card, side, menu }: what the room has selected (an agent acts on it)
//     press(id)            one of the room's actions by id, as its key or button presses it: the mounted screen's
//                          press(id) first, then the room's own ('glass'); -> { ok, error? }
//     on(evt, fn) -> off   'open' ({ screen }: the screen is up), 'close', 'screen' ({ screen }), 'say' ({ text, by }),
//                          'press' ({ id, ok })
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
import { roomOf, NAMES } from '../../core/liveroom/model.js';
import { pairAt, redoPair, learnAlone, snapshot, readBack, listWords } from './view.js';
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
  // (the stage moves the strip between the scene and the setlist, and opens it for typing to the agent)
  talkback.el.__lrTalkback = talkback;

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
  let whereEl = null;
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
    whereEl = h('span.lr-where', 'The live room');
    el = h('section.lr', { role: 'region', 'aria-label': 'The live room', tabindex: -1, hidden: true },
      h('header.lr-top',
        h('span.lr-brand.disp-s', 'Overdub'), whereEl, h('span.lr-gap'),
        h('button.btn.btn-txt.lr-shelf', { type: 'button', onclick: () => press('shelf') }, 'Shelf'),
        h('button.btn.btn-txt.lr-glass', { type: 'button', onclick: () => close() }, 'Control room →')),
      body, talkback.el);
    el.__lrTalkback = talkback;
    document.body.append(el);
  }
  function unmountScreen() {
    const was = current;
    current = null;
    if (was?.view?.unmount) { try { was.view.unmount(); } catch (e) { console.error('liveroom unmount', was.id, e); } }
    body?.replaceChildren();
    // (the talkback home again, wherever the screen had it)
    if (el && talkback.el.parentNode !== el) el.append(talkback.el);
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
  // Opening is two steps: covering the studio (at once) and entering, the screen mounted over it with the studio's
  // keys held. Before the studio is up the second waits for it, so the screen mounts once, with the song in and every
  // module installed. (asked: the screen open() was asked for; entered: this opening's screen is up)
  let up = document.documentElement.dataset.ready === '1', asked = null, entered = false;
  function open({ screen = null } = {}) {
    build();
    if (!L.open) {
      // Start a song's stage gives way (a take played there stays in Takes)
      if (app.start?.step) { try { app.start.close({ quiet: true }); } catch (e) { console.error('liveroom: closing Start a song', e); } }
      opener = document.activeElement;
      holdUnder();
      focusWas = ui.state.focus;
      ui.state.focus = 'liveroom';
      ui.covered = 'liveroom';
      L.open = true;
      entered = false;
      openedOnce = true;
      el.hidden = false;
      // (while the studio loads, the keys declared so far: entering holds them all)
      if (!up) hold();
      showKey();
      setTimeout(() => { if (L.open && el && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); }, 0);
    }
    if (screen) asked = screen;
    if (up) enter();
    return true;
  }
  function enter() {
    if (!L.open) return;
    const fresh = !entered;
    // (the holds again, over every key declared by now: the screen's own, added as it mounts, go before them)
    if (fresh) { unhold(); hold(); roomKeys(true); }
    const want = asked || (!fresh && current && L.screen) || (roomOf(store.get()) ? 'stage' : 'door');
    asked = null;
    if (fresh || want !== L.screen || !current) go(want);
    entered = true;
    delete document.documentElement.dataset.room;
    try { prefs.set({ side: 'room' }); } catch { /* storage: fine */ }
    if (fresh) { emit('open', { screen: L.screen }); sayBack(); }
  }
  // (after every 'ready' listener has run: the keys they declare are held too)
  ui.on?.('ready', () => queueMicrotask(() => { up = true; enter(); }));
  function close() {
    if (!L.open) return false;
    unmountScreen();
    L.open = false;
    L.menu = null;
    entered = false;
    asked = null;
    el.hidden = true;
    unhold();
    roomKeys(false);
    try { left = { snap: snapshot(store.get()), at: store.history.length, top: store.history.at(-1)?.id || null }; } catch (e) { console.error('liveroom: the snapshot', e); left = null; }
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
      else if (id === 'shelf' && L.open && screens.has('shelf')) r = (open({ screen: 'shelf' }), { ok: true });
      else r = { ok: false, error: L.open ? `Nothing in the room is called ${id}.` : 'The live room isn’t open.' };
    }
    if (r === true) r = { ok: true };
    emit('press', { id, ok: !!r.ok });
    return r;
  }

  /* ------------------------------------------------------------------------------------------- the panel and the loop */
  // The studio's Live room key, in the top bar before Song: on a song with a room, and for the rest of the page once
  // the room has been open. Registered when it's first needed, so a song with no room has the top bar it always had.
  let key = null, panelEl = null, studioG = null;
  const wanted = () => openedOnce || !!roomOf(store.get());
  function showKey() {
    if (!key && wanted() && !studioG) {
      // G in the studio: back through the glass (a View key, there only once the Live room key is)
      studioG = ui.keys.add({ key: 'KeyG', run: () => open(), when: () => !L.open && wanted() && !ui.covered, label: 'The live room', group: 'View' });
    }
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
    if (whereEl) {
      const pl = view().place, t = pl && NAMES.place[pl] ? `The live room · ${NAMES.place[pl][0].toUpperCase()}${NAMES.place[pl].slice(1)}` : 'The live room';
      if (whereEl.textContent !== t) whereEl.textContent = t;
    }
    if (current?.view?.frame) {
      try { current.view.frame(now); } catch (e) { console.error('liveroom frame', current.id, e); current.view.frame = null; }
    }
    talkback.frame(now);
  }

  /* ------------------------------------------------------------------------------------------- the held keys */
  // Declared while the room is open, and only then: ahead of every key the studio has (its modes too), and the
  // screen's own come in ahead of them as it mounts (first: true, in the group 'Live room'). A global key is held as
  // one, so it's held in a field too. (A dialog over the room, the keys sheet, keeps its keys: Esc closes it.)
  const isOpen = () => L.open;
  const holding = () => L.open && !document.querySelector('body > [aria-modal=true]:not(.ew-region)');
  const held = new Map();
  function hold() {
    const want = new Map();
    for (const k of ui.keys.list()) {
      const s = sig(k);
      if (k.group === 'Live room' || KEEP.has(s) || held.has(s)) continue;
      want.set(s, { key: k.key, mod: k.mod || null, global: !!k.global || !!want.get(s)?.global });
    }
    for (const [s, k] of want) held.set(s, ui.keys.add({ ...k, first: true, hidden: true, when: holding, run: () => {}, label: 'Held while the live room is open', group: 'Live room' }));
  }
  function unhold() { for (const off of held.values()) off(); held.clear(); }

  /* ------------------------------------------------------------------------------------------- the room's own keys */
  // Declared while the room is open (in the group 'Live room', first): G back through the glass, and ⌘Z ⇧⌘Z where one
  // press is a take and the band's learning of it (§7.3). Their when() is true only then, so ⌘Z and ⇧⌘Z keep the
  // studio's meaning everywhere else.
  let roomOffs = [];
  const free = () => L.open && !document.querySelector('body > [aria-modal=true]:not(.ew-region)');
  const partName = (s) => (store.get().sections || []).find((x) => x.id === s)?.name || 'part';
  const takeNo = (label) => { const m = /take (\d+)/i.exec(String(label || '')); return m ? Number(m[1]) : 1; };
  function roomKeys(on) {
    for (const o of roomOffs) o();
    roomOffs = [];
    if (!on) return;
    const k = (o) => roomOffs.push(ui.keys.add({ first: true, group: 'Live room', ...o }));
    k({ key: 'KeyG', when: free, run: () => press('glass'), label: 'Through the glass, to the control room' });
    k({
      key: 'KeyZ', mod: 'mod', label: 'Undo the take and the band’s learning together',
      when: () => free() && !!(pairAt(store.history) || learnAlone(store.history)),
      run: () => {
        const pr = pairAt(store.history);
        if (pr) {
          const part = partName(pr.section), n = takeNo(pr.take.label);
          const a = store.undo();
          const b = a.ok ? store.undo() : a;
          if (b.ok) sayLine('undo.pair', { part, take: n, back: n > 1 ? n - 1 : null });
          return;
        }
        const al = learnAlone(store.history);
        const part = al ? partName(al.section) : '';
        if (al && store.undo().ok) sayLine('undo.alone', { part });
      },
    });
    const redoIt = () => {
      const pr = redoPair(store.redoable);
      if (!pr) return;
      const a = store.redo();
      const b = a.ok ? store.redo() : a;
      if (b.ok) sayLine('redo.pair', { part: partName(pr.section), take: takeNo(pr.take.label) });
    };
    k({ key: 'KeyZ', mod: 'mod+shift', label: 'Redo the take and the band’s learning together', when: () => free() && !!redoPair(store.redoable), run: redoIt });
    k({ key: 'KeyY', mod: 'mod', label: 'Redo the take and the band’s learning together', when: () => free() && !!redoPair(store.redoable), run: redoIt });
  }

  /* ------------------------------------------------------------------------------------------- the read-back */
  // Coming back through the glass, the room reads the song and History since it was left and says what changed in
  // one line (§3.15, §7.5), signed when an agent made all of it; a once-only line is said once per song.
  let left = null;
  function sayBack() {
    const was = left;
    left = null;
    if (!was || !was.snap?.room) return;
    const steps = store.history.slice(Math.max(0, store.history.findIndex((t) => t.id === was.top) + 1));
    if (was.top == null) steps.splice(0, steps.length, ...store.history);
    if (!steps.length) return;
    let back;
    try { back = readBack(was.snap, store.get(), steps); } catch (e) { console.error('liveroom: the read-back', e); return; }
    const song = store.get();
    const fresh = back.changes.filter((c) => !(c.kind === 'level' || c.kind === 'track') || !prefs.said(song, c.id.slice(0, 64)));
    if (fresh.length) {
      const bys = [...new Set(fresh.map((c) => c.by))];
      const by = bys.length === 1 && bys[0] !== 'you' && bys[0] !== 'overdub' ? bys[0] : 'overdub';
      const words = listWords(fresh.slice(0, 3).map((c) => c.text)) + (fresh.length > 3 ? `, and ${fresh.length - 3} more` : '');
      const line = LINES['glass.back'];
      say(line.text({ changes: words }), { by });
      for (const c of fresh) if (c.kind === 'level' || c.kind === 'track') { try { prefs.mark(song, c.id.slice(0, 64)); } catch { /* fine */ } }
    }
    // (a tempo or a meter that moved is said once per song, and then it's the line: it says more than the list)
    if (back.tempo) sayLine('glass.tempo', back.tempo);
    else if (back.meter) sayLine('glass.meter', back.meter);
  }

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
