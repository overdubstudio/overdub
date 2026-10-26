// The stage [ui; stream C] (docs/research/LIVE-ROOM-MODE.md §3.3-§3.12, §3.17, §3.18, §7): the place in pixels with
// its gear (ui/liveroom/pixels sceneOf, stream E's), the soundcheck's lamps beside it (./soundcheck.js mountLamps,
// stream A's), the readout and the offered move, the talkback, and the setlist under it (./setlist.js); where the
// takes are played. It adds the 'stage' screen to the registry (./screens.js) when it's imported.
//
// Every musical decision is the deck's and the plans': a take is the deck's commit (./deck.js, stream A) with the
// part's ops joined to its step (core/liveroom/plans.js takeOps), the band's learning is its own step by the house
// (core/liveroom/band.js planLearn, stream B; reason room:learn:<section>), and the card menu's items are one step each.
// The stage only paints and presses: what it shows is drawn from the song (core/liveroom/session.js readRoom) and the
// session (ui.state.liveRoom) in the shell's one loop, never held in the DOM.
//
//   the screen's press(id) (app.liveRoom.press): 'space' (the offered move), 'count', 'take' (That's a take), 'stop',
//     'other', 'next', 'again', 'punch', 'layout', 'notyet', 'hear', 'home' / 'from' (hear it from the top / the
//     selected card), 'play' (an empty part), 'esc' (Not that one), 'keep' (⇧R: keep it after all), 'feel', 'simpler',
//     'busier', 'softer', 'louder', 'twice', 'loop', 'name:<name>', 'earlier', 'later', 'shorter:<bars>', 'remove',
//     'bassYours', 'take:up' / 'take:down', 'card:<id>' / 'card:prev' / 'card:next' / 'card:first' / 'card:last',
//     'menu', 'tempo:+2' / 'tempo:-10' ..., 'tap', 'rig:next' / 'rig:prev', 'tune', 'ask', 'shelf'; -> { ok, error? }
//
// The deck's take, as the stage reads it (stream A's, §14.2 frozen as createDeck's shape): countIn({ from, bars, voice })
// and take({ track, from, punch, tail }) are called in the same tick; stop({ at: 'bar', to, keep: 'song' }) (to: the
// beat the stop lands on, session.js stopBeat) and a punch's take() resolve to { ok, commit: { txn, track, clip | clips,
// from, to, samples?, sr? } } (txn: the recorder's step, a txn or its id), which the stage joins its part's ops to.

import { h } from '../dom.js';
import { screens } from './screens.js';
import { NAMES } from '../../core/liveroom/model.js';
import { W, H, LEDGE, windowFor } from './pixels/index.js';
import { mountLamps } from './soundcheck.js';
import { createSetlist } from './setlist.js';
import { menuItems, openMenu } from './menu.js';
import { liveView, runPlan, clock, tuningWords, low, cap } from './view.js';
import { offered, stopBeat } from '../../core/liveroom/session.js';
import { takeOps, planLayout, planTwice, planMove, planShorter, planRemove } from '../../core/liveroom/plans.js';
import { guideOps, planLearn, planFeel, planBassYours } from '../../core/liveroom/band.js';
import { planDouble } from '../../core/liveroom/double.js';
import { measurePair } from '../../core/liveroom/tight.js';
import { readInWorker } from '../../core/liveroom/read.js';
import { setupOf, feelsOf, placeOf, rigLabel } from '../../core/liveroom/places.js';
import { LINES as DOUBLE } from '../../core/liveroom/lines/double.js';
import { LINES as SOUNDCHECK } from '../../core/liveroom/lines/soundcheck.js';
import { LINES as STAGE } from '../../core/liveroom/lines/stage.js';

const title = (place) => { const n = NAMES.place[place]; return n ? cap(n) : 'The stage'; };
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const EPS = 1e-6;
const PAN_MS = 200;
// (the session's heard shapes, per song, for the page's life: "heard top to bottom since it last changed", §7.4)
const heardOf = new Map();
const songKey = (p) => p?.meta?.id || p?.id || 'song';

function fitScale(availW, availH, w, h) {
  const k = Math.floor(Math.min(availW / w, availH / h) + 1e-9);
  return Math.max(1, Math.min(6, k));
}

screens.add({
  id: 'stage',
  mount(el, ctx) {
    const { app, ui, store, deck, prefs } = ctx;
    const L = ui.state.liveRoom || (ui.state.liveRoom = { open: true, screen: 'stage', card: null, menu: null, run: 'idle', side: 'L' });
    const eng = () => app.engine || null;
    const offs = [];
    const has = (id) => Object.hasOwn(STAGE, id) || Object.hasOwn(DOUBLE, id) || Object.hasOwn(SOUNDCHECK, id);
    const say = (id, vars) => (has(id) ? ctx.say(id, vars) : false);

    /* --------------------------------------------------------------------------------------------- the layout */
    const sceneCv = h('canvas.lr-scene', { width: W, height: H, 'aria-hidden': 'true' });
    const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : h('canvas', { width: W, height: H });
    const offG = /** @type {any} */ (off).getContext('2d');
    const sceneBox = h('div.lr-scenebox', sceneCv);
    const where = h('h1.lr-h.disp', title(ctx.view().place));
    const readTempo = h('span.lr-ro-tempo.mono');
    const readTune = h('span.lr-ro-tune');
    const readKey = h('span.lr-ro-key');
    const counter = h('span.lr-counter.mono', { 'aria-live': 'off' });
    const rigName = h('span.lr-rig-name');
    const rigPrev = h('button.btn.btn-txt.lr-rig-step', { type: 'button', 'aria-label': 'The amp’s setting before', onclick: () => press('rig:prev') }, '‹');
    const rigNext = h('button.btn.btn-txt.lr-rig-step', { type: 'button', 'aria-label': 'The amp’s next setting', onclick: () => press('rig:next') }, '›');
    const rigRow = h('div.lr-rig', rigPrev, rigName, rigNext, h('kbd.lr-kbd.lr-hint', '[ ]'));
    const lampsEl = h('div.lr-lamps');
    const primary = h('button.btn.lr-primary', { type: 'button', onclick: () => press('space') }, h('span.lr-pl'), h('kbd.lr-kbd'));
    const notYet = h('button.btn.lr-sec', { type: 'button', hidden: true, onclick: () => press('notyet') }, 'Not yet');
    const again = h('button.btn.lr-sec', { type: 'button', onclick: () => press('again') }, 'Again', h('kbd.lr-kbd', 'R'));
    const next = h('button.btn.lr-sec', { type: 'button', onclick: () => press('next') }, 'Next part', h('kbd.lr-kbd', 'N'));
    const hear = h('button.btn.lr-sec.lr-hear', { type: 'button', onclick: () => press('home') }, 'Hear it all', h('kbd.lr-kbd', 'Enter'));
    const more = h('button.btn.lr-sec.lr-more', { type: 'button', onclick: (e) => press('menu', e.currentTarget) }, 'More');
    const tDown = h('button.btn.lr-step', { type: 'button', 'aria-label': 'Slower', onclick: () => press('tempo:-2') }, '−');
    const tUp = h('button.btn.lr-step', { type: 'button', 'aria-label': 'Faster', onclick: () => press('tempo:+2') }, '+');
    const tVal = h('span.lr-step-val.mono');
    const steppers = h('div.lr-steppers', tDown, tVal, tUp);
    const actions = h('div.lr-actions', primary, notYet, h('div.lr-secs', again, next, hear, more), steppers);
    const readout = h('div.lr-readout', h('p.lr-ro', readTempo, readTune, readKey, counter), rigRow);
    const side = h('div.lr-side', readout, lampsEl, actions);
    const tbSlot = h('div.lr-tbslot');
    const setlist = createSetlist({
      app,
      onPick: (id) => press(`card:${id}`),
      onMenu: (id, anchor) => { L.card = id; press('menu', anchor); },
      onNext: () => press('next'),
    });
    const stage = h('div.lr-stage', { dataset: { run: 'idle' } }, h('div.lr-stage-where', where), sceneBox, side, tbSlot, setlist.el);
    el.append(stage);
    // the talkback sits between the stage and the setlist (§3.18): the room's own strip, moved here while the stage is up
    const room = el.closest('.lr');
    const tb = room?.querySelector('.lr-talkback');
    if (tb) tbSlot.append(tb);
    const lamps = (() => { try { return mountLamps(lampsEl, ctx); } catch (e) { console.error('liveroom: the lamps', e); return { frame() {}, unmount() {} }; } })();

    /* --------------------------------------------------------------------------------------------- the session */
    const S = { last: null, drift: null, pass: null, preview: null, taps: [], feelAsk: null, menu: null, from: null, top: false, ended: false, nameBox: null };
    const song = () => store.get();
    const view = () => ctx.view();
    const saidFor = () => {
      const p = song(), out = [];
      try { if (prefs.said(p, 'layout.answered')) out.push('layout.offer'); if (prefs.said(p, 'basement.other')) out.push('basement.other'); } catch { /* storage: fine */ }
      return out;
    };
    const runState = () => ({ run: L.run, last: S.last, drift: S.drift, said: saidFor(), heard: heardOf.get(songKey(song())) || null });
    const offer = () => offered(view(), runState());
    const card = (id = L.card) => view().cards.find((c) => c.id === id) || null;
    const releasePreview = () => { if (S.preview) { try { S.preview.release(); } catch { /* gone */ } S.preview = null; } };
    const roleFor = (v, c, kind) => {
      if (kind === 'other') return 'guitarR';
      if (v.place === 'bluesbar') return /^solo/i.test(String(c?.name || v.next || '')) && v.roles.lead ? 'lead' : 'guitar';
      if (v.place === 'kitchen') return 'take';
      return 'guitarL';
    };
    const busy = () => L.run === 'count' || L.run === 'take' || L.run === 'learn';
    const dispatch = (ops, o) => store.dispatch(ops, o);
    const err = (e) => ({ ok: false, error: String(e?.message || e || 'That didn’t work.') });

    // a pass: the count (or the pre-roll) and the take, from the deck, the band's guide heard over it as a preview
    function pass(kind, cardId = null, { bar = null } = {}) {
      if (L.run !== 'idle') return { ok: false, error: 'Something’s already running.' };
      const v = view();
      const c = cardId ? v.cards.find((x) => x.id === cardId) : null;
      if (kind !== 'new' && !c) return { ok: false, error: 'Pick a part first.' };
      if (c?.end) { ctx.say('end.follows'); return { ok: true }; }
      // (Bar 5 again: that bar of the right side, with the bar before it as the pre-roll)
      const role = kind === 'punch' ? 'guitarR' : roleFor(v, c, kind);
      const track = v.roles[role];
      if (!track) return { ok: false, error: role === 'guitarR' ? 'There’s no right side in this room.' : 'There’s no guitar track in this room.' };
      const bpb = v.bpb || 4;
      const lastPart = v.parts.at(-1) || null;
      const punch = c ? (kind === 'punch' && bar >= 1 ? [c.start + (bar - 1) * bpb, c.start + bar * bpb] : [c.start, c.start + c.length]) : null;
      const from = punch ? punch[0] : lastPart ? lastPart.start + lastPart.length : 0;
      const first = !v.taken;
      const S0 = v.place ? setupOf(v.place) : null;
      const pre = first ? 0 : kind === 'new' ? 2 : 1;
      // (the count: the first take's, or a pass at the top of the song, where there's no song before it to pre-roll)
      const counted = first || from - pre * bpb < -EPS;
      const countBeats = counted ? S0?.count?.beats || ((v.tempo || 120) >= 160 ? 8 : 4) : 0;
      const p = song();
      S.pass = { kind, from, punch, track, role, section: c?.id || null, name: c ? c.name : v.next, landed: false, bpb, bar };
      L.run = 'count';
      L.card = c?.id || L.card;
      tbHold(true);
      // the band's guide under the pass (B's guideOps), heard and never stored
      try {
        const g = guideOps(p, { section: c?.id || null, from, bars: punch ? (punch[1] - punch[0]) / bpb : 8, feel: c?.part?.feel || null });
        if (g?.ops?.length) S.preview = store.preview(g.ops, { by: 'overdub' });
      } catch (e) { console.error('liveroom: the guide', e); }
      // (from: the downbeat the count or the pre-roll leads into; voice 'none' is the song's own bars before it, §9.4)
      const hits = counted && Array.isArray(S0?.count?.hits) ? S0.count.hits : undefined;
      const count = deck.countIn({ from, bars: counted ? countBeats / bpb : pre, voice: counted ? S0?.count?.voice || 'sticks' : 'none', hits });
      const take = deck.take({ track, from, punch: punch ? { from: punch[0], to: punch[1] } : null, tail: bpb });
      Promise.resolve(count).then((r) => {
        if (S.pass?.from !== from) return;
        if (r && r.ok === false) return failed(r);
        if (L.run === 'count') L.run = 'take';
      }, failed);
      Promise.resolve(take).then((r) => {
        if (r && r.ok === false) return failed(r);
        if (commitOf(r)) landed(r);
      }, failed);
      return { ok: true };
    }
    function failed(r) {
      if (!S.pass) return;
      S.pass = null;
      releasePreview();
      L.run = 'idle';
      tbHold(false);
      const msg = r?.error || (r instanceof Error ? r.message : '');
      if (msg) ctx.app.liveRoom?.say?.(msg);
    }
    async function stopPass() {
      const P = S.pass;
      if (!P) return { ok: false };
      const v = view(), beat = eng()?.beat ?? P.from;
      const to = stopBeat(v, beat, { from: P.from });
      P.to = to;
      let r;
      try { r = await deck.stop({ at: 'bar', to, keep: 'song' }); } catch (e) { failed(e); return err(e); }
      if (r && r.ok === false) { failed(r); return r; }
      if (commitOf(r)) landed(r);
      else if (S.pass === P) nothingKept(r);
      return { ok: true };
    }
    // a pass that left nothing in the song: stopped in the count (said nothing), or under a bar (the deck's line)
    function nothingKept(r) {
      S.pass = null; releasePreview(); L.run = 'idle'; tbHold(false);
      if (r?.cancelled) return;
      if (!(typeof r?.line === 'string' && say(r.line))) say('take.none');
    }
    // What the deck hands back for a landed take, as the stage reads it: a commit ({ txn, track, clip | clips, from,
    // to, samples?, sr? }), or the deck's take ({ ok, txn, take: { track, clip, asset }, takes, from, to, quietLead }).
    // null: nothing landed (a take that has only started, a count stopped, a pass under a bar)
    function commitOf(r) {
      if (!isObj(r) || r.ok === false) return null;
      if (isObj(r.commit)) return r.commit;
      if (!r.txn) return null;
      const t = isObj(r.take) ? r.take : null;
      const clips = Array.isArray(r.takes) ? r.takes.map((x) => x?.clip).filter(Boolean) : null;
      return { ...r, track: r.track || t?.track || null, clip: r.clip || t?.clip || null, clips: r.clips || clips };
    }
    // (a punch ends itself: its take lands through the deck's 'take' and 'empty' events, as well as take()'s promise)
    offs.push(deck.on?.('take', (r) => { if (S.pass && !S.pass.landed && S.pass.punch && commitOf(r)) landed(r); }) || (() => {}));
    offs.push(deck.on?.('empty', (r) => { if (S.pass && !S.pass.landed && S.pass.punch) nothingKept(r); }) || (() => {}));
    // the stop rule is the session's (the blues bar's chorus rule): the deck asks it, on the beat the key went down
    const stopWas = deck.stopBeat;
    try { deck.stopBeat = (beat, o = {}) => stopBeat(view(), beat, { from: o.from ?? S.pass?.from ?? null }); } catch { /* a frozen deck: it keeps its own */ }
    offs.push(() => { try { deck.stopBeat = stopWas ?? null; } catch { /* fine */ } });
    // the deck committed a take: its part, its seams and the End joined to the step, then the band learns it
    function landed(r) {
      const P = S.pass;
      if (!P || P.landed) return;
      P.landed = true;
      releasePreview();
      const c = commitOf(r) || r;
      const txn = typeof c.txn === 'string' ? c.txn : c.txn?.id || null;
      const to = Number.isFinite(c.to) ? c.to : P.to ?? (P.punch ? P.punch[1] : P.from + 8 * P.bpb);
      const from = Number.isFinite(c.from) ? c.from : P.from;
      const v0 = view();
      // (the song's first part: the whole bars at its head you didn't play in go, §3.6; the deck counts them)
      const drop = P.kind === 'new' && !v0.taken && Number(c.quietLead) > 0 ? Number(c.quietLead) * P.bpb : 0;
      const plan = takeOps({ song: song(), track: c.track || P.track, clip: c.clip || null, clips: c.clips || null, from, to, section: P.section, name: P.name, drop }, {});
      if (plan.ops.length) {
        const j = dispatch(plan.ops, { by: 'you', join: txn || undefined, label: plan.label, reason: plan.reason });
        if (!j.ok) { console.error('liveroom: the take\'s part', j.error); }
      } else if (txn && plan.label) {
        // (nothing to join, the take already where its part is: the recorder's step takes the part's label and reason)
        const last = store.history.at(-1);
        if (last?.id === txn) { last.label = plan.label; last.reason = plan.reason; }
      }
      const section = plan.section || P.section;
      S.last = section;
      S.drift = null;
      L.card = section;
      L.side = 'L';
      const v = view(), cd = v.cards.find((x) => x.id === section);
      const n = cd ? (P.role === 'guitarR' ? cd.takes.R.length : cd.takes.L.length || cd.takes.lead.length) : 1;
      // (the part as it landed: a new one's bars, the dropped ones out)
      const pFrom = P.kind === 'new' && cd ? cd.start : from, pTo = P.kind === 'new' && cd ? cd.start + cd.length : to;
      tbHold(false);
      if (P.kind === 'new' && !v0.taken) say('part.in', { part: cd?.name || P.name, bars: Math.round((pTo - pFrom) / P.bpb), bpm: Math.round(v.tempo), tuning: tuningWords(v.tuning) });
      else if (P.kind === 'new') say('next.in', { part: cd?.name || P.name, bars: Math.round((pTo - pFrom) / P.bpb) });
      else if (P.kind === 'again' && n > 1) say('again.in', { part: cd?.name || P.name, take: n, was: n - 1 });
      S.pass = null;
      // (the right side: the drums follow the left take, so the band doesn't learn from it; the pair is measured)
      if (P.role === 'guitarR') { pair(section, c, { from, to, bar: P.kind === 'punch' ? P.bar : null }); return; }
      learn(section, c, { from: pFrom, to: pTo, name: cd?.name || P.name });
    }
    // a clip's recording from the part's 1, as a DI (the commit's samples, else the asset the engine holds)
    function diOf(clipId, { from, samples = null, sr = null } = {}) {
      const found = clipId ? store.findClip?.(clipId) : null;
      const clip = found?.clip || null;
      let data = samples, rate = sr || 48000;
      if (!data && clip?.asset) {
        const buf = eng()?.assets?.peek?.(clip.asset);
        if (buf) { data = buf.getChannelData(0); rate = buf.sampleRate; }
      }
      if (!data || !clip) return null;
      const spb = 60 / (song().tempo || 120);
      const at = Math.max(0, Math.round(((+clip.offset || 0) + (from - clip.start) * spb) * rate));
      return { di: data.subarray(at), sr: rate };
    }
    // the other side is in: how tightly it sits on the left, bar by bar (B's measurePair, §4.7), in one line; a drift
    // of one or two bars offers that bar again (Space). Then the part plays back once, wide.
    function pair(section, c, { from, to, bar = null }) {
      L.run = 'idle';
      const v = view(), cd = v.cards.find((x) => x.id === section);
      if (!cd) return;
      const bpb = v.bpb || 4, bars = Math.round((to - from) / bpb);
      let m = null;
      try {
        const left = diOf(cd.playing.L, { from });
        const right = diOf(c.clip || c.clips?.[0] || cd.playing.R, { from, samples: c.samples || null, sr: c.sr || null });
        if (left && right && left.sr === right.sr) m = measurePair(left.di, right.di, { sr: left.sr, tempo: song().tempo, start: 0, bars, grid: placeOf(v.place).grid || 4 });
      } catch (e) { console.error('liveroom: measuring the pair', e); }
      // needs B: measurePair's verdict and the side.* lines (lines/double.js)
      const per = Array.isArray(m?.perBar) ? m.perBar.filter((b) => Number.isFinite(b?.ms)) : [];
      const worst = per.reduce((a, b) => (!a || Math.abs(b.ms) > Math.abs(a.ms) ? b : a), null);
      const r5 = (x) => Math.round(Math.abs(x) / 5) * 5;
      const vars = { part: cd.name, ms: worst ? Math.round(Math.abs(worst.ms)) : null };
      // (a punch: that bar alone, measured again)
      if (bar != null) { if (worst) say('side.punched', { ...vars, bar }); return; }
      if (m?.verdict === 'bar' && worst) {
        S.drift = { card: section, bar: worst.bar };
        say('side.drift', { ...vars, bar: worst.bar, ms: r5(worst.ms), dir: worst.ms > 0 ? 'late' : 'early' });
      } else if (m?.verdict === 'loose') {
        const lim = Math.min(20, (60000 / (song().tempo || 120)) / 16);
        const first = per.find((b) => Math.abs(b.ms) > lim || b.matched === false) || per[0] || null;
        say('side.wander', { ...vars, bar: first?.bar ?? 1 });
      } else if (m?.verdict === 'tight') say(worst && Math.abs(worst.ms) <= 10 ? 'side.tight' : 'side.fine', vars);
    }
    async function learn(section, c, { from, to }) {
      L.run = 'learn';
      try {
        const p = song();
        const cid = c.clip || c.clips?.[0] || null;
        const found = cid ? store.findClip?.(cid) : null;
        const clip = found?.clip || null;
        let samples = c.samples || null, sr = c.sr || 48000;
        if (!samples && clip?.asset) {
          const buf = eng()?.assets?.peek?.(clip.asset);
          if (buf) { samples = buf.getChannelData(0); sr = buf.sampleRate; }
        }
        const spb = 60 / (p.tempo || 120);
        const start = clip ? (+clip.offset || 0) + (from - clip.start) * spb : 0;
        const read = samples ? await readInWorker(samples, sr, { tempo: p.tempo, start, bars: (to - from) / (view().bpb || 4), grid: placeOf(view().place).grid, latency: deck.latency || 0, place: view().place }) : null;
        const plan = read ? planLearn(song(), { section, read }) : null;
        if (plan?.ops?.length) {
          const reason = /^room:learn:/.test(plan.reason || '') ? plan.reason : `room:learn:${section}`;
          const nm = view().cards.find((x) => x.id === section)?.name || 'part';
          const r = dispatch(plan.ops, { by: 'overdub', label: plan.label || `The band learned the ${low(nm)}`, reason });
          if (!r.ok) console.error('liveroom: the band\'s learning', r.error);
          else if (plan.line && has(plan.line)) ctx.say(plan.line, plan.vars || {});
        }
      } catch (e) { console.error('liveroom: the read', e); }
      if (L.run === 'learn') L.run = 'idle';
    }
    function notThatOne() {
      const P = S.pass;
      if (!P) return { ok: false };
      S.pass = null;
      releasePreview();
      Promise.resolve(deck.stop({ at: 'now', keep: 'capture' })).catch(() => {});
      L.run = 'idle';
      tbHold(false);
      S.kept = P;
      // (A's line for it, take.esc, when the deck's lines are in; the stage's own until then)
      if (!say('take.esc')) say('pass.capture');
      return { ok: true };
    }
    async function keepAfterAll() {
      const P = S.kept;
      if (!P) return { ok: false, error: 'Nothing to keep.' };
      S.kept = null;
      let r;
      try { r = await deck.keepAfterAll(); } catch (e) { return err(e); }
      if (!r || r.ok === false) return r || { ok: false };
      S.pass = { ...P, landed: false };
      landed(r);
      return { ok: true };
    }

    /* --------------------------------------------------------------------------------------------- hearing it */
    function hearFrom(top) {
      const e = eng();
      if (!e) return { ok: false };
      const c = top ? null : card();
      const from = c && !c.end ? c.start : 0;
      S.top = !c || from === 0;
      S.from = from;
      S.ended = false;
      S.seen = null;
      L.run = 'play';
      try { e.play(from); } catch (x) { L.run = 'idle'; return err(x); }
      return { ok: true };
    }
    function stopPlay(done = false) {
      const e = eng();
      if (e?.playing) { try { e.stop(); } catch { /* fine */ } }
      if (L.run === 'play') L.run = 'idle';
      if (done && S.top) {
        const v = view();
        const secs = (e?.beatToSec?.(e.songEnd?.() ?? 0)) ?? 0;
        heardOf.set(songKey(song()), v.shape);
        const empty = v.parts.find((c) => c.empty);
        if (empty) say('hear.empty', { time: clock(secs), part: empty.name });
        else say('hear.done', { parts: v.parts.length, time: clock(secs) });
      }
      return { ok: true };
    }

    /* --------------------------------------------------------------------------------------------- the menu's moves */
    function menuAt(anchor) {
      const c = card();
      if (!c) return { ok: false, error: 'Pick a part first.' };
      if (S.menu?.open) { S.menu.close(); }
      const v = view();
      const items = menuItems(v, c, { feels: feelsOf(v.place, c.part, v.tempo) || [] });
      const a = anchor || setlist.el.querySelector(`[data-card="${CSS.escape(c.id)}"] .lr-card-main, [data-card="${CSS.escape(c.id)}"]`);
      L.menu = c.id;
      S.menu = openMenu({
        host: room || el, anchor: a, title: c.name, items,
        onPick: (it) => { press(it.id === 'name' ? `name:${it.arg ?? ''}` : it.id === 'shorter' ? `shorter:${it.arg}` : it.id); },
        onClose: () => { L.menu = null; S.menu = null; },
      });
      return { ok: true };
    }
    function step(plan, { by = 'you', line = null, vars = {} } = {}) {
      if (!plan?.ops?.length) return { ok: false, error: 'Nothing to change there.' };
      const r = runPlan(store, plan, { by });
      if (!r.ok) return r;
      if (line) say(line, vars);
      return { ok: true };
    }
    function nameIt(name) {
      const c = card();
      if (!c || c.end) return { ok: false };
      if (!name) { askName(c); return { ok: true }; }
      if (name === c.name) return { ok: true };
      const r = dispatch({ type: 'section.set', section: c.id, patch: { name } }, { by: 'you', label: `Named it ${name}` });
      return r.ok ? { ok: true } : r;
    }
    function askName(c) {
      S.nameBox?.remove();
      const input = h('input.lr-namefield', { type: 'text', value: c.name, maxlength: 40, 'aria-label': `A name for the ${low(c.name)}`, autocomplete: 'off' });
      const form = h('form.lr-namebox', { onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); form.remove(); S.nameBox = null; if (v) nameIt(v); } }, input);
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); form.remove(); S.nameBox = null; } });
      input.addEventListener('blur', () => setTimeout(() => { if (S.nameBox === form) { form.remove(); S.nameBox = null; } }, 0));
      setlist.el.append(form);
      S.nameBox = form;
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }
    function feel(kind) {
      const v = view(), c = card();
      if (!c || c.end) return { ok: false, error: 'Pick a part first.' };
      const edited = c.band.filter((b) => !b.house);
      if (edited.length && S.feelAsk !== c.id) {
        S.feelAsk = c.id;
        ctx.say('glass.drums.edited', { part: c.name, track: 'drums' });
        return { ok: true, asked: true };
      }
      S.feelAsk = null;
      const part = c.part || {};
      const patch = { feel: part.feel || null, busy: part.busy || 0, loud: part.loud || 0 };
      if (kind === 'feel') {
        const feels = feelsOf(v.place, part, v.tempo) || [];
        if (!feels.length) return { ok: false, error: 'The drummer has no other feel for this part here.' };
        const i = feels.indexOf(part.feel);
        patch.feel = feels[(i + 1) % feels.length];
      } else if (kind === 'simpler' || kind === 'busier') patch.busy = Math.max(-1, Math.min(1, patch.busy + (kind === 'busier' ? 1 : -1)));
      else patch.loud = Math.max(-1, Math.min(1, patch.loud + (kind === 'louder' ? 1 : -1)));
      const plan = planFeel(song(), { section: c.id, ...patch });
      if (!plan?.ops?.length) {
        // (the band's feel, before stream B's band: the part's own data alone, one step)
        const pp = {};
        if (kind === 'feel' && patch.feel) pp.feel = patch.feel;
        if (kind === 'simpler' || kind === 'busier') pp.busy = patch.busy;
        if (kind === 'softer' || kind === 'louder') pp.loud = patch.loud;
        if (!Object.keys(pp).length) return { ok: false, error: 'Nothing to change there.' };
        const r = dispatch({ type: 'room.part.set', section: c.id, patch: pp }, { by: 'you', label: `${c.name}: ${kind === 'feel' ? NAMES.feel[patch.feel] || patch.feel : kind}`, reason: `room:feel:${c.id}` });
        if (!r.ok) return r;
      } else {
        const r = runPlan(store, plan, { by: 'you' });
        if (!r.ok) return r;
      }
      // (the band's lines are stream B's, lines/double.js: feel.named, busy.*, loud.*) // needs B
      const fname = NAMES.feel[patch.feel] || patch.feel;
      if (kind === 'feel') say('feel.named', { feel: fname, name: fname, part: c.name });
      else if (kind === 'simpler' || kind === 'busier') { if (patch.busy) say(patch.busy < 0 ? 'busy.simpler' : 'busy.busier', { part: c.name, step: patch.busy }); }
      else if (patch.loud) say(patch.loud < 0 ? 'loud.softer' : 'loud.louder', { part: c.name, step: patch.loud });
      return { ok: true };
    }
    function pickTake(dir) {
      const v = view(), c = card();
      if (!c || c.end) return { ok: false };
      const role = L.side === 'R' ? 'guitarR' : roleFor(v, c, 'again');
      const t = song().tracks.find((x) => x.id === v.roles[role]);
      if (!t) return { ok: false };
      const ids = L.side === 'R' ? c.takes.R : c.takes.L.length ? c.takes.L : c.takes.lead;
      if (ids.length < 2) { say('take.one', { part: c.name }); return { ok: false, error: 'one take' }; }
      // (in the order they were played: the track's own order)
      const order = t.clips.filter((x) => ids.includes(x.id));
      const cur = order.findIndex((x) => !x.mute);
      const j = cur + (dir > 0 ? 1 : -1);
      if (j < 0 || j >= order.length) { say('take.edge', { part: c.name, take: cur + 1, first: dir < 0 }); return { ok: false }; }
      const ops = [];
      for (const x of order) if (!x.mute && x !== order[j]) ops.push({ type: 'clip.set', track: t.id, clip: x.id, patch: { mute: true } });
      ops.push({ type: 'clip.set', track: t.id, clip: order[j].id, patch: { mute: false } });
      const r = dispatch(ops, { by: 'you', label: `${c.name}: take ${j + 1}`, reason: `room:takepick:${c.id}` });
      if (!r.ok) return r;
      say('take.pick', { part: c.name, take: j + 1 });
      return { ok: true };
    }
    function tempo(d) {
      const v = view();
      if (v.taken) return { ok: false, error: 'The tempo’s set once there’s a take.' };
      const [lo, hi] = placeOf(v.place).tempo || [40, 300];
      const bpm = Math.max(lo, Math.min(hi, Math.round((v.tempo || 120) + d)));
      if (bpm === v.tempo) return { ok: true };
      const r = dispatch({ type: 'project.set', patch: { tempo: bpm } }, { by: 'you', label: `Tempo ${bpm}`, coalesce: 'room:tempo' });
      if (r.ok) ctx.say('before.tempo', { bpm });
      return r.ok ? { ok: true } : r;
    }
    function tap() {
      const now = performance.now();
      S.taps = [...S.taps.filter((t) => now - t < 2500), now].slice(-4);
      if (S.taps.length < 4) return { ok: true };
      const iv = S.taps.slice(1).map((t, i) => t - S.taps[i]);
      const m = iv.reduce((a, b) => a + b, 0) / iv.length;
      if (iv.some((x) => Math.abs(x - m) / m > 0.08)) { S.taps = []; return { ok: true }; }
      S.taps = [];
      return tempo(60000 / m - (view().tempo || 120));
    }
    function rig(dir) {
      const v = view(), rigs = placeOf(v.place).rigs || [];
      if (!rigs.length || v.place === 'kitchen') return { ok: false };
      const i = Math.max(0, rigs.indexOf(v.rig));
      const r2 = rigs[(i + dir + rigs.length) % rigs.length];
      const r = dispatch({ type: 'room.set', patch: { rig: r2 } }, { by: 'you', label: rigLabel(r2), coalesce: 'room:rig' });
      return r.ok ? { ok: true } : r;
    }
    function selectCard(which) {
      const v = view();
      const list = v.cards;
      if (!list.length) return { ok: false };
      const i = list.findIndex((c) => c.id === L.card);
      let j = i;
      if (which === 'prev') j = i < 0 ? 0 : Math.max(0, i - 1);
      else if (which === 'next') j = i < 0 ? 0 : Math.min(list.length - 1, i + 1);
      else if (which === 'first') j = 0;
      else if (which === 'last') j = list.length - 1;
      else j = list.findIndex((c) => c.id === which);
      if (j < 0) return { ok: false };
      L.card = list[j].id;
      return { ok: true };
    }

    /* --------------------------------------------------------------------------------------------- press */
    function press(id, anchor = null) {
      const v = view();
      const s = String(id || '');
      if (s === 'space') {
        const o = offer();
        if (!o) return { ok: false, error: 'Nothing to do here yet.' };
        return press(o.id === 'play' ? `play:${o.card}` : o.id === 'other' ? `other:${o.card}` : o.id);
      }
      if (s.startsWith('card:')) return selectCard(s.slice(5));
      if (s.startsWith('name:')) return nameIt(s.slice(5));
      if (s.startsWith('shorter:')) { const c = card(); const bars = Number(s.slice(8)); const pl = c && planShorter(song(), { section: c.id, bars }); return step(pl, { line: 'shorter', vars: { part: c?.name, bars } }); }
      if (s.startsWith('tempo:')) return tempo(Number(s.slice(6)) || 0);
      if (s.startsWith('play:')) return pass('again', s.slice(5));
      if (s.startsWith('other:')) return press('other', s.slice(6));
      switch (s) {
        case 'count': case 'next': return v.place ? pass('new') : { ok: false };
        case 'take': return L.run === 'count' || L.run === 'take' ? stopPass() : { ok: false };
        case 'stop': return L.run === 'play' ? stopPlay(false) : L.run === 'count' || L.run === 'take' ? stopPass() : { ok: false };
        case 'esc':
          if (S.menu?.open) { S.menu.close(); return { ok: true }; }
          if (L.run === 'count' || L.run === 'take') return notThatOne();
          if (L.run === 'play') return stopPlay(false);
          return { ok: true };
        case 'keep': return keepAfterAll();
        case 'again': {
          if (L.run === 'count' || L.run === 'take') return stopPass();
          const c = card() || v.parts.find((x) => x.id === S.last);
          if (!c) return v.taken ? { ok: false, error: 'Pick a part first.' } : pass('new');
          if (c.end) { ctx.say('end.follows'); return { ok: true }; }
          return pass('again', c.id);
        }
        case 'play': { const c = v.parts.find((x) => x.empty); return c ? pass('again', c.id) : { ok: false }; }
        case 'punch': { const d = S.drift; if (!d) return { ok: false }; S.drift = null; L.side = 'R'; return pass('punch', d.card, { bar: d.bar }); }
        case 'other': {
          if (v.place === 'bluesbar' || v.place === 'kitchen') return { ok: false, error: 'This room has no other side.' };
          const c = (typeof anchor === 'string' ? v.cards.find((x) => x.id === anchor) : null) || card() || v.parts.find((x) => x.id === S.last);
          if (!c || c.empty || c.end) return { ok: false, error: 'Play the part first.' };
          if (v.place === 'basement') { try { prefs.mark(song(), 'basement.other'); } catch { /* fine */ } }
          const d = planDouble(song(), { section: c.id });
          if (d?.ops?.length) { const r = runPlan(store, d, { by: 'overdub' }); if (!r.ok) return r; }
          if (!say('side.now')) say('other.now');
          L.side = 'R';
          return pass('other', c.id);
        }
        case 'layout': {
          const pl = planLayout(song());
          try { prefs.mark(song(), 'layout.answered'); } catch { /* fine */ }
          if (!pl?.ops?.length) return { ok: false, error: 'Two parts first.' };
          const r = runPlan(store, pl, { by: 'overdub' });
          if (!r.ok) return r;
          say('layout.in', { bars: pl.bars, time: pl.time || clock(pl.secs), empty: pl.empty || null });
          L.card = view().parts[0]?.id || null;
          return { ok: true };
        }
        case 'notyet': try { prefs.mark(song(), 'layout.answered'); } catch { /* fine */ } return { ok: true };
        case 'hear': case 'home': return L.run === 'play' ? stopPlay(false) : busy() ? { ok: false } : hearFrom(true);
        case 'from': return L.run === 'play' ? stopPlay(false) : busy() ? { ok: false } : hearFrom(false);
        case 'feel': case 'simpler': case 'busier': case 'softer': case 'louder': return feel(s);
        case 'twice': { const c = card(); if (!c || c.end) return { ok: false }; const pl = planTwice(song(), { section: c.id }); return step(pl, { line: 'twice.in', vars: { part: c.name, bars: (c.bars || 0) * 2 } }); }
        case 'loop': {
          const c = card();
          if (!c || c.end) return { ok: false };
          const r = dispatch({ type: 'project.set', patch: { loop: { on: true, start: c.start, end: c.start + c.length } } }, { by: 'you', label: `Round and round on the ${low(c.name)}`, reason: `room:loop:${c.id}` });
          if (r.ok) say('loop.on', { part: c.name });
          return r.ok ? { ok: true } : r;
        }
        case 'earlier': case 'later': {
          const c = card();
          const i = v.parts.findIndex((x) => x.id === c?.id);
          if (i < 0) return { ok: false };
          const before = s === 'earlier' ? v.parts[i - 1]?.id : v.parts[i + 2]?.id ?? null;
          if (s === 'earlier' && !before) return { ok: false, error: 'It’s the first part.' };
          if (s === 'later' && i >= v.parts.length - 1) return { ok: false, error: 'It’s the last part.' };
          const pl = planMove(song(), { section: c.id, before });
          return step(pl, { line: 'moved', vars: { part: c.name, where: pl.where } });
        }
        case 'remove': {
          const c = card();
          if (!c || c.end) return { ok: false };
          const pl = planRemove(song(), { section: c.id });
          const r = step(pl, { line: 'removed', vars: { part: c.name, bars: c.bars } });
          if (r.ok) L.card = view().parts.at(-1)?.id || null;
          return r;
        }
        case 'bassYours': {
          const c = card();
          if (!c) return { ok: false };
          const pl = planBassYours(song(), { section: c.id });
          if (pl?.ops?.length) return step(pl, { line: 'bass.yours' });
          say('bass.yours');
          return { ok: true };
        }
        case 'take:up': return pickTake(-1);
        case 'take:down': return pickTake(1);
        case 'menu': return menuAt(anchor);
        case 'tap': return tap();
        case 'rig:next': return rig(1);
        case 'rig:prev': return rig(-1);
        case 'tune': { try { deck.tuner(); } catch { /* fine */ } return { ok: true }; }
        case 'ask': return { ok: !!app.liveRoom && askAgent() };
        case 'shelf': try { app.liveRoom.open({ screen: 'shelf' }); } catch { /* fine */ } return { ok: true };
        case 'send': try { app.liveRoom.open({ screen: 'send' }); } catch { /* fine */ } return { ok: true };
        default: return false;
      }
    }
    const askAgent = () => { const t = room?.__lrTalkback; return t?.ask ? t.ask() : false; };
    const tbHold = (on) => { const t = room?.__lrTalkback; if (t?.hold) t.hold(on); };

    /* --------------------------------------------------------------------------------------------- keys */
    const here = () => L.open && L.screen === 'stage' && !S.nameBox;
    const noMenu = () => here() && !S.menu?.open;
    const K = [];
    const key = (k, mod, run, label, when = noMenu) => K.push(ui.keys.add({ key: k, mod, run: () => run(), when, label, group: 'Live room', first: true }));
    key('Space', null, () => press(L.run === 'play' ? 'stop' : 'space'), 'The offered move: count me in, that’s a take, the other side, next part');
    key('PageDown', null, () => press(L.run === 'play' ? 'stop' : 'space'), 'A page-turner pedal: the offered move');
    key('KeyR', null, () => press('again'), 'Again on the selected part (while recording: stop at the bar line)');
    key('PageUp', null, () => press('again'), 'A page-turner pedal: Again');
    key('Enter', null, () => press(S.homed ? (S.homed = false, 'home') : 'from'), 'Hear it from the selected card');
    key('Escape', null, () => press('esc'), 'Not that one (during a take); stop');
    key('KeyR', 'shift', () => press('keep'), 'Keep it after all');
    key('ArrowLeft', null, () => (view().taken ? press('card:prev') : press('tempo:-2')), 'Before the first take: slower. After: the card before');
    key('ArrowRight', null, () => (view().taken ? press('card:next') : press('tempo:+2')), 'Before the first take: faster. After: the next card');
    key('ArrowLeft', 'shift', () => press('tempo:-10'), 'Ten BPM slower, before the first take');
    key('ArrowRight', 'shift', () => press('tempo:+10'), 'Ten BPM faster, before the first take');
    key('Home', null, () => { S.homed = true; return press('card:first'); }, 'The first card (then Enter: from the top)');
    key('End', null, () => press('card:last'), 'The last card');
    key('ArrowUp', null, () => press('take:up'), 'The selected part’s take before');
    key('ArrowDown', null, () => press('take:down'), 'The selected part’s next take');
    key('ArrowLeft', 'alt', () => press('earlier'), 'Move the selected part earlier');
    key('ArrowRight', 'alt', () => press('later'), 'Move the selected part later');
    key('KeyN', null, () => press('next'), 'Next part');
    key('KeyD', null, () => press('other'), 'The other side, on the selected part');
    key('KeyF', null, () => press('feel'), 'Another feel for the selected part');
    key('KeyX', null, () => press('twice'), '×2');
    key('KeyL', null, () => press('loop'), 'Round and round on the selected part');
    key('Backspace', null, () => press('remove'), 'Remove the selected part (⌘Z brings it back)');
    key('Delete', null, () => press('remove'), 'Remove the selected part');
    key('KeyT', null, () => press('tap'), 'Four taps set the tempo, before the first take');
    key('BracketLeft', null, () => press('rig:prev'), 'The amp’s setting before');
    key('BracketRight', null, () => press('rig:next'), 'The amp’s next setting');
    key('KeyU', null, () => press('tune'), 'The tuner');
    key('Slash', null, () => press('ask'), 'Talk to Claude, in the talkback');
    // a sustain pedal (CC 64, the input layer's 'expr' event: { sustain }) is Space while no instrument track is armed
    const onExpr = (e) => {
      if (!e || typeof e.sustain !== 'boolean') return;
      if (!e.sustain) { S.pedal = false; return; }
      if (S.pedal || !here()) return;
      S.pedal = true;
      if (song().tracks.some((t) => t.arm && t.kind !== 'audio')) return;
      press(L.run === 'play' ? 'stop' : 'space');
    };
    try { const o = app.input?.on?.('expr', onExpr); if (typeof o === 'function') offs.push(o); } catch { /* no input layer */ }

    // the screen stays awake while the room is open
    let lock = null;
    const wake = async () => { try { if (document.visibilityState === 'visible' && navigator.wakeLock && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); } } catch { lock = null; } };
    const onVis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVis);
    wake();

    // the console ledge along the scene's bottom is the glass (§3.15)
    let win = { x: 0, y: 0, w: W, h: H }, winTo = null, winFrom = null, winAt = 0;
    sceneCv.addEventListener('click', (e) => {
      const r = sceneCv.getBoundingClientRect();
      const y = win.y + ((e.clientY - r.top) / r.height) * win.h;
      if (y >= H - LEDGE) app.liveRoom?.press?.('glass');
    });

    // the first line: where you are, and the tempo before the first take
    {
      const v = view();
      if (v.place && !v.taken) ctx.say('before.tempo', { bpm: Math.round(v.tempo || 120) });
    }

    /* --------------------------------------------------------------------------------------------- the frame */
    let lastLayout = '';
    // (on a phone, a 192 x 108 window of the room at the most: around the middle of the one pixels/windowFor gives)
    const phoneWindow = (v) => {
      const w0 = windowFor(v) || { x: 0, y: 0, w: W, h: H };
      const w = Math.min(w0.w, 192), hh = Math.min(w0.h, 108);
      return { x: Math.round(w0.x + (w0.w - w) / 2), y: Math.round(w0.y + (w0.h - hh) / 2), w, h: hh };
    };
    function layout(v) {
      const vw = innerWidth, vh = innerHeight;
      const phone = vw < 700;
      const ww = phone ? winTo || phoneWindow(v) : { x: 0, y: 0, w: W, h: H };
      const k = phone ? fitScale(vw, vh * 0.4, ww.w, ww.h) : fitScale(Math.max(200, vw - 2 * Math.min(32, Math.max(16, vw * 0.024)) - 24 - 260), Math.max(150, vh - 48 - 64 - 120), W, H);
      const key = `${vw}x${vh}:${k}:${ww.w}x${ww.h}:${phone}`;
      if (key === lastLayout) return;
      lastLayout = key;
      stage.classList.toggle('lr-phone', phone);
      const w = phone ? ww.w : W, hh = phone ? ww.h : H;
      sceneCv.width = w; sceneCv.height = hh;
      sceneCv.style.width = `${w * k}px`;
      sceneCv.style.height = `${hh * k}px`;
    }
    function panTo(target, now, reduced) {
      if (!winTo || target.x !== winTo.x || target.y !== winTo.y || target.w !== winTo.w || target.h !== winTo.h) {
        winFrom = { ...win };
        winTo = { ...target };
        winAt = now;
      }
      const t = reduced ? 1 : Math.min(1, (now - winAt) / PAN_MS);
      win = { x: Math.round(winFrom.x + (winTo.x - winFrom.x) * t), y: Math.round(winFrom.y + (winTo.y - winFrom.y) * t), w: winTo.w, h: winTo.h };
    }
    function frame(now) {
      const lv = liveView(ctx);
      layout(lv);
      // the scene: drawn whole, the window cut out of it in whole pixels
      const phone = stage.classList.contains('lr-phone');
      panTo(phone ? phoneWindow(lv) : { x: 0, y: 0, w: W, h: H }, now, lv.reduced);
      try {
        const sc = ctx.scene;
        if (offG) sc.draw(offG, lv, lv.reduced ? 0 : now);
        const g = sceneCv.getContext('2d');
        if (g) { g.imageSmoothingEnabled = false; g.clearRect(0, 0, sceneCv.width, sceneCv.height); g.drawImage(/** @type {any} */ (off), win.x, win.y, win.w, win.h, 0, 0, sceneCv.width, sceneCv.height); }
      } catch (e) { console.error('liveroom: the scene', e); }
      // the run, the deck's and the engine's
      if (L.run === 'play') {
        const e = eng();
        const end = e?.songEnd?.() ?? Infinity;
        if (e?.playing && Number.isFinite(e.beat)) S.seen = e.beat;
        // (stopped from somewhere else, ⇧Esc or the agent: heard to the end only if it got to the last bar)
        if (!e?.playing && !e?.starting) stopPlay(Number.isFinite(S.seen) && S.seen >= end - (lv.bpb || 4) - EPS);
        else if (e?.beat >= end - EPS) stopPlay(true);
      }
      stage.dataset.run = L.run === 'count' || L.run === 'take' ? 'take' : L.run;
      // the readout
      where.textContent = title(lv.place);
      readTempo.textContent = `${Math.round(lv.tempo || 0)} BPM`;
      const tw = tuningWords(lv.tuning);
      readTune.textContent = tw ? ` · ${tw}` : '';
      readKey.textContent = lv.key?.root ? ` · ${lv.key.root} ${lv.key.scale}` : '';
      counter.textContent = (L.run === 'take' || L.run === 'count') && lv.bar ? ` · BAR ${Math.max(1, lv.bar - Math.floor((S.pass?.from || 0) / (lv.bpb || 4)))}` : '';
      rigRow.hidden = !lv.place || lv.place === 'kitchen';
      rigName.textContent = lv.rig ? rigLabel(lv.rig) : '';
      tVal.textContent = String(Math.round(lv.tempo || 0));
      steppers.hidden = !!lv.taken;
      // the offered move, and what's beside it
      const o = offered(lv, runState());
      primary.hidden = !o;
      if (o) {
        primary.querySelector('.lr-pl').textContent = o.label;
        primary.querySelector('.lr-kbd').textContent = o.key || 'Space';
        primary.dataset.move = o.id;
      }
      notYet.hidden = o?.id !== 'layout';
      if (o?.id === 'layout' && !S.offerSaid) {
        S.offerSaid = true;
        try { const pl = planLayout(song()); if (pl?.ops?.length) ctx.say('layout.offer', { form: pl.form, bars: pl.bars, time: pl.time || clock(pl.secs) }); } catch (e) { console.error('liveroom: the form', e); }
      }
      again.hidden = !lv.taken || o?.id === 'take' || o?.id === 'stop';
      next.hidden = !lv.taken || o?.id === 'next' || o?.id === 'take' || o?.id === 'stop';
      hear.hidden = !lv.taken || o?.id === 'hear' || o?.id === 'take' || o?.id === 'stop';
      more.hidden = !phone || !lv.taken;
      // the setlist and its playhead
      const e = eng();
      const beat = e?.playing ? e.beat : null;
      const playing = beat == null ? null : lv.cards.find((c) => beat >= c.start - EPS && beat < c.start + c.length)?.id || null;
      if (L.card && !lv.cards.some((c) => c.id === L.card)) L.card = null;
      setlist.update(lv, { card: L.card, playing });
      if (playing) { const c = lv.cards.find((x) => x.id === playing); setlist.head(playing, (beat - c.start) / c.length); } else setlist.head(null, 0);
      try { lamps.frame(now); } catch (e2) { console.error('liveroom: the lamps', e2); }
    }

    return {
      frame,
      press: (id) => press(id),
      unmount() {
        // through the glass mid-pass: Not that one (the pass is in Capture); a playback plays on, as the transport was
        if (L.run === 'count' || L.run === 'take') notThatOne();
        if (L.run === 'play') L.run = 'idle';
        for (const k of K) k();
        for (const o of offs) { try { o(); } catch { /* fine */ } }
        document.removeEventListener('visibilitychange', onVis);
        try { lock?.release?.(); } catch { /* fine */ }
        lock = null;
        releasePreview();
        S.menu?.close?.();
        try { lamps.unmount(); } catch { /* fine */ }
        setlist.unmount();
        if (tb && room && tb.parentNode === tbSlot) room.append(tb);
        el.replaceChildren();
      },
    };
  },
});

