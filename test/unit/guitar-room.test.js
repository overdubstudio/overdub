// The guitar room's foundation (docs/research/GUITAR-ROOM.md; docs/ARCHITECTURE.md "The guitar room"): the room's new
// fields in the song (beat, pins, stack, a part's beat), the club's setup, the rig's plans on both guitars, the key
// table and the room's prefs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRoom, ORDER, ROOM_LIMITS } from '../../app/src/core/liveroom/model.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import {
  planGuitarRoom,
  guitarSetup,
  CLUB_STACK,
  GUITAR_DB,
  isGuitarRoom,
} from '../../app/src/core/liveroom/guitar/setup.js';
import {
  rigOf,
  rigTracks,
  planTurn,
  planStomp,
  planMove,
  planAdd,
  planRemove,
  planSwap,
  planSync,
  coalesceKey,
} from '../../app/src/core/liveroom/guitar/rig.js';
import { GUIDE_ID, DEFAULT_PINS, BEAT_RE, beatOf, grooveOfBeat } from '../../app/src/core/liveroom/guitar/beats.js';
import { KEYS, contextOf, keyTable } from '../../app/src/ui/liveroom/guitar/keys.js';
import { gprefs } from '../../app/src/ui/liveroom/guitar/prefs.js';
import { createState } from '../../app/src/ui/liveroom/guitar/state.js';
import { fit, frame, REGIONS, STAGE } from '../../app/src/ui/liveroom/guitar/layout.js';
import '../../app/src/devices/builtin/index.js';

const club = () => {
  const store = createStore(createProject());
  const plan = planGuitarRoom(store.get(), {});
  const r = store.dispatch(plan.ops, { by: 'you', label: plan.label, reason: plan.reason });
  assert.ok(r.ok, r.error);
  return store;
};

describe("the room's new fields", () => {
  test('beat, pins and stack come after the old keys; a part has a beat', () => {
    assert.deepEqual(ORDER.room.slice(-3), ['beat', 'pins', 'stack']);
    assert.equal(ORDER.part.at(-1), 'beat');
    assert.equal(ROOM_LIMITS.pins, 8);
  });
  test('cleanRoom keeps good cards and drops the rest', () => {
    const r = cleanRoom({
      v: 1,
      beat: 'pin:p2',
      pins: [
        { id: 'p1', groove: 'house/guide', name: '  Guide  ' },
        { id: 'p1', groove: 'a/b' },
        { id: 'p3', groove: 'pin:p1' },
        {
          id: 'p2',
          groove: 'modernmetal/double-kick-gallop',
          hits: [
            { t: 0, row: 'kick', v: 1 },
            { t: 99, row: 'kick', v: 1 },
          ],
        },
      ],
      stack: { id: 'house.metal.club', name: 'The club' },
      parts: { s_a: { beat: 'house/guide' }, s_b: { beat: 'Not A Beat' } },
    });
    assert.equal(r.beat, 'pin:p2');
    assert.deepEqual(
      r.pins.map((p) => p.id),
      ['p1', 'p2'],
    );
    assert.equal(r.pins[0].name, 'Guide');
    assert.equal(r.pins[1].hits.length, 1);
    assert.deepEqual(r.stack, { id: 'house.metal.club', name: 'The club' });
    assert.equal(r.parts.s_a.beat, 'house/guide');
    assert.equal(r.parts.s_b, undefined);
  });
  test('room.set refuses a bad beat, a card too many and an unknown key', () => {
    const store = club();
    assert.equal(store.dispatch({ type: 'room.set', patch: { beat: 'nope' } }, { by: 'you' }).ok, false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, groove: GUIDE_ID }));
    assert.equal(store.dispatch({ type: 'room.set', patch: { pins: nine } }, { by: 'you' }).ok, false);
    assert.equal(
      store.dispatch({ type: 'room.set', patch: { stack: { id: 'x', colour: 'red' } } }, { by: 'you' }).ok,
      false,
    );
    assert.equal(BEAT_RE.test(GUIDE_ID), true);
  });
});

describe("the club's setup", () => {
  test('one step: both guitars on the club stack at GUITAR_DB, the drummer, no bass', () => {
    const store = club(),
      p = store.get();
    assert.equal(store.history.length, 1);
    assert.ok(isGuitarRoom(p));
    assert.deepEqual(
      p.tracks.map((t) => t.name),
      ['Guitar L', 'Guitar R', 'Drums'],
    );
    const R = rigOf(p);
    assert.equal(R.tracks.length, 2);
    assert.ok(R.same);
    assert.deepEqual(
      R.slots.map((s) => s.device),
      CLUB_STACK.chain.map((l) => l.device),
    );
    for (const id of rigTracks(p)) assert.equal(p.tracks.find((t) => t.id === id).gain, GUITAR_DB);
    assert.equal(p.room.beat, GUIDE_ID);
    assert.equal(p.room.pins.length, DEFAULT_PINS.length);
    assert.equal(p.room.stack.id, CLUB_STACK.id);
    assert.equal(beatOf(p), GUIDE_ID);
    assert.ok(grooveOfBeat(p, GUIDE_ID));
    assert.deepEqual(guitarSetup().form, []);
  });
});

describe("the rig's plans", () => {
  const steps = {
    turn: (p) => planTurn(p, { slot: rigOf(p).amp.slot, params: { gain: 7.5 } }),
    stomp: (p) => planStomp(p, { slot: rigOf(p).board[0].slot }),
    move: (p) => planMove(p, { from: rigOf(p).board[0].slot, to: rigOf(p).board[1].slot }),
    add: (p) => planAdd(p, { link: { device: 'pedal.chorus' } }),
    remove: (p) => planRemove(p, { slot: rigOf(p).board.at(-1).slot }),
    swap: (p) => planSwap(p, { stack: { chain: [{ device: 'amp.punk', on: true }] } }),
  };
  for (const [name, mk] of Object.entries(steps)) {
    test(`${name}: one step on both guitars, undone exactly`, () => {
      const store = club(),
        before = JSON.stringify(store.get().tracks);
      const plan = mk(store.get());
      assert.ok(!plan.error, plan.error);
      const r = store.dispatch(plan.ops, { by: 'you', label: plan.label, reason: plan.reason });
      assert.ok(r.ok, r.error);
      assert.ok(rigOf(store.get()).same);
      assert.notEqual(JSON.stringify(store.get().tracks), before);
      store.undo();
      assert.equal(JSON.stringify(store.get().tracks), before);
    });
  }
  test('sync makes the other side L again', () => {
    const store = club(),
      p = store.get(),
      R = rigOf(p);
    const r = store.dispatch(
      {
        type: 'insert.set',
        track: R.tracks[1],
        insert: p.tracks.find((t) => t.id === R.tracks[1]).inserts[0].id,
        patch: { on: false },
      },
      { by: 'you' },
    );
    assert.ok(r.ok, r.error);
    assert.equal(rigOf(store.get()).same, false);
    const plan = planSync(store.get());
    assert.ok(store.dispatch(plan.ops, { by: 'you' }).ok);
    assert.ok(rigOf(store.get()).same);
  });
  test('a knob coalesces by its slot and key', () => {
    assert.equal(coalesceKey(2, 'gain'), coalesceKey(2, 'gain'));
    assert.notEqual(coalesceKey(2, 'gain'), coalesceKey(2, 'bass'));
  });
});

describe('the keys, the state, the prefs, the layout', () => {
  test('one meaning per key per place', () => {
    const seen = new Set();
    for (const k of KEYS)
      for (const c of k.in) {
        const id = `${k.mod || ''}+${k.code}@${c}`;
        assert.ok(!seen.has(id), id);
        seen.add(id);
      }
    assert.equal(keyTable().length, KEYS.length);
    assert.ok(contextOf(createState(), 'take').rec);
    assert.ok(contextOf({ ...createState(), world: 'shop' }, 'idle').shop);
  });
  test('the prefs: defaults, and a stream may keep its own key', () => {
    const g = gprefs.get();
    assert.equal(g.countIn, true);
    assert.equal(gprefs.set({ countIn: false, mine: 3 }).countIn, false);
    assert.equal(gprefs.get().mine, 3);
    gprefs.set({ countIn: true });
  });
  test('the camera frames a region bigger than the stage does', () => {
    const view = { w: 1440, h: 804 };
    const home = fit(view, STAGE),
      head = frame(view, REGIONS.head, {});
    assert.ok(head.s > home.s);
  });
});
