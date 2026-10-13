// A runner for the tests (spec 0014 R23): it knows a few inputs and the stems that made them, hands those back, and
// reports scripted progress, so nothing in a test ever downloads a model. The flip tests feed it fake-wav.js songs
// (tools/fake-song.js: a mix that is the sum of four known signals). Its estimate goes through the real runner's
// arithmetic (runner.js estimateFrom) with timings the test chooses.
//
//   createFakeRunner({ known?: [{ input: { sr, channels }, stems: { drums, bass, other, vocals } }], steps?, stepMs?,
//                      timings?: { device, msPerSegment, download, firstTime, deviceMemory }, model? }) -> runner
//     runner.calls: how many times run() reached it; runner.learn(input, stems) adds one more
//   A stem may be one Float32Array (mono) or an array of channels. An input it doesn't know is refused.
import { inputHash } from './cache.js';
import { estimateFrom } from './stems/runner.js';
import { SOURCES } from './stems/dsp.js';

const aborted = () => { const e = new Error('The split was cancelled'); e.name = 'AbortError'; return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFakeRunner({ known = [], steps = 4, stepMs = 0, timings = {}, model = { id: 'fake', version: '1' } } = {}) {
  const table = new Map(), pending = known.slice();
  const runner = {
    available: true,
    model,
    offReason: null,
    calls: 0,
    learn(input, stems) { pending.push({ input, stems }); },
    async estimate({ seconds }) {
      const t = { device: 'gpu', msPerSegment: 700, download: null, firstTime: false, deviceMemory: 16, ...timings };
      return estimateFrom({ ...t, seconds });
    },
    async run(input, { onProgress = null, signal = null } = {}) {
      runner.calls++;
      while (pending.length) { const k = pending.shift(); table.set(await inputHash(k.input), k.stems); }
      const stems = table.get(await inputHash(input));
      if (!stems) throw new Error("The fake runner doesn't know this input");
      for (let i = 1; i <= steps; i++) {
        if (signal && signal.aborted) throw aborted();
        if (stepMs) await wait(stepMs);
        if (signal && signal.aborted) throw aborted();
        if (onProgress) onProgress({ stage: 'split', fraction: i / steps });
      }
      const out = {};
      for (const name of SOURCES) {
        const s = stems[name];
        out[name] = (ArrayBuffer.isView(s) ? [s] : s).map((c) => Float32Array.from(c));
      }
      return { sr: input.sr, stems: out, device: timings.device || 'gpu', ms: steps * stepMs };
    },
  };
  return runner;
}
