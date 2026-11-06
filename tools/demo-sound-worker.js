// A worker for tools/demos-test.js: renders one demo, or one of its tracks alone, with the canonical Node renderer
// and sends back only the numbers the checks read (never the samples). Renders are independent, so the test fans a
// song's mix and its stems out over the machine's cores.
//   job: { id, track: null | index of the track in the song, sections: [{ sec, from, to }] }   (from/to in seconds, as measure() takes them)
//   result, a mix:  { secs, ms, mix: measure(mix), }
//   result, a stem: { whole: { lufs, tp }, at: { [sec]: { lufs, rms, bands } } }
import { parentPort } from 'node:worker_threads';
import { demoById } from '../app/src/core/demo.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure } from '../app/src/audio/measure.js';

parentPort.on('message', ({ n, id, track, sections }) => {
  try {
    const p = demoById(id);
    const t0 = performance.now();
    const buf = renderSong(p, track == null ? { from: 0, to: p.loop.end } : { from: 0, to: p.loop.end, tracks: [p.tracks[track].id] });
    const ms = Math.round(performance.now() - t0);
    if (track == null) {
      parentPort.postMessage({ n, ok: { secs: +(buf.length / buf.sr).toFixed(1), ms, mix: measure(buf) } });
      return;
    }
    const whole = measure(buf);
    const at = {};
    for (const { sec, from, to } of sections) {
      const m = measure(buf, { from, to });
      at[sec] = { lufs: m.lufs, rms: m.rms, bands: m.bands };
    }
    parentPort.postMessage({ n, ok: { whole: { lufs: whole.lufs, tp: whole.truePeak }, at } });
  } catch (e) {
    parentPort.postMessage({ n, error: String((e && e.stack) || e) });
  }
});
