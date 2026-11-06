// The beginner's tour speaks plainly, read as source (moved from tools/onboard-test.js, which has the tour with real
// clicks and keys).
import { test } from 'node:test';
import fs from 'node:fs';
import { checks } from './helpers/check.js';

test('no tour headline is jargon', () => {
  const T = checks();
  const src = fs.readFileSync(new URL('../../app/src/ui/onboard.js', import.meta.url), 'utf8');
  const copy = {
    now: /title\('Now the overdub\.'\)/.test(src),
    thats: /title\('That’s an overdub\.'\)/.test(src),
    pick: /title\('Pick a take\.'\)/.test(src),
    capture: /Capture is always on/.test(src),
  };
  T.ok(
    !copy.now && !copy.thats && !copy.pick && !copy.capture,
    `no tour headline is jargon ("Now the overdub.", "That’s an overdub.", "Pick a take.") and no "Capture is always on" (${JSON.stringify(copy)})`,
  );
  T.done();
});
