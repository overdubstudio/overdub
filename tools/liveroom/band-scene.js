// The live room's band scenes [tools; stream B] (docs/research/LIVE-ROOM-MODE.md §4.6, §11.2): a place's song as the
// room makes it, from a reference DI, for the level checks (checks-band.js), the golden scene room:metal
// (tools/golden-scenes.js) and the bench (tools/liveroom-bench.js). Built the same way every time: fixed ids (ids seed
// the devices), the reference DIs rendered by the canonical renderer, the band learned from the left take's read
// (band.js planLearn, the real path), the finish put on by planFinish.
//
//   REFS: { metal, basement, bluesbar }   each place's reference: { tempo, tuning, parts: [{ name, bars, song() (a DI
//       Box song) }] }. metal: a verse of tools/fixtures/metal-di/chug.json and a chorus of chords.json (drop C, 132);
//       basement: a verse of power-chord eighths in E at 172; the blues bar: a head of boogie in E through the
//       twelve-bar at 96 (both DI Box, built here as the fixtures are)
//   perform(place, seed, { peak, part }) -> Float32Array   a part's reference played once: its notes moved by up to
//       ±8 ms and their velocities by ±0.03, seeded (two seeds are two performances, never a copy; 0 is as written),
//       rendered, peaks at `peak` dBFS (-12: as an interface brings a guitar in)
//   roomSong(place, { finish, rig, sides, feel, busy, loud, peak, tuning, parts }) -> { p, assets, ids, reads, learns, beats,
//       parts, finish }   the song: the place's tracks (setupOf), its parts one after another, each part's left take
//       (seed 1) and, with sides 2 (the metal club and the basement), its right (seed 2) hard right with the left hard
//       left; the band learned from each left take's read; feel, busy and loud as planFeel takes them, on every part;
//       the finish on the master
//   clean(p) -> a copy with the master's inserts out (the balance before the finish)
//   stem(p, assets, trackIds, opts) -> measure() of those tracks alone (renderSong's tracks)
import fs from 'node:fs';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { measure } from '../../app/src/audio/measure.js';
import { setupOf, placeOf } from '../../app/src/core/liveroom/places.js';
import { readTake } from '../../app/src/core/liveroom/read.js';
import { planLearn, planFeel, planFinish, bandNotes } from '../../app/src/core/liveroom/band.js';
import { riffOf as readRiff } from '../../app/src/core/liveroom/read.js';
import { rng, riffDI } from './fake.js';

const SR = 48000;
const STAMP = '2026-10-25T00:00:00.000Z';
const GUITAR = { body: 0, pick: 0.15, pickup: 0, tone: 0.7, decay: 1.2, strum: 6, mute: 1 };
const wob = (i) => (((Math.imul(i + 1, 2654435761) >>> 0) % 61) - 30) / 1000;
function diSong(title, tempo, beats, notes) {
  return {
    ...createProject(), id: 'p_room_' + title, title: 'room DI: ' + title, tempo, key: null,
    meta: { created: STAMP, modified: STAMP, authors: {} }, loop: { on: false, start: 0, end: beats },
    tracks: [{ id: 't_di', name: 'DI', kind: 'instrument', instrument: { device: 'core.guitar', params: { ...GUITAR } }, inserts: [], gain: 0, pan: 0, mute: false, solo: false, arm: false, by: 'overdub',
      clips: [{ id: 'c_di', kind: 'notes', start: 0, length: beats, by: 'overdub', notes: notes.map((n, i) => ({ id: 'n' + (i + 1), p: n.p, t: +n.t.toFixed(4), d: +n.d.toFixed(4), v: +Math.max(0.05, Math.min(1, n.v + wob(i))).toFixed(3), by: 'overdub' })) }] }],
  };
}
// the basement's: E5, A5 and G5 power chords (root, fifth, octave) in eighths, a bar each of E E A G, picked open
function punk() {
  const out = [], roots = [40, 40, 45, 43];
  for (let bar = 0; bar < 8; bar++) for (let e = 0; e < 8; e++) {
    const r = roots[(bar * 2 + (e >> 2)) % 4];
    for (const p of [r, r + 7, r + 12]) out.push({ p, t: bar * 4 + e * 0.5, d: 0.45, v: e % 2 ? 0.74 : 0.84 });
  }
  return diSong('punk', 172, 32, out);
}
// the blues bar's: the boogie (R 5 6 b7 6 5) on the shuffle's long-short eighths through the twelve-bar in E
function boogie() {
  const out = [], form = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7], ivs = [0, 7, 9, 10, 9, 7, 9, 7], at = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
  for (let bar = 0; bar < 12; bar++) {
    const r = 40 + form[bar];
    at.forEach((x, j) => { out.push({ p: r, t: bar * 4 + x, d: j % 2 ? 0.3 : 0.62, v: j % 2 ? 0.7 : 0.82 }); out.push({ p: r + ivs[j], t: bar * 4 + x, d: j % 2 ? 0.3 : 0.62, v: j % 2 ? 0.66 : 0.78 }); });
  }
  return diSong('boogie', 96, 48, out);
}
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/metal-di/${name}.json`, import.meta.url), 'utf8'));
export const REFS = {
  metal: { tempo: 132, tuning: 'drop-c', parts: [{ name: 'Verse', bars: 8, song: () => fixture('chug') }, { name: 'Chorus', bars: 8, song: () => fixture('chords') }] },
  basement: { tempo: 172, tuning: 'standard', parts: [{ name: 'Verse', bars: 8, song: punk }] },
  bluesbar: { tempo: 96, tuning: 'standard', parts: [{ name: 'Head', bars: 12, song: boogie }] },
};

const DI = new Map();
export function perform(place, seed = 1, { peak = -12, part = 0 } = {}) {
  const key = `${place}:${part}:${seed}:${peak}`;
  if (DI.has(key)) return DI.get(key);
  const s = REFS[place].parts[part].song(), r = rng(seed * 7919 + 13 + part * 101), spb = 60 / s.tempo;
  // (seed 0 is the reference as written)
  if (seed) for (const n of s.tracks[0].clips[0].notes) {
    if (n.t > 0) n.t = +Math.max(0, n.t + ((r() * 2 - 1) * 0.008) / spb).toFixed(5);
    n.v = +Math.max(0.05, Math.min(1, n.v + (r() * 2 - 1) * 0.03)).toFixed(3);
  }
  const x = renderSong(s, { tail: 0.5 }).channels[0];
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  const g = 10 ** (peak / 20) / (pk || 1), y = Float32Array.from(x, (v) => v * g);
  DI.set(key, y);
  return y;
}

export function clean(p) {
  const q = JSON.parse(JSON.stringify(p));
  q.master.inserts = [];
  q.master.clip = 'clean';
  return q;
}
export function stem(p, assets, tracks, { from = 0, to = null, tail = 0.5 } = {}) {
  const end = to ?? Math.max(...p.sections.map((s) => s.start + s.length));
  return measure(renderSong(p, { from, to: end, tracks, tail, assets }));
}

// ids every scene gives the same way: the role tracks by role, the takes by side, the inserts in order
function canonInserts(p) {
  const map = new Map();
  const walk = (list, tid) => list.forEach((x, k) => { const id = `i_${tid.replace(/^t_/, '')}_${k}`; if (x.id !== id) map.set(x.id, id); });
  for (const t of p.tracks) walk(t.inserts, t.id);
  walk(p.master.inserts || [], 't_master');
  let s = JSON.stringify(p);
  for (const [a, b] of map) s = s.split(`"${a}"`).join(`"${b}"`);
  return JSON.parse(s);
}

export function roomSong(place, { finish = null, rig = null, sides = null, feel = null, busy = 0, loud = 0, peak = -12, tuning = null, parts: count = null } = {}) {
  const ref = REFS[place], P = placeOf(place), S = setupOf(place, { tuning: tuning || ref.tuning, rig });
  const two = sides ? sides === 2 : place !== 'bluesbar', spb = 60 / ref.tempo;
  const st = createStore({ ...createProject({ tempo: ref.tempo }), id: `p_room_${place}`, title: `The room: ${P.name.toLowerCase()}`, meta: { created: STAMP, modified: STAMP, authors: {} } }, { getDevice });
  const ops = [], map = {}, assets = {};
  for (const t of S.tracks) {
    if (t.role === 'lead' || (t.role === 'guitarR' && !two)) continue;
    const { role, later, ...track } = t;
    const id = `t_${role}`;
    ops.push({ type: 'track.add', track: { ...track, id, ...(role === 'guitarL' && two ? { pan: -1 } : {}) } });
    map[role] = id;
  }
  const L = map.guitarL || map.guitar;
  let at = 0;
  const parts = ref.parts.slice(0, count || ref.parts.length).map((part, k) => {
    const beats = part.bars * 4, sid = `s_${part.name.toLowerCase()}`;
    ops.push({ type: 'section.add', section: { id: sid, name: part.name, start: at, length: beats } });
    for (const [side, track, seed] of [['left', L, 1], ...(two ? [['right', map.guitarR, 2]] : [])]) {
      const x = perform(place, seed, { peak, part: k }), aid = `a_${side}${k}`;
      assets[aid] = { sr: SR, channels: [x] };
      ops.push({ type: 'asset.add', asset: { id: aid, kind: 'audio', name: `${part.name}, ${side}`, sr: SR, channels: 1, duration: x.length / SR } });
      // (the take's clip ends at the part's end: its ring is the next part's)
      ops.push({ type: 'clip.add', track, clip: { id: `c_${side}${k}`, kind: 'audio', asset: aid, start: at, length: Math.min(beats, x.length / SR / spb), offset: 0, by: 'you' } });
    }
    const out = { id: sid, start: at, beats, k };
    at += beats;
    return out;
  });
  ops.push({ type: 'room.set', patch: { place, rig: S.rig, tuning: S.tuning, tracks: map } });
  let r = st.dispatch(ops, { by: 'overdub' });
  if (!r.ok) throw new Error(`the ${place} scene: ${r.error}`);
  const reads = [], learns = [];
  for (const part of parts) {
    const read = readTake(perform(place, 1, { peak, part: part.k }), SR, { tempo: ref.tempo, start: 0, bars: part.beats / 4, grid: P.grid, place });
    const learned = planLearn(st.get(), { section: part.id, read });
    r = st.dispatch(learned.ops, { by: 'overdub' });
    if (!r.ok) throw new Error(`the ${place} band: ${r.error}`);
    if (feel || busy || loud) {
      const f = planFeel(st.get(), { section: part.id, feel, busy, loud });
      r = st.dispatch(f.ops, { by: 'you' });
      if (!r.ok) throw new Error(`the ${place} feel: ${r.error}`);
    }
    reads.push(read);
    learns.push(learned);
  }
  const fin = planFinish(st.get(), { finish });
  r = st.dispatch(fin.ops, { by: 'you' });
  if (!r.ok) throw new Error(`the ${place} finish: ${r.error}`);
  const p = canonInserts(st.get());
  return { p, assets, ids: map, reads, learns, beats: at, parts, finish: fin.finish };
}

export function DEVICES(place) {
  const S = setupOf(place, { tuning: REFS[place].tuning });
  return [...new Set(['core.guitar', ...S.tracks.flatMap((t) => [t.instrument?.device, ...(t.inserts || []).map((x) => x.device)]), ...S.master.map((x) => x.device), 'core.drumbus'].filter(Boolean))];
}

/* ------------------------------------------------------------------ the read's fixtures (§11.3) */
const CHUG = ['mmmm m3mm mmm5 m6mm', 'mmmm mm3. mmmm 0...', 'mmmm m3mm mmm5 m6mm', 'm.mm m.mm m.mm 3.5.', 'mmmm m3mm mmm5 m6mm', 'mmmm mm3. mmmm 0...', 'mmmm m3mm mmm5 m6mm', 'm.mm m.mm 6.5. 3...'];
export function fixtureRiff(kind, low) {
  const notes = [];
  if (kind === 'chug') CHUG.forEach((b, bar) => { const st = b.replace(/ /g, ''); for (let s = 0; s < 16; s++) { const c = st[s], t = bar * 4 + s / 4; if (c === 'm') notes.push([t, low, 0]); else if (c !== '.') { let len = 1; while (s + len < 16 && st[s + len] === '.') len++; notes.push([t, low + +c, len / 4 - 0.02], [t, low + +c + 7, len / 4 - 0.02]); } } });
  if (kind === 'chords') [0, 8, 10, 5, 0, 3, 5, 6].forEach((r, bar) => notes.push([bar * 4, low + r, 3.9], [bar * 4, low + r + 7, 3.9], [bar * 4, low + r + 12, 3.9]));
  if (kind === 'tremolo') { const line = [0, 0, 1, 0, 3, 0, 1, 0, 5, 3, 1, 0, 6, 5, 3, 1]; for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) notes.push([bar * 4 + s / 4, low + line[(bar * 4 + (s >> 2)) % 16], 0.24]); }
  return { bpm: 120, beats: 32, chord: false, notes };
}
export function bareSong(place, tempo, { name = 'Verse', length = 32, next = null } = {}) {
  return {
    tempo, meter: [4, 4], key: null, tracks: [], room: { v: 1, place },
    sections: [{ id: 's_a', name, start: 0, length }, ...(next ? [{ id: 's_b', name: next, start: length, length: 32 }] : [])],
  };
}
// played: [{ s (seconds into the read's samples), g (its grid point, beats), p, d (beats), mute }]
export function scoreRead(read, played, { bpm, start = 0, beats = 32 } = {}) {
  const spb = 60 / bpm, lowP = Math.min(...played.map((n) => n.p)), truth = new Map();
  for (const n of played) if (n.mute || n.p <= lowP + 5) if (!truth.has(n.g) || truth.get(n.g).s > n.s) truth.set(n.g, n);
  const band = bandNotes(bareSong('metal', bpm, { length: beats }), 's_a', { feel: 'chugs', riff: read, seed: 'read' });
  const kicks = band.drums.filter((n) => n.p === 36).map((n) => start + n.t * spb);
  let ok = 0, wrong = 0;
  for (const [, n] of truth) if (kicks.some((k) => Math.abs(k - n.s) <= 0.015 + 1e-4)) ok++;
  for (const k of kicks) if (![...truth.values()].some((n) => Math.abs(k - n.s) <= 0.03)) wrong++;
  const tr = readRiff(played.map((n) => ({ t: n.g, p: n.p, d: n.d })), { beats }).roots;
  let roots = 0;
  for (let b = 0; b < beats; b++) if (tr[b] === read.roots[b]) roots++;
  return { ok, n: truth.size, kick: truth.size ? ok / truth.size : 1, wrong, roots, beats, key: read.key?.root ?? null, want: ((lowP % 12) + 12) % 12 };
}
const TUNED = { standard: 40, 'drop-c': 36, 'b-standard': 35 };
export function readFixtures({ kinds = ['chug', 'chords', 'tremolo'], tempos = [90, 132, 160, 200] } = {}) {
  const rows = [];
  let i = 0;
  for (const kind of kinds) for (const bpm of tempos) {
    const tuning = Object.keys(TUNED)[i++ % 3], low = TUNED[tuning], R = fixtureRiff(kind, low), spb = 60 / bpm, lead = 0.5, lat = 0.008;
    const { buf, notes } = riffDI(R, { passes: 1, bpm, seed: 7 + i, jitter: 0.01, tail: 0.5 });
    const x = new Float32Array(buf.length + Math.round((lead + lat) * SR));
    x.set(buf, Math.round((lead + lat) * SR));
    const t0 = Date.now(), read = readTake(x, SR, { tempo: bpm, start: lead, bars: 8, grid: 4, latency: 0, place: 'metal' }), ms = Date.now() - t0;
    const played = notes.map((n) => { const g = Math.round((n.t / spb) * 4) / 4; return { s: n.t + lead + lat, g, p: n.p, d: n.d / spb, mute: R.notes.some((q) => Math.abs(q[0] - g) < 1e-6 && q[1] === n.p && !q[2]) }; });
    rows.push({ kind, bpm, tuning, ...scoreRead(read, played, { bpm, start: lead, beats: 32 }), ms, read });
  }
  return rows;
}
export function diBoxFixtures() {
  return ['chug', 'chords', 'tremolo'].map((kind) => {
    const s = fixture(kind), bpm = s.tempo, spb = 60 / bpm, beats = s.tracks[0].clips[0].length;
    const x = renderSong(s, { tail: 0.5 }).channels[0];
    const t0 = Date.now(), read = readTake(x, SR, { tempo: bpm, start: 0, bars: beats / 4, grid: 4, place: 'metal' }), ms = Date.now() - t0;
    const played = s.tracks[0].clips[0].notes.map((n) => ({ s: n.t * spb, g: Math.round(n.t * 4) / 4, p: n.p, d: n.d, mute: n.v < 0.35 }));
    const tuning = kind === 'tremolo' ? 'b-standard' : 'drop-c';
    return { kind: `${kind} (DI Box)`, bpm, tuning, ...scoreRead(read, played, { bpm, start: 0, beats }), ms, read };
  });
}
