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
import { noteName as nameOf } from '../../app/src/core/music.js';
import { string, strum } from '../../tools/strings.js';
import { checks } from './helpers/check.js';

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
  test('a low string plucked again and again, as a guitarist tunes, keeps reading past 8 s (its ringing is not the floor)', () => {
    const sr = 48000,
      len = 16,
      buf = new Float32Array(sr * len);
    for (let at = 0.5; at < len - 1; at += 1.5) {
      const s = string(40, {
        sr,
        dur: 1.55,
        at,
        len,
        peak: -14,
        cents: -13,
        hum: null,
        noise: null,
        seed: Math.round(at * 10),
      });
      for (let i = 0; i < buf.length; i++) buf[i] += s.buf[i];
    }
    const hum = string(40, { sr, dur: 0, at: 0, len, peak: -120, hum: -60, noise: -70 });
    for (let i = 0; i < buf.length; i++) buf[i] += hum.buf[i];
    const R = readAll(buf, sr, 'standard', { until: len - 1 });
    const late = R.filter((x) => x.t > 9);
    const live = late.filter((x) => x.r.live && x.r.p === 40).length;
    assert.ok(live >= late.length * 0.95, `live in ${live} of ${late.length} looks after 9 s`);
    // (and the floor is still the hum's, not the strings')
    assert.ok(late[late.length - 1].r.floor < -55, `floor ${late[late.length - 1].r.floor.toFixed(1)} dBFS`);
  });
});

// moved from tools/input-test.js, with the sweep across a guitar's and a bass's range (seconds of Node) staying there
describe('tuner, on plucked strings', () => {
  test("nine tunings' open strings, plucked in turn, each read as its note on its own string", () => {
    const T = checks();
    // the strings, read in turn: each tuning's open strings, plucked one after another, name themselves
    const sr = 48000,
      bad = [];
    for (const id of [
      'standard',
      'drop-d',
      'd-standard',
      'drop-c',
      'b-standard',
      'drop-b',
      'drop-a',
      '7-standard',
      '7-drop-a',
    ]) {
      const t = TUNER_TUNINGS[id],
        at0 = 0.5,
        len = at0 + t.strings.length * 1.0 + 1,
        buf = new Float32Array(Math.round(len * sr));
      t.strings.forEach((m, i) => {
        const s = string(m, { sr, dur: 0.95, at: at0 + i, len, peak: -14, seed: 11 + i, hum: -62 });
        for (let j = 0; j < buf.length; j++) buf[j] += s.buf[j];
      });
      const reads = readAll(buf, sr, id, { until: len });
      t.strings.forEach((m, i) => {
        const mid = reads.filter((x) => x.t > at0 + i + 0.12 && x.t < at0 + i + 0.5 && x.r.live);
        const ok =
          mid.length >= 5 &&
          mid.every((x) => x.r.p === m && x.r.string?.open === m && x.r.string?.number === t.strings.length - i);
        if (!ok)
          bad.push(
            `${id} string ${t.strings.length - i}: ${
              mid
                .slice(0, 2)
                .map((x) => `${x.r.note}${x.r.octave} as ${x.r.string?.name}`)
                .join(', ') || 'nothing'
            }`,
          );
      });
    }
    T.ok(
      !bad.length,
      `tuner: nine tunings' open strings (E standard to a seven-string's drop A), plucked in turn, each read as its note on its own string${bad.length ? '; wrong: ' + bad.slice(0, 4).join('; ') : ''}`,
    );
    T.done();
  });

  test('the low string names the tuning, and the strings heard settle it', () => {
    const T = checks();
    const low = [36, 35, 33].map(
      (m) =>
        `${nameOf(m)}: ${tuningsFromLow(m)
          .map((x) => x.name)
          .join(' or ')}`,
    );
    const g = (hs) => guessTuning(hs)[0]?.id;
    T.ok(
      tuningsFromLow(36)[0].id === 'drop-c' &&
        g([35, 42]) === 'drop-b' &&
        g([35, 40, 45, 50, 54]) === 'b-standard' &&
        g([35, 40, 45, 50, 55]) === '7-standard' &&
        g([36, 43]) === 'drop-c' &&
        g([36, 41]) === 'c-standard',
      `tuner: a low string asks which tuning (${low.join('; ')}), and the strings heard after it settle it (B then F♯: drop B; B E A D F♯: B standard; B E A D G: seven-string; C then G: drop C; C then F: C standard)`,
    );
    T.done();
  });

  test('a peg turned while the string rings is followed, and reads 0 once it stops', () => {
    const T = checks();
    // B1 from 40 cents flat up to pitch over two seconds: the reading follows it
    const sr = 48000,
      s = string(35, {
        sr,
        dur: 4,
        cents: -40,
        at: 0.5,
        bend: (t) => Math.min(40, Math.max(0, (t - 0.5) * 20)),
        peak: -12,
      });
    const reads = readAll(s.buf, sr, '7-standard', { until: 5 }),
      half = windowFor(sr) / sr / 2;
    const live = reads.filter((x) => x.r.live && x.r.settled);
    const lag = Math.max(
      ...live.map((x) => Math.abs((x.r.midi - 35) * 100 - (1200 * Math.log2(s.truth(x.t - half) / 440) + 6900 - 3500))),
    );
    const end = live.filter((x) => x.t > 3.3).map((x) => x.r.shown);
    T.ok(
      lag <= 8 && end.length >= 5 && end.every((c) => c === 0),
      `tuner: a peg turned 20 cents a second while B1 rings is followed within ${lag.toFixed(1)} cents, and reads 0 once it stops (${[...new Set(end)].join(', ')})`,
    );
    T.done();
  });
});
