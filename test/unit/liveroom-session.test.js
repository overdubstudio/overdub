// The live room's session (core/liveroom/session.js) and the stage's plans (core/liveroom/plans.js): the room's view
// of a song, the offered move and the press counts it gives (docs/research/LIVE-ROOM-MODE.md §7.4, §11.4), where a
// stop lands (§3.5), and what picking a place, a take, Lay it out and the card menu's moves do to the song (§3.9,
// §3.10, §7.2, §7.3), each one undo step that undoes exactly.
//
// The places' setups, the band and the deck are other streams' (B's places.js and band.js, A's deck): here a take is
// what the recorder commits (an asset and a clip in a take folder, by you), and the place's tracks are a stand-in
// setup of setupOf's shape, so these hold the stage's own logic whatever the others' stubs do.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readRoom, offered, stopBeat, press } from '../../app/src/core/liveroom/session.js';
import {
  planPlace,
  takeOps,
  planLayout,
  planTwice,
  planMove,
  planShorter,
  planRemove,
  planEnd,
} from '../../app/src/core/liveroom/plans.js';
import { LINES as STAGE } from '../../app/src/core/liveroom/lines/stage.js';
import { LINES as GLASS } from '../../app/src/core/liveroom/lines/glass.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';

const SETUP = {
  tempo: 132,
  meter: [4, 4],
  grid: 4,
  tracks: [
    {
      role: 'guitarL',
      name: 'Guitar L',
      kind: 'audio',
      arm: true,
      gain: -6,
      pan: 0,
      inserts: [{ device: 'core.stack', params: {} }],
    },
    {
      role: 'guitarR',
      name: 'Guitar R',
      kind: 'audio',
      gain: -6,
      pan: 0,
      inserts: [{ device: 'core.stack', params: {} }],
    },
    { role: 'drums', name: 'Drums', instrument: { device: 'core.drums', params: {} }, gain: -6 },
    { role: 'bass', name: 'Bass', instrument: { device: 'core.bassguitar', params: {} }, gain: -6 },
    { role: 'heard', name: 'Riff (as heard)', mute: true },
  ],
  master: [{ device: 'core.limiter', params: {} }],
};
const json = (x) => JSON.stringify(x);
const song = (s) => {
  const p = JSON.parse(json(s.get()));
  delete p.meta.modified;
  delete p.meta.authors;
  return p;
};
let tk = 0;
// what the recorder commits for a pass: the asset and its clip in a take folder (one bar of pre-roll and a bar of ring
// recorded around the part), one step by you
function commit(s, { role = 'guitarL', from, to, pre = 4, ring = 4, take = null }) {
  const v = readRoom(s.get()),
    track = v.roles[role],
    id = `a_take${++tk}`;
  const start = Math.max(0, from - pre),
    clip = `c_take${tk}`;
  const r = s.dispatch(
    [
      {
        type: 'asset.add',
        asset: {
          id,
          kind: 'audio',
          name: id,
          sr: 48000,
          channels: 1,
          duration: ((to + ring - start) * 60) / s.get().tempo,
        },
      },
      {
        type: 'clip.add',
        track,
        clip: {
          id: clip,
          kind: 'audio',
          asset: id,
          start,
          length: to + ring - start,
          offset: 0,
          take: take || `tk_take${tk}`,
        },
      },
    ],
    { by: 'you', label: 'Take' },
  );
  assert.ok(r.ok, r.error);
  return { txn: r.txn.id, track, clip, from, to };
}
// a plan's step and what it needs after (joined: one step)
function run(s, plan, by = 'you') {
  const r = s.dispatch(plan.ops, { by, label: plan.label, reason: plan.reason });
  assert.ok(r.ok, `${plan.label}: ${r.error}`);
  const more = plan.after ? plan.after(s.get()) : [];
  if (more.length) {
    const j = s.dispatch(more, { by, join: r.txn.id });
    assert.ok(j.ok, `${plan.label}, after: ${j.error}`);
  }
  return r;
}
// a whole take: the commit, and the part's ops joined to it
function takeIn(s, { name = null, section = null, from, to, role = 'guitarL', part = null }) {
  const c = commit(s, { role, from, to });
  const t = takeOps({ song: s.get(), track: c.track, clip: c.clip, from, to, name, section }, { part });
  const r = s.dispatch(t.ops, { by: 'you', join: c.txn, label: t.label, reason: t.reason });
  assert.ok(r.ok, r.error);
  return { ...t, txn: c.txn, clip: c.clip };
}
function metalSong() {
  const s = createStore(createProject());
  run(s, planPlace(s.get(), { place: 'metal', tuning: 'drop-c', setup: SETUP }));
  return s;
}

describe("the session: the room's view", () => {
  test("picking a place: one step by you, the tempo, the role tracks (the band's signed by the house), the master, the room", () => {
    const s = metalSong(),
      p = s.get(),
      v = readRoom(p);
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].label, 'Into the metal club');
    assert.equal(s.history[0].by, 'you');
    assert.equal(p.tempo, 132);
    assert.equal(v.place, 'metal');
    assert.equal(v.rig, 'modern');
    assert.equal(v.tuning, 'drop-c');
    assert.equal(v.finish, 'tight');
    assert.deepEqual(Object.keys(v.roles).sort(), ['bass', 'drums', 'guitarL', 'guitarR', 'heard']);
    assert.equal(p.tracks.find((t) => t.id === v.roles.drums).by, 'overdub');
    assert.equal(p.tracks.find((t) => t.id === v.roles.guitarL).by, 'you');
    assert.equal(p.master.inserts.length, 1);
    assert.equal(p.room.managed[v.roles.drums].gain, -6);
    // picking it again keeps the roles it has
    const again = planPlace(p, { place: 'metal', setup: SETUP });
    assert.equal(again.ops.filter((o) => o.type === 'track.add').length, 0);
    s.undo();
    assert.equal(s.get().room, undefined);
    assert.equal(s.get().tracks.length, 0);
  });

  test('a song the control room made keeps its own master: the finish is the musician\'s ("Yours")', () => {
    const s = createStore(createProject());
    s.dispatch({ type: 'insert.add', track: 'master', insert: { device: 'core.verb', params: {} } }, { by: 'you' });
    run(s, planPlace(s.get(), { place: 'metal', setup: SETUP }));
    assert.equal(s.get().master.inserts.length, 1);
    assert.equal(s.get().master.inserts[0].device, 'core.verb');
    assert.equal(readRoom(s.get()).finish, null);
  });

  test('a take: one step by you with its part, the seams and the End; Again stacks in the folder', () => {
    const s = metalSong();
    const t1 = takeIn(s, { name: 'Verse', from: 0, to: 32 });
    assert.equal(s.history.length, 2);
    const h = s.history[1];
    assert.equal(h.label, 'Verse take 1');
    assert.equal(h.reason, `room:take:${t1.section}`);
    assert.equal(h.by, 'you');
    let v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => [c.name, c.bars]),
      [
        ['Verse', 8],
        ['End', 1],
      ],
    );
    assert.equal(v.end, v.cards[1].id);
    assert.equal(v.cards[0].takes.L.length, 1);
    assert.equal(v.cards[1].takes.L.length, 0, "the ring into the End isn't a take of the End");
    const c1 = s.get().tracks.find((t) => t.id === v.roles.guitarL).clips[0];
    assert.equal(c1.start, 0, "the first part's take from beat 0");
    assert.equal(c1.length, 36, 'and it rings a bar into the End');
    // the chorus: the verse's take ends on its seam, 30 ms before the chorus's 1
    const t2 = takeIn(s, { name: 'Chorus', from: 32, to: 64 });
    v = readRoom(s.get());
    assert.deepEqual(
      v.parts.map((c) => [c.name, c.start, c.bars]),
      [
        ['Verse', 0, 8],
        ['Chorus', 32, 8],
      ],
    );
    const L = s
      .get()
      .tracks.find((t) => t.id === v.roles.guitarL)
      .clips.slice()
      .sort((a, b) => a.start - b.start);
    const lead = (0.03 * 132) / 60;
    assert.ok(Math.abs(L[1].start - (32 - lead)) < 1e-3, `the chorus's take starts 30 ms early (${L[1].start})`);
    assert.ok(
      Math.abs(L[0].start + L[0].length - L[1].start) < 1e-3,
      'a butt splice: the verse ends where the chorus starts',
    );
    assert.ok(
      Math.abs(L[1].offset - ((32 - lead - 28) * 60) / 132) < 1e-3,
      `the pre-roll cut off by its offset (${L[1].offset})`,
    );
    assert.ok(Math.abs(L[1].start + L[1].length - 68) < 1e-3, 'the last part rings a bar into the End');
    assert.equal(v.cards.at(-1).start, 64, 'the End follows the last part');
    // Again on the verse: take 2 in its folder... a new take, the label says which
    const t3 = takeIn(s, { section: t1.section, from: 0, to: 32 });
    assert.equal(t3.label, 'Verse take 2');
    assert.equal(readRoom(s.get()).parts[0].takes.L.length, 2);
    void t2;
  });

  test("a new part: the other side's ring ends on its seam too, so the part before isn't a take of it", () => {
    const s = metalSong();
    const v0 = takeIn(s, { name: 'Verse', from: 0, to: 32 });
    takeIn(s, { section: v0.section, from: 0, to: 32, role: 'guitarR' });
    takeIn(s, { name: 'Chorus', from: 32, to: 64 });
    const v = readRoom(s.get());
    const R = s.get().tracks.find((t) => t.id === v.roles.guitarR).clips[0];
    assert.ok(R.start + R.length < 32, `the right side's ring stops at the chorus's seam (${R.start + R.length})`);
    assert.equal(v.parts[1].takes.R.length, 0, 'the chorus has no right side yet');
    assert.equal(offered(v, { run: 'idle', last: v.parts[1].id }).id, 'other', 'so the other side is offered for it');
  });

  test("the End: one bar after the last part (two at the blues bar), and planEnd when it's already there is nothing", () => {
    const s = metalSong();
    takeIn(s, { name: 'Verse', from: 0, to: 32 });
    assert.equal(planEnd(s.get()).ops.length, 0);
    s.dispatch({ type: 'section.set', section: readRoom(s.get()).end, patch: { start: 40 } }, { by: 'you' });
    const e = planEnd(s.get());
    assert.deepEqual(e.ops[0].patch, { start: 32, length: 4 });
  });
});

describe('the session: plans, each one step that undoes exactly', () => {
  const two = () => {
    const s = metalSong();
    const a = takeIn(s, { name: 'Verse', from: 0, to: 32 });
    const b = takeIn(s, { name: 'Chorus', from: 32, to: 64 });
    return { s, a, b };
  };

  test('Lay it out at the metal club: 61 bars, 1:51, the breakdown empty, the intro on the left alone; by the house; ⌘Z back', () => {
    const { s } = two();
    const before = song(s);
    // a right side on both parts
    takeIn(s, { section: readRoom(s.get()).parts[0].id, from: 0, to: 32, role: 'guitarR' });
    takeIn(s, { section: readRoom(s.get()).parts[1].id, from: 32, to: 64, role: 'guitarR' });
    const mid = song(s),
      n = s.history.length;
    const plan = planLayout(s.get());
    assert.equal(plan.bars, 61);
    assert.equal(plan.time, '1:51');
    assert.equal(plan.form, 'intro, verse, chorus, verse, chorus, breakdown, chorus ×2, end');
    assert.equal(plan.empty, 'Breakdown');
    run(s, plan, 'overdub');
    assert.equal(s.history.length, n + 1, 'one step');
    assert.equal(s.history.at(-1).by, 'overdub');
    const v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => [c.name.replace(/ \d+$/, ''), c.bars, c.empty]),
      [
        ['Intro', 4, false],
        ['Verse', 8, false],
        ['Chorus', 8, false],
        ['Verse', 8, false],
        ['Chorus', 8, false],
        ['Breakdown', 8, true],
        ['Chorus', 16, false],
        ['End', 1, true],
      ],
    );
    assert.ok(v.laidOut);
    assert.equal(v.cards[0].part.oneSide, true);
    assert.equal(v.cards[0].takes.R.length, 0, 'the intro stays on the left alone');
    assert.equal(v.cards[5].part.feel, 'halftime');
    assert.equal(v.cards[6].part.reps, 2);
    // no two takes over each other on a side
    for (const role of ['guitarL', 'guitarR']) {
      const cs = s
        .get()
        .tracks.find((t) => t.id === v.roles[role])
        .clips.filter((c) => !c.mute)
        .sort((a, b) => a.start - b.start);
      for (let i = 1; i < cs.length; i++)
        assert.ok(
          cs[i - 1].start + cs[i - 1].length <= cs[i].start + 1e-6,
          `${role}: ${cs[i - 1].id} ends by ${cs[i].id}`,
        );
    }
    assert.ok(s.undo().ok);
    assert.deepEqual(song(s), mid);
    void before;
  });

  test('Lay it out at the basement (67 bars, 1:33) and the blues bar (54 bars, 2:15)', () => {
    for (const [place, a, b, bars, time] of [
      ['basement', 32, 32, 67, '1:33'],
      ['bluesbar', 48, 48, 54, '2:15'],
    ]) {
      const s = createStore(createProject());
      const setup = {
        ...SETUP,
        tempo: place === 'basement' ? 172 : 96,
        tracks:
          place === 'bluesbar'
            ? [
                { role: 'guitar', name: 'Guitar', kind: 'audio' },
                { role: 'lead', name: 'Lead', kind: 'audio' },
                ...SETUP.tracks.slice(2),
              ]
            : SETUP.tracks,
      };
      run(s, planPlace(s.get(), { place, setup }));
      takeIn(s, {
        name: place === 'bluesbar' ? 'Head' : 'Verse',
        from: 0,
        to: a,
        role: place === 'bluesbar' ? 'guitar' : 'guitarL',
      });
      takeIn(s, {
        name: place === 'bluesbar' ? 'Solo' : 'Chorus',
        from: a,
        to: a + b,
        role: place === 'bluesbar' ? 'lead' : 'guitarL',
      });
      const plan = planLayout(s.get());
      assert.equal(plan.bars, bars, place);
      assert.equal(plan.time, time, place);
      const was = song(s);
      run(s, plan, 'overdub');
      const v = readRoom(s.get());
      assert.equal(
        v.cards.reduce((n, c) => n + c.bars, 0),
        bars,
        `${place}: the cards add up (${v.cards.map((c) => `${c.name} ${c.bars}`).join(', ')})`,
      );
      assert.equal(v.cards.at(-1).bars, place === 'bluesbar' ? 2 : 1);
      s.undo();
      assert.deepEqual(song(s), was);
    }
  });

  test('×2: one section twice the bars, its takes repeated, one card; ⌘Z back', () => {
    const { s, a } = two();
    const was = song(s);
    run(s, planTwice(s.get(), { section: a.section }));
    const v = readRoom(s.get());
    assert.deepEqual(
      v.parts.map((c) => [c.name, c.bars]),
      [
        ['Verse', 16],
        ['Chorus', 8],
      ],
    );
    assert.equal(v.parts[0].part.reps, 2);
    assert.ok(v.parts[0].takes.L.length >= 2, 'the take repeated');
    assert.equal(v.cards.at(-1).start, 96);
    assert.ok(s.undo().ok);
    assert.deepEqual(song(s), was);
  });

  test('Earlier, Later: section.move keeps the ids; the End stays last', () => {
    const { s, a, b } = two();
    const was = song(s);
    run(s, planMove(s.get(), { section: b.section, before: a.section }));
    let v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => c.name),
      ['Chorus', 'Verse', 'End'],
    );
    assert.equal(v.parts[0].id, b.section);
    s.undo();
    assert.deepEqual(song(s), was);
    const later = planMove(s.get(), { section: a.section, before: null });
    run(s, later);
    v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => c.name),
      ['Chorus', 'Verse', 'End'],
    );
  });

  test('Shorter keeps the first bars; Remove takes the part and its bars, and ⌘Z brings both', () => {
    const { s, a } = two();
    const was = song(s);
    run(s, planShorter(s.get(), { section: a.section, bars: 4 }));
    let v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => [c.name, c.bars]),
      [
        ['Verse', 4],
        ['Chorus', 8],
        ['End', 1],
      ],
    );
    s.undo();
    assert.deepEqual(song(s), was);
    run(s, planRemove(s.get(), { section: a.section }));
    v = readRoom(s.get());
    assert.deepEqual(
      v.cards.map((c) => [c.name, c.start]),
      [
        ['Chorus', 0],
        ['End', 32],
      ],
    );
    assert.equal(s.get().room.parts?.[a.section], undefined, 'its room part went with it');
    s.undo();
    assert.deepEqual(song(s), was);
  });

  test("the seams after ×2, a move, a remove and Lay it out: no gap, no overlap, and the End rings with the last part's own take", () => {
    // (on each take track, the clips that play, end to end: a gap or an overlap between two is a seam the plan broke)
    const seams = (p) => {
      const v = readRoom(p),
        out = [];
      const t = p.tracks.find((x) => x.id === v.roles.guitarL);
      const live = t.clips.filter((c) => !c.mute).sort((x, y) => x.start - y.start);
      for (let i = 0; i + 1 < live.length; i++) {
        const d = live[i + 1].start - (live[i].start + live[i].length);
        // (an empty part's bars are no seam)
        if (
          Math.abs(d) > 1e-3 &&
          !v.parts.some((c) => c.empty && Math.abs(c.start - (live[i].start + live[i].length)) < 1e-3)
        )
          out.push(`${d > 0 ? 'gap' : 'overlap'} at ${live[i + 1].start}`);
      }
      return out;
    };
    // (what plays in the End on Guitar L: the asset of the clip there, which must be the last part's take's)
    const ring = (p) => {
      const v = readRoom(p),
        end = p.sections.find((x) => x.id === v.end);
      const t = p.tracks.find((x) => x.id === v.roles.guitarL);
      const last = v.parts.at(-1);
      const there = t.clips.filter(
        (c) => !c.mute && c.start < end.start + end.length - 1e-6 && c.start + c.length > end.start + 1e-6,
      );
      const own = t.clips.find((c) => c.id === last.playing.L);
      return {
        assets: [...new Set(there.map((c) => c.asset))],
        own: own?.asset,
        reaches: Math.max(...there.map((c) => c.start + c.length)) - end.start,
      };
    };
    for (const [what, plan] of [
      ['×2', (s, a) => planTwice(s.get(), { section: a.section })],
      ['a move', (s, a, b) => planMove(s.get(), { section: b.section, before: a.section })],
      ['a remove', (s, a, b) => planRemove(s.get(), { section: b.section })],
      ['Lay it out', (s) => planLayout(s.get())],
    ]) {
      const { s, a, b } = two();
      const was = song(s);
      run(s, plan(s, a, b), what === 'Lay it out' ? 'overdub' : 'you');
      assert.deepEqual(seams(s.get()), [], `${what}: the seams`);
      const r = ring(s.get());
      assert.deepEqual(r.assets, [r.own], `${what}: the End rings with the last part's own take`);
      assert.ok(Math.abs(r.reaches - 4) < 1e-3, `${what}: a bar of ring (${r.reaches} beats)`);
      s.undo();
      assert.deepEqual(song(s), was, `${what}: ⌘Z back`);
    }
  });
});

describe('the session: the offered move and the press counts (§7.4, §11.4)', () => {
  const path = (presses) => presses.reduce((st, id) => press(st, id), {});
  const SPACE = (n) => Array(n).fill('space');

  test('the metal club: two parts, both sides, laid out, heard, sent: 12 presses', () => {
    const s = path(['door:metal', 'allow', 'tune', ...SPACE(8), 'send']);
    assert.equal(s.presses, 12);
    assert.ok(s.sent);
    assert.deepEqual(s.offered, ['count', 'take', 'other', 'next', 'take', 'other', 'layout', 'hear']);
  });
  test('the basement: the chorus doubled once offered: 10 presses', () => {
    const s = path(['door:basement', 'allow', ...SPACE(7), 'send']);
    assert.equal(s.presses, 10);
    assert.ok(s.sent);
    assert.deepEqual(s.offered, ['count', 'take', 'next', 'take', 'other', 'layout', 'hear']);
  });
  test('the blues bar: a head and a solo: 9 presses', () => {
    const s = path(['door:bluesbar', 'allow', ...SPACE(6), 'send']);
    assert.equal(s.presses, 9);
    assert.ok(s.sent);
    assert.deepEqual(s.offered, ['count', 'take', 'next', 'take', 'layout', 'hear']);
  });
  test("after the form is heard, Space plays the empty part by its name; Not yet means Lay it out isn't offered again", () => {
    const s = path(['door:metal', 'allow', ...SPACE(9)]);
    assert.equal(s.offered.at(-1), 'play');
    assert.equal(s.run.run, 'take', 'R on the breakdown: its pass');
    assert.equal(s.view.cards.find((c) => c.id === s.run.card).name, 'Breakdown');
    const n = path(['door:metal', 'allow', ...SPACE(6), 'notyet', 'space']);
    assert.equal(n.offered.at(-1), 'next');
  });
  test('the offered move on a real song follows the same rules', () => {
    const s = metalSong();
    let v = readRoom(s.get());
    assert.equal(offered(v, 'idle').id, 'count');
    assert.equal(offered(v, 'take').id, 'take');
    assert.equal(offered(v, 'play').id, 'stop');
    const a = takeIn(s, { name: 'Verse', from: 0, to: 32 });
    v = readRoom(s.get());
    assert.equal(offered(v, { run: 'idle', last: a.section }).id, 'other');
    assert.equal(offered(v, { run: 'idle' }).id, 'next');
    assert.deepEqual(offered(v, { run: 'idle', drift: { card: a.section, bar: 5 } }), {
      id: 'punch',
      label: 'Bar 5 again',
      key: 'Space',
      card: a.section,
    });
    assert.equal(v.next, 'Chorus');
    takeIn(s, { name: 'Chorus', from: 32, to: 64 });
    v = readRoom(s.get());
    assert.equal(offered(v, { run: 'idle' }).id, 'layout');
    assert.equal(offered(v, { run: 'idle', said: ['layout.offer'] }).id, 'next');
    assert.equal(offered(readRoom(createProject()), 'idle'), null, 'no room: nothing (the door)');
  });
});

describe('the session: where a stop lands (§3.5)', () => {
  const v = { meter: [4, 4], place: 'metal' };
  test("pressed in a bar's first beat: the line just gone; later: the next", () => {
    assert.equal(stopBeat(v, 32.5), 32, 'beat 0.5 of bar 9: an 8-bar part');
    assert.equal(stopBeat(v, 34), 36, 'beat 2 of bar 9: a 9-bar part');
    assert.equal(stopBeat(v, 33.5), 36);
    assert.equal(stopBeat(v, 32), 32);
    assert.equal(stopBeat(v, 0.5, { from: 0 }), 4, 'never less than a bar');
    assert.equal(stopBeat({ meter: [3, 4] }, 9.5), 9);
  });
  test('the blues bar: whole twelve-bar choruses', () => {
    const b = { meter: [4, 4], place: 'bluesbar' };
    assert.equal(stopBeat(b, 48 + 3, { from: 0 }), 48, "in a chorus's first two bars: its start");
    assert.equal(stopBeat(b, 48 + 9, { from: 0 }), 96, 'later: its end');
    assert.equal(stopBeat(b, 20, { from: 0 }), 48, 'never under one chorus');
    assert.equal(stopBeat(b, 16 + 48 + 2, { from: 16 }), 64);
  });
});

describe('the session: its lines', () => {
  test('every line is a text(vars), at most two sentences, no exclamation, and the once-only ones say so', () => {
    for (const [id, line] of Object.entries({ ...STAGE, ...GLASS })) {
      const t = line.text({
        part: 'Verse',
        bars: 8,
        bpm: 132,
        take: 2,
        was: 1,
        form: 'intro, verse',
        time: '1:51',
        parts: 7,
        title: 'Void Weather',
        note: 'verse doubled',
        changes: 'the bass came up 2 dB',
        track: 'Synth',
        job: 'mixer',
        meter: '7/8',
        where: 'before the chorus',
      });
      assert.equal(typeof t, 'string', id);
      assert.ok(t.length > 0, id);
      assert.ok(!/!/.test(t), `${id}: no exclamation marks`);
      assert.ok((t.match(/[.?](\s|$)/g) || []).length <= 2, `${id}: two sentences at most: ${t}`);
    }
    assert.equal(STAGE['layout.offer'].once, true);
    assert.equal(
      STAGE['part.in'].text({ part: 'Verse', bars: 8, bpm: 132, tuning: 'drop C' }),
      'Verse is in: 8 bars at 132, drop C. The band’s learning it.',
    );
  });
});
