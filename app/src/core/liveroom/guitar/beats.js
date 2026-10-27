// @ts-check
// The drummer's beats [core; the guitar room: the DRUMMER stream fills it, the foundation froze its exports]
// (docs/research/GUITAR-ROOM.md §2.2, §2.5; AJ: "a simple, metronome-like guide beat by default, easy to swap", "a
// deeper groove library from there, with the main-screen few editable", "no bass by default", "nothing added unasked").
// Pure: no DOM, no store; seeded where anything varies (core/grooves.js realize's seed), so a render is the same twice.
//
// What's in the song (core/liveroom/model.js, the room's fields; room.set / room.part.set, each with its inverse):
//   room.beat            the riser's beat now: what the drummer plays when you jam, and what a new part gets
//   room.pins            the riser's beat cards, in order: [{ id: 'pin id', groove: 'groove id', name?, hits? }]
//                        (hits: an edited bar, the groove's rows as you changed them: [{ t, row, v }]; at most 8 pins)
//   room.parts[s].beat   a part's beat
//   A beat is named by a string (BEAT_RE): a groove id from core/grooves.js ('modernmetal/double-kick-gallop'), the
//   house's GUIDE_ID, or a pin's 'pin:<pin id>' (an edited card: the part plays the card's bar as it is now).
//
// Frozen (the foundation's):
//   GUIDE_ID, GUIDE                  the house's guide beat: a metronome with a backbeat (hat on every beat, snare on 2
//                                    and 4, kick on 1 and 3, no humanising), a groove in core/grooves.js's own shape
//   GUIDE_TEXT                       the same, in the groove format (parseGrooves)
//   DEFAULT_PINS                     the riser's cards when the room is set up: the guide, then four from the metal
//                                    shelves (as the second mock had them)
//   BEAT_RE                          what a beat's name looks like
//   beatOf(p, section?) -> beat      the beat a part plays (its own, else room.beat, else GUIDE_ID)
//   grooveOfBeat(p, beat) -> groove | null   the groove behind a beat name: the library's, the guide, or a pin's edited
//                                    bar (a groove object with its hits), for drawing and for realize
// The DRUMMER stream's (stubs here: each returns no ops until it's built, so a caller can be written against it):
//   beatOps(p, { section, beat?, seed? }) -> { ops, label, reason: 'room:beat' }
//       the part's drums: room.part.set { beat } and the drum track's clips under the section made from the beat (the
//       house's clips there replaced; a clip someone else changed is theirs and stays). Signed by the house inside a
//       step by you (the drum clips' by: 'overdub'; the dispatch is yours). The takes stream joins it to a new part's
//       take step; the riser's swap dispatches it for the selected part.
//   jamOps(p, { beat?, from, bars }) -> { ops }
//       the drums for jamming past the song's end, from beat `from` for `bars` bars: dispatched with store.preview
//       (never kept, never in History) and released when the jam stops
//   pinOps(p, { pins }) -> { ops, label, reason: 'room:pins' }   the riser's cards set whole (reorder, swap, rename, edit)

import { parseGrooves, getGroove } from '../../grooves.js';
import { roomOf, partOf } from '../model.js';

export const GUIDE_ID = 'house/guide';
export const GUIDE_TEXT = [
  'style house  The room',
  'blurb  a metronome with a backbeat: the hat on every beat, the snare on 2 and 4',
  'tempo  40-260',
  'human  0ms 0%',
  'verse  Guide  1 bar',
  '  hat    x x x x',
  '  snare  . X . X',
  '  kick   x . x .',
].join('\n');
const parsed = parseGrooves(GUIDE_TEXT, { file: 'house' });
export const GUIDE = Object.freeze(parsed.styles?.[0]?.grooves?.[0] || null);

// the riser's cards at first (pin ids are the room's: 'p1'..; ids are forever once a song has them)
export const DEFAULT_PINS = Object.freeze([
  Object.freeze({ id: 'p1', groove: GUIDE_ID, name: 'Guide' }),
  Object.freeze({ id: 'p2', groove: 'modernmetal/djent-unison-quarters-on-the-hat', name: 'Djent' }),
  Object.freeze({ id: 'p3', groove: 'modernmetal/double-kick-gallop', name: 'Gallop' }),
  Object.freeze({ id: 'p4', groove: 'modernmetal/open-chorus-crash-riding', name: 'Open' }),
  Object.freeze({ id: 'p5', groove: 'modernmetal/half-time-china-breakdown', name: 'Half-time' }),
]);

export const BEAT_RE = /^(pin:[A-Za-z0-9_-]{1,32}|[a-z0-9][a-z0-9-]{0,31}\/[a-z0-9][a-z0-9-]{0,63})$/;

export function beatOf(p, section = null) {
  const own = section ? partOf(p, section)?.beat : null;
  if (typeof own === 'string' && BEAT_RE.test(own)) return own;
  const b = roomOf(p)?.beat;
  return typeof b === 'string' && BEAT_RE.test(b) ? b : GUIDE_ID;
}

export function grooveOfBeat(p, beat) {
  if (typeof beat !== 'string') return null;
  if (beat === GUIDE_ID) return GUIDE;
  if (beat.startsWith('pin:')) {
    const pin = (roomOf(p)?.pins || []).find((x) => x && x.id === beat.slice(4));
    if (!pin) return null;
    const base = grooveOfBeat(p, pin.groove);
    if (!Array.isArray(pin.hits) || !base) return base;
    return { ...base, id: beat, name: pin.name || base.name, hits: pin.hits.map((h) => ({ ...h })) };
  }
  try { return getGroove(beat) || null; } catch { return null; }
}

/* ------------------------------------------------------------------------------------------------ the drummer's (stubs) */
export function beatOps(_p, { section: _section, beat: _beat, seed: _seed } = /** @type {any} */ ({})) {
  return { ops: [], label: '', reason: 'room:beat' };
}
export function jamOps(_p, { beat: _beat, from: _from, bars: _bars } = /** @type {any} */ ({})) {
  return { ops: [] };
}
export function pinOps(_p, { pins: _pins } = /** @type {any} */ ({})) {
  return { ops: [], label: '', reason: 'room:pins' };
}
