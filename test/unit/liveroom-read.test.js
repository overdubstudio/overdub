// The live room's read, band and pair (core/liveroom/read.js, band.js, tight.js, double.js, lines/double.js; the
// velocity house rules in core/grooves.js): the rules on small inputs, fast. tools/liveroom/checks-band.js holds them on
// the full fixtures and measures the levels.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readTake, riffOf, attacksOf, SNAP, THIN_ONSETS } from '../../app/src/core/liveroom/read.js';
import {
  bandNotes,
  riffIn,
  planLearn,
  planFeel,
  planFinish,
  planBassYours,
  guideOps,
  isHouse,
  HOUSE_RULES,
  MUTE_V,
  TOUCH,
} from '../../app/src/core/liveroom/band.js';
import { measurePair, LIMIT_MS } from '../../app/src/core/liveroom/tight.js';
import { planDouble, planPans, panLaneOps, sidesOf } from '../../app/src/core/liveroom/double.js';
import { LINES } from '../../app/src/core/liveroom/lines/double.js';
import { realize, getGroove } from '../../app/src/core/grooves.js';
import { setupOf, grooveOf, feelsOf, guitarChain, finishChain, RIGS } from '../../app/src/core/liveroom/places.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { riffDI, SR } from '../../tools/liveroom/fake.js';

const EPS = 1e-6;
// two bars of palm-muted eighths on the low E with a G5 on the 4 of each bar, at 132
const RIFF = {
  bpm: 132,
  beats: 8,
  chord: false,
  notes: [0, 0.5, 1, 1.5, 2, 2.5, 4, 4.5, 5, 5.5, 6, 6.5]
    .map((t) => [t, 40, 0])
    .concat([
      [3, 43, 0.9],
      [3, 50, 0.9],
      [7, 43, 0.9],
      [7, 50, 0.9],
    ]),
};
let cached = null;
const take = () => (cached ||= riffDI(RIFF, { passes: 1, seed: 4, jitter: 0.006, tail: 0.4 }));
const read = () => readTake(take().buf, SR, { tempo: 132, start: 0, bars: 2, grid: 4, place: 'metal' });

describe('readTake', () => {
  test('the riff on the grid: its chugs, its roots per beat, the key', () => {
    const r = read();
    assert.equal(r.thin, false);
    assert.ok(r.notes.length >= 14 && r.notes.length <= 16, `notes ${r.notes.length}`);
    for (const n of r.notes) assert.ok(Math.abs(n.t * 4 - Math.round(n.t * 4)) < EPS, 'on the sixteenth grid');
    assert.ok(r.chugs.length >= 12, `chugs ${r.chugs.length}`);
    assert.equal(r.key.root, 4);
    assert.equal(r.key.scale, 'minor');
    assert.equal(r.roots.length, 8);
    assert.equal(r.roots[0], 4);
    for (const n of r.chugs) assert.ok(Math.abs(n.ms) <= 15, `chug ${n.t} is ${n.ms} ms off`);
  });
  test('deterministic: the same samples, the same read', () => {
    assert.deepEqual(read(), read());
  });
  test('the latency comes off every attack', () => {
    const x = take().buf,
      pad = new Float32Array(x.length + 480);
    pad.set(x, 480);
    const a = readTake(pad, SR, { tempo: 132, start: 0, bars: 2, grid: 4, latency: 0.01 }),
      b = read();
    assert.deepEqual(
      a.notes.map((n) => n.t),
      b.notes.map((n) => n.t),
    );
    assert.ok(Math.abs(a.lean - b.lean) <= 1.5, `${a.lean} against ${b.lean}`);
  });
  test('a thin read: fewer than THIN_ONSETS on the grid', () => {
    const { buf } = riffDI(
      {
        bpm: 132,
        beats: 8,
        chord: false,
        notes: [
          [0, 52, 1.8],
          [2, 55, 1.8],
          [4, 59, 1.8],
          [6, 55, 1.8],
        ],
      },
      { passes: 1, seed: 2, jitter: 0, tail: 0.4 },
    );
    const r = readTake(buf, SR, { tempo: 132, start: 0, bars: 2, grid: 4 });
    assert.ok(r.notes.length < THIN_ONSETS);
    assert.equal(r.thin, true);
  });
  test('nothing at all reads as thin, with no key', () => {
    const r = readTake(new Float32Array(SR), SR, { tempo: 120, start: 0, bars: 1 });
    assert.equal(r.thin, true);
    assert.equal(r.key, null);
    assert.equal(r.notes.length, 0);
  });
  test('attacksOf snaps within 40% of a step', () => {
    const a = attacksOf(take().buf, SR, { tempo: 132, start: 0, bars: 2, grid: 4 });
    assert.ok(a.length >= 14);
    const step = 60 / 132 / 4;
    for (const x of a) assert.ok(Math.abs(x.off) <= SNAP * step * 1000 + 0.5);
  });
});

describe('riffOf', () => {
  test('the chug rule: within 5 semitones of the lowest note, or unpitched', () => {
    const r = riffOf(
      [
        { t: 0, p: 40, d: 0.25 },
        { t: 0.25, p: 45, d: 0.25 },
        { t: 0.5, p: 46, d: 0.25 },
        { t: 0.75, p: null, d: 0.25 },
      ],
      { beats: 1 },
    );
    assert.deepEqual(
      r.chugs.map((n) => n.t),
      [0, 0.25, 0.75],
    );
    assert.equal(r.low, 40);
  });
  test('roots: the lowest pitch held 40% of a beat, the last root kept, the first back-filled', () => {
    const r = riffOf(
      [
        { t: 1, p: 43, d: 0.5 },
        { t: 1.5, p: 50, d: 0.5 },
        { t: 3, p: 45, d: 0.2 },
      ],
      { beats: 4 },
    );
    assert.deepEqual(r.roots, [7, 7, 7, 7]);
  });
});

describe('the band', () => {
  const song = (o = {}) => ({
    tempo: 132,
    meter: [4, 4],
    tracks: [],
    room: { v: 1, place: 'metal' },
    sections: [{ id: 's_a', name: 'Verse', start: 0, length: 8 }],
    ...o,
  });
  test('the kick on each chug, where it was picked (clamped to 15 ms), one per grid point', () => {
    const r = read(),
      b = bandNotes(song(), 's_a', { feel: 'chugs', riff: r, seed: 'x' });
    const kicks = b.drums.filter((n) => n.p === 36);
    assert.equal(kicks.length, new Set(r.chugs.map((c) => c.t)).size);
    const spb = 60 / 132;
    for (const k of kicks) {
      const c = r.chugs.find((q) => Math.abs(q.t - k.t) < 0.05);
      assert.ok(c, `a kick at ${k.t} with no chug`);
      assert.ok(Math.abs((k.t - c.t) * spb * 1000) <= HOUSE_RULES.kickMs + 0.6);
    }
  });
  test('the same read and seed give the same band; another seed another', () => {
    const r = read();
    assert.deepEqual(
      bandNotes(song(), 's_a', { feel: 'chugs', riff: r, seed: 'x' }),
      bandNotes(song(), 's_a', { feel: 'chugs', riff: r, seed: 'x' }),
    );
    assert.notDeepEqual(
      bandNotes(song(), 's_a', { feel: 'chugs', riff: r, seed: 'x' }).drums,
      bandNotes(song(), 's_a', { feel: 'chugs', riff: r, seed: 'y' }).drums,
    );
  });
  test('the bass: the read roots in B0-B2, resting where you rest', () => {
    const b = bandNotes(song(), 's_a', { feel: 'chugs', riff: read(), seed: 'x' }).bass;
    assert.ok(b.length > 0);
    for (const n of b) assert.ok(n.p >= HOUSE_RULES.bassLo && n.p <= HOUSE_RULES.bassHi);
    assert.ok(
      b.every((n) => [4, 7].includes(n.p % 12)),
      b.map((n) => n.p).join(' '),
    );
  });
  test("a thin read keeps the groove's own kick and the bass waits", () => {
    const thin = { notes: [], chugs: [], roots: [], low: null, thin: true };
    const b = bandNotes(song(), 's_a', { feel: 'chugs', riff: thin, seed: 'x' });
    assert.equal(b.kicks, 0);
    assert.ok(b.drums.some((n) => n.p === 36));
    assert.equal(b.bass.length, 0);
  });
  test('the touch: Softer under, Louder over, ghosts left ghosts', () => {
    const r = read(),
      at = (loud) => bandNotes(song(), 's_a', { feel: 'chugs', loud, riff: r, seed: 'x' }).drums;
    const mean = (xs) => xs.filter((n) => n.v > 0.4).reduce((s, n) => s + n.v, 0) / xs.filter((n) => n.v > 0.4).length;
    assert.ok(mean(at(-1)) < mean(at(0)) && mean(at(0)) < mean(at(1)));
    assert.ok(TOUCH.base < 1);
  });
  test("every feel resolves at the place's tempo", () => {
    for (const place of ['metal', 'basement', 'bluesbar']) {
      const S = setupOf(place);
      for (const [part, feels] of Object.entries(S.feels))
        for (const f of feels) assert.ok(getGroove(grooveOf(place, f, S.tempo)), `${place} ${part} ${f}`);
    }
    assert.ok(feelsOf('metal', 'Verse', 190).includes('blast'));
  });
});

describe('the plans', () => {
  const build = () => {
    const S = setupOf('metal', { tuning: 'drop-c' }),
      st = createStore(createProject({ tempo: 132 }));
    const ops = [],
      map = {};
    for (const t of S.tracks) {
      if (t.later) continue;
      const { role, later, ...track } = t;
      ops.push({ type: 'track.add', track: { ...track, id: `t_${role}` } });
      map[role] = `t_${role}`;
    }
    ops.push({ type: 'section.add', section: { id: 's_v', name: 'Verse', start: 0, length: 8 } });
    ops.push({ type: 'asset.add', asset: { id: 'a_l', kind: 'audio', name: 'DI', sr: SR, channels: 1, duration: 4 } });
    ops.push({
      type: 'clip.add',
      track: 't_guitarL',
      clip: { id: 'c_l', kind: 'audio', asset: 'a_l', start: 0, length: 8, offset: 0, by: 'you' },
    });
    ops.push({ type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', tracks: map } });
    assert.equal(st.dispatch(ops, { by: 'overdub' }).ok, true);
    return st;
  };
  test('planLearn: one house step, the riff as heard, the drums, the bass; undo puts it back', () => {
    const st = build(),
      before = JSON.stringify(st.get().tracks.map((t) => t.clips.length));
    const l = planLearn(st.get(), { section: 's_v', read: read() });
    assert.equal(l.label, 'The band learned the verse');
    assert.equal(l.reason, 'room:learn:s_v');
    const r = st.dispatch(l.ops, { by: 'overdub', label: l.label });
    assert.equal(r.ok, true, r.error);
    const p = st.get(),
      heard = p.tracks.find((t) => t.id === 't_heard').clips[0];
    assert.ok(heard.notes.filter((n) => n.v < MUTE_V).length === read().notes.filter((n) => n.p == null).length);
    assert.equal(p.room.parts.s_v.learned.from, 'c_l');
    assert.ok(p.tracks.find((t) => t.id === 't_drums').clips[0].notes.every((n) => n.by === 'overdub'));
    assert.ok(isHouse(p.tracks.find((t) => t.id === 't_drums').clips[0]));
    const rf = riffIn(p, 's_v');
    assert.deepEqual(rf.roots, read().roots);
    st.undo();
    assert.equal(JSON.stringify(st.get().tracks.map((t) => t.clips.length)), before);
  });
  test('planFeel, planFinish, planBassYours, guideOps dispatch', () => {
    const st = build();
    st.dispatch(planLearn(st.get(), { section: 's_v', read: read() }).ops, { by: 'overdub' });
    for (const make of [
      (p) => planFeel(p, { section: 's_v', feel: 'gallop', busy: 1 }),
      (p) => planFinish(p, { finish: 'loud' }),
      (p) => planBassYours(p, { section: 's_v' }),
      (p) => guideOps(p, { section: 's_v' }),
    ]) {
      const plan = make(st.get());
      assert.ok(plan.ops.length > 0);
      const r = st.dispatch(plan.ops, { by: 'you' });
      assert.equal(r.ok, true, `${plan.reason}: ${r.error}`);
    }
    const p = st.get();
    assert.equal(p.room.finish, 'loud');
    assert.deepEqual(
      p.master.inserts.map((x) => x.device),
      finishChain('metal', 'loud').map((x) => x.device),
    );
    assert.equal(p.master.clip, 'clean');
    assert.ok(p.tracks.some((t) => t.name === 'Bass (yours)' && t.arm));
  });
  test('planDouble: Guitar R with the right cab, armed, hard right; the lane once both sides are in', () => {
    const st = build();
    const d = planDouble(st.get(), { section: 's_v' });
    assert.equal(st.dispatch(d.ops, { by: 'overdub' }).ok, true);
    const R = st.get().tracks.find((t) => t.name === 'Guitar R');
    assert.ok(R.arm && R.pan === 1);
    assert.equal(R.inserts[0].params.cab, RIGS.modern.right);
    assert.deepEqual(
      R.inserts.map((x) => x.params),
      guitarChain('modern', 'R', 'drop-c').map((x) => x.params),
    );
    st.dispatch(
      [
        {
          type: 'clip.add',
          track: R.id,
          clip: { kind: 'audio', asset: 'a_l', start: 0, length: 8, offset: 0, by: 'you' },
        },
      ],
      { by: 'you' },
    );
    assert.deepEqual(sidesOf(st.get(), 's_v').playing.L, 'c_l');
    const pans = planPans(st.get());
    assert.equal(st.dispatch(pans.ops, { by: 'overdub' }).ok, true);
    assert.equal(st.get().tracks.find((t) => t.id === 't_guitarL').pan, -1);
    assert.deepEqual(panLaneOps(st.get()), []);
  });
});

describe('measurePair', () => {
  test('the same take is tight; a bar 30 ms late is named', () => {
    const base = RIFF.notes,
      spb = 60 / 132;
    const mk = (late, seed) =>
      riffDI(
        { ...RIFF, notes: base.map(([t, p, d]) => [t + (t >= 4 ? late / 1000 / spb : 0), p, d]) },
        { passes: 1, seed, jitter: 0.001, tail: 0.4, solid: true },
      ).buf;
    const l = mk(0, 3);
    const same = measurePair(l, mk(0, 5), { sr: SR, tempo: 132, start: 0, bars: 2, grid: 4 });
    assert.equal(same.verdict, 'tight');
    const late = measurePair(l, mk(30, 5), { sr: SR, tempo: 132, start: 0, bars: 2, grid: 4 });
    assert.equal(late.verdict, 'bar');
    assert.equal(late.worst.bar, 2);
    assert.equal(late.worst.dir, 'late');
    assert.ok(Math.abs(late.worst.ms - 30) <= 5, `${late.worst.ms}`);
    assert.equal(late.line.id, 'side.drift');
    assert.equal(LIMIT_MS, 20);
  });
  test('too little to measure: no verdict', () => {
    assert.equal(
      measurePair(new Float32Array(SR), new Float32Array(SR), { sr: SR, tempo: 120, bars: 1 }).verdict,
      null,
    );
  });
});

describe('the velocity house rules', () => {
  test('realize without rules is unchanged by them; with them, nothing over full and ghosts kept soft', () => {
    const g = 'funk/hats-and-ghosts';
    const a = realize(g, { tempo: 96, seed: 2 }),
      b = realize(g, { tempo: 96, seed: 2, rules: null });
    assert.deepEqual(a, b);
    const band = realize(g, { tempo: 96, seed: 2, rules: 'band' });
    assert.equal(band.length, a.length);
    assert.ok(band.every((n) => n.v <= 1));
    assert.ok(band.some((n) => n.v >= 0.15 && n.v <= 0.4));
  });
});

describe("the double's lines", () => {
  const NEVER =
    /\b(detect|detected|auto|automatic|AI|smart|magic|algorithm|onset|LUFS|compressor|EQ|latency|perfect|great|awesome|amazing|nailed|score|accuracy|error|failed|oops|sorry|warning|wrong|tutorial|lesson|crowd|fans|audience)\b|!/i;
  test('every line says something and nothing from the never-says list', () => {
    const vars = {
      part: 'Verse',
      ms: 12,
      bar: 5,
      dir: 'late',
      from: 1,
      take: 2,
      count: 3,
      feel: 'Gallop',
      finish: 'tight',
      others: ['loud', 'room'],
      than: 'tight',
      db: 2,
    };
    for (const [id, l] of Object.entries(LINES)) {
      const s = l.text(vars);
      assert.ok(typeof s === 'string' && s.length > 5, id);
      assert.ok(!NEVER.test(s), `${id}: ${s}`);
    }
    assert.equal(
      LINES['side.drift'].text({ part: 'Chorus', bar: 5, dir: 'late', ms: 31 }),
      'Right side is in on the chorus: bar 5 drifts late against the left, about 30 ms. Bar 5 again?',
    );
  });
});
