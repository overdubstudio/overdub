// The tally the tools/*-test.js checks print with, as an assertion: a moved check keeps its `t.ok(cond, message)` lines
// as they were. Every failed line is collected and reported together when the test calls done().
import assert from 'node:assert/strict';

export function checks() {
  const failed = [];
  return {
    ok(cond, msg) {
      if (!cond) failed.push(msg);
      return !!cond;
    },
    note() {},
    done() {
      assert.equal(failed.length, 0, `${failed.length} check(s) failed:\n  FAIL ${failed.join('\n  FAIL ')}`);
    },
  };
}
