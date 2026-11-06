// The agent guide to the kernel platform (app/src/kernel/guide.js), in Node: it documents every dsp name and no others,
// embeds both verified examples verbatim, and docs/DEVICES.md carries both examples and, it says word for word, the
// guide. Moved from tools/kernel-test.js ("the reference kernels and the guide"); the checkDevice runs of the examples
// stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { T } from './_t.js';
import * as dsp from '../../app/src/kernel/dsp.js';
import * as guide from '../../app/src/kernel/guide.js';

test('the guide names every dsp function and only real ones, embeds both examples, and DEVICES.md carries them', () => {
  const text = guide.KERNEL_GUIDE;
  const api = dsp.DSP_API;
  const missing = api.filter((k) => !new RegExp(`\\b${k}\\b`).test(text));
  const used = [...text.matchAll(/dsp\.(\w+)/g)].map((m) => m[1]);
  const unknown = [...new Set(used.filter((k) => !api.includes(k)))];
  T.ok(
    !missing.length && !unknown.length,
    `the guide documents every dsp name and no others${missing.length ? ` (missing ${missing})` : ''}${unknown.length ? ` (unknown ${unknown})` : ''}`,
  );
  T.ok(
    text.includes(guide.GUIDE_EFFECT.kernel) && text.includes(guide.GUIDE_INSTRUMENT.kernel),
    `the guide embeds both verified examples verbatim (${text.split(/\s+/).length} words)`,
  );
  const md = fs.readFileSync(new URL('../../docs/DEVICES.md', import.meta.url), 'utf8');
  T.ok(
    md.includes(guide.GUIDE_EFFECT.kernel) && md.includes(guide.GUIDE_INSTRUMENT.kernel),
    'docs/DEVICES.md carries both examples',
  );
});
