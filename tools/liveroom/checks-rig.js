// The live room's checks: swapping the guitar's chain [guitar room] (docs/research/GUITAR-ROOM.md §2.2, §2.9). Run by
// tools/liveroom-test.js (ONLY=rig), whose header says what a checks module exports.
//
// Node (LEVELS=0 skips it): each metal club rig's chain (places.js guitarChain: Half Stack's setting and Slide Rule)
// rendered through the KernelCore on the metal DI fixtures, so the sound is measured, not assumed: every rig is far
// from the dry DI, each one differs from the others, and they come out within a LU of each other (they're level-matched).
// Muted Chromium (PAGES=0 skips it): the real room on a song that already had an audio track ahead of the room's (the
// trap AJ hit: the input monitored that one, dry), a fake guitar (fake.js riffDI, a WAV Chromium plays as the input,
// never to a speaker). Ten presses of ] in a row, then through the glass, a tone put on Guitar L in the control room's
// Jam room, back, and ] twice more; after each step:
//   the song: Guitar L and Guitar R carry exactly the rig's chain for their side (core/stacks.js sameChain), the room's
//     rig and the readout follow, and History has one step per press, by you;
//   the graph: every insert on Guitar L is built and live (engine.instance, no stand-in), and the input plays through
//     Guitar L whatever else is in the song (input/audioin.js monitorVia);
//   the sound, at the master: its spectrum is far from the dry signal (measured live: in the control room the input
//     plays through the old audio track, which has no chain), the same rig measures the same each time it comes round,
//     its shape and its level (a doubled or half-built chain wouldn't), and each sounds different from the others;
//   the clicks: a steady 100 Hz tone in place of the guitar, six more presses, a Jam room tone in and ] back (the
//     devices changing: built beside the playing chain, then crossfaded in), the sharpest sample (the largest third
//     difference) from each press until the strip has swapped (engine.settled, and 100 ms on: a new chain can take
//     longer than 600 ms to build) against the steady tone before the press and after the swap; the detector is held to
//     hearing a 0.02 step put in by hand.
// And the engine's retry: a device whose first build isn't ready in time plays its stand-in (the dry signal), then is
// built again on its own once it's due (engine/strip.js BUILD), with no change to the song.

import { openRoom, press, history } from './harness.js';
import { riffDI, SR } from './fake.js';
import { guitarChain, PLACES } from '../../app/src/core/liveroom/places.js';
import { sameChain } from '../../app/src/core/stacks.js';
import '../../app/src/devices/builtin/index.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { lufs } from '../../app/src/audio/measure.js';
import { run as runKernel, metalDI, psd } from '../amp-scenes.js';

export const name = 'rig';
export const pages = true;

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
// octave bands from 63 Hz to 8 kHz, dB, the shape alone (each profile less its mean)
const CENTERS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const MIDDLE = CENTERS.slice(1, -1);   // (a setting against itself: 125 Hz to 4 kHz; the ends move with the riff)
const rmsDb = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-30); };
function profile(x, sr = SR, centers = CENTERS) {
  const N = 8192, p = psd(x, N), out = [];
  for (const c of centers) {
    let s = 0;
    for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; if (f >= c / Math.SQRT2 && f < c * Math.SQRT2) s += p[k]; }
    out.push(10 * Math.log10(s + 1e-30));
  }
  const m = out.reduce((a, b) => a + b, 0) / out.length;
  return out.map((v) => v - m);
}
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
// a chain of kernel effects on a mono signal (the KernelCore the worklet runs)
function chainRender(chain, x) {
  let y = x;
  for (const l of chain) if (l.on !== false) y = runKernel(getDevice(l.device), l.params, y)[0];
  return y;
}
// the click detector: a signal's sharpest sample, the largest third difference (a steady tone through a setting has a
// largest one that holds, about -64 dBFS at the master; a step of A puts in 2A)
function kink(x) {
  let m = 0;
  for (let i = 3; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]));
  return m;
}
// the step a swap's window adds over the steady tone either side of it, as the step that would put that in, dBFS
const STEP_MAX = 0.002;   // -54 dBFS: 44 dB under the tone at the master, which plays at about -10 dBFS
const stepOf = (sw, ...steady) => Math.max(0, kink(sw) - Math.max(...steady.map(kink))) / 2;
const dbfs = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- Node: the rigs measured */
  if (ctx.levels) {
    const rigs = PLACES.metal.rigs, dis = ['chug', 'chords'].map((n) => { try { return metalDI(n); } catch { return null; } }).filter(Boolean);
    if (!dis.length) T.ok(false, 'the metal DI fixtures render (tools/fixtures/metal-di/)');
    for (const [k, di] of dis.entries()) {
      const dry = profile(di), outs = rigs.map((r) => chainRender(guitarChain(r, 'L', 'drop-c'), di));
      const prof = outs.map((y) => profile(y)), loud = outs.map((y) => lufs({ sr: SR, channels: [y, y] }));
      const fromDry = prof.map((p) => dist(p, dry));
      const pairs = [];
      for (let i = 0; i < rigs.length; i++) for (let j = i + 1; j < rigs.length; j++) pairs.push([`${rigs[i]}/${rigs[j]}`, dist(prof[i], prof[j])]);
      T.ok(fromDry.every((d) => d > 4), `DI ${k + 1}: every rig is far from the dry DI (${rigs.map((r, i) => `${r} ${f1(fromDry[i])} dB`).join(', ')})`);
      T.ok(pairs.every(([, d]) => d > 0.4), `DI ${k + 1}: each rig sounds different from the others (${pairs.map(([n, d]) => `${n} ${f1(d)} dB`).join(', ')})`);
      T.ok(Math.max(...loud) - Math.min(...loud) < 1.5, `DI ${k + 1}: within 1.5 LU of each other (${rigs.map((r, i) => `${r} ${f1(loud[i])}`).join(', ')} LUFS)`);
    }
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const VERSE = { bpm: 132, beats: 4, chord: true, notes: [[0, 36, 0], [0.5, 36, 0], [1, 36, 0], [1.5, 39, 0.5], [2, 36, 0], [2.5, 36, 0], [3, 41, 0.75]] };
  const BAR = (4 * 60) / VERSE.bpm;   // the riff's bar: a window of two whole bars hears the whole riff, wherever it starts
  const di = riffDI(VERSE, { passes: 60, peak: -12, seed: 21 });
  const s = await openRoom('/app/?room', { fake: { wav: { sr: SR, channels: [di.buf] } }, name: 'rig' });
  const { page, E } = s;
  try {
    const setup = await E(async () => {
      const o = window.overdub;
      const { planPlace } = await import('/app/src/core/liveroom/plans.js');
      // (the trap: an audio track from before, ahead of the room's)
      o.store.dispatch({ type: 'track.add', track: { name: 'Audio', kind: 'audio' } }, { by: 'you', label: 'an audio track from before' });
      const pl = planPlace(o.store.get(), { place: 'metal' });
      const r = o.store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      await o.engine.start?.();
      await o.input.audio.open({ channel: '1', capture: false, monitor: true });
      const c = o.engine.ctx;
      // a capture of the master's left side: the last 8 s, each block with its audio-clock time (the input's own capture
      // processor, input/cap-worklet.js: the page's policy refuses a data: or blob: module)
      await c.audioWorklet.addModule('/app/src/input/cap-worklet.js');
      const cap = new AudioWorkletNode(c, 'ew-cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', processorOptions: { channels: 1 } });
      o.engine.masterTap.connect(cap);
      const ring = [];
      cap.port.onmessage = (e) => { ring.push([e.data.d[0], e.data.f / c.sampleRate]); while (ring.length > (8 * c.sampleRate) / 2048 + 2) ring.shift(); };
      // [t0, t1] on the audio clock, as one array's numbers
      window.__rig = {
        grab(t0, t1) { const out = []; for (const [b, t] of ring) { for (let i = 0; i < b.length; i++) { const u = t + i / c.sampleRate; if (u >= t0 && u < t1) out.push(b[i]); } } return out; },
        sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      };
      if (o.liveRoom.isOpen()) o.liveRoom.close();
      o.liveRoom.open({ screen: 'stage' });
      return { ok: r.ok, sr: c.sampleRate };
    });
    T.ok(setup.ok, 'the metal club on a song with an audio track from before');
    // one step: the key (or a page function), the strip settled, two bars of playing measured, and what the song and the
    // graph say
    const step = async (key, { secs = 2 * BAR, swap = false } = {}) => {
      const t0 = await E(() => window.overdub.engine.ctx.currentTime);
      if (typeof key === 'string') await press(page, key); else if (key) await E(key);
      return E(async ({ t0, secs, swap }) => {
        const o = window.overdub, R = window.__rig, c = o.engine.ctx;
        await o.engine.settled();
        // (when the strip finished swapping: a chain that's new to the strip can take longer than a window to build, so
        // the swap's window runs from the press to here, and what's after it is measured after it)
        const ts = c.currentTime;
        await R.sleep(Math.max(secs, swap ? 0.8 : 0) * 1000 + 300);
        const t1 = c.currentTime;
        const p = o.store.get(), L = p.tracks.find((t) => t.name === 'Guitar L'), G = p.tracks.find((t) => t.name === 'Guitar R');
        const live = L.inserts.map((x) => { const i = o.engine.instance(L.id, x.id); return i ? (i.fallback ? 'stand-in' : 'live') : 'none'; });
        return {
          rig: p.room?.rig, label: document.querySelector('.lr-rig-name')?.textContent || '', open: o.liveRoom.isOpen(),
          L: L.inserts.map((x) => ({ device: x.device, params: x.params, on: x.on !== false })), R: G.inserts.map((x) => ({ device: x.device, params: x.params, on: x.on !== false })),
          live, mon: o.input.audio.monitorTrack?.()?.name || null, tuning: p.room?.tuning,
          steady: R.grab(t1 - secs, t1), ...(swap ? { before: R.grab(t0 - 0.6, t0), swap: R.grab(t0, Math.max(t0 + 0.6, ts + 0.1)), after: R.grab(ts + 0.15, ts + 0.75), took: ts - t0 } : {}),
        };
      }, { t0, secs, swap });
    };
    const steps = [];
    const h0 = (await history(page)).length;
    steps.push({ what: 'start', ...(await step(null)) });
    for (let i = 1; i <= 10; i++) steps.push({ what: `] ${i}`, ...(await step('BracketRight')) });
    const h10 = await history(page);
    // through the glass: the control room monitors as it always did (the old audio track: dry), a tone on Guitar L
    steps.push({ what: 'control room', ...(await step('KeyG')) });
    const jam = await E(() => { const j = window.overdub.jam, r = j?.rigs?.RIGS?.find((x) => x.chain.some((l) => /^amp\./.test(l.device))); if (!r) return { error: 'no Jam rigs' }; const res = j.setTone(r.id, { track: window.overdub.store.get().tracks.find((t) => t.name === 'Guitar L').id, toast: false }); return { ok: !!res.ok, rig: r.name, error: res.error }; });
    T.ok(jam.ok, `in the control room the Jam room puts ${jam.rig || 'a tone'} on Guitar L${jam.error ? `: ${jam.error}` : ''}`);
    steps.push({ what: 'back', ...(await step('KeyG')) });
    steps.push({ what: '] 11', ...(await step('BracketRight')) });
    steps.push({ what: '] 12', ...(await step('BracketRight')) });

    // the song and the graph after every press
    const room = steps.filter((x) => x.open), pressed = room.filter((x) => x.what !== 'back');
    const bad = pressed.filter((x) => !(sameChain(x.L, guitarChain(x.rig, 'L', x.tuning)) && sameChain(x.R, guitarChain(x.rig, 'R', x.tuning))));
    T.ok(!bad.length, `after each press both sides carry exactly the rig’s chain for their side${bad.length ? `: not at ${bad.map((x) => x.what).join(', ')}` : ''}`);
    const presses = steps.filter((x) => x.what.startsWith(']'));
    const want = (i) => PLACES.metal.rigs[i % 3];
    T.ok(presses.slice(0, 10).every((x, i) => x.rig === want(i + 1)), `] goes round the club’s settings (${presses.map((x) => x.rig).join(', ')})`);
    const NAME = { modern: 'Modern', djent: 'Djent', thrash: 'Thrash' };
    T.ok(room.every((x) => (x.what === 'back' ? /, your own$/.test(x.label) : x.label === `Half Stack, ${NAME[x.rig]}`)), `the readout names what’s on: ${[...new Set(room.map((x) => x.label))].join(' / ')}`);
    const swaps = h10.slice(h0);
    T.ok(swaps.length === 10 && swaps.every((x) => x.by === 'you' && x.reason === 'room:rig'), `ten presses are ten steps by you (${swaps.map((x) => x.label.replace('Half Stack, ', '')).join(', ')})`);
    T.ok(steps.every((x) => x.live.every((v) => v === 'live')), `every insert on Guitar L is built and playing after every step${steps.some((x) => x.live.some((v) => v !== 'live')) ? `: ${steps.map((x) => `${x.what} ${x.live.join(',')}`).join('; ')}` : ''}`);
    T.ok(room.every((x) => x.mon === 'Guitar L'), `on the stage the input plays through Guitar L, not the audio track ahead of it (${[...new Set(room.map((x) => x.mon))].join(', ')})`);
    // (the other side: the next take goes on Guitar R, so the input plays through it, and back)
    const sides = await E(async () => {
      const o = window.overdub, L = o.ui.state.liveRoom, R = window.__rig, mon = () => o.input.audio.monitorTrack?.()?.name || null;
      L.side = 'R'; await R.sleep(400); const right = mon();
      L.side = 'L'; await R.sleep(400);
      return { right, left: mon() };
    });
    T.ok(sides.right === 'Guitar R' && sides.left === 'Guitar L', `for the other side the input plays through Guitar R, then Guitar L again (${sides.right}, ${sides.left})`);
    const ctl = steps.find((x) => x.what === 'control room');
    T.ok(ctl.mon === 'Audio', `through the glass it plays through what the control room picks, as it always did (${ctl.mon})`);

    // the sound
    for (const x of steps) { const y = Float32Array.from(x.steady); x.all = profile(y, setup.sr); x.p = profile(y, setup.sr, MIDDLE); x.db = rmsDb(y); }
    const dry = ctl.all, fromDry = room.map((x) => [x.what, dist(x.all, dry)]);
    T.ok(fromDry.every(([, d]) => d > 3), `every step on the stage is far from the dry signal (${fromDry.map(([w, d]) => `${w} ${f1(d)}`).join(', ')} dB from it)`);
    const first = {}, firstDb = {}, again = [];
    for (const x of pressed) { if (!first[x.rig]) { first[x.rig] = x.p; firstDb[x.rig] = x.db; } else again.push([x.what, x.rig, dist(x.p, first[x.rig]), x.db - firstDb[x.rig]]); }
    T.ok(again.length >= 8 && again.every(([, , d, l]) => d < 1.5 && Math.abs(l) < 1), `each setting measures the same each time it comes round, the two after the glass too: its shape and its level (a doubled chain would be 6 dB up) (${again.map(([w, r, d, l]) => `${w} ${r} ${f1(d)}/${l >= 0 ? '+' : ''}${f1(l)}`).join(', ')} dB)`);
    const rigsApart = Object.keys(first).flatMap((a, i, ks) => ks.slice(i + 1).map((b) => [`${a}/${b}`, dist(first[a], first[b])]));
    T.ok(rigsApart.every(([, d]) => d > 0.5), `and each setting sounds different from the others (${rigsApart.map(([n, d]) => `${n} ${f1(d)}`).join(', ')} dB)`);
    const back = steps.find((x) => x.what === 'back');
    T.ok(back.p && Object.values(first).every((p) => dist(back.p, p) > 1), `the Jam room’s tone sounds like itself after the glass, not a club setting (${Object.entries(first).map(([r, p]) => `${r} ${f1(dist(back.p, p))}`).join(', ')} dB)`);

    // the clicks: a steady 100 Hz sine into Guitar L in place of the guitar (monitoring off), the master captured across
    // each swap
    await E(async () => {
      const o = window.overdub, c = o.engine.ctx, L = o.store.get().tracks.find((t) => t.name === 'Guitar L');
      o.input.audio.monitor(false);
      const osc = c.createOscillator(), g = c.createGain();
      osc.frequency.value = 100; g.gain.value = 0.25;
      osc.connect(g); g.connect(o.engine.inputNode(L.id)); osc.start();
      window.__rig.tone = { osc, g };
      await window.__rig.sleep(800);
    });
    const tone = [];
    for (let i = 0; i < 6; i++) tone.push({ what: `] ${i + 1}`, ...(await step('BracketRight', { secs: 0.6, swap: true })) });
    // (and the devices changing: a Jam room tone in, built beside the playing chain and swapped in under the strip's dip,
    // then ] back to the club's amp)
    const jamTone = () => { const o = window.overdub, j = o.jam, r = j.rigs.RIGS.find((x) => x.chain.some((l) => /^amp\./.test(l.device))); j.setTone(r.id, { track: o.store.get().tracks.find((t) => t.name === 'Guitar L').id, toast: false }); };
    tone.push({ what: 'a Jam tone', ...(await step(jamTone, { secs: 0.6, swap: true })) });
    tone.push({ what: '] back', ...(await step('BracketRight', { secs: 0.6, swap: true })) });
    const F = (a) => Float32Array.from(a);
    const clicks = tone.map((x) => [x.what.startsWith(']') ? `${x.what} ${x.rig}` : x.what, stepOf(F(x.swap), F(x.before), F(x.after)), x.took]);
    T.ok(clicks.every(([, v]) => v < STEP_MAX), `no swap clicks: the sharpest sample from each press until the strip has swapped (and 100 ms on) puts in less than a ${STEP_MAX} step would over the steady tone before it and after it (${clicks.map(([w, v, took]) => `${w}: ${v ? f1(dbfs(v)) : 'none'} (${Math.round(took * 1000)} ms)`).join(', ')} dBFS; the tone's sharpest ${f1(dbfs(kink(F(tone[0].before))))} dBFS)`);
    {
      // (the detector hears one: a 0.02 step put into the steady tone by hand)
      const x = F(tone.at(-1).after), y = Float32Array.from(x);
      for (let i = y.length >> 1; i < y.length; i++) y[i] += 0.02;
      const v = stepOf(y, x);
      T.ok(Math.abs(dbfs(v) - dbfs(0.02)) < 3, `the click detector hears a 0.02 step as ${f1(dbfs(v))} dBFS (${f1(dbfs(0.02))})`);
    }
    await E(() => { const t = window.__rig.tone; t.g.gain.setTargetAtTime(0, t.osc.context.currentTime, 0.01); setTimeout(() => t.osc.stop(), 100); });

    // the engine's retry: a device that isn't ready in time (its worklet module takes 800 ms, the deadline is 300) plays
    // its stand-in, then is built again on its own once it's due, with no change to the song
    const retry = await E(async () => {
      const o = window.overdub, R = await import('/app/src/devices/registry.js'), S = await import('/app/src/engine/strip.js');
      if (!R.getDevice('test.slow')) R.defineDevice({ id: 'test.slow', name: 'Slow', kind: 'effect', params: [{ key: 'db', min: -24, max: 0, def: 0 }], worklets: { 'rig-slow': '/rig-slow-worklet.js' }, build(c) { const g = c.createGain(); return { input: g, output: g, set() {} }; } });
      // (its module: one that takes 800 ms to come, the context's addModule held up for that one URL)
      const aw = o.engine.ctx.audioWorklet, add = aw.addModule.bind(aw);
      aw.addModule = (u, x) => (/rig-slow/.test(String(u)) ? new Promise((res) => setTimeout(res, 800)) : add(u, x));
      const was = { ...S.BUILD };
      Object.assign(S.BUILD, { ready: 300, retry: 600 });
      const G = o.store.get().tracks.find((t) => t.name === 'Guitar R');
      const n = o.store.history.length;
      const r = o.store.dispatch({ type: 'insert.add', track: G.id, insert: { device: 'test.slow' } }, { by: 'you', label: 'slow' });
      const id = r.created.insert;
      await o.engine.settled();
      const firstly = o.engine.instance(G.id, id)?.fallback === true;
      await window.__rig.sleep(1500);
      await o.engine.settled();
      const then = o.engine.instance(G.id, id);
      const steps = o.store.history.length - n;
      Object.assign(S.BUILD, was);
      o.store.undo();
      return { firstly, later: !!then && !then.fallback, steps };
    });
    T.ok(retry.firstly && retry.later && retry.steps === 1, `a device that wasn’t ready in time plays its stand-in, then is built again on its own (stand-in first: ${retry.firstly}; built after: ${retry.later}; song steps: ${retry.steps})`);
    // the live path's check (input/livepath.js createLivePath; docs/research/AMP-PATH.md §7): monitoring on through
    // Guitar L, the amp's output cut behind the engine's back, then the amp's build throwing once (the strip's own retry
    // held off, so the check is what finds it); each time the check finds it, repairs it (the chain rebuilt), says one
    // line for it (here, a toast: this room has no talkback speaker), and the song never moves.
    const health = await E(async () => {
      const o = window.overdub, a = o.input.audio, path = o.input.path, R = window.__rig;
      const said = [], say = o.liveRoom.say.bind(o.liveRoom), toast = o.ui.toast;
      o.liveRoom.say = (line, opt) => { said.push(String(line)); return say(line, opt); };
      o.ui.toast = (t, opt) => { said.push(String(t)); return toast(t, opt); };
      const S = await import('/app/src/engine/strip.js'), was = { ...S.BUILD };
      Object.assign(S.BUILD, { retry: 60000 });
      const L = () => o.store.get().tracks.find((t) => t.name === 'Guitar L');
      const amp = () => L().inserts.find((x) => /^amp\.|^core\.stack$/.test(x.device));
      const until = async (fn, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await R.sleep(50); } return !!fn(); };
      const out = { steps0: o.store.history.length };
      a.monitor(true);
      await o.engine.settled(); await R.sleep(600);
      out.before = (await path.check()).state;
      // 1. the amp's output cut
      const inst = o.engine.instance(L().id, amp().id);
      try { inst.output.disconnect(); } catch { /* ok */ }
      const found = async () => { let st = 'ok'; await until(() => { path.check(); st = path.status().state; return st !== 'ok'; }, 6000); return st; };
      const s1 = await found();
      out.cut = { found: s1, fixed: await until(() => path.status().state === 'ok'), renewed: o.engine.instance(L().id, amp().id) !== inst, said: said.slice() };
      said.length = 0;
      // 2. the amp's build throwing once (the next build; the rebuild after it builds): its worklet node refused once
      const AWN = window.AudioWorkletNode, ampId = amp().device;
      let threw = 0;
      window.AudioWorkletNode = class extends AWN {
        constructor(c, n, o) { if (!threw && o?.processorOptions?.device === ampId) { threw++; throw new Error('an amp that failed to build once'); } super(c, n, o); }
      };
      try {
        await o.engine.rebuild(L().id);
        out.standIn = o.engine.instance(L().id, amp().id)?.fallback === true;
        const s2 = await found();
        out.threw = { threw, found: s2, fixed: await until(() => path.status().state === 'ok'), said: said.slice() };
      } finally { window.AudioWorkletNode = AWN; Object.assign(S.BUILD, was); o.liveRoom.say = say; o.ui.toast = toast; }
      out.steps = o.store.history.length - out.steps0;
      return out;
    });
    T.ok(health.before === 'ok' && health.cut.found !== 'ok' && health.cut.fixed && health.cut.renewed && health.cut.said.length === 1,
      `the path's check: the amp's output cut is found (${health.cut.found}), the chain rebuilt (${health.cut.fixed ? 'ok again' : 'still ' + health.cut.found}), and said once ("${health.cut.said.join('" | "')}")`);
    T.ok(health.threw.threw === 1 && health.standIn && health.threw.found !== 'ok' && health.threw.fixed && health.threw.said.length === 1 && health.steps === 0,
      `an amp that fails to build once: found (${health.threw.found}), rebuilt (${health.threw.fixed ? 'ok again' : 'not'}), said once ("${health.threw.said.join('" | "')}"); the song never moved (${health.steps} steps)`);
    // 3. the audio clock standing still on a context that reads 'running' (the Mac's output device stopped answering:
    // every analyser holds its last window, so the levels look fine): the check names it once, and clears when the
    // clock moves again
    const stall = await E(async () => {
      const o = window.overdub, path = o.input.path, R = window.__rig, c = o.engine.ctx;
      const said = [], toast = o.ui.toast;
      o.ui.toast = (t, opt) => { said.push(String(t)); return toast(t, opt); };
      const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await R.sleep(100); } return !!fn(); };
      const frozen = c.currentTime;
      Object.defineProperty(c, 'currentTime', { configurable: true, get: () => frozen });
      let found = false, back = false;
      try { found = await until(() => path.status().state === 'stalled', 9000); } finally { delete c.currentTime; }
      const line = path.status().line;
      back = await until(() => path.status().state !== 'stalled', 9000);
      o.ui.toast = toast;
      return { found, back, line, said, now: path.status().state };
    });
    T.ok(stall.found && stall.back && stall.said.length === 1 && stall.said[0] === stall.line,
      `the audio clock standing still on a running context: the check says so once ("${stall.said.join('" | "')}"), and lets go when it moves (${stall.found ? 'found' : 'not found'}; then ${stall.now})`);
    const errs = s.errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|status of 404|test\.slow|failed to build once/.test(e));
    T.ok(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await s.close();
  }
}
