// What tools/run-all.js knows about a run of the suites: which suites may have a second go alone, and which lines of a
// failed one are worth printing. The check "suites" itself is the job of .github/workflows/suites.yml; nothing here
// posts anything.

// The suites whose checks hold to the wall clock (live meters, the scheduler), which can miss with three suites sharing
// the machine: run-all gives these, and only these, a second go alone. Everywhere else a failure is a wrong result, and
// a wrong result that shows up once is still wrong: it stops the run. Adding a suite here hides its intermittent
// failures from a live deploy, so fix the check first.
export const REAL_TIME = new Set(['jam-test.js']);
export const mayRetry = (file) => REAL_TIME.has(file);

// The lines of a failed suite worth printing: its FAIL lines first, then anything else that reads as an error. A passing
// check is left out even when it says "no page errors", or twelve of those would use up the list before the FAIL.
export function failureLines(out, max = 12) {
  const lines = out.split('\n');
  const fails = lines.filter((l) => /^\s*FAIL /.test(l));
  const others = lines.filter((l) => /FAIL|Error|error/.test(l) && !/^\s*(FAIL|ok) /.test(l));
  return [...fails, ...others].slice(0, max);
}
