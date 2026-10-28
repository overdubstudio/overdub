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
