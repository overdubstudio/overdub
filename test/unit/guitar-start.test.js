// Getting started in the guitar room (docs/research/GUITAR-ROOM.md §2.1): its steps and tour, where the camera goes and
// what the spotlight lands on for each, and the words the slate and the tuner say (app/src/ui/liveroom/guitar/
// start-plan.js, pure). The room itself is tools/liveroom/checks-start.js's, in muted Chromium.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  STEP_IDS,
  stepAfter,
  TOUR,
  shotOf,
  tunerSays,
  strumsWord,
  soundSays,
  plugSays,
  tuningLabel,
  allWords,
} from '../../app/src/ui/liveroom/guitar/start-plan.js';
import { REGIONS, STAGE } from '../../app/src/ui/liveroom/guitar/layout.js';

const rect = (n) => (REGIONS[n] ? { ...REGIONS[n] } : null);
const inside = (outer, r) =>
  r.x >= outer.x - 1 && r.y >= outer.y - 1 && r.x + r.w <= outer.x + outer.w + 1 && r.y + r.h <= outer.y + outer.h + 1;

describe('Getting started: the steps', () => {
  test('plug in, tune, timing, your sound, the tour, in that order', () => {
    assert.deepEqual(STEP_IDS, ['plug', 'tune', 'time', 'sound', 'tour']);
    assert.equal(STEPS.length, 5);
    assert.equal(stepAfter('plug'), 'tune');
    assert.equal(stepAfter('sound'), 'tour');
    assert.equal(stepAfter('tour'), null);
    assert.equal(stepAfter('nope'), null);
  });
  test('each step frames what it is about, and the light lands inside the frame', () => {
    for (const id of ['plug', 'tune', 'time', 'sound']) {
      const s = shotOf(id, { rect });
      assert.ok(s.R.w > 0 && s.R.h > 0, id);
      assert.ok(Array.isArray(s.at) && s.at.length, `${id} lights something`);
      for (const r of s.at) assert.ok(r.x < s.R.x + s.R.w && r.x + r.w > s.R.x, `${id}: the light is in the frame`);
    }
    // plug in frames the board's end, its tuner and the jack, and the meter on the head
    const plug = shotOf('plug', { rect });
    assert.ok(inside(plug.R, REGIONS.tuner) && inside(plug.R, REGIONS.jack));
    // the close-up on the jack while the cable goes in is closer
    const close = shotOf('plug', { rect, close: true });
    assert.ok(close.R.w < plug.R.w && inside(close.R, REGIONS.jack));
    // tune: the tuner pedal, the slate to its right
    const tune = shotOf('tune', { rect });
    assert.ok(inside(tune.R, REGIONS.tuner) && tune.side === 'right');
  });
  test('the tour: seven stops, each on its thing, the strip last', () => {
    assert.equal(TOUR.length, 7);
    TOUR.forEach((s, i) => {
      const sh = shotOf('tour', { rect, tour: i });
      if (s.strip) {
        assert.equal(sh.at, 'strip');
        return;
      }
      assert.ok(sh.at.length >= 1, s.id);
      for (const n of s.at) assert.ok(inside(sh.R, REGIONS[n]) || n === 'riser', `${s.id}: ${n} in frame`);
      assert.ok(sh.R.x < STAGE.w && sh.R.y < STAGE.h);
    });
    assert.equal(TOUR.at(-1).id, 'strip');
    // a tour index out of range is clamped
    assert.deepEqual(shotOf('tour', { rect, tour: 99 }), shotOf('tour', { rect, tour: 6 }));
  });
  test('without the room drawn (no rects), every shot still frames the stage', () => {
    for (const id of ['plug', 'tune', 'time', 'sound', 'tour']) {
      const s = shotOf(id, { rect: () => null });
      assert.ok(s.R.w > 0 && s.R.h > 0, id);
    }
  });
});

describe('Getting started: the words', () => {
  test('the tuner says the string and how far off it is', () => {
    const r = {
      p: 36,
      note: 'C',
      octave: 2,
      live: true,
      held: false,
      shown: -9,
      inTune: false,
      string: { name: 'C', number: 6, cents: -9 },
    };
    assert.equal(tunerSays(r), 'C string (6): 9 cents flat.');
    assert.equal(tunerSays({ ...r, shown: 1, string: { ...r.string, cents: 1 } }), 'C string (6): 1 cent sharp.');
    assert.equal(tunerSays({ ...r, inTune: true, shown: 0 }), 'C string (6) is in tune.');
    assert.equal(
      tunerSays({ ...r, string: { name: 'C', number: 6, cents: 140 }, shown: 40 }),
      'C string (6): tune down to C, 140 cents sharp.',
    );
    assert.equal(tunerSays({ ...r, string: null }), 'C2: 9 cents flat.');
    assert.match(tunerSays({ ...r, live: false, held: true }), /let it ring/);
    assert.equal(tunerSays({ ...r, shown: null }), 'C string (6).');
    assert.equal(tunerSays(null, { n: 6, of: 6, tuning: 'drop C' }), 'All six in tune for drop C.');
  });
  test('counts, stacks and inputs in words', () => {
    assert.equal(strumsWord(6, 6), 'All six');
    assert.equal(strumsWord(4, 6), 'Four of six');
    assert.equal(strumsWord(7, 7), 'All seven');
    assert.equal(tuningLabel('drop C'), 'Drop C');
    assert.equal(
      soundSays({
        stack: 'the club’s stack',
        amp: 'Kraken',
        cab: '4x12 Modern',
        pedals: ['a noise gate', 'a treble booster'],
      }),
      'That’s the club’s stack: Kraken on a 4x12 Modern, a noise gate and a treble booster in front. Play through it.',
    );
    assert.equal(soundSays({ amp: 'Kraken' }), 'That’s your stack: Kraken. Play through it.');
    assert.equal(
      plugSays({ open: true, label: 'Scarlett Solo USB', input: 2, channels: 2 }),
      'Scarlett Solo USB, input 2.',
    );
    assert.equal(
      plugSays({ open: true, label: 'MacBook Pro Microphone', input: 1, channels: 1 }),
      'MacBook Pro Microphone.',
    );
    assert.equal(
      plugSays({ error: 'The browser wasn’t allowed to use the input.' }),
      'The browser wasn’t allowed to use the input.',
    );
  });
  test('every line renders: no broken values, a real minus, no exclamation marks', () => {
    for (const w of allWords()) {
      assert.ok(w.text && !/undefined|NaN|\[object/.test(w.text), w.id);
      assert.ok(!/!/.test(w.text), w.id);
      assert.ok(!/(^|[\s(:])-\d/.test(w.text), `${w.id}: a minus, not a hyphen`);
    }
  });
});
