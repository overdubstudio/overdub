// The personal lexicon's data and module (agent/lexicon.js, agent/lexicon-personal.js) in Node: words people disagree on
// are asked once with two readings, the pick is kept as this person's meaning. Moved intact from tools/lexicon-test.js;
// adjust through the tool boundary and the studio flows stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the lexicon data and the personal module', async () => {
  const L = await import('../../app/src/agent/lexicon.js');
  const P = await import('../../app/src/agent/lexicon-personal.js');
  const w = L.resolveWord('warmer'),
    c = L.resolveWord('colder'),
    lw = L.resolveWord('less warm'),
    ax = L.resolveWord('warmth'),
    tt = L.resolveWord('tighter'),
    br = L.resolveWord('brighter');
  assert.ok(
    w.ask &&
      w.root === 'warm' &&
      w.rootDir === 1 &&
      c.root === 'warm' &&
      c.rootDir === -1 &&
      lw.rootDir === -1 &&
      ax.root === 'warm' &&
      tt.root === 'tight',
    'warmer / colder / less warm / warmth / tighter resolve to their root word and direction',
  );
  assert.ok(!br.ask && !L.readingsFor(br.root), 'a word people agree on (brighter) has no readings: it is never asked');
  const ids = Object.values(L.READINGS)
    .flat()
    .map((r) => r.id);
  const okReadings = Object.entries(L.READINGS).every(
    ([, rs]) =>
      rs.length === 2 && rs.every((r) => L.AXES[r.axis] && (r.dir === 1 || r.dir === -1) && r.label && r.opposite),
  );
  assert.ok(
    okReadings && new Set(ids).size === ids.length,
    `every asked word has two readings on real axes (${Object.keys(L.READINGS).join(', ')})`,
  );
  assert.ok(
    Object.entries(L.WORDS)
      .filter(([, e]) => e[2]?.ask)
      .every(([, e]) => L.READINGS[e[2].root]),
    'every word marked ask in the table has readings to offer',
  );
  assert.ok(
    L.READINGS.warm.map((r) => r.label).join(' | ') === 'Darker top | Fuller low-mid',
    'warm: "Darker top" vs "Fuller low-mid"',
  );

  P.clear();
  assert.ok(P.meaning('warm') === null && P.list().length === 0, 'node: nothing learned to begin with');
  P.learn('warm', 'darker_top');
  P.noteUse('warm');
  P.noteUse('warm');
  let m = P.meaning('warm');
  assert.ok(
    m.reading === 'darker_top' && m.picks === 1 && m.uses === 2 && m.axis === 'brightness' && m.dir === -1,
    'node: a pick is kept with its counts',
  );
  assert.ok(
    P.learn('warm', 'nope') === null &&
      P.learn('groovy', 'darker_top') === null &&
      P.meaning('warm').reading === 'darker_top',
    'node: unknown words and readings are refused',
  );
  P.setMeaning('warm', 'fuller_lowmid');
  m = P.meaning('warm');
  assert.ok(
    m.reading === 'fuller_lowmid' && m.edited && m.picks === 1,
    'node: changed by hand: the new meaning, marked as set by hand',
  );
  const fa = P.forAgents();
  assert.ok(
    fa.words.warm?.means === 'fuller low-mid' &&
      fa.words.warm.adjust.axis === 'body' &&
      fa.asks.includes('tight') &&
      !fa.asks.includes('warm'),
    'node: forAgents says what "warm" means and which words are still asked',
  );
  let fired = 0;
  const off = P.onChange(() => fired++);
  assert.ok(
    P.forget('warm') && P.meaning('warm') === null && fired === 1 && !P.forget('warm'),
    'node: forget removes it (and tells listeners)',
  );
  off();
});
