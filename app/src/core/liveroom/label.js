// @ts-check
// The tape box's label [core; stream F] (docs/research/LIVE-ROOM-MODE.md §3.13, §2.6): what a room song is called on
// the shelf and on its cover, written from the song each time (nothing here is stored). Pure: no DOM, no Math.random.
//
// Frozen (§14.2):
//   labelOf(p) -> { title, slate, parts, note, cover }
//       title: the song's, or the house's for an untitled one ("Untitled · 132 · drop C"); slate: "METAL CLUB · DROP C ·
//       132 · C MINOR"; parts: the parts as words, in order, each name once (["Verse", "Chorus", "Breakdown"]); note:
//       the engineer's line on where you left it, at most three sentences ("Verse and chorus doubled. The breakdown's
//       still empty."); cover: what pixels/index.js drawCover draws (below)
//   titleDice(p) -> [three titles]   names to try for an untitled song, from a word bank seeded by the song (its id and
//       place): the same song always gets the same three
// And, on labelOf's result beside them (fields a reader can skip; the module exports nothing else, §14.2):
//   named     whether the song has a title of its own
//   finished  every part has a take on every side it has (the shelf record's finished)
//   notes     the note's sentences as a list (three at most)
//   where     the note as one clause, for coming back ("verse and chorus doubled; the breakdown's still empty")
//
// The cover (labelOf(p).cover), for drawCover:
//   { title, slate, place, seed, bars, key, tempo }
//   seed: a 32-bit number from the title, the key and the tempo (the palette holds still while you play, and moves when
//   you name it); bars: one number per bar of the song, 0 to 1, how busy that bar is (a spike each: Claw'd-o-Matic's
//   starburst), at most 256; key: "C minor" or ''; tempo: the song's.

import { readRoom } from './session.js';
import { roomOf, sheetOf, NAMES } from './model.js';
import { LINES } from './lines/shelf.js';
import { beatsPerBar } from '../music.js';
import { TUNINGS } from '../fretboard.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const line = (id, vars) => LINES[id].text(vars || {});
const UNTITLED = /^\s*(untitled)?\s*$/i;
const COVER_BARS = 256;
const OVER = 0.25;

/* ------------------------------------------------------------------------------------------------ words */
// a section's name in a sentence: the common ones lowercase ("verse and chorus"), anything you named as you wrote it
const COMMON = /^(intro|verse|pre-chorus|prechorus|chorus|post-chorus|bridge|breakdown|solo|head|outro|end|ending|interlude|riff|middle eight|refrain|tag|coda|turnaround)(\s+\d+)?$/i;
const inSentence = (name) => (COMMON.test(name) ? name.toLowerCase() : name);
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// ["verse", "chorus", "bridge"] -> "verse, chorus and bridge"
function listWords(xs) {
  if (xs.length <= 1) return xs[0] || '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
const NOTE_NAME = (root) => String(root || '').replace(/b$/, '♭').replace(/#$/, '♯');
function keyWords(p) {
  const k = isObj(p?.key) ? p.key : null;
  if (!k || typeof k.root !== 'string' || !k.root) return '';
  return `${NOTE_NAME(k.root)} ${String(k.scale || '').toLowerCase()}`.trim();
}
// a tuning in a sentence: 'drop-c' -> 'drop C'; standard says nothing
function tuningWords(id) {
  if (typeof id !== 'string' || !id || id === 'standard') return '';
  const t = TUNINGS[id];
  if (t) return t.name.toLowerCase().replace(/\b([a-g])\b/g, (m) => m.toUpperCase());
  const [first, ...rest] = id.split('-');
  return [first.toLowerCase(), ...rest.map((w) => (w.length <= 2 ? w.toUpperCase().replace(/B$/, '♭') : w))].join(' ');
}
const placeShort = (place) => {
  const n = NAMES.place[place];
  return n ? n.replace(/^the\s+/i, '').toUpperCase() : '';
};
const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------------------------------------ the parts and their takes */
// Which sides a place records: the metal club and the basement double (L and R), the blues bar and the kitchen don't.
const DOUBLES = new Set(['metal', 'basement']);
const audioClips = (t) => (t && Array.isArray(t.clips) ? t.clips.filter((c) => c && c.kind === 'audio') : []);
const overlaps = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start) > OVER;

// -> [{ id, name, sides: { L, R, one }, wantsR, empty }] in order, and the room's view
function partsOf(p) {
  const view = readRoom(p);
  const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  const byId = (id) => tracks.find((t) => t.id === id) || null;
  const single = ['guitar', 'lead'].map((r) => byId(view.roles[r])).filter(Boolean);
  const doubles = DOUBLES.has(view.place);
  const out = view.cards.map((c) => {
    const L = c.takes.L.length > 0, R = c.takes.R.length > 0;
    const one = single.some((t) => audioClips(t).some((x) => overlaps(x, c)));
    const oneSide = !!c.part?.oneSide;
    const any = L || R || one;
    return { id: c.id, name: c.name, L, R, one, any, wantsR: doubles && L && !R && !oneSide, done: doubles ? (oneSide ? L || R : L && R) : any };
  });
  return { view, parts: out };
}

// the kitchen's takes: the clips on its take, voice and guitar tracks, in start order
function kitchenTakes(p, view) {
  const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  const ids = ['take', 'voice', 'kguitar'].map((r) => view.roles[r]).filter(Boolean);
  const seen = new Map();
  for (const t of tracks) if (ids.includes(t.id)) for (const c of audioClips(t)) if (!seen.has(c.start)) seen.set(c.start, c);
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------------------------------------ the note */
// The note's sentences (three at most): what's in, what wants its other side, what's still empty. Never a nag.
function noteParts(p, { cap = true } = {}) {
  const C = cap ? capFirst : (x) => x;
  const { view, parts } = partsOf(p);
  const room = roomOf(p);
  if (room?.place === 'kitchen') {
    const takes = kitchenTakes(p, view);
    const tempo = Number(p?.tempo) || 120;
    if (takes.length === 1) return [line('note.take', { time: fmtTime((takes[0].length * 60) / tempo) })];
    if (takes.length > 1) {
      const m = takes.findIndex((c) => c.id === room.master);
      return [line('note.takes', { n: takes.length, master: m >= 0 ? m + 1 : 0 })];
    }
    const sh = sheetOf(p);
    const n = sh && Array.isArray(sh.sections) ? sh.sections.length : 0;
    return [n ? line('note.paper', { n }) : line('note.empty')];
  }
  const uniq = (xs) => { const seen = new Set(), out = []; for (const x of xs) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; };
  const done = uniq(parts.filter((x) => x.done).map((x) => inSentence(x.name)));
  const left = uniq(parts.filter((x) => x.wantsR && !x.done).map((x) => inSentence(x.name)));
  const empty = uniq(parts.filter((x) => !x.any).map((x) => inSentence(x.name)));
  if (!done.length && !left.length) return [line('note.empty')];
  const out = [];
  if (done.length) out.push(line(DOUBLES.has(view.place) ? 'note.doubled' : 'note.in', { parts: C(listWords(done)) }));
  if (left.length) out.push(line('note.left', { parts: C(listWords(left)), n: left.length }));
  if (empty.length) out.push(line('note.still', { parts: listWords(empty), n: empty.length }));
  return out.slice(0, 3);
}
// the note as one clause, for coming back's line: "verse and chorus doubled; the breakdown's still empty"
function whereLeft(p) {
  return noteParts(p, { cap: false }).map((x) => x.replace(/\.$/, '').replace(/^(The|Nothing|Take) /, (m) => m.toLowerCase())).join('; ');
}

/* ------------------------------------------------------------------------------------------------ the cover */
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// one number per bar: the notes that start in it (each 1) and the audio that covers it (4 a bar), over every track
// that plays (muted ones left out), scaled so the busiest bar is 1
function barEnergy(p) {
  const bpb = beatsPerBar(p?.meter || [4, 4]);
  let end = 0;
  const tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  for (const t of tracks) for (const c of t.clips || []) end = Math.max(end, (+c.start || 0) + (+c.length || 0));
  for (const s of p?.sections || []) end = Math.max(end, (+s.start || 0) + (+s.length || 0));
  const n = Math.max(0, Math.min(COVER_BARS, Math.ceil(end / bpb - 1e-9)));
  const e = new Array(n).fill(0);
  for (const t of tracks) {
    if (t.mute) continue;
    for (const c of t.clips || []) {
      if (c.mute) continue;
      if (c.kind === 'audio') {
        for (let b = Math.floor(c.start / bpb); b < n && b * bpb < c.start + c.length; b++) e[b] += 4 * Math.max(0, Math.min((b + 1) * bpb, c.start + c.length) - Math.max(b * bpb, c.start)) / bpb;
      } else for (const nt of c.notes || []) {
        if (!(nt.t < c.length)) continue;
        const b = Math.floor((c.start + nt.t) / bpb);
        if (b >= 0 && b < n) e[b] += 1;
      }
    }
  }
  const mx = Math.max(1e-9, ...e);
  return e.map((x) => Math.round((x / mx) * 1000) / 1000);
}

/* ------------------------------------------------------------------------------------------------ the label */
export function labelOf(p) {
  const room = roomOf(p) || {};
  const tempo = Math.round(Number(p?.tempo) || 120);
  const named = typeof p?.title === 'string' && !UNTITLED.test(p.title);
  const tune = room.place && room.place !== 'kitchen' ? tuningWords(room.tuning) : '';
  const sh = sheetOf(p);
  const capo = sh && Number(sh.capo) > 0 ? `CAPO ${sh.capo}` : '';
  const title = named ? p.title : ['Untitled', String(tempo), tune].filter(Boolean).join(' · ');
  const key = keyWords(p);
  const slate = [placeShort(room.place), tune.toUpperCase(), capo, String(tempo), key.toUpperCase()].filter(Boolean).join(' · ');
  const sections = (Array.isArray(p?.sections) ? p.sections : []).slice().sort((a, b) => a.start - b.start);
  const parts = [];
  for (const s of sections) if (s && typeof s.name === 'string' && s.name && !parts.some((x) => x.toLowerCase() === s.name.toLowerCase())) parts.push(s.name);
  const { parts: ps } = partsOf(p);
  const finished = ps.length > 0 && ps.every((x) => x.done);
  const notes = noteParts(p), note = notes.join(' ');
  const cover = { title, slate, place: room.place || null, seed: strHash(`${named ? p.title : ''}|${key}|${tempo}`), bars: barEnergy(p), key, tempo };
  return { title, slate, parts, note, cover, named, finished, notes, where: whereLeft(p) };
}

/* ------------------------------------------------------------------------------------------------ the name dice */
// Two words, the first from the room and the weather, the second from the gear and the road (Claw'd-o-Matic's Write me a
// song dice, in the engineer's register: "Void Weather", "Copper Pipe", "Night Haul"). A place leans on its own words.
const FIRST = ['Void', 'Copper', 'Night', 'Iron', 'Static', 'Low', 'Rust', 'Neon', 'Last', 'Paper', 'Slow', 'Black', 'Salt', 'Dust', 'Cold', 'Hollow',
  'Steel', 'Ash', 'Ghost', 'Lead', 'Glass', 'Velvet', 'Amber', 'Winter', 'Thin', 'Heavy', 'Pale', 'Long', 'Quiet', 'Burnt', 'Second', 'Sodium', 'Tin',
  'Basement', 'Faded', 'Grey', 'Broken', 'Early', 'Late', 'Midnight', 'Concrete', 'Gravel', 'Wire', 'Silver', 'Cinder', 'Tar', 'Bone', 'Crooked'];
const SECOND = ['Weather', 'Pipe', 'Haul', 'Light', 'Engine', 'Hour', 'Tide', 'Line', 'River', 'Room', 'Bell', 'Road', 'Season', 'Fever', 'Garden', 'Machine',
  'Window', 'Shift', 'Ritual', 'Signal', 'Harbour', 'Static', 'Furnace', 'Lantern', 'Current', 'Frost', 'Ladder', 'Mile', 'Orchard', 'Station', 'Kettle',
  'Spark', 'Gauge', 'Trestle', 'Valley', 'Siren', 'Anchor', 'Ember', 'Crown', 'Ferry', 'Mirror', 'Motor', 'Coil', 'Ridge', 'Porch', 'Tower', 'Thread'];
const LEAN = {
  metal: { first: ['Void', 'Iron', 'Black', 'Steel', 'Ash', 'Cinder', 'Bone', 'Heavy', 'Tar'], second: ['Furnace', 'Engine', 'Ritual', 'Machine', 'Coil', 'Siren', 'Gauge'] },
  basement: { first: ['Basement', 'Concrete', 'Static', 'Broken', 'Rust', 'Gravel', 'Burnt'], second: ['Pipe', 'Fever', 'Wire', 'Motor', 'Spark', 'Ladder'] },
  bluesbar: { first: ['Last', 'Midnight', 'Slow', 'Amber', 'Neon', 'Faded', 'Late'], second: ['Hour', 'River', 'Road', 'Bell', 'Ferry', 'Station', 'Mile'] },
  kitchen: { first: ['Paper', 'Early', 'Quiet', 'Winter', 'Thin', 'Pale', 'Velvet'], second: ['Kettle', 'Window', 'Porch', 'Garden', 'Orchard', 'Lantern', 'Thread'] },
};
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function titleDice(p) {
  const place = roomOf(p)?.place || '';
  const R = rng(strHash(`${p?.id || ''}|${place}`));
  const lean = LEAN[place] || { first: [], second: [] };
  const out = [], usedA = new Set(), usedB = new Set();
  for (let guard = 0; out.length < 3 && guard < 64; guard++) {
    const fromA = lean.first.length && R() < 0.5 ? lean.first : FIRST;
    const fromB = lean.second.length && R() < 0.5 ? lean.second : SECOND;
    const a = fromA[Math.floor(R() * fromA.length)], b = fromB[Math.floor(R() * fromB.length)];
    if (a === b || usedA.has(a) || usedB.has(b)) continue;
    usedA.add(a); usedB.add(b);
    out.push(`${a} ${b}`);
  }
  return out;
}
