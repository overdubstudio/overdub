// The live room's checks: the glass [stream C] (docs/research/LIVE-ROOM-MODE.md §3.15, §7.5, §11.6). Run by
// tools/liveroom-test.js (ONLY=glass), whose header says what a checks module exports.
//
// Node: what the room reads back from the control room (ui/liveroom/view.js snapshot and readBack), each change in
// words with its author.
// Muted Chromium: G both ways, the console ledge, Control room → and the studio's 40 px Live room key; going through
// leaves History as it was, the studio doesn't paint under the room (ui.covered) and the room's frame doesn't run
// behind the glass; an edit made in the control room is said on the way back, signed when an agent made it. The song is
// the metal club's as the door makes it (core/liveroom/plans.js planPlace, places.js setupOf).

import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { planPlace } from '../../app/src/core/liveroom/plans.js';
import { openRoom, history, press } from './harness.js';

export const name = 'glass';
export const pages = true;

const json = (x) => JSON.stringify(x);
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);

// a take on Guitar L over bars 1-8 and its part, as the stage would leave them (one step by you)
const TAKE = [
  { type: 'asset.add', asset: { id: 'a_glass1', kind: 'audio', name: 'Take 1', sr: 48000, channels: 1, duration: 16 } },
  { type: 'clip.add', track: '$L', clip: { id: 'c_glass1', kind: 'audio', asset: 'a_glass1', start: 0, length: 36, offset: 0, take: 'tk_glass1', name: 'Take 1' } },
  { type: 'section.add', section: { id: 's_glassv', name: 'Verse', start: 0, length: 32 } },
  { type: 'room.part.set', section: 's_glassv', patch: { reps: 1 } },
  { type: 'section.add', section: { id: 's_glasse', name: 'End', start: 32, length: 4 } },
];

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------- the read-back, in Node */
  {
    const { snapshot, readBack } = await import('../../app/src/ui/liveroom/view.js');
    const s = createStore(createProject({ tempo: 120 }));
    s.dispatch(planPlace(s.get(), { place: 'metal' }).ops, { by: 'you' });
    const L = s.get().tracks.find((t) => t.name === 'Guitar L').id;
    s.dispatch(TAKE.map((o) => (o.track === '$L' ? { ...o, track: L } : o)), { by: 'you', label: 'Verse take 1' });
    const snap = snapshot(s.get());
    const at = s.history.length;
    const bass = s.get().tracks.find((t) => t.name === 'Bass').id;
    s.dispatch({ type: 'track.set', track: bass, patch: { gain: -2 } }, { by: 'mcp:test', label: 'bass up' });
    s.dispatch({ type: 'track.add', track: { name: 'Synth', kind: 'instrument', instrument: { device: 'core.poly', params: {} } } }, { by: 'mcp:test', label: 'a synth' });
    s.dispatch({ type: 'section.set', section: 's_glassv', patch: { name: 'Riff' } }, { by: 'you', label: 'rename' });
    s.dispatch({ type: 'project.set', patch: { tempo: 140 } }, { by: 'you' });
    const back = readBack(snap, s.get(), s.history.slice(at));
    const by = Object.fromEntries(back.changes.map((c) => [c.kind, c]));
    T.ok(by.level?.text === 'the bass came up 2 dB' && by.level.by === 'mcp:test' && by.track?.text === 'a synth track came in' && by.track.by === 'mcp:test' && by.rename?.text === 'verse is called riff now' && by.rename.by === 'you',
      `the read-back: each change in words with its author (${back.changes.map((c) => `"${c.text}" by ${c.by}`).join('; ')})`);
    T.ok(json(back.tempo) === json({ bpm: 140, was: 132 }) && back.meter === null, `the tempo moved after takes is named with what the takes were played at (${json(back.tempo)})`);
    const quiet = readBack(snapshot(s.get()), s.get(), []);
    T.ok(!quiet.changes.length && !quiet.tempo && !quiet.meter, 'nothing changed, nothing to say');
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- the glass, muted Chromium */
  const s = await openRoom('/app/?room', { name: 'glass' });
  const { page, E } = s;
  const settle = (ms = 80) => page.evaluate((ms) => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), ms)), ms);
  try {
    const ok = await E(async ({ take }) => {
      const o = window.overdub;
      const { screens } = await import('/app/src/ui/liveroom/screens.js');
      const { planPlace } = await import('/app/src/core/liveroom/plans.js');
      // the stage's scene, counted as it draws (the room's frame)
      window.__lrDraws = 0;
      const def = screens.get('stage'), mount = def.mount;
      def.mount = (el, ctx) => {
        const sc = ctx.scene, d = sc.draw;
        if (!sc.__counted) { sc.__counted = true; sc.draw = (...a) => { window.__lrDraws++; return d.apply(sc, a); }; }
        return mount(el, ctx);
      };
      // previews, counted open and released
      window.__lrPreviews = { open: 0 };
      const pv = o.store.preview.bind(o.store);
      o.store.preview = (...a) => { const h = pv(...a); window.__lrPreviews.open++; const rel = h.release.bind(h); h.release = () => { window.__lrPreviews.open--; return rel(); }; return h; };
      const r = o.store.dispatch(planPlace(o.store.get(), { place: 'metal' }).ops, { by: 'you', label: 'Into the metal club', reason: 'room:place' });
      const L = o.store.get().tracks.find((t) => t.name === 'Guitar L').id;
      const t = o.store.dispatch(take.map((x) => (x.track === '$L' ? { ...x, track: L } : x)), { by: 'you', label: 'Verse take 1', reason: 'room:take:s_glassv' });
      o.liveRoom.open({ screen: 'stage' });
      return r.ok && t.ok;
    }, { take: TAKE });
    await settle(200);
    const st0 = await E(() => ({ open: window.overdub.liveRoom.isOpen(), screen: window.overdub.ui.state.liveRoom.screen, covered: window.overdub.ui.covered, draws: window.__lrDraws }));
    T.ok(ok && st0.open && st0.screen === 'stage' && st0.covered === 'liveroom' && st0.draws > 0, `the stage is up over the studio, which doesn't paint under it (ui.covered ${st0.covered}); the room's frame draws the scene (${st0.draws} frames)`);
    const h0 = await history(page);

    // G: through the glass; the room's frame stops; History as it was
    await press(page, 'KeyG');
    await settle();
    const out = await E(() => ({ open: window.overdub.liveRoom.isOpen(), covered: window.overdub.ui.covered, draws: window.__lrDraws, previews: window.__lrPreviews.open, key: document.querySelector('[data-panel="liveroom"] .lr-key')?.getBoundingClientRect().height }));
    await settle(400);
    const still = await E(() => window.__lrDraws);
    T.ok(!out.open && out.covered === null && still === out.draws && out.previews === 0 && json(await history(page)) === json(h0),
      `G goes through the glass: the room's frame stops (${out.draws} → ${still} frames), its previews released (${out.previews} open), the studio paints again, History as it was`); // needs B for a preview to release (guideOps)
    T.ok(out.key === 40, `the studio's Live room key is 40 px (${out.key})`);
    // G in the studio: back
    await press(page, 'KeyG');
    await settle();
    const in1 = await E(() => ({ open: window.overdub.liveRoom.isOpen(), screen: window.overdub.ui.state.liveRoom.screen, draws: window.__lrDraws }));
    T.ok(in1.open && in1.screen === 'stage' && in1.draws > still && json(await history(page)) === json(h0), `G in the studio comes back to the stage, and its frame runs again; History as it was (${h0.length} steps)`);
    // nothing changed behind the glass: nothing said about it
    const quiet = await E(() => document.querySelector('.lr-tb-line')?.textContent || '');
    T.ok(!/While you were in the control room/.test(quiet), `nothing changed behind the glass, nothing read back ("${quiet}")`);

    // the console ledge along the scene's bottom is the glass
    const box = await E(() => { const r = document.querySelector('.lr-stage .lr-scene').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 6 }; });
    await page.mouse.click(box.x, box.y);
    await settle();
    T.ok(!(await E(() => window.overdub.liveRoom.isOpen())), 'a click on the console ledge goes through the glass');

    // an agent's edits in the control room are said on the way back, signed with its byline
    await E(() => {
      const o = window.overdub, p = o.store.get(), bass = p.tracks.find((t) => t.name === 'Bass').id;
      o.store.dispatch({ type: 'track.set', track: bass, patch: { gain: -2 } }, { by: 'mcp:test', label: 'bass up' });
      o.store.dispatch({ type: 'track.add', track: { name: 'Synth', kind: 'instrument', instrument: { device: 'core.poly', params: {} } } }, { by: 'mcp:test', label: 'a synth' });
    });
    await page.click('[data-panel="liveroom"] .lr-key');
    await settle();
    const rb = await E(() => ({ line: document.querySelector('.lr-tb-line')?.textContent || '', by: document.querySelector('.lr-tb-by .by')?.className || '', name: document.querySelector('.lr-tb-by .by')?.textContent || '' }));
    T.ok(/^While you were in the control room: the bass came up 2 dB and a synth track came in\. The room leaves them as they are\.$/.test(rb.line) && /by-agent/.test(rb.by),
      `coming back by the Live room key: "${rb.line}", signed ${rb.name} in cool ink`);

    // your own edit, unsigned; the tempo moved after takes, once
    await press(page, 'KeyG');
    await settle();
    await E(() => { const o = window.overdub; o.store.dispatch({ type: 'section.set', section: 's_glassv', patch: { name: 'Riff' } }, { by: 'you', label: 'rename' }); });
    await press(page, 'KeyG');
    await settle();
    const yours = await E(() => ({ line: document.querySelector('.lr-tb-line')?.textContent || '', by: !!document.querySelector('.lr-tb-by .by'), card: [...document.querySelectorAll('.lr-card-name')].map((x) => x.textContent) }));
    T.ok(/^While you were in the control room: verse is called riff now\./.test(yours.line) && !yours.by && yours.card.includes('Riff'), `your own edit is read back unsigned, and the card follows: "${yours.line}" (${yours.card.join(', ')})`);
    await press(page, 'KeyG');
    await settle();
    await E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { tempo: 140 } }, { by: 'you' }));
    await press(page, 'KeyG');
    await settle();
    const tempo = await E(() => document.querySelector('.lr-tb-line')?.textContent || '');
    T.ok(/^The tempo’s 140 now: your takes were played at 132/.test(tempo), `the tempo moved after takes: "${tempo}"`);
    await press(page, 'KeyG');
    await settle();
    await E(() => window.overdub.store.dispatch({ type: 'project.set', patch: { tempo: 150 } }, { by: 'you' }));
    await press(page, 'KeyG');
    await settle();
    const twice = await E(() => document.querySelector('.lr-tb-line')?.textContent || '');
    T.ok(!/150/.test(twice), `…once per song: the next move isn't said again ("${twice}")`);

    // Control room → and press('glass')
    await page.click('.lr-glass');
    await settle();
    const c1 = await E(() => !window.overdub.liveRoom.isOpen());
    const p1 = await E(() => window.overdub.liveRoom.press('glass'));
    const c2 = await E(() => window.overdub.liveRoom.isOpen() && window.overdub.ui.state.liveRoom.screen === 'stage');
    T.ok(c1 && p1?.ok && c2, 'Control room → goes through, and press(\'glass\') comes back to the stage');

    const errs = s.errors.filter((e) => !ignorable(e));
    T.ok(!errs.length, `no page errors through the glass${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
  } finally { await s.close(); }
}
