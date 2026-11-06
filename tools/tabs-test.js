// Tabs [jam]: tab as a view of notes, the house riff writer, the agents' tab tools and the Jam room's tab lane.
//   1-4. (tab text round-trips; notes keeping their place through ops, undo, a split, a share link and a save; the
//      riff writer; the play-along judge and the guitar's note finder: all Node, now test/unit/tabs.test.js)
//   5. in the page: the lane under the stage; Suggest a riff (the house writer) -> takes; Hold to hear; Another; Keep;
//      the lane follows the playhead; Loop the riff; feedback from a fake pitch stream and from musical typing; Learn it
//      waits on each note; Copy tab; the neck lights the riff's note
//   6. the tools: tab_for, write_tab (a clip in free bars, a card over notes, propose, a song from a link, recording),
//      suggest_riff (takes, the lane shows them, keep), the demo agent's riff scene (the three tools'
//      refusals, "errors say what would work", are test/unit/tabs-tools.test.js)
//   7. a phone: the lane scrolls with the playhead, 44 px targets, 12 px text, no sideways page scroll
//   8. no page errors
// usage: node tools/tabs-test.js     (screenshots: tools/.out/tabs-*.png)
import { open, tally, OUTDIR } from './pw.js';
import path from 'node:path';
import * as FB from '../app/src/core/fretboard.js';

const T = tally('tabs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);

/* ============================================================================ 5-8. in the page */
const boot = async (opts = {}) => {
  const s = await open('/app/', { query: 'demo', ...opts });
  await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await s.page.waitForFunction(() => !!window.overdub.jam?.rigs && !!window.overdub.tabs, null, { timeout: 20000 });
  await s.page.evaluate(() => document.querySelector('.ar-welcome-x')?.click());
  await s.page.waitForTimeout(300);
  return s;
};
// warm pixels (the --human ink) in a box on the lane's canvas, around a note's place
const warmIn = (page, t, s, half = 9) => page.evaluate(([t, s, half]) => {
  const lane = window.overdub.tabs, cv = document.querySelector('.tb-cv'), g = cv.getContext('2d');
  const geo = lane.geometry, dpr = cv.width / geo.W;
  const x = geo.xOf(t), y = geo.yOf(s);
  const human = getComputedStyle(document.documentElement).getPropertyValue('--human').trim();
  const m = /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(human) || [];
  const hr = parseInt(m[1], 16), hg = parseInt(m[2], 16), hb = parseInt(m[3], 16);
  const d = g.getImageData(Math.round((x - half) * dpr), Math.round((y - half) * dpr), Math.round(2 * half * dpr), Math.round(2 * half * dpr)).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - hr) < 40 && Math.abs(d[i + 1] - hg) < 40 && Math.abs(d[i + 2] - hb) < 40) n++;
  return n;
}, [t, s, half]);
{
  const { page, errors, close } = await boot();
  const E = (fn, arg) => page.evaluate(fn, arg);
  // (the pictures leave out the toasts, so the lane under them shows)
  const clearToasts = () => E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  const shot = async (n) => { await clearToasts(); await page.screenshot({ path: path.join(OUTDIR, `tabs-${n}.png`) }); };
  const run = (name, input, by = 'mcp:test') => E(([n, i, b]) => window.overdub.tools.run(n, i, { by: b }), [name, input, by]);
  // the tab lane's API exposes the lane's geometry through the room's mount
  await page.click('#ew-tab-jam');
  await sleep(700);
  await E(() => { window.overdub.transport.click.set({ on: false }); window.overdub.input.recorder.setCountIn(0); });

  // ---- the lane: under the stage, above the neck; empty until there's a part
  const order = await E(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { stage: r('.jm-stage').bottom, lane: r('.tb').top, laneB: r('.tb').bottom, neck: r('.jm-neck').top }; });
  T.ok(order.lane >= order.stage - 1 && order.laneB <= order.neck + 1, 'the tab lane sits under the stage and above the neck');
  const empty = await E(() => { const tb = document.querySelector('.tb'), r = tb.getBoundingClientRect(); return { h: Math.round(r.height), text: tb.querySelector('.tb-title').textContent, none: tb.classList.contains('tb-blank'), go: !!tb.querySelector('.tb-suggest')?.getClientRects().length, practice: !!tb.querySelector('.tb-practice')?.getClientRects().length }; });
  T.ok(empty.none && empty.h <= 50 && empty.go && !empty.practice && /^No tab yet: suggest a riff for the Verse, or record one with R\.$/.test(empty.text), `with no riff and no tab part the lane is one line (${empty.h} px), saying what to do: "${empty.text}"`);

  // ---- Suggest a riff: the house writer's three takes, the first on the lane
  const h0 = await E(() => window.overdub.store.history.length);
  await page.click('.tb-suggest');
  await sleep(500);
  // (the room's new Keys guitar has its level measured: wait for it, so its step doesn't land after the Keep below)
  await E(() => window.overdub.jam.levelled);
  const tk = await E(() => { const t = window.overdub.tabs, s = t.state.takes; return { n: s?.items.length, from: s?.from, letters: [...document.querySelectorAll('.tb-take .tb-letter')].map((x) => x.textContent).join(''), shows: t.describe().shows, line: document.querySelector('.tb-line').textContent, keys: window.overdub.jam.guitars().keys?.name, h: window.overdub.store.history.length, clips: window.overdub.jam.guitars().keys?.clips.length, since: window.overdub.store.history.slice(-2).map((t) => t.label) }; });
  T.ok(tk.n === 3 && tk.from === 'house' && tk.letters === 'ABC' && /^Take A: /.test(tk.shows) && /3 riffs from the house riff writer/.test(tk.line), `Suggest a riff: three takes from the house riff writer, take A on the lane ("${tk.shows}")`);
  const opened = await E(() => { const tb = document.querySelector('.tb'); return { none: tb.classList.contains('tb-blank'), h: Math.round(tb.getBoundingClientRect().height), staff: !!tb.querySelector('.tb-scroll')?.getClientRects().length }; });
  T.ok(!opened.none && opened.staff && opened.h > 150, `with a riff to show, the lane opens up to its staff and practice (${opened.h} px)`);
  // (its level is one step with it when the renders are quick, its own step when they aren't)
  const steps = tk.h - h0, made = tk.since.slice(-steps);
  T.ok(tk.keys === 'Keys guitar' && tk.clips === 0 && steps >= 1 && steps <= 2 && /^add Keys guitar for the keys$/.test(made[0] || '') && (steps === 1 || /^Keys guitar: level [+-]?[\d.]+ dB, measured against the song$/.test(made[1] || '')), `nothing of the riffs is in the song yet: only the room's Guitar track for the keys, made so a take plays through the rig (${made.join('; ')})`);
  await shot('takes');

  // ---- Hold to hear: the take plays on the Guitar track, as a preview; let go and it's gone
  const box = await E(() => { const r = document.querySelector('.tb-take[data-i="1"] .tb-hold').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(700);
  const heldNow = await E(() => ({ clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing, hist: window.overdub.store.history.length, label: document.querySelector('.tb-take[data-i="1"] .tb-hold').textContent, shows: window.overdub.tabs.describe().shows }));
  await page.mouse.up();
  await page.waitForFunction(() => !window.overdub.engine.playing && window.overdub.jam.guitars().keys.clips.length === 0, null, { timeout: 4000 }).catch(() => {});
  const letGo = await E(() => ({ clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing, hist: window.overdub.store.history.length }));
  T.ok(heldNow.clips === 1 && heldNow.playing && heldNow.label === 'Hearing B' && /^Take B/.test(heldNow.shows) && heldNow.hist === tk.h, `Hold to hear plays take B on the Guitar track (a preview, nothing in History): "${heldNow.label}"`);
  T.ok(letGo.clips === 0 && !letGo.playing && letGo.hist === tk.h, `letting go takes it back out and stops${letGo.clips === 0 && !letGo.playing && letGo.hist === tk.h ? '' : ` (clips ${letGo.clips}, playing ${letGo.playing}, history ${letGo.hist} of ${tk.h})`}`);
  // a quick tap: let go before the transport has even started, and it still stops
  const tap = await E(async () => { const t = window.overdub.tabs; t.hold(2, true); t.hold(2, false); await new Promise((r) => setTimeout(r, 1200)); return { clips: window.overdub.jam.guitars().keys.clips.length, playing: window.overdub.engine.playing }; });
  T.ok(tap.clips === 0 && !tap.playing, `a tap on Hold to hear lets go cleanly too (clips ${tap.clips}, playing ${tap.playing})`);

  // ---- Another: three new riffs (the next seeds), not the same notes
  const before = await E(() => window.overdub.tabs.state.takes.items.map((x) => x.riff.notes.map((n) => `${n.p}@${n.t}`).join(' ')));
  await page.click('.tb-another');
  await sleep(300);
  const after = await E(() => ({ notes: window.overdub.tabs.state.takes.items.map((x) => x.riff.notes.map((n) => `${n.p}@${n.t}`).join(' ')), seed: window.overdub.tabs.state.takes.seed }));
  T.ok(after.notes.length === 3 && after.seed === 4 && after.notes.every((x) => !before.includes(x)), `Another writes three more from the next seeds (seed ${after.seed}), none of them the same`);

  // ---- Keep: the riff lands on the Guitar track, notes with their places, signed by the house, kept by you
  await page.click('.tb-take[data-i="0"] .tb-take-pick');
  const label0 = await E(() => window.overdub.tabs.state.takes.items[0].label);
  await page.click('.tb-keep');
  await sleep(400);
  const kept = await E(() => {
    const o = window.overdub, g = o.jam.guitars().keys, c = g.clips[0], last = o.store.history[o.store.history.length - 1];
    return { n: c?.notes.length, places: c?.notes.every((n) => Number.isInteger(n.s) && Number.isInteger(n.f)), tuning: c?.tuning, by: c?.by, label: last.label, keptBy: last.keptBy, takes: o.tabs.state.takes, shows: o.tabs.describe().shows, start: c?.start };
  });
  T.ok(kept.n > 8 && kept.places && kept.tuning === 'standard' && kept.by === 'overdub' && kept.label === `Riff: ${label0}` && kept.keptBy === 'you' && kept.start === 0, `Keep puts the riff on the Guitar track: ${kept.n} notes with their strings and frets, the tuning, the house's signature, kept by you ("${kept.label}")`);
  T.ok(!kept.takes && /^Keys guitar, Riff, Rock 8ths, bars 1–4$/.test(kept.shows), `and the lane shows it from the song now ("${kept.shows}")`);
  const undone = await E(() => { const o = window.overdub; o.store.undo(); const n = o.jam.guitars().keys?.clips.length || 0; o.store.redo(); return { n, back: o.jam.guitars().keys.clips.length }; });
  T.ok(undone.n === 0 && undone.back === 1, 'one undo takes the riff out, redo puts it back');

  // ---- Loop the riff, play: the lane follows the playhead, the note now lit, the neck too
  await page.click('.tb-loop');
  const lp = await E(() => ({ loop: window.overdub.store.get().loop, label: window.overdub.store.history[window.overdub.store.history.length - 1].label, pressed: document.querySelector('.tb-loop').getAttribute('aria-pressed') }));
  T.ok(lp.loop.on && lp.loop.start === 0 && lp.loop.end === 16 && lp.label === 'loop the riff, bars 1–4' && lp.pressed === 'true', 'Loop the riff loops its bars, one step by you');
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 1.2, null, { timeout: 8000 });
  const follow = await E(async () => {
    const o = window.overdub, out = [];
    for (let k = 0; k < 4; k++) {
      await new Promise((r) => setTimeout(r, 330));
      const beat = o.engine.beat, geo = o.tabs.geometry, cv = document.querySelector('.tb-cv'), g = cv.getContext('2d'), dpr = cv.width / geo.W;
      // the playhead's column, under the bottom string (where nothing else is drawn): leader green
      const x = geo.xOf(beat), y = geo.yOf(0) + 5;
      let best = 0;
      for (let dx = -10; dx <= 10; dx++) { const d = g.getImageData(Math.round((x + dx) * dpr), Math.round(y * dpr), 1, 1).data; best = Math.max(best, d[1] - d[2]); }
      const part = o.tabs.part(), now = part.notes.filter((n) => beat >= part.start + n.t - 0.06 && beat < part.start + n.t + Math.max(0.12, n.d) + 0.06).map((n) => `${n.s}:${n.f}`);
      const neck = (o.jam.state.tabNow || []).map((x) => `${x.s}:${x.f}`);
      out.push({ beat, green: best, nowOk: !neck.length || neck.every((k2) => now.includes(k2)) });
    }
    return out;
  });
  T.ok(follow.every((f) => f.green > 60) && follow.every((f) => f.nowOk), `the lane's playhead follows the transport (beats ${follow.map((f) => f.beat.toFixed(2)).join(', ')}), and the neck lights the riff's note sounding now`);

  // ---- feedback, from a fake pitch stream on the song's beats: hit, early, late, and the rest unheard
  const gs = await E(() => window.overdub.tabs.part().groups.map((g) => ({ i: g.i, t: g.t, p: g.p, s: null })));
  const nPasses = await E(() => window.overdub.tabs.passes.length);
  await page.waitForFunction(() => window.overdub.engine.beat < 1, null, { timeout: 20000 });   // (the start of a pass)
  const fed = await E(async (gs) => {
    const o = window.overdub, mpb = 60000 / o.store.get().tempo, plan = [[0, 0], [1, -110 / mpb], [2, 120 / mpb]];   // a hit, early, late
    const out = [];
    for (const [k, off] of plan) {
      const g = gs[k];
      while (o.engine.beat < g.t + Math.max(0, off) + 0.05) await new Promise((r) => setTimeout(r, 15));
      out.push(o.tabs.hear({ p: g.p, beat: g.t + off, src: 'guitar' }));
    }
    return out;
  }, gs);
  await sleep(250);
  const marks = await E(() => [...window.overdub.tabs.follow.marks].map(([i, m]) => `${i}:${m.mark}`).join(' '));
  T.ok(fed.map((x) => x?.mark).join(' ') === 'hit early late', `heard notes are judged: ${fed.map((x) => `${x?.mark} (${x?.ms} ms)`).join(', ')}`);
  // warm where it was hit, a ring where early or late, plain where missed
  const parts = await E(() => { const pt = window.overdub.tabs.part(); return pt.notes.map((n) => ({ t: pt.start + n.t, s: n.s })); });
  const w0 = await warmIn(page, parts[0].t, parts[0].s), w1 = await warmIn(page, parts[1].t, parts[1].s, 13), w4 = await warmIn(page, parts[4].t, parts[4].s);
  T.ok(w0 > 6 && w1 > 6 && w4 === 0, `the lane marks them: warm on the hit (${w0} px), a warm ring on the early one (${w1} px), nothing on one that went by (${w4} px): ${marks.split(' ').slice(0, 6).join(' ')}`);
  await shot('desktop-playing');
  // the pass ends at the loop's wrap: the line says how it went
  await page.waitForFunction((n) => window.overdub.tabs.passes.length > n, nPasses, { timeout: 20000 });
  const pass = await E(() => ({ p: window.overdub.tabs.passes[window.overdub.tabs.passes.length - 1], line: document.querySelector('.tb-line').textContent }));
  T.ok(pass.p.hit === 1 && pass.p.early === 1 && pass.p.late === 1 && /^1 of \d+, /.test(pass.line) && pass.line === pass.p.line, `after the pass, a quiet line: "${pass.line}"`);
  await shot('desktop-pass');
  // musical typing: the keys play along too
  await page.waitForFunction(() => window.overdub.engine.beat < 1.5, null, { timeout: 20000 });
  const typed = await E(async (gs) => {
    const o = window.overdub, g = gs.find((x) => x.t >= 2) || gs[3];
    while (o.engine.beat < g.t - 0.02) await new Promise((r) => setTimeout(r, 4));
    o.input.noteOn('test', g.p, 0.8, 'qwerty');
    await new Promise((r) => setTimeout(r, 120));
    o.input.noteOff('test', g.p, 'qwerty');
    return { i: g.i, mark: o.tabs.follow.marks.get(g.i) };
  }, gs);
  T.ok(typed.mark && ['hit', 'early', 'late'].includes(typed.mark.mark) && Math.abs(typed.mark.ms) < 150, `musical typing is heard the same way: ${typed.mark?.mark} (${typed.mark?.ms} ms)`);
  await E(() => window.overdub.transport.playStop());
  await sleep(300);

  // ---- Learn it: the transport waits on each note until it's played, then moves on
  await page.click('.tb-learn');
  await E(() => window.overdub.transport.marker.set(0));
  await page.click('.tb-play');
  await page.waitForFunction(() => window.overdub.tabs.learning.waiting, null, { timeout: 12000 });
  const w1s = await E(() => ({ l: window.overdub.tabs.learning, playing: window.overdub.engine.playing, hushed: window.overdub.engine.hushed, line: document.querySelector('.tb-line').textContent, clip: window.overdub.tabs.part().clipId }));
  const g0 = gs[0], g1 = gs[1];
  T.ok(!w1s.playing && w1s.l.i === 0 && Math.abs(w1s.l.at - g0.t) < 1e-6 && w1s.hushed.includes(w1s.clip) && /^Waiting on the (chord on beat 1 of bar 1 \(its lowest note, )?[A-G][#b]?: (open|\d+(st|nd|rd|th) fret), /.test(w1s.line), `Learn it: the song stops at the first note and waits, the riff itself silent ("${w1s.line}")`);
  const wrong = await E((p) => window.overdub.tabs.hear({ p: p + 1, src: 'keys' }), g0.p);
  await sleep(300);
  const still = await E(() => ({ waiting: window.overdub.tabs.learning.waiting, playing: window.overdub.engine.playing, line: document.querySelector('.tb-line').textContent }));
  T.ok(wrong.wrong && still.waiting && !still.playing && /^That was .+\. Waiting on/.test(still.line), `a wrong note doesn't move it: "${still.line}"`);
  await E((p) => { window.overdub.input.noteOn('test', p, 0.8, 'qwerty'); window.overdub.input.noteOff('test', p, 'qwerty'); }, g0.p);
  await page.waitForFunction(() => window.overdub.tabs.learning.i === 1, null, { timeout: 4000 }).catch(() => {});
  const moved = await E(() => ({ l: window.overdub.tabs.learning, playing: window.overdub.engine.playing || window.overdub.engine.starting }));
  await page.waitForFunction((t) => window.overdub.tabs.learning.waiting && Math.abs(window.overdub.tabs.learning.at - t) < 1e-6, g1.t, { timeout: 8000 }).catch(() => {});
  const next = await E(() => window.overdub.tabs.learning);
  T.ok(moved.l.i === 1 && moved.playing && next.waiting && Math.abs(next.at - g1.t) < 1e-6, `the right note moves it on, and it waits again at the next one (beat ${next.at})`);
  await page.click('.tb-learn');
  const freed = await E(() => window.overdub.engine.hushed.length);
  T.ok(freed === 0, 'Learn it off: the riff is heard again');
  await E(() => { if (window.overdub.engine.playing) window.overdub.transport.playStop(); });

  // ---- Copy tab: the text, as a guitarist reads it
  const txt = await E(() => window.overdub.tabs.text());
  const back = FB.parseTab(txt);
  T.ok(/^Keys guitar, Riff, Rock 8ths, bars 1–4\. Standard tuning \(E A D G B E\), 92 BPM\./.test(txt) && back.notes.length === kept.n && /One column per 16th/.test(txt), `Copy tab copies the riff as text that reads back (${back.notes.length} notes): "${txt.split('\n')[0]}"`);
  await page.click('.tb-copy');
  await sleep(300);
  const toast = await E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).join(' | '));
  T.ok(/Tab copied: bars 1–4, Standard tuning|clipboard/.test(toast), `Copy tab says what it copied ("${toast.slice(0, 80)}")`);

  // ---- the tools: tab_for
  const tf = await run('tab_for', { track: 'Keys guitar' });
  T.ok(tf.tab && /Standard tuning/.test(tf.tab) && tf.notes.length === kept.n && tf.notes.every((n) => n.string >= 1 && n.string <= 6 && n.fret >= 0 && n.bar >= 1 && n.beat >= 1) && tf.fingering.places_kept === kept.n && tf.grid === 'one column per 16th', `tab_for reads the part back: ${tf.notes.length} notes with string, fret, bar and beat, its places kept (${tf.fingering.places_kept})`);
  const tfb = await run('tab_for', { track: 'Hook' });
  T.ok(tfb.tab && tfb.fingering.places_fingered === tfb.notes.length, `a part with no places (the Hook) is fingered: ${tfb.notes.length} notes, ${tfb.fingering.position}`);

  // ---- write_tab: free bars land as a clip; bars with notes go to the person as a card
  const RIFF_TAB = `  |1e+a2e+a3e+a4e+a|1e+a2e+a3e+a4e+a|
e |----------------|----------------|
B |----------------|----------------|
G |--------2===----|----------------|
D |----2=3=----2=0=|2=======--------|
A |0===--------3=--|----------------|
E |----------------|----------------|`;
  const wt = await run('write_tab', { tab: RIFF_TAB, at_bar: 5, name: 'Chorus riff', reason: 'a riff for the chorus' });
  const wtc = await E((id) => { const f = window.overdub.store.findClip(id); return f ? { track: f.track.name, start: f.clip.start, by: f.clip.by, n: f.clip.notes.length, places: f.clip.notes.map((n) => `${n.s}:${n.f}`).join(' '), shows: window.overdub.tabs.describe().shows } : null; }, wt.clip?.id);
  T.ok(wt.ok && wt.landed === 'clip' && wtc && wtc.track === 'Keys guitar' && wtc.start === 16 && wtc.by === 'mcp:test' && wtc.n === 8 && wtc.places.startsWith('1:0 2:2') && wt.bars.join('-') === '5-6', `write_tab puts it in free bars as a clip with its places, signed by the agent: ${wtc?.n} notes at bar 5 (${wtc?.places})`);
  T.ok(/Chorus riff, bars 5–6/.test(wtc.shows) && /tab lane shows it/.test(wt.shown), `the lane shows what landed ("${wtc.shows}")`);
  const wc = await run('write_tab', { tab: RIFF_TAB, at_bar: 1 });
  const card = await E((id) => { const o = window.overdub, r = o.tools.requests.get(id); return { keep: !!r?.keep, fine: r?.keep?.fine, lane: o.tabs.state.takes?.from, by: o.tabs.state.takes?.by, panel: !!document.querySelector(`.ag-asks[data-id="${id}"]`), clips: o.jam.guitars().keys.clips.length }; }, wc.id);
  T.ok(wc.offered && wc.status === 'pending' && wc.landed === 'card' && /replace what's in bars 1–2 on Keys guitar/.test(wc.why) && card.lane === 'agent' && card.by === 'mcp:test' && /would replace/.test(card.fine) && card.clips === 2, `over notes it changes nothing and goes to the person as a card ("${wc.why}"), shown on the lane too`);
  await page.click('.tb-keep');
  await sleep(400);
  const wk = await run('get_variation_result', { id: wc.id });
  const wkc = await E(() => { const g = window.overdub.jam.guitars().keys; return { clips: g.clips.map((c) => `${c.start}:${c.by}:${c.notes.length}`).join(' '), shows: window.overdub.tabs.describe().shows }; });
  T.ok(wk.kept === true && /^0:mcp:test:8/.test(wkc.clips) && /Riff, bars 1–2/.test(wkc.shows), `Keep on the lane keeps it: the agent's riff replaces bars 1–2, the rest of the house riff after it (${wkc.clips})`);
  const wp = await run('write_tab', { tab: RIFF_TAB, at_bar: 7, mode: 'propose' });
  T.ok(wp.offered && wp.landed === 'card' && wp.why === 'mode propose', 'mode propose makes a card even in free bars');
  await E((id) => window.overdub.tools.answer(id, -1), wp.id);
  // a song from a link: free bars still take an add; bars with notes wait for the person
  const linked = await E(async (tab) => {
    const o = window.overdub; o.share.listening = true;
    try {
      const a = await o.tools.run('write_tab', { tab, at_bar: 7 }, { by: 'mcp:test' });
      const b = await o.tools.run('write_tab', { tab, at_bar: 1 }, { by: 'mcp:test' });
      return { a: { ok: a.ok, landed: a.landed }, b: { offered: b.offered, landed: b.landed } };
    } finally { o.share.listening = false; }
  }, RIFF_TAB);
  T.ok(linked.a.ok && linked.a.landed === 'clip' && linked.b.offered && linked.b.landed === 'card', 'on a song from a link, a riff in free bars lands (an add), one over notes waits on a card');
  await E(() => { for (const r of window.overdub.tools.requests.values()) if (r.status === 'pending') window.overdub.tools.answer(r.id, -1); });

  // ---- suggest_riff: the house writer's riffs as takes, on the Agent tab's card and the lane
  const sr = await run('suggest_riff', { section: 'Chorus', style: 'funk', takes: 3, reason: 'riffs for the chorus' });
  // the pane draws the card on its next frame (a busy machine runs a few behind)
  await page.waitForFunction((id) => document.querySelectorAll(`.ag-vars[data-id="${id}"] .ag-letter.num`).length >= 3, sr.id, { timeout: 5000 }).catch(() => {});
  const srs = await E((id) => {
    const o = window.overdub, r = o.tools.requests.get(id);
    // the letters each take goes by, on the lane and on the Agent tab's card, by label
    const lane = (o.tabs.state.takes?.items || []).map((x) => `${x.letter}:${x.label}`).sort().join(' | ');
    const card = [...document.querySelectorAll(`.ag-vars[data-id="${id}"] .ag-take`)].filter((el) => el.querySelector('.ag-letter.num')).map((el) => `${el.querySelector('.ag-letter.num').textContent.trim()}:${el.querySelector('.ag-take-h b')?.textContent}`).sort().join(' | ');
    return { cards: r?.cards.length, lane: o.tabs.state.takes?.from, n: o.tabs.state.takes?.items.length, letters: (o.tabs.state.takes?.items || []).map((x) => x.letter).join(''), laneBy: lane, cardBy: card };
  }, sr.id);
  T.ok(sr.status === 'pending' && sr.takes.length === 3 && sr.takes.every((x) => x.tab.split('\n').length >= 7 && x.text) && sr.bars.join('-') === '5-8' && sr.style === 'funk' && /house riff writer/.test(sr.from) && sr.next_seed === 4, `suggest_riff offers three riffs for the Chorus as tab (${sr.takes.map((x) => x.label).join('; ')})`);
  T.ok(srs.cards === 4 && srs.lane === 'agent' && srs.n === 3, 'they are takes on a card (and "as it was"), and on the lane');
  T.ok(srs.letters === 'ABC' && srs.laneBy === srs.cardBy, `each take has the same letter on the lane as on the Agent tab's card (${srs.letters.split('').join(', ')})${srs.laneBy === srs.cardBy ? '' : `: lane ${srs.laneBy}; card ${srs.cardBy}`}`);
  await shot('agent-takes');
  await page.click('.tb-take[data-i="1"] .tb-take-pick');
  await page.click('.tb-keep');
  await sleep(400);
  const srk = await run('get_variation_result', { id: sr.id });
  const srkc = await E(() => { const o = window.overdub, c = o.jam.guitars().keys.clips.find((x) => x.start === 16); return c ? { by: c.by, name: c.name, places: c.notes.every((n) => Number.isInteger(n.s)) } : null; });
  T.ok(srk.picked && srk.index >= 0 && srkc && srkc.by === 'mcp:test' && /^Riff, Funk 16ths$/.test(srkc.name) && srkc.places, `keeping one on the lane lands it, signed by the agent that offered it ("${srkc?.name}")`);
  // recording: the Guitar track is being written, so a riff waits
  await E(() => { const o = window.overdub; o.transport.marker.set(0); o.ui.select({ track: o.jam.guitars().keys.id }); });
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.overdub.input.recorder.state === 'rec', null, { timeout: 8000 });
  const rec = await Promise.all([run('write_tab', { tab: RIFF_TAB, at_bar: 7 }), run('suggest_riff', {})]);
  await E(() => window.overdub.input.recorder.cancel ? window.overdub.input.recorder.cancel() : window.overdub.input.recorder.stop());
  await sleep(500);
  T.ok(rec[0].error === 'recording' && rec[1].error === 'recording' && /recording/.test(rec[0].hint), `while the person records on the Guitar track, write_tab and suggest_riff are refused ("${rec[0].hint.slice(0, 60)}…")`);

  // ---- the demo agent: "give me a riff for the chorus" is the house writer's riffs, and it says so
  await E(() => { window.overdub.agent.useMock(true); });
  await E(() => window.overdub.ui.emit('agent:compose', { text: 'give me a riff for the chorus', send: true }));
  await page.waitForFunction(() => [...window.overdub.tools.requests.values()].some((r) => r.riff && r.status === 'pending' && r.by === 'claude'), null, { timeout: 30000 });
  await sleep(1200);
  const mock = await E(() => ({ text: [...document.querySelectorAll('.ag-agent .ag-text')].map((x) => x.textContent).join(' '), lane: window.overdub.tabs.state.takes?.from, by: window.overdub.tabs.state.takes?.by }));
  T.ok(/riffs for the chorus/.test(mock.text) && /from the house riff writer: a seeded program in the studio, not me/.test(mock.text) && mock.lane === 'agent' && mock.by === 'claude', `the demo agent answers with the house writer's riffs as takes and says whose they are: "${(mock.text.match(/Here are[^.]*\.[^.]*\./) || [''])[0].slice(0, 160)}"`);
  await E(() => { for (const r of window.overdub.tools.requests.values()) if (r.status === 'pending') window.overdub.tools.answer(r.id, -1); window.overdub.agent.stop(); window.overdub.agent.useMock(false); });

  // ---- the Notes panel's Tab view: the clip as tab, the same notes; pick a fret, change string, type a fret
  const STD = [40, 45, 50, 55, 59, 64], AMIN = new Set([9, 11, 0, 2, 4, 5, 7]);
  const noteNow = (id) => E((id) => { const o = window.overdub, c = o.store.findClip(o.ui.state.selection.clip).clip, n = c.notes.find((x) => x.id === id); return { p: n.p, s: n.s, f: n.f, by: n.by, h: o.store.history.length, label: o.store.history[o.store.history.length - 1].label, msg: document.querySelector('.prt-msg').textContent }; }, id);
  // (the Guitar track's longest clip: the riff kept from the lane, or the tab write_tab put there)
  await E(() => { const o = window.overdub; if (o.engine.playing) o.transport.playStop(); const g = o.jam.guitars().keys, c = g.clips.filter((x) => x.kind === 'notes').sort((a, b) => b.notes.length - a.notes.length)[0]; o.ui.select({ track: g.id, clip: c.id, notes: [] }); o.ui.show('pianoroll'); });
  await sleep(500);
  const tv = await E(() => { const o = window.overdub, pt = o.pianoroll.tab.part(); return { on: o.pianoroll.tabOn(), cls: document.querySelector('.pr').classList.contains('pr-istab'), shown: getComputedStyle(document.querySelector('.prt')).display, n: pt?.notes.length, placed: pt?.notes.every((n) => Number.isInteger(n.s)), pressed: document.querySelector('.pr-tabbtn').getAttribute('aria-pressed'), pos: document.querySelector('.prt-pos').textContent }; });
  T.ok(tv.on && tv.cls && tv.shown === 'flex' && tv.pressed === 'true' && tv.n >= 6 && tv.placed, `a part written as tab opens in Notes as tab: ${tv.n} notes on strings ("${tv.pos}")`);
  const pick = await E((T) => {
    const o = window.overdub, pt = o.pianoroll.tab.part();
    const free = (n) => n.s < 5 && n.p - T[n.s + 1] >= 0 && !pt.notes.some((x) => x !== n && x.s === n.s + 1 && x.t < n.t + Math.max(0.06, n.d) && n.t < x.t + Math.max(0.06, x.d));
    const n = pt.notes.find(free);
    if (n) document.querySelector('.prt-scroll').scrollLeft = Math.max(0, o.pianoroll.tab.at(n.id).x - document.querySelector('.prt-scroll').getBoundingClientRect().left - 200);
    return n ? { id: n.id, p: n.p, s: n.s, f: n.f } : null;
  }, STD);
  const pickAt = await E((id) => window.overdub.pianoroll.tab.at(id), pick.id);
  await page.mouse.click(pickAt.x, pickAt.y);
  await sleep(150);
  const picked = await E(() => ({ sel: [...(window.overdub.ui.state.selection.notes || [])], line: document.querySelector('.prt-sel').textContent }));
  T.ok(picked.sel.length === 1 && picked.sel[0] === pick.id && /^[A-G][#b]?-?\d: (open|\d+(st|nd|rd|th) fret), .*string\.$/.test(picked.line), `a click on a fret number picks its note, in the roll's selection too ("${picked.line}")`);
  await page.keyboard.press('ArrowUp');
  await sleep(150);
  const up = await noteNow(pick.id);
  T.ok(up.p === pick.p && up.s === pick.s + 1 && up.f === pick.p - STD[pick.s + 1] && up.by === 'you', `↑ moves it to the string above at the same pitch (string ${pick.s}, fret ${pick.f} to string ${up.s}, fret ${up.f}: "${up.label}")`);
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit0');
  await sleep(150);
  const typedTo = await noteNow(pick.id);
  T.ok(typedTo.f === 10 && typedTo.s === up.s && typedTo.p === STD[up.s] + 10 && typedTo.h === up.h + 1 && /^a fret typed on the /.test(typedTo.label), `typing 1 then 0 puts it on the 10th fret of its string, the pitch going with it (${pick.p} to ${typedTo.p}), one undo ("${typedTo.label}")`);
  await sleep(1000);
  const outFret = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((f) => !AMIN.has((STD[up.s] + f) % 12));
  await page.keyboard.press(`Digit${outFret}`);
  await sleep(150);
  const locked = await noteNow(pick.id);
  T.ok(locked.f === 10 && locked.p === typedTo.p && locked.h === typedTo.h && /is outside A minor, and Scale lock is on/.test(locked.msg), `with Scale lock on, a fret outside the key is refused and says why ("${locked.msg.slice(0, 70)}…")`);
  const undoTyped = await E((id) => { const o = window.overdub; o.store.undo(); const c = o.store.findClip(o.ui.state.selection.clip).clip, n = c.notes.find((x) => x.id === id); return { p: n.p, s: n.s, f: n.f }; }, pick.id);
  T.ok(undoTyped.p === pick.p && undoTyped.s === up.s && undoTyped.f === up.f, 'one undo takes the typed fret back, both digits');
  // the clip's tuning: Drop D re-fingers what the low string can't keep; no pitch moves
  const pitches0 = await E(() => window.overdub.store.findClip(window.overdub.ui.state.selection.clip).clip.notes.map((n) => n.p).join(','));
  await page.selectOption('.prt-tuning', 'drop-d');
  await sleep(200);
  const dd = await E(() => { const o = window.overdub, c = o.store.findClip(o.ui.state.selection.clip).clip, pt = o.pianoroll.tab.part(); return { tuning: c.tuning, pitches: c.notes.map((n) => n.p).join(','), low: pt.notes.filter((n) => n.s === 0).every((n) => n.f === n.p - 38), all: pt.notes.every((n) => [38, 45, 50, 55, 59, 64][n.s] + n.f === n.p), label: o.store.history[o.store.history.length - 1].label }; });
  T.ok(dd.tuning === 'drop-d' && dd.pitches === pitches0 && dd.low && dd.all, `the Tuning menu sets the clip's tuning: the tab follows (the low string from D), no pitch moves ("${dd.label}")`);
  await E(() => window.overdub.store.undo());
  await page.click('.pr-tabbtn');
  await sleep(200);
  const offTab = await E(() => ({ on: window.overdub.pianoroll.tabOn(), cls: document.querySelector('.pr').classList.contains('pr-istab'), main: getComputedStyle(document.querySelector('.pr-main')).visibility, pref: window.overdub.ui.state.prTab }));
  T.ok(!offTab.on && !offTab.cls && offTab.main === 'visible' && offTab.pref === false, 'the Tab switch turns it back to the roll, and stays where you put it');
  await page.click('.pr-tabbtn');
  await sleep(300);
  await shot('roll');
  const drumTab = await E(() => { const o = window.overdub, d = o.store.get().tracks.find((t) => /drum|kit|beat/i.test(t.name) && t.clips.some((c) => c.kind === 'notes')); if (!d) return null; o.ui.select({ track: d.id, clip: d.clips.find((c) => c.kind === 'notes').id, notes: [] }); return { hidden: document.querySelector('.pr-tabbtn').hidden, on: o.pianoroll.tabOn() }; });
  T.ok(drumTab && drumTab.hidden && !drumTab.on, 'a drum clip has no Tab switch');

  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `no page errors on the desktop${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

/* ============================================================================ 7. a phone */
{
  const { page, errors, close } = await boot({ width: 390, height: 844 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  await page.setViewportSize({ width: 390, height: 844 });
  await E(() => { const o = window.overdub; o.transport.click.set({ on: false }); });
  await page.click('#ew-tab-jam');
  await sleep(700);
  // a phone: the chord on one line, then the neck, then the tab lane (one line while it has nothing to show)
  const porder = await E(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const tb = r('.tb'); return { stage: Math.round(r('.jm-stage').bottom), neck: Math.round(r('.jm-neck-scroll').top), neckEnd: Math.round(r('.jm-neck').bottom), lane: Math.round(tb.top), h: Math.round(tb.height), head: Math.round(r('.tb-head').height), none: document.querySelector('.tb').classList.contains('tb-blank'), text: document.querySelector('.tb').textContent.replace(/\s+/g, ' ').trim() }; });
  T.ok(porder.neck >= porder.stage - 1 && porder.lane >= porder.neckEnd - 1 && porder.none && porder.h <= porder.head + 16 && /^Tab\s*No tab yet/.test(porder.text), `phone: the neck comes straight under the chord, the tab lane after it, one line while it's empty (${porder.h} px: "${porder.text.slice(0, 40)}")`);
  await E(() => document.querySelector('.tb').scrollIntoView({ block: 'start' }));
  await E(() => window.overdub.tabs.suggest({ agent: false }));
  await sleep(400);
  await E(() => document.querySelector('.tb').scrollIntoView({ block: 'start' }));
  await sleep(200);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-takes.png') });
  const lay = await E(() => {
    const out = { doc: document.documentElement.scrollWidth, vw: innerWidth, small: [], targets: [] };
    const root = document.querySelector('.tb');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], .sr-only')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11.95) out.small.push(`${el.className || el.tagName} ${fs}px`);
    }
    for (const el of root.querySelectorAll('button, select')) {
      if (el.closest('[hidden]') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.targets.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  T.ok(lay.doc <= lay.vw, `phone: no sideways page scroll (${lay.doc} px in ${lay.vw})`);
  T.ok(!lay.small.length, `phone: no text in the lane under 12 px${lay.small.length ? ': ' + [...new Set(lay.small)].slice(0, 4).join(', ') : ''}`);
  T.ok(!lay.targets.length, `phone: the lane's controls are 44 px targets${lay.targets.length ? ': ' + lay.targets.slice(0, 4).join(', ') : ''}`);
  await E(() => window.overdub.tabs.keep(0));
  await E(() => window.overdub.tabs.loopRiff());
  await E(() => window.overdub.transport.playStop());
  await page.waitForFunction(() => window.overdub.engine.playing && window.overdub.engine.beat > 0.5, null, { timeout: 8000 });
  const sc = [];
  for (let k = 0; k < 4; k++) { await sleep(700); sc.push(await E(() => { const s = document.querySelector('.tb-scroll'); return { left: s.scrollLeft, w: s.scrollWidth, c: s.clientWidth, beat: window.overdub.engine.beat }; })); }
  const lefts = sc.map((x) => Math.round(x.left));
  T.ok(sc[0].w > sc[0].c + 300 && new Set(lefts).size >= 3 && lefts[3] > lefts[0], `phone: the lane is wider than the screen and scrolls with the playhead (${lefts.join(', ')} px at beats ${sc.map((x) => x.beat.toFixed(1)).join(', ')})`);
  // a hit on the phone, from the fake stream, for the picture
  await E(() => { const o = window.overdub, g = o.tabs.part().groups.find((x) => x.t > o.engine.beat + 0.3); if (g) setTimeout(() => o.tabs.hear({ p: g.p, beat: g.t, src: 'guitar' }), 0); });
  await sleep(900);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-playing.png') });
  await E(() => window.overdub.transport.playStop());
  // the Notes panel's Tab view on a phone: 44 px targets, nothing under 12 px
  await E(() => { const o = window.overdub, g = o.jam.guitars().keys, c = g.clips.find((x) => x.start === 0); o.ui.select({ track: g.id, clip: c.id, notes: [c.notes[0].id] }); o.ui.show('pianoroll'); });
  await sleep(500);
  const roll = await E(() => {
    const out = { on: window.overdub.pianoroll.tabOn(), doc: document.documentElement.scrollWidth, vw: innerWidth, small: [], targets: [] };
    const root = document.querySelector('.prt');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[hidden], .sr-only') || !el.getClientRects().length || getComputedStyle(el).display === 'none') continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11.95) out.small.push(`${el.className || el.tagName} ${fs}px`);
    }
    for (const el of root.querySelectorAll('button, select')) {
      if (el.closest('[hidden]') || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) out.targets.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  T.ok(roll.on && roll.doc <= roll.vw && !roll.small.length && !roll.targets.length, `phone: the Notes panel's Tab view fits, its text 12 px or more, its controls 44 px targets${roll.small.length || roll.targets.length ? ': ' + [...roll.small, ...roll.targets].slice(0, 4).join(', ') : ''}`);
  await E(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(OUTDIR, 'tabs-phone-roll.png') });
  const errs = errors.filter((e) => !ignorable(e));
  T.ok(!errs.length, `phone: no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await close();
}

T.done();
