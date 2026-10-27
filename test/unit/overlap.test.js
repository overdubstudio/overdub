// Overlapping takes on one track (docs/research/GUITAR-ROOM.md §2.6, §4.3; docs/ARCHITECTURE.md "Overlapping takes"):
// a take keeps its ring past its part's end as the clip's `tail`, and the next part's take on the same track never
// mutes or cuts it. The ops and their exact inverses, every planner that cuts or moves clips, the recorder's plan, and
// a render that measures both takes sounding where they overlap.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/src/core/store.js';
import {
  createProject,
  normClip,
  clipTail,
  clipBodyEnd,
  clipLengthPatch,
  summarize,
} from '../../app/src/core/project.js';
import {
  planTakeFolder,
  takeFolders,
  planClipTrim,
  planTakeComp,
  planTakesFlatten,
  planDropTrim,
  snapStep,
} from '../../app/src/core/arrangement.js';
import { planTake, withTails } from '../../app/src/input/recorder.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { lufs, chroma } from '../../app/src/audio/measure.js';

// (the song without meta, keys in order: an edit stamps meta.modified and an undo leaves the stamp; an optional field an
// undo puts back lands last among its clip's keys)
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );
const song = (s) => canon({ ...s.get(), meta: null });
const audioClips = (s, g) => s.track(g).clips.filter((c) => c.kind === 'audio');
const byAsset = (s, g, a) => audioClips(s, g).find((c) => c.asset === a);

// A song at 120 BPM with a guitar track and two parts, Verse [0, 8) and Chorus [8, 16): the verse's take rang 2 beats
// past its part (tail 2), then the chorus's take went in over [8, 16) with a beat of its own ring.
function twoParts({ tails = true } = {}) {
  const s = createStore(createProject());
  const g = s.dispatch([
    { type: 'project.set', patch: { tempo: 120 } },
    { type: 'track.add', ref: 'g', track: { name: 'Left Rhythm', kind: 'audio' } },
    { type: 'section.add', section: { name: 'Verse', start: 0, length: 8 } },
    { type: 'section.add', section: { name: 'Chorus', start: 8, length: 8 } },
  ]).created.g;
  const take = (asset, A, B, tail, id) => {
    const tf = planTakeFolder(s.get(), {
      track: g,
      kind: 'audio',
      start: A,
      end: tails ? B : B + tail,
      take: id,
      passes: [{ start: A, end: tails ? B : B + tail, ...(tails ? { tail } : {}), audio: { asset, offset: 0 } }],
    });
    const r = s.dispatch(tf.ops, { by: 'you', label: 'take' });
    assert.ok(r.ok, r.error);
    return tf;
  };
  take('a_verse1', 0, 8, 2, 'tk_verse1');
  take('a_chorus1', 8, 16, 1, 'tk_chorus1');
  return { s, g, take };
}

describe('the model', () => {
  test("clipTail and clipBodyEnd: an audio clip's ring past its part, never a notes clip's, never all of it", () => {
    assert.equal(clipTail({ kind: 'audio', start: 0, length: 10, tail: 2 }), 2);
    assert.equal(clipBodyEnd({ kind: 'audio', start: 4, length: 10, tail: 2 }), 12);
    assert.equal(clipTail({ kind: 'notes', start: 0, length: 10, tail: 2 }), 0);
    assert.equal(clipTail({ kind: 'audio', start: 0, length: 2, tail: 2 }), 0);
    assert.equal(clipBodyEnd({ kind: 'notes', start: 4, length: 4 }), 8);
  });
  test('normClip keeps a good tail and drops a bad one (an older song has none)', () => {
    assert.equal(normClip({ kind: 'audio', start: 0, length: 10, asset: 'a_x', tail: 2 }).tail, 2);
    assert.ok(!('tail' in normClip({ kind: 'audio', start: 0, length: 10, asset: 'a_x', tail: 12 })));
    assert.ok(!('tail' in normClip({ kind: 'audio', start: 0, length: 10, asset: 'a_x', tail: -1 })));
    assert.ok(!('tail' in normClip({ kind: 'notes', start: 0, length: 10, tail: 2 })));
    assert.ok(!('tail' in normClip({ kind: 'audio', start: 0, length: 10, asset: 'a_x' })));
  });
  test('clip.set tail, and its inverse, exactly', () => {
    const { s, g } = twoParts();
    const c = byAsset(s, g, 'a_chorus1'),
      before = song(s);
    assert.ok(s.dispatch({ type: 'clip.set', track: g, clip: c.id, patch: { tail: null, length: 8 } }).ok);
    assert.ok(!('tail' in byAsset(s, g, 'a_chorus1')));
    assert.ok(s.undo().ok);
    assert.equal(song(s), before);
    const r = s.dispatch({ type: 'clip.set', track: g, clip: c.id, patch: { length: 1 } });
    assert.ok(
      !r.ok && /tail/.test(r.error),
      'a length that leaves the tail as long as the clip is refused, and says why',
    );
    assert.equal(song(s), before);
  });
  test("the song's summary (get_project) says where a take's part ends and its ring starts; a clip without one, nothing", () => {
    const { s, g } = twoParts();
    const lines = summarize(s.get()).split('\n');
    const v = byAsset(s, g, 'a_verse1');
    assert.ok(
      lines.some(
        (l) => l.includes(`clip ${v.id}`) && l.includes('its part ends at beat 8; the rest is its ring, tail 2'),
      ),
    );
    const { s: s2 } = twoParts({ tails: false });
    assert.ok(!summarize(s2.get()).includes('its ring'));
  });
  test("clipLengthPatch (the Inspector's Length): a take's length moves its out-point, the body stays; undo is exact", () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1'),
      before = song(s);
    assert.deepEqual(clipLengthPatch({ kind: 'notes', start: 0, length: 4 }, 2), { length: 2 });
    // back into the tail: a beat of ring left, the part still ends at beat 8
    assert.ok(s.dispatch({ type: 'clip.set', track: g, clip: v.id, patch: clipLengthPatch(v, 9) }).ok);
    let x = byAsset(s, g, 'a_verse1');
    assert.equal(x.length, 9);
    assert.equal(clipTail(x), 1);
    assert.equal(clipBodyEnd(x), 8);
    // shorter than the old tail: into the body, the tail goes (no refusal)
    assert.ok(s.dispatch({ type: 'clip.set', track: g, clip: v.id, patch: clipLengthPatch(x, 1) }).ok);
    x = byAsset(s, g, 'a_verse1');
    assert.equal(x.length, 1);
    assert.equal(clipTail(x), 0);
    assert.ok(s.undo().ok && s.undo().ok);
    assert.equal(song(s), before);
  });
});

describe('takes on one track overlap', () => {
  test("the next part's take leaves the last one's tail ringing: unmuted, uncut, out of its folder", () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1'),
      c = byAsset(s, g, 'a_chorus1');
    assert.deepEqual([v.start, v.length, v.tail, !!v.mute], [0, 10, 2, false]);
    assert.deepEqual([c.start, c.length, c.tail, !!c.mute], [8, 9, 1, false]);
    assert.equal(audioClips(s, g).length, 2, 'nothing cut into pieces');
    const fs = takeFolders(s.track(g)).map((f) => [f.start, f.end, f.clips.length]);
    assert.deepEqual(
      fs,
      [
        [0, 8, 1],
        [8, 16, 1],
      ],
      'each folder is its part, not its ring',
    );
  });
  test("without a tail, the control room's take folder is as it was: what played under the new take is cut and muted", () => {
    const { s, g } = twoParts({ tails: false });
    const v = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, !!x.mute]);
    assert.deepEqual(
      v,
      [
        [0, 8, false],
        [8, 2, true],
      ],
      "the verse take's last 2 beats go silent under the chorus take",
    );
  });
  test('another take of the verse mutes the first, tail and all; the new one rings on', () => {
    const { s, g } = twoParts();
    const tf = planTakeFolder(s.get(), {
      track: g,
      kind: 'audio',
      start: 0,
      end: 8,
      take: 'tk_verse2',
      passes: [{ start: 0, end: 8, tail: 3, audio: { asset: 'a_verse2', offset: 0 } }],
    });
    const before = song(s);
    assert.ok(s.dispatch(tf.ops).ok);
    const v1 = byAsset(s, g, 'a_verse1'),
      v2 = byAsset(s, g, 'a_verse2'),
      c = byAsset(s, g, 'a_chorus1');
    assert.deepEqual([v1.length, v1.tail, !!v1.mute], [10, 2, true]);
    assert.deepEqual([v2.start, v2.length, v2.tail, !!v2.mute, v2.take], [0, 11, 3, false, v1.take]);
    assert.ok(!c.mute);
    assert.ok(s.undo().ok);
    assert.equal(song(s), before, 'one undo step, exact');
  });
});

describe('clip.trim: the out-point', () => {
  test('back inside the tail, on the beat: the tail shortens, the body and the folder stay; undo is exact', () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1'),
      before = song(s);
    const r = s.dispatch({ type: 'clip.trim', track: g, clip: v.id, end: 8.8, snap: 'beat' });
    assert.ok(r.ok, r.error);
    const w = byAsset(s, g, 'a_verse1');
    assert.deepEqual([w.start, w.length, w.tail, w.offset], [0, 9, 1, 0]);
    assert.deepEqual(
      takeFolders(s.track(g)).map((f) => [f.start, f.end]),
      [
        [0, 8],
        [8, 16],
      ],
    );
    assert.ok(s.undo().ok);
    assert.equal(song(s), before);
    assert.ok(s.redo().ok);
    assert.equal(byAsset(s, g, 'a_verse1').tail, 1);
  });
  test("back to the part's end takes the tail off; past it grows the tail, never the body", () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1');
    assert.ok(s.dispatch({ type: 'clip.trim', track: g, clip: v.id, end: 8.1, snap: 'bar' }).ok);
    assert.ok(!('tail' in byAsset(s, g, 'a_verse1')) && byAsset(s, g, 'a_verse1').length === 8);
    s.undo();
    const p = planClipTrim(s.get(), { track: g, clip: v.id, end: 12 });
    assert.deepEqual(p.covered, [], 'growing a tail takes no beats from the chorus');
    assert.ok(s.dispatch({ type: 'clip.trim', track: g, clip: v.id, end: 12 }).ok);
    assert.deepEqual([byAsset(s, g, 'a_verse1').length, byAsset(s, g, 'a_verse1').tail], [12, 4]);
    assert.ok(!byAsset(s, g, 'a_chorus1').mute);
  });
  test("into the body of a folder's playing take: its tail goes; the take under it keeps its own, muted, as a folder of its own", () => {
    const { s, g } = twoParts();
    s.dispatch(
      planTakeFolder(s.get(), {
        track: g,
        kind: 'audio',
        start: 0,
        end: 8,
        take: 'tk_verse2',
        passes: [{ start: 0, end: 8, tail: 3, audio: { asset: 'a_verse2', offset: 0 } }],
      }).ops,
    );
    const v2 = byAsset(s, g, 'a_verse2'),
      before = song(s);
    const p = planClipTrim(s.get(), { track: g, clip: v2.id, end: 6 });
    assert.deepEqual(p.uncovered, [[6, 8]]);
    assert.ok(s.dispatch({ type: 'clip.trim', track: g, clip: v2.id, end: 6 }).ok);
    const w = byAsset(s, g, 'a_verse2');
    assert.deepEqual([w.length, 'tail' in w], [6, false]);
    const back = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0, !!x.mute, x.take === v2.take]);
    assert.deepEqual(
      back,
      [
        [0, 6, 0, true, true],
        [6, 4, 2, true, false],
      ],
      'take 1 stays muted under take 2, and its piece past the trim keeps its ring',
    );
    s.undo();
    assert.equal(song(s), before);
  });
  test('snap: bar, beat, a step; the shortest clip still holds', () => {
    const p = { meter: [6, 8] };
    assert.equal(snapStep(p, 'bar'), 3);
    assert.equal(snapStep(p, 'beat'), 1);
    assert.equal(snapStep(p, 0.25), 0.25);
    assert.throws(() => snapStep(p, 'bars'), /snap/);
    const { s, g } = twoParts();
    const c = byAsset(s, g, 'a_chorus1');
    assert.ok(s.dispatch({ type: 'clip.trim', track: g, clip: c.id, end: 8.1, snap: 'bar' }).ok);
    assert.equal(byAsset(s, g, 'a_chorus1').length, 4, 'an end that snaps onto the start goes a line out');
  });
});

describe('the arrangement keeps tails with their takes', () => {
  test('split in the body: the right half rings; in the tail: the left keeps what is left', () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1'),
      before = song(s);
    assert.ok(s.dispatch({ type: 'clip.split', track: g, clip: v.id, at: 4 }).ok);
    const parts = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0]);
    assert.deepEqual(parts, [
      [0, 4, 0],
      [4, 6, 2],
    ]);
    s.undo();
    assert.equal(song(s), before);
    // (a take's folder is its body: a split in the ring is outside it, and says so; an ordinary clip splits there)
    const r = s.dispatch({ type: 'clip.split', track: g, clip: v.id, at: 9 });
    assert.ok(!r.ok && /take folder/.test(r.error), r.error);
    s.dispatch({ type: 'clip.set', track: g, clip: v.id, patch: { take: null } });
    assert.ok(s.dispatch({ type: 'clip.split', track: g, clip: v.id, at: 9 }).ok);
    const t2 = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0]);
    assert.deepEqual(t2, [
      [0, 9, 1],
      [9, 1, 0],
    ]);
  });
  test('bars inserted between the parts: the verse take stays whole and rings into them', () => {
    const { s, g } = twoParts();
    const before = song(s);
    assert.ok(s.dispatch({ type: 'time.insert', at: 8, length: 4 }).ok);
    const v = byAsset(s, g, 'a_verse1'),
      c = byAsset(s, g, 'a_chorus1');
    assert.deepEqual([v.start, v.length, v.tail], [0, 10, 2]);
    assert.deepEqual([c.start, c.length, c.tail], [12, 9, 1]);
    assert.equal(audioClips(s, g).length, 2);
    s.undo();
    assert.equal(song(s), before);
  });
  test('the chorus deleted: the verse take rings on over what closes up; bars cut from a body keep the tail at its end', () => {
    const { s, g } = twoParts();
    assert.ok(s.dispatch({ type: 'time.remove', at: 8, length: 8 }).ok);
    const v = byAsset(s, g, 'a_verse1');
    assert.deepEqual([v.start, v.length, v.tail], [0, 10, 2]);
    assert.ok(!byAsset(s, g, 'a_chorus1'));
    s.undo();
    const before = song(s);
    assert.ok(s.dispatch({ type: 'time.remove', at: 2, length: 2 }).ok);
    const pieces = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0, x.offset]);
    assert.deepEqual(pieces, [
      [0, 2, 0, 0],
      [2, 6, 2, 2],
    ]);
    s.undo();
    assert.equal(song(s), before);
  });
  test("a duplicated verse brings its take's tail; the chorus take's ring into it is not the verse's", () => {
    const { s, g } = twoParts();
    const before = song(s);
    assert.ok(s.dispatch({ type: 'section.duplicate', section: 'Verse', push: true }).ok);
    const copies = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0, !!x.mute]);
    assert.deepEqual(copies, [
      [0, 10, 2, false],
      [8, 10, 2, false],
    ]);
    assert.deepEqual([byAsset(s, g, 'a_chorus1').start, byAsset(s, g, 'a_chorus1').tail], [16, 1]);
    s.undo();
    assert.equal(song(s), before);
    assert.ok(s.dispatch({ type: 'section.duplicate', section: 'Chorus', push: true }).ok);
    assert.equal(
      audioClips(s, g).filter((x) => x.asset === 'a_verse1').length,
      1,
      "the verse tail ringing into the chorus isn't copied with it",
    );
  });
  test('the chorus moved before the verse: each take goes with its part, its tail whole', () => {
    const { s, g } = twoParts();
    const before = song(s);
    assert.ok(s.dispatch({ type: 'section.move', section: 'Chorus', before: 'Verse' }).ok);
    const v = byAsset(s, g, 'a_verse1'),
      c = byAsset(s, g, 'a_chorus1');
    assert.deepEqual([c.start, c.length, c.tail], [0, 9, 1]);
    assert.deepEqual([v.start, v.length, v.tail], [8, 10, 2]);
    assert.equal(audioClips(s, g).length, 2);
    s.undo();
    assert.equal(song(s), before);
  });
  test('a take repeated repeats on its part, each copy ringing under the next', () => {
    const { s, g } = twoParts();
    const v = byAsset(s, g, 'a_verse1');
    assert.ok(s.dispatch({ type: 'clip.repeat', track: g, clip: v.id, times: 2 }).ok);
    const xs = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0]);
    assert.deepEqual(xs, [
      [0, 10, 2],
      [8, 10, 2],
    ]);
  });
  test('a comp of two verse takes keeps the tail on the piece that ends the part; flattening keeps it', () => {
    const { s, g } = twoParts();
    s.dispatch(
      planTakeFolder(s.get(), {
        track: g,
        kind: 'audio',
        start: 0,
        end: 8,
        take: 'tk_verse2',
        passes: [{ start: 0, end: 8, tail: 3, audio: { asset: 'a_verse2', offset: 0 } }],
      }).ops,
    );
    const v1 = byAsset(s, g, 'a_verse1'),
      before = song(s);
    // take 1 for bars 1 (beats 0-4), take 2 after
    const comp = planTakeComp(s.get(), { track: g, clip: v1.id, lane: v1.id, start: 0, end: 4 });
    assert.ok(s.dispatch(comp.ops).ok);
    const shape = audioClips(s, g)
      .filter((x) => x.asset !== 'a_chorus1')
      .map((x) => [x.asset, x.start, x.length, x.tail ?? 0, !!x.mute])
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(shape, [
      ['a_verse1', 0, 4, 0, false],
      ['a_verse2', 0, 4, 0, true],
      ['a_verse1', 4, 6, 2, true],
      ['a_verse2', 4, 7, 3, false],
    ]);
    const playing = audioClips(s, g).find((x) => x.asset === 'a_verse2' && !x.mute);
    const fl = planTakesFlatten(s.get(), { track: g, clip: playing.id });
    assert.ok(s.dispatch(fl.ops).ok);
    const flat = audioClips(s, g)
      .filter((x) => x.asset !== 'a_chorus1')
      .map((x) => [x.asset, x.start, x.length, x.tail ?? 0, !!x.mute, x.take ?? null]);
    assert.deepEqual(
      flat,
      [
        ['a_verse1', 0, 4, 0, false, null],
        ['a_verse2', 4, 7, 3, false, null],
      ],
      'two recordings side by side stay two clips; the last rings on',
    );
    s.undo();
    s.undo();
    assert.equal(song(s), before);
  });
  test("a clip dropped over a tail doesn't cut it (the tail claims no beats); one over the body does, tail and all", () => {
    const { s, g } = twoParts();
    assert.equal(
      planDropTrim(s.get(), [{ track: g, start: 8.5, end: 9.5 }], { keep: [byAsset(s, g, 'a_chorus1').id] }).ops.length,
      0,
    );
    const p = planDropTrim(s.get(), [{ track: g, start: 6, end: 7 }], { keep: [byAsset(s, g, 'a_chorus1').id] });
    assert.ok(s.dispatch(p.ops).ok);
    const xs = audioClips(s, g)
      .filter((x) => x.asset === 'a_verse1')
      .map((x) => [x.start, x.length, x.tail ?? 0]);
    assert.deepEqual(xs, [
      [0, 6, 0],
      [7, 3, 2],
    ]);
  });
});

describe('recording one', () => {
  test("withTails: a pass past the part's end gets its ring as audio.tail; one inside it, none", () => {
    const ps = withTails(
      [
        { n: 0, audio: { asset: 'a', offset: 0, start: 8, length: 10.5 } },
        { n: 1, audio: { asset: 'a', offset: 9, start: 8, length: 6 } },
      ],
      16,
    );
    assert.equal(ps[0].audio.tail, 2.5);
    assert.ok(!('tail' in ps[1].audio));
    assert.equal(withTails(ps, null), ps);
  });
  test('planTake: an audio take with a tail is a folder over its part, the clip running on, the take before ringing under it', () => {
    const { s, g } = twoParts();
    const plan = planTake(s.get(), {
      id: 'tk_rec0001',
      parts: [
        {
          track: g,
          kind: 'audio',
          mode: 'take',
          passes: withTails([{ n: 0, audio: { asset: 'a_chorus2', offset: 0, start: 8, length: 10 } }], 16),
        },
      ],
    });
    assert.ok(s.dispatch(plan.ops).ok);
    const c2 = byAsset(s, g, 'a_chorus2'),
      c1 = byAsset(s, g, 'a_chorus1'),
      v = byAsset(s, g, 'a_verse1');
    assert.deepEqual([c2.start, c2.length, c2.tail, !!c2.mute], [8, 10, 2, false]);
    assert.ok(c1.mute && c1.take === c2.take, "the chorus's first take is kept under it, muted, in its folder");
    assert.ok(!v.mute && v.tail === 2, 'the verse take still rings into the chorus');
    assert.match(plan.summary, /Take 2/);
  });
});

describe('rendered: both takes sound where they overlap', () => {
  // 120 BPM: a beat is 0.5 s. The verse take is a 220 Hz tone (A3) that rang 2 beats past bar 3; the chorus take a
  // 329.63 Hz tone (E4) from beat 8. The overlap is beats 8-10, seconds 4-5: measured over 4.1-4.9 s (clear of the
  // clips' 3 ms fades) against the same window with the chorus take alone.
  const SR = 48000;
  const tone = (hz, secs, amp = 0.25) => {
    const x = new Float32Array(Math.round(secs * SR));
    for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
    return x;
  };
  const assets = { a_verse1: { sr: SR, channels: [tone(220, 6)] }, a_chorus1: { sr: SR, channels: [tone(329.63, 6)] } };
  const W = { from: 4.1, to: 4.9 };
  const pc = (buf, name) => {
    const c = chroma(buf, W);
    return c[['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(name)];
  };
  const render = (p, extra = {}) => {
    const r = renderSong(p, { assets, tail: 1, ...extra });
    return { sr: r.sr, channels: r.channels };
  };
  test("the verse take's tail rings under the chorus take: A and E both there, louder than the chorus take alone", () => {
    const { s } = twoParts();
    const both = render(s.get());
    const alone = createStore(JSON.parse(JSON.stringify(s.get())));
    const v = alone.get().tracks[0].clips.find((c) => c.asset === 'a_verse1');
    alone.dispatch({ type: 'clip.set', track: alone.get().tracks[0].id, clip: v.id, patch: { mute: true } });
    const one = render(alone.get());
    const lBoth = lufs(both, W),
      lOne = lufs(one, W);
    // two equal tones summed: about +3 dB on one (power adds)
    assert.ok(
      lBoth - lOne > 2 && lBoth - lOne < 4,
      `the overlap is ${(lBoth - lOne).toFixed(2)} dB louder than the chorus take alone (${lBoth.toFixed(2)} vs ${lOne.toFixed(2)} LUFS)`,
    );
    assert.ok(
      pc(both, 'A') > 0.3 && pc(both, 'E') > 0.3,
      `A ${pc(both, 'A').toFixed(2)} and E ${pc(both, 'E').toFixed(2)} in the overlap`,
    );
    assert.ok(pc(one, 'A') < 0.1, `and A is gone with the verse take muted (${pc(one, 'A').toFixed(2)})`);
    // before the overlap, the verse take alone; after its tail, the chorus take alone
    const before = { from: 3.1, to: 3.9 },
      after = { from: 5.1, to: 5.9 };
    assert.ok(
      Math.abs(lufs(both, before) - lufs(both, after)) < 1.5,
      `each take alone reads about the same either side (${lufs(both, before).toFixed(2)}, ${lufs(both, after).toFixed(2)} LUFS)`,
    );
  });
  test("the control room's fold, for contrast: without a tail the verse take is muted under the chorus take", () => {
    const { s } = twoParts({ tails: false });
    const r = render(s.get());
    assert.ok(pc(r, 'A') < 0.1, `no A in the overlap (${pc(r, 'A').toFixed(2)})`);
  });
  test('renders are deterministic: the same song twice, the same samples', () => {
    const { s } = twoParts();
    const a = render(s.get()),
      b = render(s.get());
    assert.ok(a.channels[0].every((x, i) => x === b.channels[0][i]));
  });
});
