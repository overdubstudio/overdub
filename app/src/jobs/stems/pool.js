// The stems runner's DSP workers (spec 0014 R21): a few module workers (dsp-worker.js) that make spectrograms and turn
// the network's answers back into sound while the network runs, so the graphics card is never left waiting on the
// FFTs. Where there are no Workers (Node, the tests), the same calls run on this thread.
//
//   makePool(n?) -> { call(msg, transfer?) -> Promise<reply>, close() }   n defaults to min(6, cores − 2), at least 1
//   inlinePool() -> the same interface, no workers
// close() stops every worker; a call still waiting then never answers (the runner has already given up on it).
import { spec, ispec } from './dsp.js';

export function inlinePool() {
  return {
    size: 0,
    async call(msg) {
      if (msg.op === 'spec') return { mag: spec(msg.seg) };
      if (msg.op === 'ispec') return { out: ispec(msg.planes, msg.xt) };
      throw new Error('unknown op ' + msg.op);
    },
    close() {},
  };
}

export function poolSize(cores = globalThis.navigator?.hardwareConcurrency || 4) {
  return Math.max(1, Math.min(6, cores - 2));
}

export function makePool(n = poolSize()) {
  if (typeof Worker === 'undefined') return inlinePool();
  const ws = Array.from({ length: n }, () => new Worker(new URL('./dsp-worker.js', import.meta.url), { type: 'module' }));
  const pending = new Map();
  let next = 0, rr = 0, closed = false;
  const fail = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); };
  for (const w of ws) {
    w.onmessage = (e) => {
      const p = pending.get(e.data && e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data);
    };
    w.onerror = (e) => fail(new Error('A stems worker failed: ' + ((e && e.message) || 'unknown')));
  }
  return {
    size: n,
    call(msg, transfer = []) {
      if (closed) return Promise.reject(new Error('The stems workers are closed'));
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws[rr++ % ws.length].postMessage({ ...msg, id }, transfer);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const w of ws) { try { w.terminate(); } catch { /* gone */ } }
      pending.clear();
    },
  };
}
