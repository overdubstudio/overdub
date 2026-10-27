// The guitar room's takes and part line (docs/research/GUITAR-ROOM.md §2.5-§2.8; ui/liveroom/guitar/parts-plans.js):
// each plan applies as one step by you and undoes exactly (the song as it was, its meta's clock aside), a take that
// makes a new part is one step with the take, a new part's length is whole bars with the ring as the take's tail, the
// pick mutes the others, a riff off the tape is a part; and the takes' lines keep to the room's copy rules.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, clipTail } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import { planGuitarRoom } from '../../app/src/core/liveroom/guitar/setup.js';
import * as PP from '../../app/src/ui/liveroom/guitar/parts-plans.js';
import { LINES, lineOf } from '../../app/src/ui/liveroom/guitar/takes-lines.js';
import '../../app/src/devices/builtin/index.js';

const club = () => {
  const store = createStore(createProject());
  const plan = planGuitarRoom(store.get(), {});
  const r = store.dispatch(plan.ops, { by: 'you', label: plan.label, reason: plan.reason });
  assert.ok(r.ok, r.error);
  return store;
};
// the song, its meta's clock aside (meta.modified moves with every change, undo included)
const song = (store) => {
  const { meta: _m, ...rest } = store.get();
  return JSON.stringify(rest);
};
const step = (store, pl) => {
  assert.ok(pl.ops.length, pl.error || 'a plan with ops');
  const r = store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
  assert.ok(r.ok, r.error);
  return r;
};
// what the recorder's commit puts in the song: the recording described, its clip on the track (one step by you)
let n = 0;
const take = (store, { side = 'L', start, length, tail = 0 }) => {
  const line = PP.partLine(store.get());
  const track = line.roles[side === 'R' ? 'guitarR' : 'guitarL'];
  const id = `a_take${++n}`;
  const r = store.dispatch(
    [
      { type: 'asset.add', asset: { id, kind: 'audio', name: `Take ${n}`, sr: 48000, channels: 1, duration: 10 } },
      {
        type: 'clip.add',
        track,
        ref: 'tk',
        clip: { kind: 'audio', start, length, asset: id, offset: 0, gain: 0, ...(tail ? { tail } : {}) },
      },
    ],
    { by: 'you', label: 'Take' },
  );
  assert.ok(r.ok, r.error);
  return { txn: r.txn.id, track, clip: r.created.tk };
};
const parts = (store) => PP.partLine(store.get()).parts.map((c) => [c.name, c.start, c.length]);

describe('the part line', () => {
  test('a new part at the end, then one before the first: each one step, each undone exactly', () => {
    const store = club();
    const s0 = song(store);
    step(store, PP.planNewPart(store.get(), {}));
    const s1 = song(store);
    assert.deepEqual(parts(store), [['Verse', 0, 16]]);
    step(store, PP.planNewPart(store.get(), { at: 0, name: 'Intro', bars: 2 }));
    assert.deepEqual(parts(store), [
      ['Intro', 0, 8],
      ['Verse', 8, 16],
    ]);
    store.undo();
    assert.equal(song(store), s1);
    store.undo();
    assert.equal(song(store), s0);
  });
  test('a move and a removal: one step each, what follows closes up, undone exactly', () => {
    const store = club();
    step(store, PP.planNewPart(store.get(), { name: 'Verse' }));
    step(store, PP.planNewPart(store.get(), { name: 'Chorus', bars: 2 }));
    step(store, PP.planNewPart(store.get(), { name: 'Bridge', bars: 1 }));
    const before = song(store);
    const ids = PP.partLine(store.get()).parts.map((c) => c.id);
    assert.equal(PP.planMovePart(store.get(), { section: ids[0], to: 1 }).ops.length, 0, 'to its own place is no move');
    const mv = PP.planMovePart(store.get(), { section: ids[0], to: 3 });
    assert.equal(mv.where, 'after bridge');
    step(store, mv);
    assert.deepEqual(parts(store), [
      ['Chorus', 0, 8],
      ['Bridge', 8, 4],
      ['Verse', 12, 16],
    ]);
    store.undo();
    assert.equal(song(store), before);
    step(store, PP.planRemovePart(store.get(), { section: ids[1] }));
    assert.deepEqual(parts(store), [
      ['Verse', 0, 16],
      ['Bridge', 16, 4],
    ]);
    store.undo();
    assert.equal(song(store), before);
  });
  test('the last part can go too', () => {
    const store = club();
    step(store, PP.planNewPart(store.get(), {}));
    const id = PP.partLine(store.get()).parts[0].id;
    step(store, PP.planRemovePart(store.get(), { section: id }));
    assert.equal(PP.partLine(store.get()).parts.length, 0);
  });
  test('whereWords names the part it sits beside', () => {
    const line = {
      parts: [{ name: 'Verse' }, { name: 'Chorus' }],
    };
    assert.equal(PP.whereWords(line, 0), 'before chorus');
    assert.equal(PP.whereWords(line, 1), 'after verse');
    assert.equal(PP.whereWords({ parts: [{ name: 'Verse' }] }, 0), '');
  });
});

describe('a take', () => {
  test('a new part: whole bars to the bar line before the stop, the ring its tail, one step with the take', () => {
    const store = club();
    const s0 = song(store);
    const h0 = store.history.length;
    // played 3 bars and 2 beats from beat 0
    const t = take(store, { start: 0, length: 14 });
    const pl = PP.planTakeIn(store.get(), { track: t.track, clip: t.clip, from: 0 });
    assert.equal(pl.isNew, true);
    assert.equal(pl.length, 12);
    assert.equal(pl.ring, 2);
    const r = store.dispatch(pl.ops, { by: 'you', join: t.txn, label: pl.label, reason: pl.reason });
    assert.ok(r.ok, r.error);
    assert.equal(store.history.length, h0 + 1, 'the part joins the take’s step');
    assert.equal(store.history.at(-1).label, 'Verse take 1');
    const c = store
      .get()
      .tracks.find((x) => x.id === t.track)
      .clips.find((x) => x.id === t.clip);
    assert.equal(clipTail(c), 2);
    assert.deepEqual(parts(store), [['Verse', 0, 12]]);
    // Toss: the take's step out, no redo: History and the song as they were
    const u = store.undo({ id: t.txn, redo: false });
    assert.ok(u.ok, u.error);
    assert.equal(store.history.length, h0);
    assert.equal(store.canRedo(), false);
    assert.equal(song(store), s0);
  });
  test('a take stopped inside the first bar still makes a bar', () => {
    const store = club();
    assert.equal(PP.newPartLength(store.get(), { from: 0, end: 2.5 }), 4);
    assert.equal(PP.newPartLength(store.get(), { from: 16, end: 24 }), 8);
    assert.equal(
      PP.newPartLength(store.get(), { from: 16, end: 23.999 }),
      8,
      'a hair under the bar line is the bar line',
    );
  });
  test('a part’s end moved in review: the section and the take’s tail, joined, undone exactly', () => {
    const store = club();
    const t = take(store, { start: 0, length: 14 });
    const pl = PP.planTakeIn(store.get(), { track: t.track, clip: t.clip, from: 0 });
    store.dispatch(pl.ops, { by: 'you', join: t.txn });
    const before = song(store);
    const pe = PP.planPartEnd(store.get(), { section: pl.section, track: t.track, clip: t.clip, bars: 2 });
    assert.equal(pe.ring, 6);
    const r = store.dispatch(pe.ops, { by: 'you', join: t.txn });
    assert.ok(r.ok);
    assert.deepEqual(parts(store), [['Verse', 0, 8]]);
    assert.equal(
      clipTail(
        store
          .get()
          .tracks.find((x) => x.id === t.track)
          .clips.find((x) => x.id === t.clip),
      ),
      6,
    );
    store.undo();
    assert.equal(store.history.length, 1, 'Toss after a part-end drag still takes the whole take out');
    assert.notEqual(song(store), before);
  });
  test('an existing part: nothing but the label joins; a second take is take 2, ↑ ↓ picks which plays', () => {
    const store = club();
    step(store, PP.planNewPart(store.get(), { bars: 2 }));
    const sec = PP.partLine(store.get()).parts[0];
    const t1 = take(store, { start: 0, length: 9, tail: 1 });
    assert.equal(PP.planTakeIn(store.get(), { ...t1, section: sec.id }).ops.length, 0);
    const t2 = take(store, { start: 0, length: 8 });
    const pl = PP.planTakeIn(store.get(), { ...t2, section: sec.id });
    assert.equal(pl.take, 2);
    assert.equal(pl.label, 'Verse take 2');
    // the newest plays: mute the first, as the recorder does
    store.dispatch({ type: 'clip.set', track: t1.track, clip: t1.clip, patch: { mute: true } }, { by: 'you' });
    assert.deepEqual(PP.planPick(store.get(), { section: sec.id, dir: 1 }).edge, 'last');
    const before = song(store);
    const up = PP.planPick(store.get(), { section: sec.id, dir: -1 });
    assert.equal(up.take, 1);
    step(store, up);
    const clips = store.get().tracks.find((x) => x.id === t1.track).clips;
    assert.ok(!clips.find((x) => x.id === t1.clip).mute);
    assert.equal(clips.find((x) => x.id === t2.clip).mute, true);
    store.undo();
    assert.equal(song(store), before);
  });
  test('the other side is labelled as such', () => {
    const store = club();
    step(store, PP.planNewPart(store.get(), { bars: 2 }));
    const sec = PP.partLine(store.get()).parts[0];
    take(store, { start: 0, length: 8 });
    const r = take(store, { side: 'R', start: 0, length: 8 });
    const pl = PP.planTakeIn(store.get(), { ...r, section: sec.id });
    assert.equal(pl.side, 'R');
    assert.equal(pl.label, 'Verse, the other side');
    assert.equal(PP.takesIn(store.get(), { section: sec.id, side: 'R' }).length, 1);
  });
});

describe('a riff off the tape', () => {
  test('a part of its whole bars, its clip at the part’s 1 with its ring as the tail, one step, undone exactly', () => {
    const store = club();
    step(store, PP.planNewPart(store.get(), { name: 'Verse' }));
    const before = song(store);
    const riff = {
      ops: [
        {
          type: 'asset.add',
          asset: { id: 'a_r1', kind: 'audio', name: 'Riff 1', sr: 48000, channels: 1, duration: 4 },
        },
      ],
      clip: { kind: 'audio', start: 0, length: 8, asset: 'a_r1', offset: 0, gain: 0, name: 'Riff 1' },
      beats: 8,
      bars: 2,
      tail: 0.5,
    };
    const track = PP.partLine(store.get()).roles.guitarL;
    const pl = PP.planRiffPart(store.get(), { at: 0, riff, track, name: 'Riff 1' });
    step(store, pl);
    assert.deepEqual(parts(store), [
      ['Riff 1', 0, 8],
      ['Verse', 8, 16],
    ]);
    const c = store
      .get()
      .tracks.find((x) => x.id === track)
      .clips.find((x) => x.asset === 'a_r1');
    assert.equal(c.start, 0);
    const ring = Math.round(0.5 * (store.get().tempo / 60) * 10000) / 10000;
    assert.equal(clipTail(c), ring, 'half a second of ring, in beats at the song’s tempo');
    assert.equal(c.length, 8 + ring);
    store.undo();
    assert.equal(song(store), before);
  });
});

describe('the takes’ lines', () => {
  const vars = {
    part: 'Chorus',
    take: 2,
    bars: 4,
    ring: 1.5,
    next: 'Bridge',
    stopped: 3,
    n: 2,
    side: 'L',
    where: 'before the chorus',
    tape: true,
  };
  for (const id of Object.keys(LINES)) {
    test(`${id}: two sentences at most, no exclamation, no never-words`, () => {
      for (const v of [vars, { ...vars, ring: 0, next: null, n: 1, tape: false, where: '', side: 'R', take: 1 }]) {
        const t = lineOf(id, v);
        assert.ok(t.length > 0 && t.length < 160, t);
        assert.ok(!t.includes('!'), t);
        assert.ok(!/\b(error|failed|fail|wrong|perfect|auto|insert|oops)\b/i.test(t), t);
        assert.ok(!/undefined|null|NaN|\[object/.test(t), t);
        const sentences = t.split(/(?<=[.?])\s+(?=[A-Z⌘↑])/).filter(Boolean);
        assert.ok(sentences.length <= 2, `${t} (${sentences.length} sentences)`);
      }
    });
  }
});
