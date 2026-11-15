// A worker for tools/genre-demos-test.js: renders one song with the canonical Node renderer and sends back its hash
// and, when asked, its samples (transferred, not copied). A demo's renders are independent, so the test runs them on a
// few threads at once; a worker is one V8 isolate in the same Node, so its renders are the main thread's, bit for bit.
//   job:    { n, project, opts, keep }
//   result: { sha256, sr, length, warnings, channels? }
import { parentPort } from 'node:worker_threads';
import '../app/src/devices/builtin/index.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';

parentPort.on('message', ({ n, project, opts, keep }) => {
  try {
    const r = renderSong(project, opts);
    const ok = { sha256: sha256(r), sr: r.sr, length: r.length, warnings: r.warnings };
    if (keep) ok.channels = r.channels;
    parentPort.postMessage({ n, ok }, keep ? r.channels.map((c) => c.buffer) : []);
  } catch (e) {
    parentPort.postMessage({ n, error: String((e && e.stack) || e) });
  }
});
