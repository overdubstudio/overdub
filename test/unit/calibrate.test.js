// input/calibrate.js and latency.js's judgeTaps: strum on eight clicks, the round trip judged, said, kept or tried
// again. The clicks are sound: a fake latency stands in for the page's (measure calls onStep as the real one does).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTaps } from '../../app/src/input/latency.js';
import { createCalibration, calibrationLine, fmtMs } from '../../app/src/input/calibrate.js';

const W = [10, 12]; // the count's two (not used)

describe('judgeTaps', () => {
  test('tight strums: good, the median, sure', () => {
    const j = judgeTaps([...W, 14, 16, 13, 15, 17, 14]);
    assert.equal(j.grade, 'good');
    assert.equal(j.ms, 14.5);
    assert.equal(j.spread, 4);
    assert.equal(j.used, 6);
    assert.ok(j.confidence >= 0.95, String(j.confidence));
    assert.ok(j.ok);
  });
  test('one wild strum is left out', () => {
    const j = judgeTaps([...W, 14, 16, 13, 60, 15, 14]);
    assert.equal(j.dropped, 60);
    assert.equal(j.used, 5);
    assert.equal(j.grade, 'good');
    assert.equal(j.ms, 14);
  });
  test('loose, looser, too few, ahead', () => {
    assert.equal(judgeTaps([...W, 10, 22, 14, 18, 12, 25]).grade, 'fair');
    assert.equal(judgeTaps([...W, 10, 40, 14, 30, 22, 36]).grade, 'poor');
    assert.equal(judgeTaps([...W, 10, 80, 14, 90, 22, 60]).grade, 'none');
    const few = judgeTaps([...W, 14, null, 15, null, null, 16]);
    assert.equal(few.grade, 'none');
    assert.equal(few.used, 3);
    assert.equal(few.confidence, 0);
    assert.ok(judgeTaps([...W, -8, -6, -9, -7, -8, -6]).ahead);
    const fair = judgeTaps([...W, 10, 22, 14, 18, 12, 25]),
      poor = judgeTaps([...W, 10, 40, 14, 30, 22, 36]);
    assert.ok(fair.confidence < 0.9 && poor.confidence < fair.confidence);
  });
});

// a page's latency without a page: measure plays nothing, calls onStep for each click and each strum, then resolves
function fakeLatency(hits, { fail = false } = {}) {
  const fns = new Set();
  let kept = null;
  return {
    kept: () => kept,
    measured: null,
    estimate: () => 0.023,
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    set(ms, info) {
      kept = { ms, ...info };
      this.measured = {
        ms,
        at: 0,
        how: info.how,
        spread: info.spread,
        confidence: info.confidence,
        label: info.label || '',
      };
      for (const f of fns) f(this.measured);
      return true;
    },
    clear() {
      kept = null;
      this.measured = null;
      for (const f of fns) f(null);
    },
    async measure({ onStep, sig }) {
      if (fail) throw new Error('This browser can’t capture audio (no AudioWorklet).');
      for (let i = 0; i < hits.length; i++) {
        if (sig.stop) return null;
        onStep({ i, click: true });
        await null;
        onStep({ i, ms: hits[i] });
      }
      return { how: 'tap', hits, ...judgeTaps(hits) };
    },
  };
}

describe('the calibration', () => {
  test('a good one is kept by itself, with its confidence, and said', async () => {
    const lat = fakeLatency([...W, 14, 16, 13, 15, 17, 14]);
    const cal = createCalibration({ latency: lat, label: 'Scarlett Solo USB' });
    const steps = [];
    cal.on((s) => steps.push(s.phase === 'listening' ? cal.line() : s.phase));
    const r = await cal.start();
    assert.equal(r.grade, 'good');
    assert.equal(lat.kept().ms, 14.5);
    assert.equal(lat.kept().how, 'tap');
    assert.ok(lat.kept().confidence >= 0.95);
    assert.ok(cal.state.kept);
    assert.equal(
      cal.line(),
      'Round trip 14.5 ms. Your strums were within 4.0 ms of each other: a good one. Kept for Scarlett Solo USB.',
    );
    assert.ok(steps.some((x) => /^Mute the strings/.test(x)));
    assert.ok(steps.some((x) => /^Strum 3 of 6\. The last was 16\.0 ms after the click\.$/.test(x)));
  });
  test('a fair one waits for Keep; a poor one asks for another go', async () => {
    const lat = fakeLatency([...W, 10, 22, 14, 18, 12, 25]);
    const cal = createCalibration({ latency: lat });
    await cal.start();
    assert.equal(lat.kept(), null);
    assert.match(cal.line(), /a little loose\. Keep it, or go again\.$/);
    assert.ok(cal.keep());
    assert.equal(lat.kept().ms, 16);
    assert.match(cal.line(), /Kept\.$/);
    const poor = createCalibration({ latency: fakeLatency([...W, 10, 40, 14, 30, 22, 36]) });
    await poor.start();
    assert.match(poor.line(), /Go again: mute the strings and strum right on the click\.$/);
  });
  test('too few heard can’t be kept; again runs it again', async () => {
    const cal = createCalibration({ latency: fakeLatency([...W, 14, null, 15, null, null, 16]) });
    await cal.start();
    assert.equal(cal.line(), 'Heard 3 of 6 strums. Strum harder, or turn the guitar up, and go again.');
    assert.equal(cal.keep(), false);
    const r = await cal.again();
    assert.equal(r.used, 3);
  });
  test('stop, an error, what it says before anything, and forget', async () => {
    const lat = fakeLatency([...W, 14, 16, 13, 15, 17, 14]);
    const cal = createCalibration({ latency: lat });
    assert.equal(
      cal.line(),
      'Not measured yet: the browser guesses 23 ms, often wrong on a real interface. Eight clicks, about 30 seconds, once per interface.',
    );
    const p = cal.start();
    cal.stop();
    assert.equal(await p, null);
    assert.equal(cal.state.phase, 'stopped');
    assert.equal(lat.kept(), null);
    const bad = createCalibration({ latency: fakeLatency([], { fail: true }) });
    await bad.start();
    assert.equal(bad.state.phase, 'error');
    assert.match(bad.line(), /AudioWorklet/);
    await cal.start();
    assert.match(calibrationLine({ phase: 'idle', measured: lat.measured }), /^Round trip 14\.5 ms, measured/);
    cal.forget();
    assert.equal(lat.measured, null);
    assert.equal(fmtMs(140.4), '140');
    assert.equal(fmtMs(9), '9.0');
  });
});
