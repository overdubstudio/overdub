// The guitar room's drummer, its plans (core/liveroom/guitar/beats.js, beats-grid.js; docs/research/GUITAR-ROOM.md §2.2,
// §2.7), moved from tools/liveroom/checks-drummer.js, which keeps the levels and the room: a part's beat is one step by
// you with the drums signed by the house, undone exactly, never over a clip you changed; a jam's bar is the same twice,
// a preview that leaves the song and History as they were; the riser's cards, each one step; a step's click; the tempo
// and a tap's.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import '../../app/src/devices/builtin/index.js';
import { planGuitarRoom } from '../../app/src/core/liveroom/guitar/setup.js';
import * as B from '../../app/src/core/liveroom/guitar/beats.js';
import * as G from '../../app/src/core/liveroom/guitar/beats-grid.js';

const snap = (p) => JSON.stringify({ tracks: p.tracks, room: p.room, sections: p.sections, tempo: p.tempo });

function club({ verse = true } = {}) {
  const store = createStore(createProject());
  const pl = planGuitarRoom(store.get(), {});
  store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
  if (verse)
    store.dispatch([{ type: 'section.add', section: { id: 's_verse', name: 'Verse', start: 0, length: 16 } }], {
      by: 'you',
      label: 'A verse',
    });
  return store;
}

test("the beats' plans", async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- Node: the plans */
  {
    const store = club(),
      p0 = store.get(),
      drums = p0.room.tracks.drums,
      n0 = store.history.length;
    const before = snap(p0);
    const bo = B.beatOps(p0, { section: 's_verse', beat: 'pin:p3' });
    const r = store.dispatch(bo.ops, { by: 'you', label: bo.label, reason: bo.reason });
    const p1 = store.get(),
      t1 = p1.tracks.find((t) => t.id === drums),
      c1 = t1.clips[0];
    const signed =
      c1 && c1.by === 'overdub' && c1.notes.every((n) => n.by === 'overdub') && store.history.at(-1).by === 'you';
    T.ok(
      r.ok &&
        store.history.length === n0 + 1 &&
        t1.clips.length === 1 &&
        c1.start === 0 &&
        c1.length === 16 &&
        p1.room.parts?.s_verse?.beat === 'pin:p3' &&
        signed,
      `a part's beat: one step by you ("${bo.label}", ${bo.ops.length} ops), the drums signed by the house (${c1?.notes.length} hits), the part's beat named (${p1.room.parts?.s_verse?.beat})`,
    );
    // swapped again: the house's clip replaced
    const bo2 = B.beatOps(store.get(), { section: 's_verse', beat: B.GUIDE_ID });
    store.dispatch(bo2.ops, { by: 'you', label: bo2.label, reason: bo2.reason });
    const t2 = store.get().tracks.find((t) => t.id === drums);
    T.ok(
      t2.clips.length === 1 && t2.clips[0].name === 'Guide' && bo2.ops.some((o) => o.type === 'clip.remove'),
      `swapped again, the house's clip goes and the new one takes its place (${t2.clips.map((c) => c.name).join(', ')})`,
    );
    store.undo();
    store.undo();
    T.ok(snap(store.get()) === before, 'both undone exactly: the song as it was before the first');
    // a clip you changed is yours
    store.redo();
    const t3 = store.get().tracks.find((t) => t.id === drums),
      cid = t3.clips[0].id;
    store.dispatch([{ type: 'notes.add', track: drums, clip: cid, notes: [{ p: 49, t: 0, d: 1, v: 0.9 }] }], {
      by: 'you',
      label: 'my crash',
    });
    const bo3 = B.beatOps(store.get(), { section: 's_verse', beat: 'pin:p4' });
    T.ok(
      bo3.kept && !bo3.ops.some((o) => /^clip\./.test(o.type)),
      `a part's drums you changed stay yours: only its beat is named (${bo3.ops.map((o) => o.type).join(', ') || 'no ops'})`,
    );
  }
  {
    const store = club(),
      p = store.get(),
      n0 = store.history.length,
      before = snap(p);
    const a = B.jamOps(p, { beat: 'pin:p3', from: 32, bars: 1, start: 16 }),
      b = B.jamOps(p, { beat: 'pin:p3', from: 32, bars: 1, start: 16 });
    const clip = a.ops[0]?.clip;
    const pv = store.preview(a.ops, { by: 'overdub' });
    const held = store.get().tracks.find((t) => t.id === p.room.tracks.drums).clips.length;
    pv.release();
    T.ok(
      JSON.stringify(a) === JSON.stringify(b) &&
        clip?.name === 'Jam' &&
        clip.by === 'overdub' &&
        clip.start === 32 &&
        clip.length === 4 &&
        clip.notes.length > 0,
      `a jam's bar is the same twice (${clip?.notes.length} hits, seeded), one clip named Jam by the house`,
    );
    T.ok(
      held === 1 && snap(store.get()) === before && store.history.length === n0,
      'heard through a preview, then released: the song and History as they were',
    );
    const g1 = B.jamOps(p, { beat: 'pin:p4', from: 16, bars: 1, start: 16 }).ops[0].clip.notes,
      g2 = B.jamOps(p, { beat: 'pin:p4', from: 20, bars: 1, start: 16 }).ops[0].clip.notes;
    T.ok(
      JSON.stringify(g1) !== JSON.stringify(g2),
      'each bar of a jam is its own (seeded by its bar: a drummer, not a loop)',
    );
  }
  {
    const store = club(),
      p0 = store.get(),
      before = snap(p0),
      n0 = store.history.length;
    const steps = [];
    const go = (what, pins, want) => {
      const pl = B.pinOps(store.get(), { pins });
      const r = store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      steps.push({
        what,
        ok: r.ok && pl.reason === 'room:pins' && pl.ops.length === 1 && (!want || want.test(pl.label)),
        label: pl.label,
      });
    };
    const pins = () => store.get().room.pins.map((x) => ({ ...x }));
    go(
      'unpin',
      pins().filter((x) => x.id !== 'p5'),
      /^Unpinned Half-time$/,
    );
    go(
      'pin',
      [...pins(), { id: G.nextPinId([...pins(), { id: 'p5' }]), groove: 'metal/gallop', name: 'Gallop 2' }],
      /^Pinned Gallop 2/,
    );
    go(
      'rename',
      pins().map((x) => (x.id === 'p2' ? { ...x, name: 'Chug' } : x)),
      /^Renamed Djent to Chug$/,
    );
    go('reorder', [pins()[1], pins()[0], ...pins().slice(2)], /new order/);
    const g = B.grooveOfBeat(store.get(), 'pin:p1');
    go(
      'edit',
      pins().map((x) => (x.id === 'p1' ? { ...x, hits: G.stepped(g, 'kick', 6) } : x)),
      /^Edited Guide$/,
    );
    const edited = B.grooveOfBeat(store.get(), 'pin:p1');
    const notes = B.jamOps(store.get(), { beat: 'pin:p1', from: 0, bars: 1 }).ops[0]?.clip.notes || [];
    go(
      'as written',
      pins().map((x) => {
        const { hits: _h, ...rest } = x;
        return rest;
      }),
      /^Edited Guide$/,
    );
    T.ok(
      steps.every((s) => s.ok) && store.history.length === n0 + steps.length,
      `the riser's cards, each one step by you: ${steps.map((s) => `${s.what} ("${s.label}")${s.ok ? '' : ' FAILED'}`).join(', ')}`,
    );
    T.ok(
      edited &&
        edited.hits.every((x) => Number.isFinite(x.p) && x.mark) &&
        notes.some((n) => n.p === 36 && Math.abs(n.t - 1.5) < 0.05),
      `an edited card plays: its hits whole again (${edited?.hits.length}), the kick added on step 7 heard (${notes.length} hits)`,
    );
    for (let i = 0; i < steps.length; i++) store.undo();
    T.ok(snap(store.get()) === before, 'all of them undone exactly');
    // the riser's beat on a card that goes
    store.dispatch([{ type: 'room.set', patch: { beat: 'pin:p3' } }], { by: 'you' });
    const pl = B.pinOps(store.get(), { pins: pins().filter((x) => x.id !== 'p3') });
    store.dispatch(pl.ops, { by: 'you' });
    T.ok(
      store.get().room.beat === 'modernmetal/double-kick-gallop',
      `unpinning the card the riser's on: the riser plays what it was made from (${store.get().room.beat})`,
    );
    const same = B.pinOps(store.get(), { pins: pins() });
    T.ok(!same.ops.length, 'the cards set as they are: no step');
  }
  {
    const g = B.GUIDE,
      a = G.stepped(g, 'snare', 6),
      b = G.stepped(
        { ...g, hits: B.grooveOfBeat({ room: { pins: [{ id: 'x', groove: B.GUIDE_ID, hits: a }] } }, 'pin:x').hits },
        'snare',
        6,
      );
    const c = G.stepped(
      { ...g, hits: B.grooveOfBeat({ room: { pins: [{ id: 'x', groove: B.GUIDE_ID, hits: b }] } }, 'pin:x').hits },
      'snare',
      6,
    );
    const at = (hs) =>
      hs
        .filter((x) => x.row === 'snare' && Math.abs(x.t - 1.5) < 0.01)
        .map((x) => x.v)
        .join();
    const orig = g.hits
        .map((x) => [x.t, x.row, x.v].join())
        .sort()
        .join('|'),
      back = c
        .map((x) => [x.t, x.row, x.v].join())
        .sort()
        .join('|');
    T.ok(
      at(a) === '0.8' && at(b) === '1' && at(c) === '' && orig === back,
      `a step's click: a hit (${at(a)}), an accent (${at(b)}), a rest, and the bar is as it was`,
    );
    const grid = G.rowsOf(B.GUIDE).map((r) => `${r.label} ${r.cells.join('')}`);
    T.ok(
      grid.join(' / ') === 'Hat 1000100010001000 / Snare 0000200000002000 / Kick 1000000010000000',
      `the guide's bar on the grid: ${grid.join(' / ')}`,
    );
  }
  {
    const store = club(),
      p = store.get();
    const t0 = G.planTempo(p, 140);
    store.dispatch(
      [
        {
          type: 'clip.add',
          track: p.room.tracks.guitarL,
          clip: { kind: 'audio', start: 0, length: 4, asset: 'a_x', name: 'Take 1' },
        },
      ],
      { by: 'you' },
    );
    const t1 = G.planTempo(store.get(), 140);
    T.ok(
      t0.ops.length === 1 && t0.label === 'Tempo 140' && !!t1.error && !t1.ops.length,
      `the tempo moves (${t0.label}) until a take is in ("${t1.error}")`,
    );
    T.ok(
      G.tapTempo([0, 500, 1000, 1500]) === 120 &&
        G.tapTempo([0, 500, 1000]) === null &&
        G.tapTempo([0, 500, 700, 1500]) === null,
      'a tap: four steady taps a half second apart are 120; three, or an uneven four, nothing',
    );
  }

  T.done();
});
