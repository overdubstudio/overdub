// The guitar gear, evaluated once for Overdub (code.js: the pedal platform, amps, packs and presets in one scope).
// The code reads three names from the page it was written for, lazily, and here they're Overdub's:
//   PLUG.clock / PLUG._bus   the engine's clock on the live context (devices/graph.js `live`, set when a graph device is
//                            made live with opts.clock); a stopped free grid until then
//   song.key                 the project's key (window.overdub.store), as a 0-11 major key (C = 0)
//   ctx                      the live context
// Its worklets: a gear def's worklets are { name: source }, and the studio loads worklet modules only from files on its
// own origin (its policy refuses data: and blob: scripts), so each source is also a file of its own (worklets/,
// WORKLETS) and workletFiles() gives an Overdub def those instead: { name: URL }.
import { evaluate, WORKLETS } from './code.js';
import { live, onLive } from '../../graph.js';

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

let bind = {};
export const gear = evaluate({ PLUG, bind: (b) => { bind = b; } });
bind.song && bind.song(SONG);
onLive((l) => bind.ctx && bind.ctx(l.c));
if (live.c && bind.ctx) bind.ctx(live.c);
