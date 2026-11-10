// Getting started's plan held to the stage and to the room's copy rules (docs/research/GUITAR-ROOM.md §2.1;
// ui/liveroom/guitar/start-plan.js), moved from tools/liveroom/checks-start.js, which keeps it in muted Chromium: every
// step and tour stop frames something on the stage and lights it; every word the slate, the tuner and the talkback say
// keeps the rules (tools/liveroom/checks-copy.js breaks). test/unit/guitar-start.test.js holds the plan's own logic.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { breaks } from '../../tools/liveroom/checks-copy.js';

const W_ = '../../app/src/ui/liveroom/guitar/';

test('the steps, the shots and the words', async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- Node */
  const plan = await import(W_ + 'start-plan.js');
  const { REGIONS, STAGE } = await import(W_ + 'layout.js');
  const m = await import(W_ + 'start.js');
  T.ok(typeof m.mount === 'function', "the start stream's module exports mount(R)");
  T.ok(
    plan.STEPS.map((s) => s.id).join() === 'plug,tune,time,sound,tour' &&
      plan.stepAfter('plug') === 'tune' &&
      plan.stepAfter('tour') === null,
    `Getting started's steps: ${plan.STEPS.map((s) => s.label).join(', ')}`,
  );
  const rect = (n) => (REGIONS[n] ? { ...REGIONS[n] } : null);
  const inStage = (r) => r.w > 0 && r.h > 0 && r.x < STAGE.w && r.y < STAGE.h && r.x + r.w > 0 && r.y + r.h > 0;
  const shots = [
    ...['plug', 'tune', 'time', 'sound'].map((s) => [s, plan.shotOf(s, { rect })]),
    ['plug close', plan.shotOf('plug', { rect, close: true })],
    ...plan.TOUR.map((s, i) => [`tour ${s.id}`, plan.shotOf('tour', { rect, tour: i })]),
  ];
  const badShot = shots.filter(([, s]) => !inStage(s.R) || !(s.at === 'strip' || (s.at.length && s.at.every(inStage))));
  T.ok(
    !badShot.length,
    `every step and tour stop frames something on the stage and lights it (${shots.length} shots)${badShot.length ? ': ' + badShot.map(([k]) => k).join(', ') : ''}`,
  );
  const words = plan.allWords();
  const LABEL = /^W\.(esc|plugOther|tunerHead|tunerTunings|tunerLook)$/;
  const broken = words
    .filter((w) => !LABEL.test(w.id))
    .flatMap((w) => breaks(w.id, w.text).map((b) => `${w.id}: ${b.rule} ${b.why} ("${w.text}")`));
  T.ok(
    !broken.length,
    `every word Getting started and the tuner say keeps the room's copy rules (${words.length} lines)${broken.length ? ': ' + broken.join('; ') : ''}`,
  );
  const tun = [
    plan.tunerSays({
      p: 36,
      note: 'C',
      octave: 2,
      live: true,
      shown: -13,
      inTune: false,
      string: { name: 'Low C', number: 6, cents: -13 },
    }),
    plan.tunerSays({
      p: 36,
      note: 'C',
      octave: 2,
      live: true,
      shown: 0,
      inTune: true,
      string: { name: 'Low C', number: 6, cents: 0 },
    }),
    plan.tunerSays({
      p: 40,
      note: 'E',
      octave: 2,
      live: true,
      shown: 2,
      inTune: false,
      string: { name: 'Low C', number: 6, cents: 402 },
    }),
  ];
  T.ok(
    tun[0] === 'Low C string (6): 13 cents flat.' &&
      tun[1] === 'Low C string (6) is in tune.' &&
      /tune down to C/.test(tun[2]),
    `the tuner's words: "${tun.join('" / "')}"`,
  );

  T.done();
});
