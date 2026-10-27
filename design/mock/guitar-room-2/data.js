// The second guitar-room mock's world (design/mock/guitar-room-2/): who everything is, where it stands, and the fake
// state that moves it. Every amp, pedal, cab and mic is the real one Overdub vendors from Claw'd-o-Matic
// (app/vendor/clawd/, registered by app/src/devices/guitar/), so its name, category, one-line sound and "in the spirit
// of" are its own, read from the registry, never written here. The drummer's book is the studio's real groove library
// (app/src/core/grooves/). Nothing here makes a sound.

import '/app/src/devices/guitar/index.js';
import { getDevice, listDevices } from '/app/src/devices/registry.js';
import { clawd } from '/app/src/devices/guitar/clawd.js';
import { STYLES, GROOVES } from '/app/src/core/grooves.js';

export { getDevice };

/* ------------------------------------------------------------------------------------------------ small things */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------------------------------ the amp wall */
// Claw'd-o-Matic's wall filters (ampui.js AMP_TONES), in the order its wall runs; Half Stack, the room's own head, hangs
// with the high-gain amps.
export const AMP_SECTIONS = [
  { tone: 'clean', label: 'CLEAN', word: 'Clean' },
  { tone: 'crunch', label: 'CRUNCH', word: 'Crunch' },
  { tone: 'high', label: 'HIGH GAIN', word: 'High gain' },
  { tone: 'weird', label: 'WEIRD', word: 'Weird' },
  { tone: 'bass', label: 'BASS', word: 'Bass' },
];
export const toneWord = (t) => (AMP_SECTIONS.find((s) => s.tone === t) || { word: 'Amp' }).word;
export function ampsBySection() {
  const all = listDevices({ cat: 'amp' });
  return AMP_SECTIONS.map((s) => ({ ...s, amps: all.filter((d) => (d.tone || (d.id === 'core.stack' ? 'high' : 'weird')) === s.tone) }));
}

/* ------------------------------------------------------------------------------------------------ the pedal case */
// Claw'd-o-Matic's categories (pedals.js PEDAL_CATS), shelved so each shelf of the case is full: what you'd find
// together in a shop (the dynamics by the drives, delays by the reverbs). `pedalCat` is the pedal's own category.
export const PEDAL_SHELVES = [
  [['dynamics', 'Dynamics'], ['drive', 'Drive']],
  [['fuzz', 'Fuzz']],
  [['mod', 'Modulation']],
  [['time', 'Delay'], ['ambient', 'Ambient']],
  [['pitch', 'Pitch']],
  [['filter', 'Filter & wah'], ['synth', 'Synth'], ['utility', 'Utility']],
  [['glitch', 'Glitch']],
];
export const CAT_WORD = Object.fromEntries(PEDAL_SHELVES.flat());
export function pedalsByShelf() {
  const all = listDevices({ kind: 'effect' }).filter((d) => d.id.startsWith('pedal.'));
  return PEDAL_SHELVES.map((shelf) => shelf.map(([cat, word]) => ({ cat, word, pedals: all.filter((d) => d.pedalCat === cat) })));
}
// where a pedal goes when it's carried to your board (Claw'd-o-Matic's PEDAL_RANK): lower goes earlier; pedals ranked
// mod and up go after the amp, in its effects loop
export const RANK = { dynamics: 0, utility: 0.5, filter: 1, pitch: 2, synth: 2.5, drive: 3, fuzz: 4, glitch: 4.5, mod: 5, time: 6, ambient: 7 };
export const inLoop = (d) => (RANK[d?.pedalCat] ?? 3) >= 5;

/* ------------------------------------------------------------------------------------------------ cabs and mics */
export const CABS = clawd.PLUG_CABS;
export const MICS = clawd.PLUG_MICS;
export const MIC_IDS = Object.keys(MICS);
// the cabs a guitarist would put under a head (the bass ones stay with the bass amps)
export const GUITAR_CABS = ['v412', 'g412', 'b212', 'a12', 't210', 'b410', 'j15', 'p8', 'fridge', 'box', 'phone', 'horn'];
// how big a cab stands on the stage, in world units: from its speakers
export function cabBox(id) {
  const c = CABS[id] || CABS.v412;
  if (c.odd === 'fridge') return { w: 300, h: 420 };
  if (c.odd === 'box') return { w: 280, h: 210 };
  if (c.odd === 'phone') return { w: 200, h: 150 };
  if (c.odd === 'horn') return { w: 380, h: 300 };
  const n = c.n || 1, s = c.size || 12;
  if (n >= 8) return { w: 496, h: 420 };
  if (n === 4) return { w: s >= 12 ? 496 : 420, h: s >= 12 ? 330 : 300 };
  if (n === 2) return { w: s >= 12 ? 496 : 400, h: s >= 12 ? 230 : 210 };
  return { w: s >= 15 ? 340 : s >= 12 ? 320 : 260, h: s >= 15 ? 340 : s >= 12 ? 270 : 220 };
}
// a mic's place on the cone, in words (as Claw'd-o-Matic's cab view says it)
export const whereOnCone = (r) => (r < 0.12 ? 'centre' : r < 0.4 ? 'cap edge' : r < 0.82 ? 'cone' : r <= 1.04 ? 'cone edge' : 'off the cone');
export const inches = (d) => (d < 1 ? d.toFixed(1) : d < 10 ? String(Math.round(d * 2) / 2) : String(Math.round(d))) + '″';

/* ------------------------------------------------------------------------------------------------ the club's stack */
// The metal club's house stack: a noise gate and a treble booster into Kraken on a closed 4x12, a delay and a plate
// in the loop (off). The tuner is the room's own, first on every board.
export const HOUSE = {
  name: 'The club’s stack',
  amp: 'amp.recto',
  ampParams: { gain: 6.8, bass: 6.2, mid: 4.4, treble: 6.4, presence: 6, level: 6.2 },
  cab: { cab: 'v412', mic: { type: 'dyn', pos: 0.3, dist: 1, ang: 0 }, mic2: null },
  board: [
    { device: 'tuner', on: false },
    { device: 'pedal.gate', on: true },
    { device: 'pedal.mantisboost', on: true },
    { device: 'pedal.delay', on: false },
    { device: 'pedal.lobsterplate', on: false },
  ],
};
// The room's tuner: not a Claw'd-o-Matic pedal, so it's drawn here (app.js tunerFace). First on the board, it mutes.
export const TUNER = { id: 'tuner', name: 'Tuna Fork', kindLabel: 'TUNER · MUTE', blurb: 'Reads your low string first; mutes while it’s on', nod: 'the strobe and needle tuners at the front of every board' };

export const TUNINGS = [
  { id: 'e', name: 'E standard', notes: ['E', 'A', 'D', 'G', 'B', 'E'] },
  { id: 'dropd', name: 'Drop D', notes: ['D', 'A', 'D', 'G', 'B', 'E'] },
  { id: 'd', name: 'D standard', notes: ['D', 'G', 'C', 'F', 'A', 'D'] },
  { id: 'dropc', name: 'Drop C', notes: ['C', 'G', 'C', 'F', 'A', 'D'] },
  { id: 'c', name: 'C standard', notes: ['C', 'F', 'A♯', 'D♯', 'G', 'C'] },
  { id: 'dropb', name: 'Drop B', notes: ['B', 'F♯', 'B', 'E', 'G♯', 'C♯'] },
];

/* ------------------------------------------------------------------------------------------------ the drummer */
// A groove's first bar as rows of 16 steps: the top (hat, ride, crash, China), snare, kick
const TOPS = ['hat', 'open', 'ride', 'bell', 'crash', 'crash2', 'china', 'splash', 'pedal'];
export function gridOf(g) {
  const rows = { top: Array(16).fill(0), snare: Array(16).fill(0), kick: Array(16).fill(0), toms: Array(16).fill(0) };
  let top = 'hat';
  for (const h of g.hits || []) {
    if (h.t >= 4) continue;
    const s = Math.min(15, Math.round(h.t * 4)), v = h.v >= 0.95 ? 2 : 1;
    const row = TOPS.includes(h.row) ? 'top' : h.row === 'snare' || h.row === 'rim' || h.row === 'clap' ? 'snare' : h.row === 'kick' ? 'kick' : 'toms';
    if (row === 'top' && h.row !== 'pedal') top = h.row;
    rows[row][s] = Math.max(rows[row][s], v);
  }
  return { ...rows, topName: top };
}
// The house's guide beat (not in the library: a metronome with a backbeat), then the library's
export const GUIDE = { id: 'house/guide', style: 'house', styleName: 'The room', name: 'Guide beat', part: 'verse', bars: 1,
  hits: [0, 1, 2, 3].map((b) => ({ t: b, row: 'hat', v: 0.8 })).concat([{ t: 1, row: 'snare', v: 1 }, { t: 3, row: 'snare', v: 1 }, { t: 0, row: 'kick', v: 0.8 }, { t: 2, row: 'kick', v: 0.8 }]) };
export function library() {
  const styles = STYLES();
  const grooves = GROOVES();
  const byStyle = new Map(styles.map((s) => [s.id, { ...s, grooves: [] }]));
  for (const g of grooves) byStyle.get(g.style)?.grooves.push(g);
  // the metal club's shelf first: modern metal, metal, extreme, punk; then the rest as the library has them
  const first = ['modernmetal', 'metal', 'extreme', 'punk', 'rock'];
  const order = [...first.map((id) => byStyle.get(id)).filter(Boolean), ...[...byStyle.values()].filter((s) => !first.includes(s.id))];
  return { styles: order, count: grooves.length, byId: new Map([[GUIDE.id, GUIDE], ...grooves.map((g) => [g.id, g])]) };
}
// what's pinned to the riser at first: the guide, then four from the metal shelves, with short names you can change
export const PINS = [
  { id: 'house/guide', short: 'Guide' },
  { id: 'modernmetal/djent-unison-quarters-on-the-hat', short: 'Djent' },
  { id: 'modernmetal/double-kick-gallop', short: 'Gallop' },
  { id: 'modernmetal/open-chorus-crash-riding', short: 'Open' },
  { id: 'modernmetal/half-time-china-breakdown', short: 'Half-time' },
];

/* ------------------------------------------------------------------------------------------------ fake audio shapes */
export function riffShape(seed, bars, cols) {
  const r = rng(seed), steps = bars * 16, out = new Float32Array(cols);
  const CH = 'X.xx.xX.x.xxX.x.';
  for (let s = 0; s < steps; s++) {
    const c = CH[s % 16];
    if (c === '.' && r() > 0.12) continue;
    const a = (c === 'X' ? 0.95 : 0.66) * (0.82 + r() * 0.18), c0 = Math.floor((s / steps) * cols), span = Math.max(1, Math.round(cols / steps));
    for (let k = 0; k < span * 3 && c0 + k < cols; k++) out[c0 + k] = Math.max(out[c0 + k], a * Math.exp((-2.2 * k) / (span + 1)));
  }
  return out;
}
