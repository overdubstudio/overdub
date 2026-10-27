// Stacks (core/stacks.js) and the live room's amp setting (core/liveroom/plans.js planRig, rigNow): a track's whole
// chain swapped to a stack in one undo step that undoes exactly, as few ops as it takes (what lines up stays, keeps its
// id and is set in place), and the room's [ ] putting the rig's chain on both sides (docs/research/GUITAR-ROOM.md
// §2.2, §2.9). The live graph and the sound are measured in tools/liveroom/checks-rig.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../app/src/devices/builtin/index.js';
import { stackOf, sameChain, planStack, planStacks, swapStack } from '../../app/src/core/stacks.js';
import { planPlace, planRig, rigNow } from '../../app/src/core/liveroom/plans.js';
import { guitarChain, rigChain, RIGS, PLACES } from '../../app/src/core/liveroom/places.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';

const json = (x) => JSON.parse(JSON.stringify(x));
const songOnly = (p) => {
  const x = json(p);
  delete x.meta.modified;
  return x;
};
const chainNow = (store, id) => store.get().tracks.find((t) => t.id === id).inserts;
function songWith(inserts) {
  const store = createStore(createProject());
  const r = store.dispatch(
    { type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio', inserts } },
    { by: 'you' },
  );
  assert.ok(r.ok, r.error);
  return { store, id: r.created.g };
}
const MODERN = { name: 'Modern', chain: guitarChain('modern', 'L', 'drop-c') };
const DJENT = { name: 'Djent', chain: guitarChain('djent', 'L', 'drop-c') };
const BOARD = {
  name: 'Board',
  chain: [
    { device: 'core.drive', params: { drive: 0.3 }, on: true },
    { device: 'core.stack', params: { gain: 4 }, on: true },
    { device: 'core.delay', params: {}, on: false },
    { device: 'core.verb', params: { mix: 0.2 }, on: true },
  ],
};

describe('planStack: the chain made exactly the stack, in as few ops as it takes', () => {
  test('already that stack: no ops', () => {
    const { store, id } = songWith(MODERN.chain);
    const pl = planStack(store.get(), { track: id, stack: MODERN });
    assert.deepEqual(pl.ops, []);
    assert.ok(sameChain(chainNow(store, id), MODERN));
  });
  test('the same devices: set in place, the ids kept, nothing rebuilt', () => {
    const { store, id } = songWith(MODERN.chain);
    const ids = chainNow(store, id).map((x) => x.id);
    const pl = planStack(store.get(), { track: id, stack: DJENT });
    assert.ok(pl.ops.length > 0 && pl.ops.every((o) => o.type === 'insert.set'), pl.ops.map((o) => o.type).join());
    assert.deepEqual([pl.kept, pl.added, pl.removed], [2, 0, 0]);
    assert.ok(store.dispatch(pl.ops, { by: 'you' }).ok);
    assert.deepEqual(
      chainNow(store, id).map((x) => x.id),
      ids,
    );
    assert.ok(sameChain(chainNow(store, id), DJENT));
    // stored exactly as the stack has them: a key the stack leaves out is gone (its default), none added
    assert.deepEqual(
      chainNow(store, id).map((x) => x.params),
      DJENT.chain.map((x) => x.params),
    );
  });
  test('other devices: what lines up stays, the rest removed and added in place, on and off as the stack has them', () => {
    const { store, id } = songWith(MODERN.chain);
    const amp = chainNow(store, id)[0].id;
    const pl = planStack(store.get(), { track: id, stack: BOARD });
    assert.deepEqual([pl.kept, pl.added, pl.removed], [1, 3, 1]);
    assert.ok(store.dispatch(pl.ops, { by: 'you' }).ok);
    const now = chainNow(store, id);
    assert.deepEqual(
      now.map((x) => x.device),
      BOARD.chain.map((x) => x.device),
    );
    assert.deepEqual(
      now.map((x) => x.on !== false),
      BOARD.chain.map((x) => x.on),
    );
    assert.equal(now[1].id, amp, 'the amp stays built: the same insert, set in place');
    assert.ok(sameChain(now, BOARD));
  });
  test('ten swaps in a row, each one undo step that undoes exactly, and redoes', () => {
    const { store, id } = songWith([]);
    const stacks = [
      MODERN,
      BOARD,
      DJENT,
      { chain: [] },
      BOARD,
      MODERN,
      DJENT,
      BOARD,
      { chain: rigChain('thrash') },
      MODERN,
    ];
    const before = [];
    for (const s of stacks) {
      before.push(json(chainNow(store, id)));
      const r = swapStack(store, { track: id, stack: s, label: s.name });
      assert.ok(r.ok, r.error);
      assert.ok(sameChain(chainNow(store, id), s), `on ${s.name || 'its chain'}`);
    }
    const after = json(chainNow(store, id));
    for (let i = stacks.length - 1; i >= 0; i--) {
      // (a swap to the stack the track already has is no step at all)
      if (sameChain(before[i], stacks[i])) continue;
      store.undo();
      assert.deepEqual(json(chainNow(store, id)), before[i], `undo ${i + 1}`);
    }
    while (store.canRedo()) store.redo();
    assert.deepEqual(json(chainNow(store, id)), after);
  });
  test('a switch stored by its label equals its index; a param at its default equals one left out', () => {
    assert.ok(
      sameChain([{ device: 'core.stack', params: { boost: 'ON' } }], [{ device: 'core.stack', params: { boost: 1 } }]),
    );
    assert.ok(sameChain([{ device: 'core.stack', params: { gain: 6.5 } }], [{ device: 'core.stack', params: {} }]));
    assert.ok(!sameChain([{ device: 'core.stack', params: { gain: 6 } }], [{ device: 'core.stack', params: {} }]));
    assert.ok(!sameChain([{ device: 'core.stack', on: false }], [{ device: 'core.stack' }]));
  });
  test('planStacks: several tracks, one step; stackOf copies a chain without its ids', () => {
    const { store, id } = songWith(MODERN.chain);
    const r2 = store.dispatch(
      { type: 'track.add', ref: 'h', track: { name: 'Guitar 2', kind: 'audio', inserts: BOARD.chain } },
      { by: 'you' },
    );
    const id2 = r2.created.h;
    const n = store.history.length;
    const pl = planStacks(store.get(), [
      { track: id, stack: DJENT },
      { track: id2, stack: DJENT },
    ]);
    assert.ok(store.dispatch(pl.ops, { by: 'you', label: 'Djent' }).ok);
    assert.equal(store.history.length, n + 1);
    assert.ok(sameChain(chainNow(store, id), DJENT) && sameChain(chainNow(store, id2), DJENT));
    const s = stackOf(store.get().tracks.find((t) => t.id === id));
    assert.ok(s.chain.every((x) => !('id' in x)) && sameChain(s, DJENT));
    assert.throws(() => planStack(store.get(), { track: 'nope', stack: DJENT }), /no track/);
    assert.throws(() => planStack(store.get(), { track: id, stack: { chain: [{ params: {} }] } }), /no device/);
  });
});

describe('planRig: the live room’s [ ] puts the rig’s whole chain on its guitars', () => {
  function metalRoom() {
    const store = createStore(createProject());
    const pl = planPlace(store.get(), { place: 'metal' });
    assert.ok(store.dispatch(pl.ops, { by: 'you', label: pl.label }).ok);
    const p = store.get(),
      L = p.tracks.find((t) => t.name === 'Guitar L'),
      R = p.tracks.find((t) => t.name === 'Guitar R');
    return { store, L: L.id, R: R.id };
  }
  test('each side gets its side’s chain, room.rig follows, one step by you, undone exactly', () => {
    const { store, L, R } = metalRoom();
    const was = songOnly(store.get());
    assert.deepEqual(rigNow(store.get()), { rig: 'modern', matches: true, label: 'Half Stack, Modern' });
    const pl = planRig(store.get(), { rig: 'djent' });
    assert.equal(pl.label, 'Half Stack, Djent');
    assert.equal(pl.reason, 'room:rig');
    assert.ok(store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason }).ok);
    const p = store.get();
    assert.equal(p.room.rig, 'djent');
    assert.ok(sameChain(chainNow(store, L), guitarChain('djent', 'L', 'drop-c')));
    assert.ok(sameChain(chainNow(store, R), guitarChain('djent', 'R', 'drop-c')));
    assert.notEqual(
      chainNow(store, L)[0].params.cab,
      chainNow(store, R)[0].params.cab,
      'the right side is one mic over',
    );
    assert.deepEqual(rigNow(p), { rig: 'djent', matches: true, label: 'Half Stack, Djent' });
    store.undo();
    assert.deepEqual(songOnly(store.get()), was);
  });
  test('from a chain changed in the control room (a tone, a pedal added), back to the rig exactly', () => {
    const { store, L } = metalRoom();
    assert.ok(swapStack(store, { track: L, stack: BOARD }).ok);
    assert.equal(rigNow(store.get()).matches, false);
    assert.equal(rigNow(store.get()).label, 'Half Stack, your own');
    const pl = planRig(store.get(), { rig: 'modern' });
    assert.ok(pl.ops.length && !pl.ops.some((o) => o.type === 'room.set'), 'still modern: the chain alone');
    assert.ok(store.dispatch(pl.ops, { by: 'you' }).ok);
    assert.ok(sameChain(chainNow(store, L), guitarChain('modern', 'L', 'drop-c')));
    assert.equal(rigNow(store.get()).matches, true);
    assert.deepEqual(planRig(store.get(), { rig: 'modern' }).ops, [], 'on it already: nothing');
  });
  test('the tuning the room is in: Slide Rule’s low cut follows it', () => {
    const { store, L } = metalRoom();
    assert.ok(store.dispatch({ type: 'room.set', patch: { tuning: 'b-standard' } }, { by: 'you' }).ok);
    assert.ok(store.dispatch(planRig(store.get(), { rig: 'thrash' }).ops, { by: 'you' }).ok);
    assert.equal(chainNow(store, L)[1].params.b1_freq, 80);
  });
  test('every place’s every rig, ten swaps in a row on each, the chains exact every time', () => {
    for (const place of ['metal', 'basement', 'bluesbar']) {
      const store = createStore(createProject());
      assert.ok(store.dispatch(planPlace(store.get(), { place }).ops, { by: 'you' }).ok);
      const rigs = PLACES[place].rigs;
      for (let i = 1; i <= 10; i++) {
        const rig = rigs[i % rigs.length],
          pl = planRig(store.get(), { rig });
        assert.ok(!pl.error, pl.error);
        assert.ok(store.dispatch(pl.ops, { by: 'you' }).ok);
        assert.ok(rigNow(store.get()).matches && store.get().room.rig === rig, `${place} ${rig}`);
        // never a doubled chain: one amp per guitar
        for (const t of store.get().tracks.filter((x) => x.kind === 'audio' && /Guitar/.test(x.name)))
          assert.equal(t.inserts.filter((x) => x.device === 'core.stack').length, 1, `${place} ${t.name}`);
      }
    }
  });
  test('refused: a rig the place doesn’t have, the kitchen, a song with no room', () => {
    const { store } = metalRoom();
    assert.match(planRig(store.get(), { rig: 'crunch' }).error, /no "crunch"/);
    assert.match(planRig(store.get(), { rig: 'nope' }).error, /no "nope"/);
    assert.match(planRig(createProject(), { rig: 'modern' }).error, /no amp/);
    assert.ok(Object.keys(RIGS).length >= 6);
  });
});
