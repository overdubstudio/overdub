// The mock's fake world (design/mock/guitar-room/, docs/research/GUITAR-ROOM.md §5): the drummer's beats, the house
// stacks, what's in the shop, and a library of riffs from songs AJ might have. Nothing here makes a sound. The beats
// are real patterns from app/src/core/grooves/ (modernmetal.js, metal.js); the pedals and amps are the Guitar Studio's
// real devices (app/src/devices/guitar/), drawn with their real faces.

// a small seeded random, so the same library comes out every time
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h >>> 0;
};

/* ------------------------------------------------------------------------------------------------ the drummer */
// From simpler to busier; `heavy` marks the heavier ones. Rows: hat (or ride, crash, china), snare, kick, 16 steps.
export const BEATS = [
  { id: 'guide', short: 'Guide', name: 'Guide beat', note: 'quarters on the hat, kick on one and three', top: 'hat',
    hat: 'x...x...x...x...', snare: '....X.......X...', kick: 'x.......x.......' },
  { id: 'djentq', short: 'Djent', name: 'Djent unison, quarters on the hat', note: 'the kick follows a syncopated chug', top: 'hat',
    hat: 'x...x...x...x...', snare: '....X.......X...', kick: 'x.x..xx.x..x.x.x' },
  { id: 'gallop', short: 'Gallop', name: 'Double-kick gallop', note: 'ride on the eighths, the feet in gallops', top: 'ride',
    hat: 'x.x.x.x.x.x.x.x.', snare: '....X.......X...', kick: 'x.xxx.xxx.xxx.xx' },
  { id: 'open', short: 'Open chorus', name: 'Open chorus, crash riding', note: 'big and open, for a chorus', top: 'crash',
    hat: 'x.x.x.x.x.x.x.x.', snare: '....X.......X...', kick: 'x.x.x.x.x.x.x.x.' },
  { id: 'double', short: 'Double kick', name: 'Double kick', note: 'sixteenths under the hat', top: 'hat',
    hat: 'x.x.x.x.x.x.x.x.', snare: '....X.......X...', kick: 'xxxxxxxxxxxxxxxx' },
  { id: 'half', short: 'Half-time', name: 'Half-time China breakdown', note: 'heavier: the snare on three', top: 'china', heavy: true,
    hat: 'x...x...x...x...', snare: '........X.......', kick: 'X.xx.....xx.x...' },
];
export const beatById = (id) => BEATS.find((b) => b.id === id) || BEATS[0];

/* ------------------------------------------------------------------------------------------------ the stacks */
// A stack: an amp and the pedals around it, in signal order. `amp` is a device id; Half Stack (core.stack) is the room's
// own amp, the Guitar Studio's amps are amp.*. The house's are named for what they sound like.
export const HOUSE_STACKS = [
  { id: 'tight', name: 'Tight and modern', blurb: 'The club’s own: a gate, a boost, Half Stack on Modern', amp: 'core.stack', setting: 'Modern',
    chain: [{ device: 'pedal.gate', on: true }, { device: 'pedal.mantisboost', on: true }, { amp: true }] },
  { id: 'djent', name: 'Djent chug', blurb: 'Tighter, more mids, the gate harder', amp: 'core.stack', setting: 'Djent',
    chain: [{ device: 'pedal.clamshut', on: true }, { device: 'pedal.mantisboost', on: true }, { amp: true }, { device: 'pedal.coral', on: true }] },
  { id: 'scooped', name: 'Scooped and huge', blurb: 'Kraken with the mids carved out', amp: 'amp.recto',
    chain: [{ device: 'pedal.gate', on: true }, { device: 'pedal.drive', on: true }, { amp: true }, { device: 'pedal.coral', on: true }] },
  { id: 'thrash', name: 'Thrash bite', blurb: 'Half Stack on Thrash: fast picking that stays clear', amp: 'core.stack', setting: 'Thrash',
    chain: [{ device: 'pedal.gate', on: true }, { amp: true }] },
  { id: 'doom', name: 'Doom wall', blurb: 'Clownfish and a fuzz: loose, low and enormous', amp: 'amp.orange',
    chain: [{ device: 'pedal.kraken', on: true }, { amp: true }, { device: 'pedal.krakenhall', on: true }] },
  { id: 'british', name: 'British roar', blurb: 'Shell Shock pushed by a treble booster', amp: 'amp.plexi',
    chain: [{ device: 'pedal.gate', on: true }, { device: 'pedal.mantisboost', on: true }, { amp: true }] },
];
export const MINE_STACKS = [
  { id: 'mine-basement', name: 'Basement wall', blurb: 'Saved 3 Oct, from Cinder Block', amp: 'amp.metal', by: 'you',
    chain: [{ device: 'pedal.clamshut', on: true }, { device: 'pedal.hydra', on: true }, { amp: true }, { device: 'pedal.lobsterplate', on: false }] },
  { id: 'mine-lead', name: 'Lead, too much delay', blurb: 'Saved 14 Sep, from Salt Flats', amp: 'amp.lead', by: 'you',
    chain: [{ device: 'pedal.gate', on: true }, { amp: true }, { device: 'pedal.tapecrab', on: true }, { device: 'pedal.krakenhall', on: true }] },
];

/* ------------------------------------------------------------------------------------------------ the shop */
// The wall of amps, three shelves of seven: heads on top, combos in the middle, the big ones on the floor. `look` is
// the pixel sprite's palette (shop-pixels.js AMP_LOOKS).
export const WALL = [
  ['amp.metal', 'amp.recto', 'amp.slo', 'amp.friedman', 'amp.lead', 'amp.brown', 'amp.hiwatt'],
  ['amp.clean', 'amp.jangle', 'amp.crunch', 'amp.jc', 'amp.dumble', 'amp.tiny', 'amp.radio'],
  ['core.stack', 'amp.plexi', 'amp.punk', 'amp.orange', 'amp.bassman', 'amp.tape', 'amp.bit'],
];
// The counter of pedals, two rows, drives and dynamics first (a metal shop)
export const COUNTER = [
  ['pedal.gate', 'pedal.clamshut', 'pedal.mantisboost', 'pedal.barnacle', 'pedal.drive', 'pedal.hydra', 'pedal.moray', 'pedal.ratfish', 'pedal.clamocd', 'pedal.plexiprawn', 'pedal.fuzz', 'pedal.kraken', 'pedal.submariner', 'pedal.squish'],
  ['pedal.coral', 'pedal.mantismid', 'pedal.wah', 'pedal.whammerhead', 'pedal.octopus', 'pedal.submarine', 'pedal.lowtide', 'pedal.doubledory', 'pedal.jetray', 'pedal.chorus', 'pedal.tapecrab', 'pedal.delay', 'pedal.lobsterplate', 'pedal.krakenhall'],
];
// which side of the amp a pedal goes when it's put in the chain (drives and dynamics before it, the rest after)
export const BEFORE_AMP = /^(dynamics|drive|fuzz|filter|pitch)$/;

/* ------------------------------------------------------------------------------------------------ the riff library */
const SONGS = [
  ['Cinder Block', 'Drop C', 132, 'C minor'], ['Low Ceiling', 'Drop C', 118, 'C minor'], ['Night Shift', 'Drop D', 160, 'D minor'],
  ['Salt Flats', 'D standard', 96, 'D minor'], ['Glass Jaw', 'Drop C', 144, 'C minor'], ['The Long Way Down', 'Drop B', 104, 'B minor'],
  ['Pilot Light', 'E standard', 172, 'E minor'], ['Copper Pipe', 'Drop D', 138, 'D minor'], ['Static Bloom', 'C standard', 88, 'C minor'],
  ['Overpass', 'Drop C', 150, 'C minor'], ['Weight Room', 'Drop B', 126, 'B minor'], ['Tin Roof', 'E standard', 112, 'E minor'],
  ['Graveyard Shift', 'Drop A', 98, 'A minor'], ['Mile Marker', 'Drop D', 184, 'D minor'], ['Black Ice', 'Drop C', 140, 'C minor'],
  ['Hinge', 'D standard', 122, 'G minor'], ['Last Ferry', 'E standard', 90, 'E minor'], ['Rust Belt', 'Drop C', 136, 'C minor'],
  ['Slow Burn', 'Drop B', 76, 'B minor'], ['Breaker Box', 'Drop D', 166, 'D minor'], ['Low Tide Lights', 'C standard', 108, 'F minor'],
  ['Window Unit', 'Drop C', 128, 'Eb major'], ['Ten Below', 'Drop B', 152, 'B minor'],
];
const NAMED = ['the gallop one', 'chug in 7', 'verse idea', 'big open chord', 'palm-mute run', 'that bend', 'slow doom thing', 'tremolo part',
  'breakdown?', 'intro lick', 'octave riff', 'pinch harmonic bit', 'stop-start', 'the 3-over-4', 'chorus maybe', 'dive into the drop', 'outro feedback',
  'sludge in G', 'half-time thing', 'tapping run', 'riff for Kai', 'the good one', 'hammer-ons', 'clean arpeggio'];
const STACKS = ['Tight and modern', 'Tight and modern', 'Djent chug', 'Scooped and huge', 'Basement wall', 'Thrash bite', 'Doom wall', 'British roar', 'Lead, too much delay'];
const DAY = 86400000;
export const TODAY = new Date(2026, 9, 26, 15, 40);

export function makeLibrary(n = 166) {
  const r = rng(20261026), out = [];
  let t = TODAY.getTime() - 2 * DAY;
  const numbered = { n: 212 };
  for (let i = 0; i < n; i++) {
    // newer riffs first; the gaps between sessions grow as you go back (June to now)
    t -= r() < 0.7 ? Math.floor(r() * 50) * 60000 + 120000 : Math.floor(1 + r() * 4) * DAY + Math.floor(r() * 8) * 3600000;
    const untagged = r() < 0.24;
    const s = SONGS[Math.floor(Math.pow(r(), 1.35) * SONGS.length)];
    const tuning = untagged ? ['Drop C', 'Drop C', 'Drop D', 'E standard', 'Drop B', 'D standard'][Math.floor(r() * 6)] : s[1];
    const tempo = untagged ? 90 + Math.floor(r() * 18) * 5 : s[2];
    const bars = [1, 2, 2, 4, 4, 4, 4, 8, 8, 2][Math.floor(r() * 10)];
    const named = r() < 0.3;
    out.push({
      id: 'lib-' + i,
      name: named ? NAMED[Math.floor(r() * NAMED.length)] : `Riff ${numbered.n--}`,
      song: untagged ? null : s[0],
      tuning, tempo, key: untagged ? ['C minor', 'D minor', 'E minor', 'B minor'][Math.floor(r() * 4)] : s[3],
      keySure: r() < 0.7,
      bars, secs: (bars * 4 * 60) / tempo,
      stack: STACKS[Math.floor(r() * STACKS.length)],
      at: t,
      starred: r() < 0.12,
      by: r() < 0.06 ? 'claude' : 'you',
      style: ['chug', 'chug', 'gallop', 'open', 'lead', 'doom'][Math.floor(r() * 6)],
      seed: Math.floor(r() * 1e9),
    });
  }
  return out;
}
export const songsOf = (lib) => {
  const m = new Map();
  for (const x of lib) m.set(x.song || '', (m.get(x.song || '') || 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : b[1] - a[1] || a[0].localeCompare(b[0])));
};

export function when(ts) {
  const d = new Date(ts), now = TODAY, days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days <= 0) return `today ${hm}`;
  if (days === 1) return `yesterday ${hm}`;
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + hm;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------------------------------------------ fake audio shapes */
// A riff's level per column: palm-muted chugs on the sixteenths with accents, gallops, open chords that ring, a lead
// line, a doom chord. cols columns over `bars` bars. Deterministic from the seed.
export function riffShape(seed, bars, cols, style = 'chug') {
  const r = rng(seed), steps = bars * 16, hits = [];
  for (let s = 0; s < steps; s++) {
    const beat = s % 4 === 0, bar = s % 16 === 0;
    let p = 0, a = 0, len = 1;
    if (style === 'chug') { p = beat ? 0.95 : 0.55; a = bar ? 1 : beat ? 0.8 : 0.55; len = r() < 0.2 ? 3 : 1; }
    else if (style === 'gallop') { p = [1, 0, 1, 1][s % 4]; a = s % 4 === 0 ? 0.9 : 0.6; }
    else if (style === 'open') { p = s % 8 === 0 ? 1 : s % 8 === 6 ? 0.5 : 0.04; a = 1; len = 7; }
    else if (style === 'lead') { p = 0.6; a = 0.45 + r() * 0.4; len = 1 + Math.floor(r() * 3); }
    else { p = s % 16 === 0 ? 1 : s % 16 === 10 ? 0.6 : 0.02; a = 1; len = 12; }
    if (r() < p) hits.push([s, a * (0.82 + r() * 0.18), len]);
  }
  const out = new Float32Array(cols);
  for (const [s, a, len] of hits) {
    const c0 = Math.floor((s / steps) * cols), span = Math.max(1, Math.round((len / steps) * cols));
    for (let k = 0; k < span + 2 && c0 + k < cols; k++) {
      const v = a * Math.exp((-2.6 * k) / (span + 1));
      out[c0 + k] = Math.max(out[c0 + k], v);
    }
  }
  for (let i = 0; i < cols; i++) out[i] = Math.min(1, out[i] * (0.9 + r() * 0.1));
  return out;
}
