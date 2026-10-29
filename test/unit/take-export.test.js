// export_take's stretch of a recording (app/src/agent/take-export.js): sample-exact, never rounded through seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchOf, pickTake } from '../../app/src/agent/take-export.js';

const song = (tempo) => ({
  tempo,
  meter: [4, 4],
  tracks: [
    {
      id: 't_g',
      name: 'Guitar',
      kind: 'audio',
      clips: [
        { id: 'c_a', kind: 'audio', name: 'Verse riff', start: 0, length: 32, asset: 'a_1', offset: 0.5 },
        { id: 'c_b', kind: 'audio', name: 'Chorus riff', start: 32, length: 32, asset: 'a_1', offset: 0, mute: true },
      ],
    },
  ],
});

test('an 8-bar clip at 106 BPM, 44.1 kHz, is the floor of its exact span, not 18.11 s', () => {
  const p = song(106),
    [s0, s1] = stretchOf(p, p.tracks[0].clips[0], 44100, 44100 * 60);
  assert.equal(s0, 22050);
  assert.equal(s1 - s0, Math.floor(((32 * 60) / 106) * 44100)); // 798792, where 18.11 s gave 798651
});

test('a span that is a whole number of samples stays whole (no float shortfall)', () => {
  const p = song(120),
    [s0, s1] = stretchOf(p, p.tracks[0].clips[0], 48000, 48000 * 60);
  assert.equal(s1 - s0, 16 * 48000);
});

test("the stretch stops at the recording's end, and whole is all of it", () => {
  const p = song(106),
    c = p.tracks[0].clips[0];
  assert.deepEqual(stretchOf(p, c, 44100, 100000), [22050, 100000]);
  assert.deepEqual(stretchOf(p, c, 44100, 100000, true), [0, 100000]);
});

test('takes are picked by id, name, then track (the one that plays)', () => {
  const p = song(106);
  assert.equal(pickTake(p, 'c_b').take.id, 'c_b');
  assert.equal(pickTake(p, 'verse').take.id, 'c_a');
  assert.equal(pickTake(p, 'guitar').take.id, 'c_a');
  assert.equal(pickTake(p, 'riff').candidates.length, 2);
});
