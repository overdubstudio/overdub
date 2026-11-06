// The soundcheck's lamps and the count's sticks (docs/research/LIVE-ROOM-MODE.md §11.5), moved from
// tools/liveroom/checks-input.js, which keeps them in muted Chromium: the channel that moves (audioin pickChannel); the
// level's four verdicts on fakes peaking at −31, −11, −2 and 0 dBFS; the tunings a low string can be, in the order the
// room asks; the lean line; the count's sticks (seeded, measured against the click).
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { pickChannel } from '../../app/src/input/audioin.js';
import { levelVerdict, tuningsFor, tuningName, leanLine } from '../../app/src/ui/liveroom/lamps.js';
import { LINES } from '../../app/src/core/liveroom/lines/soundcheck.js';
import { sticksSamples, clickSamples, STICKS, CLICK } from '../../app/src/engine/click.js';
import { SR, riffDI } from '../../tools/liveroom/fake.js';

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const peakOf = (b) => {
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
  return p;
};
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const CHORD = {
  bpm: 120,
  beats: 4,
  chord: true,
  notes: [
    [0, 57, 1],
    [1, 57, 1],
    [2, 57, 1],
    [3, 57, 1],
  ],
};
const LEVELS = [
  [-31, 'quiet', 'Quiet'],
  [-11, 'ok', 'Loud and clear'],
  [-2, 'hot', 'Hot'],
  [0, 'clip', 'That clipped'],
];

test("the lamps' rules and the count's sticks", async () => {
  const T = checks();
  // the channel that moves
  const pc = [
    [[-200, -14], 2],
    [[-14, -80], 1],
    [[-20, -27], null],
    [[-60, -75], null],
    [[-80, -12, -40], 2],
    [[-80, -12, -20], null],
    [[-80, -12, -70, -90], 2],
    [[-14], 1],
  ];
  const got = pc.map(([l]) => pickChannel(l));
  T.ok(
    pc.every(([, w], i) => got[i] === w),
    `pickChannel: the channel 12 dB over every other and over −50 dBFS, else none (${got.join(' ')})`,
  );

  // the level's verdicts on the fakes the page plays
  const v = LEVELS.map(([pk]) => levelVerdict(db(peakOf(riffDI(CHORD, { passes: 1, peak: pk, tail: 0 }).buf))));
  T.ok(
    v.join() === LEVELS.map((x) => x[1]).join(),
    `level: fakes peaking at −31, −11, −2 and 0 dBFS are ${v.join(', ')}; under −50 is nothing (${levelVerdict(-60)})`,
  );
  const words = LEVELS.map(([pk, k]) => LINES[`level.${k}`].text({ db: pk, input: 2 }));
  T.ok(
    words.every((w, i) => w.startsWith(LEVELS[i][2])) && words[0].includes('−31 dB') && !words.join(' ').includes('!'),
    `and say so: ${words.map((w) => `“${w}”`).join(' ')}`,
  );

  // the tunings a low string can be, on a fretboard of the room's tuning ids (places.js), then on the fretboard's own
  const S = (low, iv) => {
    const s = [low];
    for (const d of iv) s.push(s[s.length - 1] + d);
    return s;
  };
  const STD = [5, 5, 5, 4, 5],
    DROP = [7, 5, 5, 4, 5];
  const FB = {
    standard: { name: 'Standard', strings: S(40, STD) },
    'drop-d': { name: 'Drop D', strings: S(38, DROP) },
    'half-down': { name: 'Half step down', strings: S(39, STD) },
    'd-standard': { name: 'D standard', strings: S(38, STD) },
    'drop-c': { name: 'Drop C', strings: S(36, DROP) },
    'c-standard': { name: 'C standard', strings: S(36, STD) },
    'b-standard': { name: 'B standard', strings: S(35, STD) },
    'drop-b': { name: 'Drop B', strings: S(35, DROP) },
    dadgad: { name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
    'open-g': { name: 'Open G', strings: [38, 43, 50, 55, 59, 62] },
  };
  const asks = [40, 38, 36, 35].map((m) =>
    tuningsFor(m, FB)
      .map((x) => x.name)
      .join(' | '),
  );
  T.ok(
    asks.join(' / ') === 'E standard / drop D | D standard / drop C | C standard / B standard | drop B',
    `the low string names the tuning: E2 ${asks[0]}; D2 ${asks[1]}; C2 ${asks[2]}; B1 ${asks[3]} (drop first from C up, standard first under it; DADGAD and open G aren't asked)`,
  );
  const which = LINES['tune.which'].text({ note: 'C', a: 'drop C', b: 'C standard' }),
    ok = LINES['tune.ok'].text({ name: tuningName({ id: 'standard', name: 'Standard', strings: S(40, STD) }) });
  T.ok(
    which === 'Low string C: drop C or C standard?' && ok === 'In tune: E standard.',
    `the lines: “${ok}” “${which}”`,
  );
  const here = [40, 38, 36, 35].map(
    (m) =>
      tuningsFor(m)
        .map((x) => x.name)
        .join(' | ') || '-',
  );
  T.ok(
    JSON.stringify(here) === JSON.stringify(asks.join(' / ').split(' / ')),
    `the fretboard's own tunings ask the same: E2 ${here[0]}; D2 ${here[1]}; C2 ${here[2]}; B1 ${here[3]}`,
  );
  const off = LINES['tune.off'].text({ cents: 20, flat: true });
  T.ok(/about 20 cents flat/.test(off), `a guitar off the band's tuning: “${off}”`);

  // the lean line (§8): both of the last two takes the same way, over 12 ms, within 6 ms of each other, and no line-up yet
  const L = [
    leanLine({ leans: [18, 21] }),
    leanLine({ leans: [18, 21], measured: true }),
    leanLine({ leans: [18, -21] }),
    leanLine({ leans: [10, 14] }),
    leanLine({ leans: [14, 24] }),
    leanLine({ leans: [-16, -19] }),
  ];
  T.ok(
    L[0]?.id === 'line.lean' &&
      L[0].vars.ms === 20 &&
      L[0].vars.late === true &&
      !L[1] &&
      !L[2] &&
      !L[3] &&
      !L[4] &&
      L[5]?.vars.late === false,
    `the lean: 18 and 21 ms late says “${LINES['line.lean'].text(L[0]?.vars || {})}”; measured, split, small or far apart says nothing; −16 and −19 is ahead`,
  );

  // the count's sticks: seeded (two makes are the same), peaks as asked, brighter than the click
  const a = sticksSamples(SR, false),
    b = sticksSamples(SR, false),
    acc = sticksSamples(SR, true);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  const hi = (x) => {
    let y1 = 0,
      x1 = 0,
      p = 0;
    const c = Math.exp((-2 * Math.PI * 4000) / SR);
    for (let i = 0; i < x.length; i++) {
      const y = c * (y1 + x[i] - x1);
      x1 = x[i];
      y1 = y;
      p = Math.max(p, Math.abs(y));
    }
    return p;
  };
  const pk = [db(peakOf(a)), db(peakOf(acc))],
    br = [db(hi(a)) - db(hi(clickSamples(SR, false))), db(hi(acc)) - db(hi(clickSamples(SR, true)))];
  T.ok(
    same &&
      Math.abs(pk[0] - db(STICKS.beat)) < 0.05 &&
      Math.abs(pk[1] - db(STICKS.bar)) < 0.05 &&
      br[0] > 0 &&
      br[1] > 0 &&
      a.length <= Math.ceil((STICKS.ms / 1000) * SR) + 1,
    `sticks: the same samples every time (${same}), the beat peaking at ${fmt(pk[0], 2)} dBFS and the bar at ${fmt(pk[1], 2)} (asked ${fmt(db(STICKS.beat), 2)} and ${fmt(db(STICKS.bar), 2)}), ${fmt(br[0])} and ${fmt(br[1])} dB more over 4 kHz than the click (${CLICK.f} Hz) so they cut through a kit, ${a.length} samples`,
  );

  T.done();
});
