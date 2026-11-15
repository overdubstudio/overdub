// The live room's runner [liveroom] (docs/research/LIVE-ROOM-MODE.md §11) over tools/liveroom/checks-*.js. Each checks
// module exports
//   name                 its name, for ONLY= (checks-band.js: 'band')
//   pages                whether run() opens a browser when ctx.pages lets it (muted headless Chromium, tools/pw.js)
//   run(T, ctx)          its checks, on the suite's one tally (T.ok(cond, line), T.note(line)); ctx: { pages (false
//                        under PAGES=0: open nothing), levels (false under LEVELS=0: skip the slow renders), out (where
//                        its screenshots and fakes go: tools/.out/liveroom) }
// They print in ORDER, then any others by name; one that fails to load or throws is a FAIL line and the rest still run.
// A stream adds its checks to its own checks-*.js, which the runner finds by name.
//
// Three suites run them, so tools/run-all.js can run the parts side by side: tools/liveroom-stage-test.js and
// tools/liveroom-band-test.js the modules PARTS names, and tools/liveroom-test.js every other, a new one included. The
// modules share nothing (their fakes and shots are named for them), and PARTS balances their time. Within a suite, LANES
// runs them side by side too: each lane a Node process of its own (this suite again, with ONLY= its modules and
// LIVEROOM_LANE=1), its modules one after another, their lines printed here module by module in ORDER, so the suite
// reads as it would one module after another.
//
//   node tools/run-all.js liveroom                 every check, the three suites three at a time
//   node tools/liveroom-test.js                    that suite's modules
//   ONLY=model,band node tools/liveroom-test.js    some, by name, whichever suite has them (any of the three takes ONLY),
//                                                  one after another in this process
//   PAGES=0                                        no browser: the Node checks only
//   LEVELS=0                                       no level renders
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, OUTDIR } from '../pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['model', 'input', 'band', 'pixels', 'stage', 'glass', 'kitchen', 'door', 'shelf', 'copy'];
export const PARTS = { 'liveroom-stage': ['stage', 'takes', 'room'], 'liveroom-band': ['band', 'rig', 'shop', 'drummer', 'guitar'] };
// Each suite's lanes: a Node process each, so one module's synthesis or renders never hold up another's presses (the
// lanes share the machine, not an event loop). A lane is a module that takes most of the suite's time on its own, or a
// few that add up to about as much; a module no lane names (a new one) runs here, after them. The tape and the drummer
// are in none, so they run with nothing of their suite beside them: the tape's grab is held to the fake's file within
// half a millisecond, and in one of five runs beside another lane it came out exactly one of Chromium's 10 ms
// fake-capture blocks off; the drummer's taps are timed from Node, and beside the band's renders five taps half a second
// apart once read as 110 BPM.
export const LANES = {
  liveroom: [['model', 'input', 'door', 'shelf', 'copy', 'library'], ['kitchen', 'pixels', 'glass', 'start']],
  'liveroom-band': [['band', 'shop'], ['rig', 'guitar']],
};

export async function runSuite(label) {
  const only = (process.env.ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
  const ctx = { pages: process.env.PAGES !== '0', levels: process.env.LEVELS !== '0', out: path.join(OUTDIR, 'liveroom') };
  fs.mkdirSync(ctx.out, { recursive: true });

  const T = tally(label);
  const named = (f) => f.replace(/^checks-/, '').replace(/\.js$/, '');
  const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
  const all = fs.readdirSync(HERE).filter((f) => /^checks-[a-z0-9-]+\.js$/.test(f));
  const elsewhere = Object.values(PARTS).flat();
  const mine = (n) => (PARTS[label] ? PARTS[label].includes(n) : !elsewhere.includes(n));
  for (const n of PARTS[label] || []) if (!all.includes(`checks-${n}.js`)) T.ok(false, `${label} names ${n}: there is no tools/liveroom/checks-${n}.js`);
  const files = all.sort((a, b) => rank(named(a)) - rank(named(b)) || a.localeCompare(b))
    .filter((f) => (only.length ? only.includes(named(f)) : mine(named(f))));
  if (only.length) for (const w of only) if (!files.some((f) => named(f) === w)) T.ok(false, `ONLY=${w}: there is no tools/liveroom/checks-${w}.js`);

  const lanes = !only.length && !process.env.LIVEROOM_LANE ? (LANES[label] || []).map((l) => l.filter((n) => files.includes(`checks-${n}.js`))).filter((l) => l.length) : [];
  const laned = lanes.flat();
  if (laned.length) {
    const said = await Promise.all(lanes.map((l) => lane(label, l)));
    const parts = new Map(said.flatMap((x) => [...x.parts]));
    const replay = (lines) => {
      for (const line of lines) {
        const m = /^ {2}(ok {3}|FAIL |\.\. {3})(.*)$/.exec(line);
        if (!m) console.log(line);
        else if (m[1] === '..   ') T.note(m[2]);
        else T.ok(m[1] === 'ok   ', m[2]);
      }
    };
    for (const x of said) replay(x.pre);
    for (const f of files) if (laned.includes(named(f))) replay(parts.get(named(f)) || []);
    for (const x of said) if (!x.done) T.ok(false, `the lane ${x.names.join(', ')} ran to its end (it exited ${x.code}${x.signal ? `, ${x.signal}` : ''})`);
  }

  for (const f of files) {
    if (laned.includes(named(f))) continue;
    let mod;
    try { mod = await import(pathToFileURL(path.join(HERE, f)).href); } catch (e) { T.ok(false, `${f} loads: ${String(e?.message || e).split('\n')[0]}`); continue; }
    const name = mod.name || named(f);
    if (typeof mod.run !== 'function') { T.ok(false, `${f} exports run(T, ctx)`); continue; }
    console.log(`-- ${name}${mod.pages && !ctx.pages ? ' (PAGES=0: its browser part skipped)' : ''}`);
    try { await mod.run(T, ctx); } catch (e) { T.ok(false, `${name}: ${String(e?.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)}`); }
  }
  T.done();
  process.exit(process.exitCode || 0);
}

// a lane: this suite again in a Node process of its own on those modules (ONLY=), its output split into each module's
// lines (from its '-- name' line on), its own summary line left out
function lane(label, names) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1]], { env: { ...process.env, ONLY: names.join(','), LIVEROOM_LANE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code, signal) => {
      const parts = new Map(), pre = [], lines = out.replace(/\n$/, '').split('\n');
      let at = null, done = false;
      for (const line of lines) {
        const h = /^-- ([a-z0-9-]+)/.exec(line);
        if (h) { at = h[1]; parts.set(at, []); }
        if (new RegExp(`^${label}: \\d+ ok, \\d+ failed$`).test(line)) { done = true; continue; }
        if (at) parts.get(at).push(line);
        else if (line) pre.push(line);
      }
      resolve({ names, parts, pre, done, code, signal });
    });
  });
}
