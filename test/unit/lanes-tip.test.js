// The value tip of an automation lane (fmtValue in ui/lanes.js), moved intact from tools/lanes-test.js: an LFO's rate and a
// fast attack under 10 Hz / 10 ms keep their decimals. The lanes under real pointer and key events stay there.
import { test } from 'node:test';
import { checks } from './helpers/check.js';

test('the tip reads sub-unit rates and times', async () => {
  const T = checks();
  const { fmtValue } = await import('../../app/src/ui/lanes.js');
  const rate = { unit: 'Hz', min: 0.5, max: 9, step: 0 },
    att = { unit: 'ms', min: 0.1, max: 100, step: 0 },
    lfo = { unit: 'Hz', min: 0.02, max: 20, step: 0 };
  const got = [
    fmtValue(rate, 0.5),
    fmtValue(rate, 1.4),
    fmtValue(att, 0.4),
    fmtValue(lfo, 0.02),
    fmtValue(att, 12),
    fmtValue({ unit: 'Hz', min: 20, max: 20000 }, 440),
    fmtValue({ unit: 'ms', min: 0, max: 2000, step: 1 }, 5),
  ];
  T.ok(
    got.join('|') === '0.50 Hz|1.4 Hz|0.40 ms|0.02 Hz|12 ms|440 Hz|5 ms',
    `the tip reads sub-unit rates and times (${got.join(', ')}; they were 1 Hz, 1 Hz, 0 ms, 0 Hz)`,
  );
  T.done();
});
