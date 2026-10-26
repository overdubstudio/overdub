// @ts-check
// Reading a work tape off the main thread (tape.js readTapeInWorker): the analyser, the chroma and the take's level.
// In: { samples: Float32Array, sr }; out: { out } or { error }.
import { readTape } from './tape.js';

self.onmessage = (e) => {
  const { samples, sr } = e.data || {};
  try {
    self.postMessage({ out: readTape(samples, sr) });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
