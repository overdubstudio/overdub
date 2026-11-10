// Clip mute, in Node (docs/ARCHITECTURE.md, "Muted clips"): clip.set { mute } round-trips exactly, is checked, survives
// normalising, a share link and the DAWproject export; an agent's apply_ops mute is signed by the agent; a muted clip is
// absent from the Node render. Moved from tools/silence-test.js section 1; the killswitch in the studio stays there.
import { test } from 'node:test';
import { createStore } from '../../app/src/core/store.js';
import { cleanProject as normProject, summarize } from '../../app/src/core/project.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { encodeShare, decodeShare } from '../../app/src/core/share.js';
import { dawprojectXml } from '../../app/src/core/dawproject.js';
import * as tools from '../../app/src/agent/tools.js';
import { getDevice } from '../../app/src/devices/registry.js';
import { T } from './_t.js';

const t = T;
const dbOf = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const peakOf = (chs, a = 0, b = Infinity) => {
  let pk = 0;
  for (const d of chs)
    for (let i = Math.max(0, a); i < Math.min(d.length, b); i++) {
      const v = Math.abs(d[i]);
      if (v > pk) pk = v;
    }
  return pk;
};
const J = (x) => JSON.stringify({ ...x, meta: null }); // (meta: the modified time and who has edited move on every edit)

const song = (mute = {}) => ({
  format: 'overdub/0',
  id: 'p_silnc1',
  title: 'Silence',
  tempo: 120,
  meter: [4, 4],
  key: null,
  loop: { on: false, start: 0, end: 16 },
  tracks: [
    {
      id: 't_keys01',
      name: 'Keys',
      kind: 'instrument',
      instrument: { device: 'core.keys', params: {} },
      inserts: [],
      clips: [
        {
          id: 'c_keys01',
          kind: 'notes',
          start: 0,
          length: 8,
          ...(mute.keys ? { mute: true } : {}),
          notes: [
            { id: 'n1', p: 60, t: 0, d: 2, v: 0.8 },
            { id: 'n2', p: 64, t: 2, d: 2, v: 0.8 },
            { id: 'n3', p: 67, t: 4, d: 2, v: 0.8 },
          ],
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
    {
      id: 't_bass01',
      name: 'Bass',
      kind: 'instrument',
      instrument: { device: 'core.bass', params: {} },
      inserts: [],
      clips: [
        {
          id: 'c_bass01',
          kind: 'notes',
          start: 0,
          length: 8,
          notes: [
            { id: 'n1', p: 36, t: 0, d: 1, v: 0.8 },
            { id: 'n2', p: 36, t: 4, d: 1, v: 0.8 },
          ],
        },
      ],
      gain: 0,
      pan: 0,
      mute: false,
      solo: false,
    },
  ],
  sections: [],
  devices: {},
  assets: {},
  master: { gain: 0, inserts: [] },
  meta: {},
});
test('clip mute: round trip, validation, link, DAWproject, apply_ops, absent from the Node render', async () => {
  const store = createStore(normProject(song()), { getDevice });
  const before = J(store.get());
  t.ok(!('mute' in store.get().tracks[0].clips[0]), 'an older clip has no mute flag (it plays)');
  let r = store.dispatch(
    { type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: true } },
    { by: 'you', label: 'mute clip' },
  );
  const muted = J(store.get());
  t.ok(r.ok && store.get().tracks[0].clips[0].mute === true, 'clip.set { mute: true } mutes the clip');
  store.undo();
  t.ok(J(store.get()) === before, 'undo puts the clip back exactly (no mute key left behind)');
  store.redo();
  t.ok(J(store.get()) === muted, 'redo mutes it again, exactly');
  r = store.dispatch({ type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: false } }, { by: 'you' });
  t.ok(r.ok && J(store.get()) === before, 'clip.set { mute: false } stores no flag at all, like an older song');
  store.undo();
  t.ok(J(store.get()) === muted, 'and its undo mutes it again');
  r = store.dispatch({ type: 'clip.set', track: 't_keys01', clip: 'c_keys01', patch: { mute: 'yes' } }, { by: 'you' });
  t.ok(!r.ok && /mute must be true or false/.test(r.error), `a mute that isn't a boolean is refused (${r.error})`);
  t.ok(normProject(JSON.parse(muted)).tracks[0].clips[0].mute === true, 'normalising a song keeps a muted clip muted');
  t.ok(/\(muted\)/.test(summarize(store.get())), "the agent's summary says the clip is muted");

  // a share link and the DAWproject export carry it
  const enc = await encodeShare(store.get());
  const dec = await decodeShare(enc.hash);
  const got = dec.ok ? normProject(dec.song).tracks[0].clips[0] : null;
  t.ok(got && got.mute === true, 'a share link keeps the clip muted');
  const xml = dawprojectXml(store.get(), { getDevice }).project;
  t.ok(
    /<Clip[^>]*enable="false"/.test(xml) && (xml.match(/enable="false"/g) || []).length === 1,
    'the DAWproject export marks the muted clip enable="false" (and only it)',
  );

  // an agent mutes with apply_ops: signed by the agent
  const app = { store, devices: { getDevice }, ui: { emit() {}, toast() {} } };
  tools.installTools(app);
  const ap = await app.tools.run(
    'apply_ops',
    {
      label: 'mute the bass',
      reason: 'let the keys breathe',
      ops: [{ type: 'clip.set', track: 'Bass', clip: 'c_bass01', patch: { mute: true } }],
    },
    { by: 'mcp:probe' },
  );
  const last = store.history[store.history.length - 1];
  t.ok(
    ap.ok !== false && !ap.error && store.get().tracks[1].clips[0].mute === true && last.by === 'mcp:probe',
    `an agent's apply_ops mute lands, signed by the agent (by ${last && last.by})`,
  );

  // the Node render: a muted clip is absent
  const full = renderSong(song(), { to: 8, tail: 0.5 });
  const keysOnly = renderSong(song(), { to: 8, tail: 0.5, tracks: ['t_keys01'] });
  const keysMuted = renderSong(song({ keys: true }), { to: 8, tail: 0.5, tracks: ['t_keys01'] });
  const bassOnly = renderSong(song(), { to: 8, tail: 0.5, tracks: ['t_bass01'] });
  const allMuted = renderSong(song({ keys: true }), { to: 8, tail: 0.5 });
  const pk = (x) => dbOf(peakOf(x.channels));
  let diff = 0;
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < allMuted.length; i++)
      diff = Math.max(diff, Math.abs(allMuted.channels[c][i] - bassOnly.channels[c][i]));
  t.ok(
    pk(keysOnly) > -40 && pk(keysMuted) <= -180 && dbOf(diff) <= -180,
    `Node render: the keys clip peaks ${pk(keysOnly).toFixed(1)} dBFS, muted ${pk(keysMuted) <= -180 ? 'digital silence' : pk(keysMuted).toFixed(1) + ' dBFS'}; the song with it muted is the bass alone, sample for sample (full song ${pk(full).toFixed(1)} dBFS)`,
  );
});
