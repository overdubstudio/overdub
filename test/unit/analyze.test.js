// app/src/audio/analyze/: the pieces of the Flip a song analysis that need no song (the whole is tools/analyze-test.js
// and tools/beat-bench.js), and the shared parts it leans on (rounds.js accentScore, jam.js chordViterbi).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resample, downmix } from '../../app/src/audio/analyze/resample.js';
import { mapOf } from '../../app/src/audio/analyze/map.js';
import { keyName, keyRoot } from '../../app/src/audio/analyze/key.js';
import { resultToOps } from '../../app/src/audio/analyze/toOps.js';
import { accentScore, downbeatOf } from '../../app/src/input/rounds.js';
import { chordViterbi } from '../../app/src/core/jam.js';
import { checkAnchors, mapSec } from '../../app/src/core/music.js';
import { createProject } from '../../app/src/core/project.js';

const sine = (hz, n, sr) => Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
const rms = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
};

describe('resample', () => {
  test('keeps a tone in the band at its level, removes one above it', () => {
    const a = resample(sine(440, 48000, 48000), 48000, 22050);
    assert.equal(a.length, 22050);
    assert.ok(Math.abs(rms(a, 2000, 20000) - Math.SQRT1_2) < 0.003);
    const b = resample(sine(15000, 48000, 48000), 48000, 22050);
    assert.ok(rms(b, 2000, 20000) < 0.003);
  });
  test('the same rate is a copy; downmix is the mean', () => {
    const x = Float64Array.from([1, 2, 3]);
    assert.deepEqual(Array.from(resample(x, 22050, 22050)), [1, 2, 3]);
    assert.deepEqual(Array.from(downmix([Float32Array.from([1, 0]), Float32Array.from([0, 1])])), [0.5, 0.5]);
  });
});

describe('mapOf: the placement rule', () => {
  test('the first downbeat lands on a bar line, the clip starts earlier by its pickup', () => {
    // beats every 0.5 s from 1.2 s, the 1 on the third beat (a two-beat pickup), 4/4
    const times = Array.from({ length: 34 }, (_, i) => 1.2 + 0.5 * i);
    const counts = times.map((_, i) => i - 2);
    const m = mapOf(times, counts, 4);
    assert.equal(checkAnchors(m.anchors), null);
    assert.equal(m.firstDownbeat, 2.2);
    // d / s = 4.4 beats: k = 2 keeps the start at or after 0 (bar 3), start = 8 - 4.4
    assert.ok(Math.abs(m.start - 3.6) < 1e-6);
    assert.ok(Math.abs(mapSec(m.anchors, 8) - (m.off + 2.2)) < 1e-6);
    assert.equal(m.tempo, 120);
  });
  test('k is 1 when the pickup is short', () => {
    const times = Array.from({ length: 20 }, (_, i) => 0.3 + 0.5 * i);
    const m = mapOf(
      times,
      times.map((_, i) => i),
      4,
    );
    assert.ok(Math.abs(m.start - (4 - 0.6)) < 1e-6);
  });
});

describe('key names', () => {
  test('as people write them', () => {
    assert.equal(keyName(3, 'major'), 'Eb major');
    assert.equal(keyName(6, 'minor'), 'F# minor');
    assert.equal(keyRoot(10, 'minor'), 'Bb');
  });
});

describe('the shared recognisers', () => {
  test("accentScore is the tap door's weights", () => {
    assert.equal(accentScore('kick', 0, 4), 3);
    assert.equal(accentScore('kick', 2, 4), 1);
    assert.equal(accentScore('snare', 1, 4), 2);
    assert.equal(accentScore('snare', 0, 4), -2);
    assert.equal(accentScore('snare', 1, 3), 0);
    // downbeatOf still reads a kick-snare loop as it did
    const notes = [
      { p: 38, t: 0 },
      { p: 36, t: 1 },
      { p: 38, t: 2 },
      { p: 36, t: 3 },
    ];
    assert.equal(downbeatOf(notes, { bpb: 4, length: 4 }).shift, 1);
  });
  test('chordViterbi reads a C major window and an A minor one', () => {
    const w = (pcs, bass) => {
      const c = new Array(12).fill(0);
      for (const p of pcs) c[p] = 1;
      return { chroma: c, bass, total: pcs.length, first: true };
    };
    const { path, cands, NC } = chordViterbi([w([0, 4, 7], 0), w([0, 4, 7], 0), w([9, 0, 4], 9), w([9, 0, 4], 9)], {
      qualities: ['', 'm', '5', '7'],
    });
    const names = path.map((s) => (s === NC ? '-' : cands[s].root + cands[s].q));
    assert.deepEqual(names, ['0', '0', '9m', '9m']);
  });
});

describe('resultToOps', () => {
  const result = {
    key: { root: 'D', scale: 'minor', name: 'D minor' },
    readings: [
      {
        id: 'found',
        bpb: 4,
        tempo: 120,
        start: 3.6,
        off: 1.8,
        firstDownbeat: 2.2,
        anchors: [
          { beat: 0, sec: 0 },
          { beat: 8, sec: 4 },
          { beat: 12, sec: 6 },
        ],
      },
    ],
    sections: [
      { name: 'Verse', start: 0, length: 8, t0: 0, t1: 2.2 },
      { name: 'Chorus', start: 8, length: 8, t0: 2.2, t1: 6.2, key: 'F major' },
    ],
    chords: [{ start: 8, end: 10, t0: 2.2, t1: 3.2, root: 2, quality: 'm', name: 'Dm', pcs: [2, 5, 9] }],
  };
  test('the key, the map, the placement, the sections and a muted Chords track', () => {
    const ops = resultToOps(createProject(), result, 'found', { clips: [{ track: 't_1', clip: 'c_1' }] });
    assert.deepEqual(
      ops.map((o) => o.type),
      ['project.set', 'tempo.map', 'clip.set', 'section.add', 'section.add', 'track.add'],
    );
    assert.deepEqual(ops[0].patch, { key: { root: 'D', scale: 'minor' } });
    assert.equal(ops[1].map.clip, 'c_1');
    assert.equal(ops[2].patch.start, 3.6);
    assert.equal(ops[4].section.key, 'F major');
    const tr = ops[5].track;
    assert.ok(tr.mute && tr.name === 'Chords');
    assert.deepEqual(
      tr.clips[0].notes.map((n) => n.p),
      [50, 57, 62, 65],
    );
  });
  test('a song that has sections and a Chords track keeps them', () => {
    const p = {
      ...createProject(),
      sections: [{ id: 's', name: 'A', start: 0, length: 4 }],
      tracks: [{ name: 'Chords' }],
      meter: [3, 4],
    };
    const ops = resultToOps(p, result, 'found', { clips: [] });
    assert.deepEqual(
      ops.map((o) => o.type),
      ['project.set', 'tempo.map'],
    );
    assert.deepEqual(ops[0].patch.meter, [4, 4]);
  });
});
