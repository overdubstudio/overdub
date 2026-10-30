// The Guitar Studio in Overdub (devices/guitar, devices/graph.js + kit.js, ui/faces.js, gallery.html):
//  1. registry: every pedal and amp in the gear (devices/guitar/gear/) is registered (ids kept: pedal.<id>, amp.<id>),
//     none refused, and every rig's devices exist; rigOps dispatch through the real store. Every worklet the gear's code
//     builds is a file on the studio's origin (gear/worklets/) with that source byte for byte, and the pedals load
//     theirs from those files.
//  2. every pedal and amp instantiates on an OfflineAudioContext and renders the DI strum with no NaN or Inf;
//     renders are deterministic (twice the same, sample for sample).
//  3. bypass is exact: a sample of insert and trails pedals and a kernel amp, off, equals the dry input to -90 dB (lined
//     up with its declared latency).
//  4. the amps: each one's level with the DI strum through it alone (then the band's soft clip, as clawd-o-matic's
//     tools/plug-level.js measures it) is -14 LUFS (±0.75), its true peak under -1 dBTP.
//  4c. the measured cabs (gear/code.js PLUG_AMP_IR): the gear's six are Half Stack's (ids and names); every guitar amp
//     defaults to one and the bass amps, Abyss, Hermit, Flotsam, the 8-Bit Crab, Beach Tape and Straight In to their own
//     designed cab (sample for sample as before); each guitar amp's default sound at its default knobs reads as it did
//     on its own cab within 0.5 LU (the band's loudness and BS.1770; the half-octave change is noted), in time with it,
//     true peak under -1 dBTP; a saved rig without a cab plays the measured one and an explicit 'own' the designed one.
//  4d. the amps on the kernel engine (devices/guitar/voicings.js; devices/builtin/amp-voiced.js), in Node and in
//     Chromium: each renders finite and bit-exact twice, and with the bank held off plays its own designed cab exactly;
//     held against what it was on the graph engine (tools/fixtures/amp-voices.json: its spectrum on its own cab, its
//     drive, its aliasing, which must be 30 dB under the old amp's or under -100 dB) and its cost per block; Half Stack's
//     own chain as a voicing reads as Half Stack; the golden scenes (tools/amp-scenes.js) in Node and Chromium alike;
//     the kernel's cab and mics are the graph amps' native nodes on pink noise; and switching cabs live (among measured
//     and designed ones) is click-free with no dip, on one amp at each rate and the odd ones.
//  5. the rigs: every preset (but the keys bank's) through its whole chain lands at -14 LUFS ±1.5 (leads up to -12),
//     true peak ≤ -1 dBTP: the pedals, the amp, the cab and the mics all came across.
//  2b. automation: every pedal param that changes the sound before set()'s `at` is marked auto: false (no lane).
//  2c. soft clippers: every WaveShaper a pedal builds that saturates has flattened by its clamp (at most ~1% of its
//     slope at rest left there: devices/kit.js softReach), unless it's on HARD_CLAMP with why.
//  6. live: stomping a few pedals on and off while a tone plays is click-free (the 10 ms crossfades).
//  6b. live: a pedal and an amp built on and wired in a moment later (as a strip does) play through themselves from
//     the first note, not their dry signal.
//  6c. live, the lifecycle (docs/DEVICES.md, "Graph devices in a live chain"; devices/lifecycle.js): every pedal and amp
//     built on a context whose clock moves 11.6 ms between reads, stomped before and after it's wired 25 ms later, says
//     health().ok with its bypass gains at their targets, and nothing calls setValueCurveAtTime live; a device whose
//     build throws rejects ready with 'threw' and plays the engine's stand-in with an 'error' report; a worklet module
//     that fails once loads on the next build; assure() snaps a kernel amp's sabotaged dry gain; 50 amp swaps leave no
//     oscillator running.
//  7. faces: gallery.html renders a face for every device with no page errors; knobs turn (keys, double-click reset),
//     switches flip, footswitches stomp; screenshots at 1440 and 390 wide (tools/.out/gallery-*.png).
// usage: node tools/guitar-test.js   (FAST=1 skips the rigs' levels; PEDALS=quack,delay renders only those)
import { open, tally, OUTDIR } from './pw.js';
import { boot } from './guitar-page.js';
import path from 'node:path';
import fs from 'node:fs';
import { run, goldenChecks, ampScenes } from './amp-scenes.js';
import { halfOct, shape, thd, alias, sine } from './amp-measure.js';
import { FIXTURE } from './amp-voices.js';
import { diStrum, bassDI } from '../app/src/audio/testsignals.js';
import { getDevice } from '../app/src/devices/registry.js';
import { AMP_VOICINGS } from '../app/src/devices/guitar/voicings.js';
import { CAB_IDS as AMP_CABS, AMP_PARAMS as AMP_KNOBS } from '../app/src/devices/guitar/amps.js';
import { AMP_VOICED } from '../app/src/devices/builtin/amp-voiced.js';
import { kernel as kernelOf } from '../app/src/devices/builtin/lib.js';
import stackDef from '../app/src/devices/builtin/stack.js';
import '../app/src/devices/guitar/index.js';

const t = tally('guitar');
const FAST = process.env.FAST === '1';
const ONLY = process.env.PEDALS ? process.env.PEDALS.split(',') : null;


// ---------------------------------------------------------------------------------------------------- 4d, in Node
// The kernel amps through the KernelCore the worklet runs (tools/amp-scenes.js run), against the fixture.
const KERNEL_AMPS = Object.keys(AMP_VOICINGS);
// the spectrum gate is 3 dB rms and 6 at worst against the graph amp's; an amp whose real circuit is further off than
// that (its voicing has no physical value left to close it: tools/amp-fit.js) is held to what it measured, and why.
// The aliasing gate is 30 dB under the graph amp's (or under -100 dB); an amp at 4x whose GAIN 10 is as hot as Half
// Stack's is held to what Half Stack does at 4x there instead (measured: -75.6, -70.6, -67.6 dB at 1, 2.5, 5 kHz)
const FIT_GATE = {
  plexi: { rms: 3.5, max: 6.5, why: "a 1959's stack at noon scoops 700 Hz-1.4 kHz deeper than the graph amp's voicing did (to -6 dB) and its bright channel sits 5 dB hotter at 2.8-5.6 kHz" },
  recto: { alias: 25, why: "at GAIN 10 it's as hot as Half Stack's (THD 20 % at 196 Hz) and aliases as Half Stack does at 4x, within 6 dB" },
  bit: { alias: 19, why: "a 4-bit DAC's steps aren't harmonics of the note: the measure reads the quantiser, 20-22 dB under the graph amp's" },
  tape: { alias: -1.5, why: "the transport's wow puts sidebands round every note, which the measure counts; within 1.5 dB of the graph amp's, the same wow" },
  abyss: { alias: 5, why: 'the octave down (f0/2 and its odd harmonics) is no harmonic of f0, so the measure counts it: at 1 kHz it reads 5 dB under the graph amp, whose octave was the same' },
  urchin: { alias: 5, why: 'the octave down (f0/2 and its odd harmonics) is no harmonic of f0, so the measure counts it: at 1 kHz it reads 27 dB under the graph amp, whose octave was the same' },
};
{
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).amps, own = AMP_CABS.indexOf('own'), x = diStrum(8, 48000), bass = bassDI(8, 48000);
  const r1 = (v) => v.toFixed(1), stack = getDevice('core.stack');
  for (const id of KERNEL_AMPS) {
    const def = getDevice('amp.' + id), old = fx[id], V = AMP_VOICINGS[id];
    // (a bass amp is heard as the fixture heard it: on the bass DI)
    const xi = old.signal === 'bass' ? bass : x, xi2 = xi.subarray(0, 2 * 48000);
    // finite and bit-exact; with the bank held off, a measured default is its own designed cab, exactly
    const a = run(def, {}, xi2)[0], b = run(def, {}, xi2)[0], held = run(def, {}, xi2, xi2, { data: null })[0], heldOwn = run(def, { cab: own }, xi2, xi2, { data: null })[0];
    let same = true, finite = true, exact = true;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) same = false; if (!Number.isFinite(a[i])) finite = false; if (held[i] !== heldOwn[i]) exact = false; }
    t.ok(finite && same && exact && def.flavour === 'kernel' && def.exportable === false, `amp.${id} (${def.name}) is a kernel (${V.os}x, latency ${Math.round(def.latency * 48000)} samples; the graph amp's was ${old.latency}): finite, twice the same sample for sample, and with the bank held off its measured default is its own designed cab exactly; not a device file`);
    // its voice against the graph amp's: the spectrum on its own cab (loudness matched, 100 Hz-8 kHz, half-octave),
    // the drive (THD at 196 Hz, -18 dBFS), aliasing at GAIN 10 (to 16 kHz), the cost of a block (best of three)
    const y = run(def, { cab: own }, xi)[0], sp = shape(halfOct(y), old.own.half), th = thd(run(def, { cab: own }, sine(196, -18, 2.5))[0]);
    const tol = FIT_GATE[id] && FIT_GATE[id].rms ? FIT_GATE[id] : { rms: 3, max: 6 };
    t.ok(sp.rms <= tol.rms && sp.max <= tol.max, `amp.${id}: its spectrum on its own cab is the graph amp's within ${r1(sp.rms)} dB rms, ${r1(sp.max)} dB at worst (allowed ${tol.rms} / ${tol.max}${tol.why ? ': ' + tol.why : ''}); new - old, 40 Hz to 14.5 kHz: ${sp.d.join(' ')}`);
    // (under 0.02 % an amp is clean, and a ratio there is the measurement's floor, not its drive: as tools/amp-fit.js)
    const floor = (v) => Math.max(0.02, v);
    t.ok(Math.abs(Math.log(floor(th) / floor(old.thd))) <= Math.log(1.5), `amp.${id}: its drive is the graph amp's within x1.5 (THD at 196 Hz ${th.toFixed(3)} %, was ${old.thd} %${floor(th) === floor(old.thd) ? '; both under 0.02 %: clean' : ''})`);
    const al = [1000, 2500, 5000].map((f) => ({ f, old: old.alias[f].to16k, now: alias(run(def, { cab: own, gain: 10 }, sine(f, -12, 2.5))[0], f, 16000) }));
    const under = (FIT_GATE[id] && FIT_GATE[id].alias) || 30;
    t.ok(al.every((q) => q.now <= Math.max(-100, q.old - under)), `amp.${id}: aliasing at GAIN 10 to 16 kHz ${al.map((q) => `${q.f / 1000} kHz ${r1(q.now)} dB (was ${r1(q.old)})`).join(', ')}: ${under} dB under the graph amp's, or under -100 dB${under !== 30 ? ' (' + FIT_GATE[id].why + ')' : ''}`);
    // (Half Stack alongside, each time: a busy machine runs slower, and the budget is as much slower as Half Stack is
    // than its 110 µs)
    const us = [], hs = [], per = (t0) => ((performance.now() - t0) * 1000) / (xi2.length / 128);
    for (let k = 0; k < 3; k++) {
      let t0 = performance.now();
      run(stack, {}, xi2);
      hs.push(per(t0));
      t0 = performance.now();
      run(def, { cab: own }, xi2);
      us.push(per(t0));
    }
    // (the budget at 4x is Half Stack's; at 2x and none, less; at 8x, half as much again: its stages run twice as many
    // samples as at 4x, and the 8x amps measure 1.1-1.6 times Half Stack in one run)
    const budget = V.os >= 8 ? 165 : V.os >= 4 ? 110 : 65, slow = Math.max(1, Math.min(...hs) / 110);
    t.ok(Math.min(...us) <= 2 * budget * slow, `amp.${id}: ${Math.min(...us).toFixed(0)} µs a 128-frame block at ${V.os}x in Node (best of three; the budget is ${budget}${V.os === 4 ? ", Half Stack's" : V.os >= 8 ? ", 1.5 times Half Stack's" : ''}; held to twice that here, and Half Stack ran at ${Math.min(...hs).toFixed(0)} µs alongside: x${slow.toFixed(2)})`);
  }
  // Half Stack's own chain written as a voicing reads as Half Stack: its boost, gate and cab off, its knobs at noon
  {
    const P = { gate: -96, boost: 0, cab: 7, presence: 5, depth: 5, low_cut: 20, high_cut: 20000, level: 0, master: 5, sag: 0.3, gain: 6.5, bass: 5, mid: 5.5, treble: 6 };
    const V = { os: 4, hp: 110, tight: null, chain: [['tri', 4, 0.12, 2.2, 35, 14000], ['pot'], ['tri', 12, 0.18, 1.6, 90, 9500], ['tri', 6, 0.32, 1.25, 40, 6800], ['stack'], ['gain', 20 * Math.log10(4)]],
      pot: [-44, -4], bright: null, stack: { R1: 250e3, R2: 1e6, R3: 25e3, R4: 47e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 }, pw: -6 + 2.2 * 5, sag: 0.3, xf: [45, 14000], depth: null, pres: [3500, 1.6] };
    const hs = { id: 'test.hs-voiced', kind: 'effect', params: AMP_KNOBS.slice(0, 6), kernel: kernelOf(String.raw`${AMP_VOICED}
const V = ${JSON.stringify(V)};
return { create({ sr, dsp }) { const a = makeVoiced(sr, dsp, V); return { latency: a.latency, process(L, R, n, P) { a.set(P); for (let i = 0; i < n; i++) { const y = a.tick(0.5 * (L[i] + R[i])); L[i] = y; R[i] = y; } } }; } };`) };
    const p = { gain: 6.5, bass: 5, mid: 5.5, treble: 6, presence: 5 };
    const a = run(hs, p, x)[0], b = run(stackDef, P, x)[0], sp = shape(halfOct(a), halfOct(b)), ta = thd(run(hs, p, sine(196, -18, 2.5))[0]), tb = thd(run(stackDef, P, sine(196, -18, 2.5))[0]);
    t.ok(sp.rms <= 0.5 && Math.abs(ta / tb - 1) <= 0.1, `Half Stack's chain as a voicing reads as Half Stack: spectrum within ${sp.rms.toFixed(2)} dB rms (${sp.max.toFixed(2)} at worst), THD ${ta.toFixed(1)} % against ${tb.toFixed(1)} %`);
  }
  // the golden scenes, in Node (pinned) and Chromium (sample for sample)
  const names = ampScenes().map((q) => q.name).filter((n) => n.startsWith('fx:amp.'));
  if (names.length) await goldenChecks(t, names, ['/app/src/devices/guitar/index.js']);
}

// ---------------------------------------------------------------------------------------------------- audio
{
  const { page, errors, close } = await open('/app/style/tokens.css');
  page.setDefaultTimeout(600000);
  await boot(page);

  // 1. registry
  const reg = await page.evaluate(() => {
    const { G, R } = window.__gt;
    const pedals = R.listDevices().filter((d) => d.id.startsWith('pedal.')), amps = R.listDevices({ cat: 'amp' }).filter((d) => d.id.startsWith('amp.'));
    const missing = [];
    for (const r of G.RIGS) for (const s of r.chain) if (!R.getDevice(s.device)) missing.push(r.id + ':' + s.device);
    const ids = G.gear.PEDAL_LIST.map((d) => d.id).filter((id) => !R.getDevice('pedal.' + id));
    const badParams = [];
    for (const d of pedals.concat(amps)) for (const p of d.params) { if (!(p.def >= Math.min(p.min, p.max) && p.def <= Math.max(p.min, p.max))) badParams.push(d.id + '.' + p.key); if (p.fmt) { try { if (typeof p.fmt(p.def) !== 'string') badParams.push(d.id + '.' + p.key + ' fmt'); } catch { badParams.push(d.id + '.' + p.key + ' fmt throws'); } } }
    const roles = pedals.reduce((n, d) => n + d.params.filter((p) => p.role).length, 0), units = pedals.reduce((n, d) => n + d.params.filter((p) => p.unit).length, 0);
    const knobs = pedals.reduce((n, d) => n + d.params.length, 0);
    return { pedals: pedals.length, clawdPedals: G.gear.PEDAL_LIST.length, refused: G.gear.PFX.refused, amps: amps.length, clawdAmps: Object.keys(G.gear.PLUG_AMPS).length,
      rigs: G.RIGS.length, presets: G.gear.PLUG_PRESETS.length, banks: G.RIG_BANKS.length, missing, ids, badParams, roles, units, knobs,
      trails: pedals.filter((d) => d.trails).length, cats: [...new Set(pedals.map((d) => d.cat))].join(' ') };
  });
  t.ok(reg.pedals === reg.clawdPedals && reg.pedals >= 100 && !reg.ids.length, `${reg.pedals} pedals registered (the gear has ${reg.clawdPedals}) as pedal.<id>${reg.ids.length ? '; missing ' + reg.ids.join(' ') : ''}`);
  t.ok(!reg.refused.length, `no pedal refused by its pedalDef${reg.refused.length ? ': ' + JSON.stringify(reg.refused) : ''}`);
  t.ok(reg.amps === reg.clawdAmps && reg.amps >= 27, `${reg.amps} amps registered as amp.<id> (the gear has ${reg.clawdAmps})`);
  t.ok(reg.rigs === reg.presets && reg.rigs > 100, `${reg.rigs} rigs from ${reg.banks} banks (every preset)`);
  t.ok(!reg.missing.length, `every rig's devices are registered${reg.missing.length ? ': ' + reg.missing.slice(0, 5).join(' ') : ''}`);
  t.ok(!reg.badParams.length, `every param's default is in range and its fmt returns a string${reg.badParams.length ? ': ' + reg.badParams.slice(0, 5).join(' ') : ''}`);
  t.note(`${reg.knobs} pedal params: ${reg.roles} with a role, ${reg.units} with a unit; ${reg.trails} trails pedals; cats: ${reg.cats}`);

  // the worklets: the studio loads worklet modules only from files on its own origin (its policy refuses data: and
  // blob: scripts), so every processor source the gear's code builds is also a file of its own
  // (devices/guitar/gear/worklets/). Each file is that source byte for byte (after its one line saying so), and every
  // pedal and amp device names those files for its worklets.
  const wl = await page.evaluate(async () => {
    const { G, R } = window.__gt;
    const { WORKLETS } = await import('/app/src/devices/guitar/gear/index.js');
    const src = {};
    for (const [n, w] of Object.entries(G.gear.PFX.worklets)) src[n] = w.src;
    const diff = [], files = Object.values(WORKLETS);
    for (const [n, s] of Object.entries(src)) {
      if (!WORKLETS[n]) { diff.push(n + ': no file'); continue; }
      const u = new URL(WORKLETS[n]);
      const text = await (await fetch(u)).text();
      if (u.origin !== location.origin || !u.pathname.startsWith('/app/src/devices/guitar/gear/worklets/')) diff.push(n + ': ' + u.href);
      else if (text.slice(text.indexOf('\n') + 1) !== s) diff.push(n + ': not its source');
    }
    const devs = R.listDevices().filter((d) => /^(pedal|amp)\./.test(d.id) && d.worklets);
    const named = devs.flatMap((d) => Object.entries(d.worklets).filter(([n, u]) => u !== WORKLETS[n] || !files.includes(u)).map(([n]) => d.id + ':' + n));
    return { n: Object.keys(src).length, files: files.length, diff, devs: devs.length, named };
  });
  t.ok(wl.n >= 40 && wl.files === wl.n && !wl.diff.length, `${wl.n} worklets the gear's code builds, each a file of its own on the studio's origin with its source byte for byte (gear/worklets/)${wl.diff.length ? ': ' + wl.diff.slice(0, 5).join(', ') : ''}`);
  t.ok(wl.devs >= 30 && !wl.named.length, `the ${wl.devs} pedals and amps with worklets load them from those files${wl.named.length ? '; not: ' + wl.named.slice(0, 5).join(' ') : ''}`);
  // the kit's own envelope follower (PFX.ENV, for a graph device of Overdub's that calls kit.envelope(); no built-in
  // does yet): its file loads behind END and it follows a tone
  const env = await page.evaluate(async () => {
    const K = await import('/app/src/devices/kit.js');
    const c = new OfflineAudioContext(1, 24000, 48000);
    const ok = await K.loadWorklet(c, 'pfx-env', K.PFX.ENV);
    if (!ok) return { ok, url: K.PFX.ENV };
    const o = c.createOscillator(), g = c.createGain(), n = new AudioWorkletNode(c, 'pfx-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    o.frequency.value = 220; g.gain.value = 0.5; o.connect(g); g.connect(n); n.connect(c.destination); o.start(0);
    const d = (await c.startRendering()).getChannelData(0);
    return { ok, end: d[d.length - 1], url: new URL(K.PFX.ENV).pathname };
  });
  t.ok(env.ok && Math.abs(env.end - 0.5) < 0.05, `the kit's own envelope follower (${env.url}) loads from its file and follows a 0.5 sine (${env.ok ? env.end.toFixed(3) : 'did not load'})`);

  const ops = await page.evaluate(async () => {
    const { G } = window.__gt;
    let store = null;
    try { const S = await import('/app/src/core/store.js'); store = S.createStore(); } catch (e) { return { skip: e.message }; }
    let r = store.dispatch({ type: 'track.add', track: { name: 'Guitar', kind: 'audio' }, ref: 'g' }, { by: 'you' });
    if (!r.ok) return { err: r.error };
    const tid = r.created.g || Object.values(r.created)[0];
    const rig = G.rigById('webcam') || G.RIGS[0];
    r = store.dispatch(G.rigOps(tid, rig), { by: 'claude', label: 'rig ' + rig.name });
    if (!r.ok) return { err: r.error };
    const t1 = store.track(tid), first = t1.inserts.map((x) => x.id);
    const rig2 = G.RIGS.find((x) => x.chain.length > 3 && x.id !== rig.id);
    r = store.dispatch(G.rigOps(tid, rig2, { replace: first }), { by: 'claude' });
    if (!r.ok) return { err: r.error };
    const t2 = store.track(tid);
    return { n1: first.length, chain1: rig.chain.length, n2: t2.inserts.length, chain2: rig2.chain.length, devs: t2.inserts.map((x) => x.device).join(' '), same: t2.inserts.every((x, k) => x.device === rig2.chain[k].device && x.on === rig2.chain[k].on) };
  });
  if (ops.skip) t.note('store not loadable: ' + ops.skip);
  else t.ok(!ops.err && ops.n1 === ops.chain1 && ops.n2 === ops.chain2 && ops.same, `rigOps through the store: a rig's ${ops.chain1} inserts, then another replacing it (${ops.devs || ops.err})`);

  // 2b. automation (docs/research/AUTOMATION.md 3.5): the engine moves a pedal's knob with set(values, { at }) ahead
  // of time. A param that changes the sound before `at` (the pedal writes .value, or rebuilds, in set()) would land up
  // to 120 ms early: those are marked auto: false in devices/guitar/pedals.js (no lane), and every other one waits.
  {
    const early = await page.evaluate(async (ONLY) => {
      const { R, input } = window.__gt;
      const SR = 48000, x = input('di', 1.2).slice(0, Math.round(1.2 * SR)), AT = 0.8, until = Math.round((AT - 0.03) * SR);
      const go = async (id, params, move) => {
        const c = new OfflineAudioContext(2, x.length, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
        b.copyToChannel(x, 0); src.buffer = b;
        const inst = await R.instantiate(c, id, { uid: 'auto-' + id, params, on: true, bpm: 120 });
        await inst.ready;
        src.connect(inst.input); inst.output.connect(c.destination); src.start(0);
        inst.set({ ...params, ...move }, { at: AT });
        const r = await c.startRendering();
        inst.dispose();
        return [r.getChannelData(0).slice(0, until), r.getChannelData(1).slice(0, until)];
      };
      const out = { found: [], marked: [], wrong: [], params: 0 };
      for (const d of R.listDevices().filter((q) => q.id.startsWith('pedal.') && (!ONLY || ONLY.includes(q.id.slice(6))))) {
        const base = {};
        for (const p of d.params) base[p.key] = p.def;
        const ref = await go(d.id, base, {}), ref2 = await go(d.id, base, {});
        // (a pedal whose renders differ by a hair on their own: its own floor, times ten)
        let floor = 0;
        for (let ch = 0; ch < 2; ch++) for (let i = 0; i < until; i++) floor = Math.max(floor, Math.abs(ref2[ch][i] - ref[ch][i]));
        for (const p of d.params) {
          if (p.auto === false) out.marked.push(d.id + '.' + p.key);
          if (p.opts || p.tap || p.step >= (p.max - p.min)) continue;
          out.params++;
          const to = p.def > (p.min + p.max) / 2 ? p.min : p.max;
          const got = await go(d.id, base, { [p.key]: to });
          let dmax = 0;
          for (let ch = 0; ch < 2; ch++) for (let i = 0; i < until; i++) dmax = Math.max(dmax, Math.abs(got[ch][i] - ref[ch][i]));
          if (dmax > Math.max(1e-4, 10 * floor)) out.found.push(d.id + '.' + p.key);
        }
      }
      return out;
    }, ONLY);
    const unmarked = early.found.filter((k) => !early.marked.includes(k));
    t.note(`automation: ${early.found.length} of ${early.params} continuous pedal params change the sound before their set()'s time${early.found.length ? ': ' + early.found.join(' ') : ''}`);
    t.ok(!unmarked.length, `every pedal param that ignores set()'s time is marked auto: false (no lane), so a lane never lands early${unmarked.length ? '; unmarked: ' + unmarked.join(' ') : ''}`);
  }

  // 2. every pedal renders, finite; deterministic
  const ids = await page.evaluate((only) => window.__gt.R.listDevices().filter((d) => d.id.startsWith('pedal.') && (!only || only.includes(d.pedal))).map((d) => d.id), ONLY);
  const bad = [], loud = [];
  let worst = { id: '', peak: -999 };
  for (let k = 0; k < ids.length; k += 12) {
    const res = await page.evaluate(async (batch) => {
      const { render, input, check } = window.__gt, x = input('di', 3), out = [];
      for (const id of batch) {
        try { const r = await render([{ device: id }], x, { extra: 0.5 }); out.push(Object.assign({ id }, check(r))); }
        catch (e) { out.push({ id, err: String(e && e.message || e) }); }
      }
      return out;
    }, ids.slice(k, k + 12));
    for (const r of res) {
      if (r.err || r.bad) bad.push(r.id + (r.err ? ' ' + r.err : ' NaN/Inf x' + r.bad));
      if (r.peak > 6) loud.push(`${r.id} ${r.peak.toFixed(1)}`);
      if (r.peak > worst.peak) worst = r;
    }
  }
  t.ok(!bad.length, `${ids.length} pedals render the DI strum on an OfflineAudioContext, finite${bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''}`);
  t.ok(!loud.length, `no pedal's raw peak over +6 dBFS at its defaults (loudest ${worst.id} ${worst.peak.toFixed(1)} dBFS)${loud.length ? ': ' + loud.join(', ') : ''}`);

  const det = await page.evaluate(async () => {
    const { render, input } = window.__gt, x = input('di', 2), out = [];
    for (const id of ['pedal.bitreef', 'pedal.verb', 'pedal.krillroll', 'pedal.chewedcable', 'pedal.planktoncloud', 'pedal.seasick', 'amp.abyss']) {
      const a = await render([{ device: id }], x), b = await render([{ device: id }], x);
      let d = 0; for (let ch = 0; ch < 2; ch++) for (let i = 0; i < a[ch].length; i++) d = Math.max(d, Math.abs(a[ch][i] - b[ch][i]));
      out.push([id, d]);
    }
    return out;
  });
  // Kernels are bit-exact. A few of the gear's pedals drive their modulation from main-thread timers (they predate the
  // clock), so under heavy CPU load two renders can differ by a render quantum's worth of wobble: allowed up to
  // -80 dB, and named here so it stays visible.
  const inexact = det.filter(([, d]) => d > 0);
  if (inexact.length) t.note(`not bit-exact under load: ${inexact.map(([id, d]) => id.split('.')[1] + ' ' + d.toExponential(1)).join(', ')}`);
  t.ok(det.every(([, d]) => d <= 1e-4), `renders are deterministic (twice the same to -80 dB; ${det.length - inexact.length}/${det.length} sample for sample)`);

  // 2c. soft clippers (devices/kit.js softReach, docs PEDALS.md "The kit"). A WaveShaperNode clamps its input to its
  // curve: past the ends it holds the end value, so a soft clipper whose curve is still climbing there (tanh at a small
  // drive, drawn only over ±1) turns into a hard clip the moment it's driven past them. Every WaveShaper every pedal
  // builds, at its defaults: one that saturates (monotonic, and at least 5% shallower at both ends than at rest) must
  // have no more than SOFT of its slope at rest left at its clamp (the slope one point in from each end against the
  // slope across the middle; 5% over the rule for the sampling), unless HARD_CLAMP names it with why. Curves that don't
  // saturate (a dead zone, a rectifier, a fold, a map that steepens, a straight line) aren't judged.
  const HARD_CLAMP = {
    quack: "a control map, not audio: the envelope soft-limited to 1, the top of the filter's sweep, where it's meant to stop",
    pistolshrimp: "control maps, not audio: the pick's envelope to the clipper's gain, which stop at the top of SNAP's range",
  };
  const soft = await page.evaluate(async ({ only, hard }) => {
    const { R } = window.__gt, { SOFT } = await import('/app/src/devices/kit.js');
    const proto = BaseAudioContext.prototype, make = proto.createWaveShaper, made = [];
    const out = { n: 0, curves: 0, judged: 0, bad: [], excused: [], worst: { id: '', r: 0 } };
    proto.createWaveShaper = function () { const n = make.call(this); made.push(n); return n; };
    try {
      for (const d of R.listDevices().filter((q) => q.id.startsWith('pedal.') && (!only || only.includes(q.pedal)))) {
        made.length = 0;
        const c = new OfflineAudioContext(2, 128, 48000), inst = await R.instantiate(c, d.id, { uid: 'sc', params: {}, on: true, bpm: 120 });
        await inst.ready;
        out.n++;
        made.forEach((n, j) => {
          const cv = n.curve;
          if (!cv || cv.length < 5) return;
          out.curves++;
          const N = cv.length, m = (N - 1) >> 1, s0 = N % 2 ? (cv[m + 1] - cv[m - 1]) / 2 : cv[m + 1] - cv[m], sg = Math.sign(s0);
          const lo = (cv[1] - cv[0]) * sg, hi = (cv[N - 1] - cv[N - 2]) * sg, a0 = Math.abs(s0);
          let mono = a0 > 0;
          for (let i = 1; mono && i < N; i++) if ((cv[i] - cv[i - 1]) * sg < -1e-7) mono = false;
          if (!mono || !(lo < 0.95 * a0 && hi < 0.95 * a0)) return;
          out.judged++;
          const r = Math.max(lo, hi) / a0, at = `${d.pedal}#${j} ${(r * 100).toFixed(1)}%`;
          if (r > out.worst.r && !hard[d.pedal]) out.worst = { id: at, r };
          if (r > SOFT * 1.05) (hard[d.pedal] ? out.excused : out.bad).push(at);
        });
        inst.dispose();
      }
    } finally { proto.createWaveShaper = make; }
    return out;
  }, { only: ONLY, hard: HARD_CLAMP });
  t.ok(soft.n >= (ONLY ? 1 : 100) && !soft.bad.length, `${soft.judged} of the ${soft.curves} WaveShaper curves in ${soft.n} pedals saturate, and each has flattened by its clamp (≤ ~1% of its slope at rest left there; worst ${soft.worst.id || 'none'})${soft.bad.length ? "; still climbing at the clamp (a hard clip when driven past it: give it reach 'soft'): " + soft.bad.join(', ') : ''}`);
  const stale = Object.keys(HARD_CLAMP).filter((id) => (!ONLY || ONLY.includes(id)) && !soft.excused.some((e) => e.startsWith(id + '#')));
  t.ok(!stale.length, `HARD_CLAMP excuses only curves that need it: ${soft.excused.join(', ') || 'none'}${stale.length ? '; nothing to excuse in ' + stale.join(' ') : ''}`);

  // 3. bypass exact
  const byp = await page.evaluate(async () => {
    const { R, render, input } = window.__gt, x = input('di', 2);
    const ins = ['pedal.gate', 'pedal.drive', 'pedal.fuzz', 'pedal.quack', 'pedal.chorus', 'pedal.whammerhead', 'pedal.bitreef', 'amp.punk'];
    const tr = ['pedal.delay', 'pedal.verb', 'pedal.tapecrab', 'pedal.halojelly', 'pedal.iceberg', 'pedal.frostbite'].filter((id) => R.getDevice(id) && R.getDevice(id).trails);
    const out = [];
    for (const id of ins.concat(tr)) {
      // (a device with latency is its dry input that much later, bypassed: a kernel amp lines its dry path up)
      const dv = R.getDevice(id), r = await render([{ device: id, on: false }], x), L = dv.flavour === 'kernel' ? Math.round((+dv.latency || 0) * 48000) : 0;
      let d = 0; for (let i = 0; i < x.length; i++) { const v = i < L ? 0 : x[i - L]; d = Math.max(d, Math.abs(r[0][i] - v), Math.abs(r[1][i] - v)); }
      out.push({ id, trails: !!R.getDevice(id).trails, db: 20 * Math.log10(d + 1e-12) });
    }
    return out;
  });
  t.ok(byp.every((b) => b.db <= -90), `bypass is exact (off = dry, worst ${Math.max(...byp.map((b) => b.db)).toFixed(0)} dB) for ${byp.filter((b) => !b.trails).length} insert and ${byp.filter((b) => b.trails).length} trails devices${byp.some((b) => b.db > -90) ? ': ' + byp.filter((b) => b.db > -90).map((b) => b.id + ' ' + b.db.toFixed(0)).join(' ') : ''}`);

  // 4. the amps
  const amps = await page.evaluate(async () => {
    const { R, render, input, clawdLufs, check, tp, M, SR } = window.__gt, out = [];
    for (const d of R.listDevices({ cat: 'amp' }).filter((x) => x.id.startsWith('amp.'))) {
      const bass = d.tone === 'bass', x = input(bass ? 'bass' : 'di', 8);
      const r = await render([{ device: d.id }], x, { band: true });
      const buf = { sampleRate: SR, numberOfChannels: 2, length: r[0].length, getChannelData: (i) => r[i] };
      out.push({ id: d.id, name: d.name, bass, lufs: clawdLufs(r[0], r[1]), bs1770: M.lufs(buf), tp: tp(r), ...check(r) });
    }
    return { out };
  });
  for (const a of amps.out) {
    const okLevel = Math.abs(a.lufs + 14) <= 0.75;
    t.ok(!a.bad && okLevel && a.tp <= -1, `${a.id.padEnd(12)} ${a.name.padEnd(13)} ${a.lufs.toFixed(1)} LUFS (BS.1770 ${a.bs1770.toFixed(1)}), TP ${a.tp.toFixed(1)} dBTP${a.bass ? ' (bass DI)' : ''}${a.bad ? ' NaN!' : ''}`);
  }

  // 4c. the measured cabs
  const irs = await page.evaluate(async () => {
    const { G, R, render, input, clawdLufs, tp, check, M, SR } = window.__gt;
    const AL = await import('/app/src/devices/builtin/amp-lib.js');
    const A = await import('/app/src/devices/guitar/amps.js');
    const g = G.gear, own = G.CAB_IDS.indexOf('own');
    const measured = G.CAB_IDS.filter(A.isMeasured);
    const ids = { same: JSON.stringify(measured) === JSON.stringify(AL.CAB_IDS) && measured.every((id, i) => g.PLUG_CABS[id].name === AL.CAB_NAMES[i] && g.PLUG_CABS[id].ir === i),
      first: G.CAB_IDS.indexOf(measured[0]), designed: G.CAB_IDS.length - measured.length };
    // half-octave bands, 63 Hz to 11.3 kHz: averaged Hann periodograms (8192 points) of the left channel, dB
    const bands = []; for (let f = 63; f < 12000; f *= Math.SQRT2) bands.push(f);
    const spec = (x) => {
      const N = 8192, w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const P = new Float64Array(N / 2); let fr = 0;
      for (let st = SR; st + N <= x.length; st += N / 2) {
        const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[st + i] * w[i];
        for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
        for (let len = 2; len <= N; len <<= 1) { const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2, vr = re[v] * cr - im[v] * ci, vi = re[v] * ci + im[v] * cr; re[v] = re[u] - vr; im[v] = im[u] - vi; re[u] += vr; im[u] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
        for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
        fr++;
      }
      return bands.map((fc) => { let e = 0; for (let k = Math.round((fc * Math.pow(2, -0.25) * N) / SR); k < Math.round((fc * Math.pow(2, 0.25) * N) / SR); k++) e += P[k]; return 10 * Math.log10(e / fr + 1e-20); });
    };
    // the lag (samples) that best lines b up with a, within ±64
    const lag = (a, b) => { let best = 0, bv = -Infinity; for (let L = -64; L <= 64; L++) { let s = 0; for (let i = SR; i < SR * 3; i++) s += a[i] * b[i + L]; if (s > bv) { bv = s; best = L; } } return best; };
    const rows = [];
    for (const d of R.listDevices({ cat: 'amp' }).filter((x) => x.id.startsWith('amp.'))) {
      const id = d.id.slice(4), def = d.params.find((p) => p.key === 'cab').def, bass = d.tone === 'bass';
      const row = { id: d.id, cab: G.CAB_IDS[def], want: g.PLUG_AMP_IR[id] || 'own', data: !!d.data };
      if (row.cab === 'own') {
        // the amps that keep their own: the default is the designed cab, sample for sample
        const x = input(bass ? 'bass' : 'di', 2), a = await render([{ device: d.id }], x), b = await render([{ device: d.id, params: { cab: own } }], x);
        let dd = 0; for (let i = 0; i < a[0].length; i++) dd = Math.max(dd, Math.abs(a[0][i] - b[0][i]));
        rows.push({ ...row, exact: dd === 0 });
        continue;
      }
      const x = input(bass ? 'bass' : 'di', 8);
      const nb = await render([{ device: d.id }], x, { band: true }), ob = await render([{ device: d.id, params: { cab: own } }], x, { band: true });
      const n = await render([{ device: d.id }], x), o = await render([{ device: d.id, params: { cab: own } }], x);
      const buf = (r) => ({ sampleRate: SR, numberOfChannels: 2, length: r[0].length, getChannelData: (i) => r[i] });
      const sn = spec(n[0]), so = spec(o[0]), dl = M.lufs(buf(n)) - M.lufs(buf(o));
      rows.push({ ...row, clawd: clawdLufs(nb[0], nb[1]) - clawdLufs(ob[0], ob[1]), bs: dl, tp: tp(n), tpOwn: tp(o), lag: lag(o[0], n[0]), bad: check(n).bad,
        sp: sn.map((v, i) => Math.round(v - so[i] - dl)) });
    }
    // a saved rig: no cab is the amp's default (measured); 'own' written is its own designed cab, and comes back as it
    const rec = G.ampParams({ amp: 'recto', gain: 6 }), ownP = G.ampParams({ amp: 'recto', cab: 'own' });
    const saved = { none: !('cab' in rec), ownIdx: ownP.cab === own, back: G.ampSettings('recto', R.paramValues(R.getDevice('amp.recto'), ownP)).cab === 'own',
      dflt: !('cab' in G.ampSettings('recto', R.paramValues(R.getDevice('amp.recto'), {}))), clean: JSON.stringify(g.plugCabClean({ amp: 'recto', cab: 'own' })) === '{"cab":"own"}' && JSON.stringify(g.plugCabClean({ amp: 'whale', cab: 'own' })) === '{}',
      older: !g.PLUG_CABS['not-a-cab'] && JSON.stringify(g.plugCabClean({ amp: 'recto', cab: 'not-a-cab' })) === '{}' };
    return { ids, rows, saved };
  });
  t.ok(irs.ids.same && irs.ids.first === irs.ids.designed, `the gear's measured cabs are Half Stack's six, ids and names, after the ${irs.ids.designed} designed ones (every CAB index before them unchanged)`);
  const wantOk = irs.rows.every((r) => r.cab === r.want && r.data);
  t.ok(wantOk, `every amp's CAB default is its PLUG_AMP_IR cab, and every amp names the bank as data (any CAB can be a measured one); the measured defaults: ${irs.rows.filter((r) => r.cab !== 'own').map((r) => r.id.slice(4) + ' ' + r.cab).join(', ')}`);
  const keep = irs.rows.filter((r) => r.cab === 'own');
  t.ok(keep.length === 11 && keep.every((r) => r.exact), `${keep.length} amps keep their own designed cab, sample for sample as before: ${keep.map((r) => r.id.slice(4)).join(' ')}`);
  for (const r of irs.rows.filter((x) => x.cab !== 'own')) {
    t.ok(!r.bad && Math.abs(r.clawd) <= 0.5 && Math.abs(r.bs) <= 0.5 && r.tp <= -1 && Math.abs(r.lag) <= 16,
      `${r.id.padEnd(12)} on ${r.cab.padEnd(15)} as loud as on its own cab: ${r.clawd >= 0 ? '+' : ''}${r.clawd.toFixed(2)} LU (BS.1770 ${r.bs >= 0 ? '+' : ''}${r.bs.toFixed(2)}), TP ${r.tpOwn.toFixed(1)} -> ${r.tp.toFixed(1)} dBTP, ${r.lag} samples apart`);
  }
  t.note(`the change, measured cab against its own (half-octave bands from 63 Hz to 11.3 kHz, dB, loudness matched):\n${irs.rows.filter((r) => r.sp).map((r) => '    ' + r.id.slice(4).padEnd(9) + r.sp.map((v) => String(v).padStart(4)).join('')).join('\n')}`);
  const sv = irs.saved;
  t.ok(sv.none && sv.ownIdx && sv.back && sv.dflt && sv.clean && sv.older, `a saved rig without a cab plays the amp's default (measured); 'own' saved is CAB 0 and comes back as 'own' (designed); a cab id from later is dropped, the amp's default`);


  // 4d, in Chromium: the kernel's cab and mics against the graph amps' own nodes (plugAmp's, as its apply() sets them
  // from plugCabNet: the designed cab's six filters, each mic's align delay, seven filters and four room taps, the
  // measured IR in a ConvolverNode), on pink noise
  const kcab = await page.evaluate(async () => {
    const { G, R, TS, SR } = window.__gt;
    const A = await import('/app/src/devices/guitar/amps.js'), AV = await import('/app/src/devices/builtin/amp-voiced.js');
    const { kernel } = await import('/app/src/devices/builtin/lib.js'), { CABS_HASH } = await import('/app/src/devices/builtin/amp-lib.js');
    const { loadData } = await import('/app/src/kernel/data.js'), { decodeOdk } = await import('/app/src/kernel/odk.js');
    const bank = decodeOdk(await loadData(CABS_HASH)), g = G.gear, dB = (d) => Math.pow(10, d / 20), x = TS.pinkNoise(3, SR, { db: -18 });
    const cabDef = (id) => ({ id: 'test.kcab-' + id, name: 'cab', kind: 'effect', cat: 'amp', params: A.AMP_PARAMS, data: { cabs: CABS_HASH },
      kernel: kernel(String.raw`${AV.AMP_VOICED}${AV.AMP_CAB}
const V = ${JSON.stringify(A.ampVoice(id, { os: 4 }))}, T = ${JSON.stringify(A.cabTables())};
return { create({ sr, dsp, data }) { const cab = makeAmpCab(sr, dsp, data && data.cabs, V, T); let buf = new Float64Array(128);
  return { process(L, R, n, P) { cab.set(P); for (let i = 0; i < n; i++) buf[i] = 0.5 * (L[i] + R[i]); cab.process(buf, n); for (let i = 0; i < n; i++) { L[i] = buf[i]; R[i] = buf[i]; } } }; } };`) });
    const nativeCab = (c, id, P) => {
      const N = g.plugCabNet(id, P, SR), F = (type, f, q, gn) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; if (gn != null) n.gain.value = gn; return n; };
      const G1 = (v) => { const n = c.createGain(); n.gain.value = v; return n; }, input = G1(1), out = G1(1);
      if (N.ir != null) {
        const conv = c.createConvolver(), s = bank.samples[N.ir], b = c.createBuffer(1, s.ch[0].length, SR);
        b.copyToChannel(Float32Array.from(s.ch[0], (v) => v * ((+s.gain || 1) / 8388608)), 0); conv.normalize = false; conv.buffer = b;
        const tr = G1(dB(N.trim)); input.connect(conv); conv.connect(tr); tr.connect(out);
        return { input, out, N };
      }
      const cb = N.custom ? N.cab : g.PLUG_AMPS[id].cab;
      const cab = [F('highpass', cb[0], 0.7), F('peaking', cb[1][0], cb[1][1], cb[1][2]), F('peaking', cb[2][0], cb[2][1], cb[2][2]), F('peaking', cb[3][0], cb[3][1], cb[3][2]), F('lowpass', cb[4][0], cb[4][1]), F('lowpass', cb[5], 0.6)];
      input.connect(cab[0]); for (let i = 0; i < 5; i++) cab[i].connect(cab[i + 1]);
      if (!N.custom) { cab[5].connect(out); return { input, out, N }; }
      const micOut = G1(dB(N.trim)); micOut.connect(out);
      for (const X of N.mics) {
        const align = c.createDelay(0.01), f = X.f.map(([t, hz, q, gn]) => F(t, hz, q, gn)), sum = G1(1), mix = G1(X.gain);
        align.delayTime.value = X.delay; cab[5].connect(align); align.connect(f[0]); for (let i = 0; i < 6; i++) f[i].connect(f[i + 1]); f[6].connect(sum);
        for (const [t, gn] of X.taps) { const d = c.createDelay(0.2), gg = G1(gn); d.delayTime.value = t; f[6].connect(d); d.connect(gg); gg.connect(sum); }
        sum.connect(mix); mix.connect(micOut);
      }
      return { input, out, N };
    };
    const render = async (build) => {
      const c = new OfflineAudioContext(2, x.length, SR), s = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
      b.copyToChannel(x, 0); s.buffer = b;
      const node = await build(c); s.connect(node.input); node.out.connect(c.destination); s.start(0);
      const o = await c.startRendering(); if (node.dispose) node.dispose();
      return o.getChannelData(0);
    };
    const ix = (k) => A.CAB_IDS.indexOf(k), mi = (k) => A.MIC_IDS.indexOf(k), out = [];
    for (const [id, p] of [['recto', {}], ['clean', { cab: 0 }], ['punk', { cab: ix('g412') }], ['clean', { cab: 0, micpos: 0.8, micdist: 6, micang: 20 }], ['plexi', { cab: ix('horn'), mic: mi('cond') }],
      ['recto', { cab: ix('v412'), mic2: 1 + mi('ribbon'), blend: 4, flip: 1, mic2dist: 3 }], ['jangle', { cab: ix('phone'), mic: mi('crystal'), mic2: 1 + mi('kick'), mic2pos: 1.2 }]]) {
      const def = cabDef(id), P = G.ampSettings(id, R.paramValues(def, p));
      const k = await render(async (c) => { const inst = await R.instantiate(c, def, { uid: 'kc', params: p, on: true }); await inst.ready; return { input: inst.input, out: inst.output, dispose: () => inst.dispose() }; });
      const N = g.plugCabNet(id, P, SR), n = await render(async (c) => nativeCab(c, id, P));
      let d = 0, e = 0;
      for (let i = 4800; i < x.length; i++) { d += (k[i] - n[i]) ** 2; e += n[i] ** 2; }
      out.push({ what: `${id} ${N.ir != null ? 'IR ' + N.ir : N.custom ? (N.cab === g.PLUG_AMPS[id].cab ? 'own' : 'designed') + ' + ' + N.mics.length + ' mic' + (N.mics.length > 1 ? 's' : '') : 'own'}`, db: 10 * Math.log10(d / e) });
    }
    return out;
  });
  t.ok(kcab.length === 7 && kcab.every((r) => r.db <= -80), `the kernel's cab and mics are the graph amps' native nodes on pink noise (the difference against them): ${kcab.map((r) => `${r.what} ${r.db.toFixed(0)} dB`).join(', ')}`);

  // 4d, live: switching a kernel amp's cabs while it plays (measured, its own, measured, a designed 4x12 with its
  // mic, measured): click-free, and no dip
  const kLive = await page.evaluate(async (KA) => {
    const { R, G } = window.__gt, c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const REC = `class GtRec4 extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; }
      process(i) { const x = i[0] && i[0][0]; if (x && this.on) this.port.postMessage(x.slice(0)); return this.on; } } registerProcessor('gt-rec4', GtRec4);`;
    await c.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(REC));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ix = (id) => G.CAB_IDS.indexOf(id), res = [];
    for (const id of KA) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 196; g.gain.value = 0.25; o.connect(g);
      const inst = await R.instantiate(c, 'amp.' + id, { uid: 'k-live-' + id, on: true }); await inst.ready;
      const rec = new AudioWorkletNode(c, 'gt-rec4'), blocks = [];
      rec.port.onmessage = (e) => blocks.push(e.data);
      g.connect(inst.input); inst.output.connect(rec); rec.connect(c.destination); o.start();
      const t0 = c.currentTime, marks = [];
      await sleep(400);
      for (const cab of [ix('british-dynamic'), ix('own'), ix('modern-two'), ix('g412'), ix('modern-close')]) { marks.push(c.currentTime + 0.01 - t0); inst.set({ cab }); await sleep(450); }
      rec.port.postMessage('stop'); o.stop(); await sleep(60);
      inst.dispose(); g.disconnect(); rec.disconnect();
      const n = blocks.reduce((s, b) => s + b.length, 0), y = new Float32Array(n); let p = 0; for (const b of blocks) { y.set(b, p); p += b.length; }
      const sr = 48000, d2 = new Float32Array(n); for (let i = 2; i < n; i++) d2[i] = Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]);
      const near = new Uint8Array(n);
      for (const m of marks) for (let i = Math.max(0, Math.round((m - 0.03) * sr)); i < Math.min(n, Math.round((m + 0.12) * sr)); i++) near[i] = 1;
      let steady = 0, at = 0;
      for (let i = Math.round(0.15 * sr); i < n - 256; i++) { if (near[i]) at = Math.max(at, d2[i]); else steady = Math.max(steady, d2[i]); }
      const W = 240, rms = (a) => { let s = 0; for (let i = a; i < a + W; i++) s += y[i] * y[i]; return Math.sqrt(s / W); };
      let lo = Infinity, ref = 0, k = 0;
      for (let a = Math.round(0.15 * sr); a + W < n - 256; a += W) { const r = rms(a); if (near[a]) lo = Math.min(lo, r); else { ref += r; k++; } }
      res.push({ id, ratio: at / Math.max(steady, 1e-9), dip: 20 * Math.log10(lo / (ref / Math.max(1, k)) + 1e-12), secs: n / sr });
    }
    await c.close();
    return res;
  }, ['clean', 'recto', 'tiny', 'di', 'tape', 'abyss', 'whale']); // (one at each rate, 2x, 4x, 8x and none, the wow, the octave, a bass amp)
  for (const r of kLive) t.ok(r.ratio < 1.6 && r.dip > -12 && r.secs > 2, `live, amp.${r.id} switching cabs (measured, its own, measured, a designed 4x12 with its mic, measured) is click-free (${r.ratio.toFixed(2)}× the steady sound's second difference) and never dips (quietest 5 ms ${r.dip.toFixed(1)} dB)`);

  // 5. the rigs, end to end
  if (!FAST) {
    const rigIds = await page.evaluate(() => window.__gt.G.RIGS.map((r) => r.id));
    const rows = [];
    for (let k = 0; k < rigIds.length; k += 16) {
      rows.push(...await page.evaluate(async (batch) => {
        const { G, render, input, clawdLufs, check, tp } = window.__gt, out = [];
        for (const id of batch) {
          const r = G.rigById(id), kind = r.bank.id === 'bass' ? 'bass' : r.bank.id === 'keys' ? 'keys' : 'di';
          try {
            const y = await render(r.chain, input(kind === 'keys' ? 'di' : kind, 6), { band: true });
            out.push({ id, bank: r.bank.id, lead: r.tags.includes('lead'), kind, lufs: clawdLufs(y[0], y[1]), tp: tp(y), ...check(y) });
          } catch (e) { out.push({ id, err: String(e.message || e) }); }
        }
        return out;
      }, rigIds.slice(k, k + 16)));
    }
    const judged = rows.filter((r) => r.kind !== 'keys');
    const off = judged.filter((r) => r.err || r.bad || r.lufs < -15.5 || r.lufs > (r.lead ? -12 : -12.5) || r.tp > -1);
    const lo = Math.min(...judged.map((r) => r.lufs)), hi = Math.max(...judged.map((r) => r.lufs));
    t.ok(!off.length, `${judged.length} rigs (all but the keys bank) through their whole chain: ${lo.toFixed(1)} to ${hi.toFixed(1)} LUFS, true peak ≤ ${Math.max(...judged.map((r) => r.tp)).toFixed(1)} dBTP${off.length ? '; off: ' + off.slice(0, 8).map((r) => `${r.id} ${r.err || (r.bad ? 'NaN' : r.lufs.toFixed(1) + '/' + r.tp.toFixed(1))}`).join(', ') : ''}`);
    const keys = rows.filter((r) => r.kind === 'keys');
    t.ok(keys.every((r) => !r.err && !r.bad), `${keys.length} keys rigs render finite (their levels are set for a keyboard, not judged with a guitar)`);
  }

  // 6. live: click-free stomps
  const live = await page.evaluate(async () => {
    const { R } = window.__gt, c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const REC = `class GtRec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = (e) => { this.on = false; }; }
      process(i) { const x = i[0] && i[0][0]; if (x && this.on) this.port.postMessage(x.slice(0)); return this.on; } } registerProcessor('gt-rec', GtRec);`;
    await c.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(REC));
    const res = [];
    for (const id of ['pedal.drive', 'pedal.chorus', 'pedal.delay', 'pedal.quack', 'amp.clean']) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 196; g.gain.value = 0.25; o.connect(g);
      const inst = await R.instantiate(c, id, { uid: 'live-' + id, on: false }); await inst.ready;
      const rec = new AudioWorkletNode(c, 'gt-rec'), blocks = [];
      rec.port.onmessage = (e) => blocks.push(e.data);
      g.connect(inst.input); inst.output.connect(rec); rec.connect(c.destination); o.start();
      const marks = [];
      const t0 = c.currentTime;
      await new Promise((r) => setTimeout(r, 300));
      for (let k = 0; k < 6; k++) { const at = c.currentTime + 0.05; marks.push(at - t0); inst.setOn(k % 2 === 0, at); await new Promise((r) => setTimeout(r, 260)); }
      rec.port.postMessage('stop'); o.stop(); await new Promise((r) => setTimeout(r, 60));
      inst.dispose(); g.disconnect(); rec.disconnect();
      const n = blocks.reduce((s, b) => s + b.length, 0), y = new Float32Array(n); let p = 0; for (const b of blocks) { y.set(b, p); p += b.length; }
      // the second difference: a click is a jump it can't hide; a crossfade between two tones stays within theirs
      const d2 = new Float32Array(n); for (let i = 2; i < n; i++) d2[i] = Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]);
      // steady: the windows between stomps; around a stomp: 40 ms either side of its scheduled time
      const sr = c.sampleRate, near = new Uint8Array(n);
      for (const m of marks) for (let i = Math.max(0, Math.round((m - 0.03) * sr)); i < Math.min(n, Math.round((m + 0.06) * sr)); i++) near[i] = 1;
      let steady = 0, at = 0, start = Math.round(0.1 * sr);
      for (let i = start; i < n - 256; i++) { if (near[i]) at = Math.max(at, d2[i]); else steady = Math.max(steady, d2[i]); }
      res.push({ id, ratio: at / Math.max(steady, 1e-9), steady, at, secs: n / sr });
    }
    await c.close();
    return res;
  });
  for (const l of live) t.ok(l.ratio < 1.6 && l.secs > 1, `live stomps on ${l.id} are click-free (second difference at the stomps ${l.ratio.toFixed(2)}× the steady sound's, ${l.secs.toFixed(1)} s captured)`);

  // 6b. live: built on and wired in a moment later, as a strip wires a device in after its dip, it plays through itself
  // from the first note. Chrome 155 and 156 drop a value curve that is over before its node first renders, so a
  // footswitch curve at build left every pedal and amp passing its dry signal until it was stomped off and on. Now a
  // device is built with its bypass set by .value and switches with linear ramps (kit.js glide, graph.js).
  // (Chromium 151, the one tools/pw.js finds, landed the curve: CHROMIUM=<a Chrome 155 or later> makes this one bite.)
  const late = await page.evaluate(async () => {
    const { R } = window.__gt, c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const REC = `class GtRec2 extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => { this.on = false; }; }
      process(i) { const a = i[0] && i[0][0], b = i[1] && i[1][0]; if (a && b && this.on) this.port.postMessage([a.slice(0), b.slice(0)]); return this.on; } } registerProcessor('gt-rec2', GtRec2);`;
    await c.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(REC));
    const res = [];
    for (const id of ['pedal.drive', 'amp.recto']) {
      const inst = await R.instantiate(c, id, { uid: 'late-' + id, on: true }); await inst.ready;
      await new Promise((r) => setTimeout(r, 80));
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 196; g.gain.value = 0.25; o.connect(g);
      const rec = new AudioWorkletNode(c, 'gt-rec2', { numberOfInputs: 2 }), blocks = [];
      rec.port.onmessage = (e) => blocks.push(e.data);
      g.connect(rec, 0, 0); g.connect(inst.input); inst.output.connect(rec, 0, 1); rec.connect(c.destination); o.start();
      await new Promise((r) => setTimeout(r, 400));
      rec.port.postMessage('stop'); o.stop(); await new Promise((r) => setTimeout(r, 60));
      inst.dispose(); g.disconnect(); rec.disconnect();
      // how far what comes out is from the dry signal, over the last 200 ms: off, it's the dry exactly (-inf)
      const tail = blocks.slice(-Math.round((0.2 * c.sampleRate) / 128));
      let d = 0, s = 0;
      for (const [x, y] of tail) for (let i = 0; i < x.length; i++) { d += (y[i] - x[i]) ** 2; s += x[i] ** 2; }
      res.push({ id, db: d > 0 && s > 0 ? 10 * Math.log10(d / s) : -Infinity, n: tail.length });
    }
    await c.close();
    return res;
  });
  for (const l of late) t.ok(l.db > -20 && l.n > 50, `${l.id} built on and wired in 80 ms later plays through itself from the first note, not its dry signal (${Number.isFinite(l.db) ? l.db.toFixed(1) + ' dB' : '-inf'} from the dry)`);

  // 6c. live, the lifecycle. Chrome's audio clock steps 5.8 ms (256 frames) at a time, even inside one task, and Chrome
  // 155 and 156 drop a value curve that's over before its node first renders: a footswitch that read the clock twice
  // left an amp dry plus wet, or a pedal silent, until it was stomped (docs/research/AMP-PATH.md §1). Here the clock
  // reads 11.6 ms stale every other time, every device is stomped off and on before it's wired (unrendered) and again
  // after, and each must say it's where it was asked to be.
  const life = await page.evaluate(async () => {
    const { R } = window.__gt, c = new AudioContext({ sampleRate: 48000 });
    await c.resume();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime').get;
    let reads = 0;
    Object.defineProperty(c, 'currentTime', { configurable: true, get() { const t = real.call(c); return reads++ % 2 ? t : Math.max(0, t - 0.0116); } });
    const P = AudioParam.prototype, curve = P.setValueCurveAtTime;
    let curves = 0;
    P.setValueCurveAtTime = function (...a) { curves++; return curve.apply(this, a); };
    const ids = R.listDevices().filter((d) => /^(pedal|amp)\./.test(d.id)).map((d) => d.id), bad = [], L = await import('/app/src/devices/lifecycle.js');
    const src = c.createOscillator(), g = c.createGain(), sink = c.createGain();
    src.frequency.value = 196; g.gain.value = 0.25; sink.gain.value = 0; src.connect(g); sink.connect(c.destination); src.start();
    for (let k = 0; k < ids.length; k += 16) {
      await Promise.all(ids.slice(k, k + 16).map(async (id) => {
        let inst;
        try { inst = await R.instantiate(c, id, { uid: 'life-' + id, on: true, bpm: 120 }); await inst.ready; } catch (e) { bad.push(id + ' ' + (e.code || '') + ' ' + e.message); return; }
        inst.setOn(false); inst.setOn(true); // (stomped while nothing has rendered)
        await sleep(25);
        g.connect(inst.input); inst.output.connect(sink);
        await sleep(150);
        // (a kernel amp has no health() of its own: the host's bypass is the worklet node's, and lifecycle.js healthOf
        // says it's ok unless it's a stand-in)
        const health = () => (typeof inst.health === 'function' ? inst.health() : { ...L.healthOf(inst), dry: 0, wet: 1, want: { dry: 0, wet: 1 } });
        let h = health();
        const near = (x, y) => Math.abs(x - y) <= 1e-3 * Math.max(1, Math.abs(y));
        if (!h.ok || !near(h.dry, h.want.dry) || !near(h.wet, h.want.wet)) bad.push(`${id} unwired-stomp ${JSON.stringify(h)}`);
        inst.setOn(false); await sleep(60); inst.setOn(true); // (and once it's playing)
        await sleep(150);
        h = health();
        if (!h.ok || !near(h.dry, h.want.dry) || !near(h.wet, h.want.wet)) bad.push(`${id} wired-stomp ${JSON.stringify(h)}`);
        try { g.disconnect(inst.input); } catch { /* gone */ }
        inst.dispose(); inst.dispose();
      }));
    }
    src.stop(); delete c.currentTime;
    P.setValueCurveAtTime = curve;
    // assure(): the dry gain put back to 1 under an amp that's on (what Chrome 156 left) is seen, and snapped
    const gains = [], mk = c.createGain;
    c.createGain = function () { const n = mk.call(c); gains.push(n); return n; };
    const amp = await R.instantiate(c, 'amp.recto', { uid: 'sabotage', on: true }); await amp.ready; // (a kernel amp: the host's bypass gains)
    c.createGain = mk;
    const dry = gains.find((n) => n.gain.value === 0); // (kernel/host.js: out, input, feed, wet, dry; on, only the dry is shut)
    await sleep(30);
    dry.gain.cancelScheduledValues(0); dry.gain.value = 1;
    const before = amp.health(), snapped = amp.assure(), after = amp.health(), again = amp.assure();
    amp.dispose();
    await c.close();
    return { n: ids.length, bad, curves, before, snapped, after, again };
  });
  t.ok(life.n >= 128 && !life.bad.length, `all ${life.n} pedals and amps, built live with the clock moving 11.6 ms between reads and stomped before and after they're wired, say they're where they were asked to be (health ok, dry and wet at target)${life.bad.length ? ': ' + life.bad.slice(0, 4).join(' | ') : ''}`);
  t.ok(life.curves === 0, `nothing called setValueCurveAtTime on the live context (${life.curves})`);
  t.ok(!life.before.ok && life.before.dry === 1 && life.snapped === true && life.after.ok && life.after.dry === 0 && life.again === false, `assure() sees an amp's dry gain put back to 1 (health ok ${life.before.ok}), snaps it (${life.snapped}: dry ${life.after.dry}, ok ${life.after.ok}) and has nothing to do after (${life.again})`);

  // a build that throws, through the engine; a worklet that fails once; 50 amp swaps
  const fail = await page.evaluate(async () => {
    const { R } = window.__gt;
    const { failureCode } = await import('/app/src/devices/lifecycle.js');
    const E = await import('/app/src/engine/engine.js'), S = await import('/app/src/core/store.js');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const warn = console.warn; console.warn = () => {};
    const out = {};
    try {
      R.defineDevice({ id: 'test.throws', name: 'Throws', kind: 'effect', cat: 'utility', params: [], look: {}, build() { throw new Error('a test build that throws'); } }, { replace: true });
      const c0 = new AudioContext();
      const i0 = await R.instantiate(c0, 'test.throws', { uid: 't0' });
      out.code = await i0.ready.then(() => 'resolved', (e) => failureCode(e));
      i0.dispose(); await c0.close();
      const store = S.createStore();
      let r = store.dispatch({ type: 'track.add', track: { name: 'Guitar', kind: 'audio' }, ref: 'g' }, { by: 'you' });
      const tid = r.created.g;
      r = store.dispatch({ type: 'insert.add', track: tid, insert: { device: 'test.throws' }, ref: 'fx' }, { by: 'you' });
      const fxId = r.created.fx;
      const engine = E.createEngine(store), errs = [];
      engine.on('error', (e) => errs.push(e.message));
      await engine.start(); await engine.settled();
      const inst = engine.instance(tid, fxId);
      out.standIn = !!(inst && inst.fallback);
      out.reported = errs.filter((m) => /test\.throws/.test(m) && /a test build that throws/.test(m));
      await engine.ctx.close();
      // the gate's worklet module failing once: a 'worklet' failure, then the next build loads it
      const { WORKLETS } = await import('/app/src/devices/guitar/gear/index.js');
      const c = new AudioContext(), add = c.audioWorklet.addModule.bind(c.audioWorklet);
      let failed = 0;
      c.audioWorklet.addModule = (u, o) => (String(u) === WORKLETS['clawd-gate'] && !failed++ ? Promise.reject(new Error('a blip')) : add(u, o));
      const a = await R.instantiate(c, 'pedal.gate', { uid: 'wk1' });
      out.first = await a.ready.then(() => 'resolved', (e) => failureCode(e));
      a.dispose();
      const b = await R.instantiate(c, 'pedal.gate', { uid: 'wk2' });
      out.second = await b.ready.then(() => 'resolved', (e) => failureCode(e));
      out.gateNode = !!(b.device && b.device.node);
      b.dispose();
      // 50 amp swaps: nothing an amp starts outlives it (the graph amps' wow oscillator didn't, once: docs/DEVICES.md)
      const running = new Set(), mkOsc = c.createOscillator;
      c.createOscillator = function () { const o = mkOsc.call(c), st = o.start, sp = o.stop; o.start = (...x) => { running.add(o); return st.apply(o, x); }; o.stop = (...x) => { running.delete(o); return sp.apply(o, x); }; return o; };
      const amps = R.listDevices({ cat: 'amp' }).filter((d) => d.id.startsWith('amp.')).map((d) => d.id);
      let cur = null;
      for (let k = 0; k < 50; k++) {
        const next = await R.instantiate(c, amps[k % amps.length], { uid: 'swap' + k }); await next.ready;
        if (cur) cur.dispose();
        cur = next;
      }
      out.whileOne = running.size;
      cur.dispose();
      out.after = running.size;
      await sleep(10); await c.close();
    } finally { console.warn = warn; }
    return out;
  });
  t.ok(fail.code === 'threw' && fail.standIn && fail.reported.length > 0, `a device whose build throws rejects ready with 'threw' (${fail.code}), and the engine plays its stand-in (${fail.standIn}) and says so (${fail.reported[0] || 'no error report'})`);
  t.ok(fail.first === 'worklet' && fail.second === 'resolved' && fail.gateNode, `the Snapper with its worklet failing to load once is a 'worklet' failure (${fail.first}), and the next build loads it (${fail.second}, gate ${fail.gateNode ? 'in' : 'missing'})`);
  t.ok(fail.whileOne === 0 && fail.after === 0, `50 amp swaps leave no oscillator running, while the last one plays (${fail.whileOne}) or once it's gone (${fail.after}): a kernel amp starts none`);

  t.ok(!errors.length, `no page errors in the audio checks${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await close();
}

// ---------------------------------------------------------------------------------------------------- faces
for (const width of [1440, 390]) {
  const { page, errors, close } = await open('/app/gallery.html', { width, height: 900 });
  const missing404 = [];
  page.on('response', (r) => { if (r.status() === 404) missing404.push(r.url()); });
  await page.waitForFunction(() => window.__gallery && window.__gallery.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500); // (the faces' fonts)
  const g = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.g-card')];
    const noFace = cards.filter((c) => !c.querySelector('.ewf')).map((c) => c.dataset.id);
    const kinds = {}; for (const f of document.querySelectorAll('.ewf')) kinds[f.dataset.face] = (kinds[f.dataset.face] || 0) + 1;
    const sliders = document.querySelectorAll('.ewf [role="slider"]').length, unlabeled = [...document.querySelectorAll('.ewf [role="slider"]')].filter((s) => !s.getAttribute('aria-label') || !s.getAttribute('aria-valuetext')).length;
    const badges = [...document.querySelectorAll('.ewf-by')].map((b) => b.textContent);
    return { cards: cards.length, devices: window.__gallery.devices, noFace, kinds, sliders, unlabeled, badges, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  t.ok(g.cards === g.devices && !g.noFace.length, `${width}px: gallery.html draws a face for all ${g.devices} devices (${Object.entries(g.kinds).map(([k, n]) => n + ' ' + k).join(', ')})`);
  t.ok(g.sliders > 400 && !g.unlabeled, `${width}px: ${g.sliders} controls are ARIA sliders with a label and a valuetext`);
  t.ok(g.badges.some((b) => /Claude/.test(b)) && g.badges.some((b) => /\byou\b/i.test(b)), `${width}px: agent-written devices are signed with their author's byline (${[...new Set(g.badges)].join(', ')})`);
  t.ok(g.overflow <= 0, `${width}px: no sideways scroll (${g.overflow > 0 ? g.overflow + ' px over' : 'fits'})`);
  if (width === 1440) {
    // interact: a knob by keys and double-click, a lever, the footswitch, a drag
    const k = await page.evaluate(async () => {
      const card = document.querySelector('.g-card[data-id="pedal.drive"]'), dial = card.querySelector('.kn-dial'), out = card.querySelector('.g-val');
      const v0 = +dial.getAttribute('aria-valuenow');
      dial.focus(); dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
      const v1 = +dial.getAttribute('aria-valuenow'), said = out.textContent;
      dial.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const v2 = +dial.getAttribute('aria-valuenow');
      const sw = card.querySelector('.pd-sw'), pd = card.querySelector('.pd'), on0 = pd.classList.contains('on'); sw.click(); const on1 = pd.classList.contains('on');
      const lever = document.querySelector('.g-card[data-id="pedal.clamocd"] .ms-b'), lv0 = lever.getAttribute('aria-valuetext'); lever.click(); const lv1 = lever.getAttribute('aria-valuetext');
      const pw = document.querySelector('.g-card[data-id="amp.punk"] .amp-pwr'), p0 = pw.getAttribute('aria-pressed'); pw.click(); const p1 = pw.getAttribute('aria-pressed');
      const txt = document.querySelector('.g-card[data-id="pedal.delay"] .kn-dial').getAttribute('aria-valuetext');
      return { v0, v1, v2, said, on0, on1, lv0, lv1, p0, p1, txt };
    });
    t.ok(k.v1 > k.v0 && k.v2 === k.v0 && /drive = /.test(k.said), `a knob turns with the keys (${k.v0} -> ${k.v1}, "${k.said}") and double-click puts it back (${k.v2})`);
    t.ok(k.on0 !== k.on1 && k.lv0 !== k.lv1 && k.p0 !== k.p1, `the footswitch stomps (${k.on0} -> ${k.on1}), a lever flips (${k.lv0} -> ${k.lv1}), the amp's power switches (${k.p0} -> ${k.p1})`);
    t.ok(k.txt === '1/8.', `valuetext comes from the param's fmt (the delay's TIME reads "${k.txt}")`);
    const dial = await page.$('.g-card[data-id="pedal.fuzz"] .kn-dial');
    await dial.scrollIntoViewIfNeeded();
    const box = await dial.boundingBox(), before = await dial.getAttribute('aria-valuenow');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 5 }); await page.mouse.up();
    const after = await dial.getAttribute('aria-valuenow'), said = await page.$eval('.g-card[data-id="pedal.fuzz"] .g-val', (e) => e.textContent);
    t.ok(+after > +before && !/…/.test(said), `dragging a knob up turns it up (${before} -> ${after}) and lets go with a commit ("${said}")`);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-1440.png') });
    for (const c of ['amp', 'fuzz', 'time']) { const s = await page.$(`section[data-cat="${c}"]`); await page.addStyleTag({ content: '.g-top{position:static}' }); if (s) await s.screenshot({ path: path.join(OUTDIR, `gallery-1440-${c}.png`) }); }
  } else {
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-390.png') });
    await page.evaluate(() => document.querySelector('section[data-cat="amp"]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUTDIR, 'gallery-390-amps.png') });
  }
  // (a device library that isn't there yet is a 404 the gallery skips on purpose)
  const real = errors.filter((e) => !/status of 404/.test(e) || missing404.some((u) => !/\/devices\/builtin\//.test(u)));
  t.ok(!real.length, `${width}px: no page errors${real.length ? ': ' + real.slice(0, 3).join(' | ') : ''}${missing404.length ? ' (skipped: ' + missing404.map((u) => u.replace(/^.*\/app\//, '')).join(', ') + ')' : ''}`);
  await close();
}
t.done();
