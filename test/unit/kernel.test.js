// The kernel platform's Node-only checks (kernel/worklet.js's parser, kernel/host.js's compileKernel, kernel/check.js's
// level advice, kernel/dsp.js's stdlib). Moved intact from tools/kernel-test.js; the worklet host, the sandbox and the reference kernels stay there
// (they need Chromium), and so does checkDeviceNode (it needs --permission and a child process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dspLib from '../../app/src/kernel/dsp.js';
import { compileKernel } from '../../app/src/kernel/host.js';
import { checks } from './helpers/check.js';

const K = { dsp: dspLib };

test("a syntax error's line, in bounded time", async () => {
  const { kernelCompiler } = await import('../../app/src/kernel/worklet.js');
  const { parse } = kernelCompiler({ dsp: {}, console: null });
  const late = (n) => '({ create() { return { process() {} }; },\n' + 'a: 1,\n'.repeat(n) + '@ })';
  const time = (src) => {
    const t0 = performance.now();
    const r = parse(src);
    return { r, ms: performance.now() - t0 };
  };
  const small = time(late(20)),
    big = time(late(16000)),
    huge = time(late(60000));
  const mid = time(
    '({ create() { return { process() {} }; },\n' + 'a: 1,\n'.repeat(3000) + 'b: ,\n' + 'c: 1,\n'.repeat(3000) + '})',
  );
  assert.ok(
    small.r.line === 22 && big.r.line === 16002 && mid.r.line === 3002,
    `syntax errors keep their lines: 22, ${big.r.line} (16,000 lines in), ${mid.r.line} (mid-file)`,
  );
  assert.ok(
    huge.r.line === null && /SyntaxError/.test(huge.r.error),
    'past 256 KB the error comes without a line (how fast it parses is timed in tools/kernel-test.js)',
  );
});

test('a long run of spaces parses in linear time', async () => {
  const { kernelCompiler } = await import('../../app/src/kernel/worklet.js');
  const { parse } = kernelCompiler({ dsp: {}, console: null });
  const ok = '({ create() { return { process() {} }; } })',
    run = ' '.repeat(250000);
  const time = (src) => {
    const t0 = performance.now();
    const r = parse(src);
    return { r, ms: performance.now() - t0 };
  };
  const mid = time(ok + run + '/* end */'),
    lead = time(run + 'export default ' + ok),
    tail = time(ok + ' ;\n\t;  ' + run);
  assert.ok(
    mid.r.ok && lead.r.ok && tail.r.ok,
    'a kernel with a 250,000-space run parses wherever the run is, and the trailing ; still goes (how fast is timed in tools/kernel-test.js)',
  );
});

test("an effect's level advice names both test signals", async () => {
  const { levelWarnings } = await import('../../app/src/kernel/check.js');
  const w = (dS, dD) => {
    const out = [],
      level = { deltaLU: dS, drumsDeltaLU: dD };
    levelWarnings(level, out);
    if (level.note) out.note = level.note;
    return out;
  };
  const filt = w(-6.2, 8.4),
    quiet = w(-8, -9),
    fine = w(-1, 0.5),
    mild = w(-4, -1),
    strumOnly = w(-7, null);
  assert.ok(
    !filt.length &&
      /depends on the input/.test(filt.note) &&
      /DI strum/.test(filt.note) &&
      /drum loop/.test(filt.note) &&
      /render_and_measure/.test(filt.note) &&
      !/trim the output/.test(filt.note),
    `input-dependent level: a note to measure on the target, not a warning no trim could clear ("${filt.note}")`,
  );
  assert.ok(
    quiet.length === 1 &&
      /trim the output/.test(quiet[0]) &&
      /8 LU quieter/.test(quiet[0]) &&
      /9 LU quieter/.test(quiet[0]),
    `both signals over the limit the same way: trim ("${quiet[0]}")`,
  );
  assert.ok(
    !fine.length &&
      mild.length === 1 &&
      /DI strum/.test(mild[0]) &&
      /drum loop/.test(mild[0]) &&
      strumOnly.length === 1 &&
      /DI strum/.test(strumOnly[0]),
    `within 3 LU: nothing; a mild offset names both signals ("${mild[0]}")`,
  );
});

test('the dsp stdlib', () => {
  const d = (() => {
    const dsp = K.dsp.makeDsp(48000),
      sr = 48000;
    const mag = (a, f) => {
      let re = 0,
        im = 0;
      for (let i = 0; i < a.length; i++) {
        const w = (2 * Math.PI * f * i) / sr;
        re += a[i] * Math.cos(w);
        im += a[i] * Math.sin(w);
      }
      return (2 * Math.hypot(re, im)) / a.length;
    };
    const run = (n, f) => {
      const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = f(i);
      return a;
    };
    const r = {};
    r.frozen = Object.isFrozen(dsp);
    r.api = K.dsp.DSP_API.every((k) => k in dsp) && Object.keys(dsp).every((k) => K.dsp.DSP_API.includes(k));
    r.tanh0 = dsp.tanh(0) === 0 && dsp.tanh(3) === 1 && dsp.tanh(-5) === -1;
    r.mtof = Math.abs(dsp.mtof(69) - 440) < 1e-9 && Math.abs(dsp.ftom(261.6255653) - 60) < 1e-6;
    const r1 = dsp.rng(42),
      r2 = dsp.rng(42);
    r.rng = Array.from({ length: 100 }, () => r1()).every((x) => x === r2() && x >= 0 && x < 1);
    const tri = dsp.osc('tri').freq(1000);
    r.triFund = mag(
      run(4800, () => tri.next()),
      1000,
    ); // ideal 8/pi^2 = 0.8106
    const saw = dsp.osc('saw').freq(1000);
    r.sawFund = mag(
      run(4800, () => saw.next()),
      1000,
    ); // ideal 2/pi = 0.6366
    const f = dsp.svf().set(1000, 0.7071);
    const tone = (hz, fn) => {
      const s = dsp.svf().set(1000, 0.7071, 6);
      const a = run(24000, (i) => s[fn](Math.sin((2 * Math.PI * hz * i) / sr)));
      return 20 * Math.log10(mag(a.subarray(12000), hz));
    };
    r.svf = {
      lp1k: tone(1000, 'lp'),
      lp10k: tone(10000, 'lp'),
      hp100: tone(100, 'hp'),
      bell1k: tone(1000, 'bell'),
      ls100: tone(100, 'lowshelf'),
      hs10k: tone(10000, 'highshelf'),
    };
    void f;
    const os = dsp.oversample2x();
    const imp = run(128, (i) => os.process(i === 10 ? 1 : 0, (x) => x));
    let pk = 0;
    for (let i = 0; i < 128; i++) if (Math.abs(imp[i]) > Math.abs(imp[pk])) pk = i;
    r.osLatency = pk - 10;
    const ks = dsp.karplus(220, 3, 0.5, 9).pluck(1);
    const ka = run(48000, () => ks.next());
    let best = 0,
      bf = 0;
    for (let ff = 215; ff < 225; ff += 0.05) {
      const m = mag(ka.subarray(0, 24000), ff);
      if (m > best) {
        best = m;
        bf = ff;
      }
    }
    r.karplusHz = bf;
    const e = dsp.adsr(0.01, 0.1, 0.5, 0.2).gate(true);
    let i = 0;
    while (e.next() < 1 && i < 48000) i++;
    r.attackMs = i / 48;
    e.gate(false);
    let k = 0;
    while (e.active() && k < 96000) {
      e.next();
      k++;
    }
    r.releaseDone = k < 96000;
    const fd = dsp.fdn(0.6, 2, 0.4);
    let mx = 0;
    for (let j = 0; j < 96000; j++) {
      fd.tick(j < 4800 ? Math.sin(j * 0.05) * 0.5 : 0, 0);
      mx = Math.max(mx, Math.abs(fd.l), Math.abs(fd.r));
    }
    r.fdnPeak = mx;
    r.fdnTail = Math.abs(fd.l) + Math.abs(fd.r);
    const md = dsp.modal([200, 310], [0.3, 0.2]).strike(1);
    let mm = 0;
    for (let j = 0; j < 48000; j++) mm = Math.max(mm, Math.abs(md.next()));
    r.modal = { peak: mm, active: md.active() };
    const n1 = dsp.noise(3, 'pink'),
      n2 = dsp.noise(3, 'pink');
    r.noiseSeeded = Array.from({ length: 50 }, () => n1.next() === n2.next()).every(Boolean);
    const l = dsp.lfo('saw', 1).sync(4, { bpm: 120, playing: true, beat: 2 });
    r.lfoSync = { phase: l.phase, hz: l.dt * 48000 };
    // fft round trip; a convolver with taps [0.5, 0, 0.25]: half the input plus a quarter two samples late, 128 frames
    // later (0 with direct: 128), and nothing else over -180 dB
    const F = dsp.fft(256),
      xs = run(256, (i) => Math.sin(i * 0.3) + (i % 7) / 7),
      Xr = new Float64Array(129),
      Xi = new Float64Array(129),
      back = new Float64Array(256);
    F.forward(xs, Xr, Xi);
    F.inverse(Xr, Xi, back);
    r.fftRound = Math.max(...back.map((v, i) => Math.abs(v - xs[i])));
    const conv = (o) => {
      const c = dsp.convolver([0.5, 0, 0.25], o),
        x = run(600, (i) => (i === 3 ? 1 : 0)),
        y = new Float32Array(600);
      c.process(x, y, null, 600);
      return { lat: c.latency, at: [...y].map((v, i) => [i, v]).filter(([, v]) => Math.abs(v) > 1e-9) };
    };
    r.conv = { plain: conv(), direct: conv({ direct: 128 }) };
    return r;
  })();
  assert.ok(d.frozen && d.api, 'dsp is frozen and exposes exactly DSP_API');
  assert.ok(d.tanh0 && d.mtof && d.rng, 'tanh exact at 0 and saturates; mtof/ftom; rng(seed) repeats');
  assert.ok(
    Math.abs(d.triFund - 0.8106) < 0.01 && Math.abs(d.sawFund - 0.6366) < 0.01,
    `band-limited osc fundamentals (tri ${d.triFund.toFixed(4)}, saw ${d.sawFund.toFixed(4)})`,
  );
  assert.ok(
    Math.abs(d.svf.lp1k + 3) < 0.2 &&
      d.svf.lp10k < -35 &&
      d.svf.hp100 < -35 &&
      Math.abs(d.svf.bell1k - 6) < 0.2 &&
      Math.abs(d.svf.ls100 - 6) < 0.3 &&
      Math.abs(d.svf.hs10k - 6) < 0.3,
    `svf responses (lp -3 dB at fc, bell/shelves +6 dB): ${JSON.stringify(Object.fromEntries(Object.entries(d.svf).map(([k, v]) => [k, +v.toFixed(1)])))}`,
  );
  assert.ok(d.osLatency === 23, `oversample2x latency is the declared 23 samples (measured ${d.osLatency})`);
  const cv = (c, at) =>
    c.at.length === 2 &&
    c.at[0][0] === at &&
    Math.abs(c.at[0][1] - 0.5) < 1e-12 &&
    c.at[1][0] === at + 2 &&
    Math.abs(c.at[1][1] - 0.25) < 1e-12;
  assert.ok(
    d.fftRound < 1e-14 &&
      cv(d.conv.plain, 131) &&
      d.conv.plain.lat === 128 &&
      cv(d.conv.direct, 3) &&
      d.conv.direct.lat === 0,
    `dsp.fft round-trips (${d.fftRound.toExponential(1)}); dsp.convolver plays its taps ${d.conv.plain.lat} frames late, and on time with direct: 128`,
  );
  assert.ok(Math.abs(d.karplusHz - 220) < 0.3, `karplus is in tune (${d.karplusHz.toFixed(2)} Hz for 220)`);
  assert.ok(
    Math.abs(d.attackMs - 10) < 0.5 && d.releaseDone,
    `adsr attack lands on time (${d.attackMs} ms) and the release ends`,
  );
  assert.ok(
    d.fdnPeak > 0.05 && d.fdnPeak < 2 && d.fdnTail < 1e-3,
    `fdn reverb rings and decays (peak ${d.fdnPeak.toFixed(3)}, after 2 s ${d.fdnTail.toExponential(1)})`,
  );
  assert.ok(d.modal.peak > 0.1 && !d.modal.active && d.noiseSeeded, 'modal bank strikes and dies; noise is seeded');
  assert.ok(
    Math.abs(d.lfoSync.phase - 0.5) < 1e-9 && Math.abs(d.lfoSync.hz - 0.5) < 1e-9,
    'lfo.sync locks to the song (beat 2 of a 4-beat cycle = phase 0.5)',
  );
});

test('compileKernel, on the main thread: a parse only', () => {
  const T = checks();
  const syn = compileKernel(
    `({\n  create({ dsp }) {\n    return {\n      process(L, R, n) { for (let i = 0; i < n; i++ { L[i] = 0; } },\n    };\n  },\n})`,
    'effect',
  );
  const noCreate = compileKernel('({ make() {} })', 'effect');
  const notObj = compileKernel('42', 'effect');
  const empty = compileKernel('', 'effect').error;
  const semi = compileKernel('({ create() { return { process() {} }; } });\n', 'effect').ok;
  const exp = compileKernel('export default ({ create() { return { process() {} }; } })', 'effect').ok;
  T.ok(
    !syn.ok && syn.line === 4 && /SyntaxError/.test(syn.error),
    `a syntax error is refused with its line: "${syn.error}"`,
  );
  T.ok(
    noCreate.ok && notObj.ok && !('kernel' in noCreate) && /empty/.test(empty),
    `compileKernel is a parse only: it passes what parses, returns no kernel object, and refuses an empty source ("${empty}")`,
  );
  T.ok(semi && exp, 'a trailing semicolon and "export default" are tolerated');
  T.done();
});
