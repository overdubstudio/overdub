// One of the stems runner's DSP workers (pool.js starts them as module workers): the spectrogram of a segment, or one
// source's answer back to sound, off the page's thread. In: { id, op: 'spec', seg } or { id, op: 'ispec', planes, xt };
// out: { id, mag } or { id, out }, the buffer transferred.
import { spec, ispec } from './dsp.js';

self.onmessage = (e) => {
  const { id, op } = e.data || {};
  try {
    if (op === 'spec') { const mag = spec(e.data.seg); self.postMessage({ id, mag }, [mag.buffer]); }
    else if (op === 'ispec') { const out = ispec(e.data.planes, e.data.xt); self.postMessage({ id, out }, [out.buffer]); }
    else self.postMessage({ id, error: 'unknown op ' + op });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
