// app/src/jobs/: the pieces of the job layer and the stems runner that need no browser (the whole, with a fake runtime
// and Chromium's workers, is tools/jobs-test.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SR, SEG, offsetsOf, normalise, separate, tables } from '../../app/src/jobs/stems/dsp.js';
import { inlinePool, poolSize } from '../../app/src/jobs/stems/pool.js';
import { estimateFrom, createStemsRunner, elsewhere, OFF, PRIOR } from '../../app/src/jobs/stems/runner.js';
import { createJobs } from '../../app/src/jobs/index.js';
import { createJobsCache, jobKey } from '../../app/src/jobs/cache.js';
import { createFakeRunner } from '../../app/src/jobs/fake.js';
import { stemsConfig } from '../../app/src/site-config.js';
import { resample } from '../../app/src/audio/analyze/resample.js';

describe('the stems DSP', () => {
  test('its own sine and cosine tables agree with Math to the last bit or two', () => {
    let worst = 0;
    for (let i = 0; i < 2048; i++) {
      worst = Math.max(
        worst,
        Math.abs(tables.cosT[i] - Math.cos((2 * Math.PI * i) / 4096)),
        Math.abs(tables.sinT[i] - Math.sin((2 * Math.PI * i) / 4096)),
      );
    }
    assert.ok(worst < 1e-15);
    assert.equal(tables.win[0], 0);
    assert.equal(tables.win[2048], 1);
  });
  test('segments: 7.8 s, a stride of three quarters, the last one short', () => {
    assert.deepEqual(offsetsOf(10), [0]);
    assert.deepEqual(offsetsOf(SEG), [0, Math.floor(0.75 * SEG)]);
    assert.equal(offsetsOf(60 * SR).length, Math.ceil((60 * SR) / Math.floor(0.75 * SEG)));
  });
  test('normalising undoes', () => {
    const mix = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 7) * 0.4 + 0.1);
    const { x, mean, std } = normalise(mix, 1000);
    assert.ok(Math.abs(mean - 0.1) < 0.01 && std > 0.1);
    for (let i = 0; i < 2000; i += 37) assert.ok(Math.abs(x[i] * std + mean - mix[i]) < 1e-6);
  });
  test('a time-branch identity network gives the input back through one short segment', async () => {
    const L = 22050,
      mix = Float32Array.from({ length: 2 * L }, (_, i) => 0.3 * Math.sin(i / 11));
    const net = async (seg, mag) => {
      const xt = new Float32Array(8 * SEG);
      for (let k = 0; k < 4; k++) xt.set(seg, k * 2 * SEG);
      return { zx: new Float32Array(4 * mag.length), xt };
    };
    const out = await separate({ network: net, mix, L, pool: inlinePool() });
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < 2 * L; i += 101) assert.ok(Math.abs(out[s * 2 * L + i] - mix[i]) < 1e-6);
  });
  test('the pool is at most six workers and at least one', () => {
    assert.equal(poolSize(2), 1);
    assert.equal(poolSize(8), 6);
    assert.equal(poolSize(32), 6);
  });
  test('resampling with interpolated phases is cleaner than the nearest phase', () => {
    const x = Float64Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 3000 * i) / 48000));
    const err = (opt) => {
      const y = resample(resample(x, 48000, 44100, opt), 44100, 48000, opt);
      let e = 0,
        p = 0;
      for (let i = 2000; i < 46000; i++) {
        e += (y[i] - x[i]) ** 2;
        p += x[i] ** 2;
      }
      return 10 * Math.log10(e / p);
    };
    assert.ok(err({ interp: true }) < err() - 15); // measured: −95 against −77 dB
  });
});

describe('the estimate', () => {
  test('from the warm-up: segments times its milliseconds', () => {
    const e = estimateFrom({ device: 'gpu', seconds: 60, msPerSegment: 500 });
    assert.equal(e.measured, true);
    assert.equal(e.wait, (offsetsOf(60 * SR).length * 500) / 1000);
    assert.equal(e.text, `About ${Math.round(e.wait)} s on this computer's graphics card.`);
  });
  test("before it: the spike's figures, said as a guess, with the download", () => {
    const e = estimateFrom({ device: 'cpu', seconds: 180, firstTime: true, download: 88.7e6 });
    assert.equal(e.wait, Math.round(3 * PRIOR.cpu * 10) / 10);
    assert.match(
      e.text,
      /^Roughly 6 min on this computer's processor, after a one-time download of 89 MB\. No WebGPU here/,
    );
  });
  test('a warning under 8 GB', () => {
    assert.match(estimateFrom({ device: 'gpu', seconds: 60, deviceMemory: 4 }).text, /under 8 GB/);
    assert.equal(estimateFrom({ device: 'gpu', seconds: 60, deviceMemory: 8 }).warn, null);
  });
});

describe('the site config and the runner switched off', () => {
  test('stems needs two allowed URLs and a 64-digit hash', () => {
    const sha = 'f'.repeat(64);
    assert.deepEqual(
      stemsConfig({ model: 'https://a.example/m.onnx', runtime: 'https://b.example/ort.mjs', sha256: sha }),
      { model: 'https://a.example/m.onnx', runtime: 'https://b.example/ort.mjs', sha256: sha, id: 'htdemucs' },
    );
    assert.equal(
      stemsConfig({ model: 'http://a.example/m.onnx', runtime: 'https://b.example/ort.mjs', sha256: sha }),
      null,
    );
    assert.equal(stemsConfig({ model: 'https://a.example/m.onnx', runtime: 'https://b.example/ort.mjs' }), null);
    assert.equal(stemsConfig(undefined), null);
  });
  test("the runtime defaults to vendor/ort/ beside the config, and must be on the page's origin (the CSP)", () => {
    const sha = 'f'.repeat(64),
      site = 'https://overdubstudio.com';
    const c = stemsConfig({ model: 'vendor/models/m.onnx', sha256: sha }, `${site}/app/site-config.json`);
    assert.equal(c.runtime, `${site}/app/vendor/ort/ort.webgpu.min.mjs`);
    assert.equal(elsewhere(c, site), null);
    const cdn = { ...c, runtime: 'https://cdn.example/ort.webgpu.min.mjs' };
    assert.match(
      elsewhere(cdn, site),
      /its runtime \(https:\/\/cdn\.example\/ort\.webgpu\.min\.mjs\) is on another site/,
    );
    assert.match(createStemsRunner(cdn, { origin: site }).offReason, /is on another site/);
    assert.equal(createStemsRunner(cdn, { origin: site }).available, false);
  });
  test('no config: off, and nothing is fetched', async () => {
    let calls = 0;
    const r = createStemsRunner(null, {
      fetch: async () => {
        calls++;
      },
      loadRuntime: async () => {
        calls++;
      },
    });
    assert.equal(r.available, false);
    await assert.rejects(r.run({ sr: 44100, channels: [new Float32Array(4)] }), { message: OFF });
    await assert.rejects(r.estimate({ seconds: 1 }), { message: OFF });
    assert.equal(calls, 0);
  });
});

describe('jobs', () => {
  const input = { sr: 8000, channels: [Float32Array.from({ length: 800 }, (_, i) => Math.sin(i / 5))] };
  const stems = {
    drums: new Float32Array(800),
    bass: new Float32Array(800).fill(0.1),
    other: new Float32Array(800),
    vocals: input.channels[0],
  };
  test('a second run is a cache hit; another model version is not', async () => {
    const fake = createFakeRunner({ known: [{ input, stems }] });
    const jobs = createJobs({ runners: { stems: fake }, cache: createJobsCache({ idb: null }) });
    const a = await jobs.run({ kind: 'stems', input });
    const b = await jobs.run({ kind: 'stems', input });
    assert.equal(a.cached, false);
    assert.equal(b.cached, true);
    assert.equal(fake.calls, 1);
    assert.equal(a.result.stems.bass[0][3], Math.fround(0.1));
    await jobs.run({ kind: 'stems', input, model: { id: 'fake', version: '2' } });
    assert.equal(fake.calls, 2);
    assert.match(await jobKey('stems', input, { id: 'm', version: 'v' }), /^stems:[0-9a-f]{64}:m:v$/);
  });
  test('a cancel caches nothing', async () => {
    const fake = createFakeRunner({ known: [{ input, stems }], steps: 3 });
    const cache = createJobsCache({ idb: null });
    const jobs = createJobs({ runners: { stems: fake }, cache });
    const ac = new AbortController();
    await assert.rejects(jobs.run({ kind: 'stems', input }, { signal: ac.signal, onProgress: () => ac.abort() }), {
      name: 'AbortError',
    });
    assert.equal(await cache.get(await jobKey('stems', input, fake.model)), null);
  });
  test('unknown kinds and missing runners are refused', async () => {
    await assert.rejects(createJobs({ cache: null }).run({ kind: 'stems', input }), /Nothing here runs stems/);
    await assert.rejects(createJobs({ cache: null }).run({ kind: 'video', input }), /No such job/);
  });
});
