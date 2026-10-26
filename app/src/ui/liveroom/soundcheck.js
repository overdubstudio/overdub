// The soundcheck's lamps [ui; stream A] (docs/research/LIVE-ROOM-MODE.md §3.3, §8): plugged in, the level, the tuning
// and the line-up, four small lamps on the stage that light as you play. There's no soundcheck screen and no gate:
// Count me in works the moment the input is open, and each lamp is a button that does its step again.
//
// Frozen (§14.2):
//   mountLamps(el, ctx) -> { frame(now), unmount() }   ctx: ui/liveroom/index.js's
//   lampsState() -> { plug, level, tune, lineup }      each lamp's state (null: dark)
//       a lamp: { lit (its step is done), state ('ok' | 'ask' | 'warn' | 'busy'), line (the id of the line it's on, in
//       core/liveroom/lines/soundcheck.js), vars, text (that line's words) }; tune also has { id (the tuning), ask: [a,
//       b] (the two it can be, while it asks) }, plug { device, input, channels }, level { db }, lineup { ms }
// What the lamps make of the input (levelVerdict, tuningsFor, NOTE: pure) is ./lamps.js's.
//
// What each lamp does:
//   1. Plug in: the input (the last one used; else an interface over a mic, a mic at the kitchen), opened with all its
//      channels, the one that moves on the first strum picked (at least 12 dB over the others: audioin pickChannel; all
//      of them moving together for a second, the loudest);
//      nothing in 5 s, a refusal, or a mic at an electric place, each says so. Monitoring is the input layer's (on
//      through the amp for an interface). Device and channel selects, 16 px.
//   2. Level: the hardest strums' peak over the last 3 s, said when it has held a second; the lamp shows the number
//      it was said with until the verdict changes (or the lamp is pressed and listens again).
//   3. Tune: the open low string (the tuner down to 38 Hz) names the tuning, or asks which of two; the answer is a
//      step by you (room.set { tuning }) when the song has a room. Six sustained notes more than 15 cents off say so.
//   4. Line it up: eight strums to the clicks (input/latency.js, how: 'tap'), kept per device; long round trips and
//      long outputs said. No ramps of their own (Chrome 155: no setValueCurveAtTime anywhere here).
// The lamps speak through ctx.say, never while a count or a take runs (the talkback is between passes).

import { h, css } from '../dom.js';
import { pickChannel, inputKind } from '../../input/audioin.js';
import { levelVerdict, tuningsFor, NOTE } from './lamps.js';
import { TUNINGS } from '../../core/fretboard.js';
import { roomOf } from '../../core/liveroom/model.js';
import { rigLabel, lowCut } from '../../core/liveroom/places.js';
import { LINES } from '../../core/liveroom/lines/soundcheck.js';
import { createDeck } from './deck.js';

const HOLD_S = 3, SETTLE_MS = 1000, NOTHING_MS = 5000;

const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

// the lamps mounted last (lampsState reads them)
let current = null;
// what the lamps last said, for the page's life: mounted again on the same input (back from the shelf, the send screen
// or the control room) they light at once and don't say it all again
const SAID = { device: null, plug: null, level: null, lamp: null };
const DARK = () => ({ plug: null, level: null, tune: null, lineup: null });

export function lampsState() {
  if (!current) return DARK();
  const out = {};
  for (const k of ['plug', 'level', 'tune', 'lineup']) out[k] = current[k] ? { ...current[k], vars: { ...(current[k].vars || {}) }, ...(current[k].ask ? { ask: current[k].ask.map((x) => ({ ...x })) } : {}) } : null;
  return out;
}

const CSS = `
.lr-lamps { display: flex; flex-direction: column; gap: 8px; width: min(100%, 1024px); }
.lr-lamp-row { display: flex; flex-direction: column; gap: 6px; }
.lr-lamp-row .lr-lamp { width: 100%; }
.lr-stage .lr-lamp-rig { display: none; }
.lr-lamp { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 6px 12px; border: 1px solid var(--line-2); background: var(--bg-2, transparent);
  color: var(--text); font: 600 13px/1.2 var(--font-ui); text-align: left; cursor: pointer; max-width: 100%; }
.lr-lamp:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.lr-lamp-dot { flex: none; width: 10px; height: 10px; background: var(--line-2); }
.lr-lamp[data-state="ok"] .lr-lamp-dot { background: var(--lr-lamp, #ffc85a); }
.lr-lamp[data-state="ask"] .lr-lamp-dot, .lr-lamp[data-state="busy"] .lr-lamp-dot { background: var(--text-3); }
.lr-lamp[data-state="warn"] .lr-lamp-dot { background: var(--text); }
.lr-lamp-name { white-space: nowrap; }
.lr-lamp-says { font-weight: 400; color: var(--text-2); }
.lr-lamp-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--text-2); font-size: 13px; }
.lr-lamp-pick select { font-size: 16px; min-height: 36px; max-width: 100%; }
.lr-lamp-ask { display: flex; flex-wrap: wrap; gap: 8px; }
.lr-lamp-ask[hidden], .lr-lamp-pick[hidden] { display: none; }
.lr-lamp-rig { font: 13px/1.3 var(--font-mono, monospace); color: var(--text-2); }
@media (hover: none) { .lr-lamp, .lr-lamp-ask .btn { min-height: 44px; } }
`;

// The guitars' Slide Rule low cut for a tuning (§4.1: 100 Hz for E standard and drop D, 90 for D and C, 80 for B), on
// each guitar role's track, in the tuning's step: the chains places.js setupOf made were for the place's own tuning
const GUITARS = ['guitarL', 'guitarR', 'guitar', 'lead'];
function lowCutOps(p, tuning) {
  const room = roomOf(p), hz = lowCut(tuning), ops = [];
  for (const role of GUITARS) {
    const t = (p.tracks || []).find((x) => x.id === room?.tracks?.[role]);
    const eq = t?.inserts?.find((fx) => fx.device === 'core.eq8' && fx.params?.b1_on);
    if (eq && eq.params.b1_freq !== hz) ops.push({ type: 'insert.set', track: t.id, insert: eq.id, patch: { params: { b1_freq: hz } } });
  }
  return ops;
}

export function mountLamps(el, ctx) {
  css('lr-lamps', CSS);
  const app = ctx.app, store = ctx.store || app.store, deck = ctx.deck || createDeck(app);
  const audio = () => app.input?.audio || null;
  const place = () => { try { return ctx.view?.().place || roomOf(store.get())?.place || null; } catch { return null; } };
  const L = { plug: null, level: null, tune: null, lineup: null };
  current = L;
  let gone = false;

  // a line: the lamp's own words, and the talkback's (not while a count or a take runs: then it waits, the newest kept)
  let queued = null;
  const words = (id, vars) => { try { return LINES[id] ? String(LINES[id].text(vars || {})) : ''; } catch { return ''; } };
  function set(k, state, line = null, vars = {}, extra = {}) {
    const lit = state === 'ok';
    L[k] = { lit, state, line, vars, text: line ? words(line, vars) : '', ...extra };
    paint(k);
    return L[k];
  }
  function say(id, vars = {}) {
    if (deck.state.run !== 'idle') { queued = { id, vars }; return; }
    queued = null;
    try { ctx.say?.(id, vars); } catch (e) { console.error('lamps say', id, e); }
  }

  /* ---- the DOM */
  const mk = (k, name) => {
    const b = h('button.lr-lamp', { type: 'button', dataset: { lamp: k, state: 'off' }, onclick: () => redo(k) }, h('i.lr-lamp-dot', { 'aria-hidden': 'true' }), h('span.lr-lamp-name', name), h('span.lr-lamp-says'));
    return b;
  };
  const btn = { plug: mk('plug', 'Plug in'), level: mk('level', 'Level'), tune: mk('tune', 'Tune'), lineup: mk('lineup', 'Line it up') };
  const devSel = h('select', { 'aria-label': 'Input', onchange: () => openInput({ device: devSel.value, channel: null, by: 'hand' }) });
  const chSel = h('select', { 'aria-label': 'Input channel', onchange: () => { const a = audio(); if (a?.state.open) { a.useChannel(chSel.value); picked = +chSel.value; plugOk(); } } });
  const pick = h('div.lr-lamp-pick', { hidden: true }, h('label', 'Input ', devSel), h('label', 'Channel ', chSel));
  const ask = h('div.lr-lamp-ask', { hidden: true });
  const rig = h('p.lr-lamp-rig', { title: '[ and ] change the amp’s setting' });
  const box = h('div.lr-lamps', h('div.lr-lamp-row', btn.plug, btn.level, btn.tune, btn.lineup), ask, pick, rig);
  el.append(box);
  function paint(k) {
    const b = btn[k], s = L[k];
    if (!b) return;
    b.dataset.state = s ? s.state : 'off';
    b.querySelector('.lr-lamp-says').textContent = s ? s.text : '';
    b.setAttribute('aria-label', `${b.querySelector('.lr-lamp-name').textContent}${s?.text ? `: ${s.text}` : ''}`);
  }
  function paintAsk() {
    const q = L.tune?.ask;
    ask.hidden = !q;
    ask.replaceChildren(...(q || []).map((t) => h('button.btn', { type: 'button', onclick: () => chooseTuning(t) }, t.name[0].toUpperCase() + t.name.slice(1))));
  }
  async function fillPick() {
    const a = audio();
    if (!a) return;
    const list = await a.devices().catch(() => []);
    if (gone) return;
    devSel.replaceChildren(...list.map((d) => h('option', { value: d.id, selected: d.id === a.state.deviceId || null }, d.label)));
    const n = Math.max(1, a.state.channels || 1);
    chSel.replaceChildren(...Array.from({ length: Math.min(8, n) }, (_, i) => h('option', { value: String(i + 1), selected: String(i + 1) === String(a.state.channel) || null }, String(i + 1))));
    pick.hidden = !a.state.open;
  }

  /* ---- 1. plug in */
  let openedAt = 0, picked = null, okSaid = false, nothingSaid = false, holds = [], together = 0;
  async function chooseDevice() {
    const a = audio();
    const list = await a.devices().catch(() => []);
    const kitchen = place() === 'kitchen';
    const saved = a.state.deviceId && list.some((d) => d.id === a.state.deviceId) ? a.state.deviceId : '';
    if (saved) return { device: saved, channel: a.state.channel || '1', saved: true };
    const kinds = list.map((d) => ({ d, k: inputKind(d.label, { isDefault: d.id === 'default' }) }));
    // (an interface by its own id, not the browser's "Default - …" entry for it: the input layer turns monitoring on
    // through the amp only for an interface the person picked, never for the browser's own default)
    const own = (k) => kinds.find((x) => x.k === k && x.d.id !== 'default') || kinds.find((x) => x.k === k);
    const want = kitchen ? own('mic') : own('interface');
    return { device: want ? want.d.id : '', channel: '1', saved: false };
  }
  async function openInput({ device = null, channel = null, by = 'room' } = {}) {
    const a = audio();
    if (!a) return;
    set('plug', 'busy', 'plug.ask');
    let want = { device, channel: channel || '1', saved: false };
    if (device == null) want = await chooseDevice();
    try {
      await a.open({ device: want.device, channel: want.channel, capture: true });
    } catch (e) {
      if (gone) return;
      const refused = /allow|NotAllowed|denied/i.test(String(e?.message || e));
      if (refused) { set('plug', 'warn', 'plug.refused'); say('plug.refused'); }
      else L.plug = { lit: false, state: 'warn', line: null, vars: {}, text: String(a.state.error || e?.message || e) }, paint('plug');
      return;
    }
    if (gone) return;
    openedAt = performance.now(); picked = null; okSaid = false; nothingSaid = false; holds = []; together = 0;
    fillPick();
    const st = a.state;
    if (st.inputKind === 'mic' && place() && place() !== 'kitchen') { set('plug', 'warn', 'plug.mic'); say('plug.mic'); }
    // the same input as last time, its channel kept: ready at once
    if (want.saved && (st.channels < 2 || st.channel !== '1' || by === 'hand')) {
      picked = +st.channel || 1;
      const vars = { device: st.label, input: st.channels >= 2 ? picked : null };
      set('plug', 'ok', 'ready.back', vars, { device: st.label, input: picked, channels: st.channels });
      say('ready.back', vars);
      okSaid = true;
    }
    lineupOnOpen();
  }
  function plugOk() {
    const st = audio().state;
    const vars = { device: st.label, input: st.channels >= 2 ? picked || +st.channel || 1 : null, amp: !!st.monitoring };
    // (a mic at an electric place stays said: it plays, but it's no interface)
    if (!(L.plug?.line === 'plug.mic')) set('plug', 'ok', 'plug.ok', vars, { device: st.label, input: picked || +st.channel || 1, channels: st.channels });
    // (and said once: not after the mic's line, which it would contradict)
    if (!okSaid && SAID.device === (st.deviceId || st.label) && SAID.plug) {
      okSaid = true;
      // (the level as it was last heard on this input, lit until it's heard again)
      if (SAID.lamp && !L.level) { set('level', SAID.lamp.state, SAID.lamp.id, SAID.lamp.vars, { db: SAID.lamp.db }); if (SAID.lamp.state === 'ok') wasOk = true; }
    }
    if (!okSaid) { okSaid = true; SAID.device = st.deviceId || st.label; SAID.plug = 'plug.ok'; if (L.plug?.line !== 'plug.mic') say('plug.ok', vars); if (st.inputKind === 'interface' && st.monitoring) say('plug.direct'); }
    if (!L.tune) { set('tune', 'ask', 'tune.ask'); }
  }
  function framePlug(now) {
    const a = audio();
    if (!a?.state.open || picked) return;
    const lv = a.levels();
    // (each channel's peak, held over half a second)
    holds.push({ t: now, v: lv.map((x) => x.db) });
    while (holds.length && holds[0].t < now - 500) holds.shift();
    const hold = lv.map((_, i) => Math.max(...holds.map((x) => x.v[i] ?? -Infinity)));
    let ch = lv.length >= 2 ? pickChannel(hold) : hold[0] >= -50 ? 1 : null;
    // (every channel moving together, none 12 dB over the rest, for a second: the same signal on all of them, a mono
    // source on a stereo input. It's coming in: the loudest is picked, never "nothing's coming in")
    const top = Math.max(...hold);
    if (!ch && lv.length >= 2 && top >= -50) { if (!together) together = now; else if (now - together >= SETTLE_MS) ch = hold.indexOf(top) + 1; }
    else if (!ch) together = 0;
    if (ch) {
      picked = ch;
      if (String(a.state.channel) !== String(ch)) a.useChannel(ch);
      chSel.value = String(ch);
      plugOk();
      return;
    }
    if (!nothingSaid && now - openedAt > NOTHING_MS && Math.max(...hold) < -50) {
      nothingSaid = true;
      const vars = { device: a.state.label, input: a.state.channels === 2 ? 2 : +a.state.channel || 1 };
      set('plug', 'warn', 'plug.nothing', vars);
      say('plug.nothing', vars);
    }
  }

  /* ---- 2. level: the peak held over the last 3 s, said once it has held a second */
  // (once it has been in the green, playing softer or resting says nothing: only louder trouble comes back)
  let peaks = [], verdict = null, since = 0, saidLevel = null, wasOk = false;
  function frameLevel(now) {
    const a = audio();
    if (!a?.state.open || !picked) return;
    const lv = a.levels(), x = lv.length >= 2 ? lv[(picked || 1) - 1] : lv[0];
    if (!x) return;
    peaks.push({ t: now, db: x.db });
    while (peaks.length && peaks[0].t < now - HOLD_S * 1000) peaks.shift();
    const db = Math.max(...peaks.map((p) => p.db));
    const v = levelVerdict(db);
    if (!v) return;
    if (v !== verdict) { verdict = v; since = now; }
    if (now - since < SETTLE_MS) return;
    if (wasOk && v === 'quiet') return;
    const id = `level.${v}`, vars = { db: Math.round(db), input: picked };
    // (the lamp holds the peak its line was said from, until the verdict changes or the lamp is pressed: a number moving
    // under a line that doesn't would be two answers. Mounted again on the same input, the verdict it said stands)
    if (saidLevel === id) return;
    saidLevel = id;
    if (SAID.level === id && SAID.lamp?.id === id) set('level', SAID.lamp.state, id, SAID.lamp.vars, { db: SAID.lamp.db });
    else {
      set('level', v === 'ok' ? 'ok' : 'warn', id, vars, { db: Math.round(db * 10) / 10 });
      SAID.lamp = { state: v === 'ok' ? 'ok' : 'warn', id, vars, db: Math.round(db * 10) / 10 };
      SAID.level = id;
      say(id, vars);
    }
    if (v === 'ok') wasOk = true;
  }

  /* ---- 3. tune: the open low string; then six sustained notes for the tuning line */
  let wasStable = false, lastMidi = null, notes = [], offSaid = false;
  function frameTune() {
    const a = audio();
    if (!a?.state.open || !picked) return;
    const tu = deck.tuner();
    const stable = !!(tu && tu.stable && Number.isFinite(tu.cents));
    if (stable && (!wasStable || Math.round(tu.midi) !== lastMidi)) {
      // a new sustained note
      lastMidi = Math.round(tu.midi);
      notes.push(tu.cents);
      if (notes.length > 6) notes.shift();
      // (the open low string, while the lamp listens for one: once it has named the tuning or asked, the riffs' low
      // notes are notes, never a new tuning, until the lamp is pressed again; nothing is read during a count or a take)
      if (lastMidi <= 44 && !(L.tune && (L.tune.lit || L.tune.ask)) && deck.state.run === 'idle') lowString(lastMidi);
      if (!offSaid && notes.length >= 6) {
        const c = median(notes);
        if (Math.abs(c) > 15) { offSaid = true; say('tune.off', { cents: Math.round(Math.abs(c) / 5) * 5, flat: c < 0 }); }
      }
    }
    wasStable = stable;
  }
  let lowSeen = null;
  function lowString(m) {
    lowSeen = m;
    const cands = tuningsFor(m);
    if (cands.length === 1) chooseTuning(cands[0], { said: true });
    else if (cands.length >= 2) {
      const vars = { note: NOTE(m), a: cands[0].name, b: cands[1].name };
      set('tune', 'ask', 'tune.which', vars, { note: NOTE(m), midi: m, ask: cands.slice(0, 2) });
      paintAsk();
      say('tune.which', vars);
    } else {
      L.tune = { lit: false, state: 'ask', line: null, vars: { note: NOTE(m) }, text: `Low string ${NOTE(m)}`, note: NOTE(m), midi: m };
      paint('tune');
    }
  }
  function chooseTuning(t, { said = false } = {}) {
    const vars = { name: t.name };
    set('tune', 'ok', 'tune.ok', vars, { id: t.id, note: lowSeen != null ? NOTE(lowSeen) : null, midi: lowSeen });
    paintAsk();
    say('tune.ok', vars);
    // the answer is the song's tuning (the bass's range, the guitar's low cut and the key's root follow it): a step by you
    const p = store.get(), room = roomOf(p);
    // (the song's tuning is the person's now: the lamp comes back lit with it, §2.6)
    try { ctx.prefs?.mark?.(p, 'tuned'); } catch { /* storage: it asks again next time */ }
    if (room && room.tuning !== t.id) {
      try { store.dispatch([{ type: 'room.set', patch: { tuning: t.id } }, ...lowCutOps(p, t.id)], { by: 'you', label: `Tuned to ${t.name}`, reason: 'room:tuning' }); } catch (e) { console.error('lamps: the tuning', e); }
    }
    return said;
  }

  /* ---- 4. line it up */
  function lineupOnOpen() {
    const a = audio();
    const m = a?.latency?.measured;
    if (m) set('lineup', 'ok', m.ms > 25 ? 'line.long' : 'line.ok', { ms: m.ms }, { ms: m.ms });
    else set('lineup', 'ask', 'line.ask');
    const out = a?.outLatency ? a.outLatency() : 0;
    if (out > 0.08) say('line.output', { ms: Math.round(out * 1000) });
  }
  let measuring = false;
  async function lineUp() {
    const a = audio();
    if (!a || measuring) return;
    measuring = true;
    set('lineup', 'busy', 'line.ask');
    say('line.ask');
    let res = null;
    try { res = await a.latency.measure({ how: 'tap' }); } catch { res = null; }
    measuring = false;
    if (gone) return;
    if (res && res.ok) {
      a.latency.set(res.ms, { how: 'tap', spread: res.spread });
      const id = res.ms > 25 ? 'line.long' : 'line.ok';
      set('lineup', 'ok', id, { ms: res.ms }, { ms: Math.round(res.ms) });
      say(id, { ms: res.ms });
    } else set('lineup', 'ask', 'line.ask');
  }

  function redo(k) {
    if (k === 'plug') openInput({ device: null });
    else if (k === 'level') { peaks = []; verdict = null; saidLevel = null; wasOk = false; SAID.level = null; }
    else if (k === 'tune') { lowSeen = null; notes = []; offSaid = false; set('tune', 'ask', 'tune.ask'); paintAsk(); say('tune.ask'); }
    else if (k === 'lineup') lineUp();
  }

  // (a song whose tuning you've chosen, coming back to it: the lamp is lit with it, and the low string isn't asked
  // again until the lamp is pressed. The place's own tuning, never confirmed, still asks)
  {
    let tuned = false;
    try { tuned = !!ctx.prefs?.said?.(store.get(), 'tuned'); } catch { tuned = false; }
    const t = tuned ? roomOf(store.get())?.tuning : null, known = t ? tuningsFor(TUNINGS[t]?.strings?.[0] ?? -1).find((x) => x.id === t) : null;
    if (known) set('tune', 'ok', 'tune.ok', { name: known.name }, { id: known.id, note: NOTE(TUNINGS[t].strings[0]), midi: TUNINGS[t].strings[0] });
  }

  /* ---- start: the input opened by itself when the browser already allows it; else the lamp asks */
  (async () => {
    const a = audio();
    if (!a) return;
    if (a.state.open) { picked = +a.state.channel || 1; fillPick(); plugOk(); lineupOnOpen(); return; }
    let granted = false;
    try { granted = (await navigator.permissions?.query?.({ name: /** @type {any} */ ('microphone') }))?.state === 'granted'; } catch { granted = false; }
    if (gone) return;
    if (granted) openInput({ device: null });
    else { set('plug', 'ask', 'plug.ask'); say('plug.ask'); }
  })();
  const offAudio = app.input?.on?.('audio', () => { if (!gone) { const st = audio()?.state; if (st && !st.open && L.plug?.lit) { picked = null; set('plug', 'ask', 'plug.ask'); } pick.hidden = !st?.open; } }) || null;

  let lastRig = null;
  return {
    frame(now) {
      if (gone) return;
      const t = Number.isFinite(now) ? now : performance.now();
      framePlug(t);
      frameLevel(t);
      frameTune();
      if (queued && deck.state.run === 'idle') say(queued.id, queued.vars);
      // the amp's setting, drawn from the song
      let r = null;
      try { r = ctx.view?.().rig || roomOf(store.get())?.rig || null; } catch { r = null; }
      if (r !== lastRig) { lastRig = r; rig.textContent = r ? `‹ ${rigLabel(r)} ›` : ''; }
    },
    unmount() {
      gone = true;
      try { offAudio?.(); } catch { /* ok */ }
      if (current === L) current = null;
      el.replaceChildren();
    },
  };
}
