// The rigs' levels across the amp rebuild: every rig (gear/code.js PLUG_PRESETS) through its whole chain and the
// band's tail, read as tools/guitar-test.js 5 reads it (clawd-o-matic's loudness on the house's DI, muted Chromium).
// The fixture is how loud each rig reads before its amp moves onto the kernel engine; once it has, the rig's MASTER
// (3 dB a step) is moved so it reads that again.
//
//   node tools/amp-rigs.js --fixture              every rig as it plays now -> tools/fixtures/amp-rigs.json
//   node tools/amp-rigs.js <amp ...> [--write]    the rigs on those amps (ids without 'amp.'): now against the
//                                                 fixture; --write moves their MASTER in gear/code.js (to 0.1)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.js';
import { boot } from './guitar-page.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RIG_FIXTURE = path.join(HERE, 'fixtures', 'amp-rigs.json');
const CODE = path.join(HERE, '..', 'app', 'src', 'devices', 'guitar', 'gear', 'code.js');

// render the rigs (ids, or every one) -> { id: { amp, level, lufs } }
export async function measureRigs(amps) {
  const { page, close, errors } = await open('/app/style/tokens.css');
  page.setDefaultTimeout(900000);
  try {
    await boot(page);
    const ids = await page.evaluate((A) => window.__gt.G.RIGS.filter((r) => !A || A.includes(r.amp.slice(4))).map((r) => r.id), amps || null);
    const out = {};
    for (let k = 0; k < ids.length; k += 12) {
      Object.assign(out, await page.evaluate(async (batch) => {
        const { G, render, input, clawdLufs } = window.__gt, o = {};
        for (const id of batch) {
          const r = G.rigById(id), kind = r.bank.id === 'bass' ? 'bass' : 'di', a = r.chain.find((s) => s.device.startsWith('amp.'));
          const y = await render(r.chain, input(kind, 6), { band: true });
          o[id] = { amp: r.amp.slice(4), level: a && a.params.level != null ? a.params.level : null, lufs: Math.round(clawdLufs(y[0], y[1]) * 100) / 100 };
        }
        return o;
      }, ids.slice(k, k + 12)));
    }
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
    return out;
  } finally { await close(); }
}

// move each rig's MASTER in gear/code.js (its preset's knobs.level) to `to` ({ id: level })
export function writeLevels(to) {
  let s = fs.readFileSync(CODE, 'utf8');
  for (const [id, v] of Object.entries(to)) {
    const i = s.indexOf(`{ id: '${id}'`);
    if (i < 0) throw new Error('no preset ' + id);
    const k = s.indexOf('knobs: {', i), e = s.indexOf('}', k), knobs = s.slice(k, e), m = /level: (-?[0-9.]+)/.exec(knobs), val = String(Math.round(v * 10) / 10);
    s = s.slice(0, k) + (m ? knobs.slice(0, m.index) + 'level: ' + val + knobs.slice(m.index + m[0].length) : knobs.trimEnd() + ', level: ' + val + ' ') + s.slice(e);
  }
  fs.writeFileSync(CODE, s);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--fixture')) {
    const rigs = await measureRigs(null);
    fs.writeFileSync(RIG_FIXTURE, JSON.stringify({ made: new Date().toISOString().slice(0, 10), how: 'clawd-o-matic loudness, 6 s of the DI (bass DI for the bass bank) through the whole chain and the band tail', rigs }, null, 0).replace(/\},"/g, '},\n"') + '\n');
    console.log(`${Object.keys(rigs).length} rigs -> ${path.relative(process.cwd(), RIG_FIXTURE)}`);
    return;
  }
  const amps = args.filter((a) => !a.startsWith('--')), fx = JSON.parse(fs.readFileSync(RIG_FIXTURE, 'utf8')).rigs;
  const now = await measureRigs(amps), to = {};
  let worst = 0;
  for (const [id, r] of Object.entries(now)) {
    const was = fx[id];
    if (!was) { console.log(id, 'not in the fixture'); continue; }
    const d = was.lufs - r.lufs, lv = r.level != null ? r.level : 5;
    worst = Math.max(worst, Math.abs(d));
    if (Math.abs(d) >= 0.25) to[id] = Math.max(0, Math.min(10, lv + d / 3));
    console.log(`${id.padEnd(16)} ${('amp.' + r.amp).padEnd(13)} ${r.lufs.toFixed(2)} (was ${was.lufs.toFixed(2)}, ${d >= 0 ? '+' : ''}${(-d).toFixed(2)})${to[id] != null ? `  MASTER ${lv} -> ${Math.round(to[id] * 10) / 10}` : ''}`);
  }
  console.log(`${Object.keys(now).length} rigs, the widest ${worst.toFixed(2)} LU off; ${Object.keys(to).length} to move`);
  if (args.includes('--write') && Object.keys(to).length) { writeLevels(to); console.log('wrote', path.relative(process.cwd(), CODE)); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
