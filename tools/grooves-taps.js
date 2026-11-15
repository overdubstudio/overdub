// The tap-to-find sweep of tools/grooves-test.js [tools]: every main groove of the library found from its own jittered
// taps, from the downbeat or from a shifted start. Each pass is 10 s of pure CPU, so the suite runs each in a worker
// thread of this file, beside each other and beside its pages.
//   inThread(label, opt) -> [[cond, msg], ...]   the pass's two checks, as the suite says them
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as G from '../app/src/core/grooves.js';
import { rng } from '../app/src/core/transforms.js';

const say = (xs, n = 6) => (xs.length ? ': ' + xs.slice(0, n).join('; ') + (xs.length > n ? ` … (${xs.length})` : '') : '');
const voiceOf = (p) => (G.familyOf(p) === 'kick' ? 'kick' : G.familyOf(p) === 'snare' ? 'snare' : 'hat');
// the onsets of a groove as a drummer would tap them: every hit (ghosts too), at its middle tempo with its swing and
// lay, each jittered up to ±jitter ms (seeded); skip drops the first beats (a shifted start)
function tapsOf(g, { skip = 0, jitter = 12, seed = 7, main = false } = {}) {
  const tempo = Math.round((g.tempo[0] + g.tempo[1]) / 2), len = Math.max(8, g.length * 2) + skip;
  const played = G.realize(g, { tempo, seed, length: len, human: 0 });
  const R = rng(`taps:${seed}:${g.id}`), out = [], seen = new Set();
  for (let k = 0; k * g.length < len; k++) {
    for (const h of g.hits) {
      const t = k * g.length + h.t, v = voiceOf(h.p);
      if (t < skip - 1e-6 || t >= len || h.v < (main ? 0.6 : 0.44) || (main && v === 'hat')) continue;
      const n = played.find((x) => x.p === h.p && Math.abs(x.t - t) < 0.2), key = `${v}:${Math.round(t * 48)}`;
      if (!n || seen.has(key)) continue;
      seen.add(key);
      out.push({ t: (n.t * 60) / tempo + ((R() - 0.5) * 2 * jitter) / 1000, voice: v });
    }
  }
  return { tempo, taps: out.sort((a, b) => a.t - b.t) };
}
const sig = (g) => { const o = G.onsetsOf(g); return JSON.stringify([g.length, o.kick.main, o.snare.main, o.all.main]); };
// every main groove from its own jittered onsets: first, or tied first with a groove that has the same hits
function sweep(label, opt) {
  const out = [], main = G.library().grooves.filter((g) => G.MAIN_PARTS.includes(g.part));
  const miss = [], terr = [];
  let first = 0, tied = 0, top5 = 0;
  for (const g of main) {
    const { tempo, taps } = tapsOf(g, opt);
    const m = G.matchTaps(taps);
    const r0 = m?.results[0];
    if (!r0) { miss.push(`${g.id}: nothing`); continue; }
    terr.push(Math.abs(r0.bpm - tempo) / tempo);
    const mine = m.results.find((r) => r.groove.id === g.id);
    if (mine) top5++;
    if (r0.groove.id === g.id) first++;
    else if (sig(r0.groove) === sig(g) || (mine && r0.score - mine.score < 0.001)) tied++;
    else miss.push(`${g.id} came after ${r0.groove.id} (${mine ? mine.score : 'not in the five'} vs ${r0.score})`);
  }
  terr.sort((a, b) => a - b);
  out.push([first + tied >= main.length - 1 && top5 === main.length, `${label}: ${first} of ${main.length} main grooves come back first from their own taps, ${tied} tie with one that plays the same hits, all ${top5} in the closest five${say(miss)}`]);
  out.push([terr[terr.length - 1] < 0.02, `${label}: the tempo read from the taps is within 2% for all of them (worst ${(terr[terr.length - 1] * 100).toFixed(2)}%)`]);
  return out;
}

export const inThread = (label, opt) => new Promise((resolve, reject) => {
  const w = new Worker(new URL(import.meta.url), { workerData: { groovesSweep: [label, opt] } });
  let got = null;
  w.once('message', (m) => { got = m; });
  w.once('error', reject);
  w.once('exit', (code) => (got ? resolve(got) : reject(new Error(`the tap sweep's worker exited (${code}) with nothing said`))));
});

if (!isMainThread && workerData?.groovesSweep) parentPort.postMessage(sweep(...workerData.groovesSweep));
