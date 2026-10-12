// Start a song (app/src/ui/start.js): the blank song's door and the stage, in the studio. Taps go through
// app.start.tap(row, perfMs) with times from tools/sloppy.js (a person a little off, drifting), so Playwright's own
// timing isn't what's measured. Quiet browsers (tools/pw.js).
//
//   node tools/start-test.js
import { open, tally, OUTDIR } from './pw.js';
import { perform, sloppyHum, wav } from './sloppy.js';
import { takeOf } from '../app/src/input/rounds.js';
import path from 'node:path';

const t = tally('start');
const K = 36, S = 38, H = 42;
const ROW = { [K]: 'kick', [S]: 'snare', [H]: 'hat' };
const ROCK = [[0, K], [2, K], [2.5, K], [1, S], [3, S], ...Array.from({ length: 8 }, (_, i) => [i / 2, H])];
const real = (errs) => errs.filter((e) => !/status of 404 .*kits|Failed to load resource: the server responded with a status of 404/.test(e));

async function blank({ width = 1440, height = 900 } = {}) {
  const o = await open('/app/', { query: 'new&on=start.slice2', width, height });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await o.page.waitForTimeout(500);
  return o;
}
const E = (page, f, a) => page.evaluate(f, a);
const song = (page) => E(page, () => { const o = window.overdub, p = o.store.get(); return { tempo: p.tempo, loop: p.loop, hist: o.store.history.map((x) => ({ label: x.label, by: x.by })), tracks: p.tracks.map((tr) => ({ id: tr.id, name: tr.name, device: tr.instrument?.device, by: tr.by, clips: tr.clips.map((c) => ({ id: c.id, by: c.by, length: c.length, notes: c.notes.map((n) => ({ p: n.p, t: n.t, by: n.by })) })) })) }; });
// a person playing the rock beat three times round at bpm, as app.start.tap calls (ms on the page's clock)
async function playRock(page, { bpm = 96, rounds = 3, jitter = 0.03, drift = 0.04, seed = 3 } = {}) {
  const hits = perform(ROCK, { bpm, bars: rounds, jitter, drift, seed, start: 0 });
  const t0 = await E(page, () => performance.now() + 40);
  await E(page, ([hs]) => { for (const x of hs) window.overdub.start.tap(x.row, x.ms); }, [hits.map((x) => ({ row: ROW[x.p], ms: t0 + x.t * 1000 }))]);
  return hits.length;
}

/* ================================================================ the door */
{
  console.log('\nthe door');
  const o = await blank();
  const { page } = o;
  try {
    const d = await E(page, () => {
      const door = document.querySelector('.st-door'), o = window.overdub;
      const go = [...door.querySelectorAll('.btn-go')].map((b) => b.textContent.trim());
      return { shown: !!door?.getClientRects().length, title: door.querySelector('.ar-empty-title')?.textContent, ways: [...door.querySelectorAll('.st-way-b')].map((b) => b.textContent.trim()),
        go, notime: [...door.querySelectorAll('.st-notime button')].map((b) => b.textContent.trim()), foot: door.querySelector('.ar-empty-foot')?.textContent.replace(/\s+/g, ' ').trim(),
        playing: o.engine.playing, stage: !!document.querySelector('.st-stage'), welcome: !!document.querySelector('.ar-welcome')?.getClientRects().length };
    });
    t.ok(d.shown && d.title === 'Take 1 is yours.' && d.ways.join() === 'Tap a beat,Hum a tune,Play the keys', `a blank song's empty space is the door: "${d.title}", ${d.ways.join(' · ')}`);
    t.ok(d.go.join() === 'Tap a beat', `Tap a beat is the door's one primary (${d.go.join(', ')})`);
    t.ok(d.notime.join() === 'Draw a beat,Pick a groove,Ask your agent' && /hear a finished one: Night Shift\./.test(d.foot), `no playing in time: ${d.notime.join(' · ')}; "${d.foot}"`);
    t.ok(!d.playing && !d.stage && !d.welcome, `nothing sounds and nothing pops up until a key or a click (playing ${d.playing}, stage ${d.stage}, welcome ${d.welcome})`);
    await page.focus('.st-way-b[data-way="Tap a beat"]');
    await page.keyboard.press('ArrowDown');
    const f1 = await E(page, () => document.activeElement?.textContent.trim());
    t.ok(f1 === 'Hum a tune', `↓ walks the ways (${f1})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-door.png') });
    // every blank song has it: a song with a track doesn't
    await E(page, () => window.overdub.store.dispatch({ type: 'track.add', track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys' } } }, { by: 'you' }));
    await page.waitForTimeout(200);
    const gone = await E(page, () => !document.querySelector('.st-door')?.getClientRects().length);
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(200);
    const back = await E(page, () => !!document.querySelector('.st-door')?.getClientRects().length);
    t.ok(gone && back, `nothing over a song with tracks, and the door is back when it's blank again (${gone}, ${back})`);
    t.ok(!real(o.errors).length, `door: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'door threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the start.slice2 toggle off: slice 1, as main has it */
// Every other block here opens the studio with ?on=start.slice2 (a local studio only). This one leaves it off: the door
// and the stage are slice 1's (ui/start-slice1.js), with no coach strip, no click view, no free hum on the stage, no
// Song ▸ Start a song or Find entry, and "~" never in the top bar. (A drum track records each pass as Layer, on or off.)
{
  console.log('\nthe start.slice2 toggle off');
  const o = await open('/app/', { query: 'new' });
  const { page } = o;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await page.waitForTimeout(500);
    const d = await E(page, async () => {
      const o = window.overdub, door = document.querySelector('.st-door');
      const id = o.store.dispatch({ type: 'track.add', ref: 'd', track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums' } } }, { by: 'you' }).created.d;
      const mode = o.input.recorder.modeFor(id);
      o.store.undo();
      const { runTool } = await import('/app/src/agent/tools.js');
      const sel = await runTool('get_selection', {}, { by: 'you', app: o });
      return { on: o.toggles.on('start.slice2'), title: door?.querySelector('.ar-empty-title')?.textContent, ways: [...(door?.querySelectorAll('.st-way-b') || [])].map((b) => b.textContent.trim()),
        coach: o.coach === undefined && !document.querySelector('.ew-dock')?.children.length, mode, find: o.ui.workspace.FEATURES.some((f) => f.id === 'start'),
        startSong: o.exporter.startSong?.() ?? null, api: typeof o.start?.setView, selStart: sel && 'start' in sel ? sel.start : 'missing' };
    });
    t.ok(!d.on && d.title === 'Take 1 is yours.' && d.ways.join() === 'Tap a beat,Hum a tune,Play the keys', `off: the door is slice 1's ("${d.title}", ${d.ways.join(' · ')}; start.slice2 ${d.on ? 'on' : 'off'})`);
    t.ok(d.mode === 'layer', `off: a drum track records each pass as Layer, as main has it (${d.mode})`);
    t.ok(d.coach && !d.find && d.startSong === false && d.api === 'undefined' && d.selStart === null,
      `off: no coach strip, no Start a song in Find, startSong() does nothing, no click view in the stage's API, get_selection.start null (${JSON.stringify(d)})`);
    await E(page, () => window.overdub.exporter.openMenu());
    await page.waitForTimeout(250);
    const menu = await E(page, () => ({ rows: document.querySelectorAll('.sm-i').length, start: !!document.querySelector('.sm-start') }));
    await page.keyboard.press('Escape');
    t.ok(menu.rows > 3 && !menu.start, `off: the Song menu has no Start a song row (${JSON.stringify(menu)})`);
    // the stage: tapping, the top bar keeps the song's tempo (no "~"); Play to a click instead is the first minute
    await E(page, () => [...document.querySelectorAll('.st-way-b')].find((b) => b.textContent.trim() === 'Tap a beat')?.click());
    await page.waitForTimeout(300);
    await playRock(page, { rounds: 1 });
    await page.waitForTimeout(400);
    const play = await E(page, () => ({ step: window.overdub.start.step, tempo: document.querySelector('.tp-tempo-num')?.textContent }));
    t.ok(play.step === 'play' && play.tempo !== '~' && /^\d/.test(play.tempo || ''), `off: tapping on the stage, the top bar's tempo stays the song's (${JSON.stringify(play)})`);
    await E(page, () => window.overdub.start.again());
    await E(page, () => [...document.querySelectorAll('.st-stage button')].find((b) => b.textContent.trim() === 'Play to a click instead')?.click());
    await page.waitForTimeout(900);
    const fm = await E(page, () => { const o = window.overdub; return { step: o.start.step, minute: !!o.onboard?.minute, tracks: o.store.get().tracks.map((x) => x.name) }; });
    t.ok(!fm.step && fm.minute && fm.tracks.includes('Drums'), `off: Play to a click instead is the first minute, off the stage (${JSON.stringify(fm)})`);
    await E(page, () => { const o = window.overdub; o.engine.stop?.(); o.onboard?.stop?.(); });
    t.ok(!real(o.errors).length, `toggle off: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'toggle off threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ tap a beat, free time */
{
  console.log('\ntap a beat');
  const o = await blank();
  const { page } = o;
  try {
    // press 1: Tap a beat
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(400);
    const st = await E(page, () => { const o = window.overdub, stage = document.querySelector('.st-stage'); return { step: o.start.step, busy: o.start.busy, region: stage?.getAttribute('role'), label: stage?.getAttribute('aria-label'), inert: [...document.querySelector('.ew-main').children].filter((c) => c !== stage).every((c) => c.inert), tracks: o.store.get().tracks.length, hist: o.store.history.length, empty: document.querySelector('.st-empty')?.textContent, pads: [...document.querySelectorAll('.st-pad')].map((p) => p.textContent.trim()) }; });
    t.ok(st.step === 'play' && st.region === 'region' && st.label === 'Start a song' && st.inert, `Tap a beat opens the stage over the centre column, the studio inert under it (${JSON.stringify({ step: st.step, inert: st.inert })})`);
    t.ok(st.tracks === 1 && st.hist === 0 && st.empty === 'Your first hit starts the clock.' && st.pads.join() === 'KickF,SnareJ,HatK,OpenL', `the pads play on a previewed Drums track, nothing in History (${st.tracks} track, ${st.hist} changes); "${st.empty}"`);
    // the keys stay on the stage: Space with nothing played doesn't start the transport, and nothing lands
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const sp = await E(page, () => ({ playing: window.overdub.engine.playing, step: window.overdub.start.step, hist: window.overdub.store.history.length, line: document.querySelector('.st-status')?.textContent }));
    t.ok(!sp.playing && sp.step === 'play' && sp.hist === 0 && sp.line === 'Your first hit starts the clock.', `Space never reaches the studio while the stage is open: it's Done, and there's nothing yet (playing ${sp.playing}; "${sp.line}")`);
    // the first hit sounds at once on the preview track
    await page.keyboard.press('KeyF');
    const v = await E(page, async () => { const o = window.overdub, id = o.store.get().tracks[0].id; await new Promise((r) => setTimeout(r, 40)); const vs = await o.engine.voices(); return { voices: vs[id]?.voices ?? null, hits: o.start.take()?.hits ?? (o.start.step && 1) }; });
    t.ok(v.voices > 0, `the first hit sounds on the blank song at once (${v.voices} voice on the preview Drums)`);
    await E(page, () => window.overdub.start.again());
    // a few hits: no BPM yet
    const t0 = await E(page, () => performance.now());
    await E(page, (t0) => { for (let i = 0; i < 5; i++) window.overdub.start.tap(i % 2 ? 'snare' : 'kick', t0 + i * 600); }, t0);
    const few = await E(page, () => ({ bpm: document.querySelector('.st-bpm')?.textContent, done: document.querySelector('.st-done')?.textContent.trim(), go: document.querySelector('.st-done')?.classList.contains('btn-go') }));
    t.ok(few.bpm === '~' && /^Done/.test(few.done) && few.go, `five hits: the tempo isn't said yet ("${few.bpm}"), and Done is ready from the 4th (${few.done})`);
    await E(page, () => window.overdub.start.again());
    // three times round, a sloppy drifting player
    const n = await playRock(page);
    await page.waitForTimeout(200);
    const live = await E(page, () => ({ bpm: document.querySelector('.st-bpm')?.textContent, rounds: document.querySelector('.st-rounds')?.textContent, line: document.querySelector('.st-status')?.textContent, take: window.overdub.start.take() }));
    t.ok(Math.abs(+live.bpm - 98) <= 4 && /round/.test(live.rounds) && /hits\. \d+ BPM, 1 bar round, 3 times round\./.test(live.line), `${n} hits: the BPM, the loop and the rounds come from the playing (${live.bpm} BPM; "${live.line}")`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-play.png') });
    // press 2: Done
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const a = await song(page);
    const tr = a.tracks[0];
    t.ok(a.hist.length === 1 && a.hist[0].by === 'you' && /^your beat, 1 bar at \d+ BPM$/.test(a.hist[0].label) && a.tracks.length === 1 && tr.name === 'Drums' && tr.device === 'core.drums' && tr.clips.length === 1 && a.loop.on && a.loop.end === 4,
      `two presses (Tap a beat, Done): one History entry by you, "${a.hist[0]?.label}", with the tempo (${a.tempo}), Drums, its clip and the loop`);
    t.ok(tr.by === 'you' && tr.clips[0].by === 'you' && tr.clips[0].notes.every((x) => x.by === 'you') && tr.clips[0].notes.length === 13, `signed you: the track, the clip and its ${tr.clips[0].notes.length} hits (the rock beat's 13)`);
    const inn = await E(page, () => ({ step: window.overdub.start.step, busy: window.overdub.start.busy, playing: window.overdub.engine.playing, head: document.querySelector('.st-title')?.textContent, sub: document.querySelector('.st-sub')?.textContent, by: !!document.querySelector('.st-sub .by-human'), level: document.querySelector('.st-level')?.textContent, go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.trim()) }));
    t.ok(inn.step === 'in' && !inn.busy && inn.playing && inn.head === 'Your beat is in the song.' && inn.by && /You played it 3 times round; kept the 13 hits you played most\./.test(inn.sub), `it's in, and it loops while you decide: "${inn.sub}"`);
    t.ok(/^Tight moved \d+ hits, \d+ ms on average\.$/.test(inn.level) && inn.go.join() === 'Hum over it', `Timing says what Tight moved ("${inn.level}"); the one primary is the next part (${inn.go.join(', ')})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-in.png') });
    // Timing steps join the landing: still one undo step
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const loose = await song(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const played = await song(page);
    const lvl = await E(page, () => document.querySelector('.st-level')?.textContent);
    const ts = (s) => s.tracks[0].clips[0].notes.map((x) => x.t).join();
    t.ok(loose.hist.length === 1 && played.hist.length === 1 && ts(loose) !== ts(a) && ts(played) !== ts(loose) && /^Your timing, evened out to \d+ BPM\.$/.test(lvl), `→ Loose, → As played: the notes move, still one undo step (${played.hist.length}); "${lvl}"`);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    // Not quite? lists the other readings; picking one plays it at once, joined; Esc puts back what was there
    const nq = await E(page, () => !!document.querySelector('.st-notquite'));
    if (nq) {
      await page.click('.st-notquite');
      await page.waitForTimeout(200);
      const rd = await E(page, () => ({ step: window.overdub.start.step, rows: [...document.querySelectorAll('.st-reading')].map((r) => r.textContent), sel: document.activeElement?.classList.contains('st-reading') }));
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      const after = await song(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const backed = await song(page);
      t.ok(rd.step === 'readings' && rd.rows.length >= 2 && rd.sel && after.hist.length === 1 && (after.tempo !== a.tempo || ts(after) !== ts(a)) && backed.tempo === a.tempo && ts(backed) === ts(a),
        `Not quite?: ${rd.rows.length} readings by ear (${rd.rows.join(' | ')}); ↓ plays the next at once, joined; Esc puts back what was there`);
    } else t.ok(false, 'Not quite? is offered on a take with more than one reading');
    await page.screenshot({ path: path.join(OUTDIR, 'start-readings.png') });
    // ⌘Z once and the song is blank: the door is back
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(300);
    const u = await E(page, () => { const o = window.overdub, p = o.store.get(); return { tracks: p.tracks.length, tempo: p.tempo, loop: p.loop.on, step: o.start.step, door: !!document.querySelector('.st-door')?.getClientRects().length }; });
    t.ok(u.tracks === 0 && u.tempo === 120 && !u.loop && !u.step && u.door, `one undo takes out the tempo, the track, the clip and the loop; the door is back (${JSON.stringify(u)})`);
    t.ok(!real(o.errors).length, `tap a beat: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'tap a beat threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ over a click: the beat window, the count-in, the fold */
{
  console.log('\nover a click');
  const o = await blank();
  const { page } = o;
  // grid beat -> a time on the page's clock, at the click's tempo, from the engine's beat now
  const at = (beats) => E(page, (bs) => { const o = window.overdub, g = o.engine.gridBeat, bpm = o.start.click().bpm, now = performance.now(); return bs.map((b) => now + ((b - g) * 60000) / bpm); }, beats);
  const until = async (beat, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const g = await E(page, () => window.overdub.engine.gridBeat); if (g >= beat) return g; await page.waitForTimeout(40); } return null; };
  try {
    const clickWas = await E(page, () => window.overdub.engine.metronome);
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await page.click('.st-view');
    await page.waitForTimeout(250);
    const c0 = await E(page, () => { const o = window.overdub; return { step: o.start.step, view: o.start.view, minute: !!o.onboard?.minute, hist: o.store.history.length, playing: o.engine.playing, beat: o.engine.beat, click: o.engine.metronome, tempo: o.store.get().tempo, loop: o.store.get().loop, title: document.querySelector('.st-title')?.textContent, alt: document.querySelector('.st-view')?.textContent, num: document.querySelector('.bw-num')?.textContent, come: document.querySelector('.bw-come')?.textContent, go: [...document.querySelectorAll('.st-stage .btn-go')].length, speed: [...document.querySelectorAll('.st-speed [role="radio"]')].map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`).join(' '), tapit: document.querySelector('.st-tapit')?.textContent, top: document.querySelector('.tp-tempo-num')?.textContent }; });
    await page.screenshot({ path: path.join(OUTDIR, 'start-click-countin.png') });
    t.ok(c0.step === 'play' && c0.view === 'click' && !c0.minute && c0.hist === 0 && c0.title === 'Tap your beat with the click.' && c0.alt === 'Free time instead', `Play to a click instead stays on the stage, the click view, no first minute and nothing in History (${JSON.stringify({ step: c0.step, view: c0.view, minute: c0.minute, hist: c0.hist })}; "${c0.title}")`);
    t.ok(c0.playing && c0.beat < 0 && /^[1-4]$/.test(c0.num) && c0.come === 'Come in on 1.' && c0.click, `the take starts from a stopped transport with a bar of count-in: "${c0.num}", "${c0.come}" (beat ${c0.beat?.toFixed(2)}, the click lent: ${c0.click})`);
    t.ok(c0.tempo === 100 && c0.loop.on && c0.loop.end === 8 && c0.speed === 'Slow 80 Easy 100* Upbeat 120' && c0.tapit === 'Tap it (T, four times)' && c0.top === '100' && c0.go === 0, `Speed as underlined words, Easy 100 chosen, a 2-bar loop, heard and not kept; the top bar shows the click's tempo (${c0.speed}; ${c0.top})`);
    // Speed: a preview of the tempo, a fresh take
    await page.click('.st-speed [role="radio"]:has-text("Upbeat 120")');
    await page.waitForTimeout(200);
    const sp = await E(page, () => { const o = window.overdub; return { tempo: o.store.get().tempo, hist: o.store.history.length, playAt: o.start.click().playAt, beat: o.engine.beat }; });
    t.ok(sp.tempo === 120 && sp.hist === 0 && sp.beat < 0, `Upbeat 120: the tempo is a preview, History unchanged (${sp.tempo} BPM, ${sp.hist} changes), and the take counts in again (beat ${sp.beat?.toFixed(2)})`);
    // the first hit window opens one bar after play
    await until(0.5);
    const op = await E(page, () => { const c = window.overdub.start.click(), w = window.overdub.start.window(); return { gap: c.openAt - c.playAt, open: w.open, numeral: w.numeral, come: document.querySelector('.bw-come')?.textContent }; });
    const bar = (4 * 60000) / 120;
    t.ok(op.gap >= bar * 0.9 && op.gap <= bar * 1.35 && op.open && !op.numeral && op.come === '', `the first hit window opens one bar after play (${Math.round(op.gap)} ms; a bar at 120 is ${bar} ms), and the count goes`);
    // a hit in the count-in isn't kept
    // the ball follows engine.beat across two frames
    const ball = [];
    for (let i = 0; i < 2; i++) {
      ball.push(await E(page, () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const w = window.overdub.start.window(); r({ ...w, now: window.overdub.engine.beat }); })))));
      await page.waitForTimeout(130);
    }
    const xOf = (w) => w.lab + ((((w.ball.beat % w.length) + w.length) % w.length) / w.length) * w.inner;
    const okBall = ball.every((w) => w.ball && Math.abs(w.ball.x - xOf(w)) < 1 && Math.abs(w.now - w.ball.beat) < 0.25) && ball[0].ball.beat !== ball[1].ball.beat && ball[1].ball.x !== ball[0].ball.x;
    t.ok(okBall && ball[0].barPx >= 160, `the ball's place is the engine's beat, frame by frame (beat ${ball.map((w) => w.ball?.beat?.toFixed(2)).join(' → ')}, x ${ball.map((w) => w.ball?.x).join(' → ')}; ${ball[0].barPx} px a bar)`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-click.png') });
    // reduced motion: no ball, the current beat's cell in reverse print
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    const rm = await E(page, () => window.overdub.start.window());
    await page.screenshot({ path: path.join(OUTDIR, 'start-click-reduced.png') });
    t.ok(!rm.ball && Number.isInteger(rm.cell), `with reduced motion there's no ball; beat ${rm.cell + 1}'s cell is lit instead`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // the keys stay on the stage: Space with no hits is Done (nothing to land), the transport plays on; ← is Speed
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    const ks = await E(page, () => { const o = window.overdub; return { playing: o.engine.playing, step: o.start.step, hist: o.store.history.length, tempo: o.store.get().tempo, bottom: o.ui.isOpen?.('bottom') ?? null }; });
    t.ok(ks.playing && ks.step === 'play' && ks.hist === 0 && ks.tempo === 100, `Space never reaches the transport over the click, and ← is a slower Speed (${JSON.stringify(ks)})`);
    // Tap it: four T presses, then the click moves to them
    const tt = await E(page, () => performance.now());
    const bpmT = await E(page, (t0) => { let r = null; for (let i = 0; i < 5; i++) r = window.overdub.start.tapTempo(t0 + i * 650); return r; }, tt);
    const tline = await E(page, () => document.querySelector('.st-status')?.textContent);
    await page.waitForTimeout(900);
    const ta = await E(page, () => ({ tempo: window.overdub.store.get().tempo, bpm: window.overdub.start.click().bpm, hist: window.overdub.store.history.length, beat: window.overdub.engine.beat }));
    t.ok(Math.abs(bpmT - 92) <= 2 && /^About \d+ BPM\. Tap again to change it\.$/.test(tline) && ta.tempo === bpmT && ta.bpm === bpmT && ta.hist === 0, `Tap it: T five times 650 ms apart reads ${bpmT} BPM ("${tline}"), and the click moves there, still a preview (${ta.tempo} BPM)`);
    await page.click('.st-speed [role="radio"]:has-text("Upbeat 120")');
    await page.waitForTimeout(150);
    // rounds fold under you: a kick played only in round 1 of 2 isn't in what plays in round 3, and isn't kept. (R14's
    // "round 2's preview" read as the preview the fold makes once round 2 is played: under round 2 the fold so far is
    // round 1 alone, nothing in it has been missed yet, and the source spec's round-2 frame shows it playing under you)
    const BEAT = [[0, 'kick'], [2, 'snare'], [4, 'kick'], [5, 'kick'], [6, 'snare'], ...[0, 1, 2, 3, 4, 5, 6, 7].map((b) => [b, 'hat'])];
    const r1 = [...BEAT, [3.5, 'kick']], r2 = BEAT;
    const plan = [...r1.map(([b, row]) => [b + 0.02, row]), ...r2.map(([b, row]) => [8 + b - 0.02, row])];
    const ms = await at(plan.map((x) => x[0]));
    await E(page, ([hs]) => { for (const x of hs) window.overdub.start.tap(x.row, x.ms); }, [plan.map((x, i) => ({ row: x[1], ms: ms[i] }))]);
    await until(8.3);
    const mid = await E(page, () => ({ c: window.overdub.start.click(), line: document.querySelector('.st-status')?.textContent }));
    await until(16.3);
    const after = await E(page, () => { const o = window.overdub, tr = o.store.get().tracks[0]; return { c: o.start.click(), line: document.querySelector('.st-status')?.textContent, rounds: document.querySelector('.st-rounds')?.textContent, preview: (tr?.clips || []).flatMap((c) => c.notes.map((n) => `${n.p}@${n.t}`)), hist: o.store.history.length }; });
    await page.screenshot({ path: path.join(OUTDIR, 'start-click-rounds.png') });
    const has35 = (xs) => xs.some((x) => x === '36@3.5' || (x.p === 36 && x.t === 3.5));
    t.ok(mid.c.rounds === 1 && has35(mid.c.fold) && /^Round 2\. Kept so far: 14 hits\. What you play most often stays; one-off misses don’t\.$/.test(mid.line), `round 2 plays round 1 under you ("${mid.line}")`);
    t.ok(after.c.rounds === 2 && !has35(after.c.fold) && !has35(after.preview) && after.preview.length === 13 && after.hist === 0 && /^Round 3\. Kept so far: 13 hits\./.test(after.line), `round 3: the kick played only in round 1 of 2 is out of the fold and out of what plays (${after.preview.length} hits under you; "${after.line}")`);
    // Done: lands like a free take, one step by you, at the click's tempo
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const a = await song(page);
    const inn = await E(page, () => ({ step: window.overdub.start.step, sub: document.querySelector('.st-sub')?.textContent, notquite: !!document.querySelector('.st-notquite'), click: window.overdub.engine.metronome }));
    const notes = a.tracks[0]?.clips[0]?.notes.map((n) => `${n.p}@${n.t}`) || [];
    t.ok(a.hist.length === 1 && a.hist[0].by === 'you' && a.hist[0].label === 'your beat, 2 bars at 120 BPM' && a.tempo === 120 && a.loop.end === 8 && notes.length === 13 && !has35(notes) && a.tracks[0].clips[0].notes.every((n) => n.by === 'you'), `Done: one History entry by you, "${a.hist[0]?.label}", the 13 hits played both times and not the one-off kick`);
    t.ok(inn.step === 'in' && /You played it twice; kept the 13 hits you played both times, left out 1\./.test(inn.sub) && !inn.notquite && inn.click === clickWas, `it's in: "${inn.sub}"; over a click the 1 is known, so no Not quite?; the click is given back (${inn.click})`);
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(300);
    const u = await E(page, () => { const o = window.overdub, p = o.store.get(); return { tracks: p.tracks.length, tempo: p.tempo, loop: p.loop.on, step: o.start.step, door: !!document.querySelector('.st-door')?.getClientRects().length }; });
    t.ok(u.tracks === 0 && u.tempo === 120 && !u.loop && !u.step && u.door, `⌘Z once: a blank song again (${JSON.stringify(u)})`);
    // Free time instead swaps back; the keys: T, Backspace, Enter, ←/→ stay on the stage
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await E(page, () => window.overdub.start.setView('click'));
    await page.waitForTimeout(300);
    const before = await E(page, () => ({ bottom: window.overdub.ui.isOpen?.('bottom') ?? null, loopOn: window.overdub.store.get().loop.on }));
    for (const k of ['KeyT', 'Backspace', 'ArrowRight', 'Enter', 'KeyD', 'KeyB']) { await page.keyboard.press(k); await page.waitForTimeout(60); }
    const ks2 = await E(page, () => ({ step: window.overdub.start.step, view: window.overdub.start.view, playing: window.overdub.engine.playing, hist: window.overdub.store.history.length, bottom: window.overdub.ui.isOpen?.('bottom') ?? null }));
    t.ok(ks2.step === 'play' && ks2.view === 'click' && ks2.playing && ks2.hist === 0 && ks2.bottom === before.bottom, `T, ⌫, →, Enter, D and B stay on the stage over a click (${JSON.stringify(ks2)})`);
    await page.click('.st-view');
    await page.waitForTimeout(250);
    const fr = await E(page, () => ({ view: window.overdub.start.view, title: document.querySelector('.st-title')?.textContent, playing: window.overdub.engine.playing, click: window.overdub.engine.metronome, hist: window.overdub.store.history.length }));
    t.ok(fr.view === 'free' && fr.title === 'Tap your beat.' && !fr.playing && fr.click === clickWas && fr.hist === 0, `Free time instead swaps it back: the click goes back as it was, nothing in History (${JSON.stringify(fr)})`);
    await page.keyboard.press('Escape');
    t.ok(!real(o.errors).length, `over a click: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'over a click threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ leaving, the agent, Hum over it */
{
  console.log('\nleaving, the agent, the next part');
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const shut = await E(page, () => ({ step: window.overdub.start.step, tracks: window.overdub.store.get().tracks.length, door: !!document.querySelector('.st-door')?.getClientRects().length }));
    t.ok(!shut.step && shut.tracks === 0 && shut.door, `Esc before a hit closes the stage and leaves nothing behind (${JSON.stringify(shut)})`);
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page, { rounds: 2 });
    // the agent waits while a take is played on the stage
    const ag = await E(page, () => window.overdub.tools.run('apply_ops', { label: 'x', ops: [{ type: 'project.set', patch: { tempo: 90 } }] }, { by: 'claude' }));
    const ro = await E(page, () => window.overdub.tools.run('get_project', {}, { by: 'claude' }));
    t.ok(ag?.error === 'recording' && !ro?.error, `while you play on the stage an agent's change waits ("${ag?.error}"), and reading the song doesn't (${ro?.error || 'ok'})`);
    const caps0 = await E(page, () => window.overdub.input.capture.list({ all: true }).length);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const ask = await E(page, () => ({ step: window.overdub.start.step, line: document.querySelector('.st-status')?.textContent }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const left = await E(page, () => ({ step: window.overdub.start.step, tracks: window.overdub.store.get().tracks.length, hist: window.overdub.store.history.length, caps: window.overdub.input.capture.list({ all: true }).length }));
    t.ok(ask.step === 'play' && /^Leave without keeping this take\? It stays in Takes\./.test(ask.line) && !left.step && left.tracks === 0 && left.hist === 0 && left.caps === caps0 + 1, `Esc after hits asks once ("${ask.line}"); leaving keeps nothing in the song, the take in Takes (${caps0} → ${left.caps})`);
    // Hum over it: the stage again, over the song (the beat looping over its bars, no Speed, no Beat)
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    const tempo0 = await E(page, () => window.overdub.store.get().tempo);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const next = await E(page, () => { const o = window.overdub; return { step: o.start.step, hum: o.start.hum(), playing: o.engine.playing, tempo: o.store.get().tempo, speed: !!document.querySelector('.st-stage .st-choice'), alt: document.querySelector('.st-alt')?.textContent, hist: o.store.history.map((x) => x.label) }; });
    t.ok(next.step === 'hum' && next.hum?.over && next.playing && next.tempo === tempo0 && !next.speed && !next.alt && next.hist.length === 1, `Hum over it (Enter): the stage reopens over the song, the beat looping, no Speed or Beat, the tempo as it was (${JSON.stringify(next)})`);
    await E(page, () => window.overdub.start.close({ to: 'song' }));
    t.ok(!real(o.errors).length, `leaving and the next part: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'leaving threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ hum a tune, over a beat */
{
  console.log('\nhum a tune');
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Hum a tune"]');
    await page.waitForTimeout(600);
    const g = await E(page, () => { const o = window.overdub, p = o.store.get(); return { step: o.start.step, playing: o.engine.playing, tempo: p.tempo, tracks: p.tracks.map((tr) => tr.name), clips: p.tracks.map((tr) => tr.clips.length), hist: o.store.history.length, speed: document.querySelector('.st-word[aria-checked="true"]')?.textContent, go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) }; });
    t.ok(g.step === 'hum' && g.playing && g.tempo === 100 && g.tracks.join() === 'Drums' && g.clips[0] === 1 && g.hist === 0, `Hum a tune: a simple beat already looping at Easy 100, heard and not in History (${JSON.stringify(g)})`);
    t.ok(g.go.length === 1 && /^Hum H$/.test(g.go[0]), `one primary: Hum (${g.go.join(', ')})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-hum.png') });
    await page.click('.st-word:has-text("Upbeat 120")');
    await page.waitForTimeout(200);
    const up = await E(page, () => ({ tempo: window.overdub.store.get().tempo, hist: window.overdub.store.history.length }));
    t.ok(up.tempo === 120 && up.hist === 0, `Speed is a preview too (${up.tempo} BPM, ${up.hist} changes)`);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(1200);
    const h = await E(page, () => { const o = window.overdub, p = o.store.get(); return { step: o.start.step, rec: o.input.recorder.state, humming: o.input.recorder.humming?.(), tempo: p.tempo, hist: o.store.history.map((x) => `${x.label} (${x.by})`), drums: p.tracks.filter((tr) => tr.name === 'Drums').length }; });
    t.ok(h.step === 'hum' && h.tempo === 120 && h.drums === 1 && /^a beat to hum over, 4 bars at 120 BPM \(you\)$/.test(h.hist[0]) && (h.rec === 'count' || h.rec === 'rec') && h.humming, `H: the beat goes in, signed you, and the hum records over it on the stage, with a bar to come in on (${h.step}, ${h.rec}, humming ${h.humming}; ${h.hist.join(' / ')})`);
    await E(page, () => { window.overdub.input.recorder.cancel?.(); window.overdub.start.close({ quiet: true }); });
    t.ok(!real(o.errors).length, `hum a tune: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'hum threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the sound card on the stage (R17, R18) */
{
  console.log('\nthe sound card on the stage');
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(900);
    const c = await E(page, () => { const st = document.querySelector('.st-stage'), card = document.querySelector('.snd-card'); return { step: window.overdub.start.step, inStage: !!card && !!st?.contains(card), go: [...st.querySelectorAll('.btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), rows: [...st.querySelectorAll('.snd-row')].length, dev: window.overdub.store.get().tracks[0]?.instrument?.device, hist: window.overdub.store.history.length }; });
    t.ok(c.step === 'in' && c.inStage && c.rows >= 2, `on 'in' the stage holds the sound card (.snd-card inside .st-stage, ${c.rows} sounds)`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(700);
    const tr = await E(page, () => { const st = document.querySelector('.st-stage'); return { trying: window.overdub.sounds.trying(), keep: [...st.querySelectorAll('.snd-keep')].map((b) => b.className), go: [...st.querySelectorAll('.btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), hist: window.overdub.store.history.length }; });
    t.ok(!!tr.trying && tr.hist === c.hist && tr.keep.length === 1 && !/btn-go/.test(tr.keep[0]) && tr.go.length === 1 && /^Hum over it/.test(tr.go[0]),
      `↓ tries the next sound (${tr.trying?.name}), nothing in History; Keep is a plain .btn and the stage's one primary is still the next part (${tr.go.join(', ')})`);
    await page.click('.st-stage .snd-keep');
    await page.waitForTimeout(400);
    const k = await E(page, () => ({ line: document.querySelector('.st-status')?.textContent, dev: window.overdub.store.get().tracks[0]?.instrument?.device, hist: window.overdub.store.history.map((x) => x.by), step: window.overdub.start.step }));
    t.ok(k.step === 'in' && k.dev !== c.dev && k.hist.length === c.hist + 1 && k.hist.at(-1) === 'you' && new RegExp(`^Drums plays ${tr.trying?.name} now\\.$`).test(k.line || ''), `Keep is its own undo step by you, and the line says so: "${k.line}" (${c.dev} → ${k.dev})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-in-card.png') });
    await page.click('.st-back');
    await page.waitForTimeout(300);
    const g = await E(page, () => ({ step: window.overdub.start.step, card: !!document.querySelector('.st-stage .snd-card'), host: !!window.overdub.sounds.el?.closest?.('.st-stage') }));
    t.ok(!g.step && !g.card && !g.host, `after Back to the song the card isn't on the stage, and the host is given back (${JSON.stringify(g)})`);
    t.ok(!real(o.errors).length, `the card: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'the card threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ a free hum, with a weak pulse (R20, R21, R24, R25, R33) */
{
  console.log('\na free hum');
  // a hum in rubato: note lengths no steady count fits well (fit 0.32 when read in Node; the fake mic moves it a little)
  const MEL = [[60, 1.3], [64, 0.7], [67, 1.15], [69, 0.45, 0.3], [67, 1.6], [64, 0.35], [62, 0.9], [60, 1.7]];
  const hm = sloppyHum(MEL, { tempo: 100, sloppy: 0.06, seed: 4 });
  const file = path.join(OUTDIR, 'start-free-hum.wav');
  const secs = wav(hm.x, hm.sr, file, { lead: 0.6, tail: 1.6 });
  const o = await open('/app/', { query: 'new&on=start.slice2', fakeAudio: file });
  const { page } = o;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await page.waitForTimeout(500);
    await page.click('.st-way-b[data-way="Hum a tune"]');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'No beat; I’ll hum freely' }).click();
    await page.waitForTimeout(300);
    // the keys stay on the stage: ← → and R reach nothing
    for (const key of ['ArrowLeft', 'ArrowRight', 'KeyR']) await page.keyboard.press(key);
    await page.waitForTimeout(200);
    const f0 = await E(page, () => { const o = window.overdub; return { step: o.start.step, hum: o.start.hum(), playing: o.engine.playing, rec: o.input.recorder.state, tracks: o.store.get().tracks.length, hist: o.store.history.length, busy: o.start.busy }; });
    t.ok(f0.step === 'hum' && f0.hum?.mode === 'free' && f0.hum.on && !f0.playing && f0.rec === 'idle' && f0.tracks === 0 && f0.hist === 0 && f0.busy, `"No beat; I'll hum freely" stays on the stage: the mic listens, nothing plays, nothing is in the song, and ← → R reach nothing (${JSON.stringify(f0)})`);
    await page.waitForTimeout(secs * 1000 - 300);
    const f1 = await E(page, () => ({ hum: window.overdub.start.hum(), line: document.querySelector('.st-status')?.textContent }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-free-hum.png') });
    t.ok(f1.hum.notes >= 6 && /^About \d+ BPM · \d+ notes$/.test(f1.line) && f1.hum.ruler === (f1.hum.fit >= 0.5 || !!f1.hum.ruler), `the notes form as you hum, and the line counts them: "${f1.line}" (fit ${f1.hum.fit}, ruler ${f1.hum.ruler})`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    const l = await E(page, () => { const o = window.overdub, p = o.store.get(), st = document.querySelector('.st-stage'); return { step: o.start.step, take: o.start.take(), tempo: p.tempo, key: p.key, hist: o.store.history.map((x) => `${x.label} (${x.by})`), tracks: p.tracks.map((tr) => `${tr.name}:${tr.clips.map((c) => c.notes.length).join('+')}`), title: st?.querySelector('.st-title')?.textContent, sub: st?.querySelector('.st-sub')?.textContent, promoted: st?.querySelector('.st-promoted')?.textContent || null, card: !!st?.querySelector('.snd-card'), go: st ? st.querySelectorAll('.btn-go').length : 0, tune: !!st?.querySelector('.st-timing .st-tune'), cap: o.input.capture.ofClip(o.start.landed()?.clip)?.rounds ?? null }; });
    const weak = l.take && l.take.fit < 0.5;
    t.ok(l.step === 'in' && l.hist.length === 1 && / \(you\)$/.test(l.hist[0]) && /^Melody:\d+$/.test(l.tracks.join()) && l.tempo === Math.round(l.take.bpm) && l.key && l.title === 'Your tune is in the song.' && /^Melody, bars? 1(–\d+)? at \d+ BPM, in [A-G][#b]? (major|minor), sung by you\./.test(l.sub),
      `Done lands it at its best reading, whatever the fit: one undo step by you, ${l.tracks.join()}, ${l.tempo} BPM, the key heard (${l.key?.root} ${l.key?.scale}); "${l.sub}"`);
    t.ok(weak ? /^It’s in at \d+ BPM, but the hum didn’t settle on a steady beat\. Hear the other ways it could go, or hum it again over a beat\.$/.test(l.promoted) : !l.promoted, `the line is promoted only on a weak pulse (fit ${l.take?.fit?.toFixed?.(2)}): ${l.promoted ? `"${l.promoted}"` : 'not promoted'}`);
    t.ok(l.card && l.go === 1 && l.tune && l.cap === 1, `the hum's 'in': the card with the hum's sounds, one primary, the In tune lamp on the Timing line, and the take in capture under its clip`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-free-in.png') });
    // In tune: off puts the notes back as sung, on puts them in the key again; each joined to the landing
    const ps = () => E(page, () => ({ ps: window.overdub.store.get().tracks[0].clips[0].notes.map((n) => n.p).join(' '), on: document.querySelector('.st-tune')?.getAttribute('aria-pressed'), hist: window.overdub.store.history.length }));
    const t0 = await ps();
    await page.click('.st-tune');
    await page.waitForTimeout(150);
    const t1 = await ps();
    await page.click('.st-tune');
    await page.waitForTimeout(150);
    const t2 = await ps();
    t.ok(t0.on === 'true' && t1.on === 'false' && t2.on === 'true' && t2.ps === t0.ps && t1.hist === 1 && t2.hist === 1, `In tune off and on again: as sung (${t1.ps}), in the key (${t2.ps}), still one undo step`);
    // the readings: three, each with a soft tick under it, Use this one joined to the landing
    await page.click('.st-notquite');
    await page.waitForTimeout(300);
    const rd = await E(page, () => ({ step: window.overdub.start.step, n: document.querySelectorAll('.st-reading').length, rows: [...document.querySelectorAll('.st-reading')].map((r) => r.textContent), tick: window.overdub.store.get().tracks.some((tr) => tr.name === 'Tick'), again: !!document.querySelector('.st-overbeat'), hist: window.overdub.store.history.length }));
    const lvl = await E(page, () => window.overdub.start.tick());
    t.ok(rd.step === 'readings' && rd.n === 3 && rd.again && rd.hist === 1, `Not quite? lists three readings (${rd.rows.join(' | ')}) and Hum it again over a beat`);
    t.ok(rd.tick && lvl && lvl.under >= 12 && lvl.tick > -100, `a soft tick on every beat, on a preview track: measured ${lvl?.tick} dB RMS against the take's ${lvl?.take}, ${lvl?.under} dB under (≥ 12)`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-free-readings.png') });
    await page.click('.st-reading:nth-child(2)');
    await page.waitForTimeout(300);
    await page.click('.st-use');
    await page.waitForTimeout(300);
    const u = await E(page, () => ({ step: window.overdub.start.step, hist: window.overdub.store.history.length, tick: window.overdub.store.get().tracks.some((tr) => tr.name === 'Tick'), reading: window.overdub.start.take()?.reading, tempo: window.overdub.store.get().tempo }));
    t.ok(u.step === 'in' && u.hist === 1 && !u.tick && u.reading === 1, `Use this one adds no History entry (${u.hist}), the tick goes with the readings, ${u.tempo} BPM now`);
    const fn = await E(page, () => ({ next: document.querySelector('.st-next')?.textContent, back: !!document.querySelector('.st-back:not(.btn-go)'), after: window.overdub.coach.after({ kind: 'hum', free: true, landed: window.overdub.start.landed() })?.label }));
    t.ok(fn.next === 'Put a beat under it' && fn.after === fn.next && fn.back, `a free hum's next part is "${fn.next}" (the strip's run: Tune ✓ · Beat · Band), Back to the song beside it`);
    // Hum it again over a beat: the landing comes back out and the stage hums over a beat at that speed
    await page.click('.st-notquite');
    await page.waitForTimeout(300);
    await page.click('.st-overbeat');
    await page.waitForTimeout(500);
    const ob = await E(page, () => { const o = window.overdub; return { step: o.start.step, hum: o.start.hum(), hist: o.store.history.length, tempo: o.store.get().tempo, sel: document.querySelector('.st-choice[aria-label="Speed"] [aria-checked="true"]')?.textContent }; });
    t.ok(ob.step === 'hum' && ob.hum?.mode === 'beat' && !ob.hum.rec && ob.hist === 0 && ob.tempo === Math.max(60, Math.min(180, u.tempo)) && /\d+$/.test(ob.sel || ''), `Hum it again over a beat: the landing comes back out and the beat plays at that reading's speed (${ob.tempo} BPM, "${ob.sel}")`);
    await E(page, () => window.overdub.start.close({ quiet: true }));
    t.ok(!real(o.errors).length, `a free hum: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'a free hum threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ a hum over the beat, on the stage (R22, R23) */
{
  console.log('\na hum over the beat');
  // the fake mic plays from when the take opens it, at the count-in: the first two notes fall in the count-in (a
  // pickup), the rest from bar 1
  const MEL = [[67, 1], [69, 1], [72, 1], [71, 0.5], [69, 0.5], [67, 1], [64, 1], [62, 1], [60, 2]];
  const hm = sloppyHum(MEL, { tempo: 100, sloppy: 0.04, seed: 6 });
  const file = path.join(OUTDIR, 'start-hum-over.wav');
  wav(hm.x, hm.sr, file, { lead: 0.9, tail: 6 });
  const o = await open('/app/', { query: 'new&on=start.slice2', fakeAudio: file });
  const { page } = o;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await page.waitForTimeout(500);
    await page.click('.st-way-b[data-way="Hum a tune"]');
    await page.waitForTimeout(500);
    const caps0 = await E(page, () => window.overdub.input.capture.list({ all: true }).length);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(500);
    const c = await E(page, () => ({ hum: window.overdub.start.hum(), busy: window.overdub.start.busy, line: document.querySelector('.st-status')?.textContent }));
    t.ok(c.hum?.mode === 'beat' && c.hum.rec && c.hum.state === 'count' && c.busy && c.line === 'Come in on 1.', `H: a bar of count-in on the stage, "${c.line}" (${c.hum?.state})`);
    await page.waitForTimeout(2400 + 9600 + 800);
    const r = await E(page, () => ({ hum: window.overdub.start.hum(), line: document.querySelector('.st-status')?.textContent }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-hum-over.png') });
    t.ok(r.hum?.state === 'rec' && r.hum.round >= 2 && /^Round \d+\. /.test(r.line), `round after round, each a take: "${r.line}"`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(2500);
    const l = await E(page, () => { const o = window.overdub, p = o.store.get(), st = document.querySelector('.st-stage'); const mel = p.tracks.find((tr) => tr.name === 'Melody'); return { step: o.start.step, take: o.start.take(), hist: o.store.history.map((x) => `${x.label} (${x.by})`), mel: mel ? mel.clips.map((cl) => ({ name: cl.name, mute: !!cl.mute, take: !!cl.take, at0: cl.notes.filter((n) => n.t === 0).length })) : null, sub: st?.querySelector('.st-sub')?.textContent, card: !!st?.querySelector('.snd-card'), tune: !!st?.querySelector('.st-timing .st-tune'), caps: o.input.capture.list({ all: true }).map((x) => ({ src: x.src, rec: !!x.rec, n: x.notes.length, beat: x.beat })) }; }, caps0);
    const playing = (l.mel || []).filter((x) => !x.mute);
    const left = l.caps.filter((x) => x.src === 'hum' && !x.rec);
    t.ok(l.step === 'in' && l.hist.length === 1 && / \(you\)$/.test(l.hist[0]) && l.mel && l.mel.every((x) => x.take) && playing.length === 1 && playing[0].at0 <= 1,
      `Done keeps the steadiest round on a new Melody, its takes in the clip's take lanes (${l.mel?.map((x) => `${x.name}${x.mute ? ' (muted)' : ''}`).join(', ')}), the beat and the tune one undo step: ${l.hist.join(' / ')}`);
    t.ok(left.length >= 1 && left.some((x) => x.n >= 1), `the notes sung in the count-in went to capture, not onto beat 1 (${left.map((x) => `${x.n} notes`).join(', ')}; ${playing[0]?.at0 ?? '?'} on beat 1)`);
    t.ok(/^Melody, bars 1–4 at 100 BPM, in [A-G][#b]? (major|minor), over Drums\. (Kept round \d+, the steadiest of \d+\.|One time round, kept as you sang it\.)/.test(l.sub || '') && l.card && l.tune, `"${l.sub}"; the card and the In tune lamp`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-hum-over-in.png') });
    // the door "Hum a tune": the next part is the band; the strip docks with both words done and the rows open
    const nx = await E(page, () => document.querySelector('.st-next')?.textContent);
    await page.click('.st-next');
    await page.waitForTimeout(800);
    const cs = await E(page, () => ({ st: window.overdub.coach.state(), words: [...document.querySelectorAll('.cs-word')].map((w) => w.textContent), rows: [...document.querySelectorAll('.cs-style .cs-sname')].map((r) => r.textContent) }));
    t.ok(nx === 'Build a band around it' && cs.st?.door === 'hum' && cs.words.join(' · ') === 'Beat ✓ · Tune ✓ · Band' && cs.st.step === 'band' && cs.st.rows && cs.rows.slice(0, 5).join() === 'Pop,Rock,Lo-fi,House,Ballad',
      `the hum's next part is "${nx}": the strip docks, ${cs.words.join(' · ')}, the style rows open (${cs.rows.join(', ')})`);
    await page.click('.cs-x');
    await page.waitForTimeout(200);
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(300);
    const u = await E(page, () => ({ tracks: window.overdub.store.get().tracks.length, step: window.overdub.start.step }));
    t.ok(u.tracks === 0 && !u.step, `one undo takes out the beat and the tune together (${u.tracks} tracks)`);
    t.ok(!real(o.errors).length, `a hum over the beat: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'a hum over the beat threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the ways in: Song ▸ Start a song, Find, "~" in the top bar */
{
  console.log('\nthe ways in, and the top bar');
  const o = await blank();
  const { page } = o;
  try {
    const tp = () => E(page, () => { const n = document.querySelector('.tp-tempo-num'), t = document.querySelector('.tp-tempo'); return { text: n?.textContent, vt: t?.getAttribute('aria-valuetext'), now: t?.getAttribute('aria-valuenow'), ball: window.overdub.transport.ball, tempo: window.overdub.store.get().tempo, step: window.overdub.start.step }; });
    // the Song menu on a blank song: Start a song under New song, and it opens the stage at once
    await page.click('.sm-btn');
    await page.waitForTimeout(250);
    const m = await E(page, () => { const rows = [...document.querySelectorAll('.sm > .sm-i')].map((b) => b.querySelector('b')?.textContent); const r = document.querySelector('.sm-start'); return { rows: rows.slice(0, 3), sub: r?.querySelector('small')?.textContent }; });
    await page.screenshot({ path: path.join(OUTDIR, 'start-song-menu.png') });
    t.ok(m.rows[0] === 'New song' && m.rows[1] === 'Start a song' && m.sub === 'a blank reel, then your idea', `Song ▸ Start a song, under New song: "${m.sub}" (${m.rows.join(' · ')})`);
    await page.click('.sm-start');
    await page.waitForTimeout(400);
    const a = await E(page, () => ({ step: window.overdub.start.step, kind: window.overdub.start.kind, hist: window.overdub.store.history.length, pop: !!document.querySelector('.ew-pop') }));
    t.ok(a.step === 'play' && a.kind === 'tap' && a.hist === 0 && !a.pop, `on a blank song it opens the stage at Tap a beat, nothing asked (${JSON.stringify(a)})`);
    // "~" in the top bar until the stage shows a BPM; the tempo holds still meanwhile
    const t0 = await tp();
    await E(page, () => { const t = performance.now(); for (let i = 0; i < 4; i++) window.overdub.start.tap(i % 2 ? 'snare' : 'kick', t + i * 600); });
    await page.waitForTimeout(120);
    const t1 = await tp();
    await page.screenshot({ path: path.join(OUTDIR, 'start-topbar-finding.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    await page.dispatchEvent('.tp-tempo', 'wheel', { deltaY: -100 });
    await page.focus('.tp-tempo');
    await page.keyboard.press('ArrowUp');
    await page.mouse.move(0, 0);
    const box = await E(page, () => { const r = document.querySelector('.tp-tempo').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x, box.y - 60, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const t2 = await tp();
    const typing = await E(page, () => !!document.querySelector('.tp-tempo input'));
    t.ok(t0.text === '~' && t1.text === '~' && t1.vt === 'finding the tempo' && t1.now == null && !t1.ball?.moving, `while the stage finds the tempo the top bar reads "${t1.text}" ("${t1.vt}"), the ball still`);
    t.ok(t2.tempo === 120 && t2.text === '~' && !typing && t2.step === 'play', `... and the tempo can't be scrolled, stepped, dragged or typed (${t2.tempo} BPM, still "${t2.text}", typing ${typing})`);
    await E(page, () => window.overdub.start.again());
    await playRock(page, { bpm: 96 });
    await page.waitForTimeout(150);
    const t3 = await tp();
    const stageBpm = await E(page, () => document.querySelector('.st-bpm')?.textContent);
    t.ok(t3.text === stageBpm && t3.vt === `${stageBpm} BPM` && +t3.text !== 120, `once the stage shows a BPM the top bar shows it too (${t3.text}; the stage ${stageBpm})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-topbar-shown.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    const t4 = await tp();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const t5 = await tp();
    t.ok(t4.step === 'in' && t4.text === String(t4.tempo) && !t5.step && t5.text === String(t5.tempo) && t5.vt === `${t5.tempo} BPM`, `landed and closed, it's the song's tempo again (${t4.text}, then ${t5.text})`);
    // a capture of the landed take carries its clip, what was played as played and the rounds
    const cp = await E(page, () => { const o = window.overdub, c = o.store.get().tracks[0].clips[0], ph = o.input.capture.ofClip(c.id); return ph && { clip: ph.clip === c.id, raw: ph.raw?.length, rounds: ph.rounds, kept: ph.kept?.[0]?.clip === c.id, none: o.input.capture.ofClip('nope') }; });
    t.ok(cp && cp.clip && cp.raw > 20 && cp.rounds === 3 && cp.kept && cp.none === null, `the landed take is in capture under its clip: ${cp?.raw} hits as played, ${cp?.rounds} times round (capture.ofClip)`);
    // a song with something in it: the menu asks New song's question first, then a new song and the stage
    await page.click('.sm-btn');
    await page.waitForTimeout(250);
    await page.click('.sm-start');
    await page.waitForTimeout(200);
    const q = await E(page, () => ({ text: document.querySelector('.sm-confirm')?.textContent, go: document.querySelector('.sm-confirm .ew-btn-primary')?.textContent, step: window.overdub.start.step }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-song-menu-ask.png') });
    t.ok(/^Start a new song\? “.*” goes to Recent songs, and Undo brings it back\./.test(q.text || '') && q.go === 'Start a song' && !q.step, `from a song with a track it asks first: "${q.text}"`);
    await page.click('.sm-confirm .ew-btn-primary');
    await page.waitForTimeout(500);
    const y = await E(page, () => ({ tracks: window.overdub.store.get().tracks.length, clips: window.overdub.store.get().tracks.reduce((n, tr) => n + tr.clips.length, 0), step: window.overdub.start.step, recent: window.overdub.exporter.recent().length }));
    t.ok(y.clips === 0 && y.step === 'play' && y.recent >= 1, `yes: a blank song with the stage open, the old song in Recent songs (${JSON.stringify(y)})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Find: "start" puts Start a song first, and Enter does what the menu does
    const f = await E(page, () => window.overdub.find.search('start').slice(0, 3).map((x) => `${x.kind}:${x.title}`));
    t.ok(f[0] === 'go:Start a song', `Find "start": ${f.join(' · ')}`);
    await E(page, () => window.overdub.find.open({ query: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUTDIR, 'start-find.png') });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const fe = await E(page, () => ({ step: window.overdub.start.step, kind: window.overdub.start.kind }));
    t.ok(fe.step === 'play' && fe.kind === 'tap', `... Enter opens the stage on a blank song (${JSON.stringify(fe)})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await E(page, () => window.overdub.store.dispatch({ type: 'track.add', ref: 'k', track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.keys' } } }, { by: 'you' }));
    await E(page, () => { const o = window.overdub, tr = o.store.get().tracks[0]; o.store.dispatch({ type: 'clip.add', track: tr.id, clip: { start: 0, length: 4, notes: [{ p: 60, t: 0, d: 1, v: 0.8 }] } }, { by: 'you' }); });
    await E(page, () => window.overdub.find.open({ query: 'start' }));
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const fa = await E(page, () => ({ step: window.overdub.start.step, ask: document.querySelector('.sm-confirm:not([hidden])')?.textContent || null, clips: window.overdub.store.get().tracks.reduce((n, tr) => n + tr.clips.length, 0) }));
    t.ok(!fa.step && /^Start a new song\?/.test(fa.ask || '') && fa.clips === 1, `... and on a song with clips, the Song menu opens on the same question, nothing replaced yet ("${(fa.ask || '').slice(0, 40)}…")`);
    await page.keyboard.press('Escape');
    t.ok(!real(o.errors).length, `the ways in: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'the ways in threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ a weak pulse: the nudge */
{
  console.log('\nthe nudge');
  // a shaky take (a beginner's: wide jitter and drift) whose reading is weak, found in Node with the stage's own reader
  let hits = null, fit = 0;
  for (let seed = 1; seed < 400 && !hits; seed++) {
    const hs = perform(ROCK, { bpm: 110, bars: 3, jitter: 0.06, drift: 0.08, seed, start: 0 });
    const r = takeOf(hs.map((x) => ({ t: x.t, p: x.p, v: 0.85 })));
    if (r && r.fit.fit < 0.5 && r.fit.fit > 0.2) { hits = hs; fit = r.fit.fit; }
  }
  const o = await blank();
  const { page } = o;
  try {
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    const st0 = await E(page, () => performance.now() + 40);
    await E(page, ([hs]) => { for (const x of hs) window.overdub.start.tap(x.row, x.ms); }, [hits.map((x) => ({ row: ROW[x.p], ms: st0 + x.t * 1000 }))]);
    await page.waitForTimeout(150);
    const w = await E(page, () => ({ line: document.querySelector('.st-status')?.textContent, done: document.querySelector('.st-done')?.textContent.trim(), go: document.querySelector('.st-done')?.classList.contains('btn-go'), dis: document.querySelector('.st-done')?.getAttribute('aria-disabled') }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-nudge.png') });
    t.ok(/ BPM.*\. One more time round helps the studio hear it\.$/.test(w.line || ''), `a weak pulse (fit ${fit}): "${w.line}"`);
    t.ok(/^Done/.test(w.done) && w.go && w.dis === 'false', `... and Done is still Done, ready (${w.done})`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    const l = await E(page, () => ({ step: window.overdub.start.step, hist: window.overdub.store.history.length }));
    t.ok(l.step === 'in' && l.hist === 1, `Done lands it anyway: one step (${JSON.stringify(l)})`);
    // a steady take: no nudge
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(300);
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page, { jitter: 0.01, drift: 0 });
    await page.waitForTimeout(150);
    const s2 = await E(page, () => document.querySelector('.st-status')?.textContent);
    t.ok(!/One more time round/.test(s2 || ''), `a steady take isn't asked ("${s2}")`);
    t.ok(!real(o.errors).length, `the nudge: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'the nudge threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the coach strip: where it docks, its words, pointing, × (R1–R3, R6, R8, R9) */
{
  console.log('\nthe coach strip');
  const o = await blank();
  const { page } = o;
  const rgb = (v) => E(page, (name) => { const d = document.createElement('i'); d.style.color = `var(${name})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
  try {
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await page.click('.st-back');
    await page.waitForTimeout(200);
    const d = await E(page, () => {
      const o = window.overdub, cs = document.querySelector('.cs'), r = cs?.getBoundingClientRect();
      const arr = document.querySelector('.ew-region-center > .ew-content').getBoundingClientRect(), bot = document.querySelector('.ew-region-bottom').getBoundingClientRect(), main = document.querySelector('.ew-main').getBoundingClientRect();
      const pt = document.querySelector('.ui-point'), inst = document.querySelector(`[data-track="${o.store.get().tracks[0].id}"] .ar-hinst`);
      const pr = pt?.getBoundingClientRect(), ir = inst?.getBoundingClientRect();
      return { shown: !!r?.height, top: r?.top, bottom: r?.bottom, left: r?.left, width: r?.width, arrBottom: arr.bottom, botTop: bot.top, mainLeft: main.left, mainW: main.width, region: cs?.getAttribute('role'),
        go: [...cs.querySelectorAll('.btn-go')].map((b) => b.textContent), more: [...cs.querySelectorAll('.cs-more')].map((b) => b.textContent), x: !!cs.querySelector('.cs-x'), line: cs.querySelector('.cs-line')?.textContent,
        words: [...cs.querySelectorAll('.cs-word')].map((w) => w.textContent), coach: o.ui.state.coach, hist: o.store.history.length,
        point: pt && ir ? { dx: Math.abs(pr.left + 3 - ir.left), dy: Math.abs(pr.top + 3 - ir.top), dw: Math.abs(pr.width - 6 - ir.width), label: pt.textContent } : null, stored: Object.keys(localStorage).filter((k) => /coach/i.test(k)) };
    });
    await page.screenshot({ path: path.join(OUTDIR, 'start-strip-tune.png') });
    t.ok(d.shown && d.region === 'region' && d.top >= d.arrBottom - 1 && d.bottom <= d.botTop + 1 && Math.abs(d.left - d.mainLeft) < 2 && Math.abs(d.width - d.mainW) < 2,
      `after Back to the song the strip docks between the arranger and the bottom pane, across the centre column (${Math.round(d.top)}–${Math.round(d.bottom)} px, the arranger ends at ${Math.round(d.arrBottom)}, the pane starts at ${Math.round(d.botTop)})`);
    t.ok(d.go.join() === 'Hum over it' && d.more.join() === 'Tap more on the drums,Play keys over it' && d.x && /^Hum a tune over your beat\. One bar of it counts you in\./.test(d.line), `one .btn-go (${d.go.join(', ')}), two words beside it (${d.more.join(', ')}) and ×; "${d.line}"`);
    t.ok(d.words.join(' · ') === 'Beat ✓ · Tune · Band' && d.coach?.run === 'start' && d.coach.step === 'tune' && d.coach.done.join() === 'beat' && !d.stored.length, `Tap a beat's run sheet: ${d.words.join(' · ')}; ui.state.coach ${JSON.stringify(d.coach)}, nothing stored`);
    t.ok(d.point && d.point.dx <= 1 && d.point.dy <= 1 && d.point.dw <= 1 && !d.point.label && / ↗ opens it big\.$/.test(d.line), `crop marks on the Drums header's instrument, unsigned (off by ${d.point ? `${d.point.dx}, ${d.point.dy}` : 'none'})`);
    await page.waitForTimeout(2100);
    const gone = await E(page, () => !document.querySelector('.ui-point'));
    t.ok(gone, 'the crop marks go after 2 s');
    // the run sheet's words: the step now underlined in cream, done ones --text-2 with ✓, later ones --text-3; no box
    const [c1, c2, c3] = [await rgb('--text'), await rgb('--text-2'), await rgb('--text-3')];
    const ws = await E(page, () => [...document.querySelectorAll('.cs-word')].map((w) => { const s = getComputedStyle(w); return { cls: w.className, color: s.color, under: s.borderBottomWidth, underC: s.borderBottomColor, top: s.borderTopWidth, left: s.borderLeftWidth, bg: s.backgroundColor, radius: s.borderTopLeftRadius, text: w.textContent }; }));
    const cur = ws.find((w) => /cur/.test(w.cls)), done = ws.find((w) => /done/.test(w.cls)), later = ws.find((w) => /later/.test(w.cls));
    t.ok(cur && cur.under === '2px' && cur.underC === c1 && cur.color === c1 && done && done.color === c2 && /✓$/.test(done.text) && later && later.color === c3 && ws.every((w) => w.top === '0px' && w.left === '0px' && w.bg === 'rgba(0, 0, 0, 0)' && w.radius === '0px'),
      `the words: now ${cur?.color} over a ${cur?.under} rule, done ${done?.color} with ✓, later ${later?.color}; no box, fill or pill`);
    // a word is a button: Band; then Build a band around it: three styles heard, nothing in History
    await page.click('.cs-word[data-word="band"]');
    await page.waitForTimeout(150);
    const bw = await E(page, () => ({ step: window.overdub.coach.state().step, go: document.querySelector('.cs-go')?.textContent, line: document.querySelector('.cs-line')?.textContent }));
    t.ok(bw.step === 'band' && bw.go === 'Build a band around it' && /^Let a band play around your song: chords, bass and keys on new tracks\. Hear each style before you keep it\.$/.test(bw.line), `the word Band goes to its step: [${bw.go}] "${bw.line}"`);
    const hearing = async (style) => { for (let i = 0; i < 40; i++) { const st = await E(page, () => window.overdub.coach.state()); if (st?.hearing && st.style === style) return true; await page.waitForTimeout(100); } return false; };
    const t0n = await E(page, () => window.overdub.store.get().tracks.length);
    await page.click('.cs-go');
    const h1 = await hearing('pop');
    const n1 = await E(page, () => window.overdub.store.get().tracks.length);
    await page.screenshot({ path: path.join(OUTDIR, 'start-strip-rows.png') });
    await page.keyboard.press('ArrowDown');
    const h2 = await hearing('rock');
    await page.keyboard.press('ArrowDown');
    const h3 = await hearing('lofi');
    const pv = await E(page, () => ({ hist: window.overdub.store.history.length, rows: [...document.querySelectorAll('.cs-style')].map((r) => `${r.querySelector('.cs-sname').textContent}: ${r.querySelector('.cs-blurb').textContent}`), sel: document.querySelector('.cs-style.sel .cs-sname')?.textContent, go: [...document.querySelectorAll('.cs .btn-go')].map((b) => b.textContent), more: [...document.querySelectorAll('.cs .cs-more')].map((b) => b.textContent) }));
    t.ok(h1 && h2 && h3 && n1 > t0n && pv.hist === d.hist && pv.sel === 'Lo-fi' && pv.rows.length === 5 && /^Pop: /.test(pv.rows[0]) && pv.go.join() === 'Keep the band' && pv.more.join() === 'Not this one',
      `Build a band around it, ↓, ↓: Pop, Rock and Lo-fi heard on the loop (${[h1, h2, h3].join(', ')}; ${t0n} → ${n1} tracks), History unchanged (${pv.hist}); ${pv.rows.length} rows with their blurbs (${pv.sel}); [${pv.go.join()}] ${pv.more.join()}`);
    // liner notes in the strip, rows open: no pills, no coloured side rules, no inset stripes
    const kit = await E(page, () => {
      const els = [...document.querySelectorAll('.cs, .cs *')];
      return { round: els.filter((el) => { const r = getComputedStyle(el).borderTopLeftRadius; return /%/.test(r) || parseFloat(r) >= 8; }).map((el) => el.className),
        stripe: els.filter((el) => { const s = getComputedStyle(el); return parseFloat(s.borderLeftWidth) >= 2 && s.borderLeftColor !== s.borderTopColor; }).map((el) => el.className),
        inset: els.filter((el) => /inset \d+px 0 0/.test(getComputedStyle(el).boxShadow)).map((el) => el.className), go: document.querySelectorAll('.cs .btn-go').length };
    });
    const bad = [...kit.round, ...kit.stripe, ...kit.inset];
    t.ok(!bad.length && kit.go === 1, `liner notes in the strip: no pills, side rules or inset stripes, one primary${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`);
    // Not this one: back to the rows, nothing heard; × ends the run and nothing in the song changes
    await page.click('.cs-more');
    await page.waitForTimeout(200);
    const nt = await E(page, () => ({ st: window.overdub.coach.state(), tracks: window.overdub.store.get().tracks.length, dis: document.querySelector('.cs-go')?.getAttribute('aria-disabled') }));
    t.ok(nt.st.rows && nt.st.sel === -1 && !nt.st.hearing && nt.tracks === t0n && nt.dis === 'true', `Not this one: back to the rows, nothing heard, Keep waits for a style (${nt.tracks} track)`);
    await page.keyboard.press('ArrowDown');
    await hearing('pop');
    await page.click('.cs-x');
    await page.waitForTimeout(200);
    const x = await E(page, () => ({ strip: !!document.querySelector('.cs'), coach: window.overdub.ui.state.coach, hist: window.overdub.store.history.length, tracks: window.overdub.store.get().tracks.length }));
    t.ok(!x.strip && x.coach === null && x.hist === d.hist && x.tracks === t0n, `× (a style still playing): the strip goes, the run ends, History unchanged (${x.hist}) and the band heard is gone (${x.tracks} track)`);
    // a reload ends a run: it isn't kept
    await E(page, () => window.overdub.coach.dock('tap'));
    await page.reload();
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await page.waitForTimeout(400);
    const rl = await E(page, () => ({ strip: !!document.querySelector('.cs'), coach: window.overdub.ui.state.coach, clips: window.overdub.store.get().tracks.reduce((n, tr) => n + tr.clips.length, 0) }));
    t.ok(!rl.strip && rl.coach === null && rl.clips === 1, `a reload ends the run (strip ${rl.strip}); the song is kept as always (${rl.clips} clip)`);
    t.ok(!real(o.errors).length, `the coach strip: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'the coach strip threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the run, press by press (R31, R4, R6, R7) */
{
  console.log('\nthe run, press by press');
  // the hum over the song: the fake mic plays from when Hum opens it, after a bar of count-in
  const MEL = [[67, 1], [69, 1], [72, 1], [71, 0.5], [69, 0.5], [67, 1], [64, 1], [62, 1], [60, 2]];
  const hm = sloppyHum(MEL, { tempo: 100, sloppy: 0.04, seed: 6 });
  const file = path.join(OUTDIR, 'start-run-hum.wav');
  wav(hm.x, hm.sr, file, { lead: 2.9, tail: 6 });
  const o = await open('/app/', { query: 'new&on=start.slice2', fakeAudio: file });
  const { page } = o;
  let presses = 0;
  const press = async (sel) => { presses++; await page.click(sel); };
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
    await page.waitForTimeout(500);
    await press('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.waitForTimeout(150);
    await press('.st-done');
    await page.waitForTimeout(500);
    const a = await song(page);
    const toBeat = presses;
    t.ok(toBeat === 2 && a.hist.length === 1 && a.tracks.length === 1 && a.tracks[0].clips.length === 1, `blank to a beat in the song: ${toBeat} presses (Tap a beat, Done)`);
    const tempo0 = a.tempo;
    // Hum over it: the stage over the song; Hum: the song made 4 bars, the take over it; Done: the steadiest round
    await press('.st-next');
    await page.waitForTimeout(600);
    const ov = await E(page, () => { const o = window.overdub, p = o.store.get(); return { step: o.start.step, hum: o.start.hum(), loop: p.loop, tempo: p.tempo, speed: !!document.querySelector('.st-stage .st-choice'), hist: o.store.history.length, go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) }; });
    t.ok(ov.step === 'hum' && ov.hum?.over && !ov.speed && ov.tempo === tempo0 && ov.hist === 1 && ov.loop.end === 4 && /^Hum H$/.test(ov.go.join()), `Hum over it: the stage over the song, its 1-bar loop going round, no Speed or Beat, nothing in History yet (${JSON.stringify({ loop: ov.loop, tempo: ov.tempo })})`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-run-over.png') });
    await press('.st-hum');
    await page.waitForTimeout(1200);
    const rec = await E(page, () => { const o = window.overdub, p = o.store.get(); return { hum: o.start.hum(), loop: p.loop, clips: p.tracks[0].clips.length, tempo: p.tempo }; });
    t.ok((rec.hum?.state === 'count' || rec.hum?.state === 'rec') && rec.loop.end === 16 && rec.clips === 4 && rec.tempo === tempo0, `Hum: the beat runs 4 bars now (Make it longer: ${rec.clips} clips, the loop to ${rec.loop.end}), the take counts in over it, the tempo unchanged`);
    await page.waitForTimeout(12000);
    await press('.st-done');
    await page.waitForTimeout(2500);
    const b = await E(page, () => { const o = window.overdub, p = o.store.get(); return { step: o.start.step, tempo: p.tempo, tracks: p.tracks.map((tr) => tr.name), hist: o.store.history.map((x) => `${x.label} (${x.by})`), next: document.querySelector('.st-next')?.textContent, sub: document.querySelector('.st-sub')?.textContent }; });
    const toTune = presses;
    t.ok(toTune === 5 && b.step === 'in' && b.tracks.join() === 'Drums,Melody' && b.tempo === tempo0 && b.hist.length === 2 && / \(you\)$/.test(b.hist[1]), `a hummed tune over it on its own track by press ${toTune} (Hum over it, Hum, Done): ${b.tracks.join(', ')}, ${b.tempo} BPM as before; History: ${b.hist.join(' / ')}`);
    t.ok(b.next === 'Build a band around it' && /over Drums\./.test(b.sub || ''), `the stage's next part is "${b.next}"; "${b.sub}"`);
    // Build a band around it: the strip, its rows open and the first style heard; Keep the band
    await press('.st-next');
    for (let i = 0; i < 40; i++) { if (await E(page, () => window.overdub.coach.state()?.hearing)) break; await page.waitForTimeout(100); }
    const r0 = await E(page, () => ({ st: window.overdub.coach.state(), words: [...document.querySelectorAll('.cs-word')].map((w) => w.textContent), hist: window.overdub.store.history.length }));
    t.ok(r0.st?.step === 'band' && r0.st.rows && r0.st.style === 'pop' && r0.words.join(' · ') === 'Beat ✓ · Tune ✓ · Band' && r0.hist === 2, `Build a band around it: ${r0.words.join(' · ')}, the rows open, Pop heard (History still ${r0.hist})`);
    await press('.cs-go');
    for (let i = 0; i < 80; i++) { if ((await E(page, () => window.overdub.coach.state()?.step)) === 'end') break; await page.waitForTimeout(150); }
    const k = await E(page, () => { const o = window.overdub, p = o.store.get(); const bpb = 4; let end = 0; for (const tr of p.tracks) for (const c of tr.clips) end = Math.max(end, c.start + c.length); return { st: o.coach.state(), hist: o.store.history.map((x) => ({ by: x.by, label: x.label })), tracks: p.tracks.map((tr) => tr.name), n: p.tracks.length, bars: Math.ceil(end / bpb - 1e-6), tempo: p.tempo, line: document.querySelector('.cs-line')?.textContent, go: document.querySelector('.cs-go')?.textContent, more: [...document.querySelectorAll('.cs-more')].map((x) => x.textContent) }; });
    const toBand = presses;
    t.ok(toBand === 7 && k.st?.step === 'end' && k.hist.length === 3 && k.hist[2].by === 'overdub' && k.n > 2, `a band kept by press ${toBand} (Build a band around it, Keep the band): one History entry by overdub, "${k.hist[2]?.label}" (${k.tracks.join(', ')})`);
    t.ok(k.line === `Your song: ${k.n} tracks, ${k.bars} bars at ${k.tempo} BPM. Take one was yours.` && k.go === 'Make it longer' && k.more.join() === 'Share', `counted from the song: "${k.line}" [${k.go}] ${k.more.join()}`);
    await page.screenshot({ path: path.join(OUTDIR, 'start-strip-end.png') });
    t.ok(presses === 7, `the budget, press by press: a beat by 2, a tune by 5, a band by 7 (${toBeat}, ${toTune}, ${toBand})`);
    // Undo takes the whole band out; redo puts it back for the end of the run
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(200);
    const u = await E(page, () => window.overdub.store.get().tracks.map((tr) => tr.name));
    t.ok(u.join() === 'Drums,Melody', `one undo takes every band track out (${u.join(', ')})`);
    await E(page, () => window.overdub.store.redo());
    await page.waitForTimeout(200);
    // Make it longer: the song repeats to 8 bars, then "Done." for 6 s, and the strip goes
    await page.click('.cs-go');
    await page.waitForTimeout(250);
    const lg = await E(page, () => ({ line: document.querySelector('.cs-line')?.textContent, hist: window.overdub.store.history.at(-1), go: document.querySelectorAll('.cs .btn-go').length }));
    t.ok(lg.line === 'Done. Find (⌘K) gets you anywhere.' && lg.hist?.label === 'make it 8 bars' && lg.hist.by === 'you' && lg.go === 0, `Make it longer ("${lg.hist?.label}"), then "${lg.line}"`);
    await page.waitForTimeout(6200);
    const bye = await E(page, () => ({ strip: !!document.querySelector('.cs'), coach: window.overdub.ui.state.coach }));
    t.ok(!bye.strip && bye.coach === null, `after 6 s the strip goes and the run is over`);
    t.ok(!real(o.errors).length, `the run: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'the run threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the other doors (R2, R4, R5) */
{
  console.log('\nthe other doors');
  const words = (page) => E(page, () => ({ st: window.overdub.coach?.state(), words: [...document.querySelectorAll('.cs-word')].map((w) => w.textContent), go: document.querySelector('.cs-go')?.textContent, more: [...document.querySelectorAll('.cs-more')].map((b) => b.textContent) }));
  const addClip = (page, { name, device, by, p }) => E(page, ([name, device, by, p]) => { const o = window.overdub; let tr = o.store.get().tracks.find((x) => x.name === name); if (!tr) { const r = o.store.dispatch({ type: 'track.add', ref: 't', track: { name, kind: 'instrument', instrument: { device } } }, { by }); tr = o.store.track(r.created.t); } return o.store.dispatch({ type: 'clip.add', track: tr.id, clip: { kind: 'notes', start: 0, length: 4, notes: [0, 1, 2, 3].map((t) => ({ p, t, d: 0.5, v: 0.8 })) } }, { by }).ok; }, [name, device, by, p]);
  // Play the keys: the take in, the run is Tune ✓ · Beat · Band; Put a beat under it opens Grooves at the song's tempo
  {
    const o = await blank();
    const { page } = o;
    try {
      await page.click('.st-way-b[data-way="Play the keys"]');
      await page.waitForTimeout(400);
      await addClip(page, { name: 'Keys', device: 'core.keys', by: 'you', p: 60 });
      await page.waitForTimeout(200);
      const k = await words(page);
      t.ok(k.st?.door === 'keys' && k.words.join(' · ') === 'Tune ✓ · Beat · Band' && k.go === 'Put a beat under it' && k.more.join() === 'Tap a beat over it', `Play the keys: ${k.words.join(' · ')} [${k.go}] ${k.more.join()}`);
      const tempo = await E(page, () => window.overdub.store.get().tempo);
      await page.click('.cs-go');
      await page.waitForTimeout(500);
      const g = await E(page, () => ({ view: window.overdub.grooves?.view(), put: document.querySelector('.gv-put')?.textContent, head: document.querySelector('.gv-listhead')?.textContent, rows: [...document.querySelectorAll('.gv-row .gv-tempo')].map((x) => x.textContent.split('–').map(Number)), hist: window.overdub.store.history.length }));
      await page.screenshot({ path: path.join(OUTDIR, 'start-strip-grooves.png') });
      t.ok(g.view === 'fit' && g.put === 'Use it' && g.rows.length > 0 && g.rows.every(([lo, hi]) => lo <= tempo && tempo <= hi) && new RegExp(`^At ${tempo} BPM`).test(g.head || ''), `Put a beat under it: Grooves at the song's ${tempo} BPM, ${g.rows.length} that sit there, and Use it ("${g.head}")`);
      await page.click('.gv-put');
      await page.waitForTimeout(400);
      const u = await words(page);
      const h1 = await E(page, () => window.overdub.store.history.at(-1));
      t.ok(u.st?.step === 'band' && u.words.join(' · ') === 'Tune ✓ · Beat ✓ · Band' && h1.by === 'you' && u.go === 'Build a band around it', `Use it lands the groove (by ${h1.by}) and the run moves on: ${u.words.join(' · ')} [${u.go}]`);
      // Tap a beat over it reopens the stage over the tune: the click view at the song's tempo, no Speed
      await E(page, () => window.overdub.coach.go('beat'));
      await page.waitForTimeout(100);
      await page.click('.cs-more');
      await page.waitForTimeout(500);
      const ov = await E(page, () => ({ step: window.overdub.start.step, view: window.overdub.start.view, click: window.overdub.start.click(), speed: !!document.querySelector('.st-speed'), alt: document.querySelector('.st-alt')?.textContent, tempo: window.overdub.store.get().tempo }));
      t.ok(ov.step === 'play' && ov.view === 'click' && ov.click?.bpm === tempo && !ov.speed && !ov.alt && ov.tempo === tempo, `Tap a beat over it: the click view over the tune at its ${ov.click?.bpm} BPM, no Speed and no free time`);
      await E(page, () => window.overdub.start.close({ quiet: true }));
      t.ok(!real(o.errors).length, `Play the keys: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
    } catch (e) { t.ok(false, 'the keys door threw: ' + (e.stack || e)); }
    finally { await o.close(); }
  }
  // Draw a beat, Pick a groove, Ask your agent
  for (const door of ['draw', 'groove', 'ask']) {
    const o = await blank();
    const { page } = o;
    try {
      if (door === 'draw') { await page.click('.st-notime button:has-text("Draw a beat")'); await page.waitForTimeout(300); await addClip(page, { name: 'Drums', device: 'core.drums', by: 'you', p: 36 }); }
      if (door === 'groove') { await page.click('.st-notime button:has-text("Pick a groove")'); await page.waitForTimeout(400); await E(page, () => window.overdub.grooves.put()); }
      if (door === 'ask') { await page.click('.ar-empty-agent'); await page.waitForTimeout(300); await addClip(page, { name: 'Bass', device: 'core.keys', by: 'claude', p: 40 }); }
      await page.waitForTimeout(250);
      const w = await words(page);
      const want = door === 'ask' ? /^(Your agent|Claude|The demo agent) ✓ · Band$/ : /^Beat ✓ · Tune · Band$/;
      t.ok(w.st?.door === door && want.test(w.words.join(' · ')) && w.go === (door === 'ask' ? 'Build a band around it' : 'Hum over it'), `${{ draw: 'Draw a beat', groove: 'Pick a groove', ask: 'Ask your agent' }[door]}: ${w.words.join(' · ')} [${w.go}]`);
      if (door === 'draw') {
        // Tap more on the drums: the click view over the Drums clip; Done folds the new hits into it
        await page.click('.cs-more');
        await page.waitForTimeout(400);
        const tm = await E(page, () => ({ step: window.overdub.start.step, view: window.overdub.start.view, tracks: window.overdub.store.get().tracks.length }));
        t.ok(tm.step === 'play' && tm.view === 'click' && tm.tracks === 1, `Tap more on the drums: the click view over the Drums clip, no new track (${JSON.stringify(tm)})`);
        await E(page, () => window.overdub.start.close({ quiet: true }));
        // Play keys over it: the stage over the song for the keys, nothing in the song until Play
        await page.click('.cs-more:has-text("Play keys over it")');
        await page.waitForTimeout(400);
        const pk = await E(page, () => ({ step: window.overdub.start.step, hum: window.overdub.start.hum(), title: document.querySelector('.st-title')?.textContent, go: [...document.querySelectorAll('.st-stage .btn-go')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), speed: !!document.querySelector('.st-stage .st-choice'), hist: window.overdub.store.history.length, tracks: window.overdub.store.get().tracks.length }));
        t.ok(pk.step === 'hum' && pk.hum?.mode === 'keys' && pk.hum.over && pk.title === 'Play your part.' && /^Play Space$/.test(pk.go.join()) && !pk.speed && pk.tracks === 1, `Play keys over it: "${pk.title}" over the song, [${pk.go.join()}], no Speed, nothing in the song until Play (${pk.tracks} track)`);
        await E(page, () => window.overdub.start.close({ quiet: true }));
      }
      t.ok(!real(o.errors).length, `${door}: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
    } catch (e) { t.ok(false, `the ${door} door threw: ` + (e.stack || e)); }
    finally { await o.close(); }
  }
}

/* ================================================================ the liner notes, and a phone */
{
  console.log('\nliner notes and a phone');
  const o = await blank({ width: 390, height: 844 });
  const { page } = o;
  try {
    const wide = async () => E(page, () => document.documentElement.scrollWidth);
    const kit = async () => E(page, () => {
      const els = [...document.querySelectorAll('.st-stage, .st-stage *, .st-door, .st-door *')];
      const round = els.filter((el) => { const r = getComputedStyle(el).borderTopLeftRadius; return /%/.test(r) || parseFloat(r) >= 8; }).map((el) => el.className);
      const stripe = els.filter((el) => { const s = getComputedStyle(el); return parseFloat(s.borderLeftWidth) >= 2 && s.borderLeftColor !== s.borderTopColor; }).map((el) => el.className);
      const inset = els.filter((el) => /inset \d+px 0 0/.test(getComputedStyle(el).boxShadow)).map((el) => el.className);
      return { round, stripe, inset };
    });
    const w0 = await wide();
    const k0 = await kit();
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(400);
    const p1 = await E(page, () => ({ sw: document.documentElement.scrollWidth, pads: [...document.querySelectorAll('.st-pad')].map((p) => Math.round(p.getBoundingClientRect().height)), done: document.querySelector('.st-done').getBoundingClientRect(), vh: innerHeight, vw: innerWidth, full: document.querySelector('.st-stage').getBoundingClientRect().width }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-phone-play.png') });
    const k1 = await kit();
    // a tap on a pad fires on pointerdown
    await page.dispatchEvent('.st-pad[data-row="kick"]', 'pointerdown');
    const tapped = await E(page, () => window.overdub.start.step === 'play' && document.querySelector('.st-status')?.textContent);
    await E(page, () => window.overdub.start.again());
    await playRock(page);
    await page.click('.st-done');
    await page.waitForTimeout(500);
    const p2 = await E(page, () => ({ sw: document.documentElement.scrollWidth, next: document.querySelector('.st-next')?.getBoundingClientRect(), vh: innerHeight, go: [...document.querySelectorAll('.st-stage .btn-go')].length }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-phone-in.png') });
    const k2 = await kit();
    t.ok(w0 <= 390 && p1.sw <= 390 && p2.sw <= 390, `390 px: no sideways scroll on the door, the pads or the take (${w0}, ${p1.sw}, ${p2.sw})`);
    t.ok(p1.pads.length === 4 && p1.pads.every((x) => x >= 120) && Math.round(p1.full) === p1.vw, `the stage is the whole phone; four pads, each ${p1.pads.join('/')} px tall`);
    t.ok(p1.done.bottom <= p1.vh && p1.done.height >= 44 && p2.next && p2.next.bottom <= p2.vh && p2.next.height >= 44 && p2.go === 1, `Done and the next part are inside the screen, ${Math.round(p1.done.height)} and ${Math.round(p2.next?.height)} px tall, one primary`);
    t.ok(/^1 hit\.$/.test(tapped || ''), `a pad fires on pointerdown ("${tapped}")`);
    // over a click on a phone: the two bars fit, 160 px a bar or more, with no sideways scroll
    await E(page, () => { window.overdub.store.undo(); });
    await page.waitForTimeout(300);
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await page.click('.st-view');
    await page.waitForTimeout(400);
    const pc = await E(page, () => ({ sw: document.documentElement.scrollWidth, w: window.overdub.start.window(), num: document.querySelector('.bw-num')?.getBoundingClientRect().width, done: document.querySelector('.st-done').getBoundingClientRect().bottom, vh: innerHeight }));
    await page.screenshot({ path: path.join(OUTDIR, 'start-phone-click.png') });
    const k3 = await kit();
    t.ok(pc.sw <= 390 && pc.w?.barPx >= 160 && pc.num > 0 && pc.done <= pc.vh, `390 px over a click: no sideways scroll, ${pc.w?.barPx} px a bar, the count-in over the window, Done on screen`);
    await E(page, () => window.overdub.start.close());
    const bad = [k0, k1, k2, k3].flatMap((k) => [...k.round, ...k.stripe, ...k.inset]);
    t.ok(!bad.length, `liner notes: no pills, no coloured side rules, no inset stripes on the door or the stage${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`);
    t.ok(!real(o.errors).length, `phone: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'phone threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ R32: liner notes on every new surface */
// The stage (.st-*), the coach strip (.cs-*) and the beat window (.bw-*): every rule in their stylesheets, in every
// state and width (not only what's on screen now), has no inset stripe and no pill or round radius; each step a run
// reaches has one .btn-go a region; and what lands is signed: the take's clip by you on its label line, the band
// unsigned (the house).
{
  console.log('\nliner notes (R32)');
  const o = await blank();
  const { page } = o;
  try {
    const goes = () => E(page, () => {
      const vis = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      return [...document.querySelectorAll('.st-stage, .cs, [role="region"]')].filter(vis).map((r) => ({ r: r.className.split(' ')[0] || r.getAttribute('aria-label'), n: [...r.querySelectorAll('.btn-go')].filter(vis).length }));
    });
    const steps = [];
    const note = async (where) => { for (const g of await goes()) steps.push({ where, ...g }); };
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await note('play');
    // the click view (the beat window), and back
    await E(page, () => window.overdub.start.setView('click'));
    await page.waitForTimeout(500);
    await note('click view');
    await E(page, () => window.overdub.start.setView('free'));
    await page.waitForTimeout(300);
    await playRock(page);
    await page.waitForTimeout(200);
    await note('play, 3 rounds');
    await E(page, () => window.overdub.start.done());
    await page.waitForTimeout(400);
    await note('in');
    const landed = await E(page, () => window.overdub.start.landed());
    await E(page, () => window.overdub.start.close({ to: 'song' }));
    await page.waitForTimeout(500);
    await note('strip');
    // the band, kept: one dispatch by the house
    await E(page, () => window.overdub.coach.go('band'));
    await page.waitForTimeout(150);
    await E(page, () => window.overdub.coach.band());
    await page.waitForTimeout(150);
    await E(page, () => window.overdub.coach.preview(0));
    for (let i = 0; i < 40 && !(await E(page, () => !!window.overdub.coach.state()?.hearing)); i++) await page.waitForTimeout(100);
    // a style being heard is a preview: a tab closing on it gives it back before the autosave's flush, so the saved song
    // never keeps a band nobody kept
    await page.waitForTimeout(700);
    const pv = await E(page, () => {
      const o = window.overdub, names = () => o.store.get().tracks.map((x) => x.name), saved = () => { try { return JSON.parse(localStorage.getItem('overdub:project')).tracks.map((x) => x.name); } catch { return null; } };
      const during = names();
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      return { during, live: names(), saved: saved(), hearing: !!o.coach.state()?.hearing, hist: o.store.history.length };
    });
    t.ok(pv.during.length > pv.live.length && pv.live.length === 1 && JSON.stringify(pv.saved) === JSON.stringify(pv.live) && !pv.hearing && pv.hist === 1,
      `a style heard when the tab closes is given back before the save: ${JSON.stringify(pv.during)} heard, ${JSON.stringify(pv.saved)} saved, History ${pv.hist}`);
    await E(page, () => window.overdub.coach.preview(0));
    for (let i = 0; i < 40 && !(await E(page, () => !!window.overdub.coach.state()?.hearing)); i++) await page.waitForTimeout(100);
    await note('band rows');
    await E(page, () => window.overdub.coach.keep());
    await page.waitForTimeout(600);
    await note('closing line');
    const sweep = await E(page, () => {
      const rules = [];
      const walk = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText) rules.push(r); } };
      for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* another origin's sheet */ } }
      const ours = rules.filter((r) => /\.(st|cs|bw)-|\.cs\b/.test(r.selectorText));
      const radius = (st) => ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'].map((k) => st.getPropertyValue(k)).join(' ');
      return { n: ours.length, sheets: [...new Set(ours.map((r) => (r.selectorText.match(/\.(st|cs|bw)-|\.cs\b/) || [''])[0]))].sort(),
        inset: ours.filter((r) => /inset\s+-?\d+(\.\d+)?px\s+0(px)?\s+0/.test(r.style.getPropertyValue('box-shadow'))).map((r) => r.selectorText),
        round: ours.filter((r) => /\b99px\b|50%/.test(radius(r.style))).map((r) => r.selectorText) };
    });
    const p = await song(page);
    const tk = p.tracks.find((x) => x.id === landed?.track), clip = tk?.clips.find((c) => c.id === landed?.clip);
    const band = p.tracks.filter((x) => x.id !== landed?.track && x.clips.length);
    await E(page, () => { window.overdub.arranger?.reveal?.(0); });
    await page.waitForTimeout(300);
    const sig = await E(page, ([c, b]) => { const ar = window.overdub.arranger; return { take: ar.signedBy(c), label: ar.clipLabel(c), band: b.map((id) => ar.signedBy(id)) }; }, [landed?.clip, band.flatMap((x) => x.clips.map((c) => c.id))]);
    t.ok(sweep.n > 100 && ['.bw-', '.cs-', '.st-'].every((x) => sweep.sheets.includes(x)) && !sweep.inset.length && !sweep.round.length,
      `${sweep.n} rules in .st-*, .cs-* and .bw-* (${sweep.sheets.join(' ')}): no inset Npx 0 0 shadow, no 99px or 50% radius${sweep.inset.length || sweep.round.length ? ` (inset: ${sweep.inset.join(', ')}; round: ${sweep.round.join(', ')})` : ''}`);
    const many = steps.filter((x) => x.n > 1);
    // (before there's enough to keep, Done isn't the primary yet: none, then one)
    t.ok(!many.length && steps.some((x) => x.where === 'in' && /st-stage/.test(x.r) && x.n === 1) && steps.some((x) => x.where === 'strip' && x.r === 'cs' && x.n === 1) && steps.some((x) => x.where === 'click view' && /st-stage/.test(x.r)) && steps.some((x) => x.where === 'play, 3 rounds' && x.n === 1),
      `one .btn-go a region at each step (${[...new Set(steps.map((x) => `${x.where} ${x.r}:${x.n}`))].join('; ')})`);
    t.ok(clip && clip.by === 'you' && clip.notes.every((n) => (n.by ?? 'you') === 'you') && sig.take === 'you' && (sig.label === undefined || /you/.test(sig.label || '')) && band.length >= 2 && sig.band.every((x) => x === ''),
      `bylines on what landed: the take's clip signed by you (label line "${sig.label}"), the band's ${sig.band.length} clips unsigned, the house's (${JSON.stringify(sig.band)})`);
    t.ok(!real(o.errors).length, `liner notes: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'liner notes threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

t.done();
