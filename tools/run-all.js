// Run every check in tools/ (each *-test.js prints ok/FAIL lines and exits 1 on failure) and summarise.
//   node tools/run-all.js            all of them, three at a time
//   node tools/run-all.js core mix   only those whose name contains one of the words
//   node tools/run-all.js round-test.js   a whole file name picks that file alone (not arrange-around-test.js)
//   node tools/run-all.js --post     a full run of a clean, pushed commit: post its result to the commit on GitHub
//                                    as the status "suites" (tools/suite-status.js), which its pull request shows
//
// These are the integration suites (browsers, servers, renders): run them locally before merging (with --post, so the
// pull request shows it). CI runs the unit tests instead (node --test "test/unit/*.test.js"); the deploy-live
// workflow runs these on the Mac mini before production.
//
// First it makes sure the sampled kits are here (app/kits/, gitignored): a kit a device pins and this checkout hasn't
// built fails suites far from the cause, so a missing one is fetched and built (tools/fetch-kits.js) before anything
// runs, and the run stops if that fails.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT, suiteStatus } from './suite-status.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const post = args.includes('--post');
const only = args.filter((a) => a !== '--post');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const tests = fs.readdirSync(HERE).filter((f) => /-test\.js$/.test(f)).filter((f) => !only.length || only.some((w) => (/-test\.js$/.test(w) ? f === w : f.includes(w)))).sort();
const PAR = Number(process.env.PAR || 3);

// the kits, before anything runs
{
  const fetchKits = (...a) => spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js'), ...a], { cwd: ROOT, encoding: 'utf8' });
  const check = fetchKits('--check');
  if (check.status !== 0) {
    const missing = check.stdout.split('\n').filter((l) => /not fetched|missing|wrong/.test(l));
    console.log(`kits: ${missing.length || 'some'} not here, fetching them first (node tools/fetch-kits.js)\n${missing.map((l) => '      ' + l).join('\n')}`);
    const got = spawnSync(process.execPath, [path.join(HERE, 'fetch-kits.js')], { cwd: ROOT, stdio: 'inherit' });
    if (got.status !== 0) {
      console.log('kits: the fetch failed, so the suites that play them would too. Fix that first (the lines above say why).');
      process.exit(1);
    }
  }
}

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code, signal) => {
      const fails = (out.match(/^\s*FAIL /gm) || []).length, oks = (out.match(/^\s*ok /gm) || []).length;
      resolve({ file, code, signal, oks, fails, secs: ((Date.now() - t0) / 1000).toFixed(1), out });
    });
  });
}

// the commit this run is of, and whether the tree matched it when the run began (gitignored output doesn't count)
const sha = git('rev-parse', 'HEAD').stdout?.trim() || '';
const dirty = (git('status', '--porcelain').stdout || '').trim() !== '';
const results = [];
const queue = tests.slice();
await Promise.all(Array.from({ length: Math.min(PAR, queue.length) }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const r = await run(f);
    results.push(r);
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${f.padEnd(24)} ${String(r.oks).padStart(4)} ok ${String(r.fails).padStart(3)} failed  ${r.secs}s`);
    if (r.code !== 0) console.log(r.out.split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => '      ' + l).join('\n'));
    // a suite that exits non-zero without a FAIL line crashed or was killed: its last lines say how
    if (r.code !== 0 && !r.fails) console.log(`      (exit ${r.code}${r.signal ? ', ' + r.signal : ''}, no FAIL line; its last lines:)\n` + r.out.trimEnd().split('\n').slice(-30).map((l) => '      | ' + l).join('\n'));
  }
}));
// A suite that failed with others running beside it runs once more on its own: the real-time checks (live meters, the
// scheduler, CPU budgets) can miss when three suites share the machine. One that passes alone counts as passed but is
// named as retried, here and in the posted status, and its first failure stays in the log above; a real break fails
// twice. (Fix a check that keeps turning up here: a retry is a tolerance for load, not for a wrong result.)
for (const r of results.filter((x) => x.code !== 0)) {
  const again = await run(r.file);
  console.log(`${again.code === 0 ? 'PASS' : 'FAIL'}  ${r.file.padEnd(24)} ${String(again.oks).padStart(4)} ok ${String(again.fails).padStart(3)} failed  ${again.secs}s  (run again, alone)`);
  if (again.code !== 0) console.log(again.out.split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 12).map((l) => '      ' + l).join('\n'));
  results[results.indexOf(r)] = { ...again, retried: true };
}
const bad = results.filter((r) => r.code !== 0);
const retried = results.filter((r) => r.retried && r.code === 0);
if (retried.length) console.log(`\nretried alone and passed: ${retried.map((r) => r.file).join(', ')}`);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
// A full run leaves its totals behind, so tools/pages-test.js can hold the quoted counts (deck, launch drafts) to them.
// A run that left suites out (named some) isn't one.
if (!only.length) {
  const oks = results.reduce((s, r) => s + r.oks, 0), fails = results.reduce((s, r) => s + r.fails, 0);
  try {
    fs.mkdirSync(path.join(HERE, '.out'), { recursive: true });
    fs.writeFileSync(path.join(HERE, '.out', 'run-all.json'), JSON.stringify({ at: new Date().toISOString(), sha: sha || null, dirty, suites: results.length, passed: results.length - bad.length, checks: oks + fails, oks, fails, retried: retried.map((r) => r.file) }, null, 2) + '\n');
  } catch { /* the totals are a convenience */ }
  console.log(`${oks + fails} checks in ${results.length} suites (${fails} failed)`);
}
if (post) {
  const st = suiteStatus({ results, only, dirty, sha, host: os.hostname().replace(/\.local$/, '') });
  if (!st.ok) console.log(`--post: nothing posted, ${st.why}`);
  else {
    const r = spawnSync('gh', ['api', '--method', 'POST', 'repos/{owner}/{repo}/statuses/' + sha, '-f', 'state=' + st.state, '-f', 'context=' + CONTEXT, '-f', 'description=' + st.description], { cwd: ROOT, encoding: 'utf8' });
    console.log(r.status === 0 ? `--post: ${CONTEXT} = ${st.state} on ${sha.slice(0, 9)} ("${st.description}")` : `--post: GitHub refused it (is ${sha.slice(0, 9)} pushed, and gh signed in?): ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
    if (r.status !== 0) process.exitCode = 1;
  }
}
if (bad.length) process.exitCode = 1;
