// The graph kit's live rules (app/src/devices/kit.js; docs/DEVICES.md, "Graph devices in a live chain"): a footswitch
// glide and the convolver's crossfade read the audio clock once and move with linear ramps (never a value curve on a
// live context: Chrome 155 and 156 drop one that ends before its node first renders), whatever the clock does between
// reads; offline they schedule exactly what they always did (the bit-identity guard for renders); a worklet module
// that failed to load is asked for again; a soft clipper is drawn out to where it has flattened (the WaveShaper clamps
// at its ends), and a curve that has already is drawn as it always was. On a recording fake of the Web Audio bits the
// kit touches.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* ---- the fake: every AudioParam call and every read of currentTime, in order */
const log = [];
class FakeParam {
  constructor(name, v) {
    this.name = name;
    this._v = v;
  }
  get value() {
    return this._v;
  }
  set value(v) {
    log.push([this.name, 'value', v]);
    this._v = v;
  }
  setValueAtTime(v, t) {
    log.push([this.name, 'set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v, t) {
    log.push([this.name, 'linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    log.push([this.name, 'exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, tc) {
    log.push([this.name, 'target', v, t, tc]);
    return this;
  }
  setValueCurveAtTime(cv, t, d) {
    log.push([this.name, 'curve', Array.from(cv), t, d]);
    return this;
  }
  cancelScheduledValues(t) {
    log.push([this.name, 'cancel', t]);
    return this;
  }
}
globalThis.AudioNode ??= class {
  connect() {}
  disconnect() {}
};
globalThis.OfflineAudioContext ??= class {};
let nodes = 0;
// a context whose currentTime is `times[k]` at its k-th read (the last one after that)
function ctx({ offline = false, times = [0] } = {}) {
  const c = offline ? Object.create(globalThis.OfflineAudioContext.prototype) : {};
  let k = 0;
  Object.defineProperty(c, 'currentTime', {
    get: () => {
      const t = times[Math.min(k++, times.length - 1)];
      log.push(['clock', 'read', t]);
      return t;
    },
  });
  c.sampleRate = 48000;
  c.state = 'running';
  c.createGain = () => {
    const g = new globalThis.AudioNode();
    g.gain = new FakeParam('g' + nodes++, 1);
    return g;
  };
  c.createConvolver = () => {
    const g = new globalThis.AudioNode();
    g.normalize = true;
    g.buffer = null;
    log.push(['convolver', 'made']);
    return g;
  };
  return c;
}
const take = () => log.splice(0);
const on = (name) => log.filter((e) => e[0] === name);

const K = await import('../../app/src/devices/kit.js');

describe('glide, live: one read of the clock, linear ramps, no curve', () => {
  // Chrome's clock steps 5.8 ms (256 frames) at a time, even inside one task; the repro's race moved it 3.1, 5.8 and
  // 11.6 ms between the glide's reads
  for (const skew of [0, 0.0031, 0.0058, 0.0116]) {
    test(`the clock moved ${(skew * 1000).toFixed(1)} ms between reads`, () => {
      take();
      const c = ctx({ times: [0.5, 0.5 + skew, 0.5 + 2 * skew] }),
        p = new FakeParam('p', 1);
      K.glide(c, p, 0.1778, 0.01);
      const ev = take(),
        reads = ev.filter((e) => e[0] === 'clock');
      assert.equal(reads.length, 1, 'one read of the clock');
      const now = reads[0][2],
        mine = ev.filter((e) => e[0] === 'p');
      assert.ok(!mine.some((e) => e[1] === 'curve'), 'no setValueCurveAtTime');
      assert.deepEqual(mine[0], ['p', 'cancel', 0], 'everything scheduled before is dropped');
      assert.deepEqual(mine[1], ['p', 'set', 1, now], 'held where it is from that read');
      const ramps = mine.filter((e) => e[1] === 'linear');
      assert.equal(ramps.length, 23, "the cosine's 24 points");
      assert.ok(
        Math.abs(ramps[0][3] - (now + K.LEAD + 0.01 / 23)) < 1e-12 &&
          Math.abs(ramps[22][3] - (now + K.LEAD + 0.01)) < 1e-12,
        'from now + 3 ms, over 10 ms',
      );
      for (let i = 1; i < ramps.length; i++)
        assert.ok(ramps[i][3] > ramps[i - 1][3] && ramps[i][2] <= ramps[i - 1][2], 'monotonic in time and value');
      assert.equal(mine.at(-1)[2], 0.1778, 'the last event lands on the target exactly');
    });
  }
  test('a switch scheduled ahead (at) holds until then', () => {
    take();
    const c = ctx({ times: [1, 1.0116] }),
      p = new FakeParam('p', 0);
    K.glide(c, p, 0.5, 0.01, 1.25);
    const mine = on('p');
    assert.deepEqual(mine.slice(0, 3), [
      ['p', 'cancel', 0],
      ['p', 'set', 0, 1],
      ['p', 'set', 0, 1.25],
    ]);
    assert.ok(Math.abs(mine.at(-1)[3] - 1.26) < 1e-12 && mine.at(-1)[2] === 0.5);
    assert.equal(log.filter((e) => e[0] === 'clock').length, 1);
  });
  test('a switch to where it already is: set there at the read, nothing else', () => {
    take();
    const c = ctx({ times: [2, 2.0058] }),
      p = new FakeParam('p', 1);
    K.glide(c, p, 1, 0.01);
    assert.deepEqual(on('p'), [
      ['p', 'cancel', 0],
      ['p', 'set', 1, 2],
    ]);
  });
  test('it starts from where the param is now (a fade already under way)', () => {
    take();
    const c = ctx({ times: [3] }),
      p = new FakeParam('p', 0.42);
    K.glide(c, p, 0, 0.01);
    assert.deepEqual(on('p')[1], ['p', 'set', 0.42, 3]);
  });
});

describe('glide, offline: exactly what it always scheduled (renders stay bit-identical)', () => {
  // (the events b5cff63's kit.js scheduled, recorded: a change here moves every render of a pedal or an amp)
  const CURVE = [
    1, 0.9953429698944092, 0.9814586639404297, 0.9586056470870972, 0.9272096753120422, 0.8878556489944458,
    0.8412765860557556, 0.788340151309967, 0.7300325036048889, 0.6674398183822632, 0.6017280220985413,
    0.5341212153434753, 0.46587878465652466, 0.39827200770378113, 0.3325601816177368, 0.2699674665927887,
    0.21165983378887177, 0.15872342884540558, 0.1121443510055542, 0.07279029488563538, 0.041394349187612534,
    0.018541356548666954, 0.004657026845961809, 0,
  ];
  const HALF = [
    0.5, 0.4976714849472046, 0.49072933197021484, 0.4793028235435486, 0.4636048376560211, 0.4439278244972229,
    0.4206382930278778, 0.3941700756549835, 0.36501625180244446, 0.3337199091911316, 0.30086401104927063,
    0.26706060767173767, 0.23293939232826233, 0.19913600385189056, 0.1662800908088684, 0.13498373329639435,
    0.10582991689443588, 0.07936171442270279, 0.0560721755027771, 0.03639514744281769, 0.020697174593806267,
    0.009270678274333477, 0.0023285134229809046, 0,
  ];
  const SNAP = {
    'from 1 to 0 at 0.5': [
      ['p', 'cancel', 0.5],
      ['p', 'set', 1, 0.5],
      ['p', 'curve', CURVE, 0.5, 0.01],
      ['p', 'set', 0, 0.51],
    ],
    'to where it is (from given)': [
      ['p', 'cancel', 0.25],
      ['p', 'set', 1, 0.25],
    ],
    'from the param, at 0.1': [
      ['p', 'cancel', 0.1],
      ['p', 'set', 0.5, 0.1],
      ['p', 'curve', HALF, 0.1, 0.01],
      ['p', 'set', 0, 0.11],
    ],
  };
  const run = {
    'from 1 to 0 at 0.5': [0, 1, 0, 0.5, 1],
    'to where it is (from given)': [0, 1, 1, 0.25, 1],
    'from the param, at 0.1': [0.1, 0.5, 0, undefined, undefined],
  };
  for (const [name, [now, v0, v, at, from]] of Object.entries(run)) {
    test(name, () => {
      take();
      K.glide(ctx({ offline: true, times: [now] }), new FakeParam('p', v0), v, 0.01, at, from);
      assert.deepEqual(on('p'), SNAP[name]);
    });
  }
});

describe('the convolver, live: the new branch made first, at 0 by .value, then one read and linear ramps', () => {
  test('a new IR under a ringing tail', () => {
    take();
    const c = ctx({ times: [4, 4.0116, 4.0232] }),
      k = K.makeKit(c, { uid: 'cv' });
    const conv = k.convolver(null);
    conv.buffer = { n: 1 }; // the first IR: straight in, nothing to fade
    let ev = take();
    assert.ok(!ev.some((e) => e[1] === 'curve' || e[1] === 'linear' || e[0] === 'clock'), 'the first IR just goes in');
    const old = ev.filter((e) => e[0] === 'convolver').length;
    assert.equal(old, 1);
    conv.buffer = { n: 2 };
    ev = take();
    const iMade = ev.findIndex((e) => e[0] === 'convolver'),
      reads = ev.filter((e) => e[0] === 'clock'),
      iRead = ev.findIndex((e) => e[0] === 'clock');
    assert.equal(reads.length, 1, 'one read of the clock');
    assert.ok(iMade >= 0 && iMade < iRead, 'read after the new branch is made');
    const now = reads[0][2];
    assert.ok(!ev.some((e) => e[1] === 'curve'), 'no setValueCurveAtTime');
    const gains = [...new Set(ev.filter((e) => /^g/.test(e[0])).map((e) => e[0]))];
    const newG = gains.find((g) => ev.some((e) => e[0] === g && e[1] === 'value' && e[2] === 0));
    assert.ok(newG, "the new branch's gain set to 0 by .value");
    const iZero = ev.findIndex((e) => e[0] === newG && e[1] === 'value');
    assert.ok(iZero < iRead, '... before the clock is read');
    const up = ev.filter((e) => e[0] === newG && e[1] === 'linear'),
      oldG = gains.find((g) => g !== newG),
      down = ev.filter((e) => e[0] === oldG && e[1] === 'linear');
    assert.ok(
      Math.abs(up.at(-1)[3] - (now + K.LEAD + 0.05)) < 1e-12 && up.at(-1)[2] === 1,
      'the new one up to 1 over 50 ms',
    );
    assert.ok(
      Math.abs(down.at(-1)[3] - (now + K.LEAD + 0.3)) < 1e-12 && down.at(-1)[2] === 0,
      'the old one down to 0 over 300 ms',
    );
    k.release();
  });
  test('offline: one node, its buffer set, nothing scheduled', () => {
    take();
    const c = ctx({ offline: true, times: [0] }),
      k = K.makeKit(c, { uid: 'cv' });
    const conv = k.convolver({ n: 1 });
    conv.buffer = { n: 2 };
    const ev = take();
    assert.equal(ev.filter((e) => e[0] === 'convolver').length, 1);
    assert.ok(!ev.some((e) => ['curve', 'linear', 'set', 'target'].includes(e[1])));
    assert.deepEqual(conv.buffer, { n: 2 });
  });
});

describe('worklets: a failed load is asked for again', () => {
  const wctx = (fails) => {
    const asked = [];
    const c = {
      state: 'running',
      audioWorklet: {
        addModule(url) {
          asked.push(url);
          return fails(url, asked) ? Promise.reject(new Error('blip')) : Promise.resolve();
        },
      },
    };
    return { c, asked };
  };
  test('a module that fails once loads on the next request, after the backoff', async () => {
    let n = 0;
    const { c, asked } = wctx((url) => /gate/.test(url) && n++ === 0);
    assert.equal(await K.loadWorklet(c, 'gate', 'https://o.test/gate.js'), false);
    assert.equal(K.workletLoaded(c, 'gate'), false);
    const r = K.workletsReady(c, { gate: 'https://o.test/gate.js' });
    assert.notEqual(r, true);
    const t0 = Date.now();
    assert.deepEqual(await r, [], 'loaded this time: nothing missing');
    assert.ok(Date.now() - t0 >= K.WORKLET_RETRY - 50, 'not before the backoff');
    assert.equal(K.workletLoaded(c, 'gate'), true);
    assert.equal(K.workletsReady(c, { gate: 'https://o.test/gate.js' }), true, 'then ready at once');
    assert.equal(asked.filter((u) => /gate/.test(u)).length, 2);
  });
  test('workletsReady names the ones that did not load', async () => {
    const { c } = wctx((url) => /bad/.test(url));
    assert.deepEqual(await K.workletsReady(c, { good: 'https://o.test/good.js', bad: 'https://o.test/bad.js' }), [
      'bad',
    ]);
  });
  test('END failing is asked for again too', async () => {
    let n = 0;
    const { c } = wctx((url) => /end\.js/.test(url) && n++ === 0);
    assert.equal(await K.loadWorklet(c, 'x', 'https://o.test/x.js'), false);
    assert.equal(await K.loadWorklet(c, 'x', 'https://o.test/x.js'), true);
  });
  test('a source string where a URL goes never loads (and is not asked for again)', async () => {
    const { c, asked } = wctx(() => false);
    const err = console.error;
    console.error = () => {};
    try {
      assert.equal(await K.loadWorklet(c, 's', 'class X extends AudioWorkletProcessor {}'), false);
      assert.equal(await K.loadWorklet(c, 's', 'class X extends AudioWorkletProcessor {}'), false);
    } finally {
      console.error = err;
    }
    assert.equal(asked.length, 0);
  });
});

describe('the kit lets go of its timers', () => {
  test('a timer that fired is forgotten; release clears the rest', async () => {
    const c = ctx(),
      k = K.makeKit(c);
    let fired = 0;
    k.later(() => fired++, 1);
    k.later(() => fired++, 10000);
    await new Promise((r) => setTimeout(r, 20));
    k.release();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(fired, 1);
  });
});

describe('soft clippers reach past ±1 (a WaveShaper clamps at its curve’s ends)', () => {
  // a context that makes WaveShapers, and records what each node is connected to
  const sctx = () => {
    const c = ctx();
    const rec = (n) => {
      n.to = [];
      n.connect = (d) => (n.to.push(d), d);
      n.disconnect = () => (n.to = []);
      return n;
    };
    const gain = c.createGain;
    c.createGain = () => rec(gain());
    c.createWaveShaper = () =>
      rec(Object.assign(new globalThis.AudioNode(), { curve: null, oversample: 'none', shaper: true }));
    return c;
  };
  const tanhOf = (k, b = 0) => {
    const t0 = Math.tanh(k * b),
      norm = Math.max(Math.tanh(k * (1 + b)) - t0, t0 - Math.tanh(k * (b - 1)));
    return (x) => (Math.tanh(k * (x + b)) - t0) / norm;
  };
  // the slope one point in from each end, against the slope across the middle (what tools/guitar-test.js judges)
  const endSlope = (cv) => {
    const N = cv.length,
      m = (N - 1) >> 1,
      s0 = N % 2 ? (cv[m + 1] - cv[m - 1]) / 2 : cv[m + 1] - cv[m];
    return Math.max(cv[1] - cv[0], cv[N - 1] - cv[N - 2]) / s0;
  };
  // what the signal meets: the node's transfer at input u (its gain, then the curve, interpolated as Web Audio does)
  const transfer = (node, u) => {
    const g = node.shaper ? 1 : node.gain.value,
      sh = node.shaper ? node : node.to[0],
      cv = sh.curve,
      v = ((cv.length - 1) / 2) * (Math.max(-1, Math.min(1, u * g)) + 1),
      i = Math.min(cv.length - 2, Math.floor(v));
    return cv[i] + (cv[i + 1] - cv[i]) * (v - i);
  };

  test('softReach: 1 for a curve already flat by ±1 (tanh at k = 3, a dead zone); out to where the slope is 1% otherwise', () => {
    assert.equal(K.softReach(tanhOf(3)), 1);
    assert.equal(
      K.softReach((x) => Math.sign(x) * Math.max(0, Math.abs(x) - 0.1)),
      1,
    );
    for (const [k, b] of [
      [1.3, 0.28],
      [1.1, 0.35],
      [2, 0.22],
      [1.6, -0.12],
    ]) {
      const R = K.softReach(tanhOf(k, b)),
        sl = (x) => 1 - Math.tanh(k * (x + b)) ** 2,
        at = Math.max(sl(R), sl(-R)) / sl(0),
        before = Math.max(sl(R - 1 / 64), sl(-(R - 1 / 64))) / sl(0);
      assert.ok(R > 1 && R * 64 === Math.round(R * 64), `k ${k}: R ${R}, in 64ths`);
      assert.ok(at <= K.SOFT && before > K.SOFT, `k ${k}: the least such R (${(at * 100).toFixed(2)}% there)`);
    }
  });
  test('a shaper flat by ±1 is the plain node, the curve it always was, bit for bit', () => {
    const k = K.makeKit(sctx()),
      n = k.shaper(3, 0),
      fn = tanhOf(3);
    assert.ok(n.shaper && n.curve.length === 4096);
    const old = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) old[i] = fn((i / 4095) * 2 - 1);
    assert.deepEqual(n.curve, old);
  });
  test('a soft one: a 1/R gain into a curve over ±R, the same transfer inside ±1, flat at its clamp, nothing at rest', () => {
    const k = K.makeKit(sctx()),
      fn = tanhOf(1.3, 0.28),
      R = K.softReach(fn),
      n = k.shaper(1.3, 0.28),
      sh = n.to[0],
      cv = sh.curve;
    assert.ok(!n.shaper && sh.shaper && sh.oversample === '2x', 'a gain stands in front of the shaper');
    assert.equal(n.gain.value, 1 / R);
    assert.ok(
      cv.length % 2 === 1 && (2 * R) / (cv.length - 1) <= 2 / 4095,
      `${cv.length} points (odd), no further apart`,
    );
    assert.equal(cv[(cv.length - 1) / 2], 0, 'a point on 0, at 0');
    for (const u of [-1, -0.5, -0.1, 0.03, 0.4, 1]) assert.ok(Math.abs(transfer(n, u) - fn(u)) < 1e-5, `fn(${u})`);
    assert.ok(endSlope(cv) <= K.SOFT * 1.05, `${(endSlope(cv) * 100).toFixed(2)}% of its slope at rest at the clamp`);
    assert.ok(
      transfer(n, -3) < -1.15 && transfer(n, -3) > fn(-R) - 1e-6,
      'driven past -1 it rounds on toward its ceiling',
    );
    const next = { name: 'next' };
    assert.equal(n.connect(next), next);
    assert.deepEqual(sh.to, [next], 'connect goes on from the shaper');
    n.disconnect();
    assert.deepEqual(sh.to, []);
  });
  test("curve: reach 1 is the plain node; a number draws that far; 'soft' as far as fn takes", () => {
    const k = K.makeKit(sctx()),
      lin = (x) => x;
    const a = k.curve(lin);
    assert.ok(a.shaper && a.curve.length === 4096 && a.curve[0] === -1 && a.curve[4095] === 1);
    const b = k.curve(lin, '4x', 4096, 3);
    assert.ok(b.gain.value === 1 / 3 && b.to[0].curve.at(-1) === 3 && b.to[0].oversample === '4x');
    const c = k.curve(Math.tanh, '2x', 4096, 'soft');
    assert.equal(c.gain.value, 1 / K.softReach(Math.tanh));
    assert.ok(endSlope(c.to[0].curve) <= K.SOFT * 1.05);
  });
});
