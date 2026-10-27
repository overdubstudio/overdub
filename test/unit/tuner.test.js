// input/tuner.js: the steady tuner (Getting started's Tune), its strings and tunings. The plucked strings are
// tools/strings.js's (Karplus-Strong on a fractional delay: the pitch is known to a hundredth of a cent).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSteadyTuner,
  stringOf,
  tuningsFromLow,
  guessTuning,
  tuningName,
  noteName,
  windowFor,
  TUNER_TUNINGS,
} from '../../app/src/input/tuner.js';
import { string, strum } from '../../tools/strings.js';

// a buffer read the way ui/gauges/tuner.js reads the input: a window ending at t, every 40 ms
function readAll(buf, sr, tuning = 'standard', { until = buf.length / sr + 1.6, step = 0.04 } = {}) {
  const W = windowFor(sr),
    tu = createSteadyTuner({ tuning }),
    win = new Float32Array(W),
    out = [];
  for (let t = 0; t < until; t += step) {
    const e = Math.round(t * sr);
    for (let i = 0; i < W; i++) {
      const j = e - W + i;
      win[i] = j >= 0 && j < buf.length ? buf[j] : 0;
    }
    out.push({ t, r: { ...tu.push(win, sr, t) } });
  }
  return out;
}

describe('strings and tunings', () => {
  test('the open string a note is nearest, and how far off it', () => {
    assert.deepEqual(stringOf(40.07, 'standard'), { s: 0, number: 6, name: 'Low E', open: 40, cents: 7, near: true });
    assert.equal(stringOf(64, 'standard').name, 'High E');
    assert.equal(stringOf(38, 'drop-d').name, 'D');
    // E2 on a drop-D guitar is its low string two semitones sharp: tune down
    assert.equal(stringOf(40, 'drop-d').cents, 200);
    assert.equal(stringOf(35, '7-standard').number, 7);
    assert.equal(stringOf(20, 'standard'), null);
  });
  test('the tunings a low string can be, in the order to ask', () => {
    assert.deepEqual(
      tuningsFromLow(36).map((t) => t.id),
      ['drop-c', 'c-standard'],
    );
    assert.deepEqual(
      tuningsFromLow(35).map((t) => t.id),
      ['b-standard', 'drop-b', '7-standard'],
    );
    assert.deepEqual(
      tuningsFromLow(35, { strings: 7 }).map((t) => t.id),
      ['7-standard', 'b-standard', 'drop-b'],
    );
    assert.deepEqual(
      tuningsFromLow(33).map((t) => t.id),
      ['drop-a', '7-drop-a'],
    );
    assert.deepEqual(
      tuningsFromLow(38).map((t) => t.name),
      ['drop D', 'D standard'],
    );
  });
  test('a set of open strings heard names the tuning', () => {
    assert.equal(guessTuning([38, 45, 50])[0].id, 'drop-d');
    assert.equal(guessTuning([36, 43, 48])[0].id, 'drop-c');
    assert.equal(guessTuning([35, 40, 45, 50, 55])[0].id, '7-standard');
    assert.equal(guessTuning([35, 42])[0].id, 'drop-b');
    assert.deepEqual(guessTuning([]), []);
  });
  test('names', () => {
    assert.equal(tuningName(TUNER_TUNINGS.standard), 'E standard');
    assert.equal(tuningName(TUNER_TUNINGS['drop-c']), 'drop C');
    assert.equal(tuningName(TUNER_TUNINGS['7-drop-a']), 'seven-string drop A');
    assert.equal(noteName(70), 'B♭');
  });
});

describe('the steady tuner', () => {
  test('silence and hum alone read nothing', () => {
    const sr = 48000;
    const hum = string(36, { sr, dur: 0.01, peak: -120, hum: -50, noise: -70, len: 3 });
    assert.equal(readAll(hum.buf, sr, null).filter((x) => x.r.live).length, 0);
    assert.equal(readAll(new Float32Array(sr * 2), sr).filter((x) => x.r.p).length, 0);
  });
  test('drop C’s low C, 13 cents flat, under a bridge pickup: the note, the string and the cents, steady', () => {
    const sr = 48000,
      s = string(36, { sr, dur: 3, cents: -13, at: 0.4, peak: -14 });
    const R = readAll(s.buf, sr, 'drop-c');
    const named = R.find((x) => x.r.live && x.r.p === 36);
    assert.ok(named && named.t - 0.4 <= 0.2, `named in ${named && (named.t - 0.4).toFixed(2)} s`);
    const steady = R.filter((x) => x.r.live && x.r.settled && x.t > 1);
    assert.ok(steady.length > 20);
    assert.ok(steady.every((x) => x.r.p === 36 && x.r.shown === -13 && Math.abs(x.r.cents + 13) <= 0.5 && !x.r.inTune));
    assert.equal(steady[0].r.string.name, 'C');
    assert.equal(steady[0].r.note, 'C');
    assert.equal(steady[0].r.octave, 2);
  });
  test('a string in tune lights in tune; it holds dimmed when the string stops, then clears', () => {
    const sr = 48000,
      s = string(45, { sr, dur: 1.2, cents: 1, at: 0.4, peak: -12 });
    const R = readAll(s.buf, sr, 'standard', { until: 4 });
    assert.ok(R.some((x) => x.r.live && x.r.inTune && x.r.shown === 1));
    const held = R.filter((x) => x.r.held);
    assert.ok(held.length > 5 && held.every((x) => x.r.p === 45));
    assert.equal(R[R.length - 1].r.p, 0);
  });
  test('a new string is a new note at once; under the tuning’s range, a power chord’s sub-octave never reads', () => {
    const sr = 48000;
    const a = string(45, { sr, dur: 0.5, at: 0.4, len: 2.6 }),
      e = string(40, { sr, dur: 1.2, at: 0.9, len: 2.6 });
    const b = a.buf.map((v, i) => v + e.buf[i]);
    const seq = [];
    for (const x of readAll(b, sr))
      if (x.r.live && x.r.p && seq[seq.length - 1]?.p !== x.r.p) seq.push({ p: x.r.p, t: x.t });
    assert.deepEqual(
      seq.map((x) => x.p),
      [45, 40],
    );
    assert.ok(seq[1].t - 0.9 <= 0.2);
    // E5 strummed and let ring: its common period is E1, an octave under the low string
    const e5 = strum([40, 47, 52], [0.4, 1.4], { sr, mute: false, len: 2.6 });
    const low = readAll(e5.buf, sr).filter((x) => x.r.p && x.r.p < 40);
    assert.equal(low.length, 0);
    assert.ok(
      readAll(e5.buf, sr, null).some((x) => x.r.p === 28),
      'with no tuning (any note) it does read E1',
    );
  });
});
