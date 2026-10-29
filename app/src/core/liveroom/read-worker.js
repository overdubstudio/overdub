// @ts-check
// The read off the main thread [core; stream B] (docs/research/LIVE-ROOM-MODE.md §4.2): a module Worker around
// core/liveroom/read.js readTake, so eight bars of audio never stall the stage's frames.
//   new Worker(new URL('./read-worker.js', import.meta.url), { type: 'module' })
//   postMessage({ id, samples, sr, opts })  ->  { id, read } | { id, error }
// It exports nothing; imported anywhere but a Worker (Node, the page), it does nothing.

import { readTake } from './read.js';

const scope = /** @type {any} */ (globalThis);
if (typeof scope.WorkerGlobalScope === 'function' && scope instanceof scope.WorkerGlobalScope) {
  scope.onmessage = (e) => {
    const { id, samples, sr, opts } = e.data || {};
    try { scope.postMessage({ id, read: readTake(samples, sr, opts) }); } catch (err) { scope.postMessage({ id, error: String(err?.message || err) }); }
  };
}
