// @ts-check
// The part line's plans [ui, pure; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.5-§2.7; AJ: insert
// anywhere, an intro before the first part, drag to reorder, delete any card including the last, ⌘Z). What a take and
// each part-line move do to the song, as ops for one store.dispatch by you. Pure: no DOM, no store; each plan is made of
// existing ops (section.add / set / move, time.insert / remove, room.part.set, clip.set, clip.add), so each has an
// exact inverse. It lives beside the stream's view because it is the stream's; it imports only the core.
//
// A part is a section (the song's sections in start order, core/liveroom/session.js readRoom's cards, the End aside).
// The guitar room adds no End and nothing else unasked: a part is made when you record one, insert one or drop a riff.
//
//   partLine(p) -> { parts: [card], bpb, roles, end, next, tempo }   the part line as readRoom reads it: parts (start
//       order, each { id, name, start, length, bars, takes: { L, R }, playing: { L, R }, empty, part }), end (the beat
//       after the last part: where a new part goes), next (the name a new part gets)
//   NEW_BARS = 4                     an inserted part's length, bars
//   newPartLength(p, { from, end }) -> beats   a part recorded at the end: whole bars from `from` up to the bar line
//       at or before where the take stopped (the ring after it is the take's tail), a bar at least
//   planNewPart(p, { at, bars, name, id }) -> { ops, label, reason, section, start, length }   an empty part at index
//       `at` of the part line (0: before the first, an intro; parts.length: at the end): time.insert there when parts
//       follow, section.add, room.part.set { reps: 1 }
//   planTakeIn(p, { track, clip, from, section, name, id }) -> { ops, label, reason, section, start, length, ring, isNew }
//       what joins a landed take's step: for a new part (no section), its section and room.part.set, its length by
//       newPartLength, and the take's tail (clip.set { tail }: what rang past the part); for an existing part, nothing
//       (the recorder set its tail from tailFrom) but the label. label "Verse take 2" / "Verse, the other side (take 2)"
//   planPartEnd(p, { section, track, clip, bars }) -> { ops, label, reason, length, ring }   a new part's end moved to
//       `bars` bars (the review's part-end handle): section.set length and the take's tail recomputed (its clip keeps its
//       length: what's past the part is its ring)
//   planRemovePart(p, { section }) -> { ops, label, reason }   the part and its bars out (room.part.set remove,
//       time.remove): what follows closes up; a ring from the part before stays on its take
//   planMovePart(p, { section, to }) -> { ops, label, reason, where }   section.move to index `to` of the part line (the
//       index among the parts as they are now, the moved one included: to = i or i + 1 is no move)
//   planPick(p, { section, side, dir }) -> { ops, label, reason, take, n } | { ops: [], edge: 'first' | 'last' | 'one' }
//       the kept take before (dir -1) or after (dir 1) the one playing, in the order they were played: it plays, the
//       others are muted (a muted take's ring is muted with it)
//   takesIn(p, { section, side }) -> [clip]   a part's takes on a side, in the order they were played (one clip each)
//   takeGroups(p, { section, side }) -> [{ clips, playing, clip }]   the same, each take with all its pieces;
//       playingTake(groups) -> index   the one that plays (the newest with a piece playing)
//   planRiffPart(p, { at, riff, track, name, id, sr }) -> { ops, label, reason, section, start, length }   a riff off the
//       tape as a part at index `at`: riff is riffs-db intoSong's result ({ ops, clip, beats, bars, tail }); its bars
//       (whole bars of its beats) inserted, the section, and the riff's clip on `track` at the part's 1, its ring (tail,
//       seconds) kept as the clip's tail
//   whereWords(line, i) -> 'before Chorus' | 'after Verse' | ''   where index i sits among the others (the parts' names
//       as the song has them, a name being a name: "Rdn Intro", never "rdn intro")

import { readRoom } from '../../../core/liveroom/session.js';
import { partOf } from '../../../core/liveroom/model.js';
import { beatsPerBar } from '../../../core/music.js';
import { newId, clipTail } from '../../../core/project.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
export const NEW_BARS = 4;
const none = (extra = {}) => ({ ops: [], label: '', reason: '', ...extra });

function minter(p) {
  const used = new Set();
  for (const t of p?.tracks || []) { used.add(t.id); for (const c of t.clips || []) used.add(c.id); }
  for (const s of p?.sections || []) used.add(s.id);
  return (prefix) => { for (;;) { const id = newId(prefix); if (!used.has(id)) { used.add(id); return id; } } };
}

export function partLine(p) {
  const v = readRoom(p);
  const parts = v.parts;
  const end = parts.length ? r4(Math.max(...parts.map((c) => c.start + c.length))) : 0;
  return { parts, bpb: v.bpb || beatsPerBar(p?.meter || [4, 4]), roles: v.roles || {}, end, next: v.next || 'Verse', tempo: v.tempo || p?.tempo || 120 };
}

export function whereWords(line, i) {
  const ps = line.parts;
  const after = ps[i + 1], before = ps[i - 1];
  return after ? `before ${after.name}` : before ? `after ${before.name}` : '';
}

export function newPartLength(p, { from, end }) {
  const bpb = beatsPerBar(p?.meter || [4, 4]);
  const n = Math.floor((Number(end) - Number(from)) / bpb + 1e-3);
  return Math.max(1, n) * bpb;
}

export function planNewPart(p, { at = null, bars = NEW_BARS, name = null, id = null } = {}) {
  const line = partLine(p);
  const n = line.parts.length;
  const i = at == null ? n : Math.max(0, Math.min(n, Math.round(Number(at) || 0)));
  const start = i < n ? line.parts[i].start : line.end;
  const length = r4(Math.max(1, Math.round(Number(bars) || NEW_BARS)) * line.bpb);
  const sid = id || minter(p)('s');
  const nm = String(name || line.next);
  /** @type {any[]} */
  const ops = [];
  if (i < n) ops.push({ type: 'time.insert', at: start, length });
  ops.push({ type: 'section.add', section: { id: sid, name: nm, start, length } });
  ops.push({ type: 'room.part.set', section: sid, patch: { reps: 1 } });
  return { ops, label: i === 0 && n ? `${nm} before ${line.parts[0].name}` : `A new part: ${nm}`, reason: `room:part:${sid}`, section: sid, start, length };
}

export function planTakeIn(p, { track = null, clip = null, from = 0, section = null, name = null, id = null } = {}) {
  const t = (p?.tracks || []).find((x) => x.id === track) || null;
  const c = t?.clips.find((x) => x.id === clip) || null;
  if (!t || !c) return none({ error: 'The take isn’t in the song.' });
  const line = partLine(p);
  const role = Object.entries(line.roles).find(([, tid]) => tid === track)?.[0] || 'guitarL';
  const side = role === 'guitarR' ? 'R' : 'L';
  const existing = section ? line.parts.find((x) => x.id === section) || null : null;
  /** @type {any[]} */
  const ops = [];
  let sid, nm, start, length, ring;
  const end = c.start + c.length;
  if (existing) {
    sid = existing.id; nm = existing.name; start = existing.start; length = existing.length;
    ring = Math.max(0, end - (start + length));
  } else {
    sid = id || minter(p)('s');
    nm = String(name || line.next);
    start = r4(Number(from) || 0);
    length = newPartLength(p, { from: start, end });
    ring = r4(Math.max(0, end - (start + length)));
    ops.push({ type: 'section.add', section: { id: sid, name: nm, start, length } });
    ops.push({ type: 'room.part.set', section: sid, patch: { reps: 1 } });
    // (what rang past the part is the take's tail: it plays on under the next part's take, never muted by it)
    const tail = ring >= 1 / 64 && ring < c.length - EPS ? ring : 0;
    if (Math.abs(clipTail(c) - tail) > 1e-4) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { tail: tail || null } });
    if (!tail) ring = 0;
  }
  // which take of the part this is, on its side (counting the one that landed)
  const n = takesIn(p, { section: sid, side, sec: { start, length } }).length || 1;
  const label = side === 'R' ? `${nm}, the other side${n > 1 ? ` (take ${n})` : ''}` : `${nm} take ${n}`;
  return { ops, label, reason: `room:take:${sid}`, section: sid, start, length, ring, isNew: !existing, take: n, side };
}

export function planPartEnd(p, { section = null, track = null, clip = null, bars = 1 } = {}) {
  const sec = (p?.sections || []).find((s) => s.id === section);
  const t = (p?.tracks || []).find((x) => x.id === track);
  const c = t?.clips.find((x) => x.id === clip);
  if (!sec || !t || !c) return none();
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const length = r4(Math.max(1, Math.round(Number(bars) || 1)) * bpb);
  /** @type {any[]} */
  const ops = [];
  if (Math.abs(length - sec.length) > EPS) ops.push({ type: 'section.set', section: sec.id, patch: { length } });
  const end = c.start + c.length;
  const ring = r4(end - (sec.start + length));
  const tail = ring >= 1 / 64 && ring < c.length - EPS ? ring : 0;
  if (Math.abs(clipTail(c) - tail) > 1e-4) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { tail: tail || null } });
  return { ops, label: `${sec.name}: ${length / bpb} bar${length / bpb === 1 ? '' : 's'}`, reason: `room:partlen:${sec.id}`, length, ring: tail };
}

export function planRemovePart(p, { section = null } = {}) {
  const sec = (p?.sections || []).find((s) => s.id === section);
  if (!sec) return none();
  /** @type {any[]} */
  const ops = [];
  // (time.remove takes the section out but leaves its room.parts entry: the part goes first, so ⌘Z brings both)
  if (partOf(p, sec.id)) ops.push({ type: 'room.part.set', section: sec.id, remove: true });
  ops.push({ type: 'time.remove', at: sec.start, length: sec.length });
  return { ops, label: `Removed ${sec.name}`, reason: `room:remove:${sec.id}` };
}

export function planMovePart(p, { section = null, to = null } = {}) {
  const line = partLine(p);
  const i = line.parts.findIndex((x) => x.id === section);
  if (i < 0 || to == null) return none();
  const j = Math.max(0, Math.min(line.parts.length, Math.round(Number(to))));
  if (j === i || j === i + 1) return none();
  const before = line.parts[j] || null;
  const sec = line.parts[i];
  // (where it lands, among the others: the part before or after it once it's there)
  const rest = line.parts.filter((x) => x.id !== sec.id);
  const k = before ? rest.findIndex((x) => x.id === before.id) : rest.length;
  const where = rest[k] ? `before ${rest[k].name}` : rest[k - 1] ? `after ${rest[k - 1].name}` : '';
  return { ops: [{ type: 'section.move', section: sec.id, before: before ? before.id : null }], label: `Moved ${sec.name} ${where}`, reason: `room:move:${sec.id}`, where };
}

// a part's takes on a side: the audio clips on its guitar that start in its bars (their 30 ms lead aside) or cover most
// of them, the ring of the part before aside, in the order they were played (by when their recordings came in: the
// song's assets, oldest first; then the track's order). One recording is one take, however many pieces a later take
// that stopped short cut it into (the take folder keeps the bars the short one didn't reach): takeGroups gives the
// pieces of each, takesIn one clip for each (the piece that plays, else the first)
export function takeGroups(p, { section = null, side = 'L', sec = null } = {}) {
  const line = partLine(p);
  const s = sec || line.parts.find((x) => x.id === section);
  const tid = line.roles[side === 'R' ? 'guitarR' : 'guitarL'];
  const t = (p?.tracks || []).find((x) => x.id === tid);
  if (!s || !t) return [];
  const ov = (c) => Math.min(c.start + c.length - clipTail(c), s.start + s.length) - Math.max(c.start, s.start);
  const mine = t.clips.filter((c) => c.kind === 'audio' && ov(c) > 0.25 && (c.start >= s.start - 0.5 || ov(c) > s.length / 2) && !(c.mute && c.length < s.length / 2));
  const keys = Object.keys(p.assets || {});
  const at = (c) => { const k = keys.indexOf(c.asset); return k < 0 ? Infinity : k; };
  const sorted = mine.map((c, i) => ({ c, i })).sort((a, b) => at(a.c) - at(b.c) || a.i - b.i).map((x) => x.c);
  /** @type {Map<string, any[]>} */
  const by = new Map();
  for (const c of sorted) { const k = c.asset || c.id; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  return [...by.values()].map((clips) => ({ clips, playing: clips.some((c) => !c.mute), clip: clips.find((c) => !c.mute) || clips[0] }));
}
export function takesIn(p, opts = {}) {
  return takeGroups(p, opts).map((g) => g.clip);
}
// which of them plays: the newest with a piece playing (a short take plays in its bars, the one before it after them)
export const playingTake = (groups) => groups.findLastIndex((g) => g.playing);

export function planPick(p, { section = null, side = 'L', dir = 1 } = {}) {
  const line = partLine(p);
  const s = line.parts.find((x) => x.id === section);
  const tid = line.roles[side === 'R' ? 'guitarR' : 'guitarL'];
  if (!s || !tid) return none({ edge: 'one' });
  const order = takeGroups(p, { section, side });
  if (order.length < 2) return none({ edge: 'one', n: order.length });
  const cur = Math.max(0, playingTake(order));
  const j = cur + (dir > 0 ? 1 : -1);
  if (j < 0 || j >= order.length) return none({ edge: j < 0 ? 'first' : 'last', take: cur + 1, n: order.length });
  // (the picked take plays, every piece of it; the others go quiet where it plays, and keep what they had past it: a
  // short take picked again still has the bars it didn't reach from the take before)
  const span = (c) => [c.start, c.start + c.length - clipTail(c)];
  const its = order[j].clips.map(span);
  const under = (c) => { const [a, b] = span(c); return its.some(([x, y]) => Math.min(b, y) - Math.max(a, x) > 0.25); };
  /** @type {any[]} */
  const ops = [];
  order.forEach((g, k) => { for (const x of g.clips) if (k !== j && !x.mute && under(x)) ops.push({ type: 'clip.set', track: tid, clip: x.id, patch: { mute: true } }); });
  for (const x of order[j].clips) if (x.mute) ops.push({ type: 'clip.set', track: tid, clip: x.id, patch: { mute: false } });
  if (!ops.length) ops.push({ type: 'clip.set', track: tid, clip: order[j].clip.id, patch: { mute: false } });
  return { ops, label: `${s.name}: take ${j + 1}`, reason: `room:takepick:${s.id}`, take: j + 1, n: order.length, clip: order[j].clip.id };
}

export function planRiffPart(p, { at = null, riff = null, track = null, name = null, id = null } = {}) {
  if (!riff || !riff.clip || !track) return none({ error: 'No riff to put there.' });
  const line = partLine(p);
  const n = line.parts.length;
  const i = at == null ? n : Math.max(0, Math.min(n, Math.round(Number(at) || 0)));
  const bpb = line.bpb;
  const beats = Number(riff.beats ?? riff.clip.length) || bpb;
  const length = r4(Math.max(1, Math.round(beats / bpb)) * bpb);
  const start = i < n ? line.parts[i].start : line.end;
  const sid = id || minter(p)('s');
  const nm = String(name || riff.clip.name || line.next);
  /** @type {any[]} */
  const ops = [];
  if (i < n) ops.push({ type: 'time.insert', at: start, length });
  ops.push({ type: 'section.add', section: { id: sid, name: nm, start, length } });
  ops.push({ type: 'room.part.set', section: sid, patch: { reps: 1 } });
  // the riff's audio described in the song (asset.add), then its clip at the part's 1, its ring kept as its tail
  for (const o of riff.ops || []) if (o.type === 'asset.add') ops.push(o);
  const spb = 60 / (Number(p.tempo) || 120);
  const tailBeats = Number(riff.tail) > 0 ? r4(Math.min(Number(riff.tail) / spb, 4 * bpb)) : 0;
  const clip = { ...riff.clip, start, length: r4(beats + tailBeats), by: 'you' };
  if (tailBeats >= 1 / 64) clip.tail = tailBeats;
  delete clip.id;
  ops.push({ type: 'clip.add', track, clip, ref: 'riffpart' });
  return { ops, label: `${nm} off the tape`, reason: `room:riff:${sid}`, section: sid, start, length };
}
