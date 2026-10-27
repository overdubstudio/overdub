// Getting started, and the tuner [ui; the guitar room's START stream] (docs/research/GUITAR-ROOM.md §2.1, §2.10;
// design/mock/guitar-room-2/ shots 01a-01k and 03f; AJ: "onboarding happening in the room").
//
// Getting started walks you in on the stage itself, on the gauges (ui/gauges/{level,tuner,timing}.js): the camera goes
// to what each step is about, the engineer's slate stands beside it (R.el.callout, never over it), and a pool of light
// lands on it (R.el.stage.spot) while the rest of the stage dims. The steps (./start-plan.js STEPS):
//   1. Plug in   the input opened (the one you used last, else your interface), the channel that moves on the first
//                strum picked (audioin pickChannel; or press one), the meter against the −12 to −6 dBFS window and what
//                to do with the interface's gain (input/level.js); the jack on the board lights
//   2. Tune      the Tuna Fork pedal, first on the board (./start-tuner.js): stomp it (its footswitch, or U) and the
//                camera goes to it, you're muted (audio.monitor(false), put back as it was when it goes off), each
//                string of the tuning lights as it comes in, and a low string that isn't in the tuning asks which
//                tuning it is (a song tuning is one step by you: room.set { tuning } and the guitars' low cut)
//   3. Timing    eight clicks to strum along to, the round trip measured and kept for the interface (input/calibrate.js)
//   4. Your sound   the stack on the stage, keep it or go through the door to the shop
//   5. The tour  the amp, the cab, the board, the drummer, the tape, the shop's door, the strip
// It comes up by itself once (the first time the room opens in a visitor's browser, gprefs gs.done false and no step
// begun); every step is skippable; Esc pauses it where it is (the header's Getting started button carries on); the
// button opens it again any time. While it's up, the room's keys are the 'gs' context's (./keys.js): Enter is the
// slate's primary button, U the tuner, 1-8 stomp, Space the drummer, Esc pauses.
//
// The tuner pedal is the room's own (not a device in the song), so this stream draws it, at the place the room keeps
// for it on the board (R.parts.room.rect('tuner')), in R.el.stage.spot under the spotlight's dimming; its zoom's side
// panel is R.panel('tuner'). The tuner never leaves you muted: off, unmounted, a take starting, or Getting started
// closing, the monitor goes back to what it was.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'gs', 'gs:next', 'gs:skip', 'tuner'
//     back() -> bool                          Esc: the tuner off (it mutes you); else Getting started paused
//     frame(now), unmount()
//     open(step?) -> void                     Getting started from a step ('plug' | 'tune' | 'time' | 'sound' | 'tour')
//     done() -> bool                          finished or skipped (R.gprefs.get().gs.done)
//     tuner(on?) -> bool                      the tuner pedal on or off (no arg: flip); on mutes the monitor
//   }
// Added (this stream's API, for the others and the checks):
//     isOpen() -> bool                        Getting started is up
//     step() -> step id | null                the step it's on
//     pedal() -> Element                      the Tuna Fork pedal (the room's el('tuner') may hand it on)
//     close({ done }) -> void                 put it away (done: as finished)
// Bus events: 'start:gs' { step } (step null: closed), 'start:tuner' { on }, 'start:plug' { in: true } (the cable
// went in: the room may draw the plug home).

import { h, css } from '../../dom.js';
import { mountLevel } from '../../gauges/level.js';
import { mountTiming } from '../../gauges/timing.js';
import { pickChannel, inputKind } from '../../../input/audioin.js';
import { TUNER_TUNINGS, tuningName, tuningOf } from '../../../input/tuner.js';
import { TUNINGS } from '../../../core/fretboard.js';
import { roomOf } from '../../../core/liveroom/model.js';
import { lowCut } from '../../../core/liveroom/places.js';
import { REGIONS } from './layout.js';
import { STEPS, stepAfter, TOUR, shotOf, W, tuningLabel, soundSays, plugSays, strumsWord } from './start-plan.js';
import { createTunaFork, createTunerPanel } from './start-tuner.js';
import { CSS } from './start-style.js';

const SLATE_W = 380;
const GUITARS = ['guitarL', 'guitarR', 'guitar', 'lead'];
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const visitor = () => { try { return !navigator.webdriver; } catch { return true; } };

export function mount(R) {
  css('gr-start', CSS);
  const { app, store, gr, gprefs } = R;
  const audio = () => app.input?.audio || null;
  const room = () => R.parts.room || null;
  const rect = (name) => { try { return room()?.rect?.(name) || (REGIONS[name] ? { ...REGIONS[name] } : null); } catch { return REGIONS[name] ? { ...REGIONS[name] } : null; } };
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let gone = false;

  /* ------------------------------------------------------------------------------------------- the tuning */
  // the tuner reads the tuning you picked on it (gprefs), else the song's (room.tuning), else standard
  const songTuning = () => roomOf(store.get())?.tuning || null;
  const tuningId = () => { const g = gprefs.get().tuning; return (g && TUNER_TUNINGS[g] ? g : null) || (TUNER_TUNINGS[songTuning()] ? songTuning() : null) || 'standard'; };
  const tuningWords = () => tuningName(tuningOf(tuningId()));
  function chooseTuning(id) {
    if (!TUNER_TUNINGS[id]) return { ok: false, error: `There’s no tuning called ${id}.` };
    const p = store.get(), rm = roomOf(p);
    if (TUNINGS[id] && rm) {
      // a tuning the song knows is the song's: one step by you (the guitars' low cut follows it)
      gprefs.set({ tuning: null });
      if (rm.tuning !== id) {
        const ops = [{ type: 'room.set', patch: { tuning: id } }];
        const hz = lowCut(id);
        for (const role of GUITARS) {
          const t = (p.tracks || []).find((x) => x.id === rm.tracks?.[role]);
          const eq = t?.inserts?.find((fx) => fx.device === 'core.eq8' && fx.params?.b1_on);
          if (eq && eq.params.b1_freq !== hz) ops.push({ type: 'insert.set', track: t.id, insert: eq.id, patch: { params: { b1_freq: hz } } });
        }
        const r = store.dispatch(ops, { by: 'you', label: `Tuned to ${tuningLabel(tuningName(TUNER_TUNINGS[id]))}`, reason: 'room:tuning' });
        if (!r.ok) return { ok: false, error: r.error };
      }
    } else gprefs.set({ tuning: id });
    panel?.setTuning(tuningId());
    R.say(W.sayTuned(tuningName(TUNER_TUNINGS[id])));
    if (G.step) paintSlate();
    return { ok: true };
  }

  /* ------------------------------------------------------------------------------------------- the tuner pedal */
  const pedal = createTunaFork({ onStomp: () => R.press('tuner') });
  const ring = h('div.gr-gs-ring', { hidden: true, 'aria-hidden': 'true' });
  const dim = h('div.gr-gs-dim', { hidden: true, 'aria-hidden': 'true' });
  const pools = h('div', { 'aria-hidden': 'true', style: 'position:absolute;inset:0;pointer-events:none' });
  R.el.stage.spot.append(pedal.el, ring, dim, pools);
  let placeAt = -1e9;
  const placePedal = (now = 0) => { if (now - placeAt < 400) return; placeAt = now; pedal.place(rect('tuner')); const j = rect('jack'); if (j) Object.assign(ring.style, { left: `${j.x + j.w - 22}px`, top: `${j.y + j.h / 2 - 14}px`, width: '28px', height: '28px' }); };
  placePedal();

  let panel = null;
  const panelEl = R.panel('tuner');
  function ensurePanel() {
    if (panel) return panel;
    panel = createTunerPanel(panelEl, {
      source: audio(), tuning: tuningId(), style: gprefs.get().tunerStyle,
      onStomp: () => R.press('tuner'),
      onTuning: (id) => chooseTuning(id),
      onStyle: (s) => { gprefs.set({ tunerStyle: s }); panel?.setStyle(s); },
      on: () => gr.tuner.on,
      input: () => !!audio()?.state.open,
    });
    return panel;
  }
  // the camera's tuner target: the pedal as it's drawn, the slate's room kept on the left while Getting started is up
  let offTarget = null;
  const tunerTarget = () => {
    offTarget?.();
    offTarget = R.camera.target('tuner', { world: 'stage', rect: () => { const t = rect('tuner'); return t ? { x: t.x - 50, y: t.y - 40, w: t.w + 100, h: t.h + 80 } : REGIONS.tuner; }, right: 380, left: G.step ? SLATE_W + 24 : 0 });
  };

  // the monitor: muted while the tuner's on, put back as it was when it goes off
  // (monitorWas is true once the tuner has turned monitoring off, and only then: an input that wasn't open yet, or
  // failed to open, when the tuner came on and turns monitoring on by itself later is muted and still put back)
  function mute() {
    const a = audio();
    if (!a || !gr.tuner.on || !a.state.open || !a.state.monitoring) return;
    gr.tuner.monitorWas = true;
    try { a.monitor(false); } catch (e) { console.error('the tuner: mute', e); }
  }
  function unmute() {
    const a = audio(), was = gr.tuner.monitorWas;
    gr.tuner.monitorWas = null;
    if (a && was && !a.state.monitoring) { try { a.monitor(true); } catch (e) { console.error('the tuner: unmute', e); } }
    return !!was;
  }
  function tuner(on, { quiet = false, camera = true } = {}) {
    const want = on === undefined ? !gr.tuner.on : !!on;
    if (want === gr.tuner.on) return gr.tuner.on;
    if (want) {
      if (R.busy()) { if (!quiet) R.say(W.sayTunerWaits); return false; }
      gr.tuner.on = true;
      gr.tuner.monitorWas = null;
      ensurePanel().resetDone();
      const a = audio();
      // (the input first, then the mute: a mute before it opens would be the next input's decision, and kept)
      if (a?.state.open) mute();
      else if (a) openInput().then(() => mute());
      if (camera && gr.world === 'stage' && gr.cam !== 'tuner') R.camera.zoomTo('tuner');
      if (!quiet) R.say(W.sayTunerOn);
    } else {
      gr.tuner.on = false;
      const was = unmute();
      if (G.step === 'tune') G.tuned = true;
      if (camera && gr.cam === 'tuner') { if (G.step) gsCam(); else R.camera.back(); }
      if (!quiet) R.say(was ? W.sayTunerOff : W.sayTunerOffQuiet);
    }
    pedal.update(null, { on: gr.tuner.on, input: !!audio()?.state.open });
    R.emit('start:tuner', { on: gr.tuner.on });
    if (G.step) paintSlate();
    return gr.tuner.on;
  }

  /* ------------------------------------------------------------------------------------------- the input */
  let opening = null;
  async function chooseDevice() {
    const a = audio();
    const list = await a.devices().catch(() => []);
    if (a.state.deviceId && list.some((d) => d.id === a.state.deviceId)) return { device: a.state.deviceId, channel: a.state.channel || '1' };
    // (an interface by its own id, not the browser's "Default - …" entry: monitoring starts by itself only for one you
    // picked, ./input/audioin.js)
    const kinds = list.map((d) => ({ d, k: inputKind(d.label, { isDefault: d.id === 'default' }) }));
    const iface = kinds.find((x) => x.k === 'interface' && x.d.id !== 'default') || kinds.find((x) => x.k === 'interface');
    return { device: iface ? iface.d.id : a.state.deviceId || '', channel: a.state.channel || '1' };
  }
  function openInput({ device = null, channel = null } = {}) {
    const a = audio();
    if (!a) return Promise.resolve(false);
    if (opening) return opening;
    G.err = '';
    opening = (async () => {
      try {
        const want = device != null ? { device, channel: channel || '1' } : await chooseDevice();
        await a.open({ device: want.device, channel: want.channel, capture: true });
        if (gone) return false;
        G.openedAt = performance.now(); G.picked = a.state.channels < 2 ? 1 : null; G.byHand = false; G.holds = []; G.together = 0;
        G.devices = await a.devices().catch(() => []);
        level?.reset?.();
        level?.setDevice?.(a.state.label);
        R.emit('start:plug', { in: true });
        if (G.step === 'plug') {
          G.close = true;
          ring.hidden = false; ring.classList.remove('gr-pulse'); void ring.offsetWidth; ring.classList.add('gr-pulse');
          R.say(W.sayPlugged(where()));
          gsCam();
          later(() => { if (G.step === 'plug') { G.close = false; gsCam(); } }, reducedMotion() ? 400 : 1700);
        }
        return true;
      } catch (e) {
        G.err = String(a.state.error || e?.message || e);
        return false;
      } finally {
        opening = null;
        if (G.step && !gone) paintSlate();
      }
    })();
    if (G.step) paintSlate();
    return opening;
  }
  const where = () => { const a = audio()?.state; return a ? `${a.label || 'The input'}${a.channels >= 2 ? `, input ${a.channel}` : ''}` : 'The input'; };
  // the channel that moves on the first strum (an interface's other inputs quiet), as the live room's lamps picked it
  function pickFrame(now) {
    const a = audio();
    if (!a?.state.open || G.picked || G.byHand) return;
    let lv = [];
    try { lv = a.levels(); } catch { lv = []; }
    if (lv.length < 2) { G.picked = +a.state.channel || 1; return; }
    G.holds.push({ t: now, v: lv.map((x) => x.db) });
    while (G.holds.length && G.holds[0].t < now - 500) G.holds.shift();
    const hold = lv.map((_, i) => Math.max(...G.holds.map((x) => x.v[i] ?? -Infinity)));
    let ch = pickChannel(hold);
    const top = Math.max(...hold);
    if (!ch && top >= -50) { if (!G.together) G.together = now; else if (now - G.together >= 1000) ch = hold.indexOf(top) + 1; } else if (!ch) G.together = 0;
    if (!ch) return;
    G.picked = ch;
    if (String(a.state.channel) !== String(ch)) { a.useChannel(ch); level?.reset?.(); if (lv.length >= 2) R.say(W.sayInput(ch)); }
    if (G.step === 'plug') paintSlate();
  }

  /* ------------------------------------------------------------------------------------------- Getting started */
  // (the session's own: what the slate shows; the step itself is gr.gs.step, and gprefs gs remembers it)
  const G = { step: null, tour: 0, close: false, tuned: false, err: '', openedAt: 0, picked: null, byHand: false, holds: [], together: 0, devices: [], side: 'right' };
  let level = null, timing = null, slateKey = '', goNow = null;
  const callout = R.el.callout;
  callout.classList.add('gr-co');
  callout.setAttribute('role', 'dialog');
  callout.setAttribute('aria-label', 'Getting started');

  function unmountGauges() {
    try { level?.unmount(); } catch { /* gone */ }
    try { timing?.stop(); timing?.unmount(); } catch { /* gone */ }
    level = null; timing = null;
  }
  const btn = (label, onclick, { go = false, kbd = '', cls = '', disabled = false } = {}) => h('button.gr-co-b' + (go ? '.go' : '') + (cls ? '.' + cls : ''), { type: 'button', onclick, disabled: disabled || null }, label, kbd ? h('kbd', kbd) : null);
  const skipBtn = () => btn(G.step === 'tour' ? 'End the tour' : 'Skip', () => R.press('gs:skip'), { cls: 'gr-co-skip' });

  function rigWords() {
    const rg = R.rig.now();
    const nameOf = (d) => R.getDevice(d)?.name || '';
    const amp = rg?.amp ? nameOf(rg.amp.device) : '';
    let cab = '';
    try { const d = R.getDevice(rg.amp.device), p = d?.params?.find((x) => x.key === 'cab'), v = Math.round(rg.amp.params?.cab ?? p?.def ?? -1); cab = p?.opts?.[v] || ''; if (/^(own|none|the amp’s own)/i.test(cab)) cab = ''; } catch { cab = ''; }
    const pedals = (rg?.board || []).filter((s) => s.on && (rg.amp ? s.slot < rg.amp.slot : true)).map((s) => { const d = R.getDevice(s.device); const k = String(d?.kindLabel || '').toLowerCase(); return k ? `a ${k}` : d?.name || ''; });
    const st = roomOf(store.get())?.stack;
    return { stack: st?.name ? (/^the /i.test(st.name) ? st.name[0].toLowerCase() + st.name.slice(1) : st.name) : 'your stack', amp, cab, pedals };
  }

  // the slate: drawn again when what it says changes (the gauges in it move by themselves, in frame)
  function paintSlate() {
    if (!G.step) { callout.hidden = true; return; }
    const a = audio(), open = !!a?.state.open, step = G.step, idx = STEPS.findIndex((s) => s.id === step);
    const key = JSON.stringify([step, G.tour, open, a?.state.label, a?.state.channel, a?.state.channels, G.picked, G.err, gr.tuner.on, G.tuned, G.devices.length, opening ? 1 : 0, tuningId(), G.side]);
    if (key === slateKey && callout.childNodes.length) return;
    slateKey = key;
    const keep = new Set();
    const steps = h('ol.gr-co-steps', { 'aria-label': 'Getting started' }, STEPS.map((s, i) => h('li' + (i < idx ? '.done' : i === idx ? '.now' : ''), { 'aria-current': i === idx ? 'step' : null }, h('i'), s.label)));
    let body = [];
    goNow = null;
    if (step === 'plug') {
      const pick = h('div.gr-co-chips', { role: 'group', 'aria-label': 'Interface' }, G.devices.length > 1 ? G.devices.map((d) => h('button.gr-co-chip', { type: 'button', 'aria-pressed': String(d.id === a.state.deviceId), title: d.label, onclick: () => openInput({ device: d.id, channel: '1' }) }, d.label)) : null);
      if (!open) {
        goNow = () => openInput();
        body = [h('h2', 'Plug in'), h('p', plugSays({ open: false })), G.err ? h('p.gr-co-v', G.err) : null,
          h('div.gr-co-acts', btn(opening ? 'Opening…' : 'Plug in', goNow, { go: true, kbd: 'Enter', disabled: !!opening }), skipBtn())];
      } else {
        goNow = () => next();
        const gauge = h('div.gr-co-gauge');
        keep.add('level');
        body = [h('h2', 'Plug in'), h('p.gr-co-from', plugSays({ open: true, label: a.state.label, input: +a.state.channel || null, channels: a.state.channels })), h('p', W.plugIn), gauge,
          h('p.gr-co-small', W.plugKnob), G.devices.length > 1 ? pick : null,
          h('div.gr-co-acts', btn('Next: tune', () => next(), { go: true, kbd: 'Enter', cls: 'gr-co-next' }), skipBtn())];
        // (the meter, kept across paints: it listens over seconds)
        if (!level) level = mountLevel(gauge, { source: a, device: a.state.label, onPickChannel: (ch) => { G.byHand = true; G.picked = ch; a.useChannel(ch); level?.reset(); paintSlate(); } });
        else gauge.append(level.el);
      }
    } else if (step === 'tune') {
      const t = tuningWords(), T = tuningOf(tuningId()), n = panel?.done.size || 0;
      if (G.tuned && !gr.tuner.on) {
        goNow = () => next();
        body = [h('h2', 'Tune'), h('p', n ? W.tuneDone(strumsWord(n, T.strings.length), t) : W.tuneNone(t)),
          n ? h('div.gr-co-strings', T.strings.map((m, i) => h('span' + (panel?.done.has(i) ? '.ok' : ''), String(TUNER_TUNINGS[tuningId()]?.notes?.split(' ')[i] || ''), h('small', String(T.strings.length - i))))) : null,
          h('div.gr-co-acts', btn('Next: timing', goNow, { go: true, kbd: 'Enter' }), btn('Stomp it again', () => R.press('tuner'), { kbd: 'U' }), skipBtn())];
      } else if (gr.tuner.on) {
        goNow = () => R.press('tuner');
        body = [h('h2', 'Tune'), h('p', W.tuneOn), h('div.gr-co-acts', btn('Stomp it off', goNow, { go: true, kbd: 'U' }), skipBtn())];
      } else {
        goNow = () => R.press('tuner');
        body = [h('h2', 'Tune'), h('p', W.tuneAsk(t)), h('div.gr-co-acts', btn('Stomp the tuner', goNow, { go: true, kbd: 'U' }), skipBtn())];
      }
    } else if (step === 'time') {
      if (!open) {
        goNow = () => openInput();
        body = [h('h2', 'Timing'), h('p', W.timeClosed), h('div.gr-co-acts', btn('Plug in', goNow, { go: true, kbd: 'Enter' }), skipBtn())];
      } else {
        keep.add('timing');
        const gauge = h('div.gr-co-gauge');
        goNow = () => { const st = timing?.cal.state; if (st && (st.phase === 'done' || st.kept || st.measured) && st.phase !== 'listening') next(); else if (st && st.phase !== 'listening') timing.start(); };
        body = [h('h2', 'Timing'), h('p', W.timeAsk), gauge, h('div.gr-co-acts', btn('Next: your sound', () => next(), { go: true, kbd: 'Enter', cls: 'gr-co-next' }), skipBtn())];
        if (!timing) timing = mountTiming(gauge, { latency: a.latency, label: () => where() });
        else gauge.append(timing.el);
      }
    } else if (step === 'sound') {
      goNow = () => next();
      body = [h('h2', 'Your sound'), h('p', soundSays(rigWords())), h('p', W.soundMore),
        h('div.gr-co-acts.one', btn('Keep this one', goNow, { go: true, kbd: 'Enter' }), btn('Through the door', () => toShop()), skipBtn())];
    } else if (step === 'tour') {
      const s = TOUR[G.tour];
      goNow = () => next();
      const amp = (() => { const rg = R.rig.now(); return rg?.amp ? R.getDevice(rg.amp.device)?.name || '' : ''; })();
      body = [h('h2', s.title), h('p', s.text({ amp })), h('p.gr-co-small', `${G.tour + 1} of ${TOUR.length}`),
        h('div.gr-co-acts', G.tour > 0 ? btn('Back', () => { G.tour--; gr.gs.tour = G.tour; paintSlate(); gsCam(); }) : null, btn(G.tour === TOUR.length - 1 ? 'Done' : 'Next', goNow, { go: true, kbd: 'Enter' }), skipBtn())];
    }
    if (!keep.has('level') && level) { try { level.unmount(); } catch { /* gone */ } level = null; }
    if (!keep.has('timing') && timing) { try { timing.stop(); timing.unmount(); } catch { /* gone */ } timing = null; }
    const esc = h('p.gr-co-esc', h('kbd', 'Esc'), ' ', W.esc);
    // (the gauges' elements move into the new slate: replaceChildren would take them out with the old one first)
    const lvEl = level?.el, tmEl = timing?.el;
    callout.replaceChildren(steps, ...body.filter(Boolean), esc);
    if (lvEl && !lvEl.isConnected) callout.querySelector('.gr-co-gauge')?.append(lvEl);
    if (tmEl && !tmEl.isConnected) callout.querySelector('.gr-co-gauge')?.append(tmEl);
    callout.dataset.side = gr.cam === 'tuner' ? 'left' : G.side;
    callout.dataset.step = step;
    callout.hidden = false;
  }

  // the camera for a step: the shot's rect, the slate's side kept clear
  let offGs = null;
  function gsCam() {
    if (!G.step || gr.world !== 'stage') return;
    const shot = shotOf(G.step, { rect, tour: G.tour, close: G.close });
    G.side = shot.side;
    const top = shot.side === 'top' ? (callout.offsetHeight || 200) + 24 : 0;
    offGs?.();
    offGs = R.camera.target('gs', { world: 'stage', rect: () => shot.R, right: shot.side === 'right' ? SLATE_W + 24 : 0, left: shot.side === 'left' ? SLATE_W + 24 : 0, top, pad: 20 });
    if (gr.cam !== 'gs') R.camera.zoomTo('gs', { push: false });
    else R.camera.refit();
    callout.dataset.side = shot.side;
    spot(shot.at);
    // (a slate on top: its height is known once it's drawn; frame again under it)
    if (shot.side === 'top') later(() => { if (G.step && gr.cam === 'gs') { const t2 = (callout.offsetHeight || 200) + 24; if (t2 !== top) { offGs?.(); offGs = R.camera.target('gs', { world: 'stage', rect: () => shot.R, top: t2, pad: 20 }); R.camera.refit(); } } }, 30);
  }
  // the spotlight: the stage dimmed but for a soft pool on each thing (world units, so it glides with the camera)
  function spot(at) {
    const strip = at === 'strip';
    R.el.strip?.el?.classList.toggle('gr-gs-lit', strip && !!G.step);
    if (!G.step || gr.world !== 'stage' || gr.cam === 'tuner') { dim.hidden = true; pools.replaceChildren(); return; }
    const rs = strip ? [] : at;
    const ox = -2400, oy = -1600, k = 0.58, e = 12;
    const masks = rs.map((r) => `radial-gradient(${(r.w * k + e).toFixed(0)}px ${(r.h * k + e).toFixed(0)}px at ${(r.x + r.w / 2 - ox).toFixed(0)}px ${(r.y + r.h / 2 - oy).toFixed(0)}px, transparent 0 74%, #000 100%)`);
    dim.style.maskImage = masks.length ? masks.join(', ') : 'none';
    dim.style.webkitMaskImage = dim.style.maskImage;
    dim.style.maskComposite = 'intersect';
    dim.hidden = false;
    pools.replaceChildren(...rs.map((r) => h('div.gr-gs-pool', { style: { left: `${r.x + r.w / 2 - (r.w * k + e)}px`, top: `${r.y + r.h / 2 - (r.h * k + e)}px`, width: `${(r.w * k + e) * 2}px`, height: `${(r.h * k + e) * 2}px` } })));
  }

  function open(step) {
    const id = STEPS.some((s) => s.id === step) ? step : 'plug';
    if (R.busy()) { R.say(W.sayWaits); return { ok: false, error: W.sayWaits }; }
    if (gr.overlay === 'review') return { ok: false, error: W.sayReview };
    // (what's open above the stage steps back first: the tape's sheet, the library, the talkback's field)
    for (let i = 0; i < 3 && gr.overlay && gr.overlay !== 'gs'; i++) R.press('back');
    if (gr.world === 'shop') { R.camera.zoomTo('stage'); later(() => open(id), (reducedMotion() ? 30 : 600) + 60); return { ok: true }; }
    G.step = id; G.close = false; G.err = '';
    if (id === 'tour') G.tour = Math.max(0, Math.min(TOUR.length - 1, gr.gs.tour || 0));
    if (id === 'tune') G.tuned = false;
    gr.gs.step = id; gr.gs.tour = G.tour;
    gprefs.set({ gs: { step: id } });
    R.overlay('gs');
    tunerTarget();
    slateKey = '';
    if (audio()?.state.open && !G.devices.length) audio().devices().then((l) => { G.devices = l || []; if (G.step) paintSlate(); }).catch(() => {});
    paintSlate();
    gsCam();
    paintButton();
    R.emit('start:gs', { step: id });
    return { ok: true };
  }
  function close({ done = false, quiet = false } = {}) {
    if (!G.step) return;
    const was = G.step;
    if (gr.tuner.on) tuner(false, { quiet: true, camera: false });
    G.step = null; gr.gs.step = null;
    if (done) gprefs.set({ gs: { done: true, step: null } });
    else gprefs.set({ gs: { step: was } });
    unmountGauges();
    callout.hidden = true; callout.replaceChildren(); slateKey = '';
    spot([]);
    R.el.strip?.el?.classList.remove('gr-gs-lit');
    if (gr.overlay === 'gs') R.overlay(null);
    offGs?.(); offGs = null;
    tunerTarget();
    if (!quiet && gr.world === 'stage') R.camera.home();
    paintButton();
    R.emit('start:gs', { step: null });
  }
  function next(skip = false) {
    if (!G.step) return { ok: false, error: 'Getting started isn’t up.' };
    if (skip) { const sk = new Set(gprefs.get().gs.skipped); sk.add(G.step); gprefs.set({ gs: { skipped: [...sk] } }); }
    if (G.step === 'tour' && !skip && G.tour < TOUR.length - 1) { G.tour++; gr.gs.tour = G.tour; paintSlate(); gsCam(); return { ok: true }; }
    if (gr.tuner.on) tuner(false, { quiet: true, camera: false });
    if (timing?.cal.state.phase === 'listening') timing.stop();
    const after = G.step === 'tour' ? null : stepAfter(G.step);
    if (!after) { close({ done: true }); R.say(W.sayDone); return { ok: true }; }
    G.step = after; G.close = false; gr.gs.step = after;
    if (after === 'tour') { G.tour = 0; gr.gs.tour = 0; }
    if (after === 'tune') G.tuned = false;
    gprefs.set({ gs: { step: after } });
    paintSlate();
    gsCam();
    R.emit('start:gs', { step: after });
    return { ok: true };
  }
  function pause() {
    const was = G.step;
    close({ quiet: false });
    gprefs.set({ gs: { step: was } });
    R.say(W.sayPaused);
  }
  function toShop() {
    // (the sound's kept; the tour waits: the button carries on with it)
    G.step = 'tour'; G.tour = 0; gr.gs.tour = 0;
    close({ quiet: true });
    R.press('shop');
  }

  // the header's button: Getting started, or carry on where it was left
  const gsBtn = h('button.gr-gs-btn', { type: 'button', 'aria-expanded': 'false', onclick: (e) => { e.currentTarget.blur(); R.press('gs'); } }, 'Getting started');
  function paintButton() {
    const g = gprefs.get().gs;
    gsBtn.textContent = !G.step && g.step ? 'Getting started: carry on' : 'Getting started';
    gsBtn.setAttribute('aria-expanded', String(!!G.step));
  }
  const tools = () => R.el.tools;
  function placeButton() { const t = tools(); if (t && !gsBtn.isConnected) t.append(gsBtn); }
  placeButton(); paintButton();

  /* ------------------------------------------------------------------------------------------- the bus */
  const offs = [];
  const spotNow = () => { if (G.step && gr.cam === 'gs') spot(shotOf(G.step, { rect, tour: G.tour, close: G.close }).at); else spot([]); };
  // the camera taken elsewhere while Getting started is up (a click on the gear): it waits, quietly
  offs.push(R.on('cam', (d) => {
    if (G.step && d.to !== 'gs' && d.to !== 'tuner' && d.to !== 'stage') close({ quiet: true });
    if (d.to === 'tuner' || d.from === 'tuner') { spotNow(); if (G.step) { callout.dataset.side = d.to === 'tuner' ? 'left' : G.side; } }
    if (d.to === 'tuner') ensurePanel();
  }));
  offs.push(R.on('rig', () => { placeAt = -1e9; if (G.step === 'sound') { slateKey = ''; paintSlate(); } }));
  const offAudio = app.input?.on?.('audio', () => { if (G.step === 'plug' || G.step === 'time') paintSlate(); });

  // once, by itself: a visitor's first time in the room (a check opens it by hand)
  const g0 = gprefs.get().gs;
  if (!g0.done && !g0.step && visitor()) later(() => { if (!gone && !G.step && !gr.overlay && !R.busy() && gr.world === 'stage') open('plug'); }, 450);

  /* ------------------------------------------------------------------------------------------- the view */
  let lastNext = '', tunAt = 0;
  return {
    press(id) {
      if (id === 'gs') { if (G.step) { gsCam(); return { ok: true }; } const g = gprefs.get().gs; return open(g.step || 'plug'); }
      if (id === 'gs:next') { if (!G.step) return { ok: false, error: 'Getting started isn’t up.' }; if (goNow) { goNow(); return { ok: true }; } return next(); }
      if (id === 'gs:skip') return next(true);
      if (id === 'tuner') { const was = gr.tuner.on, now = tuner(); return now !== was ? { ok: true } : { ok: false, error: W.sayTunerWaits }; }
      return false;
    },
    back() {
      if (gr.tuner.on) { tuner(false); return true; }
      if (G.step) { pause(); return true; }
      return false;
    },
    frame(now) {
      if (gone) return;
      placePedal(now);
      placeButton();
      const a = audio(), input = !!a?.state.open;
      // (the jack is lit while the cable's in: the input open)
      if (ring.hidden === input) ring.hidden = !input;
      // the tuner: muted while it's on (an input reopened turns monitoring back on: off again), off for a take
      if (gr.tuner.on) {
        if (R.busy()) tuner(false, { quiet: true });
        else if (a?.state.open && a.state.monitoring) mute();
      }
      // (the song's tuning undone or changed elsewhere: the tuner follows)
      if (panel && now - tunAt > 500) { tunAt = now; if (panel.tuningId !== tuningId()) panel.setTuning(tuningId()); }
      const rd = panel ? panel.frame(now, gr.tuner.on && input) : null;
      pedal.update(rd, { on: gr.tuner.on, input });
      if (!G.step) return;
      if (G.step === 'plug') {
        pickFrame(now);
        level?.frame(now);
        // (Next lights once the strum has held in the window)
        const ok = (level?.state?.good || 0) > 1000 ? '1' : '';
        if (ok !== lastNext) { lastNext = ok; const b = callout.querySelector('.gr-co-next'); if (b) b.classList.toggle('go', !!ok || !level); }
      } else if (G.step === 'time') {
        timing?.frame(now);
        const st = timing?.cal.state, ok = st && (st.kept || st.measured) && st.phase !== 'listening' ? '1' : '';
        if (ok !== lastNext) { lastNext = ok; const b = callout.querySelector('.gr-co-next'); if (b) b.classList.toggle('go', !!ok); }
      }
    },
    unmount() {
      gone = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      // (never muted after the room goes)
      if (gr.tuner.on) { gr.tuner.on = false; unmute(); }
      unmountGauges();
      for (const off of offs) off();
      offAudio?.();
      offGs?.(); offTarget?.();
      panel?.unmount();
      R.el.strip?.el?.classList.remove('gr-gs-lit');
      callout.replaceChildren(); callout.hidden = true;
      gsBtn.remove();
      pedal.el.remove(); ring.remove(); dim.remove(); pools.remove();
    },
    open: (step) => { open(step); },
    done: () => !!gprefs.get().gs.done,
    tuner: (on) => tuner(on),
    isOpen: () => !!G.step,
    step: () => G.step,
    pedal: () => pedal.el,
    close: (o = {}) => close(o),
  };
}

