// The local stems runner (spec 0014 R21, R22): htdemucs v4 on this computer, in the open core and switched off unless
// the site config names a model (jobs/index.js pageJobs). The network runs in ONNX

// Runtime Web, loaded at run time by a dynamic import from the config's `stems.runtime` (never a file in this repo),
// which must be on the page's own origin: the studio's CSP (app/index.html) runs scripts from 'self' only, so a runtime
// on a CDN would fail as "Failed to fetch dynamically imported module". deploy.sh stages it under app/vendor/ort/ from
// the config's runtimeFrom; serve.js answers it from OVERDUB_STEMS_RUNTIME_DIR. The model must be on this origin too, or
// http: on this machine (CSP connect-src). Either one elsewhere: the runner is off and offReason says why, before
// anything is fetched. The model is fetched from `stems.model`, checked against the
// pinned `stems.sha256` before anything uses it, and kept in the browser's Cache Storage ('overdub-models') so the
// download happens once. WebGPU first, then the CPU (WebAssembly; one thread unless the page is cross-origin isolated,
// which the studio is not). Everything around the network is dsp.js, in a pool of workers (pool.js).
//
// With no config (forks, self-hosting, the live site until AJ switches it on) nothing here fetches or imports
// anything: `available` is false and every call says the runner is off.
//
//   createStemsRunner(config, deps?) -> runner      config: site-config.js stemsConfig(), or null
//     runner.available, runner.model { id, version } (version: the pinned SHA-256), runner.offReason
//     await runner.device() -> 'gpu' | 'cpu'       WebGPU with an adapter, or not (asks nothing of the network)
//     await runner.estimate({ seconds }) -> { device, wait, measured, download, firstTime, warn, text }
//         wait in seconds: from the warm-up run once load() has run (measured), else from the spike's figures on AJ's
//         Mac (PRIOR, a guess, said as one); download in bytes the first time (null when the size isn't known)
//     await runner.load({ onProgress?, signal? })   the model (download, hash), the runtime, a session, the warm-up
//     await runner.run({ sr, channels }, { onProgress?, signal? }) -> { sr, stems: { drums, bass, other, vocals },
//         device, ms }   each stem is an array of channels at the input's rate and length, mono in, mono out
//     runner.dispose()
//   onProgress({ stage: 'download' | 'prepare' | 'split', fraction })
//   estimateFrom({ device, seconds, msPerSegment?, cpuThreads?, download?, firstTime?, deviceMemory? }) -> estimate
//   estimateText(estimate) -> "About 25 s on this computer's graphics card." and the rest
//
// The model's contract (what the spike exported): inputs `mix` [1, 2, SEG] and `mag` [1, 4, FQ, T], float32; outputs
// `zx` [1, 4, 4, FQ, T] and `xt` [1, 4, 2, SEG], the sources in SOURCES' order.
// deps (tests): fetch, loadRuntime(url), gpu (navigator.gpu), deviceMemory, cores, isolated, now(), pool(), caches,
// origin (the page's: location.origin; null skips the origin check, as in Node).
import { SR, SEG, FQ, T, SOURCES, spec, separate, normalise, offsetsOf } from './dsp.js';
import { makePool } from './pool.js';
import { resample } from '../../audio/analyze/resample.js';

// seconds an audio minute, measured in the spike on AJ's M5 Pro (spec 0014, "What the stems spike measured"): WebGPU
// (median), WASM with 8 threads (cross-origin isolated), WASM on one thread. Only a first guess: the warm-up replaces it.
export const PRIOR = { gpu: 7.2, cpuThreads: 33, cpu: 126 };
export const LOW_MEMORY_GB = 8;
export const MODEL_CACHE = 'overdub-models';
export const OFF = 'Splitting is off on this site. Bring the stems as files instead.';
// what the studio's CSP lets the runner reach: script-src 'self' for the runtime; connect-src 'self' and http: on this
// machine for the model
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
export function elsewhere(config, origin) {
  if (!config || !origin) return null;
  const at = (u) => { try { return new URL(u).origin; } catch { return null; } };
  if (at(config.runtime) !== origin) {
    return `Splitting is off on this site: its runtime (${config.runtime}) is on another site, and the studio only runs code from its own. Bring the stems as files instead.`;
  }
  if (at(config.model) !== origin && !LOCAL_HTTP.test(config.model)) {
    return `Splitting is off on this site: its model (${config.model}) is on another site, and the studio only fetches from its own. Bring the stems as files instead.`;
  }
  return null;
}

const aborted = () => { const e = new Error('The split was cancelled'); e.name = 'AbortError'; return e; };
const check = (signal) => { if (signal && signal.aborted) throw aborted(); };

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

/* ---------------------------------------------------------------- what it will cost */
const say = (s) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.max(1, Math.round(s / 60))} min`);

export function estimateText(e) {
  const where = e.device === 'gpu' ? "this computer's graphics card" : "this computer's processor";
  let t = `${e.measured ? 'About' : 'Roughly'} ${say(e.wait)} on ${where}`;
  const mb = (b) => (b < 1e6 ? 'under 1 MB' : `${Math.round(b / 1e6)} MB`);
  if (e.firstTime) t += e.download ? `, after a one-time download of ${mb(e.download)}` : ', after a one-time download of the model';
  t += '.';
  if (e.device === 'cpu') t += ' No WebGPU here, so the processor does the work.';
  if (e.warn) t += ' ' + e.warn;
  return t;
}

export function estimateFrom({ device, seconds, msPerSegment = null, cpuThreads = false, download = null, firstTime = false, deviceMemory = null }) {
  const measured = Number.isFinite(msPerSegment) && msPerSegment > 0;
  const perMin = device === 'gpu' ? PRIOR.gpu : cpuThreads ? PRIOR.cpuThreads : PRIOR.cpu;
  const wait = measured ? (offsetsOf(Math.max(1, Math.round(seconds * SR))).length * msPerSegment) / 1000 : (seconds / 60) * perMin;
  const warn = Number.isFinite(deviceMemory) && deviceMemory < LOW_MEMORY_GB
    ? `This computer reports under ${LOW_MEMORY_GB} GB of memory, and a split can use about 5 GB: it may slow everything down, or stop.`
    : null;
  const e = { device, wait: Math.round(wait * 10) / 10, measured, download: firstTime ? download : 0, firstTime: !!firstTime, warn };
  e.text = estimateText(e);
  return e;
}

/* ---------------------------------------------------------------- the runner */
export function createStemsRunner(config, deps = {}) {
  const {
    fetch: f = globalThis.fetch,
    loadRuntime = (url) => import(url),
    gpu = globalThis.navigator?.gpu,
    deviceMemory = globalThis.navigator?.deviceMemory,
    cores = globalThis.navigator?.hardwareConcurrency || 4,
    isolated = !!globalThis.crossOriginIsolated,
    now = () => performance.now(),
    pool = () => makePool(),
    caches = globalThis.caches,
    origin = globalThis.location?.origin ?? null,
  } = deps;
  const why = config ? elsewhere(config, origin) : OFF;
  if (why && why !== OFF) console.warn(`overdub: ${why} (the stems runtime and model are served from this site: deploy/live-config.json stems.runtimeFrom and modelFrom stage them at deploy; docs/ARCHITECTURE.md, "Jobs and the stems runner")`);
  const off = () => Promise.reject(new Error(why));
  if (why) {
    return {
      available: false, model: null, offReason: why,
      device: off, estimate: off, load: off, run: off, dispose() {},
    };
  }

  let dev = null, ready = null, state = null;   // state: { ort, session, device, msPerSegment }
  const threads = isolated ? Math.min(8, cores) : 1;

  async function device() {
    if (dev) return dev;
    let a = null;
    try { a = gpu ? await gpu.requestAdapter() : null; } catch { a = null; }
    return (dev = a ? 'gpu' : 'cpu');
  }

  async function modelStore() {
    try { return caches ? await caches.open(MODEL_CACHE) : null; } catch { return null; }
  }
  async function cachedModel() {
    const c = await modelStore();
    if (!c) return null;
    try { const r = await c.match(config.model); return r ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
  }

  async function download(onProgress, signal) {
    const r = await f(config.model, { mode: 'cors', credentials: 'omit', signal: signal || undefined });
    if (!r.ok) throw new Error(`The model didn't download (HTTP ${r.status})`);
    const total = Number(r.headers?.get?.('content-length')) || config.bytes || 0;
    if (!r.body || !r.body.getReader || !total) return new Uint8Array(await r.arrayBuffer());
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (onProgress) onProgress({ stage: 'download', fraction: Math.min(1, got / total) });
      check(signal);
    }
    const bytes = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return bytes;
  }

  // the model's bytes, checked against the pinned hash; a cached copy that no longer matches is dropped and fetched again
  async function modelBytes(onProgress, signal) {
    let bytes = await cachedModel();
    if (bytes && (await sha256(bytes)) !== config.sha256) {
      bytes = null;
      try { await (await modelStore())?.delete(config.model); } catch { /* fetch again anyway */ }
    }
    if (bytes) return bytes;
    bytes = await download(onProgress, signal);
    check(signal);
    const got = await sha256(bytes);
    if (got !== config.sha256) throw new Error(`The model doesn't match its pinned SHA-256 (got ${got.slice(0, 12)}…, want ${config.sha256.slice(0, 12)}…). It was not used.`);
    try { await (await modelStore())?.put(config.model, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* the browser declined to keep it */ }
    return bytes;
  }

  const networkOf = (ort, session) => async (seg, mag) => {
    const res = await session.run({ mix: new ort.Tensor('float32', seg, [1, 2, SEG]), mag: new ort.Tensor('float32', mag, [1, 4, FQ, T]) });
    const read = async (t) => (t.getData ? await t.getData() : t.data);
    const zx = await read(res.zx), xt = await read(res.xt);
    res.zx.dispose?.(); res.xt.dispose?.();
    return { zx, xt };
  };

  async function load({ onProgress = null, signal = null } = {}) {
    if (ready) return ready;
    ready = (async () => {
      check(signal);
      const bytes = await modelBytes(onProgress, signal);
      check(signal);
      if (onProgress) onProgress({ stage: 'prepare', fraction: 0 });
      const mod = await loadRuntime(config.runtime);
      const ort = mod && mod.default && mod.default.InferenceSession ? mod.default : mod;
      if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = new URL('./', config.runtime).href; ort.env.wasm.numThreads = threads; }
      const opts = (ep) => ({ executionProviders: [ep], graphOptimizationLevel: 'all' });
      let session = null, used = await device();
      if (used === 'gpu') {
        try { session = await ort.InferenceSession.create(bytes, opts('webgpu')); } catch { session = null; used = 'cpu'; }
      }
      if (!session) session = await ort.InferenceSession.create(bytes, opts('wasm'));
      check(signal);
      // the warm-up: one segment of silence. On the graphics card the first call compiles its shaders, so the second
      // is the one timed; on the CPU the first is already the real speed.
      const net = networkOf(ort, session), zero = new Float32Array(2 * SEG), mag = spec(zero);
      let t0 = now();
      await net(zero, mag);
      if (used === 'gpu') { t0 = now(); await net(zero, mag); }
      const msPerSegment = now() - t0;
      check(signal);
      if (onProgress) onProgress({ stage: 'prepare', fraction: 1 });
      state = { ort, session, device: used, msPerSegment, net };
      return state;
    })();
    try { return await ready; } catch (e) { ready = null; state = null; throw e; }
  }

  async function estimate({ seconds }) {
    const d = state ? state.device : await device();
    const firstTime = !state && !(await cachedModel());
    return estimateFrom({ device: d, seconds, msPerSegment: state ? state.msPerSegment : null, cpuThreads: threads > 1, download: config.bytes || null, firstTime, deviceMemory });
  }

  async function run(input, { onProgress = null, signal = null } = {}) {
    const t0 = now();
    const st = await load({ onProgress, signal });
    const chs = ArrayBuffer.isView(input.channels) ? [input.channels] : input.channels;
    const sr = input.sr, L0 = chs[0].length;
    const at44 = (x) => (sr === SR ? x : resample(x, sr, SR, { interp: true }));
    const l = at44(chs[0]), r = chs.length > 1 ? at44(chs[1]) : l, L = l.length;
    const mix = new Float32Array(2 * L);
    mix.set(l, 0); mix.set(r, L);
    const { x, mean, std } = normalise(mix, L);
    const p = pool();
    let out;
    try {
      out = await separate({ network: st.net, mix: x, L, pool: p, signal, onProgress: (d, n) => onProgress && onProgress({ stage: 'split', fraction: d / n }) });
    } finally { p.close(); }
    const back = (y) => {
      const z = sr === SR ? y : resample(y, SR, sr, { interp: true });
      const o = new Float32Array(L0);
      o.set(z.length > L0 ? z.subarray(0, L0) : z);
      return o;
    };
    const stems = {};
    SOURCES.forEach((name, s) => {
      const two = [0, 1].map((c) => {
        const a = out.subarray((s * 2 + c) * L, (s * 2 + c + 1) * L), y = new Float64Array(L);
        for (let i = 0; i < L; i++) y[i] = a[i] * std + mean;
        return y;
      });
      if (chs.length === 1) { const m = new Float64Array(L); for (let i = 0; i < L; i++) m[i] = 0.5 * (two[0][i] + two[1][i]); stems[name] = [back(m)]; }
      else stems[name] = two.map(back);
    });
    return { sr, stems, device: st.device, ms: now() - t0 };
  }

  return {
    available: true,
    model: { id: config.id || 'htdemucs', version: config.sha256 },
    offReason: null,
    device, estimate, load, run,
    dispose() { try { state?.session?.release?.(); } catch { /* gone */ } state = null; ready = null; },
  };
}
