// Stuck notes: nothing may keep sounding after the transport stops (app/src/engine/engine.js, "Stop"; the watchdog in
// app/src/kernel/host.js).
//   1. Node (test/unit/stuck.test.js), the kernel host (kernel/worklet.js KernelCore, the code the AudioWorklet runs): a 'flush' drops every
//      queued note at or after its time (and keeps what came before); 'alloff' then releases with the normal release;
//      the stop-time pattern that used to stick (an off and an on for one note at the same frame) is caught by the
//      watchdog, which releases a held voice the host has no open note for (and only while the transport is stopped),
//      lets a pedal or a still-queued off keep theirs, and fades a released voice that rings past its limit. Then live
//      notes through kernel/host.js itself (on a stand-in AudioWorkletNode running the same KernelCore): a key held
//      over a quantum boundary, let go, then pressed and let go again inside the next quantum (two offs at one frame,
//      the cause of musical typing's intermittent held voice), and a fuzz of live presses and releases.
//   2. The studio, a fuzz: every instrument (the built-ins, the Guitar Studio's, the library and showcase kernels and
//      the graph fallback synth) plays a sustain-heavy pattern (long overlapping chords, a repeated pitch that overlaps
//      itself, sixteenths so the lookahead always holds note-ons); at random moments the transport stops, seeks, plays
//      from elsewhere, wraps a loop, changes tempo and auditions; after each stop, 1 s on (longer than any release in
//      the pattern), every instrument must report no held voices (engine.voices(), the debug hook), no voices at all,
//      and a silent output (measured). Then the demo songs, stopped at random moments, the same way (held voices).
//      The watchdog must not have had to step in: the cause is fixed, the watchdog is the last resort.
//   3. Live keys: musical typing lets go when the page blurs, hides, or Cmd is let go (macOS sends no keyup for keys
//      released while Cmd is down); a live note whose off arrives while the engine is still starting never sounds; a
//      live note let go inside the render quantum it was pressed in (its off stamped with its on's own time, which
//      offs-first at one frame used to put before it) is released by its off on every kernel instrument; and the
//      watchdog, live, lets go of a note-on that reached the worklet behind the host's back, on every kernel instrument.
//
//   node tools/stuck-test.js                 STUCK_TRIALS=150 for a longer fuzz (default 36), STUCK_SEED=n
import { open, tally } from './pw.js';

const t = tally('stuck');
const TRIALS = Math.max(4, +process.env.STUCK_TRIALS || 36);
const SEED = +process.env.STUCK_SEED || 20261001;

/* ------------------------------------------------------------------ 2. the studio */
const { page, errors, close } = await open('/app/');
// (a sampled kit that isn't on this checkout, app/kits/ being gitignored, is a 404 the studio expects and plays nothing
// for; only those are left out of "no page errors" below, and only while a kit is missing)
const kit404 = [];
page.on('response', (r) => { if (r.status() === 404 && /\/kits\/[0-9a-f]{64}\.odk$/.test(new URL(r.url()).pathname)) kit404.push(r.url()); });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });

// 3a. a live note let go while the engine is still starting never sounds (and is not held)
const race = await page.evaluate(async () => {
  const { engine, store } = window.overdub;
  const tr = store.get().tracks.find((x) => x.kind !== 'audio' && x.instrument && x.instrument.device !== 'core.drums');
  if (!tr || engine.ctx) return { skip: !tr ? 'no instrument track' : 'the engine had started already' };
  engine.liveNoteOn(tr.id, 61, 0.8);
  engine.liveNoteOff(tr.id, 61);
  await engine.start(); await engine.settled();
  await new Promise((r) => setTimeout(r, 400));
  const v = engine.voices ? await engine.voices() : null;
  const inst = engine.instance(tr.id), st = inst && inst.stats ? await inst.stats() : null;
  return { held: v ? v[tr.id].held : st ? st.voices : -1, device: tr.instrument.device };
});
if (race.skip) t.note('(the start race was not checked: ' + race.skip + ')');
else t.ok(race.held === 0, `a key tapped and let go before the audio engine was up does not stick (${race.device}: ${race.held} held voices once it is)`);

await page.evaluate(() => {
  const { engine } = window.overdub;
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const taps = new WeakMap();
  // what each instrument holds and sounds: the debug hook when there is one, else its stats and an analyser on its output
  window.__probe = async (ids) => {
    const v = engine.voices ? await engine.voices() : null;
    const out = {};
    for (const id of ids) {
      const inst = engine.instance(id);
      if (!inst) { out[id] = { voices: 0, held: 0, peak: -180, none: true }; continue; }
      let r = v && v[id];
      if (!r) {
        const st = inst.stats ? await inst.stats() : null;
        let a = taps.get(inst);
        if (!a) { a = engine.ctx.createAnalyser(); a.fftSize = 2048; inst.output.connect(a); taps.set(inst, a); }
        const b = new Float32Array(2048); a.getFloatTimeDomainData(b);
        let pk = 0; for (const x of b) pk = Math.max(pk, Math.abs(x));
        r = { voices: st ? st.voices : null, held: st ? (st.held != null ? st.held : null) : null, peak: pk > 1e-9 ? 20 * Math.log10(pk) : -180, stuck: 0 };
      }
      out[id] = r;
    }
    return out;
  };
});

// a sustain-heavy pattern for every instrument, release params at most 0.25 s, so 1 s after a stop is past any release
const setup = await page.evaluate(async () => {
  const { store, engine, devices } = window.overdub;
  const defs = devices.listDevices({ kind: 'instrument' }).filter((d) => !/^engine\./.test(d.id));
  const notes = [];
  let n = 0;
  for (let b = 0; b < 32; b += 8) for (const p of [48, 55, 60]) notes.push({ id: 'h' + n++, p, t: b, d: 9, v: 0.8 });        // long chords over the bar lines
  for (let b = 0; b < 32; b++) notes.push({ id: 'r' + n++, p: 64, t: b, d: 1.5, v: 0.7 });                                   // one pitch that overlaps itself
  for (let b = 0; b < 32; b += 0.25) notes.push({ id: 's' + n++, p: 69 + (Math.round(b * 4) % 7), t: b, d: 0.2, v: 0.6 });   // sixteenths
  const track = (id, device, params) => ({ id, name: id, kind: 'instrument', instrument: { device, params }, inserts: [], gain: -12, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c' + id, kind: 'notes', start: 0, length: 32, notes }] });
  const tracks = defs.map((d, i) => {
    const params = {};
    for (const p of d.params || []) if (p.role === 'release' && p.max > 0.25) params[p.key] = Math.max(p.min, Math.min(0.25, p.def));
    return track('t_s' + String(i).padStart(3, '0'), d.id, params);
  });
  tracks.push(track('t_sfall', 'nobody.not-here', {})); // a device that isn't there: the graph fallback synth plays
  store.load({ format: 'overdub/0', id: 'p_stuck1', title: 'Stuck', tempo: 132, meter: [4, 4], key: null, loop: { on: false, start: 0, end: 32 },
    tracks, sections: [], devices: {}, assets: {}, master: { gain: -12, inserts: [] }, meta: {} }, { by: 'overdub' });
  window.__every = JSON.parse(JSON.stringify(store.get()));   // (every instrument again, for the live checks at the end)
  await engine.start(); await engine.settled();
  const kinds = {};
  for (const tr of tracks) { const i = engine.instance(tr.id); kinds[tr.id] = { device: tr.instrument.device, kernel: !!(i && i.node), fallback: !!(i && i.fallback) }; }
  await window.__probe(tracks.map((x) => x.id)); // (taps on every output from the start, when there's no hook)
  return { ids: tracks.map((x) => x.id), kinds, hook: typeof engine.voices === 'function' };
});
const kernels = Object.values(setup.kinds).filter((k) => k.kernel).length, graphs = Object.values(setup.kinds).filter((k) => !k.kernel).length;
t.ok(setup.ids.length >= 15 && kernels >= 14 && graphs >= 1, `the fuzz plays ${setup.ids.length} instruments at once (${kernels} kernels, ${graphs} graph: the fallback synth)`);
t.ok(setup.hook, 'engine.voices() reads every instrument\'s voices (held and sounding), its output peak and what the watchdog caught');

async function fuzz({ ids, trials, seed, settle = 1000, demo = false, long = 0 }) {
  return page.evaluate(async ({ ids, trials, seed, settle, demo, long }) => {
    const { store, engine } = window.overdub;
    const rnd = window.__rng(seed), pick = (a) => a[Math.floor(rnd() * a.length)];
    const end = engine.songEnd(), base = store.get().tempo;
    const res = { stops: 0, longs: 0, actions: {}, stuck: {}, ringing: {}, worst: {}, wd: 0 };
    const act = (k) => { res.actions[k] = (res.actions[k] || 0) + 1; };
    for (let i = 0; i < trials; i++) {
      await engine.play(Math.floor(rnd() * end * 4) / 4);
      act('play');
      const k = Math.floor(rnd() * 4);
      for (let j = 0; j < k; j++) {
        await window.__sleep(30 + rnd() * 600);
        const a = pick(['seek', 'seek', 'tempo', 'loop', 'replay', 'audition', 'stopplay']);
        act(a);
        if (a === 'seek') engine.seek(Math.floor(rnd() * end * 8) / 8);
        else if (a === 'tempo') store.dispatch({ type: 'project.set', patch: { tempo: Math.round(base * (0.6 + rnd() * 0.9)) } }, { by: 'you' });
        else if (a === 'loop') { const b = Math.max(0, engine.beat); store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: Math.max(0, Math.floor(b) - 2), end: Math.floor(b * 4 + 1 + rnd() * 3) / 4 + 0.25 } } }, { by: 'you' }); }
        else if (a === 'replay') await engine.play(Math.floor(rnd() * end * 4) / 4);
        else if (a === 'audition') engine.audition(pick(ids), 50 + Math.floor(rnd() * 30), 0.8, 0.25 + rnd() * 2);
        else if (a === 'stopplay') { engine.stop(); await window.__sleep(rnd() * 120); await engine.play(); }
      }
      await window.__sleep(20 + rnd() * 900);
      engine.stop();
      res.stops++;
      await window.__sleep(settle);
      let pr = await window.__probe(ids);
      for (const id of ids) {
        const r = pr[id];
        const held = r.held != null ? r.held : r.voices;
        if (held > 0) res.stuck[id] = (res.stuck[id] || 0) + 1;
      }
      // every few stops, wait out every instrument's own tail (a kernel's body or room, a cymbal) and measure silence
      if (long && i % 6 === 5) {
        res.longs++;
        await window.__sleep(long - settle);
        pr = await window.__probe(ids);
        for (const id of ids) {
          const r = pr[id];
          if (r.voices > 0 || r.peak > -90) { res.ringing[id] = (res.ringing[id] || 0) + 1; res.worst[id] = Math.max(res.worst[id] == null ? -180 : res.worst[id], r.peak); }
        }
      }
      // the next trial starts from a quiet studio either way (and from the song's own tempo and loop)
      // (the killswitch renews every instance, and with them their watchdog counts: count those first)
      if (ids.some((id) => (pr[id].held || 0) > 0)) { for (const id of ids) res.wd += +pr[id].stuck || 0; await engine.silence(); }
      store.dispatch({ type: 'project.set', patch: { tempo: base, loop: { on: false, start: 0, end: 16 } } }, { by: 'you' });
    }
    const last = await window.__probe(ids);
    for (const id of ids) res.wd += +last[id].stuck || 0;   // (each instrument's count of watchdog catches, all along)
    return res;
  }, { ids, trials, seed, settle, demo, long });
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const r1 = await fuzz({ ids: setup.ids, trials: TRIALS, seed: SEED, long: 5000 });
const moments = r1.stops * setup.ids.length;
const actions = Object.entries(r1.actions).map(([k, v]) => `${v} ${k}`).join(', ');
const name = (id) => setup.kinds[id] ? setup.kinds[id].device : id;
const list = (o) => Object.entries(o).map(([id, n]) => `${name(id)} x${n}`).join(', ');
t.note(`pattern fuzz: ${r1.stops} stops x ${setup.ids.length} instruments = ${moments} instrument-stops, after ${actions}`);
t.ok(sum(r1.stuck) === 0, `no instrument holds a voice 1 s after any stop (${sum(r1.stuck)} stuck in ${moments}${sum(r1.stuck) ? ': ' + list(r1.stuck) : ''})`);
t.ok(r1.longs >= 2 && sum(r1.ringing) === 0, `and every instrument is silent once its own tail is over: no voices, output under -90 dBFS, measured 5 s after ${r1.longs} of the stops (${sum(r1.ringing)} still sounding${sum(r1.ringing) ? ': ' + Object.entries(r1.worst).map(([id, db]) => `${name(id)} ${db.toFixed(0)} dBFS`).join(', ') : ''})`);
t.ok(r1.wd === 0, `the watchdog never had to step in: the stops themselves let every note go (${r1.wd} voices caught)`);

// the demo songs, stopped at random moments
const demoIds = await page.evaluate(async () => { const m = await import('/app/src/core/demos/index.js'); return m.MORE_DEMOS.map((d) => d.id); }).catch(() => []);
let dStops = 0, dStuck = 0, dWd = 0, dMoments = 0;
const dBad = [];
for (const [i, id] of demoIds.entries()) {
  const ids = await page.evaluate(async (id) => {
    const { store, engine } = window.overdub;
    const m = await import('/app/src/core/demos/index.js');
    const d = m.MORE_DEMOS.find((x) => x.id === id);
    store.load(d.make(), { by: 'overdub' });
    await engine.settled();
    return store.get().tracks.filter((x) => x.kind !== 'audio' && x.instrument).map((x) => x.id);
  }, id);
  const r = await fuzz({ ids, trials: Math.max(2, Math.round(TRIALS / 8)), seed: SEED + i + 1, settle: 600, demo: true });
  dStops += r.stops; dMoments += r.stops * ids.length; dStuck += sum(r.stuck); dWd += r.wd;
  if (sum(r.stuck)) dBad.push(`${id}: ${Object.keys(r.stuck).join(', ')}`);
}
t.ok(demoIds.length >= 3 && dStuck === 0 && dWd === 0, `the ${demoIds.length} demo songs: ${dStops} stops (${dMoments} instrument-stops), ${dStuck} held voices 0.6 s after a stop, ${dWd} caught by the watchdog${dBad.length ? ' (' + dBad.join('; ') + ')' : ''}`);

/* ------------------------------------------------------------------ 3. live keys */
const keys = await page.evaluate(async () => {
  const { engine, input, store } = window.overdub;
  const q = input && input.qwerty;
  if (!q) return { skip: 'no musical typing' };
  // (the track musical typing plays: input.target(), the armed or selected one)
  const tr = (input.target && input.target()) || store.get().tracks.find((x) => x.kind !== 'audio' && x.instrument);
  // from a quiet studio: the demo fuzz fires auditions without waiting for them (each waits for the engine to settle,
  // then holds its note for up to a few beats), so one can still be sounding here, under load
  await engine.silence();
  await engine.settled();
  const heldIn = (v) => Object.entries(v || {}).filter(([, r]) => r.held).map(([id, r]) => `${r.device}${id === tr.id ? ' (the target)' : ''} x${r.held}`).join(', ');
  const v0 = engine.voices ? await engine.voices() : null;
  // (what the target's instrument was handed, in frames, for the message if a voice is held)
  const inst = engine.instance(tr.id), sent = [], fr = (x) => Math.round(x * engine.ctx.sampleRate);
  const on0 = inst && inst.noteOn, off0 = inst && inst.noteOff;
  if (inst) {
    inst.noteOn = (p, v, time, x) => { sent.push(`+${p}@${fr(time)}`); return on0(p, v, time, x); };
    inst.noteOff = (p, time) => { sent.push(`-${p}@${fr(time)}`); return off0(p, time); };
  }
  q.toggle(true);
  const press = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ...opts }));
  const up = (code, opts = {}) => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, ...opts }));
  const held = () => q.held().length;
  const out = {};
  // A goes down in one render quantum and the rest happens inside the next: A let go (the blur), pressed and let go
  // again (Cmd) at one frame, which used to leave the second A held (its off came before its on), now and then, when a
  // busy page let the quantum turn between two keys. Here it always turns.
  press('KeyA');
  for (const t0 = engine.ctx.currentTime, w0 = performance.now(); engine.ctx.currentTime === t0 && performance.now() - w0 < 1000;) await new Promise((r) => setTimeout(r, 1));
  press('KeyD');
  out.down = held();
  window.dispatchEvent(new Event('blur'));
  out.blur = held();
  press('KeyA');
  press('MetaLeft', { key: 'Meta', metaKey: true });
  up('MetaLeft', { key: 'Meta' });    // (macOS: no keyup for A comes while Cmd was down)
  out.meta = held();
  press('KeyS');
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
  out.hidden = held();
  q.toggle(false);
  await new Promise((r) => setTimeout(r, 500));
  const v = engine.voices ? await engine.voices() : null;
  out.voices = v ? Object.values(v).reduce((a, r) => a + (r.held || 0), 0) : -1;
  out.who = heldIn(v);
  out.before = heldIn(v0);   // (what was held before a key went down: not the keys' doing)
  out.device = tr.instrument ? tr.instrument.device : '?';
  if (inst) { inst.noteOn = on0; inst.noteOff = off0; }
  if (out.voices && inst) {
    const st = await inst.stats();
    out.sent = sent.join(' ');
    out.left = st && st.list ? st.list.filter((x) => x.held).map((x) => `${x.p} (on at ${x.on})`).join(', ') : '';
  }
  return out;
});
if (keys.skip) t.note('(live keys not checked: ' + keys.skip + ')');
else {
  t.ok(keys.down === 2 && keys.blur === 0, `musical typing lets every key go when the window loses focus (${keys.down} held, ${keys.blur} after blur)`);
  t.ok(keys.meta === 0, `... when Cmd is let go (macOS sends no keyup for a key released while Cmd is down): ${keys.meta} held`);
  t.ok(keys.hidden === 0, `... and when the page is hidden (${keys.hidden} held)`);
  t.ok(keys.voices === 0, `and nothing holds a voice afterwards: keys pressed and let go inside one render quantum (offs stamped with their ons' own time), one of them twice, after it was held over from the quantum before (${keys.device} played them; ${keys.voices} held voices in the song${keys.who ? ': ' + keys.who : ''}${keys.before ? '; before typing: ' + keys.before : ''}${keys.sent ? '; the target was handed ' + keys.sent + ' and holds ' + (keys.left || '?') : ''})`);
}

// The last live checks run on every kernel instrument at once (the fuzz's song again), stopped.
const every = await page.evaluate(async () => {
  const { engine, store } = window.overdub;
  store.load(JSON.parse(JSON.stringify(window.__every)), { by: 'overdub' });
  await engine.start(); await engine.settled();
  const ids = store.get().tracks.filter((x) => engine.instance(x.id) && engine.instance(x.id).node).map((x) => x.id);
  const dev = Object.fromEntries(store.get().tracks.map((x) => [x.id, x.instrument.device]));
  await new Promise((r) => setTimeout(r, 300));
  return { ids, dev };
});
const devOf = (id) => every.dev[id] || id;

// a live note pressed and let go inside one render quantum (a fast tap, a blur or Cmd right after a key, a pad sending
// its on and off together): both are stamped with the same currentTime, and the off must still land after its on
const tap = await page.evaluate(async (ids) => {
  const { engine } = window.overdub;
  const s0 = await engine.voices();
  for (const id of ids) { engine.liveNoteOn(id, 60, 0.8); engine.liveNoteOff(id, 60); engine.liveNoteOn(id, 64, 0.8); engine.liveNoteOn(id, 64, 0.8); engine.liveNoteOff(id, 64); }
  await new Promise((r) => setTimeout(r, 700));
  const v = await engine.voices();
  const held = {}, caught = {};
  for (const id of ids) { if (v[id].held) held[id] = v[id].held; const d = (v[id].stuck || 0) - (s0[id].stuck || 0); if (d) caught[id] = d; }
  return { held, caught };
}, every.ids);
const tapBad = [...new Set([...Object.keys(tap.held), ...Object.keys(tap.caught)])];
t.ok(!tapBad.length, `a live note let go in the same render quantum it was pressed (its off at its on's own time) is released on every one of the ${every.ids.length} kernel instruments, by the note-off and not the watchdog (${tapBad.length ? tapBad.map((id) => `${devOf(id)}: ${tap.held[id] || 0} held, ${tap.caught[id] || 0} caught`).join('; ') : '0 held, 0 caught'})`);

// the watchdog, live: a note-on that reaches the worklet behind the host's back (as a lost off would leave it) is let go,
// on every kernel instrument (the kit's voices are one-shots that end by themselves: it gets the crash, 3.4 s, which is
// still ringing when the watchdog looks; Studio A's strokes ring in its shared mics, not in a voice, so it gets the
// snare roll, 33, the one stroke that holds its voice for as long as the note is held)
// (Virtuosity Kit, sampled, gets its crash too, once its samples are in: a kit that isn't here plays nothing, so it has
// no voice to hold and is left out, as tools/drumkit-test.js says; Rusty Brushes gets its stir, 73, and Hand Crate its
// tambourine roll, 33, and Sandbag its riser, 34: each rings for as long as its note is held; Rusty Sticks gets its crash, as Virtuosity Kit does)
const wdPitch = (id) => (every.dev[id] === 'core.drums' || every.dev[id] === 'core.drumkit' || every.dev[id] === 'core.metalkit' ? 49 : every.dev[id] === 'core.drumroom' ? 33 : every.dev[id] === 'core.brushkit' ? 73 : every.dev[id] === 'core.handkit' ? 33 : every.dev[id] === 'core.clubkit' ? 34 : 77);
const noData = await page.evaluate(async (ids) => {
  const { engine } = window.overdub;
  const t0 = performance.now();
  const state = (id) => { const d = engine.instance(id).data; return d ? d.state : 'none'; };
  while (ids.some((id) => state(id) === 'loading') && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
  return ids.filter((id) => state(id) !== 'none' && state(id) !== 'ready');
}, every.ids);
for (const id of noData) t.note(`${devOf(id)}: its samples aren't here, so the watchdog has no voice to catch on it (left out)`);
const wd = await page.evaluate(async ({ ids, pitch }) => {
  const { engine } = window.overdub;
  const s0 = await engine.voices();
  const res = {}, offs = [];
  const t0 = performance.now();
  for (const id of ids) {
    const inst = engine.instance(id), r = (res[id] = { seen: [], at: null });
    offs.push(inst.on('stuck', (d) => { r.seen.push(`${d.why}:${d.p}`); if (r.at == null) r.at = performance.now() - t0; }));
    inst.node.port.postMessage({ type: 'on', p: pitch[id], v: 0.7, time: engine.ctx.currentTime });
  }
  await new Promise((r) => setTimeout(r, 900));
  const v = await engine.voices();
  for (const off of offs) off();
  for (const id of ids) { res[id].after = v[id].held; res[id].stuck = (v[id].stuck || 0) - (s0[id].stuck || 0); }
  return res;
}, { ids: every.ids.filter((id) => !noData.includes(id)), pitch: Object.fromEntries(every.ids.map((id) => [id, wdPitch(id)])) });
const wdBad = every.ids.filter((id) => !noData.includes(id)).filter((id) => { const r = wd[id]; return !(r.after === 0 && r.seen.join() === 'held:' + wdPitch(id) && r.stuck >= 1 && r.at != null && r.at < 600); });
const wdSlow = Math.max(0, ...every.ids.filter((id) => wd[id]).map((id) => wd[id].at || 0));
t.ok(every.ids.length >= 14 && !wdBad.length, `live, the watchdog lets go of a held voice nobody holds open while stopped, on all ${every.ids.length - noData.length} kernel instruments${noData.length ? ` with their samples here (${noData.length} left out)` : ''} (the slowest caught ${Math.round(wdSlow)} ms after it started${wdBad.length ? '; ' + wdBad.map((id) => `${devOf(id)}: caught ${wd[id].at == null ? 'never' : Math.round(wd[id].at) + ' ms'}, reported ${wd[id].seen.join(', ') || 'nothing'}, ${wd[id].after} held after a second`).join('; ') : ''})`);

{
  // as many 404 lines as missing kit files, no more, and only when the kit was missing (noData above)
  let left = noData.length ? kit404.length : 0;
  const real = errors.filter((e) => !(left > 0 && /status of 404/.test(e) && left--));
  t.ok(!real.length, 'no page errors' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : '') + (errors.length > real.length ? ` (${errors.length - real.length} 404 for a sampled kit not on this checkout left out)` : ''));
}
await close();
t.done();
