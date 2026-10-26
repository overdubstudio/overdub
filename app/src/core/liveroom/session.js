// @ts-check
// The session [core; stream C] (docs/research/LIVE-ROOM-MODE.md §7, §9.3, §11.4): the room's view of the song, the
// offered move, where a stop lands, and the reducer the stage's presses run on. Pure: the stage paints from readRoom,
// the press counts (§11.4) run on press.
//
// Frozen (§14.2):
//   readRoom(p) -> the room's view:
//       { place, rig, tuning, finish, mic, master, tempo, meter, key, roles: { role: track id },
//         cards: [{ id, name, start, length, bars, part, takes: { L, R }, band: [{ track, clip, house }] }],
//         managed: { track | 'master': { gain?: [set, now], pan?: [set, now] } }, paper: { section: sheet section } }
//       roles: the room's tracks, a role whose track has gone re-bound by the name its place gives it (places.js
//       setupOf names), else left out. cards: the song's sections in start order (a section made behind the glass is a
//       card too); a card's takes per side are the clips on Guitar L and Guitar R within its bars (a take's clip runs
//       30 ms into the part before it, so its own takes overlap it by more than a quarter beat), the playing one first;
//       its band is the clips on Drums and Bass there, house: still the house's (by 'overdub'). managed: what the
//       house set (room.managed) where the mixer now differs.
//     and, beside those (additions, for the stage and the press counts):
//       bpb (beats a bar), parts (the cards but the End), end (the End's section id, or null), taken (how many parts
//       have a take), laidOut (the song has a form: a part plays twice, or the intro on one side), shape (a short
//       signature of the parts and the takes playing in them: what "heard since it last changed" compares), next (the
//       name the next part gets), and on each card: takes.lead (the blues bar's solos), playing ({ L, R }: the clip
//       playing on each side, or null), empty (no take on any side), end (the End), by (an agent's or a guest's
//       byline: the first clip in its bars that is neither yours nor the house's)
//   offered(view, run) -> { id, label, key, card? } | null   the offered move (§7.4); the kitchen's is kitchen.js
//       offeredKitchen. run: ui.state.liveRoom.run ('idle' | 'count' | 'take' | 'learn' | 'play'), or the session's
//       state { run, last (the part just played), drift ({ card, bar }: a drift line just named a bar), use2 ({ card,
//       take }: two left takes of a part sit within the pair rule, §3.7), said (the once-only marks said for this
//       song: prefs said), heard (the shape when it was last heard top to bottom) }.
//       ids: take (That's a take), stop, punch (Bar 5 again), use2 (Use take 2 as the right side), other (The other
//       side), layout, hear, play (an empty part, by name: R on it), count (Count me in), next (Next part). null:
//       nothing to offer (the door)
//   stopBeat(view, beat, { from }?) -> the beat a stop pressed at `beat` ends on (§3.5): pressed in the first beat of a
//       bar, the line just gone (a late press costs no bar); later in the bar, the next. At the blues bar a part is
//       whole twelve-bar choruses from `from` (the part's 1): in a chorus's first two bars, that chorus's start; later,
//       its end. Never before the part's first bar (or chorus) is whole
//   press(state, id) -> the next state   the reducer the press counts run on: a session in miniature (the door, the
//       input, the tuning, the takes, the double, the form, hearing it, sending it), each press one of the stage's
//       actions by id, 'space' the offered move. state: {} to start; { presses, log, place, view, run, sent, ... }

import { roomOf } from './model.js';
import { setupOf } from './places.js';
import { offeredKitchen } from './kitchen.js';
import { beatsPerBar } from '../music.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const OVER = 0.25;
const EPS = 1e-6;
const HOUSE = 'overdub';
const named = (s) => /^(end|ending)$/i.test(String(s?.name || '').trim());
// The End (§3.10): the last section, named End (Ending at the blues bar), with nothing starting after it
const endOf = (all) => { const e = all.filter(named).at(-1); return e && all.length > 1 && !all.some((s) => !named(s) && s.start > e.start + EPS) ? e : null; };

// The parts a place names, in the order the next part takes them (§3.8): after these, a part is named by the one it
// most resembles by job, numbered.
const PART_NAMES = {
  metal: ['Verse', 'Chorus', 'Bridge', 'Breakdown'],
  basement: ['Verse', 'Chorus', 'Bridge', 'Pre-chorus'],
  bluesbar: ['Head', 'Solo'],
  kitchen: ['Verse', 'Chorus', 'Bridge'],
};
// (the stem of a part's name: "Verse 2" is a verse; "Chorus ×2" too)
const stem = (n) => String(n || '').toLowerCase().replace(/\s*(×\s*\d+|\d+)\s*$/u, '').trim();
function nextPartName(place, parts) {
  const names = PART_NAMES[place] || PART_NAMES.metal;
  const have = new Set(parts.map((c) => stem(c.name)));
  const fresh = names.find((n) => !have.has(n.toLowerCase()));
  if (fresh) return fresh;
  // the one its job most resembles: the place's names in turn, numbered past those there are
  const n = parts.length, base = names[n % names.length];
  const used = new Set(parts.map((c) => String(c.name).toLowerCase()));
  for (let k = 2; k < 100; k++) if (!used.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
  return base;
}

// the sides a place records on: the role each side's takes are on
const sidesOf = (place) => (place === 'bluesbar' ? { L: 'guitar', R: null, lead: 'lead' } : place === 'kitchen' ? { L: 'take', R: null, lead: null } : { L: 'guitarL', R: 'guitarR', lead: null });

// What the cards say on top of a song's own (readRoom) or the press counts' miniature one (press): the parts, the End,
// whether the song has a form, its shape, the next part's name.
function derive(view) {
  const cards = view.cards || [];
  const parts = cards.filter((c) => !c.end);
  const taken = parts.filter((c) => !c.empty).length;
  const stems = parts.map((c) => stem(c.name));
  const laidOut = stems.some((s, i) => s && stems.indexOf(s) !== i) || parts.some((c) => c.part?.oneSide === true);
  const shape = parts.map((c) => `${c.id}:${c.start}:${c.length}:${c.playing?.L || ''}:${c.playing?.R || ''}:${(c.takes?.lead || [])[0] || ''}`).join('|');
  const end = cards.find((c) => c.end)?.id || null;
  return { ...view, parts, taken, laidOut, shape, end, next: nextPartName(view.place, parts) };
}

export function readRoom(p) {
  const room = roomOf(p) || {};
  const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  const byId = (id) => tracks.find((t) => t.id === id) || null;
  const names = room.place && room.place !== 'kitchen' ? setupOf(room.place).names || {} : {};
  const roles = {};
  for (const [role, id] of Object.entries(isObj(room.tracks) ? room.tracks : {})) {
    const t = byId(id) || (names[role] ? tracks.find((x) => x.name === names[role]) : null);
    if (t) roles[role] = t.id;
  }
  const bpb = beatsPerBar(p?.meter || [4, 4]);
  const parts = isObj(room.parts) ? room.parts : {};
  const overlap = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start);
  const within = (c, s) => overlap(c, s) > OVER;
  // (a take of a part starts in it, its 30 ms lead aside, or covers most of it: the ring of the part before, a bar or
  // two into it, isn't one, nor the piece of it the recorder's take folder keeps muted under a new take, a muted clip
  // shorter than half the part)
  const takeIn = (c, s) => within(c, s) && (c.start >= s.start - 0.5 || overlap(c, s) > s.length / 2) && !(c.mute && c.length < s.length / 2);
  const clipsIn = (role, s) => {
    const t = role ? byId(roles[role]) : null;
    if (!t) return [];
    return t.clips.filter((c) => takeIn(c, s)).sort((a, b) => Number(!!a.mute) - Number(!!b.mute)).map((c) => c.id);
  };
  const playingIn = (role, s) => {
    const t = role ? byId(roles[role]) : null;
    return t?.clips.find((c) => takeIn(c, s) && !c.mute)?.id || null;
  };
  // (a section made behind the glass is a card too; a room.parts entry whose section went is skipped: time.remove and
  // section.remove leave them, and cleanRoom prunes them only on load)
  const sections = (Array.isArray(p?.sections) ? p.sections : []).slice().sort((a, b) => a.start - b.start || Number(named(a)) - Number(named(b)));
  const side = sidesOf(room.place);
  const theEnd = endOf(sections);
  const cards = sections.map((s) => {
    const end = s === theEnd;
    const band = [];
    for (const role of ['drums', 'bass']) {
      const t = byId(roles[role]);
      if (t) for (const c of t.clips) if (within(c, s)) band.push({ track: t.id, clip: c.id, house: c.by === HOUSE });
    }
    // (the End is the band's: the ring of the last part's take runs into it, and that isn't a take of the End)
    const takes = end ? { L: [], R: [], lead: [] } : { L: clipsIn(side.L, s), R: clipsIn(side.R, s), lead: clipsIn(side.lead, s) };
    const playing = end ? { L: null, R: null } : { L: playingIn(side.L, s) || playingIn(side.lead, s), R: playingIn(side.R, s) };
    let by = null;
    for (const role of [side.L, side.R, side.lead, 'drums', 'bass']) {
      const t = role ? byId(roles[role]) : null;
      const c = t?.clips.find((x) => within(x, s) && x.by && x.by !== 'you' && x.by !== HOUSE);
      if (c) { by = c.by; break; }
    }
    return {
      id: s.id, name: s.name, start: s.start, length: s.length, bars: s.length / bpb, part: isObj(parts[s.id]) ? parts[s.id] : {},
      takes, band, playing, empty: !takes.L.length && !takes.R.length && !takes.lead.length, end, by,
    };
  });
  const managed = {};
  for (const [id, m] of Object.entries(isObj(room.managed) ? room.managed : {})) {
    const now = id === 'master' ? { gain: p?.master?.gain } : byId(id);
    if (!now || !isObj(m)) continue;
    const d = {};
    if (typeof m.gain === 'number' && typeof now.gain === 'number' && Math.abs(m.gain - now.gain) > 1e-6) d.gain = [m.gain, now.gain];
    if (id !== 'master' && typeof m.pan === 'number' && typeof now.pan === 'number' && Math.abs(m.pan - now.pan) > 1e-6) d.pan = [m.pan, now.pan];
    if (Object.keys(d).length) managed[id] = d;
  }
  const paper = {};
  for (const s of sections) if (parts[s.id]?.sheet) paper[s.id] = parts[s.id].sheet;
  return derive({
    place: room.place ?? null, rig: room.rig ?? null, tuning: room.tuning ?? null, finish: room.finish ?? null, mic: room.mic ?? null, master: room.master ?? null,
    tempo: p?.tempo ?? null, meter: p?.meter ?? [4, 4], key: p?.key ?? null, roles, cards, managed, paper, bpb,
  });
}

/* ------------------------------------------------------------------------------------------------ the offered move */
const saidOf = (r) => (r.said instanceof Set ? r.said : new Set(Array.isArray(r.said) ? r.said : []));
const runOf = (run) => (typeof run === 'string' ? { run } : isObj(run) ? run : {});
const low = (s) => String(s || '').toLowerCase();

export function offered(view, run) {
  if (!view || !view.place) return null;
  const r = runOf(run);
  // (the kitchen's own: its screen passes its run; from a bare run, the takes and the tape read from the view)
  if (view.place === 'kitchen') {
    const takes = (view.cards || []).reduce((n, c) => n + (c.takes?.L?.length || 0), 0);
    return offeredKitchen(view, { takes, rolling: r.run === 'take' || r.run === 'count', playing: r.run === 'play', ...r });
  }
  const parts = view.parts || (view.cards || []).filter((c) => !c.end);
  const said = saidOf(r);
  const state = r.run || 'idle';
  // 1. a count, a take or a playback running
  if (state === 'count' || state === 'take') return { id: 'take', label: 'That’s a take', key: 'Space' };
  if (state === 'play') return { id: 'stop', label: 'Stop', key: 'Space' };
  // 2. a drift line just named a bar
  const drift = isObj(r.drift) ? r.drift : null;
  if (drift && parts.some((c) => c.id === drift.card) && Number.isFinite(drift.bar)) return { id: 'punch', label: `Bar ${drift.bar} again`, key: 'Space', card: drift.card };
  // 2b. two left takes of a part sit within the pair rule: one of them as the right side (§3.7)
  const use2 = isObj(r.use2) ? r.use2 : null;
  if (use2 && Number.isFinite(use2.take) && parts.some((c) => c.id === use2.card && !c.takes?.R?.length)) return { id: 'use2', label: `Use take ${use2.take} as the right side`, key: 'Space', card: use2.card };
  const taken = parts.filter((c) => !c.empty);
  const last = parts.find((c) => c.id === r.last) || null;
  // 3. the other side: at the metal club, the part just played has a left take and no right one; at the basement,
  // once, after its second part
  if (last && last.takes?.L?.length && !last.takes?.R?.length && !last.part?.oneSide) {
    if (view.place === 'metal') return { id: 'other', label: 'The other side', key: 'Space', card: last.id };
    if (view.place === 'basement' && taken.length >= 2 && taken[1]?.id === last.id && !said.has('basement.other')) return { id: 'other', label: 'The other side', key: 'Space', card: last.id };
  }
  // 4. two parts in, and Lay it out not offered in this song
  if (taken.length >= 2 && !view.laidOut && !said.has('layout.offer')) return { id: 'layout', label: 'Lay it out', key: 'Space' };
  // 5. laid out and not heard top to bottom since it last changed
  if (view.laidOut && r.heard !== view.shape) return { id: 'hear', label: 'Hear it all', key: 'Space' };
  // 6. an empty part, by its name
  const empty = parts.find((c) => c.empty);
  if (empty && taken.length) return { id: 'play', label: `Play the ${low(empty.name)}`, key: 'Space', card: empty.id };
  // 7. before the first take
  if (!taken.length) return empty ? { id: 'play', label: `Play the ${low(empty.name)}`, key: 'Space', card: empty.id } : { id: 'count', label: 'Count me in', key: 'Space' };
  // 8. otherwise
  return view.laidOut ? { id: 'hear', label: 'Hear it all', key: 'Space' } : { id: 'next', label: 'Next part', key: 'Space' };
}

/* ------------------------------------------------------------------------------------------------ the stop */
export function stopBeat(view, beat, { from = null } = {}) {
  const bpb = beatsPerBar(view?.meter || [4, 4]);
  const at = Number(beat) || 0;
  if (view?.place === 'bluesbar' && Number.isFinite(from)) {
    const L = 12 * bpb, rel = at - from;
    const k = Math.max(0, Math.floor(rel / L + EPS)), into = rel - k * L;
    const end = from + (into < 2 * bpb - EPS ? k : k + 1) * L;
    return Math.max(end, from + L);
  }
  const bar = Math.floor(at / bpb + EPS), into = at - bar * bpb;
  const end = (into < 1 - EPS ? bar : bar + 1) * bpb;
  return Number.isFinite(from) ? Math.max(end, from + bpb) : end;
}

/* ------------------------------------------------------------------------------------------------ the press counts */
// A session in miniature, on the same offered(): each press is what a button or a key does, 'space' the offered move.
// The song is cards with takes per side; a take is 8 bars (a chorus of 12 at the blues bar), the other side ends by
// itself, Lay it out writes the place's form with its empty parts, and hearing it all marks the shape heard.
const START = { metal: 132, basement: 172, bluesbar: 96, kitchen: 84 };
const FORM = {
  metal: [['Intro', 0, 4, true], [0], [1], [0], [1], ['Breakdown', null, 8], [1, 2]],
  basement: [['Intro', 0, 2], [0, 2], [1], [0], [1], ['Bridge', null, 8], [1, 2]],
  bluesbar: [['Intro', 0, 4], [0], [1], ['Solo', null, 12], [0]],
};
let seq = 0;
const card = (name, bars, bpb, extra = {}) => ({ id: `c${++seq}`, name, start: 0, length: bars * bpb, bars, part: {}, takes: { L: [], R: [], lead: [] }, playing: { L: null, R: null }, band: [], empty: true, end: false, by: null, ...extra });
function relay(cards, bpb) {
  let t = 0;
  for (const c of cards) { c.start = t; c.length = c.bars * bpb; t += c.length; }
  return cards;
}
const viewOf = (s) => derive({ ...s.view, cards: relay(s.view.cards.map((c) => ({ ...c })), s.view.bpb || 4) });

export function press(state, id) {
  const s = isObj(state) ? JSON.parse(JSON.stringify({ ...state, run: { ...(state.run || {}), said: [...saidOf(state.run || {})] } })) : {};
  s.presses = (s.presses || 0) + 1;
  s.log = [...(s.log || []), id];
  s.last = id;
  s.run = { run: 'idle', said: [], ...(s.run || {}) };
  s.view = s.view || { place: null, cards: [], bpb: 4, meter: [4, 4], tempo: null };
  const mark = (x) => { if (!s.run.said.includes(x)) s.run.said.push(x); };
  const bpb = s.view.bpb || 4;
  const bars = s.view.place === 'bluesbar' ? 12 : 8;
  const sideOf = (c) => (s.view.place === 'bluesbar' && stem(c.name) === 'solo' ? 'lead' : 'L');
  const find = (cid) => s.view.cards.find((c) => c.id === cid) || null;
  let act = id, arg = null;
  if (typeof id === 'string' && id.startsWith('door:')) { act = 'door'; arg = id.slice(5); }
  if (act === 'space') {
    const o = offered(viewOf(s), s.run);
    s.offered = [...(s.offered || []), o ? o.id : null];
    if (!o) return s;
    act = o.id; arg = o.card || null;
  }
  const begin = (c) => { s.run.run = 'take'; s.run.card = c.id; };
  const land = () => {
    const c = find(s.run.card);
    s.run.run = 'idle';
    if (!c) return;
    const k = sideOf(c), n = c.takes[k].length + 1;
    c.takes[k] = [...c.takes[k], `${c.id}${k}${n}`];
    if (k === 'L' || k === 'lead') c.playing = { ...c.playing, L: c.takes[k][c.takes[k].length - 1] };
    if (!c.bars) c.bars = bars;
    c.empty = false;
    s.run.last = c.id;
    s.run.card = null;
  };
  switch (act) {
    case 'door':
      s.screen = 'stage';
      s.place = arg;
      s.view = { place: arg, cards: [], bpb, meter: [4, 4], tempo: START[arg] ?? 120 };
      break;
    case 'allow': s.input = true; break;
    case 'tune': s.tuned = true; break;
    case 'count': case 'next': {
      if (!s.input) { s.refused = act; break; }
      const v = viewOf(s);
      const c = card(v.next, 0, bpb);
      // (a new part goes after the last one, before the End)
      const at = s.view.cards.findIndex((x) => x.end);
      if (at < 0) s.view.cards.push(c); else s.view.cards.splice(at, 0, c);
      begin(c);
      break;
    }
    case 'play': case 'again': { const c = find(arg || s.run.card || s.run.last); if (c) begin(c); break; }
    case 'take': land(); if (!s.view.cards.some((c) => c.end)) s.view.cards.push(card('End', 1, bpb, { end: true, empty: true })); break;
    case 'stop': s.run.run = 'idle'; break;
    case 'other': {
      const c = find(arg || s.run.last);
      if (c) { c.takes.R = [...c.takes.R, `${c.id}R${c.takes.R.length + 1}`]; c.playing = { ...c.playing, R: c.takes.R[c.takes.R.length - 1] }; }
      if (s.view.place === 'basement') mark('basement.other');
      break;
    }
    case 'punch': s.run.drift = null; break;
    case 'notyet': mark('layout.offer'); break;
    case 'layout': {
      mark('layout.offer');
      const played = s.view.cards.filter((c) => !c.end && !c.empty);
      const form = FORM[s.view.place] || FORM.metal;
      const used = new Set();
      const out = [];
      for (const [a, b, n, one] of form) {
        if (typeof a === 'number') {
          const src = played[a];
          if (!src) continue;
          const reps = b || 1;
          if (!used.has(src.id)) { used.add(src.id); src.bars *= reps; src.part = { ...src.part, reps }; out.push(src); } else out.push({ ...src, id: `c${++seq}`, bars: src.bars / (src.part.reps || 1) * reps, part: { ...src.part, reps } });
        } else if (b === 0) out.push({ ...played[0], id: `c${++seq}`, name: a, bars: Math.min(n, played[0].bars), part: { oneSide: !!one } });
        else out.push(card(a, n, bpb));
      }
      for (const c of played) if (!used.has(c.id)) out.push(c);
      out.push(card('End', s.view.place === 'bluesbar' ? 2 : 1, bpb, { end: true }));
      s.view.cards = out;
      break;
    }
    case 'hear': s.run.heard = viewOf(s).shape; s.heard = true; break;
    case 'send': if (s.heard) s.sent = true; break;
    default: break;
  }
  return s;
}
