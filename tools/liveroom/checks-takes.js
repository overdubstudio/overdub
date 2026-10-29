// The live room's checks: the guitar room's TAKES stream [guitar room] (docs/research/GUITAR-ROOM.md §2.5-§2.8; the
// stream's module, app/src/ui/liveroom/guitar/takes.js, says what it owns and its frozen API). Run by
// tools/liveroom-test.js (ONLY=takes), whose header says what a checks module exports. The seams it shares with the other
// streams are checks-guitar.js's.
//   Node: the takes' lines keep to the room's copy rules (./checks-copy.js breaks(), rendered with every kind of value);
//     the part line's plans each apply as one step and undo exactly (the unit tests hold the detail:
//     test/unit/guitar-takes.test.js)
//   muted Chromium: the club opened on the guitar room (core/liveroom/guitar/setup.js planGuitarRoom, by you), the
//     input open on a fake guitar playing all through the file (./fake.js session), the deck's latency 0. R at the
//     start of an empty part line records a new part: the count (the deck's, the sticks its voice; the drummer told),
//     the recording view, Space, the review; the take and its part are one step by you; the out handle's trim joins
//     it; Toss leaves History as it was; Again counts in again; Keep opens the part line. A take on that part (tailFrom
//     its end), ↑ ↓ the takes, the other side (the monitor moved to Guitar R and back, both lanes in review), a new
//     part after and before, moved, deleted and ⌘Z, a card dragged with the pointer, a name typed on a card (its letters
//     stay in the field), Enter and Home play, Enter and Space with the part line focused (a focused list or handle
//     swallows no key: Enter on a handle dragged with the pointer keeps the take), the other side's tightness said,
//     Esc in a take tosses it, a riff placed (the tape's place(), stood in for), no <select>, no range, no
//     console or page errors. Screenshots: tools/.out/liveroom/gr-takes-*.png
import path from 'node:path';
import { openRoom, press, history } from './harness.js';
import { session } from './fake.js';
import { breaks, renders } from './checks-copy.js';
import { LINES, lineOf } from '../../app/src/ui/liveroom/guitar/takes-lines.js';
import * as PP from '../../app/src/ui/liveroom/guitar/parts-plans.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import { planGuitarRoom } from '../../app/src/core/liveroom/guitar/setup.js';
import '../../app/src/devices/builtin/index.js';

export const name = 'takes';
export const pages = true;

const BPM = 132;
// a riff played all through the file (Chromium plays it from when the input opens, looping): whatever the count's
// timing, a take has a guitar on it
const RIFF = { bpm: BPM, beats: 4, chord: true, notes: [[0, 40, 0], [0.5, 40, 0], [1, 40, 0.5], [2, 43, 0], [2.5, 43, 0], [3, 45, 0.75]] };
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|status of 404/.test(e);

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- Node */
  {
    const V = [
      { part: 'Chorus', take: 2, bars: 4, ring: 1.5, next: 'Bridge', stopped: 3, n: 2, side: 'L', where: 'before the chorus', tape: true },
      { part: 'Verse', take: 1, bars: 1, ring: 0, next: null, stopped: 1, n: 1, side: 'R', where: '', tape: false },
      // (the other side's verdicts, measurePair's)
      ...['tight', 'fine', 'bar', 'loose'].map((verdict, i) => ({ part: 'Rdn Intro', take: 1, bars: 4, ring: 0, next: null, stopped: 4, n: 1, side: 'R', where: '', tape: false, verdict, ms: [4, -12.6, 58, 31][i], bar: i + 1, dir: i % 2 ? 'late' : 'early' })),
    ];
    const bad = [];
    for (const id of Object.keys(LINES)) {
      for (const v of V) {
        const t = lineOf(id, v);
        for (const b of breaks(id, t)) bad.push(`${id} "${t}": ${b.why}`);
      }
      for (const r of renders(LINES[id])) {
        if (r.error) bad.push(`${id} (${r.how}): ${r.error}`);
        else for (const b of breaks(id, r.text)) bad.push(`${id} "${r.text}": ${b.why}`);
      }
    }
    T.ok(!bad.length, `the takes' ${Object.keys(LINES).length} lines keep to the room's copy rules, every way they render${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
    const store = createStore(createProject());
    const g = planGuitarRoom(store.get(), {});
    store.dispatch(g.ops, { by: 'you' });
    const strip = (p) => JSON.stringify({ ...p, meta: null });
    const s0 = strip(store.get());
    const plans = [
      ['a part at the end', () => PP.planNewPart(store.get(), {})],
      ['an intro before it', () => PP.planNewPart(store.get(), { at: 0, name: 'Intro', bars: 2 })],
      ['a move', () => PP.planMovePart(store.get(), { section: PP.partLine(store.get()).parts[0].id, to: 2 })],
      ['a delete', () => PP.planRemovePart(store.get(), { section: PP.partLine(store.get()).parts[0].id })],
    ];
    const res = [];
    for (const [what, mk] of plans) {
      const before = strip(store.get()), pl = mk();
      const d = store.dispatch(pl.ops, { by: 'you', label: pl.label });
      const u = store.undo();
      const back = strip(store.get()) === before;
      store.redo();
      res.push([what, d.ok && u.ok && back]);
    }
    T.ok(res.every((r) => r[1]) && strip(store.get()) !== s0, `the part line's plans: each one step, undone exactly (${res.map(([w, ok]) => `${w}${ok ? '' : ' NOT'}`).join(', ')})`);
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const fk = session({ bpm: BPM, lead: 0.5, tail: 0.5, parts: [{ kind: 'riff', riff: RIFF, bar: 1, passes: 40, seed: 7, jitter: 0.003, peak: -12 }] });
  const s = await openRoom('/app/?room', { fake: fk, name: 'takes' });
  const { page, E, errors } = s;
  const shot = (_s, n) => page.screenshot({ path: path.join(ctx.out, `gr-takes-${n}.png`) });
  const waitFor = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 30 });
  const settle = (ms = 80) => page.evaluate((ms) => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), ms)), ms);
  const beat = () => E(() => window.overdub.engine.beat);
  // the room's state as the checks read it
  const READ = () => E(() => {
    const o = window.overdub, R = document.querySelector('.gr').__gr, L = o.ui.state.liveRoom, p = o.store.get();
    const tr = (role) => p.tracks.find((t) => t.id === p.room?.tracks?.[role]);
    const clips = (role) => (tr(role)?.clips || []).map((c) => ({ id: c.id, start: c.start, length: c.length, tail: c.tail || 0, mute: !!c.mute }));
    return {
      run: L.run, card: L.card, overlay: R.gr.overlay, drawer: !!R.gr.drawer, take: R.gr.take ? { ...R.gr.take } : null,
      sections: p.sections.slice().sort((a, b) => a.start - b.start).map((x) => ({ id: x.id, name: x.name, start: x.start, length: x.length })),
      L: clips('guitarL'), R: clips('guitarR'), steps: o.store.history.length, said: window.__tk.said.slice(),
      cards: [...document.querySelectorAll('.grt-card')].map((c) => c.querySelector('.grt-cn')?.textContent),
      over: !R.el.over.hidden && R.el.over.classList.contains('grt-rec'), review: !document.querySelector('.gr-sheet[data-sheet="review"]')?.hidden,
    };
  });
  // a take: R (or the key given), the count, `bars` bars of recording, then Space; the review up
  const recordTake = async ({ key = 'KeyR', bars = 2.5, stop = 'Space', shots = null } = {}) => {
    await press(page, key);
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'count' || window.overdub.ui.state.liveRoom.run === 'take', null, 10000);
    if (shots) { await settle(250); await shot(s, shots[0]); }
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'take', null, 20000);
    const b0 = await E(() => window.__tk.takes.at(-1)?.from ?? 0);
    await waitFor((b) => window.overdub.engine.beat >= b, b0 + bars * 4, 30000);
    if (shots) await shot(s, shots[1]);
    await press(page, stop);
    if (stop === 'Space') await waitFor(() => window.overdub.ui.state.liveRoom.gr.overlay === 'review', null, 20000).catch(() => {});
    await settle(150);
  };
  try {
    const installed = await E(async () => {
      const o = window.overdub;
      const { planGuitarRoom } = await import('/app/src/core/liveroom/guitar/setup.js');
      const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (fn, ms) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await sleep(10); } };
      window.__tk = { said: [], counts: [], takes: [], stops: [], monitor: [], drummer: [] };
      o.liveRoom.on('say', (e) => window.__tk.said.push(e.text));
      if (o.liveRoom.isOpen()) o.liveRoom.close();
      const pl = planGuitarRoom(o.store.get(), { tuning: null });
      const r = o.store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      await o.engine.start?.();
      await o.input.audio.open({ channel: '1', capture: true, monitor: false });
      await until(() => o.input.audio.state.open && Number.isFinite(o.input.audio.state.firstFrame), 15000);
      const deck = createDeck(o);
      deck.latency = 0;
      const count = deck.countIn, take = deck.take, stop = deck.stop;
      deck.countIn = (a = {}) => { window.__tk.counts.push({ ...a }); return count(a); };
      deck.take = (a = {}) => { window.__tk.takes.push(JSON.parse(JSON.stringify(a))); return take(a); };
      deck.stop = (a = {}) => { window.__tk.stops.push(JSON.parse(JSON.stringify(a))); return stop(a); };
      const mv = o.input.audio.monitorVia?.bind(o.input.audio);
      // (the room names its target by a resolver, asked at every sync: what it resolves to when it's set is recorded)
      if (mv) o.input.audio.monitorVia = (t) => { window.__tk.monitor.push(typeof t === 'function' ? t() : t); return mv(t); };
      o.liveRoom.open({ screen: 'guitar' });
      await until(() => document.querySelector('.gr')?.__gr?.parts?.takes, 10000);
      const R = document.querySelector('.gr').__gr;
      // the drummer, as the takes stream tells it before the deck's count (counted: true; the drummer plays under the take)
      const dr = R.parts.drummer;
      if (dr) { const ci = dr.countIn?.bind(dr); dr.countIn = (a) => { window.__tk.drummer.push({ ...a }); return ci ? ci(a) : Promise.resolve(); }; }
      R.drawer(true);
      return { ok: r.ok, guitars: [o.store.get().room.tracks.guitarL, o.store.get().room.tracks.guitarR] };
    });
    T.ok(installed.ok, `the club in the guitar room, the input open on a fake guitar (${installed.guitars.join(', ')})`);
    await settle(200);
    const empty = await READ();
    const emptyText = await E(() => document.querySelector('.grt-empty')?.textContent || '');
    T.ok(!empty.sections.length && /press R to record a part/.test(emptyText), `an empty part line says so in the drawer ("${emptyText}")`);
    await shot(s, 'empty');

    /* a new part: the count, the take, the review */
    const h0 = await history(page);
    await recordTake({ shots: ['count', 'rec'] });
    const a = await READ();
    const h1 = await history(page);
    const c0 = await E(() => ({ counts: window.__tk.counts.slice(), takes: window.__tk.takes.slice(), stops: window.__tk.stops.slice(), drummer: window.__tk.drummer.slice() }));
    T.ok(c0.counts[0]?.voice === 'sticks' && c0.counts[0]?.from === 0 && c0.counts[0]?.bars === 1 && c0.drummer[0]?.sounded === true && c0.drummer[0]?.counted === true && c0.drummer[0]?.bars === 1,
      `R counts a new part in: the deck's count from beat ${c0.counts[0]?.from}, ${c0.counts[0]?.bars} bar of ${c0.counts[0]?.voice}; the drummer told (sounded: ${c0.drummer[0]?.sounded})`);
    T.ok(c0.takes[0]?.track === installed.guitars[0] && c0.takes[0]?.tailFrom == null && c0.stops[0]?.at === 'now' && c0.stops[0]?.keep === 'song',
      `the take on Guitar L, no tailFrom for a part that isn't there yet; Space stops it now and keeps it (${JSON.stringify(c0.stops[0])})`);
    const part1 = a.sections[0];
    T.ok(a.overlay === 'review' && a.review && a.take && a.take.isNew && part1 && part1.length % 4 === 0 && part1.length >= 4 && a.L.length === 1,
      `Space: the review is up on ${part1?.name}, a new part of ${part1 ? part1.length / 4 : '-'} whole bars, its take ${a.L[0] ? `${a.L[0].length} beats, ${a.L[0].tail} of them ring` : 'missing'}`);
    T.ok(h1.length === h0.length + 1 && h1.at(-1).by === 'you' && h1.at(-1).ops.includes('section.add') && h1.at(-1).ops.includes('clip.add'),
      `a take and its part are one step by you ("${h1.at(-1)?.label}": ${[...new Set(h1.at(-1)?.ops || [])].join(', ')})`);
    T.ok(a.said.some((x) => /is in: .*Keep it\?/.test(x)), `the talkback says it's in ("${a.said.at(-1)}")`);
    await settle(400);
    await shot(s, 'review');

    // the out handle: back a beat, joined to the take
    const out0 = a.L[0];
    await E(() => document.querySelector('.grt-h.grt-out').focus());
    await press(page, 'ArrowLeft');
    await press(page, 'ArrowLeft');
    const tr = await READ();
    const h2 = await history(page);
    T.ok(tr.L[0].length < out0.length && h2.length === h1.length && tr.overlay === 'review', `the out handle trims the take (${out0.length} → ${tr.L[0].length} beats), joined to its step (History ${h2.length}), arrows on a focused handle are the handle's`);
    await E(() => document.activeElement?.blur());

    // Toss: History as it was
    await press(page, 'Backspace');
    await settle();
    const t1 = await READ();
    const h3 = await history(page);
    T.ok(!t1.sections.length && !t1.L.length && t1.overlay !== 'review' && JSON.stringify(h3) === JSON.stringify(h0) && !(await E(() => window.overdub.store.canRedo())),
      `Toss takes the take and its part out and leaves History as it was (${h3.length} steps; nothing to redo)`);

    // Again in review: the take out, a new count
    await recordTake();
    const nCounts = (await E(() => window.__tk.counts.length));
    await press(page, 'KeyR');
    await waitFor(() => ['count', 'take'].includes(window.overdub.ui.state.liveRoom.run), null, 10000);
    const ag = await READ();
    T.ok((await E(() => window.__tk.counts.length)) === nCounts + 1 && !ag.L.length && !ag.sections.length && ag.over, `R in review is Again: the take out and a new count (${ag.run})`);
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'take', null, 20000);
    const b1 = await beat();
    await waitFor((b) => window.overdub.engine.beat >= b, b1 + 8, 30000);
    await press(page, 'Space');
    await waitFor(() => window.overdub.ui.state.liveRoom.gr.overlay === 'review', null, 20000);
    // the out handle dragged back with the pointer (it keeps focus), then Keep with Enter on it: a focused handle
    // never swallows the room's Enter
    const hd0 = (await history(page)).length, len0 = (await READ()).L[0]?.length;
    const ob = await page.locator('.grt-h.grt-out').boundingBox();
    // (by its upper half: the part's end, when the take stopped just past a bar line, sits on it below)
    await page.mouse.move(ob.x + ob.width / 2, ob.y + 40);
    await page.mouse.down();
    await page.mouse.move(ob.x + ob.width / 2 - 70, ob.y + 40, { steps: 6 });
    await page.mouse.up();
    await settle(120);
    const dr = await READ();
    const hFocus = await E(() => document.activeElement?.classList.contains('grt-out'));
    T.ok(dr.L[0]?.length < len0 && (await history(page)).length === hd0 && dr.overlay === 'review' && hFocus,
      `the out handle dragged with the pointer trims the take (${len0} → ${dr.L[0]?.length} beats, snapped to the beat), joined to its step; the handle has focus`);
    // Keep
    await press(page, 'Enter');
    await settle(200);
    const k = await READ();
    const hk = await history(page);
    T.ok(k.overlay !== 'review' && k.drawer && k.cards.length === 1 && k.card === k.sections[0]?.id && hk.length === h0.length + 1 && k.said.some((x) => /^Kept: /.test(x)),
      `Enter on the focused handle keeps it: the part line opens on ${k.cards.join(', ')} (selected), one step by you ("${hk.at(-1)?.label}")`);
    await press(page, 'Space');
    await settle(100);
    await shot(s, 'parts');

    /* a second take on that part: tailFrom its end, take 2, ↑ ↓ */
    const sec = k.sections[0];
    await recordTake({ bars: sec.length / 4 + 0.75 });
    const t2 = await READ();
    const tk2 = await E(() => window.__tk.takes.at(-1));
    T.ok(tk2.from === sec.start && tk2.tailFrom === sec.start + sec.length && t2.take?.take === 2 && !t2.take.isNew && t2.L.length === 2,
      `R on a part records it again: from ${tk2.from}, what rings past beat ${tk2.tailFrom} its tail; take ${t2.take?.take} (${t2.L.map((c) => `${c.start}+${c.length}${c.mute ? ' muted' : ''}`).join(', ')})`);
    await settle(300);
    await shot(s, 'review-ring');
    await press(page, 'Enter');
    await settle();
    const hp = (await history(page)).length;
    const playing0 = (await READ()).L.find((c) => !c.mute)?.id;
    await press(page, 'ArrowUp');
    const up = await READ();
    const hpu = await history(page);
    const playing1 = up.L.filter((c) => !c.mute);
    T.ok(hpu.length === hp + 1 && hpu.at(-1).by === 'you' && playing1.length === 1 && playing1[0].id !== playing0 && hpu.at(-1).label === 'Verse: take 1', `↑ picks take 1: it plays, take 2 is muted, one step by you ("${hpu.at(-1)?.label}")`);
    await press(page, 'ArrowDown');

    /* the other side */
    await E(() => { window.__tk.monitor.length = 0; });
    await recordTake({ key: 'KeyD', bars: sec.length / 4 });
    const sd = await READ();
    const mon = await E(() => window.__tk.monitor.slice());
    const two = await E(() => document.querySelector('.grt-tl')?.classList.contains('grt-two'));
    T.ok(sd.take?.side === 'R' && sd.R.length === 1 && mon[0] === installed.guitars[1] && two, `D records the other side on Guitar R (the monitor moved there: ${mon.join(' → ')}); the review shows both lanes`);
    await waitFor(() => window.__tk.said.some((x) => /^The other side is in/.test(x)), null, 10000).catch(() => {});
    const pairSaid = (await E(() => window.__tk.said.filter((x) => /^The other side is in/.test(x)))).at(-1) || '';
    const pairMeta = await E(() => document.querySelector('.grt-meta')?.textContent || '');
    T.ok(/^The other side is in(: (within \d+ ms of your left|bar \d+ runs (early|late) against your left|it wanders))?.*Keep it/.test(pairSaid) && !/Bar \d+ again\?/.test(pairSaid),
      `the other side measured against the left (measurePair): "${pairSaid}"; the review says "${pairMeta}"`);
    await settle(300);
    await shot(s, 'review-side');
    await press(page, 'Enter');
    await settle(200);
    const sk = await READ();
    const mon2 = await E(() => window.__tk.monitor.slice());
    T.ok(mon2.at(-1) === installed.guitars[0] && sk.run === 'play' && sk.said.some((x) => /^Kept\. Both sides/.test(x)), `Keep on the other side: the monitor back on Guitar L, both sides played wide (${sk.run}; "${sk.said.filter((x) => /Both sides|ms|drift|tight|wander/i.test(x)).slice(-2).join(' / ')}")`);
    await press(page, 'Space');
    await settle();

    /* the part line: a new part after, before; moved; deleted; ⌘Z */
    const hn = (await history(page)).length;
    await press(page, 'KeyN');
    await press(page, 'Shift+KeyN');
    const pn = await READ();
    const hnn = await history(page);
    T.ok(pn.sections.length === 3 && hnn.length === hn + 2 && hnn.slice(-2).every((x) => x.by === 'you') && pn.card === pn.sections[1].id,
      `N a new part after, ⇧N one before it: each one step by you (${pn.sections.map((x) => `${x.name} ${x.length / 4}`).join(', ')})`);
    await press(page, 'Alt+ArrowLeft');
    const mv = await READ();
    T.ok(mv.sections[0].id === pn.card && (await history(page)).length === hn + 3, `⌥← moves it first (${mv.sections.map((x) => x.name).join(', ')})`);
    await press(page, 'Backspace');
    const rm = await READ();
    await press(page, 'Meta+KeyZ');
    const back = await READ();
    T.ok(rm.sections.length === 2 && back.sections.length === 3 && JSON.stringify(back.sections) === JSON.stringify(mv.sections), `⌫ deletes the selected part, ⌘Z puts it back (${rm.sections.map((x) => x.name).join(', ')} → ${back.sections.map((x) => x.name).join(', ')})`);
    await settle(150);
    await shot(s, 'line');
    // a card dragged with the pointer past the last one: one step by you, then ⌘Z
    {
      const hd = (await history(page)).length;
      const c0 = await page.locator('.grt-card').first().boundingBox();
      const cl = await page.locator('.grt-card').last().boundingBox();
      await page.mouse.move(c0.x + 60, c0.y + 50);
      await page.mouse.down();
      await page.mouse.move(c0.x + 120, c0.y + 50, { steps: 4 });
      await page.mouse.move(cl.x + cl.width - 20, cl.y + 50, { steps: 10 });
      const lit = await E(() => document.querySelector('.grt-gap.grt-hot')?.dataset.drop ?? null);
      await page.mouse.up();
      await settle(120);
      const dg = await READ();
      const hdg = await history(page);
      T.ok(lit === '3' && dg.sections.at(-1).id === back.sections[0].id && hdg.length === hd + 1 && hdg.at(-1).by === 'you' && !(await E(() => !!document.querySelector('.grt-ghost'))),
        `a card dragged past the last: the gap lights (${lit}), it moves there, one step by you ("${hdg.at(-1)?.label}": ${dg.sections.map((x) => x.name).join(', ')})`);
      await press(page, 'Meta+KeyZ');
      await settle(120);
    }

    // a name typed on a card: its letters stay in the field
    await page.dblclick('.grt-card[aria-selected="true"] .grt-cn');
    await page.keyboard.type('Rdn Intro');
    await press(page, 'Enter');
    const nm = await READ();
    T.ok(nm.run === 'idle' && nm.sections.some((x) => x.name === 'Rdn Intro') && nm.sections.length === 3, `a name typed on a card stays in the field and names it ("${nm.sections.map((x) => x.name).join(', ')}"; the room ${nm.run})`);

    // Enter plays from the selected part, Home from the top, Space stops
    await E(() => document.activeElement?.blur());
    await E(() => { const R = document.querySelector('.gr').__gr; R.press(`card:${window.overdub.ui.state.liveRoom.card}`); });
    const sel = await READ();
    const selSec = sel.sections.find((x) => x.id === sel.card);
    await press(page, 'Enter');
    await waitFor(() => window.overdub.engine.playing, null, 5000).catch(() => {});
    const pf = await E(() => ({ playing: window.overdub.engine.playing, run: window.overdub.ui.state.liveRoom.run, from: window.__lrPlays.at(-1)?.from }));
    await press(page, 'Space');
    await press(page, 'Home');
    await waitFor(() => window.overdub.engine.playing, null, 5000).catch(() => {});
    const hf = await E(() => ({ playing: window.overdub.engine.playing, from: window.__lrPlays.at(-1)?.from }));
    await press(page, 'Space');
    await settle();
    const st = await READ();
    T.ok(pf.playing && pf.run === 'play' && pf.from === selSec?.start && hf.playing && hf.from === 0 && st.run === 'idle', `Enter plays from ${selSec?.name} (beat ${pf.from}), Home from the top (beat ${hf.from}), Space stops (${st.run})`);

    // with the part line focused (a card clicked): Enter plays from it and it keeps playing; Space stops it
    {
      await page.click('.grt-card[aria-selected="true"] .grt-cm');
      const fl = await E(() => document.activeElement?.getAttribute('role'));
      await press(page, 'Enter');
      await waitFor(() => window.overdub.engine.playing, null, 5000).catch(() => {});
      await settle(500);
      const pl1 = await E(() => ({ playing: window.overdub.engine.playing, run: window.overdub.ui.state.liveRoom.run, plays: window.__lrPlays.length }));
      await press(page, 'Space');
      await settle(300);
      const pl2 = await E(() => ({ playing: window.overdub.engine.playing, run: window.overdub.ui.state.liveRoom.run, focus: document.activeElement?.getAttribute('role') }));
      // ↑ on the focused list: the take before plays on the card with two (the live room's holds mark the key on its way)
      await page.locator('.grt-card', { hasText: 'of 2' }).locator('.grt-cm').click();
      const hu = (await history(page)).length;
      await press(page, 'ArrowUp');
      const hu2 = await history(page);
      T.ok(fl === 'listbox' && pl1.playing && pl1.run === 'play' && !pl2.playing && pl2.run === 'idle' && pl2.focus === 'listbox' && hu2.length === hu + 1 && /: take 1$/.test(hu2.at(-1)?.label || ''),
        `with the part line focused (${fl}), Enter plays from the card and keeps playing (${pl1.run}), Space stops it (${pl2.run}), ↑ picks a take ("${hu2.at(-1)?.label}"): the list swallows none`);
      await press(page, 'ArrowDown');
      await E(() => document.activeElement?.blur());
    }

    // Esc in a take tosses it
    const he = await history(page);
    await press(page, 'KeyR');
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'take', null, 20000);
    await waitFor((b) => window.overdub.engine.beat >= b, (await E(() => window.__tk.takes.at(-1)?.from ?? 0)) + 6, 30000);
    await press(page, 'Escape');
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'idle', null, 10000).catch(() => {});
    await settle(300);
    const es = await READ();
    T.ok(JSON.stringify(await history(page)) === JSON.stringify(he) && es.overlay !== 'review' && !es.over, `Esc in a take tosses it: nothing in History, the view down ("${es.said.at(-1)}")`);

    // a riff off the tape as a part: place() with an intoSong-shaped riff (the tape's own drag and Enter: checks-tape)
    const hr = (await history(page)).length;
    const pr = await E(async () => {
      const R = document.querySelector('.gr').__gr, o = window.overdub, p = o.store.get();
      const c = p.tracks.find((t) => t.id === p.room.tracks.guitarL).clips[0];
      const r = await R.parts.takes.place({ name: 'Riff 1', ops: [], clip: { kind: 'audio', asset: c.asset, offset: c.offset || 0, gain: 0, start: 0, length: 8 }, beats: 8, bars: 2, tail: 0.4 }, { at: 0 });
      const { takesIn } = await import('/app/src/ui/liveroom/guitar/parts-plans.js');
      const q = o.store.get(), first = q.sections.slice().sort((a, b) => a.start - b.start)[0];
      const dump = ['guitarL', 'guitarR'].map((k) => `${k}: ${q.tracks.find((t) => t.id === q.room.tracks[k]).clips.map((x) => `${x.start}+${x.length}`).join(' ')}`).join('; ');
      return { ...r, first: first?.name, sides: [takesIn(q, { section: first?.id, side: 'L' }).length, takesIn(q, { section: first?.id, side: 'R' }).length], dump, summary: R.parts.takes.summary() };
    });
    const hr2 = await history(page);
    T.ok(pr.ok && pr.first === 'Riff 1' && hr2.length === hr + 1 && hr2.at(-1).by === 'you' && pr.sides.join() === '1,0', `place(): a riff off the tape is the first part, its one take on the left, one step by you ("${hr2.at(-1)?.label}"; the line ${pr.summary?.parts} parts, ${pr.summary?.bars} bars)${pr.sides.join() === '1,0' ? '' : `; its takes ${pr.sides.join(', ')}: ${pr.dump}`}`);
    await settle(200);
    await shot(s, 'riff');

    // heard top to bottom: Home, and the song plays to its end by itself; Send comes up in the header
    const send0 = await E(() => !!document.querySelector('.lr-send') && !document.querySelector('.lr-send').hidden);
    await E(() => { const R = document.querySelector('.gr').__gr; R.drawer(false); document.activeElement?.blur?.(); });
    await press(page, 'Home');
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'play', null, 5000).catch(() => {});
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'idle', null, 60000).catch(() => {});
    await settle(300);
    const sent = await E(() => ({ send: !!document.querySelector('.lr-send') && !document.querySelector('.lr-send').hidden, said: window.__tk.said.at(-1) || '' }));
    T.ok(!send0 && sent.send && /top to bottom/.test(sent.said), `Home, played to the end: Send comes up in the header ("${sent.said}"; before it ${send0 ? 'was' : 'wasn’t'} up)`);

    const form = await E(() => ({ sel: document.querySelectorAll('.gr select').length, range: document.querySelectorAll('.gr input[type=range]').length }));
    T.ok(!form.sel && !form.range, `no <select> and no range slider (${form.sel}, ${form.range})`);
    const errs = errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `no console or page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await s.close();
  }
}
