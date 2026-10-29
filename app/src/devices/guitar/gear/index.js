// The guitar gear, evaluated once for Overdub (code.js: the pedal platform, amps, packs and presets in one scope).
// The code reads three names from the page it was written for, lazily, and here they're Overdub's:
//   PLUG.clock / PLUG._bus   the engine's clock on the live context (devices/graph.js `live`, set when a graph device is
//                            made live with opts.clock); a stopped free grid until then
//   song.key                 the project's key (window.overdub.store), as a 0-11 major key (C = 0)
//   ctx                      the live context
//   CABS                     the measured cabs' bank: Half Stack's (devices/builtin/amp-lib.js CABS_HASH, kernel data
//                            fetched by kernel/data.js: app/kits/<hex>.odk), which the amps play as their measured cabs
// Its worklets: a gear def's worklets are { name: source }, and the studio loads worklet modules only from files on its
// own origin (its policy refuses data: and blob: scripts), so each source is also a file of its own (worklets/,
// WORKLETS) and workletFiles() gives an Overdub def those instead: { name: URL }.
import { evaluate, WORKLETS } from './code.js';
import { live, onLive } from '../../graph.js';
import { loadData, peekData, dataState } from '../../../kernel/data.js';
import { decodeOdk } from '../../../kernel/odk.js';
import { CABS_HASH, cabResample } from '../../builtin/amp-lib.js';

export { WORKLETS };
// { name: source } (a pedal's worklets, or the amps') -> { name: the URL of its file in worklets/ }
export function workletFiles(worklets, who) {
  const out = {};
  for (const name of Object.keys(worklets || {})) {
    if (WORKLETS[name]) out[name] = WORKLETS[name];
    else console.error(`guitar: ${who}'s worklet "${name}" has no file (add it to gear/worklets/ and WORKLETS in gear/code.js): it will pass its signal through`);
  }
  return out;
}

const FREE = { playing: () => false, bpm: () => 120, beatsPerBar: () => 4, bar: () => 0, barTime: (b) => b * 2, barAt: (t) => t / 2 };
const PLUG = {
  get clock() { return live.clock || FREE; },
  get _bus() { return live.c ? { c: live.c } : null; },
};

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// a mode's root to the major key it's a mode of (semitones up)
const TO_MAJOR = { major: 0, majorPentatonic: 0, minor: 3, harmonicMinor: 3, melodicMinor: 3, minorPentatonic: 3, blues: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5, locrian: 1 };
let keyOverride = null;
export function majorKeyOf(key) {
  if (!key || !key.root) return 0;
  const m = /^([A-Ga-g])([#♯b♭]*)/.exec(String(key.root));
  if (!m) return 0;
  let pc = PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return (((pc + (TO_MAJOR[key.scale] || 0)) % 12) + 12) % 12;
}
// The song as the packs see it: only its key (the harmonizers and arpeggiators follow it).
const SONG = {
  get key() {
    if (keyOverride != null) return keyOverride;
    try { const e = typeof window !== 'undefined' && window.overdub; const p = e && e.store && e.store.get(); return majorKeyOf(p && p.key); } catch { return 0; }
  },
};
// Tests and renders without a store: set the key the packs hear ({ root, scale }, a 0-11 major key, or null to follow
// the project again).
export function setSongKey(k) { keyOverride = k == null ? null : typeof k === 'number' ? ((k % 12) + 12) % 12 : majorKeyOf(k); }

// The measured cabs (code.js PLUG_IRS): the bank decoded once, its taps as Half Stack's kernel scales them (x / 2^23 *
// gain), and at another host rate resampled once per rate the way the kernel does it (amp-lib.js cabResample), so a 44.1
// or 96 kHz interface hears the same cabs. Nothing is fetched until an amp asks (load()). In Node there's no fetch of
// app/kits: useCabBank(decoded) hands one over (tools; engine/node/data.js dataFor decodes it); useCabBank(null) holds
// it off (tests: an amp as it is when the bank isn't on the server), useCabBank() lets it be found again.
let bank; // undefined: not looked for yet; null: not here (or held off)
const atRate = new Map();
function decoded() {
  if (bank === undefined) {
    const b = peekData(CABS_HASH);
    if (!b) return null;
    try { bank = decodeOdk(b); } catch (e) { console.error('guitar: the cab bank does not decode:', e.message); bank = null; }
  }
  return bank;
}
export function useCabBank(b) { bank = b === undefined ? undefined : b || null; atRate.clear(); }
const CABS = {
  load: () => (decoded() ? Promise.resolve(true) : bank === null ? Promise.resolve(false) : loadData(CABS_HASH).then(() => !!decoded())),
  state: () => (decoded() ? 'ready' : dataState(CABS_HASH) || null),
  native() {
    const b = decoded();
    if (!b) return null;
    if (!atRate.has('native')) atRate.set('native', { sr: b.sr, taps: b.samples.map((s) => Float64Array.from(s.ch[0], (v) => v * ((+s.gain || 1) / 8388608))) });
    return atRate.get('native');
  },
  taps(sr) {
    const b = decoded();
    if (!b) return null;
    if (!atRate.has(sr)) atRate.set(sr, b.samples.map((s) => Float32Array.from(sr === b.sr ? Array.from(s.ch[0], (v) => v * ((+s.gain || 1) / 8388608)) : cabResample(s.ch[0], (+s.gain || 1) / 8388608, b.sr, sr))));
    return atRate.get(sr);
  },
};

let bind = {};
export const gear = evaluate({ PLUG, CABS, bind: (b) => { bind = b; } });
bind.song && bind.song(SONG);
onLive((l) => bind.ctx && bind.ctx(l.c));
if (live.c && bind.ctx) bind.ctx(live.c);
