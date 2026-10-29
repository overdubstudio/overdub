// The live room's checks: the rolling tape (docs/research/GUITAR-ROOM.md §1.4, §2.3, §4.3; input/tape.js). Run by
// tools/liveroom-test.js (ONLY=tape), whose header says what a checks module exports. Muted Chromium, a fake guitar
// (fake.js session: a two-bar riff twice from bar 1, then the band rolling on and silence) at the context's own rate,
// so nothing resamples it:
//   1. the tape fills: it rolls from the input's opening with the band counted in to the fake's bar 1 (harness.js
//      alignCount), the deck recording a take over the same four bars at the same time (latency 0: the fake has none);
//      its span grows with the clock and its waveform peaks where the riff does (−12 dBFS)
//   2. that was the one: the default selection is bars 1-4, on their lines
//   3. grab: the asset's samples are the fake's, every one (16 bits in, 16 bits out), and its line is the deck's: the
//      take's first sample (the recorder placing beat 0 by the same rule) is the grab's sample at the line, and from
//      there they agree to the sample; the place says beats 0-16, four bars at 120; nothing entered History
//   4. it doesn't change recording: the deck's take landed as a take does (one step by you, asset.add and its clip)
//   5. what it costs the page while it rolls: the JS heap after a forced collection, before and after ten seconds
// And the guitar room's TAPE stream (app/src/ui/liveroom/guitar/tape.js and its tape-*.js, talk-room.js):
//   6. in Node: every line it says keeps the room's copy rules (checks-copy.js's never-says words, no exclamation mark,
//      two sentences at most), and a long reply from Claude is cut to a sentence or two for the talkback
//   7. in the club (the door's 1, the fake guitar, the drummer standing in as the transport counted in to the fake's
//      bar 1): the tape rolls as the room mounts; G puts the camera on the machine and the last minute up, the default
//      selection on its bar lines; a focused end moves a bar line at a time; B turns snapping off and on (the pref
//      kept); Enter keeps it: one riff more in riffs-db (its tempo, its bars, the club's stack and the song's tag),
//      nothing in History, the riffs up in the tray with the line said; a click on its card hears it through the rig
//      at the level it was played (measured into Guitar L's chain)
//   8. a riff onto the part line, as Enter on its card and as a drag onto the part line: the takes stream's place gets
//      the riff and where it goes (the takes stream's real place) and its part is one step by you that ⌘Z takes back;
//      Enter on a card is the card's alone (the room's play-from isn't pressed with it)
//   9. the library (⇧L): the riff listed newest first with its song, a search that matches nothing and one that does,
//      ↓ and Enter putting it on the part line; Esc steps back out of it, and out of the tape's sheet with the camera
//  10. Claude on the talkback: with nobody connected / says so and opens nothing; with the demo agent / opens the field
//      (a letter types, it doesn't record), Enter asks with the room's state as context, the reply comes into the
//      talkback signed in cool ink; a click away closes the field (its words kept) and gives the room its keys back;
//      an edit by 'claude' while the room is up is one step ⌘Z takes back
//  11. leaving the room stops the tape it started; no console or page errors
import { openRoom, alignCount, history, press } from './harness.js';
import { session } from './fake.js';

export const name = 'tape';
export const pages = true;

const BPM = 120;
const RIFF = { bpm: BPM, beats: 8, chord: true, notes: [[0, 40, 0], [0.5, 40, 0], [1, 43, 1], [2.5, 40, 0], [3, 45, 0.5], [4, 40, 0], [4.75, 40, 0], [5.5, 47, 1], [7, 43, 0]] };
const IGNORE = (e) => /favicon|net::ERR|Failed to load resource|AudioContext was not allowed/i.test(e);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

export async function run(T, ctx) {
  await guitarNode(T);
  if (!ctx.pages) return;
  await rolling(T, ctx);
  await guitarRoom(T, ctx);
}

async function rolling(T, ctx) {
  // the context's rate on this machine (the output device's), so the fake needs no resampling on its way in
  const probe = await openRoom('/app/', { ready: false });
  let sr = 48000;
  try { sr = await probe.E(async () => { const c = new AudioContext(); const r = c.sampleRate; await c.close(); return r; }); } finally { await probe.close(); }
  const fake = session({ bpm: BPM, lead: 5, tail: 8, sr, parts: [{ kind: 'riff', riff: RIFF, bar: 1, passes: 2, seed: 21 }] });
  const src = fake.wav.channels[0], bar1 = fake.timeline.bar1;
  // the 16-bit samples the file holds (fake.js writeWav's rounding)
  const v16 = Int16Array.from(src, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
  const room = await openRoom('/app/', { fake, name: 'tape' });
  const { errors, E } = room;
  try {
    const setup = await E(async () => {
      const app = window.overdub, { store, input } = app;
      const { createProject } = await import('/app/src/core/project.js');
      const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
      store.load(createProject({ tempo: 120 }), { by: 'you' });
      const G = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio' } }, { by: 'you' }).created.g;
      input.tape.start({ seconds: 60 });
      await input.audio.open({ channel: '1', capture: true, monitor: false });
      const deck = createDeck(app);
      deck.latency = 0;
      const t0 = performance.now();
      while (!(input.tape.state.open && input.tape.state.head > 0 && input.audio.state.firstFrame != null) && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 20));
      window.__tp = { deck, G, h0: store.history.length };
      return { open: input.tape.state.open, head: input.tape.state.head, sr: input.tape.state.sr, bytes: input.tape.state.bytes, ctxSr: app.engine.ctx?.sampleRate, firstFrame: input.audio.state.firstFrame };
    });
    T.ok(setup.open && setup.head > 0 && setup.sr === sr, `the tape rolls once the input opens: ${setup.sr} Hz (the context's: ${setup.ctxSr}), a ${fmt(setup.bytes / 1e6, 2)} MB ring for a minute`);
    if (!setup.open) return;

    // the band counted in to the fake's bar 1, the deck recording a take over it
    const al = await alignCount(room.page, { bar1, beats: 4, bpm: BPM });
    if (!al.ok) { T.ok(false, `the count lined up with the fake: ${al.error}`); return; }
    const took = await E(async ({ at }) => {
      const app = window.overdub, { deck, G } = window.__tp;
      deck.countIn({ from: 0, bars: 1, voice: 'click', at });
      const t = await deck.take({ track: G, from: 0 });
      if (!t.ok) return { error: t.error };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const spans = [];
      while (app.engine.beat < 16.25) { await sleep(25); if (spans.length < 400) spans.push(app.input.tape.span().seconds); }
      const landed = new Promise((r) => { const off = deck.on('take', (x) => { off(); r(x); }); });
      const st = await deck.stop({ at: 'bar', beat: 16.25 });
      const res = st && st.take ? st : await Promise.race([landed, sleep(8000).then(() => null)]);
      return { spans: [spans[0], spans[spans.length - 1]], take: res?.take || null, empty: !!res?.empty };
    }, { at: al.at });
    if (took.error) { T.ok(false, `the deck's take started: ${took.error}`); return; }
    T.ok(took.spans[1] > took.spans[0] + 8, `it fills as the band plays: ${fmt(took.spans[0])} s on tape, then ${fmt(took.spans[1])} s`);

    // the fake rings out and the band rolls on: then "that was the one"
    await E(async (until) => { const st = window.overdub.input.audio.state, c = window.overdub.engine.ctx; while ((c.currentTime - st.firstFrame / st.sr) < until) await new Promise((r) => setTimeout(r, 50)); }, bar1 + 8 + 2.5);
    const r = await E(async () => {
      const app = window.overdub, tape = app.input.tape, { deck, h0 } = window.__tp;
      const sel = await tape.select();
      const g = sel ? await tape.grab(sel) : null;
      const hist = app.store.history.length;
      const sp = tape.span(), pk = tape.peaks(sp.from, sp.to, 600);
      let loud = 0; for (const v of pk) loud = Math.max(loud, v);
      // the take's samples and the grab's, from the line on
      const tk = deck.state.last?.take || null;
      let same = null, take = null;
      if (g?.ok && tk) {
        const clip = app.store.clip(tk.track, tk.clip), buf = await app.engine.assets.get(tk.asset);
        const a = buf.getChannelData(0), lead = g.frames.at - g.frames.from, off = Math.round((clip.offset || 0) * buf.sampleRate);
        take = { start: clip.start, offset: clip.offset, n: a.length };
        // (as 16 bits: the take keeps the browser's floats, the tape the 16-bit values they came from)
        const q = (x) => (x < 0 ? Math.round(x * 32768) : Math.round(x * 32767));
        const cmp = (shift) => { let ok = 0, n = 0; for (let i = 0; i + off < a.length && lead + i + shift < g.data.length && i < buf.sampleRate * 8; i++) { n++; if (q(a[i + off]) === q(g.data[lead + i + shift])) ok++; } return { ok, n }; };
        same = { at: cmp(0), before: cmp(-1), after: cmp(1) };
      }
      // the grab's samples as 16 bits, for Node to hold against the file
      let b64 = null;
      if (g?.ok) {
        const v = new Int16Array(g.data.length);
        for (let i = 0; i < v.length; i++) { const x = g.data[i]; v[i] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767); }
        const u = new Uint8Array(v.buffer); let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        b64 = btoa(s);
      }
      const ff = app.input.audio.state.firstFrame;
      return { sel, g: g && { ok: g.ok, error: g.error, asset: g.asset, frames: g.frames, place: g.place, seconds: g.seconds, peak: g.peak, lead: g.lead }, b64, hist, h0, loud, same, take, ff, inAssets: g?.ok ? !!(await app.engine.assets.get(g.asset.id)) : false };
    });
    const sel = r.sel;
    T.ok(sel && sel.snapped && sel.beats?.from === 0 && sel.beats?.to === 16 && sel.bars === 4 && sel.bar === 1,
      `that was the one: the default selection is bars ${sel?.bar}–${sel ? sel.bar + sel.bars - 1 : '?'} (beats ${sel?.beats?.from}–${sel?.beats?.to}, ${sel?.why}), on their lines`);
    T.ok(r.loud > 0 && Math.abs(20 * Math.log10(r.loud) + 12) < 0.6, `its waveform peaks where the riff does: ${fmt(20 * Math.log10(r.loud), 2)} dBFS (the fake: −12)`);
    if (!r.g?.ok) { T.ok(false, `grab: ${r.g?.error || 'no selection'}`); return; }

    // the grab against the file: where in the file its first sample is (around firstFrame's reckoning), then every sample
    const got = new Int16Array(Uint8Array.from(Buffer.from(r.b64, 'base64')).buffer);
    const guess = r.g.frames.from - r.ff;
    let off = null;
    for (let d = 0; d <= 4096 && off == null; d++) {
      for (const s of d ? [guess + d, guess - d] : [guess]) {
        if (s < 0 || s + got.length > v16.length) continue;
        let k = 0;
        while (k < 256 && got[k + 2400] === v16[s + k + 2400]) k++;
        if (k === 256) { off = s; break; }
      }
    }
    let bad = -1;
    if (off != null) { bad = 0; for (let i = 0; i < got.length; i++) if (got[i] !== v16[off + i]) bad++; }
    T.ok(off != null && bad === 0, `grab: the asset's ${got.length} samples are the fake's, every one (${off == null ? 'not found in the file' : `${bad} differ`}), ${fmt(r.g.seconds, 3)} s at ${r.g.asset.sr} Hz, peaking at ${fmt(r.g.peak, 2)} dBFS`);
    const lineErr = off == null ? null : r.g.frames.at - r.g.frames.from + off - Math.round(bar1 * sr);
    // (the band was counted in by firstFrame, which reckons the fake capture's start a few ms either way: the deck's
    // take, next, is off by the same, so this is the count's lining up with the file, not the tape's with the band)
    T.ok(lineErr != null && Math.abs(lineErr) <= Math.round(0.05 * sr), `its line is the fake's bar 1 to ${lineErr} samples (${fmt((lineErr / sr) * 1000, 1)} ms: where firstFrame puts the fake capture's start; within 50 ms)`);
    const sm = r.same;
    T.ok(sm && sm.at.n > sr * 4 && sm.at.ok === sm.at.n && sm.before.ok < sm.before.n * 0.5 && sm.after.ok < sm.after.n * 0.5,
      `and the deck's: the take's first sample (beat ${r.take?.start}, offset ${r.take?.offset}) is the grab's at its line, and they agree for ${sm?.at.ok} of ${sm?.at.n} samples (a sample either way: ${sm?.before.ok}, ${sm?.after.ok})`);
    const p = r.g.place;
    T.ok(p && p.from === 0 && p.to === 16 && p.beats === 16 && p.bars === 4 && p.bpm === 120 && Math.abs(p.start + 0.06) < 0.002 && Math.abs(p.length - 16.06) < 0.002 && r.g.lead === Math.round(0.03 * sr) / sr,
      `its place: beats ${p?.from}–${p?.to} (${p?.bars} bars at ${p?.bpm}), the first sample at beat ${fmt(p?.start, 4)} (the 30 ms lead), ${fmt(p?.length, 4)} beats long`);
    T.ok(r.inAssets && r.hist === r.h0 + 1, `grab put the samples in engine.assets (${r.g.asset.id}, "${r.g.asset.name}") and the song is as it was: History has the take's step and nothing more (${r.hist - r.h0})`);

    const h = await history(room.page);
    const last = h[h.length - 1];
    T.ok(took.take && last && last.by === 'you' && last.ops.includes('asset.add') && last.ops.includes('clip.add'), `recording as it was: the deck's take landed as one step by you (${last?.ops.join(', ')}) while the tape rolled`);

    // what it costs the page: the heap after a collection, before and after ten seconds of rolling
    const cdp = await room.page.context().newCDPSession(room.page);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    const h1 = await heap();
    await new Promise((res) => setTimeout(res, 10000));
    const h2 = await heap();
    T.ok(h2 - h1 < 2e6, `ten more seconds rolling: the page's heap ${h2 >= h1 ? 'grew' : 'shrank'} ${fmt(Math.abs(h2 - h1) / 1024, 0)} KB (${fmt(h1 / 1e6, 1)} MB then ${fmt(h2 / 1e6, 1)} MB; the ring itself is in the audio thread)`);

    const stop = await E(() => { const tape = window.overdub.input.tape; tape.stop(); return { rolling: tape.state.rolling, open: tape.state.open, bytes: tape.state.bytes }; });
    T.ok(!stop.rolling && !stop.open && stop.bytes === 0, 'tape.stop() lets the ring go');
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(!errs.length, `no console or page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await room.close();
  }
}

/* ============================================================================================ the guitar room's tape stream */
async function guitarNode(T) {
  const { TAPE_LINES } = await import('../../app/src/ui/liveroom/guitar/tape-lines.js');
  const { breaks } = await import('./checks-copy.js');
  const vars = { a: 30, b: 33, s: 7.3, name: 'Riff 4', n: 4, tempo: 132, tuning: 'Drop C', bar: 33, what: 'Bars 30–33', names: ['Claude Code'], why: 'the key on the server was turned down' };
  const bad = [];
  for (const [id, fn] of Object.entries(TAPE_LINES)) {
    for (const v of [vars, { ...vars, n: 1, tuning: '', names: [] }]) {
      let t;
      try { t = String(fn(v)); } catch (e) { bad.push(`${id}: throws (${e?.message || e})`); break; }
      for (const x of breaks(`tape.${id}`, t)) bad.push(`${id}: ${x.why}`);
    }
  }
  T.ok(!bad.length, `the tape stream's ${Object.keys(TAPE_LINES).length} lines keep the room's copy rules${bad.length ? ': ' + bad.join('; ') : ''}`);
  const { shorten } = await import('../../app/src/ui/liveroom/guitar/talk-room.js').catch(() => ({ shorten: null }));
  if (shorten) {
    const long = 'The drummer’s on **Double-kick gallop** now, at 132. A d-beat wants 160 or more: say if you want the tempo up. ⌘Z puts the old beat back. ' + 'More words here. '.repeat(30);
    const s = shorten(long);
    T.ok(s.length <= 280 && s.startsWith('The drummer’s on Double-kick gallop now') && !/\*/.test(s), `a long reply from Claude is a sentence or two in the talkback (${s.length} characters: "${s.slice(0, 60)}…")`);
  }
}

async function guitarRoom(T, ctx) {
  const BPM = 120;
  const probe = await openRoom('/app/', { ready: false });
  let sr = 48000;
  try { sr = await probe.E(async () => { const c = new AudioContext(); const r = c.sampleRate; await c.close(); return r; }); } finally { await probe.close(); }
  // (three passes of the riff from bar 1, then the band rolls on)
  const fake = session({ bpm: BPM, lead: 5, tail: 8, sr, parts: [{ kind: 'riff', riff: RIFF, bar: 1, passes: 3, seed: 21 }] });
  const room = await openRoom('/app/?room', { fake, name: 'gr-tape' });
  const { page, E, errors } = room;
  const shot = (n) => page.screenshot({ path: `${ctx.out}/gr-tape-${n}.png` });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // the club through the door
    await E(() => { const o = window.overdub; if (o.liveRoom.isOpen()) o.liveRoom.close(); o.liveRoom.open({ screen: 'door' }); });
    await wait(300);
    await press(page, 'Digit1');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'guitar', null, { timeout: 15000 }).catch(() => {});
    const m = await E(async () => {
      const o = window.overdub, R = document.querySelector('.gr')?.__gr;
      const rollingAtMount = !!o.input.tape.state.rolling;
      o.store.dispatch({ type: 'project.set', patch: { tempo: 120 } }, { by: 'you' });
      await o.input.audio.open({ channel: '1', capture: true, monitor: false });
      const t0 = performance.now();
      while (!(o.input.tape.state.open && o.input.tape.state.head > 0 && o.input.audio.state.firstFrame != null) && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 20));
      const { count } = await import('/app/src/ui/liveroom/riffs-db.js');
      window.__gt = { h0: o.store.history.length, n0: await count() };
      return { screen: o.ui.state.liveRoom.screen, R: !!R, tape: !!R?.parts?.tape, rollingAtMount, open: o.input.tape.state.open };
    });
    T.ok(m.screen === 'guitar' && m.tape && m.rollingAtMount && m.open, `the tape rolls as the guitar room mounts (rolling ${m.rollingAtMount}), and fills once the input opens (${m.open})`);
    if (!m.tape) return;
    // the band, counted in to the fake's bar 1 (the drummer's jam stands in: the transport from the count)
    const al = await alignCount(page, { bar1: fake.timeline.bar1, beats: 4, bpm: BPM });
    if (!al.ok) { T.ok(false, `the count lined up with the fake: ${al.error}`); return; }
    await E(async ({ at }) => { const o = window.overdub; await o.engine.start(); o.engine.play(-4, { at }); }, { at: al.at });
    await E(async (until) => { const st = window.overdub.input.audio.state, c = window.overdub.engine.ctx; while ((c.currentTime - st.firstFrame / st.sr) < until) await new Promise((r) => setTimeout(r, 50)); }, fake.timeline.bar1 + 12 + 2.5);

    // G: that was the one
    await press(page, 'KeyG');
    await page.waitForFunction(() => !!window.overdub.ui.state.liveRoom.gr?.tape?.sel, null, { timeout: 8000 }).catch(() => {});
    await wait(200);
    const g = await E(() => {
      const o = window.overdub, gr = o.ui.state.liveRoom.gr, tp = o.input.tape, sel = gr.tape.sel;
      const sheet = document.querySelector('.gr-sheet[data-sheet="tape"]');
      return { overlay: gr.overlay, cam: gr.cam, shown: !!sheet && !sheet.hidden, sel: sel && { from: sel.from, to: sel.to, bar: sel.bar, bars: sel.bars }, onLines: sel ? tp.snap(sel.from) === sel.from && tp.snap(sel.to) === sel.to : false,
        line: document.querySelector('.lr-tb-text')?.textContent || '', focus: document.activeElement?.className || '', keep: document.querySelector('.gr-tp-keep')?.textContent || '', handles: [...document.querySelectorAll('.gr-tp-h span')].map((x) => x.textContent) };
    });
    T.ok(g.overlay === 'tape' && g.cam === 'tape' && g.shown && g.sel && g.sel.bars >= 2 && g.onLines && g.handles[0] === `in ${g.sel.bar}` && g.keep.includes(`bars ${g.sel.bar}–${g.sel.bar + g.sel.bars - 1}`),
      `G: the camera on the tape machine and the last minute up, bars ${g.sel?.bar}–${g.sel ? g.sel.bar + g.sel.bars - 1 : '?'} picked on their bar lines, and the sheet says so (${g.handles.join(', ')}; "${g.keep.replace(/Enter$/, '')}")`);
    T.ok(/^The last minute, on the drummer’s bars\. Bars \d+ to \d+ are picked/.test(g.line) && /gr-tp-out/.test(g.focus), `the talkback says what's picked ("${g.line}"), and the end's handle has the keys`);
    await shot('sheet');
    // a focused end moves a bar line at a time; B: snapping off, then on again (kept in the room's prefs)
    const before = g.sel;
    await press(page, 'ArrowLeft');
    const left = await E(() => { const o = window.overdub, sel = o.ui.state.liveRoom.gr.tape.sel, tp = o.input.tape; return { from: sel.from, to: sel.to, onLine: tp.snap(sel.to) === sel.to, line: tp.lines(sel.to - 10, sel.to + 10, 0).length }; });
    const barF = Math.round((sr * 60 * 4) / BPM);
    T.ok(left.from === before.from && Math.abs(before.to - left.to - barF) <= 2 && left.onLine, `← on the focused end: a bar shorter, on the line before (${before.to - left.to} frames: a bar is ${barF})`);
    await press(page, 'KeyB');
    const off = await E(() => { const o = window.overdub; return { snap: o.ui.state.liveRoom.gr.tape.snap, pref: JSON.parse(localStorage.getItem('overdub:guitar-room') || '{}').snap, label: document.querySelector('.gr-tp-snap')?.textContent || '' }; });
    await press(page, 'KeyB');
    const on = await E(() => window.overdub.ui.state.liveRoom.gr.tape.snap);
    T.ok(off.snap === false && off.pref === false && /off/.test(off.label) && on === true, `B: snap to bars off (the room's prefs: snap ${off.pref}, "${off.label.replace(/B$/, '')}"), and on again`);
    // Enter keeps it
    await press(page, 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.gr-ty-card').length > 0, null, { timeout: 8000 }).catch(() => {});
    await wait(200);
    const k = await E(async () => {
      const o = window.overdub, gr = o.ui.state.liveRoom.gr, db = await import('/app/src/ui/liveroom/riffs-db.js');
      const n = await db.count(), rows = (await db.list({ limit: 1 })).rows, r = rows[0] ? await db.get(rows[0].id) : null;
      return { n, n0: window.__gt.n0, h: o.store.history.length, h0: window.__gt.h0, overlay: gr.overlay, cam: gr.cam, drawer: gr.drawer, cards: [...document.querySelectorAll('.gr-ty-card .gr-ty-cn')].map((x) => x.textContent),
        r: r && { id: r.id, name: r.name, tempo: r.tempo, bars: r.bars, beats: r.beats, song: r.song, here: o.store.get().id, stack: r.stack?.name, chain: (r.chain || []).length, offset: r.offset }, line: document.querySelector('.lr-tb-text')?.textContent || '' };
    });
    const want = (before?.bars || 0) - 1;
    T.ok(k.n === k.n0 + 1 && k.r && k.r.tempo === 120 && k.r.bars === want && k.r.song === k.r.here && k.r.chain > 0 && k.r.offset > 0, `Enter keeps it: one riff more in the library (${k.r?.name}, ${k.r?.bars} of ${want} bars at ${k.r?.tempo}, from this song, through ${k.r?.stack || 'its'} ${k.r?.chain}-piece chain, its first beat ${Math.round((k.r?.offset || 0) * 1000)} ms in)`);
    T.ok(k.h === k.h0 && k.overlay === null && k.cam === 'stage' && k.drawer && k.cards[0] === k.r?.name && new RegExp(`is in the tray: ${want} bars? at 120`).test(k.line), `and the song is as it was (History ${k.h - k.h0}), the camera back on the stage, ${k.r?.name} first in the tray ("${k.line}")`);
    await shot('tray');
    // a click on its card hears it, round and round, through the rig: into Guitar L's chain at the level it was played
    // (the fake peaks at −12 dBFS; the monitor is off, so all the chain's input hears is the riff)
    const lv = await E(() => {
      const o = window.overdub, G = (o.store.get().room?.tracks || {}).guitarL, node = o.engine.inputNode(G);
      const an = node.context.createAnalyser(); an.fftSize = 2048; node.connect(an);
      window.__gt.an = { an, node, peak: 0, t: setInterval(() => { const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); for (const x of b) window.__gt.an.peak = Math.max(window.__gt.an.peak, Math.abs(x)); }, 20) };
      return !!G;
    });
    await page.locator('.gr-ty-card').first().click();
    await wait(2500);
    const lvl = await E(() => { const a = window.__gt.an; clearInterval(a.t); try { a.node.disconnect(a.an); } catch { /* gone */ } const R = document.querySelector('.gr').__gr; return { db: 20 * Math.log10(a.peak || 1e-9), key: R.parts.tape.tray && document.querySelector('.gr-ty-card.gr-ty-on') ? 'on' : 'off' }; });
    await page.locator('.gr-ty-card').first().click();
    await wait(200);
    const quiet = await E(() => !document.querySelector('.gr-ty-card.gr-ty-on'));
    T.ok(lv && lvl.key === 'on' && Math.abs(lvl.db + 12) <= 1 && quiet, `a click on ${k.r?.name} hears it through the rig at the level it was played (${fmt(lvl.db, 2)} dBFS into Guitar L's chain; the fake's −12), and a second click stops it`);

    // onto the part line: the takes stream's own place (a part from the riff, one step by you), each call noted
    await E(() => {
      const R = document.querySelector('.gr').__gr;
      window.__gt.places = [];
      const place = R.parts.takes.place;
      R.parts.takes.place = (riff, where) => { window.__gt.places.push({ id: riff.id, where }); return place(riff, where); };
    });
    const h1 = await E(() => window.overdub.store.history.length);
    await E(() => { const R = document.querySelector('.gr').__gr; window.__gt.pressed = []; window.__gt.offPress = R.on('press', ({ id }) => window.__gt.pressed.push(id)); document.querySelector('.gr-ty-card').focus(); });
    await press(page, 'Enter');
    await wait(400);
    const pl = await E(() => { const o = window.overdub, last = o.store.history.at(-1); window.__gt.offPress(); return { places: window.__gt.places, pressed: window.__gt.pressed, h: o.store.history.length, by: last?.by, ops: (last?.ops || []).map((x) => x.type), sections: (o.store.get().sections || []).length }; });
    T.ok(pl.places.length === 1 && pl.places[0].id === k.r?.id && Number.isInteger(pl.places[0].where?.at) && pl.h === h1 + 1 && pl.by === 'you' && pl.ops.includes('clip.add') && pl.ops.includes('section.add') && !pl.pressed.length,
      `Enter on its card: the part line's place gets ${k.r?.name} at ${pl.places[0]?.where?.at} (after the selected part), and its part is one step by you (${pl.ops.join(', ')}); the room's keys pressed nothing else (${pl.pressed.join(', ') || 'no play-from'})`);
    await press(page, 'Meta+KeyZ');
    const un = await E(() => ({ h: window.overdub.store.history.length, sections: (window.overdub.store.get().sections || []).length }));
    T.ok(un.h === h1 && un.sections === pl.sections - 1, `⌘Z takes the part back out in one step (History ${un.h - h1}, sections ${pl.sections} then ${un.sections})`);
    // the drag
    const cardBox = await page.locator('.gr-ty-card').first().boundingBox(), partBox = await page.locator('.gr-parts').boundingBox();
    if (cardBox && partBox) {
      await page.mouse.move(cardBox.x + 40, cardBox.y + 30);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(cardBox.x + 40 + ((partBox.x + 80 - cardBox.x - 40) * i) / 8, cardBox.y + 30 + ((partBox.y + 40 - cardBox.y - 30) * i) / 8);
      await shot('drag');
      await page.mouse.up();
      await wait(400);
    }
    const dr = await E(() => ({ places: window.__gt.places, h: window.overdub.store.history.length, by: window.overdub.store.history.at(-1)?.by }));
    T.ok(dr.places.length === 2 && dr.places[1].where?.at === 0 && dr.h === h1 + 1 && dr.by === 'you', `a drag onto the part line: place at ${dr.places[1]?.where?.at} (no parts on it yet), one step by you`);
    await press(page, 'Meta+KeyZ');

    // the library
    await press(page, 'Shift+KeyL');
    await page.waitForFunction(() => document.querySelectorAll('.gr-lb-row').length > 0, null, { timeout: 8000 }).catch(() => {});
    const lb = await E(() => { const gr = window.overdub.ui.state.liveRoom.gr; return { overlay: gr.overlay, rows: [...document.querySelectorAll('.gr-lb-row .gr-lb-nm')].map((x) => x.textContent), song: document.querySelector('.gr-lb-row .gr-lb-sg')?.textContent, focus: document.activeElement?.className || '', h: document.querySelector('.gr-sheet[data-sheet="library"]')?.clientHeight, view: document.querySelector('.gr-view')?.clientHeight }; });
    T.ok(lb.overlay === 'library' && lb.rows[0] === k.r?.name && lb.song === 'this song' && /gr-lb-list/.test(lb.focus) && Math.abs(lb.h - lb.view) <= 2, `⇧L: the library over the whole view (${lb.h} of ${lb.view} px), ${lb.rows[0]} first, from this song, the list with the keys`);
    await shot('library');
    await page.fill('.gr-lb-q', 'zzzz no such riff');
    await wait(500);
    const none = await E(() => ({ rows: document.querySelectorAll('.gr-lb-row').length, empty: document.querySelector('.gr-lb-empty')?.textContent || '' }));
    await page.fill('.gr-lb-q', k.r?.name || 'Riff');
    await wait(500);
    const some = await E(() => document.querySelectorAll('.gr-lb-row').length);
    T.ok(none.rows === 0 && /No riff matches/.test(none.empty) && some >= 1, `a search: nothing for one that matches nothing ("${none.empty}"), ${some} for "${k.r?.name}"`);
    await page.focus('.gr-lb-list');
    await press(page, 'Home');
    await press(page, 'Enter');
    await wait(400);
    const lp = await E(() => ({ places: window.__gt.places.length, overlay: window.overdub.ui.state.liveRoom.gr.overlay, drawer: window.overdub.ui.state.liveRoom.gr.drawer, by: window.overdub.store.history.at(-1)?.by }));
    T.ok(lp.places === 3 && lp.overlay === null && lp.drawer, `Enter in the library: the riff onto the part line (place ${lp.places}), the library down and the drawer up`);
    await press(page, 'Meta+KeyZ');
    // Esc: out of the library, out of the tape's sheet with the camera
    await press(page, 'Shift+KeyL');
    await wait(300);
    await press(page, 'Escape');
    const e1 = await E(() => window.overdub.ui.state.liveRoom.gr.overlay);
    await press(page, 'KeyG');
    await wait(900);
    await press(page, 'Escape');
    await wait(300);
    const e2 = await E(() => { const gr = window.overdub.ui.state.liveRoom.gr; return { overlay: gr.overlay, cam: gr.cam }; });
    T.ok(e1 === null && e2.overlay === null && e2.cam === 'stage', `Esc steps back: out of the library (${e1}), out of the tape's sheet with the camera off the machine (${e2.cam})`);

    // Claude on the talkback: nobody, then the demo agent
    await E(() => { const gr = window.overdub.ui.state.liveRoom.gr; if (gr.drawer) document.querySelector('.gr').__gr.drawer(false); });
    await press(page, 'Slash');
    await wait(200);
    const t0 = await E(() => ({ overlay: window.overdub.ui.state.liveRoom.gr.overlay, line: document.querySelector('.lr-tb-text')?.textContent || '' }));
    T.ok(t0.overlay === null && /Nobody’s on the other side of the glass/.test(t0.line), `/ with nobody connected: it says so ("${t0.line}") and opens nothing`);
    await E(() => window.overdub.agent?.useMock?.(true));
    await press(page, 'Slash');
    await wait(300);
    await page.keyboard.type('hi r');
    const t1 = await E(() => ({ overlay: window.overdub.ui.state.liveRoom.gr.overlay, value: document.querySelector('.gr-tk-field')?.value, run: window.overdub.ui.state.liveRoom.run, focus: document.activeElement?.className || '' }));
    T.ok(t1.overlay === 'talk' && t1.value === 'hi r' && t1.run === 'idle' && /gr-tk-field/.test(t1.focus), `/ with Claude on: the field opens and takes the typing ("${t1.value}"; R didn't record: ${t1.run})`);
    await shot('talk');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    const ctxSent = await E(() => new Promise((res) => {
      const ag = window.overdub.agent, send = ag.send;
      ag.send = (q, o) => { ag.send = send; res({ q, context: o?.context || '' }); return send(q, o); };
      document.querySelector('.gr-tk-field').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.querySelector('.gr-tk-form').requestSubmit();
    }));
    await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 20000 }).catch(() => {});
    await wait(400);
    const t2 = await E(() => { const by = document.querySelector('.lr-tb-by .by'); return { overlay: window.overdub.ui.state.liveRoom.gr.overlay, line: document.querySelector('.lr-tb-line')?.textContent || '', by: by?.textContent || '', ink: by ? getComputedStyle(by).color : '', agent: getComputedStyle(document.documentElement).getPropertyValue('--agent').trim() }; });
    T.ok(ctxSent.q === 'hi' && /guitar room/.test(ctxSent.context) && /Tempo 120/.test(ctxSent.context) && /part line/.test(ctxSent.context), `Enter asks Claude "${ctxSent.q}" with the room as context (${ctxSent.context.split('\n').length} lines: the place, the tempo, the rig, the part line)`);
    T.ok(t2.overlay === null && t2.by === 'Claude' && t2.line.length > 0, `its reply comes into the talkback signed Claude (${t2.ink}; --agent ${t2.agent}): "${t2.line.slice(0, 80)}${t2.line.length > 80 ? '…' : ''}"`);
    // a click away from the open field: it goes, its words kept, and the room's keys are back
    await press(page, 'Slash');
    await wait(200);
    await page.keyboard.type('abc');
    await page.mouse.click(700, 24);
    await wait(150);
    const away = await E(() => ({ overlay: window.overdub.ui.state.liveRoom.gr.overlay, open: window.overdub.ui.state.liveRoom.gr.talk.open }));
    await press(page, 'KeyH');
    const cam = await E(() => window.overdub.ui.state.liveRoom.gr.cam);
    await press(page, 'Escape');
    await press(page, 'Slash');
    await wait(200);
    const kept = await E(() => document.querySelector('.gr-tk-field')?.value);
    await press(page, 'Escape');
    const shut = await E(() => ({ overlay: window.overdub.ui.state.liveRoom.gr.overlay, value: document.querySelector('.gr-tk-field')?.value }));
    T.ok(away.overlay === null && !away.open && cam === 'head' && kept === 'abc' && shut.overlay === null && shut.value === '', `a click away from the field closes it (overlay ${away.overlay}) and H reaches the room again (${cam}); / brings the words back ("${kept}"), Esc lets them go`);
    const ed = await E(async () => {
      const o = window.overdub, h = o.store.history.length, was = o.store.get().tempo;
      const r = await o.tools.run('apply_ops', { ops: [{ type: 'project.set', patch: { tempo: 140 } }], label: 'Tempo to 140', reason: 'they asked' }, { by: 'claude' });
      const last = o.store.history.at(-1);
      return { ok: !r.error, error: r.error, steps: o.store.history.length - h, by: last?.by, was, now: o.store.get().tempo };
    });
    await press(page, 'Meta+KeyZ');
    const back = await E(() => window.overdub.store.get().tempo);
    T.ok(ed.ok && ed.steps === 1 && ed.by === 'claude' && ed.now === 140 && back === ed.was, `an edit by Claude while the room is up: one step signed claude (${ed.was} → ${ed.now}), and ⌘Z puts it back (${back})${ed.error ? ': ' + ed.error : ''}`);

    // leaving the room: the tape it started stops
    const left2 = await E(async () => { const o = window.overdub; o.engine.stop(); o.liveRoom.close(); await new Promise((r) => setTimeout(r, 200)); return { rolling: o.input.tape.state.rolling, bytes: o.input.tape.state.bytes }; });
    T.ok(!left2.rolling && left2.bytes === 0, 'through the glass: the tape the room started is stopped and let go');
    const errs = errors.filter((e) => !IGNORE(e));
    T.ok(!errs.length, `the guitar room's tape: no console or page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await room.close();
  }
}
