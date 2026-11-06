// Stuck notes, in Node: the kernel host (kernel/worklet.js KernelCore, the code the AudioWorklet runs). A 'flush' drops
// every queued note at or after its time; 'alloff' releases with the normal release; the stop-time pattern that used to
// stick is caught by the watchdog; live notes through kernel/host.js on a stand-in AudioWorkletNode; a fuzz of live
// presses and releases. Moved from tools/stuck-test.js section 1; the studio's fuzz and the live keys stay there.
import { test } from 'node:test';
import { kernelCore, kernelCompiler } from '../../app/src/kernel/worklet.js';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { T } from './_t.js';

const t = T;
const SEED = +process.env.STUCK_SEED || 20261001;

test('the kernel host: flush, alloff, the stop-time pattern and the watchdog, live notes through host.js, a fuzz', async () => {
  const SR = 48000,
    Core = kernelCore(SR, makeDsp(SR), kernelCompiler);
  // a voice that holds at 0.5 until released, then fades over 10 ms
  const SRC = `({ poly: 8, create({ sr }) { return { voice() { let g = 0, held = false, ph = 0, f = 0; return {
    start(p) { held = true; g = 0.5; f = 440 * Math.pow(2, (p - 69) / 12) / sr; },
    release() { held = false; },
    render(L, R, n) { for (let i = 0; i < n; i++) { if (!held) g *= 0.995; ph += f; const s = Math.sin(ph * 6.283) * g; L[i] += s; R[i] += s; } return held || g > 1e-6; } }; } }; } })`;
  const mk = (extra = {}) => {
    const out = [];
    const c = new Core({ source: SRC, kind: 'instrument', params: [], values: {}, poly: 8, seed: 1, ...extra }, (m) =>
      out.push(m),
    );
    return { c, out };
  };
  const run = (c, frames, from = 0) => {
    const L = new Float32Array(128),
      R = new Float32Array(128);
    let pk = 0;
    for (let f = from; f < from + frames; f += 128) {
      c.block(null, null, L, R, f);
      for (let i = 0; i < 128; i++) pk = Math.max(pk, Math.abs(L[i]));
    }
    return pk;
  };
  const stats = (k) => {
    k.out.length = 0;
    k.c.msg({ type: 'stats' });
    return k.out.find((m) => m.type === 'stats');
  };
  const sec = (f) => f / SR;

  // the old stop: alloff now, and the off for a note queued in the lookahead at its own start frame (before its on)
  let k = mk();
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: sec(4800) });
  k.c.msg({ type: 'alloff', time: sec(1200) });
  k.c.msg({ type: 'off', p: 60, time: sec(4800) });
  run(k.c, 48000);
  let s = stats(k);
  t.ok(
    s.voices === 1 && s.held === 1,
    `the cause, reproduced in the host: an off sent for a note's own start frame lands before its on (offs first at one frame), so the note sounds on with no off to come (${s.held} held voice 1 s later)`,
  );

  // flush: everything queued at or after its time goes, earlier events stay
  k = mk();
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: sec(256) });
  k.c.msg({ type: 'on', p: 64, v: 0.8, time: sec(4800) });
  k.c.msg({ type: 'off', p: 64, time: sec(9600) });
  k.c.msg({ type: 'on', p: 67, v: 0.8, time: sec(6000) });
  k.c.msg({ type: 'flush', time: sec(2400) });
  k.c.msg({ type: 'alloff', time: sec(2400) });
  run(k.c, 2304);
  s = stats(k);
  const before = s.voices;
  const tail = run(k.c, 48000, 2304);
  s = stats(k);
  t.ok(
    before === 1 && s.voices === 0 && s.held === 0 && s.notes === 1 && tail < 0.5,
    `'flush' drops the queued notes from its time on (2 note-ons and an off never happen), keeps the earlier one, and 'alloff' releases it with its own release (${s.notes} note played, ${s.voices} voices 1 s on)`,
  );

  // the watchdog: a held voice the host has no open note for, while stopped
  k = mk({ transport: { playing: false } });
  k.c.msg({ type: 'on', p: 62, v: 0.8, time: 0 });
  k.c.msg({ type: 'on', p: 65, v: 0.8, time: 0 });
  run(k.c, 4800);
  k.out.length = 0;
  k.c.msg({ type: 'watch', open: { 65: 1 }, time: sec(4800), ring: 5 });
  const caught = k.out.filter((m) => m.type === 'stuck');
  run(k.c, 24000, 4800);
  s = stats(k);
  t.ok(
    caught.length === 1 && caught[0].p === 62 && caught[0].why === 'held' && s.held === 1 && s.voices === 1,
    `the watchdog releases a held voice with no open note (pitch ${caught[0] && caught[0].p}, reported as 'stuck') with its normal release, and keeps the one the host holds open (${s.held} held)`,
  );
  k.c.msg({ type: 'transport', playing: true, bpm: 120, beat: 0, time: 0 });
  k.out.length = 0;
  k.c.msg({ type: 'watch', open: {}, time: sec(28800), ring: 5 });
  t.ok(!k.out.some((m) => m.type === 'stuck'), 'while the transport plays, the watchdog leaves every voice alone');

  // a pedal down, or an off still queued for that pitch: not stuck
  k = mk({ transport: { playing: false } });
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: 0 });
  k.c.msg({ type: 'expr', sustain: true, time: 0 });
  k.c.msg({ type: 'on', p: 72, v: 0.8, time: 0 });
  k.c.msg({ type: 'off', p: 72, time: sec(48000) });
  run(k.c, 1280);
  k.c.msg({ type: 'off', p: 60, time: sec(1280) });
  run(k.c, 1280, 1280);
  k.out.length = 0;
  k.c.msg({ type: 'watch', open: {}, time: sec(2560), ring: 5 });
  t.ok(
    !k.out.some((m) => m.type === 'stuck'),
    'a voice the sustain pedal holds, and one whose off is still queued, are not stuck',
  );

  // a released voice that never goes quiet
  const DRONE = SRC.replace('if (!held) g *= 0.995;', '').replace('return held || g > 1e-6;', 'return true;');
  k = { out: [] };
  k.c = new Core(
    { source: DRONE, kind: 'instrument', params: [], values: {}, poly: 8, seed: 1, transport: { playing: false } },
    (m) => k.out.push(m),
  );
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: 0 });
  k.c.msg({ type: 'off', p: 60, time: sec(1280) });
  run(k.c, 48000 * 3);
  k.out.length = 0;
  k.c.msg({ type: 'watch', open: {}, time: sec(48000 * 3), ring: 2 });
  const rang = k.out.filter((m) => m.type === 'stuck');
  run(k.c, 4800, 48000 * 3);
  s = stats(k);
  t.ok(
    rang.length === 1 && rang[0].why === 'ring' && s.voices === 0,
    `a released voice still sounding past its limit (2 s here) is faded out and reported ('${rang[0] && rang[0].why}')`,
  );

  // Live notes through the host (kernel/host.js on a stand-in AudioWorkletNode that runs this KernelCore): every note is
  // stamped with currentTime, which moves a render quantum at a time, so ons and offs pile up on one frame.
  const fake = () => {
    const c = {
      sampleRate: SR,
      currentTime: 0,
      audioWorklet: { addModule: async () => true },
      createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    };
    globalThis.AudioWorkletNode = class {
      constructor(ctx, name, o) {
        const port = (this.port = {
          onmessage: null,
          postMessage: (m) => this.core.msg(structuredClone(m)),
          close() {},
        });
        this.core = new Core(o.processorOptions, (m) =>
          queueMicrotask(() => port.onmessage && port.onmessage({ data: m })),
        );
      }
      connect() {}
      disconnect() {}
    };
    return c;
  };
  const host = await import('../../app/src/kernel/host.js');
  const live = async () => {
    const c = fake();
    const inst = await host.kernelInstance(
      c,
      { id: 'test.held', kind: 'instrument', kernel: SRC, params: [] },
      { uid: 't_live:instrument' },
    );
    const core = inst.node.core;
    let f = 0;
    const L = new Float32Array(128),
      R = new Float32Array(128);
    const to = (frame) => {
      for (; f < frame; f += 128) core.block(null, null, L, R, f);
      c.currentTime = f / SR;
    };
    return {
      c,
      inst,
      core,
      to,
      done: () => {
        inst.dispose();
        delete globalThis.AudioWorkletNode;
      },
    };
  };

  // the cause, in the worklet: a key held from one quantum, let go in the next, then pressed and let go again inside it
  // (a blur or Cmd right after a key): two offs at one frame come before the new on, so the second off finds nothing
  k = mk();
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: sec(1280) });
  k.c.msg({ type: 'off', p: 60, time: sec(1408) });
  k.c.msg({ type: 'on', p: 60, v: 0.8, time: sec(1408) });
  k.c.msg({ type: 'off', p: 60, time: sec(1408) });
  run(k.c, 48000);
  s = stats(k);
  const was = s.held;
  // the same keys through the host: the off that would find nothing goes one frame later, after its on
  const L1 = await live();
  L1.to(1280);
  L1.inst.noteOn(60, 0.8, L1.c.currentTime);
  L1.to(1408);
  L1.inst.noteOn(64, 0.8, L1.c.currentTime);
  for (const p of [60, 64]) L1.inst.noteOff(p, L1.c.currentTime); // the blur
  L1.inst.noteOn(60, 0.8, L1.c.currentTime);
  L1.inst.noteOff(60, L1.c.currentTime); // A again, then Cmd let go
  L1.inst.noteOn(62, 0.8, L1.c.currentTime);
  L1.inst.noteOff(62, L1.c.currentTime); // S, then the page hidden
  L1.to(48000);
  s = await L1.inst.stats();
  L1.done();
  t.ok(
    was === 1 && s && s.held === 0 && s.voices === 0 && s.notes === 4 && L1.inst.stuck === 0,
    `musical typing's intermittent held voice, reproduced in the host: a key held over a quantum boundary, let go, pressed and let go again inside the next quantum sends two offs at one frame, and the second came before its own on (${was} held); through kernel/host.js both find their notes (${s ? s.held : '?'} held of ${s ? s.notes : '?'} notes, 1 s on)`,
  );

  // and a fuzz of live keys through the host: three pitches, presses and releases at random, currentTime moving on
  // a quantum now and then (or not at all, as on a busy main thread); every note must end, by its own note-off
  const rnd = (
    (x) => () =>
      (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296
  )(SEED);
  let held = 0,
    played = 0,
    sent = 0,
    worst = '';
  for (let trial = 0; trial < 200; trial++) {
    const Lx = await live();
    const down = new Set(),
      log = [];
    for (let i = 0; i < 24; i++) {
      if (rnd() < 0.3) Lx.to((Math.round((Lx.c.currentTime * SR) / 128) + 1 + Math.floor(rnd() * 2)) * 128);
      const p = 60 + Math.floor(rnd() * 3),
        now = Lx.c.currentTime;
      if (!down.has(p) || rnd() < 0.15) {
        // a press (of a key still down: its off first, as engine.liveNoteOn does)
        if (down.has(p)) Lx.inst.noteOff(p, now);
        Lx.inst.noteOn(p, 0.8, now);
        down.add(p);
        sent++;
        log.push(`+${p}@${Math.round(now * SR)}`);
      } else {
        Lx.inst.noteOff(p, now);
        down.delete(p);
        log.push(`-${p}@${Math.round(now * SR)}`);
      }
    }
    for (const p of down) {
      Lx.inst.noteOff(p, Lx.c.currentTime);
      log.push(`-${p}@${Math.round(Lx.c.currentTime * SR)}`);
    }
    Lx.to(Math.round(Lx.c.currentTime * SR) + 48000);
    const st = await Lx.inst.stats();
    Lx.done();
    played += st.notes;
    if (st.held) {
      held += st.held;
      if (!worst) worst = log.join(' ');
    }
  }
  t.ok(
    held === 0 && played === sent,
    `a fuzz of live keys through the host (200 runs of 24 presses and releases on 3 pitches, ons and offs piling up on one frame): every note is let go by its own note-off (${held} held of ${played} notes${worst ? '; first: ' + worst : ''})`,
  );
});
