// The live room's checks: the stage and its press counts [stream C] (docs/research/LIVE-ROOM-MODE.md §11.4, §11.6).
// Run by tools/liveroom-test.js (ONLY=stage), whose header says what a checks module exports.
//
// Node: the press counts (12 at the metal club, 10 at the basement, 9 at the blues bar) on core/liveroom/session.js's
// reducer, the offered move after each kind of step, and the stop rule at every place.
// Muted Chromium: the metal club's session on the stage, with stand-ins where another stream's part isn't in this
// build. The deck is a fake that commits each take as the recorder would (asset.add and the take folder's clip.add,
// one step by you), the place's tracks are a stand-in setup (core/liveroom/places.js setupOf has none until stream B),
// and the band's learning is dispatched by hand as the house's step (core/liveroom/band.js planLearn is inert until B).
// Each check that leans on a stand-in says which stream it needs.

import path from 'node:path';
import { press as pressRoom, offered, stopBeat } from '../../app/src/core/liveroom/session.js';
import { openRoom, history, press, OUT } from './harness.js';

export const name = 'stage';
export const pages = true;

const json = (x) => JSON.stringify(x);
const SPACE = (n) => Array.from({ length: n }, () => 'space');
const walk = (ids) => ids.reduce((s, id) => pressRoom(s, id), {});
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);

// the place's tracks, standing in for places.js setupOf's until stream B fills it in // needs B
const SETUP = {
  tempo: 132, meter: [4, 4], grid: 4, count: { beats: 4, voice: 'sticks' },
  tracks: [
    { role: 'guitarL', name: 'Guitar L', kind: 'audio', pan: -0.8 },
    { role: 'guitarR', name: 'Guitar R', kind: 'audio', pan: 0.8 },
    { role: 'drums', name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
    { role: 'bass', name: 'Bass', kind: 'instrument', instrument: { device: 'core.poly', params: {} } },
  ],
  master: [],
};

// In the page: the stage's ctx captured as it mounts, its deck swapped for a fake that commits each take as the
// recorder would, and the engine's transport held still (beat and playing set by the check), so nothing plays.
const INSTALL = async (setup) => {
  const o = window.overdub;
  const { screens } = await import('/app/src/ui/liveroom/screens.js');
  const { planPlace } = await import('/app/src/core/liveroom/plans.js');
  const F = (window.__lrFake = { calls: [], n: 0, cur: null, resolve: null, kept: null, beat: 0, playing: false, plays: [] });
  // (a commit as the stage's seam has it, or, as: 'deck', the deck's own take: { ok, txn, take, takes, from, to, quietLead })
  function commit({ track, from, to }, as = 'commit') {
    const p = o.store.get();
    const t = p.tracks.find((x) => x.id === track);
    const n = ++F.n, id = `a_fake${n}`, cid = `c_fake${n}`;
    const start = from <= 0 ? 0 : from - 4, len = to + 4 - start, spb = 60 / p.tempo;
    const ops = [{ type: 'asset.add', asset: { id, kind: 'audio', name: `Take ${n}`, sr: 48000, channels: 1, duration: len * spb } }];
    // (what played there is muted under it, as the recorder's take folder does: a clip mostly under the new take)
    for (const c of t.clips) if (!c.mute && Math.min(c.start + c.length, to) - Math.max(c.start, from) > c.length / 2) ops.push({ type: 'clip.set', track, clip: c.id, patch: { mute: true } });
    ops.push({ type: 'clip.add', track, clip: { id: cid, kind: 'audio', asset: id, start, length: len, offset: 0, take: `tk_fake${n}`, name: `Take ${n}` } });
    const r = o.store.dispatch(ops, { by: 'you', label: `Take ${n}` });
    if (!r.ok) return { ok: false, error: r.error };
    const tk = { track, clip: cid, asset: id, start, length: len };
    return as === 'deck' ? { ok: true, txn: r.txn.id, take: tk, takes: [tk], from, to, quietLead: 0 } : { ok: true, commit: { txn: r.txn.id, track, clip: cid, from, to } };
  }
  const fake = {
    state: { run: 'idle' },
    countIn(a) { F.calls.push(['countIn', a]); fake.state.run = 'count'; return Promise.resolve({ ok: true }); },
    take(a) { F.calls.push(['take', a]); F.cur = a; fake.state.run = 'take'; return new Promise((res) => { F.resolve = res; }); },
    stop(a) {
      F.calls.push(['stop', a]);
      fake.state.run = 'idle';
      const cur = F.cur, res = F.resolve;
      F.cur = null; F.resolve = null;
      if (a.keep === 'capture') { F.kept = cur; res?.({ ok: false, cancelled: true }); return Promise.resolve({ ok: true }); }
      res?.({ ok: true });
      return Promise.resolve(cur ? commit({ track: cur.track, from: cur.from, to: a.to }, 'deck') : { ok: false, error: 'no take' });
    },
    keepAfterAll() { F.calls.push(['keepAfterAll']); const k = F.kept; F.kept = null; return Promise.resolve(k ? commit({ track: k.track, from: k.from, to: k.punch ? k.punch.to : k.from + 32 }) : { ok: false }); },
    level: () => null, tuner: () => null,
  };
  // a punch ends itself at its part's end: the check says when
  F.finish = () => { const cur = F.cur, res = F.resolve; F.cur = null; F.resolve = null; fake.state.run = 'idle'; res?.(commit({ track: cur.track, from: cur.punch.from, to: cur.punch.to })); };
  const def = screens.get('stage'), mount = def.mount;
  def.mount = (el, ctx) => { window.__lrCtx = ctx; Object.assign(ctx.deck, fake); return mount(el, ctx); };
  // the transport, held still
  const e = o.engine;
  Object.defineProperty(e, 'beat', { get: () => F.beat, configurable: true });
  Object.defineProperty(e, 'playing', { get: () => F.playing, configurable: true });
  e.play = (from) => { F.plays.push(from ?? null); F.playing = true; F.beat = from || 0; };
  e.stop = () => { F.playing = false; };
  const r = o.store.dispatch(planPlace(o.store.get(), { place: 'metal', setup }).ops, { by: 'you', label: 'Into the metal club', reason: 'room:place' });
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
    tempo: p.tempo,
    sections: p.sections.slice().sort((a, b) => a.start - b.start).map((s) => [s.name, s.start, s.length]),
    cards: [...document.querySelectorAll('.lr-cards > [data-card]')].map((c) => c.querySelector('.lr-card-name')?.textContent || c.textContent.trim()),
    calls: window.__lrFake.calls.map(([k, a]) => [k, a ? JSON.parse(JSON.stringify(a)) : null]),
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
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- §11.6, muted Chromium */
  const s = await openRoom('/app/?room', { name: 'stage' });
  const { page, E } = s;
  const settle = (ms = 60) => page.evaluate((ms) => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), ms)), ms);
  try {
    const placed = await E(INSTALL, SETUP);
    await settle(200);
    let r = await E(READ);
    T.ok(placed && r.screen === 'stage' && r.primary === 'Count me in' && /The drummer’s at 132/.test(r.line), `the stage on a metal song: Count me in, and the drummer's tempo said (${r.primary}; "${r.line}")`); // needs B (setupOf's tracks)
    await s.shot('liveroom/stage-1440');

    // keys: every key of §3.17 declared through ui.keys.add, in the group 'Live room', with a when
    const keys = await E(() => window.overdub.ui.keys.list().filter((k) => k.group === 'Live room' && k.label !== 'Held while the live room is open').map((k) => ({ s: `${k.mod ? k.mod + '+' : ''}${k.key}`, when: typeof k.when === 'function' })));
    const missing = STAGE_KEYS.filter((k) => !keys.some((x) => x.s === k && x.when));
    T.ok(!missing.length, `every key of §3.17 is declared with ui.keys.add, in the group 'Live room', with the room's when (${STAGE_KEYS.length} keys)${missing.length ? '; missing: ' + missing.join(' ') : ''}`);
    // under the room the studio's single keys do nothing
    const left0 = await E(() => window.overdub.ui.isOpen('left'));
    await press(page, 'KeyB');
    T.ok((await E(() => window.overdub.ui.isOpen('left'))) === left0, 'on the stage the studio’s single keys are held (B left the browser pane as it was)');

    // the tempo before the first take: ← → 2 BPM, ⇧ 10
    await press(page, 'ArrowRight');
    await press(page, 'Shift+ArrowRight');
    const t1 = (await E(READ)).tempo;
    await press(page, 'Shift+ArrowLeft');
    await press(page, 'ArrowLeft');
    r = await E(READ);
    T.ok(t1 === 144 && r.tempo === 132 && /The drummer’s at 132/.test(r.line), `before the first take ← → move the tempo 2 BPM and ⇧ 10 (132 → ${t1} → ${r.tempo}), said each time`);

    // Space: counted in, the take from beat 0 on Guitar L, the rest of the stage dimmed
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    const gL = await E(() => window.overdub.store.get().tracks.find((t) => t.name === 'Guitar L')?.id);
    const gR = await E(() => window.overdub.store.get().tracks.find((t) => t.name === 'Guitar R')?.id);
    const tk = r.calls.find((c) => c[0] === 'take')?.[1], ci = r.calls.find((c) => c[0] === 'countIn')?.[1];
    T.ok(ci?.from === 0 && tk?.track === gL && tk?.from === 0 && !tk?.punch && r.run === 'take' && r.primary === 'That’s a take' && r.dim === 'take',
      `Space counts in (countIn from ${ci?.from}, ${ci?.bars} bar of ${ci?.voice}) and the take starts on Guitar L at beat 0; the primary reads ${r.primary}, the rest dims (${r.dim})`); // needs A (the deck)
    // That's a take, pressed half a beat into bar 9: the part is 8 bars
    await E(() => { window.__lrFake.beat = 32.5; });
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    let h = await history(page);
    const stop = r.calls.find((c) => c[0] === 'stop')?.[1];
    const verse = h.at(-1);
    T.ok(stop?.to === 32 && stop?.at === 'bar' && json(r.sections) === json([['Verse', 0, 32], ['End', 32, 4]]) && verse.label === 'Verse take 1' && verse.by === 'you' && /^room:take:/.test(verse.reason) && verse.ops.includes('clip.add') && verse.ops.includes('section.add'),
      `That's a take half a beat into bar 9 ends on bar 9's line: one step by you, "${verse.label}" (${verse.reason}), the take and its part and the End together (${json(r.sections)})`);
    T.ok(/^Verse is in: 8 bars at 132/.test(r.line) && r.cards[0]?.startsWith('Verse') && r.primary === 'The other side', `the verse lands: "${r.line}", a card, and the offered move is The other side (${r.primary})`);
    // the band learns it: the house's step after the take // needs B (planLearn)
    const learn = (sec, part) => E(({ sec, part }) => {
      const o = window.overdub, p = o.store.get(), d = p.tracks.find((t) => t.name === 'Drums'), s0 = p.sections.find((x) => x.id === sec);
      return o.store.dispatch([{ type: 'clip.add', track: d.id, clip: { kind: 'notes', start: s0.start, length: s0.length, notes: [{ p: 36, t: 0, d: 0.25, v: 0.9 }] } }], { by: 'overdub', label: `The band learned the ${part}`, reason: `room:learn:${sec}` }).ok;
    }, { sec, part });
    const vsec = verse.reason.slice('room:take:'.length);
    await learn(vsec, 'verse');
    const n0 = (await history(page)).length;
    // ⌘Z in the room: the take and its learning in one press, said; ⇧⌘Z both back
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

    // PageDown (a page-turner pedal): the other side, on Guitar R over the verse's bars, ending itself
    await press(page, 'PageDown');
    await settle();
    r = await E(READ);
    const tkR = r.calls.filter((c) => c[0] === 'take').at(-1)?.[1];
    T.ok(tkR?.track === gR && json(tkR?.punch) === json({ from: 0, to: 32 }), `PageDown is the offered move: the other side, on Guitar R over bars 1-8 (${json(tkR?.punch)})`); // needs B (planDouble)
    await E(() => window.__lrFake.finish());
    await settle();
    h = await history(page);
    T.ok(h.at(-1).label === 'Verse, the other side' && h.at(-1).by === 'you', `the right side lands as one step by you: "${h.at(-1).label}"`);
    // a sustain pedal (the input layer's expr event) is Space: Next part, then That's a take
    r = await E(READ);
    T.ok(r.primary === 'Next part', `with both sides in, the offered move is Next part (${r.primary})`);
    await E(() => { window.overdub.input.emit('expr', { src: 'midi', sustain: true }); window.overdub.input.emit('expr', { src: 'midi', sustain: false }); });
    await settle();
    r = await E(READ);
    const ciN = r.calls.filter((c) => c[0] === 'countIn').at(-1)?.[1], tkN = r.calls.filter((c) => c[0] === 'take').at(-1)?.[1];
    T.ok(ciN?.from === 32 && ciN?.bars === 2 && ciN?.voice === 'none' && tkN?.from === 32 && tkN?.track === gL && r.run === 'take', `a sustain-pedal press is Space: the next part from beat 32, two bars of the verse before it as its pre-roll (countIn into ${ciN?.from}, ${ciN?.bars} bars of ${ciN?.voice})`); // needs A (countIn's from is the downbeat)
    await E(() => { window.__lrFake.beat = 64.4; window.overdub.input.emit('expr', { src: 'midi', sustain: true }); window.overdub.input.emit('expr', { src: 'midi', sustain: false }); });
    await settle();
    r = await E(READ);
    h = await history(page);
    const chorus = h.at(-1), csec = chorus.reason.slice('room:take:'.length);
    T.ok(chorus.label === 'Chorus take 1' && json(r.sections) === json([['Verse', 0, 32], ['Chorus', 32, 32], ['End', 64, 4]]) && /^Chorus is in/.test(r.line), `…and the pedal again ends it: "${chorus.label}", the End after it (${json(r.sections)}); "${r.line}"`);
    await learn(csec, 'chorus');
    // Again on the chorus, an agent's edit, then the learning: ⌘Z undoes the learning alone
    await press(page, 'KeyR');
    await settle();
    r = await E(READ);
    const ciA = r.calls.filter((c) => c[0] === 'countIn').at(-1)?.[1], tkA = r.calls.filter((c) => c[0] === 'take').at(-1)?.[1];
    T.ok(ciA?.from === 32 && ciA?.bars === 1 && ciA?.voice === 'none' && json(tkA?.punch) === json({ from: 32, to: 64 }) && tkA?.track === gL,
      `R is Again on the chorus: a bar of the verse as its pre-roll into beat ${ciA?.from}, the take ending itself at the chorus's end (${json(tkA?.punch)})`); // needs A
    await E(() => window.__lrFake.finish());
    await settle();
    await E(() => { const o = window.overdub, d = o.store.get().tracks.find((t) => t.name === 'Bass'); o.store.dispatch({ type: 'track.set', track: d.id, patch: { gain: -9 } }, { by: 'mcp:test', label: 'bass down' }); });
    await learn(csec, 'chorus');
    const n1 = (await history(page)).length;
    await press(page, 'Meta+KeyZ');
    await settle();
    r = await E(READ);
    h = await history(page);
    T.ok(h.length === n1 - 1 && h.at(-1).by === 'mcp:test' && h.at(-2).label === 'Chorus take 2' && /^Undone: what the band learned on the chorus/.test(r.line),
      `with an agent's edit between the take and the learning, ⌘Z undoes the learning alone: "${r.line}" (the take and the agent's edit stay)`);
    // ↑ ↓: which take plays in the chorus, one step by you
    const playingC = () => E(() => { const o = window.overdub, t = o.store.get().tracks.find((x) => x.name === 'Guitar L'); return t.clips.filter((c) => !c.mute && c.start + c.length > 33 && c.start < 63).map((c) => c.name); });
    const before = await playingC();
    await press(page, 'ArrowUp');
    await settle();
    const after = await playingC();
    r = await E(READ);
    T.ok(json(before) === json(['Take 4']) && json(after) === json(['Take 3']) && /^Take 1 plays on the chorus/.test(r.line), `↑ on the chorus plays its first take there (${before} → ${after}): "${r.line}"`);
    await press(page, 'ArrowDown');
    await settle();
    T.ok(json(await playingC()) === json(['Take 4']), '↓ puts the second back');

    // Esc during a pass: Not that one, nothing in History; ⇧R keeps it after all
    const n2 = (await history(page)).length;
    await press(page, 'KeyR');
    await settle();
    await press(page, 'Escape');
    await settle();
    r = await E(READ);
    const capt = r.calls.filter((c) => c[0] === 'stop').at(-1)?.[1];
    T.ok((await history(page)).length === n2 && capt?.keep === 'capture' && capt?.at === 'now' && r.run === 'idle' && /^Not that one/.test(r.line), `Esc during a pass stops at once into Capture, nothing in History: "${r.line}"`); // needs A
    await press(page, 'Shift+KeyR');
    await settle();
    h = await history(page);
    T.ok(h.length === n2 + 1 && h.at(-1).label === 'Chorus take 3', `⇧R puts it in after all: "${h.at(-1).label}"`);

    // the other side on the chorus, then Lay it out: offered once, by the house, ⌘Z back
    await press(page, 'PageDown');
    await settle();
    await E(() => window.__lrFake.finish());
    await settle();
    r = await E(READ);
    T.ok(r.primary === 'Lay it out' && /lay them out as a song\? Intro, verse, chorus, verse, chorus, breakdown, chorus ×2, end: 61 bars, 1:51/.test(r.line), `two parts in, Lay it out is offered: "${r.line}"`);
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

    // Hear it all: from the top, the end said with the empty part's name
    await press(page, 'Space');
    await settle();
    r = await E(READ);
    const plays = await E(() => window.__lrFake.plays.slice());
    T.ok(r.run === 'play' && plays.at(-1) === 0 && r.primary === 'Stop', `Hear it all plays from the top (${plays.at(-1)}), and Space is Stop`);
    await E(() => { window.__lrFake.beat = 999; });
    await settle(100);
    r = await E(READ);
    T.ok(r.run === 'idle' && /^That’s 1:51 top to bottom\. The breakdown’s still empty/.test(r.line), `at the end: "${r.line}"`);

    // the menu: every item one step by you, undone exactly (Simpler and Louder as part data until B's band) // needs B (planFeel)
    const songNow = () => E(() => { const p = JSON.parse(JSON.stringify(window.overdub.store.get())); delete p.meta.modified; delete p.meta.authors; return JSON.stringify(p); });
    const pick = (name) => E((name) => { const o = window.overdub, sec = o.store.get().sections.find((x) => x.name === name); o.ui.state.liveRoom.card = sec.id; return sec.id; }, name);
    const items = [['simpler'], ['louder'], ['twice', (x) => /×2$/.test(x.label)], ['loop'], ['name:Pre-chorus'], ['earlier'], ['later'], ['shorter:4'], ['remove']];
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

    // reduced motion: the scene holds still
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(100);
    const still = await E(async () => {
      const cv = document.querySelector('.lr-stage .lr-scene'), g = cv.getContext('2d');
      const sum = () => { const d = g.getImageData(0, 0, cv.width, cv.height).data; let x = 0; for (let i = 0; i < d.length; i += 7) x = (x * 31 + d[i]) >>> 0; return x; };
      const a = sum();
      await new Promise((r) => setTimeout(r, 600));
      return a === sum();
    });
    T.ok(still, 'under reduced motion the scene doesn’t move between frames');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    const errs = s.errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `no page errors on the stage${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
    void path; void OUT;
  } finally { await s.close(); }
}
