// The press counts (docs/research/LIVE-ROOM-MODE.md §11.4), moved from tools/liveroom/checks-stage.js, which keeps the
// metal club's first session in muted Chromium: 12 at the metal club, 10 at the basement, 9 at the blues bar on
// core/liveroom/session.js's reducer, the offered move after each kind of step, and the stop rule at every place.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { press as pressRoom, offered, stopBeat } from '../../app/src/core/liveroom/session.js';

const json = (x) => JSON.stringify(x);
const SPACE = (n) => Array.from({ length: n }, () => 'space');
const walk = (ids) => ids.reduce((s, id) => pressRoom(s, id), {});

test('the press counts, the stop and the offered move', async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- §11.4, in Node */
  {
    const m = walk(['door:metal', 'allow', 'tune', ...SPACE(8), 'send']);
    T.ok(
      m.presses === 12 &&
        m.sent &&
        json(m.offered) === json(['count', 'take', 'other', 'next', 'take', 'other', 'layout', 'hear']),
      `the metal club in 12 presses: door, Allow, tune, then Space for ${m.offered.join(', ')}, and send (${m.presses})`,
    );
    const b = walk(['door:basement', 'allow', ...SPACE(7), 'send']);
    T.ok(
      b.presses === 10 &&
        b.sent &&
        json(b.offered) === json(['count', 'take', 'next', 'take', 'other', 'layout', 'hear']),
      `the basement in 10: the chorus doubled once offered (${b.offered.join(', ')}; ${b.presses})`,
    );
    const u = walk(['door:bluesbar', 'allow', ...SPACE(6), 'send']);
    T.ok(
      u.presses === 9 && u.sent && json(u.offered) === json(['count', 'take', 'next', 'take', 'layout', 'hear']),
      `the blues bar in 9: a head and a solo, no double (${u.offered.join(', ')}; ${u.presses})`,
    );
    const n = walk(['door:metal', 'allow', ...SPACE(6), 'notyet', 'space']);
    T.ok(
      n.offered.at(-1) === 'next',
      `Not yet: Lay it out isn't offered again in that song, and Space is Next part (${n.offered.at(-1)})`,
    );
    // the stop rule at every place, and the blues bar's chorus rule
    const at = (place, beat, from) => stopBeat({ place, meter: [4, 4] }, beat, { from });
    const stops = [
      ['metal', 32.5, 0, 32],
      ['metal', 34, 0, 36],
      ['basement', 32.9, 0, 32],
      ['basement', 33.5, 0, 36],
      ['bluesbar', 49, 0, 48],
      ['bluesbar', 57, 0, 96],
      ['metal', 1, 0, 4],
    ];
    const bad = stops.filter(([p, b, f, want]) => at(p, b, f) !== want);
    T.ok(
      !bad.length,
      `the stop: in a bar's first beat the line just gone, later the next; at the blues bar whole choruses; never before the first bar is whole${bad.length ? ': wrong at ' + json(bad) : ''}`,
    );
    T.ok(
      offered({ place: 'metal', cards: [], parts: [] }, 'take')?.id === 'take' &&
        offered({ place: 'metal', cards: [], parts: [] }, 'play')?.id === 'stop' &&
        offered({ place: null }, 'idle') === null,
      'the offered move: during a pass That’s a take, during playback Stop, and nothing on the door',
    );
    // two left takes within the pair rule: Use take 1 as the right side, before the other side
    const two = {
      place: 'metal',
      cards: [{ id: 's1', name: 'Chorus', takes: { L: ['a', 'b'], R: [], lead: [] }, part: {} }],
      parts: [{ id: 's1', name: 'Chorus', takes: { L: ['a', 'b'], R: [], lead: [] }, part: {} }],
    };
    const u2 = offered(two, { run: 'idle', last: 's1', use2: { card: 's1', take: 1 } });
    T.ok(
      u2?.id === 'use2' &&
        u2.label === 'Use take 1 as the right side' &&
        offered(two, { run: 'idle', last: 's1' })?.id === 'other',
      `two left takes within the pair rule offer "${u2?.label}" ahead of the other side`,
    );
  }

  T.done();
});
