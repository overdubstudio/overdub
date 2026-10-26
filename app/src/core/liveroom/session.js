// @ts-check
// The session [core; the foundation's read, stream C fills in the rest] (docs/research/LIVE-ROOM-MODE.md §7, §9.3):
// the room's view of the song, and the reducer the stage's presses run on. Pure: the stage paints from readRoom, the
// press counts (§11.4) run on press.
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
//   offered(view, run) -> { id, label, key } | null   the offered move (§7.4); the kitchen's is kitchen.js
//       offeredKitchen. null: nothing to offer
//   stopBeat(view, beat) -> the beat a stop pressed at `beat` ends on (§3.5: the bar line)
//   press(state, id) -> the next state   the reducer the press counts run on
//
// Until stream C lands, nothing is offered and a press only counts.

import { roomOf } from './model.js';
import { setupOf } from './places.js';
import { beatsPerBar } from '../music.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const OVER = 0.25;

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
  const within = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start) > OVER;
  const clipsIn = (role, s) => {
    const t = byId(roles[role]);
    if (!t) return [];
    return t.clips.filter((c) => within(c, s)).sort((a, b) => Number(!!a.mute) - Number(!!b.mute)).map((c) => c.id);
  };
  const sections = (Array.isArray(p?.sections) ? p.sections : []).slice().sort((a, b) => a.start - b.start);
  const cards = sections.map((s) => {
    const band = [];
    for (const role of ['drums', 'bass']) {
      const t = byId(roles[role]);
      if (t) for (const c of t.clips) if (within(c, s)) band.push({ track: t.id, clip: c.id, house: c.by === 'overdub' });
    }
    return { id: s.id, name: s.name, start: s.start, length: s.length, bars: s.length / bpb, part: isObj(parts[s.id]) ? parts[s.id] : {}, takes: { L: clipsIn('guitarL', s), R: clipsIn('guitarR', s) }, band };
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
  return {
    place: room.place ?? null, rig: room.rig ?? null, tuning: room.tuning ?? null, finish: room.finish ?? null, mic: room.mic ?? null, master: room.master ?? null,
    tempo: p?.tempo ?? null, meter: p?.meter ?? [4, 4], key: p?.key ?? null, roles, cards, managed, paper,
  };
}

export function offered(view, run) {
  return null;
}

export function stopBeat(view, beat) {
  const bpb = beatsPerBar(view?.meter || [4, 4]);
  return Math.ceil(beat / bpb - 1e-9) * bpb;
}

export function press(state, id) {
  const s = isObj(state) ? state : {};
  return { ...s, presses: (s.presses || 0) + 1, last: id };
}
