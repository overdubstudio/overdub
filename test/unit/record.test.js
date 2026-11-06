// Recording in the song, in Node (app/src/input/recorder.js, core/sounds.js): the commit plans (planTake: Layer, Fold, New
// take, take stacks and their undo), the pass map (passOf), joinSeams and pickActive across the loop's seam, where a
// take goes (newPartFor, soundsFor, the aim rules over a stub shell), and tuneOf. Moved from tools/record-test.js
// sections 1, 1b, 1c and 1d; the studio flows stay there.
import { test } from 'node:test';
import { createStore } from '../../app/src/core/store.js';
import { createProject, cleanProject } from '../../app/src/core/project.js';
import { demoProject } from '../../app/src/core/demo.js';
import {
  planTake,
  passRange,
  joinSeams,
  pickActive,
  createRecorder,
  takeSeconds,
} from '../../app/src/input/recorder.js';
import { beatToSec } from '../../app/src/core/music.js';
import { newPartFor, kindOfTake, soundsFor, familyOf, SOUND_SETS } from '../../app/src/core/sounds.js';
import { tuneOf } from '../../app/src/input/tap.js';
import { takeFolders, takeNumber, planClipTrim } from '../../app/src/core/arrangement.js';
import { passOf, passGrid } from '../../app/src/input/capture.js';
import { phrase, render as renderVoice } from '../../tools/hum-bench.js';
import { T } from './_t.js';

const t = T;
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((kk) => [kk, v[kk]]),
        )
      : v,
  );

test('take plans: Layer, Fold, New take, take folders, trims, undo', () => {
  // the pass map: a take from beat 6 in the loop [4, 12): pass 0 is 6..12, then the loop again and again
  const span = { g0: 6, b0: 6, loop: { start: 4, end: 12 }, wrap: 12 };
  const at4 = (g) => {
    const w = passOf(g, span);
    return `${w.pass}:${Math.round(w.beat * 1e4) / 1e4}`;
  };
  t.ok(
    [6, 11.5, 12, 19.99, 20, 30].map(at4).join(' ') === '0:6 0:11.5 1:4 1:11.99 2:4 3:6',
    `passOf: the unwrapped grid to (pass, song beat) across wraps (${[6, 11.5, 12, 19.99, 20, 30].map(at4).join(' ')})`,
  );
  t.ok(
    passGrid(0, span).join() === '6,12' &&
      passGrid(2, span).join() === '20,28' &&
      passGrid(0, { g0: 3, b0: 3, loop: null, wrap: Infinity }).join() === '3,Infinity',
    'passGrid: the grid each pass covers',
  );

  const song = cleanProject(demoProject());
  const drums = song.tracks.find((x) => x.name === 'Drums'),
    keys = song.tracks.find((x) => x.name === 'Keys');
  const beat = drums.clips[0];
  // Layer: hits over the Beat go into it, never a second clip, never a doubled hit
  const store = createStore(song);
  const before = canon(store.get().tracks);
  const dup = beat.notes[0];
  const lay = planTake(store.get(), {
    id: 'tk_test01',
    parts: [
      {
        track: drums.id,
        kind: 'notes',
        mode: 'layer',
        drums: true,
        name: 'Tapped beat',
        span: { start: 0, end: 32 },
        passes: [
          {
            n: 0,
            notes: [
              { p: 39, t: 4.5, d: 0.25, v: 0.8 },
              { p: dup.p, t: beat.start + dup.t, d: 0.25, v: 0.8 },
            ],
          },
          {
            n: 1,
            notes: [
              { p: 39, t: 4.5, d: 0.25, v: 0.9 },
              { p: 39, t: 6.5, d: 0.25, v: 0.7 },
            ],
          },
        ],
      },
    ],
  });
  t.ok(
    lay.ops.length === 1 &&
      lay.ops[0].type === 'notes.add' &&
      lay.ops[0].clip === beat.id &&
      lay.ops[0].notes.length === 2,
    `Layer: two passes' hits go into the Beat clip as one notes.add (${lay.ops.map((o) => o.type + ':' + (o.notes?.length ?? '')).join(', ')}): the repeat merges (louder wins), the hit already there isn't doubled`,
  );
  t.ok(
    lay.ops[0].notes.find((n) => n.t === 4.5)?.v === 0.9 &&
      /^Your beat is in: bars 1–2, 3 hits on Drums \(1 already there\)\.$/.test(lay.summary) &&
      lay.parts[0].notes === 3,
    `and says so, counting your own hits and their own bars (the one on a hit already there merged, and said so): "${lay.summary}"`,
  );
  // Layer onto an empty track: one clip over the take's span
  const s2 = createStore(createProject());
  const tr = s2.dispatch({ type: 'track.add', ref: 'd', track: { name: 'Beat', instrument: { device: 'core.drums' } } })
    .created.d;
  const lay2 = planTake(s2.get(), {
    id: 'tk_test02',
    parts: [
      {
        track: tr,
        kind: 'notes',
        mode: 'layer',
        drums: true,
        span: { start: 0, end: 8 },
        passes: [
          { n: 0, notes: [{ p: 36, t: 0, d: 0.25, v: 0.8 }] },
          { n: 1, notes: [{ p: 38, t: 5, d: 0.25, v: 0.8 }] },
        ],
      },
    ],
  });
  t.ok(
    lay2.ops.length === 1 &&
      lay2.ops[0].type === 'clip.add' &&
      lay2.ops[0].clip.start === 0 &&
      lay2.ops[0].clip.length === 8 &&
      lay2.ops[0].clip.notes.length === 2,
    `Layer on an empty track: one clip over the loop, bars 1–2, with both passes (${JSON.stringify(lay2.ops[0].clip && { start: lay2.ops[0].clip.start, length: lay2.ops[0].clip.length, notes: lay2.ops[0].clip.notes.length })})`,
  );

  // Fold (picked per track; Layer is a drum track's default): three passes round a 1-bar loop, a kick played once in pass 2 is left out, a snare
  // missed in pass 3 stays (two of three), and the toast counts it; one pass folds to itself (Layer's commit)
  const sF = createStore(createProject());
  const kF = sF.dispatch({ type: 'track.add', ref: 'd', track: { name: 'Kit', instrument: { device: 'core.drums' } } })
    .created.d;
  const BT = [
    [0, 36],
    [1, 38],
    [2, 36],
    [3, 38],
  ];
  const fp = (n, { extra = [], miss = null } = {}) => ({
    n,
    complete: true,
    clip: { start: 0, end: 4, from: 0, to: 4 },
    notes: [...BT.filter(([b, p]) => !(miss && miss[0] === b && miss[1] === p)), ...extra].map(([b, p]) => ({
      p,
      t: b,
      d: 0.25,
      v: 0.8,
    })),
  });
  const fold = planTake(sF.get(), {
    id: 'tk_test0f',
    bpb: 4,
    parts: [
      {
        track: kF,
        kind: 'notes',
        mode: 'fold',
        drums: true,
        loop: { start: 0, end: 4 },
        span: { start: 0, end: 4 },
        passes: [fp(0), fp(1, { extra: [[2.5, 36]] }), fp(2, { miss: [3, 38] })],
      },
    ],
  });
  const fNotes = fold.ops[0]?.clip?.notes.map((n) => `${n.p}@${n.t}`).join(' ');
  t.ok(
    fold.ops.length === 1 &&
      fNotes === '36@0 38@1 36@2 38@3' &&
      fold.parts[0].kept === 4 &&
      fold.parts[0].left === 1 &&
      fold.label === 'record Kit' &&
      /^Your beat is in: bar 1 on Kit, 3 times round\. Kept 4; left out 1\.$/.test(fold.summary),
    `Fold: three passes, a kick in one only is left out, a snare missed in one stays (${fNotes}; "${fold.summary}")`,
  );
  const fold1 = planTake(sF.get(), {
    id: 'tk_test0g',
    bpb: 4,
    parts: [
      {
        track: kF,
        kind: 'notes',
        mode: 'fold',
        drums: true,
        loop: { start: 0, end: 4 },
        span: { start: 0, end: 4 },
        passes: [fp(0, { extra: [[2.5, 36]] })],
      },
    ],
  });
  t.ok(
    fold1.ops[0]?.clip?.notes.length === 5 && /^Your beat is in: bar 1, 5 hits on Kit\.$/.test(fold1.summary),
    `one pass folds to itself: all 5 hits, as Layer puts them ("${fold1.summary}")`,
  );

  // New take over the Changes clip (beats 0–32), from bar 5: split at 16, the covered half muted into the take group,
  // two passes: the first muted, the last playing
  const take = planTake(store.get(), {
    id: 'tk_test03',
    parts: [
      {
        track: keys.id,
        kind: 'notes',
        mode: 'take',
        passes: [
          { n: 0, clip: { start: 16, end: 32 }, notes: [{ p: 60, t: 16.5, d: 1, v: 0.8 }] },
          { n: 1, clip: { start: 16, end: 32 }, notes: [{ p: 64, t: 17, d: 1, v: 0.8 }] },
        ],
      },
    ],
  });
  const r = store.dispatch(take.ops, { by: 'you', label: take.label });
  const k = store.track(keys.id);
  const group = k.clips.filter((c) => c.take === 'tk_test03');
  t.ok(
    r.ok && store.history.length === 1 && k.clips.length === 4 && group.length === 3,
    `one dispatch, one undo step: Keys has the first half, the covered half and two takes (${k.clips.map((c) => `${c.start}+${c.length}${c.mute ? ' muted' : ''}${c.take ? ' ' + c.take : ''}`).join(', ')})`,
  );
  const playing = group.filter((c) => !c.mute);
  t.ok(
    playing.length === 1 &&
      playing[0].name === 'Take 3' &&
      playing[0].notes.length === 1 &&
      playing[0].notes[0].p === 64 &&
      playing[0].notes[0].t === 1,
    `the last pass plays ("${playing[0]?.name}"), the first pass and the covered half are kept, muted`,
  );
  t.ok(
    /Take 3 is in on Keys, bars 5–8; Changes is muted\. One more underneath, muted\./.test(take.summary) &&
      take.label === 'record take 3 on Keys',
    `"${take.summary}" (${take.label})`,
  );
  t.ok(
    k.clips.find((c) => c.id === keys.clips[0].id).length === 16 &&
      !k.clips.find((c) => c.id === keys.clips[0].id).mute,
    'the part before bar 5 keeps playing',
  );
  store.undo();
  t.ok(canon(store.get().tracks) === before, 'undo takes the whole take out and puts the clip back exactly');
  // the next take over a take group joins it
  store.dispatch(take.ops, { by: 'you' });
  const again = planTake(store.get(), {
    id: 'tk_other1',
    parts: [
      {
        track: keys.id,
        kind: 'notes',
        mode: 'take',
        passes: [{ n: 0, clip: { start: 16, end: 32 }, notes: [{ p: 67, t: 18, d: 1, v: 0.8 }] }],
      },
    ],
  });
  store.dispatch(again.ops, { by: 'you' });
  const g2 = store.track(keys.id).clips.filter((c) => c.take === 'tk_test03');
  t.ok(
    g2.length === 4 && g2.filter((c) => !c.mute).length === 1 && g2.find((c) => !c.mute).name === 'Take 4',
    `recording over a take stack adds to it: ${g2.length} takes, one playing ("${g2.find((c) => !c.mute)?.name}")`,
  );
  // nothing played: nothing planned
  t.ok(
    planTake(store.get(), {
      id: 'tk_none01',
      parts: [
        { track: keys.id, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 0, end: 4 }, notes: [] }] },
      ],
    }).ops.length === 0,
    'an empty pass adds nothing',
  );
  // no track to record onto: the plan makes one
  const s3 = createStore(createProject());
  const mk = planTake(s3.get(), {
    id: 'tk_new001',
    parts: [
      {
        track: null,
        newTrack: { name: 'Keys', device: 'core.keys' },
        kind: 'notes',
        mode: 'take',
        passes: [{ n: 0, clip: { start: 0, end: 4 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }],
      },
    ],
  });
  const r3 = s3.dispatch(mk.ops, { by: 'you' });
  t.ok(
    r3.ok &&
      s3.get().tracks.length === 1 &&
      s3.get().tracks[0].clips.length === 1 &&
      s3.get().tracks[0].clips[0].take === 'tk_new001',
    'with no track, the take makes one (never a dead end)',
  );

  /* ---- fresh eyes 2: a take silences only what it recorded; one folder per range; trims give back; counts are yours */
  const ns = (ts) => ts.map((x) => ({ p: 60, t: x, d: 0.5, v: 0.8 }));
  const span8 = { g0: 16, b0: 16, loop: { start: 0, end: 32 }, wrap: 32 };
  // R at bar 5 with the loop on bars 1–8, played in bars 5–6, stopped in bar 7: the take is bars 5–6, not 5–8
  const pr = passRange({ span: span8, stopPass: 0, stopBeat: 25.3 }, { n: 0, notes: ns([16.5, 19, 22.75]) }, 4);
  t.ok(
    pr.start === 16 && pr.end === 24 && !pr.complete,
    `a take ends where you stopped (the bar line before the stop), not at the loop's end: played bars 5–6, stopped at beat 25.3 -> ${pr.start}..${pr.end}`,
  );
  const pr2 = passRange({ span: span8, stopPass: 0, stopBeat: 29.5 }, { n: 0, notes: ns([16.5]) }, 4);
  const pr3 = passRange(
    { span: span8, stopPass: 0, stopBeat: 24.6 },
    { n: 0, notes: [{ p: 60, t: 22, d: 2.6, v: 0.8 }] },
    4,
  );
  const pr4 = passRange({ span: span8, stopPass: 2, stopBeat: 5 }, { n: 1, notes: ns([3]) }, 4);
  t.ok(
    pr2.end === 28 && pr3.end === 28 && pr4.start === 0 && pr4.end === 32 && pr4.complete,
    `bars you passed through count, a note still sounding at the stop keeps its bar, a pass that ran round is the loop (${pr2.end}, ${pr3.end}, ${pr4.start}..${pr4.end})`,
  );
  // the take over the demo's Changes (bars 1–8), bars 5–6: only bars 5–6 are muted
  const sk = createStore(cleanProject(demoProject()));
  const kid = sk.get().tracks.find((x) => x.name === 'Keys').id,
    before2 = canon(sk.get().tracks);
  const changes = JSON.parse(JSON.stringify(sk.track(kid).clips[0]));
  const heardAt = (st, a, b) =>
    st
      .track(kid)
      .clips.filter((c) => !c.mute)
      .flatMap((c) => c.notes.map((n) => c.start + n.t))
      .filter((x) => x >= a - 1e-6 && x < b - 1e-6).length;
  const origIn = (a, b) => changes.notes.filter((n) => n.t >= a - 1e-6 && n.t < b - 1e-6).length;
  const t56 = planTake(sk.get(), {
    id: 'tk_fresh1',
    parts: [
      {
        track: kid,
        kind: 'notes',
        mode: 'take',
        passes: [{ n: 0, clip: { start: pr.start, end: pr.end }, notes: ns([16.5, 19, 22.75]) }],
      },
    ],
  });
  sk.dispatch(t56.ops, { by: 'you', label: t56.label });
  t.ok(
    heardAt(sk, 0, 16) === origIn(0, 16) &&
      heardAt(sk, 24, 32) === origIn(24, 32) &&
      heardAt(sk, 16, 24) === 3 &&
      /Take 2 is in on Keys, bars 5–6; Changes is muted\.$/.test(t56.summary),
    `the original plays on in bars 1–4 and 7–8 (${heardAt(sk, 0, 16)} and ${heardAt(sk, 24, 32)} notes heard), only bars 5–6 are your take: "${t56.summary}"`,
  );
  // loop bars 5–6: two passes and a third cut short by the stop, over the same bars: one folder, one entry per pass
  const tLoop = planTake(sk.get(), {
    id: 'tk_fresh2',
    parts: [
      {
        track: kid,
        kind: 'notes',
        mode: 'take',
        active: 1,
        passes: [
          { n: 0, clip: { start: 16, end: 24 }, notes: ns([17]) },
          { n: 1, clip: { start: 16, end: 24 }, notes: ns([18, 21.5]) },
          { n: 2, clip: { start: 16, end: 20 }, notes: ns([16.25]) },
        ],
      },
    ],
  });
  sk.dispatch(tLoop.ops, { by: 'you', label: tLoop.label });
  const folders = () => takeFolders(sk.track(kid));
  const f56 = folders().find((x) => x.start === 16);
  const names = f56.clips.map((c) => c.name).join(',');
  t.ok(
    folders().length === 1 &&
      f56.end === 24 &&
      f56.clips.every((c) => c.start === 16 && c.length === 8) &&
      names === 'Changes,Take 2,Take 3,Take 4,Take 5',
    `one take folder for bars 5–6, one entry per pass, every entry the same bars, numbered in folder order (${names})`,
  );
  const act = f56.playing;
  // (numbered in the order they were recorded: the passes are Takes 3, 4 and 5, and the complete second one plays)
  const byName = (nm) => f56.clips.find((c) => c.name === nm);
  t.ok(
    byName('Take 3').notes.some((n) => n.t === 1) &&
      act &&
      act.name === 'Take 4' &&
      act.notes.some((n) => n.t === 2) &&
      byName('Take 5').notes.some((n) => n.t === 0.25) &&
      /^Take 4 is in on Keys, bars 5–6; Take 2 is muted\. Three more underneath, muted, the pass you stopped in among them\.$/.test(
        tLoop.summary,
      ) &&
      tLoop.label === 'record take 4 on Keys',
    `stopped mid-pass: the last complete pass plays (${act?.name}), the cut-short pass is stacked under it, the takes numbered in the order they were played; the toast, the label, the badge and "take k of n" agree: "${tLoop.summary}" (${tLoop.label}; ${f56.clips.length} takes, ${act?.name} is ${f56.clips.indexOf(act) + 1} of ${f56.clips.length})`,
  );
  // a complete first pass, then a second the stop cut short: Take 1 is the first and plays, Take 2 the cut-short one
  // (fresh eyes 5: the complete first pass played as "Take 2", the later, cut-short pass was "Take 1")
  {
    const so = createStore(createProject());
    const to = so.dispatch({
      type: 'track.add',
      ref: 't',
      track: { name: 'Keys', instrument: { device: 'core.keys' } },
    }).created.t;
    const N2 = (p, b) => ({ p, t: b, d: 0.5, v: 0.8 });
    const po = planTake(so.get(), {
      id: 'tk_order01',
      bpb: 4,
      parts: [
        {
          track: to,
          kind: 'notes',
          mode: 'take',
          active: 0,
          natural: 0,
          passes: [
            {
              n: 0,
              complete: true,
              clip: { start: 0, end: 8, from: 0, to: 8 },
              notes: [N2(60, 0), N2(62, 1), N2(64, 2), N2(65, 3)],
            },
            { n: 1, complete: false, clip: { start: 0, end: 4, from: 0, to: 2.5 }, notes: [N2(67, 0), N2(69, 1)] },
          ],
        },
      ],
    });
    so.dispatch(po.ops, { by: 'you', label: po.label });
    const fo = takeFolders(so.track(to))[0],
      seen = fo.clips.map((c) => `${c.name}${c.mute ? '' : '*'}:${c.notes.map((n) => n.p).join(',')}`);
    t.ok(
      seen.join(' | ') === 'Take 1*:60,62,64,65 | Take 2:67,69' &&
        /^Take 1 is in on Keys, bars 1–2\. One more underneath, muted, the pass you stopped in among them\.$/.test(
          po.summary,
        ) &&
        po.label === 'record take 1 on Keys',
      `takes are numbered in the order they were recorded: the complete first pass is Take 1 and plays, the cut-short second is Take 2 (${seen.join(' | ')}; "${po.summary}")`,
    );
  }
  // the cut-short pass, picked, still plays the rest of the bars (what played there before fills it out)
  const frag = f56.clips.find((c) => c.name === 'Take 5');
  t.ok(
    frag.notes.some((n) => n.t >= 4),
    `picking the cut-short pass never leaves the rest of its bars silent (${frag.notes.length} notes over bars 5–6, ${frag.notes.filter((n) => n.t >= 4).length} of them from what played in bar 6)`,
  );
  // a take over other bars that overlap the folder (bars 6–8): no empty leftover pieces, each folder covers one range
  const bar6 = heardAt(sk, 20, 24),
    bar8 = heardAt(sk, 28, 32); // (what played there before this take)
  const tOver = planTake(sk.get(), {
    id: 'tk_fresh3',
    parts: [
      { track: kid, kind: 'notes', mode: 'take', passes: [{ n: 0, clip: { start: 20, end: 32 }, notes: ns([21]) }] },
    ],
  });
  const rO = sk.dispatch(tOver.ops, { by: 'you', label: tOver.label });
  const fs = folders();
  const tidy = fs.every(
    (f) =>
      f.clips.every((c) => c.start === f.start && c.start + c.length === f.end) &&
      f.clips.filter((c) => !c.mute).length === 1,
  );
  const empties = sk.track(kid).clips.filter((c) => c.take && c.mute && !c.notes.length && takeNumber(c));
  t.ok(
    rO.ok && tidy && !empties.length && heardAt(sk, 0, 16) === origIn(0, 16),
    `recording over part of a folder: each folder still covers one range with one take playing, no empty leftovers (${fs.map((f) => `${f.start}–${f.end}: ${f.clips.map((c) => c.name + (c.mute ? '' : '*')).join(',')}`).join('; ')})`,
  );
  // switching takes in any folder never leaves its bars silent where something played
  let silent = 0;
  for (const f of fs)
    for (const c of f.clips) {
      const pl = f.playing;
      if (pl.notes.length && !c.notes.length) silent++;
    }
  t.ok(
    !silent,
    `every take in every folder has the notes of its bars: switching never silences the range (${silent} empty)`,
  );
  // Trim to the loop: the take cut to bars 7–8; what it no longer covers (bar 6) plays again
  const big = fs.find((f) => f.start === 20);
  const trim = planClipTrim(sk.get(), { track: kid, clip: big.playing.id, start: 24, end: 32 });
  sk.dispatch(trim.ops, { by: 'you', label: 'trim clip to the loop' });
  t.ok(
    bar6 > 0 ? heardAt(sk, 20, 24) === bar6 : false,
    `trimming a take un-mutes what it no longer covers: bar 6 plays what played there before again (${heardAt(sk, 20, 24)} of ${bar6} notes): "${trim.summary}"`,
  );
  const leftEdge = planClipTrim(sk.get(), {
    track: kid,
    clip: folders().find((f) => f.start === 24).playing.id,
    start: 24,
    end: 28,
  });
  sk.dispatch(leftEdge.ops, { by: 'you', label: 'shorten clip' });
  t.ok(
    heardAt(sk, 28, 32) === bar8 && bar8 === origIn(28, 32),
    `and so does dragging its right edge in (bar 8: ${heardAt(sk, 28, 32)} of ${bar8} notes)`,
  );
  while (sk.canUndo()) sk.undo();
  t.ok(canon(sk.get().tracks) === before2, 'and every step undoes exactly');
});

test("the commit's edges (fresh eyes 3)", () => {
  const heardOn = (st, tid, a, b) =>
    st
      .track(tid)
      .clips.filter((c) => !c.mute)
      .flatMap((c) => (c.notes || []).map((n) => `${n.p}@${r4n(c.start + n.t)}`))
      .filter((x) => {
        const b0 = +x.split('@')[1];
        return b0 >= a - 1e-6 && b0 < b - 1e-6;
      })
      .sort();
  const r4n = (x) => Math.round(x * 1e4) / 1e4;
  // a punch out inside a bar: the take is bars 5–7, but the rest of bar 7 after the stop is still what played there
  const sp = createStore(cleanProject(demoProject()));
  const kp = sp.get().tracks.find((x) => x.name === 'Keys').id;
  const before = heardOn(sp, kp, 25.5, 28),
    beforeIn = heardOn(sp, kp, 16, 18);
  const ps = {
    n: 0,
    notes: [
      { p: 72, t: 17, d: 0.5, v: 0.8 },
      { p: 74, t: 25, d: 0.25, v: 0.8 },
    ],
  };
  const pr = passRange({ span: { g0: 16, b0: 16, loop: null, wrap: Infinity }, stopPass: 0, stopBeat: 25.5 }, ps, 4);
  const pl = planTake(sp.get(), {
    id: 'tk_punch1',
    parts: [{ track: kp, kind: 'notes', mode: 'take', passes: [{ ...ps, clip: pr }] }],
  });
  sp.dispatch(pl.ops, { by: 'you' });
  t.ok(
    pr.start === 16 &&
      pr.end === 28 &&
      pr.from === 16 &&
      pr.to === 25.5 &&
      before.length &&
      heardOn(sp, kp, 25.5, 28).join() === before.join(),
    `a punch out at beat 25.5: the take is bars 5–7 (${pr.start}..${pr.end}, recorded ${pr.from}..${pr.to}), and what played after the stop still plays (${heardOn(sp, kp, 25.5, 28).length} of ${before.length} notes)`,
  );
  // a punch in from a marker inside a bar: the beats before it are what played there
  sp.undo();
  const ps2 = {
    n: 0,
    notes: [
      { p: 72, t: 19, d: 0.5, v: 0.8 },
      { p: 74, t: 22, d: 0.5, v: 0.8 },
    ],
  };
  const pr2 = passRange({ span: { g0: 18, b0: 18, loop: null, wrap: Infinity }, stopPass: 0, stopBeat: 26.2 }, ps2, 4);
  sp.dispatch(
    planTake(sp.get(), {
      id: 'tk_punch2',
      parts: [{ track: kp, kind: 'notes', mode: 'take', passes: [{ ...ps2, clip: pr2 }] }],
    }).ops,
    { by: 'you' },
  );
  t.ok(
    pr2.start === 16 && pr2.from === 18 && beforeIn.length && heardOn(sp, kp, 16, 18).join() === beforeIn.join(),
    `a punch in at a marker on beat 18: the take starts at bar 5 but beats 16–18 still play what was there (${heardOn(sp, kp, 16, 18).length} of ${beforeIn.length} notes)`,
  );
  // the bars a take is on are the ones it was played in (a meter changed mid-take ends it on the old bars)
  const sm = createStore(cleanProject(demoProject()));
  const km = sm.get().tracks.find((x) => x.name === 'Keys').id;
  sm.dispatch({ type: 'project.set', patch: { meter: [3, 4] } }, { by: 'you' });
  const pm = planTake(sm.get(), {
    id: 'tk_meter1',
    bpb: 4,
    parts: [
      {
        track: km,
        kind: 'notes',
        mode: 'take',
        passes: [{ n: 0, clip: { start: 16, end: 20, from: 16, to: 19 }, notes: [{ p: 60, t: 16.5, d: 0.5, v: 0.8 }] }],
      },
    ],
  });
  t.ok(
    /Take 2 is in on Keys, bar 5; Changes is muted\./.test(pm.summary),
    `a take keeps the bars it was played in after a meter change ("${pm.summary}")`,
  );

  // an audio take begun inside the loop and stopped just after the wrap: nothing it doesn't play over goes quiet
  const sa = createStore(createProject());
  const ga = sa.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio' } }).created.g;
  sa.dispatch({
    type: 'clip.add',
    track: ga,
    clip: { kind: 'audio', start: 0, length: 16, asset: 'a_old', offset: 0, name: 'Rhythm' },
  });
  const pa = planTake(sa.get(), {
    id: 'tk_aud001',
    parts: [
      {
        track: ga,
        kind: 'audio',
        mode: 'take',
        active: 0,
        passes: [
          { n: 0, audio: { asset: 'a_new', offset: 0, start: 8, length: 8 } },
          { n: 1, audio: { asset: 'a_new', offset: 4, start: 0, length: 2 } },
        ],
      },
    ],
  });
  sa.dispatch(pa.ops, { by: 'you' });
  const au = sa.track(ga).clips.map((c) => `${c.name}@${c.start}+${c.length}${c.mute ? ' M' : ''}`);
  const playsAt = (b) =>
    sa
      .track(ga)
      .clips.filter((c) => !c.mute && b >= c.start && b < c.start + c.length)
      .map((c) => c.asset);
  t.ok(
    playsAt(2).join() === 'a_old' &&
      playsAt(5).join() === 'a_old' &&
      playsAt(10).join() === 'a_new' &&
      /bars 3–4/.test(pa.summary),
    `an audio take from bar 3 stopped after the wrap: bars 1–2 still play the old guitar, bars 3–4 the take (${au.join(', ')}; "${pa.summary}")`,
  );
  // a looped audio take over the whole loop: the passes stack in one folder as before
  const pa2 = planTake(sa.get(), {
    id: 'tk_aud002',
    parts: [
      {
        track: ga,
        kind: 'audio',
        mode: 'take',
        active: 1,
        passes: [
          { n: 0, audio: { asset: 'a_x', offset: 0, start: 0, length: 16 } },
          { n: 1, audio: { asset: 'a_x', offset: 10, start: 0, length: 16 } },
          { n: 2, audio: { asset: 'a_x', offset: 20, start: 0, length: 3 } },
        ],
      },
    ],
  });
  sa.dispatch(pa2.ops, { by: 'you' });
  const fx = takeFolders(sa.track(ga)).find((f) => f.clips.some((c) => c.asset === 'a_x'));
  t.ok(
    fx &&
      fx.clips.filter((c) => c.asset === 'a_x').length === 3 &&
      fx.playing?.asset === 'a_x' &&
      fx.playing.start === 0 &&
      fx.playing.length === 16 &&
      playsAt(2).join() === 'a_x',
    `three passes over the whole loop: three takes in one folder, the complete one playing bars 1–4 (${fx ? fx.clips.map((c) => c.name + (c.mute ? '' : '*')).join(', ') : 'no folder'})`,
  );

  // an audio take on a mapped song (a flip): the transport plays the map, so a loop pass lasts its bars' seconds on the
  // map, not the nominal tempo's (R3/R4); a trimmed pass's offset is the map's seconds too
  {
    const anchors = [{ beat: 0, sec: 0 }];
    for (let bar = 0; bar < 32; bar++) {
      const bpm = 66.9 + (3.3 * bar) / 31,
        a = anchors[anchors.length - 1];
      anchors.push({ beat: a.beat + 4, sec: Math.round((a.sec + (4 * 60) / bpm) * 1e6) / 1e6 });
    }
    const sm2 = createStore(createProject());
    sm2.dispatch({ type: 'tempo.map', map: { anchors } }, { by: 'you' });
    const mp = sm2.get(),
      span = { g0: 0, b0: 0, loop: { start: 0, end: 16 }, wrap: 16 };
    const tOf = takeSeconds(mp, span),
      loopSecs = beatToSec(mp, 16) - beatToSec(mp, 0),
      nominal = (16 * 60) / mp.tempo;
    const worst = Math.max(...[1, 2, 3, 4, 5].map((k) => Math.abs(tOf(16 * k) - k * loopSecs)));
    const mid = tOf(16 * 3 + 6) - (3 * loopSecs + beatToSec(mp, 6));
    t.ok(
      worst < 1e-9 && Math.abs(mid) < 1e-9 && Math.abs(loopSecs - nominal) > 0.1,
      `on a map a loop pass lasts its bars' seconds (${loopSecs.toFixed(3)} s for bars 1–4, not the nominal ${nominal.toFixed(3)} s): pass 5 starts ${(5 * (loopSecs - nominal)).toFixed(3)} s later than one tempo puts it`,
    );
    const g2 = sm2.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Voice', kind: 'audio' } }).created.g;
    const pm2 = planTake(sm2.get(), {
      id: 'tk_map001',
      parts: [
        {
          track: g2,
          kind: 'audio',
          mode: 'take',
          active: 1,
          passes: [
            { n: 0, audio: { asset: 'a_m', offset: 0, start: 0, length: 16 } },
            { n: 1, audio: { asset: 'a_m', offset: 20, start: 4, length: 8 } },
          ],
        },
      ],
    });
    sm2.dispatch(pm2.ops, { by: 'you' });
    const trimmed = sm2.track(g2).clips.find((c) => c.asset === 'a_m' && c.mute);
    t.ok(
      trimmed && Math.abs(trimmed.offset - (beatToSec(mp, 4) - beatToSec(mp, 0))) < 1e-4,
      `a pass trimmed to the take that plays starts at the map's seconds (offset ${trimmed?.offset} s, ${(beatToSec(mp, 4)).toFixed(4)} s on the map)`,
    );
  }

  // recording over a range that overlaps an earlier take folder: one name per entry, what played isn't a "Take N"
  const sn = createStore(cleanProject(demoProject()));
  const kn = sn.get().tracks.find((x) => x.name === 'Keys').id;
  const one = (st, a, b, p) =>
    st.dispatch(
      planTake(st.get(), {
        id: newTk(),
        parts: [
          {
            track: kn,
            kind: 'notes',
            mode: 'take',
            passes: [{ n: 0, clip: { start: a, end: b }, notes: [{ p, t: a + 0.5, d: 0.5, v: 0.8 }] }],
          },
        ],
      }).ops,
      { by: 'you' },
    );
  let tkN = 0;
  const newTk = () => 'tk_name' + String(++tkN).padStart(2, '0');
  one(sn, 16, 24, 72);
  one(sn, 16, 32, 74);
  const fo = takeFolders(sn.track(kn)).find((f) => f.start === 16 && f.end === 32);
  const nm = fo ? fo.clips.map((c) => c.name) : [];
  t.ok(
    fo &&
      new Set(nm).size === nm.length &&
      !takeNumber(fo.clips[0]) &&
      nm.slice(1).every((x, i) => x === `Take ${i + 2}`),
    `a take over bars 5–8 after one over bars 5–6: every entry has its own name, what played first and not a "Take N" (${nm.join(', ')})`,
  );
  // and fuzzed: overlapping takes never repeat a name in a folder
  let dupes = 0,
    tried = 0;
  for (let k = 0; k < 40; k++) {
    const a = 4 * Math.floor((k * 7) % 6),
      len = 4 * (1 + ((k * 5) % 3));
    one(sn, a, Math.min(32, a + len), 60 + (k % 12));
    tried++;
    for (const f of takeFolders(sn.track(kn))) {
      const ns = f.clips.map((c) => c.name);
      if (new Set(ns).size !== ns.length) dupes++;
    }
  }
  t.ok(!dupes, `${tried} overlapping takes: no folder ever holds two entries of one name (${dupes} did)`);

  // a pitched note ringing over the take's end isn't struck again there
  const sl = createStore(createProject());
  const pd = sl.dispatch({ type: 'track.add', ref: 'k', track: { name: 'Pad', instrument: { device: 'core.keys' } } })
    .created.k;
  sl.dispatch({
    type: 'clip.add',
    track: pd,
    clip: { kind: 'notes', start: 0, length: 32, name: 'Pad', notes: [{ p: 60, t: 20, d: 8, v: 0.8 }] },
  });
  sl.dispatch(
    planTake(sl.get(), {
      id: 'tk_tail02',
      parts: [
        {
          track: pd,
          kind: 'notes',
          mode: 'take',
          passes: [{ n: 0, clip: { start: 16, end: 24 }, notes: [{ p: 67, t: 17, d: 1, v: 0.8 }] }],
        },
      ],
    }).ops,
    { by: 'you' },
  );
  const ons = sl
    .track(pd)
    .clips.filter((x) => !x.mute)
    .flatMap((x) => x.notes.map((n) => `${n.p}@${x.start + n.t}`));
  t.ok(
    ons.join() === '67@17',
    `a note tied over the take's last bar line (C4 from beat 20) isn't struck again at beat 24 once the take replaces it (${ons.join(', ')})`,
  );
});

test("a phrase over the loop's seam stays one take (joinSeams, pickActive)", () => {
  const lp = { start: 0, end: 8 };
  const N = (p, t, d = 0.25) => ({ p, t, d, v: 0.8 });
  const ph = [60, 62, 63, 65, 67, 68, 70, 72];
  // R in bar 1 of a 2-bar loop: recording starts at bar 2, the tune runs on round the loop: 4 notes, then 4 more
  const head = ph.slice(0, 4).map((p, i) => N(p, 5 + i * 0.75)),
    tail = ph.slice(4).map((p, i) => N(p, i * 0.75));
  const j1 = joinSeams(
    [
      { n: 0, notes: head },
      { n: 1, notes: tail },
    ],
    lp,
    4,
  );
  t.ok(
    j1.passes.length === 1 &&
      j1.passes[0].n === 0 &&
      j1.passes[0].notes.length === 8 &&
      j1.passes[0].wrap &&
      j1.joins.length === 1 &&
      j1.joins[0].at === 'start' &&
      j1.joins[0].notes === 4,
    `joinSeams: a tune played on over the loop's end stays one pass, its tail at the loop's start (${j1.passes.map((x) => `pass ${x.n}: ${x.notes.map((n) => n.p + '@' + n.t).join(' ')}`).join('; ')})`,
  );
  // the pass it began in, wrapped, covers the whole loop: the take holds the tail too
  const span = { g0: 4, b0: 4, loop: lp, wrap: 8 };
  const pr = passRange({ span, stopPass: 2, stopBeat: 1 }, j1.passes[0], 4);
  t.ok(
    pr.start === 0 && pr.from === 0 && pr.end === 8 && pr.complete,
    `and its range is the whole loop, from the loop's start where the tail sits (${pr.start}..${pr.end}, recorded ${pr.from}..${pr.to})`,
  );
  // a rest at the seam: two phrases, two passes
  const j2 = joinSeams(
    [
      { n: 0, notes: head },
      { n: 1, notes: tail.map((x) => ({ ...x, t: x.t + 2.5 })) },
    ],
    lp,
    4,
  );
  // playing that fills every pass (a riff each time round): no pass to fold into, a take per time round
  const riff = (n) => ({ n, notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => N(60 + b, b)) });
  const j3 = joinSeams([riff(0), riff(1), riff(2)], lp, 4);
  // a phrase longer than the loop: neither side fits, it stays as played
  const j4 = joinSeams(
    [
      { n: 0, notes: [0, 1, 2, 3, 4, 5, 6, 7.5].map((b) => N(60, b)) },
      { n: 1, notes: [0.5, 1.5].map((b) => N(62, b)) },
    ],
    lp,
    4,
  );
  t.ok(
    j2.joins.length === 0 &&
      j2.passes.length === 2 &&
      j3.joins.length === 0 &&
      j3.passes.length === 3 &&
      j4.joins.length === 0,
    `and only then: a rest of 2.5 beats at the seam is two phrases (${j2.passes.length} passes), a riff filling every pass stays a take each (${j3.passes.length}), a phrase longer than the loop isn't folded onto itself (${j4.joins.length} joins)`,
  );
  // an earlier try at the loop's start, then a pickup at its end into the next pass: the pickup goes on into that pass
  const j5 = joinSeams(
    [
      { n: 0, notes: [N(60, 0), N(62, 1), N(64, 2), N(67, 7), N(69, 7.5)] },
      { n: 1, notes: [N(71, 0), N(72, 0.5), N(74, 1), N(76, 2)] },
    ],
    lp,
    4,
  );
  t.ok(
    j5.joins.length === 1 &&
      j5.joins[0].at === 'end' &&
      j5.passes[0].notes.map((x) => x.p).join() === '60,62,64' &&
      j5.passes[1].notes.map((x) => x.p).join() === '71,72,74,76,67,69',
    `a pickup before the seam goes on into the pass its phrase is in, when the pass it began in has another try at its start (${j5.passes.map((x) => x.notes.map((n) => n.p).join(',')).join(' | ')})`,
  );
  // a tail still ringing at the phrase's first note is cut there, never over it
  const j6 = joinSeams(
    [
      { n: 0, notes: [N(60, 4), N(62, 6), N(64, 7.5)] },
      { n: 1, notes: [N(65, 0), N(67, 3, 3)] },
    ],
    lp,
    4,
  );
  const cut = j6.passes[0].notes.find((x) => x.p === 67);
  t.ok(
    j6.passes.length === 1 && cut && cut.d === 1,
    `a tail note ringing into the phrase's first note is cut there (G4 at 3 for ${cut?.d} beat, was 3)`,
  );

  // the pass that plays: never a fragment over a fuller one
  const pa = pickActive([
    { n: 0, complete: true, notes: new Array(7).fill(0) },
    { n: 1, complete: true, notes: [0] },
  ]);
  const pb = pickActive([
    { n: 0, complete: true, notes: [0] },
    { n: 1, complete: false, notes: [0] },
  ]);
  const pc = pickActive([
    { n: 0, complete: true, notes: [0, 0] },
    { n: 1, complete: true, notes: new Array(8).fill(0) },
    { n: 2, complete: false, notes: [0, 0, 0] },
  ]);
  const pd = pickActive([
    { n: 0, complete: true, notes: [0] },
    { n: 1, complete: false, notes: new Array(8).fill(0) },
  ]);
  t.ok(
    pa.n === 0 && pa.natural === 1 && pb.n === 0 && pc.n === 1 && pd.n === 1,
    `pickActive: a last pass of 1 note under one of 7 lets the 7 play (${pa.n}); passes alike still play the last complete one (${pb.n}, ${pc.n}); a cut-short pass that holds the whole tune plays over a 1-note one (${pd.n})`,
  );

  // the plan says what happened, in plain words
  const song = cleanProject(demoProject());
  const s = createStore(song);
  const tune = s.dispatch(
    { type: 'track.add', ref: 't', track: { name: 'Tune', instrument: { device: 'core.keys' } } },
    { by: 'you' },
  ).created.t;
  const planOf = (passes, extra) =>
    planTake(s.get(), {
      id: 'tk_seam01',
      bpb: 4,
      parts: [{ track: tune, kind: 'notes', mode: 'take', passes, ...extra }],
    });
  const whole = planOf([{ n: 0, complete: true, clip: pr, notes: j1.passes[0].notes }], {
    active: 0,
    natural: 0,
    joins: j1.joins,
  });
  s.dispatch(whole.ops, { by: 'you' });
  const plays = s.track(tune).clips.filter((c) => !c.mute);
  t.ok(
    plays.length === 1 &&
      plays[0].notes.length === 8 &&
      plays[0].start === 0 &&
      plays[0].length === 8 &&
      whole.summary ===
        "Take 1 is in on Tune, bars 1–2. Your phrase ran past the loop's end and is kept whole: its last 4 notes come round at bar 1.",
    `one take plays all 8 notes over bars 1–2: "${whole.summary}"`,
  );
  s.undo();
  const fr = planOf(
    [
      {
        n: 0,
        complete: true,
        clip: { start: 0, end: 8, from: 0, to: 8 },
        notes: ph.slice(0, 7).map((p, i) => N(p, 4 + i * 0.5)),
      },
      { n: 1, complete: true, clip: { start: 0, end: 8, from: 0, to: 8 }, notes: [N(67, 7)] },
    ],
    { active: 0, natural: 1 },
  );
  s.dispatch(fr.ops, { by: 'you' });
  const fp = s.track(tune).clips.filter((c) => !c.mute);
  t.ok(
    fp.length === 1 &&
      fp[0].notes.length === 7 &&
      fr.summary ===
        'Take 1 is in on Tune, bars 1–2. One more underneath, muted. The last time round had only 1 note, so the fuller take plays (7 notes).',
    `the fuller pass plays and the toast says why, without calling the 1-note pass the one you stopped in: "${fr.summary}"`,
  );
});

test('where a take goes: newPartFor, soundsFor, aim rules, tuneOf', async () => {
  // a recorder over a stub shell: the store, the selection, a view; nothing sounds
  const rig = (view, build) => {
    const store = createStore(createProject());
    const ids = build ? build(store) : {};
    const fns = new Map();
    const ui = {
      state: { selection: { track: null } },
      on: (k, fn) => {
        if (!fns.has(k)) fns.set(k, new Set());
        fns.get(k).add(fn);
        return () => fns.get(k).delete(fn);
      },
      emit: (k, d) => {
        for (const fn of fns.get(k) || []) fn(d);
      },
      toast() {},
      announce() {},
    };
    ui.select = (x) => {
      Object.assign(ui.state.selection, x);
      ui.emit('select', ui.state.selection);
    };
    const app = { store, engine: { playing: false, on() {} }, ui, devices: { getDevice: () => null } };
    const events = [];
    const input = {
      emit: (k, d) => events.push([k, d]),
      capture: { add: () => null, flush() {} },
      options: { grid: 0.25 },
    };
    const rec = createRecorder(app, input, { view });
    return { store, ui, rec, ids, events, input, name: (id) => store.track(id)?.name || null };
  };
  const add = (store, name, device, clips = []) =>
    store.dispatch({ type: 'track.add', ref: 'x', track: { name, instrument: { device }, clips } }).created.x;
  // a take onto a track, as the commit leaves it: a clip, then the recorder told
  const takeOn = (R, kind, track, start = 0) => {
    R.store.dispatch({
      type: 'clip.add',
      track,
      clip: { kind: 'notes', start, length: 8, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] },
    });
    R.rec.took(kind, track);
    R.ui.select({ track });
  };

  // newPartFor: one name and first sound per kind, then "Melody 2"
  t.ok(
    JSON.stringify(newPartFor('hum', createProject())) === '{"name":"Melody","device":"core.keys"}' &&
      newPartFor('keys', null).name === 'Keys' &&
      newPartFor('pads', null).device === 'core.drums' &&
      newPartFor('beatbox', null).name === 'Drums',
    'newPartFor: Melody, Keys, Drums (Lamp Tines, Lamp Tines, Gobo Kit)',
  );
  t.ok(
    newPartFor('hum', { tracks: [{ name: 'Melody' }, { name: 'melody 2' }] }).name === 'Melody 3',
    'and the next free name: Melody 3',
  );
  // kindOfTake: a hum is a hum in any register (hum before bass)
  const line = (ps) => ps.map((p, i) => ({ p, t: i, d: 1 }));
  t.ok(
    kindOfTake({ src: 'hum', notes: line([60, 64, 67, 69]) }) === 'hum' &&
      kindOfTake({ src: 'hum', notes: line([45, 47, 48]) }) === 'hum' &&
      kindOfTake({ src: 'midi', notes: line([36, 40, 43]) }) === 'bass' &&
      kindOfTake({ src: 'midi', notes: [0, 1, 2].flatMap((b) => [60, 64, 67].map((p) => ({ p, t: b, d: 1 }))) }) ===
        'chords' &&
      kindOfTake({ kind: 'drums', src: 'tap', notes: [] }) === 'drums' &&
      kindOfTake({ src: 'qwerty', notes: line([60, 62, 64]) }) === 'played',
    'kindOfTake: a hummed C4–A4 line and a hummed A2–C3 line are hums, a played low line is bass, triads are chords, a tapped beat is drums',
  );
  // soundsFor: the hum set, its fallbacks, the current sound first, no doubles, every row a family
  const ids = (rs) => rs.map((r) => r.device + (r.preset ? ':' + r.preset : '')).join(',');
  const hs = soundsFor('hum');
  t.ok(
    ids(hs) === 'core.keys,core.wavetable,core.strings,claude.choir-loft' && hs.every((r) => r.family),
    `soundsFor hum: ${ids(hs)}`,
  );
  t.ok(
    ids(soundsFor('hum', { has: (id) => id !== 'claude.choir-loft' })).endsWith('core.mallets'),
    'without Choir Loft the fourth is Mallet Bag',
  );
  const cw = soundsFor({ src: 'hum' }, { current: 'core.wavetable' });
  t.ok(
    cw.length === 4 &&
      cw[0].device === 'core.wavetable' &&
      cw[0].now &&
      cw.filter((r) => r.device === 'core.wavetable').length === 1,
    `current first, kept to four: ${ids(cw)}`,
  );
  const dk = soundsFor('drums', { current: 'core.drums', currentPreset: 'Studio kit' });
  t.ok(
    dk.filter((r) => r.device === 'core.drums' && r.preset === 'Studio kit').length === 1 && dk.every((r) => r.family),
    `a kit on Studio kit isn't listed twice: ${ids(dk)}`,
  );
  t.ok(
    familyOf(
      { device: 'core.wavetable', preset: 'Low Key' },
      { blurb: 'x', presets: [{ name: 'Low Key', blurb: 'Bass: deep and round' }] },
    ) === 'Bass' && familyOf({}, { blurb: 'Electric piano with bark' }) === '',
    "familyOf: the blurb's words before its colon",
  );
  const { BUILTINS } = await import('../../app/src/devices/builtin/index.js');
  const { LIBRARY } = await import('../../app/src/devices/library/index.js');
  const findDef = (id) => [...BUILTINS, ...LIBRARY].find((d) => d && d.id === id) || null;
  const bad = Object.values(SOUND_SETS)
    .flatMap((S) => [...S.rows, ...S.fallbacks])
    .filter((r) => {
      const d = findDef(r.device);
      return !d || (r.preset && !(d.presets || []).some((x) => x.name === r.preset));
    });
  t.ok(
    !bad.length,
    `every id and preset in SOUND_SETS is a real device (${bad.map((r) => r.device + ':' + (r.preset || '')).join(', ') || 'all found'})`,
  );

  // the simple view
  {
    const R = rig('simple', (s) => ({ drums: add(s, 'Drums', 'core.drums') }));
    const { drums } = R.ids;
    R.ui.select({ track: drums });
    t.ok(
      R.rec.aim('hum').track === null && R.rec.aim('hum').why === 'new' && R.rec.targetFor('keys') === null,
      `simple: Drums selected, a hum and the keys aim at a new track (${JSON.stringify(R.rec.aim('hum'))})`,
    );
    t.ok(
      R.rec.aim('pads').track === drums,
      `the pads aim at the song's only kit (${JSON.stringify(R.rec.aim('pads'))})`,
    );
    const mel = add(R.store, 'Melody', 'core.keys');
    takeOn(R, 'hum', mel);
    R.ui.select({ track: drums });
    t.ok(
      R.rec.aim('hum').track === mel && R.rec.aim('hum').why === 'last',
      `the second hum goes onto Melody, the last hum's track (${JSON.stringify(R.rec.aim('hum'))})`,
    );
    const bass = add(R.store, 'Bass', 'core.bass', [
      { kind: 'notes', start: 0, length: 4, notes: [{ p: 36, t: 0, d: 1 }] },
    ]);
    R.ui.select({ track: bass });
    t.ok(
      R.rec.aim('hum').track === bass && R.rec.aim('hum').why === 'selected',
      'selecting Bass after the last hum aims the next hum at Bass',
    );
    R.rec.setAim('hum', drums);
    t.ok(
      R.rec.targetFor('hum')?.id === drums && R.rec.aim('hum').why === 'choice' && R.events.length >= 0,
      'setAim(hum, Drums) puts a hum on Drums (a choice)',
    );
    // 'new' is one-shot: once its take is in, the next goes onto that track, never a Melody 2
    R.rec.setAim('hum', 'new');
    t.ok(R.rec.aim('hum').track === null, 'setAim(hum, new): a new track');
    const m2 = add(R.store, newPartFor('hum', R.store.get()).name, 'core.keys');
    takeOn(R, 'hum', m2);
    R.ui.select({ track: drums });
    t.ok(
      R.rec.aim('hum').track === m2 && R.name(m2) === 'Melody 2',
      `after that take, the next hum's aim is that track (${R.name(R.rec.aim('hum').track)}), not another new one`,
    );
    let aims = 0;
    R.rec.on('aim', () => aims++);
    R.rec.setAim('keys', null);
    t.ok(aims > 0, "setAim emits 'aim'");
  }
  {
    // pads after a reload (no last take): the only Drums, nothing selected; two kits and none picked: a new one
    const R = rig('simple', (s) => ({
      drums: add(s, 'Drums', 'core.drums', [{ kind: 'notes', start: 0, length: 4, notes: [{ p: 36, t: 0, d: 0.25 }] }]),
    }));
    t.ok(
      R.rec.aim('pads').track === R.ids.drums && R.rec.aim('pads').why === 'only-kit',
      'pads after a reload: onto the only drum track',
    );
    add(R.store, 'Drums 2', 'core.drums');
    t.ok(R.rec.aim('pads').track === null, 'two kits, none picked or selected: a new one');
  }
  // the full studio: the armed track first; 'new' disarms; arming by hand clears the choice; no first-pitched fallback
  {
    const R = rig('full', (s) => ({
      bass: add(s, 'Bass', 'core.bass'),
      keys: add(s, 'Keys', 'core.keys'),
      drums: add(s, 'Drums', 'core.drums'),
    }));
    const { bass, keys, drums } = R.ids;
    R.ui.select({ track: drums });
    t.ok(
      R.rec.targetFor('hum') === null && R.rec.targetFor('keys')?.id === drums,
      `full: Drums selected, nothing armed: a hum aims at a new track, not at Bass (${R.name(R.rec.targetFor('hum')?.id)}); the keys play the selected Drums as before`,
    );
    R.store.dispatch({ type: 'track.set', track: keys, patch: { arm: true } }, { by: 'you' });
    t.ok(
      R.rec.targetFor('hum')?.id === keys && R.rec.aim('hum').why === 'armed',
      "an armed Keys takes the hum (today's rule)",
    );
    R.input.sketchMode = 'hum'; // (Hum it open: R records the hum, so the lit R speaks for it)
    t.ok(R.rec.target === keys && R.rec.lands()?.id === keys, 'in Hum it the lit R is the armed Keys');
    R.rec.setAim('hum', 'new');
    t.ok(
      R.rec.targetFor('hum') === null &&
        !R.store.get().tracks.some((x) => x.arm) &&
        R.rec.target === null &&
        R.rec.lands() === null &&
        R.store.history.at(-1).label === 'record onto a new track' &&
        R.store.history.at(-1).by === 'you',
      `setAim(hum, new) overrides it and disarms every track, one step by you ("${R.store.history.at(-1).label}"), and nothing is lit`,
    );
    R.input.sketchMode = null;
    R.store.dispatch({ type: 'track.set', track: bass, patch: { arm: true } }, { by: 'you', label: 'arm Bass' });
    t.ok(
      R.rec.aim('hum').track === bass && R.rec.aim('hum').why === 'armed',
      `arming a track by hand afterwards clears the choice (${JSON.stringify(R.rec.aim('hum'))})`,
    );
    R.rec.setAim('hum', keys);
    t.ok(
      R.store.track(keys).arm && !R.store.track(bass).arm && R.rec.aim('hum').track === keys,
      'picking a track in Onto arms it, the other arm gives way',
    );
    R.ui.select({ track: bass });
    t.ok(R.rec.aim('hum').why !== 'choice', 'selecting another track by hand is the newer act: the choice gives way');
  }
  // the commit plan: a take over other bars stacks nothing; over the same bars it says what it muted
  {
    const st = createStore(createProject());
    const mel = st.dispatch({
      type: 'track.add',
      ref: 'm',
      track: { name: 'Melody', instrument: { device: 'core.keys' } },
    }).created.m;
    const take1 = planTake(st.get(), {
      id: 'tk_aim001',
      parts: [
        {
          track: mel,
          kind: 'notes',
          mode: 'take',
          kinds: ['hum'],
          passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }],
        },
      ],
    });
    st.dispatch(take1.ops, { by: 'you' });
    const beside = planTake(st.get(), {
      id: 'tk_aim002',
      parts: [
        {
          track: mel,
          kind: 'notes',
          mode: 'take',
          passes: [{ n: 0, clip: { start: 8, end: 16 }, notes: [{ p: 64, t: 8, d: 1, v: 0.8 }] }],
        },
      ],
    });
    const d2 = st.dispatch(beside.ops, { by: 'you' });
    t.ok(
      d2.ok &&
        !beside.parts[0].stacked &&
        st.track(mel).clips.every((c) => !c.mute) &&
        !/muted/.test(beside.summary) &&
        take1.parts[0].kinds.join() === 'hum',
      `a take over other bars is a clip beside the first, nothing muted ("${beside.summary}")`,
    );
    const over = planTake(st.get(), {
      id: 'tk_aim003',
      parts: [
        {
          track: mel,
          kind: 'notes',
          mode: 'take',
          passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 67, t: 0, d: 1, v: 0.8 }] }],
        },
      ],
    });
    t.ok(
      over.parts[0].stacked &&
        over.parts[0].stacked.names.join() === 'Take 1' &&
        /^Take 2 is in on Melody, bars 1–2; Take 1 is muted\.$/.test(over.summary),
      `one over the same bars stacks as Take 2 and says so: "${over.summary}" (${JSON.stringify(over.parts[0].stacked)})`,
    );
  }
  // Put it on its own track: one step, the take on a new Melody with the same sound, Take 1 playing again
  {
    const R = rig('simple', (s) => ({ mel: add(s, 'Melody', 'core.wavetable') }));
    const { mel } = R.ids;
    R.store.dispatch(
      planTake(R.store.get(), {
        id: 'tk_own001',
        parts: [
          {
            track: mel,
            kind: 'notes',
            mode: 'take',
            passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] }],
          },
        ],
      }).ops,
      { by: 'you' },
    );
    const pl = planTake(R.store.get(), {
      id: 'tk_own002',
      parts: [
        {
          track: mel,
          kind: 'notes',
          mode: 'take',
          passes: [{ n: 0, clip: { start: 0, end: 8 }, notes: [{ p: 64, t: 0, d: 1, v: 0.8 }] }],
        },
      ],
    });
    const d = R.store.dispatch(pl.ops, { by: 'you' });
    const act = R.store.track(mel).clips.find((c) => !c.mute),
      was = R.store.track(mel).clips.find((c) => c.mute);
    const n0 = R.store.history.length;
    const own = R.rec.ownTrack({
      track: mel,
      clip: act.id,
      kind: 'hum',
      names: ['Take 1'],
      unmute: pl.parts[0].stacked.unmute.map((u) => d.created[u] || u),
    });
    const nt = R.store.track(own.track),
      moved = nt && nt.clips[0];
    t.ok(
      own.ok &&
        R.store.history.length === n0 + 1 &&
        nt.name === 'Melody 2' &&
        nt.instrument.device === 'core.wavetable' &&
        moved &&
        moved.id === act.id &&
        !moved.take &&
        !moved.mute &&
        !R.store.track(mel).clips.find((c) => c.id === was.id).mute &&
        R.rec.aim('hum').track === nt.id,
      `Put it on its own track: one undo step, ${nt?.name} on Light Table with the take, Take 1 playing again on Melody ("${own.text}")`,
    );
    R.store.undo();
    t.ok(
      !R.store.track(own.track) && R.store.track(mel).clips.filter((c) => !c.mute).length === 1,
      'and one undo puts the stack back',
    );
  }
  // the keys' track: made when the keys start, selected, said
  {
    const R = rig('simple', (s) => ({ drums: add(s, 'Drums', 'core.drums') }));
    R.ui.select({ track: R.ids.drums });
    const k = R.rec.keysTrack();
    const said = R.events.find((e) => e[0] === 'keys:track');
    t.ok(
      k &&
        k.name === 'Keys' &&
        k.instrument.device === 'core.keys' &&
        R.ui.state.selection.track === k.id &&
        said &&
        said[1].text === 'Keys play a new track, Keys (Lamp Tines). Undo takes it away.' &&
        R.rec.keysTrack().id === k.id,
      `the keys aimed at a new track: keysTrack makes Keys (Lamp Tines), selected, said once ("${said?.[1].text}"), and the next call plays it`,
    );
    R.ui.select({ track: R.ids.drums });
    t.ok(
      R.rec.targetFor('keys')?.id === k.id,
      "selecting Drums afterwards: the keys still play Keys (a drum track is the keys' only when picked)",
    );
  }
  // the Beatbox catch: a hummed voice reads as a tune, noise bursts on the beat don't
  {
    const sr = 22050,
      voice = renderVoice(
        phrase(
          [60, 64, 67, 69, 67, 64, 62, 60].map((m) => ({ m, beats: 1, gap: 0.1 })),
          { tempo: 90 },
        ),
        sr,
      );
    const x = voice.x || voice.samples || voice;
    const tn = tuneOf(x, sr, { tempo: 90 });
    const bursts = new Float32Array(sr * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let b = 0; b < 8; b++) {
      const i0 = Math.round(b * 0.5 * sr);
      for (let i = 0; i < sr * 0.06; i++) bursts[i0 + i] = rnd() * 0.6 * Math.exp(-i / (sr * 0.015));
    }
    const nb = tuneOf(bursts, sr, { tempo: 120 });
    t.ok(
      tn && tn.notes >= 6 && !nb,
      `tuneOf: a hum is a tune (${tn ? `${tn.notes} notes, confident on ${Math.round(tn.conf * 100)}%, ${tn.perBeat} onsets a beat` : 'not heard'}); beatbox bursts are not (${nb ? JSON.stringify({ n: nb.notes, c: nb.conf }) : 'none'})`,
    );
  }
});
