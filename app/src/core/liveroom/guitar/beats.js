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
// The DRUMMER stream's (the drummer stream built them; signatures as the foundation froze them):
//   beatOps(p, { section, beat?, seed? }) -> { ops, label, reason: 'room:beat', kept, beat, name, error? }
//       the part's drums: room.part.set { beat } and the drum track's clip under the section made from the beat (the
//       house's clips there replaced, cut at the part's edges; a clip someone else made or changed is theirs: it stays,
//       nothing is written over it, kept: true). Signed by the house inside a step by you (the drum clip's by:
//       'overdub'; the dispatch is yours). The takes stream joins it to a new part's take step; the riser's swap
//       dispatches it for the selected part. The notes: the groove realized at the song's tempo (rules 'band'), seeded
//       `<section>:<beat>`, at the house's touch, nothing added (no crash on the 1, no fills: nothing unasked)
//   jamOps(p, { beat?, from, bars, start? }) -> { ops }
//       the drums for jamming where the song has none (past its end, or a part's bars before its drums are in), from
//       beat `from` for `bars` bars: one clip named 'Jam' by the house, dispatched with store.preview (never kept,
//       never in History) and released when the jam stops; start (an addition): the jam's first beat, so a groove
//       longer than a bar keeps its place in its loop from chunk to chunk; seeded `jam:<beat>:<bar>`. No plan here
//       touches a 'Jam' clip
//   pinOps(p, { pins }) -> { ops, label, reason: 'room:pins' }   the riser's cards set whole (reorder, swap, rename,
//       edit), one room.set; the riser's beat on a card that went goes to that card's groove in the same op
// Fixed by the drummer stream (a body, not a signature): grooveOfBeat on an edited card gives its hits whole ({ p, t,
// d, v, mark, div, row }), so realize plays them; the song keeps them as { t, row, v }.

import { parseGrooves, getGroove, pieceOf, realize, MARKS } from '../../grooves.js';
import { beatsPerBar } from '../../music.js';
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
    // (an edited card: its bar as the song keeps it, { t, row, v }, made whole again so realize can play it: the piece
    // from the row's name, a sixteenth long, the mark its velocity reads as; the groove is that bar, or bars)
    const bpb = beatsPerBar(base.meter || [4, 4]);
    const hits = pin.hits.map(hitOf).filter(Boolean).sort((a, b) => a.t - b.t || a.p - b.p);
    const length = bpb * Math.max(1, Math.ceil((Math.max(0, ...hits.map((x) => x.t)) + 1e-6) / bpb));
    return { ...base, id: beat, name: pin.name || base.name, length, bars: length / bpb, hits, rows: rowsOfHits(hits) };
  }
  try { return getGroove(beat) || null; } catch { return null; }
}
const MARK_OF = (v) => (v >= 0.95 ? 'X' : v >= 0.7 ? 'x' : v >= 0.55 ? 'O' : v >= 0.4 ? 'o' : 'g');
function hitOf(x) {
  if (!x || !Number.isFinite(x.t) || typeof x.row !== 'string') return null;
  const p = Number.isFinite(x.p) ? x.p : pieceOf(x.row);
  if (!Number.isFinite(p)) return null;
  const v = Number.isFinite(x.v) ? Math.max(0.05, Math.min(1, x.v)) : 0.8, mark = typeof x.mark === 'string' && Object.hasOwn(MARKS, x.mark) ? x.mark : MARK_OF(v);
  return { p, t: x.t, d: Number.isFinite(x.d) ? x.d : 0.25, v, mark, div: Number.isFinite(x.div) ? x.div : 4, row: x.row };
}
function rowsOfHits(hits) {
  const seen = [];
  for (const x of hits) if (!seen.includes(x.row)) seen.push(x.row);
  return seen.map((name) => ({ name, cells: '' }));
}

/* ------------------------------------------------------------------------------------------------ the drummer's */
const HOUSE = 'overdub';
const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// The jam's clips are named so (store.preview's, by the house): nothing keeps one, and a plan here never touches one
// (a page closed mid-jam may leave one in a saved song: it plays like any clip, and the room's plans step around it)
const JAM = 'Jam';
const isJam = (c) => c?.name === JAM && c.by === HOUSE;
// still the house's: made by it and every note in it its own (core/liveroom/band.js isHouse's rule)
const isHouse = (c) => c.by === HOUSE && (c.kind !== 'notes' || (c.notes || []).every((n) => (n.by ?? c.by) === HOUSE));
const overlaps = (c, a, b) => Math.min(c.start + c.length, b) - Math.max(c.start, a) > 0.05;
// The house's touch: every hit over a ghost's scaled to it, as the band plays (core/liveroom/band.js TOUCH.base: the
// drums' fader was measured there; tools/liveroom/checks-drummer.js measures the guide and the riser's beats again)
const TOUCH = 0.72;
const touch = (v) => (v <= 0.4 + EPS ? v : r4(Math.max(0.41, Math.min(v >= 0.999 ? 1 : 0.95, v * TOUCH))));
const drumsOf = (p) => { const id = roomOf(p)?.tracks?.drums; return typeof id === 'string' ? (p.tracks || []).find((t) => t.id === id) || null : null; };
const nameOf = (p, beat, g) => {
  if (beat.startsWith('pin:')) { const pin = (roomOf(p)?.pins || []).find((x) => x && x.id === beat.slice(4)); if (pin?.name) return pin.name; }
  return beat === GUIDE_ID ? 'Guide' : g?.name || 'Beat';
};
// the notes a beat plays over `length` beats, `offset` beats into its loop, at the song's tempo, seeded
function notesOf(p, g, { length, offset = 0, seed }) {
  let out = [];
  // (a library groove plays by the live room's house rules; the guide and an edited card aren't in the library, which
  // those rules look a groove up in: they play as written, held under full as the rules hold the rest)
  const lib = (() => { try { return getGroove(g.id) === g; } catch { return false; } })();
  try { out = realize(g, { tempo: +p.tempo || 120, seed, length, offset: g.length > EPS ? offset % g.length : 0, ...(lib ? { rules: 'band' } : {}) }); } catch { out = []; }
  if (!lib) out = out.map((n) => ({ ...n, v: n.v > 0.4 + EPS ? Math.min(0.95, n.v) : n.v }));
  // (the guide plays as written, at no touch: measured, it then sits with the club's verse beat, where at the touch it
  // read 2 LU under it; a guide you can't hear over a guitar isn't one. tools/liveroom/checks-drummer.js holds it there)
  const k = g.id === GUIDE_ID ? (v) => v : touch;
  return out.map((n) => ({ p: n.p, t: n.t, d: n.d, v: k(n.v), by: HOUSE }));
}

export function beatOps(p, { section, beat = null, seed = null } = /** @type {any} */ ({})) {
  const s = (p?.sections || []).find((x) => x.id === section) || null;
  const out = (ops, label, extra = {}) => ({ ops, label, reason: 'room:beat', ...extra });
  if (!s) return out([], '', { error: 'There’s no part there.' });
  const b = typeof beat === 'string' ? beat : beatOf(p, section);
  if (!BEAT_RE.test(b)) return out([], '', { error: `“${b}” isn’t a beat.` });
  const g = grooveOfBeat(p, b);
  if (!g) return out([], '', { error: 'That beat isn’t on the riser or in the book.' });
  const name = nameOf(p, b, g);
  const ops = [];
  if (partOf(p, s)?.beat !== b) ops.push({ type: 'room.part.set', section: s.id, patch: { beat: b } });
  const t = drumsOf(p);
  let kept = false;
  if (t) {
    const a = s.start, e = s.start + s.length;
    const here = t.clips.filter((c) => !isJam(c) && overlaps(c, a, e));
    // a clip someone else made or changed is theirs: the part keeps it, and the beat is only named
    if (here.some((c) => !isHouse(c))) kept = true;
    else {
      let n = 0;
      for (const c of here) {
        const c0 = c.start, c1 = c.start + c.length;
        if (c0 >= a - EPS && c1 <= e + EPS) { ops.push({ type: 'clip.remove', track: t.id, clip: c.id }); continue; }
        // (a clip across the part's edges: cut there, and only the piece inside goes)
        let inside = c.id;
        if (c0 < a - EPS) { const ref = `beat_${c.id}_${n++}`; ops.push({ type: 'clip.split', track: t.id, clip: c.id, at: a, ref }); inside = `$${ref}`; }
        if (c1 > e + EPS) ops.push({ type: 'clip.split', track: t.id, clip: inside, at: e, ref: `beat_${c.id}_${n++}` });
        ops.push({ type: 'clip.remove', track: t.id, clip: inside });
      }
      const notes = notesOf(p, g, { length: s.length, seed: seed ?? `${s.id}:${b}` });
      if (notes.length) ops.push({ type: 'clip.add', track: t.id, clip: { kind: 'notes', start: s.start, length: s.length, name, by: HOUSE, notes } });
    }
  }
  return out(ops, ops.length ? `${name} under the ${String(s.name || 'part').toLowerCase()}` : '', { kept, beat: b, name });
}

// (start: the jam's first beat, where the groove's loop begins; from - start whole bars on. A seam addition: left out,
// the loop begins at `from`)
export function jamOps(p, { beat = null, from, bars, start = null } = /** @type {any} */ ({})) {
  const t = drumsOf(p);
  const b = typeof beat === 'string' && BEAT_RE.test(beat) ? beat : beatOf(p);
  const g = grooveOfBeat(p, b) || GUIDE;
  const bpb = beatsPerBar(p?.meter || [4, 4]);
  const n = Math.max(1, Math.min(64, Math.round(+bars || 1)));
  const f = Math.max(0, +from || 0), s0 = Number.isFinite(+start) && start != null ? +start : f;
  if (!t) return { ops: [] };
  const into = Math.max(0, f - s0), bar = Math.round(into / bpb);
  const notes = notesOf(p, g, { length: n * bpb, offset: into, seed: `jam:${b}:${bar}` });
  return { ops: notes.length ? [{ type: 'clip.add', track: t.id, clip: { kind: 'notes', start: r4(f), length: n * bpb, name: JAM, by: HOUSE, notes } }] : [] };
}

const pinKey = (x) => JSON.stringify([x.id, x.groove, x.name ?? null, x.hits ?? null]);
export function pinOps(p, { pins } = /** @type {any} */ ({})) {
  const was = Array.isArray(roomOf(p)?.pins) ? roomOf(p).pins : [];
  const next = (Array.isArray(pins) ? pins : []).filter(isObj).map((x) => {
    const o = { id: x.id, groove: x.groove };
    if (typeof x.name === 'string' && x.name.trim()) o.name = x.name.trim();
    if (Array.isArray(x.hits)) o.hits = x.hits.map((hh) => ({ t: r4(+hh.t), row: hh.row, v: r4(+hh.v) }));
    return o;
  });
  const out = (ops, label) => ({ ops, label, reason: 'room:pins' });
  if (next.map(pinKey).join('|') === was.map(pinKey).join('|')) return out([], '');
  const label = pinLabel(p, was, next);
  const patch = { pins: next };
  // (the riser's beat on a card that's gone: the beat that card was made from)
  const beat = roomOf(p)?.beat;
  if (typeof beat === 'string' && beat.startsWith('pin:') && !next.some((x) => x.id === beat.slice(4))) {
    const gone = was.find((x) => x.id === beat.slice(4));
    patch.beat = gone?.groove || GUIDE_ID;
  }
  return out([{ type: 'room.set', patch }], label);
}
function pinLabel(p, was, next) {
  const nm = (x) => x.name || grooveOfBeat(p, x.groove)?.name || 'a beat';
  const ids = (xs) => xs.map((x) => x.id);
  const added = next.filter((x) => !was.some((w) => w.id === x.id)), gone = was.filter((x) => !next.some((w) => w.id === x.id));
  if (added.length === 1 && !gone.length) return `Pinned ${nm(added[0])} to the riser`;
  if (gone.length === 1 && !added.length) return `Unpinned ${nm(gone[0])}`;
  if (added.length || gone.length) return 'The riser’s cards';
  if (ids(was).join() !== ids(next).join()) return 'The riser’s cards, in a new order';
  const ch = next.filter((x) => { const w = was.find((y) => y.id === x.id); return pinKey(w) !== pinKey(x); });
  if (ch.length === 1) {
    const w = was.find((y) => y.id === ch[0].id), x = ch[0];
    if (JSON.stringify(w.hits ?? null) !== JSON.stringify(x.hits ?? null)) return `Edited ${nm(x)}`;
    if ((w.name ?? null) !== (x.name ?? null)) return `Renamed ${nm(w)} to ${nm(x)}`;
    return `${nm(x)}: another groove`;
  }
  return 'The riser’s cards';
}
