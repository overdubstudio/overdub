// @ts-check
// The live path: the guitar (or any input) from the jack to the speakers, through the monitored track's chain
// (docs/research/AMP-PATH.md). app/src/input/ owns it end to end: audioin.js the input and the monitor, this file the
// rules they follow and the check that the path works.
//
// [frozen seam: amp/base] The policies below are pure and frozen (test/unit/livepath.test.js holds them):
//   autoMonitor({ kind, channels, role }) -> { on, why }      monitoring decided by itself for an input as it opens
//   chooseInput(list, { remembered, channel, role }) -> { device, channel, why, reask }   which input to open
//   realIdOf(list, { deviceId, groupId, label }) -> id | ''   the device behind the browser's "Default - " entry
//   pathVerdict(snapshot) -> { state, repair, insert, key, line }   what the health check makes of one measurement
//   LINES, say(key, vars)                                     what the path says (the talkback in a room, else a toast)
//   HEALTH                                                    the check's timing and thresholds
//
// [built by the path stream; the API is frozen here]
//   createLivePath(app, audio) -> app.input.path
//     path.status() -> { state, repair, insert, key, line, at, levels: { in, strip, chain }, tries }  (= audio.state.path)
//     path.check({ repair = true } = {}) -> Promise<status>   measure now, and repair what the verdict asks for
//     path.wake() -> Promise<boolean>   resume the audio context (a room calls it on any key or click)
//     app.input emits 'path' (the status) when the state changes; a repair says its line once per episode
//   audio (audioin.js) adds: choose({ role }) -> chooseInput's answer for the inputs there now; openBest({ role, capture })
//     (choose, open, and on a blind first open choose again once the labels are in); hold(reason) / release(reason)
//     (a mute that ends: the tuner's); hush() (the killswitch's: an interface keeps its decision, anything else is
//     turned off by hand); wake(); monitorVia(trackId | () => trackId | null); state.monitorHolds, state.path,
//     state.realId. Closing an input never records a decision.
//   engine adds: monitored(trackId | null) (the polite stop leaves that strip alone), rebuild(trackId) -> Promise<{ ok,
//     failed: [insertId] }> (the strip renewed, atomically), chainTaps(trackId) -> { input, chain } | null (the strip's
//     input and its chain's end, to listen to; never fed)
//
// Roles: 'instrument' (the guitar room, a take there, its soundcheck: a guitar through an interface is expected) or ''
// (anywhere else).

import { healthOf, assure } from '../devices/lifecycle.js';

/** An input is: 'interface' | 'mic' | 'virtual' | '' (audioin.js inputKind). */

/**
 * Monitoring, decided by itself for an input as it opens (by hand it's whatever the person said). The label decides
 * what an input is, not how it was picked: an interface opened as the browser's "Default - " entry monitors too.
 * @param {{ kind?: string, channels?: number, role?: string }} o
 * @returns {{ on: boolean, why: '' | 'mic' | 'virtual' }}
 */
export function autoMonitor({ kind = '', channels = 0, role = '' } = {}) {
  if (kind === 'interface') return { on: true, why: '' };
  if (kind === 'mic') return { on: false, why: 'mic' };
  if (kind === 'virtual') return { on: false, why: 'virtual' };
  // (an input it can't name, with an interface's channels, in the guitar room: a guitar)
  if (role === 'instrument' && channels >= 2) return { on: true, why: '' };
  return { on: false, why: '' };
}

const isAlias = (id) => !id || id === 'default' || id === 'communications';
const bare = (label) => String(label || '').replace(/^(default|communications)\s*[-–:]\s*/i, '').trim();

/**
 * The device behind an entry: its own id, or for the browser's "Default - " (or "Communications - ") entry the entry
 * with the same group id (else the same name). '' when it can't tell.
 * @param {Array<{ id: string, label?: string, groupId?: string }>} list  the inputs (enumerateDevices, audioinput)
 * @param {{ deviceId?: string, groupId?: string, label?: string }} got  what was opened (track.getSettings() and label)
 */
export function realIdOf(list, { deviceId = '', groupId = '', label = '' } = {}) {
  if (!isAlias(deviceId)) return deviceId;
  const real = (Array.isArray(list) ? list : []).filter((d) => d && !isAlias(d.id));
  const name = bare(label);
  const byGroup = groupId ? real.filter((d) => d.groupId === groupId) : [];
  if (byGroup.length === 1) return byGroup[0].id;
  const pool = byGroup.length ? byGroup : real;
  const byName = name ? pool.filter((d) => bare(d.label) === name) : [];
  if (byName.length === 1 || (byGroup.length && byName.length)) return byName[0].id;
  return '';
}

/**
 * Which input to open. Every opener asks this (the guitar room's tuner and Getting started, a take, Sketch's Open, the
 * soundcheck), so they can't disagree.
 *   - no labels yet (no standing microphone grant): the browser's default, and reask: choose again once it's open
 *   - the remembered device, when it's here (never the "Default - " entry: that's resolved to its device first); in
 *     the guitar room an interface outranks a remembered microphone
 *   - else an interface, by its own entry
 *   - else the device the browser's default names, else the default itself
 * The channel is the remembered one, except on a microphone (input 1).
 * why: 'blind' | 'remembered' | 'instrument' (an interface over the remembered mic) | 'interface' | 'moved' (the
 * remembered device isn't here; an interface is) | 'gone' (it isn't, and no interface is) | 'default'
 * @param {Array<{ id: string, label?: string, groupId?: string, kind?: string }>} list  the inputs, each with its kind
 * @param {{ remembered?: string, channel?: string, role?: string }} o
 * @returns {{ device: string, channel: string, why: string, reask: boolean }}
 */
export function chooseInput(list, { remembered = '', channel = '1', role = '' } = {}) {
  const L = (Array.isArray(list) ? list : []).filter((d) => d && typeof d === 'object');
  const ch = String(channel || '1');
  if (!L.length || L.every((d) => !d.label)) return { device: '', channel: ch, why: 'blind', reask: true };
  const real = L.filter((d) => !isAlias(d.id));
  const kindOf = (d) => (d && d.kind) || '';
  const out = (d, why) => ({ device: d ? d.id : '', channel: d && kindOf(d) === 'mic' ? '1' : ch, why, reask: false });
  // (a remembered "Default - " entry is the device it named)
  const def = L.find((d) => d.id === 'default');
  const memId = remembered === 'default' && def ? realIdOf(L, { deviceId: 'default', groupId: def.groupId, label: def.label }) : remembered;
  const mem = !isAlias(memId) ? real.find((d) => d.id === memId) : null;
  const iface = real.find((d) => kindOf(d) === 'interface');
  if (mem && !(role === 'instrument' && kindOf(mem) === 'mic' && iface)) return out(mem, 'remembered');
  const lost = !mem && !isAlias(remembered);
  if (iface) return out(iface, mem ? 'instrument' : lost ? 'moved' : 'interface');
  const named = def ? real.find((d) => d.id === realIdOf(L, { deviceId: 'default', groupId: def.groupId, label: def.label })) : null;
  return out(named || null, lost ? 'gone' : 'default');
}

/** The health check's timing (ms) and thresholds (dBFS peak over an analyser's window). */
export const HEALTH = Object.freeze({
  after: 300,      // a check this long after anything that can change the path (an open, a decision, a target, a 'graph')
  every: 2000,     // and this often while monitoring is on and the input is over `quiet`
  quiet: -60,      // under this at the input there's nothing to judge
  playing: -40,    // over this at the strip, the chain's end must move too (a gate may close under it)
  drop: 30,        // the strip this far under the input: the monitor isn't reaching it
  silent: -80,     // the chain's end under this while the strip plays: nothing gets through
  dryCorr: 0.995,  // the chain's end this alike to the strip's input (best normalised cross-correlation): dry
  settle: 150,     // a device's fade is over this long after a switch (graph.js's is 10 ms; a crossfade 30)
  tries: 3,        // rebuilds in one episode before it says it gave up
  backoff: 5000,   // between two rebuilds in one episode
});

/** What the path says. {track}, {device}, {label}: filled by say(). The house's voice: unsigned. */
export const LINES = Object.freeze({
  off: 'Monitoring is off, so the rig can’t hear you. Press M to play through it.',
  offMic: 'Monitoring is off: this is a microphone, and through speakers it would howl. Use headphones, then press M.',
  suspended: 'The browser paused the audio. Press any key to bring it back.',
  noEngine: 'The studio’s audio didn’t start, so the rig can’t play. Reload the page; the song is saved.',
  unwired: 'Your input wasn’t reaching {track}. Plugged it back in.',
  standIn: '{device} didn’t build, so you were going round it dry. Rebuilt the chain.',
  stuck: '{device} was stuck half on. Set it right.',
  silent: 'Nothing was getting through {track}’s chain. Rebuilt it.',
  dry: 'The amp came up dry. Rebuilt the chain.',
  muted: '{track} is muted in the control room, so you can’t hear the rig.',
  gaveUp: 'The chain still isn’t passing your guitar after three rebuilds. Reload the page; the song is saved.',
  moved: 'Opened {label}: the input you used last time isn’t plugged in.',
  gone: '{label} went away (unplugged or switched off).',
  back: '{label} is back. Plugged in again.',
  processed: 'The browser kept its voice cleanup on for {label}: the amp hears a gated signal. Pick the interface itself.',
});
/** @param {string} key  @param {Record<string, string>} [vars] */
export function say(key, vars = {}) {
  const s = LINES[key] || '';
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : k === 'track' ? 'the track' : k === 'device' ? 'A pedal' : 'The input'));
}

/**
 * The health check's verdict on one measurement. First match wins:
 *   closed, suspended (repair 'resume'), no-engine, off, held, waiting, quiet, unwired ('rewire'), stand-in
 *   ('rebuild'), stuck ('assure'), silent ('rebuild'), dry ('rebuild'), muted, ok
 * @param {{
 *   open?: boolean, ctx?: string, engine?: boolean, monitoring?: boolean, monitorOff?: string, holds?: string[],
 *   track?: { id: string, name?: string } | null, audible?: boolean,
 *   levels?: { in?: number, strip?: number, chain?: number },
 *   inserts?: Array<{ id: string, device?: string, name?: string, on?: boolean, amp?: boolean,
 *     health?: { ok: boolean, failed: string, settled: boolean, known?: boolean } }>,
 *   dryLike?: boolean | null,
 * }} s
 * @returns {{ state: string, repair: 'none' | 'resume' | 'rewire' | 'assure' | 'rebuild', insert: string | null, key: string, line: string }}
 */
export function pathVerdict(s = {}) {
  const lv = s.levels || {}, num = (x) => (Number.isFinite(x) ? x : -Infinity);
  const inDb = num(lv.in), stripDb = num(lv.strip), chainDb = num(lv.chain);
  const track = s.track || null, vars = { track: track ? track.name || '' : '' };
  /** @param {string} state @param {'none' | 'resume' | 'rewire' | 'assure' | 'rebuild'} [repair] @param {string} [key] @param {{ id: string } | null} [insert] @param {Record<string, string>} [more] */
  const V = (state, repair = 'none', key = '', insert = null, more = {}) => ({ state, repair, insert: insert ? insert.id : null, key, line: key ? say(key, { ...vars, ...more }) : '' });
  if (!s.open) return V('closed');
  if (s.ctx !== 'running') return V('suspended', 'resume', 'suspended');
  if (s.engine === false) return V('no-engine', 'none', 'noEngine');
  if (!s.monitoring) return V('off', 'none', s.monitorOff === 'mic' ? 'offMic' : s.monitorOff === 'feedback' ? '' : 'off');
  if (s.holds && s.holds.length) return V('held');
  if (!track) return V('waiting');
  if (inDb < HEALTH.quiet) return V('quiet');
  if (stripDb < inDb - HEALTH.drop) return V('unwired', 'rewire', 'unwired');
  const ins = Array.isArray(s.inserts) ? s.inserts : [];
  const nameOf = (x) => x.name || x.device || '';
  const standIn = ins.find((x) => x.health && x.health.failed);
  if (standIn) return V('stand-in', 'rebuild', 'standIn', standIn, { device: nameOf(standIn) });
  const stuck = ins.find((x) => x.health && x.health.known !== false && !x.health.ok && x.health.settled);
  if (stuck) return V('stuck', 'assure', 'stuck', stuck, { device: nameOf(stuck) });
  if (stripDb >= HEALTH.playing && chainDb < HEALTH.silent) return V('silent', 'rebuild', 'silent');
  if (stripDb >= HEALTH.playing && s.dryLike === true && ins.some((x) => x.on && x.amp)) return V('dry', 'rebuild', 'dry');
  if (s.audible === false) return V('muted', 'none', 'muted');
  return V('ok');
}

/* ---------------------------------------------------------------------------------------------- the check, running */
// createLivePath(app, audio) -> app.input.path [built by the path stream: docs/research/AMP-PATH.md §7]. Live only, and
// it only listens: an analyser off the input's pick (audio.tap), the monitored strip's input and its chain's end
// (engine.chainTaps), plus what each wired insert says about itself (devices/lifecycle.js healthOf). Nothing it adds
// changes what is heard; a repair does (audio.rewire, lifecycle assure, engine.rebuild), and says so once per episode.
//   path.status()          the last verdict: { state, repair, insert, key, line, at, levels: { in, strip, chain }, tries }
//   path.check({ repair })  measure now (and repair what the verdict asks for) -> Promise<status>
//   path.wake()            the audio context resumed (any key or click in a room calls it)
//   path.speaker(fn | null)  where its lines go: fn(line, { key }) (the guitar room's talkback, R.say by the house),
//                          else a toast. Device lines (moved, gone, back, processed) go the same way, from audioin.js
//   path.speak(line, o)    say a line there now
// An episode starts at the first verdict that isn't ok and ends at ok (or the input closing, a new input, a new target).
// Within one: a device that reports itself wrong is snapped (assure) once, then the chain rebuilt; the monitor
// rewired once, then the chain rebuilt; rebuilds up to HEALTH.tries, HEALTH.backoff apart, then LINES.gaveUp and no more.
// A state with a line but no repair (off, the mic, suspended, the engine, muted) is said only to a room listening
// (path.speaker), and off or muted only while something is coming in: it's news when you play and hear nothing.

const AMP_RE = /^amp\.|^core\.stack$/;
const peakDb = (b) => { let pk = 0; for (let i = 0; i < b.length; i++) { const v = b[i] < 0 ? -b[i] : b[i]; if (v > pk) pk = v; } return pk > 1e-9 ? 20 * Math.log10(pk) : -Infinity; };

/**
 * Is y a delayed, scaled copy of x? The best normalised cross-correlation over lags up to 20 ms (and a few ms the
 * other way: two analysers read one after the other can be a render quantum apart), against HEALTH.dryCorr. Pure.
 * @param {Float32Array} x  @param {Float32Array} y  @param {number} sr
 * @returns {{ dry: boolean, corr: number, lag: number }}
 */
export function dryLike(x, y, sr) {
  const n = Math.min(x.length, y.length), maxL = Math.min(Math.round(0.02 * sr), n >> 1), neg = Math.min(256, n >> 2);
  let best = 0, at = 0;
  for (let L = -neg; L <= maxL; L++) {
    let xy = 0, xx = 0, yy = 0;
    const a = Math.max(0, L), b = Math.min(n, n + L);
    for (let i = a; i < b; i += 2) { const u = x[i - L], v = y[i]; xy += u * v; xx += u * u; yy += v * v; }
    if (xx < 1e-12 || yy < 1e-12) continue;
    const c = Math.abs(xy) / Math.sqrt(xx * yy);
    if (c > best) { best = c; at = L; }
    if (best >= HEALTH.dryCorr) break;
  }
  return { dry: best >= HEALTH.dryCorr, corr: best, lag: at };
}

const LINE_ONLY = new Set(['off', 'offMic', 'suspended', 'noEngine', 'muted']);

/**
 * @param {any} app  { engine, store, ui, input, devices }
 * @param {any} audio  input/audioin.js's
 */
export function createLivePath(app, audio) {
  const engine = app.engine, store = app.store, input = app.input;
  const blank = () => ({ state: 'closed', repair: 'none', insert: null, key: '', line: '', at: 0, levels: { in: -Infinity, strip: -Infinity, chain: -Infinity }, tries: 0 });
  let status = blank();
  let speaker = null, ep = null, due = 0, dueT = 0, iv = 0, checking = null, rebuilding = 0;
  // the analysers: { c, inAn, offIn, stripAn, chainAn, from: { input, chain } }
  const T = { c: null, inAn: null, offIn: null, stripAn: null, chainAn: null, from: null, bufs: null };
  const getDevice = (id) => { try { return app.devices?.getDevice?.(id) || null; } catch { return null; } };

  function speak(line, o = {}) {
    if (!line) return;
    if (speaker) { try { speaker(line, o); return; } catch (e) { console.warn('live path: speaker', e); } }
    app.ui?.toast?.(line, o.kind ? { kind: o.kind } : undefined);
  }
  function sayOnce(key, line) {
    if (!line || !ep || ep.said.has(key)) return;
    ep.said.add(key);
    speak(line, { key });
  }

  // analysers on the engine's context, hooked to the strip monitoring plays through now
  function taps(trackId) {
    const c = engine.ctx;
    if (!c) return null;
    if (T.c !== c) {
      if (T.offIn) { try { T.offIn(); } catch { /* gone */ } }
      const A = () => { const a = c.createAnalyser(); a.fftSize = 8192; a.smoothingTimeConstant = 0; return a; };
      Object.assign(T, { c, inAn: A(), stripAn: A(), chainAn: A(), from: null, bufs: [0, 1, 2].map(() => new Float32Array(8192)) });
      T.offIn = audio.tap(T.inAn);
    }
    const ct = trackId && engine.chainTaps ? engine.chainTaps(trackId) : null;
    if (!ct || ct.input?.context !== c) { unhook(); return { ct: null }; }
    if (!T.from || T.from.input !== ct.input || T.from.chain !== ct.chain) {
      unhook();
      try { ct.input.connect(T.stripAn); ct.chain.connect(T.chainAn); T.from = { input: ct.input, chain: ct.chain }; } catch { T.from = null; }
    }
    return { ct };
  }
  function unhook() {
    if (!T.from) return;
    try { T.from.input.disconnect(T.stripAn); } catch { /* gone */ }
    try { T.from.chain.disconnect(T.chainAn); } catch { /* gone */ }
    T.from = null;
  }

  // one measurement, or null while the path is changing under it (a build, a dip, the killswitch's renew): try again
  function measure() {
    const st = audio.state, c = audio.ctx || engine.ctx;
    const own = !!audio.ctx && !!engine.ctx && audio.ctx !== engine.ctx;
    const base = { open: !!st.open, ctx: c ? c.state : 'suspended', engine: !!engine.ctx && !own && typeof engine.inputNode === 'function', monitoring: !!st.monitoring, monitorOff: st.monitorOff || '', holds: st.monitorHolds || [] };
    if (!base.open || base.ctx !== 'running' || !base.engine || !base.monitoring || base.holds.length) return { snap: { ...base, track: null }, extra: null };
    const t = audio.monitorTrack ? audio.monitorTrack() : null;
    if (!t) return { snap: { ...base, track: null }, extra: null };
    if (engine.silencing || rebuilding) return null;
    const tp = taps(t.id);
    if (!tp || !tp.ct || tp.ct.settling) return null;
    const [bi, bs, bc] = T.bufs;
    T.chainAn.getFloatTimeDomainData(bc);
    T.stripAn.getFloatTimeDomainData(bs);
    T.inAn.getFloatTimeDomainData(bi);
    const levels = { in: peakDb(bi), strip: peakDb(bs), chain: peakDb(bc) };
    const inserts = [];
    for (const x of t.inserts || []) {
      const inst = engine.instance ? engine.instance(t.id, x.id) : null;
      if (!inst) return null;   // (not built yet: a reconcile on its way)
      const def = getDevice(x.device);
      let health = healthOf(inst);
      // (a held device is the person's choice, and a device that isn't defined can't be built by trying again: the
      // engine reports those; neither is the path's to repair)
      if (inst.held || (inst.fallback && !def)) health = { ...health, ok: true, failed: '', known: false };
      inserts.push({ id: x.id, device: x.device, name: def?.name || '', on: x.on !== false, amp: AMP_RE.test(x.device) || def?.cat === 'amp', health, inst });
    }
    const p = store.get(), anySolo = (p.tracks || []).some((x) => x.solo);
    const audible = !t.mute && (!anySolo || !!t.solo);
    let dry = null;
    if (levels.strip >= HEALTH.playing && inserts.some((x) => x.on && x.amp)) dry = dryLike(bs, bc, T.c.sampleRate);
    return { snap: { ...base, track: { id: t.id, name: t.name || '' }, audible, levels, inserts, dryLike: dry ? dry.dry : null }, extra: { dry } };
  }

  function setStatus(v, snap) {
    const was = status;
    const lv = (snap && snap.levels) || { in: -Infinity, strip: -Infinity, chain: -Infinity };
    status = { state: v.state, repair: v.repair, insert: v.insert, key: v.key, line: v.line, at: Date.now(), levels: { in: lv.in ?? -Infinity, strip: lv.strip ?? -Infinity, chain: lv.chain ?? -Infinity }, tries: ep ? ep.tries : 0 };
    audio.state.path = status;
    if (was.state !== status.state || was.tries !== status.tries) input.emit('path', status);
  }

  async function act(v, snap) {
    const st = v.state;
    if (st === 'ok' || st === 'closed') { ep = null; return; }
    if (st === 'quiet' || st === 'held' || st === 'waiting') return;
    if (!ep) ep = { t0: Date.now(), said: new Set(), assured: new Set(), rewired: 0, tries: 0, last: 0, gaveUp: false };
    if (v.repair === 'none') {
      if (!v.key || !speaker || !LINE_ONLY.has(v.key)) return;
      if ((v.key === 'off' || v.key === 'offMic') && audio.state.monitorBy === 'hand') return;
      if ((v.key === 'off' || v.key === 'offMic' || v.key === 'muted') && !(snap.levels && snap.levels.in >= HEALTH.quiet)) return;
      sayOnce(v.key, v.line);
      return;
    }
    if (v.repair === 'resume') {
      if (await audio.wake()) { later(HEALTH.after); return; }
      if (speaker) sayOnce(v.key, v.line);
      return;
    }
    if (v.repair === 'rewire' && ep.rewired < 1) {
      ep.rewired++;
      audio.rewire();
      sayOnce(v.key, v.line);
      later(HEALTH.after);
      return;
    }
    if (v.repair === 'assure' && v.insert && !ep.assured.has(v.insert)) {
      ep.assured.add(v.insert);
      const x = (snap.inserts || []).find((i) => i.id === v.insert);
      if (x && x.inst) assure(x.inst);
      sayOnce(v.key, v.line);
      later(HEALTH.settle + HEALTH.after);
      return;
    }
    // rebuild (or a rewire or a snap that didn't take): the strip renewed, HEALTH.backoff apart, HEALTH.tries in all
    if (ep.gaveUp) return;
    if (ep.tries >= HEALTH.tries) { ep.gaveUp = true; sayOnce('gaveUp', LINES.gaveUp); setStatus({ ...v }, snap); return; }
    const wait = ep.last ? ep.last + HEALTH.backoff - Date.now() : 0;
    if (wait > 0) { later(wait); return; }
    ep.tries++; ep.last = Date.now();
    sayOnce(v.key, v.line);
    const track = snap.track && snap.track.id;
    if (!track || !engine.rebuild) return;
    rebuilding++;
    try { await engine.rebuild(track); } catch (e) { console.warn('live path: rebuild', e); } finally { rebuilding--; }
    setStatus({ ...v }, snap);
    later(HEALTH.after + HEALTH.settle);
  }

  async function run(repair) {
    const m = measure();
    if (!m) { later(HEALTH.after); return status; }
    const v = pathVerdict(m.snap);
    setStatus(v, m.snap);
    if (repair) await act(v, m.snap);
    return status;
  }
  function check({ repair = true } = {}) {
    if (checking) return checking;
    checking = (async () => { try { return await run(repair); } catch (e) { console.warn('live path: check', e); return status; } finally { checking = null; } })();
    return checking;
  }
  // a check `ms` from now (the sooner of two asked for)
  /** @param {number} [ms] */
  function later(ms = HEALTH.after) {
    const at = Date.now() + ms;
    if (dueT && due <= at) return;
    clearTimeout(dueT);
    due = at;
    dueT = setTimeout(() => { dueT = 0; due = 0; check(); }, ms);
    ensureTicking();
  }
  // every HEALTH.every while monitoring is on and something is coming in
  function ensureTicking() {
    if (iv || typeof setInterval !== 'function') return;
    iv = setInterval(() => {
      const st = audio.state;
      if (!st.open) { clearInterval(iv); iv = 0; return; }
      if (!st.monitoring || checking || dueT || !T.inAn || !engine.ctx) return;
      T.inAn.getFloatTimeDomainData(T.bufs[0]);
      if (peakDb(T.bufs[0]) >= HEALTH.quiet) check();
    }, HEALTH.every);
  }

  // what can change the path: an open, a decision or a hold, a new target, the engine rebuilding the monitored strip, the
  // context's state, the killswitch done
  input.on('pathchange', (why) => {
    if (why === 'open' || why === 'target' || why === 'close') ep = null;
    if (why === 'close') { setStatus({ state: 'closed', repair: 'none', insert: null, key: '', line: '' }, null); return; }
    later(HEALTH.after);
  });
  input.on('monitor', () => later(HEALTH.after));
  try {
    engine.on('graph', (e) => { const t = audio.monitorTrack ? audio.monitorTrack() : null; if (t && e && e.track === t.id && !rebuilding) later(HEALTH.after); });
    engine.on('transport', (e) => { if (e && e.why === 'context' && audio.state.open) later(HEALTH.after); });
    engine.on('silence', () => {
      if (!audio.state.open) return;
      const t0 = Date.now();
      const wait = () => { if (engine.silencing && Date.now() - t0 < 5000) setTimeout(wait, 50); else later(HEALTH.after); };
      setTimeout(wait, 50);
    });
  } catch { /* an engine without events */ }

  return {
    status: () => status,
    check,
    wake: () => audio.wake(),
    speaker(fn) { speaker = typeof fn === 'function' ? fn : null; },
    speak,
    // (checks: the episode as it stands)
    get episode() { return ep ? { tries: ep.tries, said: [...ep.said], gaveUp: ep.gaveUp, assured: [...ep.assured], rewired: ep.rewired } : null; },
  };
}
