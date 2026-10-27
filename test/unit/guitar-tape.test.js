// The guitar room's tape stream, as Node runs it (app/src/ui/liveroom/guitar/tape-lines.js, talk-room.js): every line
// the tape, the riffs and the talkback say keeps the live room's copy rules (tools/liveroom/checks-copy.js breaks: the
// never-says words, two sentences, a full stop), the numbers in them read as a musician reads them, and a long reply
// from Claude comes down to a sentence or two for the talkback. The room itself runs in muted Chromium:
// tools/liveroom/checks-tape.js (ONLY=tape node tools/liveroom-test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAPE_LINES, plural, bars, secs, barsOf } from '../../app/src/ui/liveroom/guitar/tape-lines.js';
import { IDEAS, shorten } from '../../app/src/ui/liveroom/guitar/talk-room.js';
import { breaks } from '../../tools/liveroom/checks-copy.js';

const VARS = {
  a: 30,
  b: 33,
  s: 7.3,
  name: 'Riff 4',
  n: 4,
  tempo: 132,
  tuning: 'Drop C',
  bar: 33,
  what: 'Bars 30–33',
  names: ['Claude Code'],
  why: 'the key on the server was turned down',
};
const OTHER = { ...VARS, a: 9, b: 9, s: 1, n: 1, tuning: '', names: ['Claude Code', 'Cursor'], why: '' };

test('every tape line keeps the room’s copy rules, both ways', () => {
  for (const [id, fn] of Object.entries(TAPE_LINES)) {
    for (const v of [VARS, OTHER]) {
      const t = fn(v);
      assert.equal(typeof t, 'string', id);
      assert.deepEqual(breaks(`tape.${id}`, t), [], `${id}: "${t}"`);
    }
  }
});

test('what Claude can be asked keeps them too', () => {
  for (const q of IDEAS) assert.deepEqual(breaks('tape.idea', q), [], q);
});

test('numbers read as a musician reads them', () => {
  assert.equal(bars(1), '1 bar');
  assert.equal(bars(4), '4 bars');
  assert.equal(plural(2.5, 'bar'), '2.5 bars');
  assert.equal(secs(7.26), '7.3 s');
  assert.equal(secs(12), '12.0 s');
  assert.equal(barsOf(30, 33), 'bars 30–33');
  assert.equal(barsOf(9, 9), 'bar 9');
  assert.match(
    TAPE_LINES.kept({ name: 'Riff 2', n: 1, tempo: 120, tuning: '' }),
    /^Riff 2 is in the tray: 1 bar at 120\. /,
  );
  assert.match(TAPE_LINES.open({ a: 5, b: 5 }), /Bar 5 is picked, the last you played: Enter keeps it\./);
  assert.equal(TAPE_LINES.noAnswer({ why: 'the line dropped.' }), 'Claude didn’t answer: the line dropped.');
});

test('a reply from Claude, for the talkback', () => {
  assert.equal(shorten('Done. **Tempo** is `140`.'), 'Done. Tempo is 140.');
  assert.equal(shorten('- one\n- two'), 'one two');
  const long =
    'The drummer’s on Double-kick gallop now, at 132. A d-beat wants 160 or more: say if you want it. ⌘Z puts the old beat back. ' +
    'More here. '.repeat(40);
  const s = shorten(long);
  assert.ok(s.length <= 280, `${s.length} characters`);
  assert.ok(s.startsWith('The drummer’s on Double-kick gallop now, at 132.'));
  assert.ok(!/More here/.test(s.slice(0, 120)));
  assert.equal(shorten(''), '');
});
