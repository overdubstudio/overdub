// The record line's words (input/qwerty.js snapWords): what the grid and Scale lock do to what the keys play, in every
// state, and what each part says a click does. Moved from tools/sketch-rec-test.js section 0.
import { test } from 'node:test';
import { T } from './_t.js';

const t = T;

test('snapWords: the line for each state, each part says what it does and what a click does', async () => {
  const qm = await import('../../app/src/input/qwerty.js');
  const sw = typeof qm.snapWords === 'function' ? qm.snapWords : null;
  const line = (o) => {
    if (!sw) return null;
    const w = sw(o);
    return `${w.grid.text}, ${w.key.text}${w.key.aside ? `, ${w.key.aside}` : ''}`;
  };
  const cm = { root: 'C', scale: 'minor' };
  const states = [
    [{ key: cm }, 'Snapping to 1/16, in C minor'],
    [{ key: cm, quantize: false }, 'Your timing, in C minor'],
    [{ key: cm, scaleLock: false }, 'Snapping to 1/16, every note'],
    [{ key: cm, quantize: false, scaleLock: false }, 'Your timing, every note'],
    [{ key: null }, 'Snapping to 1/16, in C major, no key set'],
    [{ key: null, scaleLock: false }, 'Snapping to 1/16, every note'],
    [{ key: cm, grid: 0.5 }, 'Snapping to 1/8, in C minor'],
    [{ key: cm, grid: 1 / 3 }, 'Snapping to 1/8T, in C minor'],
    [{ key: { root: 'Eb', scale: 'major' }, grid: 1 / 6 }, 'Snapping to 1/16T, in Eb major'],
  ];
  const got = states.map(([o]) => line(o));
  t.ok(
    states.every(([, want], i) => got[i] === want),
    `the line's words for each state: ${got.map((x) => `"${x}"`).join(', ')}`,
  );
  const w = sw?.({ key: cm }),
    off = sw?.({ key: cm, quantize: false, scaleLock: false }),
    tw = sw?.({ key: cm, touch: true }),
    nk = sw?.({ key: null });
  t.ok(
    !!w &&
      w.grid.on &&
      w.key.on &&
      !off.grid.on &&
      !off.key.on &&
      w.grid.title === 'On the grid: what you play lands on the 1/16 grid. Click to keep your own timing.' &&
      w.key.title === 'Scale lock: the keys play only C minor, so no note sounds wrong. Click to play every note.' &&
      /^Tap to keep/.test(tw.grid.title.split('. ').pop()) &&
      /no key, so the keys play C major/.test(nk.key.title),
    `each part says what it does and what a click does, "Tap" on a touch screen ("${w?.grid.title}" | "${w?.key.title}" | "${nk?.key.title}")`,
  );
});
