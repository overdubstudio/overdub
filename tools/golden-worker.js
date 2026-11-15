// A worker for tools/golden-test.js: renders one golden scene (tools/golden-scenes.js) with the canonical Node renderer
// and sends back its hash, its measure and what the checks read. Scenes are independent renders, so the test fans them
// out over a few cores; a worker is one V8 isolate in the same Node, so its renders are the main thread's, bit for bit.
//   job:    { n, name, twice, keep }   twice: render it a second time here and hash that too; keep: send the samples back
//   result: { sha256, again?, length, sr, ms, lufs, truePeak, peak, warnings, skipped, channels? }
import { parentPort } from 'node:worker_threads';
import { scenes } from './golden-scenes.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { measure } from '../app/src/audio/measure.js';

let all = null;
parentPort.on('message', ({ n, name, twice, keep }) => {
  try {
    all ||= scenes();
    const s = all.find((x) => x.name === name);
    const a = Date.now();
    const r = renderSong(s.project, { ...s.opts, assets: s.assets });
    const ms = Date.now() - a;
    const m = measure({ sr: r.sr, channels: r.channels });
    const ok = { sha256: sha256(r), length: r.length, sr: r.sr, ms, lufs: m.lufs, truePeak: m.truePeak, peak: m.peak, warnings: r.warnings, skipped: r.skipped };
    if (twice) ok.again = sha256(renderSong(s.project, { ...s.opts, assets: s.assets }));
    if (keep) ok.channels = r.channels;
    parentPort.postMessage({ n, ok }, keep ? r.channels.map((c) => c.buffer) : []);
  } catch (e) {
    parentPort.postMessage({ n, error: String((e && e.stack) || e) });
  }
});
