// The audio input: a mic, or a guitar/bass/keys through an interface. It opens with the browser's voice processing off
// (no echo cancellation, noise suppression or AGC: they wreck an instrument), picks a channel of the interface, meters
// it, tunes it, monitors it live through an audio track's inserts (engine.inputNode: a guitar plays through the pedals
// and amps as you play), and records it to that track through the recorder (input/recorder.js: count-in, loop passes as
// takes).
//
// Which input: the track's own (the Inspector's Input: device and channel 1-8, track.input), else Sketch's picker (the
// last one opened; localStorage overdub:input { deviceId, channel, countIn }: the device's real id, never the browser's
// 'default'). An interface is opened with all its channels (a 4- or 8-input one included) and the chosen one split off.
// A device plugged in or out shows up without a reload ('devices'). This file is the live path's input end
// (docs/research/AMP-PATH.md; the rules it follows are input/livepath.js's, and app.input.path checks that it works).
//
//   audio.devices() -> Promise<[{ id, label, groupId, kind }]>   kind: inputKind (below)
//   audio.choose({ role }) -> { device, channel, why, reask }    livepath.js chooseInput over the inputs there now
//   audio.openBest({ role, capture })   choose and open; a blind first open (no labels before the grant) chooses again
//                  once they're in and reopens if an interface is there that isn't the one open; role 'instrument'
//                  (the guitar room's) listens for the channel that moves on the first strum (state.picking)
//   audio.open({ device, channel, monitor, capture, split, role, listen }) / close() / ensureOpen()
//   audio.openFor(track) -> state                       the track's input (or Sketch's picker), opened if it isn't
//   audio.inputOf(track) -> { device, channel, from: 'track' | 'picker' }
//   audio.state  { open, deviceId (the real device: the browser's "Default - " entry resolved, livepath.js realIdOf),
//                  realId, label, channel ('1'…'32' | 'both' | 'stereo'), channels (the device's), settings, processed
//                  (the browser kept its voice processing on), inputKind ('interface' | 'mic' | 'virtual' | ''), role,
//                  monitoring (the decision), monitorBy ('auto' | 'hand' | 'open' | 'guard'), monitorAuto (decided by
//                  itself and on), monitorOff ('' | 'mic' | 'virtual' | 'feedback': why it's off), monitorLine (the
//                  sentence that says why, or ''), monitorHolds ([reason]: muted for a moment), monitorTrack (the id it
//                  plays through), monitorWaiting, picking, path (app.input.path's status), recording, countIn, error,
//                  sr, firstFrame (the audio-clock frame the first captured block began on, once one has: a check lines
//                  a fake guitar up with the count by it), split ({ [channel]: track id } while two channels record at
//                  once, or null) }
//   settings is the track's getSettings() as the browser opened it (echoCancellation, noiseSuppression,
//   autoGainControl, channelCount, latency, ...): the kitchen table reads whether the browser kept cleaning the mic up.
//   Every getUserMedia asks for the voice processing off; a remembered device that's gone is chosen again by its label
//   (never asked for loosely: that opens the browser's default with its processing on). If the browser keeps it on
//   anyway, state.processed and LINES.processed once.
//
// Monitoring is ONE decision per input { for: its real id, on, by, why }, made as it opens (open's monitor: 'auto', the
// default) by livepath.js autoMonitor: an instrument interface or line input monitors, however it was picked (the
// browser's "Default - Scarlett" entry is the Scarlett); a microphone (built in, a webcam's, AirPods', a phone's, the
// browser's one-channel default) doesn't, with MIC_LINE in state.monitorLine; nor does a virtual one; in the guitar room
// (role 'instrument') an input it can't name with two or more channels does. By hand (monitor(on): Sketch's chip, the
// Jam room's button, the guitar room's M) it's that, for that device, for the page's life. An opener's own word
// (monitor: true or false, the kitchen's) stands while the same device reopens for the same role. Holds mute it for a
// moment without deciding anything (hold / release: the tuner's 'tuner'). Closing never decides. The killswitch's
// hush() leaves an interface's decision alone and turns anything else off by hand. While it plays, the feedback guard
// (createFeedbackGuard) listens to any input but an interface: a tone that rings up on its own turns monitoring off
// with a fast fade and one toast (FEEDBACK_LINE). inputKind(label) and createFeedbackGuard() are pure: tools/input-test.js checks both.
//   audio.level() -> { peak, db, clip }   (read it in a frame)
//   audio.levels() -> [{ ch, peak, db }]   each of the device's channels (up to 8) as it is now, whichever one is
//                  picked: the live room picks the one that moves on the first strum (pickChannel, pure)
//   audio.useChannel(ch, { auto })   pick another channel of the device open now, in place (no reopen: monitoring and
//                  the capture carry on); a channel it doesn't have, or a split, goes the setChannel way. A pick by
//                  hand (not auto) ends the listening for the first strum
//   open's capture: true attaches the capture at once (its module loaded before the browser is asked), so
//                  state.firstFrame is the input's first block; split: { 1: trackA, 2: trackB } (or { track,
//                  monitor, mic } per channel) records two channels to two tracks at once: one stream, a pick per
//                  channel, the capture two channels wide (the recorder makes a take on each), monitoring per channel
//                  through each track's strip (monitor: false keeps a channel out of it), and the feedback guard on a
//                  mic channel (mic: true) whatever the device is, an interface too
//   audio.tune({ lo, hi }?) -> { hz, midi, p, cents, stable, conf } | null   lo/hi: the instrument's range in Hz (default
//                  38-1400); cents only once the note has settled (stable), else null
//   audio.samples() -> { buf, sr } | null   the picked input's latest window, as it is now (the analyser's: 4096 samples
//                  at 48 kHz, 8192 over 50 kHz, so a quarter of it holds a low B's period at any rate): Getting
//                  started's tuner and meter read it in a frame (input/tuner.js, input/level.js, ui/gauges/). The
//                  buffer is reused: read it before the next call
//   audio.listen(fn({ f, d: [Float32Array] })) -> off    raw blocks with their audio-clock frame (hum, beatbox, latency)
//   audio.tap(node) -> off   the picked input (a split's first channel) also into `node`, an AudioNode on audio.ctx,
//                  through every reopen and channel change until off (the rolling tape, input/tape.js; the path's
//                  check); recording, monitoring and the capture don't change
//   audio.monitor(on?)   by hand: live through the monitored track's inserts; with no audio track it stays on and waits
//   audio.hold(reason) / release(reason) -> [reasons]   a mute that ends (the tuner's)
//   audio.hush()   the killswitch's (ui/transport.js silenceAll, before engine.silence)
//   audio.role(r)  'instrument' while the guitar room is up, '' elsewhere: a decision not made by hand is made again
//   audio.wake() -> Promise<bool>   resume the audio context (a room's key or click; open does)
//   audio.rewire()   the monitor unwired and wired again (the path's repair)
//   audio.monitorTrack() -> the track it plays through now | null (off, held, closed, or waiting: state.monitorWaiting)
//   audio.monitorVia(trackId | () => trackId | null)   where monitoring plays, whatever is armed or selected: a track,
//                  or a function asked at every sync (the guitar room's: a take's other side, else Guitar L), or null
//                  for the usual rule (the armed audio track, else the selected one, else the first). A track that's gone
//                  or isn't an audio track falls back to the usual rule. What a take records onto is unchanged
//                  (recordTrack, the recorder's own target). The engine is told (engine.monitored).
//   audio.record({ track?, countIn? }) ; audio.stopRecord() ; audio.toggleRecord()   (through the recorder)
//   audio.recordTrack()  the track a take would go to       audio.latency  (latency.js)
//   events (app.input.on): 'audio' (state changed), 'take' (an audio take landed: { track, clip, asset, seconds }),
//   'devices' (the inputs changed: [{ id, label }]), 'monitor' ({ track, waiting }: what it plays through changed;
//   waiting: on, with no audio track to play through), 'pathchange' (why: something that can change the live path:
//   livepath.js checks it a moment later)
//   An input that goes away (its stream ends, or it's gone at a devicechange) closes with LINES.gone; when it's back at
//   a devicechange it opens again, on the same channel, with LINES.back.

import { createLatency } from './latency.js';
import { createTuner, fft } from './pitch.js';
import { autoMonitor, chooseInput, realIdOf, say as sayLine } from './livepath.js';

// The input recorder's processor ('ew-cap'): its module, a file on this origin (input/cap-worklet.js)
const CAP_WORKLET = new URL('./cap-worklet.js', import.meta.url).href;

const SAVE = 'overdub:input';
// the browser's own entries, not a device: "Default - …" and Windows' "Communications - …"
const isAlias = (id) => !id || id === 'default' || id === 'communications';

// The channel that moves: levels in dB per channel (index 0 is input 1) as the first strum peaks; the one at least
// `over` dB over every other and over `floor`, as a channel number (1-based), else null. The live room plugs in by it
// (docs/research/LIVE-ROOM-MODE.md §3.3: a guitar on input 2 and nothing on 1 is input 2).
export function pickChannel(levels, { over = 12, floor = -50 } = {}) {
  const L = (Array.isArray(levels) ? levels : []).map((x) => (Number.isFinite(+x) ? +x : -Infinity));
  if (!L.length) return null;
  let k = 0;
  for (let i = 1; i < L.length; i++) if (L[i] > L[k]) k = i;
  if (!(L[k] >= floor)) return null;
  for (let i = 0; i < L.length; i++) if (i !== k && !(L[k] - L[i] >= over)) return null;
  return k + 1;
}
const dB = (d) => Math.pow(10, d / 20);
// the analyser's window: a quarter of it holds the lowest period the tuner looks for (30 Hz) at the context's rate
const winFor = (sr) => (sr > 50000 ? 8192 : 4096);

// What monitoring says when it's off for a reason (state.monitorLine; the feedback one is a toast too)
export const MIC_LINE = 'Monitoring is off: this is a microphone, and through speakers it would howl. Use headphones, then turn it on.';
export const FEEDBACK_LINE = 'Feedback: monitoring is off. Headphones stop it.';

// What an input is, by its name. An instrument interface or a line input ('interface': a guitar through one can't feed
// back, so monitoring starts by itself); a microphone ('mic': built in, a webcam's, AirPods', a
// phone's, a headset's, and the browser's own one-channel default: through speakers it hears itself); a virtual or
// loopback device ('virtual': it hears the speakers' own signal); '' (can't tell). The browser's default is named
// "Default - <device>": the device's name decides (an interface opened as the default monitors too: livepath.js).
const IFACE_RE = /scarlett|focusrite|clarett|\bumc ?\d|behringer|usb audio codec|audient|\bid ?\d{1,2}\b|\bevo ?\d|apogee|\bboss\b|katana|\bgt-?\d|\bhx\b|helix|line ?6|\bpod\b|irig|ik multimedia|\bmotu\b|presonus|audiobox|steinberg|\bur ?\d{2}|universal audio|\bvolt ?\d|apollo|\bssl ?\d|arturia|minifuse|komplete audio|native instruments|tascam|\bus-?\d|rubix|roland|mackie|onyx|\brme\b|babyface|fireface|m-audio|m-track|antelope|kemper|fractal|axe-?fx|quad cortex|neural dsp|fender|mustang|blackstar|\bvox\b|\bnux\b|mooer|line[ -]?in\b|instrument|guitar/i;
const MIC_RE = /built-?in|macbook|internal|default|webcam|camera|airpods|iphone|headset/i;
const VIRTUAL_RE = /blackhole|loopback|soundflower|virtual|vb-?audio|voicemeeter|teams audio|zoomaudio|aggregate|multi-output|cable output/i;
export function inputKind(label, { channels = 0, isDefault = false } = {}) {
  const s = String(label || '').trim();
  if (VIRTUAL_RE.test(s)) return 'virtual';
  const name = s.replace(/^(default|communications)\s*[-–:]\s*/i, '');
  if (MIC_RE.test(name)) return 'mic';
  if (IFACE_RE.test(name)) return 'interface';
  // (a brand wins over the word: Windows calls a Focusrite's input "Microphone (Focusrite USB Audio)")
  if (/micro?phone|\bmic\b/i.test(name)) return 'mic';
  if ((isDefault || name !== s || !name) && channels <= 1) return 'mic';
  return '';
}

// The feedback guard: a tone at one frequency, the loudest thing in the input, whose own level grows frame on frame for
// `span` seconds (by `rise` dB in all) while the places its harmonics would be (an octave under it, two and three times
// it) don't grow with it: a microphone hearing its own monitor through the speakers rings up as a sine. A held note
// decays; a strum is many notes and starts again; a bend moves; a volume swell or a crescendo lifts a note's harmonics
// with it. None of them trips it. One 4096-point FFT a push (every 50 ms or so while monitoring).
//   createFeedbackGuard({ span, rise, share, floor }) -> { push(buf (its last 4096 samples are read), sr, t (s)) -> true
//       when it trips, reset() }
export function createFeedbackGuard({ span = 0.3, rise = 4, share = 0.4, floor = -50, N = 4096, follow = 0.5, alone = 20 } = {}) {
  const re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N), pw = new Float32Array(N >> 1);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const full = ((N / 4) * (N / 4) * 1.5) / 2, H = N >> 1;   // (a full-scale sine reads -3: its RMS level)
  const level = (p) => 10 * Math.log10(p / full + 1e-20);
  // the power within a bin of x, unless x is inside the tone's own skirt (kf: the tone; an octave under a low one is)
  let kf = 0;
  const around = (x) => { if (Math.abs(x - kf) < 4) return 0; const c = Math.round(x); let s = 0; for (let j = Math.max(2, c - 1); j <= Math.min(H - 1, c + 1); j++) s += pw[j]; return s; };
  let run = null;   // the frames so far where one tone leads and doesn't fall: { k, t0, db0, h0, top, db, h }
  return {
    reset() { run = null; },
    push(buf, sr, t) {
      const o = buf.length - N;
      if (o < 0) return false;
      for (let i = 0; i < N; i++) { re[i] = buf[o + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let tot = 0, pk = 0, k = 0;
      for (let j = 2; j < H; j++) { const p = re[j] * re[j] + im[j] * im[j]; pw[j] = p; tot += p; if (p > pk) { pk = p; k = j; } }
      let near = 0;
      for (let j = Math.max(2, k - 2); j <= Math.min(H - 1, k + 2); j++) near += pw[j];
      // the peak between bins, and the level where its harmonics (and an octave under) would sit
      const a = pw[k - 1] || 0, c = pw[k + 1] || 0, den = a - 2 * pk + c;
      kf = k + (den < 0 ? (0.5 * (a - c)) / den : 0);
      const db = level(near), h = level(around(kf / 2) + around(2 * kf) + around(3 * kf));
      const leads = db > floor - 20 && tot > 0 && near / tot >= share;
      const same = run && Math.abs(k - run.k) <= Math.max(1.5, run.k * 0.015);
      if (leads && same && db >= run.db - 2 && db >= run.top - 3) { run.db = db; run.h = h; run.top = Math.max(run.top, db); }
      else run = leads ? { k, t0: t, db0: db, h0: h, top: db, db, h } : null;
      if (!run || t - run.t0 < span - 1e-3 || run.db < floor) return false;
      const up = run.db - run.db0;
      return up >= rise && run.h - run.h0 < up * follow && run.db - run.h >= alone;
    },
  };
}

// A timer that keeps time in background tabs (a Worker's setInterval; main-thread timers are throttled there): the
// guard has to hear feedback with the studio behind another tab too.
function ticker(fn, ms) {
  let w = null, iv = null;
  try {
    const url = URL.createObjectURL(new Blob(['let id = null; onmessage = (e) => { clearInterval(id); id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null; };'], { type: 'text/javascript' }));
    w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => fn();
    w.onerror = () => { try { w.terminate(); } catch { /* ok */ } w = null; if (!iv) iv = setInterval(fn, ms); };
    w.postMessage(ms);
  } catch { w = null; iv = setInterval(fn, ms); }
  return () => { if (w) { try { w.postMessage(0); w.terminate(); } catch { /* ok */ } } if (iv) clearInterval(iv); };
}

export function createAudioIn(app, input) {
  const engine = app.engine, store = app.store;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SAVE) || '{}') || {}; } catch { saved = {}; }
  // (a 'default' saved before the live path: the device it named is chosen again by label)
  if (saved.deviceId === 'default' || saved.deviceId === 'communications') saved.deviceId = '';
  const state = { open: false, deviceId: saved.deviceId || '', realId: '', label: '', channel: saved.channel || '1', channels: 0, settings: {}, processed: false, inputKind: '', role: '', monitoring: false, monitorAuto: false, monitorBy: '', monitorOff: '', monitorLine: '', monitorHolds: [], monitorTrack: null, monitorWaiting: false, picking: false, path: null, recording: false, countIn: saved.countIn !== false, error: '', sr: 0, opening: false, firstFrame: null, split: null };
  let ctx = null, ownCtx = null, rig = null, cap = null, capReady = null, mon = null, monDest = null, recording = false;
  let warned = false, syncT = 0, via = null;   // (the monitor: said once that it waits for a track; a sync queued; where it plays)
  // Monitoring: one decision { for: the real device id, on, by: 'auto' | 'hand' | 'open' | 'guard', why }, the holds
  // that mute it for a moment ('tuner'), and what was decided by hand (or by the feedback guard) for each device, kept
  // for the page's life. pending: turned on or off by hand before an input was open (the next one opened gets it).
  let decision = null, pending = null;
  const hand = new Map();      // real id -> { on, by, why }
  const holds = new Set();
  let guard = null, stopGuard = null, monitoredId = null;
  let lost = null;             // the input that went away ({ id, channel, label, role, capture }), reopened when it's back
  let picking = null;          // listening for the channel that moves on the first strum
  const processedSaid = new Set();
  const recorder = () => input.recorder;
  const listeners = new Set();
  const taps = new Set();     // nodes the picked input also feeds (audio.tap)
  const tuners = new Map();   // the tuner for each range asked for: `${lo}|${hi}` -> { at, last, tuner }
  // (never 'default': the device it is, by realIdOf, or nothing)
  const persist = () => { try { localStorage.setItem(SAVE, JSON.stringify({ deviceId: isAlias(picker.deviceId) ? '' : picker.deviceId, channel: picker.channel, countIn: state.countIn })); } catch { /* ok */ } };
  // Sketch's picker: what was last opened from it (a track's own input doesn't change it)
  let picker = { deviceId: state.deviceId, channel: state.channel };
  const changed = () => {
    state.monitorLine = state.monitorOff === 'feedback' ? FEEDBACK_LINE : state.open && !state.monitoring && state.inputKind === 'mic' ? MIC_LINE : '';
    input.emit('audio', state);
  };
  // something that can change the live path happened: its health check runs a moment later (input/livepath.js)
  const pathEvt = (why) => input.emit('pathchange', why);
  // a line of the path's (livepath.js LINES): the room's talkback while a room listens (input.path.speak), else a toast
  function speak(key, vars = {}, o = {}) {
    const line = sayLine(key, vars);
    if (!line) return;
    const p = input.path;
    if (p && typeof p.speak === 'function') { try { p.speak(line, { key, ...o }); return; } catch (e) { console.warn('input: speak', e); } }
    app.ui?.toast?.(line, o.kind ? { kind: o.kind } : undefined);
  }

  async function ensureCtx() {
    try { await engine.start(); } catch { /* silent engine */ }
    if (engine.ctx) { ctx = engine.ctx; await audio.wake(); return ctx; }
    // FALLBACK until the engine has a context: a private one (no monitoring through tracks then: the path says so)
    if (!ownCtx) ownCtx = new AudioContext({ latencyHint: 'interactive' });
    if (ownCtx.state !== 'running') { try { await ownCtx.resume(); } catch { /* gesture */ } }
    ctx = ownCtx;
    return ctx;
  }
  // the inputs as the browser lists them: { id, label (as given: '' before a grant), groupId, kind }
  async function inputs() {
    const md = navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return [];
    const all = await md.enumerateDevices().catch(() => []);
    return all.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label || '', groupId: d.groupId || '', kind: inputKind(d.label, { isDefault: d.deviceId === 'default' }) }));
  }

  const audio = {
    state,
    get ctx() { return ctx; },
    // [{ id, label, groupId, kind }]: label filled in when the browser gives none (before a grant)
    async devices() {
      const L = await inputs();
      return L.map((d, i) => ({ ...d, label: d.label || (d.id === 'default' ? 'Default input' : `Input ${i + 1}`) }));
    },
    // Which input to open (livepath.js chooseInput over the inputs there now): the remembered one, an interface by its
    // own entry in the guitar room (role 'instrument') and anywhere one is plugged in, else the browser's default;
    // reask when the browser gave no labels yet (no grant: choose again once it's open)
    async choose({ role = state.role } = {}) {
      return chooseInput(await inputs(), { remembered: isAlias(picker.deviceId) ? '' : picker.deviceId, channel: picker.channel || '1', role });
    },
    // choose, open, and on a blind first open (no labels until the grant) choose again and reopen if an interface is
    // now there that isn't the one open. In the guitar room (role 'instrument') the channel that moves on the first
    // strum is picked (unless one is picked by hand).
    async openBest({ role = state.role, capture = false } = {}) {
      const c = await audio.choose({ role });
      const listen = role === 'instrument';
      await audio.open({ device: c.device, channel: c.channel, capture, role, listen });
      if (c.why === 'moved' && state.open) speak('moved', { label: state.label });
      if (c.reask && state.open) {
        const L = await inputs(), again = chooseInput(L, { remembered: '', channel: state.channel, role });
        const d = again.device ? L.find((x) => x.id === again.device) : null;
        if (!again.reask && d && d.kind === 'interface' && again.device !== state.realId) await audio.open({ device: again.device, channel: state.channel, capture, role, listen });
      }
      return state;
    },
    // monitor: 'auto' (decide for this input: see below), true or false (this open's own word: kept while the same
    // device reopens for the same role), 'keep'. role: 'instrument' in the guitar room (livepath.js), '' elsewhere.
    // listen: pick the channel that moves on the first strum.
    async open({ device = picker.deviceId, channel = picker.channel, forTrack = null, monitor = 'auto', capture = false, split = null, role = state.role, listen = false } = {}) {
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) { state.error = 'Can’t open an audio input here: the page needs https (or localhost) and a browser that allows audio input.'; changed(); throw new Error(state.error); }
      state.opening = true; changed();
      const c = await ensureCtx();
      // two channels to two tracks (split), each [{ ch, track, monitor, mic }], low channel first
      const parts = splitOf(split);
      // (the capture's module first, so it attaches as the stream comes in: state.firstFrame is the input's first block)
      if (capture || parts) { try { await capModule(c); } catch { /* attachCap says why */ } }
      // ask for at least the channel wanted (an 8-input interface offers 8); then all the device has (below)
      const chN = Math.max(2, Math.min(32, parts ? Math.max(...parts.map((x) => x.ch)) : parseInt(channel, 10) || 2));
      // Every attempt with the browser's voice processing off. A device that's gone isn't asked for loosely (that opens
      // the browser's default with its processing on): it's chosen again by label, else the default, processing off.
      let err = null, denied = false;
      const flags = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      const attempt = async (dev) => {
        const want = { ...flags, channelCount: { ideal: chN }, latency: { ideal: 0 } }, plain = { ...flags };
        if (dev) { want.deviceId = { exact: dev }; plain.deviceId = { exact: dev }; }
        for (const a of [want, plain]) {
          try { return await md.getUserMedia({ audio: a }); } catch (e) { err = e; if (e && e.name === 'NotAllowedError') { denied = true; return null; } }
        }
        return null;
      };
      let used = device || '', moved = false;
      let stream = await attempt(used);
      if (!stream && !denied && used && err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        if (picker.deviceId === used) { picker.deviceId = ''; persist(); }
        const again = chooseInput(await inputs(), { remembered: '', channel, role });
        if (again.device !== used) { used = again.device; moved = true; stream = await attempt(used); }
      }
      if (!stream && !denied && used) { used = ''; moved = true; stream = await attempt(''); }
      state.opening = false;
      if (!stream) {
        state.error = denied ? 'The browser wasn’t allowed to use the input. Allow the microphone for this site (the icon in the address bar), then try again.'
          : err && err.name === 'OverconstrainedError' ? 'That input isn’t there any more. Pick another.' : `Couldn’t open the input (${(err && (err.message || err.name)) || 'error'}).`;
        changed();
        throw new Error(state.error);
      }
      audio.close(true);
      const track = stream.getAudioTracks()[0];
      // the device's real channel count: open it with all of them, so input 3 of 8 is there to pick
      try {
        const caps = track && track.getCapabilities ? track.getCapabilities() : {}, max = caps.channelCount && caps.channelCount.max;
        const now = track && track.getSettings ? track.getSettings().channelCount : 0;
        if (max && now && max > now && track.applyConstraints) await track.applyConstraints({ ...flags, ...(used ? { deviceId: { exact: used } } : {}), channelCount: { ideal: Math.min(32, max) } }).catch(() => {});
      } catch { /* the browser can't say: what it opened is what there is */ }
      const st = (track && track.getSettings && track.getSettings()) || {};
      // the device behind what opened (the browser's "Default - " entry is the device it names), now that labels are in
      const listNow = await inputs().catch(() => []);
      const label = (track && track.label) || 'Input';
      const rid = realIdOf(listNow, { deviceId: st.deviceId || used, groupId: st.groupId || '', label }) || (isAlias(used) ? '' : used);
      const src = c.createMediaStreamSource(stream);
      const n = Math.max(1, Math.min(32, st.channelCount || 1)), ch = parseInt(channel, 10);
      // one channel of the interface (a guitar is on one input; a stereo downmix would halve it), both summed, or a pair
      const pick = c.createGain(); pick.channelCount = channel === 'stereo' ? 2 : 1; pick.channelCountMode = 'explicit'; pick.channelInterpretation = 'speakers';
      let sp = null, picks = null;
      if (parts) {
        // a pick per channel, each with its own analyser (its meter and its feedback guard); the first is the input's
        sp = c.createChannelSplitter(Math.max(2, n, ...parts.map((x) => x.ch))); src.connect(sp);
        picks = parts.map((x, i) => {
          const g = i === 0 ? pick : c.createGain();
          g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers';
          sp.connect(g, x.ch - 1);
          const a = c.createAnalyser(); a.fftSize = winFor(c.sampleRate); g.connect(a);
          return { ...x, pick: g, an: a, buf: new Float32Array(a.fftSize), mon: null, dest: null };
        });
      } else if (channel === 'both' || channel === 'stereo' || !(ch >= 1) || (n < 2 && ch <= 1)) src.connect(pick);
      else {
        // (a splitter as wide as the channel asked for: a channel the device doesn't have is silence, not channel 1)
        sp = c.createChannelSplitter(Math.max(2, n, ch)); src.connect(sp); sp.connect(pick, ch - 1);
      }
      const an = picks ? picks[0].an : c.createAnalyser();
      if (!picks) { an.fftSize = winFor(c.sampleRate); pick.connect(an); }
      const r = (rig = { stream, src, pick, an, track, sp, picks, lv: null, buf: new Float32Array(an.fftSize), peak: 0, clipAt: 0 });
      // (this stream's own end: a stale stream's ended can't close the input open now)
      if (track) track.addEventListener('ended', () => { if (rig === r) wentAway(); });
      const processed = !!(st.echoCancellation || st.noiseSuppression || st.autoGainControl);
      Object.assign(state, { open: true, deviceId: rid || (isAlias(used) ? '' : used), realId: rid, asked: rid || (isAlias(used) ? '' : used), forTrack, label, channel: picks ? String(picks[0].ch) : String(channel), channels: n, settings: st, processed, role: role || '', error: '', sr: c.sampleRate, firstFrame: null, split: picks ? Object.fromEntries(picks.map((x) => [String(x.ch), x.track])) : null });
      if (!forTrack && !picks) { picker = { deviceId: state.deviceId, channel: String(channel) }; persist(); }
      lost = null;
      // Monitoring for this input. A decision made by hand (or by the feedback guard) for this device stands; so does
      // this open's own word (monitor true or false: the kitchen's), for the same device and role; else it's decided by
      // itself (livepath.js autoMonitor): on for an instrument interface or line input, however it was picked (the
      // browser's "Default - Scarlett" entry is the Scarlett), off for a microphone (MIC_LINE says why) and a virtual one.
      state.inputKind = inputKind(label, { channels: n, isDefault: !rid && (!used || used === 'default') });
      const key = rid || st.deviceId || used || '';
      if (monitor === true || monitor === false) decide(monitor, { by: 'open', why: monitor ? '' : state.inputKind === 'mic' ? 'mic' : '', id: key });
      else if (monitor === 'auto') {
        const h = hand.get(key);
        if (pending) { decide(pending.on, { by: 'hand', id: key }); pending = null; }
        else if (h) decide(h.on, { by: h.by, why: h.why, id: key });
        else if (!(decision && decision.for === key && decision.by === 'open' && decision.role === state.role)) autoDecide(key);
      }
      for (const t of taps) { if (t.context === c) { try { pick.connect(t); } catch { /* gone */ } } }
      if (listeners.size || capture || picks) await attachCap();
      syncMonitor();
      changed();
      if (listen) listenForChannel(); else stopPicking();
      if (moved && device && !isAlias(device)) speak('moved', { label });
      if (processed && !processedSaid.has(key)) { processedSaid.add(key); speak('processed', { label }); }
      pathEvt('open');
      return state;
    },
    async ensureOpen() { if (!state.open) await audio.open(); return state; },
    // The input a track records from: the Inspector's (track.input) when it was set, else Sketch's picker
    inputOf(t) {
      const inp = t && t.input;
      const ch = inp && /^(both|stereo)$/.test(String(inp.channel)) ? String(inp.channel) : String(+(inp && inp.channel) || 1);   // (Sketch's picker may set both or stereo)
      if (inp && ((inp.device && inp.device !== 'default') || ch !== '1')) return { device: inp.device && inp.device !== 'default' ? inp.device : '', channel: ch, from: 'track' };
      return { device: picker.deviceId || '', channel: String(picker.channel || '1'), from: 'picker' };
    },
    async openFor(t) {
      const want = audio.inputOf(t);
      if (state.open && want.device === (state.asked || '') && want.channel === String(state.channel)) return state;
      // (opened for a track's own input, Sketch's picker keeps its choice)
      return audio.open({ device: want.device, channel: want.channel, forTrack: want.from === 'track' ? t.id : null });
    },
    // Closing is only closing: it never decides monitoring (the next open of this device is heard as it was)
    close(quiet) {
      if (recording) { try { recorder()?.stop({ keepPlaying: true }); } catch { /* ok */ } }
      if (cap) { try { cap.port.postMessage('off'); cap.disconnect(); } catch { /* ok */ } cap = null; capReady = null; }
      stopPicking();
      unwireMonitor();
      unwireSplit();
      if (rig) { for (const t of rig.stream.getTracks()) t.stop(); try { rig.src.disconnect(); rig.pick.disconnect(); for (const x of rig.picks || []) x.pick.disconnect(); } catch { /* ok */ } rig = null; }
      const was = state.open;
      state.open = false;
      state.split = null;
      state.firstFrame = null;
      // (quiet: open() is about to reopen and wire the monitor again)
      if (!quiet) { report(false); markMonitored(null); }
      if (was && !quiet) { changed(); pathEvt('close'); }
    },
    setChannel(ch) { stopPicking(); picker.channel = state.channel = String(ch); persist(); if (state.open) return audio.open({ channel: picker.channel }); changed(); return null; },
    setDevice(id) { picker.deviceId = state.deviceId = id; persist(); if (state.open) return audio.open({ device: id }); changed(); return null; },
    // another channel of the device open now, picked in place: the stream, the monitor and the capture carry on.
    // (auto: the first strum's pick, ./start.js's and this file's own; anything else is a pick by hand)
    useChannel(ch, { auto = false } = {}) {
      if (!auto) stopPicking();
      const c = String(ch), k = parseInt(c, 10);
      if (!rig || rig.picks || !/^\d+$/.test(c) || !(k >= 1) || k > state.channels || !ctx) return audio.setChannel(c);
      if (String(state.channel) === c) return state;
      try { rig.src.disconnect(rig.pick); } catch { /* not wired that way */ }
      if (rig.sp) { try { rig.sp.disconnect(rig.pick); } catch { /* not wired that way */ } }
      else { rig.sp = ctx.createChannelSplitter(Math.max(2, state.channels)); rig.src.connect(rig.sp); }
      rig.sp.connect(rig.pick, k - 1);
      rig.peak = 0;
      state.channel = c;
      if (!state.forTrack) { picker.channel = c; persist(); }
      changed();
      pathEvt('channel');
      return state;
    },
    // every channel of the device, as it is now (an analyser on each, made the first time it's asked)
    levels() {
      if (!rig || !ctx) return [];
      if (!rig.lv) {
        const n = Math.max(1, Math.min(8, state.channels || 1));
        if (n < 2) rig.lv = { an: [rig.an], buf: rig.buf };
        else {
          const sp = ctx.createChannelSplitter(Math.max(2, n));
          rig.src.connect(sp);
          const an = [];
          for (let i = 0; i < n; i++) { const a = ctx.createAnalyser(); a.fftSize = 2048; sp.connect(a, i); an.push(a); }
          rig.lv = { sp, an, buf: new Float32Array(2048) };
        }
      }
      return rig.lv.an.map((a, i) => {
        const b = rig.lv.buf.length === a.fftSize ? rig.lv.buf : new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(b);
        let pk = 0; for (let j = 0; j < b.length; j++) { const v = Math.abs(b[j]); if (v > pk) pk = v; }
        return { ch: i + 1, peak: pk, db: 20 * Math.log10(pk + 1e-9) };
      });
    },

    level() {
      if (!rig) return { peak: 0, db: -120, clip: false, lvl: 0 };
      rig.an.getFloatTimeDomainData(rig.buf);
      let pk = 0; for (let i = 0; i < rig.buf.length; i++) { const v = Math.abs(rig.buf[i]); if (v > pk) pk = v; }
      rig.peak = Math.max(pk, rig.peak * 0.9);
      const now = performance.now();
      if (pk > 0.89) rig.clipAt = now;
      const db = 20 * Math.log10(rig.peak + 1e-9);
      return { peak: rig.peak, db, clip: now - rig.clipAt < 1200, lvl: Math.max(0, Math.min(1, (db + 60) / 60)) };
    },
    // the tuner: YIN on the analyser at most 25 times a second (input/pitch.js createTuner). { lo, hi } in Hz is the
    // instrument's range (default 38-1400 Hz: down to a bass's low E): the Jam room passes its tuning's low string and
    // top fret, so a chord's common period (A1 under an A7) is never a note. One tuner (and its 40 ms) per range.
    tune({ lo = 38, hi = 1400 } = {}) {
      if (!rig) return null;
      lo = Number.isFinite(+lo) && +lo >= 20 ? +lo : 38;
      hi = Number.isFinite(+hi) && +hi > lo * 1.5 ? Math.min(+hi, 5000) : Math.max(1400, lo * 1.5);
      const k = `${lo.toFixed(2)}|${hi.toFixed(2)}`;
      let tu = tuners.get(k);
      if (!tu) { if (tuners.size >= 4) tuners.clear(); tu = { at: 0, last: null, tuner: createTuner({ lo, hi }) }; tuners.set(k, tu); }
      const now = performance.now();
      if (now - tu.at < 40) return tu.last;
      tu.at = now;
      rig.an.getFloatTimeDomainData(rig.buf);
      tu.last = tu.tuner.push(rig.buf, ctx.sampleRate, now / 1000);
      return tu.last;
    },

    tap(node) {
      if (!node) return () => {};
      taps.add(node);
      if (rig && node.context === ctx) { try { rig.pick.connect(node); } catch { /* not this context's */ } }
      return () => { if (!taps.delete(node)) return; if (rig) { try { rig.pick.disconnect(node); } catch { /* not wired */ } } };
    },

    samples() {
      if (!rig || !ctx) return null;
      rig.an.getFloatTimeDomainData(rig.buf);
      return { buf: rig.buf, sr: ctx.sampleRate };
    },

    listen(fn) {
      listeners.add(fn);
      if (state.open && !cap) attachCap();
      return () => { listeners.delete(fn); if (!listeners.size && cap && !recording) { try { cap.port.postMessage('off'); cap.disconnect(); } catch { /* ok */ } cap = null; capReady = null; } };
    },

    // The audio context awake: resumed if the browser paused it (a room calls this on any key or click; open() does).
    // -> true once it runs
    async wake() {
      const c = engine.ctx || ctx;
      if (!c) return false;
      if (c.state !== 'running' && c.state !== 'closed') { try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 250))]); } catch { /* a gesture first */ } }
      return c.state === 'running';
    },

    /* ---- monitoring: the input through the record track's inserts, as you play */
    // the track the monitor plays through now, or null: monitoring off, held, the input closed, or waiting for an audio
    // track (state.monitorWaiting)
    monitorTrack: () => (monDest ? store.track(monDest.track) : null),
    // by hand: for the input open now (or the next one opened): kept for that device for the page's life
    monitor(on = !state.monitoring) {
      if (state.open) decide(!!on, { by: 'hand', id: decisionKey() });
      else { pending = { on: !!on }; decide(!!on, { by: 'hand', id: null }); }
      syncMonitor();
      changed();
      pathEvt('decision');
      return state.monitoring;
    },
    // a mute for a moment that leaves the decision alone (the tuner's 'tuner'): heard again when the last hold goes
    hold(reason = 'hold') {
      const k = String(reason);
      if (holds.has(k)) return state.monitorHolds;
      holds.add(k);
      state.monitorHolds = [...holds];
      syncMonitor();
      changed();
      pathEvt('hold');
      return state.monitorHolds;
    },
    release(reason = 'hold') {
      if (!holds.delete(String(reason))) return state.monitorHolds;
      state.monitorHolds = [...holds];
      syncMonitor();
      changed();
      pathEvt('hold');
      return state.monitorHolds;
    },
    // The killswitch's (ui/transport.js silenceAll, before engine.silence): an interface keeps its decision (a guitar
    // can't howl; it's heard again when the speakers open); a microphone, a virtual input or one it can't name is turned
    // off by hand (the howl the killswitch was pressed for)
    hush() {
      if (!state.monitoring || state.inputKind === 'interface') return false;
      if (state.open) decide(false, { by: 'hand', why: state.inputKind === 'mic' ? 'mic' : '', id: decisionKey() });
      else { pending = { on: false }; decide(false, { by: 'hand', id: null }); }
      syncMonitor({ fast: true });
      changed();
      pathEvt('decision');
      return true;
    },
    // What the room is: 'instrument' in the guitar room (a guitar through an interface is expected), '' elsewhere. An
    // input decided by itself (or by an opener) is decided again for it; a decision made by hand stands.
    role(r = '') {
      const v = String(r || '');
      if (v === state.role) return state.role;
      state.role = v;
      if (state.open && !rig?.picks && decision && (decision.by === 'auto' || decision.by === 'open')) {
        autoDecide(decision.for);
        syncMonitor();
        changed();
        pathEvt('decision');
      }
      return state.role;
    },
    get _monitorGain() { return mon ? mon.gain.value : null; },   // (checks: the ramp in)
    // Where it plays: a track id, or a function asked at every sync (the guitar room's: the side a take records, else
    // Guitar L), or null for the usual rule (the armed audio track, else the selected one, else the first). A track
    // that's gone or isn't an audio track falls back to the usual rule. What a take records onto is unchanged.
    monitorVia(v = null) {
      via = typeof v === 'function' ? v : v ? String(v) : null;
      if (rig) syncMonitor();
      pathEvt('target');
    },
    // the monitor unwired and wired again (the path's repair when the input wasn't reaching the strip)
    rewire() {
      if (!rig) return false;
      if (rig.picks) { for (const x of rig.picks) fadeOut(x, true); } else unwireMonitor(true);
      syncMonitor();
      return true;
    },

    /* ---- recording: the recorder (input/recorder.js) records the mic onto the armed audio track */
    recordTrack: () => recordTrack(false),
    get recording() { return recording; },
    _recording(on) { recording = !!on; state.recording = recording; changed(); },
    setCountIn(v) { state.countIn = !!v; persist(); recorder()?.setCountIn(v ? 1 : 0); changed(); },
    async toggleRecord(o) { return recorder()?.state !== 'idle' ? audio.stopRecord() : audio.record(o); },
    // R for audio: onto `track` (or the armed / selected audio track; one is made if there is none)
    async record({ track = null, countIn = state.countIn } = {}) {
      const rc = recorder();
      if (!rc) return null;
      if (rc.state !== 'idle') return rc.live();
      const t = track ? store.track(track) : recordTrack(true);
      if (!t) return null;
      const bars = countIn === true ? Math.max(1, rc.countIn) : +countIn || 0;
      return rc.record({ audio: t.id, countIn: bars });
    },
    // -> { track, clip, asset, seconds, startBeat, latency } of the take that plays (the last pass), or null
    async stopRecord({ keepPlaying = false } = {}) {
      const rc = recorder();
      if (!rc || rc.state === 'idle') return null;
      const res = await rc.stop({ keepPlaying });
      if (!res || !res.ok || !res.audio) return null;
      const part = res.parts.find((x) => x.kind === 'audio' || (store.track(x.track)?.kind === 'audio'));
      const t = part ? store.track(part.track) : null;
      const clip = t ? t.clips.filter((c) => c.kind === 'audio' && c.asset === res.audio.asset && !c.mute).pop() || t.clips.filter((c) => c.asset === res.audio.asset).pop() : null;
      return clip ? { track: t.id, clip: clip.id, asset: res.audio.asset, seconds: res.audio.seconds, startBeat: clip.start, latency: audio.latency.get() } : null;
    },
    latency: null,
  };
  audio.latency = createLatency(audio);

  // the output latency the engine's playhead uses (engine.beat is what is heard now)
  function outLat() { const c = engine.ctx || ctx; return c ? (c.outputLatency || c.baseLatency || 0) : 0; }
  audio.outLatency = outLat;
  // the track the monitor plays through: monitorVia's while it names an audio track, else the record track
  function viaId() {
    if (typeof via === 'function') { try { const v = via(); return v ? String(v) : null; } catch (e) { console.warn('input: monitorVia', e); return null; } }
    return via;
  }
  function monitorTarget() {
    const id = viaId(), t = id ? store.track(id) : null;
    return t && t.kind === 'audio' ? t : recordTrack(false);
  }
  // The audio track a take goes to: the armed one, else the selected audio track, else the first; arm it if asked to.
  // With no audio track at all, make one (never a dead end).
  function recordTrack(make) {
    const p = store.get(), sel = app.ui?.state?.selection?.track;
    const audios = p.tracks.filter((t) => t.kind === 'audio');
    const t = audios.find((x) => x.arm) || audios.find((x) => x.id === sel) || audios[0] || null;
    if (!make) return t;
    if (!t) {
      const r = store.dispatch({ type: 'track.add', ref: 'rec', track: { name: 'Audio', kind: 'audio', arm: true } }, { by: 'you', label: 'add an audio track to record on' });
      return r.ok ? store.track(r.created.rec || r.created.track) : null;
    }
    if (!t.arm) store.dispatch({ type: 'track.set', track: t.id, patch: { arm: true } }, { by: 'you', label: `arm ${t.name}` });
    return store.track(t.id);
  }

  // the capture's module, loaded once per context
  function capModule(c) {
    if (!c.__ewCap) c.__ewCap = c.audioWorklet.addModule(CAP_WORKLET).then(() => true, () => false);
    return c.__ewCap;
  }
  async function attachCap() {
    if (!rig) return null;
    if (cap) return cap;
    if (!capReady) {
      capReady = (async () => {
        const c = ctx, r = rig;
        if (!(await capModule(c))) throw new Error('This browser can’t capture audio (no AudioWorklet).');
        if (rig !== r) return null;
        // (a split: each channel's pick, side by side, into a capture as wide)
        const w = r.picks ? r.picks.length : 1;
        const node = new AudioWorkletNode(c, 'ew-cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: w, channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { channels: w } });
        node.port.onmessage = (e) => {
          if (state.firstFrame == null && e.data && Number.isFinite(e.data.f)) state.firstFrame = e.data.f;
          for (const fn of [...listeners]) { try { fn(e.data); } catch (err) { console.error('input listener', err); } }
        };
        if (r.picks) {
          const m = c.createChannelMerger(w);
          r.picks.forEach((x, i) => x.pick.connect(m, 0, i));
          m.connect(node);
          r.merge = m;
        } else r.pick.connect(node);
        cap = node;
        return node;
      })();
    }
    return capReady;
  }

  // Monitoring is heard while it's decided on and nothing holds it (state.monitoring, state.monitorHolds), wired through
  // the track monitorVia names (or the one a take would go to). With no audio track it stays on and waits:
  // state.monitorWaiting, monitorTrack() null and 'monitor' { track: null, waiting: true } (the Jam room remakes its Live
  // guitar then); it says so once, and wires itself as soon as there's one. Wiring follows the track and its strip, never
  // a mere change: a knob, a tone flip or a note leaves it alone. Decided by itself it comes in over 150 ms; by hand, at
  // once. While it's wired the feedback guard listens to the input. The engine is told which strip it plays through
  // (engine.monitored: the polite stop leaves that one alone).
  function syncMonitor({ fast = false } = {}) {
    clearTimeout(syncT); syncT = 0;
    if (rig && rig.picks) { syncSplit(fast); return; }
    const target = state.monitoring && rig && ctx ? monitorTarget() : null;
    markMonitored(target ? target.id : null);
    const want = target && !holds.size ? target : null;
    const dest = want && engine.inputNode ? engine.inputNode(want.id) : null;
    const ok = !!dest && dest.context === ctx;
    if (!(ok && mon && monDest && monDest.node === dest && monDest.track === want.id)) {
      unwireMonitor(fast);
      if (ok) {
        mon = ctx.createGain(); mon.gain.value = 0;
        rig.pick.connect(mon); mon.connect(dest);
        const now = ctx.currentTime;
        if (state.monitorAuto) { mon.gain.setValueAtTime(0, now); mon.gain.linearRampToValueAtTime(1, now + 0.15); }
        else mon.gain.setTargetAtTime(1, now, 0.015);
        monDest = { node: dest, track: want.id };
        listen();
      }
    }
    report(!!(state.monitoring && rig && !holds.size && !target));
  }
  function markMonitored(id) {
    if (id === monitoredId) return;
    monitoredId = id;
    try { engine.monitored?.(id); } catch { /* the silent engine */ }
  }
  // the key the decision is made for: the device's real id (the browser's default resolved), else what was opened
  const decisionKey = () => state.realId || state.settings?.deviceId || state.deviceId || '';
  // monitoring on or off for an input (id): by itself ('auto'), by the opener ('open'), by hand ('hand') or by the
  // feedback guard ('guard'); off for a reason ('mic', 'virtual', 'feedback') or none. By hand and by the guard, it's
  // kept for that device.
  function decide(on, { by = 'auto', why = '', id = decision ? decision.for : null } = {}) {
    const was = state.monitoring;
    decision = { for: id, on: !!on, by, why: on ? '' : why, role: state.role };
    if (id && (by === 'hand' || by === 'guard')) hand.set(id, { on: !!on, by, why: decision.why });
    state.monitoring = !!on; state.monitorAuto = !!on && by === 'auto'; state.monitorBy = by; state.monitorOff = on ? '' : why;
    if (!on) warned = false;
    if (was !== state.monitoring) pathEvt('decision');
  }
  function autoDecide(id) {
    const a = autoMonitor({ kind: state.inputKind, channels: state.channels, role: state.role });
    decide(a.on, { by: 'auto', why: a.why, id });
  }
  // the feedback guard: the input every 50 ms (a worker's clock: a tab in the background still hears it) while the
  // monitor is wired; a trip fades the monitor out fast, turns monitoring off and says so once. An interface is skipped:
  // a guitar into one can't hear the speakers, and a clean, compressed note under long delays reads as a tone ringing up
  function listen() {
    if (stopGuard) return;
    guard = guard || createFeedbackGuard();
    guard.reset();
    stopGuard = ticker(() => {
      if (!mon || !rig || !ctx) return;
      if (state.inputKind === 'interface') { guard.reset(); return; }
      rig.an.getFloatTimeDomainData(rig.buf);
      if (!guard.push(rig.buf, ctx.sampleRate, ctx.currentTime)) return;
      decide(false, { by: 'guard', why: 'feedback', id: decisionKey() });
      syncMonitor({ fast: true });
      changed();
      app.ui?.toast?.(FEEDBACK_LINE, { kind: 'bad' });
    }, 50);
  }
  // the monitor's state, told when it changes ('monitor', then 'audio'); with no track to play through, said once (until
  // it wires or monitoring goes off), unless a listener made one just now
  function report(waiting) {
    const track = monDest ? monDest.track : null;
    if (track) warned = false;
    if ((state.monitorTrack ?? null) === track && !!state.monitorWaiting === waiting) return;
    state.monitorTrack = track; state.monitorWaiting = waiting;
    input.emit('monitor', { track, waiting });
    changed();
    if (waiting && !warned && !monitorTarget()) {
      warned = true;
      app.ui?.toast?.('Monitoring waits for an audio track. Add one and you hear the input through its pedals and amp.');
    }
  }
  function unwireMonitor(fast = false) {
    if (stopGuard) { stopGuard(); stopGuard = null; }
    if (!mon) return;
    const m = mon;
    mon = null; monDest = null;
    // (from where it is: a ramp in still going is held there, not finished, then faded)
    try { const t = ctx.currentTime, v = m.gain.value; m.gain.cancelScheduledValues(t); m.gain.setValueAtTime(v, t); m.gain.setTargetAtTime(0, t, fast ? 0.004 : 0.01); } catch { /* ok */ }
    setTimeout(() => { try { m.disconnect(); } catch { /* ok */ } }, 80);
  }
  // A split's monitoring: each channel through its own track's strip while monitoring is on (and not held) and that
  // channel isn't kept out of it (monitor: false: a mic on speakers), and the feedback guard on each mic channel that
  // plays, whatever the device is (a mic on an interface's input 1 hears the speakers as any mic does). A trip takes
  // that channel out.
  function syncSplit(fast = false) {
    if (stopGuard) { stopGuard(); stopGuard = null; }
    if (mon) unwireMonitor(fast);
    let first = null;
    for (const x of rig.picks) {
      const t = state.monitoring && !holds.size && x.monitor !== false && x.track ? store.track(x.track) : null;
      const dest = t && engine.inputNode ? engine.inputNode(t.id) : null;
      const ok = !!dest && dest.context === ctx;
      if (ok && x.mon && x.dest === dest) { first = first || t.id; continue; }
      fadeOut(x, fast);
      if (!ok) continue;
      x.mon = ctx.createGain(); x.mon.gain.value = 0;
      x.pick.connect(x.mon); x.mon.connect(dest);
      x.mon.gain.setTargetAtTime(1, ctx.currentTime, 0.015);
      x.dest = dest;
      first = first || t.id;
    }
    markMonitored(first);
    const mics = rig.picks.filter((x) => x.mic && x.mon);
    if (mics.length && !rig.stopGuards) {
      for (const x of mics) { x.guard = x.guard || createFeedbackGuard(); x.guard.reset(); }
      rig.stopGuards = ticker(() => {
        if (!rig || !rig.picks || !ctx) return;
        for (const x of rig.picks) {
          if (!x.mic || !x.mon || !x.guard) continue;
          x.an.getFloatTimeDomainData(x.buf);
          if (!x.guard.push(x.buf, ctx.sampleRate, ctx.currentTime)) continue;
          x.monitor = false;
          fadeOut(x, true);
          state.monitorOff = 'feedback';
          changed();
          app.ui?.toast?.(FEEDBACK_LINE, { kind: 'bad' });
        }
      }, 50);
    } else if (!mics.length && rig.stopGuards) { rig.stopGuards(); rig.stopGuards = null; }
    if ((state.monitorTrack ?? null) !== first) { state.monitorTrack = first; state.monitorWaiting = false; input.emit('monitor', { track: first, waiting: false }); changed(); }
  }
  function fadeOut(x, fast) {
    if (!x.mon) return;
    const m = x.mon;
    x.mon = null; x.dest = null;
    try { const t = ctx.currentTime, v = m.gain.value; m.gain.cancelScheduledValues(t); m.gain.setValueAtTime(v, t); m.gain.setTargetAtTime(0, t, fast ? 0.004 : 0.01); } catch { /* ok */ }
    setTimeout(() => { try { m.disconnect(); } catch { /* ok */ } }, 80);
  }
  function unwireSplit() {
    if (!rig || !rig.picks) return;
    if (rig.stopGuards) { rig.stopGuards(); rig.stopGuards = null; }
    for (const x of rig.picks) fadeOut(x, false);
  }
  // split's channels: [{ ch, track, monitor, mic }] from { 1: track | { track, monitor, mic }, ... }, or null
  function splitOf(split) {
    if (!split || typeof split !== 'object') return null;
    const out = [];
    for (const [k, v] of Object.entries(split)) {
      const ch = parseInt(k, 10), o = v && typeof v === 'object' ? v : { track: v };
      if (!(ch >= 1 && ch <= 32) || !o.track) continue;
      out.push({ ch, track: String(o.track), monitor: o.monitor !== false, mic: !!o.mic });
    }
    out.sort((a, b) => a.ch - b.ch);
    return out.length >= 2 ? out : null;
  }

  // The channel that moves on the first strum, listened for after an instrument's open (the guitar room's, openBest
  // with role 'instrument'): each channel's peak held over half a second; the one 12 dB over the rest (pickChannel), or,
  // every channel moving together for a second (one source on a stereo input), the loudest. Picked in place; a channel
  // picked by hand meanwhile ends it. Two minutes at most.
  function listenForChannel() {
    stopPicking();
    if (!rig || rig.picks || state.channels < 2) return;
    const P = { holds: [], together: 0, t0: performance.now(), iv: 0 };
    picking = P;
    state.picking = true;
    P.iv = setInterval(() => {
      if (picking !== P) return;
      if (!rig) { stopPicking(); return; }
      const now = performance.now();
      if (now - P.t0 > 120000) { stopPicking(); return; }
      let lv = [];
      try { lv = audio.levels(); } catch { lv = []; }
      if (lv.length < 2) { stopPicking(); return; }
      P.holds.push({ t: now, v: lv.map((x) => x.db) });
      while (P.holds.length && P.holds[0].t < now - 500) P.holds.shift();
      const hold = lv.map((_, i) => Math.max(...P.holds.map((x) => x.v[i] ?? -Infinity)));
      let ch = pickChannel(hold);
      const top = Math.max(...hold);
      if (!ch && top >= -50) { if (!P.together) P.together = now; else if (now - P.together >= 1000) ch = hold.indexOf(top) + 1; } else if (!ch) P.together = 0;
      if (!ch) return;
      stopPicking();
      if (String(state.channel) !== String(ch)) audio.useChannel(ch, { auto: true });
    }, 50);
  }
  function stopPicking() {
    if (!picking) return;
    clearInterval(picking.iv);
    picking = null;
    if (state.picking) { state.picking = false; changed(); }
  }

  // The input went away (its stream ended, or it's gone from the list): closed, said, and opened again when it's back
  function wentAway() {
    if (!state.open) return;
    lost = { id: state.realId, channel: String(state.channel), label: state.label, role: state.role, capture: !!cap || listeners.size > 0 };
    const label = state.label;
    audio.close();
    speak('gone', { label }, { kind: 'bad' });
  }

  // (after the engine has caught up with the change: one sync for a burst of them)
  const later = () => { if (!syncT) syncT = setTimeout(syncMonitor, 0); };
  // keep the monitor on the right track: another armed, one made or deleted, a new song, the engine rebuilding its strip
  store.on('change', () => {
    if (!state.monitoring || !rig) return;
    if (rig.picks) { later(); return; }
    const t = monitorTarget(), id = t ? t.id : null;
    if (id !== monitoredId || id !== (monDest ? monDest.track : null) || (t && monDest && engine.inputNode && monDest.node !== engine.inputNode(t.id))) later();
  });
  try { engine.on('graph', (e) => { if (state.monitoring && rig && (!e || e.kind === 'track')) later(); }); } catch { /* ok */ }
  // an interface plugged in (or out) shows up without a reload; the one open going away closes, and comes back by itself
  try {
    const md = navigator.mediaDevices;
    if (md && md.addEventListener) md.addEventListener('devicechange', async () => {
      const list = await audio.devices();
      input.emit('devices', list);
      app.ui?.emit?.('input:devices', list);
      if (state.open && state.realId && !list.some((d) => d.id === state.realId)) wentAway();
      else if (!state.open && lost && lost.id && list.some((d) => d.id === lost.id)) {
        const l = lost;
        lost = null;
        try {
          await audio.open({ device: l.id, channel: l.channel, role: l.role, capture: l.capture });
          speak('back', { label: state.label });
        } catch (e) { console.warn('input: back', e); }
      }
    });
  } catch { /* node */ }
  return audio;
}
export { dB };
