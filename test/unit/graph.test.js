// A graph device's lifecycle in a live chain (app/src/devices/graph.js against devices/lifecycle.js; docs/DEVICES.md,
// "Graph devices in a live chain"): built with its bypass set by .value and nothing scheduled; ready rejects with a
// coded failure when the device can't be what it says (never a quiet stand-in of its own); the footswitch moves from
// one clock read with linear ramps; health() says where the bypass gains are and should be; assure() snaps them;
// dispose is idempotent. On a recording fake of the Web Audio bits the wrapper touches (tools/guitar-test.js runs the
// same in muted Chromium, every pedal and amp).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { failureCode, healthOf, assure } from '../../app/src/devices/lifecycle.js';

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
class Node extends globalThis.AudioNode {
  constructor(name) {
    super();
    this.name = name;
    this.out = new Set();
  }
  connect(n) {
    this.out.add(n);
    log.push([this.name, 'connect', n && n.name]);
    return n;
  }
  disconnect(n) {
    if (n) this.out.delete(n);
    else this.out.clear();
  }
}
// a live context whose clock is set by hand (`c.t`); every read logged
function live(t = 1) {
  let n = 0;
  const c = { t, state: 'running', sampleRate: 48000 };
  Object.defineProperty(c, 'currentTime', {
    get: () => {
      log.push(['clock', 'read', c.t]);
      return c.t;
    },
  });
  c.createGain = () => {
    const g = new Node('g' + n++);
    g.gain = new FakeParam(g.name, 1);
    return g;
  };
  return c;
}
const take = () => log.splice(0);
const G = await import('../../app/src/devices/graph.js');

const fx = (over = {}) => ({
  id: 'test.fx',
  name: 'Test Fx',
  kind: 'effect',
  params: [],
  build(c) {
    const a = c.createGain();
    return { input: a, output: a, set() {} };
  },
  ...over,
});

describe('build: the bypass set by .value, nothing scheduled', () => {
  for (const on of [true, false]) {
    test(`an insert built ${on ? 'on' : 'off'}`, async () => {
      take();
      const c = live(),
        inst = G.graphInstance(c, fx(), { uid: 'a', on });
      await inst.ready;
      const ev = take();
      assert.ok(!ev.some((e) => ['curve', 'linear', 'target'].includes(e[1])), 'no ramp, glide or curve at build');
      assert.ok(!ev.some((e) => e[1] === 'set' && e[0] !== 'clock'), 'no setValueAtTime on the bypass at build either');
      const h = inst.health();
      assert.equal(h.ok, true);
      assert.equal(h.settled, true);
      assert.equal(h.failed, '');
      assert.deepEqual([h.dry, h.wet], on ? [0, 1] : [1, 0]);
      assert.deepEqual(h.want, on ? { dry: 0, wet: 1 } : { dry: 1, wet: 0 });
      inst.dispose();
      inst.dispose();
    });
  }
  test('a trails device built on: the send at 1 by .value, the dry at unity', async () => {
    take();
    const c = live(),
      inst = G.graphInstance(c, fx({ trails: true }), { uid: 't', on: true });
    await inst.ready;
    assert.ok(!take().some((e) => ['curve', 'linear', 'target'].includes(e[1])));
    const h = inst.health();
    assert.equal(h.ok, true);
    assert.deepEqual([h.dry, h.wet, h.want.dry, h.want.wet], [1, 1, 1, 1]);
    inst.dispose();
  });
});

describe('ready rejects with a coded failure, and the device never stands in for itself', () => {
  const quiet = async (fn) => {
    const w = console.warn;
    console.warn = () => {};
    try {
      return await fn();
    } finally {
      console.warn = w;
    }
  };
  test("build() throws: 'threw'", () =>
    quiet(async () => {
      const inst = G.graphInstance(
        live(),
        fx({
          build() {
            throw new Error('boom');
          },
        }),
        { uid: 'x' },
      );
      await assert.rejects(inst.ready, (e) => failureCode(e) === 'threw' && /boom/.test(e.message));
      const h = healthOf(inst);
      assert.equal(h.ok, false);
      assert.match(h.failed, /boom/);
      inst.dispose();
    }));
  test("no output, or an effect with no input: 'no-output'", () =>
    quiet(async () => {
      for (const build of [() => ({}), (c) => ({ output: c.createGain() }), () => null]) {
        const inst = G.graphInstance(live(), fx({ build }), { uid: 'n' });
        await assert.rejects(inst.ready, (e) => failureCode(e) === 'no-output');
        inst.dispose();
      }
    }));
  test("a worklet the def declares that didn't load: 'worklet'", () =>
    quiet(async () => {
      const c = live();
      c.audioWorklet = { addModule: () => Promise.reject(new Error('404')) };
      let built = false;
      const inst = G.graphInstance(
        c,
        fx({
          worklets: { 'test-proc': 'https://o.test/proc.js' },
          build(cc) {
            built = true;
            const a = cc.createGain();
            return { input: a, output: a, set() {} };
          },
        }),
        { uid: 'w' },
      );
      await assert.rejects(inst.ready, (e) => failureCode(e) === 'worklet' && /test-proc/.test(e.message));
      assert.equal(built, false, 'not built without it');
      inst.dispose();
    }));
  test('a failure the build throws itself keeps its code', () =>
    quiet(async () => {
      const { failure } = await import('../../app/src/devices/lifecycle.js');
      const inst = G.graphInstance(
        live(),
        fx({
          build() {
            throw failure('worklet', 'no octave');
          },
        }),
        { uid: 'f' },
      );
      await assert.rejects(inst.ready, (e) => failureCode(e) === 'worklet' && e.message === 'no octave');
    }));
  test('what a failed build started is let go', () =>
    quiet(async () => {
      let stopped = 0;
      const c = live();
      c.createOscillator = () => {
        const o = new Node('osc');
        o.frequency = new FakeParam('f', 0);
        o.start = () => {};
        o.stop = () => stopped++;
        return o;
      };
      const inst = G.graphInstance(
        c,
        fx({
          build(cc, k) {
            k.lfo(1);
            throw new Error('half built');
          },
        }),
        { uid: 'h' },
      );
      await assert.rejects(inst.ready);
      assert.equal(stopped, 1);
    }));
});

describe('the footswitch, live: one clock read, linear ramps; health and assure', () => {
  test('setOn moves both gains from one read, settles, and health says so', async () => {
    const c = live(2),
      inst = G.graphInstance(c, fx(), { uid: 's', on: true });
    await inst.ready;
    take();
    inst.setOn(false);
    const ev = take(),
      reads = ev.filter((e) => e[0] === 'clock');
    assert.ok(!ev.some((e) => e[1] === 'curve'), 'no setValueCurveAtTime');
    assert.ok(
      ev.some((e) => e[1] === 'linear'),
      'linear ramps',
    );
    // (the wrapper reads the clock for its own bookkeeping; every event sits on the first read or after it)
    const now = reads[0][2];
    assert.ok(ev.filter((e) => e[1] === 'set').every((e) => e[3] >= now));
    const h = inst.health();
    assert.equal(h.settled, false, 'not settled while the fade runs');
    assert.equal(h.on, false);
    assert.deepEqual(h.want, { dry: 1, wet: 0 });
    c.t = 2.02; // the audio clock past the fade
    assert.equal(inst.health().settled, true);
    inst.dispose();
  });
  test('a dropped switch is seen, and assure() snaps it and says it had to', async () => {
    const c = live(3),
      inst = G.graphInstance(c, fx(), { uid: 'd', on: false });
    await inst.ready;
    inst.setOn(true);
    c.t = 3.05;
    // (the browser dropped the switch: the fake's params stay where they were, as Chrome 156's did)
    let h = inst.health();
    assert.equal(h.settled, true);
    assert.equal(h.ok, false);
    assert.deepEqual([h.dry, h.wet], [1, 0]);
    take();
    assert.equal(assure(inst), true);
    const ev = take();
    assert.ok(
      ev.some((e) => e[1] === 'value' && e[2] === 0) && ev.some((e) => e[1] === 'value' && e[2] === 1),
      'snapped by .value',
    );
    h = inst.health();
    assert.equal(h.ok, true);
    assert.equal(assure(inst), false, 'nothing to do the second time');
    inst.dispose();
  });
  test('an instrument: ok once built, no bypass gains', async () => {
    const c = live(),
      inst = G.graphInstance(
        c,
        {
          id: 'test.inst',
          name: 'Inst',
          kind: 'instrument',
          params: [],
          build(cc) {
            return { output: cc.createGain(), set() {} };
          },
        },
        { uid: 'i' },
      );
    await inst.ready;
    const h = inst.health();
    assert.equal(h.ok, true);
    assert.equal(h.dry, null);
    assert.equal(h.want, null);
    assert.equal(inst.assure(), false);
    inst.dispose();
  });
  test('disposed: health says so, assure does nothing, dispose twice is fine', async () => {
    const c = live(),
      inst = G.graphInstance(c, fx(), { uid: 'z' });
    await inst.ready;
    inst.dispose();
    inst.dispose();
    assert.equal(inst.health().failed, 'disposed');
    assert.equal(inst.assure(), false);
  });
});
