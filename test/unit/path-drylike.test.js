// The live path's dry test (app/src/input/livepath.js dryLike; docs/research/AMP-PATH.md §7): the amp's output is "dry"
// when it is a delayed, scaled copy of what came in. A real amp's output is not; a wire, a gain or a short delay is.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dryLike, HEALTH } from '../../app/src/input/livepath.js';

const SR = 48000;
// a plucked-ish test signal: a few partials with a decay and a little seeded noise (no Math.random)
function pluck(n = 8192, seed = 7) {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    const t = i / SR,
      env = Math.exp(-t * 6);
    x[i] =
      env *
        (0.5 * Math.sin(2 * Math.PI * 110 * t) +
          0.3 * Math.sin(2 * Math.PI * 220 * t + 0.4) +
          0.15 * Math.sin(2 * Math.PI * 330 * t + 1.1)) +
      (s / 2147483647 - 0.5) * 0.02;
  }
  return x;
}
const delayed = (x, d, g = 1) => {
  const y = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) y[i] = g * x[i - d];
  return y;
};

describe('dryLike', () => {
  test('the same signal is dry', () => {
    const x = pluck();
    const r = dryLike(x, x, SR);
    assert.equal(r.dry, true);
    assert.ok(Math.abs(r.lag) <= 8, `lag ${r.lag}`); // (it stops at the first lag past the threshold)
    assert.ok(r.corr >= HEALTH.dryCorr);
  });
  test('a delayed, scaled copy is dry, at its lag (and a quantum the other way too)', () => {
    const x = pluck();
    const r = dryLike(x, delayed(x, 300, 0.25), SR);
    assert.equal(r.dry, true);
    assert.ok(Math.abs(r.lag - 300) <= 8, `lag ${r.lag}`);
    const back = dryLike(delayed(x, 128), x, SR);
    assert.equal(back.dry, true);
    assert.ok(Math.abs(back.lag + 128) <= 8, `lag ${back.lag}`);
  });
  test('a polarity flip is still a copy', () => {
    const x = pluck(),
      y = x.map((v) => -0.5 * v);
    assert.equal(dryLike(x, y, SR).dry, true);
  });
  test('a distorted signal is not dry', () => {
    const x = pluck(),
      y = x.map((v) => Math.tanh(40 * v));
    const r = dryLike(x, y, SR);
    assert.equal(r.dry, false);
    assert.ok(r.corr < HEALTH.dryCorr);
  });
  test('silence on either side is never dry', () => {
    const x = pluck(),
      z = new Float32Array(x.length);
    assert.equal(dryLike(x, z, SR).dry, false);
    assert.equal(dryLike(z, x, SR).dry, false);
  });
  test('a copy later than 20 ms is out of reach', () => {
    const x = pluck();
    assert.equal(dryLike(x, delayed(x, Math.round(0.03 * SR)), SR).dry, false);
  });
});
