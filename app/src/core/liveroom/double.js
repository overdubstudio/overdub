// @ts-check
// The other side [core] (docs/research/LIVE-ROOM-MODE.md §3.7, §4.1, §8): the double. Pure plans, each -> { ops,
// label, reason } for one store.dispatch, made of existing ops (§9.3), never dispatched here.
//
// Frozen (§14.2):
//   planDouble(p, { section })               the other side's set-up, the house's step: Guitar R made the first time
//                                            (the left's chain with the cab one mic over, places.js rigChain 'R'),
//                                            armed (monitoring follows the armed track, input/audioin.js), panned hard
//                                            right, and Guitar L's pan lane as the song stands
//   planUseAsRight(p, { section, clip })     a take of the left side used as the right (a step by you): the clip moved
//                                            to Guitar R, another left take playing in its place when it was the one
//                                            playing, and the pan lane with the part wide
// Also here (seam additions):
//   planPans(p) -> { ops, label, reason }    Guitar L's pan lane for the song as it stands, the house's (C joins it to
//                                            a right take's step, or dispatches it after one lands): a part with one
//                                            side plays it centred; once it has both, L hard left (R is hard right); a
//                                            part single on purpose (room.parts oneSide) stays hard left. A step at each
//                                            part boundary with a 20 ms ramp; gone (and L's own pan hard left) once
//                                            every part has both sides
//   panLaneOps(p, { both }) -> ops           the same, with the sections in `both` counted as having both sides
//   sidesOf(p, section) -> { L: [clip ids], R: [clip ids], playing: { L, R } }   the takes on each side in a part
//   roleTrack(p, role) -> the role's track (room.tracks, else by the name its place gives it) | null
//   PAN_RAMP   seconds, the lane's ramp at a boundary

import { roomOf, partOf } from './model.js';
import { placeOf, guitarChain, guitarGain } from './places.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const none = () => ({ ops: [], label: '', reason: '' });
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export const PAN_RAMP = 0.02;
const HOUSE = 'overdub';
const DEFAULT_NAMES = { guitarL: 'Guitar L', guitarR: 'Guitar R', guitar: 'Guitar', lead: 'Lead', drums: 'Drums', bass: 'Bass', heard: 'Riff (as heard)', bassYours: 'Bass (yours)' };

export function roleTrack(p, role) {
  const room = roomOf(p), tracks = Array.isArray(p?.tracks) ? p.tracks : [];
  const id = isObj(room?.tracks) ? room.tracks[role] : null;
  return (id && tracks.find((t) => t.id === id)) || (DEFAULT_NAMES[role] ? tracks.find((t) => t.name === DEFAULT_NAMES[role]) : null) || null;
}
const sectionOf = (p, s) => (isObj(s) ? s : (p?.sections || []).find((x) => x.id === s) || null);
const sorted = (p) => (p?.sections || []).slice().sort((a, b) => a.start - b.start);
// a take plays in a part when it covers more than a quarter beat of it (its clip starts 30 ms before the part's 1, so
// it overlaps the part before by less than that)
const within = (c, s) => Math.min(c.start + c.length, s.start + s.length) - Math.max(c.start, s.start) > 0.25;

export function sidesOf(p, section) {
  const s = sectionOf(p, section), out = { L: [], R: [], playing: { L: null, R: null } };
  if (!s) return out;
  for (const [side, role] of [['L', 'guitarL'], ['R', 'guitarR']]) {
    const t = roleTrack(p, role) || (side === 'L' ? roleTrack(p, 'guitar') : null);
    if (!t) continue;
    const cs = t.clips.filter((c) => c.kind === 'audio' && within(c, s));
    out[side] = cs.map((c) => c.id);
    const on = cs.filter((c) => !c.mute);
    out.playing[side] = on.length ? on[on.length - 1].id : null;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the pan lane */
function panPoints(p, { both = [] } = {}) {
  const secs = sorted(p).filter((s) => s.length > EPS), bothSet = new Set(both);
  if (!secs.length) return { all: false, any: false, points: [] };
  const vals = secs.map((s) => {
    const sides = sidesOf(p, s);
    const wide = bothSet.has(s.id) || (sides.playing.R != null && sides.playing.L != null);
    return wide || partOf(p, s)?.oneSide ? -1 : 0;
  });
  const all = vals.every((v) => v === -1), any = vals.some((v) => v === -1);
  const ramp = (PAN_RAMP * (p.tempo || 120)) / 60, points = [{ t: 0, v: vals[0] }];
  for (let i = 1; i < secs.length; i++) {
    if (vals[i] === vals[i - 1]) continue;
    const b = secs[i].start;
    points.push({ t: r4(Math.max(points[points.length - 1].t + EPS * 10, b - ramp)), v: vals[i - 1] }, { t: r4(b), v: vals[i] });
  }
  return { all, any, points, end: secs[secs.length - 1].start + secs[secs.length - 1].length };
}
const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x.t - b[i].t) < 1e-4 && Math.abs(x.v - b[i].v) < 1e-6);

export function panLaneOps(p, { both = [] } = {}) {
  const L = roleTrack(p, 'guitarL');
  if (!L) return [];
  const lane = L.auto?.pan || null;
  // a lane someone else wrote is theirs: the house leaves it
  if (lane && lane.by && lane.by !== HOUSE) return [];
  const { all, any, points } = panPoints(p, { both });
  const ops = [];
  if (all || !any) {
    // one value everywhere: no lane, L's own pan says it
    if (lane) ops.push({ type: 'auto.clear', track: L.id, param: 'pan' });
    const want = all ? -1 : 0;
    if (Math.abs((L.pan || 0) - want) > EPS) ops.push({ type: 'track.set', track: L.id, patch: { pan: want } });
    return ops;
  }
  const have = lane ? lane.points.map((x) => ({ t: x.t, v: x.v })) : [];
  if (lane && same(have, points)) return [];
  const to = Math.max(points[points.length - 1].t, ...(lane ? lane.points.map((x) => x.t) : [0]));
  // (signed by the house whoever's step it rides in, a right side's take by you among them: _by, ops.js writeRange)
  ops.push({ type: 'auto.write', track: L.id, param: 'pan', points: points.map((x) => ({ t: x.t, v: x.v })), from: 0, to, _by: HOUSE });
  if (Math.abs(L.pan || 0) > EPS) ops.push({ type: 'track.set', track: L.id, patch: { pan: 0 } });
  return ops;
}

export function planPans(p) {
  const ops = panLaneOps(p);
  return ops.length ? { ops, label: 'The guitars’ sides', reason: 'room:pans' } : none();
}

/* ------------------------------------------------------------------------------------------------ the other side */
// The right side's track as its place makes it (the left's rig and tuning, the cab one mic over), its fader the
// left's (the right side's LEVEL already matches the two, places.js RIGS rightLevel).
function rightTrack(p) {
  const room = roomOf(p) || {}, P = placeOf(room.place), rig = P.rigs.includes(room.rig) ? room.rig : P.rigs[0];
  const L = roleTrack(p, 'guitarL');
  return { name: DEFAULT_NAMES.guitarR, kind: 'audio', color: 'var(--c-3)', inserts: guitarChain(rig, 'R', room.tuning || 'standard'), gain: L ? L.gain : guitarGain(P.id, rig, -12), pan: 1, by: 'you' };
}
function ensureRight(p, ops) {
  const R = roleTrack(p, 'guitarR');
  if (R) return { id: R.id, made: false };
  const room = roomOf(p) || {};
  ops.push({ type: 'track.add', ref: 'guitarR', track: rightTrack(p) });
  ops.push({ type: 'room.set', patch: { tracks: { ...(isObj(room.tracks) ? room.tracks : {}), guitarR: '$guitarR' } } });
  return { id: '$guitarR', made: true };
}

export function planDouble(p, { section = null } = {}) {
  const s = sectionOf(p, section), L = roleTrack(p, 'guitarL');
  if (!s || !L) return none();
  const ops = [], R = ensureRight(p, ops);
  const Rt = roleTrack(p, 'guitarR');
  if (!Rt || !Rt.arm) ops.push({ type: 'track.set', track: R.id, patch: { arm: true } });
  if (Rt && Math.abs((Rt.pan ?? 0) - 1) > EPS) ops.push({ type: 'track.set', track: R.id, patch: { pan: 1 } });
  if (L.arm) ops.push({ type: 'track.set', track: L.id, patch: { arm: false } });
  ops.push(...panLaneOps(p));
  return { ops, label: 'The other side’s set up', reason: `room:double:${s.id}`, made: R.made };
}

export function planUseAsRight(p, { section = null, clip = null } = {}) {
  const s = sectionOf(p, section), L = roleTrack(p, 'guitarL');
  if (!s || !L) return none();
  const c = L.clips.find((x) => x.id === clip && x.kind === 'audio' && within(x, s));
  if (!c) return none();
  const ops = [], R = ensureRight(p, ops), sides = sidesOf(p, s);
  ops.push({ type: 'clip.move', track: L.id, clip: c.id, toTrack: R.id });
  if (c.mute) ops.push({ type: 'clip.set', track: R.id, clip: c.id, patch: { mute: false } });
  // the left keeps a take playing: the newest of the others, when the one moved was the one playing
  if (!c.mute) {
    const others = L.clips.filter((x) => x.kind === 'audio' && x.id !== c.id && within(x, s));
    const next = others[others.length - 1];
    if (next && next.mute) ops.push({ type: 'clip.set', track: L.id, clip: next.id, patch: { mute: false } });
  }
  // the right plays this one only
  const Rt = roleTrack(p, 'guitarR');
  if (Rt) for (const x of Rt.clips) if (x.kind === 'audio' && within(x, s) && !x.mute) ops.push({ type: 'clip.set', track: Rt.id, clip: x.id, patch: { mute: true } });
  const lane = panLaneOps(p, { both: [s.id] });
  ops.push(...lane);
  const k = sides.L.indexOf(c.id) + 1;
  return { ops, label: `Take ${k} is the right side of the ${String(s.name).toLowerCase()}`, reason: `room:useright:${s.id}` };
}
