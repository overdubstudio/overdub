// The tape box (core/liveroom/label.js; docs/research/LIVE-ROOM-MODE.md §3.13), on a whole room song: its label and its
// note from the song, and the same three titles from the dice. Moved from tools/liveroom/checks-shelf.js, which keeps
// the shelf in muted Chromium; test/unit/liveroom-door.test.js holds the rest of the label.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { labelOf, titleDice } from '../../app/src/core/liveroom/label.js';
import { createProject } from '../../app/src/core/project.js';

// A room song at the metal club: the verse doubled (two recordings), the chorus on the left (a third), each recording
// named by id (`shared` is a recording another song uses too)
function roomSong({ id, title = 'Untitled', takes = ['a_' + id + '_1', 'a_' + id + '_2', 'a_' + id + '_3'] }) {
  const p = createProject({ id, title, tempo: 132, key: { root: 'C', scale: 'minor' } });
  const audio = (cid, asset, start, length) => ({
    id: cid,
    kind: 'audio',
    asset,
    start,
    length,
    offset: 0,
    gain: 0,
    by: 'you',
  });
  p.sections = [
    { id: 's_v', name: 'Verse', start: 0, length: 16 },
    { id: 's_c', name: 'Chorus', start: 16, length: 16 },
    { id: 's_b', name: 'Breakdown', start: 32, length: 16 },
  ];
  p.tracks = [
    {
      id: 't_gl',
      name: 'Guitar L',
      kind: 'audio',
      instrument: null,
      inserts: [],
      clips: [audio('c1', takes[0], 0, 16), audio('c3', takes[2], 16, 16)],
      gain: 0,
      pan: -0.8,
      mute: false,
      solo: false,
      arm: false,
      by: 'you',
    },
    {
      id: 't_gr',
      name: 'Guitar R',
      kind: 'audio',
      instrument: null,
      inserts: [],
      clips: [audio('c2', takes[1], 0, 16)],
      gain: 0,
      pan: 0.8,
      mute: false,
      solo: false,
      arm: false,
      by: 'you',
    },
  ];
  p.room = {
    v: 1,
    place: 'metal',
    rig: 'modern',
    tuning: 'drop-c',
    finish: 'tight',
    tracks: { guitarL: 't_gl', guitarR: 't_gr' },
  };
  return p;
}

test('the tape box from the song', async () => {
  const T = checks();
  // 1. the tape box, in Node
  const a = roomSong({ id: 'p_box', title: 'Untitled' });
  const L = labelOf(a);
  T.ok(
    L.title === 'Untitled · 132 · drop C' &&
      L.slate === 'METAL CLUB · DROP C · 132 · C MINOR' &&
      L.parts.join(', ') === 'Verse, Chorus, Breakdown',
    `the tape box’s label from the song: “${L.title}”, “${L.slate}”, ${L.parts.join(', ')}`,
  );
  T.ok(
    L.note === 'Verse doubled. Chorus wants its other side. The breakdown’s still empty.',
    `…and its note from the song: “${L.note}”`,
  );
  const d1 = titleDice(a),
    d2 = titleDice(roomSong({ id: 'p_box', title: 'Untitled' }));
  T.ok(
    d1.length === 3 && d1.join() === d2.join(),
    `the dice give the same three titles for the same song: ${d1.join(' · ')}`,
  );

  T.done();
});
