// input/level.js: the input's level against the −12 to −6 dBFS window, and what to do with the interface's gain.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, levelAdvice, meterPos, WINDOW } from '../../app/src/input/level.js';

const lin = (db) => 10 ** (db / 20);
// strums every 500 ms peaking at `db`, the frames between them decaying 30 dB a second, at 60 frames a second
function play(meter, db, ms, t0 = 0) {
  let st = null;
  for (let t = 0; t <= ms; t += 1000 / 60) st = meter.push({ peak: lin(db - ((t % 500) / 1000) * 30) }, t0 + t);
  return st;
}

describe('the verdict', () => {
  test('each window, once it has held', () => {
    for (const [db, v] of [
      [-70, 'none'],
      [-31, 'quiet'],
      [-17, 'low'],
      [-9, 'ok'],
      [-12, 'ok'],
      [-6, 'ok'],
      [-3, 'hot'],
    ]) {
      const st = play(createLevel(), db, 1500);
      assert.equal(st.verdict, v, `${db} dBFS`);
    }
    assert.deepEqual(WINDOW, { lo: -12, hi: -6 });
  });
  test('a clip says so at once, holds three seconds, and the lamp can be put out', () => {
    const m = createLevel();
    play(m, -9, 1000);
    let st = m.push({ peak: 1 }, 1100);
    assert.equal(st.verdict, 'clip');
    assert.ok(st.clip);
    assert.equal(st.clips, 1);
    st = play(m, -9, 2500, 1200);
    assert.ok(st.clip, 'still lit at 3.6 s');
    m.clearClip();
    st = m.push({ peak: lin(-9) }, 3800);
    assert.ok(!st.clip);
  });
  test('it doesn’t flicker as you play, and playing softer after a good strum keeps it good for a while', () => {
    const m = createLevel();
    play(m, -9, 1500);
    // softer for 4 s: still ok, the number it was said with kept
    const st = play(m, -20, 4000, 1600);
    assert.equal(st.verdict, 'ok');
    assert.match(st.advice.text, /−9 dBFS/);
    // a clip comes through at once whatever was said
    assert.equal(m.push({ peak: 1 }, 6000).verdict, 'clip');
  });
  test('the bar falls, the hold holds, then falls', () => {
    const m = createLevel();
    m.push({ peak: lin(-6) }, 0);
    let st = m.push({ peak: lin(-40) }, 500);
    assert.ok(Math.abs(st.db - -18) < 0.01, `bar ${st.db}`);
    assert.ok(Math.abs(st.hold - -6) < 0.01);
    st = m.push({ peak: lin(-40) }, 2500);
    assert.ok(st.hold < -6 && st.hold >= st.db);
    assert.equal(meterPos(-60), 0);
    assert.equal(meterPos(0), 1);
    assert.equal(meterPos(-30), 0.5);
  });
  test('samples work as well as a peak', () => {
    const b = new Float32Array(512);
    b[100] = -lin(-9);
    assert.ok(Math.abs(createLevel().push(b, 0).peak - -9) < 0.01);
  });
});

describe('the advice', () => {
  test('names the interface’s knob, the number, which way and how far', () => {
    const q = levelAdvice('quiet', -31);
    assert.equal(q.turn, 'up');
    assert.equal(q.by, 21);
    assert.match(
      q.text,
      /^Quiet: your hardest strum peaks at −31 dBFS\. Turn the gain knob on your interface up, about 21 dB\.$/,
    );
    assert.match(levelAdvice('quiet', -31, { quietFor: 9000 }).text, /instrument \(INST or Hi-Z\)/);
    assert.equal(levelAdvice('low', -14).turn, 'up');
    assert.equal(levelAdvice('ok', -9).turn, null);
    assert.match(levelAdvice('ok', -9).text, /^Right in the window: −9 dBFS/);
    assert.equal(levelAdvice('hot', -2).turn, 'down');
    assert.equal(levelAdvice('clip', 0).by, 9);
    assert.match(levelAdvice('none', -80).text, /^Nothing coming in yet/);
  });
  test('on a Focusrite, the ring round the knob', () => {
    assert.match(levelAdvice('ok', -9, { device: 'Scarlett Solo USB' }).text, /ring round the knob stays green/);
    assert.match(levelAdvice('clip', 0, { device: 'Focusrite USB Audio' }).text, /went red/);
    assert.doesNotMatch(levelAdvice('ok', -9, { device: 'UMC204HD' }).text, /ring/);
  });
});
