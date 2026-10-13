// Start a song: a blank song's way in, and a stage to play the first idea on at any speed. The studio keeps time for
// you: tap a beat in free time (no click), go round as many times as you like, and the tempo, the loop and the 1 are
// read from what you played (input/rounds.js); what you played most often is kept. Done puts it in the song at once,
// one undo step signed you (core/start.js planStart), and the stage loops it while you choose the timing (Tight,
// Loose, As played) or another reading ("Not quite?"). Then the next part: Hum over it.
//
// The door is the blank song's empty state (arranger.js syncEmpty draws doorOf here), on every blank song: Tap a beat
// (the primary), Hum a tune (over a simple beat), Play the keys, Flip a song (ui/flip.js: a song you own, split,
// mapped and marked), and with no playing in time Draw a beat, Pick a groove or Ask your agent. Nothing pops up over a
// song with tracks.
//
// The stage covers the centre column (the arranger and the bottom pane, inert under it); the top bar and the agent
// stay. On a phone it is the whole screen. Steps:
//   'play'      Tap your beat: four pads (F J K L, or the pads on screen, on pointerdown), heard at once on a previewed
//               Drums track (store.preview: nothing in History). Your first hit starts the clock; after six hits over
//               three seconds the BPM shows, after two bars' worth the bar lines fade in under your hits, and once a
//               repeat is found the rounds are counted. Done (Space, Enter) lands it; Start again (Backspace) clears
//               it (the hits stay in Takes); "Play to a click instead" swaps the window for the click view (below).
//   'play' over a click (S.view 'click'): Tap your beat with the click. A 2-bar window (ui/beatwindow.js) with a ball
//               on the engine's beat; each take starts from a stopped transport with a bar of count-in (4 3 2 1, "Come
//               in on 1."), then loops with no count. Speed (Slow 80 / Easy 100 / Upbeat 120, ← →) and Tap it (T four
//               times or more: timing.js findPulse) are previews of the tempo, and restart the take. Each time round
//               is a round: at every wrap the rounds so far are folded (rounds.js foldRounds) and the fold at Tight
//               plays under you on the previewed Drums track, so a one-off miss is never played back as a cue. Done
//               lands the fold as a free take lands (planStart, one undo step by you, at the click's tempo). "Free time
//               instead" swaps back. The click is lent for the view (on, and off again after) if it was off.
//   'hum'       Hum over this beat: a simple beat loops at Easy 100 (Speed Slow 80 / Easy 100 / Upbeat 120, Beat
//               Simple / Rock / Lo-fi, all previews). Hum (H) puts the beat in the song and records the hum over it on
//               the stage, a bar of count-in first, each time round a take (Space stops: the steadiest round plays;
//               the beat and the tune are one undo step). "No beat; I'll hum freely" stays on the stage: the pitch
//               trace and the notes as they form, the ruler once the pulse is steady, and Done lands it at the best
//               reading. Both are ui/start-hum.js.
//   'in'        Your beat (or tune) is in the song: what was kept and left out, counted; Timing (Tight / Loose / As
//               played, ← →), each a change joined to the landing's undo step (a hum: the In tune lamp on that line
//               too); the sound card (ui/sounds.js, hosted here: Keep is its own undo step, ↓ tries the next sound);
//               Hum over it (Enter, the primary; a hum's is Back to the song); Not quite?; Back to the song (Esc).
//   'readings'  Which one nods along with you? The other place the 1 could be and the tempo halved or doubled (a hum:
//               rounds.js humReadingsOf, a soft tick on every beat under it, and Hum it again over a beat); picking
//               one plays it at once (joined to the landing); Use this one, or Esc puts back what was there.
//   'choose'    the same readings step for another flow (app.start.choose: Flip a song's grids, ui/flip.js): its own
//               title and rows; picking one plays it (opts.pick), Use this one keeps it (opts.use), Back or Esc puts
//               back what was there (opts.back, also on any other way out).
// Esc before any hit closes the stage; after hits it asks once ("Leave without keeping this take? It stays in Takes.").
// "Skip to the studio" is always at the top right. While the stage is open the agent's song-changing tools wait
// (app.start.busy, read by agent/tools.js's recording check) and the studio's keys stay under it.
//
// Over the song (open({ kind, over: { track, clip } }): the coach strip's Hum over it, Play keys over it, Tap more on
// the drums and Tap a beat over it, ui/coach-strip.js): the stage reopens with the song as the guide. The loop runs over
// the clip's bars (a hum's made 4 bars with the song's own Make it longer, sketch.js longerPlan, when Hum is pressed:
// one undo step with the take), Speed and Beat are hidden and the tempo never changes. A hum or the keys go onto a new
// track (core/sounds.js newPartFor, the recorder's 'take' mode, the steadiest round kept); taps go over the click view
// at the song's tempo, and Done folds them into the Drums clip (what was there stays; notes.add) or, over a tune, onto a
// new Drums track. The stage's primary on 'in' is the run's next part (app.coach.after), else Hum over it.
// close emits { from, to, kind, free, over, landed, under } (landed: the take that went in while it was open, or null).
//
// app.start = { open({ kind = 'tap' | 'hum' | 'keys', view = 'free' | 'click', free (a hum: no beat), over }), close(), step, kind, view, busy, tap(row, perfMs), done(), again(),
//   humNow() (Hum over the beat), humFree() (the free hum), hum() (the hum now: { mode, on, notes, bpm, fit, ruler } or
//   { mode: 'beat', rec, state, round, speed }), setTune(on), againOverBeat(), tick() (Promise of the reading tick's
//   level: { take, tick, under, gain } dB),
//   setView('free' | 'click'), setSpeed(bpm), tapTempo(perfMs), click() (the click view's take: { bpm, hits, rounds, kept, left,
//   playAt, openAt } or null), window() (the beat window's last frame: ui/beatwindow.js state()),
//   setLevel(level), readings(), useReading(i), landed(), take(), tempoShown() (the BPM shown while you play, or null:
//   the top bar's "~"), on('step' | 'land' | 'close', fn),
//   choose({ run, title, sub, items: [{ main, what }], at, pick(i) -> ok, use(i), back() }), pickChoice(i) }
// While the pulse is weak (the reading's fit under 0.5) the status line asks for one more time round; Done is never
// blocked. A landed take goes to capture with its clip id, what was played as played and the rounds (capture.ofClip).
// On 'in' the stage holds the sound card (app.sounds.setHost, then offer({ track, from: 'take', take })) and gives the
// host back when it closes; the card's Keep is a .btn there (one primary a region) and the line says what plays now.
//
// All of the above is the start.slice2 toggle (app/src/toggles.js). Off, doorOf and the default export hand over to
// ui/start-slice1.js (slice 1 as main had it); the other switch points are listed in docs/ARCHITECTURE.md (Toggles).

import { h, css, canvas, tok, byline } from './dom.js';
import { ROWS } from '../input/tap.js';
import { takeOf, atLevel, moved, foldRounds } from '../input/rounds.js';
import { LEVELS, findPulse, snapGentle } from '../input/timing.js';
import { mountBeatWindow, OPEN } from './beatwindow.js';
import { humStage, tuned } from './start-hum.js';
import { noteName, keyLabel } from '../core/music.js';
import { planStart } from '../core/start.js';
import { isDrumTrack } from '../input/recorder.js';
import { TYPE_MAP } from '../input/qwerty.js';
import { longerPlan } from './sketch.js';
import { putGroove } from '../agent/grooves-tool.js';
import { on as toggleOn } from '../toggles.js';
import slice1, { doorOf as doorOfSlice1 } from './start-slice1.js';

const LEVEL_WORD = { tight: 'Tight', loose: 'Loose', played: 'As played' };
const SPEEDS = [['Slow', 80], ['Easy', 100], ['Upbeat', 120]];
const BEATS = [['Simple', 'pop/eighths'], ['Rock', 'rock/straight-eighths'], ['Lo-fi', 'lofi/dusty']];
const PAD_ROWS = ['kick', 'snare', 'hat', 'open'];
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const agentName = (app) => app.agent?.name || app.agent?.provider?.name || null;

// The door: the blank song's ways in. ctx: { addTrackMenu(anchor), showAgent(), openDemo() } from the arranger.
// (start.slice2 off: the door and the stage are slice 1's, ui/start-slice1.js, as main had them)
export function doorOf(app, ctx = {}) {
  if (!toggleOn('start.slice2')) return doorOfSlice1(app, ctx);
  const go = (fn) => (e) => { e?.preventDefault?.(); fn(); };
  const st = () => app.start;
  const tap = () => (st() ? st().open({ kind: 'tap' }) : app.onboard?.firstMinute?.('tap'));
  const hum = () => (st() ? st().open({ kind: 'hum' }) : app.ui.show('sketch'));
  // (the doors that don't use the stage: the coach strip docks when their first part lands, app.coach.expect)
  const expect = (door) => { try { app.coach?.expect?.(door); } catch { /* ok */ } };
  const keys = () => { expect('keys'); return app.onboard?.keysOver ? app.onboard.keysOver() : app.ui.show('sketch'); };
  const flip = () => (app.flip ? app.flip.pick() : app.importers?.pickAudio?.());
  const row = (label, why, run, primary = false, key = null) => h('li.st-way', { onclick: (e) => { if (!e.target.closest('button')) run(); } },
    h(primary ? 'button.btn.btn-go.st-way-b' : 'button.btn.st-way-b', { type: 'button', onclick: go(run), dataset: { way: label }, 'aria-describedby': null }, label),
    h('span.st-way-why', why, key ? [' ', h('kbd', key)] : null),
    h('span.st-way-arrow', { 'aria-hidden': 'true' }, '→'));
  const ledger = h('ul.ledger.st-ways.ar-empty-actions', { 'aria-label': 'Ways into the song' },
    row('Tap a beat', 'F J K L on your keys, or the pads on screen. Any speed.', tap, true),
    row('Hum a tune', 'Over a simple beat, or on its own. Nothing records until you press Hum.', hum),
    row('Play the keys', 'Your computer keys or a MIDI keyboard. Any speed.', keys),
    // (behind workflow.flip: off, the door has its three ways)
    toggleOn('workflow.flip') ? row('Flip a song', 'Bring a song you own. It gets split, mapped and marked; the drop is yours.', flip) : null);
  // ↑ ↓ walk the ways
  ledger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const bs = [...ledger.querySelectorAll('.st-way-b')], i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
  });
  const name = agentName(app);
  return h('div.ar-empty-card.st-door',
    h('h2.ar-empty-title.disp', 'Take 1 is yours.'),
    h('p.ar-empty-text', 'Bring one idea. Play it at any speed; the studio sets the tempo from you.'),
    ledger,
    h('p.st-notime', h('span.t3', 'No playing in time: '),
      h('button.btn.btn-txt', { type: 'button', title: 'Click squares in the Beat tab: nothing to play in time', onclick: () => { expect('draw'); return app.beat?.draw ? app.beat.draw() : app.ui.show('drumgrid'); } }, 'Draw a beat'), ' ',
      h('button.btn.btn-txt', { type: 'button', onclick: () => { expect('groove'); app.ui.show('grooves'); } }, 'Pick a groove'), ' ',
      h('button.btn.btn-txt.ar-empty-agent', { type: 'button', onclick: () => { expect('ask'); ctx.showAgent?.(); app.ui.emit('agent:compose', { text: 'I have an idea. Help me get it down.' }); } }, name ? `Ask ${name}` : 'Ask your agent')),
    h('p.ar-empty-foot', 'Or ', h('span', { dataset: { feature: 'tracks' } }, h('button.ar-link', { type: 'button', onclick: (e) => ctx.addTrackMenu?.(e.currentTarget) }, 'add a track'), ' yourself, or '), 'hear a finished one: ', h('button.ar-link.ar-empty-demo', { type: 'button', onclick: () => ctx.openDemo?.() }, 'Night Shift'), '.'));
}

export default function (app) {
  if (!toggleOn('start.slice2')) return slice1(app);
  const { store, ui, engine } = app;
  css('start', CSS);
  const fns = new Map();
  const emit = (t, d) => { if (t === 'land' && d?.clip) S.everLanded = { track: d.track, clip: d.clip }; for (const fn of fns.get(t) || []) { try { fn(d); } catch (e) { console.error('start listener', e); } } };

  // the session's state (never the song's): what is open, what has been played, what landed
  const S = { step: null, kind: null, view: 'free', hits: [], read: null, pads: null, guide: null, ckTempo: null, ckFold: null, speed: 100, beat: BEATS[0][1], landed: null, level: 'tight', reading: 0, before: null, asking: false, gridAt: 0, flash: new Map(), ck: null, clickLent: false, hum: null, under: null, tune: true, tick: null, inLine: '', trying: null, over: null, everLanded: null, choice: null };
  let stage = null, body = null, statusEl = null, opener = null;
  const mainEl = () => document.querySelector('.ew-main');
  const under = () => { const m = mainEl(); return m ? [...m.children].filter((c) => c !== stage) : []; };
  const bpbOf = () => { const m = store.get().meter || [4, 4]; return (m[0] * 4) / m[1]; };

  /* ---------------------------------------------------------------- previews: heard, never in History */
  function release() {
    // (last made, first given back: the fold's clip sits on the pads' track)
    for (const k of ['tick', 'ckFold', 'ckTempo', 'pads', 'guide']) { const p = S[k]; S[k] = null; if (p) { try { p.release(); } catch (e) { console.error('start: preview release', e); } } }
  }
  // (a page going away gives the previews back first, before the autosave's flush: capture runs ahead of it)
  window.addEventListener('pagehide', () => { if (S.pads || S.guide || S.ckTempo || S.tick) { try { engine.stop?.(); } catch { /* ok */ } release(); } }, true);
  function padsTrack() {
    // (Tap more on the drums: the pads sound on the Drums track itself)
    if (S.over?.drums && store.track(S.over.track)) return S.over.track;
    if (S.pads && store.track(S.pads.created?.pads)) return S.pads.created.pads;
    const r = store.preview({ type: 'track.add', ref: 'pads', track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } } }, { by: 'you' });
    if (!r.ok) return null;
    S.pads = r;
    return r.created.pads;
  }
  // the guide beat: a groove on a previewed Drums track, the loop over it, at the chosen speed
  function guideOn() {
    if (S.guide) { try { S.guide.release(); } catch { /* ok */ } S.guide = null; }
    const plan = putGroove(app, { groove: S.beat, track: null, bar: 0, bars: 4, dryRun: true });
    if (!plan.ok) { say(plan.error || 'The beat could not load.'); return false; }
    const ops = [{ type: 'project.set', patch: { tempo: S.speed, loop: { on: true, start: 0, end: 4 * bpbOf() } } }, ...plan.ops];
    const r = store.preview(ops, { by: 'you' });
    if (!r.ok) { say(r.error); return false; }
    S.guide = r;
    S.guidePlan = { ops: plan.ops, summary: plan.summary };
    try { if (!engine.playing) engine.play(0); } catch { /* silent engine */ }
    return true;
  }

  /* ---------------------------------------------------------------- the stage */
  function mount() {
    if (stage) return;
    const m = mainEl();
    if (!m) return;
    opener = document.activeElement;
    statusEl = h('p.st-status', { role: 'status', 'aria-live': 'polite' });
    body = h('div.st-body');
    stage = h('section.st-stage', { role: 'region', 'aria-label': 'Start a song', tabindex: -1 },
      h('header.st-top', h('span.st-run.disp-s', 'Start a song'), h('span.st-stepname', ''), h('span.st-gap'), h('span.st-alt'),
        h('button.btn.btn-txt.st-skip', { type: 'button', onclick: () => close({ to: 'studio' }) }, 'Skip to the studio')),
      body);
    m.classList.add('st-on');
    m.append(stage);
    for (const c of under()) c.inert = true;
    document.documentElement.classList.add('st-open');
  }
  function unmount() {
    if (!stage) return;
    for (const c of under()) c.inert = false;
    mainEl()?.classList.remove('st-on');
    stage.remove();
    stage = null; body = null;
    document.documentElement.classList.remove('st-open');
    try { if (opener?.isConnected) opener.focus(); } catch { /* ok */ }
    opener = null;
  }
  const say = (text) => { if (statusEl) statusEl.textContent = text || ''; };
  function setStep(step) {
    S.step = step;
    S.asking = false;
    if (stage) {
      stage.querySelector('.st-stepname').textContent = step === 'choose' ? S.choice?.stepName || 'Pick a reading' : { play: 'Play it', hum: 'Play it', in: 'It’s in', readings: 'It’s in' }[step] || '';
      stage.querySelector('.st-run').textContent = step === 'choose' ? S.choice?.run || 'Start a song' : 'Start a song';
      stage.setAttribute('aria-label', step === 'choose' ? S.choice?.run || 'Start a song' : 'Start a song');
      stage.dataset.step = step;
    }
    draw();
    // (the step's controls were redrawn: focus that was on one goes to the step's first control, not the page)
    if (stage && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) { const f = stage.querySelector('.st-first') || stage; try { f.focus({ preventScroll: true }); } catch { /* ok */ } }
    emit('step', step);
  }

  // the part the stage plays over: its clip's whole bars, the song's tempo, and what's on it now (Tap more keeps it)
  function overOf(o) {
    const f = o && (o.clip ? store.findClip(o.clip) : null);
    if (!f || f.clip.kind !== 'notes') return null;
    const bpb = bpbOf(), a = Math.floor(f.clip.start / bpb + 1e-6) * bpb, b = Math.max(a + bpb, Math.ceil((f.clip.start + f.clip.length) / bpb - 1e-6) * bpb);
    return { track: f.track.id, clip: f.clip.id, name: f.track.name, start: a, length: b - a, drums: isDrumTrack(f.track), tempo: store.get().tempo, base: f.clip.notes.map(({ p, t, d, v }) => ({ p, t, d, v })) };
  }
  function open({ kind = 'tap', view = 'free', free = false, over = null } = {}) {
    if (S.step) close({ quiet: true });
    const ov = over ? overOf(over) : null;
    if (over && !ov) { ui.toast('That part isn’t in the song any more.'); return false; }
    if (!ov && store.get().tracks.some((t) => t.clips.length)) { ui.toast('Start a song is for a blank song: Song ▸ New song gives you one.'); return false; }
    try { app.input?.qwerty?.on && app.input.qwerty.toggle(false); } catch { /* ok */ }
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    Object.assign(S, { kind, view: 'free', ck: null, hits: [], read: null, landed: null, level: 'tight', reading: 0, before: null, gridAt: 0, hum: null, under: null, tune: true, inLine: '', trying: null, over: ov, everLanded: null, take: null });
    mount();
    if (kind === 'hum' || kind === 'keys') { S.hum = { mode: kind === 'keys' ? 'keys' : 'beat', rec: false, busy: false }; setStep('hum'); if (ov) hum.overLoop(); else if (free) hum.freeStart(); else guideOn(); }
    else { setStep('play'); padsTrack(); if (ov || view === 'click') setView('click'); }
    requestAnimationFrame(() => { const b = stage?.querySelector('.st-first') || stage; try { b?.focus({ preventScroll: true }); } catch { /* ok */ } });
    return true;
  }
  function close({ to = 'studio', quiet = false } = {}) {
    if (!S.step) return;
    // (a take played and not kept stays in Takes)
    if (S.step === 'play' && played()) keepInTakes();
    if (S.step === 'hum') hum.stop({ quiet });
    // (another flow's readings left any way but Use this one: what was there goes back)
    if (S.step === 'choose' && S.choice && !S.choice.settled) { S.choice.settled = true; try { S.choice.back?.(); } catch (e) { console.error('start: choose back', e); } }
    giveHost();
    const playing = S.step === 'in' || S.step === 'readings' || S.step === 'choose';
    if (!playing || to !== 'song') { try { if (engine.playing && (S.guide || S.step === 'play')) engine.stop(); } catch { /* ok */ } }
    release();
    giveClick();
    clearTimeout(S.ck?.tapTimer);
    S.view = 'free'; S.ck = null;
    const was = S.step;
    // (what the coach strip needs: the door, the take that went in while it was open, the beat a hum went over)
    const info = { from: was, to, kind: S.kind, free: !!S.take?.free, over: S.over ? { track: S.over.track, clip: S.over.clip, drums: S.over.drums } : null,
      landed: S.everLanded && store.findClip(S.everLanded.clip) ? { track: S.everLanded.track, clip: S.everLanded.clip } : null,
      under: S.under?.clip && store.findClip(S.under.clip) ? { track: S.under.track, clip: S.under.clip } : null };
    S.step = null; S.kind = null; S.asking = false; S.hum = null; S.over = null; S.everLanded = null; S.choice = null;
    unmount();
    if (!quiet) emit('close', info);
  }
  function keepInTakes() {
    const cap = app.input?.capture;
    if (S.view === 'click') {
      // (over the click: the hits on the click's beats, as played, at its tempo)
      const ck = S.ck;
      if (!cap || !ck || !ck.hits.length) return;
      try { cap.add({ src: 'tap', kind: 'drums', notes: ck.hits.map((x) => ({ p: x.p, t: Math.max(0, snap(x.g)), d: 0.25, v: x.v })), tempo: ck.bpm, beat: 0, track: null }); } catch (e) { console.error('start: capture', e); }
      return;
    }
    const r = S.read || takeOf(S.hits.map(hitOf), { bpb: bpbOf() });
    if (!cap || !r) return;
    try { cap.add({ src: 'tap', kind: 'drums', notes: r.notes.map(({ p, t, d, v }) => ({ p, t, d, v })), tempo: r.bpm, beat: null, track: null, free: { bpm: r.bpm, fit: r.fit.fit, drift: r.fit.drift } }); } catch (e) { console.error('start: capture', e); }
  }

  /* ---------------------------------------------------------------- playing */
  const hitOf = (x) => ({ t: x.t, p: x.p, v: x.v });
  function tap(row, perfMs = performance.now(), v = 0.85) {
    if (S.step !== 'play') return false;
    const r = ROWS.find((x) => x.id === row);
    if (!r) return false;
    const tid = padsTrack();
    if (tid) { try { engine.liveNoteOn(tid, r.p, v); setTimeout(() => { try { engine.liveNoteOff(tid, r.p); } catch { /* ok */ } }, 160); } catch { /* silent engine */ } }
    if (S.view === 'click') return clickHit(r, row, perfMs, v);
    S.hits.push({ t: perfMs / 1000, p: r.p, v, row });
    S.flash.set(row, performance.now());
    if (S.asking) { S.asking = false; }
    S.read = S.hits.length >= 3 ? takeOf(S.hits.map(hitOf), { bpb: bpbOf() }) : null;
    syncPlay();
    return true;
  }
  function again() {
    if (S.step !== 'play') return;
    if (S.view === 'click') { const had = S.ck?.hits.length; if (had) keepInTakes(); startTake(); if (had) say('Cleared. That take is in Takes if you want it back.'); return; }
    if (S.hits.length) keepInTakes();
    S.hits = []; S.read = null; S.gridAt = 0;
    say('Cleared. That take is in Takes if you want it back.');
    syncPlay();
  }
  const span = () => (S.hits.length ? S.hits[S.hits.length - 1].t - S.hits[0].t : 0);
  const showBpm = () => !!S.read && S.hits.length >= 6 && span() >= 3;
  // another flow's readings (Flip a song's grids): the stage's readings step with its own rows
  function choose(opts) {
    if (!opts || !Array.isArray(opts.items) || !opts.items.length) return false;
    if (S.step) close({ quiet: true });
    S.choice = { ...opts, i: Math.max(0, Math.min(opts.items.length - 1, opts.at || 0)), settled: false };
    S.kind = 'choose';
    mount();
    setStep('choose');
    return true;
  }
  function pickChoice(i) {
    const c = S.choice;
    if (S.step !== 'choose' || !c) return false;
    i = Math.max(0, Math.min(c.items.length - 1, i));
    let ok = true;
    try { ok = c.pick ? c.pick(i) !== false : true; } catch (e) { console.error('start: choose pick', e); ok = false; }
    if (ok) c.i = i;
    draw();
    return ok;
  }
  function useChoice() {
    const c = S.choice;
    if (S.step !== 'choose' || !c) return false;
    c.settled = true;
    try { c.use?.(c.i); } catch (e) { console.error('start: choose use', e); }
    close({ to: 'song' });
    return true;
  }
  function done() {
    if (S.step === 'choose') return useChoice();
    if (S.step === 'play') return S.view === 'click' ? landClick() : land();
    if (S.step === 'in') return next();
    if (S.step === 'readings') return useReading(S.reading, { back: true });
    if (S.step === 'hum') return hum.done();
    return false;
  }
  function land() {
    const r = S.hits.length >= 4 ? (S.read || takeOf(S.hits.map(hitOf), { bpb: bpbOf() })) : null;
    if (!r) { say(S.hits.length ? 'A few more hits, and the studio can find the beat.' : 'Your first hit starts the clock.'); return false; }
    release();
    const notes = atLevel(r.notes, 'tight', { length: r.length });
    const plan = planStart(store.get(), { notes, bpm: r.bpm, length: r.length, kind: 'drums' });
    const res = store.dispatch(plan.ops, { by: 'you', label: plan.label });
    if (!res.ok) { say(`That didn't go in: ${res.error}`); padsTrack(); return false; }
    const track = store.get().tracks.find((t) => t.clips.some((c) => c.id === res.created.c));
    S.landed = { txn: res.txn.id, track: track?.id || null, clip: res.created.c };
    S.take = r; S.level = 'tight'; S.reading = 0;
    // the take, with what was played as played, goes to capture under the clip's id (Timing and the readings re-plan
    // from it after the stage closes): kept, so Takes shows it on the track
    try { app.input?.capture?.add({ src: 'tap', kind: 'drums', notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })), tempo: r.bpm, beat: 0, track: S.landed.track, clip: S.landed.clip, raw: S.hits.map(hitOf), rounds: r.fold.rounds, free: { bpm: r.bpm, fit: r.fit.fit, drift: r.fit.drift }, kept: [{ track: S.landed.track, clip: S.landed.clip, at: Date.now() }] }); } catch (e) { console.error('start: capture', e); }
    try { ui.select({ track: S.landed.track, clip: S.landed.clip, notes: [] }); } catch { /* ok */ }
    try { engine.play(0); } catch { /* silent engine */ }
    S.inLine = ''; S.trying = null;
    setStep('in');
    hostCard();
    emit('land', { ...S.landed });
    return true;
  }
  /* ---------------------------------------------------------------- over a click (S.view 'click') */
  const played = () => (S.view === 'click' ? (S.ck?.hits.length || 0) : S.hits.length);
  const snap = (b) => snapGentle(b, { coarse: 0.5, fine: 0.25 });
  const loopLen = () => (S.over ? S.over.length : 2 * bpbOf());
  const base = () => (S.over ? S.over.start : 0);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  // the click is the studio's, not the song's: lent for the view when it was off, and given back after
  function lendClick() {
    if (S.clickLent) return;
    let on = false;
    try { on = !!engine.metronome; } catch { /* no engine */ }
    if (on) return;
    S.clickLent = true;
    try { app.transport.click.set({ on: true }); } catch { try { engine.metronome = true; } catch { /* ok */ } }
  }
  function giveClick() {
    if (!S.clickLent) return;
    S.clickLent = false;
    try { app.transport.click.set({ on: false }); } catch { try { engine.metronome = false; } catch { /* ok */ } }
  }
  function dropPreview(k) { const p = S[k]; S[k] = null; if (p) { try { p.release(); } catch (e) { console.error('start: preview release', e); } } }
  function setView(view) {
    if (S.step !== 'play' || (view !== 'click' && view !== 'free') || view === S.view) return false;
    if (played()) keepInTakes();
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    dropPreview('ckFold'); dropPreview('ckTempo');
    S.hits = []; S.read = null; S.gridAt = 0; S.asking = false;
    if (view === 'click') {
      S.view = 'click';
      S.ck = { bpm: S.over ? S.over.tempo : S.speed || 100, hits: [], taps: [], tapTimer: 0, tapLine: '', folded: 0, fold: null, playAt: 0, openAt: 0 };
      lendClick();
      draw();
      startTake();
    } else {
      clearTimeout(S.ck?.tapTimer);
      S.view = 'free'; S.ck = null;
      giveClick();
      draw();
    }
    emit('view', S.view);
    return true;
  }
  // A take over the click: from a stopped transport, a bar of count-in, then round the loop with no count
  function startTake() {
    const ck = S.ck;
    if (!ck) return;
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    dropPreview('ckFold'); dropPreview('ckTempo');
    Object.assign(ck, { hits: [], folded: 0, fold: null, openAt: 0 });
    bw?.clear();
    padsTrack();
    // the tempo and the 2-bar loop: heard, never in History until Done (over the song: its tempo, the clip's bars)
    const r = store.preview({ type: 'project.set', patch: { ...(S.over ? {} : { tempo: ck.bpm }), loop: { on: true, start: base(), end: base() + loopLen() } } }, { by: 'you' });
    if (r.ok) S.ckTempo = r;
    ck.playAt = performance.now();
    try { const p = engine.play(base(), { countIn: { beats: bpbOf(), preroll: true } }); p?.catch?.(() => {}); } catch { /* silent engine */ }
    syncClick();
  }
  // the take's grid at an event's time (beats from bar 1; below 0 in the count-in): the engine's, moved on at the tempo
  function gridAt(perfMs) {
    let g = null;
    try { g = engine.playing ? engine.gridBeat : null; } catch { g = null; }
    if (!Number.isFinite(g)) return null;
    return g - base() + ((perfMs - performance.now()) / 60000) * S.ck.bpm;
  }
  function clickHit(r, row, perfMs, v) {
    const ck = S.ck;
    S.flash.set(row, performance.now());
    if (S.asking) S.asking = false;
    const g = gridAt(perfMs);
    // (in the count-in, or stopped: heard, not kept)
    if (g == null || g < OPEN) { syncClick(); return true; }
    ck.hits.push({ g: r4(g), p: r.p, v, row });
    bw?.hit(row, g);
    syncClick();
    return true;
  }
  // The rounds so far, folded (rounds.js foldRounds): the whole rounds up to `upto` beats and, with Done mid-round, the
  // one you're in as far as it got. Hits on the click's grid (the pads' gentle snap), as played in raw.
  function foldOf(ck, upto) {
    const L = loopLen(), whole = Math.floor(upto / L + 1e-9), part = upto - whole * L;
    const all = ck.hits.map((x) => ({ p: x.p, t: Math.max(0, snap(x.g)), raw: x.g, v: x.v }));
    // (a round only begun counts when something was played in it)
    const n = whole + (part >= 0.25 && all.some((x) => x.t >= whole * L - 1e-6 && x.t < upto) ? 1 : 0);
    if (!n) return null;
    const notes = all.filter((x) => x.t < n * L - 1e-6);
    if (!notes.length) return null;
    const reach = Array.from({ length: n }, (_, k) => [0, k < whole ? L : part]);
    const loop = { bars: 2, length: L, rounds: Array.from({ length: n }, (_, k) => [k * L, (k + 1) * L]), agree: 1 };
    return { ...foldRounds(notes, loop, { bpb: bpbOf(), reach }), loop };
  }
  // each wrap: the fold so far, at Tight, is what plays under you on the next round (a one-off miss never comes back
  // as a cue)
  function refold() {
    const ck = S.ck;
    ck.fold = foldOf(ck, ck.folded * loopLen());
    dropPreview('ckFold');
    const tid = padsTrack(), L = loopLen();
    const notes = ck.fold ? atLevel(ck.fold.notes, 'tight', { length: L }) : [];
    if (tid && notes.length) {
      const r = store.preview({ type: 'clip.add', track: tid, clip: { kind: 'notes', start: base(), length: L, name: 'Beat', notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) } }, { by: 'you' });
      if (r.ok) S.ckFold = r;
    }
    bw?.setFold(notes);
    syncClick();
  }
  function clickFrame(now) {
    const ck = S.ck;
    if (!ck) return;
    let g = null;
    try { g = engine.playing ? engine.gridBeat : null; } catch { g = null; }
    if (Number.isFinite(g)) {
      g -= base();
      if (g >= OPEN && !ck.openAt) ck.openAt = performance.now();
      const done = g >= 0 ? Math.floor(g / loopLen()) : 0;
      if (done > ck.folded) { ck.folded = done; refold(); }
    }
    bw?.frame(now);
    flashPads(now);
  }
  function setSpeed(bpm) {
    bpm = Math.round(+bpm);
    if (S.step !== 'play' || S.view !== 'click' || S.over || !(bpm >= 40 && bpm <= 240)) return false;
    if (S.ck.hits.length) keepInTakes();
    clearTimeout(S.ck.tapTimer);
    S.ck.bpm = bpm; S.ck.tapLine = '';
    if (SPEEDS.some(([, v]) => v === bpm)) S.speed = bpm;
    draw();
    startTake();
    return true;
  }
  // Tap it: four T presses or more, read with timing.js findPulse; the click moves to it once the taps stop
  function tapTempo(perfMs = performance.now()) {
    if (S.step !== 'play' || S.view !== 'click' || S.over) return null;
    const ck = S.ck, t = perfMs / 1000;
    if (ck.taps.length && (t - ck.taps[ck.taps.length - 1] > 2 || t < ck.taps[ck.taps.length - 1])) ck.taps = [];
    ck.taps.push(t);
    if (ck.taps.length > 12) ck.taps.shift();
    if (ck.taps.length < 4) return null;
    const p = findPulse(ck.taps, { halves: false });
    if (!p || !(p.tatum > 0)) return null;
    // (the rate you tapped: findPulse's beat can be two of your taps; Tap it means each tap is a beat)
    const bpm = Math.max(50, Math.min(200, Math.round(60 / p.tatum)));
    ck.tapLine = `About ${bpm} BPM. Tap again to change it.`;
    say(ck.tapLine);
    clearTimeout(ck.tapTimer);
    ck.tapTimer = setTimeout(() => { if (S.ck === ck && S.view === 'click') { const line = ck.tapLine; setSpeed(bpm); ck.tapLine = line; syncClick(); } }, 700);
    return bpm;
  }
  // Done over the click: the fold lands as a free take does (planStart, one undo step by you), at the click's tempo
  function landClick() {
    const ck = S.ck;
    if (!ck || ck.hits.length < 4) { say(ck?.hits.length ? 'A few more hits, and the studio can find the beat.' : 'Come in on 1.'); return false; }
    const L = loopLen(), bpm = ck.bpm;
    let g = null;
    try { g = engine.playing ? engine.gridBeat : null; } catch { g = null; }
    const last = Math.max(...ck.hits.map((x) => x.g));
    if (Number.isFinite(g)) g -= base();
    const f = foldOf(ck, Number.isFinite(g) ? Math.max(g, ck.folded * L, Math.min(last + 0.25, (ck.folded + 1) * L)) : last + 0.25);
    if (!f || !f.notes.length) { say('A few more hits, and the studio can find the beat.'); return false; }
    clearTimeout(ck.tapTimer);
    try { engine.stop(); } catch { /* ok */ }
    release();
    giveClick();
    const notes = atLevel(f.notes, 'tight', { length: L });
    const ov = S.over;
    let res;
    if (ov?.drums && store.findClip(ov.clip)) {
      // Tap more on the drums: the fold goes into the Drums clip, over what was there (a hit already there isn't doubled)
      const had = new Set(ov.base.map((n) => `${n.p}@${n.t}`));
      const add = notes.filter((n) => !had.has(`${n.p}@${r4(n.t)}`)).map(({ p, t, d, v }) => ({ p, t: r4(t), d, v }));
      res = add.length ? store.dispatch([{ type: 'notes.add', track: ov.track, clip: ov.clip, notes: add }], { by: 'you', label: `more on ${ov.name}, ${plural(add.length, 'hit')}` }) : { ok: false, error: 'every hit was there already' };
      if (res.ok) res.created = { ...res.created, c: ov.clip };
    } else {
      const plan = planStart(store.get(), { notes, bpm, length: L, kind: 'drums' });
      // (over a tune: the beat from the tune's first bar)
      if (ov) for (const op of plan.ops) if (op.type === 'clip.add') op.clip.start = ov.start;
      res = store.dispatch(plan.ops, { by: 'you', label: ov ? `${plan.label} over ${ov.name}` : plan.label });
    }
    if (!res.ok) { say(`That didn't go in: ${res.error}`); lendClick(); startTake(); return false; }
    const track = store.get().tracks.find((t) => t.clips.some((c) => c.id === res.created.c));
    S.landed = { txn: res.txn.id, track: track?.id || null, clip: res.created.c };
    const rd = { bpm, shift: 0, notes: f.notes, length: L, why: 'first' };
    S.take = { bpm, fit: { fit: 1, drift: 0 }, loop: f.loop, fold: f, downbeat: { shift: 0, sure: true, margin: 1, why: 'click' }, notes: f.notes, strays: f.strays, length: L, readings: [rd], click: true, base: ov?.drums ? ov.base : null };
    S.level = 'tight'; S.reading = 0;
    try { app.input?.capture?.add({ src: 'tap', kind: 'drums', notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })), tempo: bpm, beat: base(), track: S.landed.track, clip: S.landed.clip, raw: ck.hits.map((x) => ({ t: r4((x.g * 60) / bpm), p: x.p, v: x.v })), rounds: f.rounds, kept: [{ track: S.landed.track, clip: S.landed.clip, at: Date.now() }] }); } catch (e) { console.error('start: capture', e); }
    try { ui.select({ track: S.landed.track, clip: S.landed.clip, notes: [] }); } catch { /* ok */ }
    try { engine.play(base()); } catch { /* silent engine */ }
    S.inLine = ''; S.trying = null;
    setStep('in');
    hostCard();
    emit('land', { ...S.landed });
    return true;
  }
  // "Or play it again over a click." from the readings: the landing comes back out (it's the last step, yours), and
  // the stage is the click view
  function againOverClick() {
    const top = store.history[store.history.length - 1];
    if (!S.landed || !top || top.id !== S.landed.txn) { close({ to: 'studio' }); open({ kind: 'tap', view: 'click' }); return; }
    const was = S.landed; S.landed = null;
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    const u = store.undo();
    if (u && u.ok === false) { S.landed = was; return; }
    Object.assign(S, { take: null, hits: [], read: null, level: 'tight', reading: 0, before: null, gridAt: 0, view: 'free' });
    setStep('play');
    padsTrack();
    setView('click');
  }
  // the take's notes as the song has them now, for a level and a reading
  function planned(reading = S.reading, level = S.level, tune = S.tune) {
    const rd = S.take.readings[reading] || S.take.readings[0];
    const notes = atLevel(rd.notes, level, { length: rd.length });
    // (Tap more on the drums: what was on the clip stays as it was, under the new hits)
    if (S.take.base) { const had = new Set(S.take.base.map((n) => `${n.p}@${n.t}`)); return { rd, notes: [...S.take.base, ...notes.filter((n) => !had.has(`${n.p}@${r4(n.t)}`))] }; }
    // (a hum: in the key's scale, or as sung)
    return { rd, notes: S.take.kind === 'hum' ? tuned(notes, S.take.key, tune) : notes };
  }
  function replan(ops, label) {
    const res = store.dispatch(ops, { by: 'you', label, join: S.landed.txn });
    if (!res.ok) { say(`That didn't change: ${res.error}`); return res; }
    if (res.txn && res.txn.id !== S.landed.txn) S.landed.txn = res.txn.id;   // (something else came between: its own step)
    return res;
  }
  function setLevel(level) {
    if (!LEVELS.includes(level) || !S.landed || !store.findClip(S.landed.clip)) return false;
    const { notes } = planned(S.reading, level);
    const res = replan([{ type: 'notes.replace', track: S.landed.track, clip: S.landed.clip, notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) }], `timing: ${LEVEL_WORD[level].toLowerCase()}`);
    if (!res.ok) return false;
    S.level = level;
    draw();
    return true;
  }
  function useReading(i, { back = false, hear = false } = {}) {
    if (!S.landed || !S.take) return false;
    i = Math.max(0, Math.min(S.take.readings.length - 1, i));
    if (i !== S.reading || hear) {
      const { rd, notes } = planned(i, S.level);
      // (the readings' tick is a preview, not the song's)
      const blank = store.get().tracks.every((t) => t.id === S.landed.track || !t.clips.length || t.id === S.tick?.created?.tk);
      const ops = [
        ...(blank ? [{ type: 'project.set', patch: { tempo: Math.round(rd.bpm), loop: { on: true, start: 0, end: rd.length } } }] : []),
        { type: 'clip.set', track: S.landed.track, clip: S.landed.clip, patch: { length: rd.length } },
        { type: 'notes.replace', track: S.landed.track, clip: S.landed.clip, notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) },
      ];
      const res = replan(ops, `another reading: ${Math.round(rd.bpm)} BPM`);
      if (!res.ok) return false;
      S.reading = i;
    }
    if (back) { hum.tickOff(); setStep('in'); } else draw();
    return true;
  }
  // what the coach strip makes of this landing (app.coach.after): the run's next part, as the stage's primary
  const landing = () => ({ kind: S.kind, free: !!S.take?.free, over: S.over ? { track: S.over.track, clip: S.over.clip, drums: S.over.drums } : null, landed: S.landed ? { track: S.landed.track, clip: S.landed.clip } : null, under: S.under?.clip ? { track: S.under.track, clip: S.under.clip } : null });
  function nextPart() {
    let nx = null;
    try { nx = app.coach?.after?.(landing()) || null; } catch (e) { console.error('start: coach', e); }
    if (nx) return nx;
    // (no strip: a hum's next is the song; a beat's is a hum over it, on the stage)
    return S.take?.kind === 'hum' ? null : { label: 'Hum over it', run: (l) => open({ kind: 'hum', over: l }) };
  }
  function next() {
    const nx = nextPart(), l = S.landed ? { track: S.landed.track, clip: S.landed.clip } : null;
    close({ to: 'song' });
    try { if (!engine.playing) engine.play(0); } catch { /* ok */ }
    if (nx) nx.run(l);
    return true;
  }
  // the hum's steps (ui/start-hum.js): Hum over the beat, and the free hum, both on the stage
  const hum = humStage(app, {
    S, say: (t) => say(t), setStep: (x) => setStep(x), draw: () => draw(), emit, bpbOf, guideOn, statusEl: () => statusEl, body: () => body,
    dropGuide: () => dropPreview('guide'), longerPlan: (o) => longerPlan(app, o),
    // a hum landed: the stage's step 'in', as a tapped beat's
    landed(take, landed) {
      S.take = take; S.landed = landed; S.level = 'tight'; S.reading = 0; S.tune = !take.keys; S.before = null; S.inLine = ''; S.trying = null;
      try { ui.select({ track: landed.track, clip: landed.clip, notes: [] }); } catch { /* ok */ }
      try { engine.play(0); } catch { /* silent engine */ }
      setStep('in');
      hostCard();
      emit('land', { ...landed });
    },
  });
  const humNow = () => (S.step === 'hum' ? hum.beatStart() : false);
  const humFree = () => (S.step === 'hum' ? hum.freeStart() : false);
  // "Hum it again over a beat" (a free hum's readings): the landing comes back out (it's the last step, yours), and
  // the stage is the hum over a beat at that reading's speed
  function againOverBeat() {
    const rd = S.take?.readings?.[S.reading] || S.take?.readings?.[0];
    const bpm = rd ? rd.bpm : 100;
    const top = store.history[store.history.length - 1];
    hum.tickOff();
    giveHost();
    if (!S.landed || !top || top.id !== S.landed.txn) { close({ to: 'studio' }); open({ kind: 'hum' }); hum.overBeat(bpm); return; }
    const was = S.landed; S.landed = null;
    try { if (engine.playing) engine.stop(); } catch { /* ok */ }
    const u = store.undo();
    if (u && u.ok === false) { S.landed = was; return; }
    Object.assign(S, { take: null, level: 'tight', reading: 0, before: null, kind: 'hum', hum: { mode: 'beat', rec: false, busy: false } });
    setStep('hum');
    hum.overBeat(bpm);
  }
  // In tune (a hum): the notes in the key's scale, or as sung; a change joined to the landing
  function setTune(on) {
    if (!S.take || S.take.kind !== 'hum' || !S.landed || !store.findClip(S.landed.clip)) return false;
    const { notes } = planned(S.reading, S.level, !!on);
    const res = replan([{ type: 'notes.replace', track: S.landed.track, clip: S.landed.clip, notes: notes.map(({ p, t, d, v }) => ({ p, t, d, v })) }], on ? 'in tune' : 'as sung');
    if (!res.ok) return false;
    S.tune = !!on;
    draw();
    return true;
  }

  /* ---------------------------------------------------------------- the sound card, on 'in' */
  let cardSlot = null, hostWas;   // (hostWas undefined: the stage isn't holding the card)
  function hostCard() {
    const snd = app.sounds;
    if (!snd?.offer || !S.landed?.track || !S.take || !cardSlot?.isConnected) return;
    if (hostWas === undefined) {
      const mine = (a) => (S.landed && a?.track === S.landed.track && cardSlot?.isConnected ? cardSlot : typeof hostWas === 'function' ? hostWas(a) : null);
      try { hostWas = snd.setHost(mine) ?? null; } catch { hostWas = null; }
    }
    const isHum = S.take.kind === 'hum';
    const take = { kind: isHum ? 'notes' : 'drums', src: isHum ? 'hum' : 'tap', committed: true, start: 0, end: S.take.length };
    try { snd.offer({ track: S.landed.track, from: 'take', take, asked: true, focus: false }); } catch (e) { console.error('start: sounds', e); }
  }
  function giveHost() {
    if (hostWas === undefined) return;
    const snd = app.sounds;
    try { if (snd?.el && cardSlot?.contains(snd.el)) snd.close(); } catch { /* ok */ }
    try { snd?.setHost?.(hostWas); } catch { /* ok */ }
    hostWas = undefined; cardSlot = null;
  }
  // ↓ on 'in' tries the next sound on the card (then the card's own keys have it)
  function tryNext(d) {
    const rows = [...(cardSlot?.querySelectorAll('.snd-row') || [])];
    if (!rows.length) return false;
    let i = rows.findIndex((r) => r.classList.contains('sel'));
    if (i < 0) i = Math.max(0, rows.findIndex((r) => r.dataset.now === '1'));
    const j = Math.max(0, Math.min(rows.length - 1, i + d));
    try { rows[j].focus({ preventScroll: true }); } catch { /* ok */ }
    rows[j].click();
    return true;
  }
  function leave() {
    const hs = S.step === 'hum' ? hum.state() : null;
    if (hs && !S.asking && ((hs.mode === 'free' && hs.notes) || (hs.mode === 'beat' && hs.rec))) {
      S.asking = true;
      const rec = hs.mode === 'beat';
      statusEl.replaceChildren(rec ? 'Stop here? What you hummed goes in as it is. ' : 'Leave without keeping this hum? It stays in Takes. ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => { S.asking = false; if (rec) hum.beatDone(); else close({ to: 'studio' }); } }, rec ? 'Stop' : 'Leave'), ' ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => { S.asking = false; say(''); } }, rec ? 'Keep going' : 'Stay'));
      return;
    }
    if (S.step === 'readings') hum.tickOff();
    if (S.step === 'play' && played() && !S.asking) {
      S.asking = true;
      statusEl.replaceChildren('Leave without keeping this take? It stays in Takes. ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => close({ to: 'studio' }) }, 'Leave'), ' ',
        h('button.btn.btn-txt', { type: 'button', onclick: () => { S.asking = false; say(''); } }, 'Stay'));
      return;
    }
    if (S.step === 'readings') { useReading(S.before ?? S.reading, { back: true }); return; }
    close({ to: S.step === 'in' || S.step === 'choose' ? 'song' : 'studio' });
  }

  /* ---------------------------------------------------------------- drawing */
  let win = null, grid = null, bw = null;
  // the four pads: each fires on pointerdown, never on click; from the keyboard F J K L play it wherever the focus is,
  // and Enter on a focused pad plays it too (Space stays Done)
  const padsEl = () => h('div.st-pads', PAD_ROWS.map((id) => {
    const r = ROWS.find((x) => x.id === id);
    return h('button.st-pad', { type: 'button', dataset: { row: id }, 'aria-label': `${r.short || r.label} (${r.hint})`,
      onpointerdown: (e) => { e.preventDefault(); tap(id, e.timeStamp || performance.now()); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tap(id, e.timeStamp || performance.now()); } else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); done(); } } },
    h('span.st-pad-l', r.short || r.label), h('kbd', r.hint));
  }));
  function draw() {
    if (!body) return;
    win = null; grid = null; bw = null;
    const alt = stage.querySelector('.st-alt');
    alt.replaceChildren();
    if (S.step === 'play' && S.view === 'click') {
      // (over the song: its tempo and its bars, so no Speed and no free time)
      if (!S.over) alt.append(h('button.btn.btn-txt.st-view', { type: 'button', onclick: () => setView('free') }, 'Free time instead'));
      const ck = S.ck;
      const bwEl = h('div.st-bw');
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Tap your beat with the click.')),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', ''), h('span.st-unit', ''), h('span.st-rounds', ''))),
        S.over ? null : h('div.st-speed', h('div.st-choice', { role: 'radiogroup', 'aria-label': 'Speed' }, h('span.st-choice-l.t3', 'Speed'),
          SPEEDS.map(([word, val]) => h('button.st-word', { type: 'button', role: 'radio', 'aria-checked': String(val === ck.bpm), onclick: () => setSpeed(val) }, `${word} ${val}`))),
        h('button.st-word.st-tapit', { type: 'button', title: 'Tap T in time, four times or more', onpointerdown: (e) => { e.preventDefault(); tapTempo(e.timeStamp || performance.now()); } }, 'Tap it (T, four times)')),
        bwEl,
        padsEl(),
        h('footer.st-foot', statusEl,
          h('button.btn.btn-txt.st-again', { type: 'button', onclick: () => again() }, 'Start again'),
          h('button.btn.st-done.st-first', { type: 'button', onclick: () => done() }, 'Done ', h('kbd', 'Space'))));
      bw = mountBeatWindow(bwEl, { rows: ROW_ORDER.map((id) => { const r = ROWS.find((x) => x.id === id); return { id, label: r.short || r.label, p: r.p }; }), meter: store.get().meter || [4, 4], bars: Math.max(1, Math.round(loopLen() / bpbOf())), ball: true, countIn: true,
        clock: () => { try { return { beat: engine.beat - base(), grid: engine.playing ? engine.gridBeat - base() : null, playing: engine.playing }; } catch { return { playing: false }; } } });
      syncClick();
    } else if (S.step === 'play') {
      alt.append(h('button.btn.btn-txt.st-view', { type: 'button', onclick: () => setView('click') }, 'Play to a click instead'));
      win = canvas('st-win');
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Tap your beat.'), h('p.st-sub', 'Any speed. Keep going round; the studio finds the tempo and the bar from you.')),
          h('div.st-read', { 'aria-hidden': 'true' }, h('span.num.st-bpm', ''), h('span.st-unit', ''), h('span.st-rounds', ''))),
        h('div.st-winwrap', win.cv, h('p.st-empty.t3', 'Your first hit starts the clock.')),
        padsEl(),
        h('footer.st-foot', statusEl,
          h('button.btn.btn-txt.st-again', { type: 'button', onclick: () => again() }, 'Start again'),
          h('button.btn.st-done.st-first', { type: 'button', onclick: () => done() }, 'Done ', h('kbd', 'Space'))));
      syncPlay();
    } else if (S.step === 'hum') {
      hum.draw(body, alt);
    } else if (S.step === 'in' && S.take?.kind === 'hum') {
      drawHumIn();
    } else if (S.step === 'in') {
      const r = S.take, rd = r.readings[S.reading] || r.readings[0], bars = Math.max(1, Math.round(rd.length / bpbOf()));
      const t = S.landed && store.track(S.landed.track);
      const k = r.fold.notes.length, left = r.fold.strays.length, rounds = r.fold.rounds;
      const foldLine = !r.loop.bars ? `Kept all ${plural(k, 'hit')} as you played them.`
        : rounds === 1 ? `One time round: kept all ${plural(k, 'hit')}.`
          : rounds === 2 ? `You played it twice; kept the ${plural(k, 'hit')} you played both times${left ? `, left out ${left}` : ''}.`
            : `You played it ${rounds} times round; kept the ${plural(k, 'hit')} you played most${left ? `, left out ${left}` : ''}.`;
      grid = canvas('st-grid');
      const mv = moved(rd.notes, S.level, { bpm: rd.bpm });
      const levelLine = S.level === 'played' ? `Your timing, evened out to ${Math.round(rd.bpm)} BPM.` : `${LEVEL_WORD[S.level]} moved ${plural(mv.n, 'hit')}${mv.n ? `, ${mv.ms} ms on average` : ''}.`;
      const unsure = !r.downbeat.sure && r.readings.length > 1;
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Your beat is in the song.'),
          h('p.st-sub', `${t?.name || 'Drums'}, ${bars === 1 ? 'bar 1' : `bars 1–${bars}`} at ${Math.round(rd.bpm)} BPM, played by `, byline('you', { app }), '. ', foldLine, ' ', h('span.t3', 'Undo takes it out.')))),
        h('div.st-inrow', h('div.st-inleft', h('div.st-gridwrap', grid.cv), timingLine(levelLine, null)), slot()),
        h('footer.st-foot', statusEl,
          h(unsure ? 'p.st-unsure' : 'span', unsure ? 'The studio isn’t sure where the 1 is. ' : null,
            r.readings.length > 1 ? h('button.btn.btn-txt.st-notquite', { type: 'button', onclick: () => { S.before = S.reading; setStep('readings'); } }, unsure ? 'Hear the other ways it could go.' : 'Not quite? Hear the other ways it could go.') : null),
          h('button.btn.btn-txt.st-back', { type: 'button', onclick: () => close({ to: 'song' }) }, 'Back to the song'),
          nextBtn()));
      say(S.inLine || '');
      drawGrid();
    } else if (S.step === 'readings') {
      const r = S.take, isHum = r.kind === 'hum';
      const why = isHum
        ? { first: 'the beat the studio heard in you', count: 'another count of the same tune', pickup: 'bar 1 on your second note: the first was a pickup', slower: 'half as quick: one beat is what was two', faster: 'twice as quick: one beat is what was half' }
        : { kick: 'bar 1 starts on your first kick', snare: 'bar 1 starts on your first snare', first: 'bar 1 starts on your first hit', slower: 'slower: one bar is what was two', faster: 'quicker: one bar is what was half' };
      // (two readings that both start on a kick: the second says where its bar 1 is, counted from the first's)
      const words = (rd, i) => {
        const first = r.readings[0];
        if (!isHum && i > 0 && rd.why === first.why && rd.bpm === first.bpm) {
          const d = ((rd.shift - first.shift) % rd.length + rd.length) % rd.length;
          return `bar 1 starts ${d === 1 ? 'a beat' : `${d} beats`} later, on another ${rd.why === 'first' ? 'hit' : rd.why}`;
        }
        return why[rd.why] || why.first;
      };
      const list = h('ul.ledger.st-readings', { role: 'listbox', 'aria-label': 'Readings' }, r.readings.map((rd, i) => h('li.ledger-row.st-reading' + (i === S.reading ? '.sel' : ''), { role: 'option', tabindex: i === S.reading ? 0 : -1, 'aria-selected': String(i === S.reading), onclick: () => useReading(i) },
        h('span.num.st-rbpm', `${Math.round(rd.bpm)} BPM`), h('span.what', words(rd, i)), h('span.t3', i === S.reading ? 'hearing' : ''))));
      list.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); useReading((S.reading + (e.key === 'ArrowDown' ? 1 : r.readings.length - 1)) % r.readings.length); body.querySelector('.st-reading.sel')?.focus(); }
      });
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', 'Which one nods along with you?'), h('p.st-sub', isHum ? 'Each plays your tune, with a soft tick on every beat. Pick the one that feels right; it plays as soon as you pick it.' : 'Each plays your beat. Pick the one that feels right; it plays as soon as you pick it.'))),
        list,
        h('footer.st-foot', statusEl,
          isHum ? (r.free ? h('button.btn.btn-txt.st-overbeat', { type: 'button', onclick: () => againOverBeat() }, 'Hum it again over a beat') : null)
            : r.click ? null : h('button.btn.btn-txt', { type: 'button', onclick: () => againOverClick() }, 'Or play it again over a click.'),
          h('button.btn.btn-txt', { type: 'button', onclick: () => leave() }, 'Back'),
          h('button.btn.btn-go.st-use', { type: 'button', onclick: () => useReading(S.reading, { back: true }) }, 'Use this one')));
      requestAnimationFrame(() => body?.querySelector('.st-reading.sel')?.focus());
      // (a hum's reading plays with a tick on every beat under it, on a preview track)
      if (isHum) hum.tickOn(r.readings[S.reading] || r.readings[0]);
    } else if (S.step === 'choose') {
      const c = S.choice;
      const list = h('ul.ledger.st-readings.st-choose', { role: 'listbox', 'aria-label': 'Readings' }, c.items.map((it, i) => h('li.ledger-row.st-reading' + (i === c.i ? '.sel' : ''), { role: 'option', tabindex: i === c.i ? 0 : -1, 'aria-selected': String(i === c.i), onclick: () => pickChoice(i) },
        h('span.num.st-rbpm', it.main), h('span.what', it.what), h('span.t3', i === c.i ? 'hearing' : ''))));
      list.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); pickChoice((c.i + (e.key === 'ArrowDown' ? 1 : c.items.length - 1)) % c.items.length); body?.querySelector('.st-reading.sel')?.focus(); }
      });
      body.replaceChildren(
        h('div.st-head', h('div', h('h2.st-title.disp', c.title || 'Which one nods along?'), c.sub ? h('p.st-sub', c.sub) : null)),
        list,
        h('footer.st-foot', statusEl,
          h('button.btn.btn-txt', { type: 'button', onclick: () => leave() }, 'Back'),
          h('button.btn.btn-go.st-use', { type: 'button', onclick: () => useChoice() }, 'Use this one')));
      requestAnimationFrame(() => body?.querySelector('.st-reading.sel')?.focus());
    }
  }
  // the stage's one primary on 'in': the run's next part (Enter), or Back to the song when there's none
  function nextBtn() {
    const nx = nextPart();
    return nx ? h('button.btn.btn-go.st-next.st-first', { type: 'button', onclick: () => next() }, nx.label)
      : h('button.btn.btn-go.st-back.st-first', { type: 'button', onclick: () => close({ to: 'song' }) }, 'Back to the song');
  }
  // the Timing line: the three words, what the level moved, and (a hum) the In tune lamp
  function timingLine(levelLine, tune) {
    return h('div.st-timing', h('span.st-choice-l.t3', 'Timing'),
      h('div.st-choice', { role: 'radiogroup', 'aria-label': 'Timing' }, LEVELS.map((lv) => h('button.st-word', { type: 'button', role: 'radio', 'aria-checked': String(lv === S.level), onclick: () => setLevel(lv) }, LEVEL_WORD[lv]))),
      h('span.st-level.t2', { role: 'status' }, levelLine), tune);
  }
  // where the sound card sits on 'in' (the same node across redraws, so the card stays put)
  function slot() { if (!cardSlot) cardSlot = h('div.st-card'); return cardSlot; }
  // a hum's 'in': what landed, in words (the key, the speed, what it's over, the round kept), Timing and In tune, the
  // card with the hum's sounds; a free hum whose pulse was weak says so, and offers the other readings or a beat
  function drawHumIn() {
    const r = S.take, rd = r.readings[S.reading] || r.readings[0], bars = Math.max(1, Math.round(rd.length / bpbOf()));
    const t = S.landed && store.track(S.landed.track);
    const bpm = Math.round(rd.bpm), key = r.key ? keyLabel(r.key) : 'no key';
    const barsW = bars === 1 ? 'bar 1' : `bars 1–${bars}`;
    const sub = r.free
      ? [`${t?.name || 'Melody'}, ${barsW} at ${bpm} BPM, in ${key}, sung by `, byline('you', { app }), '. ', h('span.t3', 'Undo takes it out.')]
      : r.keys ? [`${t?.name || 'Keys'}, ${barsW} at ${bpm} BPM, over ${r.over}, played by `, byline('you', { app }), '. ', r.rounds > 1 ? `Kept round ${r.kept}, the steadiest of ${r.rounds}.` : 'One time round, kept as you played it.', ' ', h('span.t3', 'Undo takes it out.')]
      : [`${t?.name || 'Melody'}, ${barsW} at ${bpm} BPM, in ${key}, over ${r.over}. `, r.rounds > 1 ? `Kept round ${r.kept}, the steadiest of ${r.rounds}.` : 'One time round, kept as you sang it.', ' ', h('span.t3', 'Undo takes it out.')];
    grid = canvas('st-grid');
    const mv = moved(rd.notes, S.level, { bpm: rd.bpm });
    const levelLine = S.level === 'played' ? 'As you sang it.' : `${LEVEL_WORD[S.level]} moved ${plural(mv.n, 'note')}${mv.n ? `, ${mv.ms} ms on average` : ''}.`;
    const tune = r.keys ? null : h('button.tog.st-tune', { type: 'button', 'aria-pressed': String(!!S.tune), title: `On: your notes in ${key}. Off: as sung`, onclick: () => setTune(!S.tune) }, 'In tune');
    const weak = r.free && r.readings.length > 1 && !(r.fit?.fit >= 0.5);
    const other = r.readings.length > 1 ? h('button.btn.btn-txt.st-notquite', { type: 'button', onclick: () => { S.before = S.reading; setStep('readings'); } }, weak ? 'Hear the other ways it could go' : 'Not quite? Hear the other ways it could go.') : null;
    body.replaceChildren(
      h('div.st-head', h('div', h('h2.st-title.disp', r.keys ? 'Your part is in the song.' : 'Your tune is in the song.'), h('p.st-sub', ...sub))),
      h('div.st-inrow', h('div.st-inleft', h('div.st-gridwrap', grid.cv), timingLine(levelLine, tune)), slot()),
      h('footer.st-foot', statusEl,
        weak ? h('p.st-unsure.st-promoted', `It’s in at ${bpm} BPM, but the hum didn’t settle on a steady beat. `, other, ', or ', h('button.btn.btn-txt.st-overbeat', { type: 'button', onclick: () => againOverBeat() }, 'hum it again over a beat'), '.')
          : h('span', other),
        nextPart() ? h('button.btn.btn-txt.st-back', { type: 'button', onclick: () => close({ to: 'song' }) }, 'Back to the song') : null,
        nextBtn()));
    say(S.inLine || '');
    drawGrid();
  }
  function syncPlay() {
    if (S.step !== 'play' || !body || S.view === 'click') return;
    const n = S.hits.length, r = S.read;
    const bpm = body.querySelector('.st-bpm'), unit = body.querySelector('.st-unit'), rounds = body.querySelector('.st-rounds');
    const shown = showBpm();
    bpm.textContent = shown ? String(Math.round(r.bpm)) : n ? '~' : '';
    unit.textContent = shown || n ? 'BPM' : '';
    const loopOk = shown && r.loop.bars;
    rounds.textContent = loopOk ? `${plural(r.loop.bars, 'bar')} round · round ${r.fold.rounds}` : '';
    body.querySelector('.st-empty').hidden = n > 0;
    const doneB = body.querySelector('.st-done');
    const ready = n >= 4;
    doneB.classList.toggle('btn-go', ready);
    doneB.firstChild.textContent = ready ? 'Done ' : 'A few more ';
    doneB.setAttribute('aria-disabled', String(!ready));
    // (a weak pulse: one more time round, never a block on Done; rounds-test measures what it buys a beginner)
    const nudge = shown && r.fit && r.fit.fit < 0.5 ? ' One more time round helps the studio hear it.' : '';
    if (!S.asking) say(!n ? '' : shown ? `${plural(n, 'hit')}. ${Math.round(r.bpm)} BPM${loopOk ? `, ${plural(r.loop.bars, 'bar')} round, ${plural(r.fold.rounds, 'time')} round` : ''}.${nudge}` : `${plural(n, 'hit')}.`);
  }
  function syncClick() {
    if (S.step !== 'play' || S.view !== 'click' || !body || !S.ck) return;
    const ck = S.ck, n = ck.hits.length, k = ck.fold ? ck.fold.notes.length : 0;
    const bpm = body.querySelector('.st-bpm'), unit = body.querySelector('.st-unit'), rounds = body.querySelector('.st-rounds');
    if (bpm) { bpm.textContent = String(Math.round(ck.bpm)); unit.textContent = 'BPM'; rounds.textContent = ck.folded ? `round ${ck.folded + 1} · kept so far: ${plural(k, 'hit')}` : ''; }
    for (const b of body.querySelectorAll('.st-speed [role="radio"]')) b.setAttribute('aria-checked', String(b.textContent.endsWith(` ${Math.round(ck.bpm)}`)));
    const doneB = body.querySelector('.st-done');
    const ready = n >= 4;
    doneB.classList.toggle('btn-go', ready);
    doneB.firstChild.textContent = ready ? 'Done ' : 'A few more ';
    doneB.setAttribute('aria-disabled', String(!ready));
    if (!S.asking) say(ck.folded ? `Round ${ck.folded + 1}. Kept so far: ${plural(k, 'hit')}. What you play most often stays; one-off misses don’t.` : ck.tapLine || '');
  }
  // a pad that just sounded lights for a moment (reverse print), so a tap is seen as well as heard
  function flashPads(now) {
    for (const [row, at] of S.flash) {
      const el = body?.querySelector(`.st-pad[data-row="${row}"]`);
      const lit = now - at < 110;
      if (el && el.classList.contains('on') !== lit) el.classList.toggle('on', lit);
      if (!lit) S.flash.delete(row);
    }
  }
  // the hits, scrolling left as you play, and (once the beat is found) the bar lines fading in under them
  const ROW_ORDER = ['hat', 'open', 'snare', 'kick'];
  function drawWin(now) {
    if (!win || S.step !== 'play' || S.view === 'click') return;
    win.fit();
    const g = win.g, W = win.w, H = win.h;
    g.clearRect(0, 0, W, H);
    const lineC = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text3 = tok('--text-3');
    const nowS = performance.now() / 1000, SPAN = 6;
    const t1 = Math.max(nowS, S.hits.length ? S.hits[S.hits.length - 1].t + 0.5 : nowS), t0 = t1 - SPAN;
    const lab = 54, x = (t) => lab + ((t - t0) / SPAN) * (W - lab - 8);
    const rowH = H / ROW_ORDER.length;
    g.font = `600 11px ${tok('--font-ui') || 'sans-serif'}`;
    g.textBaseline = 'middle';
    ROW_ORDER.forEach((id, i) => {
      g.fillStyle = text3;
      g.fillText(ROWS.find((r) => r.id === id).short || ROWS.find((r) => r.id === id).label, 0, rowH * (i + 0.5));
      g.fillStyle = lineC; g.fillRect(lab, Math.round(rowH * (i + 1)) - 1, W - lab, 1);
    });
    // the grid arrives under your hits: two bars' worth played, and a pulse found
    const r = S.read;
    if (r && showBpm() && r.fit && (span() * r.bpm) / 60 >= 2 * bpbOf()) {
      if (!S.gridAt) S.gridAt = now;
      const a = Math.min(1, (now - S.gridAt) / 120);
      const first = S.hits[0].t, spb = 60 / r.bpm, bpb = bpbOf();
      g.globalAlpha = a;
      for (let b = Math.floor((t0 - first) / spb); first + b * spb <= t1; b++) {
        const xx = Math.round(x(first + b * spb)) + 0.5;
        if (xx < lab) continue;
        g.fillStyle = b % bpb === 0 ? line2 : lineC;
        g.fillRect(xx, 0, b % bpb === 0 ? 2 : 1, H);
      }
      g.globalAlpha = 1;
    }
    for (const hit of S.hits) {
      if (hit.t < t0) continue;
      const i = ROW_ORDER.indexOf(hit.row);
      const xx = x(hit.t);
      g.fillStyle = text;
      g.fillRect(Math.round(xx) - 1, rowH * i + rowH * 0.2, 3, rowH * 0.6);
    }
    flashPads(now);
  }
  function drawGrid(now = performance.now()) {
    if (!grid || !S.take) return;
    grid.fit();
    const g = grid.g, W = grid.w, H = grid.h;
    g.clearRect(0, 0, W, H);
    const { rd, notes } = planned();
    const rowsP = [...new Set(notes.map((n) => n.p))].sort((a, b) => b - a);
    const lab = 54, L = rd.length, bx = (b) => lab + (b / L) * (W - lab - 4), rowH = H / Math.max(3, rowsP.length);
    const lineC = tok('--line'), line2 = tok('--line-2'), text = tok('--text'), text3 = tok('--text-3'), accent = tok('--accent');
    const bpb = bpbOf();
    for (let b = 0; b <= L; b += 0.5) { g.fillStyle = b % bpb === 0 ? line2 : lineC; if (b % 1 === 0) g.fillRect(Math.round(bx(b)), 0, 1, H); }
    g.font = `600 11px ${tok('--font-ui') || 'sans-serif'}`; g.textBaseline = 'middle';
    const name = (p) => (S.take.kind === 'hum' ? noteName(p) : { 35: 'Kick', 36: 'Kick', 38: 'Snare', 40: 'Snare', 42: 'Hat', 46: 'Open', 49: 'Crash' }[p] || `Note ${p}`);
    rowsP.forEach((p, i) => { g.fillStyle = text3; g.fillText(name(p), 0, rowH * (i + 0.5)); });
    const cw = Math.max(4, (W - lab) / (L * 4) - 3);
    for (const n of notes) {
      const i = rowsP.indexOf(n.p);
      // (a hum's notes as long as they were sung; a hit is a cell)
      const w = S.take.kind === 'hum' ? Math.max(4, bx(Math.min(L, n.t + (n.d || 0.25))) - bx(n.t) - 2) : cw;
      g.fillStyle = text; g.fillRect(Math.round(bx(n.t)) + 1, rowH * i + rowH * 0.25, w, rowH * 0.5);
      // where you hit it, in pencil
      const raw = rd.notes.find((x) => x.t === n.t && (x.p === n.p || S.take.kind === 'hum'))?.raw;
      if (raw != null && Math.abs(raw - n.t) > 0.01) { g.fillStyle = text3; g.fillRect(Math.round(bx(Math.max(0, Math.min(L, raw)))), rowH * i + rowH * 0.15, 1, rowH * 0.7); }
    }
    // the playhead, leader green
    if (engine.playing && Number.isFinite(engine.beat)) { const b = ((engine.beat % L) + L) % L; g.fillStyle = accent; g.fillRect(Math.round(bx(b)), 0, 2, H); }
  }

  /* ---------------------------------------------------------------- the loop and the keys */
  ui.panel({ id: 'start', region: 'top', title: 'Start a song', mount: (el) => { el.hidden = true; el.style.display = 'none'; return { frame(now) { if (!S.step) return; if (S.step === 'play') { if (S.view === 'click') clickFrame(now); else drawWin(now); } else if (S.step === 'hum') hum.frame(now); else if (S.step === 'in' && grid) drawGrid(now); } }; } });
  const isOpen = () => !!S.step;
  const on = (step) => () => S.step === step;
  // (first: ahead of the keys a mode declares, Tap's F J K L among them; Space needn't be, as no other Space with a
  // when() can be live while the stage has the keys, and the transport's own Space has none)
  const K = (key, when, run, label, extra = {}) => ui.keys.add({ key, when, run, label, group: 'Start a song', first: key !== 'Space', ...extra });
  // the studio's own keys wait under the stage (Space is the stage's on every step, below; added first: ui.keys tries the last-added `first` key first, so the
  // stage's own keys below win over these) (R, M, S, the panes, Tap, the keys' octave...)
  // (Play keys over it: musical typing plays through, its notes and its octave keys)
  const keysStep = () => S.step === 'hum' && S.hum?.mode === 'keys';
  const typed = new Set([...Object.keys(TYPE_MAP), 'KeyZ', 'KeyX', 'KeyC', 'KeyV']);
  for (const key of ['KeyR', 'KeyM', 'KeyS', 'KeyB', 'KeyD', 'KeyA', 'KeyT', 'KeyH', 'KeyC', 'KeyE', 'KeyN', 'KeyZ', 'KeyX', 'KeyG', 'KeyQ', 'KeyW', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyY', 'KeyV', 'Digit0', 'Delete', 'Backspace', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Comma', 'Period', 'Slash']) {
    K(key, typed.has(key) ? () => isOpen() && !keysStep() : isOpen, () => {}, 'Held while Start a song is open', { hidden: true });
  }

  for (const id of PAD_ROWS) { const r = ROWS.find((x) => x.id === id); K(r.key, on('play'), (e) => tap(id, e?.timeStamp || performance.now()), `Tap the ${(r.short || r.label).toLowerCase()} (Start a song)`, { hidden: true }); }
  K('Space', () => S.step === 'play' || S.step === 'in' || S.step === 'readings' || S.step === 'choose', () => done(), 'Done (Start a song)', { hidden: true });
  K('Enter', () => S.step === 'play' && !document.activeElement?.closest?.('button'), () => done(), 'Done (Start a song)', { hidden: true });
  K('Backspace', on('play'), () => again(), 'Start again (Start a song)', { hidden: true });
  // over a click: T is Tap it, ← → step the Speed (each a fresh take)
  const clickView = () => S.step === 'play' && S.view === 'click';
  const speedStep = (d) => { const vs = SPEEDS.map(([, v]) => v), cur = S.ck?.bpm ?? S.speed; const i = vs.indexOf(cur); const j = i < 0 ? (d > 0 ? vs.findIndex((v) => v > cur) : vs.length - 1 - [...vs].reverse().findIndex((v) => v < cur)) : i + d; if (j >= 0 && j < vs.length && vs[j] != null) setSpeed(vs[j]); };
  K('KeyT', clickView, (e) => tapTempo(e?.timeStamp || performance.now()), 'Tap it: the tempo (Start a song)', { hidden: true });
  K('ArrowLeft', clickView, () => speedStep(-1), 'Slower (Start a song)', { hidden: true });
  K('ArrowRight', clickView, () => speedStep(1), 'Quicker (Start a song)', { hidden: true });
  K('Enter', on('in'), () => next(), 'The next part: Hum over it (Start a song)', { hidden: true });
  // the hum (over the beat or free): H, Space and Enter start it, and stop it into the song; ⌫ starts a free hum again
  K('KeyH', () => S.step === 'hum' && !keysStep(), () => hum.done(), 'Hum, or Done (Start a song)', { hidden: true });
  // (first, unlike the other steps' Space: the recorder's own Space, stop and keep, is live while the hum records)
  K('Space', on('hum'), () => hum.done(), 'Hum, or Done (Start a song)', { hidden: true, first: true });
  K('Enter', () => S.step === 'hum' && !document.activeElement?.closest?.('button'), () => hum.done(), 'Hum, or Done (Start a song)', { hidden: true });
  K('Backspace', on('hum'), () => hum.again(), 'Hum again (Start a song)', { hidden: true });
  // the sound card on 'in': ↓ tries the next sound
  K('ArrowDown', () => S.step === 'in' && !!cardSlot?.querySelector('.snd-row') && !cardSlot.contains(document.activeElement), () => tryNext(1), 'Try the next sound (Start a song)', { hidden: true });
  K('ArrowRight', on('in'), () => setLevel(LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(S.level) + 1)]), 'Looser timing (Start a song)', { hidden: true });
  K('ArrowLeft', on('in'), () => setLevel(LEVELS[Math.max(0, LEVELS.indexOf(S.level) - 1)]), 'Tighter timing (Start a song)', { hidden: true });
  K('Escape', isOpen, () => leave(), 'Leave Start a song', { hidden: true, global: true });
  // a blank song from elsewhere (a demo, a link) closes the stage; an undo of the landing goes back to the door
  store.on('change', (e) => {
    if (!S.step) return;
    if (e.kind === 'load') { close({ quiet: true }); return; }
    if ((S.step === 'in' || S.step === 'readings') && S.landed && !store.findClip(S.landed.clip)) { close({ to: 'studio' }); return; }
    // the card's Keep (its own undo step): the line says what the track plays now
    if (S.landed && (S.step === 'in' || S.step === 'readings') && e.kind === 'do') {
      const op = (e.ops || []).find((o) => o.type === 'instrument.set' && o.track === S.landed.track);
      if (op) {
        const t = store.track(S.landed.track), def = app.devices?.getDevice?.(op.device);
        S.inLine = `${t?.name || 'The track'} plays ${S.trying || def?.name || op.device} now.`;
        if (S.step === 'in') say(S.inLine);
      }
    }
  });
  // (the sound on trial, by name, for that line)
  ui.on?.('sounds', (d) => { const tr = d?.trying; if (tr && S.landed && tr.track === S.landed.track && tr.name) S.trying = tr.name; });
  // while a take is played on the stage, the agent's song-changing tools wait (agent/tools.js reads app.start.busy)
  const api = app.start = {
    open, close: (o) => close(o), tap, done, again, setLevel, useReading: (i) => useReading(i), humNow, humFree, leave, choose, pickChoice, setView, setSpeed, tapTempo,
    hum: () => (S.step === 'hum' ? hum.state() : null), setTune, againOverBeat, tick: () => hum.tick(),
    click: () => (S.ck ? { bpm: S.ck.bpm, hits: S.ck.hits.length, rounds: S.ck.folded, kept: S.ck.fold ? S.ck.fold.notes.length : 0, left: S.ck.fold ? S.ck.fold.strays.length : 0, fold: S.ck.fold ? S.ck.fold.notes.map(({ p, t }) => ({ p, t })) : [], playAt: S.ck.playAt, openAt: S.ck.openAt } : null),
    window: () => (bw ? bw.state() : null),
    readings: () => (S.take ? S.take.readings.map((r) => ({ bpm: r.bpm, why: r.why, length: r.length })) : []),
    landed: () => (S.landed ? { ...S.landed } : null),
    take: () => (S.take?.kind === 'hum' ? { kind: 'hum', free: !!S.take.free, bpm: S.take.readings[S.reading]?.bpm ?? S.take.bpm, length: S.take.length, fit: S.take.fit?.fit ?? null, rounds: S.take.rounds, kept: S.take.kept, key: S.take.key, level: S.level, reading: S.reading, tune: S.tune }
      : S.read || S.take ? { hits: S.hits.length, bpm: (S.take || S.read).bpm, length: (S.take || S.read).length, loop: (S.take || S.read).loop.bars, rounds: (S.take || S.read).fold.rounds, kept: (S.take || S.read).fold.notes.length, strays: (S.take || S.read).fold.strays.length, sure: (S.take || S.read).downbeat.sure, level: S.level, reading: S.reading } : null),
    // the BPM the stage shows while you play (the top bar reads it; "~" until then): null before six hits over three
    // seconds, and off the play step
    tempoShown: () => (S.step !== 'play' ? null : S.view === 'click' && S.ck ? Math.round(S.ck.bpm) : showBpm() ? Math.round(S.read.bpm) : null),
    get step() { return S.step; }, get kind() { return S.kind; }, get view() { return S.step ? S.view : null; },
    get busy() { return S.step === 'play' || S.step === 'hum'; },
    on(t, fn) { if (!fns.has(t)) fns.set(t, new Set()); fns.get(t).add(fn); return () => fns.get(t).delete(fn); },
  };
  return api;
}

const CSS = `
.ew-main.st-on { position: relative; }
.st-stage { position: absolute; inset: 0; z-index: 40; display: flex; flex-direction: column; overflow: auto; background: var(--bg); padding: 14px clamp(16px, 4vw, 48px) 18px; outline: none; animation: st-in .16s var(--ease, ease) both; }
@keyframes st-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.st-top { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; border-bottom: var(--rule); }
.st-run { font-size: 15px; color: var(--text); }
.st-stepname { font-size: 12.5px; color: var(--text-3); }
.st-gap { flex: 1; }
.st-alt { display: inline-flex; gap: 12px; }
.st-body { display: flex; flex-direction: column; gap: 18px; flex: 1; min-height: 0; max-width: 1080px; width: 100%; margin: 0 auto; padding-top: 22px; }
.st-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.st-title { margin: 0; padding-bottom: 8px; border-bottom: var(--rule-heavy); font-size: clamp(28px, 4vw, 40px); color: var(--text); display: inline-block; }
.st-sub { margin: 10px 0 0; max-width: 62ch; color: var(--text-2); font-size: 13.5px; line-height: 1.5; }
.st-read { display: grid; justify-items: end; gap: 2px; min-width: 120px; }
.st-bpm { font-size: 44px; line-height: 1; color: var(--text); min-height: 44px; }
.st-unit { font-size: 11px; letter-spacing: .08em; color: var(--text-3); text-transform: uppercase; }
.st-rounds { font-size: 12px; color: var(--text-2); min-height: 16px; }
.st-winwrap, .st-gridwrap { position: relative; border-top: var(--rule); border-bottom: var(--rule); }
.st-win { display: block; width: 100%; height: clamp(120px, 22vh, 190px); }
.st-grid { display: block; width: 100%; height: clamp(110px, 20vh, 170px); }
.st-empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; font-size: 13px; pointer-events: none; }
.st-empty[hidden] { display: none; }
.st-pads { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.st-pad { display: flex; align-items: flex-end; justify-content: space-between; height: clamp(76px, 13vh, 112px); padding: 10px 12px; border: var(--rule-2); border-radius: var(--r-press); background: none; color: var(--text); font: 600 14px/1 var(--font-ui); cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.st-pad:hover { border-color: var(--text-3); }
.st-pad.on { background: var(--text); border-color: var(--text); color: var(--bg); }
.st-pad.on kbd { color: var(--bg); border-color: var(--bg); }
.st-pad:focus-visible, .st-word:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 1px; }
.st-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-top: auto; padding-top: 12px; border-top: var(--rule); }
.st-status { flex: 1 1 260px; margin: 0; color: var(--text-2); font-size: 13px; min-height: 18px; }
.st-done, .st-next, .st-use, .st-hum, .st-back.btn-go { height: 40px; padding: 0 18px; font-size: 14px; }
.st-done[aria-disabled="true"] { color: var(--text-3); }
.st-choice { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 4px 14px; }
.st-choice-l { min-width: 56px; font-size: 12px; }
.st-word { padding: 2px 4px; border: 0; border-radius: var(--r-press); background: none; color: var(--text-2); font: 600 13.5px/1.4 var(--font-ui); text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 4px; cursor: pointer; }
.st-word:hover { color: var(--text); }
.st-word[aria-checked="true"] { background: var(--text); color: var(--bg); text-decoration: none; }
.st-timing { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 18px; padding: 10px 0; border-bottom: var(--rule); }
.st-level { font-size: 13px; }
.st-unsure { margin: 0; color: var(--accent-2); font-size: 13px; }
.st-humwrap { display: flex; justify-content: center; padding: 18px 0; border-top: var(--rule); border-bottom: var(--rule); }
.st-hum { height: 64px; padding: 0 34px; font-size: 18px; gap: 10px; }
.btn-go kbd { color: var(--bg); border-color: color-mix(in srgb, var(--bg) 45%, transparent); }
.st-dot { width: 10px; height: 10px; background: var(--rec); }
.st-phones { font-size: 12px; }
.st-speed { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 22px; }
.st-tapit { color: var(--text-3); }
.st-readings .ledger-row { --ledger-cols: 132px 1fr auto; cursor: pointer; padding: 12px 8px; }
.st-choose .ledger-row { --ledger-cols: 136px 1fr auto; }
.st-hwin { display: block; width: 100%; height: clamp(140px, 26vh, 220px); }
.st-tune { margin-left: auto; }
.st-inrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px 28px; align-items: start; }
.st-inleft { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.st-card { width: min(400px, 34vw); }
.st-card:empty { display: none; }
.st-promoted { flex: 1 1 420px; line-height: 1.6; }
.st-promoted .btn-txt { padding: 0; height: auto; vertical-align: baseline; }
.st-rbpm { font-size: 18px; white-space: nowrap; }
/* the door: a ledger of ways in, each row the full width */
.st-door { max-width: 760px; width: 100%; }
.st-ways { margin: 4px 0 12px; border-top: var(--rule); }
.ledger.st-ways > li.st-way { display: grid; grid-template-columns: 150px 1fr 20px; align-items: center; gap: 12px; min-height: 56px; padding: 0 6px 0 0; border-bottom: var(--rule); cursor: pointer; }
.st-way:hover { background: var(--bg-3); }
.st-way-b { justify-self: start; height: 34px; padding: 0 14px; font-size: 13.5px; }
.st-way-why { color: var(--text-2); font-size: 13px; line-height: 1.4; }
.st-way-arrow { color: var(--text-3); justify-self: end; }
.st-notime { margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 13px; }
.ar-empty .ar-empty-agent { color: var(--text-2); }
@media (max-width: 1100px) {
  .st-inrow { grid-template-columns: minmax(0, 1fr); }
  .st-card { width: auto; }
}
@media (max-width: 900px) {
  .st-stage { position: fixed; inset: 0; z-index: 200; padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); }
  .st-body { gap: 12px; padding-top: 12px; }
  .st-head { flex-direction: column; align-items: stretch; gap: 8px; }
  .st-read { justify-items: start; grid-auto-flow: column; align-items: baseline; gap: 8px; }
  .st-bpm { font-size: 30px; min-height: 30px; }
  .st-pads { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .st-pad { height: 120px; font-size: 16px; }
  .st-pad kbd { display: none; }
  .st-win { height: 120px; }
  .st-hwin { height: 150px; }
  .st-foot { position: sticky; bottom: 0; background: var(--bg); }
  .st-stage .st-done, .st-stage .st-next, .st-stage .st-use, .st-stage .st-hum, .st-stage .st-back.btn-go { height: 48px; flex: 1 1 100%; }
  .st-stage .st-hum { height: 40vh; max-height: 260px; width: 100%; font-size: 22px; }
  .st-alt .btn-txt, .st-skip { font-size: 12.5px; }
  .ledger.st-ways > li.st-way { grid-template-columns: 1fr 20px; padding: 8px 0; }
  .st-way-b { grid-column: 1; height: 44px; }
  .st-way-why { grid-column: 1; font-size: 12.5px; }
  .st-way-arrow { grid-row: 1; grid-column: 2; }
  .st-top { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .st-stage { animation: none; } }
`;
