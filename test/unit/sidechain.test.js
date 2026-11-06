// Keys (sidechains), the ops: insert.add and insert.set take a key ({ track }), each with an exact inverse; a missing
// track, the insert's own, a master insert, a loop and a device that hears no key are refused with nothing changed; a
// key whose track is removed stays, heard as silence; get_project says who keys what; normInsert keeps a valid key.
// And keyPlan's order. Moved from tools/sidechain-test.js; the renders and the studio stay there.
import { test } from 'node:test';
import { createProject, normInsert, summarize } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { keyPlan } from '../../app/src/engine/strip.js';
import '../../app/src/devices/builtin/index.js';
import { T } from './_t.js';

const ok = T.ok;
const STAMP = '2026-10-07T00:00:00.000Z';

const base = () => ({
  ...createProject(),
  id: 'p_sc',
  title: 'sc',
  tempo: 120,
  key: null,
  meta: { created: STAMP, modified: STAMP, authors: {} },
  tracks: ['Kick', 'Bass', 'Pad'].map((name) => ({
    id: 't_' + name.toLowerCase(),
    name,
    kind: 'instrument',
    instrument: { device: name === 'Kick' ? 'core.drums' : 'core.bass', params: {} },
    inserts: [],
    clips: [],
    gain: 0,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    by: 'you',
  })),
});
test('the ops: key on insert.add and insert.set, refusals, loops, a removed key track, normInsert, master.clip', () => {
  const store = createStore(base(), { getDevice });
  const ins = (t, id) =>
    store
      .get()
      .tracks.find((x) => x.id === t)
      .inserts.find((x) => x.id === id);
  let r = store.dispatch(
    { type: 'insert.add', track: 'Bass', insert: { device: 'core.ducker', key: { track: 'Kick' } }, ref: 'd' },
    { by: 'claude', label: 'duck' },
  );
  const d = r.ok && r.created.d;
  ok(
    r.ok && ins('t_bass', d).key && ins('t_bass', d).key.track === 't_kick',
    `insert.add takes a key by the track's name, stored by its id (${JSON.stringify(r.ok && ins('t_bass', d).key)})`,
  );
  r = store.dispatch(
    { type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 't_pad' } } },
    { by: 'you', label: 'rekey' },
  );
  ok(r.ok && ins('t_bass', d).key.track === 't_pad', 'insert.set moves the key to another track');
  store.undo();
  ok(ins('t_bass', d).key.track === 't_kick', 'and its undo puts the old key back exactly');
  r = store.dispatch(
    { type: 'insert.set', track: 't_bass', insert: d, patch: { key: null } },
    { by: 'you', label: 'unkey' },
  );
  ok(r.ok && !('key' in ins('t_bass', d)), 'key: null removes it (no field left behind)');
  store.undo();
  ok(ins('t_bass', d).key.track === 't_kick', '...and undo brings it back');
  const before = JSON.stringify(store.get());
  const refused = (op, re) => {
    const x = store.dispatch(op, { by: 'claude', label: 'bad' });
    return !x.ok && re.test(x.error) && JSON.stringify(store.get()) === before ? x.error : false;
  };
  let e = refused(
    { type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 'Nope' } } },
    /no track "Nope"/,
  );
  ok(e, `a key naming no track is refused, nothing changed ("${e}")`);
  e = refused(
    { type: 'insert.set', track: 't_bass', insert: d, patch: { key: { track: 't_bass' } } },
    /can't key itself/,
  );
  ok(e, `a track keying itself is refused ("${e}")`);
  e = refused(
    { type: 'insert.add', track: 'master', insert: { device: 'core.ducker', key: { track: 't_kick' } } },
    /master insert can't take a key/,
  );
  ok(e, `a key on a master insert is refused ("${e}")`);
  e = refused(
    { type: 'insert.add', track: 't_kick', insert: { device: 'core.ducker', key: { track: 't_bass' } } },
    /would make a loop/,
  );
  ok(e, `a key that closes a loop (Bass keyed by Kick, Kick keyed by Bass) is refused ("${e}")`);
  e = refused(
    { type: 'insert.add', track: 't_pad', insert: { device: 'core.clipper', key: { track: 't_kick' } } },
    /has no key input/,
  );
  ok(
    e,
    `a key on a device that hears none (Clip Lamp) is refused, so nothing says "keyed by" when nothing is ("${e}")`,
  );
  // a longer loop: Pad keyed by Bass, then Kick keyed by Pad
  r = store.dispatch(
    { type: 'insert.add', track: 't_pad', insert: { device: 'core.ducker', key: { track: 't_bass' } }, ref: 'p' },
    { by: 'claude', label: 'pad duck' },
  );
  const b2 = JSON.stringify(store.get());
  const x = store.dispatch(
    { type: 'insert.add', track: 't_kick', insert: { device: 'core.ducker', key: { track: 't_pad' } } },
    { by: 'claude', label: 'bad' },
  );
  ok(
    r.ok && !x.ok && /loop/.test(x.error) && JSON.stringify(store.get()) === b2,
    'a loop through three tracks (Kick -> Bass -> Pad -> Kick) is refused too',
  );
  ok(
    !store.dispatch({ type: 'insert.set', track: 't_bass', insert: d, patch: { key: 'Kick' } }, { by: 'claude' }).ok,
    'a key that is not { track } is refused',
  );
  // a key and a $ref in one call
  r = store.dispatch(
    [
      { type: 'track.add', ref: 'g', track: { name: 'Ghost', instrument: { device: 'core.drums' } } },
      { type: 'insert.add', track: 't_pad', insert: { device: 'core.ducker', key: { track: '$g' } }, ref: 'q' },
    ],
    { by: 'claude', label: 'ghost' },
  );
  ok(
    r.ok && ins('t_pad', r.created.q).key.track === r.created.g,
    'a key can name a track made earlier in the same call ($ref)',
  );
  store.undo();
  // the key track removed: the key stays, says so, and undo brings the track back under it
  r = store.dispatch({ type: 'track.remove', track: 't_kick' }, { by: 'you', label: 'rm kick' });
  const text = summarize(store.get());
  ok(
    r.ok && ins('t_bass', d).key.track === 't_kick' && /key track missing: t_kick/.test(text),
    'removing the key track leaves the key in the song; get_project says "key track missing"',
  );
  ok(keyPlan(store.get()).keyOf.get(d) === null, '...and the renderers hear it as silence (keyPlan: no source)');
  store.undo();
  ok(
    store.get().tracks.some((t) => t.id === 't_kick') && /keyed by t_kick "Kick"/.test(summarize(store.get())),
    'undoing the removal brings the key track back; get_project: keyed by t_kick "Kick"',
  );
  // older readers and bad files
  ok(
    !('key' in normInsert({ id: 'fx_a', device: 'core.ducker', key: 'Kick' })) &&
      !('key' in normInsert({ id: 'fx_a', device: 'core.ducker', key: { track: 5 } })),
    'normInsert drops a key that is not { track: "<id>" }',
  );
  ok(
    JSON.stringify(normInsert({ id: 'fx_a', device: 'core.eq', on: true, params: {}, by: 'you' })) ===
      '{"id":"fx_a","device":"core.eq","on":true,"params":{},"by":"you"}',
    'an insert without a key is exactly as before (no new field)',
  );
  // master.clip
  r = store.dispatch({ type: 'master.set', patch: { clip: 'clean' } }, { by: 'claude', label: 'clean' });
  ok(r.ok && store.get().master.clip === 'clean', 'master.set { clip: "clean" }');
  store.undo();
  ok(
    !('clip' in store.get().master),
    '...and its undo puts the master back to the soft clip (no field: what every older song has)',
  );
  ok(
    !store.dispatch({ type: 'master.set', patch: { clip: 'loud' } }, { by: 'claude' }).ok,
    'a master clip that is neither "soft" nor "clean" is refused',
  );
});

test('keyPlan: key sources first, a key on a device that takes none is ignored, a heard track needs its sources', () => {
  const p = {
    tracks: [
      { id: 'a', inserts: [{ id: 'x1', device: 'core.ducker', key: { track: 'c' } }] },
      { id: 'b', inserts: [] },
      { id: 'c', inserts: [{ id: 'x2', device: 'core.ducker', key: { track: 'b' } }] },
    ],
  };
  const plan = keyPlan(p);
  ok(
    plan.order.join() === 'b,c,a',
    `keyPlan orders key sources first, otherwise in track order (${plan.order.join(', ')})`,
  );
  const q = {
    tracks: [
      { id: 'a', inserts: [{ id: 'x1', device: 'core.eq', key: { track: 'b' } }] },
      { id: 'b', inserts: [] },
    ],
  };
  ok(
    keyPlan(q).order.join() === 'a,b' && !keyPlan(q).keyOf.has('x1'),
    'a key on a device that takes none is ignored (track order kept)',
  );
  const heard = { a: true, b: false, c: false };
  ok([...keyPlan(p, { heard }).needed].sort().join() === 'a,b,c', 'a heard track needs its key sources, and theirs');
});
