// The job layer (spec 0014 R19, R20): long work on a person's audio that the studio does once and keeps. Stems are the
// first kind. A job picks its kind's runner, reports progress, can be cancelled, and caches what it made (cache.js) by
// the input, the model and the model's version, so a second run of the same song never reaches the runner.
//
// A job returns sound, never ops: the caller lands it in the song as assets (asset.add) so playback and renders read
// the stored samples and never depend on which runner made them, or whether one is still around (R20).
//
//   const jobs = createJobs({ runners?: { stems: runner }, cache? })   cache: createJobsCache(), null for none
//   jobs.register(kind, runner) ; jobs.runner(kind) -> runner | null
//   await jobs.estimate({ kind, input }) -> runner.estimate(...), or { cached: true, text } when it's already done
//   await jobs.run({ kind, input, model? }, { onProgress?, signal? }) -> { kind, key, cached, model, result, ms }
//       input { sr, channels }; model { id, version } (default: the runner's); result for stems: { sr, stems:
//       { drums, bass, other, vocals } }, each an array of channels. A cancelled job rejects with AbortError and
//       leaves nothing in the cache. A runner that is off rejects with its reason (runner.offReason).
//   await pageJobs() -> the page's jobs: the local stems runner as the site config says (off without one)
//
// A runner: { available, model, offReason?, estimate({ seconds }), run(input, { onProgress, signal }) }
// (stems/runner.js, and fake.js for the tests).
import { createJobsCache, jobKey, channelsOf } from './cache.js';
import { loadSiteConfig } from '../site-config.js';
import { createStemsRunner } from './stems/runner.js';

export const KINDS = ['stems'];

const aborted = () => { const e = new Error('The job was cancelled'); e.name = 'AbortError'; return e; };

export function createJobs({ runners = {}, cache } = {}) {
  const table = new Map(Object.entries(runners));
  let store = cache;
  const cacheOf = () => (store === undefined ? (store = createJobsCache()) : store);
  const pick = (kind) => {
    if (!KINDS.includes(kind)) throw new Error(`No such job: ${kind}`);
    const r = table.get(kind);
    if (!r) throw new Error(`Nothing here runs ${kind} jobs`);
    if (!r.available) throw new Error(r.offReason || `${kind} is off here`);
    return r;
  };
  return {
    register(kind, runner) { table.set(kind, runner); },
    runner(kind) { return table.get(kind) || null; },
    async estimate({ kind, input }) {
      const r = pick(kind), c = cacheOf();
      if (c && (await c.get(await jobKey(kind, input, r.model)))) return { cached: true, wait: 0, text: 'Already split on this computer.' };
      return r.estimate({ seconds: channelsOf(input)[0].length / input.sr });
    },
    async run({ kind, input, model = null }, { onProgress = null, signal = null } = {}) {
      if (signal && signal.aborted) throw aborted();
      const r = pick(kind), m = model || r.model, c = cacheOf();
      const key = await jobKey(kind, input, m);
      if (c) {
        const hit = await c.get(key);
        if (hit) return { kind, key, cached: true, model: m, result: hit, ms: 0 };
      }
      const t0 = performance.now();
      const res = await r.run(input, { onProgress, signal });
      if (signal && signal.aborted) throw aborted();
      const result = { sr: res.sr, stems: res.stems };
      if (c) await c.put(key, result);
      return { kind, key, cached: false, model: m, result, ms: performance.now() - t0 };
    },
  };
}

let page = null;
export function pageJobs() {
  return page || (page = loadSiteConfig().then((cfg) => createJobs({ runners: { stems: createStemsRunner(cfg.stems) } })));
}
