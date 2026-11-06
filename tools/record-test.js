// Recording in the song (docs/research/RECORDING-UX.md, wave A2: app/src/input/recorder.js).
//   1. Node: the commit plans (planTake): Layer adds into the clip under the notes and makes clips only where there are
//      none; New take stacks passes as one take group (the last plays) and splits and mutes what it covers, in one undo
//      step; the loop pass map (passOf) across wraps.
//   2. The studio (Night Shift, 92 bpm, real key events against the running song): R at bar 5 with the count-in puts
//      notes at bar 5 (±1/32), a note in the count's last eighth on the downbeat; the New take mutes the covered part;
//      Layer over the demo's Beat adds into that clip; two loop passes give one clip (pads) or two takes (keys); the
//      punch ignores notes outside the loop; the killswitch during a take commits it; an agent's edit to the target
//      while recording is refused (and get_recording says so); a hum from a synthesized voice with the song playing
//      lands on its bar; the Inspector's input (device, channel 3 of a four-channel interface) is the one recorded;
//      Shift+R puts a played-along phrase in the song at its beats.
//   3. Fresh eyes 4, Node and the studio: a tune played on round the loop's end stays one take (joinSeams), a fragment
//      of a last pass never plays over a fuller one (pickActive), the toast says which, and Sketch's Takes lists each
//      pass once (the played phrase that went into the take isn't a second card).
//   3b. Overlapping takes: a mic take recorded for a part (tailFrom) keeps its ring past the part as its tail; the next
//      part's take goes over it without muting it; clip.trim cuts the ring back on the grid, ⌘Z puts it back.
//   4. Fresh eyes 5: takes are numbered in the order they were recorded (a complete first pass is Take 1 and plays, the
//      pass the stop cut short is Take 2); a note begun just before the loop comes round, in your own timing and held
//      over the wrap, is the next pass's downbeat, not a stub at the end of the pass before, and ⌘Z takes it out with
//      that pass ("(5 notes)").
//
// The Node sections (the commit plans, the pass map, the seam, where a take goes) are test/unit/record.test.js.
//   node tools/record-test.js
import { open, tally } from './pw.js';
import { snapGentle } from '../app/src/input/timing.js';
import { phrase, render as renderVoice } from './hum-bench.js';

const t = tally('record');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ 2. the studio */
const MIC_SHIM = `(() => {
  // the mic: a stream the test feeds (a synthesized voice; a two-input interface with a different tone on each input);
  // getUserMedia's constraints kept. (Chromium carries two channels through a page-made stream, not more.)
  window.__gum = [];
  window.__mic = null;
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => {
    window.__gum.push(JSON.parse(JSON.stringify(c)));
    const app = window.overdub; await app.engine.start();
    const ctx = app.engine.ctx;
    if (!window.__mic || window.__mic.ctx !== ctx) window.__mic = { ctx, merge: ctx.createChannelMerger(2) };
    // (a fresh stream each time: closing the input stops the last one's track)
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 2; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
    window.__mic.merge.connect(dest);
    return dest.stream;
  };
})();`;

const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.addInitScript(MIC_SHIM);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(async () => { const app = window.overdub; await app.engine.start(); app.ui.setOpen?.('bottom', true); });
  const ids = await page.evaluate(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  const tempo = await page.evaluate(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  // keydown beats as the page saw them (the audible beat at the event's timeStamp)
  await page.evaluate(() => { window.__kd = []; window.addEventListener('keydown', (e) => { const en = window.overdub.engine; window.__kd.push({ code: e.code, beat: en.playing ? en.beatAt(e.timeStamp) : null }); }, true); });
  const beatNow = () => page.evaluate(() => window.overdub.engine.beat);
  // wait until the audible beat (or, grid: the transport's unwrapped grid, across loop wraps) is `b` (a few ms early:
  // the key's own trip), then return it
  async function until(b, { grid = false } = {}) {
    for (let i = 0; i < 2000; i++) {
      const x = grid ? await page.evaluate(() => window.overdub.engine.gridBeat ?? -1e9) : await beatNow();
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  const state = () => page.evaluate(() => window.overdub.input.recorder.state);
  async function idle() { for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50); await page.waitForTimeout(80); }
  async function tapKey(code, ms = 120) { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); }
  const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
  const reset = () => page.evaluate(() => { const app = window.overdub; app.engine.stop(); while (app.store.canUndo()) app.store.undo(); });

  /* ---- R at bar 5, with the count-in, musical typing on Keys */
  // (every note, where its key went down: Scale lock and the grid, on by default for the keys, are sketch-rec-test's)
  await page.evaluate(() => { const q = window.overdub.input.qwerty; q.setScaleLock(false); q.setQuantize(false); });
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(16); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(150);
  const counting = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, b: window.overdub.engine.beat, c: window.overdub.engine.counting }));
  t.ok(counting.s === 'count' && counting.c && counting.c.until === 16, `R starts the count-in: the song pre-rolls from bar 4 with the click (state ${counting.s}, beat ${counting.b.toFixed(2)}, until ${counting.c?.until})`);
  await until(15.8);
  await tapKey('KeyD', 100);                         // E4 in the count's last eighth: the downbeat
  await until(16.5);
  await tapKey('KeyA', 200);                         // C4 on the "and" of beat 1
  await until(18);
  await tapKey('KeyG', 200);                         // G4 on beat 3
  const live = await page.evaluate(() => window.overdub.input.recorder.live());
  t.ok(live.state === 'rec' && live.passes.length === 1 && live.passes[0].notes.length === 3, `while it records, live() has the notes so far (${live.passes[0]?.notes.map((n) => n.p + '@' + n.t).join(' ')})`);
  await shot('record-mid-take');

  /* ---- an agent edit to the target while recording is refused; another track is fine */
  const agent = await page.evaluate(async ({ keys, bass }) => {
    const tools = window.overdub.tools;
    const a = await tools.run('apply_ops', { label: 'add a note', reason: 'test', ops: [{ type: 'notes.add', track: keys, clip: window.overdub.store.get().tracks.find((x) => x.id === keys).clips[0].id, notes: 'C5@0:1' }] }, { by: 'mcp:probe' });
    const b = await tools.run('apply_ops', { label: 'faster', reason: 'test', ops: [{ type: 'project.set', patch: { tempo: 120 } }] }, { by: 'mcp:probe' });
    const c = await tools.run('apply_ops', { label: 'bass down', reason: 'test', ops: [{ type: 'track.set', track: bass, patch: { gain: -2 } }] }, { by: 'mcp:probe' });
    const g = await tools.run('get_recording', {}, { by: 'mcp:probe' });
    return { a, b, c, g, state: window.overdub.input.recorder.state };
  }, { keys: ids.Keys, bass: ids.Bass });
  t.ok(agent.a.error === 'recording' && /recording on Keys \(bars 1–8\)/.test(agent.a.hint), `an agent's edit to Keys while it records is refused: ${agent.a.error}: "${agent.a.hint}"`);
  t.ok(agent.b.error === 'recording' && agent.state === 'rec', 'so is a tempo change (the timeline), and the take keeps going');
  t.ok(!agent.c.error && agent.c.ok !== false, 'an edit to another track (Bass) goes through');
  t.ok(agent.g.state === 'rec' && agent.g.tracks?.[0]?.name === 'Keys' && agent.g.tracks[0].mode === 'take' && agent.g.from.bar === 5 && agent.g.notes_so_far === 3, `get_recording: ${JSON.stringify({ state: agent.g.state, tracks: agent.g.tracks, from: agent.g.from, pass: agent.g.pass, notes: agent.g.notes_so_far })}`);

  await page.keyboard.press('Space');
  await idle();
  const kd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyA' || x.code === 'KeyG'));
  const take1 = await page.evaluate((k) => {
    const app = window.overdub, tr = app.store.track(k), last = app.input.recorder.last;
    return { last: { ok: last.ok, label: last.label, summary: last.summary }, clips: tr.clips.map((c) => ({ id: c.id, start: c.start, length: c.length, mute: !!c.mute, take: c.take || null, notes: c.notes.map((n) => ({ p: n.p, t: n.t, by: n.by })), by: c.by })), playing: app.engine.playing, hist: app.store.history.slice(-1).map((x) => ({ by: x.by, label: x.label })) };
  }, ids.Keys);
  const tk = take1.clips.find((c) => c.take && !c.mute);
  const songBeat = (p) => tk.start + (tk.notes.find((n) => n.p === p)?.t ?? NaN);
  t.ok(tk && tk.start === 16 && near(songBeat(64), 16, 1e-6), `the note in the count's last eighth lands on the downbeat of bar 5 (E4 at beat ${songBeat(64)})`);
  // (the test presses a key from outside the page, a few ms off its aim; where the page heard the key go down is the truth)
  t.ok(Math.floor(songBeat(60) / 4) === 4 && Math.floor(songBeat(67) / 4) === 4 && near(songBeat(60), kd[0]?.beat, 1 / 32) && near(songBeat(67), kd[1]?.beat, 1 / 32), `the notes land in bar 5 where they were played, within 1/32: C4 at ${songBeat(60).toFixed(3)} (its key went down at ${kd[0]?.beat?.toFixed(3)}; aimed at 16.5), G4 at ${songBeat(67).toFixed(3)} (${kd[1]?.beat?.toFixed(3)}; aimed at 18)`);
  t.ok(near(songBeat(60), kd[0]?.beat, 0.005) && near(songBeat(67), kd[1]?.beat, 0.005), `each note sits where its key went down, to 5 ms of a beat (the event's timeStamp, not when the page got to it: ${(Math.abs(songBeat(60) - kd[0]?.beat) * 60000 / tempo).toFixed(1)} ms, ${(Math.abs(songBeat(67) - kd[1]?.beat) * 60000 / tempo).toFixed(1)} ms)`);
  const covered = take1.clips.filter((c) => c.take === tk.take && c.mute);
  t.ok(tk.length === 4 && covered.length === 1 && covered[0].start === 16 && covered[0].length === 4 && take1.clips.some((c) => c.start === 0 && c.length === 16 && !c.mute && !c.take) && take1.clips.some((c) => c.start === 20 && c.length === 12 && !c.mute && !c.take), `New take: played in bar 5 and stopped in it, the take is bar 5 and only bar 5 of Changes is muted; bars 1–4 and 6–8 play on (${take1.clips.map((c) => `${c.start}+${c.length}${c.mute ? ' muted' : ''}`).join(', ')})`);
  t.ok(take1.hist[0].by === 'you' && take1.hist[0].label === 'record take 2 on Keys' && !take1.playing, `one undo step by you ("${take1.hist[0].label}"); Space stopped the song`);
  t.ok(/Take 2 is in on Keys, bar 5; \S.* is muted\. Undo takes it back\./.test(await lastToast()), `the toast: "${await lastToast()}"`);
  const cap = await page.evaluate(() => window.overdub.input.capture.list().find((x) => x.rec));
  t.ok(cap && cap.notes.length === 3 && cap.beat === 16 && /^tk_/.test(cap.take) && cap.pass === 0, `the pass is in capture too (Sketch's Takes), marked in the song (${cap && cap.notes.length} notes from beat ${cap && cap.beat}, ${cap && cap.take} pass ${cap && cap.pass})`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- Layer over the demo's Beat: pads into that clip */
  const beatBefore = await page.evaluate((d) => { const tr = window.overdub.store.track(d); return { clips: tr.clips.length, notes: tr.clips[0].notes.length, id: tr.clips[0].id }; }, ids.Drums);
  await page.evaluate((d) => { const app = window.overdub; app.ui.select({ track: d }); app.engine.seek(4); app.ui.show('sketch'); }, ids.Drums);
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyR');
  await until(4.5); await tapKey('KeyJ', 60);       // snare on the "and" of beat 1, bar 2 (the Beat has none there)
  await until(5.25); await tapKey('KeyL', 60);      // open hat on the second sixteenth of beat 2
  await page.waitForTimeout(150);
  const heard = await page.evaluate((d) => window.overdub.store.track(d).clips[0].notes.length, ids.Drums);
  await page.keyboard.press('Space');
  await idle();
  const beatAfter = await page.evaluate((d) => { const app = window.overdub, tr = app.store.track(d), c = tr.clips[0]; return { clips: tr.clips.length, notes: c.notes.length, id: c.id, mine: c.notes.filter((n) => n.by === 'you').map((n) => n.p + '@' + n.t), label: app.store.history.slice(-1)[0]?.label, hist: app.store.history.length }; }, ids.Drums);
  t.ok(beatAfter.clips === 1 && beatAfter.id === beatBefore.id && beatAfter.notes === beatBefore.notes + 2, `Layer: the hits go into the Beat clip, no second clip (${beatBefore.notes} → ${beatAfter.notes} notes; yours: ${beatAfter.mine.join(' ')})`);
  const padKd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyJ' || x.code === 'KeyL').slice(-2));
  // (the pads' forgiving grid: an eighth when near one, else the sixteenth; input/timing.js)
  const q16 = (b) => snapGentle(b, { coarse: 0.5, fine: 0.25 });
  const wantPads = [`38@${q16(padKd[0]?.beat)}`, `46@${q16(padKd[1]?.beat)}`];
  t.ok(wantPads.every((x) => beatAfter.mine.includes(x)) && beatAfter.label === 'record Drums' && beatAfter.hist === 1, `quantized on input, forgivingly (an eighth when near one, else the 1/16 cell: ${wantPads.join(' ')}: played at ${padKd.map((x) => x.beat?.toFixed(3)).join(', ')}), signed by you, one undo step ("${beatAfter.label}")`);
  t.ok(heard === beatBefore.notes + 2, 'while recording, each hit was already in the clip (heard on the next pass), out of the history');
  t.ok(/Your beat is in: bar 2, 2 hits on Drums\./.test(await lastToast()), `your own hits and their own bars: "${await lastToast()}"`);
  await reset();

  /* ---- two loop passes: one clip (pads), two takes (keys) */
  await page.evaluate(() => { const app = window.overdub; app.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 4 } } }, { type: 'track.add', ref: 'd', track: { name: 'Kit', instrument: { device: 'core.drums' } } }], { by: 'you', label: 'setup' }); });
  const kit = await page.evaluate(() => window.overdub.store.get().tracks.find((x) => x.name === 'Kit').id);
  await page.evaluate((d) => { const app = window.overdub; app.store.dispatch({ type: 'track.set', track: d, patch: { arm: true } }, { by: 'you' }); app.engine.seek(0); }, kit);
  await page.keyboard.press('KeyR');                // count-in below bar 1: clicks alone
  const below = await page.evaluate(() => { const c = window.overdub.engine.counting; return { beat: window.overdub.engine.beat, c }; });
  await until(1, { grid: true }); await tapKey('KeyF', 60);     // pass 1: kick on beat 2
  await until(6, { grid: true }); await tapKey('KeyJ', 60);     // pass 2 (grid 6 = song beat 2): snare on beat 3
  await until(8.5, { grid: true }); await tapKey('KeyK', 60);   // pass 3: hat on beat 1's "and"
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  await idle();
  const pads = await page.evaluate((d) => { const app = window.overdub, tr = app.store.track(d); return tr.clips.map((c) => ({ start: c.start, length: c.length, take: c.take || null, notes: c.notes.map((n) => n.p + '@' + n.t) })); }, kit);
  t.ok(below.c && below.c.from === -4 && below.beat < 0.01, `below bar 1 the count is clicks alone, from beat -4 (beat ${below.beat.toFixed(2)})`);
  const loopKd = await page.evaluate(() => window.__kd.filter((x) => ['KeyF', 'KeyJ', 'KeyK'].includes(x.code)).slice(-3));
  const P_OF = { KeyF: 36, KeyJ: 38, KeyK: 42 };
  const wantLoop = loopKd.map((x) => ({ p: P_OF[x.code], t: snapGentle(x.beat, { coarse: 0.5, fine: 0.25 }) })).sort((a, b) => a.t - b.t || a.p - b.p).map((n) => n.p + '@' + n.t).join(' ');
  t.ok(pads.length === 1 && pads[0].start === 0 && pads[0].length === 4 && pads[0].notes.join(' ') === wantLoop, `pads, three passes of a one-bar loop: one clip with every pass layered (${JSON.stringify(pads)}; played ${loopKd.map((x) => x.beat?.toFixed(2)).join(', ')} in passes 1-3)`);
  // keys: two passes, two takes
  await page.evaluate(({ d, k }) => { const app = window.overdub; app.store.dispatch([{ type: 'track.set', track: d, patch: { arm: false } }, { type: 'track.set', track: k, patch: { arm: true } }], { by: 'you' }); app.engine.seek(0); }, { d: kit, k: ids.Keys });
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(1, { grid: true }); await tapKey('KeyA', 150);    // pass 1: C4
  await until(5, { grid: true }); await tapKey('KeyS', 150);    // pass 2: D4
  await until(7.5, { grid: true });
  await page.keyboard.press('Space');
  await idle();
  const keysTakes = await page.evaluate((k) => { const tr = window.overdub.store.track(k); return tr.clips.map((c) => ({ start: c.start, length: c.length, mute: !!c.mute, take: c.take || null, name: c.name, notes: c.notes.length > 4 ? c.notes.length : c.notes.map((n) => n.p + '@' + Math.round(n.t * 16) / 16) })); }, ids.Keys);
  const grp = keysTakes.filter((c) => c.take);
  t.ok(grp.length === 3 && grp.filter((c) => !c.mute).length === 1 && /^\["60@/.test(JSON.stringify(grp.find((c) => !c.mute).notes)) && grp.some((c) => c.mute && /^\["62@/.test(JSON.stringify(c.notes))) && grp.every((c) => c.start === 0 && c.length === 4), `keys, a pass and then one cut short by Space: the complete pass (C4) plays, the cut-short one (D4) and the covered bar are kept under it, muted (${grp.map((c) => `${c.name}${c.mute ? ' muted' : ''} ${JSON.stringify(c.notes)}`).join('; ')})`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- Fold: three passes, a kick played in one only is left out, and the toast counts it. A drum track's default is
     Layer (Q-F: AJ chose layer, 2026-10-11), so the track is set to Fold, as a person picks it in Sketch's Each pass */
  await page.evaluate(() => { const app = window.overdub; app.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 4 } } }, { type: 'track.add', ref: 'd', track: { name: 'Kit', instrument: { device: 'core.drums' } } }], { by: 'you', label: 'setup' }); });
  const kit2 = await page.evaluate(() => window.overdub.store.get().tracks.find((x) => x.name === 'Kit').id);
  const fmode = await page.evaluate((d) => { const app = window.overdub; app.store.dispatch({ type: 'track.set', track: d, patch: { arm: true } }, { by: 'you' }); app.input.setMode('tap'); app.engine.seek(0); return app.input.recorder.setMode(d, 'fold'); }, kit2);
  await page.keyboard.press('KeyR');
  for (const [b, k] of [[1, 'KeyF'], [2, 'KeyJ'], [5, 'KeyF'], [6, 'KeyJ'], [7, 'KeyF'], [9, 'KeyF'], [10, 'KeyJ']]) { await until(b, { grid: true }); await tapKey(k, 50); }
  await until(11.5, { grid: true });
  await page.keyboard.press('Space');
  await idle();
  const fk = await page.evaluate((d) => { const app = window.overdub, tr = app.store.track(d); return { clips: tr.clips.map((c) => c.notes.map((n) => n.p + '@' + n.t).join(' ')), last: app.input.recorder.last, show: !!document.querySelector('.ew-toast .rec-show'), hist: app.store.history.slice(-1)[0]?.label }; }, kit2);
  const fToast = await lastToast();
  const fkd = await page.evaluate(() => window.__kd.filter((x) => ['KeyF', 'KeyJ'].includes(x.code)).slice(-7).map((x) => x.beat?.toFixed(2)).join(' '));
  t.ok(fmode === 'fold' && fk.clips.length === 1 && fk.clips[0] === '36@1 38@2' && fk.hist === 'record Kit', `Fold: three passes, the kick on 4 played once is left out, the rest kept where it's in two of three or more (${fk.clips.join(' | ')}; played at ${fkd})`);
  t.ok(/Kept 2; left out 1\..*Show them/.test(fToast) && fk.show, `the toast counts it, with Show them ("${fToast.slice(0, 140)}")`);
  await reset();

  /* ---- the punch: the loop is the punch range (notes before it are left out of the take, kept in capture) */
  await page.evaluate((k) => { const app = window.overdub; app.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 8, end: 12 } } }, { by: 'you' }); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(0); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(5); await tapKey('KeyA', 150);        // bar 2: before the loop (pre-roll)
  const pre = await state();
  await until(9); await tapKey('KeyG', 150);        // bar 3: in the loop
  await until(10.5);
  await page.keyboard.press('Space');
  await idle();
  const punch = await page.evaluate((k) => { const app = window.overdub; app.input.capture.flush(); const tr = app.store.track(k), c = tr.clips.find((x) => x.take && !x.mute); const cap = app.input.capture.list().filter((x) => !x.rec && (x.notes || []).some((n) => n.p === 60)).length; return { clip: c && { start: c.start, length: c.length, notes: c.notes.filter((n) => n.by === 'you').map((n) => n.p + '@' + Math.round(n.t * 16) / 16), fill: c.notes.filter((n) => n.by !== 'you').every((n) => c.start + n.t >= 10.4) }, cap }; }, ids.Keys);
  t.ok(pre === 'count' && punch.clip && punch.clip.start === 8 && punch.clip.length === 4 && punch.clip.notes.length === 1 && /^67@/.test(punch.clip.notes[0]) && punch.clip.fill, `punch: from bar 2 with the loop on bar 3, the pre-roll's C4 is left out; the take is bar 3 with G4 only, what played there before going on after the stop (${JSON.stringify(punch.clip)}; state before the loop: ${pre})`);
  t.ok(punch.cap >= 1, 'the note outside the loop is still in capture (never lose an idea)');
  await page.keyboard.press('Backquote');
  await page.evaluate(() => window.overdub.input.recorder.setCountIn(1));
  await reset();

  /* ---- the killswitch during a take commits it */
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(16); }, ids.Keys);
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyR');
  await until(16.25); await tapKey('KeyA', 150);
  await until(17); await tapKey('KeyF', 150);
  await page.keyboard.press('Shift+Escape');
  await idle();
  const kill = await page.evaluate((k) => { const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((x) => x.take && !x.mute); return { playing: app.engine.playing, clip: c && c.notes.filter((n) => n.by === 'you').map((n) => n.p), last: app.input.recorder.last?.why }; }, ids.Keys);
  t.ok(!kill.playing && kill.last === 'silence' && JSON.stringify(kill.clip) === '[60,65]', `Shift+Esc silences and keeps the take (${JSON.stringify(kill)})`);
  t.ok(/^Silenced\. Take 2 kept on Keys \(bar 5\)\./.test(await lastToast()), `"${await lastToast()}"`);
  await page.keyboard.press('Backquote');
  await reset();

  /* ---- Shift+R: Put it in the song (a phrase played along, not recording) */
  await page.evaluate((b) => { const app = window.overdub; app.ui.select({ track: b }); app.engine.play(8); }, ids.Bass);
  await page.keyboard.press('Backquote');
  await until(9); await tapKey('KeyA', 150);
  await until(10); await tapKey('KeyD', 150);
  await page.keyboard.press('Backquote');
  await page.evaluate(() => window.overdub.engine.stop());
  await page.keyboard.press('Shift+KeyR');
  await page.waitForTimeout(100);
  const put = await page.evaluate((b) => { const app = window.overdub, tr = app.store.track(b), c = tr.clips.find((x) => x.by === 'you'); return { start: c.start, notes: c.notes.map((n) => ({ p: n.p, t: n.t })), label: app.store.history.slice(-1)[0]?.label }; }, ids.Bass);
  const putKd = await page.evaluate(() => window.__kd.filter((x) => x.code === 'KeyA' || x.code === 'KeyD').slice(-2));
  t.ok(put.start === 8 && put.notes.map((n) => n.p).join() === '60,64' && put.notes.every((n, i) => near(put.start + n.t, putKd[i]?.beat, 0.04)), `Shift+R puts what you just played in the song at the beats you played it (${put.notes.map((n, i) => `${n.p}@${(put.start + n.t).toFixed(3)} (played ${putKd[i]?.beat?.toFixed(3)})`).join(', ')}; "${put.label}")`);
  t.ok(/Put in the song: 2 notes on Bass at bar 3, where you played them\./.test(await lastToast()), `"${await lastToast()}"`);
  await reset();

  /* ---- a hum from a synthesized voice, with the song playing, into a take: lands on its bar */
  const ph = phrase([{ m: 57, beats: 1 }, { m: 60, beats: 1 }, { m: 64, beats: 2 }], { tempo, style: 'hum', range: 'tenor', seed: 5 });
  const voice = renderVoice(ph, 48000);
  const lead = ph.notes[0].t0;    // seconds before the first note
  const hum = await page.evaluate(async ({ k, x, lead }) => {
    const app = window.overdub, en = app.engine, ctx = en.ctx;
    app.ui.select({ track: k });
    app.engine.seek(4);
    await app.input.audio.open();                          // the shim's stream
    await app.input.recorder.record({ countIn: 0 });
    await new Promise((r) => setTimeout(r, 200));
    await app.input.toggleHum();                           // H, in the take
    const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const mic = window.__mic; src.connect(mic.merge, 0, 0);
    // sung so its first note is heard on bar 3 (beat 8)
    const spb = 60 / app.store.get().tempo, at = ctx.currentTime + (8 - en.beat) * spb - lead;
    src.start(at);
    await new Promise((r) => setTimeout(r, (at - ctx.currentTime + x.length / 48000 + 0.3) * 1000));
    const rec = app.input.hum.recording;
    const res = await app.input.recorder.stop();
    const tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute);
    return { rec, ok: res && res.ok, clip: c && { start: c.start, notes: c.notes.map((n) => ({ p: n.p, t: n.t, d: n.d })) } };
  }, { k: ids.Keys, x: Array.from(voice.x), lead });
  const hn = hum.clip ? hum.clip.notes : [];
  const first = hn.length ? hum.clip.start + hn[0].t : NaN;
  t.ok(hum.rec && hum.ok && hn.map((n) => n.p).join(',') === '57,60,64', `a hum (A3 C4 E4) sung with the song playing goes into the take (${hn.map((n) => n.p).join(',')})`);
  t.ok(Math.floor(first / 4) + 1 === 3 && near(first, 8, 0.125), `and lands on its bar: bar 3, its first note at beat ${first} (sung at 8)`);
  await reset();

  /* ---- fresh eyes 2: hum into the song on the natural path */
  // sing the voice so its first note is heard at song beat `b` (once the transport moves)
  const singAt = (b) => page.evaluate(async ({ x, lead, b }) => {
    const app = window.overdub, en = app.engine, ctx = en.ctx;
    for (let i = 0; i < 200 && !(en.playing && en.beat > -3.9); i++) await new Promise((r) => setTimeout(r, 25));
    const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(window.__mic.merge, 0, 0);
    const spb = 60 / app.store.get().tempo, at = ctx.currentTime + (b - en.beat) * spb - lead;
    src.start(at);
    return true;
  }, { x: Array.from(voice.x), lead, b });
  const humTake = (k) => page.evaluate((k) => { const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.by === 'you' && y.notes.some((n) => n.by === 'you')); return { toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '', clip: c && { start: c.start, length: c.length, notes: c.notes.map((n) => ({ p: n.p, t: c.start + n.t, d: n.d })) }, hum: app.input.hum.active, rec: app.input.recorder.state }; }, k);
  // 1. In Hum it, R: the count-in, then the mic into the song; Space while the last note still sounds keeps it
  await page.evaluate((k) => { const app = window.overdub; app.ui.show('sketch'); app.input.emit('sketch:mode', 'hum'); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(1); }, ids.Keys);
  const humMode = await page.evaluate(() => window.overdub.input.sketchMode);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  const humOn = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording, c: !!window.overdub.engine.counting }));
  await singAt(8);
  await until(11);                                   // E4 runs 10..12: still sounding
  await page.keyboard.press('Space');
  await idle();
  await page.waitForTimeout(300);
  const h1 = await humTake(ids.Keys);
  const h1n = h1.clip ? h1.clip.notes.filter((n) => n.t >= 8) : [];
  t.ok(humMode === 'hum' && humOn.s === 'count' && humOn.c && humOn.hum && humOn.rec, `in Hum it, R counts in and opens the mic into the take (${JSON.stringify(humOn)})`);
  t.ok(h1n.map((n) => n.p).join(',') === '57,60,64' && near(h1n[0].t, 8, 0.125) && h1.clip.start === 4 && /Take \d+ is in on Keys/.test(h1.toast), `the hum lands in the song at the beats it was sung, the note still sounding at Space kept (${h1n.map((n) => `${n.p}@${n.t}`).join(' ')}; clip from ${h1.clip?.start}; "${h1.toast}")`);
  await reset();
  // 2. H, then R: the hum already going is the take's; what was drawn lands on Space
  await page.evaluate((k) => { const app = window.overdub; app.ui.select({ track: k }); app.engine.seek(4); }, ids.Keys);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(300);
  const h2pre = await page.evaluate(() => ({ hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording }));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  const h2mid = await page.evaluate(() => ({ s: window.overdub.input.recorder.state, rec: window.overdub.input.hum.recording }));
  await singAt(8);
  await until(12.5);
  await page.keyboard.press('Space');
  await idle();
  await page.waitForTimeout(300);
  const h2 = await humTake(ids.Keys);
  const h2n = h2.clip ? h2.clip.notes.filter((n) => n.t >= 8) : [];
  t.ok(h2pre.hum && !h2pre.rec && h2mid.rec && h2n.map((n) => n.p).join(',') === '57,60,64' && near(h2n[0].t, 8, 0.125) && !h2.hum, `H, then R: the hum joins the take and lands on Space, not just in Sketch (${JSON.stringify({ pre: h2pre, mid: h2mid })}; ${h2n.map((n) => `${n.p}@${n.t}`).join(' ')}; "${h2.toast}")`);
  await reset();
  // 3. H while the song plays (not recording), then keep: at the beats it was sung, not at the marker
  await page.evaluate(() => { const app = window.overdub; app.engine.seek(0); app.engine.play(4); });
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyH');
  await singAt(10);
  await until(14.5);
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(400);
  const h3 = await page.evaluate((b) => {
    const app = window.overdub; app.engine.stop();
    const tk = app.input.hum.take; if (!tk || !tk.capture) return { none: true, beat: tk && tk.beat };
    const r = app.input.capture.keep(tk.capture, { track: b });
    const c = r.ok ? app.store.clip(r.track, r.clip) : null;
    return { beat: tk.beat, notes: c ? c.notes.map((n) => ({ p: n.p, t: c.start + n.t })) : [], marker: app.transport?.marker?.beat };
  }, ids.Bass);
  t.ok(!h3.none && h3.notes.length >= 3 && near(h3.notes[0].t, 10, 0.125) && h3.notes[0].p === 57, `H during playback: the hum is kept at the beats it was sung (first note at ${h3.notes[0]?.t}, sung at 10; the marker at ${h3.marker})`);
  await reset();
  // 4. fresh eyes 5: a hum recorded with R is moved into the song's key as a hum on its own is, and says so the same
  // way: "Moved 1 note into A minor, the song's key." with Undo, which puts the note back as sung in the take (one undo
  // step of its own, the take still in) and turns Snap off for the hums after. (A3 C#4 E4: C# is outside A minor)
  {
    const sharp = phrase([{ m: 57, beats: 1 }, { m: 61, beats: 1 }, { m: 64, beats: 2 }], { tempo, style: 'hum', range: 'tenor', seed: 5 });
    const sv = renderVoice(sharp, 48000);
    await page.evaluate(() => { for (const x of document.querySelectorAll('.ew-toast')) x.remove(); });
    await page.evaluate((k) => { const app = window.overdub; app.ui.show('sketch'); app.input.emit('sketch:mode', 'hum'); app.ui.select({ track: k }); app.engine.seek(4); app.input.recorder.setCountIn(1); app.input.options.snapKey = true; }, ids.Keys);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(200);
    await page.evaluate(async ({ x, lead, b }) => {
      const app = window.overdub, en = app.engine, ctx = en.ctx;
      for (let i = 0; i < 200 && !(en.playing && en.beat > -3.9); i++) await new Promise((r) => setTimeout(r, 25));
      const buf = ctx.createBuffer(1, x.length, 48000); buf.copyToChannel(Float32Array.from(x), 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(window.__mic.merge, 0, 0);
      src.start(ctx.currentTime + (b - en.beat) * (60 / app.store.get().tempo) - lead);
    }, { x: Array.from(sv.x), lead: sharp.notes[0].t0, b: 8 });
    await until(12.5);
    await page.keyboard.press('Space');
    await idle();
    await page.waitForTimeout(300);
    const mv = await page.evaluate((k) => {
      const app = window.overdub, tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      const toasts = [...document.querySelectorAll('.ew-toast')].map((x) => ({ text: x.querySelector('.ew-toast-text')?.textContent || '', act: x.querySelector('.ew-toast-act')?.textContent || '' }));
      return { toasts, hist: app.store.history.length, notes: c ? c.notes.filter((n) => c.start + n.t >= 8).map((n) => n.p) : [], take: app.input.hum.take && { rec: app.input.hum.take.rec, moved: app.input.hum.take.result?.moved.length } };
    }, ids.Keys);
    const said = mv.toasts.find((x) => /^Moved/.test(x.text));
    t.ok(mv.take?.rec && mv.take.moved === 1 && mv.notes.length === 3 && mv.notes[0] === 57 && [60, 62].includes(mv.notes[1]) && mv.notes[2] === 64, `in Hum it, R: the hummed C#4 goes into the take moved into A minor (${mv.notes.join(', ')})`);
    t.ok(said && said.text === 'Moved 1 note into A minor, the song’s key.' && said.act === 'Undo' && mv.toasts.some((x) => /^Take \d+ is in on Keys/.test(x.text)), `and the take says so, as a hum on its own does: "${said?.text}" [${said?.act}], beside "${mv.toasts.find((x) => /^Take/.test(x.text))?.text || 'no take toast'}" (${mv.toasts.map((x) => x.text).join(' | ')})`);
    const un = await page.evaluate(async (k) => {
      const app = window.overdub, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('.ew-toast')].find((x) => /^Moved/.test(x.textContent.trim()))?.querySelector('.ew-toast-act');
      const h0 = app.store.history.length;
      b?.click();
      await wait(150);
      const tr = app.store.track(k), c = tr.clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      const top = app.store.history[app.store.history.length - 1];
      const out = { clicked: !!b, steps: app.store.history.length - h0, label: top?.label, by: top?.by, notes: c ? c.notes.filter((n) => c.start + n.t >= 8).map((n) => n.p) : [], snap: app.input.options.snapKey, said: document.querySelector('.ew-announce')?.textContent || '', status: document.querySelector('[data-panel="sketch"] .sk-status')?.textContent || '' };
      app.store.undo();
      const c2 = app.store.track(k).clips.find((y) => y.take && !y.mute && y.notes.some((n) => n.by === 'you'));
      out.undone = c2 ? c2.notes.filter((n) => c2.start + n.t >= 8).map((n) => n.p) : [];
      app.input.options.snapKey = true;
      return out;
    }, ids.Keys);
    t.ok(un.clicked && un.steps === 1 && un.by === 'you' && /back as sung/.test(un.label || '') && un.notes.join() === '57,61,64' && un.snap === false && /Back as you sang it/.test(un.said), `its Undo puts the note back as sung in the take (${un.notes.join(', ')}), one step of its own ("${un.label}"), and Snap is off for the next hum ("${un.said}")`);
    t.ok(mv.notes.length === 3 && un.undone.join() === mv.notes.join(), `and ⌘Z on that step puts the take back as it went in (${un.undone.join(', ')})`);
    await reset();
  }
  await page.evaluate(() => window.overdub.input.emit('sketch:mode', 'play'));

  /* ---- the Inspector's input: the device, and which input of the interface */
  await page.evaluate(() => {
    const mic = window.__mic, ctx = mic.ctx;
    const tone = (hz, ch) => { const o = ctx.createOscillator(); o.frequency.value = hz; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, ch); o.start(); return o; };
    window.__toneNodes = [tone(220, 0), tone(440, 1)];   // input 1: 220 Hz, input 2: 440 Hz
  });
  await page.evaluate((g) => { const app = window.overdub; app.input.audio.close(); app.ui.select({ track: g }); app.ui.setOpen?.('left', true); app.ui.show('inspector'); }, ids.Guitar);
  await page.waitForSelector('select[aria-label="Input channel"]', { timeout: 5000 });
  const devOpts = await page.evaluate(() => [...document.querySelector('select[aria-label="Input device"]').options].map((o) => o.value));
  const dev = devOpts.find((v) => v && v !== 'default') || null;
  // one take on the input the Inspector names: -> { hz, pk, secs, start } of what was recorded, or { none }
  async function takeOn(channel) {
    // (the Inspector redraws after a take lands: pick until the track says so)
    for (let i = 0; i < 10; i++) {
      await page.selectOption('select[aria-label="Input channel"]', String(channel));
      await page.waitForTimeout(80);
      if (await page.evaluate(({ g, ch }) => +window.overdub.store.track(g).input?.channel === ch, { g: ids.Guitar, ch: channel })) break;
    }
    await page.evaluate((g) => { window.__gum.length = 0; const app = window.overdub; app.ui.select({ track: g }); app.engine.seek(16); }, ids.Guitar);
    const n0 = await page.evaluate((g) => window.overdub.store.track(g).clips.length, ids.Guitar);
    await page.keyboard.press('KeyR');
    await until(19);
    await page.keyboard.press('Space');
    await idle();
    return page.evaluate(async ({ g, n0 }) => {
      const app = window.overdub, tr = app.store.track(g), st = app.input.audio.state;
      const out = { input: tr.input, gum: window.__gum.map((x) => x.audio), channel: st.channel, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '' };
      if (tr.clips.length === n0) return { ...out, none: true };
      const c = tr.clips.filter((x) => x.kind === 'audio' && !x.mute).pop(), buf = await app.engine.assets.get(c.asset), d = buf.getChannelData(0);
      let pk = 0, zc = 0; for (let i = 1; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++; }
      return { ...out, pk, hz: Math.round(zc / 2 / buf.duration), secs: buf.duration, start: c.start };
    }, { g: ids.Guitar, n0 });
  }
  if (dev) await page.selectOption('select[aria-label="Input device"]', dev);
  const in2 = await takeOn(2);
  t.ok(in2.input && in2.input.channel === 2 && (!dev || in2.input.device === dev), `the Inspector sets Guitar's input (${JSON.stringify(in2.input)})`);
  t.ok(in2.gum[0] && (!dev || in2.gum[0].deviceId?.exact === dev), `R opens the device the Inspector names (${JSON.stringify(in2.gum[0] && in2.gum[0].deviceId)})`);
  t.ok(!in2.none && in2.pk > 0.2 && Math.abs(in2.hz - 440) < 15 && in2.start >= 16 && in2.secs > 1.5, `and records its input 2: the 440 Hz on it, not input 1's 220 Hz (${in2.hz} Hz, peak ${in2.pk?.toFixed(2)}, ${in2.secs?.toFixed(2)} s from beat ${in2.start})`);
  const in1 = await takeOn(1);
  t.ok(!in1.none && Math.abs(in1.hz - 220) < 15, `input 1 records input 1 (${in1.hz} Hz; ${JSON.stringify({ input: in1.input, gum: in1.gum.length, channel: in1.channel })})`);
  // input 3 of an interface: the device is asked for that many channels, and a channel it doesn't have is silence
  // (never input 1 instead)
  const in3 = await takeOn(3);
  t.ok(in3.gum[0] && in3.gum[0].channelCount?.ideal >= 3 && in3.channel === '3', `input 3: the device is opened asking for 3 channels or more (${JSON.stringify(in3.gum[0] && in3.gum[0].channelCount)}; split to input ${in3.channel})`);
  t.ok(in3.none && /Nothing came in on input 3/.test(in3.toast), `and a two-input device has no input 3: nothing is recorded, rather than input 1 ("${in3.toast}")`);
  await page.evaluate(() => { for (const n of window.__toneNodes || []) { try { n.stop(); } catch { /* ok */ } } });

  /* ---- a plugged-in interface shows up without a reload */
  const dc = await page.evaluate(async () => {
    let got = null;
    const off = window.overdub.input.on('devices', (l) => { got = l; });
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise((r) => setTimeout(r, 300));
    off();
    return got && got.length;
  });
  t.ok(dc > 0, `devicechange: the input list is read again and announced (${dc} inputs)`);

  const own = errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
  t.ok(!own.length, `no page errors${errors.length ? ` from recording (others' in-flight panels: ${errors.length - own.length})` : ''}${own.length ? ': ' + own.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  t.ok(false, 'the studio run threw: ' + (e && e.stack || e));
}
await close();

/* ------------------------------------------------------------------ 3. the studio: fresh eyes 3 (a take's edges) */
{
  const s3 = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page } = s3;
  try {
    await page.addInitScript(MIC_SHIM);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const ev = (fn, a) => page.evaluate(fn, a);
    await ev(async () => { await window.overdub.engine.start(); });
    const wait = (ms) => page.waitForTimeout(ms);
    const grid = () => ev(() => window.overdub.engine.gridBeat ?? -1);
    const untilG = async (b) => { for (let i = 0; i < 1500; i++) { const x = await grid(); if (x >= b) return x; await wait(Math.max(5, Math.min(120, (b - x) * 300))); } return null; };
    const idleR = async () => { for (let i = 0; i < 100 && (await ev(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await wait(50); await wait(150); };
    const resetAll = () => ev(() => { const a = window.overdub; a.engine.stop(); while (a.store.canUndo()) a.store.undo(); a.store.dispatch({ type: 'project.set', patch: { loop: { on: false } } }, { by: 'you' }); });
    const ids3 = await ev(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
    const tone = (hz, secs) => ev(({ hz, secs }) => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = hz; const gn = ctx.createGain(); gn.gain.value = 0.4; o.connect(gn); gn.connect(mic.merge, 0, 0); o.start(); o.stop(ctx.currentTime + secs); }, { hz, secs });
    const toast = () => ev(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
    await resetAll();

    /* ---- a ruler click (a seek) during a mic take keeps the take, ending where it was */
    await ev(async () => { await window.overdub.input.audio.ensureOpen(); });
    await ev(() => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, 0); o.start(); window.__hold = o; });
    await ev((g) => { const a = window.overdub; a.ui.select({ track: g }); a.engine.seek(16); }, ids3.Guitar);
    const caps0 = await ev(() => window.overdub.input.capture.list({ all: true }).filter((x) => x.kind === 'audio').length);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await untilG(24);
    await ev(() => window.overdub.engine.seek(4));     // the ruler, on bar 2
    await idleR();
    const sk = await ev(({ g, caps0 }) => { const a = window.overdub, c = a.store.track(g).clips.find((x) => x.take && !x.mute); return { clip: c && { start: c.start, length: c.length }, caps: a.input.capture.list({ all: true }).filter((x) => x.kind === 'audio').length - caps0, last: a.input.recorder.last?.why }; }, { g: ids3.Guitar, caps0 });
    await ev(() => { try { window.__hold.stop(); } catch { /* ok */ } window.overdub.engine.stop(); });
    t.ok(sk.clip && near(sk.clip.start, 16, 0.1) && sk.clip.length > 7 && sk.clip.length < 9 && sk.caps === 1 && sk.last === 'seek', `a seek back to bar 2 during a mic take from bar 5 keeps the take where it was played (${JSON.stringify(sk)})`);
    await resetAll();

    /* ---- overlapping takes (docs/ARCHITECTURE.md "Overlapping takes"): a mic take for bars 5-6 (tailFrom 24) played
       on two beats past them keeps that ring as its tail; the next part's take from bar 7 goes over it without muting
       or cutting it; clip.trim cuts the ring back to a beat on the grid, and ⌘Z puts it back */
    {
      const held = (hz) => ev((hz) => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = hz; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, 0); o.start(); window.__hold = o; }, hz);
      const unhold = () => ev(() => { try { window.__hold.stop(); } catch { /* ok */ } });
      const takes = () => ev((g) => window.overdub.store.track(g).clips.filter((c) => c.kind === 'audio').map((c) => ({ id: c.id, start: Math.round(c.start * 1000) / 1000, length: Math.round(c.length * 1000) / 1000, tail: c.tail ? Math.round(c.tail * 1000) / 1000 : 0, mute: !!c.mute, take: c.take || null })), ids3.Guitar);
      await held(220);
      await ev((g) => { const a = window.overdub; a.ui.select({ track: g }); a.engine.seek(16); }, ids3.Guitar);
      const r1 = await ev((g) => window.overdub.input.recorder.record({ countIn: 0, audio: g, tailFrom: 24 }).then((x) => !!x), ids3.Guitar);
      await untilG(26);
      const c1 = await ev(() => window.overdub.input.recorder.stop().then((x) => x && x.takes && x.takes[0]));
      await idleR(); await unhold();
      const after1 = await takes();
      const v = after1[0];
      t.ok(r1 && after1.length === 1 && near(v.start, 16, 0.15) && near(v.start + v.length - v.tail, 24, 1e-3) && v.tail > 1.7 && v.tail < 2.6 && !v.mute && c1 && near(c1.tail, v.tail, 1e-3), `a mic take for bars 5-6 played two beats on: its clip runs on, the ring past beat 24 its tail (${JSON.stringify(after1)}; commit's take ${JSON.stringify(c1)})`);
      await held(330);
      await ev(() => window.overdub.engine.seek(24));
      await ev((g) => window.overdub.input.recorder.record({ countIn: 0, audio: g, tailFrom: 32 }), ids3.Guitar);
      await untilG(33);
      await ev(() => window.overdub.input.recorder.stop()); await idleR(); await unhold();
      const after2 = await takes();
      const v1 = after2.find((c) => c.id === v.id), w = after2.find((c) => c.id !== v.id);
      t.ok(after2.length === 2 && v1 && !v1.mute && v1.length === v.length && v1.tail === v.tail && w && near(w.start, 24, 0.15) && near(w.start + w.length - w.tail, 32, 1e-3) && w.tail > 0.7 && !w.mute && w.take !== v1.take, `the next part's take from bar 7 goes over the first's ring without muting or cutting it: both play (${JSON.stringify(after2)})`);
      const tr = await ev(({ g, c }) => { const a = window.overdub; const r = a.store.dispatch({ type: 'clip.trim', track: g, clip: c, end: 25.2, snap: 'beat' }, { by: 'you' }); const x = a.store.track(g).clips.find((y) => y.id === c); const out = { ok: r.ok, length: x.length, tail: x.tail }; a.store.undo(); const y = a.store.track(g).clips.find((z) => z.id === c); out.undone = { length: y.length, tail: y.tail }; return out; }, { g: ids3.Guitar, c: v.id });
      t.ok(tr.ok && near(v.start + tr.length, 25, 1e-3) && near(tr.tail, 1, 1e-3) && near(tr.undone.length, v.length, 1e-3) && near(tr.undone.tail, v.tail, 1e-3), `clip.trim cuts the first take's ring back to beat 25 on the grid (a beat of tail left), and ⌘Z puts it back exactly (${JSON.stringify(tr)})`);
      await ev(() => window.overdub.engine.stop());
      await resetAll();
    }

    /* ---- a looped mic take on a mapped song (a flip): each pass is cut where the map puts it. The loop's two bars
       play at 180 BPM on a map whose nominal tempo is 120, so a pass lasts 2.667 s; one tempo would cut 4 s */
    await ev(() => { const mic = window.__mic, ctx = mic.ctx; const o = ctx.createOscillator(); o.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(mic.merge, 0, 0); o.start(); window.__hold = o; });
    await ev((g) => { const a = window.overdub; a.store.dispatch([{ type: 'tempo.map', map: { anchors: [{ beat: 0, sec: 0 }, { beat: 16, sec: 8 }, { beat: 24, sec: 10.666667 }, { beat: 256, sec: 126.666667 }] } }, { type: 'project.set', patch: { loop: { on: true, start: 16, end: 24 } } }], { by: 'you', label: 'map' }); a.ui.select({ track: g }); a.engine.seek(16); }, ids3.Guitar);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await untilG(36);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const mt = await ev((g) => { const a = window.overdub, p = a.store.get(), tr = a.store.track(g); const cs = tr.clips.filter((c) => c.kind === 'audio' && c.take).sort((x, y) => x.offset - y.offset); return { tempo: p.tempo, clips: cs.map((c) => ({ start: c.start, length: c.length, offset: Math.round(c.offset * 1000) / 1000, mute: !!c.mute })) }; }, ids3.Guitar);
    await ev(() => { try { window.__hold.stop(); } catch { /* ok */ } window.overdub.engine.stop(); });
    const mc = mt.clips, whole = mc.filter((c) => c.start === 16 && c.length > 6);
    const step = mc.length >= 3 ? mc[2].offset - mc[1].offset : NaN;
    t.ok(mt.tempo === 120 && whole.length >= 2 && whole.every((c) => near(c.length, 8, 0.05)) && near(step, 10.666667 - 8, 0.03), `a looped mic take on a mapped song: each pass is the loop's 8 beats and 2.667 s of the recording on the map, not 4 s at the nominal 120 (${JSON.stringify(mc)})`);
    await resetAll();

    /* ---- and a seek during a looped keys take: the passes and the held note are kept as played */
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 24 } } }, { by: 'you' }); a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    const tap = async (p, at, ms = 120) => { await untilG(at); await ev((p) => window.overdub.input.noteOn('t', p, 0.8), p); await wait(ms); await ev((p) => window.overdub.input.noteOff('t', p), p); };
    await tap(72, 17); await tap(74, 26.5); await untilG(35);
    await ev(() => window.overdub.input.noteOn('t', 77, 0.8));
    await untilG(36.5);
    await ev(() => window.overdub.engine.seek(16));
    await idleR();
    await ev(() => window.overdub.input.noteOff('t', 77));
    const lk = await ev((k) => { const a = window.overdub, tr = a.store.track(k); const f = tr.clips.filter((c) => c.take); const pl = f.find((c) => !c.mute); const held = f.flatMap((c) => c.notes.filter((n) => n.p === 77 && n.by === 'you')); return { range: [Math.min(...f.map((c) => c.start)), Math.max(...f.map((c) => c.start + c.length))], playing: pl && pl.notes.filter((n) => n.by === 'you').map((n) => n.p), held: held.map((n) => n.d) }; }, ids3.Keys);
    await ev(() => window.overdub.engine.stop());
    t.ok(lk.range.join() === '16,24' && lk.playing?.join() === '74' && lk.held.length === 1 && lk.held[0] > 1, `a seek three passes into a looped take: the folder is bars 5–6, the last complete pass plays, the held note keeps its length (${JSON.stringify(lk)})`);
    await resetAll();

    /* ---- ⌘Z during a take is the take's: the last pass comes out, the song's history stays */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await tap(72, 16.4); await untilG(20.2);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const h1 = await ev(() => window.overdub.store.history.map((x) => x.label));
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 20 } } }, { by: 'you', label: 'loop' }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await tap(76, 16.4); await untilG(16.9);
    await page.keyboard.press('Meta+KeyZ');            // the first pass, still running: nothing to take out
    await wait(120);
    const z1 = { state: await ev(() => window.overdub.input.recorder.state), hist: await ev(() => window.overdub.store.history.length), toast: await toast() };
    await tap(79, 20.5); await untilG(24.4);           // pass 1 (79), then into pass 2
    await page.keyboard.press('Meta+KeyZ');            // takes pass 1 out
    await wait(120);
    const z2 = { toast: await toast(), passes: await ev(() => window.overdub.input.recorder.passes().map((x) => x.n)) };
    await untilG(25.5);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const zz = await ev((k) => { const a = window.overdub, tr = a.store.track(k); return { hist: a.store.history.map((x) => x.label), mine: tr.clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)).sort() }; }, ids3.Keys);
    t.ok(z1.state === 'rec' && z1.hist === h1.length + 1 && /No finished pass/.test(z1.toast), `⌘Z in a take's first pass undoes nothing in the song ("${z1.toast}"; ${z1.hist} steps)`);
    t.ok(/^Pass 2 is out of the take \(1 note\)/.test(z2.toast) && !z2.passes.includes(1), `⌘Z after a pass takes that pass out of the take ("${z2.toast}")`);
    t.ok(zz.hist.length === h1.length + 2 && zz.hist[0] === h1[0] && zz.mine.join() === '72,76', `and the stop puts the take in after the first one, which stays: ${zz.hist.join(' / ')}; your notes ${zz.mine.join(', ')} (79 taken out)`);
    await resetAll();

    /* ---- a note begun just before the loop comes round is the next pass's downbeat, in your own timing too (fresh
       eyes 5, My timing: one 0.03 beats early and held over the wrap landed as a 0.03-beat stub at the end of the pass
       before, the next pass had no downbeat, and ⌘Z said "(4 notes)" of a pass of 5, leaving the early one behind).
       The notes go in on the recorder's grid as the hum's do, so where each lands is exact */
    await ev((k) => { const a = window.overdub; a.store.dispatch({ type: 'project.set', patch: { loop: { on: true, start: 16, end: 20 } } }, { by: 'you', label: 'loop' }); a.ui.select({ track: k }); a.engine.seek(16); }, ids3.Keys);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await untilG(16.5);
    const ew = await ev(() => {
      const r = window.overdub.input.recorder, w = r.where(r.gridNow(true));
      // 0.03 beats before this pass ends, held a beat over the wrap; then four more in the next pass
      const n = r.addNotes([{ p: 72, g: w.g1 - 0.03, d: 1, v: 0.8 }, ...[74, 76, 77, 79].map((p, i) => ({ p, g: w.g1 + 0.5 + i * 0.5, d: 0.4, v: 0.8 }))], { src: 'hum' });
      return { pass: w.pass, g1: w.g1, added: n };
    });
    await untilG(ew.g1 + 4.4);                         // into the pass after
    const el = await ev(() => { const L = window.overdub.input.recorder.live(); return L.passes.flatMap((ps) => ps.notes.map((n) => ({ pass: ps.n, p: n.p, t: Math.round(n.t * 1000) / 1000, d: Math.round(n.d * 1000) / 1000 }))); });
    const early = el.filter((x) => x.p === 72);
    t.ok(ew.added === 5 && early.length === 1 && early[0].pass === ew.pass + 1 && early[0].t === 16 && Math.abs(early[0].d - 0.97) < 0.01 && !el.some((x) => x.pass === ew.pass && x.t > 19.8), `a note 0.03 beats before the loop's end, held over it, is the next pass's downbeat at bar 5 (${JSON.stringify(early)}), not a stub at the end of the pass before`);
    await page.keyboard.press('Meta+KeyZ');            // the pass it began: all five of its notes come out together
    await wait(150);
    const ez = { toast: await toast(), left: await ev(() => window.overdub.input.recorder.live().passes.flatMap((ps) => ps.notes.map((n) => n.p))) };
    await ev(() => window.overdub.input.recorder.cancel()); await idleR();
    t.ok(new RegExp(`^Pass ${ew.pass + 2} is out of the take \\(5 notes\\)`).test(ez.toast) && !ez.left.includes(72), `⌘Z takes that pass out whole, the early downbeat with it ("${ez.toast}"; left ${ez.left.join(', ') || 'none'})`);
    await resetAll();

    /* ---- MIDI with Drums selected records onto Drums, as R says */
    await ev((d) => { const a = window.overdub; a.ui.select({ track: d }); a.engine.seek(16); }, ids3.Drums);
    const tg = await ev(() => { const a = window.overdub; return { r: a.store.track(a.input.recorder.target)?.name, keys: a.input.target()?.name }; });
    const bass0 = await ev((b) => JSON.stringify(window.overdub.store.track(b).clips), ids3.Bass);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    for (const [p, at] of [[36, 16.5], [38, 17.5]]) { await untilG(at); await ev((p) => window.overdub.input.noteOn('midi', p, 0.9, 'midi'), p); await wait(60); await ev((p) => window.overdub.input.noteOff('midi', p, 'midi'), p); }
    await untilG(18.2);
    await ev(() => window.overdub.input.recorder.stop()); await idleR();
    const dr = await ev(({ d, b }) => { const a = window.overdub; return { summary: a.input.recorder.last?.summary, mine: a.store.track(d).clips.flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)), bass: JSON.stringify(a.store.track(b).clips) }; }, { d: ids3.Drums, b: ids3.Bass });
    t.ok(tg.r === 'Drums' && tg.keys === 'Drums' && dr.mine.join() === '36,38' && dr.bass === bass0 && /Drums/.test(dr.summary), `with Drums selected, MIDI plays and records onto Drums, the track R names; Bass is untouched (${JSON.stringify({ ...tg, mine: dr.mine, summary: dr.summary })})`);
    await resetAll();

    /* ---- Hum it: R during the count-in calls the hum off too */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); a.ui.show?.('sketch'); a.input.emit('sketch:mode', 'hum'); }, ids3.Keys);
    await wait(300);
    await page.keyboard.press('KeyR');
    await wait(500);
    const hc0 = await ev(() => ({ st: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active }));
    await page.keyboard.press('KeyR');
    await wait(400);
    const hc1 = await ev(() => ({ st: window.overdub.input.recorder.state, hum: window.overdub.input.hum.active, rec: window.overdub.input.hum.recording }));
    t.ok(hc0.st === 'count' && hc0.hum && hc1.st === 'idle' && !hc1.hum && !hc1.rec, `Hum it: R starts the hum with the count-in, R again calls both off (${JSON.stringify([hc0, hc1])})`);
    await resetAll();

    /* ---- H, then R: what was hummed before R stays in Sketch */
    await ev((k) => { const a = window.overdub; a.ui.select({ track: k }); a.engine.seek(16); a.input.emit('sketch:mode', 'play'); }, ids3.Keys);
    const hcap0 = await ev(() => window.overdub.input.capture.list({ all: true }).map((x) => x.id));
    await ev(() => window.overdub.input.toggleHum());
    await wait(300); await tone(220, 1.2); await wait(1500);
    await ev(() => window.overdub.input.recorder.record({ countIn: 0 }));
    await wait(400); await tone(330, 1.0); await wait(1400);
    await ev(() => window.overdub.input.recorder.stop()); await idleR(); await wait(400);
    const hr = await ev(({ k, ids }) => { const a = window.overdub; const caps = a.input.capture.list({ all: true }).filter((x) => !ids.includes(x.id)); return { take: a.store.track(k).clips.filter((c) => c.take && !c.mute).flatMap((c) => c.notes.filter((n) => n.by === 'you').map((n) => n.p)), sketch: caps.filter((x) => x.src === 'hum' && !x.rec).flatMap((x) => (x.notes || []).map((n) => n.p)) }; }, { k: ids3.Keys, ids: hcap0 });
    t.ok(hr.take.includes(64) && hr.sketch.includes(57) && !hr.take.includes(57), `H, then R: the hum after R is the take (${hr.take.join(', ')}), the A3 hummed before it is kept in Sketch (${hr.sketch.join(', ')})`);
    await resetAll();

    const own3 = s3.errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
    t.ok(!own3.length, `no page errors in the take's edges${own3.length ? ': ' + own3.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, 'the edges run threw: ' + (e && e.stack || e));
  }
  await s3.close();
}

/* ------------------------------------------------------------------ 4. the studio: fresh eyes 4 (a tune over the loop's seam) */
// The beginner and the phone: with the loop already playing, record waits for the next bar, so a tune starts near the
// loop's end and runs on round it. Real keys (musical typing), R and Space, and the Sketch panel's Record button.
{
  const s4 = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page } = s4;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
    const ev = (fn, a) => page.evaluate(fn, a);
    const wait = (ms) => page.waitForTimeout(ms);
    const grid = () => ev(() => window.overdub.engine.gridBeat ?? -1);
    const untilG = async (b) => { for (let i = 0; i < 1500; i++) { const x = await grid(); if (x >= b - 0.01) return x; await wait(Math.max(5, Math.min(120, (b - x) * 300))); } return null; };
    const idleR = async () => { for (let i = 0; i < 100 && (await ev(() => window.overdub.input.recorder.state)) !== 'idle'; i++) await wait(50); await wait(150); };
    const key = async (code, ms = 100) => { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); };
    const toast = () => ev(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
    await ev(async () => { const a = window.overdub; await a.engine.start(); a.ui.setOpen?.('bottom', true); a.ui.show('sketch'); const q = a.input.qwerty; q.setScaleLock(false); q.setQuantize(false); a.input.recorder.setCountIn(1); });
    // a 4-bar loop already playing, a new track to play a tune on (a loop of 2 bars or less, the first minute's, starts
    // a take at its top, so a phrase only meets the seam in a longer one)
    const setup = () => ev(() => {
      const a = window.overdub; a.engine.stop();
      const r = a.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 16 } } }, { type: 'track.add', ref: 't', track: { name: 'Tune', instrument: { device: 'core.keys' } } }], { by: 'you', label: 'setup' });
      a.ui.select({ track: r.created.t }); a.engine.play(0);
      return r.created.t;
    });
    const takeOf = (k) => ev((k) => { const a = window.overdub, tr = a.store.track(k); return { take: a.input.recorder.last?.take, clips: tr.clips.map((c) => ({ name: c.name, mute: !!c.mute, start: c.start, length: c.length, notes: c.notes.map((n) => ({ p: n.p, t: Math.round((c.start + n.t) * 100) / 100 })) })) }; }, k);
    // Sketch's Takes: the cards of this song, each with its phrase
    const takesList = (take) => ev((take) => {
      const a = window.overdub;
      return [...document.querySelectorAll('.sk-idea:not(.sk-other)')].map((c) => ({ c, p: a.input.capture.get(c.dataset.id) })).filter((x) => x.p && (x.p.take === take || x.p.inTake === take || (!x.p.rec && x.p.at > Date.now() - 60000)))
        .map(({ c, p }) => ({ rec: !!p.rec, notes: (p.notes || []).length, put: !!c.querySelector('.sk-put'), insong: c.querySelector('.sk-insong')?.textContent || '' }));
    }, take);
    const QW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];   // C4 D4 E4 F4 G4 A4 B4 C5
    await page.keyboard.press('Backquote');

    // 1. R at the top of bar 3: a whole bar counts in, recording starts at bar 4; an 8-note tune from bar 4 runs on round
    // the loop; Space a pass later (R later in bar 3 counts a whole bar too: to the loop's top after the wrap)
    const k1 = await setup();
    await untilG(8.1);
    await page.keyboard.press('KeyR');
    for (let i = 0; i < 8; i++) { await untilG(13.2 + i * 0.75); await key(QW[i]); }
    await untilG(33);
    await page.keyboard.press('Space');
    await idleR();
    const a1 = await takeOf(k1), t1 = await toast();
    const play1 = a1.clips.filter((c) => !c.mute);
    await shot4('record-seam-whole');
    t.ok(play1.length === 1 && play1[0].notes.map((n) => n.p).join() === '67,69,71,72,60,62,64,65' && play1[0].start === 0 && play1[0].length === 16 && a1.clips.length === 1, `a tune played on round the loop's end is one take, all 8 notes playing, its last ones at bar 1 where they came round (${a1.clips.map((c) => `${c.name}${c.mute ? ' muted' : ''}: ${c.notes.map((n) => n.p + '@' + n.t).join(' ')}`).join('; ')})`);
    t.ok(/^Take 1 is in on Tune, bars 1–4\. Your phrase ran past the loop's end and is kept whole: its last 4 notes come round at bar 1\. Undo takes it back\./.test(t1), `the toast says so: "${t1}"`);
    await wait(2700);                                   // (the played phrase closes after its silence)
    const l1 = await takesList(a1.take);
    t.ok(l1.length === 1 && l1[0].rec && l1[0].notes === 8 && !l1[0].put && /in the song: Tune, bars 1–4/.test(l1[0].insong), `Takes lists the tune once, whole and in the song, with no second copy offering to put it in (${JSON.stringify(l1)})`);

    // 2. Sketch's Record button; 7 notes in the first pass, 1 late in the next; Space a pass later
    const k2 = await setup();
    await untilG(8.1);
    await page.click('.sk-recbtn');
    for (let i = 0; i < 7; i++) { await untilG(12.25 + i * 0.5); await key(QW[i], 80); }
    await untilG(31); await key('KeyG', 80);
    await untilG(33);
    await page.keyboard.press('Space');
    await idleR();
    const a2 = await takeOf(k2), t2 = await toast();
    const play2 = a2.clips.filter((c) => !c.mute);
    t.ok(play2.length === 1 && play2[0].notes.length === 7 && a2.clips.some((c) => c.mute && c.notes.length === 1), `a last pass of 1 note doesn't play over the 7 before it: the 7 play, the 1 is underneath (${a2.clips.map((c) => `${c.name}${c.mute ? ' muted' : ''}: ${c.notes.length}`).join('; ')})`);
    t.ok(/^Take 1 is in on Tune, bars 1–4\. One more underneath, muted\. The last time round had only 1 note, so the fuller take plays \(7 notes\)\./.test(t2), `and the toast says why: "${t2}"`);
    await wait(2700);
    const l2 = await takesList(a2.take);
    t.ok(l2.length === 2 && l2.every((x) => x.rec && !x.put) && l2.map((x) => x.notes).sort().join() === '1,7', `Takes: one card per pass, no copies of them (${JSON.stringify(l2)})`);
    await ev(() => window.overdub.engine.stop());
    await page.keyboard.press('Backquote');
    const own4 = s4.errors.filter((e) => !/arranger|SRC_ICON|roundRect|trackIcon/.test(e));
    t.ok(!own4.length, `no page errors over the seam${own4.length ? ': ' + own4.slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    t.ok(false, 'the seam run threw: ' + (e && e.stack || e));
  }
  async function shot4(name) { try { await s4.shot(name); } catch { /* ok */ } }
  await s4.close();
}
t.done();
