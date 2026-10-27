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
import { openRoom, alignCount, history } from './harness.js';
import { session } from './fake.js';

export const name = 'tape';
export const pages = true;

const BPM = 120;
const RIFF = { bpm: BPM, beats: 8, chord: true, notes: [[0, 40, 0], [0.5, 40, 0], [1, 43, 1], [2.5, 40, 0], [3, 45, 0.5], [4, 40, 0], [4.75, 40, 0], [5.5, 47, 1], [7, 43, 0]] };
const IGNORE = (e) => /favicon|net::ERR|Failed to load resource|AudioContext was not allowed/i.test(e);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

export async function run(T, ctx) {
  if (!ctx.pages) return;
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
