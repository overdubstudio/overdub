// @ts-check
// The places [core; stream B fills it in] (docs/research/LIVE-ROOM-MODE.md §2.2, §4.1, §5): what each electric room
// is (its tempo, its grid, its rigs, its band, its levels, its kick head), the amp on its stage, and what a place sets
// up when you pick it. Pure: no DOM, no Math.random. The kitchen table's setup is core/liveroom/kitchen.js
// (kitchenSetup); the ids are core/liveroom/model.js's.
//
// Frozen (§14.2):
//   PLACES, placeOf(id)                    the three electric places (an unknown id is the metal club)
//   RIGS, rigChain(rig, side) -> [{ device, params, on }] | null, rigLabel(rig)
//       the amp's settings (RIG_IDS), the chain for one side ('L' or 'R': the right side's cab is one mic over, §4.1)
//       and a setting's name as the studio gives a device on a preset ("Half Stack, Modern")
//   setupOf(place, { tuning, finish }) -> { tempo, meter, grid, count, tracks, master, feels, form, names }
//       what picking the place makes (core/liveroom/plans.js planPlace turns it into ops)
//   feelsOf(place, part, tempo) -> [feel ids]   the feels the menu offers for a part, in order
//   finishChain(place, finish) -> [inserts]     the master's chain for a finish
// Kept from the prototype, for the read and the band (seam additions, §14.2):
//   earOf(sr) -> the note finder's options for the room (input/onsets.js createNoteFinder)
//   chordAt(place, riff, beat, from) -> { name, next, change, bar, of } | null   the blues bar's twelve-bar at a beat
//
// Until stream B lands, setupOf, feelsOf and finishChain are inert: the prototype's places, no tracks, no chains.

import STACK from '../../devices/builtin/stack.js';
import { presetParams } from '../../devices/registry.js';

const EPS = 1e-6;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/* ------------------------------------------------------------------------------------------------ the amp */
// The amp on every stage is Half Stack (core.stack): a kernel, so a take sounds the same live, in the studio's renders
// and in the canonical Node one, and it breaks up at the level a guitar comes in at. A rig is one of its settings: a
// preset of its own with the knobs given over it (GAIN, as its description has it: 3 crunch, 5 hard rock, 6 to 7
// modern metal rhythm), and LEVEL so it comes out as loud as Modern, measured (tools/liveroom/checks-band.js, on its
// metal DI fixtures). The rig ids are model.js RIG_IDS.
const AMP = 'core.stack', AMP_NAME = STACK.name;
export const RIGS = {
  modern: { id: 'modern', name: 'Modern', preset: 'Modern' },
  djent: { id: 'djent', name: 'Djent', preset: 'Djent', params: { level: -0.4 } },
  thrash: { id: 'thrash', name: 'Thrash', preset: 'Thrash', params: { level: -2.5 } },
  hardrock: { id: 'hardrock', name: 'Hard rock', preset: 'Modern', params: { gain: 5, level: 0.6 } },
  crunch: { id: 'crunch', name: 'Crunch', preset: 'Modern', params: { gain: 3, level: 1.7 } },
  edge: { id: 'edge', name: 'Edge of breakup', preset: 'Modern', params: { gain: 2, level: 2.4 } },
};
// (side: B gives the right side its own cab, §4.1; until then both sides are the same chain)
export function rigChain(rig, side = 'L') {
  const r = RIGS[rig];
  return r ? [{ device: AMP, params: { ...(presetParams(STACK, r.preset) || {}), ...(r.params || {}) }, on: true }] : null;
}
export const rigLabel = (rig) => (RIGS[rig] ? `${AMP_NAME}, ${RIGS[rig].name}` : AMP_NAME);

/* ------------------------------------------------------------------------------------------------ the places */
// Each place: its tempo (the range it plays in, and the one it leans to), its grid (4: sixteenths; 3: eighth-note
// triplets, a shuffle), its rigs (the first one plugged in), its grooves (core/grooves.js ids), its bass, the scale the
// song is set to, the band's levels (faders, measured: tools/liveroom/checks-band.js), and what's painted on the kick.
export const PLACES = {
  basement: {
    id: 'basement', name: 'The basement', what: 'Punk', blurb: 'Fast and loud, under somebody’s house.',
    tempo: [140, 210], prefer: 172, grid: 4, scale: 'minor', rigs: ['hardrock', 'modern', 'thrash'],
    drums: { style: 'punk', verse: 'punk/straight-punk', chorus: 'punk/open-eighths', fill: 'punk/snare-to-floor', kit: { device: 'core.drums', params: { kit: 0, room: 0.4, tone: 0.2, decay: 1, drive: 0.3 } } },
    bass: { mode: 'eighths', params: { style: 1, tone: 0.5, pickup: 0.5, sustain: 1, mute: 0.1, drive: 0.5 } },
    gain: { drums: -6.5, bass: -6 },
    kick: 'SUMP PUMP',
  },
  metal: {
    id: 'metal', name: 'The metal club', what: 'Metal', blurb: 'Tight and heavy. The kick locks to your chugs.',
    tempo: [90, 200], prefer: 132, grid: 4, scale: 'minor', rigs: ['modern', 'djent', 'thrash'],
    drums: { style: 'modernmetal', verse: 'modernmetal/djent-unison-quarters-on-the-hat', chorus: 'modernmetal/open-chorus-crash-riding', fill: 'modernmetal/kick-and-snare-flurry', follow: true, kit: { device: 'core.drums', params: { kit: 5, room: 0.3, tone: 0.2, decay: 0.9, drive: 0.4 } } },
    bass: { mode: 'double', params: { style: 1, tone: 0.5, pickup: 0.35, sustain: 1, mute: 0.08, drive: 0.6 } },
    gain: { drums: -6, bass: -6 },
    kick: 'VOID',
  },
  bluesbar: {
    id: 'bluesbar', name: 'The blues bar', what: 'Blues', blurb: 'A shuffle in a small room, twelve bars at a time.',
    tempo: [66, 140], prefer: 96, grid: 3, scale: 'blues', rigs: ['crunch', 'hardrock', 'edge'],
    drums: { style: 'shuffle', verse: 'shuffle/shuffle', chorus: 'shuffle/double-shuffle', fill: 'shuffle/triplet-pickup', kit: { device: 'core.drums', params: { kit: 5, room: 0.45, tone: 0, decay: 1, drive: 0.15 } } },
    bass: { mode: 'boogie', params: { style: 0, tone: 0.35, pickup: 0.25, sustain: 1, mute: 0.08, drive: 0.2 } },
    // the twelve-bar, in steps from the riff's root (I, IV, V)
    form: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7],
    gain: { drums: -3, bass: -7 },
    kick: 'LAST CALL',
  },
};
export const placeOf = (id) => PLACES[id] || PLACES.metal;

// The room's ear: a 30 Hz floor and a long window, so a power chord's own low note reads (its root an octave under the
// guitar's range), and attacks with no pitch kept (a muted chug is rhythm).
export const earOf = (sr) => ({ sr, lo: 30, win: sr > 50000 ? 8192 : 4096, unpitched: true });

/* ------------------------------------------------------------------------------------------------ what a place sets up */
// (inert until stream B: the place's own tempo, meter and grid; no tracks, master chain, feels or form yet)
export function setupOf(place, { tuning = null, finish = null } = {}) {
  const P = placeOf(place);
  return { tempo: P.prefer, meter: [4, 4], grid: P.grid, count: { beats: 4, voice: 'sticks' }, tracks: [], master: [], feels: [], form: [], names: {} };
}
export function feelsOf(place, part, tempo) { return []; }
export function finishChain(place, finish) { return []; }

/* ------------------------------------------------------------------------------------------------ the twelve-bar */
// The blues bar's chart at a song beat: the chord, the next one, the bar of the twelve. riff: { root } (a pitch class)
export function chordAt(place, riff, beat, from = 0) {
  const P = placeOf(place);
  if (!P.form || !riff) return null;
  const rel = beat - from;
  if (rel < -EPS) return null;
  const bar = Math.floor(rel / 4 + EPS), i = bar % P.form.length, j = (i + 1) % P.form.length;
  const nm = (s) => PC_NAMES[pcOf(riff.root + s)] + '7';
  return { name: nm(P.form[i]), next: nm(P.form[j]), change: P.form[j] !== P.form[i], bar: i + 1, of: P.form.length };
}
