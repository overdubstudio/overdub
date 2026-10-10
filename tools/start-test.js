// Start a song (app/src/ui/start.js): the blank song's door and the stage, in the studio. Taps go through
// app.start.tap(row, perfMs) with times from tools/sloppy.js (a person a little off, drifting), so Playwright's own
// timing isn't what's measured. Quiet browsers (tools/pw.js).
//
//   node tools/start-test.js
import { open, tally, OUTDIR } from './pw.js';
import { perform } from './sloppy.js';
import { takeOf } from '../app/src/input/rounds.js';
import path from 'node:path';

const t = tally('start');
const K = 36, S = 38, H = 42;
const ROW = { [K]: 'kick', [S]: 'snare', [H]: 'hat' };
const ROCK = [[0, K], [2, K], [2.5, K], [1, S], [3, S], ...Array.from({ length: 8 }, (_, i) => [i / 2, H])];
const real = (errs) => errs.filter((e) => !/status of 404 .*kits|Failed to load resource: the server responded with a status of 404/.test(e));

async function blank({ width = 1440, height = 900 } = {}) {
  const o = await open('/app/', { query: 'new', width, height });
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
    // rounds fold under you: a kick played only in round 1 of 2 isn't in what plays in round 3, and isn't kept
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
    // Hum over it: Sketch's Hum over the beat, looping
    await page.click('.st-way-b[data-way="Tap a beat"]');
    await page.waitForTimeout(300);
    await playRock(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const next = await E(page, () => { const o = window.overdub; return { step: o.start.step, playing: o.engine.playing, sketch: o.ui.visible?.('sketch'), mode: document.querySelector('.sk-hum') ? 'hum' : null, hist: o.store.history.map((x) => x.label) }; });
    t.ok(!next.step && next.playing && next.sketch && next.mode === 'hum', `Hum over it (Enter): the stage folds away, the beat keeps looping and Sketch is on Hum (${JSON.stringify(next)})`);
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
    t.ok(!h.step && h.tempo === 120 && h.drums === 1 && /^a beat to hum over, 4 bars at 120 BPM \(you\)$/.test(h.hist[0]) && (h.rec === 'count' || h.rec === 'rec') && h.humming, `H: the beat goes in, signed you, and the hum records over it with a bar to come in on (${h.rec}, humming ${h.humming}; ${h.hist.join(' / ')})`);
    await E(page, () => window.overdub.input.recorder.cancel?.());
    t.ok(!real(o.errors).length, `hum a tune: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'hum threw: ' + (e.stack || e)); }
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

t.done();
