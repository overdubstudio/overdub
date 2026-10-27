// The live room's checks: the guitar room's START stream [guitar room] (docs/research/GUITAR-ROOM.md §2.1; the
// stream's module, app/src/ui/liveroom/guitar/start.js, says what it owns and its API). Run by tools/liveroom-test.js
// (ONLY=start), whose header says what a checks module exports. The seams it shares with the other streams are
// checks-guitar.js's.
//   Node: the steps and the tour (./start-plan.js): every step's shot frames something on the stage and lights it;
//     every word the slate, the tuner and the talkback say keeps the room's copy rules (checks-copy.js breaks)
//   muted Chromium, a fake interface (input 1 quiet, a guitar on input 2: drop C's low C, 13 cents flat, plucked every
//   two seconds and peaking at −9 dBFS), the club opened with planGuitarRoom on the screen 'guitar':
//     1. Getting started stays down in a check's browser and comes up by itself in a visitor's, once, at Plug in
//     2. Plug in: Enter opens the input; input 2 is picked by itself (the one moving); the meter says the strum is in
//        the window; the jack lights
//     3. Tune: U stomps the Tuna Fork; the camera goes to it; you're muted; its window and its panel read C2, about 13
//        cents flat, on string 6; U again and the monitor's back as it was. A tuning picked on it is one step by you
//        (the song's tuning and the guitars' low cut), undone exactly
//     4. the tuner never leaves you muted: off, a take starting, Getting started skipped, the screen unmounted
//     5. Timing: eight clicks (latency.measure faked: the clicks are sound), a good run kept for the interface
//     6. Your sound names the stack; the tour's seven stops each put the camera on its thing; Done finishes it (gprefs
//        gs.done), the slate and the spotlight gone, the camera home
//     7. Esc pauses it where it is; the header's button carries on from there
//     8. keys land: a slate button the mouse pressed doesn't take Space or U; no <select> or range slider anywhere in
//        it; no console or page errors
//   Screenshots: tools/.out/liveroom/gr-start-*.png
import path from 'node:path';
import { openRoom, press, history, OUT } from './harness.js';
import { SR } from './fake.js';
import { breaks } from './checks-copy.js';
import { string as pluck } from '../strings.js';

export const name = 'start';
export const pages = true;

const W_ = '../../app/src/ui/liveroom/guitar/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a stereo interface: input 1 a faint hiss, input 2 drop C's low C 13 cents flat, plucked every 2 s at −9 dBFS
function fakeGuitar() {
  const len = 12, n = SR * len, one = new Float32Array(n), two = new Float32Array(n);
  for (let k = 0; k < 6; k++) {
    const s = pluck(36, { sr: SR, dur: 1.9, cents: -13, at: 0.05 + k * 2, len, peak: -9, pickup: 0.1, hum: -70, noise: -80, seed: 3 + k });
    for (let i = 0; i < n; i++) two[i] += s.buf[i];
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(two[i]));
  for (let i = 0; i < n; i++) two[i] *= 10 ** (-9 / 20) / pk;
  let s = 7;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; one[i] = (s / 2147483647 - 0.5) * 2e-4; }
  return { wav: { sr: SR, channels: [one, two] } };
}

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- Node */
  const plan = await import(W_ + 'start-plan.js');
  const { REGIONS, STAGE } = await import(W_ + 'layout.js');
  const m = await import(W_ + 'start.js');
  T.ok(typeof m.mount === 'function', 'the start stream\'s module exports mount(R)');
  T.ok(plan.STEPS.map((s) => s.id).join() === 'plug,tune,time,sound,tour' && plan.stepAfter('plug') === 'tune' && plan.stepAfter('tour') === null,
    `Getting started's steps: ${plan.STEPS.map((s) => s.label).join(', ')}`);
  const rect = (n) => (REGIONS[n] ? { ...REGIONS[n] } : null);
  const inStage = (r) => r.w > 0 && r.h > 0 && r.x < STAGE.w && r.y < STAGE.h && r.x + r.w > 0 && r.y + r.h > 0;
  const shots = [...['plug', 'tune', 'time', 'sound'].map((s) => [s, plan.shotOf(s, { rect })]), ['plug close', plan.shotOf('plug', { rect, close: true })],
    ...plan.TOUR.map((s, i) => [`tour ${s.id}`, plan.shotOf('tour', { rect, tour: i })])];
  const badShot = shots.filter(([, s]) => !inStage(s.R) || !(s.at === 'strip' || (s.at.length && s.at.every(inStage))));
  T.ok(!badShot.length, `every step and tour stop frames something on the stage and lights it (${shots.length} shots)${badShot.length ? ': ' + badShot.map(([k]) => k).join(', ') : ''}`);
  const words = plan.allWords();
  const LABEL = /^W\.(esc|plugOther|tunerHead|tunerTunings|tunerLook)$/;
  const broken = words.filter((w) => !LABEL.test(w.id)).flatMap((w) => breaks(w.id, w.text).map((b) => `${w.id}: ${b.rule} ${b.why} ("${w.text}")`));
  T.ok(!broken.length, `every word Getting started and the tuner say keeps the room's copy rules (${words.length} lines)${broken.length ? ': ' + broken.join('; ') : ''}`);
  const tun = [
    plan.tunerSays({ p: 36, note: 'C', octave: 2, live: true, shown: -13, inTune: false, string: { name: 'Low C', number: 6, cents: -13 } }),
    plan.tunerSays({ p: 36, note: 'C', octave: 2, live: true, shown: 0, inTune: true, string: { name: 'Low C', number: 6, cents: 0 } }),
    plan.tunerSays({ p: 40, note: 'E', octave: 2, live: true, shown: 2, inTune: false, string: { name: 'Low C', number: 6, cents: 402 } }),
  ];
  T.ok(tun[0] === 'Low C string (6): 13 cents flat.' && tun[1] === 'Low C string (6) is in tune.' && /tune down to C/.test(tun[2]), `the tuner's words: "${tun.join('" / "')}"`);

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  // 1. a check's browser: it stays down
  {
    const s = await openRoom('/app/?room', { name: 'start-quiet' });
    try {
      await openClub(s.E);
      await wait(900);
      const r = await s.E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step(), overlay: window.overdub.ui.state.liveRoom.gr.overlay, btn: document.querySelector('.lr-tools .gr-gs-btn')?.textContent || '' }));
      T.ok(r.step === null && r.overlay === null && r.btn === 'Getting started', `in a check's browser Getting started stays down until asked (the header's button: "${r.btn}")`);
      T.ok(!s.errors.length, `no errors (quiet)${s.errors.length ? ': ' + s.errors.slice(0, 3).join(' | ') : ''}`);
    } finally { await s.close(); }
  }

  const fake = fakeGuitar();
  const s = await openRoom('/app/?room', { name: 'start', fake, webdriver: false });
  const { page, E, errors } = s;
  const shot = (n) => page.screenshot({ path: path.join(OUT, `gr-start-${n}.png`) });
  try {
    await openClub(E);
    await page.waitForFunction(() => document.querySelector('.gr')?.__gr?.parts.start?.step() === 'plug', null, { timeout: 5000 }).catch(() => {});
    const first = await E(() => {
      const R = document.querySelector('.gr').__gr, co = document.querySelector('.gr-callout');
      return { step: R.parts.start.step(), overlay: R.gr.overlay, cam: R.gr.cam, shown: !co.hidden && co.offsetWidth > 0, where: document.querySelector('.lr-where')?.textContent || '', dim: !document.querySelector('.gr-gs-dim').hidden };
    });
    T.ok(first.step === 'plug' && first.overlay === 'gs' && first.shown && first.cam === 'gs' && first.dim && /Getting started/.test(first.where),
      `in a visitor's browser it comes up by itself at Plug in: the slate up, the camera on the board's end, the room dimmed round it ("${first.where}")`);
    await shot('plug');

    // 2. plug in
    await press(page, 'Enter');
    await page.waitForFunction(() => window.overdub.input.audio.state.open, null, { timeout: 8000 }).catch(() => {});
    // (the fake isn't an interface the browser names, so monitoring is turned on here as an interface's would be)
    await E(() => window.overdub.input.audio.monitor(true));
    await page.waitForFunction(() => String(window.overdub.input.audio.state.channel) === '2', null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => /window/i.test(document.querySelector('.gr-callout .gg-lv-say')?.textContent || ''), null, { timeout: 9000 }).catch(() => {});
    const plug = await E(() => {
      const a = window.overdub.input.audio, co = document.querySelector('.gr-callout');
      return { open: a.state.open, ch: a.state.channel, chs: a.state.channels, say: co.querySelector('.gg-lv-say')?.textContent || '', from: co.querySelector('.gr-co-from')?.textContent || '', ring: !document.querySelector('.gr-gs-ring').hidden };
    });
    T.ok(plug.open && plug.ch === '2' && plug.ring, `Enter plugs in: ${plug.from} (input ${plug.ch} of ${plug.chs}, picked as the one moving), and the jack lights`);
    T.ok(/Right in the window/.test(plug.say), `the meter puts the strum in the −12 to −6 window and says so: "${plug.say}"`);
    await shot('plug-in');
    await press(page, 'Enter');
    const toTune = await E(() => document.querySelector('.gr').__gr.parts.start.step());
    T.ok(toTune === 'tune', `Enter: Next, to Tune (${toTune})`);
    await wait(700);
    await shot('tune');

    // 3. tune
    const mon0 = await E(() => window.overdub.input.audio.state.monitoring);
    await press(page, 'KeyU');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.cam === 'tuner', null, { timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => /^C/.test(document.querySelector('.gr-tf-note')?.textContent || '') && /STRING 6/.test(document.querySelector('.gr-tf-str')?.textContent || ''), null, { timeout: 9000 }).catch(() => {});
    await wait(1500);
    const tune = await E(() => {
      const o = window.overdub, gr = o.ui.state.liveRoom.gr, p = document.querySelector('.gr-panel[data-target=tuner]');
      return { on: gr.tuner.on, mon: o.input.audio.state.monitoring, was: gr.tuner.monitorWas, cam: gr.cam, panel: !!p && !p.hidden, note: document.querySelector('.gr-tf-note')?.textContent || '', str: document.querySelector('.gr-tf-str')?.textContent || '',
        cents: document.querySelector('.gr-tf-cents')?.textContent || '', verdict: p?.querySelector('.gr-tp-verdict')?.textContent || '', side: document.querySelector('.gr-callout')?.dataset.side, gauge: p?.querySelector('.gg-tu-note')?.textContent || '' };
    });
    const cents = Number(String(tune.cents).replace('−', '-').replace('¢', ''));
    T.ok(tune.on && mon0 && !tune.mon && tune.was === true && tune.cam === 'tuner' && tune.panel && tune.side === 'left',
      `U stomps the Tuna Fork: the camera on it, its panel up, the slate to the left, you muted (monitoring ${mon0} → ${tune.mon})`);
    T.ok(/^C2?$/.test(tune.note) && tune.str === 'STRING 6' && Math.abs(cents + 13) <= 3 && /\bC string \(6\)/.test(tune.verdict),
      `its window reads ${tune.note} ${tune.str} ${tune.cents} (the fake: C2, 13 cents flat); the panel: "${tune.verdict}" (gauge ${tune.gauge})`);
    await shot('tuner');
    await press(page, 'KeyU');
    const off = await E(() => ({ on: window.overdub.ui.state.liveRoom.gr.tuner.on, mon: window.overdub.input.audio.state.monitoring, cam: window.overdub.ui.state.liveRoom.gr.cam, slate: document.querySelector('.gr-callout').textContent }));
    T.ok(!off.on && off.mon && off.cam === 'gs' && /Next: timing/.test(off.slate), `U again: off, you're back on (monitoring ${off.mon}), the camera back on the step, Next: timing offered`);

    // a tuning picked on the tuner: the song's, one step by you, undone exactly
    const h0 = (await history(page)).length;
    const tun1 = await E(async () => {
      const o = window.overdub, R = document.querySelector('.gr').__gr;
      const before = JSON.stringify({ room: o.store.get().room, tracks: o.store.get().tracks });
      const was = o.store.get().room.tuning;
      R.parts.start.tuner(true);
      await new Promise((r) => setTimeout(r, 100));
      const chip = [...document.querySelectorAll('.gr-panel[data-target=tuner] .gr-tp-chips button')].find((b) => b.textContent === 'C standard');
      chip?.click();
      const p = o.store.get(), last = o.store.history.at(-1);
      const out = { was, now: p.room.tuning, label: last?.label, by: last?.by, chip: !!chip, steps: o.store.history.length };
      o.store.undo();
      out.back = JSON.stringify({ room: o.store.get().room, tracks: o.store.get().tracks }) === before;
      o.store.redo(); o.store.undo();
      R.parts.start.tuner(false);
      return out;
    });
    T.ok(tun1.chip && tun1.now === 'c-standard' && tun1.by === 'you' && /C standard/.test(tun1.label || '') && tun1.back && tun1.steps === h0 + 1,
      `a tuning picked on the tuner is the song's: one step by you ("${tun1.label}", ${tun1.was} → ${tun1.now}), undone exactly`);

    // 4. never left muted
    const never = await E(async () => {
      const o = window.overdub, a = o.input.audio, R = document.querySelector('.gr').__gr, st = R.parts.start;
      const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const out = {};
      a.monitor(true);
      st.tuner(true); await tick(); out.muted = !a.state.monitoring;
      // a take starts while it's on
      R.run('take'); await tick(); out.take = { on: o.ui.state.liveRoom.gr.tuner.on, mon: a.state.monitoring }; R.run('idle');
      // refused while a take runs
      R.run('take'); out.refused = st.tuner(true) === false && a.state.monitoring; R.run('idle');
      // Getting started skipped past it
      st.tuner(true); await tick(); R.press('gs:skip'); await tick(); out.skip = { on: o.ui.state.liveRoom.gr.tuner.on, mon: a.state.monitoring, step: st.step() };
      // monitoring turned on again by an input reopened while it's on: off again
      st.tuner(true); await tick(); a.monitor(true); await tick(); await tick(); out.held = !a.state.monitoring;
      st.tuner(false);
      // monitoring was off before: it stays off after
      a.monitor(false); st.tuner(true); await tick(); st.tuner(false); out.stayOff = !a.state.monitoring;
      a.monitor(true);
      return out;
    });
    T.ok(never.muted && !never.take.on && never.take.mon && never.refused && !never.skip.on && never.skip.mon && never.held && never.stayOff,
      `the tuner never leaves you muted: a take turns it off (monitoring ${never.take.mon}) and it waits while one runs; skipped past (${never.skip.step}), back on; an input that comes back on is muted again; off before, off after`);

    // 5. timing (the step after skipping Tune)
    await E(async () => {
      const a = window.overdub.input.audio, lat = a.latency;
      const { judgeTaps } = await import('/app/src/input/latency.js');
      const hits = [12, 9, 14.1, 15.9, 13.2, 15.0, 16.8, 14.4];
      window.__realMeasure = lat.measure;
      lat.measure = async ({ onStep, sig }) => {
        for (let i = 0; i < 8; i++) { if (sig.stop) return null; onStep({ i, click: true }); await new Promise((r) => setTimeout(r, 50)); onStep({ i, ms: hits[i] }); }
        return { how: 'tap', hits: hits.slice(), ...judgeTaps(hits) };
      };
    });
    const t0 = await E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step(), cam: window.overdub.ui.state.liveRoom.gr.cam }));
    await shot('timing');
    await press(page, 'Enter');
    await page.waitForFunction(() => /Kept/.test(document.querySelector('.gr-callout .gg-tm-say')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
    const tm = await E(() => ({ say: document.querySelector('.gr-callout .gg-tm-say')?.textContent || '', kept: window.overdub.input.audio.latency.measured }));
    T.ok(t0.step === 'time' && t0.cam === 'gs' && /Round trip 14/.test(tm.say) && tm.kept && Math.abs(tm.kept.ms - 14.25) < 1,
      `Timing: Enter counts eight clicks, the round trip is kept for the interface ("${tm.say}")`);
    await shot('timing-kept');
    await press(page, 'Enter');

    // 6. your sound, the tour
    const snd = await E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step(), text: document.querySelector('.gr-callout')?.textContent || '' }));
    T.ok(snd.step === 'sound' && /Kraken/.test(snd.text) && /club’s stack/.test(snd.text), `Your sound names the stack: "${(/That’s[^.]*\./.exec(snd.text) || [''])[0]}"`);
    await shot('sound');
    await press(page, 'Enter');
    const stops = [];
    for (let i = 0; i < 7; i++) {
      await wait(i === 2 ? 700 : 120);
      const r = await E(() => {
        const R = document.querySelector('.gr').__gr, co = document.querySelector('.gr-callout');
        return { step: R.parts.start.step(), title: co.querySelector('h2')?.textContent || '', cam: R.gr.cam, side: co.dataset.side, pools: document.querySelectorAll('.gr-gs-pool').length, lit: document.querySelector('.gr-strip')?.classList.contains('gr-gs-lit') };
      });
      stops.push(r);
      if (i === 2) await shot('tour-board');
      if (i === 3) await shot('tour-drummer');
      await press(page, 'Enter');
    }
    const fin = await E(() => {
      const R = document.querySelector('.gr').__gr;
      return { step: R.parts.start.step(), done: R.parts.start.done(), overlay: R.gr.overlay, cam: R.gr.cam, slate: !document.querySelector('.gr-callout').hidden, dim: !document.querySelector('.gr-gs-dim').hidden, g: R.gprefs.get().gs };
    });
    T.ok(stops.every((x) => x.step === 'tour' && x.cam === 'gs' && (x.pools > 0 || x.lit)) && stops.length === 7,
      `the tour's seven stops each put the camera and a pool of light on their thing (${stops.map((x) => `${x.title} (${x.side})`).join(', ')})`);
    T.ok(fin.step === null && fin.done && fin.overlay === null && fin.cam === 'stage' && !fin.slate && !fin.dim, 'Done: finished and remembered (gs.done), the slate and the spotlight gone, the camera home');
    await shot('done');

    // 7. Esc pauses; the button carries on
    const pz = await E(async () => {
      const R = document.querySelector('.gr').__gr, w = (ms) => new Promise((r) => setTimeout(r, ms));
      R.press('gs'); await w(50);
      const a = R.parts.start.step();
      R.press('gs:next'); await w(50);
      return { a, b: R.parts.start.step() };
    });
    await press(page, 'Escape');
    const paused = await E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step(), btn: document.querySelector('.lr-tools .gr-gs-btn')?.textContent, overlay: window.overdub.ui.state.liveRoom.gr.overlay }));
    await page.click('.lr-tools .gr-gs-btn');
    await wait(80);
    const resumed = await E(() => document.querySelector('.gr').__gr.parts.start.step());
    T.ok(pz.a === 'plug' && paused.step === null && paused.overlay === null && /carry on/.test(paused.btn || '') && resumed === pz.b,
      `Esc pauses it at ${pz.b} ("${paused.btn}"); the button carries on from there (${resumed})`);

    // 8. keys land: a slate button the mouse pressed doesn't take Space or U
    const before = await E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step() }));
    await page.click('.gr-callout .gr-co-skip');
    const afterSkip = await E(() => document.querySelector('.gr').__gr.parts.start.step());
    // the focus on whatever the click left it on: Space and U still the room's
    await E(() => { const b = document.querySelector('.gr-callout button'); b?.focus(); window.__focused = b?.textContent; });
    await press(page, 'Space');
    const sp = await E(() => ({ step: document.querySelector('.gr').__gr.parts.start.step(), focused: window.__focused }));
    await press(page, 'KeyU');
    const u = await E(() => window.overdub.ui.state.liveRoom.gr.tuner.on);
    await press(page, 'KeyU');
    T.ok(before.step === 'tune' && afterSkip === 'time' && sp.step === 'time' && u === true,
      `a focused slate button ("${sp.focused}") takes neither Space (still ${sp.step}) nor U (the tuner came on)`);
    const nope = await E(() => [...document.querySelectorAll('.gr-callout select, .gr-callout input[type=range], .gr-panel[data-target=tuner] select, .gr-panel[data-target=tuner] input[type=range], .gr-spot select, .gr-spot input')].length);
    T.ok(nope === 0, `no <select> and no range slider in Getting started or the tuner (${nope})`);

    // the screen goes with the tuner on: never left muted
    const gone = await E(async () => {
      const o = window.overdub, a = o.input.audio, R = document.querySelector('.gr').__gr;
      a.monitor(true);
      R.parts.start.tuner(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const muted = !a.state.monitoring;
      o.liveRoom.close();
      await new Promise((r) => setTimeout(r, 50));
      return { muted, mon: a.state.monitoring, pedal: !!document.querySelector('.gr-tf'), btn: !!document.querySelector('.gr-gs-btn') };
    });
    T.ok(gone.muted && gone.mon && !gone.pedal && !gone.btn, `the room closed with the tuner on: monitoring back (${gone.mon}), the pedal and the button gone`);
    T.ok(!errors.length, `no console or page errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
  } finally { await s.close(); }
}

// the club, on the guitar room (setup.js planGuitarRoom: one step by you)
async function openClub(E) {
  await E(async () => {
    const o = window.overdub;
    const { planGuitarRoom } = await import('/app/src/core/liveroom/guitar/setup.js');
    if (o.liveRoom.isOpen()) o.liveRoom.close();
    const p = planGuitarRoom(o.store.get(), {});
    o.store.dispatch(p.ops, { by: 'you', label: p.label, reason: p.reason });
    o.liveRoom.open({ screen: 'guitar' });
    await new Promise((r) => setTimeout(r, 300));
  });
}
