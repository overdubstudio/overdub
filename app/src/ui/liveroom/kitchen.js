// The kitchen table [ui] (docs/research/LIVE-ROOM-MODE.md §2.5, §3.18, §6): how it's miked, the headphones question,
// the balance, the paper, the work tape, the band's read of it, the players offered one at a time, the takes. It adds
// the 'kitchen' screen to the registry (ui/liveroom/screens.js) when it's imported, and records through the deck
// (ui/liveroom/deck.js: countIn({ voice: 'none' }) for the work tape, take, stop). On headphones there's the other way
// in beside the bare tape (§6.3): Count me in, one bar of sticks (countIn({ bars: 1, voice: 'sticks' })) with the
// shaker on the song's time under the take; ← → and T set the tempo first. A counted take is on the grid by
// construction, so nothing about its time is read: the band reads its chords straight away. The input opens by itself
// when the browser already allows it (a mic first, as soundcheck.js picks one for the kitchen), else on the
// headphones answer, a press, when the browser asks.
//
// What the musician hears before they choose is a preview (store.preview: nothing in the song, nothing in History);
// what they keep is one step: the time (tempo.map) by you, the read (sections, the Chords track) by the house, a
// player by you with its clip by the house. On speakers the band never plays during a take: every band track is held
// muted in a preview for as long as the tape rolls.
//
//   kitchenState()                the screen's run state, for checks and the agent ({ step, takes, ask, offer, done, ... })

import { h, css } from '../dom.js';
import { screens } from './screens.js';
import { createPaper } from './paper.js';
import { W, H } from './pixels/index.js';
import { roomOf, sheetOf, NAMES } from '../../core/liveroom/model.js';
import { readTapeInWorker } from '../../core/liveroom/tape.js';
import {
  kitchenOps, planTime, planRead, planPlayer, planMaster, planKitchenFinish, offeredKitchen, offerSections, takeName,
  takeNumber, chordsWords, PLAYERS, PLAYER_ORDER, fromTakeOps, after,
} from '../../core/liveroom/kitchen-plans.js';
import { capoChoices } from '../../core/liveroom/sheet-text.js';
import { beatsPerBar, beatToSec, secToBeat } from '../../core/music.js';
import { inputKind } from '../../input/audioin.js';
import { LINES } from '../../core/liveroom/lines/kitchen.js';
import { createStore } from '../../core/store.js';
import { renderProject } from '../../engine/render.js';
import { lufs } from '../../audio/measure.js';

const CSS = `
.kt { display: grid; grid-template-columns: minmax(0, 512px) minmax(0, 640px); gap: 20px; width: 100%; max-width: 1180px; align-items: start; }
.kt-left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.kt-scene { width: 100%; max-width: 512px; aspect-ratio: 16 / 9; image-rendering: pixelated; display: block; background: var(--bg-2, #111); }
.kt-right { min-width: 0; max-height: calc(100vh - 140px); overflow: auto; }
.kt-go { width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font: 600 17px/1.2 var(--font-ui);
  background: var(--accent); color: var(--bg); border: 0; border-radius: var(--r-press); padding: 0 16px; cursor: pointer; }
/* (the key's hint is the stage's: style.js .lr-kbd, printed in the button's own ink) */
.kt-go .lr-kbd { border-color: currentColor; }
.kt-break { flex-basis: 100%; height: 0; }
.kt-go:disabled { opacity: 0.5; cursor: default; }
.kt-go:disabled kbd, .kt-go[hidden] { display: none; }
.kt-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.kt-row > span { color: var(--text-3); font-size: 13px; }
.kt-chip { min-height: 36px; padding: 0 12px; font: 400 14px/1 var(--font-ui); background: none; color: var(--text); border: 1px solid var(--line-2); cursor: pointer; }
/* (pressed is reverse print, BRAND.md: leader green is only the one primary action) */
.kt-chip[aria-pressed="true"] { background: var(--text); border-color: var(--text); color: var(--bg); }
.kt-chip:disabled { opacity: 0.45; cursor: default; }
.kt-q { margin: 0; font: 400 17px/1.4 var(--font-ui); }
/* (the paper stays as it is while the tape rolls: it's what you sing from) */
.kt-dim .kt-row { opacity: 0.5; }
.kt-counter { font: 600 13px/1 var(--font-mono); color: var(--text-3); }
@media (max-width: 900px) { .kt { grid-template-columns: minmax(0, 1fr); } .kt-scene { max-width: 100%; aspect-ratio: 384 / 144; } .kt-right { max-height: none; } .kt-chip { min-height: 44px; } }
`;

let current = null;
export function kitchenState() { return current ? current.state() : null; }

// how long the shaker under a counted take runs (it stops with the tape): 128 bars, about six minutes at 84
const COUNT_BARS = 128;
const MICS = [
  { id: 'laptop', mic: 'one', label: 'The laptop’s mic' },
  { id: 'interface', mic: 'one', label: 'A mic on the interface' },
  { id: 'two', mic: 'two', label: 'A mic and a pickup' },
];
// a line's words, on the screen rather than in the talkback (a question, a chip)
const words = (id, vars) => { try { return LINES[id] ? String(LINES[id].text(vars || {})) : ''; } catch { return ''; } };
const SAYS_OUTPUT = (label) => (/headphone|airpods|earbud|buds|headset/i.test(label) ? 'headphones' : /speaker/i.test(label) ? 'speakers' : null);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dbOf = (lv) => {
  if (lv == null) return null;
  if (typeof lv === 'number') return lv;
  for (const k of ['short', 'lufs', 'db', 'rms', 'peak']) if (Number.isFinite(lv[k])) return lv[k];
  return null;
};

screens.add({
  id: 'kitchen',
  mount(el, ctx) {
    css('lr-kitchen', CSS);
    const { app, ui, store, say } = ctx;
    const deck = () => ctx.deck;
    // what the kitchen reads of the input, from the deck's state (ui/liveroom/deck.js: input { label, channels }) and the
    // input layer's (the browser's settings for the track); both moving: two channels over -50 dBFS now
    const inputNow = () => {
      const i = deck()?.state?.input || {}, a = app.input?.audio?.state || {};
      let both = false;
      try { const chs = deck()?.level?.()?.channels || []; both = chs.filter((c) => Number.isFinite(c.db) && c.db > -50).length >= 2; } catch { both = false; }
      return { device: String(i.label || a.label || ''), channels: i.channels || a.channels || 0, settings: a.settings || null, bothMoving: both };
    };
    const run = {
      step: 'how', mic: null, micGuess: 'laptop', phones: null, balance: null, rolling: false, playing: false, reading: false,
      takes: 0, ask: null, offer: null, done: [], again: false, heard: false, sent: false, readings: null, chosen: 'found', form: null,
      counted: false, countTempo: null, moves: false,
    };
    const reads = new Map();   // clip id -> the tape's read
    let preview = null, takeHold = null, rollStart = 0, lastCanvas = 0, live = true, taps = [], hearGen = 0;
    // a line said a moment later (the chords line read first), never after the screen has gone
    const later = (fn, ms) => setTimeout(() => { if (live) fn(); }, ms);

    // the room in the song: the kitchen's tracks when the song has none yet (the house's), else what it has
    const roomNow = () => roomOf(store.get()) || {};
    const takeTrack = () => { const r = roomNow(); return r.tracks?.take || r.tracks?.kguitar || null; };
    function setup(mic) {
      const r = kitchenOps(store.get(), { mic });
      store.dispatch(r.ops, { by: 'overdub', label: r.label, reason: r.reason });
    }
    // (the output the engine plays to: its sink's id, the default one's 'default'; the answer is kept per output)
    function outputLabel() { const sink = app.engine?.ctx?.sinkId; return String((typeof sink === 'string' && sink) || 'default'); }

    // the input: the one saved, else a mic (the kitchen's), opened by itself when the browser already allows it (ask:
    // false), else on a press (the browser asks then)
    let micAsked = false;
    async function openMic({ ask = true } = {}) {
      const a = app.input?.audio;
      if (!a || a.state.open || micAsked) return !!a?.state?.open;
      if (!ask) {
        let granted = false;
        try { granted = (await navigator.permissions?.query?.({ name: /** @type {any} */ ('microphone') }))?.state === 'granted'; } catch { granted = false; }
        if (!granted || !live || a.state.open || micAsked) return !!a.state.open;
      }
      micAsked = true;
      try {
        const list = await a.devices().catch(() => []);
        const saved = a.state.deviceId && list.some((d) => d.id === a.state.deviceId) ? a.state.deviceId : '';
        const mic = saved ? null : list.find((d) => inputKind(d.label, { isDefault: d.id === 'default' }) === 'mic');
        await a.open({ device: saved || mic?.id || '', channel: a.state.channel || '1', capture: true });
        return true;
      } catch (e) {
        micAsked = false;
        if (/allow|NotAllowed|denied/i.test(String(e?.message || e))) { if (live) say('k.mic.refused'); }
        else console.warn('overdub kitchen input:', e?.message || e);
        return false;
      }
    }

    // what it is: from the room's input, the guess the room shows (§2.5: it picks and shows it)
    function guessMic() {
      const label = inputNow().device;
      if (/scarlett|focusrite|interface|audient|motu|presonus|zoom|steinberg|behringer|usb audio/i.test(label)) return 'interface';
      return 'laptop';
    }

    /* ------------------------------------------------------------------------------------------- the layout */
    const canvas = h('canvas.kt-scene', { width: W, height: H, 'aria-hidden': 'true' });
    const g = canvas.getContext('2d');
    const go = h('button.kt-go', { type: 'button', onclick: () => press(offered()?.id) }, h('span.kt-go-label', ''), h('kbd.lr-kbd', 'Space'));
    const q = h('p.kt-q', { 'aria-live': 'polite' });
    const choices = h('div.kt-row.kt-choices');
    const takesRow = h('div.kt-row.kt-takes');
    const bandRow = h('div.kt-row.kt-band');
    const finishRow = h('div.kt-row.kt-finish');
    const counter = h('span.kt-counter', '');
    const left = h('div.kt-left', canvas, q, choices, go, counter, takesRow, bandRow, finishRow);
    const paper = createPaper({ app, store, say });
    const right = h('div.kt-right', paper.el);
    const root = h('div.kt', { dataset: { step: run.step } }, left, right);
    el.append(root);

    /* ------------------------------------------------------------------------------------------- steps */
    const p0 = store.get();
    const r0 = roomOf(p0);
    const tapes = () => (store.get().tracks.find((t) => t.id === takeTrack())?.clips || []).filter((c) => c.kind === 'audio').length;
    // (coming back: a kitchen song with its tape already rolled; a table the door just set has its tracks, no takes)
    let fresh = false;
    if (r0?.place === 'kitchen' && takeTrack() && tapes()) {
      run.mic = r0.mic === 'two' ? 'two' : 'laptop';
      const known = ctx.prefs.get().outputs[outputLabel()] || SAYS_OUTPUT(outputLabel());
      run.phones = known ? known === 'headphones' : null;
      run.step = run.phones == null ? 'phones' : 'paper';
      for (const t of store.get().tracks) if (t.id === takeTrack()) run.takes = t.clips.filter((c) => c.kind === 'audio').length;
    } else {
      fresh = true;
      if (r0?.place !== 'kitchen' || !takeTrack()) setup('one');
      run.mic = run.micGuess = guessMic();
      const said = SAYS_OUTPUT(outputLabel()) || ctx.prefs.get().outputs[outputLabel()];
      if (said) { run.phones = said === 'headphones'; run.step = 'balance'; } else run.step = 'phones';
    }
    // (the guess and the browser's settings are the input's: read once it's open, if the browser lets it open now)
    // (the guess is said once the input is open, so it's the input's: on a first visit that's after the headphones
    // answer, the press the browser asks on)
    let howSaid = false;
    function sayHow() {
      if (howSaid || !fresh || !app.input?.audio?.state?.open) return;
      howSaid = true;
      if (!run.picked) run.mic = run.micGuess = guessMic();
      say('k.how', { mic: MICS.find((m) => m.id === run.mic).label });
      browserCheck();
    }
    openMic({ ask: false }).then(() => {
      if (!live) return;
      sayHow();
      if (run.step === 'balance' && !run.balance) startBalance();
      draw();
    });

    function browserCheck() {
      const { settings: s, device } = inputNow();
      if (s && (s.echoCancellation || s.noiseSuppression || s.autoGainControl)) say('k.browser');
      if (/scarlett solo/i.test(device)) say('k.solo.direct');
    }
    function pickMic(id) {
      const m = MICS.find((x) => x.id === id);
      if (!m || (m.mic === 'two' && !twoMoving())) return;
      run.mic = id;
      run.picked = true;
      if ((roomNow().mic || 'one') !== m.mic) setup(m.mic);
      draw();
    }
    const twoMoving = () => { const i = inputNow(); return i.channels >= 2 && i.bothMoving; };
    function answerPhones(yes) {
      run.phones = !!yes;
      ctx.prefs.set({ outputs: { [outputLabel()]: yes ? 'headphones' : 'speakers' } });
      if (!yes) say('k.speakers.wait');
      run.step = 'balance';
      draw();
      // (the press the browser asks for the input on, when it hasn't been allowed yet)
      openMic().then(() => { if (!live) return; sayHow(); if (run.step === 'balance' && !run.balance) startBalance(); draw(); });
    }
    // the balance: three seconds of strumming, three of a voice; the voice wanted 3-8 dB over the guitar
    function startBalance() {
      const d = deck();
      if (!d || typeof d.level !== 'function') { run.step = 'paper'; return; }
      say('k.balance.strum');
      run.balance = { phase: 'strum', heard: [], since: 0, strum: null };
    }
    function balanceFrame(now) {
      const B = run.balance;
      if (!B || run.step !== 'balance') return;
      const db = dbOf(deck()?.level?.());
      if (db == null || db < -50) { if (!B.heard.length) B.since = now; return; }
      // (the three seconds run from the first sound heard)
      if (!B.heard.length) B.since = now;
      B.heard.push(db);
      if (now - B.since < 3000) return;
      const mean = 10 * Math.log10(B.heard.reduce((a, x) => a + 10 ** (x / 10), 0) / B.heard.length);
      if (B.phase === 'strum') { B.strum = mean; B.phase = 'sing'; B.heard = []; B.since = now; say('k.balance.sing'); return; }
      const over = Math.round(mean - B.strum);
      if (over < 3) say('k.balance.guitar');
      else if (over > 8) say('k.balance.voice');
      else say('k.balance.ok', { db: over });
      run.balance = null;
      run.step = 'paper';
      draw();
    }
    function skipBalance() { run.balance = null; run.step = 'paper'; say('k.paper.blank'); draw(); }

    /* ------------------------------------------------------------------------------------------- the offered move */
    const view = () => ctx.view();
    const offered = () => {
      if (run.step === 'phones') return { id: 'phones.yes', label: 'Yes, headphones', key: 'Space' };
      if (run.step === 'how' || run.step === 'balance') return null;
      return offeredKitchen(view(), run);
    };
    async function press(id) {
      if (!id) return { ok: false, error: 'nothing to press' };
      if (id === 'phones.yes') { answerPhones(true); return { ok: true }; }
      if (id === 'phones.no') { answerPhones(false); return { ok: true }; }
      if (id === 'tape' || id === 'again') return startTape(id === 'again');
      if (id === 'count') return startTape(run.takes > 0, { counted: true });
      if (id === 'tempo.down' || id === 'tempo.up') { nudgeTempo(id === 'tempo.up' ? 1 : -1); return { ok: true }; }
      if (id === 'stop') return stop();
      if (id === 'time') { try { return keepTime(run.chosen); } catch (e) { console.warn('overdub kitchen time:', e?.message || e); return { ok: false }; } }
      if (id.startsWith('time.')) return hearReading(id.slice(5));
      if (id === 'keep') return keepPlayer();
      if (id === 'nothanks') return noThanks();
      if (id.startsWith('offer.')) return offerPlayer(id.slice(6));
      if (id === 'hear') { stopPreview(); try { app.engine.play(0); } catch { /* silent engine */ } run.playing = true; run.heard = true; draw(); return { ok: true }; }
      if (id === 'send') return send();
      if (id.startsWith('finish.')) return finish(id.slice(7));
      if (id.startsWith('mic.')) { pickMic(id.slice(4)); return { ok: true }; }
      if (id === 'balance.skip') { skipBalance(); return { ok: true }; }
      if (id === 'form') return writeForm();
      if (id === 'form.no') return leaveForm();
      if (id.startsWith('use.')) return useTake(id.slice(4));
      return false;
    }

    /* ------------------------------------------------------------------------------------------- previews */
    function stopPreview() {
      if (preview) { try { preview.release(); } catch { /* gone */ } preview = null; }
      try { if (app.engine?.playing) app.engine.stop(); } catch { /* silent engine */ }
      run.playing = false;
    }
    function hearOps(ops, from) {
      stopPreview();
      if (!ops.length) return false;
      const r = store.preview(ops, { by: 'overdub' });
      if (!r.ok) { console.warn('overdub kitchen preview:', r.error); return false; }
      preview = r;
      try { app.engine.play(Math.max(0, from)); run.playing = true; } catch { /* silent engine */ }
      return true;
    }

    /* ------------------------------------------------------------------------------------------- the tape */
    // Count me in (headphones, before any time is kept): the tempo the count will be at, set first by ← → and T
    const canCount = () => !!run.phones && !roomNow().master && !run.rolling && !run.reading && run.step === 'paper' && !run.offer;
    const countTempo = () => Math.round(run.countTempo ?? store.get().tempo ?? 84);
    function nudgeTempo(by) { if (canCount()) setCountTempo(countTempo() + by); }
    function setCountTempo(t) {
      run.countTempo = Math.max(40, Math.min(240, Math.round(t)));
      hearTempo();
      draw();
    }
    // T: four taps whose intervals agree within 8%
    function tap(now) {
      if (!canCount()) return;
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 4) taps.shift();
      if (taps.length < 4) return;
      const gaps = taps.slice(1).map((x, i) => x - taps[i]), mean = gaps.reduce((a, x) => a + x, 0) / gaps.length;
      if (gaps.every((x) => Math.abs(x - mean) <= 0.08 * mean)) setCountTempo(60000 / mean);
    }
    // the shaker on the song's time over `bars` bars from `from` (the ops, for a preview)
    function shakerOver(p, from, bars) {
      try {
        const bpb = beatsPerBar(p.meter || [4, 4]);
        const q = after(p, [{ type: 'section.add', section: { id: 'kt_count', name: 'Chorus', start: from, length: Math.round(bars * bpb) } }]);
        return planPlayer(q, { player: 'shaker', section: 'kt_count' }).ops;
      } catch (e) { console.warn('overdub kitchen shaker:', e?.message || e); return []; }
    }
    // after a tempo change, a bar of the shaker at it, the takes quiet: you hear the number rather than read it
    function hearTempo() {
      const p = store.get(), tempo = countTempo(), gen = ++hearGen;
      const set = [{ type: 'project.set', patch: { tempo } }];
      const takeId = takeTrack();
      const ops = [...set, ...(takeId ? [{ type: 'track.set', track: takeId, patch: { mute: true } }] : []), ...shakerOver(after(p, set), 0, 1)];
      if (!hearOps(ops, 0)) return;
      // (a bar to hear the number by isn't something to stop: Space still starts the tape)
      run.playing = false;
      const bpb = beatsPerBar(p.meter || [4, 4]);
      later(() => { if (gen === hearGen && preview) { stopPreview(); draw(); } }, ((bpb * 60) / tempo) * 1000 + 250);
    }
    async function startTape(again, { counted = false } = {}) {
      const d = deck(), track = takeTrack();
      if (!d || !track) return { ok: false, error: 'no deck' };
      if (counted && !run.phones) return { ok: false, error: 'a count needs headphones: on speakers the band waits' };
      stopPreview();
      paper.markTake();
      // on speakers the band sits out: every band track held muted while the tape rolls (a preview, never the song)
      const band = PLAYER_ORDER.map((id) => roomNow().tracks?.[PLAYERS[id].role]).filter(Boolean);
      if (!run.phones && band.length) { const r = store.preview(band.map((t) => ({ type: 'track.set', track: t, patch: { mute: true } })), { by: 'overdub' }); takeHold = r.ok ? r : null; }
      if (counted) {
        // the tempo you set is the song's (a step by you), and the shaker plays it under the take (a preview, released
        // when the tape stops)
        const tempo = countTempo();
        if (tempo !== Math.round(store.get().tempo)) store.dispatch([{ type: 'project.set', patch: { tempo } }], { by: 'you', label: `${tempo} BPM` });
        const sh = shakerOver(store.get(), 0, COUNT_BARS);
        if (sh.length) { const r = store.preview(sh, { by: 'overdub' }); takeHold = r.ok ? r : null; }
      }
      const c = await d.countIn(counted ? { from: 0, bars: 1, voice: 'sticks' } : { from: 0, bars: 0, voice: 'none' });
      if (c && c.ok === false) { releaseHold(); say('k.tape.start'); return c; }
      const t = await d.take({ track, from: 0 });
      if (t && t.ok === false) { releaseHold(); return t; }
      run.rolling = true;
      run.counted = counted;
      run.again = run.again || again;
      rollStart = performance.now();
      draw();
      return { ok: true };
    }
    // Esc while the tape rolls: it stops at once and nothing goes into the song (the deck keeps the pass in Capture)
    async function notThatOne() {
      const d = deck();
      run.rolling = false;
      releaseHold();
      try { await d?.stop?.({ at: 'now', keep: 'capture' }); } catch (e) { console.warn('overdub kitchen stop:', e?.message || e); }
      draw();
    }
    function releaseHold() { if (takeHold) { try { takeHold.release(); } catch { /* gone */ } takeHold = null; } }
    async function stop() {
      if (run.playing && !run.rolling) { stopPreview(); draw(); return { ok: true }; }
      const d = deck(), track = takeTrack();
      const before = new Set(clipsOn(track).map((c) => c.id));
      const res = await d.stop({ at: 'now', keep: 'song' });
      run.rolling = false;
      releaseHold();
      const fresh = clipsOn(track).filter((c) => !before.has(c.id) && c.kind === 'audio');
      let clip = fresh[fresh.length - 1] || null;
      if (!clip) { draw(); return res || { ok: false }; }
      run.takes = clipsOn(track).filter((c) => c.kind === 'audio').length;
      const n = run.takes, sh = sheetOf(store.get());
      const timed = run.counted || !!roomNow().master;
      const name = takeName(store.get(), n, { capo: sh?.capo || 0, bpm: timed ? store.get().tempo : null });
      const trim = run.counted ? null : await leadTrim(clip, { first: !roomNow().master });
      store.dispatch([{ type: 'clip.set', track, clip: clip.id, patch: { name, ...(trim || {}) } }], { by: 'you', label: `Take ${n}`, ...(res?.txn ? { join: res.txn } : {}) });
      clip = clipsOn(track).find((c) => c.id === clip.id) || clip;
      const secs = await durationOf(clip);
      if (!live) return { ok: true, clip: clip.id };
      say('k.take.in', { n, time: mmss(secs) });
      draw();
      readTake(clip, { first: !roomNow().master, counted: run.counted });
      return { ok: true, clip: clip.id };
    }
    const clipsOn = (track) => (store.get().tracks.find((t) => t.id === track)?.clips || []);
    // what a clip plays: its recording from its offset (the read is of that, kitchen-plans.js)
    async function samplesOf(clip) {
      const buf = await app.engine.assets.get(clip.asset);
      if (!buf) return null;
      const x = buf.getChannelData(0), at = Math.max(0, Math.min(x.length, Math.round((+clip.offset || 0) * buf.sampleRate)));
      return { x: at ? x.subarray(at) : x, sr: buf.sampleRate };
    }
    async function durationOf(clip) { const a = store.get().assets?.[clip.asset]; if (a && Number.isFinite(a.duration)) return Math.max(0, a.duration - (+clip.offset || 0)); const s = await samplesOf(clip); return s ? s.x.length / s.sr : 0; }
    // The work tape keeps two seconds before your first note and trims the silence before that (§6.3): the first 10 ms
    // over -45 dBFS, or 30 dB under the take's peak when that's higher. The first tape (no time yet) starts the song
    // there: its head goes, the clip still at the song's start. A tape on a song whose time is kept stays where it was
    // played: its start moves up with the cut
    const KEEP_S = 2, TRIM_MIN = 0.25;
    async function leadTrim(clip, { first }) {
      let s = null;
      try { s = await samplesOf(clip); } catch { s = null; }
      if (!s) return null;
      const { x, sr } = s, W = Math.max(1, Math.round(0.01 * sr));
      let pk = 0;
      for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
      const lim = Math.max(10 ** (-45 / 20), pk * 10 ** (-30 / 20));
      let at = -1;
      for (let i = 0; i < x.length && at < 0; i += W) { for (let j = i; j < Math.min(x.length, i + W); j++) if (Math.abs(x[j]) > lim) { at = i; break; } }
      if (at < 0) return null;
      const cut = Math.round(Math.max(0, at / sr - KEEP_S) * 1000) / 1000;
      if (cut < TRIM_MIN) return null;
      const p = store.get(), off = Math.round(((+clip.offset || 0) + cut) * 1000) / 1000;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      if (first && !p.tempoMap) {
        const len = r4(clip.length - cut / (60 / (+p.tempo || 120)));
        return len > 0.25 ? { offset: off, length: len } : null;
      }
      const s0 = beatToSec(p, clip.start), start = r4(secToBeat(p, s0 + cut)), end = clip.start + clip.length;
      return end - start > 0.25 ? { offset: off, start, length: r4(end - start) } : null;
    }
    async function readTake(clip, { first, counted = false }) {
      const s = await samplesOf(clip);
      if (!s) return;
      run.reading = true;
      draw();
      let read;
      try { read = await readTapeInWorker(s.x, s.sr); } catch (e) { run.reading = false; console.warn('overdub kitchen read:', e); if (live) draw(); return; }
      // (a read that comes back after the screen has gone says nothing)
      if (!live) return;
      // (a counted take's read is marked: its time is the count's, never the analyser's)
      reads.set(clip.id, counted ? { ...read, counted: true } : read);
      run.reading = false;
      if (!first) { draw(); return; }
      run.readClip = clip.id;
      // a blank paper: the take's own chords offered to write down, in the shapes a capo gives
      const sh = sheetOf(store.get());
      const blank = !sh || !sh.sections.some((x) => x.lines.some((l) => /\[|\|/.test(l.text)));
      if (blank) {
        const f = fromTakeOps(store.get(), { take: { clip: clip.id, read }, capo: 0 });
        if (f.line) { run.fromTake = { clip: clip.id }; say('k.paper.fromtake', { chords: f.line.split(' in the ')[0], section: f.line.split(' in the ')[1] }); }
      }
      // a counted take: on the song's grid already, so the band reads its chords and nothing about its time
      if (counted) { landRead({ track: takeTrack(), clip: clip.id, read, counted: true }); return; }
      // the time, confirmed by ear: the found reading with a shaker on it, at once
      const tw = planTime(store.get(), { take: { track: takeTrack(), clip: clip.id, read }, reading: 'found' });
      run.ask = 'time';
      run.chosen = 'found';
      const t = tw.time || { tempo: Math.round(read.result.tempo) };
      run.moves = !!tw.moves;
      if (tw.moves) say(run.phones ? 'k.time.moves' : 'k.time.speakers', { tempo: countTempo() });
      else say('k.time.read', { tempo: t.tempo, lo: t.lo, hi: t.hi, player: 'the shaker' });
      hearReading('found');
      draw();
    }
    // a reading heard at once: the take on that grid with a shaker over it (a preview)
    function hearReading(id) {
      const clip = run.readClip, read = reads.get(clip);
      if (!read) return { ok: false };
      stopPreview();
      run.chosen = id;
      const take = { track: takeTrack(), clip, read };
      const t = planTime(store.get(), { take, reading: id });
      if (!t.ops.length) return { ok: false };
      // the shaker over the whole take, on the song as the time would make it
      const s = previewShaker(t.ops, clip);
      hearOps([...t.ops, ...s], 0);
      draw();
      return { ok: true };
    }
    function previewShaker(timeOps, clip) {
      try {
        const p1 = afterOps(store.get(), timeOps);
        const c = p1.tracks.flatMap((t) => t.clips).find((x) => x.id === clip);
        if (!c) return [];
        const p2 = afterOps(p1, [{ type: 'section.add', section: { id: 'kt_tmp', name: 'Chorus', start: Math.ceil(c.start), length: Math.max(4, Math.floor(c.length)) } }]);
        return planPlayer(p2, { player: 'shaker', section: 'kt_tmp' }).ops;
      } catch (e) { console.warn('overdub kitchen shaker:', e); return []; }
    }
    const afterOps = (p, ops) => after(p, ops);
    function keepTime(id) {
      const clip = run.readClip, read = reads.get(clip);
      if (!read) return { ok: false };
      stopPreview();
      const take = { track: takeTrack(), clip, read };
      const t = planTime(store.get(), { take, reading: id });
      const r1 = store.dispatch(t.ops, { by: 'you', label: t.label, reason: t.reason });
      if (!r1.ok) { console.warn('overdub kitchen time:', r1.error); return r1; }
      return landRead(take);
    }
    // the house's read of a take whose time is the song's (kept by ear, or counted in), then the first player's offer
    function landRead(take) {
      stopPreview();
      run.ask = null;
      run.moves = false;
      const rd = planRead(store.get(), { take });
      if (rd.ops.length) {
        const r2 = store.dispatch(rd.ops, { by: 'overdub', label: rd.label, reason: rd.reason });
        if (!r2.ok) console.warn('overdub kitchen read:', r2.error);
        if (r2.ok) {
          const w = chordsWords(rd);
          if (w) say('k.chords', w);
          if (rd.unknown?.length) later(() => say('k.unknown'), 0);
          run.form = rd.form?.length ? rd.form[rd.form.length - 1] : null;
        }
      }
      // where the take and the paper differ in form, that's asked first (once the chords line has been read); then the
      // first player's offer, played in at once
      if (run.form) {
        const f = run.form, section = String(f.name || 'chorus').replace(/\s+\d+$/, '').toLowerCase();
        const where = f.end ? 'at the end' : f.after ? `after the ${String(f.after).replace(/\s+\d+$/, '').toLowerCase()}` : 'at the top';
        run.ask = 'form';
        later(() => { if (run.ask === 'form') say('k.form', { section, times: f.times, where }); }, 2500);
      } else offerNext(2500);
      draw();
      return { ok: true };
    }
    function offerNext(lineAfter = 0) { const next = nextPlayer(); if (next) offerPlayer(next, { lineAfter }); }
    // the master take's free time, from its read (the song keeps no read): where the players rest. A counted master
    // has none
    const masterFree = () => { const m = roomNow().master; const rd = m ? reads.get(m) : null; return rd && !rd.counted ? rd.result.free : null; };
    function nextPlayer() {
      const o = offeredKitchen(view(), { ...run, offer: null, ask: null });
      return o && o.id.startsWith('offer.') ? o.id.slice(6) : null;
    }
    function offerPlayer(id, { lineAfter = 0 } = {}) {
      stopPreview();
      const where = offerSections(store.get(), id);
      if (!where.length) { run.done.push(id); draw(); return { ok: false }; }
      const r = planPlayer(store.get(), { player: id, section: where, free: masterFree() });
      run.offer = id;
      if (lineAfter) later(() => { if (run.offer === id) say(`k.offer.${id}`); }, lineAfter);
      else say(`k.offer.${id}`);
      const from = store.get().sections.find((s) => s.id === where[0])?.start ?? 0;
      hearOps(r.ops, from);
      draw();
      return { ok: true };
    }
    function keepPlayer() {
      const id = run.offer;
      if (!id) return { ok: false };
      stopPreview();
      const r = planPlayer(store.get(), { player: id, section: offerSections(store.get(), id), free: masterFree() });
      const d = store.dispatch(r.ops, { by: 'you', label: r.label, reason: r.reason });
      run.done.push(id);
      run.offer = null;
      if (d.ok) say('k.player.in', { player: PLAYERS[id].name, where: r.where });
      draw();
      return d;
    }
    function noThanks() { if (!run.offer) return { ok: false }; stopPreview(); run.done.push(run.offer); run.offer = null; draw(); return { ok: true }; }
    // A finish chosen is a step by you, and said with its number: each finish's loudness on this song, measured as the
    // stage does (the busiest part, the chorus else the first, eight bars of it at most, rendered offline through each
    // finish on a copy of the song), the one chosen against the one it replaced
    const FINISHES = ['bare', 'warm', 'close'];
    let levels = null;
    const levelsKey = (p) => JSON.stringify([p.tempo, p.tempoMap?.anchors?.length || 0, p.sections.map((x) => [x.start, x.length]), p.tracks.map((t) => [t.id, t.mute, t.gain, t.clips.map((c) => [c.id, c.mute, c.start, c.length])])]);
    async function finishLevels() {
      const p = store.get(), key = levelsKey(p), assets = app.engine?.assets;
      if (levels?.key === key) return levels.p;
      if (!assets) return null;
      const bpb = beatsPerBar(p.meter || [4, 4]), secs = p.sections.slice().sort((a, b) => a.start - b.start);
      const c = secs.find((x) => /^chorus/i.test(x.name)) || secs[0] || { start: 0, length: 8 * bpb };
      const range = { from: c.start, to: c.start + Math.min(c.length, 8 * bpb) };
      const mine = { key, p: (async () => {
        const out = {};
        for (const f of FINISHES) {
          try {
            const st = createStore(structuredClone(p));
            const pl = planKitchenFinish(st.get(), { finish: f });
            if (pl.ops.length) st.dispatch(pl.ops, { by: 'you' });
            out[f] = Math.round(lufs(await renderProject(st.get(), { ...range, tail: 0, assets })) * 10) / 10;
          } catch (e) { console.warn('overdub kitchen finish level:', f, e?.message || e); }
        }
        return out;
      })() };
      levels = mine;
      return mine.p;
    }
    function finish(f) {
      const than = FINISHES.includes(roomNow().finish) ? roomNow().finish : 'bare';
      if (f === than) return { ok: true };
      const r = planKitchenFinish(store.get(), { finish: f });
      if (!r.ops.length) return { ok: false };
      // (measured on the song as it was played, before the step: the finish is the only change between the two)
      const measured = finishLevels();
      const d = store.dispatch(r.ops, { by: 'you', label: r.label, reason: r.reason });
      if (d.ok) {
        const words = (m) => { if (!live || roomNow().finish !== f) return; const db = m && Number.isFinite(m[f]) && Number.isFinite(m[than]) ? Math.round((m[f] - m[than]) * 10) / 10 : null; say('k.finish', { finish: NAMES.finish[f] || f, than: NAMES.finish[than] || than, db }); };
        Promise.race([Promise.resolve(measured), new Promise((res) => setTimeout(() => res(null), 8000))]).then(words, () => words(null));
      }
      return d;
    }
    function send() {
      stopPreview();
      run.sent = true;
      if (screens.has('send') && app.liveRoom?.open) app.liveRoom.open({ screen: 'send' });
      draw();
      return { ok: true };
    }
    // "You played the chorus twice at the end. Write it as Chorus ×2?": the two passes one section of the song
    function leaveForm() { run.form = null; run.ask = null; offerNext(); draw(); return { ok: true }; }
    function writeForm() {
      const f = run.form;
      if (!f) return { ok: false };
      run.ask = null;
      const p = store.get(), secs = p.sections.slice().sort((a, b) => a.start - b.start);
      const runOf = secs.filter((s) => roomOf(p)?.parts?.[s.id]?.sheet === f.section);
      const group = [];
      for (const s of runOf) { if (group.length && Math.abs(group[group.length - 1].start + group[group.length - 1].length - s.start) > 0.5) { if (group.length >= 2) break; group.length = 0; } group.push(s); }
      if (group.length < 2) return { ok: false };
      const ops = [{ type: 'section.set', section: group[0].id, patch: { length: group.reduce((a, s) => a + s.length, 0) } }, { type: 'room.part.set', section: group[0].id, patch: { reps: group.length } }];
      for (const s of group.slice(1)) ops.push({ type: 'room.part.set', section: s.id, remove: true }, { type: 'section.remove', section: s.id });
      run.form = null;
      const r = store.dispatch(ops, { by: 'you', label: `${f.name} ×${group.length}` });
      offerNext();
      draw();
      return r;
    }
    async function useTake(clipId) {
      let read = reads.get(clipId);
      if (!read) { const c = clipsOn(takeTrack()).find((x) => x.id === clipId); const s = c && (await samplesOf(c)); if (s) { read = await readTapeInWorker(s.x, s.sr); reads.set(clipId, read); } }
      // (a counted take is on the song's grid already: it becomes the master with nothing re-timed)
      const r = planMaster(store.get(), { clip: clipId, read: read && !read.counted ? read : null });
      if (!r.ops.length) return { ok: false };
      const d = store.dispatch(r.ops, { by: 'overdub', label: r.label, reason: r.reason });
      if (d.ok) say('k.master', { n: takeNumber(store.get(), clipId), tempo: r.tempo });
      draw();
      return d;
    }
    function hearTake(dir) {
      const cl = clipsOn(takeTrack()).filter((c) => c.kind === 'audio');
      if (!cl.length) return;
      run.heardTake = Math.max(0, Math.min(cl.length - 1, (run.heardTake ?? cl.length - 1) + dir));
      const want = cl[run.heardTake];
      // a take from the top, bare: that one heard, the others and the band quiet
      const band = PLAYER_ORDER.map((id) => roomNow().tracks?.[PLAYERS[id].role]).filter(Boolean);
      const ops = [...cl.map((c) => ({ type: 'clip.set', track: takeTrack(), clip: c.id, patch: { mute: c.id !== want.id } })), ...band.map((t) => ({ type: 'track.set', track: t, patch: { mute: true } }))];
      hearOps(ops, want.start);
      draw();
    }
    // a player in or out of the selected section (the band chips)
    function togglePlayer(id) {
      const p = store.get(), P = PLAYERS[id];
      const sel = ui.state.liveRoom?.card || null;
      const secs = sel ? [sel] : offerSections(p, id);
      const tid = roomNow().tracks?.[P.role];
      const t = tid ? p.tracks.find((x) => x.id === tid) : null;
      const inIt = t && secs.some((sid) => { const s = p.sections.find((x) => x.id === sid); return s && t.clips.some((c) => c.start < s.start + s.length && c.start + c.length > s.start); });
      if (inIt) {
        const ops = [];
        for (const sid of secs) { const s = p.sections.find((x) => x.id === sid); if (s) for (const c of t.clips) if (c.start < s.start + s.length && c.start + c.length > s.start) ops.push({ type: 'clip.remove', track: t.id, clip: c.id }); }
        store.dispatch(ops, { by: 'you', label: `${P.name} out` });
      } else {
        const r = planPlayer(p, { player: id, section: secs, free: masterFree() });
        if (r.ops.length) store.dispatch(r.ops, { by: 'you', label: r.label, reason: r.reason });
        if (!run.done.includes(id)) run.done.push(id);
      }
      draw();
    }

    /* ------------------------------------------------------------------------------------------- drawing */
    function chip(label, onclick, { pressed = null, disabled = false, id = null, aria = null } = {}) {
      return h('button.kt-chip', { type: 'button', onclick, disabled, 'aria-pressed': pressed == null ? null : String(pressed), 'aria-label': aria, dataset: id ? { act: id } : {} }, label);
    }
    function draw() {
      root.dataset.step = run.step;
      root.classList.toggle('kt-dim', run.rolling);
      const o = offered();
      // (nothing to press: what the room's doing instead, or no button at all; never a blank green bar)
      const busy = run.reading ? 'The band’s reading it' : run.step === 'balance' ? 'Listening' : '';
      go.querySelector('.kt-go-label').textContent = o ? o.label : busy;
      go.disabled = !o;
      go.hidden = !o && !busy;
      go.dataset.act = o ? o.id : '';
      choices.replaceChildren();
      q.textContent = '';
      // (the question's answers first, under it; how it's miked after them, on its own row)
      const mics = [];
      if (run.step === 'phones' || run.step === 'balance' || run.step === 'how') {
        mics.push(h('span.kt-break'), h('span', 'Miked'));
        for (const m of MICS) mics.push(chip(m.id === 'two' && !twoMoving() ? `${m.label} · needs a guitar with a pickup` : m.label, () => pickMic(m.id), { pressed: run.mic === m.id, disabled: m.id === 'two' && !twoMoving(), id: `mic.${m.id}`, aria: m.id === 'two' && !twoMoving() ? words('k.pickup.needed') : null }));
      }
      if (run.step === 'phones') {
        q.textContent = words('k.phones');
        choices.append(chip('Yes', () => answerPhones(true), { id: 'phones.yes' }), chip('No, speakers', () => answerPhones(false), { id: 'phones.no' }));
      } else if (run.step === 'balance') {
        q.textContent = run.balance?.phase === 'sing' ? 'Sing a line, or speak one.' : 'Strum the way you’ll play.';
        choices.append(chip(words('k.balance.skip'), skipBalance, { id: 'balance.skip' }));
      } else if (run.ask === 'time') {
        for (const [id, label] of [['found', 'On the beat'], ['double', 'Twice as fast'], ['half', 'Half as fast'], ['downbeat', 'The 1’s a beat later']]) {
          if (!reads.get(run.readClip)?.result.readings.some((r) => r.id === id)) continue;
          choices.append(chip(label, () => hearReading(id), { pressed: run.chosen === id, id: `time.${id}` }));
        }
      } else if (run.offer) {
        choices.append(chip('No thanks', noThanks, { id: 'nothanks' }));
      }
      if (mics.length) choices.append(...mics);
      // on headphones, beside the bare tape: Count me in, at a tempo set first (− +, ← →, T)
      if (canCount()) {
        choices.append(
          chip('−', () => nudgeTempo(-1), { id: 'tempo.down', aria: 'Slower' }),
          chip(`Count me in at ${countTempo()}`, () => press('count'), { id: 'count' }),
          chip('+', () => nudgeTempo(1), { id: 'tempo.up', aria: 'Faster' }));
      }
      if (run.fromTake && run.ask !== 'time') {
        // (the key the take sounds in, as read: the song has none of its own yet)
        const k = reads.get(run.fromTake.clip)?.result?.key || store.get().key;
        for (const c of capoChoices(k)) choices.append(chip(c.capo ? `${c.shapes} shapes, capo ${c.capo}` : 'No capo', () => writeFromTake(c.capo), { id: `fromtake.${c.capo}` }));
      }
      if (run.ask === 'form' && run.form) choices.append(chip(`Write it as ${String(run.form.name).replace(/\s+\d+$/, '')} ×${run.form.times}`, writeForm, { id: 'form' }), chip('Leave it as played', leaveForm, { id: 'form.no' }));
      // the takes: whole passes, "Take 1", the master pressed
      takesRow.replaceChildren();
      const cl = takeTrack() ? clipsOn(takeTrack()).filter((c) => c.kind === 'audio') : [];
      if (cl.length) {
        cl.forEach((c, i) => { const m = roomNow().master === c.id; takesRow.append(chip(`Take ${i + 1}`, () => { run.heardTake = i; hearTake(0); }, { pressed: m, id: `take.${i + 1}`, aria: m ? `Take ${i + 1}, the master` : null })); });
        const sel = run.heardTake != null ? cl[run.heardTake] : null;
        if (sel && roomNow().master !== sel.id) takesRow.append(chip('Use this one', () => useTake(sel.id), { id: `use.${sel.id}` }));
      }
      // the band: in or out of the selected section
      bandRow.replaceChildren();
      if (store.get().sections.length) {
        bandRow.append(h('span', 'Band'));
        for (const id of PLAYER_ORDER) {
          const tid = roomNow().tracks?.[PLAYERS[id].role];
          const has = !!tid && store.get().tracks.some((t) => t.id === tid && t.clips.length);
          bandRow.append(chip(PLAYERS[id].name.toLowerCase(), () => togglePlayer(id), { pressed: has, id: `band.${id}` }));
        }
      }
      // the finish, and Send a mix once there's a band to send
      finishRow.replaceChildren();
      if (roomNow().master) {
        const f = roomNow().finish || 'bare';
        for (const id of ['bare', 'warm', 'close']) finishRow.append(chip(id[0].toUpperCase() + id.slice(1), () => { finish(id); draw(); }, { pressed: f === id, id: `finish.${id}` }));
        if (run.done.length || run.heard) finishRow.append(chip('Send a mix', send, { id: 'send' }));
      }
    }
    function writeFromTake(capo) {
      const clip = run.fromTake?.clip, read = reads.get(clip);
      if (!read) return;
      const f = fromTakeOps(store.get(), { take: { clip, read }, capo });
      const r = f.ops.length ? store.dispatch(f.ops, { by: 'overdub', label: f.label, reason: f.reason }) : null;
      run.fromTake = null;
      // with the time kept, the band reads the master again with the chords now on the paper
      const m = roomNow().master, mr = m ? reads.get(m) : null;
      if (r?.ok && mr && !run.rolling) { landRead({ track: takeTrack(), clip: m, read: mr, ...(mr.counted ? { counted: true } : {}) }); return; }
      draw();
    }
    draw();

    /* ------------------------------------------------------------------------------------------- keys */
    const editing = () => paper.editing() || (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) || document.activeElement?.isContentEditable;
    const when = () => ui.state.liveRoom?.open && ui.state.liveRoom.screen === 'kitchen' && !editing();
    const keys = [
      { key: 'Space', label: 'The offered move', run: () => { press(offered()?.id); } },
      { key: 'PageDown', label: 'The offered move', run: () => { press(offered()?.id); } },
      { key: 'Escape', label: 'Not that one', run: () => { if (run.rolling) notThatOne(); else if (run.offer) noThanks(); else if (run.playing) { stopPreview(); draw(); } } },
      { key: 'ArrowLeft', label: 'Slower, for the count', run: () => nudgeTempo(-1) },
      { key: 'ArrowRight', label: 'Faster, for the count', run: () => nudgeTempo(1) },
      { key: 'ArrowLeft', mod: 'shift', label: 'Ten slower, for the count', run: () => nudgeTempo(-10) },
      { key: 'ArrowRight', mod: 'shift', label: 'Ten faster, for the count', run: () => nudgeTempo(10) },
      { key: 'KeyT', label: 'Tap the tempo for the count', run: () => tap(performance.now()) },
      { key: 'ArrowUp', label: 'The take before', run: () => hearTake(-1) },
      { key: 'ArrowDown', label: 'The next take', run: () => hearTake(1) },
      { key: 'KeyY', label: 'Headphones on', run: () => { if (run.step === 'phones') answerPhones(true); } },
      { key: 'KeyN', label: 'Speakers', run: () => { if (run.step === 'phones') answerPhones(false); } },
    ];
    const offs = [];
    for (const k of keys) {
      try { offs.push(ui.keys.add({ ...k, first: true, when, group: 'Live room' })); } catch (e) { console.warn('overdub kitchen key', k.key, e); }
    }

    current = { state: () => ({ ...run, done: run.done.slice(), offered: offered(), reads: reads.size, preview: !!preview, hold: !!takeHold }) };
    return {
      frame(now) {
        balanceFrame(now);
        paper.frame(now);
        if (run.rolling) counter.textContent = mmss((performance.now() - rollStart) / 1000);
        else if (!run.playing) counter.textContent = '';
        if (run.playing && app.engine && !app.engine.playing && !run.rolling) { run.playing = false; draw(); }
        if (now - lastCanvas > 66) {
          lastCanvas = now;
          try { ctx.scene?.draw?.(g, { ...view(), place: 'kitchen', rolling: run.rolling }, now); } catch { /* the scene is E's */ }
        }
      },
      press,
      unmount() {
        live = false;
        stopPreview();
        releaseHold();
        for (const off of offs) { try { off?.(); } catch { /* gone */ } }
        paper.unmount();
        current = null;
        el.replaceChildren();
      },
    };
  },
});
