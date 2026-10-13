// The analysis in a Worker (spec 0014 R11): the studio stays free while a three-minute song is read. client.js starts
// it as a module worker. Messages in: { id, input: { sr, mix?, stems? } }; out: { id, stage } as it goes, then
// { id, result } or { id, error }.
import { analyze } from './index.js';

self.onmessage = (e) => {
  const { id, input } = e.data || {};
  try {
    const t0 = performance.now();
    const result = analyze(input, { onProgress: (stage) => self.postMessage({ id, stage }) });
    self.postMessage({ id, result, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
