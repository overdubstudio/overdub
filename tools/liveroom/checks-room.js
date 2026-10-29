// The live room's checks: the guitar room's ROOM stream [guitar room] (docs/research/GUITAR-ROOM.md; the stream's
// module, app/src/ui/liveroom/guitar/stage.js, says what it owns and its frozen API). Run by tools/liveroom-test.js
// (ONLY=room), whose header says what a checks module exports. The seams it shares with the other streams are
// checks-guitar.js's.
//
// In Node:
//   1. the stage's pixels (room-pixels.js) draw with the room's brushes only, at whole pixels, the same every time,
//      with no red pixel; the tape machine holds still under reduced motion; the kit moves with a hit
//   2. the cab under an amp: the club's 4x12 Modern, an amp's own box, the mics from the amp's params
// In muted Chromium (the club through the door, a fake guitar on the input):
//   3. the stage draws the real rig: the head on its cab, Tuna Fork and every pedal of the chain on the board in
//      signal order, the meter, the jack, the cables; rect(name) is where each thing is drawn; no <select>, no range
//   4. the gear plays: a knob dragged with the mouse, a knob's arrow keys, the head's power, a footswitch clicked, a
//      digit's stomp, a pedal dragged along the board (and into the amp's loop), a tag's arrows, Back in the case:
//      each ONE undo step by you, on both guitars, undone exactly; an agent's edit is drawn too
//   5. keys land: a focused knob takes its arrows but not the room's letters and digits
//   6. the camera frames the drawn gear (head, cab, board, tuner) and Esc comes back; the header's Step back too
//   7. the hotspots: the door to the shop, the tape machine, the kit; + Pedal goes to the shop's case
//   8. the mic dragged across the grille at the cab: POSITION, one step on both guitars
//   9. the meter lights with the fake guitar; the kit API moves the kit; screenshots at 1440, 1280 and 2000 wide
import { openRoom, press, history } from './harness.js';
import { session } from './fake.js';
import { pixelBuffer, isRed } from './checks-pixels.js';

export const name = 'room';
export const pages = true;

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- Node: the pixels */
  const px = await import('../../app/src/ui/liveroom/guitar/room-pixels.js');
  const { PX, MARGIN, STAGE } = await import('../../app/src/ui/liveroom/guitar/layout.js');
  const W = (STAGE.w + MARGIN.x * 2) / PX, H = (STAGE.h + MARGIN.y * 2) / PX;
  const draw = (fn, w, hh) => { const b = pixelBuffer(w, hh); fn(b); return b; };
  const stage = (view) => draw((b) => px.drawStage(px.shifted(b, MARGIN.x / PX, MARGIN.y / PX), view), W, H);
  const a = stage({}), b2 = stage({}), hov = stage({ doorHover: true });
  const reds = (b) => { let n = 0; for (let i = 0; i < b.data.length; i += 4) if (isRed(b.data[i], b.data[i + 1], b.data[i + 2])) n++; return n; };
  const same = (x, y) => Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) === 0;
  T.ok(!a.bad.size && same(a, b2) && !same(a, hov) && !reds(a) && !reds(hov) && a.calls > 1000,
    `the stage's pixels: brushes only (${a.bad.size ? [...a.bad.keys()].join(', ') : 'fillStyle, globalAlpha, fillRect'}), the same every time, the door lights when it's hovered, no red pixel (${reds(a)}; ${a.calls} rects)`);
  const tape = (s) => draw((b) => px.drawTape(b, s), px.TAPE.w, px.TAPE.h);
  const t1 = tape({ rolling: true, bar: 5, input: 0.6, spin: 0.3 }), t2 = tape({ rolling: true, bar: 5, input: 0.6, spin: 1.4 });
  const r1 = tape({ rolling: true, bar: 5, input: 0.6, spin: 0.3, reduced: true }), r2 = tape({ rolling: true, bar: 5, input: 0.6, spin: 1.4, reduced: true });
  const stopped = tape({ rolling: false });
  T.ok(!t1.bad.size && !same(t1, t2) && same(r1, r2) && !same(t1, stopped) && !reds(t1) && !reds(tape({ rolling: true, bar: 12, input: 1, hot: true })),
    'the tape machine: its reels turn while it rolls, hold still under reduced motion, the counter and lamps follow; no red pixel');
  const kit = (s) => draw((b) => px.drawKit(b, s), px.KIT.w, px.KIT.h);
  const k0 = kit({}), k1 = kit({ kick: 1, snare: 1, crash: 1 }), kr = kit({ kick: 1, snare: 1, crash: 1, reduced: true }), kc = kit({ count: 3, tap: 1 });
  T.ok(!k0.bad.size && !same(k0, k1) && same(k0, kr) && !same(k0, kc) && !reds(k1) && !reds(kc), 'the kit: a hit moves it, reduced motion holds it, the sticks count; no red pixel');

  /* ---------------------------------------------------------------------------------------- Node: the cab */
  await import('../../app/src/devices/guitar/index.js');
  const rr = await import('../../app/src/ui/liveroom/guitar/room-rig.js');
  const { CLUB_STACK } = await import('../../app/src/core/liveroom/guitar/setup.js');
  const amp = CLUB_STACK.chain.find((l) => l.device === 'amp.recto');
  const club = rr.cabOf(amp), own = rr.cabOf({ device: 'amp.recto', params: { cab: 0 } }), fridge = rr.cabOf({ device: 'amp.recto', params: { cab: 9 } });
  const modern = rr.cabOf({ device: 'amp.recto', params: { cab: 7 } }), bass = rr.cabOf({ device: 'amp.whale', params: {} }), stack = rr.cabOf({ device: 'core.stack', params: { cab: 4 } });
  const mics = rr.micsOf({ mic: 0, micpos: 0.3, micdist: 1 }), two = rr.micsOf({ mic: 1, mic2: 3, mic2pos: 0.9 });
  const none = rr.micsOf({ mic: 0, micpos: 0.3, micdist: 1 }, 'amp.recto'), placed = rr.micsOf({ cab: 7, mic: 0, micpos: 0.3, micdist: 1 }, 'amp.recto');
  T.ok(club.name === 'Modern 4x12, close dynamic' && club.measured && club.n === 4 && club.box.w === 496 && own.n === 4 && /its own/.test(own.name) && !own.measured && fridge.odd === 'fridge'
    && modern.name === '4x12 Modern' && !modern.measured && /its own/.test(bass.name) && stack.measured && stack.name === 'British 4x12, dynamic'
    && mics.length === 1 && mics[0].type === 'dyn' && two.length === 2 && two[0].type === 'ribbon' && two[1].type === 'cond' && two[1].pos === 0.9 && !none.length && placed.length === 1,
  `the cab under the amp: the club's ${club.name} (measured: no mic to move), the amp's own (${own.name}), the designed ${modern.name}, the fridge; a bass amp on its own (${bass.name}); the Half Stack's ${stack.name}; the mics from the amp's params on a designed cab (${two.map((m) => m.name).join(' + ')})`);

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const riff = { bpm: 132, beats: 4, chord: true, notes: [[0, 40, 0], [0.5, 40, 0], [1, 43, 1], [2, 40, 0], [2.5, 40, 0], [3, 45, 1]] };
  const fake = session({ bpm: 132, lead: 2, tail: 2, parts: [{ kind: 'riff', riff, bar: 1, passes: 60, seed: 3 }] });
  for (const [wd, ht] of [[1440, 900], [1280, 800], [2000, 1200]]) {
    const s = await openRoom('/app/?room', { name: 'gr-room', width: wd, height: ht, fake });
    try { await (wd === 1440 ? checks(T, s, ctx) : shots(T, s, wd)); } finally { await s.close(); }
  }
}

async function intoClub(s) {
  const { page, E } = s;
  await E(async () => { const o = window.overdub; if (o.liveRoom.isOpen()) o.liveRoom.close(); o.liveRoom.open({ screen: 'door' }); await new Promise((r) => setTimeout(r, 300)); });
  await press(page, 'Digit1');
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'guitar' && document.querySelector('.gr-r-head'), null, { timeout: 15000 });
  await E(async () => { try { await window.overdub.input?.audio?.open?.(); } catch { /* the meter says so */ } });
  await page.waitForTimeout(600);
}

async function shots(T, s, wd) {
  await intoClub(s);
  const { page, E } = s;
  await page.waitForTimeout(600);
  await s.shot?.(`liveroom/gr-room-stage-${wd}`);
  const fit = await E(() => {
    const v = document.querySelector('.gr-view').getBoundingClientRect(), ins = (el) => { const r = el.getBoundingClientRect(); return r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1; };
    const gear = [...document.querySelectorAll('.gr-r-head, .gr-r-cab, .gr-r-slot, .gr-r-add, .gr-r-meter')];
    return { all: gear.length, inside: gear.filter(ins).length, scroll: document.documentElement.scrollWidth > innerWidth };
  });
  T.ok(fit.all > 6 && fit.inside === fit.all && !fit.scroll, `at ${wd} wide the whole rig is on screen (${fit.inside} of ${fit.all}), no sideways scroll`);
}

async function checks(T, s, ctx) {
  const { page, E, errors } = s;
  await intoClub(s);
  const shot = (n) => s.shot?.(`liveroom/gr-room-${n}`);
  const rigInfo = () => E(async () => {
    const { rigOf } = await import('/app/src/core/liveroom/guitar/rig.js');
    const r = rigOf(window.overdub.store.get());
    return r ? { devices: r.slots.map((x) => x.device), on: r.slots.map((x) => x.on), same: r.same, tracks: r.tracks.length, amp: r.amp?.slot ?? null, board: r.board.map((x) => x.slot), params: r.slots.map((x) => x.params) } : null;
  });
  // (the song but its meta: the store stamps meta itself, an undo isn't a change back in time)
  const song = () => E(() => { const { meta, ...p } = window.overdub.store.get(); void meta; return JSON.stringify(p); });
  const undo = () => E(() => window.overdub.store.undo());
  const center = (sel, i = 0) => E(({ sel, i }) => { const el = document.querySelectorAll(sel)[i]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, { sel, i });
  // one step by you, both guitars the same, and undone exactly
  async function oneStep(what, act, ok = () => true) {
    const h0 = (await history(page)).length, before = await song(), r0 = await rigInfo();
    await act();
    await page.waitForTimeout(120);
    const h1 = await history(page), r1 = await rigInfo();
    const step = h1.length === h0 + 1 && h1.at(-1).by === 'you';
    const good = !!r1?.same && r1.tracks === 2 && ok(r0, r1);
    await undo();
    await page.waitForTimeout(80);
    const now = await song(), back = now === before;
    let diff = '';
    if (!back) { const x = JSON.parse(before), y = JSON.parse(now); diff = Object.keys({ ...x, ...y }).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).join(', '); }
    T.ok(step && good && back, `${what}: one step by you (${h1.length - h0} step${h1.length - h0 === 1 ? '' : 's'}${h1.at(-1) ? `, “${h1.at(-1).label}”` : ''}), both guitars the same (${r1?.same}), undone exactly (${back}${diff ? ': ' + diff : ''})`);
    return { r0, r1 };
  }

  // 3. the stage, drawn from the real rig
  const drawn = await E(() => {
    const R = document.querySelector('.gr').__gr, room = R.parts.room;
    const rig = R.rig.now();
    const slots = [...document.querySelectorAll('.gr-r-slot')].map((el) => (el.dataset.tuner ? 'tuner' : el.dataset.device));
    const names = ['head', 'cab', 'board', 'meter', 'jack', 'tuner', 'kit', 'riser', 'banner', 'tape', 'door'];
    const cam = R.camera.now(), v = R.el.view.getBoundingClientRect();
    const off = [];
    for (const n of ['head', 'cab', 'board', 'meter', 'tuner']) {
      const r = room.rect(n), el = room.el(n);
      if (!r || !el) { off.push(n + ': none'); continue; }
      const b = el.getBoundingClientRect(), want = { x: v.left + cam.x + r.x * cam.s, y: v.top + cam.y + r.y * cam.s, w: r.w * cam.s, h: r.h * cam.s };
      const d = Math.max(Math.abs(b.left - want.x), Math.abs(b.top - want.y), Math.abs(b.width - want.w), Math.abs(b.height - want.h));
      if (d > 3) off.push(`${n} ${d.toFixed(1)} px`);
    }
    for (const sl of rig.board) { const r = room.rect(`slot:${sl.slot}`), el = room.el(`slot:${sl.slot}`); if (!r || !el) off.push(`slot:${sl.slot}: none`); }
    return {
      want: ['tuner', ...rig.board.map((x) => x.device)], slots, amp: document.querySelector('.gr-r-head')?.dataset.amp, ampWant: rig.amp?.device,
      missing: names.filter((n) => !room.rect(n) || !room.el(n)), off,
      cables: document.querySelectorAll('.gr-r-cables path').length, sel: document.querySelectorAll('.gr select').length, range: document.querySelectorAll('.gr input[type=range]').length,
      keycaps: [...document.querySelectorAll('.gr-r-keycap')].map((k) => k.textContent),
      hasKit: typeof room.kit === 'function',
    };
  });
  T.ok(drawn.slots.join() === drawn.want.join() && drawn.amp === drawn.ampWant && drawn.cables >= 8, `the stage draws the real rig: ${drawn.amp} on its cab, the board in signal order (${drawn.slots.join(' → ')}), ${drawn.cables / 2} cables`);
  T.ok(!drawn.missing.length && !drawn.off.length, `rect(name) and el(name) are where each thing is drawn (${drawn.missing.length ? 'missing: ' + drawn.missing.join(', ') : 'all 11'}${drawn.off.length ? '; off: ' + drawn.off.join(', ') : ''})`);
  T.ok(!drawn.sel && !drawn.range && drawn.keycaps[0].startsWith('U') && drawn.keycaps[1].startsWith('1'), `no <select>, no range input (${drawn.sel}, ${drawn.range}); keycaps ${drawn.keycaps.join(', ')}`);
  await shot('stage');

  // 4. the gear plays: each one step by you on both guitars, undone exactly
  // a knob, dragged
  const gain = await center('.gr-r-head .kn-dial', 0);
  await oneStep('the head’s GAIN dragged up with the mouse', async () => {
    await page.mouse.move(gain.x, gain.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(gain.x, gain.y - i * 6);
    await page.mouse.up();
  }, (a, b) => b.params[b.amp].gain > a.params[a.amp].gain);
  const said = await E(() => document.querySelector('.lr-talkback')?.textContent || '');
  T.ok(/Gain [\d.]+ on Kraken/.test(said), `the talkback says what turned ("${said.trim().slice(0, 80)}")`);
  // a knob's keys: three presses coalesce
  await page.waitForTimeout(1600);
  await oneStep('the head’s BASS turned with ↑ ↑ ↑ (a focused knob takes its arrows)', async () => {
    await E(() => document.querySelectorAll('.gr-r-head .kn-dial')[1].focus());
    for (let i = 0; i < 3; i++) await press(page, 'ArrowUp');
  }, (a, b) => b.params[b.amp].bass > a.params[a.amp].bass);
  // 5. a focused knob doesn't swallow the room's letters and digits
  await page.waitForTimeout(1600);
  await E(() => document.querySelectorAll('.gr-r-head .kn-dial')[1].focus());
  const h5 = (await history(page)).length;
  await press(page, 'Digit1');
  const k5 = { stomp: (await history(page)).length === h5 + 1 };
  await undo();
  await E(() => document.querySelectorAll('.gr-r-head .kn-dial')[1].focus());
  await press(page, 'KeyB');
  k5.cam = await E(() => window.overdub.ui.state.liveRoom.gr.cam);
  await press(page, 'Escape');
  await page.waitForTimeout(700);
  T.ok(k5.stomp && k5.cam === 'board', `keys land with a knob focused: 1 stomps (${k5.stomp}), B goes to the board (${k5.cam})`);
  // the head's power
  await oneStep('the head’s power switch', async () => { await E(() => document.querySelector('.gr-r-head .amp-pwr').click()); },
    (a, b) => b.on[b.amp] !== a.on[a.amp]);
  // a footswitch clicked, and a digit
  await oneStep('Snapper’s footswitch clicked', async () => { await E(() => document.querySelector('.gr-r-slot[data-device="pedal.gate"] .pd-sw').click()); }, (a, b) => b.on[0] !== a.on[0]);
  // a footswitch the mouse pressed doesn't keep the hand: Enter is the room's (play), not a second stomp
  const sw = await center('.gr-r-slot[data-device="pedal.gate"] .pd-sw');
  const h7 = (await history(page)).length;
  await page.mouse.click(sw.x, sw.y);
  await page.waitForTimeout(80);
  const held7 = await E(() => !!document.activeElement?.closest('.gr-r-slot'));
  await press(page, 'Enter');
  await page.waitForTimeout(80);
  const n7 = (await history(page)).length - h7;
  for (let i = 0; i < n7; i++) await undo();
  T.ok(!held7 && n7 === 1, `a footswitch clicked with the mouse doesn't keep the focus (${held7}), so Enter isn't a second stomp (${n7} step${n7 === 1 ? '' : 's'})`);
  await oneStep('2 stomps the second pedal', async () => { await E(() => document.querySelector('.lr').focus()); await press(page, 'Digit2'); }, (a, b) => b.on[a.board[1]] !== a.on[a.board[1]]);
  // a pedal dragged along the board: Snapper after Mantis Boost
  const sn = await center('.gr-r-slot[data-device="pedal.gate"]'), mb = await center('.gr-r-slot[data-device="pedal.mantisboost"]');
  const dragTo = async (from, x) => {
    const y = from.y - from.h * 0.12;
    await page.mouse.move(from.x + from.w * 0.3, y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.w * 0.3 + ((x - from.x) * i) / 10, y);
    await page.mouse.up();
  };
  await oneStep('Snapper dragged past Mantis Boost', () => dragTo(sn, mb.x + mb.w * 0.4), (a, b) => b.devices.indexOf('pedal.gate') === a.devices.indexOf('pedal.mantisboost') && b.devices.length === a.devices.length);
  const echo = await center('.gr-r-slot[data-device="pedal.delay"]');
  await oneStep('Mantis Boost dragged into the amp’s loop', () => dragTo(mb, echo.x + echo.w * 0.6), (a, b) => b.devices.indexOf('pedal.mantisboost') > b.amp && a.devices.indexOf('pedal.mantisboost') < a.amp);
  // Esc lets go of a pedal mid-drag: it goes back, stays back while the hand moves on, and nothing changes
  const h6 = (await history(page)).length, sn2 = await center('.gr-r-slot[data-device="pedal.gate"]');
  const left0 = await E(() => document.querySelector('.gr-r-slot[data-device="pedal.gate"]').style.left);
  await page.mouse.move(sn2.x + sn2.w * 0.3, sn2.y - sn2.h * 0.12); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(sn2.x + sn2.w * 0.3 + i * 30, sn2.y - sn2.h * 0.12);
  const mid = await E(() => document.querySelector('.gr-r-slot[data-device="pedal.gate"]').style.left);
  await press(page, 'Escape');
  for (let i = 6; i <= 10; i++) await page.mouse.move(sn2.x + sn2.w * 0.3 + i * 30, sn2.y - sn2.h * 0.12);
  const held = await E(() => document.querySelector('.gr-r-slot[data-device="pedal.gate"]').style.left);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after6 = { left: await E(() => document.querySelector('.gr-r-slot[data-device="pedal.gate"]').style.left), steps: (await history(page)).length - h6, cam: await E(() => window.overdub.ui.state.liveRoom.gr.cam) };
  T.ok(mid !== left0 && held === left0 && after6.left === left0 && after6.steps === 0 && after6.cam === 'stage', `Esc lets go of a pedal mid-drag: back where it was (${left0}; mid-drag ${mid}, after Esc ${held}, after the button ${after6.left}), no step (${after6.steps}), the camera stays (${after6.cam})`);
  // at the board: the tags' arrows and Back in the case
  await E(() => window.overdub.liveRoom.press('cam:board'));
  await page.waitForTimeout(800);
  await shot('board');
  // the hand stays on the tag's arrow across the new drawing (pressed again and again from the keys)
  // (reached with the keys: Shift+Tab from its →, then pressed; ui/liveroom/index.js's hold on Enter keeps Enter from
  // a focused button in the live room, so the press is the button's click)
  const kept = {};
  const arrowSel = '.gr-r-tag[data-device="pedal.delay"] [aria-label^="Move Echo Reef earlier"]';
  await E(() => document.querySelector('.gr-r-tag[data-device="pedal.delay"] [aria-label^="Move Echo Reef later"]').focus());
  await press(page, 'Shift+Tab');
  const h8 = (await history(page)).length;
  kept.on = await E((sel) => document.activeElement === document.querySelector(sel), arrowSel);
  await E((sel) => document.activeElement.matches(sel) && document.activeElement.click(), arrowSel);
  await page.waitForTimeout(60);
  const arrowHeld = () => E((sel) => document.activeElement === document.querySelector(sel), arrowSel);
  kept.moved = (await history(page)).length === h8 + 1;
  kept.a = await arrowHeld();
  if (kept.moved) await undo();
  await page.waitForTimeout(60);
  kept.b = await arrowHeld();
  T.ok(kept.on && kept.moved && kept.a && kept.b, `a tag's ← reached with the keys moves the pedal (${kept.moved}) and keeps the hand on it through the move and its undo (${kept.a}, ${kept.b})`);
  // (pressed with the mouse, it gives the keys back to the room: ui/liveroom/index.js)
  const ar = await center('.gr-r-tag[data-device="pedal.delay"] [aria-label^="Move Echo Reef earlier"]');
  const h9 = (await history(page)).length;
  await page.mouse.click(ar.x, ar.y);
  await page.waitForTimeout(80);
  const mouse9 = { moved: (await history(page)).length === h9 + 1, held: await E(() => !!document.activeElement?.closest('.gr-r-tag')) };
  if (mouse9.moved) await undo();
  await page.waitForTimeout(60);
  T.ok(mouse9.moved && !mouse9.held, `a tag's ← clicked with the mouse moves the pedal (${mouse9.moved}) and gives the keys back to the room (held: ${mouse9.held})`);
  await oneStep('Echo Reef’s tag: ← (before the amp)', () => E(() => document.querySelector('.gr-r-tag[data-slot="3"] [aria-label^="Move Echo Reef earlier"]').click()), (a, b) => b.devices.indexOf('pedal.delay') < b.amp);
  await oneStep('Lobster Plate: Back in the case', () => E(() => [...document.querySelectorAll('.gr-r-tag button')].find((x) => x.textContent === 'Back in the case' && x.closest('.gr-r-tag').textContent.includes('Lobster')).click()), (a, b) => !b.devices.includes('pedal.lobsterplate') && b.devices.length === a.devices.length - 1);
  // an agent's edit is drawn too (the drawing follows the song, whoever changed it)
  const agent = await E(async () => {
    const o = window.overdub, { planStomp } = await import('/app/src/core/liveroom/guitar/rig.js');
    const p = planStomp(o.store.get(), { slot: 1 });
    o.store.dispatch(p.ops, { by: 'claude', label: p.label });
    await new Promise((r) => setTimeout(r, 50));
    const off = document.querySelector('.gr-r-slot[data-slot="1"]')?.classList.contains('gr-r-off');
    o.store.undo();
    await new Promise((r) => setTimeout(r, 50));
    return { off, back: !document.querySelector('.gr-r-slot[data-slot="1"]')?.classList.contains('gr-r-off') };
  });
  T.ok(agent.off && agent.back, `Claude stomping pedal 2 is drawn on the board, and its undo too (${agent.off}, ${agent.back})`);
  await press(page, 'Escape');
  await page.waitForTimeout(700);

  // 6. the camera frames the drawn gear, and Esc comes back
  const cams = [];
  for (const t of ['head', 'cab', 'board', 'tuner']) {
    await E((t) => window.overdub.liveRoom.press('cam:' + t), t);
    await page.waitForTimeout(800);
    const r = await E((t) => {
      const R = document.querySelector('.gr').__gr, v = R.el.view.getBoundingClientRect(), s = R.camera.now().s;
      // (the board: every pedal on it and the + pedal; the board itself runs the stage's width)
      const els = t === 'board' ? [...document.querySelectorAll('.gr-r-slot, .gr-r-add')] : [R.parts.room.el(t)];
      const inside = els.every((el) => { const b = el.getBoundingClientRect(); return b.left >= v.left - 2 && b.right <= v.right + 2 && b.top >= v.top - 2 && b.bottom <= v.bottom + 2; });
      const b = R.parts.room.el(t).getBoundingClientRect(), back = document.querySelector('.gr-r-back');
      return { s, inside, share: (Math.min(b.width, v.width) * Math.min(b.height, v.height)) / (v.width * v.height), back: !!back && !back.hidden };
    }, t);
    await shot(`cam-${t}`);
    await press(page, 'Escape');
    await page.waitForTimeout(750);
    cams.push({ t, ...r, home: await E(() => window.overdub.ui.state.liveRoom.gr.cam) });
  }
  T.ok(cams.every((c) => c.s > 1 && c.inside && c.back && c.home === 'stage'), `the camera frames the drawn gear and Esc comes back (${cams.map((c) => `${c.t} ×${c.s.toFixed(2)} ${Math.round(c.share * 100)}% of the view${c.inside ? '' : ' (cut off)'}${c.home === 'stage' ? '' : ', back at ' + c.home}`).join('; ')})`);
  await E(() => window.overdub.liveRoom.press('cam:head'));
  await page.waitForTimeout(700);
  await E(() => document.querySelector('.gr-r-back').click());
  await page.waitForTimeout(700);
  const hb = await E(() => ({ cam: window.overdub.ui.state.liveRoom.gr.cam, hidden: document.querySelector('.gr-r-back').hidden, panel: document.querySelector('.gr-panel[data-target=head]')?.textContent || '' }));
  T.ok(hb.cam === 'stage' && hb.hidden && /Kraken/.test(hb.panel) && /In the spirit of/.test(hb.panel), `the header’s Step back comes back from the head (${hb.cam}), and hides on the stage; the head's panel names Kraken and its spirit`);

  // 7. the hotspots: the tape machine, the kit, the door; + Pedal to the shop's case
  const hotTape = await E(async () => {
    const R = document.querySelector('.gr').__gr, seen = [];
    const off = R.on('press', (d) => seen.push(d.id));
    document.querySelector('.gr-r-hot[data-hot=tape]').click();
    off();
    return seen;
  });
  await E(() => document.querySelector('.gr-r-hot[data-hot=kit]').click());
  await page.waitForTimeout(400);
  const kitCam = await E(() => window.overdub.ui.state.liveRoom.gr.cam);
  await press(page, 'Escape');
  await page.waitForTimeout(700);
  await E(() => document.querySelector('.gr-r-hot[data-hot=door]').click());
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'shop', null, { timeout: 5000 }).catch(() => {});
  const door = await E(() => window.overdub.ui.state.liveRoom.gr.world);
  await press(page, 'KeyS');
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'stage', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await E(() => document.querySelector('.gr-r-add').click());
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'shop', null, { timeout: 5000 }).catch(() => {});
  const add = await E(() => ({ world: window.overdub.ui.state.liveRoom.gr.world, cam: window.overdub.ui.state.liveRoom.gr.cam }));
  await press(page, 'KeyS');
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'stage', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  T.ok(hotTape.includes('tape') && kitCam === 'kit' && door === 'shop' && add.world === 'shop' && add.cam === 'case', `the hotspots: the tape machine presses tape (${hotTape.join(', ')}), the kit opens the book (${kitCam}), the door is the shop (${door}); + Pedal goes to the shop's case (${add.world} ${add.cam})`);

  // 8. a mic dragged across the grille, close up at the cab (the club's Kraken stands on a measured cab, its mic part of
  // the measurement: the cab zoom's builder puts it on the designed 4x12 Modern first, which takes mics)
  await E(() => window.overdub.liveRoom.press('cam:cab'));
  await page.waitForTimeout(800);
  const measuredMics = await E(() => document.querySelectorAll('.gr-r-mic:not([hidden])').length);
  await E(() => [...document.querySelectorAll('.gr-panel[data-target=cab] .grs-cablist:not(.measured) .grs-chip')].find((b) => b.textContent === '4x12 Modern')?.click());
  await page.waitForTimeout(500);
  const designedMics = await E(() => document.querySelectorAll('.gr-r-mic:not([hidden])').length);
  T.ok(measuredMics === 0 && designedMics >= 1, `at the cab: no mic stands in front of the measured cab (${measuredMics}); on the designed 4x12 Modern, ${designedMics} to move`);
  const mic = await center('.gr-r-mic-body'), cone = await E(() => { const c = document.querySelectorAll('.gr-r-cone')[3].getBoundingClientRect(); return { x: c.left + c.width * 0.97, y: c.top + c.height * 0.5 }; });
  await oneStep('the mic dragged out to the fourth cone’s edge', async () => {
    await page.mouse.move(mic.x, mic.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(mic.x + ((cone.x - mic.x) * i) / 12, mic.y + ((cone.y - mic.y) * i) / 12);
    await page.mouse.up();
  }, (a, b) => (b.params[b.amp].micpos ?? 0.3) > 0.6);
  await shot('cam-cab-mic');
  await press(page, 'Escape');
  await page.waitForTimeout(700);

  // 9. the meter with the fake guitar, the kit API, slot:<n>
  await page.waitForTimeout(800);
  const meter = await E(() => ({ lit: document.querySelectorAll('.gr-r-leds i.gr-on').length, db: document.querySelector('.gr-r-db').textContent, open: !!window.overdub.input?.audio?.state?.open }));
  T.ok(!meter.open || (meter.lit > 0 && /dBFS/.test(meter.db)), `the meter on the head lights with the fake guitar (${meter.lit} lamps, ${meter.db}; input open: ${meter.open})`);
  // (one kit on the riser: the drummer stream draws its own, canvas[data-kit], and the room's hides; with it taken
  // away the room's kit API still moves the room's)
  const kitMoved = await E(async () => {
    const R = document.querySelector('.gr').__gr, cv = document.querySelector('canvas.gr-r-kit'), g = cv.getContext('2d');
    const theirs = document.querySelector('.gr-riser canvas[data-kit]');
    const one = !!theirs && cv.hidden;
    const two = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const kept = theirs?.dataset.kit;
    if (theirs) delete theirs.dataset.kit;
    await two();
    const snap = () => Array.from(g.getImageData(0, 0, cv.width, cv.height).data).join();
    const a = snap();
    R.parts.room.kit({ kick: 1, snare: 1, crash: 1 });
    await two();
    const b = snap();
    R.parts.room.kit(null);
    await two();
    const back = snap() === a;
    if (theirs) theirs.dataset.kit = kept;
    await two();
    return one && a !== b && back && cv.hidden;
  });
  T.ok(kitMoved, 'one kit on the riser (the drummer\'s; the room\'s hides), and the room\'s kit API moves it with a hit (kit({ kick, snare, crash })) and back to rest (kit(null))');
  const slot = await E(async () => {
    const o = window.overdub, R = document.querySelector('.gr').__gr;
    const r = o.liveRoom.press('slot:1');
    await new Promise((res) => setTimeout(res, 50));
    return { ok: r.ok, cam: R.gr.cam, focus: !!document.activeElement?.closest('.gr-r-slot[data-slot="1"]'), mark: document.querySelector('.gr-r-slot[data-slot="1"]').classList.contains('gr-r-focus') };
  });
  await press(page, 'Escape');
  await page.waitForTimeout(700);
  slot.after = await E(() => ({ marks: document.querySelectorAll('.gr-r-slot.gr-r-focus').length, slot: window.overdub.ui.state.liveRoom.gr.slot }));
  T.ok(slot.after.marks === 0 && slot.after.slot == null, `back on the stage the pedal in focus is let go (${slot.after.marks} marked, gr.slot ${slot.after.slot})`);
  T.ok(slot.ok && slot.cam === 'board' && slot.focus && slot.mark, `slot:1 goes to the board and puts the hand on pedal 2 (${slot.cam}, focused ${slot.focus})`);
  // (one of each: Talk to Claude is the tape stream's, in the strip's talkback; Getting started the start stream's)
  const strip = await E(() => ({ talk: document.querySelectorAll('.gr-strip button').length && [...document.querySelectorAll('.gr-strip button')].filter((b) => /Talk to Claude/.test(b.textContent)).length, drawer: document.querySelector('.gr-strip-tools .gr-r-chip')?.textContent || '', gs: [...document.querySelectorAll('.lr-tools button')].filter((b) => /^Getting started/.test(b.textContent)).length }));
  T.ok(strip.talk === 1 && /Riffs/.test(strip.drawer) && /Part line/.test(strip.drawer) && strip.gs === 1, `the strip's buttons (one Talk to Claude: ${strip.talk}; ${strip.drawer.replace(/\s+/g, ' ').trim()}) and one Getting started in the header (${strip.gs})`);
  T.ok(!errors.length, `no console or page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  void ctx;
}
