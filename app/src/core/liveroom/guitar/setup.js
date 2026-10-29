// @ts-check
// The guitar room's setup [core; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §2.1, §2.2; AJ's
// answers: the club's stack loaded, a simple guide beat, no bass by default, nothing added unasked). Pure.
//
// The metal club, as the guitar room makes it: the door's one step by you (core/liveroom/plans.js planPlace with this
// setup). The tempo and the meter (132, 4/4), Guitar L and Guitar R (audio, both through the club's stack, then the
// room's Slide Rule EQ for the tuning: ONE stack, both sides tracked on it, core/liveroom/guitar/rig.js), the Drums
// (the club's kit and Drum Riser, the house's), the master's Tight finish, and the room: place, tuning, rig, the
// tracks by role, the riser's beat (the guide) and its cards (beats.js DEFAULT_PINS). No bass, no Riff (as heard), no
// parts: the part line starts empty.
//
//   CLUB_STACK = { id: 'house.metal.club', name: 'The club’s stack', chain }   a noise gate and a treble booster into
//       Kraken (amp.recto) on its closed 4x12 with a dynamic mic on the cap edge, a delay and a plate in the loop (off)
//   GUITAR_DB                       the guitars' fader for the club's stack, measured (tools/liveroom/checks-guitar.js
//                                   holds it to the old Half Stack's level within a dB)
//   guitarSetup({ tuning, stack }) -> a setup (core/liveroom/places.js setupOf's shape) for planPlace
//   planGuitarRoom(p, { tuning, stack }) -> { ops, label: 'Into the metal club', reason: 'room:place' }
//   isGuitarRoom(p) -> bool          the song is the guitar room's: its room is the metal club (an older metal song too:
//                                    the guitar room opens it, its Half Stack on the board)

import { planPlace } from '../plans.js';
import { setupOf, gtrEq } from '../places.js';
import { roomOf } from '../model.js';
import { GUIDE_ID, DEFAULT_PINS } from './beats.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export const CLUB_STACK = Object.freeze({
  id: 'house.metal.club',
  name: 'The club’s stack',
  chain: Object.freeze([
    { device: 'pedal.gate', params: { th: -62 }, on: true },
    { device: 'pedal.mantisboost', params: { boost: 6, range: 0 }, on: true },
    // Kraken on the 4x12 Modern (cab 7), a dynamic (mic 0) on the cap edge, an inch back
    { device: 'amp.recto', params: { gain: 6.8, bass: 6.2, mid: 4.4, treble: 6.4, presence: 6, level: 6.2, cab: 7, mic: 0, micpos: 0.3, micdist: 1, micang: 0 }, on: true },
    { device: 'pedal.delay', params: { time: 2, fb: 4, mix: 4 }, on: false },
    { device: 'pedal.lobsterplate', params: { decay: 4, tone: 6, pre: 20, mix: 3 }, on: false },
  ].map((l) => Object.freeze(l))),
});

// The guitar tracks' fader, dB: measured, not guessed. The metal DI fixtures (tools/fixtures/metal-di/, chug and
// chords) rendered offline through the club's stack and through the old stage's Half Stack (places.js setupOf('metal'),
// at its own fader, +6), BS.1770: the club's reads -20.2 and -20.7 LUFS, the Half Stack's -18.3 and -15.9 with its
// fader; this fader puts the two DIs' mean on the old one's (each within 2 LU: the stacks answer a chug and a chord
// differently). tools/liveroom/checks-guitar.js measures it again.
export const GUITAR_DB = 3.3;

export function guitarSetup({ tuning = null, stack = null } = {}) {
  const S = setupOf('metal', { tuning });
  const chain = clone((stack && Array.isArray(stack.chain) ? stack.chain : null) || CLUB_STACK.chain);
  const eq = { device: 'core.eq8', params: gtrEq(S.tuning), on: true };
  const tracks = [];
  for (const t of S.tracks) {
    if (t.role === 'guitarL' || t.role === 'guitarR') tracks.push({ ...clone(t), inserts: [...clone(chain), clone(eq)], gain: GUITAR_DB });
    else if (t.role === 'drums') tracks.push(clone(t));
    // (no bass and no Riff (as heard): the guitar room's band is the drummer alone, until you add one)
  }
  const names = Object.fromEntries(tracks.map((t) => [t.role, t.name]));
  return { ...S, tracks, names, rig: null, form: [] };
}

export function planGuitarRoom(p, { tuning = null, stack = null } = {}) {
  const setup = guitarSetup({ tuning, stack });
  const plan = planPlace(p, { place: 'metal', tuning: setup.tuning, setup });
  const room = roomOf(p);
  const extra = {};
  if (!room?.beat) extra.beat = GUIDE_ID;
  if (!Array.isArray(room?.pins) || !room.pins.length) extra.pins = DEFAULT_PINS.map((x) => ({ ...x }));
  if (!room?.stack) extra.stack = stack?.id ? { id: stack.id, ...(stack.name ? { name: stack.name } : {}) } : { id: CLUB_STACK.id, name: CLUB_STACK.name };
  const ops = [...plan.ops];
  if (Object.keys(extra).length) ops.push({ type: 'room.set', patch: extra });
  return { ops, label: plan.label || 'Into the metal club', reason: 'room:place' };
}

export function isGuitarRoom(p) {
  return roomOf(p)?.place === 'metal';
}
