// The ok/note shape tools/pw.js's tally() has, over node:assert, so a check moved out of tools/ keeps its assertions
// line for line. Not a test file (the glob is *.test.js).
import assert from 'node:assert/strict';

export const T = {
  ok(cond, msg) {
    assert.ok(cond, msg);
    return true;
  },
  note() {},
};
