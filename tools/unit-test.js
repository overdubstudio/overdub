// The unit tests as a suite, so that run-all holds them too. Checks moved out of the browser suites into test/unit, and
// run-all is what a live deploy waits for and what the "suites" status reports: without this they would gate nothing
// but CI, and the ones reading the private repo beside this one would run nowhere at all.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/unit/*.test.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
let oks = 0, fails = 0;
for (const line of (r.stdout || '').split('\n')) {
  const m = /^\s*(not )?ok \d+ - (.*)$/.exec(line);
  if (!m) continue;
  if (m[1]) fails++;
  else oks++;
  console.log(`${m[1] ? 'FAIL' : '  ok'} ${m[2]}`);
}
console.log(`unit: ${oks} ok, ${fails} failed`);
// a run that printed no tests at all, or died, is a failure whatever it counted
process.exit(r.status === 0 && oks > 0 ? 0 : 1);
