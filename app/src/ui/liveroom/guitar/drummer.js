// The drummer [ui; the guitar room's DRUMMER stream] (docs/research/GUITAR-ROOM.md §2.2, §2.7, §2.8; design/mock/
// guitar-room-2/ shots 02a, 02b and 03d; AJ: "a simple, metronome-like guide beat by default, easy to swap", "a deeper
// groove library from there, with the main-screen few editable", "no bass by default", "nothing added unasked").
//
// What's on the riser (R.el.stage.riser, world units: core/liveroom/guitar/layout.js REGIONS.kit and .riser):
//   - the kit, in its own pixels (./drummer-kit.js): the hits move it, the sticks count you in;
//   - the drummer's plate: DRUMMER (Space: the jam on and off), the tempo (← →, ⇧ for tens; T taps it), the bar the
//     drummer's on, the beat's name;
//   - the beat cards (the song's room.pins, the riser holds RISER_MAX): a click, [ ], picks one (room.set { beat } by
//     you; with the part line up and a part selected, that part's drums too: beats.js beatOps, the same step);
//   - the book's ribbon (K, or the kit): the camera to the kit and the book (./drummer-book.js) in R.panel('kit').
// The jam (./drummer-jam.js): the room's beat (or a groove from the book, played now and nothing changed in the song)
// from the song's end on, heard through store.preview a bar at a time, never kept; R.run('jam') while it plays. The
// count-in into a take is the deck's (R.deck.countIn, the sticks' voice), with the drummer filling the bars the song has
// no drums in from the part's 1 on, until the transport stops.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'drummer', 'tempo:<±n>', 'tap', 'beat:prev', 'beat:next', 'beat:<n>',
//                                             'countin'
//     back() -> bool                          Esc: nothing of the drummer's (the camera steps back out of the book; Space
//                                             stops the jam, Esc never does)
//     frame(now), unmount()
//     playing() -> bool                       the jam is on
//     stop() -> void                          stop the jam (the takes stream calls it before a count-in), and let go of
//                                             the bars the drummer was filling under a take
//     countIn({ bars, bpm, at, from?, beat? }) -> Promise<{ ok, from, beats, startT, downbeat } | { ok: false, error }>
//         the drummer counts you in on the deck (R.deck.countIn: the sticks; bars: the count's, default one, two at 160
//         and up; at: the audio-clock time of its first beat), then plays the bars the song has no drums in from `from`
//         (the part's 1; default the song's end) with `beat` (default the part's there, else the room's) until the
//         transport stops or stop(). With the count-in off (R.gprefs countIn, ⇧K) the transport starts at `from` at
//         once. It resolves once the count is on the audio clock (the downbeat's time in the result), well before the
//         downbeat itself, so the take armed straight after (R.deck.take) records from the 1. bpm is the song's tempo
//         (the song's is what plays; it isn't set here). counted: true (the takes stream's call) means the count is
//         already the deck's, started by whoever called: the drummer only plays under the take (no second count) and
//         resolves at once with { ok, from }. sounded: the engine is sounding the sticks (the riser shows the count).
//   }
// Bus: 'drummer:jam' { on, beat, kind }.

import { h, css } from '../../dom.js';
import { beatsPerBar } from '../../../core/music.js';
import { roomOf } from '../../../core/liveroom/model.js';
import { BEAT_RE, GUIDE_ID, beatOf, beatOps, grooveOfBeat, pinOps } from '../../../core/liveroom/guitar/beats.js';
import { RISER_MAX, miniOf, stepped, riserOf, shortName, nextPinId, planTempo, tapTempo, STEPS } from '../../../core/liveroom/guitar/beats-grid.js';
import { REGIONS } from './layout.js';
import { CSS } from './drummer-style.js';
import { LINES } from '../../../core/liveroom/lines/drummer.js';
import { createJam } from './drummer-jam.js';
import { createKit, hitsAt } from './drummer-kit.js';
import { createBook } from './drummer-book.js';

const EPS = 1e-6;
const MINE = /^(drummer|tap|countin|tempo:[+-]?\d{1,3}|beat:(prev|next|[1-9]))$/;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const reduced = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; } };

export function mount(R) {
  css('gr-drummer', CSS);
  const { store } = R;
  const layer = R.el.stage.riser;
  const engine = () => R.app.engine || null;
  const song = () => store.get();
  const bpb = () => beatsPerBar(song().meter || [4, 4]);
  const jam = createJam({ store, engine, bpb });
  const offs = [];
  Object.assign(R.gr.jam, { on: false, release: null, kind: null, beat: null, audition: null });
  // the drummer's lines (core/liveroom/lines/drummer.js), the house's, unsigned, in the talkback (R.say: the live room's
  // own line table, ui/liveroom/index.js, doesn't carry this file's)
  const line = (id, vars = {}) => {
    const l = Object.hasOwn(LINES, id) ? LINES[id] : null;
    let text = '';
    try { text = l ? String(l.text(vars) ?? '') : ''; } catch (e) { console.error('drummer line', id, e); }
    if (text) R.say(text, { by: 'overdub' });
    return !!text;
  };
  const said = (id) => { const k = `drummer:${id}`; if (R.gr.said[k]) return true; R.gr.said[k] = true; return false; };

  /* ------------------------------------------------------------------------------------------- the kit and the riser */
  const kitV = createKit(layer);
  const RZ = REGIONS.riser;
  const at = (el, x, y, w, hh) => { Object.assign(el.style, { position: 'absolute', left: x + 'px', top: y + 'px', ...(w ? { width: w + 'px' } : {}), ...(hh ? { height: hh + 'px' } : {}) }); return el; };
  const bpmEl = h('b', '');
  const barEl = h('span.grd-bar', 'BAR –');
  const beatEl = h('span.grd-beat', '');
  const tapEl = h('button.grd-tap', { type: 'button', 'aria-label': 'Tap the tempo (T)', onclick: () => R.press('tap') }, 'TAP', h('kbd', 'T'));
  const plate = at(h('div.grd-plate', { role: 'group', 'aria-label': 'The drummer' },
    // (Space's press, so it stops a take or the song as the key does; in a take's review, where Space hears the take,
    // the drummer's own)
    h('button.grd-go', { type: 'button', 'aria-label': 'The drummer: start or stop (Space)', onclick: () => R.press(R.gr.overlay === 'review' ? 'drummer' : 'space') }, h('i'), 'DRUMMER', h('kbd', 'Space')),
    h('div.grd-tempo', h('button', { type: 'button', 'aria-label': 'Slower (←)', onclick: () => R.press('tempo:-1') }, '←'), bpmEl, h('button', { type: 'button', 'aria-label': 'Faster (→)', onclick: () => R.press('tempo:+1') }, '→'), h('small', 'BPM'), barEl),
    h('div.grd-low', beatEl, tapEl)), RZ.x + 8, RZ.y + 8, 176, 84);
  const cardsEl = h('div.grd-cards');
  const ribbon = at(h('button.grd-ribbon', { type: 'button', 'aria-label': 'The drummer’s book (K)', onclick: () => R.press('cam:kit') }, 'The book', h('kbd', 'K')), RZ.x + RZ.w - 100, RZ.y - 28);
  layer.append(plate, cardsEl, ribbon);
  // (a click with the mouse doesn't leave a button holding the focus: Enter after it is the room's, not the card's
  // again; Tab still reaches every one)
  const noFocus = (e) => { if (e.button === 0 && e.target?.closest?.('button')) { e.preventDefault(); document.activeElement?.blur?.(); } };
  layer.addEventListener('mousedown', noFocus);
  offs.push(() => layer.removeEventListener('mousedown', noFocus));

  /* ------------------------------------------------------------------------------------------- what's on the riser now */
  const riser = () => riserOf(song());
  const roomBeat = () => beatOf(song());
  // the card a beat is: its own pin, or an unedited card of the same groove
  const cardOf = (beat, list = riser()) => (typeof beat !== 'string' ? null : beat.startsWith('pin:') ? list.find((c) => `pin:${c.id}` === beat) || null : list.find((c) => c.groove === beat && !c.edited) || null);
  const nameOf = (beat) => {
    const c = cardOf(beat);
    if (c) return c.name;
    const g = grooveOfBeat(song(), beat);
    return beat === GUIDE_ID ? 'Guide' : g?.name || 'The beat';
  };
  const longName = (beat) => {
    const c = cardOf(beat);
    if (c) return c.groove === GUIDE_ID ? 'Guide beat' : `${c.label}${c.edited ? ' (yours)' : ''}`;
    return beat === GUIDE_ID ? 'Guide beat' : grooveOfBeat(song(), beat)?.name || '';
  };
  const jamBeat = () => R.gr.jam.audition || roomBeat();
  const drumsTrack = () => { const p = song(), id = roomOf(p)?.tracks?.drums; return id ? p.tracks.find((t) => t.id === id) || null : null; };
  // where a jam starts: the bar after everything in the song (and past the loop, which would wrap the drummer back)
  function jamFrom(p = song()) {
    const B = beatsPerBar(p.meter || [4, 4]);
    let end = 0;
    for (const s of p.sections || []) end = Math.max(end, s.start + s.length);
    for (const t of p.tracks || []) for (const c of t.clips || []) if (!(c.name === 'Jam' && c.by === 'overdub')) end = Math.max(end, c.start + c.length);
    if (p.loop?.on && Number.isFinite(p.loop.end)) end = Math.max(end, p.loop.end);
    return Math.ceil(end / B - EPS) * B;
  }
  const sync = () => { Object.assign(R.gr.jam, { on: jam.state.on, kind: jam.state.kind, beat: jam.state.beat, release: jam.state.on ? () => stop() : null }); };

  /* ------------------------------------------------------------------------------------------- the cards */
  let cardsKey = '';
  function drawCards(force = false) {
    const list = riser(), now = jam.state.on ? jam.state.beat : roomBeat(), sel = R.gr.jam.audition ? null : cardOf(now, list);
    const next = jam.state.on ? pendingCard(list) : null;
    const key = JSON.stringify([list.map((c) => [c.id, c.name, c.edited, c.groove, c.edited ? c.g?.hits?.length : 0]), sel?.id, next?.id]);
    if (!force && key === cardsKey) return;
    cardsKey = key;
    const x0 = RZ.x + 192, y0 = RZ.y + 8, cw = 60, gap = 6;
    const els = list.slice(0, RISER_MAX).map((c, i) => {
      const m = c.g ? miniOf(c.g) : { top: Array(STEPS).fill(0), snare: Array(STEPS).fill(0), kick: Array(STEPS).fill(0) };
      const kind = c.edited ? 'yours' : c.groove === GUIDE_ID ? 'house' : (c.g?.part ? (c.g.part === 'half' ? 'half' : c.g.part) : '');
      return at(h('button.grd-card', {
        type: 'button', 'aria-pressed': String(sel?.id === c.id), title: `${c.groove === GUIDE_ID ? 'The room’s guide beat' : c.label}${c.edited ? ', edited' : ''}`,
        'aria-label': `Beat card ${i + 1}: ${c.name}${c.edited ? ', edited' : ''}`, dataset: { pin: c.id, next: next?.id === c.id ? '1' : '' },
        onclick: () => R.press(`beat:${i + 1}`),
      }, h('span.grd-mini', ['top', 'snare', 'kick'].map((r) => m[r].map((v) => h('i' + (v ? '.h' + v : ''))))), h('b', c.name), kind ? h('small', kind) : null), x0 + i * (cw + gap), y0, cw, 84);
    });
    if (list.length < RISER_MAX) els.push(at(h('button.grd-empty', { type: 'button', onclick: () => R.press('cam:kit') }, '+ Pin from the book'), x0 + list.length * (cw + gap), y0, cw, 84));
    cardsEl.replaceChildren(...els);
  }
  // a swap waiting for its bar: the card it will be
  function pendingCard(list) {
    const k = jam.state.bar ? jam.state.bar - 1 : 0;
    const b = jam.beatAt(k + 1) !== jam.state.beat ? jam.beatAt(k + 1) : jam.beatAt(k + 2) !== jam.state.beat ? jam.beatAt(k + 2) : null;
    return b ? cardOf(b, list) : null;
  }

  /* ------------------------------------------------------------------------------------------- the drummer's actions */
  const fail = (error) => ({ ok: false, error });
  function dispatch(ops, { label, reason, coalesce = null }) {
    const r = store.dispatch(ops, { by: 'you', label, reason, coalesce });
    // (a run of picks or turns folds into one step: it's named for the last)
    if (r.ok && r.txn && label) r.txn.label = label;
    return r;
  }
  // the part a picked beat goes under: the part line is up and a part is selected, and the drummer isn't jamming
  const partFor = () => {
    const id = R.L.card;
    return !jam.state.on && R.gr.drawer && id && (song().sections || []).some((s) => s.id === id) ? id : null;
  };
  function pick(id) {
    const list = riser(), c = list.find((x) => x.id === id);
    if (!c) return fail('There’s no card there.');
    if (R.busy()) return fail('The beat changes once the take is in.');
    const b = `pin:${c.id}`, p = song(), ops = [];
    if (roomOf(p)?.beat !== b) ops.push({ type: 'room.set', patch: { beat: b } });
    const sec = partFor();
    let label = `Beat: ${c.name}`, kept = false, part = null;
    if (sec) {
      const bo = beatOps(p, { section: sec, beat: b });
      if (!bo.error) { ops.push(...bo.ops); kept = bo.kept; part = (p.sections || []).find((s) => s.id === sec)?.name || 'part'; if (bo.label) label = bo.label; }
    }
    if (ops.length) {
      const r = dispatch(ops, { label, reason: 'room:beat', coalesce: sec ? null : 'room:beat' });
      if (!r.ok) return fail(r.error);
    }
    const was = R.gr.jam.audition;
    R.gr.jam.audition = null;
    if (jam.state.on) {
      if (jam.state.beat !== b || was) { jam.swap(b); line('drummer.next', { name: c.name }); }
    } else if (part && kept) line('drummer.kept', { part });
    else if (part) line('drummer.part', { name: c.name, part });
    else line('drummer.pick', { name: c.name, playing: false });
    sync();
    drawCards();
    R.emit('drummer:jam', { on: jam.state.on, beat: b, kind: jam.state.kind });
    return { ok: true };
  }
  function cycle(dir) {
    const list = riser().slice(0, RISER_MAX);
    if (!list.length) return fail('The riser has no cards.');
    const cur = cardOf(jam.state.on && !R.gr.jam.audition ? jam.state.beat : roomBeat(), list);
    const i = cur ? list.indexOf(cur) : dir > 0 ? -1 : 0;
    return pick(list[(i + dir + list.length) % list.length].id);
  }
  function jamOn() {
    if (R.busy()) return fail('The drummer plays with the take.');
    const run = R.run();
    if (run && run !== 'idle' && run !== 'jam') return fail('Something’s already playing.');
    if (!drumsTrack()) { line('drummer.nokit'); return fail('There’s no drums track in this song.'); }
    const b = jamBeat();
    const r = jam.start({ from: jamFrom(), beat: b, kind: 'jam', play: true });
    if (!r.ok) return r;
    R.run('jam');
    sync();
    line('drummer.on', { name: nameOf(b), bpm: Math.round(+song().tempo || 120), tape: !!R.app.input?.tape?.state?.open });
    R.emit('drummer:jam', { on: true, beat: b, kind: 'jam' });
    drawCards();
    return { ok: true };
  }
  function stop({ drop = false } = {}) {
    const kind = jam.state.kind;
    const was = jam.stop({ transport: kind === 'jam', drop });
    if (R.run() === 'jam') R.run('idle');
    sync();
    if (was) R.emit('drummer:jam', { on: false, beat: null, kind });
    return was;
  }
  function toggle() {
    if (jam.state.on && jam.state.kind === 'jam') {
      stop();
      R.gr.jam.audition = null;
      line('drummer.off');
      drawCards();
      return { ok: true };
    }
    return jamOn();
  }
  let tempoSay = 0;
  function tempo(d) {
    const p = song(), pl = planTempo(p, (+p.tempo || 120) + d);
    if (pl.error) { line('drummer.tempo.set'); return fail(pl.error); }
    if (!pl.ops.length) return { ok: true };
    const r = dispatch(pl.ops, { label: pl.label, reason: 'room:tempo', coalesce: 'room:tempo' });
    if (!r.ok) return fail(r.error);
    // (said once the arrows rest: a run of presses is one line)
    clearTimeout(tempoSay);
    tempoSay = setTimeout(() => line('drummer.tempo', { bpm: Math.round(+song().tempo || 120) }), 450);
    return { ok: true };
  }
  let taps = [], tapFlash = 0;
  function tap() {
    const now = performance.now();
    // (a run of taps: each within 2 s of the one before, so the drummer's slowest tempo can be tapped too)
    taps = [...(taps.length && now - taps[taps.length - 1] < 2000 ? taps : []), now].slice(-6);
    tapFlash = now;
    const bpm = tapTempo(taps);
    if (bpm == null) return { ok: true };
    const p = song();
    if (bpm === Math.round(+p.tempo || 120)) return { ok: true };
    const pl = planTempo(p, bpm);
    if (pl.error) { taps = []; line('drummer.tempo.set'); return fail(pl.error); }
    const r = dispatch(pl.ops, { label: pl.label, reason: 'room:tempo', coalesce: 'room:tempo' });
    if (!r.ok) return fail(r.error);
    clearTimeout(tempoSay);
    tempoSay = setTimeout(() => line('drummer.tap', { bpm: Math.round(+song().tempo || 120) }), 450);
    return { ok: true };
  }
  function countInPref() {
    const on = !R.gprefs.get().countIn;
    R.gprefs.set({ countIn: on });
    line('drummer.countin', { on });
    book.render(true);
    return { ok: true };
  }

  // the book's: the riser's cards set whole (beats.js pinOps), one step by you
  const pinsNow = () => { const p = song(); return (Array.isArray(roomOf(p)?.pins) && roomOf(p).pins.length ? roomOf(p).pins : riser().map((c) => ({ id: c.id, groove: c.groove, name: c.name }))).map((x) => ({ ...x })); };
  // (beat: the room's beat set in the same step, when pinOps doesn't move it itself)
  function setPins(pins, { coalesce = null, beat = null } = {}) {
    if (R.busy()) return fail('The riser changes once the take is in.');
    const before = roomOf(song())?.beat;
    const pl = pinOps(song(), { pins });
    if (!pl.ops.length) return { ok: true, same: true };
    if (beat && beat !== before && pl.ops[0]?.type === 'room.set' && !('beat' in pl.ops[0].patch)) pl.ops[0].patch.beat = beat;
    const r = dispatch(pl.ops, { label: pl.label, reason: pl.reason, coalesce });
    if (!r.ok) return fail(r.error);
    // (the card that was playing went: the drummer plays what it was made from)
    const after = roomOf(song())?.beat;
    if (jam.state.on && before !== after && jam.state.beat === before) jam.swap(after);
    sync();
    drawCards();
    return { ok: true };
  }
  // a new card never takes an id the song's beats still name (a part's 'pin:<id>' keeps meaning its card)
  const freshId = (pins) => {
    const p = song(), named = [...(pins || [])];
    const names = [roomOf(p)?.beat, ...Object.values(roomOf(p)?.parts || {}).map((x) => x?.beat)].filter((b) => typeof b === 'string' && b.startsWith('pin:'));
    for (const b of names) named.push({ id: b.slice(4) });
    return nextPinId(named);
  };
  // the card the room plays, when it's this one by its groove's name (the room starts on 'house/guide', the guide card's
  // groove): an edit makes it the card's own name, so what you edit is what the drummer plays
  const own = (id) => { const b = roomBeat(); return b !== `pin:${id}` && cardOf(b)?.id === id ? `pin:${id}` : null; };
  const act = {
    pick: (id) => pick(id),
    audition(gid) {
      if (!BEAT_RE.test(gid) || !grooveOfBeat(song(), gid)) return fail('The book has no such groove.');
      if (R.busy()) return fail('The beat changes once the take is in.');
      R.gr.jam.audition = gid;
      if (jam.state.on) { jam.swap(gid); line('drummer.next', { name: nameOf(gid) }); sync(); book.render(); return { ok: true }; }
      const r = jamOn();
      book.render();
      return r;
    },
    pin(gid) {
      const pins = pinsNow();
      if (pins.length >= RISER_MAX) { line('drummer.full', { max: RISER_MAX }); return fail(`The riser holds ${RISER_MAX}.`); }
      const g = grooveOfBeat(song(), gid);
      if (!g) return fail('The book has no such groove.');
      const name = shortName(g.name);
      const r = setPins([...pins, { id: freshId(pins), groove: gid, name }]);
      if (r.ok) line('drummer.pinned', { name });
      return r;
    },
    unpin(id) {
      const pins = pinsNow(), c = riser().find((x) => x.id === id);
      if (pins.length <= 1) return fail('The riser keeps one card at least.');
      const r = setPins(pins.filter((x) => x.id !== id));
      if (r.ok) line('drummer.unpinned', { name: c?.name || 'That card' });
      return r;
    },
    move(id, dir) {
      const pins = pinsNow(), i = pins.findIndex((x) => x.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= pins.length) return { ok: true };
      [pins[i], pins[j]] = [pins[j], pins[i]];
      return setPins(pins);
    },
    rename(id, name) {
      const t = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!t) return { ok: true };
      return setPins(pinsNow().map((x) => (x.id === id ? { ...x, name: t } : x)));
    },
    step(id, row, k) {
      const p = song(), g = grooveOfBeat(p, `pin:${id}`);
      if (!g) return fail('There’s no card there.');
      const hits = stepped(g, row, k, { bpb: bpb() });
      const c = riser().find((x) => x.id === id);
      const r = setPins(pinsNow().map((x) => (x.id === id ? { ...x, hits } : x)), { coalesce: `room:pins:${id}`, beat: own(id) });
      if (r.ok && !said(`edited:${id}`)) line('drummer.edited', { name: c?.name || 'The card' });
      // (the drummer playing it: the bar as it is now from the next one on)
      if (r.ok && jam.state.on && jam.state.beat === `pin:${id}`) jam.swap(`pin:${id}`);
      return r;
    },
    reset(id) {
      const r = setPins(pinsNow().map((x) => { if (x.id !== id) return x; const { hits: _h, ...rest } = x; return rest; }), { beat: own(id) });
      if (r.ok && jam.state.on && jam.state.beat === `pin:${id}`) jam.swap(`pin:${id}`);
      return r;
    },
    countIn: () => countInPref(),
  };

  /* ------------------------------------------------------------------------------------------- the book */
  const panel = R.panel('kit');
  const bookW = () => Math.round(clamp((R.el.view.clientWidth || 1440) * 0.54, 560, 820));
  let camW = 0, baseOff = null;
  function target() {
    const w = R.el.view.clientWidth || 0;
    if (w === camW && baseOff) return;
    camW = w;
    panel.style.setProperty('--bw', bookW() + 'px');
    // (the first registration's off puts the foundation's target back; a later one replaces this stream's own)
    const off = R.camera.target('kit', { world: 'stage', rect: () => ({ x: 548, y: 150, w: 584, h: 410 }), right: bookW() + 28, pad: 14 });
    if (!baseOff) baseOff = off;
  }
  const look = () => {
    const e = engine(), playing = jam.state.on;
    let step = null;
    if (playing && e?.playing) { const into = e.beat - jam.state.start; if (into >= 0) step = Math.floor(((into % bpb()) / bpb()) * STEPS + EPS); }
    const list = riser(), beat = jam.state.on ? jam.state.beat : roomBeat();
    return { riser: list, beat, card: cardOf(beat, list)?.id ?? null, playing, audition: R.gr.jam.audition, step, countIn: R.gprefs.get().countIn, max: RISER_MAX };
  };
  const book = createBook({ el: panel, act, look });
  offs.push(R.on('cam', (d) => { if (d?.to === 'kit') book.render(true); }));
  target();

  /* ------------------------------------------------------------------------------------------- the count-in */
  async function countIn({ bars = null, bpm: _bpm = null, at: when = null, from = null, beat = null, counted = false, sounded: _sounded = null } = {}) {
    if (jam.state.on) stop();
    const p = song();
    const f = Number.isFinite(+from) && from != null ? Math.max(0, +from) : jamFrom(p);
    const on = R.gprefs.get().countIn !== false;
    const n = on ? (Number.isFinite(+bars) && bars != null ? clamp(Math.round(+bars), 0, 4) : (+p.tempo || 120) >= 160 ? 2 : 1) : 0;
    // the beat under the take: the one asked for, the part's there, else the room's
    const sec = (p.sections || []).find((s) => Math.abs(s.start - f) < EPS);
    const b = typeof beat === 'string' && BEAT_RE.test(beat) ? beat : beatOf(p, sec?.id || null);
    // (the drummer's first bars are in before the transport starts, so the 1 is heard)
    jam.start({ from: f, beat: b, kind: 'take', play: false });
    sync();
    // (the takes stream's call: the count is the deck's already, one count, never two)
    if (counted) { R.emit('drummer:jam', { on: true, beat: b, kind: 'take' }); return { ok: true, from: f }; }
    let r;
    try { r = await R.deck.countIn({ from: f, bars: n, voice: 'sticks', at: when }); } catch (e) { r = { ok: false, error: String(e?.message || e) }; }
    if (!r?.ok) { jam.stop(); sync(); return r || fail('The count didn’t start.'); }
    R.emit('drummer:jam', { on: true, beat: b, kind: 'take' });
    return r;
  }

  /* ------------------------------------------------------------------------------------------- the jam's leftovers */
  // The jam's bars are previews. The autosave (main.js) leaves them out, but a song saved before it did, or one sent or
  // shelved mid-jam, can still hold the bars that were in then. Nothing else names a clip 'Jam' by the house, and a
  // leftover one would play under the next jam's own bars, so they're taken out when the room comes up and when a song
  // loads, the same way they went in (a preview, never released: nothing in History, the song as it was before the jam)
  function sweep() {
    if (jam.state.on) return;
    const ops = [];
    for (const t of song().tracks || []) for (const c of t.clips || []) if (c.name === 'Jam' && c.by === 'overdub') ops.push({ type: 'clip.remove', track: t.id, clip: c.id });
    if (ops.length) store.preview(ops, { by: 'overdub' });
  }
  sweep();
  offs.push(store.on('change', (e) => { if (e?.kind !== 'load') return; if (jam.state.on) stop({ drop: true }); sweep(); }));

  /* ------------------------------------------------------------------------------------------- the frame */
  drawCards(true);
  let lastBar = '';
  function frame() {
    const e = engine(), p = song(), B = bpb(), spb = 60 / (+p.tempo || 120);
    // (the jam's run: someone else started the song, or the transport stopped by itself)
    if (jam.state.on && jam.state.kind === 'jam' && R.run() !== 'jam') jam.stop();
    jam.tick();
    if (!jam.state.on && R.run() === 'jam') { R.run('idle'); R.emit('drummer:jam', { on: false, beat: null, kind: 'jam' }); }
    sync();
    if (!jam.state.on && R.gr.jam.audition && R.run() !== 'jam') R.gr.jam.audition = null;
    target();
    // the count: its number on the kick head, the sticks clicking
    const beat = e?.playing ? e.beat : null;
    const k = e?.counting || null;
    let count = null, tapA = 0;
    if (k && beat != null) {
      const i = Math.floor(beat - k.from + 1e-6);
      if (i >= 0 && i < k.beats) { count = (i % B) + 1; tapA = Math.max(0, 1 - ((beat - Math.floor(beat)) * spb) / 0.18); }
    }
    // (Getting started's Timing: the drummer clicks the sticks with its eight clicks, R.gr.sticks, the start stream's)
    if (count == null && R.gr.sticks?.count) { count = R.gr.sticks.count; tapA = R.gr.sticks.tap || 0; }
    const ks = R.deck?.state || {};
    kitV.draw({ ...hitsAt(drumsTrack(), beat, spb), count, tap: tapA, loading: ks.kit === 'loading' ? clamp((ks.kitPct ?? 0) / 100, 0, 0.99) : null, reduced: reduced() });
    // the plate
    plate.dataset.on = jam.state.on && count == null ? '1' : '';
    plate.dataset.count = count != null ? '1' : '';
    const bpmT = String(Math.round(+p.tempo || 120));
    if (bpmEl.textContent !== bpmT) bpmEl.textContent = bpmT;
    const barT = count != null ? `IN ${count}` : jam.state.on && jam.state.bar ? `BAR ${jam.state.bar}` : beat != null && beat >= 0 ? `BAR ${Math.floor(beat / B) + 1}` : 'BAR –';
    if (barT !== lastBar) { barEl.textContent = barT; lastBar = barT; }
    const nm = longName(jam.state.on ? jam.state.beat : jamBeat());
    const beatT = R.gr.jam.audition && jam.state.on ? `From the book: ${nm}` : nm;
    if (beatEl.textContent !== beatT) beatEl.textContent = beatT;
    tapEl.dataset.hit = performance.now() - tapFlash < 120 ? '1' : '';
    drawCards();
    book.frame();
  }

  return {
    press(id) {
      if (typeof id !== 'string' || !MINE.test(id)) return false;
      if (id === 'drummer') return toggle();
      if (id === 'tap') return tap();
      if (id === 'countin') return countInPref();
      const t = /^tempo:([+-]?\d{1,3})$/.exec(id);
      if (t) return tempo(Number(t[1]));
      if (id === 'beat:prev') return cycle(-1);
      if (id === 'beat:next') return cycle(1);
      const n = /^beat:([1-9])$/.exec(id);
      if (n) { const c = riser()[Number(n[1]) - 1]; return c ? pick(c.id) : fail(`There’s no card ${n[1]} on the riser.`); }
      return false;
    },
    back: () => false,
    frame,
    unmount() {
      stop();
      clearTimeout(tempoSay);
      for (const off of offs.splice(0)) { try { off(); } catch { /* fine */ } }
      book.dispose();
      kitV.dispose();
      plate.remove(); cardsEl.remove(); ribbon.remove();
      // (the camera's kit target back as the foundation had it)
      baseOff?.();
      R.gr.jam.on = false; R.gr.jam.release = null; R.gr.jam.audition = null;
    },
    playing: () => jam.state.on && jam.state.kind === 'jam',
    stop: () => { stop(); },
    countIn,
  };
}
