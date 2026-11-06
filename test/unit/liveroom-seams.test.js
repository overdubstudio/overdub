// The live room's seams (docs/research/LIVE-ROOM-MODE.md §11.1, §14.1, §14.2), moved from tools/liveroom/checks-model.js,
// which keeps the page: every module of §14.2 imports in Node and exports exactly its frozen names; the ten ops, applied,
// undone and redone through the store; a room and a sheet through save, load, a render and a share link; readRoom,
// prefs over overdub:room (a stub storage, and none) and decideDoor's rows.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { createStore } from '../../app/src/core/store.js';
import { createProject, cleanProject } from '../../app/src/core/project.js';
import { OP_TYPES } from '../../app/src/core/ops.js';
import { listenCopy } from '../../app/src/core/share.js';
import '../../app/src/devices/builtin/index.js';
import { renderSong } from '../../app/src/engine/node/render.js';
import { sha256 } from '../../app/src/engine/node/io.js';

const APP = '../../app/src/';
const LINE_FILES = ['soundcheck', 'double', 'stage', 'glass', 'kitchen', 'door', 'shelf'];
// spec §14.2, with the foundation's additions (each in the spec's table and the foundation's report)
const FROZEN = {
  'core/liveroom/model.js': [
    'PLACE_IDS',
    'RIG_IDS',
    'FINISHES',
    'FEEL_IDS',
    'ROLES',
    'ROOM_LIMITS',
    'cleanRoom',
    'cleanSheet',
    'roomOf',
    'partOf',
    'sheetOf',
    'NAMES',
    'ORDER',
    'putKey',
    'placeKey',
  ],
  'core/liveroom/room-ops.js': ['ROOM_OPS'],
  'core/liveroom/sheet-ops.js': ['SHEET_OPS'],
  // (with stream B's additions, each in §14.2's rows)
  'core/liveroom/places.js': [
    'PLACES',
    'placeOf',
    'RIGS',
    'rigChain',
    'rigLabel',
    'setupOf',
    'feelsOf',
    'finishChain',
    'earOf',
    'chordAt',
    'FADERS',
    'FEELS',
    'FEEL_GROOVES',
    'FILLS',
    'WINDOWS',
    'bandTracks',
    'chainHash',
    'fillsOf',
    'finishBus',
    'follows',
    'grooveOf',
    'gtrEq',
    'guitarChain',
    'guitarGain',
    'lowCut',
    'partKey',
  ],
  'core/liveroom/read.js': ['readTake', 'readInWorker', 'SNAP', 'THIN_ONSETS', 'attacksOf', 'earOf', 'hear', 'riffOf'],
  'core/liveroom/read-worker.js': [],
  'core/liveroom/band.js': [
    'guideOps',
    'planLearn',
    'planFeel',
    'planFinish',
    'planBassYours',
    'bandFor',
    'HOUSE_RULES',
    'MUTE_V',
    'TOUCH',
    'bandNotes',
    'defaultFeel',
    'guideOf',
    'isHouse',
    'riffIn',
  ],
  'core/liveroom/tight.js': [
    'measurePair',
    'BASEMENT_MS',
    'LIMIT_MS',
    'MATCH_MS',
    'REFINE_MS',
    'TIGHT_MS',
    'UNMATCHED',
  ],
  'core/liveroom/double.js': [
    'planDouble',
    'planUseAsRight',
    'PAN_RAMP',
    'panLaneOps',
    'planPans',
    'roleTrack',
    'sidesOf',
  ],
  'core/liveroom/session.js': ['readRoom', 'offered', 'stopBeat', 'press'],
  // (planRig and rigNow: the guitar room's rig fix, docs/research/GUITAR-ROOM.md §2.9)
  'core/liveroom/plans.js': [
    'planPlace',
    'takeOps',
    'planLayout',
    'planTwice',
    'planMove',
    'planShorter',
    'planRemove',
    'planEnd',
    'planRig',
    'rigNow',
  ],
  'core/liveroom/sheet.js': ['parseSheet', 'formatSheet', 'lineParts', 'soundingKey', 'transposeChord'],
  'core/liveroom/align.js': ['alignChords'],
  'core/liveroom/kitchen.js': [
    'kitchenSetup',
    'planRead',
    'planTime',
    'planPlayer',
    'planMaster',
    'planKitchenFinish',
    'offeredKitchen',
  ],
  'core/liveroom/label.js': ['labelOf', 'titleDice'],
  ...Object.fromEntries(LINE_FILES.map((f) => [`core/liveroom/lines/${f}.js`, ['LINES']])),
  'ui/liveroom/index.js': ['default', 'screens'],
  'ui/liveroom/screens.js': ['screens'],
  'ui/liveroom/prefs.js': ['prefs'],
  'ui/liveroom/deck.js': ['createDeck'],
  'ui/liveroom/soundcheck.js': ['mountLamps', 'lampsState'],
  'ui/liveroom/pixels/index.js': ['W', 'H', 'LEDGE', 'sceneOf', 'drawCrop', 'drawCover', 'windowFor'],
  'ui/liveroom/door-decide.js': ['decideDoor'],
  'ui/liveroom/shelf-db.js': ['put', 'list', 'get', 'remove'],
  'ui/liveroom/send.js': ['sendMix', 'sendSong'],
};
// the skeleton's other modules: each its stream's to fill, so only that they load (the page loads only if they do)
const OTHERS = [
  'ui/liveroom/view.js',
  'ui/liveroom/style.js',
  'ui/liveroom/stage.js',
  'ui/liveroom/setlist.js',
  'ui/liveroom/menu.js',
  'ui/liveroom/talkback.js',
  'ui/liveroom/paper.js',
  'ui/liveroom/kitchen.js',
  'ui/liveroom/door.js',
  'ui/liveroom/shelf.js',
  'ui/liveroom/pixels/scenes.js',
];
const TEN = [
  'room.set',
  'room.part.set',
  'sheet.set',
  'sheet.section.add',
  'sheet.section.set',
  'sheet.section.remove',
  'sheet.line.add',
  'sheet.line.set',
  'sheet.line.remove',
  'section.move',
];

const json = (x) => JSON.stringify(x);
// the song as History compares it: everything but when it was last modified
const songOf = (s) => {
  const p = JSON.parse(JSON.stringify(s.get()));
  if (p.meta) delete p.meta.modified;
  return JSON.stringify(p);
};
const msg = (e) => String(e?.message || e).split('\n')[0];

// a song with something in it to hear, and the room's two fields over it (ops: the room's, applied after)
function song() {
  const s = createStore(createProject({ tempo: 120 }));
  const r = s.dispatch(
    [
      { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 8 } },
      { type: 'section.add', ref: 'c', section: { name: 'Chorus', start: 8, length: 8 } },
      {
        type: 'track.add',
        ref: 'd',
        track: { name: 'Drums', kind: 'instrument', instrument: { device: 'core.drums', params: {} } },
      },
      {
        type: 'clip.add',
        track: '$d',
        ref: 'dc',
        clip: {
          kind: 'notes',
          start: 0,
          length: 16,
          notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((t) => ({
            p: t % 2 ? 38 : 36,
            t,
            d: 0.25,
            v: 0.9,
          })),
        },
      },
      {
        type: 'track.add',
        ref: 'k',
        track: { name: 'Keys', kind: 'instrument', instrument: { device: 'core.poly', params: {} } },
      },
      {
        type: 'clip.add',
        track: '$k',
        ref: 'kc',
        clip: {
          kind: 'notes',
          start: 0,
          length: 16,
          notes: [
            { p: 52, t: 0, d: 4, v: 0.8 },
            { p: 55, t: 4, d: 4, v: 0.8 },
            { p: 57, t: 8, d: 8, v: 0.8 },
          ],
        },
      },
    ],
    { by: 'you' },
  );
  if (!r.ok) throw new Error(r.error);
  return { s, ids: r.created };
}
const ROOM_OPS = (ids) => [
  {
    type: 'room.set',
    patch: {
      place: 'metal',
      rig: 'modern',
      tuning: 'drop-c',
      finish: 'tight',
      tracks: { drums: ids.d, guitarL: ids.k },
    },
  },
  { type: 'room.part.set', section: ids.v, patch: { feel: 'chugs' } },
  { type: 'sheet.set', patch: { capo: 3, notes: 'Slow at first.' } },
  {
    type: 'sheet.section.add',
    section: { id: 'ss_verse1', name: 'Verse 1', lines: [{ id: 'sl_one', text: 'Somewhere a [G]paper [Em]moon' }] },
  },
];

test('the seams: every module imports and exports its frozen names', async () => {
  const T = checks();
  {
    const wrong = [],
      loaded = {};
    for (const [file, want] of Object.entries(FROZEN)) {
      try {
        const m = await import(APP + file);
        loaded[file] = m;
        const got = Object.keys(m).sort(),
          exp = [...want].sort();
        if (json(got) !== json(exp))
          wrong.push(`${file}: ${got.join(' ') || 'nothing'} (frozen: ${exp.join(' ') || 'nothing'})`);
      } catch (e) {
        wrong.push(`${file} doesn't load: ${msg(e)}`);
      }
    }
    T.ok(
      !wrong.length,
      `every module of §14.2 imports in Node and exports exactly its frozen names (${Object.keys(FROZEN).length} modules)${wrong.length ? ': ' + wrong.join('; ') : ''}`,
    );
    const bad = [];
    for (const file of OTHERS) {
      try {
        await import(APP + file);
      } catch (e) {
        bad.push(`${file}: ${msg(e)}`);
      }
    }
    T.ok(
      !bad.length,
      `the skeleton's other modules import (${OTHERS.length})${bad.length ? ': ' + bad.join('; ') : ''}`,
    );
    const px = loaded['ui/liveroom/pixels/index.js'],
      pf = loaded['ui/liveroom/prefs.js'];
    T.ok(
      px?.W === 256 && px?.H === 144 && px?.LEDGE === 14 && pf?.prefs?.key === 'overdub:room',
      `the frozen numbers: the scene ${px?.W} x ${px?.H}, its ledge ${px?.LEDGE}, the prefs under ${pf?.prefs?.key}`,
    );
    const { screens } = loaded['ui/liveroom/index.js'] || {};
    const ids = screens?.list?.() || [];
    T.ok(
      ['door', 'stage', 'kitchen', 'shelf', 'send'].every((x) => ids.includes(x)) &&
        ids.every((x) => typeof screens.get(x)?.mount === 'function'),
      `the registry holds the room's screens, each with its mount: ${ids.join(', ')}`,
    );
    let threw = false;
    try {
      screens.add({ id: 'x' });
    } catch {
      threw = true;
    }
    const off = screens.add({ id: 'lr-check', mount: () => ({ frame() {}, unmount() {} }) }),
      had = screens.has('lr-check');
    off();
    T.ok(
      threw && had && !screens.has('lr-check'),
      'screens.add refuses a screen with no mount, and its remove() takes one out again',
    );
    const seen = new Map(),
      dup = [],
      notFn = [];
    for (const f of LINE_FILES) {
      const L = loaded[`core/liveroom/lines/${f}.js`]?.LINES;
      if (!L || typeof L !== 'object') {
        notFn.push(`${f}: no LINES`);
        continue;
      }
      for (const [id, line] of Object.entries(L)) {
        if (seen.has(id)) dup.push(`${id} (${seen.get(id)} and ${f})`);
        seen.set(id, f);
        if (typeof line?.text !== 'function') notFn.push(`${f}.${id}`);
      }
    }
    T.ok(
      !dup.length && !notFn.length,
      `every lines/*.js has LINES, each line a text(vars), the ids unique across the ${LINE_FILES.length} files (${seen.size} lines)${dup.length ? '; twice: ' + dup.join(', ') : ''}${notFn.length ? '; not a line: ' + notFn.join(', ') : ''}`,
    );
    const R = loaded['core/liveroom/room-ops.js']?.ROOM_OPS,
      S = loaded['core/liveroom/sheet-ops.js']?.SHEET_OPS;
    T.ok(
      json(Object.keys(R || {}).sort()) === json(['room.part.set', 'room.set']) &&
        json(Object.keys(S || {}).sort()) ===
          json([
            'sheet.line.add',
            'sheet.line.remove',
            'sheet.line.set',
            'sheet.section.add',
            'sheet.section.remove',
            'sheet.section.set',
            'sheet.set',
          ]),
      `room-ops.js and sheet-ops.js hold the nine room and sheet ops (${Object.keys(R || {}).length} and ${Object.keys(S || {}).length})`,
    );
  }

  T.done();
});

test('the ten ops: applied, undone and redone', async () => {
  const T = checks();
  {
    const missing = TEN.filter((x) => !OP_TYPES.includes(x));
    T.ok(
      !missing.length,
      `the ten new ops are in the op catalog${missing.length ? ': missing ' + missing.join(', ') : ''}`,
    );
    const { s, ids } = song();
    const steps = [
      ...ROOM_OPS(ids),
      { type: 'room.part.set', section: ids.c, patch: { feel: 'open', busy: 1 } },
      { type: 'room.part.set', section: ids.v, remove: true },
      { type: 'sheet.section.set', section: 'ss_verse1', patch: { name: 'First verse' } },
      { type: 'sheet.line.add', section: 'ss_verse1', line: { id: 'sl_two', text: 'over a [C]cardboard [D]sea' } },
      { type: 'sheet.line.set', section: 'ss_verse1', line: 'sl_one', patch: { text: 'Somewhere a [G]paper moon' } },
      { type: 'sheet.line.remove', section: 'ss_verse1', line: 'sl_two' },
      { type: 'section.move', section: ids.c, before: ids.v },
      { type: 'sheet.section.remove', section: 'ss_verse1' },
      { type: 'sheet.set', clear: true },
      { type: 'room.set', clear: true },
    ];
    const bad = [];
    for (const op of steps) {
      const before = songOf(s),
        r = s.dispatch(op, { by: 'you' });
      if (!r.ok) {
        bad.push(`${op.type}: ${r.error}`);
        continue;
      }
      const after = songOf(s),
        u = s.undo(),
        back = songOf(s) === before,
        rr = s.redo(),
        again = songOf(s) === after;
      if (!u.ok || !back || !rr.ok || !again)
        bad.push(
          `${op.type}${op.clear ? ' clear' : op.remove ? ' remove' : ''}: ${!back ? 'undo left a different song' : 'redo left a different song'}`,
        );
    }
    T.ok(
      !bad.length,
      `each of the room's ops, applied, undone and redone through the store, gives back the song it started from and then the applied one, deep-equal (${steps.length} steps)${bad.length ? ': ' + bad.join('; ') : ''}`,
    );
    const seen = new Set(steps.map((x) => x.type));
    T.ok(
      TEN.every((x) => seen.has(x)),
      `all ten are among them (${[...seen].filter((x) => TEN.includes(x)).length})`,
    );
  }

  T.done();
});

test('the song: save and load, a render, a share link, a redo', async () => {
  const T = checks();
  {
    const { s, ids } = song(),
      r = s.dispatch(ROOM_OPS(ids), { by: 'you' });
    const p = s.get(),
      raw = JSON.parse(json(p));
    raw.room.fromLater = { x: 1 };
    raw.sheet.sections[0].lines[0].fromLater = 'kept';
    const back = cleanProject(JSON.parse(json(raw)));
    T.ok(
      r.ok &&
        back.room?.place === 'metal' &&
        back.room.fromLater?.x === 1 &&
        back.sheet?.capo === 3 &&
        back.sheet.sections[0].lines[0].fromLater === 'kept' &&
        json(cleanProject(JSON.parse(json(back)))) === json(back),
      `a room and a sheet survive save and load, with the keys a newer studio wrote, and cleaning again changes nothing${r.ok ? '' : ': ' + r.error}`,
    );
    // an older reader: the song as a studio before the room had it
    const older = JSON.parse(json(p));
    delete older.room;
    delete older.sheet;
    const opts = { from: 0, to: 16, tail: 0.5 };
    const h1 = sha256(renderSong(p, opts)),
      h0 = sha256(renderSong(cleanProject(older), opts));
    T.ok(
      h1 === h0,
      `the same song with and without its room and sheet renders to the same hash (${h1.slice(0, 16)}, ${h0 === h1 ? 'the same' : 'without: ' + h0.slice(0, 16)})`,
    );
    // a share link: the sheet's lines are the guest's, an agent's stay the agent's
    s.dispatch(
      { type: 'sheet.line.add', section: 'ss_verse1', line: { id: 'sl_agent', text: 'a line from the agent' } },
      { by: 'mcp:test' },
    );
    const l = listenCopy({ song: JSON.parse(json(s.get())), from: { name: 'Sam', mark: 'abcdef' } }, {});
    const lines = l.song?.sheet?.sections?.[0]?.lines || l.sheet?.sections?.[0]?.lines || [];
    const by = Object.fromEntries(lines.map((x) => [x.id, x.by]));
    T.ok(
      /^guest:/.test(by.sl_one || '') && by.sl_agent === 'mcp:test',
      `a share link signs the sheet's lines as the guest (${by.sl_one}), and an agent's line stays the agent's (${by.sl_agent})`,
    );
    // redo keeps the step's reason and audition
    const s2 = createStore(createProject());
    s2.dispatch(
      { type: 'room.set', patch: { place: 'bluesbar' } },
      { by: 'claude', label: 'the blues bar', reason: 'you asked for a shuffle', audition: true },
    );
    s2.undo();
    const rr = s2.redo(),
      last = s2.history[s2.history.length - 1];
    T.ok(
      rr.ok && last?.reason === 'you asked for a shuffle' && last?.audition === true && last?.label === 'the blues bar',
      `store.redo keeps a step's reason and audition ("${last?.reason}")`,
    );
  }

  T.done();
});

test("the session's seams: readRoom, prefs, decideDoor", async () => {
  const T = checks();
  {
    const { readRoom, stopBeat } = await import(APP + 'core/liveroom/session.js');
    const { s, ids } = song();
    s.dispatch(ROOM_OPS(ids), { by: 'you' });
    const v = readRoom(s.get());
    T.ok(
      v.place === 'metal' &&
        v.roles.drums === ids.d &&
        v.roles.guitarL === ids.k &&
        v.cards.map((c) => c.name).join() === 'Verse,Chorus' &&
        v.cards[0].part.feel === 'chugs' &&
        v.cards[0].bars === 2,
      `readRoom: the place, the roles, the parts as cards in order with their room parts (${v.cards.map((c) => `${c.name} ${c.bars} bars`).join(', ')})`,
    );
    T.ok(
      readRoom(createProject()).place === null && readRoom(createProject()).cards.length === 0,
      'readRoom of a song with no room: no place, no cards',
    );
    T.ok(
      stopBeat(v, 33.5) === 36 && stopBeat(v, 32) === 32,
      'stopBeat: a stop ends on the next bar line (33.5 ends at 36, 32 at 32)',
    );

    // prefs over a stub storage, then over none
    const store = new Map(),
      was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, x) => {
          store.set(k, String(x));
        },
        removeItem: (k) => store.delete(k),
      },
    });
    try {
      const { prefs } = await import(APP + 'ui/liveroom/prefs.js');
      const g0 = prefs.get();
      prefs.set({ side: 'room', place: 'metal', outputs: { 'MacBook Pro Speakers': 'speakers' } });
      prefs.set({ side: 'sideways', outputs: { 'AirPods Pro': 'headphones' } });
      const g1 = prefs.get(),
        stored = JSON.parse(store.get('overdub:room') || 'null');
      T.ok(
        json(g0) === json({ v: 1, side: null, place: null, outputs: {}, said: {} }) &&
          g1.side === 'room' &&
          g1.place === 'metal' &&
          json(g1.outputs) === json({ 'MacBook Pro Speakers': 'speakers', 'AirPods Pro': 'headphones' }) &&
          stored?.side === 'room',
        `prefs: overdub:room starts empty; set keeps a side and a place, merges the outputs, and ignores a side that isn't one (${json(g1)})`,
      );
      prefs.mark({ id: 'p_song1' }, 'layout');
      for (let i = 0; i < 50; i++) prefs.mark(`p_more${i}`, 'finish');
      T.ok(
        !prefs.said('p_song1', 'layout') &&
          prefs.said('p_more49', 'finish') &&
          !prefs.said('p_more49', 'layout') &&
          Object.keys(prefs.get().said).length === 50,
        'prefs: a once-only line said for a song is remembered for the last 50 songs',
      );
      let odd;
      try {
        prefs.mark('constructor', 'layout');
        prefs.mark('__proto__', 'layout');
        const a = [
          prefs.said('constructor', 'layout'),
          prefs.said('valueOf', 'layout'),
          prefs.said('__proto__', 'layout'),
        ];
        store.set('overdub:room', '{"v":1,"said":{"__proto__":["layout"],"toString":["layout"]}}');
        odd = [
          ...a,
          prefs.said('toString', 'layout'),
          prefs.said('__proto__', 'layout'),
          prefs.said('length', 'layout'),
        ].join(' ');
      } catch (e) {
        odd = msg(e);
      }
      T.ok(
        odd === 'true false false true false false',
        `prefs: a song whose id is one of Object's words (constructor, toString, __proto__) is a song like any other (${odd})`,
      );
      store.set('overdub:room', '{not json');
      T.ok(
        prefs.get().side === null &&
          (prefs.set({ side: 'control' }), JSON.parse(store.get('overdub:room')).side === 'control'),
        'prefs: an unreadable overdub:room reads as empty, and the next set writes a good one',
      );
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked');
        },
      });
      prefs.set({ side: 'room' });
      T.ok(prefs.get().side === 'room', 'prefs: with storage blocked, it remembers for the page load');
    } finally {
      if (was) Object.defineProperty(globalThis, 'localStorage', was);
      else delete globalThis.localStorage;
    }

    const { decideDoor } = await import(APP + 'ui/liveroom/door-decide.js');
    const rows = [
      [{ search: '?room' }, 'room', 'new'],
      [{ search: '?room', webdriver: true }, 'room', 'new'],
      [{ search: '' }, 'room', 'new'],
      [{ search: '', saved: true }, 'control', 'saved'],
      [{ search: '?new', webdriver: true }, 'control', 'new'],
      [{ search: '?demo=boiler-room' }, 'control', 'demo'],
      [{ search: '?room', hash: '#s=abc' }, 'control', 'shared'],
    ];
    const off = rows.filter(([a, side, sg]) => {
      const d = decideDoor(a);
      return d.side !== side || d.song !== sg;
    });
    T.ok(
      !off.length,
      `decideDoor: ?room is the room's on a new song, even under webdriver; a first visit the room's door; under webdriver today's first screens; a share link the control room's${off.length ? ': wrong for ' + off.map(([a]) => json(a)).join(', ') : ''}`,
    );
  }

  T.done();
});
