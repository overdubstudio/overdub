// The demo shelf (app/src/core/demos/): every song renders offline through the real engine and lands where a finished
// demo should (measured, not guessed): the master at -11.5..-9.5 LUFS (a genre demo: its genre's targets,
// audio/targets.js), true peak at or under -1 dBTP, every track audible, the lead of each section not buried, and the
// key reading right.
// The documents (valid, seeded, signed, every device resolving, the lanes in range, Studio A played like a drummer, a
// Scribble Strip that moves, a Slide Rule band that works) are test/unit/demos.test.js: they need no render.
// The sound is rendered by the canonical Node renderer (renderSong, as tools/genre-demos-test.js does) wherever it can
// run the song: every device a kernel, its data fetched. A demo that names a pedal or an amp (Web Audio node graphs) or a
// kit that isn't fetched is rendered in the page, the studio's own engine, with the same thresholds; and one Node-able
// demo is rendered in both, so the preview and the canonical render are held to agree (PARITY).
// Screenshots of each in the arranger (1440 wide, one page that visits them all) and of the Song menu's Demos list land
// in tools/.out/.
// (The Node render runs kernels in the Node renderer, not the AudioWorklet. Chromium's worklet runs each registered device
// at its defaults, in tools/sounds-test.js, which only notes the check's warnings; the demos' presets and kits no longer run there.)
// Their devices are the studio's own code: every demo opens with nothing held (devices/trust.js), from the shelf or
// from a link someone else made of it.
import fs from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { open, tally } from './pw.js';
import { DEMOS, demoById } from '../app/src/core/demo.js';
import { encodeShare } from '../app/src/core/share.js';
import { MORE_DEMOS } from '../app/src/core/demos/index.js';
import { dataPath } from '../app/src/engine/node/data.js';
import '../app/src/devices/builtin/index.js';
import '../app/src/devices/library/index.js'; // (the house shelf, claude.*) and the guitar gear: registered as the renderer registers them
import '../app/src/devices/guitar/index.js';
import { getDevice } from '../app/src/devices/registry.js';
import { checkTargets, targetWords } from '../app/src/audio/targets.js';
import { LEADS } from './demo-leads.js';

const t = tally('demos');

const RELATIVE = { 'D major': 'B minor', 'D minor': 'F major', 'E major': 'C# minor', 'G major': 'E minor', 'A minor': 'C major', 'F# minor': 'A major', 'C minor': 'Eb major', 'Eb major': 'C minor', 'Ab major': 'F minor', 'E minor': 'G major', 'B minor': 'D major', 'G minor': 'Bb major', 'F minor': 'Ab major' };
const sharps = (k) => k.replace(/^([A-G])b /, (_, l) => ({ D: 'C#', E: 'D#', G: 'F#', A: 'G#', B: 'A#' }[l] + ' ')); // the key reader names sharps

/* ------------------------------------------------------------------ the sound */
// Can the Node renderer play this song whole? Every device a kernel (no pedal or amp), every kernel data file fetched.
const devicesOf = (p) => [...p.tracks.flatMap((tr) => [tr.instrument?.device, ...tr.inserts.map((x) => x.device)]), ...p.master.inserts.map((x) => x.device)].filter(Boolean);
const nodeRenders = (p) => [...new Set(devicesOf(p))].every((id) => {
  const d = getDevice(id);
  return d && !d.build && d.flavour !== 'graph' && typeof d.kernel === 'string' && Object.values(d.data || {}).every((h) => fs.existsSync(dataPath(h)));
});
const PARITY_LU = 0.1, PARITY_DB = 0.1; // how far the page and Node renders may differ (LU, dB)
const KEEP = ['lufs', 'truePeak', 'lufsShortMax', 'crest', 'lra', 'lowSideDb', 'lowCorrelation', 'bands'];

// The render jobs run on a pool of worker threads (tools/demo-sound-worker.js): a song's mix and each of its stems are
// independent renders, so they spread over the cores; only the numbers come back. The heaviest first.
const WORKERS = Math.max(1, Math.min(8, os.availableParallelism()));
function pool(jobs) {
  const results = new Array(jobs.length);
  let next = 0, live = 0, fail = null;
  return new Promise((resolve, reject) => {
    const workers = [];
    const finish = () => { if (live === 0) { for (const w of workers) w.terminate(); fail ? reject(fail) : resolve(results); } };
    const feed = (w) => {
      if (next >= jobs.length || fail) { live--; finish(); return; }
      const n = next++;
      w.postMessage({ n, ...jobs[n] });
    };
    for (let i = 0; i < Math.min(WORKERS, jobs.length); i++) {
      const w = new Worker(new URL('./demo-sound-worker.js', import.meta.url));
      workers.push(w); live++;
      w.on('message', (m) => { if (m.error) fail = new Error(m.error); else results[m.n] = m.ok; feed(w); });
      w.on('error', (e) => { fail = e; feed(w); });
      feed(w);
    }
  });
}

// What each Node-rendered demo's sound is, from the canonical render: the mix, each track's stem, each lead against the
// others. Same numbers, same shape as the in-page measurement below.
async function soundsInNode(demos) {
  const jobs = [];
  for (const d of demos) {
    const p = demoById(d.id), spb = 60 / p.tempo;
    const sections = Object.keys(LEADS[d.id]).map((sec) => { const s = p.sections.find((x) => x.name === sec); return { sec, from: s.start * spb, to: (s.start + s.length) * spb }; });
    jobs.push({ id: d.id, track: null, sections, weight: p.tracks.length * p.loop.end });
    p.tracks.forEach((_, i) => jobs.push({ id: d.id, track: i, sections, weight: p.loop.end }));
  }
  const order = jobs.map((_, i) => i).sort((a, b) => jobs[b].weight - jobs[a].weight);
  const done = await pool(order.map((i) => ({ id: jobs[i].id, track: jobs[i].track, sections: jobs[i].sections })));
  const got = new Array(jobs.length);
  order.forEach((i, k) => { got[i] = done[k]; });
  const out = new Map();
  let at = 0;
  for (const d of demos) {
    const p = demoById(d.id), { secs, ms, mix } = got[at++];
    const stems = p.tracks.map((tr) => ({ name: tr.name, ...got[at++] }));
    const tracks = {};
    for (const s of stems) tracks[s.name] = { lufs: +s.whole.lufs.toFixed(1), tp: +s.whole.tp.toFixed(1) };
    // in each lead's section: the lead against every other pitched track, by loudness and in the lead's own band
    const lead = [];
    for (const [sec, name] of Object.entries(LEADS[d.id])) {
      const L = stems.find((s) => s.name === name).at[sec];
      const band = Object.entries(L.bands).sort((a, b) => b[1] - a[1])[0][0];
      const others = [];
      for (const s of stems) {
        if (s.name === name || /^(Drums|Bass|808|Hats)$/.test(s.name)) continue; // the rhythm section
        const m = s.at[sec];
        if (m.lufs < -60) continue;
        others.push({ name: s.name, lufs: +m.lufs.toFixed(1), inBand: +(m.rms + m.bands[band]).toFixed(1) });
      }
      lead.push({ sec, name, lufs: +L.lufs.toFixed(1), band, inBand: +(L.rms + L.bands[band]).toFixed(1), others });
    }
    out.set(d.id, { secs, ms, lufs: +mix.lufs.toFixed(1), tp: +mix.truePeak.toFixed(1), key: mix.key, bands: mix.bands, m: Object.fromEntries(KEEP.map((k) => [k, mix[k]])), tracks, lead });
  }
  return out;
}

// The same, in the studio's own engine (the preview): the page loads the demo and renders it.
async function soundInPage(page, d) {
  return page.evaluate(async ({ id, leads }) => {
    const app = window.overdub;
    const { demoById } = await import('/app/src/core/demo.js');
    app.store.load(demoById(id), { by: 'overdub' });
    const p = app.store.get();
    const M = await import('/app/src/audio/measure.js');
    const spb = 60 / p.tempo, end = p.loop.end;
    const t0 = performance.now();
    const buf = await app.engine.render({ from: 0, to: end });
    const ms = performance.now() - t0;
    const mix = M.measure(buf);
    const stems = {};
    for (const tr of p.tracks) stems[tr.name] = await app.engine.render({ from: 0, to: end, tracks: [tr.id] });
    const tracks = {};
    for (const [name, b] of Object.entries(stems)) { const m = M.measure(b); tracks[name] = { lufs: +m.lufs.toFixed(1), tp: +m.truePeak.toFixed(1) }; }
    // in each lead's section: the lead against every other pitched track, by loudness and in the lead's own band
    const lead = [];
    for (const [sec, name] of Object.entries(leads)) {
      const s = p.sections.find((x) => x.name === sec);
      const at = { from: s.start * spb, to: (s.start + s.length) * spb };
      const L = M.measure(stems[name], at);
      const band = Object.entries(L.bands).sort((a, b) => b[1] - a[1])[0][0];
      const others = [];
      for (const tr of p.tracks) {
        if (tr.name === name || /^(Drums|Bass|808|Hats)$/.test(tr.name)) continue; // the rhythm section
        const m = M.measure(stems[tr.name], at);
        if (m.lufs < -60) continue;
        others.push({ name: tr.name, lufs: +m.lufs.toFixed(1), inBand: +(m.rms + m.bands[band]).toFixed(1) });
      }
      lead.push({ sec, name, lufs: +L.lufs.toFixed(1), band, inBand: +(L.rms + L.bands[band]).toFixed(1), others });
    }
    const keep = ['lufs', 'truePeak', 'lufsShortMax', 'crest', 'lra', 'lowSideDb', 'lowCorrelation', 'bands'];
    return { secs: +buf.duration.toFixed(1), ms: Math.round(ms), lufs: +mix.lufs.toFixed(1), tp: +mix.truePeak.toFixed(1), key: mix.key, bands: mix.bands, m: Object.fromEntries(keep.map((k) => [k, mix[k]])), tracks, lead };
  }, { id: d.id, leads: LEADS[d.id] });
}

// What a finished demo sounds like, held the same wherever it was rendered (`how` names the renderer in the messages)
function holdSound(d, r, how) {
  t.note(`${d.title} (${how}): ${JSON.stringify({ lufs: r.lufs, tp: r.tp, key: r.key && `${r.key.root} ${r.key.scale}`, tracks: r.tracks })}`);
  t.ok(r.secs > 20, `${d.title}: renders ${r.secs} s in ${r.ms} ms (${how})`);
  t.ok(r.tp <= -1, `${d.title}: true peak ${r.tp} dBTP <= -1`);
  if (d.targets) {
    // a genre demo is mastered as its genre is (bass music at -8 to -6 LUFS, metal at -9 to -7), so it is held to the
    // genre's whole-song targets here (tools/genre-demos-test.js holds the canonical Node render and each drop); every
    // track audible and none louder than the mix
    const rows = checkTargets(r.m, d.targets, { window: 'song' }), miss = rows.filter((x) => !x.ok);
    t.ok(!miss.length, `${d.title}: the ${d.targets} targets: ${(miss.length ? miss : rows).map(targetWords).join('; ')}`);
    for (const [name, m] of Object.entries(r.tracks)) t.ok(m.lufs >= r.lufs - 16 && m.lufs <= r.lufs + 0.5, `${d.title}: ${name} sits at ${m.lufs} LUFS (the mix ${r.lufs}: within 16 LU under it)`);
  } else {
    t.ok(r.lufs >= -11.5 && r.lufs <= -9.5, `${d.title}: the mix is ${r.lufs} LUFS (-11.5..-9.5)`);
    // the balance: no band holds much over half the energy (the shelf peaks at -2.5, sub), and the top end stays a top end
    const top = Math.max(...Object.values(r.bands)), highs = Math.max(r.bands.highmid, r.bands.presence, r.bands.air);
    t.ok(top <= -2 && highs <= -13, `${d.title}: no band dominates (loudest ${top} dB of the energy, the highs at most ${highs} dB)`);
    for (const [name, m] of Object.entries(r.tracks)) t.ok(m.lufs >= -19.5 && m.lufs <= -12.5, `${d.title}: ${name} sits at ${m.lufs} LUFS (-19.5..-12.5)`);
  }
  for (const l of r.lead) {
    const loud = Math.max(...l.others.map((o) => o.lufs)), band = Math.max(...l.others.map((o) => o.inBand));
    t.ok(l.lufs >= loud - 1.5 && l.inBand >= band - 3, `${d.title}: in the ${l.sec}, ${l.name} leads (${l.lufs} LUFS vs ${loud}; ${l.inBand} dB vs ${band} in its ${l.band} band)`);
  }
  const want = [d.key, RELATIVE[d.key]].map(sharps);
  const read = [r.key, r.key && r.key.alt].filter(Boolean).map((k) => `${k.root} ${k.scale}`);
  // (high-gain power chords carry no third, and a distorted fifth's harmonics outweigh the root's: the key reader
  // hears a metal riff in C as G minor or Bb major. Noted for a metal demo, not held)
  if (d.targets === 'metal') t.note(`${d.title}: key reads ${read.join(' / ')} (written in ${d.key}; power chords)`);
  else t.ok(want.includes(read[0]), `${d.title}: key reads ${read.join(' / ')} (${want.join(' or ')})`);
}

const inNode = MORE_DEMOS.filter((d) => nodeRenders(d.make()));
const PARITY = inNode[0]; // rendered in the page as well, and the two held together
const inPage = MORE_DEMOS.filter((d) => !inNode.includes(d));
t.ok(inNode.length > 0, `${inNode.length} of ${MORE_DEMOS.length} demos render in Node (${inNode.map((d) => d.id).join(', ')}); in the page: ${inPage.map((d) => d.id).join(', ') || 'none'}`);

const nodeSounds = soundsInNode(inNode); // (rendering on the worker threads while the page does its own)
nodeSounds.catch(() => {});

const { page, errors, close } = await open('/app/', { query: 'new&autostart' });
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
for (const d of inPage) holdSound(d, await soundInPage(page, d), 'page');
// the preview and the canonical render agree on a demo's loudness, peak, key and every stem
if (PARITY) {
  const a = (await nodeSounds).get(PARITY.id), b = await soundInPage(page, PARITY);
  const dl = Math.abs(a.lufs - b.lufs), dt = Math.abs(a.tp - b.tp);
  const stems = Object.keys(a.tracks).map((n) => Math.abs(a.tracks[n].lufs - (b.tracks[n]?.lufs ?? Infinity)));
  t.ok(dl <= PARITY_LU && dt <= PARITY_DB && Math.max(...stems) <= PARITY_LU && a.key?.root === b.key?.root && a.key?.scale === b.key?.scale,
    `${PARITY.title}: the page and Node render agree (mix ${b.lufs} vs ${a.lufs} LUFS, peak ${b.tp} vs ${a.tp} dBTP, stems within ${Math.max(...stems).toFixed(2)} LU, key ${b.key?.root} ${b.key?.scale} vs ${a.key?.root} ${a.key?.scale})`);
}
t.ok(!errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no page errors while rendering ' + errors.slice(0, 3).join(' | '));
for (const d of inNode) holdSound(d, (await nodeSounds).get(d.id), 'Node');
await close();

/* ------------------------------------------------------------------ how they look */
// one page visits every demo by its link
{
  const o = await open('/app/', { query: 'new' });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  for (const d of MORE_DEMOS) {
    const seen = o.errors.length;
    await o.page.goto(`${o.base}/app/?demo=${d.id}`, { waitUntil: 'load' });
    await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await o.page.evaluate(() => window.overdub.welcome?.close());
    await o.page.click('button[title="Fit the whole song in view"]');
    await o.page.waitForTimeout(700);
    const title = await o.page.evaluate(() => window.overdub.store.get().title);
    t.ok(title === d.title, `/app/?demo=${d.id} opens “${title}”`);
    await o.shot(`demos-${d.id}`);
    const errs = o.errors.slice(seen).filter((e) => !/Failed to load resource/.test(e));
    t.ok(!errs.length, `${d.title}: no page errors in the studio ` + errs.slice(0, 3).join(' | '));
  }
  await o.close();
}

// Nothing a demo brings is held: Night Shift's three devices and any other demo's are the studio's own code, so they
// play without asking, opened from the shelf (?demo= and the Song menu) or from a link someone else made of the demo
{
  const o = await open('/app/', { query: 'demo=night-shift' });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const first = await o.page.evaluate(() => ({ title: window.overdub.store.get().title, held: window.overdub.trust ? window.overdub.trust.held().length : null, devices: Object.keys(window.overdub.store.get().devices || {}).length, ask: !!document.querySelector('.sh-held') }));
  const links = {};
  for (const d of DEMOS) links[d.id] = (await encodeShare(demoById(d.id), { from: { name: 'Sam' } })).hash;
  const r = await o.page.evaluate(async (links) => {
    const app = window.overdub, out = [];
    const held = () => (app.trust ? app.trust.held().map((d) => d.id) : null);
    for (const [id, hash] of Object.entries(links)) {
      await app.exporter.openDemo(id);
      const shelf = { held: held(), devices: Object.keys(app.store.get().devices || {}).length, ask: !!document.querySelector('.sh-held') };
      await app.share.open(hash);
      const link = { held: held(), listening: app.share.listening, ask: !!document.querySelector('.sh-held'), playing: Object.keys(app.store.get().devices || {}).filter((d) => app.devices.getDevice(d)?.source === 'project').length };
      out.push({ id, shelf, link });
    }
    return out;
  }, links);
  const bad = r.filter((x) => !Array.isArray(x.shelf.held) || x.shelf.held.length || x.shelf.ask || !Array.isArray(x.link.held) || x.link.held.length || x.link.ask || !x.link.listening || x.link.playing !== x.shelf.devices);
  const errs = o.errors.filter((e) => !/Failed to load resource/.test(e));
  t.ok(first.title === 'Night Shift' && first.held === 0 && first.devices === 3 && !first.ask && r.length === DEMOS.length && !bad.length && !errs.length,
    `every shipped demo opens with nothing held (Night Shift's ${first.devices} devices play from ?demo=, the Song menu and someone else's link; so do all ${DEMOS.length} demos' ${r.reduce((n, x) => n + x.shelf.devices, 0)})${bad.length ? `: ${JSON.stringify(bad[0])}` : ''}; no page errors ${errs.slice(0, 3).join(' | ')}`);
  await o.close();
}

// the Song menu: Demos opens a list; picking one (and saying yes) replaces the song (and Undo is offered)
{
  const o = await open('/app/', { query: 'new' });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await o.page.click('.sm-btn');
  await o.page.click('.sm-more');
  const items = await o.page.$$eval('.sm-demos .sm-i b', (els) => els.map((e) => e.textContent));
  t.ok(DEMOS.every((d) => items.includes(d.title)), 'the Demos list names every demo: ' + items.join(', '));
  await o.shot('demos-menu');
  await o.page.click(`.sm-demos .sm-i:has-text("${MORE_DEMOS[2].title}")`);
  await o.page.click('.sm-confirm .ew-btn-primary');   // (it asks first, the way New song does: ui/export.js)
  await o.page.waitForFunction((title) => window.overdub.store.get().title === title, MORE_DEMOS[2].title, { timeout: 5000 }).catch(() => {});
  const now = await o.page.evaluate(() => window.overdub.store.get().title);
  t.ok(now === MORE_DEMOS[2].title, `picking “${MORE_DEMOS[2].title}” opens it (now “${now}”)`);
  t.ok(!o.errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no page errors in the menu ' + o.errors.slice(0, 3).join(' | '));
  await o.close();
}
t.done();
