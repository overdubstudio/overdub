// One studio and Find anything [find] (app/src/ui/workspace.js, app/src/ui/workspace-view.js), the parts that need no
// browser: decideView in Node (the full studio for everyone and nothing written down; ?view=simple and ?view=round for
// that load only; a saved simple view is read as full ("merged"); a storage that throws is survived) and the registry
// (its ids, groups, titles and purposes are the ones in the spec, word for word; each panel feature maps to its panel;
// every feature has search words and says where it is), and workspace.js's own words and look, read as source. That
// every mapped panel is one the studio registers, and everything else, is in the browser: tools/find-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FEATURES } from '../../app/src/ui/workspace.js';

const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };
const KEY = 'overdub:workspace';

const SPEC = [
  ['Make', 'notes', 'Notes', "Edit a part's notes one by one."],
  ['Make', 'beat', 'Beat grid', 'Click a drum pattern in, square by square.'],
  ['Make', 'grooves', 'Grooves', 'Drum patterns by style, ready to drop in.'],
  ['Make', 'jam', 'Guitar', 'The Jam room: play guitar over the song, with tab and amps.'],
  ['Sound', 'devices', 'Sound', 'The instrument and effects on a track, and their knobs.'],
  ['Sound', 'browser', 'Instruments and effects', 'Every instrument, effect and guitar rig, to try or add.'],
  ['Balance', 'mixer', 'Mixer', 'How loud each part is, and where it sits left to right.'],
  ['Balance', 'compare', 'Compare', 'Hold your mix up against a track you like.'],
  ['Balance', 'meters', 'Level meter', 'How loud the whole song is playing, and All off.'],
  ['Song', 'loop', 'Loop', 'Play a few bars round and round.'],
  ['Song', 'position', 'Where you are', 'Bar and beat of the playhead, and the beat lights.'],
  ['Song', 'song-settings', 'Song settings', 'Beats per bar, tap the tempo, the click.'],
  ['Song', 'tracks', 'Track tools', 'Add tracks, snap, zoom, and colours.'],
  ['Song', 'start', 'Start a song', 'Play one idea at any speed; the studio keeps time.'],

  ['Song', 'redo', 'Redo', 'Put back what Undo took away.'],
  ['Recording', 'record-options', 'Recording options', 'Count-in, layering takes and timing.'],
  ['Agent', 'history', 'History', 'Everything that changed, who changed it, and how to take it back.'],
  ['Agent', 'details', 'Details', 'Exact values for whatever is selected.'],
  ['Agent', 'agent-setup', 'Connect your own agent', 'Use your own Claude, or Claude Code on this computer.'],
  [
    'Files',
    'files',
    'Files and reports',
    'Import MIDI, audio and devices; export stems, MIDI and DAWproject; who-made-what reports.',
  ],
  ['Layout', 'panes', 'Pane buttons', 'Buttons to show and hide the side and bottom panes.'],
];
const PANEL_OF = {
  notes: 'pianoroll',
  beat: 'drumgrid',
  grooves: 'grooves',
  jam: 'jam',
  devices: 'rack',
  browser: 'browser',
  mixer: 'mixer',
  compare: 'reference',
  history: 'history',
  details: 'inspector',
};
const curly = (s) => s.replace(/'/g, '’'); // the studio sets apostrophes curly
const same = (a, b) => a === b || a === curly(b);

test('registry', () => {
  const F = FEATURES.map((f) => ({
    id: f.id,
    group: f.group,
    title: f.title,
    purpose: f.purpose,
    the: !!f.the,
    aliases: f.aliases || [],
    panels: f.panels || [],
    where: f.where || '',
  }));
  T.ok(
    F.length === SPEC.length,
    `the registry has the spec's ${SPEC.length} features (${F.length}: ${F.map((f) => f.id).join(', ')})`,
  );
  const off = SPEC.filter(([g, id, t, p]) => {
    const f = F.find((x) => x.id === id);
    return !f || f.group !== g || !same(f.title, t) || !same(f.purpose, p);
  }).map(([, id]) => id);
  T.ok(
    !off.length,
    `each feature's id, group, title and purpose are the spec's, word for word${off.length ? ' (not: ' + off.join(', ') + ')' : ''}`,
  );
  const panelsOff = Object.entries(PANEL_OF)
    .filter(([id, panel]) => !F.find((x) => x.id === id)?.panels.includes(panel))
    .map(([id, panel]) => `${id} → ${panel}`);
  T.ok(
    !panelsOff.length,
    `the panel features map to their panels${panelsOff.length ? ' (not: ' + panelsOff.join(', ') + ')' : ''}`,
  );
  T.ok(
    F.every((f) => f.aliases.length && f.where.length > 6),
    'every feature has search words and says where it is',
  );
});

/* ======================================================================== decideView, in Node */
test('decideView', async () => {
  let mod = null;
  try {
    mod = await import('../../app/src/ui/workspace-view.js');
  } catch (e) {
    T.ok(false, `app/src/ui/workspace-view.js loads in Node (${e.message})`);
  }
  const decideView = mod?.decideView;
  T.ok(typeof decideView === 'function', 'workspace-view.js exports decideView, a pure function Node can call');
  if (typeof decideView !== 'function') return;
  const mem = (init = {}) => {
    const data = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
      data,
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => {
        data.set(k, String(v));
      },
      removeItem: (k) => {
        data.delete(k);
      },
      key: (i) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
  };
  const dv = (search, storage, webdriver) => decideView({ search, storage, webdriver });
  const clean = dv('', mem(), false),
    cleanWd = dv('', mem(), true);
  T.ok(
    clean.view === 'full' && !clean.persist && cleanWd.view === 'full',
    `a clean browser opens the full studio, with or without webdriver, and nothing is written down (${JSON.stringify(clean)})`,
  );
  for (const k of ['overdub:layout', 'overdub:welcomed', 'overdub:project']) {
    const r = dv('', mem({ [k]: k === 'overdub:welcomed' ? '1' : '{}' }), false);
    T.ok(r.view === 'full', `a browser with ${k} opens the full studio (${r.view})`);
  }
  const merged = dv('', mem({ [KEY]: { v: 1, view: 'simple', added: { mixer: 'you' } } }), false);
  T.ok(
    merged.view === 'full' && merged.from === 'merged' && !merged.persist,
    `a saved simple view is read as full, from "merged" (${JSON.stringify(merged)})`,
  );
  const savedFull = dv('', mem({ [KEY]: { v: 1, view: 'full', added: {} } }), false);
  T.ok(savedFull.view === 'full', 'a saved full is kept');
  const url = dv('?view=simple', mem({ [KEY]: { v: 1, view: 'full' } }), false);
  T.ok(
    url.view === 'simple' && !url.persist && url.from === 'url',
    `?view=simple opens the simple view for that load only, for one release (${JSON.stringify(url)})`,
  );
  const round = dv('?view=round', mem(), false);
  T.ok(
    round.view === 'simple' && round.round === true && !round.persist,
    `?view=round is the Round prototype over the simple view, for that load only (${JSON.stringify(round)})`,
  );
  const odd = dv('?view=wide', mem(), false);
  T.ok(odd.view === 'full', `an unknown ?view is ignored (${odd.view})`);
  let v7 = null,
    threw = null;
  try {
    v7 = dv('', mem({ [KEY]: 'not json' }), false).view;
  } catch (e) {
    threw = e.message;
  }
  T.ok(!threw && v7 === 'full', `an unreadable saved layout doesn't throw (${threw || v7})`);
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
    key: () => null,
    length: 0,
  };
  let v8 = null,
    threw8 = null;
  try {
    v8 = dv('', broken, false).view;
  } catch (e) {
    threw8 = e.message;
  }
  T.ok(
    !threw8 && v8 === 'full',
    `storage that throws (a private window, blocked site data) doesn't throw (${threw8 || v8})`,
  );
});

test('the copy: workspace.js carries the spec’s words and draws none of the old look', () => {
  const ws = fs.readFileSync(new URL('../../app/src/ui/workspace.js', import.meta.url), 'utf8');
  const want = [
    'Find anything',
    'Every panel is here. Type what you’re after: mixer, loop, tempo, piano roll.',
    'Nothing called that. Ask Claude where it is.',
    'One studio now: everything’s on screen, and Find (⌘K) gets you anywhere.',
    'Go to',
    'Ask Claude: “',
    'Full studio',
  ];
  const miss = want.filter((w) => !ws.includes(w));
  T.ok(
    !miss.length,
    `workspace.js carries the spec's words${miss.length ? ' (missing: ' + miss.map((m) => `"${m}"`).join(', ') + ')' : ''}`,
  );
  T.ok(
    !/✨|sparkle|border-left:\s*[2-9]px|inset\s+\d+px\s+0\s+0|border-radius:\s*(99|50%|\d{2,}px)/.test(ws),
    'Find draws no sparkles, no coloured left border and no pills',
  );
});
