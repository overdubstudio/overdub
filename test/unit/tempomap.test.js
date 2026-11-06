// The tempo map (core/music.js "The tempo map", docs/ARCHITECTURE.md), in Node: the normaliser keeps a good map and drops
// a bad one whole; the conversions round-trip to 1e-9 s; tempo.map, time.insert / time.remove, section.duplicate and
// shiftMap on a mapped song; the MIDI and DAWproject exports. Moved from tools/tempomap-test.js; the renders and the
// browser stay there.
import { test } from 'node:test';
import { createStore } from '../../app/src/core/store.js';
import { cleanProject, createProject, LIMITS } from '../../app/src/core/project.js';
import { applyOp } from '../../app/src/core/ops.js';
import {
  beatToSec,
  secToBeat,
  tempoAt,
  timeline,
  mapNominal,
  mapInsert,
  mapRemove,
  shiftMap,
  mapSec,
  checkAnchors,
  MAP_ANCHORS,
} from '../../app/src/core/music.js';
import { gridClock } from '../../app/src/engine/clock.js';
import { encodeMidi } from '../../app/src/ui/export.js';
import { parseSmf } from '../../app/src/input/importers.js';
import { dawprojectXml } from '../../app/src/core/dawproject.js';
import { mapAnchors } from '../../tools/golden-scenes.js';
import { T } from './_t.js';

const ok = T.ok;
const clone = (x) => JSON.parse(JSON.stringify(x));
const canon = (p) => JSON.stringify({ ...p, meta: null });
const A = mapAnchors(); // 8 bars drifting 92 -> 96 BPM
const MAP = { anchors: A, clip: 'c_record' };

test('the normaliser (R1)', () => {
  const warns = [];
  const good = cleanProject({ ...createProject(), tempoMap: clone(MAP) }, { warn: (w) => warns.push(w) });
  ok(
    JSON.stringify(good.tempoMap) === JSON.stringify(MAP) && !warns.length,
    'a good map is kept exactly, with its clip',
  );
  ok(
    good.tempo === mapNominal(A) && good.tempo > 93 && good.tempo < 95,
    `tempo is the map's nominal tempo, the median segment's to 0.01 (${good.tempo})`,
  );
  const bad = {
    "a first anchor that isn't { 0, 0 }": [
      { beat: 0, sec: 0.1 },
      { beat: 4, sec: 2.5 },
    ],
    'beats that fall back': [
      { beat: 0, sec: 0 },
      { beat: 4, sec: 2.5 },
      { beat: 3, sec: 3 },
    ],
    'seconds that stand still': [
      { beat: 0, sec: 0 },
      { beat: 4, sec: 2.5 },
      { beat: 8, sec: 2.5 },
    ],
    'a segment at 600 BPM': [
      { beat: 0, sec: 0 },
      { beat: 4, sec: 0.4 },
    ],
    'a segment at 10 BPM': [
      { beat: 0, sec: 0 },
      { beat: 1, sec: 6 },
    ],
    'a NaN': [
      { beat: 0, sec: 0 },
      { beat: NaN, sec: 2 },
    ],
    'one anchor': [{ beat: 0, sec: 0 }],
    'too many anchors': Array.from({ length: MAP_ANCHORS + 1 }, (_, i) => ({ beat: i, sec: i * 0.5 })),
  };
  for (const [what, anchors] of Object.entries(bad)) {
    const w = [];
    const p = cleanProject({ ...createProject({ tempo: 101 }), tempoMap: { anchors } }, { warn: (x) => w.push(x) });
    ok(
      !('tempoMap' in p) && p.tempo === 101 && w.length === 1 && /tempo map was dropped/.test(w[0].message),
      `a map with ${what} is dropped whole, with a warning, and the song keeps its tempo (${w[0] && w[0].message.slice(0, 90)})`,
    );
  }
  ok(
    !('tempoMap' in cleanProject({ ...createProject(), tempoMap: 'x' }, { warn: () => {} })),
    "a map that isn't an object is dropped",
  );
  ok(!('tempoMap' in cleanProject(createProject())), 'a song without a map gets none');
  ok(
    LIMITS.anchors === 4096 &&
      checkAnchors(Array.from({ length: 4096 }, (_, i) => ({ beat: i, sec: i * 0.5 }))) === null,
    'LIMITS.anchors is 4,096, and a map of 4,096 anchors is kept',
  );
});

test('the conversions (R3)', () => {
  const p = cleanProject({ ...createProject(), tempoMap: clone(MAP) });
  let worst = 0;
  for (let b = -3; b < 40; b += 0.37)
    worst = Math.max(worst, (Math.abs(secToBeat(p, beatToSec(p, b)) - b) * 60) / tempoAt(p, b));
  for (let s = 0; s < 25; s += 0.29) worst = Math.max(worst, Math.abs(beatToSec(p, secToBeat(p, s)) - s));
  ok(
    worst < 1e-9,
    `beat -> seconds -> beat and back round-trip within 1e-9 s, before, inside and past the map (worst ${worst.toExponential(1)} s)`,
  );
  ok(
    A.every((a) => beatToSec(p, a.beat) === a.sec),
    "every anchor's beat is exactly its seconds",
  );
  ok(
    Math.abs(tempoAt(p, 1) - 92) < 1e-9 &&
      Math.abs(tempoAt(p, 31) - 96) < 1e-9 &&
      Math.abs(tempoAt(p, 100) - 96) < 1e-9,
    `tempoAt is each segment's tempo (bar 1 ${tempoAt(p, 1).toFixed(3)}, bar 8 ${tempoAt(p, 31).toFixed(3)}, past the map ${tempoAt(p, 100).toFixed(3)})`,
  );
  const plain = createProject({ tempo: 92 });
  const tl = timeline(plain, 3),
    spb = 60 / 92;
  const same =
    [0, 3, 4.25, 17.3, 100].every((b) => tl.sec(b) === (b - 3) * spb) &&
    [0, 0.4, 7.7].every((s) => tl.beat(s) === 3 + s / spb);
  ok(
    same && !tl.mapped && beatToSec(plain, 8) === (8 * 60) / 92 && secToBeat(plain, 3) === (3 * 92) / 60,
    "without a map the timeline is the renders' own expressions ((b - from) * spb, from + s / spb), bit for bit",
  );
  ok(beatToSec(4, 120) === 2 && secToBeat(2, 120) === 4, 'the old two-number forms still work');
  // kernels' clock: bpm() is the segment's tempo, the grid the map's
  let now = 0;
  const c = {
    get currentTime() {
      return now;
    },
  };
  const clock = gridClock(c, { bpm: 92, beatsPerBar: 4, from: 0, playing: true, timeline: timeline(p, 0) });
  now = A[3].sec + 0.01;
  const bpm3 = clock.bpm(),
    bar3 = clock.barAt(now);
  now = A[6].sec + 0.01;
  ok(
    Math.abs(bpm3 - tempoAt(p, 13)) < 1e-9 &&
      Math.abs(clock.bpm() - tempoAt(p, 25)) < 1e-9 &&
      Math.abs(bar3 - (3 + secToBeat(p, A[3].sec + 0.01) / 4 - 3)) < 1e-9,
    `gridClock on a map: bpm() is the segment's tempo (${bpm3.toFixed(3)}, then ${clock.bpm().toFixed(3)}) and bar lines fall on the anchors`,
  );
  const segs = clock.segments();
  ok(
    segs.length === A.length - 1 &&
      segs.every(
        (g, i) =>
          g.time === A[i].sec &&
          Math.abs(g.bpm - (60 * (A[i + 1].beat - A[i].beat)) / (A[i + 1].sec - A[i].sec)) < 1e-9,
      ),
    `the clock hands the kernels ${segs.length} segments, each at its anchor's seconds with its own tempo`,
  );
  ok(Math.abs(tempoAt(p, 4) - segs[1].bpm) < 1e-12, 'a beat on an anchor is in the segment that starts there');
});

test('nominal tempo, project.set, tempo.map (R5, R6)', () => {
  const s = createStore(cleanProject(createProject({ tempo: 120 })));
  const before = canon(s.get());
  let r = s.dispatch([{ type: 'tempo.map', map: clone(MAP) }], { by: 'overdub', label: 'map' });
  ok(
    r.ok && s.get().tempo === mapNominal(A) && JSON.stringify(s.get().tempoMap.anchors) === JSON.stringify(A),
    `tempo.map sets the map, and the tempo becomes its nominal ${s.get().tempo}`,
  );
  const mapped = canon(s.get());
  s.dispatch(
    [
      { type: 'track.add', ref: 'o', track: { name: 'Original', kind: 'audio', instrument: null } },
      {
        type: 'clip.add',
        track: '$o',
        clip: { id: 'c_record', kind: 'audio', start: 0, length: 32, asset: 'a_x', offset: 0, name: 'Original' },
      },
    ],
    { by: 'you' },
  );
  r = s.dispatch([{ type: 'project.set', patch: { tempo: 100 } }], { by: 'claude' });
  ok(
    !r.ok && /The grid follows Original\. Clear the map to set a tempo\./.test(r.error),
    `project.set { tempo } on a mapped song is refused: "${r.error}"`,
  );
  s.undo();
  ok(canon(s.get()) === mapped, 'undo of the clip: the mapped song');
  s.undo();
  ok(canon(s.get()) === before, 'undo of tempo.map gives back the song before it, tempo and all');
  s.redo();
  ok(canon(s.get()) === mapped, 'redo gives the mapped song again');
  r = s.dispatch([{ type: 'tempo.map', map: null }], { by: 'you' });
  ok(
    r.ok && !('tempoMap' in s.get()) && s.get().tempo === mapNominal(A),
    'tempo.map null clears it; the grid plays on at the nominal tempo',
  );
  s.undo();
  ok(canon(s.get()) === mapped, 'and its undo puts the map back exactly');
  r = s.dispatch(
    [
      {
        type: 'tempo.map',
        map: {
          anchors: [
            { beat: 0, sec: 0 },
            { beat: 4, sec: 0.1 },
          ],
        },
      },
    ],
    { by: 'claude' },
  );
  ok(!r.ok && /20\.\.400/.test(r.error), `a bad map is refused, not repaired (${r.error && r.error.slice(0, 80)})`);
  // the op on its own: apply, invert, apply
  const p = cleanProject(createProject({ tempo: 110 }));
  const p0 = canon(p);
  const inv = applyOp(p, { type: 'tempo.map', map: clone(MAP) }, { by: 'claude', refs: {} }).inverse;
  const p1 = canon(p);
  for (const o of inv) applyOp(p, o, { by: 'claude', refs: {} });
  const back = canon(p);
  applyOp(p, { type: 'tempo.map', map: clone(MAP) }, { by: 'claude', refs: {} });
  ok(back === p0 && canon(p) === p1, 'apply, invert, apply again: the same song each time');
});

test('time.insert / time.remove / section.duplicate (R7)', () => {
  const song = () => {
    const s = createStore(cleanProject(createProject({ tempo: 120 })));
    s.dispatch(
      [
        { type: 'track.add', ref: 'o', track: { name: 'Original', kind: 'audio', instrument: null } },
        {
          type: 'clip.add',
          track: '$o',
          clip: { id: 'c_record', kind: 'audio', start: 0, length: 32, asset: 'a_x', offset: 0, name: 'Original' },
        },
        { type: 'section.add', section: { name: 'Verse', start: 0, length: 16 } },
        { type: 'section.add', section: { name: 'Coda', start: 40, length: 8 } },
        { type: 'tempo.map', map: clone(MAP) },
      ],
      { by: 'you' },
    );
    return s;
  };
  // where a moment of the recording (seconds into its file) sits on the grid, from the song as it is
  const recSec = (p, beat) => {
    for (const t of p.tracks)
      for (const c of t.clips)
        if (beat >= c.start - 1e-9 && beat <= c.start + c.length + 1e-9 && c.asset === 'a_x')
          return c.offset + beatToSec(p, beat) - beatToSec(p, c.start);
    return null;
  };
  const s = song(),
    p0 = clone(s.get());
  let r = s.dispatch([{ type: 'time.insert', at: 10, length: 4 }], { by: 'you' });
  const p = s.get();
  ok(r.ok, 'time.insert at beat 10 on a mapped song');
  const before = [0, 3, 9.5].every((b) => Math.abs(beatToSec(p, b) - beatToSec(p0, b)) < 1e-12);
  const after = [10, 12, 20, 31].every(
    (b) => Math.abs(beatToSec(p, b + 4) - (beatToSec(p0, b) + (4 * 60) / tempoAt(p0, 10))) < 1e-9,
  );
  ok(
    before && after,
    'the grid before the point is untouched; after it, every beat moved by 4 beats and the seconds the map gives 4 beats at the point',
  );
  // the recording: its right half moved 4 beats; each moment of it is still on the beat it was
  const drift = [12, 20, 30].map((b) => Math.abs(recSec(p, b + 4) - recSec(p0, b)));
  // (within the 0.1 ms a clip offset is rounded to: arrangement.js r4)
  ok(
    drift.every((d) => d < 1e-4),
    `the recording after the point stays on its beats (worst ${(Math.max(...drift) * 1e3).toFixed(3)} ms, the offset's rounding)`,
  );
  s.undo();
  ok(canon(s.get()) === canon(p0), 'undo puts the map (and everything) back');
  r = s.dispatch([{ type: 'time.remove', at: 8, length: 4 }], { by: 'you' });
  const q = s.get();
  const kept = [0, 5, 7.9].every((b) => Math.abs(beatToSec(q, b) - beatToSec(p0, b)) < 1e-12);
  const closed = [12, 16, 25, 31].every(
    (b) => Math.abs(beatToSec(q, b - 4) - (beatToSec(p0, b) - (beatToSec(p0, 12) - beatToSec(p0, 8)))) < 1e-9,
  );
  const dr = [13, 20, 30].map((b) => Math.abs(recSec(q, b - 4) - recSec(p0, b)));
  ok(
    r.ok && kept && closed && dr.every((d) => d < 1e-4),
    `time.remove closes the map up with the recording (anchors inside go; the rest move back by 4 beats and their seconds; worst ${(Math.max(...dr) * 1e3).toFixed(3)} ms)`,
  );
  ok(
    checkAnchors(q.tempoMap.anchors) === null && Math.abs(tempoAt(q, 9) - tempoAt(p0, 13)) < 1e-9,
    'the map is still a good one, and the grid after the cut keeps its tempo',
  );
  s.undo();
  r = s.dispatch([{ type: 'section.duplicate', section: 'Verse' }], { by: 'claude' });
  ok(
    !r.ok && /This part follows a recording; copying it would break the grid/.test(r.error),
    `section.duplicate over the mapped span is refused: "${r.error}"`,
  );
  r = s.dispatch([{ type: 'section.duplicate', section: 'Coda' }], { by: 'claude' });
  ok(r.ok, 'a section past the map duplicates as before');
  // past the map: nothing to move
  const pm = clone(s.get().tempoMap);
  s.dispatch([{ type: 'time.insert', at: 60, length: 4 }], { by: 'you' });
  ok(
    JSON.stringify(s.get().tempoMap) === JSON.stringify(pm),
    'time inserted past the last anchor leaves the map alone',
  );
});

test('shiftMap (R8)', () => {
  const p0 = { tempoMap: MAP };
  const later = { tempoMap: shiftMap(MAP, 8) },
    spb0 = A[1].sec / 4;
  const moved = [0, 4, 13, 31].every((b) => Math.abs(beatToSec(later, b + 8) - (beatToSec(p0, b) + 8 * spb0)) < 1e-9);
  const back = shiftMap(later.tempoMap, -8);
  const same =
    back.anchors.length === A.length &&
    back.anchors.every((a, i) => Math.abs(a.beat - A[i].beat) < 1e-12 && Math.abs(a.sec - A[i].sec) < 1e-9);
  ok(
    moved && checkAnchors(later.tempoMap.anchors) === null,
    "shiftMap(map, 2 bars) moves every bar line 2 bars later, with the recording's seconds",
  );
  ok(same && back.clip === 'c_record', 'shiftMap back by 2 bars gives the map it was (within 1e-9 s)');
  ok(
    mapInsert(MAP, 40, 4).anchors.length === A.length && mapRemove(MAP, 40, 4).anchors.length === A.length,
    'insert or remove past the map changes nothing',
  );
});

test('MIDI and DAWproject exports (R9)', () => {
  const p = cleanProject({ ...createProject({ title: 'Map' }), tempoMap: clone(MAP) });
  p.tracks.push({
    ...p.tracks[0],
    id: 't_k',
    name: 'Keys',
    kind: 'instrument',
    instrument: { device: 'core.keys', params: {} },
    clips: [{ id: 'c_k', kind: 'notes', start: 0, length: 32, notes: [{ id: 'n1', p: 60, t: 0, d: 1, v: 0.8 }] }],
  });
  const ppq = 480;
  const smf = parseSmf(encodeMidi(p, { ppq }));
  const tempos = smf.tempos;
  let worstTicks = 0,
    sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    if (i) sec += ((tempos[i].beat - tempos[i - 1].beat) * tempos[i - 1].us) / 1e6;
    const want = mapSec(A, tempos[i].beat);
    worstTicks = Math.max(worstTicks, (Math.abs(sec - want) / (60 / tempoAt(p, tempos[i].beat))) * ppq);
  }
  ok(
    tempos.length === A.length && tempos.every((t, i) => Math.abs(t.beat - A[i].beat) < 1e-9),
    `the MIDI file has one tempo event per segment (the last runs on past the map), at each anchor's beat (${tempos.length})`,
  );
  ok(
    worstTicks < 1,
    `read back by importers.js, every anchor's time is within a tick (worst ${worstTicks.toFixed(3)} ticks)`,
  );
  const plain = parseSmf(encodeMidi(cleanProject(createProject({ tempo: 97 }))));
  ok(plain.tempos.length === 1 && Math.abs(plain.tempo - 97) < 0.01, 'a song without a map still writes its one tempo');
  const x = dawprojectXml(p, { audio: {} });
  const pts = x.project.match(/<RealPoint [^>]*interpolation="hold"/g) || [];
  ok(
    /<TempoAutomation[^>]*unit="bpm"/.test(x.project) && pts.length === A.length - 1,
    `the DAWproject export writes the map as tempo automation (${pts.length} held points)`,
  );
  const tid = /<Tempo id="(id\d+)"/.exec(x.project);
  ok(tid && new RegExp(`<Target parameter="${tid[1]}"`).test(x.project), "its points target the transport's tempo");
  ok(
    !/TempoAutomation/.test(dawprojectXml(createProject(), {}).project),
    'a song without a map has no tempo automation',
  );
});
