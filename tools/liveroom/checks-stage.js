// The live room's checks: the stage and its press counts [stream C] (docs/research/LIVE-ROOM-MODE.md §11.4, §11.6).
// Run by tools/liveroom-test.js (ONLY=stage), whose header says what a checks module exports.
//
// Node: the press counts (12 at the metal club, 10 at the basement, 9 at the blues bar) on core/liveroom/session.js's
// reducer, the offered move after each kind of step, and the stop rule at every place.
// Muted Chromium: the metal club's first session (§2.3) on the real room: the door's planPlace, the deck (its count,
// its takes through the recorder, its stop rule), the band's read and learning (core/liveroom/read.js in its worker,
// band.js planLearn), the double (double.js planDouble, tight.js measurePair) and the finish (band.js planFinish). The
// guitar is a fake (fake.js session: a riff's DI at 132, every pass at its own place in one WAV that Chromium plays as
// the input, never to a speaker), each pass's count lined up with the part it plays (harness.js alignCount's sum: the
// count's `at` given to the deck's countIn), the deck's latency 0 (the fake has none). Hear it all and the wide
// playback after the other side are moved on by seeking near their end: what's checked is where they start and that
// they stop and say so, not a minute and fifty-one seconds of listening. The control room's click, left on, is held off
// through every play in the room and given back as it was when the room closes.

import path from 'node:path';
import { press as pressRoom, offered, stopBeat } from '../../app/src/core/liveroom/session.js';
import { openRoom, history, press, OUT } from './harness.js';
import { session } from './fake.js';

export const name = 'stage';
export const pages = true;

const json = (x) => JSON.stringify(x);
const SPACE = (n) => Array.from({ length: n }, () => 'space');
const walk = (ids) => ids.reduce((s, id) => pressRoom(s, id), {});
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);

// The fake guitar at 132: a verse of palm-muted chugs on drop C's low C with a held note at the end of the bar, a
// chorus of held power chords. Each pass the session plays sits at its own bar of the file, the gaps the room's own
// time between passes (the ring, the read, the presses).
const BPM = 132;
const VERSE = { bpm: BPM, beats: 4, chord: true, notes: [[0, 36, 0], [0.5, 36, 0], [1, 36, 0], [1.5, 39, 0.5], [2, 36, 0], [2.5, 36, 0], [3, 41, 0.75]] };
const CHORUS = { bpm: BPM, beats: 4, chord: true, notes: [[0, 36, 1], [1, 43, 1], [2, 41, 1], [3, 39, 0.75]] };
// [what, the riff, the file's bar it starts on, seed]
const PASSES = [['verse L', VERSE, 1, 11], ['verse R', VERSE, 19, 12], ['chorus', CHORUS, 37, 13], ['chorus again', CHORUS, 53, 14], ['chorus kept', CHORUS, 67, 15], ['chorus R', CHORUS, 77, 16]];
function stageFake() {
  return session({ bpm: BPM, lead: 14, tail: 4, parts: PASSES.map(([, riff, bar, seed]) => ({ kind: 'riff', riff, bar, passes: 8, seed, jitter: 0.003, peak: -12 })) });
}

// In the page: the room on a metal song (the door's step, planPlace by you), the input open on the fake, the deck's
// latency 0, and its countIn given each pass's `at` in turn (the audio-clock time of the count's first beat that puts
// the pass's downbeat on its part of the file); a pass with no part queued counts in as the deck would
const INSTALL = async ({ parts }) => {
  const o = window.overdub;
  const { planPlace } = await import('/app/src/core/liveroom/plans.js');
  const { createDeck } = await import('/app/src/ui/liveroom/deck.js');
  const st = await import('/app/src/ui/liveroom/stage.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 60000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await sleep(5); } };
  window.__lr = { sleep, until, stageState: st.stageState, queue: [], counts: [], takes: [], stops: [], said: [] };
  o.liveRoom.on('say', (e) => window.__lr.said.push(e.text));
  const pl = planPlace(o.store.get(), { place: 'metal' });
  const r = o.store.dispatch(pl.ops, { by: 'you', label: pl.label, reason: pl.reason });
  await o.engine.start?.();
  await o.input.audio.open({ channel: '1', capture: true, monitor: false });
  await until(() => o.input.audio.state.open && Number.isFinite(o.input.audio.state.firstFrame), 15000);
  const deck = createDeck(o);
  deck.latency = 0;
  const count = deck.countIn, take = deck.take, stop = deck.stop;
  const st0 = o.input.audio.state, fileT0 = st0.firstFrame / (st0.sr || o.engine.ctx.sampleRate);
  deck.countIn = (a = {}) => {
    const part = window.__lr.queue.shift();
    const bpb = 4, spb = 60 / (o.store.get().tempo || 120);
    const at = part == null ? null : fileT0 + parts[part] - (a.bars ?? 1) * bpb * spb;
    window.__lr.counts.push({ ...a, at, part: part ?? null, now: o.engine.ctx.currentTime });
    return count(at == null ? a : { ...a, at });
  };
  deck.take = (a = {}) => { window.__lr.takes.push(JSON.parse(JSON.stringify(a))); return take(a); };
  deck.stop = (a = {}) => { window.__lr.stops.push(JSON.parse(JSON.stringify(a))); return stop(a); };
  window.__lr.fileT0 = fileT0;
  // the control room's click on (not only while recording), as a person might have left it there: the room holds it
  // off from when it opens (the door is up at ?room: through the glass first, so the click is the control room's)
  if (o.liveRoom.isOpen()) o.liveRoom.close();
  o.transport.click.set({ on: true, whileRecording: false });
  window.__lr.clickWas = { ...o.engine.click };
  window.__lr.clicks = [];
  o.engine.on('transport', (e) => { if (e.why === 'play' || e.why === 'stop') window.__lr.clicks.push({ why: e.why, on: !!o.engine.click.on }); });
  o.liveRoom.open({ screen: 'stage' });
  return r.ok;
};

// what the checks read off the page after a step
const READ = () => {
  const o = window.overdub, L = o.ui.state.liveRoom, p = o.store.get();
  const st = document.querySelector('.lr-stage');
  return {
    run: L.run, card: L.card, side: L.side, screen: L.screen,
    primary: st?.querySelector('.lr-primary')?.hidden ? null : st?.querySelector('.lr-primary .lr-pl')?.textContent || null,
    move: st?.querySelector('.lr-primary')?.dataset.move || null,
    dim: st?.dataset.run || null,
    line: document.querySelector('.lr-tb-line')?.textContent || '',
    by: document.querySelector('.lr-tb-by .by')?.textContent || null,
    tempo: p.tempo, beat: o.engine.beat, playing: o.engine.playing,
    sections: p.sections.slice().sort((a, b) => a.start - b.start).map((s) => [s.name, s.start, s.length]),
    cards: [...document.querySelectorAll('.lr-cards > [data-card]')].map((c) => c.querySelector('.lr-card-name')?.textContent || c.textContent.trim()),
    counts: window.__lr.counts.map((x) => ({ ...x })), takes: window.__lr.takes.slice(), stops: window.__lr.stops.slice(), said: window.__lr.said.slice(),
    state: window.__lr.stageState(),
  };
};

const STAGE_KEYS = ['Space', 'KeyR', 'Enter', 'Escape', 'shift+KeyR', 'ArrowLeft', 'ArrowRight', 'shift+ArrowLeft', 'shift+ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'alt+ArrowLeft', 'alt+ArrowRight',
  'KeyN', 'KeyD', 'KeyF', 'KeyX', 'KeyL', 'Backspace', 'KeyT', 'BracketLeft', 'BracketRight', 'KeyU', 'KeyG', 'Slash', 'PageDown', 'PageUp', 'mod+KeyZ', 'mod+shift+KeyZ'];

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- §11.4, in Node */
  {
    const m = walk(['door:metal', 'allow', 'tune', ...SPACE(8), 'send']);
    T.ok(m.presses === 12 && m.sent && json(m.offered) === json(['count', 'take', 'other', 'next', 'take', 'other', 'layout', 'hear']),
      `the metal club in 12 presses: door, Allow, tune, then Space for ${m.offered.join(', ')}, and send (${m.presses})`);
    const b = walk(['door:basement', 'allow', ...SPACE(7), 'send']);
    T.ok(b.presses === 10 && b.sent && json(b.offered) === json(['count', 'take', 'next', 'take', 'other', 'layout', 'hear']), `the basement in 10: the chorus doubled once offered (${b.offered.join(', ')}; ${b.presses})`);
    const u = walk(['door:bluesbar', 'allow', ...SPACE(6), 'send']);
    T.ok(u.presses === 9 && u.sent && json(u.offered) === json(['count', 'take', 'next', 'take', 'layout', 'hear']), `the blues bar in 9: a head and a solo, no double (${u.offered.join(', ')}; ${u.presses})`);
    const n = walk(['door:metal', 'allow', ...SPACE(6), 'notyet', 'space']);
    T.ok(n.offered.at(-1) === 'next', `Not yet: Lay it out isn't offered again in that song, and Space is Next part (${n.offered.at(-1)})`);
    // the stop rule at every place, and the blues bar's chorus rule
    const at = (place, beat, from) => stopBeat({ place, meter: [4, 4] }, beat, { from });
    const stops = [['metal', 32.5, 0, 32], ['metal', 34, 0, 36], ['basement', 32.9, 0, 32], ['basement', 33.5, 0, 36], ['bluesbar', 49, 0, 48], ['bluesbar', 57, 0, 96], ['metal', 1, 0, 4]];
    const bad = stops.filter(([p, b, f, want]) => at(p, b, f) !== want);
    T.ok(!bad.length, `the stop: in a bar's first beat the line just gone, later the next; at the blues bar whole choruses; never before the first bar is whole${bad.length ? ': wrong at ' + json(bad) : ''}`);
    T.ok(offered({ place: 'metal', cards: [], parts: [] }, 'take')?.id === 'take' && offered({ place: 'metal', cards: [], parts: [] }, 'play')?.id === 'stop' && offered({ place: null }, 'idle') === null,
      'the offered move: during a pass That’s a take, during playback Stop, and nothing on the door');
    // two left takes within the pair rule: Use take 1 as the right side, before the other side
    const two = { place: 'metal', cards: [{ id: 's1', name: 'Chorus', takes: { L: ['a', 'b'], R: [], lead: [] }, part: {} }], parts: [{ id: 's1', name: 'Chorus', takes: { L: ['a', 'b'], R: [], lead: [] }, part: {} }] };
    const u2 = offered(two, { run: 'idle', last: 's1', use2: { card: 's1', take: 1 } });
    T.ok(u2?.id === 'use2' && u2.label === 'Use take 1 as the right side' && offered(two, { run: 'idle', last: 's1' })?.id === 'other', `two left takes within the pair rule offer "${u2?.label}" ahead of the other side`);
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- §11.6, muted Chromium */
  const fk = stageFake();
  const parts = fk.timeline.parts.map((x) => x.at);
  const s = await openRoom('/app/?room', { fake: fk, name: 'stage' });
  const { page, E } = s;
  const settle = (ms = 60) => page.evaluate((ms) => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), ms)), ms);
  const waitFor = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 20 });
  // (the transport at a song beat; the room idle, the recorder too; History's newest step a learning)
  const toBeat = (b) => waitFor((b) => window.overdub.engine.playing && window.overdub.engine.beat >= b, b, 120000);
  const idle = () => waitFor(() => window.overdub.ui.state.liveRoom.run === 'idle' && window.overdub.input.recorder.state === 'idle', null, 60000);
  const learned = (sec) => waitFor((sec) => window.overdub.store.history.at(-1)?.reason === `room:learn:${sec}` && window.overdub.ui.state.liveRoom.run === 'idle', sec, 60000);
  const labelled = (label) => waitFor((label) => window.overdub.store.history.some((x) => x.label === label), label, 90000).catch(async (e) => {
    const said = await E(() => [...window.__lr.said.slice(-4), ...window.overdub.store.get().tracks.filter((t) => /Guitar/.test(t.name)).map((t) => `${t.name}: ${t.clips.map((c) => `${c.id}@${c.start}+${c.length}${c.mute ? 'M' : ''} take ${c.take}`).join(', ')}`)]);
    throw new Error(`no step "${label}": History ${(await history(page)).map((x) => `${x.label} (${x.by})`).join(', ')}; said ${said.join(' / ')}; ${String(e.message).split('\n')[0]}`);
  });
  const queue = (i) => E((i) => window.__lr.queue.push(i), i);
  const pedal = () => E(() => { window.overdub.input.emit('expr', { src: 'midi', sustain: true }); window.overdub.input.emit('expr', { src: 'midi', sustain: false }); });
  const saidSince = (r0, r1) => r1.said.slice(r0.said.length);
  const any = (lines, re) => lines.find((x) => re.test(x)) || null;
  // (a count lined up with its part: its first beat still ahead of the audio clock when the deck was asked)
  const lined = (c) => c && c.at != null && c.at > c.now + 0.02;
  try {
    const placed = await E(INSTALL, { parts });
    await settle(300);
    let r = await E(READ);
    const tracks = await E(() => window.overdub.store.get().tracks.map((t) => `${t.name}:${t.by}`));
    T.ok(placed && r.screen === 'stage' && r.primary === 'Count me in' && any(r.said, /The drummer’s at 132/) && json(tracks) === json(['Guitar L:you', 'Guitar R:you', 'Drums:overdub', 'Bass:overdub', 'Riff (as heard):overdub']),
      `the stage on a metal song (planPlace by you): Count me in, the drummer's tempo said, the tracks and who made them (${tracks.join(', ')})`);
    await s.shot('liveroom/stage-1440');

    // keys: every key of §3.17 declared through ui.keys.add, in the group 'Live room', with a when
    const keys = await E(() => window.overdub.ui.keys.list().filter((k) => k.group === 'Live room' && k.label !== 'Held while the live room is open').map((k) => ({ s: `${k.mod ? k.mod + '+' : ''}${k.key}`, when: typeof k.when === 'function' })));
    const missing = STAGE_KEYS.filter((k) => !keys.some((x) => x.s === k && x.when));
    T.ok(!missing.length, `every key of §3.17 is declared with ui.keys.add, in the group 'Live room', with the room's when (${STAGE_KEYS.length} keys)${missing.length ? '; missing: ' + missing.join(' ') : ''}`);
    const left0 = await E(() => window.overdub.ui.isOpen('left'));
    await press(page, 'KeyB');
    T.ok((await E(() => window.overdub.ui.isOpen('left'))) === left0, 'on the stage the studio’s single keys are held (B left the browser pane as it was)');

    // the tempo before the first take: ← → 2 BPM, ⇧ 10
    let r0 = await E(READ);
    await press(page, 'ArrowRight');
    await press(page, 'Shift+ArrowRight');
    const t1 = (await E(READ)).tempo;
    await press(page, 'Shift+ArrowLeft');
    await press(page, 'ArrowLeft');
    r = await E(READ);
    T.ok(t1 === 144 && r.tempo === 132 && /The drummer’s at 132/.test(saidSince(r0, r).at(-1) || ''), `before the first take ← → move the tempo 2 BPM and ⇧ 10 (132 → ${t1} → ${r.tempo}), said each time`);

    // Space: counted in (a bar of sticks, lined up with the fake's verse), the take from beat 0 on Guitar L
    await queue(0);
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    const gL = await E(() => window.overdub.store.get().tracks.find((t) => t.name === 'Guitar L')?.id);
    const gR = await E(() => window.overdub.store.get().tracks.find((t) => t.name === 'Guitar R')?.id);
    let ci = r.counts.at(-1), tk = r.takes.at(-1);
    T.ok(ci?.from === 0 && ci?.bars === 1 && ci?.voice === 'sticks' && lined(ci) && tk?.track === gL && tk?.from === 0 && !tk?.punch && (r.run === 'count' || r.run === 'take') && r.primary === 'That’s a take' && r.dim === 'take',
      `Space counts in (the deck's countIn from ${ci?.from}, ${ci?.bars} bar of ${ci?.voice}, its first stick ${ci ? (ci.at - ci.now).toFixed(2) : '-'} s ahead) and the take starts on Guitar L at beat 0; the primary reads ${r.primary}, the rest dims (${r.dim})`);
    // That's a take, pressed half a beat into bar 9: the part is 8 bars, the band learns it
    await toBeat(32.45);
    await press(page, 'Space');
    await labelled('Verse take 1');
    let h = await history(page);
    const verse = h.find((x) => x.label === 'Verse take 1'), vsec = verse.reason.slice('room:take:'.length);
    await learned(vsec);
    r = await E(READ);
    h = await history(page);
    const stop = r.stops.at(-1), vlearn = h.at(-1);
    T.ok(stop?.at === 'bar' && json(r.sections) === json([['Verse', 0, 32], ['End', 32, 4]]) && verse.by === 'you' && /^room:take:/.test(verse.reason) && verse.ops.includes('asset.add') && verse.ops.includes('clip.add') && verse.ops.includes('section.add'),
      `That's a take half a beat into bar 9 ends on bar 9's line: one step by you, "${verse.label}" (${verse.reason}), the recording, its part and the End together (${json(r.sections)})`);
    T.ok(vlearn.by === 'overdub' && vlearn.label === 'The band learned the verse' && any(r.said, /^Verse is in: 8 bars at 132/) && any(r.said, /^They’ve got it/) && r.cards[0]?.startsWith('Verse') && r.primary === 'The other side',
      `the verse lands ("${any(r.said, /^Verse is in/)}"), the band learns it ("${vlearn.label}", by the house: "${any(r.said, /^They’ve got it|^The kick keeps/)}"), and the offered move is The other side (${r.primary})`);
    // the kick on the fake riff's chugs: each kick near a chug within 15 ms of it
    const kicks = await E((vsec) => { const p = window.overdub.store.get(), sec = p.sections.find((x) => x.id === vsec), d = p.tracks.find((t) => t.name === 'Drums'); const spb = 60 / p.tempo; return d.clips.filter((c) => !c.mute && c.start < sec.start + sec.length && c.start + c.length > sec.start).flatMap((c) => c.notes.filter((n) => n.p === 35 || n.p === 36).map((n) => (c.start + n.t) * spb)); }, vsec);
    const chugs = fk.timeline.parts[0].notes.filter((n) => n.d < 0.25).map((n) => n.t - parts[0]);
    const near = kicks.map((k) => chugs.reduce((m, c) => (Math.abs(c - k) < Math.abs(m) ? c - k : m), Infinity)).filter((x) => Math.abs(x) < 0.06);
    const worst = Math.max(0, ...near.map((x) => Math.abs(x) * 1000));
    const med = near.map((x) => x * 1000).sort((a, b) => a - b)[near.length >> 1];
    T.ok(near.length >= chugs.length * 0.8 && worst <= 15, `the kick on the chugs: ${near.length} kicks on the verse's ${chugs.length} palm-muted chugs, the furthest ${worst.toFixed(1)} ms from its chug (15 or under; median ${med?.toFixed(1)} ms, chug minus kick)`);

    // ⌘Z in the room: the take and its learning in one press, said; ⇧⌘Z both back
    const n0 = h.length;
    await press(page, 'Meta+KeyZ');
    await settle();
    r = await E(READ);
    h = await history(page);
    T.ok(h.length === n0 - 2 && json(r.sections) === json([]) && /^Undone: verse take 1/.test(r.line), `⌘Z in the room undoes the take and the band's learning in one press (${n0} → ${h.length} steps): "${r.line}"`);
    await press(page, 'Meta+Shift+KeyZ');
    await settle();
    r = await E(READ);
    h = await history(page);
    T.ok(h.length === n0 && h.at(-1).reason === `room:learn:${vsec}` && h.at(-2).label === 'Verse take 1' && /^Back in: verse take 1/.test(r.line), `⇧⌘Z redoes the pair, each with its reason (${h.slice(-2).map((x) => x.label).join(', ')}): "${r.line}"`);

    // PageDown (a page-turner pedal): the other side, set up by the house, played on Guitar R over the verse's bars
    await queue(1);
    r0 = await E(READ);
    await press(page, 'PageDown');
    await settle();
    r = await E(READ);
    ci = r.counts.at(-1); tk = r.takes.at(-1);
    h = await history(page);
    T.ok(tk?.track === gR && json(tk?.punch) === json({ from: 0, to: 32 }) && ci?.bars === 1 && lined(ci) && h.at(-1).label === 'The other side’s set up' && h.at(-1).by === 'overdub' && any(saidSince(r0, r), /^Now the other side/),
      `PageDown is the offered move: the other side set up by the house ("${h.at(-1).label}"), then played on Guitar R over bars 1-8 (${json(tk?.punch)}), counted in again`);
    await labelled('Verse, the other side');
    await waitFor(() => window.__lr.stageState()?.wide, null, 30000);
    r = await E(READ);
    h = await history(page);
    const side = h.find((x) => x.label === 'Verse, the other side');
    const sideLine = any(saidSince(r0, r), /^Right side is in on the verse/);
    const plays = await s.plays();
    T.ok(side.by === 'you' && side.ops.includes('auto.write') && sideLine && r.run === 'play' && r.state.wide?.to === 32 && plays.at(-1)?.from === 0,
      `the right side lands as one step by you with the guitars' pan lane ("${side.label}"), measured against the left: "${sideLine}"; then the verse plays back once, wide (from ${plays.at(-1)?.from} to ${r.state.wide?.to})`);
    // a sustain pedal (the input layer's expr event) is Space: it stops the playback and does Next part
    await queue(2);
    await pedal();
    await settle();
    r = await E(READ);
    ci = r.counts.at(-1); tk = r.takes.at(-1);
    T.ok(!r.state.wide && ci?.from === 32 && ci?.bars === 2 && ci?.voice === 'none' && lined(ci) && tk?.from === 32 && tk?.track === gL && (r.run === 'take' || r.run === 'count'),
      `a sustain-pedal press stops the wide playback and is Next part: from beat 32, two bars of the verse before it as its pre-roll (countIn into ${ci?.from}, ${ci?.bars} bars of ${ci?.voice})`);
    await toBeat(64.4);
    await pedal();
    await labelled('Chorus take 1');
    h = await history(page);
    const chorus = h.find((x) => x.label === 'Chorus take 1'), csec = chorus.reason.slice('room:take:'.length);
    await learned(csec);
    r = await E(READ);
    T.ok(json(r.sections) === json([['Verse', 0, 32], ['Chorus', 32, 32], ['End', 64, 4]]) && any(r.said, /^Chorus is in/), `…and the pedal again ends it: "${chorus.label}", the End after it (${json(r.sections)}); "${any(r.said, /^Chorus is in/)}"`);

    // Again on the chorus, an agent's edit landing before the band's learning: ⌘Z undoes the learning alone
    await E(async () => {
      const o = window.overdub, { createDeck } = await import('/app/src/ui/liveroom/deck.js'), deck = createDeck(o);
      const off = deck.on('take', () => { off(); const d = o.store.get().tracks.find((t) => t.name === 'Bass'); o.store.dispatch({ type: 'track.set', track: d.id, patch: { gain: -9 } }, { by: 'mcp:test', label: 'bass down' }); });
    });
    await queue(3);
    r0 = await E(READ);
    await press(page, 'KeyR');
    await settle();
    r = await E(READ);
    ci = r.counts.at(-1); tk = r.takes.at(-1);
    T.ok(ci?.from === 32 && ci?.bars === 1 && ci?.voice === 'none' && lined(ci) && json(tk?.punch) === json({ from: 32, to: 64 }) && tk?.track === gL,
      `R is Again on the chorus: a bar of the verse as its pre-roll into beat ${ci?.from}, the take ending itself at the chorus's end (${json(tk?.punch)})`);
    await labelled('Chorus take 2');
    await learned(csec);
    await waitFor(() => window.__lr.stageState()?.use2, null, 15000).catch(() => null);
    r = await E(READ);
    const use2 = any(saidSince(r0, r), /^You played the chorus twice/);
    T.ok(use2 && r.primary === `Use take ${r.state.use2?.take} as the right side` && r.state.use2?.take === 1, `two takes of the chorus within the pair rule: "${use2}", and the primary reads ${r.primary}`);
    const n1 = (await history(page)).length;
    await press(page, 'Meta+KeyZ');
    await settle();
    r = await E(READ);
    h = await history(page);
    T.ok(h.length === n1 - 1 && h.at(-1).by === 'mcp:test' && h.at(-2).label === 'Chorus take 2' && /^Undone: what the band learned on the chorus/.test(r.line),
      `with an agent's edit between the take and the learning, ⌘Z undoes the learning alone: "${r.line}" (the take and the agent's edit stay)`);
    // ↑ ↓: which take plays in the chorus, one step by you
    const playingC = () => E(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.name === 'Guitar L'); return t.clips.filter((c) => !c.mute && c.start + c.length > 33 && c.start < 63).map((c) => c.id); });
    const takesC = await E(() => { const o = window.overdub, p = o.store.get(), keys = Object.keys(p.assets), t = p.tracks.find((x) => x.name === 'Guitar L'); return t.clips.filter((c) => c.start + c.length > 33 && c.start < 63 && c.length > 16).sort((a, b) => keys.indexOf(a.asset) - keys.indexOf(b.asset)).map((c) => c.id); });
    const before = await playingC();
    await press(page, 'ArrowUp');
    await settle();
    const after = await playingC();
    r = await E(READ);
    T.ok(json(before) === json([takesC[1]]) && json(after) === json([takesC[0]]) && /^Take 1 plays on the chorus/.test(r.line), `↑ on the chorus plays its first take there (${before} → ${after}): "${r.line}"`);
    await press(page, 'ArrowDown');
    await settle();
    T.ok(json(await playingC()) === json([takesC[1]]), '↓ puts the second back');

    // Esc during a pass: Not that one, nothing in History; ⇧R keeps it after all
    const n2 = (await history(page)).length;
    await queue(4);
    r0 = await E(READ);
    await press(page, 'KeyR');
    await toBeat(63);
    await press(page, 'Escape');
    await idle();
    r = await E(READ);
    const capt = r.stops.at(-1);
    T.ok((await history(page)).length === n2 && capt?.keep === 'capture' && capt?.at === 'now' && r.run === 'idle' && any(saidSince(r0, r), /^Not that one/), `Esc during a pass stops at once into Capture, nothing in History: "${any(saidSince(r0, r), /^Not that one/)}"`);
    await press(page, 'Shift+KeyR');
    await labelled('Chorus take 3');
    await learned(csec);
    h = await history(page);
    T.ok(h.some((x) => x.label === 'Chorus take 3' && x.by === 'you'), '⇧R puts it in after all: "Chorus take 3", by you, and the band learns it');

    // the other side on the chorus; its wide playback moved on; then Lay it out, offered once, by the house, ⌘Z back
    await queue(5);
    await press(page, 'Space');
    await labelled('Chorus, the other side');
    await waitFor(() => window.__lr.stageState()?.wide, null, 30000);
    const wide = await E(() => window.__lr.stageState().wide);
    await E((to) => window.overdub.engine.seek(to - 1), wide.to);
    await waitFor(() => !window.__lr.stageState()?.wide && window.overdub.ui.state.liveRoom.run === 'idle', null, 30000);
    await settle(150);
    r = await E(READ);
    const offerLine = any(r.said, /lay them out as a song\?/);
    T.ok(wide.to === 64 && r.primary === 'Lay it out' && /Intro, verse, chorus, verse, chorus, breakdown, chorus ×2, end: 61 bars, 1:51/.test(offerLine || ''), `the chorus's other side plays back wide to beat ${wide.to}, then Lay it out is offered: "${offerLine}"`);
    const pre = await E(() => JSON.stringify(window.overdub.store.get().sections));
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    h = await history(page);
    T.ok(h.at(-1).by === 'overdub' && h.at(-1).reason === 'room:layout' && r.sections.map((x) => x[0]).join(', ') === 'Intro, Verse, Chorus, Verse 2, Chorus 2, Breakdown, Chorus 3, End' && r.primary === 'Hear it all',
      `Lay it out is one step by the house: ${r.sections.map((x) => `${x[0]} ${x[2] / 4}`).join(', ')}; then Hear it all`);
    await press(page, 'Meta+KeyZ');
    await settle();
    const back = await E(() => JSON.stringify(window.overdub.store.get().sections));
    T.ok(back === pre, '⌘Z takes the form back out exactly');
    await press(page, 'Meta+Shift+KeyZ');
    await settle();
    await s.shot('liveroom/stage-laidout');

    // Hear it all: from the top (moved on to its last second), the end said with the empty part's name
    const sendHidden0 = await E(() => document.querySelector('.lr-send')?.hidden);
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    const clickH = await E(() => ({ on: window.overdub.engine.click.on, set: window.overdub.transport.click.get().on }));
    const playsH = await s.plays();
    T.ok(r.run === 'play' && playsH.at(-1)?.from === 0 && r.primary === 'Stop' && sendHidden0 === true, `Hear it all plays from the top (${playsH.at(-1)?.from}), and Space is Stop; Send isn't offered before it (hidden: ${sendHidden0})`);
    T.ok(!clickH.on && clickH.set === true, `the band is the time: the control room's click, on, is held off while Hear it all plays (engine ${clickH.on}; what you set reads ${clickH.set})`);
    r0 = r;
    await E(() => window.overdub.engine.seek(window.overdub.engine.songEnd() - 1.5));
    await waitFor(() => window.overdub.ui.state.liveRoom.run === 'idle', null, 30000);
    await settle(100);
    r = await E(READ);
    const endLine = any(saidSince(r0, r), /top to bottom/);
    T.ok(/^That’s 1:51 top to bottom\. The breakdown’s still empty/.test(endLine || '') && r.state.heard, `at the end: "${endLine}"`);

    // the finish: three chips once heard, the place's default on; each one's loudness measured on this song; a chip
    // previews level-matched (the master trimmed by the difference); choosing one is a step by you, said with the
    // measured difference; Send in the header
    await waitFor(() => window.__lr.said.some((x) => /^Hear it with a finish\?/.test(x)), null, 10000).catch(() => null);
    const fin0 = await E(() => ({ chips: [...document.querySelectorAll('.lr-finishes:not([hidden]) .lr-chip')].map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`), send: !document.querySelector('.lr-send')?.hidden, line: window.__lr.said.find((x) => /^Hear it with a finish\?/.test(x)) || null }));
    T.ok(json(fin0.chips) === json(['Tight*', 'Loud', 'Room']) && fin0.send && fin0.line === 'Hear it with a finish? Tight is on; Loud and Room are a press away.', `after the first time through: "${fin0.line}", the chips ${fin0.chips.join(' · ')}, and Send in the header (${fin0.send})`);
    await waitFor(() => { const f = window.__lr.stageState()?.finishes?.lufs; return f && ['tight', 'loud', 'room'].every((k) => Number.isFinite(f[k])); }, null, 180000);
    const L = (await E(() => window.__lr.stageState().finishes.lufs));
    const g0 = await E(() => window.overdub.store.get().master.gain || 0);
    await page.hover('.lr-chip[data-finish="loud"]');
    await settle(150);
    const pv = await E(() => ({ gain: window.overdub.store.get().master.gain || 0, hist: window.overdub.store.history.length, run: window.overdub.ui.state.liveRoom.run, limiter: window.overdub.store.get().master.inserts.find((x) => x.device === 'core.limiter')?.params?.gain }));
    const nH = (await history(page)).length;
    await page.click('.lr-chip[data-finish="loud"]');
    await settle(150);
    h = await history(page);
    r = await E(READ);
    const chosen = r.said.filter((x) => /^Loud/.test(x)).at(-1) || '';
    const db = L.loud - L.tight;
    T.ok(L.loud - L.tight >= 1 && Math.abs(pv.gain - (g0 - db)) < 0.02 && pv.hist === nH && pv.run === 'play' && pv.limiter === 14,
      `measured on this song: Tight ${L.tight}, Loud ${L.loud}, Room ${L.room} LUFS; Loud focused plays it with the master ${(pv.gain - g0).toFixed(2)} dB (level-matched), nothing in History`);
    T.ok(h.length === nH + 1 && h.at(-1).by === 'you' && h.at(-1).reason === 'room:finish' && chosen === `Loud: the same mix, pushed. About ${Math.round(db)} dB louder than Tight.` && (await E(() => window.overdub.store.get().room.finish)) === 'loud',
      `choosing Loud is one step by you ("${h.at(-1).label}"): "${chosen}"`);
    await press(page, 'Escape');
    await settle();
    // the menu: every item one step by you, undone exactly
    const songNow = () => E(() => { const p = JSON.parse(JSON.stringify(window.overdub.store.get())); delete p.meta.modified; delete p.meta.authors; return JSON.stringify(p); });
    const pick = (name) => E((name) => { const o = window.overdub, sec = o.store.get().sections.find((x) => x.name === name); o.ui.state.liveRoom.card = sec.id; return sec.id; }, name);
    const items = [['feel'], ['simpler'], ['louder'], ['twice'], ['loop'], ['name:Pre-chorus'], ['earlier'], ['later'], ['shorter:4'], ['remove'], ['bassYours']];
    const menuBad = [];
    for (const [id] of items) {
      await pick('Chorus 2');
      const a = await songNow(), n = (await history(page)).length;
      const res = await E((id) => window.overdub.liveRoom.press(id), id);
      const hh = await history(page);
      const one = res?.ok && hh.length === n + 1 && hh.at(-1).by === 'you';
      await E(() => window.overdub.store.undo());
      const b2 = await songNow();
      if (!one || a !== b2) menuBad.push(`${id}${res?.ok ? '' : ` (${res?.error})`}${one ? '' : ' not one step by you'}${a === b2 ? '' : ' not undone exactly'}`);
    }
    T.ok(!menuBad.length, `the card menu: ${items.map((x) => x[0]).join(', ')}, each one step by you that ⌘Z undoes exactly${menuBad.length ? '; wrong: ' + menuBad.join('; ') : ''}`);
    // ×2 on the verse: 16 bars, the take repeated; Earlier keeps the ids
    await pick('Verse 2');
    await E(() => window.overdub.liveRoom.press('twice'));
    const tw = await E(() => { const p = window.overdub.store.get(), s0 = p.sections.find((x) => x.name === 'Verse 2'), t = p.tracks.find((x) => x.name === 'Guitar L'); return { len: s0.length, clips: t.clips.filter((c) => !c.mute && c.start >= s0.start - 0.5 && c.start < s0.start + s0.length).length, all: t.clips.map((c) => `${c.name}@${c.start}+${c.length}${c.mute ? 'M' : ''}`).join(' '), at: s0.start }; });
    T.ok(tw.len === 64 && tw.clips >= 2, `×2: one section, twice the bars (${tw.len / 4}), its take repeated (${tw.clips} clips playing in it)${tw.clips >= 2 ? '' : `; at ${tw.at}: ${tw.all}`}`);
    await E(() => window.overdub.store.undo());
    const ids0 = await E(() => window.overdub.store.get().sections.map((x) => x.id).sort().join());
    await pick('Chorus 2');
    await E(() => window.overdub.liveRoom.press('earlier'));
    const mv = await E(() => ({ ids: window.overdub.store.get().sections.map((x) => x.id).sort().join(), order: window.overdub.store.get().sections.slice().sort((a, b) => a.start - b.start).map((x) => x.name).join(', '), line: document.querySelector('.lr-tb-line')?.textContent }));
    T.ok(mv.ids === ids0 && /Chorus 2, Verse 2/.test(mv.order) && /^Moved the chorus 2 before the verse 2/.test(mv.line), `Earlier: the part moves, its ids kept (${mv.order}): "${mv.line}"`);
    await E(() => window.overdub.store.undo());
    // the menu opens from the card, walks with the arrows and closes with Esc, focus back on the card
    await pick('Verse');
    await settle();
    await page.click('.lr-card.lr-sel .lr-card-main');
    await settle();
    const mn = await E(() => ({ up: !!document.querySelector('.lr-menu'), items: [...document.querySelectorAll('.lr-menu .lr-mi')].map((b) => b.textContent), focus: !!document.activeElement?.closest('.lr-menu') }));
    await press(page, 'ArrowDown');
    await press(page, 'Escape');
    await settle();
    const mc = await E(() => ({ gone: !document.querySelector('.lr-menu'), focus: !!document.activeElement?.closest('.lr-card'), open: window.overdub.liveRoom.isOpen() }));
    T.ok(mn.up && mn.focus && mn.items.some((x) => /^Again/.test(x)) && mn.items.some((x) => /^Remove/.test(x)) && mc.gone && mc.focus && mc.open,
      `a click on the selected card opens its menu (${mn.items.length} items, focus in it); Esc closes it and gives the card its focus back, the room still open`);

    // access: the talkback a polite live region, the scene hidden from readers, every button named, focus in the room
    const acc = await E(() => {
      const lr = document.querySelector('.lr');
      const named = [...lr.querySelectorAll('button')].filter((b) => !b.hidden && b.offsetParent).every((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().length > 0);
      return { live: document.querySelector('.lr-tb-text')?.getAttribute('aria-live'), scene: document.querySelector('.lr-scene')?.getAttribute('aria-hidden'), named, focus: lr.contains(document.activeElement) || document.activeElement === document.body };
    });
    T.ok(acc.live === 'polite' && acc.scene === 'true' && acc.named && acc.focus, `access: the talkback is a polite live region, the scene aria-hidden, every button named, focus in the room (${json(acc)})`);

    // layouts: no sideways scroll, the scene at a whole scale; the phone's targets and text
    for (const [w, hh, tag] of [[1440, 900, '1440'], [1280, 800, '1280'], [390, 844, 'phone']]) {
      await page.setViewportSize({ width: w, height: hh });
      await settle(150);
      const lay = await E(() => {
        const lr = document.querySelector('.lr'), cv = document.querySelector('.lr-stage .lr-scene');
        const k = cv.getBoundingClientRect().width / cv.width;
        const vis = (x) => x.offsetParent && getComputedStyle(x).visibility !== 'hidden' && x.getBoundingClientRect().width > 0;
        const small = [...lr.querySelectorAll('button, .lr-mi')].filter(vis).filter((b) => b.getBoundingClientRect().height < 44 && !b.closest('.lr-top')).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 20));
        const tiny = [...lr.querySelectorAll('*')].filter((x) => vis(x) && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.className || x.tagName);
        return { sw: document.scrollingElement.scrollWidth, cw: innerWidth, lsw: lr.scrollWidth, lcw: lr.clientWidth, k, small, tiny, phone: document.querySelector('.lr-stage').classList.contains('lr-phone') };
      });
      const whole = Math.abs(lay.k - Math.round(lay.k)) < 0.01;
      T.ok(lay.sw <= lay.cw && lay.lsw <= lay.lcw && whole && !lay.tiny.length && (tag !== 'phone' || (lay.phone && !lay.small.length)),
        `at ${w} × ${hh}: no sideways scroll (${lay.lsw} ≤ ${lay.lcw}), the scene at ×${Math.round(lay.k * 100) / 100}, text 12 px or more${tag === 'phone' ? `, targets 44 px or more${lay.small.length ? ' (small: ' + lay.small.join(', ') + ')' : ''}` : ''}${lay.tiny.length ? '; tiny: ' + lay.tiny.slice(0, 4).join(', ') : ''}`);
      await s.shot(`liveroom/stage-${tag}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(100);

    // reduced motion: the scene holds still (the stage's own view, the input moving and the kick on: the same pixels
    // 600 ms apart, the lamps and meters still following their signals, which are held here)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(100);
    const still = await E(async () => {
      const { W, H, sceneOf } = await import('/app/src/ui/liveroom/pixels/index.js');
      const o = window.overdub;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const { readRoom } = await import('/app/src/core/liveroom/session.js');
      const v = { ...readRoom(o.store.get()), reduced, beat: 5.5, run: 'take', live: { input: 0.6, L: 0.5, kick: 1, snare: 0.4, master: [0.5, 0.5] } };
      const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d'), scene = sceneOf('metal');
      const sum = () => { const d = g.getImageData(0, 0, W, H).data; let x = 0; for (let i = 0; i < d.length; i += 7) x = (x * 31 + d[i]) >>> 0; return x; };
      scene.draw(g, { ...v, now: 1000 }, 1000);
      const a = sum();
      await new Promise((r) => setTimeout(r, 600));
      scene.draw(g, { ...v, now: 1600 }, 1600);
      return reduced && a === sum();
    });
    T.ok(still, 'under reduced motion the scene doesn’t move between frames (the same view drawn 600 ms apart gives the same pixels)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Send: from the header, once heard top to bottom
    await page.click('.lr-send');
    await settle(200);
    const sent = await E(() => ({ screen: window.overdub.ui.state.liveRoom.screen, up: !!document.querySelector('.lr-screen[data-screen="send"]') }));
    T.ok(sent.screen === 'send' && sent.up, `Send in the header opens the send screen (${sent.screen})`);

    // the click, held off whenever the room played (every play and stop in it: the takes, Hear it all, the wide
    // playbacks, the previews), given back exactly as it was when the room closes
    const ck = await E(() => { const o = window.overdub, during = window.__lr.clicks.slice(); o.liveRoom.close(); return { during, was: window.__lr.clickWas, now: { ...o.engine.click }, open: o.liveRoom.isOpen() }; });
    const roomPlays = ck.during.filter((x) => x.why === 'play');
    T.ok(roomPlays.length >= 6 && ck.during.every((x) => !x.on) && !ck.open && json(ck.now) === json(ck.was),
      `the click: off through all ${roomPlays.length} plays in the room, and back as it was when the room closes (${json(ck.now)}${json(ck.now) === json(ck.was) ? '' : `, was ${json(ck.was)}`})${ck.during.some((x) => x.on) ? `; on at ${ck.during.map((x, i) => (x.on ? `${x.why} ${i}` : '')).filter(Boolean).join(', ')} of ${ck.during.length}` : ''}`);
    // one turned on while the room is open (an agent's, straight on the engine): held off while the room plays, and
    // there again when the play stops; the room closed, it's as that agent left it
    await E(() => { const o = window.overdub; o.engine.click = { on: false }; o.liveRoom.open({ screen: 'stage' }); o.engine.click = { on: true }; o.liveRoom.press('home'); });
    await waitFor(() => window.overdub.engine.playing, null, 10000);
    await settle(100);
    const ag = await E(() => ({ playing: window.overdub.engine.click.on }));
    await E(() => window.overdub.liveRoom.press('stop'));
    await settle(100);
    const ag2 = await E(() => { const o = window.overdub, idle = o.engine.click.on; o.liveRoom.close(); return { idle, closed: o.engine.click.on }; });
    T.ok(!ag.playing && ag2.idle && ag2.closed, `a click turned on in the room: off while it plays (${ag.playing}), on again when it stops (${ag2.idle}) and after (${ag2.closed})`);

    const errs = s.errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `no page errors on the stage${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
    void path; void OUT;
  } finally { await s.close(); }
}
