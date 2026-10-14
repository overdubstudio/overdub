// Start a song: the hum on the stage. ui/start.js holds the stage, its steps and app.start; this is the hum's part of
// them (the step 'hum'), split out of it with the same contract. Two ways to hum:
//
//   over a beat (S.hum.mode 'beat', the door's Hum a tune): the guide beat loops as a preview (start.js guideOn) at a
//     Speed and a Beat. Hum (H) puts the beat in the song (by you) and records the hum over it with the recorder
//     (input/recorder.js) onto a new Melody track in 'take' mode: a bar of count-in from bar 1, then each time round
//     the loop is a take in the clip's take lanes. Notes sung in the count-in go to capture, never onto beat 1 (the
//     recorder's addNotes leaves them out of the take). Done (Space, Enter, H) stops: the steadiest round
//     (rounds.js steadiest) plays and the others stay in the take lanes, muted; the beat and the tune are one undo step
//     (Q-E: the take's commit joins the beat's, recorder.record({ join })), with the key heard in the hum on a song
//     that had none.
//   free (S.hum.mode 'free', "No beat; I'll hum freely"): no beat and no click. The mic listens (input/hum.js
//     start({ free: true })); the pitch trace and the notes are drawn as they form, and once timing.js fitSegs reads a
//     steady pulse (fit ≥ 0.5) the beat's ruler fades in under them ("About {n} BPM · {k} notes"). Done always lands,
//     at the best reading (rounds.js humReadingsOf), whatever the fit: one undo step by you (core/start.js planStart:
//     tempo, loop, a Melody track and its clip, plus the key heard on a blank song).
//
//   over the song (S.over, the coach strip's Hum over it and Play keys over it): no guide beat, the song itself loops
//     over the part's bars (a preview until Hum is pressed). Hum (H) makes the song 4 bars when it's shorter (sketch.js
//     longerPlan, the song's own Make it longer, with the loop round the 4 bars) and records as over a beat, the take
//     joined to that change; the tempo doesn't move. The keys (S.hum.mode 'keys') are the same with no Make it longer:
//     Play (Space) puts musical typing on (lent for the take, given back after) and counts in a bar, and Done keeps
//     the steadiest round on a new track.
//
// The reading tick (R25): while the readings of a hum are up, a soft tick on every beat plays on a previewed track
// (nothing in History), at a level measured once (engine.render + audio/measure.js) to sit at least 12 dB under the
// take's RMS: tick() -> Promise of { take, tick, under, gain } (dB).
//
// humStage(app, ctx) -> { draw(body, alt), frame(now), start(), done(), again(), freeStart(), overBeat(bpm), overLoop(), leave(),
//   stop({ quiet }), state(), tickOn(rd), tickOff(), tick() }
//   ctx: { S, say, setStep, draw, emit, bpbOf, guideOn, dropGuide, landed(take, landed), stage() }

import { h, canvas, tok } from './dom.js';
import { fitSegs } from '../input/timing.js';
import { humReadingsOf, steadiest, atLevel } from '../input/rounds.js';
import { guessKey, keyChosen } from '../input/hum.js';
import { takeFolders, takeNumber } from '../core/arrangement.js';
import { planStart } from '../core/start.js';
import { snapToScale } from '../core/music.js';

const r4 = (x) => Math.round(x * 10000) / 10000;
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const SPEEDS = [['Slow', 80], ['Easy', 100], ['Upbeat', 120]];
const BEATS = [['Simple', 'pop/eighths'], ['Rock', 'rock/straight-eighths'], ['Lo-fi', 'lofi/dusty']];
const TICK = { p: 37, v: 0.45, gain: -14 };   // a side stick on every beat, its track's gain lowered until measured under

// the notes as they come in, in tune (the key's scale) or as sung
export const tuned = (notes, key, on) => (on && key ? notes.map((n) => ({ ...n, p: snapToScale(n.p, key) })) : notes.map((n) => ({ ...n })));

export function humStage(app, ctx) {
  const { store, engine } = app;
  const { S } = ctx;
  const inp = () => app.input || null;
  let win = null;

  /* ---------------------------------------------------------------- free: listen, read the pulse as it forms */
  async function freeStart() {
    if (S.step !== 'hum') return false;
    ctx.dropGuide();
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    S.hum = { mode: 'free', on: false, starting: true, busy: false, fit: null, fitN: -1, fitT: 0, rulerAt: 0 };
    ctx.draw();
    const hum = inp()?.hum;
    if (!hum) { S.hum.starting = false; ctx.say('The mic isn’t loaded in this tab.'); return false; }
    const H = S.hum;
    try { if (!hum.active) await hum.start({ free: true }); } catch (e) {
      H.starting = false;
      const blocked = /allow|NotAllowed|denied/i.test(String(e && e.message));
      ctx.say(blocked ? 'The mic is blocked. Allow it from the address bar, then press H.' : `The mic didn’t open: ${e && e.message}`);
      return false;
    }
    if (S.step !== 'hum' || S.hum !== H) { try { hum.cancel(); } catch { /* ok */ } return false; }
    H.starting = false; H.on = true;
    sync();
    return true;
  }
  // the reading while you hum: fitSegs a few times a second, when the notes changed
  function readLive(force = false) {
    const H = S.hum, hum = inp()?.hum;
    if (!H || H.mode !== 'free' || !hum) return null;
    const segs = hum.segs() || [];
    const now = performance.now();
    if (!force && (segs.length === H.fitN || now - H.fitT < 300)) return H.fit;
    H.fitN = segs.length; H.fitT = now;
    let f = null;
    try { f = segs.length >= 3 ? fitSegs(segs) : null; } catch { f = null; }
    H.fit = f ? { bpm: f.bpm, fit: f.fit, t0: segs[0].t0, b0: f.raws[0], n: segs.length } : null;
    if (H.fit && H.fit.fit >= 0.5 && !H.rulerAt) H.rulerAt = now;
    return H.fit;
  }
  async function freeDone() {
    const H = S.hum, hum = inp()?.hum;
    if (!H || H.mode !== 'free' || H.busy) return false;
    if (!hum?.active) { if (!H.starting) return freeStart(); ctx.say('The mic is opening.'); return false; }
    if (!(hum.segs() || []).length) { ctx.say('Nothing heard yet. Hum a little louder, or closer to the mic.'); return false; }
    H.busy = true;
    let tk = null;
    try { tk = await hum.stop(); } catch (e) { console.error('start: hum', e); }
    H.busy = false; H.on = false;
    if (S.step !== 'hum' || S.hum !== H) return false;
    if (!tk || !tk.segs?.length) { ctx.say('Heard nothing. Hum a little louder, or closer to the mic.'); return freeStart(); }
    return landFree(tk);
  }
  // a hum too short for a pulse (two notes) still lands: at 100 BPM, each note an eighth or more from the first
  function plainReading(segs, bpb) {
    const t0 = segs[0].t0, k = 100 / 60;
    const notes = segs.map((s) => { const raw = r4((s.t0 - t0) * k); return { p: s.p ?? Math.round(s.midi), t: Math.round(raw * 2) / 2, d: Math.max(0.25, Math.round((s.t1 - s.t0) * k * 4) / 4), v: 0.8, raw }; });
    const end = notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
    return { bpm: 100, shift: 0, notes, length: Math.max(bpb, Math.ceil(end / bpb - 1e-9) * bpb), why: 'first', fit: 0 };
  }
  function landFree(tk) {
    const bpb = ctx.bpbOf();
    let readings = [];
    try { readings = humReadingsOf({ segs: tk.segs }, { bpb }); } catch (e) { console.error('start: readings', e); }
    if (!readings.length) readings = [plainReading(tk.segs, bpb)];
    const song = store.get(), blank = !song.tracks.some((t) => t.clips.length);
    const rd = readings[0];
    const heard = guessKey(rd.notes);
    const key = keyChosen(song, store.history) ? song.key : heard ? { root: heard.root, scale: heard.scale } : song.key;
    const notes = tuned(atLevel(rd.notes, 'tight', { length: rd.length }), key, true);
    const plan = planStart(song, { notes, bpm: rd.bpm, length: rd.length, kind: 'hum' });
    if (blank && key) { const ps = plan.ops.find((o) => o.type === 'project.set'); if (ps) ps.patch.key = { root: key.root, scale: key.scale }; }
    const res = store.dispatch(plan.ops, { by: 'you', label: plan.label.replace(/^your part/, 'your tune') });
    if (!res.ok) { ctx.say(`That didn’t go in: ${res.error}`); return freeStart(); }
    const track = store.get().tracks.find((t) => t.clips.some((c) => c.id === res.created.c));
    const landed = { txn: res.txn.id, track: track?.id || null, clip: res.created.c };
    const fit = Number.isFinite(rd.fit) ? rd.fit : (tk.free?.fit ?? 0);
    const take = { kind: 'hum', free: true, bpm: rd.bpm, fit: { fit }, key, readings, length: rd.length, rounds: 1, kept: 1, notes: rd.notes };
    // what was sung, as sung, goes with the clip (capture.ofClip): Timing and the readings re-plan from it later
    try { if (tk.capture) inp()?.capture?.update?.(tk.capture, { clip: landed.clip, track: landed.track, raw: tk.segs.map((g) => ({ t0: g.t0, t1: g.t1, midi: g.midi, conf: g.conf, db: g.db })), rounds: 1, kept: [{ track: landed.track, clip: landed.clip, at: Date.now() }] }); } catch (e) { console.error('start: capture', e); }
    S.hum = null;
    ctx.landed(take, landed);
    return true;
  }

  /* ---------------------------------------------------------------- over the song: the part's bars loop */
  const bars = (L) => Math.max(1, Math.round(L / ctx.bpbOf()));
  function overLoop() {
    const o = S.over;
    if (!o) return false;
    ctx.dropGuide();
    S.guidePlan = null;
    const r = store.preview({ type: 'project.set', patch: { loop: { on: true, start: o.start, end: o.start + o.length } } }, { by: 'you' });
    if (r.ok) S.guide = r;
    try { if (engine.playing) engine.stop(); engine.play(o.start); } catch { /* silent engine */ }
    return true;
  }
  // the keys: musical typing on from Play (lent, given back when the take ends): aimed at a new track, typing on makes
  // it (recorder.keysTrack), so the take and the track are one undo step
  function lendTyping() {
    const q = inp()?.qwerty;
    if (!q || q.on) return;
    try { q.toggle(true); S.typingLent = true; } catch { /* ok */ }
  }
  function giveTyping() {
    if (!S.typingLent) return;
    S.typingLent = false;
    try { inp()?.qwerty?.on && inp().qwerty.toggle(false); } catch { /* ok */ }
  }
  // Hum over the song: what Hum puts in the song first, the 4 bars and the loop round them (one change, joined by the
  // take). The keys: only the loop, when it isn't round the part already
  function overOps() {
    const o = S.over, p = store.get(), bpb = ctx.bpbOf(), ops = [];
    let L = o.length;
    if (S.hum?.mode !== 'keys' && bars(L) < 4) {
      const plan = ctx.longerPlan({ bars: 4 });
      if (plan?.ok) { ops.push(...plan.ops.filter((x) => x.type !== 'project.set')); L = 4 * bpb; }
    }
    const lp = p.loop;
    if (!(lp?.on && Math.abs(lp.start - o.start) < 1e-6 && Math.abs(lp.end - (o.start + L)) < 1e-6)) ops.push({ type: 'project.set', patch: { loop: { on: true, start: o.start, end: o.start + L } } });
    return { ops, length: L };
  }

  /* ---------------------------------------------------------------- over a beat: the rounds as takes */
  async function beatStart() {
    if (S.step !== 'hum' || S.hum?.rec || S.hum?.mode === 'free') return false;
    const rec = inp()?.recorder;
    if (!rec) { ctx.say('The recorder isn’t loaded in this tab.'); return false; }
    if (S.over) return overStart(rec);
    if (!S.guidePlan && !ctx.guideOn()) return false;
    try { rec.setAim?.('hum', 'new'); } catch { /* ok */ }
    const ops = [{ type: 'project.set', patch: { tempo: S.speed, loop: { on: true, start: 0, end: 4 * ctx.bpbOf() } } }, ...S.guidePlan.ops];
    ctx.dropGuide();
    // (whether the song has a key of its own is asked now, before the tune is in it: afterwards it has a pitched part)
    const chosen = keyChosen(store.get(), store.history);
    const res = store.dispatch(ops, { by: 'you', label: `a beat to hum over, 4 bars at ${S.speed} BPM` });
    if (!res.ok) { ctx.say(`The beat didn’t go in: ${res.error}`); ctx.guideOn(); return false; }
    S.under = { txn: res.txn.id, track: res.created.drums || null, clip: res.created.groove || null, chosen };
    try { if (engine.playing) engine.stop(); engine.seek?.(0); } catch { /* ok */ }
    const H = S.hum = { mode: 'beat', rec: true, busy: false };
    ctx.draw();
    try { await rec.record({ hum: true, countIn: 1, join: S.under.txn }); } catch (e) { console.error('start: hum take', e); }
    if (S.hum !== H) return true;
    if (rec.state === 'idle') { H.rec = false; ctx.say('The take didn’t start. The beat is in the song: press Hum to try again.'); ctx.draw(); return false; }
    sync();
    return true;
  }
  async function overStart(rec) {
    const keys = S.hum.mode === 'keys', o = S.over;
    if (!store.findClip(o.clip)) { ctx.say('That part isn’t in the song any more.'); return false; }
    try { rec.setAim?.(keys ? 'keys' : 'hum', 'new'); } catch { /* ok */ }
    ctx.dropGuide();
    const chosen = keyChosen(store.get(), store.history);
    const { ops, length } = overOps();
    let txn = null;
    if (ops.length) {
      const res = store.dispatch(ops, { by: 'you', label: keys ? `a loop to play over, ${plural(bars(length), 'bar')}` : `make it ${bars(length)} bars to hum over` });
      if (!res.ok) { ctx.say(`That didn’t go in: ${res.error}`); overLoop(); return false; }
      txn = res.txn?.id || null;
    }
    S.under = { txn, track: o.track, clip: o.clip, chosen, over: true };
    try { if (engine.playing) engine.stop(); engine.seek?.(o.start); } catch { /* ok */ }
    const H = S.hum = { mode: keys ? 'keys' : 'beat', rec: true, busy: false };
    if (keys) lendTyping();
    ctx.draw();
    try { await rec.record({ hum: !keys, countIn: 1, join: txn }); } catch (e) { console.error('start: take over the song', e); }
    if (S.hum !== H) return true;
    if (rec.state === 'idle') { H.rec = false; ctx.say('The take didn’t start: press it again.'); ctx.draw(); return false; }
    sync();
    return true;
  }
  async function beatDone() {
    const rec = inp()?.recorder, H = S.hum;
    if (!H || (H.mode !== 'beat' && H.mode !== 'keys') || !H.rec || H.busy || !rec) return false;
    if (rec.state === 'count') { ctx.say('Come in on 1.'); return false; }
    if (rec.state !== 'rec') return false;
    H.busy = true;
    // the hum hands its notes to the take now (input/hum.js): each round's notes, as placed and as sung
    const hum = inp().hum;
    try { if (hum?.active && hum.recording) await hum.stop(); } catch (e) { console.error('start: hum', e); }
    const lv = rec.live() || {};
    const ps = (lv.passes || []).filter((p) => p.notes.length && !p.drums);
    const whole = ps.filter((p) => p.n < (lv.pass ?? 0));
    const pool = whole.length ? whole : ps;
    const si = pool.length ? steadiest(pool.map((p) => ({ notes: p.notes.map((n, i) => ({ t: n.t, raw: p.raw[i] })) })), { grid: 0.5 }) : -1;
    const keep = si >= 0 ? pool[si] : null;
    let res = null;
    try { res = await rec.stop(); } catch (e) { console.error('start: hum take', e); }
    H.busy = false; H.rec = false;
    if (H.mode === 'keys') giveTyping();
    if (S.step !== 'hum' || S.hum !== H) return false;
    if (!res || !res.ok || res.empty || !keep) {
      ctx.say(S.over ? 'Nothing heard in that take. Press it again to go round once more.' : 'Nothing heard in that take. The beat is in the song: press Hum to go again.');
      ctx.draw();
      return false;
    }
    return landOver(res, keep, pool.length);
  }
  function landOver(res, keep, rounds) {
    const keysTake = S.hum?.mode === 'keys';
    const part = (res.parts || []).find((x) => (x.kinds || []).includes(S.hum?.mode === 'keys' ? 'keys' : 'hum')) || (res.parts || []).find((x) => !x.drums) || res.parts?.[0];
    const tr = part && store.track(part.track);
    if (!tr) { ctx.say('The take went in, but its track isn’t there.'); return false; }
    const folders = takeFolders(tr);
    const folder = folders.find((f) => f.clips.some((c) => (part.clips || []).includes(c.id))) || folders[0] || null;
    const clips = folder ? folder.clips : tr.clips;
    const kept = clips.find((c) => takeNumber(c) === keep.n + 1) || folder?.playing || clips[clips.length - 1];
    // the song had no key: the one heard in the kept round, in the same step
    const song = store.get();
    const sung = new Map();
    for (const op of res.sung?.ops || []) if (op.clip === kept.id) for (const n of op.notes) sung.set(n.id, n.p);
    const base = kept.notes.map((n) => ({ p: sung.get(n.id) ?? n.p, t: n.t, d: n.d, v: n.v ?? 0.8 }));
    const heard = guessKey(base);
    const chosen = S.under?.chosen ?? keyChosen(song, store.history);
    const key = chosen ? song.key : heard ? { root: heard.root, scale: heard.scale } : song.key;
    // where each note was sung (the round's own raw, on the song's beats; the clip's are from its start)
    const raws = keep.notes.map((n, i) => ({ p: n.p, t: n.t - kept.start, raw: keep.raw[i] - kept.start }));
    const used = new Set();
    const notes = base.map((n, i) => {
      const p = kept.notes[i].p, near = (x) => !used.has(x) && Math.abs(x.t - n.t) < 0.26;
      const m = raws.find((x) => near(x) && x.p === p) || raws.find(near);
      if (m) used.add(m);
      return { ...n, raw: m ? r4(m.raw) : n.t };
    });
    const ops = [];
    if (folder) for (const c of folder.clips) if (!!c.mute !== (c.id !== kept.id)) ops.push({ type: 'clip.set', track: tr.id, clip: c.id, patch: { mute: c.id !== kept.id } });
    if (!chosen && key && !keysTake) ops.push({ type: 'project.set', patch: { key: { root: key.root, scale: key.scale } } });
    const inTune = tuned(atLevel(notes, 'tight', { length: kept.length }), key, !keysTake);
    if (inTune.some((n, i) => n.p !== kept.notes[i]?.p)) ops.push({ type: 'notes.replace', track: tr.id, clip: kept.id, notes: inTune.map(({ p, t, d, v }) => ({ p, t, d, v })) });
    let txn = res.txn || S.under?.txn || null;
    const bpm = S.over ? store.get().tempo : S.speed;
    if (ops.length) {
      const d = store.dispatch(ops, { by: 'you', label: S.over ? `your ${keysTake ? 'part' : 'tune'} over ${S.over.name}` : `a beat and your tune over it, 4 bars at ${S.speed} BPM`, join: txn });
      if (d.ok && d.txn) txn = d.txn.id;
    }
    const length = kept.length;
    const under = S.under?.track ? store.track(S.under.track) : null;
    const take = { kind: 'hum', keys: keysTake, free: false, bpm, fit: { fit: 1 }, key, length, rounds, kept: keep.n + 1, over: under?.name || 'Drums', notes,
      readings: [{ bpm, shift: 0, notes, length, why: 'first', fit: 1 }] };
    S.hum = null;
    ctx.landed(take, { txn, track: tr.id, clip: kept.id });
    return true;
  }

  /* ---------------------------------------------------------------- the step's controls */
  function start() { return S.hum?.mode === 'free' ? freeDone() : S.hum?.rec ? beatDone() : beatStart(); }
  function done() { return S.hum?.mode === 'free' ? freeDone() : S.hum?.rec ? beatDone() : beatStart(); }
  // Start again on the free hum: what was sung goes to Takes (capture), and the mic listens afresh
  async function again() {
    const H = S.hum, hum = inp()?.hum;
    if (!H || H.mode !== 'free' || H.busy) return false;
    if (hum?.active) { H.busy = true; try { if ((hum.segs() || []).length) await hum.stop(); else hum.cancel(); } catch { /* ok */ } H.busy = false; }
    if (S.step !== 'hum' || S.hum !== H) return false;
    await freeStart();
    if ((S.hum?.mode === 'free')) ctx.say('Cleared. That hum is in Takes if you want it back.');
    return true;
  }
  // over a beat again (from a free hum's readings, or the free view): the guide at a speed
  function overBeat(bpm = null) {
    stop({ quiet: true });
    if (Number.isFinite(bpm)) S.speed = Math.max(60, Math.min(180, Math.round(bpm)));
    S.hum = { mode: 'beat', rec: false, busy: false };
    ctx.guideOn();
    ctx.draw();
    return true;
  }
  // the stage closing or switching: a free hum is let go (into Takes when something was sung), a take over the beat
  // in its count-in is called off, one recording goes in as it is
  function stop({ quiet = false } = {}) {
    const H = S.hum, hum = inp()?.hum, rec = inp()?.recorder;
    if (!H) return;
    if (H.mode === 'free' && hum?.active && !hum.recording) { try { if ((hum.segs() || []).length && !quiet) hum.stop(); else hum.cancel(); } catch { /* ok */ } }
    if ((H.mode === 'beat' || H.mode === 'keys') && H.rec && rec) { try { if (rec.state === 'count') rec.cancel(); else if (rec.state === 'rec') rec.stop(); } catch { /* ok */ } }
    H.rec = false; H.on = false;
    giveTyping();
  }
  function state() {
    const H = S.hum, hum = inp()?.hum, rec = inp()?.recorder;
    if (!H) return null;
    if (H.mode === 'free') { const f = H.fit; return { mode: 'free', on: !!hum?.active, notes: hum?.active ? (hum.segs() || []).length : 0, bpm: f ? Math.round(f.bpm) : null, fit: f ? f.fit : null, ruler: !!H.rulerAt }; }
    const lv = H.rec && rec ? rec.live() : null;
    return { mode: H.mode === 'keys' ? 'keys' : 'beat', over: !!S.over, rec: !!H.rec, state: rec?.state || 'idle', round: lv ? (lv.pass || 0) + 1 : 0, speed: S.speed };
  }

  /* ---------------------------------------------------------------- drawing */
  function draw(body, alt) {
    win = null;
    const H = S.hum || (S.hum = { mode: 'beat', rec: false, busy: false });
    if (H.mode === 'free') {
      alt.append(h('button.btn.btn-txt.st-view', { type: 'button', onclick: () => overBeat() }, 'Hum over a beat instead'));
      win = canvas('st-hwin');
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Hum your tune.'), h('p.st-sub', 'No beat and no click: hum it at your own speed, as many times round as you like. The studio finds the tempo from you.')),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', ''), h('span.st-unit', ''), h('span.st-rounds', ''))),
        h('div.st-winwrap', win.cv, h('p.st-empty.t3', 'Your first note starts the clock.')),
        h('footer.st-foot', ctx.statusEl(),
          h('button.btn.btn-txt.st-again', { type: 'button', onclick: () => again() }, 'Start again'),
          h('button.btn.st-done.st-first', { type: 'button', onclick: () => freeDone() }, 'Done ', h('kbd', 'Space'))));
      sync();
      return;
    }
    const keys = H.mode === 'keys', tempo = S.over ? store.get().tempo : S.speed;
    if (H.rec) {
      win = canvas('st-hwin');
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', keys ? 'Play your part.' : 'Hum over this beat.'), h('p.st-sub', `${tempo} BPM. ${keys ? 'Play it' : 'Hum it'} each time round the loop, as many times as you like; every round is kept as a take, and the steadiest one plays.`)),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', String(tempo)), h('span.st-unit', 'BPM'), h('span.st-rounds', ''))),
        h('div.st-winwrap', win.cv, h('p.st-empty.t3.st-count', 'Come in on 1.')),
        h('footer.st-foot', ctx.statusEl(), keys ? null : h('span.t3.st-phones', 'Headphones keep the beat out of your hum.'),
          h('button.btn.btn-go.st-done.st-first', { type: 'button', onclick: () => beatDone() }, 'Done ', h('kbd', 'Space'))));
      sync();
      return;
    }
    if (S.over) {
      // over the song: no Speed and no Beat (the song has both), and no free hum
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', keys ? 'Play your part.' : 'Hum over this beat.'), h('p.st-sub', keys ? `Your keys play a new track over ${S.over.name}. Press Play and the loop counts you in for a bar; play as many times round as you like. Space stops.` : 'Press Hum and the beat counts you in for a bar. Hum anything, as many times round as you like. Space stops.')),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', String(tempo)), h('span.st-unit', 'BPM'), h('span.st-rounds', ''))),
        h('div.st-humwrap', h('button.btn.btn-go.st-hum.st-first', { type: 'button', onclick: () => beatStart() }, h('span.st-dot', { 'aria-hidden': 'true' }), keys ? 'Play ' : 'Hum ', h('kbd', keys ? 'Space' : 'H'))),
        h('footer.st-foot', ctx.statusEl(), keys ? null : h('span.t3.st-phones', 'Headphones keep the beat out of your hum.')));
      return;
    }
    alt.append(h('button.btn.btn-txt.st-view', { type: 'button', onclick: () => freeStart() }, 'No beat; I’ll hum freely'));
    const speeds = SPEEDS.some(([, v]) => v === S.speed) ? SPEEDS : [...SPEEDS, ['Yours', S.speed]];
    const choice = (label, items, cur, set) => h('div.st-choice', { role: 'radiogroup', 'aria-label': label }, h('span.st-choice-l.t3', label),
      items.map(([word, val]) => h('button.st-word', { type: 'button', role: 'radio', 'aria-checked': String(val === cur), onclick: () => { set(val); ctx.guideOn(); ctx.draw(); } }, typeof val === 'number' ? `${word} ${val}` : word)));
    body.replaceChildren(
      h('div.st-head', h('div', h('h2.st-title.disp', 'Hum over this beat.'), h('p.st-sub', 'Press Hum and the beat counts you in for a bar. Hum anything, as many times round as you like. Space stops.'))),
      choice('Speed', speeds, S.speed, (v) => { S.speed = v; }),
      choice('Beat', BEATS, S.beat, (v) => { S.beat = v; }),
      h('div.st-humwrap', h('button.btn.btn-go.st-hum.st-first', { type: 'button', onclick: () => beatStart() }, h('span.st-dot', { 'aria-hidden': 'true' }), 'Hum ', h('kbd', 'H'))),
      h('footer.st-foot', ctx.statusEl(), h('span.t3.st-phones', 'Headphones keep the beat out of your hum.')));
  }
  // the words and the readout, from the hum and the take as they are now
  function sync() {
    const body = ctx.body(), H = S.hum, hum = inp()?.hum;
    if (!body || S.step !== 'hum' || !H) return;
    const bpm = body.querySelector('.st-bpm'), unit = body.querySelector('.st-unit'), rounds = body.querySelector('.st-rounds');
    if (H.mode === 'free') {
      const k = hum?.active ? (hum.segs() || []).length : 0, f = readLive();
      const shown = f && f.fit >= 0.5;
      if (bpm) { bpm.textContent = shown ? String(Math.round(f.bpm)) : k ? '~' : ''; unit.textContent = k ? 'BPM' : ''; rounds.textContent = k ? plural(k, 'note') : ''; }
      const empty = body.querySelector('.st-empty');
      if (empty) empty.hidden = k > 0;
      const doneB = body.querySelector('.st-done');
      if (doneB) { doneB.classList.toggle('btn-go', k > 0); doneB.firstChild.textContent = k > 0 ? 'Done ' : 'Hum something '; doneB.setAttribute('aria-disabled', String(!k)); }
      if (!S.asking && !H.busy) ctx.say(H.starting ? 'Opening the mic.' : !H.on ? '' : !k ? 'Listening. Hum your tune; go round as many times as you like.' : f ? `About ${Math.round(f.bpm)} BPM · ${plural(k, 'note')}` : `${plural(k, 'note')}.`);
      return;
    }
    if (H.rec) {
      const rec = inp()?.recorder, lv = rec?.live?.() || null, counting = rec?.state === 'count';
      const n = lv ? (lv.pass || 0) + 1 : 1;
      if (rounds) rounds.textContent = counting ? '' : `round ${n}`;
      const c = body.querySelector('.st-count');
      if (c) c.hidden = !counting;
      if (!S.asking && !H.busy) ctx.say(counting ? 'Come in on 1.' : `Round ${n}. ${H.mode === 'keys' ? 'Play it' : 'Hum it'} each time round; Space stops, and the steadiest round is kept.`);
    }
  }
  let lastSync = 0;
  function frame(now) {
    if (S.step !== 'hum' || !S.hum) return;
    if (now - lastSync > 120) { lastSync = now; sync(); }
    if (win) drawTrace(now);
  }
  // the pitch as you hum it (pencil), the notes it has become (ink), and once the pulse is steady the beat's ruler
  // fading in under them; the last eight seconds, scrolling left
  function drawTrace(now) {
    const hum = inp()?.hum, H = S.hum;
    win.fit();
    const g = win.g, W = win.w, Hh = win.h;
    g.clearRect(0, 0, W, Hh);
    const frames = hum?.active ? hum.trace() || [] : [], segs = hum?.active ? hum.segs() || [] : [];
    const tNow = Math.max(frames.length ? frames[frames.length - 1].t : 0, segs.length ? segs[segs.length - 1].t1 : 0);
    const SPAN = 8, t1 = Math.max(SPAN, tNow + 0.5), t0 = t1 - SPAN;
    const x = (t) => ((t - t0) / SPAN) * W;
    const ms = segs.map((s) => s.midi).filter(Number.isFinite);
    const lo = Math.min(55, ...ms.map((m) => Math.floor(m) - 3)), hi = Math.max(lo + 18, ...ms.map((m) => Math.ceil(m) + 3));
    const y = (m) => Hh - ((m - lo) / (hi - lo)) * Hh;
    const lineC = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text3 = tok('--text-3');
    // the ruler: the beat the studio hears in you, once it is steady
    const f = H?.mode === 'free' ? H.fit : null;
    if (f && f.fit >= 0.5 && H.rulerAt) {
      const a = Math.min(1, (now - H.rulerAt) / 400), spb = 60 / f.bpm, bpb = ctx.bpbOf(), first = f.t0 - f.b0 * spb;
      g.globalAlpha = a;
      for (let b = Math.ceil((t0 - first) / spb); first + b * spb <= t1; b++) {
        const xx = Math.round(x(first + b * spb)) + 0.5;
        g.fillStyle = b % bpb === 0 ? line2 : lineC;
        g.fillRect(xx, 0, b % bpb === 0 ? 2 : 1, Hh);
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = text3;
    for (const fr of frames) {
      if (fr.t < t0 || !Number.isFinite(fr.midi) || !(fr.conf > 0.4)) continue;
      g.fillRect(Math.round(x(fr.t)), Math.round(y(fr.midi)), 1.5, 1.5);
    }
    g.fillStyle = text;
    for (const s of segs) {
      if (s.t1 < t0) continue;
      const xa = x(Math.max(t0, s.t0)), xb = x(s.t1);
      g.fillRect(Math.round(xa), Math.round(y(Math.round(s.midi)) - 3), Math.max(3, Math.round(xb - xa)), 6);
    }
  }

  /* ---------------------------------------------------------------- the reading tick (R25) */
  let tickGain = null, tickWait = null;
  function tickOff() { const p = S.tick; S.tick = null; if (p) { try { p.release(); } catch (e) { console.error('start: tick release', e); } } }
  function tickOn(rd) {
    tickOff();
    if (!rd || !S.landed) return null;
    const L = rd.length, beats = [];
    for (let b = 0; b < L - 1e-6; b++) beats.push({ p: TICK.p, t: b, d: 0.1, v: TICK.v });
    const r = store.preview([
      { type: 'track.add', ref: 'tk', track: { name: 'Tick', kind: 'instrument', instrument: { device: 'core.drums', params: {} }, gain: tickGain ?? TICK.gain } },
      { type: 'clip.add', track: '$tk', clip: { kind: 'notes', start: 0, length: L, name: 'Tick', notes: beats } },
    ], { by: 'you' });
    if (r.ok) S.tick = r;
    if (r.ok && tickGain == null && !tickWait) tickWait = level(L).catch((e) => { console.error('start: tick level', e); return null; });
    return r.ok;
  }
  // the tick's level against the take's, measured, and its gain lowered until it sits 12 dB under (once a session)
  async function level(L) {
    if (!engine.render || engine.silent) return null;
    const { measure } = await import('../audio/measure.js');
    const rms = async (ids) => measure(await engine.render({ from: 0, to: L, tracks: ids, tail: 0.3 })).rms;
    let gain = tickGain ?? TICK.gain;
    const tid = () => S.tick?.created?.tk;
    if (!tid() || !S.landed) return null;
    const take = await rms([S.landed.track]);
    let tick = await rms([tid()]);
    if (take - tick < 12 && tick > -100) {
      gain = Math.round((gain - (12 - (take - tick)) - 3) * 10) / 10;
      tickGain = gain;
      if (S.tick && S.step === 'readings') { const rd = S.take?.readings?.[S.reading]; tickOn(rd); }
      if (tid()) tick = await rms([tid()]);
    }
    tickGain = gain;
    return { take, tick, under: Math.round((take - tick) * 10) / 10, gain };
  }
  function tick() { return tickWait || Promise.resolve(null); }

  return { draw, frame, start, done, again, freeStart, overBeat, overLoop, stop, state, tickOn, tickOff, tick, beatStart, beatDone, freeDone };
}
