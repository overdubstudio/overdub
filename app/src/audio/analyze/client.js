// Run the analysis for the studio (spec 0014 R11, R12): from the cache when this input was read before, else in a
// Worker (worker.js), inline where there are no Workers (Node). Cancel with an AbortSignal: the Worker is stopped and
// nothing is cached.
//
//   analyzeAudio({ sr, mix?, stems? }, { onProgress?(stage), signal?, cache?, worker? }) -> Promise<{ result, key,
//       cached, ms }>
//   cache: an analysis cache (cache.js createAnalysisCache; default one for the page), null for none
//   worker: false runs it on this thread
import { analyze } from './index.js';
import { createAnalysisCache, inputKey } from './cache.js';

let pageCache = null;
let seq = 0;
const aborted = () => { const e = new Error('The analysis was cancelled'); e.name = 'AbortError'; return e; };

function inWorker(input, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const id = ++seq;
    const done = () => { try { w.terminate(); } catch { /* gone */ } if (signal) signal.removeEventListener('abort', stop); };
    const stop = () => { done(); reject(aborted()); };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.id !== id) return;
      if (m.stage) { if (onProgress) onProgress(m.stage); return; }
      done();
      if (m.error) reject(new Error(m.error)); else resolve({ result: m.result, ms: m.ms });
    };
    w.onerror = (e) => { done(); reject(new Error('The analysis worker failed: ' + ((e && e.message) || 'unknown'))); };
    w.postMessage({ id, input });
  });
}

export async function analyzeAudio(input, { onProgress = null, signal = null, cache, worker = typeof Worker !== 'undefined' } = {}) {
  if (signal && signal.aborted) throw aborted();
  const store = cache === undefined ? (pageCache || (pageCache = createAnalysisCache())) : cache;
  const key = await inputKey(input);
  if (store) {
    const hit = await store.get(key);
    if (hit) return { result: hit, key, cached: true, ms: 0 };
  }
  let out;
  if (worker) out = await inWorker(input, { onProgress, signal });
  else {
    const t0 = performance.now();
    const result = analyze(input, { onProgress });
    out = { result, ms: performance.now() - t0 };
  }
  if (signal && signal.aborted) throw aborted();
  if (store) await store.put(key, out.result);
  return { result: out.result, key, cached: false, ms: out.ms };
}
