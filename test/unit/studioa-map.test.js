// Studio A (core.drumroom): the definition and the note map. Every note of NOTE_MAP is a piece and an articulation the
// kit has, every articulation has a note; the names in core/music.js (DRUM_MAP, DRUM_NAMES) cover it, and the names that
// were there keep their numbers (and formatGrid its names); every param has a role, a desc and its piece's prefix.
// Moved from tools/studioa-test.js ('the map').
import { test } from 'node:test';
import { INSTRUMENTS } from '../../app/src/devices/builtin/index.js';
import { DRUM_MAP, DRUM_NAMES, formatGrid, parseGrid } from '../../app/src/core/music.js';
import kit, { NOTE_MAP, PIECES, ARTS, KITS } from '../../app/src/devices/builtin/drumroom.js';
import { T } from './_t.js';

const t = T;
const ID = 'core.drumroom';

test('the definition and the note map', () => {
  t.ok(
    INSTRUMENTS.includes(kit) && kit.id === ID && kit.cat === 'drums' && kit.kind === 'instrument',
    `${ID} (${kit.name}) is a built-in instrument on the drums shelf`,
  );
  const ROLES = [
    'tone',
    'level',
    'drive',
    'mix',
    'time',
    'feedback',
    'rate',
    'depth',
    'size',
    'decay',
    'attack',
    'release',
    'pitch',
    'shape',
    'width',
    'gate',
    'sens',
  ];
  const bad = kit.params.filter((p) => !ROLES.includes(p.role) || !(p.desc && p.desc.length >= 20) || !p.group);
  t.ok(
    !bad.length,
    `all ${kit.params.length} params have a role, a desc an agent can act on and a group${bad.length ? ': not ' + bad.map((p) => p.key).join(', ') : ''}`,
  );
  const pieceKeys = kit.params.filter((p) => PIECES.includes(p.group));
  t.ok(
    pieceKeys.length >= 30 && pieceKeys.every((p) => p.key.startsWith(p.group + '_')),
    `the ${pieceKeys.length} per-piece params are keyed by their piece (kick_*, snare_*, hat_*, tom1_* ...)`,
  );
  for (const k of ['mix_close', 'mix_oh', 'mix_room', 'mix_crush', 'bleed', 'room_size'])
    t.ok(
      kit.params.some((p) => p.key === k),
      `the mic mix has ${k}`,
    );
  for (const piece of [
    'kick',
    'snare',
    'hat',
    'tom1',
    'tom2',
    'tom3',
    'tom4',
    'ride',
    'crash1',
    'crash2',
    'china',
    'splash',
  ]) {
    t.ok(
      ['tune', 'decay', 'level'].every((s) => kit.params.some((p) => p.key === `${piece}_${s}`)),
      `${piece}: tune, decay and level`,
    );
  }
  const kitOpt = kit.params.find((p) => p.key === 'kit');
  t.ok(kitOpt.opts.join() === KITS.join() && KITS.length === 5, `KIT offers ${KITS.join(', ')}`);
  t.ok(
    kit.presets.length >= 8 && KITS.every((_, k) => kit.presets.some((pr) => pr.params.kit === k)),
    `${kit.presets.length} presets, one for every kit and a few mixes (${kit.presets.map((p) => p.name).join(', ')})`,
  );
  const notes = NOTE_MAP.map((r) => r[0]);
  t.ok(
    new Set(notes).size === notes.length && notes.every((p) => p >= 0 && p <= 127),
    `${notes.length} notes in the map, each once`,
  );
  const wrong = NOTE_MAP.filter(([, piece, art]) => !PIECES.includes(piece) || !ARTS[piece].includes(art));
  t.ok(
    !wrong.length,
    `every note plays a piece and an articulation the kit has${wrong.length ? ': not ' + wrong.map((r) => r[0]).join(', ') : ''}`,
  );
  const missing = PIECES.flatMap((piece) =>
    ARTS[piece].filter((art) => !NOTE_MAP.some((r) => r[1] === piece && r[2] === art)).map((art) => piece + ' ' + art),
  );
  t.ok(!missing.length, `every articulation has a note${missing.length ? ': not ' + missing.join(', ') : ''}`);
  const GM = {
    35: 'kick',
    36: 'kick',
    37: 'snare',
    38: 'snare',
    39: 'clap',
    40: 'snare',
    41: 'tom4',
    42: 'hat',
    43: 'tom4',
    44: 'hat',
    45: 'tom3',
    46: 'hat',
    47: 'tom2',
    48: 'tom1',
    49: 'crash1',
    50: 'tom1',
    51: 'ride',
    52: 'china',
    53: 'ride',
    54: 'tamb',
    55: 'splash',
    56: 'cowbell',
    57: 'crash2',
    59: 'ride',
    69: 'shaker',
    70: 'shaker',
  };
  const gmOff = Object.entries(GM).filter(([p, piece]) => NOTE_MAP.find((r) => r[0] === +p)?.[1] !== piece);
  t.ok(
    !gmOff.length,
    `General MIDI notes play what GM names (35-59, and the tambourine, cowbell, cabasa and maracas)${gmOff.length ? ': not ' + gmOff.map((g) => g[0]).join(', ') : ''}`,
  );
  const unnamed = notes.filter((p) => !DRUM_NAMES[p]);
  t.ok(
    !unnamed.length,
    `DRUM_NAMES labels every note of the map${unnamed.length ? ' (not ' + unnamed.join(', ') + ')' : ''}`,
  );
  const strays = Object.entries(DRUM_MAP).filter(([, p]) => !notes.includes(p));
  t.ok(
    !strays.length,
    `every DRUM_MAP name is a note Studio A plays${strays.length ? ' (not ' + strays.map((s) => s.join('=')).join(', ') + ')' : ''}`,
  );
  const beyond = NOTE_MAP.filter((r) => r[0] < 35 || r[0] > 81).filter((r) => r[0] !== 82);
  const named = beyond.filter((r) => Object.values(DRUM_MAP).includes(r[0]));
  t.ok(
    named.length === beyond.length,
    `the ${beyond.length} articulations beyond GM have DRUM_MAP names (${beyond
      .map(
        (r) =>
          Object.keys(DRUM_MAP)
            .filter((k) => DRUM_MAP[k] === r[0])
            .pop() +
          '=' +
          r[0],
      )
      .join(' ')})`,
  );
  // additive only: the names that were there keep their numbers, and grids print the same names
  const OLD = {
    kick: 36,
    bd: 36,
    rim: 37,
    side: 37,
    snare: 38,
    sd: 38,
    clap: 39,
    cp: 39,
    hat: 42,
    hh: 42,
    ch: 42,
    closed: 42,
    pedal: 44,
    ph: 44,
    open: 46,
    oh: 46,
    tom1: 50,
    hitom: 50,
    tom2: 47,
    midtom: 47,
    tom3: 45,
    lotom: 45,
    floor: 43,
    crash: 49,
    cy: 49,
    ride: 51,
    rd: 51,
    bell: 53,
    cowbell: 56,
    cb: 56,
    shaker: 70,
    sh: 70,
    tamb: 54,
  };
  const moved = Object.entries(OLD).filter(([k, p]) => DRUM_MAP[k] !== p);
  t.ok(
    !moved.length,
    `the ${Object.keys(OLD).length} names that were there keep their numbers${moved.length ? ' (moved: ' + moved.map((m) => m[0]).join(', ') + ')' : ''}`,
  );
  const OLD_NAMES = {
    36: 'Kick',
    37: 'Rim',
    38: 'Snare',
    39: 'Clap',
    42: 'Hat',
    44: 'Pedal hat',
    46: 'Open hat',
    43: 'Floor tom',
    45: 'Low tom',
    47: 'Mid tom',
    50: 'High tom',
    49: 'Crash',
    51: 'Ride',
    53: 'Bell',
    54: 'Tamb',
    56: 'Cowbell',
    70: 'Shaker',
  };
  t.ok(
    Object.entries(OLD_NAMES).every(([p, n]) => DRUM_NAMES[p] === n),
    'DRUM_NAMES keeps every label it had',
  );
  const grid = formatGrid(Object.values(OLD).map((p, i) => ({ p, t: (i % 16) * 0.25, d: 0.25, v: 0.8 })));
  const WAS = [
    'kick',
    'side',
    'snare',
    'clap',
    'hat',
    'pedal',
    'open',
    'hitom',
    'midtom',
    'lotom',
    'floor',
    'crash',
    'ride',
    'bell',
    'cowbell',
    'shaker',
    'tamb',
  ];
  t.ok(
    Object.keys(grid.rows).sort().join() === WAS.sort().join(),
    `formatGrid names the old notes as before (${Object.keys(grid.rows).join(' ')})`,
  );
  const back = parseGrid({
    steps: 4,
    rows: { rimshot: 'x...', half: '.x..', flam: '..x.', rideedge: '...x', tom4: 'x...' },
  })
    .map((n) => n.p)
    .join();
  t.ok(back === '40,24,31,59,43', `grids take the new names (rimshot half flam rideedge tom4 -> ${back})`);
});
