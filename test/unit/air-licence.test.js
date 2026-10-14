// The Aachen rooms' licence gate (tools/kits/air-rooms.js, R17 of intent 0006): the bank is built only from the pinned
// license.txt, which begins "MIT License", and the pinned readme.txt, which says the database is under it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkLicence, checkReadme, members, RECIPE } from '../../tools/kits/air-rooms.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const mit = Buffer.from(
  'MIT License\r\n\r\nCopyright (c) 2011 RWTH Aachen University\r\n\r\nPermission is hereby granted',
);

describe('the AIR licence gate', () => {
  test('a licence with its pinned hash that begins "MIT License" passes, and its text comes back', () => {
    assert.match(checkLicence(mit, sha(mit)), /^MIT License/);
  });
  test('a licence that is not the pinned one is refused, whatever it says', () => {
    assert.throws(() => checkLicence(mit), /SHA-256 .* pinned 576e14bf/);
    assert.throws(() => checkLicence(mit, sha(Buffer.from('another'))), /pinned/);
  });
  test('a pinned file that does not begin "MIT License" is refused', () => {
    for (const text of ['Apache License\nVersion 2.0', ' MIT License', 'The MIT License (MIT)', '']) {
      const b = Buffer.from(text);
      assert.throws(() => checkLicence(b, sha(b)), /doesn't begin "MIT License"/);
    }
  });
  test('the readme must be the pinned one and still say MIT', () => {
    const ok = Buffer.from('This database is under the MIT license. For further details see license.txt');
    assert.doesNotThrow(() => checkReadme(ok, sha(ok)));
    assert.throws(() => checkReadme(ok), /pinned 4bbf73d0/);
    const changed = Buffer.from('This database is for research use only.');
    assert.throws(() => checkReadme(changed, sha(changed)), /no longer says/);
  });
  test('every member the recipe reads is pinned: the licence, the readme and both ears of six rooms', () => {
    const m = members();
    assert.equal(Object.keys(m).length, 14);
    for (const [name, hash] of Object.entries(m)) {
      assert.match(name, /^AIR_1_4\//);
      assert.match(hash, /^[0-9a-f]{64}$/);
    }
    assert.equal(RECIPE.zip.sha256, 'd2fd52767505c402e8aed9299dcd046493c8254cfab2f769fcf480dc7c616a5f');
    assert.equal(RECIPE.zip.size, 202650373);
  });
});
