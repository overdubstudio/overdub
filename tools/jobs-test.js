// The job layer and the local stems runner [jobs] (app/src/jobs/, spec 0014 section C: R19-R23, R29). Nothing here
// downloads a model: the runner is driven by a fake ONNX Runtime (an identity network) and a fake model (bytes of our
// own), and the jobs by fake.js.
//   1. Node: the DSP (spectrogram and back, the segments and their crossfade) with identity networks; the runner end to
//      end on a fake runtime (the hash, WebGPU then the CPU, the warm-up's estimate, the memory warning, resampling,
//      mono); a bad hash refused before anything runs; no config, no fetch; site-config.js's stems rules and the local
//      server's env; the jobs: cache hit, model version, cancel, a runner that is off; no weights, runtimes or foreign
//      audio tracked in git.
//   2. Chromium (QUIET: muted): the worker pool gives the same samples as Node, byte for byte; the IndexedDB cache
//      ('overdub-jobs') answers a second run and a cancel leaves nothing; the runner through the browser's own fetch and
//      Cache Storage with the fake runtime served by the test (bad hash: refused, the runtime never requested; good:
//      split, kept, the second estimate knows it's downloaded); the studio with no stems config makes no request for
//      either.
//   node tools/jobs-test.js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, tally } from './pw.js';
import { fakeSong } from './fake-wav.js';
import { fakeMix } from './fake-song.js';
import { startServer } from '../server/serve.js';
import { SR, SEG, SOURCES, spec, ispec, separate, offsetsOf, normalise } from '../app/src/jobs/stems/dsp.js';
import { inlinePool } from '../app/src/jobs/stems/pool.js';
import { createStemsRunner, estimateFrom, PRIOR, OFF, sha256 } from '../app/src/jobs/stems/runner.js';
import { createJobs } from '../app/src/jobs/index.js';
import { createJobsCache, jobKey, inputHash } from '../app/src/jobs/cache.js';
import { createFakeRunner } from '../app/src/jobs/fake.js';
import { stemsConfig, loadSiteConfig } from '../app/src/site-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = tally('jobs');
const ok = T.ok;
const db = (x) => (x === 0 ? -Infinity : 10 * Math.log10(x));

const testMix = (seconds, sr = SR, seed = 1) => fakeMix({ seconds, sr, seed });
// error energy over signal energy, in dB, over [a, b) of each planar channel
function errDb(got, want, L, a = 0, b = L, channels = 2) {
  let e = 0, p = 0;
  for (let c = 0; c < channels; c++) for (let i = a; i < b; i++) { const d = got[c * L + i] - want[c * L + i]; e += d * d; p += want[c * L + i] ** 2; }
  return db(e / p);
}
// identity networks: the spectral branch alone (zx = the input's spectrogram, xt = 0), or the time branch alone
const spectralNet = (gains = [1, 1, 1, 1]) => async (seg, mag) => {
  const zx = new Float32Array(4 * mag.length);
  gains.forEach((g, k) => { for (let i = 0; i < mag.length; i++) zx[k * mag.length + i] = g * mag[i]; });
  return { zx, xt: new Float32Array(8 * SEG) };
};
const timeNet = (gains = [1, 1, 1, 1]) => async (seg, mag) => {
  const xt = new Float32Array(8 * SEG);
  gains.forEach((g, k) => { for (let i = 0; i < 2 * SEG; i++) xt[k * 2 * SEG + i] = g * seg[i]; });
  return { zx: new Float32Array(4 * mag.length), xt };
};

/* ------------------------------------------------------------------ the DSP (R21) */
{
  const seg = new Float32Array(2 * SEG);
  const { mix, L } = testMix(SEG / SR);
  seg.set(mix.subarray(0, SEG), 0); seg.set(mix.subarray(L, L + SEG), SEG);
  const back = ispec(spec(seg), new Float32Array(2 * SEG));
  const EDGE = 1536;    // _spec's reflect pad: demucs drops the two frames that cover it, so the edge is the network's
  const mid = errDb(back, seg, SEG, EDGE, SEG - EDGE), edge = errDb(back, seg, SEG, 0, EDGE);
  ok(mid <= -100, `one segment, spectrogram and back: ${mid.toFixed(1)} dB away from its first and last ${EDGE} samples (gate −100 dB)`);
  T.note(`... and ${edge.toFixed(1)} dB in the first ${EDGE} samples: demucs' _spec keeps frames 2..2+le and _ispec pads two empty frames back, so a segment's edges come from the network (and the crossfade), as in the reference`);
  const xt = Float32Array.from({ length: 2 * SEG }, (_, i) => (i % 7) * 1e-3);
  const withXt = ispec(spec(seg), xt);
  let worst = 0;
  for (let i = EDGE; i < SEG - EDGE; i++) worst = Math.max(worst, Math.abs(withXt[i] - back[i] - xt[i]));
  ok(worst < 1e-6, `the time branch is added to the spectral one, sample for sample (worst ${worst.toExponential(1)})`);
}
let nodeHash = null, nodeSpectralHash = null, nodeMixHash = null;
const hashOf = async (f32) => sha256(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
{
  const { mix, L } = testMix(20);
  const offs = offsetsOf(L);
  ok(offs.length === 4 && offs[1] === Math.floor(0.75 * SEG) && L - offs[3] < SEG, `a 20 s song is ${offs.length} segments of 7.8 s, 25% overlap, the last one short (${((L - offs[3]) / SR).toFixed(2)} s)`);
  const progress = [];
  const out = await separate({ network: timeNet(), mix, L, pool: inlinePool(), onProgress: (d, n) => progress.push(`${d}/${n}`) });
  const worst = Math.max(...SOURCES.map((_, s) => errDb(out.subarray(s * 2 * L, (s + 1) * 2 * L), mix, L)));
  ok(worst <= -100, `the segments and their triangular crossfade put an identity network's answer back together: ${worst.toFixed(1)} dB, every source, the whole song (gate −100 dB)`);
  ok(progress.join(',') === '1/4,2/4,3/4,4/4', `progress a segment at a time (${progress.join(', ')})`);
  nodeHash = await hashOf(out);
  nodeMixHash = await hashOf(mix);
  const g = [0.1, 0.2, 0.3, 0.4];
  const parts = await separate({ network: timeNet(g), mix, L, pool: inlinePool() });
  let bad = 0;
  for (let s = 0; s < 4; s++) for (let i = 0; i < 2 * L; i += 997) if (Math.abs(parts[s * 2 * L + i] - g[s] * mix[i]) > 1e-6) bad++;
  ok(!bad, 'each source lands in its own place (drums, bass, other, vocals): four gains give four scaled copies');
  const sp = await separate({ network: spectralNet(), mix, L, pool: inlinePool() });
  const spDb = errDb(sp.subarray(0, 2 * L), mix, L);
  const spMid = errDb(sp.subarray(0, 2 * L), mix, L, offs[1] + 8192, offs[1] + 60000);
  ok(spMid <= -100, `the spectral branch alone, well inside a segment: ${spMid.toFixed(1)} dB`);
  T.note(`the spectral branch alone over the whole song: ${spDb.toFixed(1)} dB (the segment edges, see above)`);
  nodeSpectralHash = await hashOf(sp);
  const n = normalise(mix, L);
  let m = 0;
  for (let i = 0; i < 2 * L; i++) m = Math.max(m, Math.abs(n.x[i] * n.std + n.mean - mix[i]));
  ok(Math.abs(n.mean - 0.005) < 0.002 && n.std > 0 && m < 1e-6, `separate.py's normalising (mean ${n.mean.toFixed(4)}, std ${n.std.toFixed(4)}) undoes exactly`);
  const ac = new AbortController();
  let err = null;
  try { await separate({ network: timeNet(), mix, L, pool: inlinePool(), signal: ac.signal, onProgress: (d) => { if (d === 1) ac.abort(); } }); } catch (e) { err = e; }
  ok(err && err.name === 'AbortError', 'a cancel stops the split between segments');
}

/* ------------------------------------------------------------------ a fake ONNX Runtime and a fake model */
const MODEL = new TextEncoder().encode('not a model: bytes for the jobs test '.repeat(64));
const MODEL_SHA = await sha256(MODEL);
function fakeOrt({ failGpu = false, clock = null, msPerRun = 700, net = timeNet() } = {}) {
  const log = { creates: [], runs: 0 };
  const tensor = (data) => ({ data, getData: async () => data, dispose() {} });
  return {
    log,
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
    InferenceSession: {
      async create(bytes, opts) {
        const ep = opts.executionProviders[0];
        log.creates.push(ep);
        if (ep === 'webgpu' && failGpu) throw new Error('no adapter for you');
        return {
          async run({ mix, mag }) {
            log.runs++;
            if (clock) clock.t += msPerRun;
            const { zx, xt } = await net(mix.data, mag.data);
            return { zx: tensor(zx), xt: tensor(xt) };
          },
        };
      },
    },
  };
}
function harness({ sha = MODEL_SHA, bytes = MODEL.length, gpu = true, failGpu = false, deviceMemory = 16, msPerRun = 700 } = {}) {
  const calls = { fetch: [], runtime: [] }, clock = { t: 0 };
  const ort = fakeOrt({ failGpu, clock, msPerRun });
  const deps = {
    fetch: async (url) => { calls.fetch.push(url); return new Response(MODEL, { headers: { 'content-length': String(MODEL.length) } }); },
    loadRuntime: async (url) => { calls.runtime.push(url); return ort; },
    gpu: gpu ? { requestAdapter: async () => ({}) } : undefined,
    deviceMemory, cores: 10, isolated: false, now: () => clock.t, pool: () => inlinePool(), caches: undefined,
  };
  const config = stemsConfig({ model: 'https://models.example.com/htdemucs.onnx', runtime: 'https://cdn.example.com/ort/ort.webgpu.min.mjs', sha256: sha, bytes });
  return { runner: createStemsRunner(config, deps), calls, ort, clock, config };
}

/* ------------------------------------------------------------------ the runner, end to end on the fake (R21, R22) */
{
  const H = harness();
  const before = await H.runner.estimate({ seconds: 180 });
  ok(!H.calls.fetch.length && !H.calls.runtime.length, 'an estimate before the first run fetches nothing');
  ok(before.device === 'gpu' && !before.measured && before.firstTime && before.download === MODEL.length && Math.abs(before.wait - 3 * PRIOR.gpu) < 0.2, `before the warm-up it guesses from the spike's figures and says so: "${before.text}"`);
  const { mix, L } = testMix(20);
  const input = { sr: SR, channels: [mix.slice(0, L), mix.slice(L)] };
  const stages = new Set();
  let last = 0;
  const res = await H.runner.run(input, { onProgress: (p) => { stages.add(p.stage); if (p.stage === 'split') last = p.fraction; } });
  ok(H.calls.fetch.length === 1 && H.calls.fetch[0] === H.config.model && H.calls.runtime.length === 1 && H.calls.runtime[0] === H.config.runtime, 'the model and the runtime come from the URLs the site config names, once each');
  ok(H.ort.env.wasm.wasmPaths === 'https://cdn.example.com/ort/' && H.ort.env.wasm.numThreads === 1, `the runtime's WebAssembly files sit beside it; one thread, as the studio isn't cross-origin isolated`);
  ok(H.ort.log.creates.join() === 'webgpu' && res.device === 'gpu', 'WebGPU first');
  ok([...stages].join() === 'download,prepare,split' && last === 1, `progress: ${[...stages].join(', ')}, the split to 100%`);
  const worst = Math.max(...SOURCES.map((name) => { const s = res.stems[name]; const got = new Float32Array(2 * L); got.set(s[0], 0); got.set(s[1], L); return errDb(got, mix, L); }));
  ok(SOURCES.every((n) => res.stems[n].length === 2 && res.stems[n][0].length === L) && worst <= -100, `with an identity network every stem comes back as the input, normalising and all: ${worst.toFixed(1)} dB`);
  ok(H.ort.log.runs === 2 + offsetsOf(L).length, `the warm-up is two runs on the graphics card (the first compiles), then one a segment (${H.ort.log.runs})`);
  const after = await H.runner.estimate({ seconds: 180 });
  const segs = offsetsOf(180 * SR).length;
  ok(after.measured && !after.firstTime && Math.abs(after.wait - segs * 0.7) < 0.05 && after.text === `About ${Math.round(segs * 0.7)} s on this computer's graphics card.`, `after it, the wait is timed from the warm-up (${segs} segments at 700 ms): "${after.text}"`);
  await H.runner.run(input);
  ok(H.calls.fetch.length === 1 && H.calls.runtime.length === 1, 'a second split reuses the session: no second download');
}
{
  const H = harness({ failGpu: true, msPerRun: 5000 });
  const { mix, L } = testMix(4, 48000, 3);
  const mono = mix.slice(0, L);
  const res = await H.runner.run({ sr: 48000, channels: [mono] });
  ok(H.ort.log.creates.join() === 'webgpu,wasm' && res.device === 'cpu', 'WebGPU refused: it falls back to the CPU and carries on');
  ok(H.ort.log.runs === 1 + 1, 'on the CPU the first warm-up run is the timed one');
  const s = res.stems.vocals;
  const d = errDb(s[0], mono, L, 4800, L - 4800, 1);
  ok(s.length === 1 && s[0].length === L && d < -85, `a mono 48 kHz file: mono stems at 48 kHz, its length, through the resampler and back (${d.toFixed(1)} dB)`);
  const e = await H.runner.estimate({ seconds: 180 });
  ok(e.device === 'cpu' && e.measured && /^About \d+ min on this computer's processor\. No WebGPU here/.test(e.text), `no WebGPU: it quotes the CPU's wait and doesn't fail: "${e.text}"`);
}
{
  const H = harness({ gpu: false, deviceMemory: 4 });
  const e = await H.runner.estimate({ seconds: 120 });
  ok(e.device === 'cpu' && Math.abs(e.wait - 2 * PRIOR.cpu) < 0.5 && e.warn && /under 8 GB/.test(e.text), `under 8 GB of memory it warns before starting: "${e.text}"`);
  const f = estimateFrom({ device: 'gpu', seconds: 200, msPerSegment: 1000, deviceMemory: 8 });
  ok(!f.warn && f.text === `About ${offsetsOf(200 * SR).length} s on this computer's graphics card.`, '8 GB and up: no warning');
}

/* ------------------------------------------------------------------ a bad hash, and no config (R21) */
{
  const H = harness({ sha: 'ab'.repeat(32) });
  let err = null;
  try { await H.runner.run({ sr: SR, channels: [new Float32Array(SR)] }); } catch (e) { err = e; }
  ok(err && /doesn't match its pinned SHA-256/.test(err.message) && H.calls.fetch.length === 1 && !H.calls.runtime.length && !H.ort.log.creates.length, `a model that doesn't match its hash is refused before the runtime is even loaded ("${err && err.message}")`);
}
{
  const calls = [];
  const spy = (what) => async () => { calls.push(what); throw new Error('should not be called'); };
  const r = createStemsRunner(null, { fetch: spy('fetch'), loadRuntime: spy('runtime'), gpu: { requestAdapter: spy('gpu') } });
  const out = await Promise.allSettled([r.estimate({ seconds: 60 }), r.load(), r.run({ sr: SR, channels: [new Float32Array(10)] }), r.device()]);
  ok(!r.available && out.every((o) => o.status === 'rejected' && o.reason.message === OFF) && !calls.length, `no config: the runner is off, says so ("${OFF}"), and fetches, imports and asks nothing`);
  const jobs = createJobs({ runners: { stems: r }, cache: null });
  let err = null;
  try { await jobs.run({ kind: 'stems', input: { sr: SR, channels: [new Float32Array(10)] } }); } catch (e) { err = e; }
  ok(err && err.message === OFF, 'a stems job with the runner off fails with the same reason');
  const seen = [];
  const cfg = await loadSiteConfig({ fresh: true, fetch: async (u) => { seen.push(u); return new Response('{}', { headers: { 'content-type': 'application/json' } }); }, search: '', host: 'overdubstudio.com' });
  ok(cfg.stems === null && cfg.cloud === null && seen.join() === 'site-config.json', 'site-config.json with no stems entry: stems off');
}
{
  const sha = 'a'.repeat(64);
  const good = { model: 'https://m.example.com/x.onnx', runtime: 'https://c.example.com/ort.webgpu.min.mjs', sha256: sha.toUpperCase() };
  const g = stemsConfig(good);
  ok(g && g.sha256 === sha && g.id === 'htdemucs' && !('bytes' in g), 'stems config: two https URLs and a SHA-256 switch it on (the hash lower-cased, the id defaulted)');
  ok(stemsConfig({ ...good, model: 'http://localhost:8080/x.onnx', runtime: 'http://127.0.0.1:8080/ort.mjs' }), 'http: is allowed on this machine (loopback), like the cloud origin');
  const bad = [
    { ...good, model: 'http://models.example.com/x.onnx' }, { ...good, runtime: 'javascript:alert(1)' }, { ...good, model: 'https://u:p@m.example.com/x' },
    { ...good, sha256: 'abc' }, { ...good, sha256: undefined }, { ...good, runtime: '' }, { ...good, model: '/models/x.onnx' }, [], 'on', null,
  ];
  ok(bad.every((b) => stemsConfig(b) === null), `and ${bad.length} wrong ones (plain http elsewhere, other schemes, credentials, a short or missing hash, a relative URL, not an object) leave it off`);
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const get = async () => (await fetch(srv.url + '/app/site-config.json')).json();
    const a = await get();
    process.env.OVERDUB_STEMS_MODEL = 'http://127.0.0.1:9/htdemucs.onnx';
    process.env.OVERDUB_STEMS_RUNTIME = 'http://127.0.0.1:9/ort.webgpu.min.mjs';
    process.env.OVERDUB_STEMS_SHA256 = sha;
    const b = await get();
    delete process.env.OVERDUB_STEMS_MODEL; delete process.env.OVERDUB_STEMS_RUNTIME; delete process.env.OVERDUB_STEMS_SHA256;
    ok(!fs.existsSync(path.join(ROOT, 'app/site-config.json')) ? !a.stems && stemsConfig(b.stems)?.model === 'http://127.0.0.1:9/htdemucs.onnx' : true, 'the local server answers stems only from OVERDUB_STEMS_* (for trying a model you exported, locally)');
  } finally { await srv.close(); }
}

/* ------------------------------------------------------------------ the jobs: cache, model, cancel (R19, R20, R23) */
const song = fakeSong({ seed: 3, bpm: 110, form: [['Verse', 4], ['Chorus', 4]], sr: 22050 });
const scaled = Object.fromEntries(SOURCES.map((n) => [n, Float32Array.from(song.stems[n], (x) => 0.55 * x)]));
const songInput = { sr: song.sr, channels: [song.mix] };
{
  let sum = 0;
  for (let i = 0; i < song.mix.length; i += 101) sum = Math.max(sum, Math.abs(scaled.drums[i] + scaled.bass[i] + scaled.other[i] + scaled.vocals[i] - song.mix[i]));
  ok(sum < 1e-6, 'the fixture: a fake-wav song whose mix is the sum of its four stems');
  const fake = createFakeRunner({ known: [{ input: songInput, stems: scaled }], steps: 5 });
  const cache = createJobsCache();
  ok((await cache.mode()) === 'memory', 'no IndexedDB (Node): the jobs cache lives in memory');
  const jobs = createJobs({ runners: { stems: fake }, cache });
  const prog = [];
  const a = await jobs.run({ kind: 'stems', input: songInput }, { onProgress: (p) => prog.push(p.fraction) });
  ok(!a.cached && fake.calls === 1 && SOURCES.every((n) => a.result.stems[n][0].length === song.mix.length && a.result.stems[n][0][5000] === scaled[n][5000]), 'the fake hands back the known stems for the known input');
  ok(prog.join() === '0.2,0.4,0.6,0.8,1', `... with its scripted progress (${prog.join(', ')})`);
  const b = await jobs.run({ kind: 'stems', input: songInput });
  ok(b.cached && fake.calls === 1 && b.key === a.key && b.result === a.result, `a second run of the same input comes from the cache and never reaches the runner (key ${a.key.slice(0, 18)}…)`);
  ok(a.key === `stems:${await inputHash(songInput)}:fake:1`, 'the key is the kind, the input\'s SHA-256, the model id and its version');
  const c = await jobs.run({ kind: 'stems', input: songInput, model: { id: 'fake', version: '2' } });
  ok(!c.cached && fake.calls === 2, 'another version of the model is another job');
  const est = await jobs.estimate({ kind: 'stems', input: songInput });
  ok(est.cached && est.wait === 0, `an estimate for a song already split: "${est.text}"`);
  let unknown = null;
  try { await jobs.run({ kind: 'stems', input: { sr: 22050, channels: [new Float32Array(100)] } }); } catch (e) { unknown = e; }
  ok(unknown && /doesn't know/.test(unknown.message), 'the fake refuses an input it doesn\'t know');
  let nokind = null;
  try { await jobs.run({ kind: 'mastering', input: songInput }); } catch (e) { nokind = e; }
  ok(nokind && /No such job/.test(nokind.message), 'stems is the only kind of job');
}
{
  const fake = createFakeRunner({ known: [{ input: songInput, stems: scaled }], steps: 10, stepMs: 15 });
  const cache = createJobsCache();
  const jobs = createJobs({ runners: { stems: fake }, cache });
  const ac = new AbortController();
  const seen = [];
  const p = jobs.run({ kind: 'stems', input: songInput }, { signal: ac.signal, onProgress: (x) => { seen.push(x.fraction); if (seen.length === 3) ac.abort(); } });
  let err = null;
  try { await p; } catch (e) { err = e; }
  const key = await jobKey('stems', songInput, fake.model);
  ok(err && err.name === 'AbortError' && (await cache.get(key)) === null && seen.length === 3, `a cancelled job rejects with AbortError and leaves nothing in the cache (stopped at ${Math.round(seen[2] * 100)}%)`);
  const again = await jobs.run({ kind: 'stems', input: songInput });
  ok(!again.cached && fake.calls === 2, '... so the next run splits it again');
  const est = await createJobs({ runners: { stems: createFakeRunner({ timings: { msPerSegment: 600 } }) }, cache: null }).estimate({ kind: 'stems', input: { sr: 44100, channels: [new Float32Array(44100 * 60)] } });
  ok(est.measured && est.text === `About ${Math.round(offsetsOf(60 * SR).length * 0.6)} s on this computer's graphics card.`, `the fake's timings go through the runner's own estimate: "${est.text}"`);
}

/* ------------------------------------------------------------------ nothing committed that shouldn't be (R29) */
{
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  ok(tracked.length > 100, `git lists ${tracked.length} tracked files`);
  const weights = tracked.filter((f) => /\.(onnx|ort|safetensors|pt|th)$/i.test(f));
  ok(!weights.length, `no model weights tracked (.onnx, .ort, .safetensors, .pt, .th)${weights.length ? ': ' + weights.join(', ') : ''}`);
  const runtimes = tracked.filter((f) => /(^|\/)(ort[.-][^/]*\.(m?js|wasm)|onnxruntime[^/]*)$/i.test(f) || /(^|\/)onnxruntime(-web)?\//i.test(f));
  ok(!runtimes.length, `no ONNX Runtime files tracked${runtimes.length ? ': ' + runtimes.join(', ') : ''}`);
  const AUDIO = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|f32)$/i;
  const flip = tracked.filter((f) => f.startsWith('tools/fixtures/flip/') && AUDIO.test(f));
  const strangers = [];
  for (const f of flip) {
    // a fixture there must say how fake-wav.js made it (<file>.json: fakeSong's options) and come out the same again
    const spec = path.join(ROOT, f + '.json');
    let same = false;
    try {
      const { writeWav } = await import('./fake-wav.js');
      const s = fakeSong(JSON.parse(fs.readFileSync(spec, 'utf8')));
      const tmp = path.join(ROOT, 'tools/.out/jobs-fixture.wav');
      writeWav(tmp, s.mix, s.sr);
      same = Buffer.compare(fs.readFileSync(tmp), fs.readFileSync(path.join(ROOT, f))) === 0;
    } catch { same = false; }
    if (!same) strangers.push(f);
  }
  ok(!strangers.length, `audio under tools/fixtures/flip/ is only fake-wav.js's own (${flip.length} file${flip.length === 1 ? '' : 's'})${strangers.length ? ': not ours: ' + strangers.join(', ') : ''}`);
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  ok(/^\*\.onnx$/m.test(ignore) && /^\*\.safetensors$/m.test(ignore), '.gitignore keeps model files out of the repo');
}

/* ------------------------------------------------------------------ Chromium */
const { page, errors, close, base, context } = await open('/tools/engine-test.html');
try {
  // the worker pool, byte for byte against Node
  const pooled = await page.evaluate(async () => {
    const { separate, SEG } = await import('/app/src/jobs/stems/dsp.js');
    const { makePool } = await import('/app/src/jobs/stems/pool.js');
    const { sha256 } = await import('/app/src/jobs/stems/runner.js');
    const { fakeMix } = await import('/tools/fake-song.js');
    const { mix, L } = fakeMix({ seconds: 20, sr: 44100, seed: 1 });
    const time = async (seg, mag) => { const xt = new Float32Array(8 * SEG); for (let k = 0; k < 4; k++) xt.set(seg, k * 2 * SEG); return { zx: new Float32Array(4 * mag.length), xt }; };
    const spectral = async (seg, mag) => { const zx = new Float32Array(4 * mag.length); for (let k = 0; k < 4; k++) zx.set(mag, k * mag.length); return { zx, xt: new Float32Array(8 * SEG) }; };
    const pool = makePool(4);
    const t0 = performance.now();
    const o1 = await separate({ network: time, mix, L, pool });
    const o2 = await separate({ network: spectral, mix, L, pool });
    const ms = performance.now() - t0;
    pool.close();
    const h = (f) => sha256(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
    return { time: await h(o1), spectral: await h(o2), mix: await h(mix), ms, workers: pool.size };
  });
  if (pooled.time !== nodeHash || pooled.spectral !== nodeSpectralHash) T.note(`hashes: mix ${pooled.mix === nodeMixHash ? 'same' : 'differs'}, time ${pooled.time === nodeHash ? 'same' : 'differs'}, spectral ${pooled.spectral === nodeSpectralHash ? 'same' : 'differs'}`);
  ok(pooled.time === nodeHash && pooled.spectral === nodeSpectralHash, `in Chromium, ${pooled.workers} module workers give the same samples as Node, byte for byte (both identity networks, ${(pooled.ms / 1000).toFixed(2)} s)`);

  // the IndexedDB cache, and a cancel
  const idb = await page.evaluate(async () => {
    const { fakeSong } = await import('/tools/fake-song.js');
    const { createJobs } = await import('/app/src/jobs/index.js');
    const { createJobsCache, jobKey } = await import('/app/src/jobs/cache.js');
    const { createFakeRunner } = await import('/app/src/jobs/fake.js');
    const s = fakeSong({ seed: 3, bpm: 110, form: [['Verse', 4], ['Chorus', 4]], sr: 22050 });
    const stems = Object.fromEntries(Object.entries(s.stems).map(([k, v]) => [k, Float32Array.from(v, (x) => 0.55 * x)]));
    const input = { sr: s.sr, channels: [s.mix] };
    const fake = createFakeRunner({ known: [{ input, stems }], steps: 8, stepMs: 20 });
    const cache = createJobsCache();
    const mode = await cache.mode();
    const a = await createJobs({ runners: { stems: fake }, cache }).run({ kind: 'stems', input });
    const b = await createJobs({ runners: { stems: fake }, cache: createJobsCache() }).run({ kind: 'stems', input });
    const same = ['drums', 'bass', 'other', 'vocals'].every((n) => b.result.stems[n][0].length === s.mix.length && b.result.stems[n][0].every((x, i) => x === a.result.stems[n][0][i]));
    const s2 = fakeSong({ seed: 4, bpm: 96, form: [['Verse', 4]], sr: 22050 });
    const in2 = { sr: s2.sr, channels: [s2.mix] };
    fake.learn(in2, s2.stems);
    const ac = new AbortController();
    const p = createJobs({ runners: { stems: fake }, cache }).run({ kind: 'stems', input: in2 }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    let name = '';
    try { await p; } catch (e) { name = e.name; }
    const left = await createJobsCache().get(await jobKey('stems', in2, fake.model));
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
    return { mode, a: a.cached, b: b.cached, same, calls: fake.calls, name, left, dbs };
  });
  ok(idb.mode === 'idb' && idb.dbs.includes('overdub-jobs'), "the browser keeps jobs in IndexedDB ('overdub-jobs')");
  ok(!idb.a && idb.b && idb.same, 'a second run, from a fresh cache, is answered by IndexedDB with the same samples');
  ok(idb.name === 'AbortError' && idb.left == null && idb.calls === 2, 'a cancelled job leaves nothing in IndexedDB');

  // the runner through the browser's fetch, the Cache Storage and a dynamic import, with the fake runtime served here
  const hits = [];
  page.on('request', (r) => hits.push(r.url()));
  const FAKE_ORT = `
    export const env = { wasm: {} };
    export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
    const SEG = 343980;
    const t = (data) => ({ data, getData: async () => data, dispose() {} });
    export const InferenceSession = { async create(bytes, opts) {
      (globalThis.__ortCreates ||= []).push(opts.executionProviders[0] + ':' + bytes.length);
      return { async run({ mix, mag }) {
        const xt = new Float32Array(8 * SEG); for (let k = 0; k < 4; k++) xt.set(mix.data, k * 2 * SEG);
        return { zx: t(new Float32Array(4 * mag.data.length)), xt: t(xt) };
      } };
    } };`;
  await context.route('**/fake-models/**', (route) => {
    const u = route.request().url();
    if (u.endsWith('/model.onnx')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(MODEL), headers: { 'access-control-allow-origin': '*' } });
    if (u.endsWith('/ort.webgpu.min.mjs')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_ORT, headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 404, body: '' });
  });
  const real = await page.evaluate(async ({ base, sha, bad }) => {
    const { createStemsRunner } = await import('/app/src/jobs/stems/runner.js');
    const { stemsConfig } = await import('/app/src/site-config.js');
    await caches.delete('overdub-models');
    const cfg = (h) => stemsConfig({ model: base + '/fake-models/model.onnx', runtime: base + '/fake-models/ort.webgpu.min.mjs', sha256: h });
    const out = {};
    try { await createStemsRunner(cfg(bad)).run({ sr: 44100, channels: [new Float32Array(44100)] }); } catch (e) { out.bad = e.message; }
    out.keptBad = !!(await (await caches.open('overdub-models')).match(base + '/fake-models/model.onnx'));
    out.createsAfterBad = (globalThis.__ortCreates || []).length;
    const r = createStemsRunner(cfg(sha));
    out.first = await r.estimate({ seconds: 60 });
    const sr = 44100, L = sr * 10, left = new Float32Array(L), right = new Float32Array(L);
    for (let i = 0; i < L; i++) { left[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr); right[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / sr); }
    const res = await r.run({ sr, channels: [left, right] });
    let e = 0, p = 0;
    for (const n of ['drums', 'bass', 'other', 'vocals']) for (const [c, x] of [[0, left], [1, right]]) for (let i = 0; i < L; i++) { const d = res.stems[n][c][i] - x[i]; e += d * d; p += x[i] * x[i]; }
    out.db = 10 * Math.log10(e / p);
    out.kept = !!(await (await caches.open('overdub-models')).match(base + '/fake-models/model.onnx'));
    out.second = await createStemsRunner(cfg(sha)).estimate({ seconds: 60 });
    out.creates = globalThis.__ortCreates;
    out.device = res.device;
    return out;
  }, { base, sha: MODEL_SHA, bad: 'cd'.repeat(32) });
  const ortHits = hits.filter((u) => u.includes('/fake-models/ort'));
  ok(/doesn't match its pinned SHA-256/.test(real.bad || '') && !real.keptBad && real.createsAfterBad === 0, `a bad hash in the browser: refused, not kept, no session ("${real.bad}")`);
  ok(ortHits.length === 1, `the runtime is imported only after a model passes its hash (${ortHits.length} request for it)`);
  ok(real.db <= -100 && real.creates.length === 1 && real.creates[0].endsWith(':' + MODEL.length), `a split in Chromium on the fake runtime (${real.device === 'gpu' ? 'WebGPU' : 'the CPU'}), the pool and all: every stem the input, ${real.db.toFixed(1)} dB`);
  ok(real.first.firstTime && real.kept && !real.second.firstTime, `the model is kept in Cache Storage ('overdub-models'): first "${real.first.text}", then "${real.second.text}"`);

  // the studio with no stems config: no request for a model or a runtime, ever
  const studio = await context.newPage();
  const reqs = [];
  studio.on('request', (r) => reqs.push(r.url()));
  await studio.goto(base + '/app/', { waitUntil: 'load' });
  const offMsg = await studio.evaluate(async () => {
    const { pageJobs } = await import('/app/src/jobs/index.js');
    const j = await pageJobs();
    const r = j.runner('stems');
    try { await j.run({ kind: 'stems', input: { sr: 44100, channels: [new Float32Array(4410)] } }); return 'ran'; } catch (e) { return (r.available ? 'on: ' : '') + e.message; }
  });
  await studio.waitForTimeout(300);
  const foreign = reqs.filter((u) => !/^(data|blob):/.test(u) && (!u.startsWith(base) || /\.onnx|\/ort[.-]|onnxruntime|fake-models/i.test(u)));
  ok(offMsg === OFF && !foreign.length, `the studio with no stems config: the runner is off ("${offMsg}") and nothing was fetched for it (${reqs.length} requests, all this server's own studio files)`);
  await studio.close();
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally { await close(); }
T.done();
