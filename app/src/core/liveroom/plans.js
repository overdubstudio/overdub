// @ts-check
// The stage's plans [core; stream C] (docs/research/LIVE-ROOM-MODE.md §3, §7.2, §7.3, §9.3): what picking a place, a
// take, laying a song out and the card menu's moves do to the song. Pure: each -> { ops, label, reason } for one
// store.dispatch, made of existing ops (section.move is core/arrangement.js's), and never dispatches.
//
// Frozen (§14.2):
//   planPlace(p, { place, tuning })      the tempo and meter, the role tracks with their chains and faders (from
//                                        core/liveroom/places.js setupOf; the kitchen's from kitchen.js kitchenSetup),
//                                        the master finish, room.set
//   takeOps(take, { part })              the ops joined to a take's step: a new part's section.add and room.part.set,
//                                        the seams' re-trims, the End moved
//   planLayout(p)                        the place's form: copies, empty sections, their parts and their band, the End
//   planTwice(p, { section })            ×2
//   planMove(p, { section, before })     section.move, with the seams and the End
//   planShorter(p, { section, bars })    time.remove of the bars cut
//   planRemove(p, { section })           time.remove over the part
//   planEnd(p)                           the End: one bar after the last part, its ring kept
//
// What each takes and returns, beside the frozen shape:
//   planPlace(p, { place, tuning, finish, mic, setup })   setup: what the place sets up (setupOf's shape; the default
//       is places.js setupOf, or kitchen.js kitchenSetup at the kitchen). Its tracks are [{ role, name, kind, ... }]:
//       track.add's track with the role it plays (or { role, track: {...} }); a band role (drums, bass, the riff as
//       heard, the kitchen's players and chords) is signed by the house inside the step unless the spec signs it.
//       Roles the song already has are kept; a song's own master chain is kept (the finish is then null: "Yours").
//       By you, label "Into the metal club", reason room:place
//   takeOps(take, { part })   take: { song (the song as the take left it, the take in), track, clip (the take's clip;
//       or clips: every clip the take put in), from (the part's 1, beats), to (the stop's bar line), section (an
//       existing part's id: Again, the other side, a punch; none for a new part), name (a new part's name), id (a new
//       part's section id; one is made), drop (the song's first part: the beats of whole bars at its head you didn't
//       play in, the deck's quietLead, dropped: the take moves left by them) }; part: room.part.set's patch for a new part (its feel). -> { ops, label,
//       reason, section } by you, reason room:take:<section>, label "Verse take 1". The take's clips start 30 ms before
//       the part's 1 (the first part's at beat 0) when the recording reaches back that far, end on the next part's
//       seam (a butt splice) or, the last part, ring a bar into the End; the take before it on the track ends where it
//       starts; the End moves to follow the last part
//   planLayout(p) -> { ops, label, reason, after, form, bars, secs, empty }   by the house, reason room:layout: the
//       place's form (FORMS below) over the parts played so far; form: the parts' names in order ("Intro, verse, …,
//       end"), bars and secs: its length, empty: the first part in it that has no take
//   planTwice, planMove, planShorter, planRemove -> { ops, label, reason, after }   by you
//   after(p) -> ops: what the plan's step needs once its ops are in (the seams at the new boundaries, the End, and,
//       after a layout, the band's feel on each empty part), planned on the song as the ops left it and dispatched
//       joined to the step (store.dispatch(after(store.get()), { by, join: txn })), so it's one undo step
//   planEnd(p) -> { ops, label, reason }   by the house, reason room:end

import { roomOf, partOf, NAMES, FINISHES } from './model.js';
import { setupOf, placeOf } from './places.js';
import { kitchenSetup } from './kitchen.js';
import { planFeel } from './band.js';
import { readRoom } from './session.js';
import { beatsPerBar, beatsBefore, beatSecs } from '../music.js';
import { newId } from '../project.js';

const EPS = 1e-6;
const MIN_CLIP = 0.25;
const LEAD = 0.03;          // a take's clip starts 30 ms before its part's 1 (§7.2)
const r4 = (x) => Math.round(x * 10000) / 10000;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const low = (s) => String(s || '').toLowerCase();
const none = () => ({ ops: [], label: '', reason: '' });
const HOUSE = 'overdub';
// the band's roles: their tracks are the house's
const BAND = new Set(['drums', 'bass', 'heard', 'shaker', 'cajon', 'kbass', 'strings', 'chords']);
// the roles a take is on
const TAKE_ROLES = ['guitarL', 'guitarR', 'guitar', 'lead', 'take', 'voice', 'kguitar', 'bassYours'];
const endBars = (place) => (place === 'bluesbar' ? 2 : 1);
const endName = (place) => (place === 'bluesbar' ? 'Ending' : 'End');
const sectionOf = (p, id) => (Array.isArray(p?.sections) ? p.sections.find((s) => s.id === id) : null) || null;
const named = (s) => /^(end|ending)$/i.test(String(s?.name || '').trim());
// (in start order, an End after anything that starts with it)
const sorted = (p) => (Array.isArray(p?.sections) ? p.sections.slice().sort((a, b) => a.start - b.start || Number(named(a)) - Number(named(b))) : []);
// The End: the last section, named End (Ending at the blues bar), with nothing starting after it but another End
const endOf = (all) => { const e = all.filter(named).at(-1); return e && all.length > 1 && !all.some((s) => !named(s) && s.start > e.start + EPS) ? e : null; };
const isEndSec = (s, i, all) => s === endOf(all);
function minter(p) {
  const used = new Set();
  for (const t of p?.tracks || []) { used.add(t.id); for (const c of t.clips || []) used.add(c.id); }
  for (const s of p?.sections || []) used.add(s.id);
  return (prefix) => { for (;;) { const id = newId(prefix); if (!used.has(id)) { used.add(id); return id; } } };
}
const lead = (p, at) => r4(beatsBefore(p, at, LEAD));

/* ------------------------------------------------------------------------------------------------ the place */
export function planPlace(p, { place = null, tuning = null, finish = null, mic = 'one', setup = null } = {}) {
  if (!place || !NAMES.place[place]) return none();
  const S = setup || (place === 'kitchen' ? kitchenSetup({ mic }) : setupOf(place, { tuning, finish }));
  const room = roomOf(p) || {};
  const have = readRoom(p).roles;
  /** @type {any[]} */
  const ops = [];
  const hasTakes = (p.tracks || []).some((t) => t.kind === 'audio' && t.clips.length);
  const patch = {};
  if (!p.tempoMap && !hasTakes && Number.isFinite(S.tempo)) patch.tempo = S.tempo;
  if (Array.isArray(S.meter) && !hasTakes) patch.meter = S.meter;
  if (Object.keys(patch).length) ops.push({ type: 'project.set', patch });
  const tracks = { ...(isObj(room.tracks) ? have : {}) }, managed = {};
  for (const spec of Array.isArray(S.tracks) ? S.tracks : []) {
    if (!isObj(spec) || typeof spec.role !== 'string') continue;
    const role = spec.role;
    if (tracks[role]) continue;
    const { role: _r, track: inner, ...rest } = spec;
    const track = clone(isObj(inner) ? inner : rest);
    if (!track.by && BAND.has(role)) track.by = HOUSE;
    ops.push({ type: 'track.add', track, ref: role });
    tracks[role] = `$${role}`;
    const m = {};
    if (Number.isFinite(track.gain)) m.gain = track.gain;
    if (Number.isFinite(track.pan)) m.pan = track.pan;
    if (Object.keys(m).length) managed[`$${role}`] = m;
  }
  // the master: the place's finish, unless the song has a chain of its own (then it's yours, and stays)
  const own = (p.master?.inserts || []).length > 0;
  const fin = finish || S.finish || (FINISHES[place] || [])[0] || null;
  if (!own) for (const ins of Array.isArray(S.master) ? S.master : []) if (isObj(ins) && ins.device) ops.push({ type: 'insert.add', track: 'master', insert: clone(ins) });
  const rp = { place };
  if (place !== 'kitchen') { const rig = S.rig || placeOf(place).rigs?.[0]; if (rig) rp.rig = rig; }
  if (tuning) rp.tuning = tuning;
  if (!own && fin) rp.finish = fin;
  if (place === 'kitchen') rp.mic = mic === 'two' ? 'two' : 'one';
  if (Object.keys(tracks).length) rp.tracks = tracks;
  if (Object.keys(managed).length) rp.managed = { ...(isObj(room.managed) ? room.managed : {}), ...managed };
  ops.push({ type: 'room.set', patch: rp });
  return { ops, label: `Into ${NAMES.place[place]}`, reason: 'room:place' };
}

/* ------------------------------------------------------------------------------------------------ seams */
// The seams on the room's take tracks after a step that moved bars (§7.2), worked out on copies of the clips and
// written as one clip.set (or clip.remove) per clip:
//   1. butt splices: a span that runs past the start of the next one ends where it starts (the engine's own edge
//      fades do the rest), so no two takes ever play over each other;
//   2. the End rings with the last part's own take: a clip lying in the End that doesn't carry on the audio of a
//      take ending at its line (the ring of a part that was moved, cut or removed) goes, and the take that ends there
//      runs a bar on into it, as far as its recording reaches;
//   3. no gap at a seam: where a copy, a move or a cut left a take starting up to 30 ms after the one before ends (the
//      lead cut off at a section line), it starts where that one ends, reaching back into its own recording, or else
//      the one before runs on to it.
function seamOps(p) {
  const v = readRoom(p);
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const assets = isObj(p.assets) ? p.assets : {};
  const all = sorted(p), end = endOf(all);
  /** @type {any[]} */
  const ops = [];
  const seen = new Set();
  for (const role of TAKE_ROLES) {
    const t = (p.tracks || []).find((x) => x.id === v.roles[role]);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const work = t.clips.filter((c) => c.kind === 'audio').map((c) => ({ c, start: c.start, length: c.length, offset: +c.offset || 0, gone: false }));
    const live = () => work.filter((w) => !w.gone);
    const spansOf = () => {
      const by = new Map();
      for (const w of live()) {
        const k = w.c.take || w.c.id;
        if (!by.has(k)) by.set(k, { start: w.start, end: w.start + w.length, clips: [] });
        const s = by.get(k);
        s.start = Math.min(s.start, w.start); s.end = Math.max(s.end, w.start + w.length); s.clips.push(w);
      }
      return [...by.values()].sort((a, b) => a.start - b.start);
    };
    // (how far a clip's recording reaches, in beats from its start)
    const reach = (w) => {
      const d = assets[w.c.asset]?.duration;
      return Number.isFinite(d) ? (d - w.offset) / beatSecs(p, 1, w.start) : w.length;
    };
    // 1. butt splices
    const ss = spansOf();
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = ss[i], b = ss[i + 1];
      if (!(a.end > b.start + EPS)) continue;
      // (a take inside another, a punch, is the comp's: left alone)
      if (b.start < a.start + MIN_CLIP || b.end < a.end - EPS) continue;
      for (const w of a.clips) {
        if (!(w.start + w.length > b.start + EPS)) continue;
        const len = r4(b.start - w.start);
        if (len >= MIN_CLIP) w.length = len;
      }
    }
    // 2. the End's ring
    if (end) {
      const at = end.start, stop = end.start + end.length;
      const near = lead(p, at) + 1e-3;
      const enders = live().filter((w) => w.start < at - EPS && Math.abs(w.start + w.length - at) <= near);
      const carries = (r) => enders.some((x) => x.c.asset === r.c.asset && Math.abs(x.offset + beatSecs(p, x.length, x.start) - (r.offset - beatSecs(p, r.start - (x.start + x.length), x.start + x.length))) < 2e-3);
      for (const r of live()) {
        if (r.start < at - EPS || r.start + r.length > stop + EPS) continue;
        if (carries(r)) continue;
        r.gone = true;
      }
      for (const x of enders) {
        const cont = live().some((r) => r !== x && r.start >= at - near && r.start <= at + EPS && r.c.asset === x.c.asset);
        if (cont) continue;
        const want = Math.min(at + Math.min(bpb, end.length), x.start + reach(x)) - x.start;
        if (want > x.length + EPS) x.length = r4(want);
      }
    }
    // 3. no gap at a seam
    const s3 = spansOf();
    for (let i = 0; i + 1 < s3.length; i++) {
      const a = s3[i], b = s3[i + 1];
      const gap = b.start - a.end;
      if (!(gap > EPS) || gap > lead(p, b.start) + 1e-3) continue;
      const secs = beatSecs(p, gap, a.end);
      if (b.clips.every((w) => w.offset >= secs - 1e-6 && Math.abs(w.start - b.start) < EPS)) {
        for (const w of b.clips) { w.offset = r4(Math.max(0, w.offset - secs)); w.length = r4(w.length + (w.start - a.end)); w.start = r4(a.end); }
      } else {
        for (const w of a.clips) if (Math.abs(w.start + w.length - a.end) < EPS && reach(w) >= w.length + gap - 1e-3) w.length = r4(b.start - w.start);
      }
    }
    for (const w of work) {
      if (w.gone) { ops.push({ type: 'clip.remove', track: t.id, clip: w.c.id }); continue; }
      const patch = {};
      if (Math.abs(w.start - w.c.start) > EPS) patch.start = w.start;
      if (Math.abs(w.offset - (+w.c.offset || 0)) > 1e-6) patch.offset = w.offset;
      if (Math.abs(w.length - w.c.length) > EPS) patch.length = w.length;
      if (Object.keys(patch).length) ops.push({ type: 'clip.set', track: t.id, clip: w.c.id, patch });
    }
  }
  return ops;
}
// Where the End goes: right after the last part
function endOps(p) {
  const room = roomOf(p);
  if (!room) return [];
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const all = sorted(p);
  const end = endOf(all);
  // (an End left behind by a move or a cut, past the last part's: the one End goes, the others are parts' copies)
  const parts = all.filter((s) => s !== end);
  if (!parts.length) return end ? [{ type: 'room.part.set', section: end.id, remove: true }, { type: 'section.remove', section: end.id }].filter((o) => o.type !== 'room.part.set' || partOf(p, end.id)) : [];
  const at = r4(Math.max(...parts.map((s) => s.start + s.length)));
  const len = endBars(room.place) * bpb;
  if (end) return Math.abs(end.start - at) < EPS && Math.abs(end.length - len) < EPS ? [] : [{ type: 'section.set', section: end.id, patch: { start: at, length: len } }];
  return [{ type: 'section.add', section: { id: minter(p)('s'), name: endName(room.place), start: at, length: len } }];
}
export function planEnd(p) {
  const ops = endOps(p);
  return ops.length ? { ops, label: 'The end follows the last part', reason: 'room:end' } : none();
}
const afterSeams = (extra = null) => (q) => {
  /** @type {any[]} */
  const ops = [...seamOps(q)];
  // (the End after the seams: the seams never move a section)
  ops.push(...endOps(q));
  if (extra) ops.push(...extra(q));
  return ops;
};

/* ------------------------------------------------------------------------------------------------ a take */
export function takeOps(take, { part = null } = {}) {
  const p = take?.song;
  if (!isObj(p) || !Array.isArray(p.sections)) return none();
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const from = r4(Number(take.from) || 0);
  let to = r4(Number(take.to) || from + bpb);
  if (!(to > from + EPS)) return none();
  /** @type {any[]} */
  const ops = [];
  const existing = take.section ? sectionOf(p, take.section) : null;
  // (the song's first part drops the whole bars at its head you didn't play in, §3.6: the take moves left by them, so
  // your 1 is the song's; at least a bar stays)
  const firstPart = !existing && from <= EPS && !sorted(p).some((s, i, a) => !isEndSec(s, i, a));
  const drop = firstPart && Number(take.drop) > 0 ? Math.max(0, Math.min(Math.floor(Number(take.drop) / bpb) * bpb, Math.floor((to - from) / bpb - 1) * bpb)) : 0;
  to = r4(to - drop);
  const id = existing ? existing.id : take.id || minter(p)('s');
  const name = existing ? existing.name : String(take.name || 'Verse');
  if (!existing) {
    ops.push({ type: 'section.add', section: { id, name, start: from, length: r4(to - from) } });
    const patch = isObj(part) && Object.keys(part).length ? part : { reps: 1 };
    ops.push({ type: 'room.part.set', section: id, patch });
  }
  // the take's clips: their seams
  const t = (p.tracks || []).find((x) => x.id === take.track) || null;
  const ids = new Set([...(Array.isArray(take.clips) ? take.clips : []), ...(take.clip ? [take.clip] : [])]);
  const mine = t ? t.clips.filter((c) => ids.has(c.id)) : [];
  // the parts after this one (by start), the End aside: is this the last?
  const all = sorted(p).filter((s, i, a) => !isEndSec(s, i, a) && s.id !== id);
  const later = all.filter((s) => s.start >= to - EPS);
  const last = !later.length;
  const head = from <= EPS ? 0 : r4(from - lead(p, from));
  const tail = last ? to + endBars(roomOf(p)?.place) * bpb : r4(to - lead(p, to));
  const touched = new Set();
  const starts = [];
  for (const c of mine) {
    if (c.kind !== 'audio') continue;
    const patch = {};
    let start = c.start - drop, off = +c.offset || 0;
    if (start < -EPS) { off = r4(off + beatSecs(p, -start, 0)); start = 0; }
    // (a recording that reaches back past the seam is cut there; one that starts later keeps its own start)
    if (start < head - EPS) { off = r4(off + beatSecs(p, head - start, start)); start = head; }
    if (Math.abs(start - c.start) > EPS) patch.start = r4(start);
    if (Math.abs(off - (+c.offset || 0)) > 1e-6) patch.offset = off;
    const end = Math.min(c.start + c.length - drop, tail);
    if (Math.abs(end - start - c.length) > EPS && end - start >= MIN_CLIP) patch.length = r4(end - start);
    if (Object.keys(patch).length) { ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch }); touched.add(c.id); }
    starts.push(start);
  }
  // the take before it on the track ends where this one starts (the take folder it's in, every clip of it)
  if (t && mine.length) {
    const start = Math.min(...(starts.length ? starts : mine.map((c) => c.start)));
    const folder = new Set(mine.map((c) => c.take).filter(Boolean));
    for (const c of t.clips) {
      if (ids.has(c.id) || (c.take && folder.has(c.take)) || c.kind !== 'audio') continue;
      if (c.start < start - EPS && c.start + c.length > start + EPS && c.start + c.length <= to + endBars(roomOf(p)?.place) * bpb + EPS) {
        const len = r4(start - c.start);
        if (len >= MIN_CLIP) ops.push({ type: 'clip.set', track: t.id, clip: c.id, patch: { length: len } });
      }
    }
  }
  // a new part: the ring of the part before it on the other take tracks (the other side's, the lead's) ends on its
  // seam too, so nothing of the last part sounds into the new one
  if (!existing && from > EPS) {
    const side = Object.values(readRoom(p).roles);
    const takeTracks = (p.tracks || []).filter((x) => x.kind === 'audio' && x.id !== take.track && side.includes(x.id));
    for (const x of takeTracks) {
      for (const c of x.clips) {
        if (c.start < head - EPS && c.start + c.length > head + EPS && c.start + c.length <= to + endBars(roomOf(p)?.place) * bpb + EPS) {
          const len = r4(head - c.start);
          if (len >= MIN_CLIP) ops.push({ type: 'clip.set', track: x.id, clip: c.id, patch: { length: len } });
        }
      }
    }
  }
  // the End follows the last part: planned on the song with the part in it
  const q = clone(p);
  if (!existing) q.sections.push({ id, name, start: from, length: r4(to - from) });
  if (!q.room) q.room = { v: 1 };
  ops.push(...endOps(q));
  // the label: which take of the part this is, on its side
  const role = Object.entries(readRoom(p).roles).find(([, tid]) => tid === take.track)?.[0] || '';
  const sec = { start: from, length: to - from };
  // (the takes of this part: the clips that start in it or cover most of it, the ring of the one before aside)
  const ov = (c) => Math.min(c.start + c.length, sec.start + sec.length) - Math.max(c.start, sec.start);
  const n = t ? new Set(t.clips.filter((c) => ov(c) > 0.25 && (c.start >= sec.start - 0.5 || ov(c) > sec.length / 2)).map((c) => c.take || c.id)).size : 1;
  const label = role === 'guitarR' ? `${name}, the other side${n > 1 ? ` (take ${n})` : ''}` : `${name} take ${Math.max(1, n)}`;
  return { ops, label, reason: `room:take:${id}`, section: id };
}

/* ------------------------------------------------------------------------------------------------ ×2, moves, shorter, remove */
export function planTwice(p, { section = null } = {}) {
  const sec = sectionOf(p, section);
  if (!sec) return none();
  const L = sec.length;
  const reps = partOf(p, sec.id)?.reps || 1;
  const ops = twiceOps(p, sec.id, L, !!partOf(p, sec.id), reps);
  return { ops, label: `${sec.name} ×2`, reason: `room:twice:${sec.id}`, after: afterSeams() };
}
// (×2 as ops: the section copied right after itself with everything in it, the copy's card taken back out and the
// section grown over both, so it stays one part with its takes repeated)
function twiceOps(p, id, L, hasPart, reps) {
  const ref = `twice_${String(id).replace(/[^A-Za-z0-9_]/g, '')}`;
  /** @type {any[]} */
  const ops = [{ type: 'section.duplicate', section: id, push: true, ref }];
  if (hasPart) ops.push({ type: 'room.part.set', section: `$${ref}`, remove: true });
  ops.push({ type: 'section.remove', section: `$${ref}` });
  ops.push({ type: 'section.set', section: id, patch: { length: r4(2 * L) } });
  ops.push({ type: 'room.part.set', section: id, patch: { reps: Math.min(4, reps * 2) } });
  return ops;
}

export function planMove(p, { section = null, before = null } = {}) {
  const sec = sectionOf(p, section);
  if (!sec) return none();
  // (the End stays last: a move "to the end" goes before it)
  const all = sorted(p), end = all.find((s, i) => isEndSec(s, i, all)) || null;
  let to = before;
  if (to == null && end && end.id !== sec.id) to = end.id;
  if (to === sec.id) return none();
  const target = to ? sectionOf(p, to) : null;
  const where = target ? (target === end ? 'to the end' : `before the ${low(target.name)}`) : 'to the end';
  return { ops: [{ type: 'section.move', section: sec.id, before: to ?? null }], label: `Moved the ${low(sec.name)} ${where}`, reason: `room:move:${sec.id}`, after: afterSeams(), where };
}

export function planShorter(p, { section = null, bars = 0 } = {}) {
  const sec = sectionOf(p, section);
  const bpb = beatsPerBar(p?.meter || [4, 4]);
  const keep = Math.round(Number(bars) || 0) * bpb;
  if (!sec || !(keep > 0) || keep >= sec.length - EPS) return none();
  return { ops: [{ type: 'time.remove', at: r4(sec.start + keep), length: r4(sec.length - keep) }], label: `${sec.name}: ${keep / bpb} bar${keep / bpb === 1 ? '' : 's'}`, reason: `room:shorter:${sec.id}`, after: afterSeams() };
}

export function planRemove(p, { section = null } = {}) {
  const sec = sectionOf(p, section);
  if (!sec) return none();
  /** @type {any[]} */
  const ops = [];
  // (time.remove takes the section out but leaves its room.parts entry: the part goes first, so ⌘Z brings both)
  if (partOf(p, sec.id)) ops.push({ type: 'room.part.set', section: sec.id, remove: true });
  ops.push({ type: 'time.remove', at: sec.start, length: sec.length });
  return { ops, label: `Removed the ${low(sec.name)}`, reason: `room:remove:${sec.id}`, after: afterSeams() };
}

/* ------------------------------------------------------------------------------------------------ Lay it out */
// The places' forms (§3.10), over the parts played so far: [0] the first part, [1] the second (by start), each where
// the form plays it again a copy of it; { reps: 2 } plays it twice (×2); { first: n } or { last: n } is a copy of n of
// its bars (the intro); { name, bars, feel } a part nobody has played yet, empty, the band's on its own. A pre-chorus
// the musician made goes before each chorus; a played part the form has no place for stays after it.
const FORMS = {
  metal: [{ copy: 0, first: 4, name: 'Intro', oneSide: true, feel: 'build' }, { copy: 0 }, { copy: 1 }, { copy: 0 }, { copy: 1 }, { name: 'Breakdown', bars: 8, feel: 'halftime', drop: true }, { copy: 1, reps: 2 }],
  basement: [{ copy: 0, first: 2, name: 'Intro' }, { copy: 0, reps: 2 }, { copy: 1 }, { copy: 0 }, { copy: 1 }, { name: 'Bridge', bars: 8, feel: 'halftime' }, { copy: 1, reps: 2 }],
  bluesbar: [{ copy: 0, last: 4, name: 'Intro' }, { copy: 0 }, { copy: 1 }, { name: 'Solo', bars: 12, feel: 'shuffle' }, { copy: 0 }],
};
const timeOf = (secs) => { const s = Math.round(secs); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function planLayout(p) {
  const room = roomOf(p);
  const form = room ? FORMS[room.place] : null;
  if (!form) return none();
  const bpb = beatsPerBar(p.meter || [4, 4]);
  const v = readRoom(p);
  const played = v.parts.filter((c) => !c.empty);
  if (played.length < 2) return none();
  const pre = played.find((c, i) => i >= 2 && /^pre-?chorus/i.test(String(c.name)));
  const main = played.filter((c) => c !== pre);
  const A = main[0], B = main[1];
  // the slots in order, each { src (a card) | null, orig, beats, name, part }
  /** @type {any[]} */
  const slots = [];
  const used = new Set();
  const take = (k, extra = {}) => {
    const src = [A, B][k];
    const orig = !used.has(src.id) && !extra.first && !extra.last;
    if (orig) used.add(src.id);
    slots.push({ src, orig, ...extra });
  };
  for (const f of form) {
    if (f.copy == null) { slots.push({ src: null, name: f.name, beats: f.bars * bpb, feel: f.feel, drop: f.drop }); continue; }
    if (f.copy === 1 && pre) { const orig = !used.has(pre.id); if (orig) used.add(pre.id); slots.push({ src: pre, orig }); }
    take(f.copy, { reps: f.reps || 1, first: f.first, last: f.last, name: f.name, oneSide: f.oneSide, feel: f.feel });
  }
  // the played parts the form has no place for: after it, as they are
  const rest = played.filter((c) => !used.has(c.id));
  // the ops, walking the song from its first beat: an original part where the cursor is passes it; anything else goes
  // in there, pushing what's after it right
  /** @type {any[]} */
  const ops = [];
  const mint = minter(p);
  let c = 0, n = 0;
  const names = [], now = new Map();
  let total = 0, empty = null;
  const removeEnd = v.end ? [{ type: 'room.part.set', section: v.end, remove: true }, { type: 'section.remove', section: v.end }].filter((o) => o.type !== 'room.part.set' || partOf(p, v.end)) : [];
  ops.push(...removeEnd);
  // (a pre-chorus played after the chorus goes before it first, so the parts lie in the form's order)
  if (pre && pre.start > B.start) ops.push({ type: 'section.move', section: pre.id, before: B.id });
  // (the parts as they lie now, each moved right by what goes in before it)
  for (const s of slots) {
    if (!s.src) {
      const id = mint('s'), len = s.beats;
      ops.push({ type: 'time.insert', at: r4(c), length: r4(len) });
      ops.push({ type: 'section.add', section: { id, name: s.name, start: r4(c), length: r4(len) } });
      const patch = { ...(s.feel ? { feel: s.feel } : {}), ...(s.drop ? { drop: true } : {}) };
      ops.push({ type: 'room.part.set', section: id, patch: Object.keys(patch).length ? patch : { reps: 1 } });
      names.push(low(s.name)); total += len; c += len; empty ??= s.name;
      continue;
    }
    // (its length now: an original played twice already is twice as long, and a copy of it is one pass)
    const L = now.get(s.src.id) ?? s.src.length, one = s.src.length;
    let id = s.src.id, len = L;
    if (!s.orig) {
      const ref = `lay${++n}`;
      ops.push({ type: 'section.duplicate', section: s.src.id, to: r4(c), push: true, ref });
      id = `$${ref}`;
      const keep = (s.first || s.last) ? Math.min(one, (s.first || s.last) * bpb) : one;
      if (L > one + EPS) s.reps1 = true;
      if (keep < L - EPS) {
        ops.push(s.first ? { type: 'time.remove', at: r4(c + keep), length: r4(L - keep) } : { type: 'time.remove', at: r4(c), length: r4(L - keep) });
        len = keep;
      }
      const patch = {};
      if (s.oneSide) patch.oneSide = true;
      if (s.feel) patch.feel = s.feel;
      if (s.first || s.last || s.reps1) patch.reps = 1;
      if (s.name) ops.push({ type: 'section.set', section: id, patch: { name: s.name } });
      if (Object.keys(patch).length) ops.push({ type: 'room.part.set', section: id, patch });
    }
    if (s.reps > 1) {
      // (×2 on a part whose card is made in this step: its id is the step's ref)
      const ref = `twice${++n}`;
      ops.push({ type: 'section.duplicate', section: id, push: true, ref });
      ops.push({ type: 'room.part.set', section: `$${ref}`, remove: true });
      ops.push({ type: 'section.remove', section: `$${ref}` });
      ops.push({ type: 'section.set', section: id, patch: { length: r4(len * 2) } });
      ops.push({ type: 'room.part.set', section: id, patch: { reps: 2 } });
      len *= 2;
      if (s.orig) now.set(s.src.id, len);
    }
    names.push(`${low(s.name || s.src.name)}${s.reps > 1 ? ' ×2' : ''}`);
    total += len; c += len;
  }
  for (const r of rest) { names.push(low(r.name)); total += r.length; }
  const endLen = endBars(room.place) * bpb;
  names.push('end'); total += endLen;
  const secs = beatSecs(p, total, 0);
  // the band on the empty parts: each one's feel, by the house inside the step; and the intro on the left alone (the
  // copy of the right side the step made in it taken out)
  const extra = (q) => {
    const out = [];
    const w = readRoom(q);
    const right = (q.tracks || []).find((t) => t.id === w.roles.guitarR);
    for (const card of w.parts) {
      if (card.part?.oneSide && right) for (const id of card.takes.R) out.push({ type: 'clip.remove', track: right.id, clip: id });
    }
    for (const card of w.parts) {
      if (!card.empty || !card.part?.feel || card.band.length) continue;
      try { out.push(...(planFeel(q, { section: card.id, feel: card.part.feel, busy: 0, loud: 0 }).ops || [])); } catch { /* the band's: it plays the groove it has */ }
    }
    return out;
  };
  const bars = total / bpb;
  return {
    ops, label: `Laid out: ${bars} bars`, reason: 'room:layout', after: afterSeams(extra),
    form: names.join(', '), bars, secs, time: timeOf(secs), empty,
  };
}
