// ui/lanes.js in Node: stepIndex (an arrow key walks past a jump), and a gain lane above the drawn top (moveValue,
// nudgeValue, shapeLane). Moved intact from tools/lanes-test.js; the lanes under real pointer and key events stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('stepIndex: an arrow walks past a jump, and stays on the last point', async () => {
  const { stepIndex } = await import('../../app/src/ui/lanes.js');
  const pts = [
    { t: 0, v: -20 },
    { t: 4, v: -20 },
    { t: 4, v: 0 },
    { t: 8, v: 0 },
  ];
  let sel = { from: 0, to: 0 };
  const walk = [];
  for (let k = 0; k < 4; k++) {
    const i = stepIndex(pts, sel, 1);
    sel = { from: pts[i].t, to: pts[i].t };
    walk.push(pts[i].t);
  }
  const back = [];
  for (let k = 0; k < 3; k++) {
    const i = stepIndex(pts, sel, -1);
    sel = { from: pts[i].t, to: pts[i].t };
    back.push(pts[i].t);
  }
  assert.ok(
    walk.join() === '4,8,8,8' && back.join() === '4,0,0',
    `→ walks past a jump (beats ${walk.join(', ')}), ← walks back over it (${back.join(', ')})`,
  );
  assert.ok(
    stepIndex(pts, { from: 6, to: 9 }, 1) === 3 &&
      stepIndex(pts, { from: 2, to: 5 }, 1) === 3 &&
      stepIndex(pts, { from: 2, to: 5 }, -1) === 1,
    '→ from a range with no point after it stays on the last point (not back to the first); ← from a range picks its first point',
  );
});

test('a gain lane above the drawn top keeps its value (moveValue, nudgeValue, shapeLane)', async () => {
  const { moveValue, nudgeValue, shapeLane } = await import('../../app/src/ui/lanes.js');
  const { MIXER, normPoints, formatPoints, paramSpec, discrete } = await import('../../app/src/core/automation.js');
  const G = MIXER.gain;
  const up = nudgeValue(G, 12, 1),
    dn = nudgeValue(G, 12, -1),
    dnBig = nudgeValue(G, 12, -1, true);
  assert.ok(
    moveValue(G, 12, 0) === 12 &&
      up === 12 &&
      dn < 12 &&
      dn > 11 &&
      dnBig < dn &&
      dnBig > 6 &&
      moveValue(G, 24, 0.2) === 24 &&
      moveValue(G, 0, 0.5) === 6,
    `a +12 dB gain point: sideways stays +12, ↑ stays +12 (the top is its own), ↓ ${dn.toFixed(2)}, Shift+↓ ${dnBig.toFixed(2)} (was +6 for all three); a 0 dB point still stops at +6`,
  );
  const h12 = normPoints(
    [
      { t: 0, v: 12 },
      { t: 16, v: 12 },
    ],
    G,
  );
  const sh = (n) => shapeLane(n, h12, G, 4, 8, 0);
  const vals = (pts) => pts.filter((x) => x.t >= 4 && x.t <= 8);
  const is12 = (x) => Math.abs(x.v - 12) < 1e-6;
  assert.ok(
    vals(sh('swell')).every(is12) &&
      vals(sh('hold')).every(is12) &&
      vals(sh('dip')).every((x) => x.v <= 12 + 1e-6) &&
      vals(sh('dip')).some((x) => x.v < 6) &&
      sh('dip')
        .filter((x) => x.t === 4 || x.t === 8)
        .every(is12),
    `shapes on a +12 dB hold join it at +12: Swell ${formatPoints(vals(sh('swell')))}, Hold ${formatPoints(vals(sh('hold')))}, Dip ${formatPoints(vals(sh('dip')))} (Swell was a 6 dB cut)`,
  );
  const ru = vals(sh('ramp-up'));
  assert.ok(
    is12(ru[ru.length - 1]) && ru.every((x) => x.v <= 12 + 1e-6 && x.v > -6),
    `Ramp up on a +12 hold rises to +12 (${formatPoints(ru)}; it fell to -12)`,
  );
  const l2 = normPoints(
    [
      { t: 0, v: -6 },
      { t: 8, v: 12 },
      { t: 16, v: 12 },
      { t: 24, v: -6 },
    ],
    G,
  );
  const sw2 = shapeLane('swell', l2, G, 10, 14, 0).filter((x) => x.t >= 8 && x.t <= 16);
  assert.ok(sw2.every(is12), `a Swell inside a +12 stretch leaves it at +12 (${formatPoints(sw2)})`);
  // ↑/↓ on a switch or a few-setting param: at least one setting a press (a 2-way switch never moved)
  const sw = paramSpec({ key: 'mode', opts: ['A', 'B'] }),
    five = paramSpec({ key: 'reg', opts: ['1', '2', '3', '4', '5'] }),
    div = paramSpec({ key: 'div', min: 0, max: 40, step: 1 });
  const moves = [
    nudgeValue(sw, 0, 1),
    nudgeValue(sw, 0, 1, true),
    nudgeValue(sw, 1, -1),
    nudgeValue(sw, 1, 1),
    nudgeValue(five, 2, 1),
    nudgeValue(five, 2, -1, true),
    nudgeValue(div, 10, 1),
  ];
  assert.ok(
    moves.join() === '1,1,0,1,3,1,11' && discrete(sw),
    `↑/↓ move a switch or a stepped param a setting at a time (${moves.join(', ')}); the top stays the top`,
  );
  const cut = paramSpec({ key: 'cut', min: 20, max: 20000, curve: 'log', unit: 'Hz', step: 1 });
  assert.ok(
    nudgeValue(cut, 1000, 1) > 1050 && nudgeValue(cut, 1000, 1) < 1100,
    `a knob still moves a hundredth of its travel (${nudgeValue(cut, 1000, 1).toFixed(0)} Hz from 1000)`,
  );
});
