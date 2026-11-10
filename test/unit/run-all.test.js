// tools/run-all.js is what a live deploy waits for, so what it lets through is what ships. These run the real script
// over planted suites in a throwaway copy of tools/, and read its exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_TIME, mayRetry } from '../../tools/suite-status.js';

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools');

function runAll(suites) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-all-'));
  const tools = path.join(dir, 'tools');
  fs.mkdirSync(tools);
  for (const f of ['run-all.js', 'suite-status.js']) fs.copyFileSync(path.join(TOOLS, f), path.join(tools, f));
  fs.writeFileSync(path.join(tools, 'fetch-kits.js'), '');
  for (const [name, code] of Object.entries(suites)) fs.writeFileSync(path.join(tools, name), code);
  const r = spawnSync(process.execPath, [path.join(tools, 'run-all.js')], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

const OK = "console.log('  ok fine');";
// fails its first run and passes its second: a marker file beside the suite says which this is
const ONCE = `import fs from 'node:fs';
const seen = new URL('./seen', import.meta.url);
if (!fs.existsSync(seen)) { fs.writeFileSync(seen, ''); console.log('FAIL once'); process.exit(1); }
console.log('  ok fine');`;

test('a suite that fails every time stops the run', () => {
  assert.equal(runAll({ 'a-test.js': OK, 'b-test.js': "console.log('FAIL always'); process.exit(1);" }).status, 1);
});

test('a crash, or a kill, stops the run', () => {
  assert.equal(runAll({ 'a-test.js': "throw new Error('boom');" }).status, 1);
  assert.equal(runAll({ 'a-test.js': "process.kill(process.pid, 'SIGKILL');" }).status, 1);
});

test('a wrong result that fails only once still stops the run: only a real-time suite gets a second go', () => {
  const r = runAll({ 'compat-test.js': ONCE });
  assert.equal(r.status, 1, r.stdout);
  assert.doesNotMatch(r.stdout, /run again/);
});

test('a real-time suite that missed a deadline beside others passes if it passes alone, and is named', () => {
  const [suite] = REAL_TIME;
  const r = runAll({ [suite]: ONCE });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, new RegExp(`retried alone and passed: ${suite}`));
});

test('a real-time suite that fails alone too stops the run', () => {
  const [suite] = REAL_TIME;
  assert.equal(runAll({ [suite]: "console.log('FAIL always'); process.exit(1);" }).status, 1);
});

test('a FAIL line fails the suite whatever its exit code says', () => {
  assert.equal(runAll({ 'a-test.js': "console.log('  ok fine'); console.log('FAIL printed, exit 0');" }).status, 1);
});

test('a suite that checked nothing has not passed', () => {
  assert.equal(runAll({ 'a-test.js': 'process.exit(0);' }).status, 1);
});

test('a clean run passes', () => {
  assert.equal(runAll({ 'a-test.js': OK, 'b-test.js': OK }).status, 0);
});

test('the real-time list names suites that exist, and only those get a retry', () => {
  for (const f of REAL_TIME) {
    assert.ok(fs.existsSync(path.join(TOOLS, f)), `${f} is a suite`);
    assert.equal(mayRetry(f), true);
  }
  for (const f of ['compat-test.js', 'agent-test.js', 'stack-monitor-test.js', 'unit-test.js'])
    assert.equal(mayRetry(f), false, f);
});

test("rooms-test gets a second go alone: its CPU ratios (AULA against Stairwell) read the machine's load", () => {
  // idle on the Mac mini: 5.1x, and 8.69x once from cold; with two other suites beside it: 7.1-7.2x, against 7x
  assert.equal(mayRetry('rooms-test.js'), true);
});
