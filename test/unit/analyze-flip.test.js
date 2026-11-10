// The Node half of tools/analyze-test.js: BeatBench's gates on its 16 seeded songs, one song closely, the input order,
// the ops a result becomes, section.key, keyOf, the cache and a cancel. The Chromium half (a Worker, IndexedDB) stays
// in tools/analyze-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSong } from '../../tools/fake-wav.js';
import { runBench, passes, GATES, benchSpec, scoreSong } from '../../tools/beat-bench.js';
import { analyze, pickInput, ANALYZER_VERSION } from '../../app/src/audio/analyze/index.js';
import { resultToOps, readingOps, flipSummary } from '../../app/src/audio/analyze/toOps.js';
import { analyzeAudio } from '../../app/src/audio/analyze/client.js';
import { inputKey, createAnalysisCache } from '../../app/src/audio/analyze/cache.js';
import { beatToSec, checkAnchors, mapSec, parsePc } from '../../app/src/core/music.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject, cleanProject } from '../../app/src/core/project.js';
import { keyOf } from '../../app/src/audio/measure.js';

const ok = (cond, msg) => assert.ok(cond, msg);
const T = { note() {} };

/* ------------------------------------------------------------------ the bench (R18) */
test('the bench (R18)', () => {
  const t0 = performance.now();
  const { rows, totals: B } = runBench({ n: 16, seed: 1 });
  const P = passes(B);
  const pct = (x) => (100 * x).toFixed(1) + '%';
  ok(P.beatF, `beats: F-measure ${B.beatF.toFixed(3)} over ${B.songs} songs (gate ${GATES.beatF})`);
  ok(P.tempoAmong, `tempo: the right one among the readings on ${pct(B.tempoAmong)} of songs (gate: every song)`);
  ok(P.tempoFirst, `tempo: the right one first on ${pct(B.tempoFirst)} (gate 90%)`);
  ok(P.downbeat, `downbeats: the bar lines right on ${pct(B.downbeat)} of songs (gate 90%)`);
  ok(P.mapMs, `the map: ${B.mapMs.toFixed(1)} ms from the true beats, median, outside free spans (gate 15 ms)`);
  ok(P.chords, `chords: ${pct(B.chords)} of the chord time named right, major or minor (gate 85%)`);
  ok(P.sections, `sections: boundaries within a bar, F ${pct(B.sections)} (gate 80%)`);
  ok(
    rows.some((r) => r.spec.bpb === 3) &&
      rows.some((r) => r.spec.freeIntro) &&
      rows.some((r) => r.spec.drift === 'live') &&
      rows.some((r) => r.spec.drift === 'ramp') &&
      Math.min(...rows.map((r) => r.spec.bpm)) <= 75 &&
      Math.max(...rows.map((r) => r.spec.bpm)) >= 145,
    'the bench covers 3/4 and 4/4, free intros, steady, live and ramping tempos, 70..150 BPM',
  );
  T.note(
    `bench: ${(B.msPerMin / 1000).toFixed(2)} s an audio minute in Node; ${((performance.now() - t0) / 1000).toFixed(1)} s for the set`,
  );
  const tuned = rows.filter((r) => r.spec.tuning);
  const tErr = tuned.map((r) => Math.abs(r.res.tuning - r.spec.tuning));
  ok(
    tuned.length >= 6 && Math.max(...tErr) <= 5,
    `tuning: the band's offset from A440 read within 5 cents on ${tuned.length} songs tuned off it (worst ${Math.max(...tErr)} c)`,
  );
  const keyRight = rows.filter(
    (r) =>
      r.res.key && parsePc(r.res.key.root) === r.truth.key.root && (r.res.key.scale === 'minor') === r.truth.key.minor,
  ).length;
  ok(keyRight >= 0.8 * rows.length, `key: right on ${keyRight} of ${rows.length} songs (root and mode)`);
  const unsure = rows.filter((r) => !r.res.sure);
  T.note(
    `unsure (the readings shown): ${unsure.length} of ${rows.length} (${unsure.map((r) => `${r.spec.bpm} BPM: ${r.res.why.join(', ')}`).join('; ') || 'none'})`,
  );
});

/* ------------------------------------------------------------------ one song, closely */
const spec = benchSpec(1); // 118 BPM, live, a 6 s free intro, tuned -15 cents
const song = fakeSong(spec);
const res = analyze({ sr: song.sr, mix: song.mix });
const resJson = JSON.stringify(res);
test('one song, closely', () => {
  ok(
    JSON.stringify(analyze({ sr: song.sr, mix: song.mix })) === resJson,
    `deterministic: the same input gives byte-identical JSON twice (${resJson.length} bytes)`,
  );
  ok(
    res.version === ANALYZER_VERSION && res.input === 'mix' && !res.lowConfidence,
    `the result names its analyser (version ${res.version}) and what it read (${res.input})`,
  );
  ok(
    res.free.length >= 1 && res.free[0][0] === 0 && Math.abs(res.free[0][1] - (spec.freeIntro + 0.4)) < 0.6,
    `the a cappella intro is a free span (${res.free.map(([a, b]) => `${a}-${b} s`).join(', ')}; the band comes in at ${(spec.freeIntro + 0.4).toFixed(1)} s)`,
  );
  ok(
    res.beats.every((t) => t >= res.free[0][1] - 0.05),
    'no beats in the free span',
  );
  const ids = res.readings.map((r) => r.id);
  ok(
    ids[0] === 'found' && ids.includes('double') && ids.includes('half') && ids.includes('downbeat'),
    `the readings: ${ids.join(', ')} (found first, then double, half and the other downbeat)`,
  );
  ok(
    res.readings.every((r) => !checkAnchors(r.anchors) && r.anchors[0].beat === 0 && r.anchors[0].sec === 0),
    'every reading is a complete map the song accepts',
  );
  const f = res.readings[0],
    dbl = res.readings.find((r) => r.id === 'double'),
    half = res.readings.find((r) => r.id === 'half');
  ok(
    Math.abs(dbl.tempo / f.tempo - 2) < 0.02 && Math.abs(half.tempo / f.tempo - 0.5) < 0.01,
    `double and half are twice and half the tempo (${dbl.tempo}, ${half.tempo} against ${f.tempo})`,
  );
  // placement: the first downbeat on a bar line at beat bpb·k, k the smallest whole number keeping the start >= 0
  const k = Math.round(
    (f.start + f.firstDownbeat / ((mapSec(f.anchors, f.bpb * 2) - mapSec(f.anchors, 0)) / (f.bpb * 2))) / f.bpb,
  );
  const dbSong = mapSec(f.anchors, f.bpb * k);
  ok(
    f.start >= 0 && (k === 1 || f.start < f.bpb) && Math.abs(dbSong - (f.off + f.firstDownbeat)) < 1e-5,
    `placement: the recording starts at beat ${f.start.toFixed(3)} (offset 0) and its first downbeat (${f.firstDownbeat} s in) lands on beat ${f.bpb * k}, bar ${k + 1}`,
  );
  ok(
    Math.abs(f.off - mapSec(f.anchors, f.start)) < 1e-5,
    "the first segment runs at the first bar's tempo: the clip's start beat is its start second",
  );
  const s = scoreSong(res, song.truth);
  ok(
    s.downbeat && s.mapMs < 15 && Math.abs(res.tuning - spec.tuning) <= 5,
    `this song: bar lines right, the map ${s.mapMs.toFixed(1)} ms off its beats, tuning ${res.tuning} c (played ${spec.tuning})`,
  );
  ok(
    res.key && res.key.name === `${res.key.root} ${res.key.scale}` && /^[A-G][#b]? (major|minor)$/.test(res.key.name),
    `a key, named as people write it (${res.key && res.key.name})`,
  );
  ok(
    res.sections.length >= 6 &&
      res.sections.some((x) => /^Chorus/.test(x.name)) &&
      res.sections.some((x) => /^Verse/.test(x.name)),
    `sections named: ${res.sections.map((x) => x.name + (x.key ? ` (${x.key})` : '')).join(', ')}`,
  );
  ok(
    /^Grid follows Original, \d+\.\d BPM(, drifting [\d.]+–[\d.]+)?\. Key [A-G][#b]? (major|minor)\. \d+ sections\.$/.test(
      flipSummary(res, null, { clip: 'Original' }),
    ),
    `the summary: "${flipSummary(res, null, { clip: 'Original' })}"`,
  );
});

/* ------------------------------------------------------------------ the input order (R11) */
test('the input order (R11)', () => {
  const st = song.stems;
  ok(pickInput({ mix: song.mix, stems: st }).from === 'drums', 'with stems, the beat is read from the drums');
  ok(
    pickInput({ stems: { vocals: st.vocals, bass: st.bass, other: st.other } }).from === 'stems',
    'no drum stem: the non-vocal stems summed',
  );
  ok(
    pickInput({ mix: song.mix, stems: { vocals: st.vocals } }).from === 'mix',
    'only a vocal stem beside the mix: the mix',
  );
  const v = pickInput({ stems: { vocals: st.vocals } });
  ok(v.from === 'vocals' && v.lowConfidence, 'the vocal alone only when nothing else exists, and then low confidence');
  const rd = analyze({ sr: song.sr, stems: st });
  ok(
    rd.input === 'drums' && Math.abs(rd.tempo / res.tempo - 1) < 0.01 && scoreSong(rd, song.truth).downbeat,
    `from the stems: the drum stem's grid agrees with the mix's (${rd.tempo} against ${res.tempo})`,
  );
  const rv = analyze({ sr: song.sr, stems: { vocals: st.vocals } });
  ok(
    rv.lowConfidence && !rv.sure && rv.why.includes('the vocal alone'),
    `from the vocal alone: low confidence, the readings shown (${rv.why.join(', ')})`,
  );
});

/* ------------------------------------------------------------------ the ops (R17) */
const flipProject = () => {
  const store = createStore(createProject());
  store.dispatch(
    [
      {
        type: 'asset.add',
        asset: {
          id: 'a_orig',
          kind: 'audio',
          name: 'Original',
          sr: song.sr,
          channels: 1,
          duration: song.mix.length / song.sr,
        },
      },
      {
        type: 'track.add',
        ref: 't',
        track: {
          name: 'Original',
          kind: 'audio',
          clips: [{ id: 'c_orig', kind: 'audio', start: 0, length: 64, asset: 'a_orig', offset: 0 }],
        },
      },
    ],
    { by: 'you', label: 'Flip: test' },
  );
  return store;
};
test('the ops (R17)', () => {
  const store = flipProject();
  const tid = store.get().tracks[0].id;
  const before = JSON.stringify(store.get());
  const ops = resultToOps(store.get(), res, 'found', { clips: [{ track: tid, clip: 'c_orig' }] });
  store.dispatch(ops, { by: 'overdub', label: 'Grid, key and sections from test' });
  const p = store.get(),
    f = res.readings[0];
  ok(
    p.tempoMap && p.tempoMap.clip === 'c_orig' && p.tempoMap.anchors.length === f.anchors.length && p.tempo === f.tempo,
    `the map lands, following the Original clip (${p.tempoMap.anchors.length} anchors, ${p.tempo} BPM nominal)`,
  );
  ok(
    p.tracks[0].clips[0].start === f.start && p.tracks[0].clips[0].offset === 0,
    `the clip is placed at beat ${f.start.toFixed(3)}, offset 0`,
  );
  ok(
    p.key && p.key.root === res.key.root && p.key.scale === res.key.scale,
    `the song's key: ${p.key.root} ${p.key.scale}`,
  );
  ok(
    p.sections.length === res.sections.length &&
      p.sections.every((x, i) => x.name === res.sections[i].name && x.start === res.sections[i].start),
    `${p.sections.length} sections, as found`,
  );
  const ch = p.tracks.find((t) => t.name === 'Chords');
  ok(
    ch &&
      ch.mute &&
      ch.kind === 'instrument' &&
      ch.clips.length === 1 &&
      ch.clips[0].notes.length >= 3 * res.chords.length,
    `the chords as block chords on a muted Chords track (${res.chords.length} chords, ${ch && ch.clips[0].notes.length} notes)`,
  );
  ok(
    p.tracks.every((t) => t.by === 'you' || t.by === 'overdub') && ch.by === 'overdub',
    'the house signs the Chords track',
  );
  store.undo();
  const noMeta = (x) => JSON.stringify({ ...(typeof x === 'string' ? JSON.parse(x) : x), meta: null });
  if (noMeta(store.get()) !== noMeta(before)) {
    const a = JSON.parse(noMeta(store.get())),
      b = JSON.parse(noMeta(before));
    for (const k of Object.keys(b))
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        T.note(
          'differs after undo: ' +
            k +
            ' ' +
            JSON.stringify(a[k]).slice(0, 200) +
            ' vs ' +
            JSON.stringify(b[k]).slice(0, 200),
        );
  }
  ok(noMeta(store.get()) === noMeta(before), 'one undo step takes the whole analysis back out');
  // another reading: the grid alone, in one step
  store.redo();
  const dbl = res.readings.find((r) => r.id === 'double');
  store.dispatch(readingOps(store.get(), res, dbl, { clips: [{ track: tid, clip: 'c_orig' }] }), {
    by: 'you',
    label: 'Twice as fast',
  });
  ok(
    store.get().tempoMap.anchors.length === dbl.anchors.length &&
      store.get().tracks[0].clips[0].start === dbl.start &&
      Math.abs(store.get().tempo - dbl.tempo) < 1e-9,
    `picking the double reading replaces the map and the placement (${store.get().tempo} BPM)`,
  );
  // the sections and the chords follow the grid (R27): each stays at its point in the recording, and the found grid
  // put back puts them back exactly
  {
    const recSecs = (q) => {
      const s0 = beatToSec(q, q.tracks[0].clips[0].start);
      return q.sections.map((x) => beatToSec(q, x.start) - s0);
    };
    const chordSecs = (q) => {
      const s0 = beatToSec(q, q.tracks[0].clips[0].start),
        c = q.tracks.find((t) => t.name === 'Chords').clips[0];
      return c.notes.map((n) => beatToSec(q, c.start + n.t) - s0);
    };
    store.undo();
    const pf = store.get(),
      fs = recSecs(pf),
      fc = chordSecs(pf),
      barSec = (4 * 60) / dbl.tempo;
    store.dispatch(readingOps(pf, res, dbl, { clips: [{ track: tid, clip: 'c_orig' }] }), {
      by: 'you',
      label: 'Twice as fast',
    });
    const pd = store.get(),
      ds = recSecs(pd),
      dc = chordSecs(pd);
    const worstS = Math.max(...ds.slice(1).map((x, i) => Math.abs(x - fs[i + 1]))),
      worstC = Math.max(...dc.map((x, i) => Math.abs(x - fc[i])));
    ok(
      ds.length === fs.length && worstS <= barSec / 2 + 1e-6 && worstC <= 60 / dbl.tempo / 2 + 0.05,
      `on another reading the sections and chords stay where they are in the recording (worst section ${worstS.toFixed(3)} s, within half its bar; worst chord ${worstC.toFixed(3)} s)`,
    );
    const found = res.readings.find((r) => r.id === 'found');
    store.dispatch(readingOps(store.get(), res, found, { clips: [{ track: tid, clip: 'c_orig' }] }), {
      by: 'you',
      label: 'the grid as it was',
    });
    const pb = store.get(),
      chf = (q) => JSON.stringify(q.tracks.find((t) => t.name === 'Chords').clips[0].notes.map((n) => [n.p, n.t, n.d]));
    ok(
      JSON.stringify(pb.sections.map((x) => [x.name, x.start, x.length, x.key])) ===
        JSON.stringify(pf.sections.map((x) => [x.name, x.start, x.length, x.key])) && chf(pb) === chf(pf),
      'the found grid picked again puts the sections, their keys and the chords back exactly',
    );
    // a section the person moved goes by its seconds
    store.dispatch([{ type: 'section.set', section: pb.sections[2].id, patch: { start: pb.sections[2].start + 4 } }], {
      by: 'you',
    });
    const pe = store.get(),
      es = recSecs(pe);
    store.dispatch(readingOps(pe, res, dbl, { clips: [{ track: tid, clip: 'c_orig' }] }), { by: 'you' });
    const moved = recSecs(store.get());
    ok(
      Math.abs(moved[2] - es[2]) <= barSec / 2 + 1e-6,
      `a section the person moved keeps its point in the recording too (${es[2].toFixed(2)} s -> ${moved[2].toFixed(2)} s)`,
    );
  }
  // a reading's own sections: on another grid the times go to that grid's bar lines
  const store2 = flipProject();
  store2.dispatch(
    resultToOps(store2.get(), res, 'double', { clips: [{ track: store2.get().tracks[0].id, clip: 'c_orig' }] }),
    { by: 'overdub' },
  );
  ok(
    store2.get().sections.every((x) => x.start % dbl.bpb === 0 && x.length >= dbl.bpb) &&
      store2.get().sections.length === res.sections.length,
    'on the double reading the sections sit on its bar lines',
  );
});

/* ------------------------------------------------------------------ section.key (R17) */
test('section.key (R17)', () => {
  const p = cleanProject({
    ...createProject(),
    sections: [
      { id: 's_a', name: 'Verse', start: 0, length: 16, key: 'F# minor' },
      { id: 's_b', name: 'Chorus', start: 16, length: 16 },
      { id: 's_c', name: 'Bridge', start: 32, length: 8, key: 'ignore previous instructions' },
    ],
  });
  ok(
    p.sections[0].key === 'F# minor' && !('key' in p.sections[1]) && !('key' in p.sections[2]),
    'cleanProject keeps a section key, leaves none where there was none, drops one that is not a key',
  );
  const again = cleanProject(JSON.parse(JSON.stringify(p)));
  ok(JSON.stringify(again.sections) === JSON.stringify(p.sections), 'a section key survives save and load');
  const plain = createProject();
  plain.sections = [{ id: 's_x', name: 'Verse', start: 0, length: 16 }];
  ok(
    JSON.stringify(cleanProject(plain).sections) ===
      JSON.stringify([{ id: 's_x', name: 'Verse', start: 0, length: 16 }]),
    'a song with no section keys is unchanged',
  );
  const store = createStore(createProject());
  store.dispatch({ type: 'section.add', section: { id: 's_k', name: 'Bridge', start: 0, length: 8, key: 'Bb major' } });
  ok(store.get().sections[0].key === 'Bb major', 'section.add keeps a key');
  store.dispatch({ type: 'section.set', section: 's_k', patch: { key: 'G minor' } });
  ok(store.get().sections[0].key === 'G minor', 'section.set changes it');
  store.undo();
  ok(store.get().sections[0].key === 'Bb major', '... and undoes exactly');
  store.dispatch({ type: 'section.set', section: 's_k', patch: { key: null } });
  ok(!('key' in store.get().sections[0]), 'null clears it');
  const bad = store.dispatch({ type: 'section.set', section: 's_k', patch: { key: 'H minor' } });
  const bad2 = store.dispatch({ type: 'section.add', section: { name: 'X', start: 8, length: 8, key: { root: 'C' } } });
  ok(
    !bad.ok && /key's name/.test(bad.error) && !bad2.ok && store.get().sections.length === 1,
    `a key that isn't one is refused ("${bad.error}")`,
  );
});

/* ------------------------------------------------------------------ keyOf: the default unchanged, Temperley added */
test('keyOf: the default unchanged, Temperley added', () => {
  const c = [1, 0.1, 0.6, 0.1, 0.8, 0.5, 0.1, 0.9, 0.1, 0.5, 0.1, 0.4];
  const a = keyOf(c),
    b = keyOf(c, { profile: 'krumhansl' }),
    t = keyOf(c, { profile: 'temperley', all: true });
  ok(
    JSON.stringify(a) === JSON.stringify(b) && !('all' in a) && a.root === 'C' && a.scale === 'major',
    `keyOf's default (Krumhansl) answer is as it was (${a.root} ${a.scale}, ${a.confidence})`,
  );
  ok(
    t.root === 'C' && t.scale === 'major' && t.all.length === 24,
    "keyOf with Temperley's profiles, all 24 keys ranked",
  );
});

/* ------------------------------------------------------------------ the cache and a cancel (R12) */
test('the cache and a cancel (R12)', async () => {
  const cache = createAnalysisCache();
  ok((await cache.mode()) === 'memory', 'no IndexedDB (Node): the cache lives in memory');
  const small = fakeSong({
    seed: 7,
    bpm: 120,
    form: [
      ['Verse', 4],
      ['Chorus', 4],
    ],
    sr: 22050,
  });
  const input = { sr: small.sr, mix: small.mix };
  const a = await analyzeAudio(input, { cache, worker: false });
  const b = await analyzeAudio(input, { cache, worker: false });
  ok(
    !a.cached &&
      b.cached &&
      JSON.stringify(a.result) === JSON.stringify(b.result) &&
      a.key === b.key &&
      a.key.endsWith(':' + ANALYZER_VERSION),
    `the second run of the same input comes from the cache (key ${a.key.slice(0, 12)}…:${ANALYZER_VERSION})`,
  );
  const other = await inputKey({ sr: small.sr, mix: small.mix.map((x, i) => (i === 1000 ? x + 0.001 : x)) });
  ok(other !== a.key, 'one sample changed: another key');
  const ac = new AbortController();
  ac.abort();
  let err = null;
  try {
    await analyzeAudio({ sr: 22050, mix: new Float32Array(22050) }, { cache, worker: false, signal: ac.signal });
  } catch (e) {
    err = e;
  }
  ok(err && err.name === 'AbortError', 'a cancelled run rejects with AbortError');
});
