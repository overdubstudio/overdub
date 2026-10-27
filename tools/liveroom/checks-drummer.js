// The live room's checks: the guitar room's DRUMMER stream [guitar room] (docs/research/GUITAR-ROOM.md §2.2, §2.7; the
// stream's module, app/src/ui/liveroom/guitar/drummer.js, says what it owns and its frozen API). Run by
// tools/liveroom-test.js (ONLY=drummer), whose header says what a checks module exports.
//   Node: the beats' plans (core/liveroom/guitar/beats.js): a part's beat is one step by you with the drums signed by the
//     house, undone exactly, swapped again over the house's own clip, never over one you changed; a jam's bar is the
//     same twice, a preview that leaves the song and History as they were; the riser's cards (pin, unpin, rename,
//     reorder, edit, back as written) each one step, undone exactly, the riser's beat following a card that goes; an
//     edited card plays (its hits whole again); a step's click goes rest, hit, accent, rest; the tempo stays put once a
//     take is in; a tap's tempo
//   LEVELS: the drums measured, offline, by the canonical renderer (the club's kit, the master out): the guide beat sits
//     with the club's verse beat (within 1.5 LU), every riser card within a few LU of it, the same song renders the same
//     samples twice
//   muted Chromium: the riser drawn where the layout says (the plate, the cards, the ribbon, the kit); Space jams (the
//     song's end on, the drummer's bars as previews, nothing in History) and Space again stops (nothing left); a card's
//     swap is one step and comes in at a bar line; with a part selected and the part line up, its drums too; ← → and ⇧
//     the tempo, one step; T taps it; K opens the book: a step edits a card (one step), a name typed stays in its field,
//     Play now plays a groove without changing the song, a pin and an unpin; the count-in on the deck (the sticks), the
//     drummer's bars under the take, let go when the transport stops; ⇧K turns the count off; a focused card never
//     takes Space; no console errors
import fs from 'node:fs';
import path from 'node:path';
import { openRoom, press, history } from './harness.js';
import { createProject } from '../../app/src/core/project.js';
import { createStore } from '../../app/src/core/store.js';
import '../../app/src/devices/builtin/index.js';
import { planGuitarRoom } from '../../app/src/core/liveroom/guitar/setup.js';
import * as B from '../../app/src/core/liveroom/guitar/beats.js';
import * as G from '../../app/src/core/liveroom/guitar/beats-grid.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { sha256 } from '../../app/src/engine/node/io.js';
import { measure } from '../../app/src/audio/measure.js';

export const name = 'drummer';
export const pages = true;

const f1 = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : String(x));
const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (p) => JSON.stringify({ tracks: p.tracks, room: p.room, sections: p.sections, tempo: p.tempo });

function club({ verse = true } = {}) {
  const store = createStore(createProject());
  const pl = planGuitarRoom(store.get(), {});
  store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
  if (verse) store.dispatch([{ type: 'section.add', section: { id: 's_verse', name: 'Verse', start: 0, length: 16 } }], { by: 'you', label: 'A verse' });
  return store;
}

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- Node: the plans */
  {
    const store = club(), p0 = store.get(), drums = p0.room.tracks.drums, n0 = store.history.length;
    const before = snap(p0);
    const bo = B.beatOps(p0, { section: 's_verse', beat: 'pin:p3' });
    const r = store.dispatch(bo.ops, { by: 'you', label: bo.label, reason: bo.reason });
    const p1 = store.get(), t1 = p1.tracks.find((t) => t.id === drums), c1 = t1.clips[0];
    const signed = c1 && c1.by === 'overdub' && c1.notes.every((n) => n.by === 'overdub') && store.history.at(-1).by === 'you';
    T.ok(r.ok && store.history.length === n0 + 1 && t1.clips.length === 1 && c1.start === 0 && c1.length === 16 && p1.room.parts?.s_verse?.beat === 'pin:p3' && signed,
      `a part's beat: one step by you ("${bo.label}", ${bo.ops.length} ops), the drums signed by the house (${c1?.notes.length} hits), the part's beat named (${p1.room.parts?.s_verse?.beat})`);
    // swapped again: the house's clip replaced
    const bo2 = B.beatOps(store.get(), { section: 's_verse', beat: B.GUIDE_ID });
    store.dispatch(bo2.ops, { by: 'you', label: bo2.label, reason: bo2.reason });
    const t2 = store.get().tracks.find((t) => t.id === drums);
    T.ok(t2.clips.length === 1 && t2.clips[0].name === 'Guide' && bo2.ops.some((o) => o.type === 'clip.remove'), `swapped again, the house's clip goes and the new one takes its place (${t2.clips.map((c) => c.name).join(', ')})`);
    store.undo(); store.undo();
    T.ok(snap(store.get()) === before, 'both undone exactly: the song as it was before the first');
    // a clip you changed is yours
    store.redo();
    const t3 = store.get().tracks.find((t) => t.id === drums), cid = t3.clips[0].id;
    store.dispatch([{ type: 'notes.add', track: drums, clip: cid, notes: [{ p: 49, t: 0, d: 1, v: 0.9 }] }], { by: 'you', label: 'my crash' });
    const bo3 = B.beatOps(store.get(), { section: 's_verse', beat: 'pin:p4' });
    T.ok(bo3.kept && !bo3.ops.some((o) => /^clip\./.test(o.type)), `a part's drums you changed stay yours: only its beat is named (${bo3.ops.map((o) => o.type).join(', ') || 'no ops'})`);
  }
  {
    const store = club(), p = store.get(), n0 = store.history.length, before = snap(p);
    const a = B.jamOps(p, { beat: 'pin:p3', from: 32, bars: 1, start: 16 }), b = B.jamOps(p, { beat: 'pin:p3', from: 32, bars: 1, start: 16 });
    const clip = a.ops[0]?.clip;
    const pv = store.preview(a.ops, { by: 'overdub' });
    const held = store.get().tracks.find((t) => t.id === p.room.tracks.drums).clips.length;
    pv.release();
    T.ok(JSON.stringify(a) === JSON.stringify(b) && clip?.name === 'Jam' && clip.by === 'overdub' && clip.start === 32 && clip.length === 4 && clip.notes.length > 0,
      `a jam's bar is the same twice (${clip?.notes.length} hits, seeded), one clip named Jam by the house`);
    T.ok(held === 1 && snap(store.get()) === before && store.history.length === n0, 'heard through a preview, then released: the song and History as they were');
    const g1 = B.jamOps(p, { beat: 'pin:p4', from: 16, bars: 1, start: 16 }).ops[0].clip.notes, g2 = B.jamOps(p, { beat: 'pin:p4', from: 20, bars: 1, start: 16 }).ops[0].clip.notes;
    T.ok(JSON.stringify(g1) !== JSON.stringify(g2), 'each bar of a jam is its own (seeded by its bar: a drummer, not a loop)');
  }
  {
    const store = club(), p0 = store.get(), before = snap(p0), n0 = store.history.length;
    const steps = [];
    const go = (what, pins, want) => {
      const pl = B.pinOps(store.get(), { pins });
      const r = store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      steps.push({ what, ok: r.ok && pl.reason === 'room:pins' && pl.ops.length === 1 && (!want || want.test(pl.label)), label: pl.label });
    };
    const pins = () => store.get().room.pins.map((x) => ({ ...x }));
    go('unpin', pins().filter((x) => x.id !== 'p5'), /^Unpinned Half-time$/);
    go('pin', [...pins(), { id: G.nextPinId([...pins(), { id: 'p5' }]), groove: 'metal/gallop', name: 'Gallop 2' }], /^Pinned Gallop 2/);
    go('rename', pins().map((x) => (x.id === 'p2' ? { ...x, name: 'Chug' } : x)), /^Renamed Djent to Chug$/);
    go('reorder', [pins()[1], pins()[0], ...pins().slice(2)], /new order/);
    const g = B.grooveOfBeat(store.get(), 'pin:p1');
    go('edit', pins().map((x) => (x.id === 'p1' ? { ...x, hits: G.stepped(g, 'kick', 6) } : x)), /^Edited Guide$/);
    const edited = B.grooveOfBeat(store.get(), 'pin:p1');
    const notes = B.jamOps(store.get(), { beat: 'pin:p1', from: 0, bars: 1 }).ops[0]?.clip.notes || [];
    go('as written', pins().map((x) => { const { hits: _h, ...rest } = x; return rest; }), /^Edited Guide$/);
    T.ok(steps.every((s) => s.ok) && store.history.length === n0 + steps.length, `the riser's cards, each one step by you: ${steps.map((s) => `${s.what} ("${s.label}")${s.ok ? '' : ' FAILED'}`).join(', ')}`);
    T.ok(edited && edited.hits.every((x) => Number.isFinite(x.p) && x.mark) && notes.some((n) => n.p === 36 && Math.abs(n.t - 1.5) < 0.05), `an edited card plays: its hits whole again (${edited?.hits.length}), the kick added on step 7 heard (${notes.length} hits)`);
    for (let i = 0; i < steps.length; i++) store.undo();
    T.ok(snap(store.get()) === before, 'all of them undone exactly');
    // the riser's beat on a card that goes
    store.dispatch([{ type: 'room.set', patch: { beat: 'pin:p3' } }], { by: 'you' });
    const pl = B.pinOps(store.get(), { pins: pins().filter((x) => x.id !== 'p3') });
    store.dispatch(pl.ops, { by: 'you' });
    T.ok(store.get().room.beat === 'modernmetal/double-kick-gallop', `unpinning the card the riser's on: the riser plays what it was made from (${store.get().room.beat})`);
    const same = B.pinOps(store.get(), { pins: pins() });
    T.ok(!same.ops.length, 'the cards set as they are: no step');
  }
  {
    const g = B.GUIDE, a = G.stepped(g, 'snare', 6), b = G.stepped({ ...g, hits: B.grooveOfBeat({ room: { pins: [{ id: 'x', groove: B.GUIDE_ID, hits: a }] } }, 'pin:x').hits }, 'snare', 6);
    const c = G.stepped({ ...g, hits: B.grooveOfBeat({ room: { pins: [{ id: 'x', groove: B.GUIDE_ID, hits: b }] } }, 'pin:x').hits }, 'snare', 6);
    const at = (hs) => hs.filter((x) => x.row === 'snare' && Math.abs(x.t - 1.5) < 0.01).map((x) => x.v).join();
    const orig = g.hits.map((x) => [x.t, x.row, x.v].join()).sort().join('|'), back = c.map((x) => [x.t, x.row, x.v].join()).sort().join('|');
    T.ok(at(a) === '0.8' && at(b) === '1' && at(c) === '' && orig === back, `a step's click: a hit (${at(a)}), an accent (${at(b)}), a rest, and the bar is as it was`);
    const grid = G.rowsOf(B.GUIDE).map((r) => `${r.label} ${r.cells.join('')}`);
    T.ok(grid.join(' / ') === 'Hat 1000100010001000 / Snare 0000200000002000 / Kick 1000000010000000', `the guide's bar on the grid: ${grid.join(' / ')}`);
  }
  {
    const store = club(), p = store.get();
    const t0 = G.planTempo(p, 140);
    store.dispatch([{ type: 'clip.add', track: p.room.tracks.guitarL, clip: { kind: 'audio', start: 0, length: 4, asset: 'a_x', name: 'Take 1' } }], { by: 'you' });
    const t1 = G.planTempo(store.get(), 140);
    T.ok(t0.ops.length === 1 && t0.label === 'Tempo 140' && !!t1.error && !t1.ops.length, `the tempo moves (${t0.label}) until a take is in ("${t1.error}")`);
    T.ok(G.tapTempo([0, 500, 1000, 1500]) === 120 && G.tapTempo([0, 500, 1000]) === null && G.tapTempo([0, 500, 700, 1500]) === null, 'a tap: four steady taps a half second apart are 120; three, or an uneven four, nothing');
  }

  /* ---------------------------------------------------------------------------------------- LEVELS: the drums, measured */
  if (ctx.levels) {
    const lv = [];
    let hashes = null;
    for (const beat of [B.GUIDE_ID, 'pin:p2', 'pin:p3', 'pin:p4', 'pin:p5']) {
      const store = club({ verse: false });
      store.dispatch([{ type: 'section.add', section: { id: 's_verse', name: 'Verse', start: 0, length: 32 } }], { by: 'you' });
      const bo = B.beatOps(store.get(), { section: 's_verse', beat });
      store.dispatch(bo.ops, { by: 'you' });
      const p = JSON.parse(JSON.stringify(store.get()));
      p.master.inserts = []; p.master.clip = 'clean';
      const out = renderSong(p, { from: 0, to: 32, tracks: [p.room.tracks.drums], tail: 0.5 });
      lv.push({ beat, name: bo.name, lufs: measure(out).lufs, warn: out.warnings.length });
      if (beat === B.GUIDE_ID) hashes = [sha256(out), sha256(renderSong(p, { from: 0, to: 32, tracks: [p.room.tracks.drums], tail: 0.5 }))];
    }
    const guide = lv[0].lufs, verse = lv[1].lufs;
    T.ok(Math.abs(guide - verse) <= 1.5 && lv.every((x) => !x.warn), `the guide beat sits with the club's verse beat: ${n1(guide)} against ${n1(verse)} LUFS (${f1(guide - verse)}), the drums alone, the master out`);
    T.ok(lv.every((x) => Math.abs(x.lufs - guide) <= 4), `every card on the riser within 4 LU of the guide (${lv.map((x) => `${x.name} ${n1(x.lufs)}`).join(', ')})`);
    T.ok(hashes && hashes[0] === hashes[1], `the same song renders the same samples twice (${hashes?.[0]?.slice(0, 12)})`);
  } else T.note('LEVELS=0: the drum level renders skipped');

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const s = await openRoom('/app/?room', { name: 'drummer' });
  const { page, E, errors } = s;
  const shot = (n) => page.screenshot({ path: path.join(ctx.out, `gr-drummer-${n}.png`) }).catch(() => {});
  fs.mkdirSync(ctx.out, { recursive: true });
  const room = () => E(() => {
    const o = window.overdub, R = document.querySelector('.gr')?.__gr, p = o.store.get(), d = p.room?.tracks?.drums;
    const t = p.tracks.find((x) => x.id === d);
    return { run: R?.run(), jam: R ? { on: R.gr.jam.on, kind: R.gr.jam.kind, beat: R.gr.jam.beat, audition: R.gr.jam.audition } : null, beat: p.room?.beat, tempo: p.tempo,
      jams: t ? t.clips.filter((c) => c.name === 'Jam').map((c) => c.start) : null, drums: t ? t.clips.filter((c) => c.name !== 'Jam').length : null,
      playing: o.engine.playing, at: o.engine.beat, cam: R?.gr.cam, hist: o.store.history.length };
  });
  try {
    await E(async () => {
      const o = window.overdub;
      const { planGuitarRoom } = await import('/app/src/core/liveroom/guitar/setup.js');
      if (o.liveRoom.isOpen()) o.liveRoom.close();
      const pl = planGuitarRoom(o.store.get(), {});
      o.store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
      o.liveRoom.open({ screen: 'guitar' });
    });
    await page.waitForFunction(() => !!document.querySelector('.gr')?.__gr?.parts?.drummer, null, { timeout: 15000 });
    await sleep(300);
    // the riser, drawn where the layout says
    const drawn = await E(async () => {
      const { REGIONS } = await import('/app/src/ui/liveroom/guitar/layout.js');
      const box = (el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width) || el.offsetWidth, h: parseFloat(el.style.height) || el.offsetHeight });
      const inside = (b, r, slack = 40) => b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack;
      const L = document.querySelector('.gr-riser');
      const plate = L.querySelector('.grd-plate'), cards = [...L.querySelectorAll('.grd-card')], kit = L.querySelector('.grd-kit'), rib = L.querySelector('.grd-ribbon');
      return { plate: !!plate && inside(box(plate), REGIONS.riser), cards: cards.length, cardsIn: cards.every((c) => inside(box(c), REGIONS.riser)), names: cards.map((c) => c.querySelector('b').textContent), kit: !!kit && inside(box(kit), REGIONS.kit, 2), rib: !!rib, pressed: cards.findIndex((c) => c.getAttribute('aria-pressed') === 'true') };
    });
    T.ok(drawn.plate && drawn.cards === 5 && drawn.cardsIn && drawn.kit && drawn.rib && drawn.pressed === 0, `the riser: the kit, the drummer's plate, ${drawn.cards} beat cards (${drawn.names.join(', ')}; the guide's lit), the book's ribbon, each where the layout puts it`);
    await shot('stage');

    // Space: the jam, from the song's end, nothing in History
    const h0 = (await history(page)).length;
    await press(page, 'Space');
    await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 2, null, { timeout: 15000 }).catch(() => {});
    const j1 = await room();
    T.ok(j1.run === 'jam' && j1.jam.on && j1.jam.kind === 'jam' && j1.playing && j1.jams.length >= 2 && j1.jams[0] === 0 && j1.hist === h0, `Space: the drummer plays the guide from the song's end (bars at ${j1.jams.join(', ')} heard as previews), History as it was (${j1.hist})`);
    await shot('jam');
    // ] swaps the card: one step, at a bar line
    await press(page, 'BracketRight');
    const sw = await E(() => { const R = document.querySelector('.gr').__gr, o = window.overdub; return { beat: o.store.get().room.beat, label: o.store.history.at(-1)?.label, by: o.store.history.at(-1)?.by, n: o.store.history.length, next: document.querySelector('.grd-card[data-next="1"]')?.dataset.pin || null, jamBeat: R.gr.jam.beat }; });
    await page.waitForFunction(() => document.querySelector('.gr').__gr.gr.jam.beat === 'pin:p2', null, { timeout: 8000 }).catch(() => {});
    const sw2 = await room();
    T.ok(sw.beat === 'pin:p2' && sw.by === 'you' && sw.n === h0 + 1 && sw2.jam.beat === 'pin:p2', `] swaps to the next card (${sw.label}), one step by you, the drummer on it from the next bar (marked ${sw.next || 'at once'}; playing ${sw2.jam.beat})`);
    await shot('jam-swapped');
    // Space again: stopped, nothing left
    await press(page, 'Space');
    await sleep(200);
    const j2 = await room();
    T.ok(j2.run === 'idle' && !j2.jam.on && !j2.playing && j2.jams.length === 0 && j2.hist === h0 + 1, `Space again: the drummer stops, every bar of theirs let go (${j2.jams.length} left), History holds only the swap`);

    // the tempo: ← → and ⇧, one step; T taps
    await press(page, 'ArrowRight'); await press(page, 'ArrowRight'); await press(page, 'Shift+ArrowRight');
    const tp = await E(() => ({ tempo: window.overdub.store.get().tempo, label: window.overdub.store.history.at(-1)?.label, n: window.overdub.store.history.length, plate: document.querySelector('.grd-tempo b')?.textContent }));
    await E(() => window.overdub.store.undo());
    const tpu = await E(() => window.overdub.store.get().tempo);
    T.ok(tp.tempo === 144 && tp.n === h0 + 2 && tp.label === 'Tempo 144' && tpu === 132, `→ → ⇧→: 144 BPM on the plate (${tp.plate}), one step (${tp.label}); ⌘Z, back to ${tpu}`);
    await sleep(1600);
    for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyT'); await sleep(500); }
    await sleep(100);
    const tap = await E(() => ({ tempo: window.overdub.store.get().tempo, label: window.overdub.store.history.at(-1)?.label }));
    T.ok(tap.tempo >= 114 && tap.tempo <= 126, `T five times, a half second apart: ${tap.tempo} BPM (${tap.label}; a timed check: under load the taps land late)`);
    await E(() => { const o = window.overdub; while (o.store.history.at(-1)?.reason === 'room:tempo') o.store.undo(); });

    // a selected part, the part line up: its drums too
    const part = await E(async () => {
      const o = window.overdub, R = document.querySelector('.gr').__gr;
      o.store.dispatch([{ type: 'section.add', section: { id: 's_dv', name: 'Verse', start: 0, length: 8 } }], { by: 'you', label: 'A verse' });
      R.L.card = 's_dv'; R.drawer(true);
      const r = R.press('beat:3');
      const p = o.store.get(), t = p.tracks.find((x) => x.id === p.room.tracks.drums);
      const out = { ok: r.ok, label: o.store.history.at(-1)?.label, ops: o.store.history.at(-1)?.ops.map((x) => x.type), clips: t.clips.map((c) => `${c.name}@${c.start}+${c.length}`), partBeat: p.room.parts?.s_dv?.beat };
      o.store.undo();
      R.drawer(false); R.L.card = null;
      o.store.undo();
      return out;
    });
    T.ok(part.ok && part.partBeat === 'pin:p3' && part.clips.join() === 'Gallop@0+8' && part.ops.includes('room.set') && part.ops.includes('clip.add'), `a card picked with a part selected and the part line up: its drums too, one step (${part.label}: ${part.ops.join(', ')})`);

    // K: the book
    await press(page, 'KeyK');
    await sleep(800);
    const bk = await E(() => { const p = document.querySelector('.gr-panel[data-target="kit"]'); return { shown: !!p && !p.hidden, pages: p ? [...p.querySelectorAll('.grd-page h2')].map((x) => x.textContent) : [], pins: p?.querySelectorAll('.grd-pin').length, tabs: p?.querySelectorAll('.grd-tabs button').length, grooves: p?.querySelectorAll('.grd-gv').length, w: p?.getBoundingClientRect().width }; });
    T.ok(bk.shown && bk.pages.join() === 'On the riser,Every groove' && bk.pins === 5 && bk.tabs >= 20 && bk.grooves > 5, `K: the drummer's book (${Math.round(bk.w)} px): ${bk.pages.join(' and ')}, ${bk.pins} cards, ${bk.tabs} styles, ${bk.grooves} grooves on the first`);
    await shot('book');
    // a step on the guide's grid
    const n1h = (await history(page)).length;
    await page.click('.grd-pin[data-pin="p1"] .grd-grid button[data-k="step:p1:kick:6"]');
    await sleep(100);
    const ed = await E(() => { const o = window.overdub, pin = o.store.get().room.pins.find((x) => x.id === 'p1'); return { hits: pin.hits?.length ?? null, label: o.store.history.at(-1)?.label, n: o.store.history.length, cell: document.querySelector('.grd-pin[data-pin="p1"] .grd-grid button[data-k="step:p1:kick:6"]')?.className, card: document.querySelector('.grd-card[data-pin="p1"] small')?.textContent }; });
    T.ok(ed.hits === 9 && ed.n === n1h + 1 && /h1/.test(ed.cell || '') && ed.card === 'yours', `a click on the guide's grid adds a kick: one step (${ed.label}), drawn on the page and the card (${ed.card})`);
    await shot('book-edited');
    await E(() => window.overdub.store.undo());
    // a name typed stays in its field
    await page.click('.grd-pin[data-pin="p2"] input.grd-short', { clickCount: 3 });
    await page.keyboard.type('Chug kb');
    await page.keyboard.press('Enter');
    await sleep(100);
    const nm = await room();
    const nmPin = await E(() => window.overdub.store.get().room.pins.find((x) => x.id === 'p2').name);
    T.ok(nmPin === 'Chug kb' && nm.cam === 'kit', `a card's name typed in the book stays in its field ("${nmPin}"; the camera stayed at ${nm.cam})`);
    await E(() => window.overdub.store.undo());
    // Play now: a groove from the book, the song as it was
    const h2 = (await history(page)).length;
    await page.click('.grd-gv[data-groove="modernmetal/djent-unison-in-threes"] button[data-k^="try:"]');
    await page.waitForFunction(() => window.overdub.engine.playing, null, { timeout: 8000 }).catch(() => {});
    await sleep(600);
    const au = await room();
    T.ok(au.jam.on && au.jam.audition === 'modernmetal/djent-unison-in-threes' && au.beat === 'pin:p2' && au.hist === h2, `Play now: the drummer plays a groove from the book (${au.jam.beat}), the song's beat as it was (${au.beat}), nothing in History`);
    await shot('book-playing');
    await press(page, 'Space');
    await sleep(200);
    // pin, then unpin: the riser holds five
    const pinR = await E(async () => {
      const R = document.querySelector('.gr').__gr, o = window.overdub;
      document.querySelector('.grd-gv[data-groove="modernmetal/djent-unison-in-threes"] button[data-k^="pin:"]')?.click();
      const full = o.store.get().room.pins.length;
      document.querySelector('.grd-pin[data-pin="p5"] button[data-k="unpin:p5"]')?.click();
      await new Promise((r) => setTimeout(r, 50));
      const after = o.store.get().room.pins.length;
      document.querySelector('.grd-gv[data-groove="modernmetal/djent-unison-in-threes"] button[data-k^="pin:"]')?.click();
      await new Promise((r) => setTimeout(r, 50));
      const p = o.store.get().room.pins;
      const out = { full, after, ids: p.map((x) => x.id), last: p.at(-1), labels: o.store.history.slice(-2).map((x) => x.label), run: R.run() };
      o.store.undo(); o.store.undo();
      return out;
    });
    T.ok(pinR.full === 5 && pinR.after === 4 && pinR.ids.length === 5 && new Set(pinR.ids).size === 5 && pinR.last?.name === 'Djent unison', `the riser holds five; an unpin and a pin, one step each (${pinR.labels.join('; ')}), the new card an id nothing else in the song names (${pinR.last?.id})`);
    await press(page, 'Escape');
    await sleep(700);

    // the count-in: the deck's, the sticks; the drummer under the take; let go when the transport stops
    const ci = await E(async () => {
      const o = window.overdub, R = document.querySelector('.gr').__gr;
      window.__lrPlays.length = 0;
      const r = await R.parts.drummer.countIn({ from: 0 });
      await new Promise((res) => setTimeout(res, 400));
      const p = o.store.get(), t = p.tracks.find((x) => x.id === p.room.tracks.drums);
      const out = { ok: r?.ok, downbeat: r?.downbeat, play: window.__lrPlays[0] || null, jams: t.clips.filter((c) => c.name === 'Jam').map((c) => c.start), kind: R.gr.jam.kind, count: document.querySelector('.grd-bar')?.textContent, hist: o.store.history.length };
      o.engine.stop();
      await new Promise((res) => setTimeout(res, 900));
      const t2 = o.store.get().tracks.find((x) => x.id === p.room.tracks.drums);
      out.after = t2.clips.filter((c) => c.name === 'Jam').length;
      out.on = R.gr.jam.on;
      return out;
    });
    T.ok(ci.ok && ci.play?.opts?.countIn?.voice === 'sticks' && ci.play.opts.countIn.beats === 4 && ci.play.from === 0 && Number.isFinite(ci.downbeat), `countIn: the deck counts a bar of sticks into the 1 (${JSON.stringify(ci.play?.opts?.countIn)}), resolving with the downbeat's time`);
    T.ok(ci.kind === 'take' && ci.jams[0] === 0 && ci.after === 0 && !ci.on, `the drummer under the take from the 1 (bars at ${ci.jams.join(', ')}), let go when the transport stopped (${ci.after} left)`);
    await press(page, 'Shift+KeyK');
    const off = await E(async () => {
      const o = window.overdub, R = document.querySelector('.gr').__gr;
      window.__lrPlays.length = 0;
      const pref = R.gprefs.get().countIn;
      const r = await R.parts.drummer.countIn({ from: 0 });
      const play = window.__lrPlays[0] || null;
      o.engine.stop();
      R.parts.drummer.stop();
      R.gprefs.set({ countIn: true });
      return { pref, ok: r?.ok, play };
    });
    T.ok(off.pref === false && off.ok && off.play && !off.play.opts?.countIn, `⇧K turns the count-in off: the take starts on the 1 at once (play from ${off.play?.from}, no count)`);
    await sleep(300);

    // a focused card never takes Space
    await page.focus('.grd-card[data-pin="p3"]');
    const b4 = await E(() => window.overdub.store.get().room.beat);
    await press(page, 'Space');
    await sleep(300);
    const fc = await room();
    await press(page, 'Space');
    await sleep(200);
    T.ok(fc.run === 'jam' && fc.beat === b4, `a beat card with focus: Space is still the drummer's (${fc.run}), the card not pressed (the beat stayed ${fc.beat})`);
    T.ok(!errors.length, `no console or page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await s.close();
  }
}
