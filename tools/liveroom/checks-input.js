// The live room's checks: the input and the deck [stream A] (docs/research/LIVE-ROOM-MODE.md §11.5). Run by
// tools/liveroom-test.js (ONLY=input), whose header says what a checks module exports.
//   1. Node: the channel that moves (audioin pickChannel); the level's four verdicts on fakes peaking at −31, −11, −2
//      and 0 dBFS; the tunings a low string can be, in the order the room asks (a stand-in fretboard with stream B's
//      ids, so the two-way questions are checked whether or not they've landed); the lean line; the count's sticks
//      (seeded, measured against the click)
//   2. The soundcheck (muted Chromium): a stereo fake, silence on input 1 and a guitar on input 2, into the lamps:
//      input 2 picked; Quiet, Loud and clear, Hot and That clipped as the fake gets louder; the open low strings E2, D2,
//      C2, B1 named or asked about (as the fretboard's tunings have them, the Tune lamp pressed before C2 and B1); the
//      D2 after E2 has been named, with no press, names nothing; six notes of a C2 20 cents flat say so, and
//      not before the sixth
//   3. The count (muted Chromium, the speakers' feed captured): four sticks at 132, eight at 160, the basement's two
//      bars with its hits, each on its beat within a render quantum (128 samples), the silent ones silent, `at` kept
//   4. The takes (muted Chromium, a stereo fake: a voice on input 1, a guitar on input 2, the deck's latency 0): the
//      stop at beat 0.5 of bar 9 makes 8 bars and at beat 2 a 9-bar part, each keeping a bar of ring, one step by you
//      with an asset.add saying rate, channels and length; Esc keeps the pass in Capture with nothing in History, and
//      ⇧R (deck.keepAfterAll) puts it in at its bars; a stop pressed and then starved of frames and hidden still ends
//      on its line; two inputs make two takes on two tracks, lined up to the sample, in one step by you.
// The keys are the stage's (stream C): these drive the deck as the keys do, a key event's time being the beat (stop's
// rule reads it from the event, as Space will).
import { pickChannel } from '../../app/src/input/audioin.js';
import { levelVerdict, tuningsFor, tuningName, leanLine } from '../../app/src/ui/liveroom/lamps.js';
import { LINES } from '../../app/src/core/liveroom/lines/soundcheck.js';
import { sticksSamples, clickSamples, STICKS, CLICK } from '../../app/src/engine/click.js';
import { SR, riffDI, mix, session } from './fake.js';
import { openRoom } from './harness.js';

export const name = 'input';
export const pages = true;

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const peakOf = (b) => { let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const IGNORE = (e) => /favicon|net::ERR|Failed to load resource|AudioContext was not allowed/i.test(e);

export async function run(T, ctx) {
  // (PART=soundcheck or PART=deck: one page only, while working on it)
  const part = process.env.PART || '';
  node(T);
  if (!ctx.pages) return;
  if (!part || part === 'soundcheck') await soundcheck(T, ctx);
  if (!part || part === 'deck') await deckPage(T, ctx);
}

/* ------------------------------------------------------------------ 1. Node */
const CHORD = { bpm: 120, beats: 4, chord: true, notes: [[0, 57, 1], [1, 57, 1], [2, 57, 1], [3, 57, 1]] };
const LEVELS = [[-31, 'quiet', 'Quiet'], [-11, 'ok', 'Loud and clear'], [-2, 'hot', 'Hot'], [0, 'clip', 'That clipped']];

function node(T) {
  // the channel that moves
  const pc = [[[-200, -14], 2], [[-14, -80], 1], [[-20, -27], null], [[-60, -75], null], [[-80, -12, -40], 2], [[-80, -12, -20], null], [[-80, -12, -70, -90], 2], [[-14], 1]];
  const got = pc.map(([l]) => pickChannel(l));
  T.ok(pc.every(([, w], i) => got[i] === w), `pickChannel: the channel 12 dB over every other and over −50 dBFS, else none (${got.join(' ')})`);

  // the level's verdicts on the fakes the page plays
  const v = LEVELS.map(([pk]) => levelVerdict(db(peakOf(riffDI(CHORD, { passes: 1, peak: pk, tail: 0 }).buf))));
  T.ok(v.join() === LEVELS.map((x) => x[1]).join(), `level: fakes peaking at −31, −11, −2 and 0 dBFS are ${v.join(', ')}; under −50 is nothing (${levelVerdict(-60)})`);
  const words = LEVELS.map(([pk, k]) => LINES[`level.${k}`].text({ db: pk, input: 2 }));
  T.ok(words.every((w, i) => w.startsWith(LEVELS[i][2])) && words[0].includes('−31 dB') && !words.join(' ').includes('!'), `and say so: ${words.map((w) => `“${w}”`).join(' ')}`);

  // the tunings a low string can be, with stream B's ids on a stand-in fretboard
  const S = (low, iv) => { const s = [low]; for (const d of iv) s.push(s[s.length - 1] + d); return s; };
  const STD = [5, 5, 5, 4, 5], DROP = [7, 5, 5, 4, 5];
  const FB = {
    standard: { name: 'Standard', strings: S(40, STD) }, 'drop-d': { name: 'Drop D', strings: S(38, DROP) }, 'half-down': { name: 'Half step down', strings: S(39, STD) },
    'd-standard': { name: 'D standard', strings: S(38, STD) }, 'drop-c': { name: 'Drop C', strings: S(36, DROP) }, 'c-standard': { name: 'C standard', strings: S(36, STD) },
    'b-standard': { name: 'B standard', strings: S(35, STD) }, 'drop-b': { name: 'Drop B', strings: S(35, DROP) }, dadgad: { name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] }, 'open-g': { name: 'Open G', strings: [38, 43, 50, 55, 59, 62] },
  };
  const asks = [40, 38, 36, 35].map((m) => tuningsFor(m, FB).map((x) => x.name).join(' | '));
  T.ok(asks.join(' / ') === 'E standard / drop D | D standard / drop C | C standard / B standard | drop B', `the low string names the tuning: E2 ${asks[0]}; D2 ${asks[1]}; C2 ${asks[2]}; B1 ${asks[3]} (drop first from C up, standard first under it; DADGAD and open G aren't asked)`);
  const which = LINES['tune.which'].text({ note: 'C', a: 'drop C', b: 'C standard' }), ok = LINES['tune.ok'].text({ name: tuningName({ id: 'standard', name: 'Standard', strings: S(40, STD) }) });
  T.ok(which === 'Low string C: drop C or C standard?' && ok === 'In tune: E standard.', `the lines: “${ok}” “${which}”`);
  const here = [40, 38, 36, 35].map((m) => tuningsFor(m).map((x) => x.id).join('|') || '-');
  T.note(`the fretboard's own tunings here: E2 ${here[0]}, D2 ${here[1]}, C2 ${here[2]}, B1 ${here[3]}`);
  const off = LINES['tune.off'].text({ cents: 20, flat: true });
  T.ok(/about 20 cents flat/.test(off), `a guitar off the band's tuning: “${off}”`);

  // the lean line (§8): both of the last two takes the same way, over 12 ms, within 6 ms of each other, and no line-up yet
  const L = [leanLine({ leans: [18, 21] }), leanLine({ leans: [18, 21], measured: true }), leanLine({ leans: [18, -21] }), leanLine({ leans: [10, 14] }), leanLine({ leans: [14, 24] }), leanLine({ leans: [-16, -19] })];
  T.ok(L[0]?.id === 'line.lean' && L[0].vars.ms === 20 && L[0].vars.late === true && !L[1] && !L[2] && !L[3] && !L[4] && L[5]?.vars.late === false, `the lean: 18 and 21 ms late says “${LINES['line.lean'].text(L[0]?.vars || {})}”; measured, split, small or far apart says nothing; −16 and −19 is ahead`);

  // the count's sticks: seeded (two makes are the same), peaks as asked, brighter than the click
  const a = sticksSamples(SR, false), b = sticksSamples(SR, false), acc = sticksSamples(SR, true);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  const hi = (x) => { let y1 = 0, x1 = 0, p = 0; const c = Math.exp((-2 * Math.PI * 4000) / SR); for (let i = 0; i < x.length; i++) { const y = c * (y1 + x[i] - x1); x1 = x[i]; y1 = y; p = Math.max(p, Math.abs(y)); } return p; };
  const pk = [db(peakOf(a)), db(peakOf(acc))], br = [db(hi(a)) - db(hi(clickSamples(SR, false))), db(hi(acc)) - db(hi(clickSamples(SR, true)))];
  T.ok(same && Math.abs(pk[0] - db(STICKS.beat)) < 0.05 && Math.abs(pk[1] - db(STICKS.bar)) < 0.05 && br[0] > 0 && br[1] > 0 && a.length <= Math.ceil((STICKS.ms / 1000) * SR) + 1,
    `sticks: the same samples every time (${same}), the beat peaking at ${fmt(pk[0], 2)} dBFS and the bar at ${fmt(pk[1], 2)} (asked ${fmt(db(STICKS.beat), 2)} and ${fmt(db(STICKS.bar), 2)}), ${fmt(br[0])} and ${fmt(br[1])} dB more over 4 kHz than the click (${CLICK.f} Hz) so they cut through a kit, ${a.length} samples`);
}

/* ------------------------------------------------------------------ 2. the soundcheck */
const OPENS = [[40, 18], [38, 21.5], [36, 25], [35, 28.5]];
const FLAT0 = 33, FLATN = 6, REDO_AT = 31.8;

function soundcheckFake() {
  const parts = LEVELS.map(([pk], k) => ({ buf: riffDI(CHORD, { passes: 2, peak: pk, tail: 0, seed: 20 + k, jitter: 0 }).buf, at: 1 + 4 * k }));
  for (const [m, at] of OPENS) parts.push({ buf: riffDI({ bpm: 60, beats: 3, notes: [[0, m, 2.4]] }, { passes: 1, peak: -12, tail: 0, seed: m, jitter: 0, solid: true }).buf, at });
  for (let i = 0; i < FLATN; i++) parts.push({ buf: riffDI({ bpm: 60, beats: 2, notes: [[0, 35.8, 1.5]] }, { passes: 1, peak: -12, tail: 0, seed: 70 + i, jitter: 0, solid: true }).buf, at: FLAT0 + 2 * i });
  const g = mix(parts, { length: Math.round(48 * SR) });
  return { wav: { sr: SR, channels: [new Float32Array(g.length), g] } };
}

async function soundcheck(T, ctx) {
  const room = await openRoom('/app/?room', { fake: soundcheckFake(), name: 'input-soundcheck' });
  const { page, errors, E } = room;
  try {
    // the lamps, mounted with a ctx that writes down what they say and when (seconds into the fake)
    await E(async () => {
      const app = window.overdub;
      const { mountLamps, lampsState } = await import('/app/src/ui/liveroom/soundcheck.js');
      const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
      const deck = createDeck(app);
      const said = [];
      const fileT = () => { const st = app.input.audio.state, c = app.input.audio.ctx || app.engine.ctx; return st.firstFrame == null || !c ? null : c.currentTime - st.firstFrame / st.sr; };
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2000;max-width:90vw';
      document.body.append(el);
      const lamps = mountLamps(el, { app, ui: app.ui, store: app.store, deck, view: () => ({ place: null }), say: (id, vars) => said.push({ id, vars, t: fileT() }), prefs: null, scene: null });
      let on = true;
      const loop = (now) => { if (!on) return; try { lamps.frame(now); } catch (e) { console.error(e); } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      window.__sc = { said, lampsState, fileT, stop: () => { on = false; lamps.unmount(); }, deck };
    });
    // the input opens by itself (the browser allows it): wait for the fake to start
    await page.waitForFunction(() => window.overdub.input.audio.state.open && window.overdub.input.audio.state.firstFrame != null, null, { timeout: 15000 });
    const ch = await E(() => window.overdub.input.audio.state.channels);
    // the Tune lamp pressed before C2 and B1 (a guitar retuned) and before the flat notes, not before D2: once the lamp
    // has named a tuning, a low note is a note (a riff's D on the low string isn't drop D) until it's pressed again
    for (const at of [...OPENS.slice(2).map(([, t]) => t - 0.6), REDO_AT]) {
      await page.waitForFunction((t) => (window.__sc.fileT() ?? 0) > t, at, { timeout: 60000 });
      await E(() => document.querySelector('.lr-lamp[data-lamp="tune"]').click());
    }
    const flatEnd = FLAT0 + 2 * (FLATN - 1) + 1.5;
    await page.waitForFunction((t) => (window.__sc.fileT() ?? 0) > t, flatEnd + 1, { timeout: 30000 });
    const r = await E(() => ({ said: window.__sc.said, lamps: window.__sc.lampsState(), st: { channel: window.overdub.input.audio.state.channel, channels: window.overdub.input.audio.state.channels, label: window.overdub.input.audio.state.label } }));
    await room.shot('liveroom-input-lamps');
    await E(() => window.__sc.stop());
    const said = r.said, line = (id) => said.find((x) => x.id === id);
    T.note(`the lamps said: ${said.map((x) => `${x.id}@${fmt(x.t)}`).join(' ')}`);

    // input 2
    if (ch >= 2) T.ok(r.st.channel === '2' && r.lamps.plug?.lit && r.lamps.plug.input === 2 && line('plug.ok')?.vars.input === 2, `plugged in: a stereo fake with silence on 1 and a guitar on 2 picks input 2 (channel ${r.st.channel} of ${r.st.channels}; “${r.lamps.plug?.text}”)`);
    else T.note(`the fake capture came in mono (${ch} channel): the channel pick is checked in Node only`);

    // the level, as the fake gets louder
    const lv = LEVELS.map(([, k], i) => { const x = said.find((s) => s.id === `level.${k}`); return { k, t: x?.t, okT: x && x.t > 1 + 4 * i && x.t < 1 + 4 * (i + 1) + 0.6 }; });
    T.ok(lv.every((x) => x.okT), `level: the fake at −31, −11, −2 and 0 dBFS says ${lv.map((x) => `${x.k}@${fmt(x.t)}`).join(', ')}, each in its 4 s (“${LINES['level.quiet'].text(line('level.quiet')?.vars || {})}” … “${LINES['level.clip'].text(line('level.clip')?.vars || {})}”)`);

    // the open low strings
    const tune = OPENS.map(([m, at], i) => {
      const c = i === 1 ? [] : tuningsFor(m), x = said.find((s) => (s.id === 'tune.ok' || s.id === 'tune.which') && s.t > at - 0.2 && s.t < at + 3);
      const want = c.length >= 2 ? `tune.which:${c[0].name} or ${c[1].name}` : c.length === 1 ? `tune.ok:${c[0].name}` : 'none';
      const have = x ? (x.id === 'tune.which' ? `tune.which:${x.vars.a} or ${x.vars.b}` : `tune.ok:${x.vars.name}`) : 'none';
      return { m, want, have };
    });
    T.ok(tune[0].have === 'tune.ok:E standard', `tune: the open E2 says “${LINES['tune.ok'].text({ name: 'E standard' })}” (${tune[0].have})`);
    T.ok(tune[1].have === 'none', `tune: a low D after the lamp has named E standard names nothing (${tune[1].have}): it's a note, not a retune, until the lamp is pressed`);
    T.ok(tune.every((x) => x.have === x.want), `tune: the open low strings ${tune.map((x) => `${x.m} → ${x.have}`).join('; ')} (as the fretboard's tunings have them, the lamp pressed before C2 and B1: ${tune.map((x) => x.want).join('; ')})`);
    const offL = said.find((s) => s.id === 'tune.off'), sixth = FLAT0 + 2 * (FLATN - 1);
    T.ok(offL && offL.vars.flat === true && Math.abs(offL.vars.cents - 20) <= 5 && offL.t > sixth && offL.t < sixth + 2, `tune: six notes of a C2 20 cents flat say “${offL ? LINES['tune.off'].text(offL.vars) : '(nothing)'}” at ${fmt(offL?.t)} s, after the sixth (${sixth} s)`);
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `soundcheck: no page errors (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally { await room.close(); }
}

/* ------------------------------------------------------------------ 3 and 4. the count and the takes */
const RIFF = { bpm: 160, beats: 4, chord: true, notes: [[0, 40, 1], [1, 43, 0], [1.5, 45, 0], [2, 40, 1], [3, 47, 0.5]] };

function takesFake() {
  const passes = 72, vn = [], scale = [57, 59, 60, 62, 64];
  for (let b = 0, k = 0; b < passes * 4 - 2; b += 2, k++) vn.push([b, scale[k % 5], 1.8]);
  return session({ bpm: 160, channels: 2, lead: 1, tail: 2, parts: [{ kind: 'voice', notes: vn, bar: 1, channel: 0, vowel: 'a' }, { kind: 'riff', riff: RIFF, passes, bar: 1, channel: 1, jitter: 0.003 }] });
}

// (in the page) the speakers' feed recorded, each block with its audio time, until stop()
function pageHelpers() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // (the studio's own capture processor, input/cap-worklet.js: the page's policy refuses data: and blob: modules)
  const capture = async (ctx, node) => {
    if (!ctx.__lrcap) ctx.__lrcap = ctx.audioWorklet.addModule('/app/src/input/cap-worklet.js');
    await ctx.__lrcap;
    const cap = new AudioWorkletNode(ctx, 'ew-cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', processorOptions: { channels: 1 } });
    const chunks = [];
    cap.port.onmessage = (e) => { if (e.data && e.data.d) chunks.push([e.data.d[0], e.data.f]); };
    const z = ctx.createGain(); z.gain.value = 0; cap.connect(z); z.connect(ctx.destination);
    node.connect(cap);
    return { stop: async () => { cap.port.postMessage('off'); await sleep(150); try { node.disconnect(cap); } catch { /* ok */ } cap.disconnect(); z.disconnect(); return chunks; } };
  };
  // the first frame over thr in [t0, t1) (audio times), or null; the peak there
  const firstOver = (chunks, sr, t0, t1, thr) => { for (const [d, f] of chunks) { for (let i = 0; i < d.length; i++) { const t = (f + i) / sr; if (t < t0) continue; if (t >= t1) return null; if (Math.abs(d[i]) > thr) return f + i; } } return null; };
  const peakIn = (chunks, sr, t0, t1) => { let p = 0; for (const [d, f] of chunks) for (let i = 0; i < d.length; i++) { const t = (f + i) / sr; if (t >= t0 && t < t1) p = Math.max(p, Math.abs(d[i])); } return p; };
  // a key the deck hears: a key event dispatched now, and the stop (or anything) run inside it, as the stage's Space
  const key = (fn) => { let out = null; const h = (e) => { if (e.code === 'F8') out = fn(e); }; window.addEventListener('keydown', h, true); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8', key: 'F8' })); window.removeEventListener('keydown', h, true); return out; };
  const until = async (fn, ms = 60000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await sleep(1); } };
  window.__lr = { sleep, capture, firstOver, peakIn, key, until };
}

async function deckPage(T, ctx) {
  const fake = takesFake();
  const room = await openRoom('/app/?room', { fake, name: 'input-takes' });
  const { errors, E } = room;
  try {
    await E(pageHelpers);
    await E(async () => {
      const app = window.overdub;
      const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
      const { createProject } = await import('/app/src/core/project.js');
      window.__lr.deck = createDeck(app);
      window.__lr.createProject = createProject;
      window.__lr.same = createDeck(app) === window.__lr.deck;
    });
    T.ok(await E(() => window.__lr.same), 'the deck: one per page (createDeck(app) again gives the same one)');

    /* ---- 3. the count */
    const counts = [{ tempo: 132, bars: 1, want: 4, hits: null, at: true }, { tempo: 160, bars: null, want: 8, hits: null }, { tempo: 140, bars: 2, want: 8, hits: [0, 2, 4, 5, 6, 7], basement: true }];
    for (const c of counts) {
      const r = await E(async (c) => {
        const app = window.overdub, { engine, store } = app, { deck, capture, firstOver, peakIn, sleep } = window.__lr;
        if (engine.playing) engine.stop();
        store.load(window.__lr.createProject({ tempo: c.tempo }), { by: 'you' });
        await engine.start?.();
        const ectx = engine.ctx, sr = ectx.sampleRate, mon = engine._monitor;
        if (!mon) return { error: 'no speakers feed (engine._monitor)' };
        const cap = await capture(ectx, mon);
        const at = c.at ? ectx.currentTime + 0.35 : null;
        const res = await deck.countIn({ from: 0, bars: c.bars, voice: 'sticks', hits: c.hits, ...(at != null ? { at } : {}) });
        const k = engine.lastCount;
        if (!res.ok || !k) { await cap.stop(); engine.stop(); return { error: res.error || 'no count' }; }
        const spb = k.spb, end = k.startT + k.beats * spb;
        while (ectx.currentTime < end + 0.15) await sleep(20);
        const chunks = await cap.stop();
        const k2 = engine.lastCount;
        engine.stop();
        const beats = [];
        for (let i = 0; i < k.beats; i++) {
          const t = k.startT + i * spb, f = firstOver(chunks, sr, t - 0.03, t + 0.06, 0.02);
          beats.push({ i, err: f == null ? null : f - Math.round(t * sr), peak: peakIn(chunks, sr, t - 0.01, t + 0.06) });
        }
        return { sr, at, startT: k.startT, voice: k.voice, beats: k.beats, hits: k.hits, sounded: k2.sounded.map((x) => x.i), list: beats, ok: res.ok, downbeat: res.downbeat };
      }, c);
      if (r.error) { T.ok(false, `count at ${c.tempo}: ${r.error}`); continue; }
      const heard = r.list.filter((x) => x.peak > 0.02).map((x) => x.i);
      const wantHeard = c.hits || r.list.map((x) => x.i);
      const errs = r.list.filter((x) => wantHeard.includes(x.i)).map((x) => x.err);
      const okTimes = errs.every((e) => e != null && Math.abs(e) <= 128);
      const what = c.basement ? `the basement's two bars at ${c.tempo} (hits ${c.hits.join(',')})` : `${c.want} sticks at ${c.tempo}`;
      T.ok(r.voice === 'sticks' && r.beats === c.want && heard.join() === wantHeard.join() && r.sounded.join() === wantHeard.join() && okTimes,
        `count: ${what}: ${r.beats} beats, heard on ${heard.join(',')}, each ${errs.map((e) => (e == null ? '-' : e)).join('/')} samples from its beat (within 128); the engine says it sounded ${r.sounded.join(',')}`);
      if (c.at) T.ok(Math.abs(r.startT - r.at) < 1e-9 && Math.abs(r.downbeat - (r.at + (4 * 60) / c.tempo)) < 1e-6, `count: \`at\` kept: the first stick at ${fmt(r.startT, 4)} s as asked (${fmt(r.at, 4)}), the 1 at ${fmt(r.downbeat, 4)}`);
    }

    /* ---- 4. the takes */
    const setup = await E(async () => {
      const app = window.overdub, { store, input } = app, { deck } = window.__lr;
      store.load(window.__lr.createProject({ tempo: 160 }), { by: 'you' });
      const G = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio' } }, { by: 'you' }).created.g;
      const V = store.dispatch({ type: 'track.add', ref: 'v', track: { name: 'Voice', kind: 'audio' } }, { by: 'you' }).created.v;
      await input.audio.open({ channel: '2', capture: true, monitor: false });
      deck.latency = 0;
      window.__lr.G = G; window.__lr.V = V;
      return { G, V, open: input.audio.state.open, channels: input.audio.state.channels, latency: deck.latency };
    });
    T.note(`takes: the input open (${setup.channels} channels), the deck's latency ${setup.latency} s`);

    // a take from bar 1, the stop pressed at `beat` (a key event at that beat); then how it landed
    const takeAt = (beat, { stall = false, again = null } = {}) => E(async ({ beat, stall, again }) => {
      const app = window.overdub, { store, engine, input } = app, { deck, key, until, sleep, G } = window.__lr;
      const h0 = store.history.length;
      let landings = 0;
      const offT = deck.on('take', () => { landings++; });
      const t = await deck.take({ track: G, from: 0 });
      if (!t.ok) { offT(); return { error: t.error }; }
      await until(() => engine.playing && engine.beat >= beat);
      const pressed = engine.beat;
      const p = key(() => deck.stop({ at: 'bar' }));
      // (pressed again in the ring bar, past its first beat: the same stop, not a bar more)
      let p2 = null;
      if (again != null) { await until(() => engine.beat >= again); p2 = key(() => deck.stop({ at: 'bar' })); }
      if (stall) {
        // the tab hidden and starved: no frames, no timers, nothing on the main thread for 2.6 s across the line
        const raf = window.requestAnimationFrame;
        Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
        window.requestAnimationFrame = () => 0;
        document.dispatchEvent(new Event('visibilitychange'));
        const until2 = performance.now() + 2600;
        while (performance.now() < until2) { /* busy */ }
        delete document.visibilityState; delete document.hidden;
        window.requestAnimationFrame = raf;
        document.dispatchEvent(new Event('visibilitychange'));
      }
      const res = await p, res2 = p2 ? await p2 : res;
      await sleep(50);
      offT();
      const H = store.history.slice(h0).map((x) => ({ by: x.by, label: x.label, ops: (x.ops || []).map((o) => o.type), assets: (x.ops || []).filter((o) => o.type === 'asset.add').map((o) => o.asset) }));
      let clip = null, secs = null, sr = null;
      if (res?.take) {
        const tr = store.track(res.take.track), c = tr?.clips.find((x) => x.id === res.take.clip);
        clip = c ? { start: c.start, length: c.length, offset: c.offset || 0, by: c.by } : null;
        const buf = await engine.assets.get(res.take.asset);
        secs = buf ? buf.length / buf.sampleRate : null; sr = buf?.sampleRate;
      }
      return { pressed, landings, same: res2 === res, res: res && { ok: res.ok, to: res.to, from: res.from, bars: res.bars, tail: res.tail, empty: res.empty, kept: res.kept, txn: !!res.txn, quietLead: res.quietLead, peaks: res.peaks?.bars?.slice(0, 3) }, H, clip, secs, sr, playing: engine.playing, inputSr: input.audio.state.sr };
    }, { beat, stall, again });

    const spb = 60 / 160;
    const landed = (name, r, part) => {
      if (r.error) return T.ok(false, `${name}: ${r.error}`);
      const ring = 4, A = r.H.flatMap((x) => x.assets), a = A[0];
      T.ok(r.res?.ok && r.res.to === part && r.res.bars === part / 4 && r.res.tail === ring && r.clip?.start === 0 && Math.abs(r.clip.length - (part + ring)) < 1e-6 && Math.abs(r.secs - (part + ring) * spb) < 0.02,
        `${name}: pressed at beat ${fmt(r.pressed - Math.floor(r.pressed / 4) * 4, 2)} of bar ${Math.floor(r.pressed / 4) + 1}, a ${r.res?.bars}-bar part (to beat ${r.res?.to}), the take keeping a bar of ring (clip ${r.clip?.start}–${r.clip && r.clip.start + r.clip.length} beats, ${fmt(r.secs, 3)} s of audio, ${fmt((part + ring) * spb, 3)} asked)`);
      T.ok(r.H.length === 1 && r.H[0].by === 'you' && r.res.txn && r.H[0].ops.includes('asset.add') && a && a.sr > 0 && a.channels === 1 && Math.abs(a.duration - r.secs) < 0.002,
        `${name}: one step by you (${r.H.map((x) => `${x.by}: ${x.label} [${x.ops.join(', ')}]`).join('; ')}), its asset.add listing rate ${a?.sr}, channels ${a?.channels}, length ${fmt(a?.duration, 3)} s`);
    };
    landed('stop at beat 0.5 of bar 9', await takeAt(32.45), 32);
    const twice = await takeAt(34.05, { again: 37.4 });
    landed('stop at beat 2 of bar 9', twice, 36);
    if (!twice.error) T.ok(twice.landings === 1 && twice.same, `stop at beat 2 of bar 9, pressed again in the ring at beat 2.4 of bar 10: the same stop, landing once (${twice.landings} take event${twice.landings === 1 ? '' : 's'}, the same result: ${twice.same})`);

    // Esc during a take: nothing in History, the pass in Capture; ⇧R puts it in at its bars
    const esc = await E(async () => {
      const app = window.overdub, { store, engine, input } = app, { deck, until, sleep, G } = window.__lr;
      const h0 = store.history.length, c0 = input.capture.list?.().length ?? null;
      const t = await deck.take({ track: G, from: 0 });
      if (!t.ok) return { error: t.error };
      await until(() => engine.playing && engine.beat >= 9);
      const res = await deck.stop({ at: 'now', keep: 'capture' });
      await sleep(50);
      const hEsc = store.history.length - h0, caps = (input.capture.list?.() || []).filter((x) => x.thrown);
      const back = await deck.keepAfterAll();
      await sleep(50);
      const H = store.history.slice(h0).map((x) => ({ by: x.by, label: x.label, ops: (x.ops || []).map((o) => o.type) }));
      const tr = back?.take ? store.track(back.take.track) : null, c = tr?.clips.find((x) => x.id === back.take.clip);
      return { res: { kept: res.kept, line: res.line, capture: res.capture?.length }, hEsc, caps: caps.length, c0, back: back && { ok: back.ok, error: back.error, to: back.to }, H, clip: c ? { start: c.start, length: c.length } : null, playing: engine.playing };
    });
    if (esc.error) T.ok(false, `Esc: ${esc.error}`);
    else {
      T.ok(esc.res.kept === 'capture' && esc.res.line === 'take.esc' && esc.hEsc === 0 && esc.caps >= 1 && !esc.playing, `Esc during a take: nothing in History (${esc.hEsc} steps), the pass in Capture (${esc.caps}), the talkback's line “${LINES['take.esc'].text({})}”`);
      T.ok(esc.back?.ok && esc.H.length === 1 && esc.H[0].by === 'you' && esc.clip?.start === 0 && esc.clip.length >= 8.5, `⇧R puts it in after all, at its bars: one step by you (${esc.H.map((x) => `${x.label} [${x.ops.join(', ')}]`).join('; ')}), the clip from beat ${esc.clip?.start}, ${fmt(esc.clip?.length, 2)} beats`);
    }

    // the transport stopped under a take's count by something else (the recorder lets the take go by itself): the deck
    // is idle again, and the next take starts
    const gone = await E(async () => {
      const app = window.overdub, { engine } = app, { deck, until, sleep, G } = window.__lr;
      const t = await deck.take({ track: G, from: 0 });
      if (!t.ok) return { error: t.error };
      const during = { run: deck.state.run, rec: app.input.recorder.state };
      engine.stop();
      await until(() => app.input.recorder.state === 'idle', 5000).catch(() => {});
      await sleep(50);
      const after = { run: deck.state.run, rec: app.input.recorder.state };
      const t2 = await deck.take({ track: G, from: 0 });
      const next = { ok: t2.ok, error: t2.error || null, run: deck.state.run };
      const c = await deck.stop({ at: 'now', keep: 'capture' });
      await until(() => !engine.playing, 5000).catch(() => {});
      return { during, after, next, cancelled: !!c.cancelled };
    });
    if (gone.error) T.ok(false, `a take let go under its count: ${gone.error}`);
    else T.ok(gone.during.run === 'count' && gone.after.run === 'idle' && gone.after.rec === 'idle' && gone.next.ok && gone.next.run === 'count' && gone.cancelled,
      `a take let go under its count (the transport stopped by something else): the deck is ${gone.after.run} again, and the next take starts (${gone.next.ok ? gone.next.run : gone.next.error}); a stop in its count cancels it (${gone.cancelled})`);

    // a punch (the other side, Bar 5 again) with the transport stopped: counted in to its start, it ends itself at its
    // end, keeping only that range (from 30 ms before its 1), one step by you, and the band plays a bar on, then stops
    const pun = await E(async () => {
      const app = window.overdub, { store, engine } = app, { deck, until, sleep, G } = window.__lr;
      const h0 = store.history.length;
      let got = null;
      const off = deck.on('take', (x) => { got = x; });
      const t = await deck.take({ track: G, punch: { from: 16, to: 20 } });
      if (!t.ok) { off(); return { error: t.error }; }
      const counted = engine.beat;
      let last = null;
      await until(() => { if (engine.playing) last = engine.beat; return !!got && !engine.playing; }, 20000).catch(() => {});
      off();
      await sleep(50);
      const H = store.history.slice(h0);
      const c = got?.take ? store.track(got.take.track)?.clips.find((x) => x.id === got.take.clip) : null;
      return { counted, from: t.from, last, res: got && { from: got.from, to: got.to, bars: got.bars }, clip: c ? { start: c.start, length: c.length } : null, H: H.map((x) => x.by), playing: engine.playing };
    });
    if (pun.error) T.ok(false, `a punch: ${pun.error}`);
    else {
      const end = pun.clip ? pun.clip.start + pun.clip.length : null, lead = pun.clip ? (16 - pun.clip.start) * spb * 1000 : null;
      T.ok(pun.counted < 16 && pun.res?.from === 16 && pun.res.to === 20 && pun.res.bars === 1 && Math.abs(end - 20) < 1e-3 && lead > 25 && lead < 35 && pun.H.length === 1 && pun.H[0] === 'you' && !pun.playing && Math.abs(pun.last - 24) < 0.3,
        `a punch of bar 5 with the transport stopped: counted in to it (beat ${fmt(pun.counted, 2)} as the take armed), a ${pun.res?.bars}-bar take ending itself at beat ${fmt(end, 3)}, its clip from ${fmt(lead)} ms before the 1, ${pun.H.length} step by ${pun.H[0]}, the band stopping a bar on (beat ${fmt(pun.last, 2)})`);
    }

    // a stop pressed, and then the tab hidden and starved of frames: it still ends on the bar line
    landed('stop at beat 2 of bar 5, the tab then hidden and stalled for 2.6 s', await takeAt(18.05, { stall: true }), 20);

    // two inputs: a voice on 1 and a guitar on 2, two takes on two tracks, lined up, one step
    const two = await E(async () => {
      const app = window.overdub, { store, engine, input } = app, { deck, key, until, sleep, G, V } = window.__lr;
      input.audio.close();
      await input.audio.open({ split: { 1: V, 2: G }, capture: true, monitor: false });
      deck.latency = 0;
      const h0 = store.history.length;
      const t = await deck.take({ track: V, from: 0 });
      if (!t.ok) return { error: t.error };
      await until(() => engine.playing && engine.beat >= 16.4);
      const res = await key(() => deck.stop({ at: 'bar' }));
      await sleep(50);
      const H = store.history.slice(h0).map((x) => ({ by: x.by, label: x.label, ops: (x.ops || []).map((o) => o.type) }));
      const takes = [];
      for (const tk of res?.takes || []) {
        const c = store.track(tk.track)?.clips.find((x) => x.id === tk.clip), buf = await engine.assets.get(tk.asset);
        let pk = 0; const d = buf?.getChannelData(0) || []; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        takes.push({ track: store.track(tk.track)?.name, start: c?.start, length: c?.length, offset: c?.offset || 0, frames: buf?.length, sr: buf?.sampleRate, peak: 20 * Math.log10(pk + 1e-12) });
      }
      return { split: input.audio.state.split, res: res && { ok: res.ok, to: res.to, bars: res.bars, empty: res.empty }, H, takes };
    });
    if (two.error) T.ok(false, `two inputs: ${two.error}`);
    else {
      const [a, b] = two.takes;
      const lined = a && b && a.start === b.start && a.offset === b.offset && a.length === b.length && Math.abs(a.frames - b.frames) <= 1;
      T.ok(two.takes.length === 2 && new Set(two.takes.map((x) => x.track)).size === 2 && lined && two.H.length === 1 && two.H[0].by === 'you' && two.takes.every((x) => x.peak > -30),
        `two inputs: a voice on 1 and a guitar on 2 make ${two.takes.length} takes on ${two.takes.map((x) => x.track).join(' and ')}, lined up (from beat ${a?.start}, ${a?.frames} and ${b?.frames} frames), in ${two.H.length} step by ${two.H[0]?.by} (${two.H[0]?.label}; peaks ${two.takes.map((x) => fmt(x.peak)).join(' / ')} dBFS)`);
    }
    await room.shot('liveroom-input-takes');
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(errs.length === 0, `the deck: no page errors (${errs.length})${errs.length ? '\n    ' + errs.slice(0, 5).join('\n    ') : ''}`);
  } finally { await room.close(); }
}

