// The riff library and the stack rack in a browser that refuses IndexedDB (a private window), as tools/liveroom/
// checks-library.js ran them on a second page: Node has no indexedDB, so these are the same code path. Both stores keep
// the visit's in memory and say so in words. (test/unit/guitar-library.test.js holds the memory side in full; the
// IndexedDB side stays in muted Chromium, in checks-library.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as riffs from '../../app/src/ui/liveroom/riffs-db.js';
import * as rack from '../../app/src/ui/liveroom/rack-db.js';

test('IndexedDB refused: riffs and the rack are the visit’s, and each says so', async () => {
  assert.equal(globalThis.indexedDB, undefined);
  const r = await riffs.add({ audio: { sr: 48000, channels: [new Float32Array(4800)] }, tempo: 120, beats: 1 });
  const k = await rack.save([{ device: 'core.stack', params: {}, on: true }]);
  assert.equal(await riffs.where(), 'memory');
  assert.ok(r.ok);
  assert.equal(r.where, 'memory');
  assert.equal((await riffs.list()).rows.length, 1);
  assert.match(riffs.note(), /won’t keep riffs/);
  assert.equal(await rack.where(), 'memory');
  assert.ok(k.ok);
  assert.equal((await rack.list()).length, 1);
  assert.match(rack.note(), /won’t keep the rack/);
});
