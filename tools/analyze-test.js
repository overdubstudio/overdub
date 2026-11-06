// The analysis behind Flip a song [analyze] (app/src/audio/analyze/, spec 0014 section B).
//   1. Node: moved to test/unit/analyze-flip.test.js (BeatBench's gates, the input order, the ops, section.key, keyOf,
//      the cache and a cancel).
//   2. Here, Chromium (QUIET: muted): the same song analysed in a Worker gives byte-identical JSON to Node's; a 3-minute
//      song in under 3 s in the Worker; the IndexedDB cache ('overdub-analysis') hit on the second run; a cancelled
//      run leaves nothing cached.
//   node tools/analyze-test.js
import { open, tally } from './pw.js';
import { fakeSong } from './fake-wav.js';
import { GATES, benchSpec } from './beat-bench.js';
import { analyze } from '../app/src/audio/analyze/index.js';
import { inputKey } from '../app/src/audio/analyze/cache.js';

const T = tally('analyze');
const ok = T.ok;

const spec = benchSpec(1);           // 118 BPM, live, a 6 s free intro, tuned -15 cents
const song = fakeSong(spec);
const res = analyze({ sr: song.sr, mix: song.mix });
const resJson = JSON.stringify(res);

/* ------------------------------------------------------------------ Chromium: a Worker, IndexedDB */
const { page, errors, close } = await open('/tools/engine-test.html');
try {
  const nodeKey = await inputKey({ sr: song.sr, mix: song.mix });
  const got = await page.evaluate(async ({ spec }) => {
    const { fakeSong } = await import('/tools/fake-song.js');
    const { analyzeAudio } = await import('/app/src/audio/analyze/client.js');
    const { inputKey } = await import('/app/src/audio/analyze/cache.js');
    const s = fakeSong(spec);
    const input = { sr: s.sr, mix: s.mix };
    const key = await inputKey(input);
    const r = await analyzeAudio(input, { cache: null });
    return { key, json: JSON.stringify(r.result), ms: r.ms };
  }, { spec });
  ok(got.key === nodeKey, 'the browser builds the same song, sample for sample (the same SHA-256)');
  ok(got.json === resJson, `in a Worker in Chromium the result is byte-identical to Node's (${got.json.length} bytes, ${(got.ms / 1000).toFixed(2)} s)`);
  // a 3-minute song, in the Worker
  const long = await page.evaluate(async () => {
    const { fakeSong } = await import('/tools/fake-song.js');
    const { analyzeAudio } = await import('/app/src/audio/analyze/client.js');
    const form = [['Intro', 4], ['Verse', 16], ['Chorus', 8], ['Verse', 16], ['Chorus', 8], ['Bridge', 8], ['Chorus', 8], ['Outro', 4]];
    const s = fakeSong({ seed: 42, bpm: 92, drift: 'live', form, sr: 44100 });
    const t0 = performance.now();
    const stages = [];
    const r = await analyzeAudio({ sr: s.sr, mix: s.mix }, { cache: null, onProgress: (st) => stages.push(st) });
    return { secs: s.mix.length / s.sr, ms: r.ms, wall: performance.now() - t0, stages, tempo: r.result.tempo };
  });
  ok(long.secs >= 180 && long.ms < GATES.secsFor3Min * 1000, `a ${(long.secs / 60).toFixed(1)}-minute song analysed in ${(long.ms / 1000).toFixed(2)} s in a Worker (gate ${GATES.secsFor3Min} s; ${(long.wall / 1000).toFixed(2)} s with the copy in and out)`);
  ok(long.stages.join(',') === 'beat,key,sections', `the Worker reports its stages as it goes (${long.stages.join(', ')})`);
  // IndexedDB, a hit on the second run, and a cancel that caches nothing
  const idb = await page.evaluate(async () => {
    const { fakeSong } = await import('/tools/fake-song.js');
    const { analyzeAudio } = await import('/app/src/audio/analyze/client.js');
    const { createAnalysisCache, inputKey } = await import('/app/src/audio/analyze/cache.js');
    const cache = createAnalysisCache();
    const mode = await cache.mode();
    const s = fakeSong({ seed: 9, bpm: 128, form: [['Verse', 8], ['Chorus', 8]], sr: 22050 });
    const input = { sr: s.sr, mix: s.mix };
    const a = await analyzeAudio(input, { cache });
    const fresh = createAnalysisCache();     // a new page's cache: only IndexedDB can answer
    const b = await analyzeAudio(input, { cache: fresh });
    const s2 = fakeSong({ seed: 10, bpm: 100, form: [['Verse', 16], ['Chorus', 16]], sr: 44100 });
    const in2 = { sr: s2.sr, mix: s2.mix };
    const ac = new AbortController();
    const p = analyzeAudio(in2, { cache, signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    let name = '';
    try { await p; } catch (e) { name = e.name; }
    const left = await fresh.get(await inputKey(in2));
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    return { mode, a: a.cached, b: b.cached, same: JSON.stringify(a.result) === JSON.stringify(b.result), name, left, dbs };
  });
  ok(idb.mode === 'idb' && idb.dbs.includes('overdub-analysis'), `the browser caches in IndexedDB ('overdub-analysis')`);
  ok(!idb.a && idb.b && idb.same, 'a second run, from a fresh cache, is answered by IndexedDB');
  ok(idb.name === 'AbortError' && idb.left == null, 'a cancelled run stops the Worker and leaves nothing cached');
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally { await close(); }
T.done();
