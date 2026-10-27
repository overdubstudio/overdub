// Takes and the part line [ui; the guitar room's TAKES stream] (docs/research/GUITAR-ROOM.md §2.5-§2.8; design/mock/
// guitar-room/ shots 04*-06*: the part line, the count-in, the recording view, the take landed, the other side; AJ:
// keep it or toss it after every take, stop and redo mid-take, hear what you just recorded, start from any part, insert
// a part before another, drag parts, delete any part, the take never cut at the part's end, its tail ringing under the
// next part, a metronome count-in into each part, on by default).
//
// What it owns: the recording view (R.el.over, ./takes-rec.js), the count-in into a part, recording on the deck
// (R.deck.take({ tailFrom }): what rings past the part is its tail, core/project.js clipTail), take review
// (R.sheet('review'), ./takes-review.js: the clip's in and out handles, clip.trim; Keep / Toss / Again; ↑↓ the takes),
// the other side on the same rig and both together, hear-back, and the part line (R.el.drawer.parts, ./parts-line.js:
// insert, drag, delete, play from, Home; ./parts-plans.js). It sets R.run ('count', 'take', 'play', 'idle') and moves the
// monitor to the side it records (app.input.audio.monitorVia), back to Guitar L when the take's in or tossed.
//
// One step by you per take: the recorder's commit (the take, its asset) with the part joined to it (a new part's
// section and room.part.set, its tail; the drummer's beatOps for a new part; the sides' pans for the other side), and
// every handle moved and take picked in review joined to it too, so ⌘Z (or Toss) takes the whole take back out and
// leaves History as it was. Each part-line move is one step by you.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'record', 'again', 'stop', 'keep', 'toss', 'side', 'hear', 'home', 'play',
//                                             'take:up', 'take:down', 'card:<section id>' | 'card:new' | 'card:prev' |
//                                             'card:next', 'part:new', 'part:before', 'part:remove', 'part:left',
//                                             'part:right'
//     back() -> bool                          Esc: a take running is tossed (as Esc in rec), review closes (the take
//                                             kept as it is), playback stops
//     frame(now), unmount()
//     inReview() -> bool                      a take is waiting on Keep / Toss
//     part() -> section id | null             the part the next take is for (ui.state.liveRoom.card)
//     place(riff, { at }) -> Promise<{ ok, error?, section }>   a riff from the tape (the tape stream's) onto the part
//                                             line as a part at index `at` (0: before the first part; a section id: before
//                                             that part; null: at the end). riff: a riffs-db row ({ id, name }), or
//                                             riffs-db intoSong's result ({ ops, clip, beats, bars, tail }) with a name.
//                                             One step by you: the bars, the section, the riff's clip on Guitar L (its
//                                             ring kept as the clip's tail) and the drummer's beat for it
//   }
// Added beside the frozen API (for the room's strip and the tape's drag):
//     summary() -> { parts, bars, secs }      the part line in numbers (the strip's "Part line" chip); the bus says
//                                             'takes:parts' with the same whenever it changes
//     dropAt(clientX, clientY, { final, kind: 'riff' }) -> index | null   where a riff dragged there would land on the
//                                             part line, lighting that gap (./parts-line.js)
//
// The count-in: the deck's (the engine's count on the audio clock, the song's bars before the part pre-rolling under
// it: "the parts around it play"), with the engine's sticks as its voice when the musician's count-in is on (prefs
// countIn, ⇧K; off: no voice, the bar before as the lead-in, none at the top). The drummer is told: R.parts.drummer
// .countIn({ bars, bpm, at, from, sounded }) at the count's first beat (at, on the audio clock), sounded: true when the
// engine is already sounding it, so the drummer shows the count (the sticks on the riser) without a second voice. A
// drummer that sounds the count itself says so with R.parts.drummer.countsAloud === true, and the engine's voice is
// then 'none'. The drummer's jam is stopped first (R.parts.drummer.stop()).
//
// The drums under a take: a part's own (the drummer's beatOps clips) play from the song; past the song's end (a new
// part), the room's beat is heard for the take through store.preview (the drummer's jamOps: never kept, never in
// History), released when the take lands.

import { css } from '../../dom.js';
import { CSS } from './takes-style.js';
import { say as sayLine } from './takes-lines.js';
import * as PP from './parts-plans.js';
import { createPartLine } from './parts-line.js';
import { createRecView } from './takes-rec.js';
import { createReview } from './takes-review.js';
import { measurePair } from '../../../core/liveroom/tight.js';
import { planPans } from '../../../core/liveroom/double.js';
import { beatOps, jamOps, beatOf, grooveOfBeat } from '../../../core/liveroom/guitar/beats.js';

const EPS = 1e-6;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

export function mount(R) {
  css('gr-takes', CSS);
  const { store, L, gr, app } = R;
  const eng = () => app.engine || null;
  const tell = (id, vars) => sayLine(R, id, vars);
  const offs = [];
  const err = (e, fallback = 'That didn’t go through.') => ({ ok: false, error: String(e?.message || e?.error || e || fallback) });
  const tapeKept = () => { try { return !!app.input?.tape?.state?.rolling; } catch { return false; } };
  let P = null;          // the pass: the count and the take running
  let gen = 0;
  let hearing = null;    // playback the room started: { until } (a beat it stops at), or null to play on
  let dirty = true;
  let lastSummary = '';
  let playAt = 0;        // when the room last started playback (the engine starts a beat later)

  /* ------------------------------------------------------------------------------------------- the views */
  const line = createPartLine(R, {
    pick: (id) => press(`card:${id}`),
    play: (id) => { L.card = id; return press('play'); },
    remove: (id) => { L.card = id; return press('part:remove'); },
    move: (id, to) => movePart(id, to),
    rename: (id, name) => rename(id, name),
    add: (at) => newPart(at),
    other: () => press('side'),
    key: (id) => press(id),
  });
  R.el.drawer.parts.append(line.el);
  const rec = createRecView(R);
  const review = createReview(R, {
    keep: () => press('keep'),
    toss: () => press('toss'),
    again: () => press('again'),
    trim: (which, beat, o) => trim(which, beat, o),
    partEnd: (bars) => partEnd(bars),
    stopHear: () => stopHear(),
  });
  offs.push(store.on('change', () => { dirty = true; }));
  offs.push(R.on('drawer', () => { dirty = true; }));

  /* ------------------------------------------------------------------------------------------- reading the song */
  const lineNow = () => PP.partLine(store.get());
  const sectionOf = (id) => lineNow().parts.find((x) => x.id === id) || null;
  const clipNow = (track, clip) => store.get().tracks.find((t) => t.id === track)?.clips.find((c) => c.id === clip) || null;
  const selected = () => { const id = L.card; return id && id !== 'new' ? sectionOf(id) : null; };
  function beatName(p, id) {
    try { const b = beatOf(p, id); const g = grooveOfBeat(p, b); return g?.name || (b === 'house/guide' ? 'The guide beat' : String(b).split('/').pop()); } catch { return 'The guide beat'; }
  }
  function drumsUnder(p, a, b) {
    const id = PP.partLine(p).roles.drums;
    const t = id ? p.tracks.find((x) => x.id === id) : null;
    return !!t && t.clips.some((c) => c.start < b - EPS && c.start + c.length > a + EPS);
  }
  function monitor(track) { try { app.input?.audio?.monitorVia?.(track || null); } catch (e) { console.error('takes: monitorVia', e); } }
  const monitorHome = () => monitor(lineNow().roles.guitarL || null);
  function relabel(txn, label, reason) {
    const last = store.history.at(-1);
    if (last && last.id === txn) { if (label) last.label = label; if (reason) last.reason = reason; }
  }
  const txnId = (t) => (typeof t === 'string' ? t : t?.id || null);

  /* ------------------------------------------------------------------------------------------- playing back */
  function playFrom(beat, { until = null } = {}) {
    const e = eng();
    if (!e) return { ok: false, error: 'No engine here.' };
    if (R.busy()) return { ok: false, error: 'A take is running.' };
    try { R.parts.drummer?.stop?.(); } catch (x) { console.error('takes: the drummer', x); }
    try { if (e.playing) e.stop(); e.play(Math.max(0, beat)); } catch (x) { return err(x); }
    L.run = 'play';
    playAt = performance.now();
    hearing = until != null ? { until } : null;
    return { ok: true };
  }
  function stopPlay() {
    const e = eng();
    try { if (e?.playing) e.stop(); } catch { /* fine */ }
    if (L.run === 'play') L.run = 'idle';
    hearing = null;
    if (gr.take) gr.take.hear = null;
    return { ok: true };
  }
  function stopHear() { if (gr.take?.hear || (L.run === 'play' && gr.take)) stopPlay(); }

  /* ------------------------------------------------------------------------------------------- a take */
  function record(side = 'L', target = undefined) {
    if (P || R.busy()) return { ok: false, error: 'A take is already going.' };
    if (gr.take) closeReview();
    stopPlay();
    const p = store.get(), ln = PP.partLine(p);
    const tgt = target === undefined ? L.card : target;
    const sec = tgt && tgt !== 'new' ? ln.parts.find((x) => x.id === tgt) || null : null;
    if (side === 'R' && (!sec || !sec.takes.L.length)) { tell('gtake.side'); return { ok: false, error: 'Play the part on the left first.' }; }
    const track = ln.roles[side === 'R' ? 'guitarR' : 'guitarL'];
    if (!track) return { ok: false, error: 'There’s no guitar track in this room.' };
    const bpb = ln.bpb, bpm = ln.tempo || 120;
    const from = sec ? sec.start : ln.end;
    const countOn = R.gprefs.get().countIn !== false;
    const bars = countOn ? (bpm >= 160 ? 2 : 1) : from > EPS ? 1 : 0;
    const i = sec ? ln.parts.indexOf(sec) : ln.parts.length;
    const P0 = {
      gen: ++gen, side, section: sec?.id || null, name: sec ? sec.name : ln.next, n: (sec ? sec.takes[side].length : 0) + 1,
      from, tailFrom: sec ? sec.start + sec.length : null, bars: sec ? sec.bars : null, count: countOn ? bars * bpb : 0, preBars: bars,
      bpb, bpm, prev: ln.parts[i - 1]?.name || null, countOn, track, preview: null, landed: false, stopping: false, tossing: false, started: false, idleAt: null,
    };
    P = P0;
    try { R.parts.drummer?.stop?.(); } catch (e) { console.error('takes: the drummer', e); }
    L.run = 'count';
    L.side = side;
    if (sec) L.card = sec.id;
    if (side === 'R') monitor(track);
    rec.show(P0);
    go(P0);
    return { ok: true };
  }
  async function go(pass) {
    const a = app.input?.audio;
    if (a && !a.state?.open) { try { await a.ensureOpen?.(); } catch { /* said below */ } }
    if (P !== pass) return;
    if (!a?.state?.open) { done(pass); tell('gtake.input'); return; }
    // the drums under a part that has none yet (a new part past the end): the room's beat, heard and never kept
    try {
      const p = store.get(), to = pass.tailFrom ?? pass.from + 64 * pass.bpb;
      if (!drumsUnder(p, pass.from, to)) {
        const j = jamOps(p, { beat: beatOf(p, pass.section), from: pass.from, bars: Math.ceil((to - pass.from) / pass.bpb) + 16 });
        if (j?.ops?.length) pass.preview = store.preview(j.ops, { by: 'overdub' });
      }
    } catch (e) { console.error('takes: the drums under the take', e); }
    const drummer = R.parts.drummer;
    const loud = pass.countOn && !(drummer && drummer.countsAloud === true);
    let cnt, tk;
    try {
      cnt = R.deck.countIn({ from: pass.from, bars: pass.preBars, voice: loud ? 'sticks' : 'none', preroll: true });
      tk = R.deck.take({ track: pass.track, from: pass.from, tailFrom: pass.tailFrom });
    } catch (e) { failed(pass, e); return; }
    Promise.resolve(cnt).then((c) => {
      if (P !== pass) return;
      if (c && c.ok === false) { failed(pass, c); return; }
      if (pass.countOn && Number.isFinite(c?.startT)) {
        try { drummer?.countIn?.({ bars: pass.preBars, bpm: pass.bpm, at: c.startT, from: pass.from, sounded: loud }); } catch (e) { console.error('takes: the drummer’s count', e); }
      }
    }, (e) => failed(pass, e));
    Promise.resolve(tk).then((r) => { if (P === pass && r && r.ok === false) failed(pass, r); }, (e) => failed(pass, e));
  }
  // the pass is over, whatever happened: the drums it heard out, the view down, the run idle
  function done(pass) {
    if (P === pass) P = null;
    if (pass.preview) { try { pass.preview.release(); } catch { /* gone */ } pass.preview = null; }
    rec.hide();
    if (L.run === 'count' || L.run === 'take') L.run = 'idle';
  }
  function failed(pass, r) {
    if (P !== pass) return;
    done(pass);
    monitorHome();
    const msg = r?.error || (r instanceof Error ? r.message : '');
    if (msg && msg !== 'stopped') R.say(msg);
  }
  async function stopTake() {
    const pass = P;
    if (!pass || pass.stopping || pass.tossing) return { ok: true };
    pass.stopping = true;
    let r;
    try { r = await R.deck.stop({ at: 'now', keep: 'song' }); } catch (e) { failed(pass, e); return err(e); }
    landed(pass, r);
    return { ok: true };
  }
  function tossRec({ after = null, quiet = false } = {}) {
    const pass = P;
    if (!pass) return { ok: false };
    if (pass.tossing) return { ok: true };
    pass.tossing = true;
    pass.landed = true;
    Promise.resolve(R.deck.stop({ at: 'now', keep: 'capture' })).catch(() => null).then((r) => {
      done(pass);
      if (!after) monitorHome();
      if (!quiet) tell(r?.cancelled ? 'gtake.stopped' : 'gtake.esc', { tape: tapeKept() });
      if (after) after();
    });
    return { ok: true };
  }
  // the deck's commit, as the stream reads it: { txn, track, clip } | null
  function commitOf(r) {
    if (!isObj(r) || r.ok === false || !r.txn || !isObj(r.take) || !r.take.clip) return null;
    return { txn: txnId(r.txn), track: r.take.track, clip: r.take.clip };
  }
  // (a take that ended by itself: a hidden tab, the tempo moving; the deck says so)
  offs.push(R.deck.on?.('take', (r) => { if (P && !P.stopping && !P.tossing && commitOf(r)) landed(P, r); }) || (() => {}));
  offs.push(R.deck.on?.('empty', (r) => { if (P && !P.stopping && !P.tossing) landed(P, r); }) || (() => {}));

  function landed(pass, r) {
    if (pass.landed) return;
    pass.landed = true;
    done(pass);
    const c = commitOf(r);
    if (!c) {
      monitorHome();
      if (r?.cancelled) tell('gtake.stopped');
      else if (r?.kept === 'capture') tell('gtake.esc', { tape: tapeKept() });
      else if (r?.empty) tell('gtake.none');
      else if (r?.error) R.say(r.error);
      return;
    }
    const plan = PP.planTakeIn(store.get(), { track: c.track, clip: c.clip, from: pass.from, section: pass.section, name: pass.name });
    if (plan.error) { console.error('takes: the take’s part', plan.error); monitorHome(); return; }
    if (plan.ops.length) {
      const j = store.dispatch(plan.ops, { by: 'you', join: c.txn, label: plan.label, reason: plan.reason });
      if (!j.ok) console.error('takes: the take’s part', j.error);
    } else relabel(c.txn, plan.label, plan.reason);
    if (plan.isNew) {
      try { const b = beatOps(store.get(), { section: plan.section }); if (b?.ops?.length) { const j = store.dispatch(b.ops, { by: 'you', join: c.txn }); if (!j.ok) console.error('takes: the part’s drums', j.error); } } catch (e) { console.error('takes: the part’s drums', e); }
    }
    if (pass.side === 'R') {
      try { const pp = planPans(store.get()); if (pp?.ops?.length) store.dispatch(pp.ops, { by: 'you', join: c.txn }); } catch (e) { console.error('takes: the sides’ pans', e); }
    }
    relabel(c.txn, plan.label, plan.reason);
    L.card = plan.section;
    const clip = clipNow(c.track, c.clip);
    gr.take = { section: plan.section, side: pass.side, track: c.track, clip: c.clip, txn: c.txn, isNew: plan.isNew, take: plan.take, recEnd: clip ? clip.start + clip.length : null, landed: performance.now(), hear: null, pairWords: null };
    R.drawer(false);
    R.overlay('review');
    review.render();
    R.emit('takes:landed', { section: plan.section, side: pass.side, track: c.track, clip: c.clip, txn: c.txn, isNew: plan.isNew, take: plan.take });
    const sec = sectionOf(plan.section);
    const ln = lineNow(), nx = ln.parts[ln.parts.findIndex((x) => x.id === plan.section) + 1] || null;
    const bpb = ln.bpb;
    const ring = clip && sec ? Math.max(0, clip.start + clip.length - (sec.start + sec.length)) / bpb : 0;
    if (pass.side === 'R') pair(gr.take);
    else if (plan.isNew) tell('gtake.newin', { part: sec?.name || plan.label, bars: sec ? sec.bars : 1, ring });
    else if (clip && sec && clip.start + clip.length < sec.start + sec.length - 1e-3) tell('gtake.short', { take: plan.take, stopped: Math.max(1, Math.floor((clip.start + clip.length - sec.start) / bpb) + 1), bars: sec.bars });
    else tell('gtake.in', { take: plan.take, bars: sec?.bars || 1, ring, next: nx?.name || null });
    hear();
  }
  // the other side is in: how tightly it sits on the left, bar by bar (core/liveroom/tight.js measurePair), said in the
  // pair's own line (lines/double.js side.tight, side.fine, side.drift, side.wander)
  async function pair(T) {
    try {
      const sec = sectionOf(T.section);
      const left = sec ? PP.takesIn(store.get(), { section: sec.id, side: 'L' }).find((x) => !x.mute) : null;
      const right = clipNow(T.track, T.clip);
      if (!sec || !left || !right) return;
      const di = async (c) => {
        const buf = eng()?.assets?.peek?.(c.asset) || (await eng()?.assets?.get?.(c.asset));
        if (!buf) return null;
        const data = buf.getChannelData(0), sr = buf.sampleRate, spb = 60 / (store.get().tempo || 120);
        const at = Math.max(0, Math.round(((+c.offset || 0) + (sec.start - c.start) * spb) * sr));
        return { di: data.subarray(at), sr };
      };
      const [a, b] = [await di(left), await di(right)];
      if (!a || !b || a.sr !== b.sr || gr.take !== T) return;
      const m = measurePair(a.di, b.di, { sr: a.sr, tempo: store.get().tempo, start: 0, bars: Math.round(sec.length / lineNow().bpb), grid: 4, place: 'metal' });
      if (gr.take !== T) return;
      if (m?.line) {
        R.line(m.line.id, { ...m.line.vars, part: sec.name });
        const ms = Math.round(Math.abs(m.median ?? 0));
        T.pairWords = m.verdict === 'bar' && m.worst ? `Bar ${m.worst.bar} drifts ${m.worst.dir === 'early' ? 'early' : 'late'} against your left, about ${Math.max(5, Math.round(Math.abs(m.worst.ms) / 5) * 5)} ms.` : `Within ${Math.max(1, ms)} ms of your left take, on the median.`;
        review.render();
      }
    } catch (e) { console.error('takes: measuring the pair', e); }
  }
  // hear what you just played: the part from its 1 to the take's out, once (any press stops it)
  function hear() {
    const T = gr.take;
    if (!T) return { ok: false };
    if (T.hear) { stopPlay(); return { ok: true }; }
    const sec = sectionOf(T.section), c = clipNow(T.track, T.clip);
    if (!sec || !c) return { ok: false };
    const r = playFrom(sec.start, { until: c.start + c.length + 0.25 });
    if (r.ok) T.hear = { until: c.start + c.length + 0.25 };
    return r;
  }

  /* ------------------------------------------------------------------------------------------- review */
  function closeReview() {
    if (gr.overlay === 'review') R.overlay(null);
    gr.take = null;
  }
  function keep() {
    const T = gr.take;
    if (!T) return { ok: false, error: 'No take to keep.' };
    stopHear();
    closeReview();
    monitorHome();
    R.drawer(true);
    dirty = true;
    const sec = sectionOf(T.section);
    if (!sec) return { ok: true };
    if (T.side === 'R') {
      tell('gtake.keptR', { part: sec.name });
      // both sides, wide: the part from its 1 to the end of its ring
      const c = clipNow(T.track, T.clip);
      playFrom(sec.start, { until: Math.max(sec.start + sec.length, c ? c.start + c.length : 0) + 0.25 });
    } else tell('gtake.kept', { part: sec.name, n: PP.takesIn(store.get(), { section: sec.id, side: 'L' }).length });
    return { ok: true };
  }
  function tossTake({ quiet = false } = {}) {
    const T = gr.take;
    if (!T) return { ok: false, error: 'No take to toss.' };
    stopHear();
    closeReview();
    const u = store.undo({ id: T.txn, redo: false });
    monitorHome();
    dirty = true;
    if (!u.ok) { R.say('That take is under later changes now, so it stays. ⌘Z takes them back first.'); return { ok: false, error: u.error }; }
    if (T.isNew) L.card = lineNow().parts.at(-1)?.id || 'new';
    if (!quiet) tell('gtake.tossed', { take: T.take, tape: tapeKept() });
    return { ok: true };
  }
  function trim(which, beat, { free = false } = {}) {
    const T = gr.take;
    if (!T) return { ok: false };
    const op = { type: 'clip.trim', track: T.track, clip: T.clip, [which === 'in' ? 'start' : 'end']: beat };
    if (!free) op.snap = 'beat';
    const r = store.dispatch([op], { by: 'you', join: T.txn });
    if (!r.ok) { R.say(String(r.error || 'That trim didn’t go through.')); review.render(); return r; }
    if (which === 'out') {
      const c = clipNow(T.track, T.clip), sec = sectionOf(T.section);
      if (c && sec) tell('gtake.trim', { ring: Math.max(0, c.start + c.length - (sec.start + sec.length)) / lineNow().bpb });
    }
    review.render();
    return { ok: true };
  }
  function partEnd(bars) {
    const T = gr.take;
    if (!T || !T.isNew) return { ok: false };
    const pl = PP.planPartEnd(store.get(), { section: T.section, track: T.track, clip: T.clip, bars });
    if (!pl.ops.length) { review.render(); return { ok: true }; }
    const r = store.dispatch(pl.ops, { by: 'you', join: T.txn });
    if (!r.ok) { R.say(String(r.error)); return r; }
    try { const b = beatOps(store.get(), { section: T.section }); if (b?.ops?.length) store.dispatch(b.ops, { by: 'you', join: T.txn }); } catch (e) { console.error('takes: the part’s drums', e); }
    const sec = sectionOf(T.section);
    if (sec) tell('gtake.partlen', { part: sec.name, bars: sec.bars });
    review.render();
    return { ok: true };
  }
  function pick(dir) {
    const T = gr.take;
    const section = T ? T.section : selected()?.id || null;
    if (!section) return { ok: false, error: 'Pick a part first.' };
    const side = T ? T.side : 'L';
    const pl = PP.planPick(store.get(), { section, side, dir });
    const sec = sectionOf(section);
    if (!pl.ops.length) {
      if (pl.edge === 'one') tell('gtake.one', { part: sec?.name || 'That part' });
      else if (pl.edge) tell('gtake.edge', { part: sec?.name || 'That part', take: pl.take });
      return { ok: false, error: 'No other take that way.' };
    }
    const r = store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason, ...(T ? { join: T.txn } : {}) });
    if (!r.ok) return r;
    tell('gtake.pick', { part: sec?.name || 'It', take: pl.take });
    if (T) review.render();
    return { ok: true };
  }

  /* ------------------------------------------------------------------------------------------- the part line */
  const refuse = () => (R.busy() ? { ok: false, error: 'A take is running.' } : gr.take ? { ok: false, error: 'Keep or toss the take first.' } : null);
  function step(pl, { by = 'you' } = {}) {
    if (!pl?.ops?.length) return { ok: false, error: pl?.error || 'Nothing to change there.' };
    const r = store.dispatch(pl.ops, { by, label: pl.label, reason: pl.reason });
    dirty = true;
    return r.ok ? { ok: true, txn: r.txn } : { ok: false, error: r.error };
  }
  function newPart(at) {
    const no = refuse();
    if (no) return no;
    const pl = PP.planNewPart(store.get(), { at });
    const r = step(pl);
    if (!r.ok) return r;
    try { const b = beatOps(store.get(), { section: pl.section }); if (b?.ops?.length) store.dispatch(b.ops, { by: 'you', join: txnId(r.txn) }); } catch (e) { console.error('takes: the part’s drums', e); }
    L.card = pl.section;
    R.drawer(true);
    const ln = lineNow(), i = ln.parts.findIndex((x) => x.id === pl.section);
    tell('gpart.added', { part: ln.parts[i]?.name || 'a part', bars: pl.length / ln.bpb, where: PP.whereWords(ln, i) });
    return { ok: true };
  }
  function movePart(id, to) {
    const no = refuse();
    if (no) return no;
    const pl = PP.planMovePart(store.get(), { section: id, to });
    if (!pl.ops.length) return { ok: false, error: 'It’s already there.' };
    const r = step(pl);
    if (!r.ok) return r;
    L.card = id;
    const sec = sectionOf(id);
    tell('gpart.moved', { part: sec?.name || 'It', where: pl.where });
    return { ok: true };
  }
  function rename(id, name) {
    const sec = sectionOf(id);
    if (!sec || !name || name === sec.name) return { ok: false };
    const r = store.dispatch({ type: 'section.set', section: id, patch: { name: String(name).slice(0, 40) } }, { by: 'you', label: `Named it ${name}`, reason: `room:name:${id}` });
    dirty = true;
    if (r.ok) tell('gpart.named', { part: name });
    return r.ok ? { ok: true } : r;
  }
  function selectCard(which) {
    const ln = lineNow(), ps = ln.parts;
    const i = ps.findIndex((x) => x.id === L.card);
    let next = null;
    if (which === 'new') next = 'new';
    else if (which === 'prev') next = L.card === 'new' ? ps.at(-1)?.id || 'new' : ps[Math.max(0, i < 0 ? 0 : i - 1)]?.id || 'new';
    else if (which === 'next') next = i < 0 ? (L.card === 'new' ? 'new' : ps[0]?.id || 'new') : ps[i + 1]?.id || 'new';
    else if (which === 'first') next = ps[0]?.id || 'new';
    else if (which === 'last') next = ps.at(-1)?.id || 'new';
    else next = ps.some((x) => x.id === which) ? which : null;
    if (!next) return { ok: false, error: 'There’s no part like that.' };
    L.card = next;
    R.drawer(true);
    dirty = true;
    return { ok: true };
  }

  /* ------------------------------------------------------------------------------------------- press */
  const rec0 = () => !!P;
  function press(id) {
    const s = String(id || '');
    // (playing back after a take: any press stops it first, then does what it does)
    if (gr.take?.hear && s !== 'hear' && s !== 'stop') stopHear();
    if (s.startsWith('card:')) return selectCard(s.slice(5));
    switch (s) {
      case 'record':
        if (rec0()) return press('again');
        if (gr.take) return press('again');
        return record('L');
      case 'again': {
        if (rec0()) {
          const pass = P;
          tell('gtake.again');
          return tossRec({ quiet: true, after: () => record(pass.side, pass.section || 'new') });
        }
        const T = gr.take;
        if (T) {
          const target = T.isNew ? 'new' : T.section;
          tossTake({ quiet: true });
          return record(T.side, target);
        }
        return record('L');
      }
      case 'stop':
        if (rec0()) { stopTake(); return { ok: true }; }
        if (L.run === 'play' || eng()?.playing) return stopPlay();
        return { ok: false, error: 'Nothing’s playing.' };
      case 'toss':
        if (rec0()) return tossRec();
        return tossTake();
      case 'keep': return keep();
      case 'hear':
        if (gr.take) return hear();
        if (L.run === 'play') return stopPlay();
        return press('play');
      case 'side': {
        const T = gr.take;
        if (T) {
          if (T.side === 'R') return { ok: false, error: 'This is the other side already.' };
          const section = T.section;
          keep();
          return record('R', section);
        }
        if (rec0()) return { ok: false, error: 'A take is running.' };
        return record('R', selected()?.id || null);
      }
      case 'home': {
        if (rec0()) return { ok: false, error: 'A take is running.' };
        if (!lineNow().parts.length) { tell('gpart.empty'); return { ok: false, error: 'The part line’s empty.' }; }
        if (L.run === 'play') stopPlay();
        const r = playFrom(0);
        if (r.ok) tell('gpart.top');
        return r;
      }
      case 'play': {
        if (rec0()) return { ok: false, error: 'A take is running.' };
        if (L.run === 'play') return stopPlay();
        const sec = selected();
        if (!lineNow().parts.length) { tell('gpart.empty'); return { ok: false, error: 'The part line’s empty.' }; }
        const r = playFrom(sec ? sec.start : 0);
        if (r.ok) tell(sec ? 'gpart.from' : 'gpart.top', { part: sec?.name });
        return r;
      }
      case 'take:up': return pick(-1);
      case 'take:down': return pick(1);
      case 'part:new': case 'part:before': {
        const ln = lineNow(), i = ln.parts.findIndex((x) => x.id === L.card);
        return newPart(s === 'part:before' ? Math.max(0, i) : i < 0 ? ln.parts.length : i + 1);
      }
      case 'part:remove': {
        const no = refuse();
        if (no) return no;
        const sec = selected();
        if (!sec) return { ok: false, error: 'Pick a part first.' };
        const ln = lineNow(), i = ln.parts.indexOf(sec);
        const r = step(PP.planRemovePart(store.get(), { section: sec.id }));
        if (!r.ok) return r;
        const after = lineNow().parts;
        L.card = after[Math.min(i, after.length - 1)]?.id || 'new';
        tell('gpart.removed', { part: sec.name, n: after.length });
        return { ok: true };
      }
      case 'part:left': case 'part:right': {
        const sec = selected();
        if (!sec) return { ok: false, error: 'Pick a part first.' };
        const ln = lineNow(), i = ln.parts.indexOf(sec);
        if (s === 'part:left' && i === 0) { tell('gpart.first'); return { ok: false, error: 'It’s the first part.' }; }
        if (s === 'part:right' && i === ln.parts.length - 1) { tell('gpart.last'); return { ok: false, error: 'It’s the last part.' }; }
        return movePart(sec.id, s === 'part:left' ? i - 1 : i + 2);
      }
      default: return false;
    }
  }

  /* ------------------------------------------------------------------------------------------- a riff onto the line */
  async function place(riff, { at = null } = {}) {
    const no = refuse();
    if (no) return no;
    if (!riff) return { ok: false, error: 'No riff to put there.' };
    let into = riff;
    if (!isObj(riff.clip)) {
      const db = await import('../riffs-db.js');
      into = await db.intoSong(riff.id || riff, { project: store.get() });
      if (!into?.ok) return { ok: false, error: into?.error || 'That riff isn’t here.' };
    }
    const p = store.get(), ln = PP.partLine(p);
    const track = ln.roles.guitarL;
    if (!track) return { ok: false, error: 'There’s no guitar track in this room.' };
    const idx = typeof at === 'string' ? Math.max(0, ln.parts.findIndex((x) => x.id === at)) : at;
    const pl = PP.planRiffPart(p, { at: idx, riff: into, track, name: riff.name || into.clip?.name || null });
    if (pl.error) return { ok: false, error: pl.error };
    const r = step(pl);
    if (!r.ok) return r;
    try { const b = beatOps(store.get(), { section: pl.section }); if (b?.ops?.length) store.dispatch(b.ops, { by: 'you', join: txnId(r.txn) }); } catch (e) { console.error('takes: the part’s drums', e); }
    L.card = pl.section;
    R.drawer(true);
    const ln2 = lineNow(), i = ln2.parts.findIndex((x) => x.id === pl.section);
    tell('gpart.riff', { part: ln2.parts[i]?.name || 'The riff', bars: pl.length / ln2.bpb, where: PP.whereWords(ln2, i) });
    return { ok: true, section: pl.section };
  }

  /* ------------------------------------------------------------------------------------------- the loop */
  function summary() {
    const ln = lineNow();
    const bars = ln.parts.reduce((a, c) => a + c.bars, 0);
    return { parts: ln.parts.length, bars, secs: Math.round((bars * ln.bpb * 60) / (ln.tempo || 120)) };
  }
  function frame() {
    const e = eng();
    if (P) {
      // the run follows the deck: the count turns into the take at its 1
      const run = R.deck.state?.run;
      if (run === 'take') { P.started = true; if (L.run === 'count') L.run = 'take'; }
      // (the recorder let the take go by itself with nothing to commit: the transport stopped under it)
      if (P.started && run === 'idle' && !P.stopping && !P.tossing) {
        P.idleAt ??= performance.now();
        if (performance.now() - P.idleAt > 600) { const pass = P; done(pass); monitorHome(); tell('gtake.none'); }
      } else if (P) P.idleAt = null;
      if (P) rec.frame(P);
    }
    if (L.run === 'play' && e && !e.playing && performance.now() - playAt > 1500) { L.run = 'idle'; hearing = null; if (gr.take) gr.take.hear = null; }
    if (L.run === 'play' && hearing && e?.playing && e.beat >= hearing.until) stopPlay();
    if (gr.take?.hear) review.frame();
    // the selection stays on something that's there
    if (dirty) {
      dirty = false;
      const p = store.get(), ln = PP.partLine(p);
      if (L.card && L.card !== 'new' && !ln.parts.some((x) => x.id === L.card)) L.card = ln.parts.at(-1)?.id || null;
      if (gr.take && (!ln.parts.some((x) => x.id === gr.take.section) || !clipNow(gr.take.track, gr.take.clip))) { closeReview(); monitorHome(); }
      const beats = {};
      for (const c of ln.parts) beats[c.id] = beatName(p, c.id);
      const sel = selected();
      if (!line.dragging()) line.render({ line: ln, sel: L.card, beats, song: p, canOther: !!(sel && sel.takes.L.length && !P && !gr.take) });
      if (gr.take && !review.dragging()) review.render();
      const sm = summary(), key = JSON.stringify(sm);
      if (key !== lastSummary) { lastSummary = key; R.emit('takes:parts', sm); }
    }
    line.frame(L.run === 'play' || L.run === 'take' ? e?.beat ?? null : null);
  }

  return {
    press,
    back() {
      if (P) { tossRec(); return true; }
      if (gr.overlay === 'review' && gr.take) { keep(); return true; }
      if (L.run === 'play') { stopPlay(); return true; }
      return false;
    },
    frame,
    unmount() {
      const pass = P;
      if (pass) { pass.tossing = true; pass.landed = true; Promise.resolve(R.deck.stop({ at: 'now', keep: 'capture' })).catch(() => {}); done(pass); }
      if (L.run === 'play') stopPlay();
      if (gr.take) closeReview();
      rec.hide();
      for (const off of offs.splice(0)) { try { off(); } catch { /* fine */ } }
      line.dispose();
      review.dispose();
      R.el.drawer.parts.replaceChildren();
      R.el.over.replaceChildren();
    },
    inReview: () => !!gr.take && gr.overlay === 'review',
    part: () => (L.card && L.card !== 'new' ? L.card : null),
    place,
    summary,
    dropAt: (x, y, o) => line.dropAt(x, y, o || {}),
  };
}
