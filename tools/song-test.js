// The demo song end to end: every device it names resolves, it renders offline through the real engine, and the
// mix lands where a finished demo should (measured, not guessed). Also per-track levels, so a mix change is visible.
// A device the song carries (p.devices) resolves as the studio's project load registers it. The render is the canonical one, in Node (renderSong); the studio boots with the demo and autostart in Chromium,
// and raises no errors of its own.
import { open, tally } from './pw.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { measure } from '../app/src/audio/measure.js';
import { demoProject } from '../app/src/core/demo.js';
import { getDevice } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import '../app/src/devices/guitar/index.js';

const t = tally('song');
const p = demoProject();
const missing = [];
for (const tr of p.tracks) {
  if (tr.instrument && !(getDevice(tr.instrument.device) || p.devices?.[tr.instrument.device])) missing.push(tr.instrument.device);
  for (const fx of tr.inserts) if (!(getDevice(fx.device) || p.devices?.[fx.device])) missing.push(fx.device);
}
const t0 = performance.now();
const buf = renderSong(p, { from: 0, to: 32 });
const ms = Math.round(performance.now() - t0);
const mix = measure({ sr: buf.sr, channels: buf.channels });
const tracks = {};
for (const tr of p.tracks) {
  if (!tr.clips.length) continue;
  const b = renderSong(p, { from: 0, to: 32, tracks: [tr.id] });
  const m = measure({ sr: b.sr, channels: b.channels });
  tracks[tr.name] = { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1) };
}
const r = { missing, secs: buf.length / buf.sr, ms, lufs: +mix.lufs.toFixed(1), tp: +mix.truePeak.toFixed(1), lra: +(mix.lra ?? 0).toFixed(1), bands: mix.bands, key: mix.key, tracks };
console.log('  ..   ' + JSON.stringify(r));
t.ok(r.missing.length === 0, 'every device in the demo resolves ' + r.missing.join(', '));
t.ok(r.secs > 20, `renders ${r.secs.toFixed(1)} s in ${r.ms} ms`);
t.ok(r.lufs >= -12 && r.lufs <= -9.5, `the mix is ${r.lufs} LUFS (-12..-9.5)`);
for (const [name, m] of Object.entries(r.tracks)) if (name !== 'Fireflies') t.ok(m.lufs >= -19 && m.lufs <= -13, `${name} sits at ${m.lufs} LUFS (-19..-13)`);
t.ok(r.tp <= -1, `true peak ${r.tp} dBTP <= -1`);
// A minor and C major share every note; either reading (or its alternative) is right
const keys = [r.key, r.key && r.key.alt].filter(Boolean).map((k) => k.root + ' ' + k.scale);
t.ok(keys.some((k) => k === 'A minor' || k === 'C major'), `key reads ${keys.join(' / ')}`);

// the studio boots with the demo and autostart, in Chromium, with no page errors
const { page, errors, close } = await open('/app/', { query: 'demo&autostart' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
t.ok(!errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no page errors ' + errors.slice(0, 3).join(' | '));
await close();
t.done();
