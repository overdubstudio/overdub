// The live room [ui, a prototype: ?room]: the room in front of the glass. You say what you brought and where you're
// playing, plug in, and play; play a riff twice and the house band comes in on the next pass; Space and it's take one,
// from the riff's first note. Then the control room (the studio) has it: your guitar, the band, the tempo. Why it works
// this way is docs/research/LIVE-ROOM.md; the music is core/liveroom.js; the pictures are ui/liveroom-pixels.js.
// /app/?room opens it over a blank song (main.js); for the rest of the tab the top bar has a Live room key, before Song.
//
// Steps (R.step), each the whole screen over the studio (inert under it):
//   'bring'   What are you bringing? An electric guitar (the others aren't in this room yet).
//   'place'   Where are we playing? The basement, the metal club, the blues bar: each its own amp (a Guitar Studio rig),
//             its own band and its own idea of fast.
//   'check'   Soundcheck: plug in (the input, monitoring through the place's rig on a Guitar track, signed you), check
//             one, two (your loudest chord's peak), the tuner, the timing (the round trip, measured once per input:
//             input/latency.js).
//   'room'    The room. No red light: the tape is always rolling, and what you played before the band came in is kept.
//             Play a riff twice (core/liveroom.js findRiff, on the guitar's notes: input/onsets.js) and the band comes in
//             on the next pass that starts on a bar line, timed so it lands where your hands will be (the band starts at
//             that pass's input time less the round trip and the engine's delay compensation: the recorder's own
//             placement, input/recorder.js finishAudio). Before then a note that doesn't fit the riff twice calls it off
//             ("part of something longer"). The band is a preview while you play (store.preview: nothing in History);
//             Give me a beat starts the drums at the place's tempo with a bar of sticks instead; Tap the 1 (T, twice, on
//             the riff's 1) brings the band in on a riff the room didn't catch by ear. Stop for a bar (no notes, nothing
//             ringing) and the band finishes that bar with you; the take waits for Space either way.
//   'take'    Space: the take lands, two undo steps: yours (the tempo, the key, the take on the Guitar track from bar 1)
//             and the house's (Drums and Bass from where they came in to the end of the take). Hear it back, or into
//             the control room. Leaving for the control room with the band playing keeps the take first (the tape was
//             rolling; it's two undo steps if it wasn't wanted).
// The gear moves with the sound: your amp with your level, the kit on the band's notes, the bass cone with its meter.
//
// app.liveRoom = { open(step?), close(), state: R, riff(), plugIn(opts), place(id), bring(kind), take(), beat(),
//   tap(t?) (t on the input's clock; now, without one), setRig(id), feed(onsets) (a test's notes, as the input's), entry() }

import { h, css } from './dom.js';
import { PLACES, PLACE_IDS, placeOf, earOf, findRiff, riffFromTaps, fitsRiff, nextEntry, bandOps, chordAt, pcName, AMP, AMP_NAME, RIGS, rigChain, rigLabel } from '../core/liveroom.js';
import { createNoteFinder } from '../input/onsets.js';
import { W, H, drawRoom, drawThing, drawTape } from './liveroom-pixels.js';

const LIVE_DB = 6;           // a live guitar's fader to start (the Jam room's: ui/jam.js LIVE_DB, measured there)
const KEEP_S = 40;           // seconds of input kept from before a take starts
const BAND_BARS = 96;        // how far the band plays while you do (it's trimmed to the take when it lands)
const COMMIT_S = 0.35;       // the engine is told this long before the band's first beat
const FLAG = 'overdub:liveroom';
const r4 = (x) => Math.round(x * 10000) / 10000;
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const barsWord = (r) => (r.n === 2 ? 'half a bar' : r.bars === 1 ? 'a bar' : `${NUM[r.bars] || r.bars} bars`);
const fmtDb = (d) => `${d < 0 ? '−' : ''}${Math.abs(Math.round(d))} dB`;
const THINGS = [
  { id: 'electric', name: 'Electric guitar', note: 'Through an amp: riffs, chords, leads.', live: true },
  { id: 'acoustic', name: 'Acoustic guitar', note: 'Not in this room yet.' },
  { id: 'keys', name: 'Keys', note: 'Not in this room yet.' },
  { id: 'voice', name: 'Your voice', note: 'Not in this room yet.' },
];

export default function installLiveRoom(app) {
  let fromUrl = false, flagged = false;
  try { fromUrl = new URLSearchParams(location.search).has('room'); } catch { /* no address */ }
  try { flagged = sessionStorage.getItem(FLAG) === '1'; } catch { /* storage blocked */ }
  if (!fromUrl && !flagged && app.liveRoom !== true) return;
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* ok */ }
  const { ui, store, engine } = app;
  css('liveroom', CSS);

  const R = {
    open: false, step: 'bring', bring: null, place: null, rig: null, guitar: null,
    phase: 'idle',               // the room: idle | heard | coming | band | beat | ended (the band stopped with you)
    riff: null, entry: null, misses: 0, band: null, ids: {}, t0: null, lastNote: -Infinity, lastLoud: 0, stopAt: null, ended: null, taking: false,
    onsets: [], chunks: [], take: null, peak: -120, peakAt: 0, said: '', saidAt: 0, taps: [], hinted: false, roomAt: 0,
    vis: { amp: 0, hit: 0, kick: 0, snare: 0, hat: 0, crash: 0, tom: 0, bass: 0, heard: 0 },
  };
  let el = null, body = null, statusEl = null, roomCv = null, opener = null, finder = null, offListen = null;
  const audio = () => app.input?.audio || null;
  const sr = () => audio()?.state?.sr || engine.ctx?.sampleRate || 48000;
  const latency = () => { try { return audio()?.latency?.get() || 0; } catch { return 0; } };
  const pdc = () => engine.latency?.total || 0;
  const place = () => placeOf(R.place);

  /* ------------------------------------------------------------------------------------------- the overlay */
  // what's under the room goes inert while it's up, and back to what it was after (the Start stage may have made some of
  // it inert already)
  let wasInert = null;
  function under() { return [...document.body.children].filter((c) => c !== el && !c.classList.contains('ew-toasts')); }
  function open(step = null) {
    if (!el) {
      body = h('div.lr-body');
      // a region over an inert studio, as the Start stage is (not an aria-modal dialog: the shell leaves a modal's keys
      // to the modal, and the room's keys are ui.keys like everyone's)
      el = h('section.lr', { role: 'region', 'aria-label': 'The live room', tabindex: -1 },
        h('header.lr-top',
          h('span.lr-brand.disp-s', 'Overdub'), h('span.lr-where', 'The live room'), h('span.lr-gap'),
          h('button.btn.btn-txt.lr-glass', { type: 'button', onclick: () => close() }, 'Control room →')),
        body);
      document.body.append(el);
    }
    if (!R.open) {
      opener = document.activeElement;
      wasInert = new Map(under().map((c) => [c, c.inert]));
      for (const c of wasInert.keys()) c.inert = true;
    }
    R.open = true;
    el.hidden = false;
    // (back from the control room with the input open: the room's Guitar is the armed track again, should a Jam room
    // there have armed its own Live guitar)
    if (R.guitar && audio()?.state?.open) ensureGuitar().catch(() => {});
    go(step || (R.place && R.guitar ? 'room' : R.step || 'bring'));
    setTimeout(() => el?.focus(), 0);
  }
  // To the control room. With the band playing (or stopped with you) the take is kept first, as Space keeps it: the
  // tape was rolling, and it's two undo steps if it wasn't wanted; a band that hadn't come in yet is called off.
  async function close() {
    if (!R.open) return;
    if (R.phase === 'band' || R.phase === 'beat' || R.phase === 'ended') await take();
    else if (R.phase !== 'idle') callOff('');
    R.open = false;
    el.hidden = true;
    for (const [c, was] of wasInert || []) c.inert = was;
    wasInert = null;
    try { if (opener?.isConnected) opener.focus(); } catch { /* ok */ }
  }

  function go(step) {
    R.step = step;
    body.replaceChildren();
    roomCv = null; statusEl = null;
    el.dataset.step = step;
    if (step === 'bring') stepBring();
    else if (step === 'place') stepPlace();
    else if (step === 'check') stepCheck();
    else if (step === 'room') stepRoom();
    else if (step === 'take') stepTake();
  }
  const back = (label, to) => h('button.btn.btn-txt.lr-back', { type: 'button', onclick: () => go(to) }, `← ${label}`);

  /* ------------------------------------------------------------------------------------------- what you bring */
  function stepBring() {
    const cards = THINGS.map((t, i) => {
      const cv = h('canvas.lr-thing', { width: 64, height: 64, 'aria-hidden': 'true' });
      drawThing(cv.getContext('2d'), t.id, { dim: !t.live });
      return h('button.lr-card', { type: 'button', disabled: !t.live, 'aria-disabled': t.live ? null : 'true', dataset: { thing: t.id }, onclick: () => bring(t.id) },
        cv, h('span.lr-card-name', t.name), h('span.lr-card-note', t.note), t.live ? h('kbd', String(i + 1)) : null);
    });
    body.append(
      h('h1.lr-h.disp', 'What are you bringing?'),
      h('p.lr-sub', 'Pick what you play. The room sets up around it.'),
      h('div.lr-cards.lr-things', cards));
  }
  function bring(kind) {
    if (!THINGS.find((t) => t.id === kind && t.live)) return false;
    R.bring = kind;
    try { engine.start?.(); } catch { /* it starts on the next gesture */ }
    go('place');
    return true;
  }

  /* ------------------------------------------------------------------------------------------- where */
  function stepPlace() {
    const cards = PLACE_IDS.map((id, i) => {
      const P = PLACES[id];
      const cv = h('canvas.lr-placecv', { width: W, height: H, 'aria-hidden': 'true', dataset: { place: id } });
      return h('button.lr-card.lr-placecard', { type: 'button', dataset: { place: id }, onclick: () => choose(id) },
        cv,
        h('span.lr-card-row', h('span.lr-card-name', P.name), h('kbd', String(i + 1))),
        h('span.lr-card-what', `${P.what} · ${P.tempo[0]}–${P.tempo[1]} BPM`),
        h('span.lr-card-note', P.blurb));
    });
    body.append(
      h('h1.lr-h.disp', 'Where are we playing?'),
      h('p.lr-sub', 'Each room has its own amp, its own band and its own idea of fast.'),
      h('div.lr-cards.lr-places', cards),
      back('What you’re bringing', 'bring'));
  }
  function choose(id) {
    if (!PLACES[id]) return false;
    const was = R.place;
    R.place = id;
    if (was !== id) R.rig = PLACES[id].rigs[0];
    go('check');
    if (R.guitar && store.track(R.guitar) && was !== id) setRig(R.rig, { quiet: true });
    return true;
  }

  /* ------------------------------------------------------------------------------------------- soundcheck */
  let check = null;
  function stepCheck() {
    const P = place();
    roomCv = h('canvas.lr-room.lr-room-check', { width: W, height: H, 'aria-hidden': 'true' });
    const devSel = h('select.lr-sel', { 'aria-label': 'Input' });
    const chSel = h('select.lr-sel.lr-ch', { 'aria-label': 'Input channel' });
    const plug = h('button.btn', { type: 'button', onclick: () => plugIn({ device: devSel.value, channel: chSel.value || '1' }) }, 'Plug in');
    const plugLine = h('p.lr-line'), monBtn = h('button.btn.btn-txt', { type: 'button', hidden: true, onclick: () => { audio()?.monitor(true); paintCheck(); } }, 'I’m on headphones: let me hear it');
    const meter = h('div.lr-meter', h('div.lr-meter-fill')), levelLine = h('p.lr-line', 'Hit your loudest chord.');
    const tuneNote = h('span.lr-tune-note.disp', '–'), tuneLine = h('p.lr-line', 'Play an open string.');
    const timeLine = h('p.lr-line'), timeBtn = h('button.btn.btn-txt', { type: 'button', onclick: () => measure() }, 'Line it up: strum with eight clicks');
    const go2 = h('button.btn.btn-go.lr-go', { type: 'button', onclick: () => intoRoom() }, 'Into the room');
    check = { devSel, chSel, plug, plugLine, monBtn, meter, levelLine, tuneNote, tuneLine, timeLine, timeBtn, go2 };
    body.append(
      h('h1.lr-h.disp', 'Soundcheck'),
      h('p.lr-sub', `${P.name}: ${setTo(R.rig)}.`),
      h('div.lr-check',
        h('div.lr-check-room', roomCv, rigRow()),
        h('ol.lr-steps',
          h('li', h('h2.lr-h2', 'Plug in'), h('div.lr-row', devSel, chSel, plug), plugLine, monBtn),
          h('li', h('h2.lr-h2', 'Check, one, two'), meter, levelLine),
          h('li', h('h2.lr-h2', 'Tune up'), h('div.lr-row', tuneNote, tuneLine)),
          h('li', h('h2.lr-h2', 'Timing'), timeLine, timeBtn))),
      h('div.lr-foot', back('Somewhere else', 'place'), go2));
    fillDevices();
    paintCheck();
  }
  async function fillDevices() {
    const a = audio();
    if (!a || !check) return;
    let list = [];
    try { list = await a.devices(); } catch { /* none yet */ }
    if (!check) return;
    const cur = a.state.deviceId || '';
    check.devSel.replaceChildren(...(list.length ? list : [{ id: '', label: 'Default input' }]).map((d) => h('option', { value: d.id, selected: d.id === cur ? true : null }, d.label || 'Input')));
    paintChannels();
  }
  function paintChannels() {
    const a = audio();
    if (!a || !check) return;
    const n = Math.max(1, a.state.channels || 2), cur = String(a.state.channel || '1');
    check.chSel.replaceChildren(...Array.from({ length: Math.min(8, n) }, (_, i) => h('option', { value: String(i + 1), selected: String(i + 1) === cur ? true : null }, `Input ${i + 1}`)));
  }
  function paintCheck() {
    const a = audio();
    if (!check || !a) return;
    const st = a.state;
    check.plug.textContent = st.open ? 'Plugged in' : 'Plug in';
    check.plug.classList.toggle('btn-go', !st.open);
    // (the track the input really plays through: the room's Guitar, by its rig's name, or whatever else it is)
    const mt = st.open && st.monitoring ? a.monitorTrack?.() : null;
    check.plugLine.textContent = st.error ? st.error
      : !st.open ? 'Your guitar into the interface, the interface into the computer.'
      : mt ? `${st.label}, input ${st.channel}. You’re hearing it through ${mt.id === R.guitar ? setTo(R.rig) : `${mt.name}’s chain`}.`
      : st.monitoring ? `${st.label}, input ${st.channel}. Monitoring is on but has no track to play through yet, so the amp isn’t on.`
      : st.monitorLine || `${st.label}, input ${st.channel}. Monitoring is off, so the amp isn’t on yet: anything you hear is the interface itself.`;
    check.monBtn.hidden = !st.open || st.monitoring;
    const L = latency(), m = a.latency?.measured;
    check.timeLine.textContent = m ? `Timing: ${Math.round(m.ms)} ms round trip, measured.` : `Timing: about ${Math.round(L * 1000)} ms, the browser’s guess.`;
    check.go2.disabled = !st.open;
  }
  async function plugIn({ device = undefined, channel = undefined } = {}) {
    const a = audio();
    if (!a) return null;
    try { await engine.start?.(); } catch { /* no audio yet */ }
    // the Guitar track first, so the input plays through it from the moment it opens (as the Jam room's Plug in does).
    // Opened with no audio track, monitoring waits for one, and a Jam room open in the control room makes its own Live
    // guitar for it at once: the input would play through that, not the rig here.
    await ensureGuitar();
    try { await a.open({ ...(device != null ? { device } : {}), ...(channel != null ? { channel } : {}), monitor: 'auto' }); } catch { /* the line says why */ }
    if (!a.state.open) { paintCheck(); return null; }
    listenOn();
    // (the inputs again: the browser names them only once it's allowed to listen, so your interface can be picked)
    fillDevices();
    paintChannels();
    paintCheck();
    sound('pop');
    return a.state;
  }
  async function measure() {
    const a = audio();
    if (!a?.state.open || !check) return;
    check.timeBtn.disabled = true;
    check.timeLine.textContent = 'Strum on each click: two to settle, then six.';
    try {
      const res = await a.latency.measure({ how: 'tap', onStep: ({ i }) => { if (check) check.timeLine.textContent = `Click ${i + 1} of 8…`; } });
      if (res?.ok) a.latency.set(res.ms, { how: 'tap', spread: res.spread });
      if (check) check.timeLine.textContent = res?.ok ? `Timing: ${Math.round(res.ms)} ms round trip, measured.` : 'Didn’t catch enough of those. Try again, a little harder on each click.';
    } catch (e) { if (check) check.timeLine.textContent = 'Couldn’t measure: ' + e.message; }
    if (check) check.timeBtn.disabled = false;
  }
  function intoRoom() { if (!audio()?.state.open) return false; go('room'); return true; }

  /* ------------------------------------------------------------------------------------------- your guitar, its rig */
  const rigOf = (id) => RIGS[id] || RIGS[place().rigs[0]];
  const setTo = (id) => `the ${AMP_NAME}, set to ${rigOf(id).name}`;
  function rigRow() {
    const name = h('span.lr-rig-name', rigLabel(R.rig));
    const flip = (d) => { const list = place().rigs, i = list.indexOf(R.rig); setRig(list[(i + d + list.length) % list.length]); name.textContent = rigLabel(R.rig); };
    return h('div.lr-rig', h('button.btn.lr-rig-b', { type: 'button', 'aria-label': 'The amp’s last sound', onclick: () => flip(-1) }, '‹'), name,
      h('button.btn.lr-rig-b', { type: 'button', 'aria-label': 'The amp’s next sound', onclick: () => flip(1) }, '›'));
  }
  // The room's Guitar track (made the first time, signed you) and the one armed audio track: the input monitors and
  // records through the first armed one (input/audioin.js recordTrack), so any other is disarmed in the same step.
  async function ensureGuitar() {
    R.rig = rigOf(R.rig).id;
    const t = R.guitar && store.track(R.guitar);
    const off = store.get().tracks.filter((x) => x.kind === 'audio' && x.arm && x.id !== t?.id).map((x) => ({ type: 'track.set', track: x.id, patch: { arm: false } }));
    if (t) {
      if (!t.arm || off.length) store.dispatch([...off, ...(t.arm ? [] : [{ type: 'track.set', track: t.id, patch: { arm: true } }])], { by: 'you', label: `arm ${t.name}` });
      return store.track(t.id);
    }
    const r = store.dispatch([...off, { type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', inserts: rigChain(R.rig), gain: LIVE_DB, arm: true } }], { by: 'you', label: `Guitar on the ${AMP_NAME} (${rigOf(R.rig).name}), in ${place().name.toLowerCase()}` });
    if (!r.ok) { ui.toast(r.error, { kind: 'bad' }); return null; }
    R.guitar = r.created.g;
    return store.track(R.guitar);
  }
  // Another of the amp's settings: the knobs turned on the Guitar's Half Stack (a chain without one gets the amp in
  // place of what it had)
  function setRig(id, { quiet = false } = {}) {
    const chain = rigChain(id);
    if (!chain) return false;
    R.rig = id;
    const t = R.guitar && store.track(R.guitar);
    if (!t) return false;
    const amp = t.inserts.find((x) => x.device === AMP);
    const ops = amp ? [{ type: 'insert.set', track: t.id, insert: amp.id, patch: { params: chain[0].params, on: true } }]
      : [...t.inserts.map((x) => ({ type: 'insert.remove', track: t.id, insert: x.id })), ...chain.map((s) => ({ type: 'insert.add', track: t.id, insert: { device: s.device, params: { ...s.params }, on: s.on } }))];
    const r = store.dispatch(ops, { by: 'you', label: `${t.name}: ${rigLabel(id)}` });
    if (!quiet && r.ok) say(`${RIGS[id].name} on the ${AMP_NAME}.`);
    if (check?.plugLine) paintCheck();
    return r.ok;
  }

  /* ------------------------------------------------------------------------------------------- the input */
  function listenOn() {
    if (offListen) return;
    const rate = sr();
    finder = createNoteFinder(earOf(rate));
    offListen = audio().listen(onBlock);
  }
  function onBlock({ f, d }) {
    const x = d && d[0];
    if (!x || !x.length) return;
    R.chunks.push({ f, x });
    // keep what's needed: the take from its start, else the last KEEP_S seconds
    const rate = sr(), keepFrom = R.t0 != null ? Math.round((R.t0 - 1) * rate) : f - KEEP_S * rate;
    while (R.chunks.length > 1 && R.chunks[0].f + R.chunks[0].x.length < keepFrom) R.chunks.shift();
    for (const e of finder.push(x, f)) onNote({ t: e.f / rate, p: e.p, ps: e.ps });
  }
  // the input from t0 to t1 (seconds on the audio clock)
  function slice(t0, t1) {
    const rate = sr(), F0 = Math.round(t0 * rate), F1 = Math.round(t1 * rate), out = new Float32Array(Math.max(0, F1 - F0));
    for (const c of R.chunks) {
      const a = Math.max(F0, c.f), b = Math.min(F1, c.f + c.x.length);
      if (b > a) out.set(c.x.subarray(a - c.f, b - c.f), a - F0);
    }
    return out;
  }
  function onNote(o) {
    R.lastNote = o.t;
    R.vis.hit = 1;
    if (R.step !== 'room' || !R.open) return;
    R.onsets.push(o);
    if (R.onsets.length > 600) R.onsets.splice(0, 200);
    // (a tapped riff isn't second-guessed: the person said where it was)
    if (R.phase === 'heard') { if (!R.riff.tapped && !fitsRiff(R.riff, o) && ++R.misses >= 2) callOff('Lost it: that was part of something longer. Keep going.'); return; }
    if (R.phase !== 'idle') return;
    const r = findRiff(R.onsets, { place: R.place });
    if (r) plan(r);
  }

  /* ------------------------------------------------------------------------------------------- the band */
  function plan(r) {
    const c = engine.ctx;
    if (!c) return;
    const L = latency(), D = pdc();
    const e = nextEntry(r, c.currentTime, { lead: L + D + COMMIT_S + 0.1 });
    if (!e) return;
    // the band, heard nowhere yet: a preview, so its instruments are warm when it comes in
    const res = preview(r, { from: e.beat });
    if (!res) return;
    R.riff = r; R.entry = { ...e, at: e.t - L - D }; R.misses = 0; R.phase = 'heard'; R.t0 = r.t0; R.vis.heard = 1;
    say(`${r.tapped ? 'Got it' : 'Heard it'}: ${barsWord(r)} at ${Math.round(r.bpm)} in ${pcName(r.root)}. The band’s in on the next one.`);
  }
  // Tap the 1 (T, or a footswitch that types it): on the riff's 1, twice, and the band comes in on the next pass at your
  // tempo, for the riff the room didn't catch by ear (core/liveroom.js riffFromTaps). A tap is put on the input's clock
  // (now, less how long ago the key went down, plus the input's own latency: the round trip less the output's), and the
  // riff is read a moment after the second, when that 1's note has come in.
  function tap(t = null, e = null) {
    if (R.step !== 'room' || R.phase !== 'idle' || !engine.ctx) return false;
    if (t == null) {
      const ago = e?.timeStamp ? Math.max(0, (performance.now() - e.timeStamp) / 1000) : 0;
      t = engine.ctx.currentTime + Math.max(0, latency() - (audio()?.outLatency?.() || 0)) - ago;
    }
    if (R.taps.length && t - R.taps[R.taps.length - 1] > 10.5) R.taps = [];
    R.taps.push(t);
    R.hinted = true;
    if (R.taps.length < 2) { say('One. And again on the next 1.'); return true; }
    const [ta, tb] = R.taps;
    R.taps = [];
    if (tb - ta < 0.6) { say('Those were too close for a riff. Tap its 1, then the next 1.'); return true; }
    setTimeout(() => {
      if (R.step !== 'room' || R.phase !== 'idle') return;
      const r = riffFromTaps(R.onsets, [ta, tb], { place: R.place });
      if (r) plan(r); else say('Couldn’t place those. Tap its 1 again, twice.');
    }, 160);
    return true;
  }
  function preview(r, { from, count = false, parts = ['drums', 'bass'] }) {
    release();
    const P = place();
    const { ops, band } = bandOps(R.place, r, { from, length: BAND_BARS * 4, count, parts, seed: seedOf() });
    const bpm = r ? r.bpm : P.prefer;
    const pv = store.preview([{ type: 'project.set', patch: { tempo: bpm, meter: [4, 4], loop: { on: false } } }, ...ops], { by: 'overdub' });
    if (!pv.ok) { say(`The band couldn’t set up: ${pv.error}`); return null; }
    R.band = { pv, from, band };
    R.ids = { drums: pv.created.drums || null, bass: pv.created.bass || null };
    drumCache = null;
    return R.band;
  }
  function release() { if (R.band?.pv) { try { R.band.pv.release(); } catch { /* gone */ } } R.band = null; }
  function seedOf() { return (store.get().tracks.length + 1) * 7; }
  function callOff(line) {
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    release();
    R.phase = 'idle'; R.riff = null; R.entry = null; R.t0 = null; R.misses = 0; R.onsets = []; R.ended = null; R.stopAt = null; R.taps = [];
    if (line) say(line);
  }
  function commit() {
    const e = R.entry;
    if (!e) return;
    R.phase = 'coming';
    say('Here they come.');
    try { engine.play(e.beat, { at: e.at }); } catch (err) { say('The band couldn’t start: ' + err.message); callOff(''); }
  }
  // Give me a beat: the drums at the place's tempo, a bar of sticks first; the take starts on the sticks' first click
  function beat() {
    if (R.step !== 'room' || !engine.ctx) return false;
    if (R.phase !== 'idle') return false;
    const c = engine.ctx, P = place();
    if (!preview(null, { from: 0, count: true, parts: ['drums'] })) return false;
    const at = c.currentTime + 0.25 + pdc();
    R.riff = { bpm: P.prefer, n: 4, bars: 1, root: 4, notes: [], period: (4 * 60) / P.prefer, t0: at + latency() + pdc(), place: P.id, beat: true };
    R.entry = { beat: 0, t: at + latency() + pdc(), at };
    R.t0 = R.riff.t0; R.phase = 'beat';
    say(`Sticks, then the drums at ${P.prefer}. Play over it; Space when you’re done.`);
    try { engine.play(0, { at }); } catch (err) { say('The drums couldn’t start: ' + err.message); callOff(''); }
    return true;
  }

  /* ------------------------------------------------------------------------------------------- the take */
  // until the input has come in up to audio-clock time t (a take's ring-out), 1.5 s at most
  const inputAt = (t) => new Promise((res) => {
    const F = Math.round(t * sr()), began = performance.now();
    const tick = () => { const k = R.chunks[R.chunks.length - 1]; if ((k && k.f + k.x.length >= F) || performance.now() - began > 1500) res(); else setTimeout(tick, 30); };
    tick();
  });
  async function take() {
    const live = R.phase === 'band' || R.phase === 'beat' || R.phase === 'coming' || R.phase === 'ended';
    if (R.step !== 'room' || R.t0 == null || !live || R.taking) return null;
    R.taking = true;
    try { return await land(); } finally { R.taking = false; }
  }
  async function land() {
    const c = engine.ctx, rate = sr(), P = place(), r = R.riff, e = R.entry, spb = 60 / r.bpm;
    // where it ends: now, or where the band stopped with you; the band to the end of that bar
    const ended = R.phase === 'ended' && R.ended ? R.ended : { t: c.currentTime, beat: engine.playing ? engine.beat : e.beat };
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    const endBeat = Math.max(e.beat + 4, Math.ceil(ended.beat / 4 - 1e-6) * 4);
    say('Keeping it…');
    // the take from just before the riff's first note to a ring-out past the end, placed so the band's way in is where
    // your hands were: the riff's 1 at bar 1, any drift since then taken up by the offset
    const PRE = 0.5, TAIL = 0.6;
    await inputAt(ended.t + TAIL);
    const A0 = R.t0 - PRE, data = slice(A0, ended.t + TAIL);
    const offset = r4(Math.max(0, e.t - e.beat * spb - A0)), length = r4(Math.max(1, (data.length / rate - offset) / spb));
    const asset = 'a_' + Date.now().toString(36).slice(-6) + 'lr';
    try { await engine.assets.put(asset, { sr: rate, channels: [data] }); } catch (err) { say('Couldn’t keep the audio: ' + err.message); return null; }
    release();
    const n = (store.track(R.guitar)?.clips.length || 0) + 1, name = `Take ${n}`;
    const key = { root: pcName(r.root), scale: P.scale };
    const mine = store.dispatch([
      { type: 'project.set', patch: { tempo: r.bpm, meter: [4, 4], loop: { on: false }, ...(r.beat ? {} : { key }) } },
      { type: 'asset.add', asset: { id: asset, kind: 'audio', name, sr: rate, channels: 1, duration: data.length / rate } },
      { type: 'clip.add', track: R.guitar, ref: 'take', clip: { kind: 'audio', asset, start: 0, length, offset, name } },
    ], { by: 'you', label: `${name}: your guitar in ${P.name.toLowerCase()}, ${Math.round(r.bpm)} BPM` });
    if (!mine.ok) { say('The take didn’t land: ' + mine.error); R.phase = 'idle'; return null; }
    const { ops } = bandOps(R.place, r.beat ? null : r, { from: e.beat, length: endBeat - e.beat, count: !!r.beat, parts: r.beat ? ['drums'] : ['drums', 'bass'], seed: seedOf() });
    const house = store.dispatch(ops, { by: 'overdub', label: `The house band in ${P.name.toLowerCase()}, from bar ${Math.round(e.beat / 4) + 1}` });
    R.ids = { drums: house.created?.drums || null, bass: house.created?.bass || null };
    drumCache = null;
    R.take = { name, bars: Math.round(endBeat / 4), bpm: r.bpm, root: r.beat ? null : pcName(r.root), from: Math.round(e.beat / 4) + 1, seconds: ended.t - R.t0, beat: !!r.beat };
    R.phase = 'idle'; R.riff = null; R.entry = null; R.t0 = null; R.onsets = []; R.ended = null; R.taps = [];
    go('take');
    return R.take;
  }

  /* ------------------------------------------------------------------------------------------- the room */
  function stepRoom() {
    roomCv = h('canvas.lr-room', { width: W, height: H, 'aria-label': `${place().name}, your amp, the band’s gear and the tape` });
    statusEl = h('p.lr-status', { role: 'status', 'aria-live': 'polite' });
    const beatBtn = h('button.btn', { type: 'button', onclick: () => beat() }, 'Give me a beat ', h('kbd', 'B'));
    const tapBtn = h('button.btn', { type: 'button', title: 'On the riff’s 1, twice: the band comes in on the next pass', onclick: (e) => tap(null, e) }, 'Tap the 1 ', h('kbd', 'T'));
    const takeBtn = h('button.btn.btn-go', { type: 'button', onclick: () => take() }, 'That’s a take ', h('kbd', 'Space'));
    const offBtn = h('button.btn.btn-txt', { type: 'button', onclick: () => callOff('Band’s out. Nothing kept; play when you’re ready.') }, 'Not that one');
    const readout = h('span.lr-readout');
    room = { beatBtn, tapBtn, takeBtn, offBtn, readout };
    body.append(
      h('div.lr-stage', roomCv),
      statusEl,
      h('div.lr-bar', beatBtn, tapBtn, takeBtn, offBtn, h('span.lr-gap'), readout, rigRow(),
        h('button.btn.btn-txt', { type: 'button', onclick: () => go('check') }, 'Soundcheck')));
    R.onsets = []; R.taps = []; R.roomAt = engine.ctx?.currentTime || 0;
    say(R.take ? 'Play another riff when you’re ready.' : 'Play anything. Play a riff twice and the band comes in on the third time round.');
    fit();
  }
  let room = null;
  function paintRoom() {
    if (!room) return;
    const live = R.phase === 'band' || R.phase === 'beat' || R.phase === 'coming' || R.phase === 'ended';
    room.takeBtn.disabled = !live || !!R.taking;
    room.beatBtn.disabled = R.phase !== 'idle';
    room.tapBtn.disabled = R.phase !== 'idle';
    room.offBtn.hidden = R.phase === 'idle';
    let txt = '';
    if (R.riff && R.phase !== 'idle') txt = R.riff.beat ? `${R.riff.bpm} BPM` : `${Math.round(R.riff.bpm)} BPM · ${pcName(R.riff.root)}`;
    const ch = R.phase === 'band' && R.riff && !R.riff.beat ? chordAt(R.place, R.riff, engine.beat, R.entry.beat) : null;
    if (ch) txt += ` · ${ch.name}, bar ${ch.bar} of ${ch.of}${ch.change ? ` · ${ch.next} next` : ''}`;
    if (room.readout.textContent !== txt) room.readout.textContent = txt;
  }
  function stepTake() {
    const T = R.take, P = place();
    const cv = h('canvas.lr-tape', { width: 128, height: 80, 'aria-hidden': 'true' });
    const sub = `${P.name}\n${T.root ? T.root + '  ' : ''}${Math.round(T.bpm)} BPM\n${T.bars} BARS  ${Math.floor(T.seconds / 60)}:${String(Math.round(T.seconds % 60)).padStart(2, '0')}`;
    tape = { cv, sub, label: T.name.toUpperCase() };
    const hear = h('button.btn', { type: 'button', onclick: () => hearIt(hear) }, 'Hear it back ', h('kbd', 'Space'));
    const line = T.beat
      ? `${T.bars} bars at ${Math.round(T.bpm)}: your guitar over the house drums.`
      : `${T.bars} bars at ${Math.round(T.bpm)} in ${T.root}. Your guitar from bar 1, the band from bar ${T.from}.`;
    body.append(
      h('div.lr-takebox', cv),
      h('h1.lr-h.disp', `${T.name} is in.`),
      h('p.lr-sub', line),
      h('div.lr-foot.lr-foot-c', hear, h('button.btn.btn-go', { type: 'button', onclick: () => { try { engine.stop(); } catch { /* ok */ } close(); } }, 'Into the control room ', h('kbd', 'Enter'))));
  }
  let tape = null;
  function hearIt(btn) {
    try {
      if (engine.playing) { engine.stop(); if (btn) btn.firstChild.textContent = 'Hear it back '; }
      else { engine.play(0); if (btn) btn.firstChild.textContent = 'Stop '; }
    } catch { /* silent engine */ }
  }

  function say(line) {
    R.said = line; R.saidAt = performance.now();
    if (statusEl && statusEl.textContent !== line) statusEl.textContent = line;
  }

  /* ------------------------------------------------------------------------------------------- the loop */
  let drumCache = null, lastBeat = null, lastT = 0;
  function drumNotes() {
    const id = R.ids.drums, t = id && store.track(id);
    if (!t) return [];
    if (drumCache && drumCache.t === t) return drumCache.notes;
    const notes = [];
    for (const c of t.clips) for (const n of c.notes || []) notes.push({ p: n.p, t: c.start + n.t, v: n.v });
    notes.sort((a, b) => a.t - b.t);
    drumCache = { t, notes };
    return notes;
  }
  function hits() {
    if (!engine.playing) { lastBeat = null; return; }
    const b = engine.beat, prev = lastBeat;
    lastBeat = b;
    if (prev == null || b < prev - 1e-3 || b - prev > 1) return;
    const ns = drumNotes();
    let lo = 0, hi = ns.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ns[mid].t <= prev) lo = mid + 1; else hi = mid; }
    const V = R.vis;
    for (let i = lo; i < ns.length && ns[i].t <= b; i++) {
      const p = ns[i].p, v = ns[i].v || 0.8;
      if (p === 35 || p === 36) V.kick = Math.max(V.kick, v);
      else if (p === 38 || p === 40 || p === 37) V.snare = Math.max(V.snare, v);
      else if (p === 42 || p === 44 || p === 46) V.hat = Math.max(V.hat, v);
      else if (p === 49 || p === 57 || p === 52 || p === 55) V.crash = 1;
      else if (p >= 41 && p <= 50) V.tom = Math.max(V.tom, v);
    }
  }
  function frame(now) {
    if (!R.open || !el) return;
    const dt = Math.min(0.1, Math.max(0, (now - (lastT || now)) / 1000));
    lastT = now;
    const V = R.vis, a = audio();
    // your level, your attacks, the band's hits, the bass's meter
    const lv = a?.state.open ? a.level() : null;
    const db = lv ? lv.db : -120;
    V.amp += ((db > -60 ? Math.max(0, Math.min(1, (db + 48) / 42)) : 0) - V.amp) * Math.min(1, dt * 18);
    if (db > R.peak || now - R.peakAt > 2500) { if (db > -100) { R.peak = db; R.peakAt = now; } }
    hits();
    const bm = R.ids.bass ? engine.meters?.tracks?.[R.ids.bass] : null;
    V.bass += ((bm && bm.peak > -60 ? Math.max(0, Math.min(1, (bm.peak + 36) / 30)) : 0) - V.bass) * Math.min(1, dt * 20);
    const fall = (k, tau) => { V[k] *= Math.exp(-dt / tau); };
    fall('hit', 0.08); fall('kick', 0.09); fall('snare', 0.1); fall('hat', 0.06); fall('crash', 0.45); fall('tom', 0.12); fall('heard', 0.6);
    // the room's clock: commit the band, then say it's in
    const c = engine.ctx;
    if (R.phase === 'heard' && c && c.currentTime >= R.entry.at - COMMIT_S) commit();
    if (R.phase === 'heard' && c && c.currentTime - R.lastNote > 2.2) callOff('Stopped? The band waits for the next riff.');
    // (the room is strict about what it calls a riff, so after a while of playing it says how to tell it, once)
    if (R.step === 'room' && R.phase === 'idle' && !R.hinted && c && R.onsets.length >= 40 && c.currentTime - R.roomAt > 25) {
      R.hinted = true;
      say('If that’s a riff, tap T on its 1, twice, and the band comes in on the next one.');
    }
    if ((R.phase === 'coming') && engine.playing && engine.beat >= R.entry.beat - 1e-3) { R.phase = 'band'; say('That’s the band. Keep going; the tape’s rolling. Space when you’re done.'); }
    // you stopped (a bar with no notes and nothing ringing): the band finishes that bar with you, and the take waits
    if (c && db > -42) R.lastLoud = c.currentTime;
    if ((R.phase === 'band' || R.phase === 'beat') && engine.playing && c) {
      const quiet = c.currentTime - Math.max(R.lastNote, R.lastLoud || 0) > (4 * 60) / R.riff.bpm + 0.3;
      const played = R.lastNote > R.entry.t;   // (over a beat, not before you've played a note over it)
      if (quiet && played && R.stopAt == null) R.stopAt = Math.ceil(engine.beat / 4 + 1e-6) * 4;
      if (R.stopAt != null && engine.beat >= R.stopAt - 0.02) {
        R.ended = { t: c.currentTime, beat: R.stopAt }; R.stopAt = null;
        try { engine.stop(); } catch { /* ok */ }
        R.phase = 'ended';
        say('The band stopped with you. Space keeps it, from your first note; Esc and it’s gone.');
      }
    }
    if (R.step === 'room') paintRoom();
    // pictures
    const t = now / 1000;
    const S = { on: !!a?.state.open, amp: V.amp, hit: V.hit, kick: V.kick, snare: V.snare, hat: V.hat, crash: V.crash, tom: V.tom, bass: V.bass, heard: V.heard,
      band: R.phase !== 'idle' || (R.step === 'take'), rolling: !!a?.state.open && R.step !== 'place', counter: R.t0 != null && c ? Math.max(0, c.currentTime - R.t0) : 0 };
    if (roomCv) drawRoom(roomCv.getContext('2d'), R.place, S, t);
    if (R.step === 'place') for (const cv of body.querySelectorAll('canvas.lr-placecv')) drawRoom(cv.getContext('2d'), cv.dataset.place, { on: true, amp: 0.15 + 0.1 * Math.sin(t * 2), rolling: false }, t);
    if (R.step === 'take' && tape) { drawTape(tape.cv.getContext('2d'), { label: tape.label, sub: tape.sub, t: engine.playing ? t : 0 }); }
    if (R.step === 'check' && check) {
      const fill = check.meter.firstChild, w = `${Math.round(V.amp * 100)}%`;
      if (fill.style.width !== w) fill.style.width = w;
      fill.classList.toggle('lr-clip', !!lv?.clip);
      if (a?.state.open) {
        const pk = R.peak;
        check.levelLine.textContent = lv?.clip ? 'That clipped. Turn the gain down a touch.' : pk < -40 ? 'Hit your loudest chord.' : pk < -26 ? `Quiet: peaks at ${fmtDb(pk)}. Turn the gain on your interface up.` : `Loud and clear: peaks at ${fmtDb(pk)}.`;
        const tu = a.tune ? a.tune({ lo: 38, hi: 1400 }) : null;
        if (tu && tu.midi) {
          check.tuneNote.textContent = pcName(Math.round(tu.midi));
          check.tuneLine.textContent = tu.cents == null ? 'Let it ring…' : Math.abs(tu.cents) <= 4 ? 'In tune.' : `${Math.abs(Math.round(tu.cents))} cents ${tu.cents < 0 ? 'flat' : 'sharp'}.`;
        }
      }
    }
  }
  // the room's canvas: the biggest whole-pixel scale that fits (a phone gets what fits)
  function fit() {
    if (!roomCv) return;
    const box = roomCv.parentElement, aw = Math.max(200, (box?.clientWidth || innerWidth) - 4), ah = Math.max(120, innerHeight - 230);
    const s = Math.min(aw / W, ah / H), k = s >= 2 ? Math.floor(s) : s;
    roomCv.style.width = `${Math.round(W * k)}px`; roomCv.style.height = `${Math.round(H * k)}px`;
  }
  addEventListener('resize', () => { if (R.open) fit(); });
  // the room's key on the top bar, before Song (the account's key is after it); its panel's frame is the room's loop
  ui.panel({
    id: 'liveroom', region: 'top', title: 'Live room',
    mount(m) {
      m.append(h('button.btn.lr-key', { type: 'button', title: 'Back to the live room', onclick: () => open() }, 'Live room'));
      return { frame };
    },
  });

  // small real sounds: the amp's pop when you plug in
  function sound(kind) {
    const c = engine.ctx;
    if (!c || kind !== 'pop') return;
    try {
      const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + 0.01;
      o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.2);
    } catch { /* no sound: fine */ }
  }

  /* ------------------------------------------------------------------------------------------- keys */
  const K = (key, when, run, label, more = {}) => ui.keys.add({ key, when: () => R.open && when(), run, label, group: 'Live room', first: true, ...more });
  K('Space', () => R.step === 'room' || R.step === 'take', () => { if (R.step === 'room') take(); else hearIt(body.querySelector('.lr-foot .btn')); }, 'That’s a take (in the room); hear it back');
  K('Enter', () => R.step === 'check' || R.step === 'take' || R.step === 'bring', () => { if (R.step === 'check') intoRoom(); else if (R.step === 'take') { try { engine.stop(); } catch { /* ok */ } close(); } else bring('electric'); }, 'Next');
  K('Escape', () => true, () => {
    if (R.step === 'room' && R.phase !== 'idle') callOff('Band’s out. Nothing kept; play when you’re ready.');
    else if (R.step === 'place') go('bring');
    else if (R.step === 'check') go('place');
    else if (R.step === 'room') go('check');
    else close();
  }, 'Back; call the band off', { global: true });
  K('KeyB', () => R.step === 'room', () => beat(), 'Give me a beat');
  K('KeyT', () => R.step === 'room', (e) => { if (!e?.repeat) tap(null, e); }, 'Tap the 1 (twice, on the riff’s 1)');
  K('BracketLeft', () => R.step === 'room' || R.step === 'check', () => { const l = place().rigs; setRig(l[(l.indexOf(R.rig) - 1 + l.length) % l.length]); }, 'The amp’s last sound');
  K('BracketRight', () => R.step === 'room' || R.step === 'check', () => { const l = place().rigs; setRig(l[(l.indexOf(R.rig) + 1) % l.length]); }, 'The amp’s next sound');
  for (let i = 1; i <= 4; i++) K(`Digit${i}`, () => R.step === 'bring' || (R.step === 'place' && i <= 3), () => { if (R.step === 'bring') bring(THINGS[i - 1].id); else choose(PLACE_IDS[i - 1]); }, 'Pick');
  // the soundcheck's line follows the monitor, which wires itself a moment after a track is made or armed
  app.input?.on?.('monitor', () => { if (R.open && R.step === 'check') paintCheck(); });

  app.liveRoom = {
    open, close, state: R, riff: () => R.riff, entry: () => R.entry, plugIn, place: choose, bring, take, beat, setRig, tap: (t) => tap(t ?? null),
    // a test's notes, as the input's: [{ t (audio clock s), p }]
    feed(list) { for (const o of list) onNote(o); },
  };
  if (fromUrl) open('bring');
}

const CSS = `
.lr { position: fixed; inset: 0; z-index: 900; display: flex; flex-direction: column; background: var(--bg); color: var(--text); overflow: auto; outline: none;
  padding: 12px clamp(16px, 3vw, 40px) 18px; }
.lr[hidden] { display: none; }
.lr-top { display: flex; align-items: center; gap: 12px; min-height: 36px; }
.lr-brand { font-size: 18px; }
.lr-where { color: var(--text-3); font-size: 13px; }
.lr-gap { flex: 1; }
.lr-body { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 18px; }
.lr-h { margin: 0; font-size: clamp(28px, 4.2vw, 46px); text-align: center; }
.lr-h2 { margin: 0 0 6px; font: 700 14px/1.2 var(--font-ui); }
.lr-sub { margin: 0; color: var(--text-2); font-size: 15px; text-align: center; max-width: 60ch; }
.lr-cards { display: grid; gap: 12px; width: min(100%, 1100px); margin-top: 8px; }
.lr-things { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lr-places { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.lr-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg-2); color: var(--text); text-align: left; cursor: pointer; font: 14px/1.35 var(--font-ui); }
.lr-card:hover:not(:disabled) { border-color: var(--text-3); background: var(--bg-3); }
.lr-card:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.lr-card:disabled { cursor: default; color: var(--text-3); }
.lr-card kbd { margin-top: auto; }
.lr-card-row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; }
.lr-card-row kbd { margin-top: 0; }
.lr-card-name { font-weight: 700; font-size: 16px; }
.lr-card-what { color: var(--text-2); font-size: 13px; }
.lr-card-note { color: var(--text-2); font-size: 13px; }
.lr-card:disabled .lr-card-note { color: var(--text-3); }
.lr-thing { width: 128px; height: 128px; image-rendering: pixelated; align-self: center; }
.lr-placecv { width: 100%; height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated; border-radius: 1px; }
.lr-back { margin-top: 6px; }
.lr-check { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 1fr); gap: 22px; width: min(100%, 1180px); align-items: start; }
.lr-check-room { display: flex; flex-direction: column; gap: 8px; }
.lr-room-check { width: 100%; height: auto; aspect-ratio: 16 / 9; image-rendering: pixelated; }
.lr-steps { margin: 0; padding: 0 0 0 20px; display: flex; flex-direction: column; gap: 16px; }
.lr-steps li::marker { color: var(--text-3); font: 700 13px var(--font-ui); }
.lr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lr-sel { height: 28px; max-width: 230px; border: var(--rule-2); border-radius: var(--r-press); background: var(--bg-2); color: var(--text); font: 13px var(--font-ui); padding: 0 6px; }
.lr-ch { max-width: 100px; }
.lr-line { margin: 4px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.4; }
.lr-meter { height: 10px; border: var(--rule-2); border-radius: var(--r-press); overflow: hidden; background: var(--bg-2); }
.lr-meter-fill { height: 100%; width: 0; background: var(--ok); transition: width .05s linear; }
.lr-meter-fill.lr-clip { background: var(--bad); }
.lr-tune-note { font-size: 34px; min-width: 2ch; }
.lr-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: min(100%, 1180px); margin-top: 6px; }
.lr-foot-c { justify-content: center; }
.lr-go { height: 34px; padding: 0 16px; font-size: 14px; }
.lr-stage { width: 100%; display: flex; justify-content: center; }
.lr-room { image-rendering: pixelated; display: block; }
.lr-status { margin: 0; min-height: 1.4em; font: 600 clamp(16px, 1.6vw, 20px)/1.35 var(--font-ui); text-align: center; max-width: 70ch; }
.lr-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: min(100%, 1180px); }
.lr-readout { font: 13px var(--font-mono); color: var(--text-2); }
.lr-rig { display: inline-flex; align-items: center; gap: 6px; }
.lr-rig-name { font: 600 13px var(--font-ui); min-width: 9ch; text-align: center; }
.lr-rig-b { width: 28px; padding: 0; }
.lr-takebox { margin-top: 8px; }
.lr-tape { width: 384px; height: 240px; image-rendering: pixelated; max-width: 100%; }
.ew-region-top > .ew-panel[data-panel="liveroom"] { flex: none; order: 8; display: flex; align-items: center; height: 40px; padding: 0 6px; }
.lr-key { height: 30px; padding: 0 12px; }
@media (max-width: 760px) {
  .lr-things { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lr-places { grid-template-columns: 1fr; }
  .lr-check { grid-template-columns: 1fr; }
  .lr-thing { width: 96px; height: 96px; }
}
`;
