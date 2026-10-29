// @ts-check
// The places [core] (docs/research/LIVE-ROOM-MODE.md §2.2, §4.1, §5): what each electric room is (its tempo, its grid,
// its rigs, its band, its levels, its kick head), the amp on its stage, and what a place sets up when you pick it.
// Pure: no DOM, no Math.random. The kitchen table's setup is core/liveroom/kitchen.js (kitchenSetup); the ids are
// core/liveroom/model.js's.
//
// Frozen (§14.2):
//   PLACES, placeOf(id)                    the three electric places (an unknown id is the metal club)
//   RIGS, rigChain(rig, side) -> [{ device, params, on }] | null, rigLabel(rig)
//       the amp's settings (RIG_IDS), the chain for one side ('L' or 'R': the right side's cab is one mic over, §4.1,
//       its LEVEL set so the two sides measure the same) and a setting's name ("Half Stack, Modern")
//   setupOf(place, { tuning, finish }) -> { tempo, meter, grid, count, tracks, master, feels, form, names, ... }
//       what picking the place makes (core/liveroom/plans.js planPlace turns it into ops):
//         tempo, range         the tempo it starts at and the range it plays in (BPM)
//         meter, grid          [4, 4]; 4 sixteenths, 3 eighth-note triplets (a shuffle)
//         count                { bars, beats, voice: 'sticks', hits? } the count-in (hits: the beats that sound, of the
//                              whole count, 0-based: the basement's 1 ... 2 ... 1 2 3 4), and fast: the bars at 160 and up
//         tracks               [{ role, name, kind, color, instrument?, inserts, gain, pan, mute, by, later? }] the role
//                              tracks in the order they're made (by: 'overdub' the house's, 'you' yours; later: made
//                              when it's first needed: Guitar R by core/liveroom/double.js planDouble)
//         master, masterClip   the default finish's inserts, and the master's end ('clean': the chain ends in a limiter)
//         finish, finishes     the default finish and the place's three (model.js FINISHES)
//         feels                { part: [feel ids] } at the starting tempo (feelsOf for any other)
//         form                 Lay it out (§3.10): [{ name, bars, part, copy?, feel?, reps?, oneSide?, drop?, empty?,
//                              intro? }] copy: the part whose takes it repeats (by its default name); empty: a card the band
//                              plays alone; intro: { from, bars, single } the opening built from a part's first bars
//         names                { role: track name } (core/liveroom/session.js readRoom re-binds a role by it)
//         parts                the default names of the parts in the order they're played (§3.8)
//         rigs, scale, kick, ending, drift   the amp's three settings, the scale the key is read in, the kick head,
//                              the ending's name, the double's drift limit (ms)
//   feelsOf(place, part, tempo) -> [feel ids]   the feels the menu offers for a part (a part word or a section's name),
//       in order, each one a groove that exists in its bank at that tempo (grooveOf)
//   finishChain(place, finish) -> [inserts]     the master's chain for a finish
// Kept from the prototype, for the read and the band (seam additions, §14.2):
//   earOf(sr) -> the note finder's options for the room (input/onsets.js createNoteFinder)
//   chordAt(place, riff, beat, from) -> { name, next, change, bar, of } | null   the blues bar's twelve-bar at a beat
// Also here, for the band and the checks:
//   grooveOf(place, feel, tempo) -> groove id | null   the groove behind a feel at a tempo (core/grooves.js)
//   follows(feel) -> whether the kick goes on your chugs in that feel   fillsOf(place, tempo) -> { one, two, bar, ending }
//   partKey(nameOrPart) -> 'intro' | 'verse' | 'prechorus' | 'chorus' | 'half' | 'bridge' | 'outro' | null
//   gtrEq(tuning) -> Slide Rule's params on a guitar (its low cut by tuning)   lowCut(tuning) -> Hz
//   guitarGain(place, rig, peakDb) -> the guitar fader for a guitar coming in at that peak (FADERS, measured)
//   chainHash(inserts) -> a short hash of a chain (room.managed's chain)
//   WINDOWS   the finishes' loudness windows where audio/targets.js has none (the basement's and the blues bar's)

import STACK from '../../devices/builtin/stack.js';
import METALKIT from '../../devices/builtin/metalkit.js';
import DRUMBUS from '../../devices/builtin/drumbus.js';
import EBASS from '../../devices/builtin/ebass.js';
import BASSRIG from '../../devices/builtin/bassrig.js';
import BASSGUITAR from '../../devices/builtin/bassguitar.js';
import CLIPPER from '../../devices/builtin/clipper.js';
import { presetParams } from '../../devices/registry.js';
import { getGroove, partOfName } from '../grooves.js';
import { FINISHES } from './model.js';
import { earOf } from './read.js';

const EPS = 1e-6;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const DEFS = { 'core.stack': STACK, 'core.metalkit': METALKIT, 'core.drumbus': DRUMBUS, 'core.ebass': EBASS, 'core.bassrig': BASSRIG, 'core.bassguitar': BASSGUITAR, 'core.clipper': CLIPPER };
const preset = (id, name, over = {}) => ({ ...(presetParams(DEFS[id], name) || {}), ...over });

/* ------------------------------------------------------------------------------------------------ the amp */
// The amp on every stage is Half Stack (core.stack): a kernel, so a take sounds the same live, in the studio's renders
// and in the canonical Node one, and it breaks up at the level a guitar comes in at. A rig is one of its settings: a
// preset of its own with the knobs given over it (GAIN, as its description has it: 3 crunch, 5 hard rock, 6 to 7
// modern metal rhythm), and LEVEL so it comes out as loud as Modern, measured (tools/liveroom/checks-band.js, on its
// metal DI fixtures). The rig ids are model.js RIG_IDS.
//   cab   the left side's cab (the preset's); right: the right side's, one mic over on the same cab (§4.1: MODERN CLOSE
//         -> MODERN SIDE, MODERN BRIGHT -> MODERN 2 MICS, MODERN SIDE -> MODERN CLOSE; amp-lib.js CAB_LABELS)
//   rightLevel   the right side's LEVEL against the left's, dB, so the two sides measure the same (checks-band.js, on
//         the reference DI; within 0.5 LU)
const AMP = 'core.stack', AMP_NAME = STACK.name;
export const RIGS = {
  modern: { id: 'modern', name: 'Modern', preset: 'Modern', cab: 0, right: 2, rightLevel: -2.3 },
  djent: { id: 'djent', name: 'Djent', preset: 'Djent', params: { level: -0.4 }, cab: 1, right: 3, rightLevel: -1.3 },
  thrash: { id: 'thrash', name: 'Thrash', preset: 'Thrash', params: { level: -2.5 }, cab: 2, right: 0, rightLevel: 2.2 },
  hardrock: { id: 'hardrock', name: 'Hard rock', preset: 'Modern', params: { gain: 5, level: 0.6 }, cab: 0, right: 2, rightLevel: -2.2 },
  crunch: { id: 'crunch', name: 'Crunch', preset: 'Modern', params: { gain: 3, level: 1.7 }, cab: 0, right: 2, rightLevel: -2.2 },
  edge: { id: 'edge', name: 'Edge of breakup', preset: 'Modern', params: { gain: 2, level: 2.4 }, cab: 0, right: 2, rightLevel: -2.2 },
};
const r2 = (x) => Math.round(x * 100) / 100;
export function rigChain(rig, side = 'L') {
  const r = RIGS[rig];
  if (!r) return null;
  const params = { ...(presetParams(STACK, r.preset) || {}), ...(r.params || {}) };
  if (side === 'R') { params.cab = r.right; params.level = r2((params.level || 0) + r.rightLevel); }
  return [{ device: AMP, params, on: true }];
}
export const rigLabel = (rig) => (RIGS[rig] ? `${AMP_NAME}, ${RIGS[rig].name}` : AMP_NAME);

/* ------------------------------------------------------------------------------------------------ the guitar's EQ */
// Slide Rule on each guitar, as Boiler Room's GTR_EQ (core/demos/boiler-room.js): a low cut that follows the tuning (a
// lower string needs more of its low end: 100 Hz for E standard and drop D, 90 for D, drop C and C, 80 for B and drop
// B), 2 dB out at 400 Hz (the box), and a high cut at 9.5 kHz (the fizz).
const LOW_CUT = { standard: 100, 'drop-d': 100, 'half-down': 100, dadgad: 100, 'open-g': 100, 'd-standard': 90, 'drop-c': 90, 'c-standard': 90, 'b-standard': 80, 'drop-b': 80 };
export const lowCut = (tuning) => LOW_CUT[tuning] || 100;
export const gtrEq = (tuning) => ({ b1_on: 1, b1_type: 4, b1_freq: lowCut(tuning), b4_on: 1, b4_type: 0, b4_freq: 400, b4_gain: -2, b4_q: 1.2, b8_on: 1, b8_type: 6, b8_freq: 9500 });

/* ------------------------------------------------------------------------------------------------ the places */
// Each place: its tempo (the range it plays in, and the one it starts at), its grid (4: sixteenths; 3: eighth-note
// triplets, a shuffle), its rigs (the first one plugged in), its kit and bass, the scale the song is set to, the
// band's levels (faders, measured: tools/liveroom/checks-band.js), and what's painted on the kick.
//   drums: { style (the groove bank), verse, chorus, fill (the prototype's band: bandFor), follow, kit, bus }
//   bass:  { mode ('roots' | 'eighths' | 'boogie'), device, params, rig }
//   gain:  { drums, bass, guitar } the faders, dB (guitar: the guitar's at a -12 dBFS peak in; FADERS has the slope)
export const PLACES = {
  basement: {
    id: 'basement', name: 'The basement', what: 'Punk', blurb: 'Fast and loud, under somebody’s house.',
    tempo: [150, 210], prefer: 172, grid: 4, scale: 'minor', rigs: ['hardrock', 'modern', 'thrash'],
    count: { bars: 2, beats: 8, voice: 'sticks', hits: [0, 2, 4, 5, 6, 7] },
    drums: { style: 'punk', verse: 'punk/straight-punk', chorus: 'punk/open-eighths', fill: 'punk/snare-to-floor', kit: { device: 'core.drums', params: { kit: 0, room: 0.4, tone: 0.2, decay: 1, drive: 0.3 } }, bus: 'Smash' },
    bass: { mode: 'eighths', device: 'core.bassguitar', params: preset('core.bassguitar', 'Punk pick'), rig: 'Grind' },
    gain: { drums: -6, bass: -5.6, guitar: 6 },
    parts: ['Verse', 'Chorus', 'Bridge'], next: ['Chorus', 'Bridge', 'Pre-chorus'],
    kick: 'SUMP PUMP', ending: 'Crash hold', drift: 25,
  },
  metal: {
    id: 'metal', name: 'The metal club', what: 'Metal', blurb: 'Tight and heavy. Your stack, a drummer, and the tape rolling.',
    tempo: [90, 200], prefer: 132, grid: 4, scale: 'minor', rigs: ['modern', 'djent', 'thrash'],
    count: { bars: 1, beats: 4, voice: 'sticks', fast: { at: 160, bars: 2 } },
    drums: { style: 'modernmetal', verse: 'modernmetal/djent-unison-quarters-on-the-hat', chorus: 'modernmetal/open-chorus-crash-riding', fill: 'modernmetal/kick-and-snare-flurry', follow: true, kit: { device: 'core.metalkit', params: preset('core.metalkit', 'Modern', { sub: -13 }) }, bus: 'Modern' },
    bass: { mode: 'roots', device: 'core.ebass', params: preset('core.ebass', 'Even'), rig: 'Modern', rigParams: { low: 0 } },
    gain: { drums: -4.4, bass: -4, guitar: 6 },
    parts: ['Verse', 'Chorus', 'Bridge'], next: ['Chorus', 'Pre-chorus', 'Breakdown', 'Bridge'],
    kick: 'VOID', ending: 'Crash out', drift: 20,
  },
  bluesbar: {
    id: 'bluesbar', name: 'The blues bar', what: 'Blues', blurb: 'A shuffle in a small room, twelve bars at a time.',
    tempo: [70, 140], prefer: 96, grid: 3, scale: 'blues', rigs: ['crunch', 'hardrock', 'edge'],
    count: { bars: 1, beats: 4, voice: 'sticks' },
    drums: { style: 'shuffle', verse: 'shuffle/shuffle', chorus: 'shuffle/double-shuffle', fill: 'shuffle/triplet-pickup', kit: { device: 'core.drums', params: { kit: 5, room: 0.45, tone: 0, decay: 1, drive: 0.15 } }, bus: null },
    bass: { mode: 'boogie', device: 'core.bassguitar', params: { style: 0, tone: 0.35, pickup: 0.25, sustain: 1, mute: 0.08, drive: 0.2 }, rig: null },
    // the twelve-bar, in steps from the riff's root (I, IV, V)
    form: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7],
    gain: { drums: -0.9, bass: -9.3, guitar: 6, lead: 4 },
    parts: ['Head', 'Solo'], next: ['Solo', 'Head'],
    kick: 'LAST CALL', ending: 'Blues ending', drift: 20,
  },
};
export const placeOf = (id) => PLACES[id] || PLACES.metal;

// The room's ear (read.js has it, so the read's Worker loads no more than it needs).
export { earOf };

/* ------------------------------------------------------------------------------------------------ the guitar's fader */
// The guitar fader for a guitar coming in at peakDb (dBFS, the soundcheck's reading), per rig: the fader at -12 dBFS
// in (the place's gain.guitar) less how much louder the amp comes out per dB more in (the slope: an amp compresses, so
// under 1), held within the green (-18 to -6). Measured on the reference DI at -18, -12 and -6 dBFS through each rig
// (tools/liveroom/checks-band.js prints the slopes and holds this table within 0.5 dB of them).
export const FADERS = { modern: 0.08, djent: 0.09, thrash: 0.1, hardrock: 0.1, crunch: 0.13, edge: 0.15 };
export function guitarGain(place, rig, peakDb = -12) {
  const P = placeOf(place), s = FADERS[rig] ?? 0.3;
  const at = Math.min(-6, Math.max(-18, Number.isFinite(peakDb) ? peakDb : -12));
  return Math.round((P.gain.guitar - s * (at + 12)) * 10) / 10;
}

/* ------------------------------------------------------------------------------------------------ the feels */
// A feel is a groove from the place's bank at the part's tempo (§4.4, §5): each feel lists its grooves in order, and
// the first whose tempo range holds the tempo plays. Feels whose kick goes on your chugs: FOLLOW.
export const FEEL_GROOVES = {
  metal: {
    chugs: ['modernmetal/djent-unison-quarters-on-the-hat', 'metal/double-kick'],
    gallop: ['modernmetal/double-kick-gallop', 'metal/gallop'],
    threes: ['modernmetal/djent-unison-in-threes'],
    open: ['modernmetal/open-chorus-crash-riding', 'metal/crash-riding'],
    china: ['modernmetal/china-on-the-beat-kick-in-bursts', 'extreme/double-kick-under-the-china'],
    halftime: ['modernmetal/half-time-china-breakdown', 'metal/breakdown'],
    stops: ['modernmetal/half-time-china-breakdown-stopping'],
    toms: ['modernmetal/tom-groove-under-the-riff', 'metal/tom-groove'],
    build: ['modernmetal/crash-and-floor-toms', 'metal/toms-and-double-kick'],
    blast: ['extreme/traditional-blast'],
    dbeat: ['extreme/swedish-d-beat'],
  },
  basement: {
    straight: ['punk/straight-punk'], open: ['punk/open-eighths'], skank: ['punk/skank-beat'], halftime: ['punk/half-time'], floortoms: ['punk/floor-tom-pound'],
  },
  bluesbar: {
    shuffle: ['shuffle/shuffle'], double: ['shuffle/double-shuffle'], ride: ['shuffle/ride-and-stick'], slow: ['shuffle/slow-twelve-eight'],
  },
};
const FOLLOW = new Set(['chugs', 'open', 'halftime']);
export const follows = (feel) => FOLLOW.has(feel);
// (the modern metal bank to 160, the metal one above: a groove counts at a tempo when the tempo is in its range)
const inRange = (g, tempo) => !!g && tempo >= g.tempo[0] - EPS && tempo <= g.tempo[1] + EPS;
export function grooveOf(place, feel, tempo) {
  const list = FEEL_GROOVES[placeOf(place).id]?.[feel];
  if (!list) return null;
  const t = Number.isFinite(tempo) ? tempo : placeOf(place).prefer;
  const all = list.map((id) => getGroove(id)).filter(Boolean);
  // the modern metal bank to 160, the metal bank above it
  const pick = placeOf(place).id === 'metal' && t > 160 ? all.find((g) => g.style !== 'modernmetal' && inRange(g, t)) || all.find((g) => inRange(g, t)) : all.find((g) => inRange(g, t));
  return pick ? pick.id : null;
}
// Which part a section is, for its feels: a pre-chorus and a breakdown are their own (grooves.js partOfName files a
// pre-chorus as a verse and a breakdown as half time); a blues bar's head is a verse and its solo a chorus.
export function partKey(x) {
  const s = String(x || '').toLowerCase().trim();
  if (['intro', 'verse', 'prechorus', 'chorus', 'half', 'bridge', 'outro'].includes(s)) return s;
  if (/pre[- ]?chorus/.test(s)) return 'prechorus';
  if (/\bhead\b/.test(s)) return 'verse';
  const p = /** @type {string} */ (partOfName(s));
  return p === 'fill' || p === 'ending' ? 'outro' : p;
}
export const FEELS = {
  metal: { intro: ['build'], verse: ['chugs', 'gallop', 'threes'], prechorus: ['chugs', 'china', 'gallop'], chorus: ['open', 'china'], half: ['halftime', 'stops'], bridge: ['toms', 'gallop'], outro: [] },
  basement: { intro: ['floortoms', 'straight'], verse: ['straight', 'skank', 'open'], prechorus: ['straight', 'skank'], chorus: ['open', 'straight'], half: ['halftime', 'floortoms'], bridge: ['halftime', 'floortoms'], outro: [] },
  bluesbar: { intro: ['shuffle'], verse: ['shuffle', 'double', 'ride'], prechorus: ['shuffle', 'ride'], chorus: ['double', 'shuffle', 'ride'], half: ['slow', 'shuffle'], bridge: ['ride', 'shuffle'], outro: [] },
};
export function feelsOf(place, part, tempo) {
  const P = placeOf(place), t = Number.isFinite(tempo) ? tempo : P.prefer, k = partKey(part) || 'verse';
  const list = [...(FEELS[P.id][k] || FEELS[P.id].verse)];
  // at 180 and up the extreme bank's blast and D-beat join the verse and the chorus (§4.4); a slow shuffle under 80
  if (P.id === 'metal' && t >= 180 && (k === 'verse' || k === 'chorus')) list.push('blast', 'dbeat');
  if (P.id === 'bluesbar' && t < 80 && (k === 'verse' || k === 'chorus') && !list.includes('slow')) list.push('slow');
  return list.filter((f) => grooveOf(P.id, f, t));
}

// The fills (§4.3, §5): one beat between equals, two coming down, a bar going up; the ending's groove.
export const FILLS = {
  metal: { one: 'modernmetal/kick-and-snare-flurry', two: 'modernmetal/toms-down-feet-under', bar: 'modernmetal/round-the-kit-into-the-drop', drop: 'modernmetal/round-the-kit-into-the-drop', ending: 'modernmetal/crash-out' },
  metalFast: { one: 'metal/double-kick-flurry', two: 'metal/toms-over-the-feet', bar: 'metal/round-the-kit-feet-under', drop: 'metal/round-the-kit-feet-under', ending: 'metal/crash-out' },
  basement: { one: 'punk/snare-pickup', two: 'punk/snare-to-floor', bar: 'punk/snare-to-floor', drop: 'punk/sixteenths-to-the-toms', ending: 'punk/crash-hold' },
  bluesbar: { one: 'shuffle/triplet-pickup', two: 'shuffle/triplet-roll', bar: 'shuffle/turnaround', drop: 'shuffle/triplet-roll', ending: 'shuffle/blues-ending' },
};
export function fillsOf(place, tempo) {
  const P = placeOf(place);
  return P.id === 'metal' && tempo > 160 ? FILLS.metalFast : FILLS[P.id];
}

/* ------------------------------------------------------------------------------------------------ the finishes */
// The master for each finish (§4.1, §4.6, §5). The metal club's Tight is Boiler Room's master: Slide Rule (a 35 Hz low
// cut, +1.5 dB at 140 Hz, a 1.5 dB shelf down at 10 kHz), Gatefold (mono under 150 Hz, STEEP: under 120 the hard-panned
// guitars' low end still measured -19 dB of side), Clip Lamp (Master clip +3) and Red Line at -1 dBTP, its gain
// measured into the metal window (-8.8 LUFS on the reference); Loud pushes Red Line to about 1.7 LU over (as far as a
// PLR of 6 lets it go: -1 dBTP less 6 is -7 LUFS); Room opens the drums (Drum Riser on its Room preset, band.js
// planFinish) and sits at the window's floor. The basement's Raw, the blues bar's Bar (a short Stairwell) and Close,
// and each place's Loud and Room: each measured on the place's own reference, its window (WINDOWS) around what it
// measured. The gains are what tools/liveroom/checks-band.js measured. drumBus: the Drum Riser preset a finish puts on
// the drums (null: the place's own).
const MASTER_EQ = { b1_on: 1, b1_type: 4, b1_freq: 35, b2_on: 1, b2_type: 0, b2_freq: 140, b2_gain: 1.5, b2_q: 0.8, b8_on: 1, b8_type: 2, b8_freq: 10000, b8_gain: -1.5 };
const ins = (device, params) => ({ device, params, on: true });
const metalMaster = (gain) => [ins('core.eq8', { ...MASTER_EQ }), ins('core.width', { monobass: 150, mono_mode: 1 }), ins('core.clipper', preset('core.clipper', 'Master clip (+3)')), ins('core.limiter', { gain, ceiling: -1, release: 80 })];
const BAR_ROOM = { size: 0.28, decay: 0.9, damp: 0.55, predelay: 8, lowcut: 220, width: 0.8, mix: 0.12 };
const FINISH = {
  metal: {
    tight: { chain: () => metalMaster(5.25) },
    loud: { chain: () => metalMaster(14) },
    room: { chain: () => metalMaster(5.5), drumBus: 'Room' },
  },
  basement: {
    raw: { chain: () => metalMaster(2) },
    loud: { chain: () => metalMaster(10) },
    room: { chain: () => metalMaster(1.5), drumBus: 'Room' },
  },
  bluesbar: {
    bar: { chain: () => [ins('core.eq8', { b1_on: 1, b1_type: 4, b1_freq: 35 }), ins('core.verb', { ...BAR_ROOM }), ins('core.limiter', { gain: 1, ceiling: -1, release: 120 })] },
    close: { chain: () => [ins('core.eq8', { b1_on: 1, b1_type: 4, b1_freq: 35 }), ins('core.limiter', { gain: 1, ceiling: -1, release: 120 })] },
    loud: { chain: () => [ins('core.eq8', { b1_on: 1, b1_type: 4, b1_freq: 35 }), ins('core.clipper', preset('core.clipper', 'Master clip (+3)')), ins('core.limiter', { gain: 3, ceiling: -1, release: 100 })] },
  },
};
export function finishChain(place, finish) {
  const P = placeOf(place), F = FINISH[P.id], id = F[finish] ? finish : FINISHES[P.id][0];
  return F[id].chain();
}
// The Drum Riser preset a finish puts on the drums (the Room finishes open them), else the place's own.
export const finishBus = (place, finish) => FINISH[placeOf(place).id][finish]?.drumBus || placeOf(place).drums.bus;
// The finishes' windows where audio/targets.js has none (no punk or blues targets): integrated LUFS over the song,
// about a dB either side of what each measured on its place's reference (tools/liveroom/band-scene.js; checks-band.js
// prints the readings), and -1 dBTP for all.
export const WINDOWS = {
  basement: { raw: [-10, -7.75], loud: [-8.25, -6], room: [-10.5, -8.25] },
  bluesbar: { bar: [-14.25, -12], close: [-14, -11.75], loud: [-10, -7.75] },
};

/* ------------------------------------------------------------------------------------------------ a chain's hash */
// A short hash of a chain (room.managed's chain): the devices in order and their params, FNV-1a over its JSON.
export function chainHash(inserts) {
  const s = JSON.stringify((inserts || []).map((x) => [x.device, x.on === false ? 0 : 1, Object.keys(x.params || {}).sort().map((k) => [k, x.params[k]])]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------------------------------------ what a place sets up */
const NAMES = { guitarL: 'Guitar L', guitarR: 'Guitar R', guitar: 'Guitar', lead: 'Lead', drums: 'Drums', bass: 'Bass', heard: 'Riff (as heard)', bassYours: 'Bass (yours)' };
const COLORS = { guitarL: 'var(--c-4)', guitarR: 'var(--c-3)', guitar: 'var(--c-4)', lead: 'var(--c-2)', drums: 'var(--c-1)', bass: 'var(--c-5)', heard: 'var(--c-6)', bassYours: 'var(--c-5)' };
// The Riff (as heard) track: the read's notes on a muted track (a muted track, not muted clips: core/jam.js
// harmonyNotes skips muted clips, so tab, jam tips and agents still read them), on DI Box so it shows as a guitar.
const HEARD = { device: 'core.guitar', params: { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 6, mute: 1 } };

function track(role, o) {
  return { role, name: NAMES[role], kind: 'instrument', color: COLORS[role], inserts: [], gain: 0, pan: 0, mute: false, by: 'overdub', ...o };
}
export function guitarChain(rig, side, tuning) {
  return [...(rigChain(rig, side) || rigChain('modern', side) || []), { device: 'core.eq8', params: gtrEq(tuning), on: true }];
}
export function bandTracks(place) {
  const P = placeOf(place), D = P.drums, B = P.bass;
  const drums = track('drums', { instrument: { device: D.kit.device, params: { ...D.kit.params } }, inserts: D.bus ? [{ device: 'core.drumbus', params: preset('core.drumbus', D.bus), on: true }] : [], gain: P.gain.drums });
  const bass = track('bass', { instrument: { device: B.device, params: { ...B.params } }, inserts: B.rig ? [{ device: 'core.bassrig', params: preset('core.bassrig', B.rig, B.rigParams || {}), on: true }] : [], gain: P.gain.bass });
  return { drums, bass };
}

export function setupOf(place, { tuning = null, finish = null, rig = null } = {}) {
  const P = placeOf(place), tune = tuning || (P.id === 'metal' ? 'drop-c' : 'standard'), amp = RIGS[rig] && P.rigs.includes(rig) ? rig : P.rigs[0];
  const fin = FINISHES[P.id].includes(finish) ? finish : FINISHES[P.id][0];
  const { drums, bass } = bandTracks(P.id);
  const g = guitarGain(P.id, amp, -12);
  const tracks = P.id === 'bluesbar'
    ? [
      track('guitar', { kind: 'audio', inserts: guitarChain(amp, 'L', tune), gain: g, pan: -0.4, by: 'you' }),
      track('lead', { kind: 'audio', inserts: [{ device: AMP, params: { ...(presetParams(STACK, 'Lead') || {}) }, on: true }, { device: 'core.eq8', params: gtrEq(tune), on: true }], gain: P.gain.lead, pan: 0.4, by: 'you', later: true }),
      drums, bass,
      track('heard', { instrument: { ...HEARD, params: { ...HEARD.params } }, mute: true }),
    ]
    : [
      track('guitarL', { kind: 'audio', inserts: guitarChain(amp, 'L', tune), gain: g, by: 'you' }),
      track('guitarR', { kind: 'audio', inserts: guitarChain(amp, 'R', tune), gain: g, pan: 1, by: 'you', later: true }),
      drums, bass,
      track('heard', { instrument: { ...HEARD, params: { ...HEARD.params } }, mute: true }),
    ];
  const names = Object.fromEntries(tracks.map((t) => [t.role, t.name]));
  names.bassYours = NAMES.bassYours;
  const feels = Object.fromEntries(['intro', 'verse', 'prechorus', 'chorus', 'half', 'bridge'].map((k) => [k, feelsOf(P.id, k, P.prefer)]));
  return {
    tempo: P.prefer, range: [...P.tempo], meter: [4, 4], grid: P.grid,
    count: { ...P.count, ...(P.count.hits ? { hits: [...P.count.hits] } : {}), ...(P.count.fast ? { fast: { ...P.count.fast } } : {}) },
    tracks, master: finishChain(P.id, fin), masterClip: 'clean', finish: fin, finishes: [...FINISHES[P.id]],
    feels, form: formOf(P.id), names, parts: [...P.parts], next: [...P.next],
    rigs: [...P.rigs], rig: amp, tuning: tune, scale: P.scale, kick: P.kick, ending: P.ending, drift: P.drift,
  };
}

// Lay it out (§3.10): the place's form, from your parts. The metal club's is the corpus's: a buildup intro, verse and
// chorus rotations, the breakdown in the bridge, a last chorus twice, the end (61 bars at 132: 1:51).
function formOf(place) {
  if (place === 'metal') {
    return [
      { name: 'Intro', bars: 4, part: 'intro', feel: 'build', intro: { from: 'Verse', bars: 4, single: 2 }, oneSide: true },
      { name: 'Verse', bars: 8, part: 'verse', copy: 'Verse' },
      { name: 'Chorus', bars: 8, part: 'chorus', copy: 'Chorus' },
      { name: 'Verse', bars: 8, part: 'verse', copy: 'Verse' },
      { name: 'Chorus', bars: 8, part: 'chorus', copy: 'Chorus' },
      { name: 'Breakdown', bars: 8, part: 'half', feel: 'halftime', empty: true, drop: true },
      { name: 'Chorus', bars: 16, part: 'chorus', copy: 'Chorus', reps: 2 },
      { name: 'End', bars: 1, part: 'outro' },
    ];
  }
  if (place === 'basement') {
    return [
      { name: 'Intro', bars: 2, part: 'intro', feel: 'floortoms', intro: { from: 'Verse', bars: 2, single: 0 } },
      { name: 'Verse', bars: 16, part: 'verse', copy: 'Verse', reps: 2 },
      { name: 'Chorus', bars: 8, part: 'chorus', copy: 'Chorus' },
      { name: 'Verse', bars: 8, part: 'verse', copy: 'Verse' },
      { name: 'Chorus', bars: 8, part: 'chorus', copy: 'Chorus' },
      { name: 'Bridge', bars: 8, part: 'bridge', feel: 'halftime', empty: true },
      { name: 'Chorus', bars: 16, part: 'chorus', copy: 'Chorus', reps: 2 },
      { name: 'End', bars: 1, part: 'outro' },
    ];
  }
  return [
    { name: 'Intro', bars: 4, part: 'intro', feel: 'shuffle', intro: { from: 'Head', bars: 4, last: true, single: 0 } },
    { name: 'Head', bars: 12, part: 'verse', copy: 'Head' },
    { name: 'Solo', bars: 12, part: 'chorus', feel: 'double', empty: true },
    { name: 'Solo', bars: 12, part: 'chorus', feel: 'double', empty: true },
    { name: 'Head', bars: 12, part: 'verse', copy: 'Head' },
    { name: 'Ending', bars: 2, part: 'outro' },
  ];
}

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
