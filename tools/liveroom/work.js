// The live room's Node work off the main thread [tools]: a checks module's slow renders, each in a worker thread of its
// own, so they take more than one core and never hold up the event loop (the presses and waits of a page under way).
//
//   offThread(jobs, { max }) -> [replay(T)]   jobs: [{ module (a file URL), fn (its export, called as fn(T, ...args)),
//       args }], up to max (3) at a time, in the order given. Each runs on a tally of its own; replay(T) prints its lines
//       on T as they were said, so the suite reads as if they ran one after the other. A job that throws is a FAIL line.
//       The args are copied to the worker (structured clone), and nothing the job builds is shared: a cache in one
//       worker is that worker's alone.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const SELF = new URL(import.meta.url);
const failed = (fn, e) => ['ok', false, `${fn}: ${String(e?.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)}`];

export async function offThread(jobs, { max = 3 } = {}) {
  const lines = jobs.map(() => null);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++, job = jobs[i];
      lines[i] = await new Promise((resolve) => {
        const w = new Worker(SELF, { workerData: { liveroomWork: true, module: String(job.module), fn: job.fn, args: job.args || [] } });
        let got = null;
        w.once('message', (m) => { got = m; });
        w.once('error', (e) => { got = [...(got || []), failed(job.fn, e)]; });
        w.once('exit', (code) => resolve(got || [failed(job.fn, `its worker exited (${code}) with nothing said`)]));
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, jobs.length) }, lane));
  return lines.map((said) => (T) => { for (const [k, a, b] of said) if (k === 'ok') T.ok(a, b); else T.note(a); });
}

if (!isMainThread && workerData?.liveroomWork) {
  const said = [];
  const T = { ok(cond, msg) { said.push(['ok', !!cond, msg]); return !!cond; }, note(msg) { said.push(['note', msg]); } };
  // (no top-level await: the job's module imports this one, which has to have finished loading first)
  import(workerData.module).then((mod) => mod[workerData.fn](T, ...workerData.args)).catch((e) => { said.push(failed(workerData.fn, e)); }).then(() => parentPort.postMessage(said));
}
