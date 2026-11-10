// The live room's runner [liveroom] (docs/research/LIVE-ROOM-MODE.md §11) over tools/liveroom/checks-*.js. Each checks
// module exports
//   name                 its name, for ONLY= (checks-band.js: 'band')
//   pages                whether run() opens a browser when ctx.pages lets it (muted headless Chromium, tools/pw.js)
//   run(T, ctx)          its checks, on the suite's one tally (T.ok(cond, line), T.note(line)); ctx: { pages (false
//                        under PAGES=0: open nothing), levels (false under LEVELS=0: skip the slow renders), out (where
//                        its screenshots and fakes go: tools/.out/liveroom) }
// They run in ORDER, then any others by name; one that fails to load or throws is a FAIL line and the rest still run.
// A stream adds its checks to its own checks-*.js, which the runner finds by name.
//
// Three suites run them, so tools/run-all.js can run the parts side by side: tools/liveroom-stage-test.js and
// tools/liveroom-band-test.js the modules PARTS names, and tools/liveroom-test.js every other, a new one included. The
// modules share nothing (their fakes and shots are named for them), and PARTS balances their time.
//
//   node tools/run-all.js liveroom                 every check, the three suites three at a time
//   node tools/liveroom-test.js                    that suite's modules
//   ONLY=model,band node tools/liveroom-test.js    some, by name, whichever suite has them (any of the three takes ONLY)
//   PAGES=0                                        no browser: the Node checks only
//   LEVELS=0                                       no level renders
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, OUTDIR } from '../pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['model', 'input', 'band', 'pixels', 'stage', 'glass', 'kitchen', 'door', 'shelf', 'copy'];
export const PARTS = { 'liveroom-stage': ['stage', 'takes', 'room'], 'liveroom-band': ['band', 'rig', 'shop', 'drummer', 'guitar'] };

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

  for (const f of files) {
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
