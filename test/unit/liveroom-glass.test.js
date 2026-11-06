// What the room reads back from the control room (ui/liveroom/view.js snapshot and readBack; docs/research/
// LIVE-ROOM-MODE.md §7.5), each change in words with its author. Moved from tools/liveroom/checks-glass.js, which keeps
// the glass in muted Chromium.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject } from '../../app/src/core/project.js';
import { planPlace } from '../../app/src/core/liveroom/plans.js';

const json = (x) => JSON.stringify(x);

// a take on Guitar L over bars 1-8 and its part, as the stage would leave them (one step by you)
const TAKE = [
  { type: 'asset.add', asset: { id: 'a_glass1', kind: 'audio', name: 'Take 1', sr: 48000, channels: 1, duration: 16 } },
  {
    type: 'clip.add',
    track: '$L',
    clip: {
      id: 'c_glass1',
      kind: 'audio',
      asset: 'a_glass1',
      start: 0,
      length: 36,
      offset: 0,
      take: 'tk_glass1',
      name: 'Take 1',
    },
  },
  { type: 'section.add', section: { id: 's_glassv', name: 'Verse', start: 0, length: 32 } },
  { type: 'room.part.set', section: 's_glassv', patch: { reps: 1 } },
  { type: 'section.add', section: { id: 's_glasse', name: 'End', start: 32, length: 4 } },
];

test('the read-back', async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- the read-back, in Node */
  {
    const { snapshot, readBack } = await import('../../app/src/ui/liveroom/view.js');
    const s = createStore(createProject({ tempo: 120 }));
    s.dispatch(planPlace(s.get(), { place: 'metal' }).ops, { by: 'you' });
    const L = s.get().tracks.find((t) => t.name === 'Guitar L').id;
    s.dispatch(
      TAKE.map((o) => (o.track === '$L' ? { ...o, track: L } : o)),
      { by: 'you', label: 'Verse take 1' },
    );
    const snap = snapshot(s.get());
    const at = s.history.length;
    const bass = s.get().tracks.find((t) => t.name === 'Bass').id;
    s.dispatch({ type: 'track.set', track: bass, patch: { gain: -2 } }, { by: 'mcp:test', label: 'bass up' });
    s.dispatch(
      {
        type: 'track.add',
        track: { name: 'Synth', kind: 'instrument', instrument: { device: 'core.poly', params: {} } },
      },
      { by: 'mcp:test', label: 'a synth' },
    );
    s.dispatch({ type: 'section.set', section: 's_glassv', patch: { name: 'Riff' } }, { by: 'you', label: 'rename' });
    s.dispatch({ type: 'project.set', patch: { tempo: 140 } }, { by: 'you' });
    const back = readBack(snap, s.get(), s.history.slice(at));
    const by = Object.fromEntries(back.changes.map((c) => [c.kind, c]));
    T.ok(
      by.level?.text === 'the bass came up 2 dB' &&
        by.level.by === 'mcp:test' &&
        by.track?.text === 'a synth track came in' &&
        by.track.by === 'mcp:test' &&
        by.rename?.text === 'verse is called riff now' &&
        by.rename.by === 'you',
      `the read-back: each change in words with its author (${back.changes.map((c) => `"${c.text}" by ${c.by}`).join('; ')})`,
    );
    T.ok(
      json(back.tempo) === json({ bpm: 140, was: 132 }) && back.meter === null,
      `the tempo moved after takes is named with what the takes were played at (${json(back.tempo)})`,
    );
    const quiet = readBack(snapshot(s.get()), s.get(), []);
    T.ok(!quiet.changes.length && !quiet.tempo && !quiet.meter, 'nothing changed, nothing to say');
  }

  T.done();
});
