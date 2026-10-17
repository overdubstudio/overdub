// Find's rows (app/src/ui/workspace.js pickRows): the same query over the same devices gives the same rows, whatever
// order the devices registered in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRows } from '../../app/src/ui/workspace.js';

const sound = (id, title, aliases = []) => ({ kind: 'sound', id: 'sound:' + id, title, purpose: '', aliases });
// the reverbs as the studio has them: a search for "reverb" matches more than the six Sound rows Find shows
const SOUNDS = [
  sound('core.verb', 'Stairwell', ['reverb', 'effect']),
  sound('core.rooms', 'Echo Chamber', ['reverb', 'effect', 'measured rooms: a church, a hall, a stairwell']),
  sound('pedal.verb', 'Reverb'),
  sound('claude.skylight', 'Skylight', ['reverb pedal']),
  sound('pedal.springsquid', 'Spring Squid', ['reverb pedal']),
  sound('pedal.lobsterplate', 'Lobster Plate', ['reverb pedal']),
  sound('pedal.krakenhall', 'Kraken Hall', ['reverb pedal']),
  sound('pedal.halojelly', 'Halo Jelly', ['reverb pedal']),
  sound('core.flute:Hall', 'Hall', ['Flute']),
];
const GO = [{ kind: 'go', id: 'go:mixer', title: 'Mixer', purpose: 'levels and reverb sends', aliases: [] }];

// a seeded shuffle (mulberry32), so the test is the same every run
function shuffled(a, seed) {
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const ids = (rows) => rows.map((r) => r.id);

test('the same rows whatever order the devices registered in', () => {
  for (const q of ['reverb', 'hall', 'room', 'plate', 'r']) {
    const want = ids(pickRows([...GO, ...SOUNDS], q));
    for (let seed = 1; seed <= 200; seed++)
      assert.deepEqual(ids(pickRows([...GO, ...shuffled(SOUNDS, seed)], q)), want, `"${q}", seed ${seed}`);
  }
});

test('"reverb": six Sound rows, the best matches first, and Echo Chamber among them', () => {
  const rows = pickRows([...GO, ...SOUNDS], 'reverb').filter((r) => r.kind === 'sound');
  assert.equal(rows.length, 6);
  assert.equal(rows[0].id, 'sound:pedal.verb'); // the title is the word
  assert.ok(ids(rows).includes('sound:core.rooms') && ids(rows).includes('sound:core.verb'));
});

test('a better match still wins over id order, and Go to stays ahead of Sound', () => {
  const rows = pickRows([...shuffled(SOUNDS, 7), ...GO], 'hall');
  assert.equal(rows[0].id, 'sound:core.flute:Hall'); // a title that is the word
  // as good a match (an alias that is the word): Go to first
  const sends = { kind: 'go', id: 'go:sends', title: 'Sends', purpose: '', aliases: ['reverb'] };
  const reverb = pickRows([...SOUNDS, sends], 'reverb');
  assert.ok(reverb.indexOf(sends) >= 0 && reverb.indexOf(sends) < reverb.findIndex((r) => r.id === 'sound:core.rooms'));
});
