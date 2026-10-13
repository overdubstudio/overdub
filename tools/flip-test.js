// Flip a song (spec 0014 sections D-F, R8, R24-R28, R33), in the studio: the door's fourth row, the file picker with
// one file or the stems, the one undo step, the split on a fake runner (jobs/fake.js: nothing is ever downloaded), the
// progress line, the analysis landing by the house, the readings step, the arranger and the tempo readout on the map,
// a whole-bar drag carrying the map, and Export release. The songs are our own signal, made here by tools/fake-song.js
// and written under tools/.out/flip/ (never committed). Chromium is quiet (tools/pw.js QUIET); screenshots land in
// tools/.out/.
//
//   node tools/flip-test.js
import { open, tally, OUTDIR } from './pw.js';
import { fakeSong, writeWav } from './fake-wav.js';
import path from 'node:path';
import fs from 'node:fs';

const t = tally('flip');
const DIR = path.join(OUTDIR, 'flip');
const E = (page, f, a) => page.evaluate(f, a);
const real = (errs) => errs.filter((e) => !/status of 404 .*kits|Failed to load resource: the server responded with a status of 404/.test(e));
const FORM = [['Intro', 2], ['Verse', 4], ['Chorus', 4], ['Verse', 4], ['Chorus', 4], ['Outro', 2]];

// the song: a band at 96 drifting a little, its four stems, and the mix that is their sum
const song = fakeSong({ seed: 4, bpm: 96, drift: 'live', sr: 44100, form: FORM });
const FILES = { mix: 'Night Bus.wav', vocals: 'Night Bus (vocals).wav', drums: 'Night Bus (drums).wav', bass: 'Night Bus (bass).wav', other: 'Night Bus (other).wav' };
fs.mkdirSync(DIR, { recursive: true });
writeWav(path.join(DIR, FILES.mix), song.mix, song.sr);
for (const k of ['vocals', 'drums', 'bass', 'other']) writeWav(path.join(DIR, FILES[k]), song.stems[k], song.sr);
const file = (k) => path.join(DIR, FILES[k]);

// (Flip a song is behind workflow.flip and the local runner behind stems.local: on here, by ?on=, except where a check
// says off)
const ON = 'new&on=workflow.flip,stems.local';
async function blank(opts = {}) {
  const o = await open('/app/', { query: ON, ...opts });
  await o.page.route('**/__flip/*', (route) => {
    const name = decodeURIComponent(route.request().url().split('/__flip/')[1]);
    route.fulfill({ status: 200, contentType: 'audio/wav', body: fs.readFileSync(path.join(DIR, name)) });
  });
  await o.page.waitForSelector('html[data-ready="1"]', { timeout: 45000 });
  await o.page.waitForTimeout(400);
  return o;
}
// the fake runner, taught this song: the mix as the page decodes it, and its stems
async function fakeJobs(page, timings = { device: 'gpu', msPerSegment: 700 }, stepMs = 500) {
  return E(page, async ([files, timings, stepMs]) => {
    const app = window.overdub;
    // (the studio decodes at its audio context's rate: start it first, so the fake hears the input the flip will send)
    try { await app.engine.start(); } catch { /* a silent engine decodes at 48 kHz either way */ }
    const { createJobs } = await import('/app/src/jobs/index.js');
    const { createFakeRunner } = await import('/app/src/jobs/fake.js');
    const dec = async (n) => app.importers.decodeAudio(await (await fetch('/__flip/' + encodeURIComponent(n))).arrayBuffer());
    const ch = (b) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
    const mix = await dec(files.mix);
    const stems = {};
    for (const k of ['vocals', 'drums', 'bass', 'other']) stems[k] = ch(await dec(files[k]));
    const runner = createFakeRunner({ known: [{ input: { sr: mix.sampleRate, channels: ch(mix) }, stems }], steps: 5, stepMs, timings });
    window.__fake = runner;
    app.flip.useJobs(createJobs({ runners: { stems: runner }, cache: null }));
    return true;
  }, [FILES, timings, stepMs]);
}
async function pickFiles(page, paths) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.st-way-b[data-way="Flip a song"]')]);
  t.ok(fc.isMultiple(), 'the picker takes one file or several');
  await fc.setFiles(paths);
}
const state = (page) => E(page, () => {
  const app = window.overdub, p = app.store.get();
  return {
    title: p.title, tempo: p.tempo, key: p.key, map: p.tempoMap || null, sections: p.sections.map((s) => ({ name: s.name, start: s.start, length: s.length, key: s.key || null })),
    hist: app.store.history.map((x) => ({ label: x.label, by: x.by })),
    tracks: p.tracks.map((tr) => ({ id: tr.id, name: tr.name, kind: tr.kind, mute: !!tr.mute, by: tr.by, clips: tr.clips.map((c) => ({ id: c.id, start: c.start, length: c.length, offset: c.offset, asset: c.asset, by: c.by, notes: c.notes ? c.notes.length : 0 })) })),
    assets: Object.keys(p.assets || {}).length,
  };
});
const idle = (page) => E(page, () => window.overdub.flip.idle());
// the readings step opens by itself when the analysis is unsure: close it (Back: nothing was picked, nothing changes)
async function settle(page) {
  await page.waitForFunction(() => window.overdub.store.history.length >= 1 && window.overdub.flip.last(), null, { timeout: 15000 });
  await idle(page);
  await page.waitForTimeout(150);
  const open = await E(page, () => window.overdub.start.step);
  if (open === 'choose') { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
  return open === 'choose';
}

/* ================================================================ one file, the split on the graphics card */
{
  console.log('\none file, split on the fake runner');
  const o = await blank();
  const { page } = o;
  try {
    const ways = await E(page, () => [...document.querySelectorAll('.st-door .st-way-b')].map((b) => b.textContent.trim()));
    t.ok(ways.join() === 'Tap a beat,Hum a tune,Play the keys,Flip a song', `the door has four rows, Flip a song last (${ways.join(' · ')})`);
    await page.screenshot({ path: path.join(OUTDIR, 'flip-door.png') });
    await fakeJobs(page);
    await pickFiles(page, [file('mix')]);
    await page.waitForFunction(() => window.overdub.store.history.length >= 1, null, { timeout: 15000 });
    const s0 = await state(page);
    t.ok(s0.hist[0]?.label === 'Flip: Night Bus' && s0.hist[0]?.by === 'you' && s0.title === 'Night Bus', `the import is one step, "${s0.hist[0]?.label}", by ${s0.hist[0]?.by}; the song is "${s0.title}"`);
    t.ok(s0.tracks.length === 1 && s0.tracks[0].name === 'Original' && !s0.tracks[0].mute && s0.tracks[0].clips[0].offset === 0, 'the original on a track named Original, playing until the stems arrive, offset 0');
    // the progress line: the split's percent and its estimate, at the foot of the arranger; nothing modal
    await page.waitForFunction(() => /^Splitting… [1-9]\d*%/.test(document.querySelector('.ar-job:not([hidden]) .ar-job-t')?.textContent || ''), null, { timeout: 15000 });
    const mid = await E(page, () => {
      const app = window.overdub, ln = document.querySelector('.ar-job');
      app.engine.play(0);
      const playing = app.engine.playing || app.engine.starting;
      const r = app.store.dispatch({ type: 'section.add', section: { name: 'Mine', start: 0, length: 4 } }, { by: 'you', label: 'a section while it splits' });
      app.store.undo();
      app.engine.stop();
      return { text: ln.querySelector('.ar-job-t').textContent, acts: [...ln.querySelectorAll('button')].map((b) => b.textContent), stage: !!document.querySelector('.st-stage'), playing, edit: r.ok, fill: ln.querySelector('.ar-job-fill').style.width };
    });
    t.ok(/About \d+ s on this computer's graphics card\./.test(mid.text) && mid.acts.join() === 'Cancel' && mid.fill !== '0', `one progress line: "${mid.text}" (${mid.acts.join()}, the hairline at ${mid.fill})`);
    t.ok(!mid.stage && mid.playing && mid.edit, 'nothing blocks: no stage over the song, it plays, and an edit goes in while it splits');
    await page.screenshot({ path: path.join(OUTDIR, 'flip-splitting.png') });
    const unsure = await settle(page);
    const s1 = await state(page);
    const labels = s1.hist.map((x) => `${x.label} (${x.by})`);
    t.ok(labels.join(' | ') === 'Flip: Night Bus (you) | Stems from Night Bus (overdub) | Grid, key and sections from Night Bus (overdub)', `three steps: ${labels.join(' | ')}`);
    const names = s1.tracks.map((x) => `${x.name}${x.mute ? ' (muted)' : ''}`);
    t.ok(names.join() === 'Original (muted),Vocals,Drums (muted),Bass (muted),Other (muted),Chords (muted)', `the vocal plays; the rest on hand, muted: ${names.join(', ')}`);
    const audio = s1.tracks.filter((x) => x.kind === 'audio').map((x) => x.clips[0]);
    const orig = s1.tracks.find((x) => x.name === 'Original').clips[0];
    t.ok(s1.map && s1.map.clip === orig.id && s1.map.anchors.length > 10 && audio.every((c) => Math.abs(c.start - s1.map.clipStart) < 1e-9 && c.offset === 0), `the grid follows the Original (${s1.map?.anchors.length} anchors), every clip at beat ${s1.map?.clipStart?.toFixed(3)}, offset 0`);
    t.ok(Math.abs(s1.tempo - 96) < 2 && s1.key && s1.sections.length >= 4, `nominal ${s1.tempo} BPM (the band plays 96), key ${s1.key?.root} ${s1.key?.scale}, ${s1.sections.length} sections: ${s1.sections.map((x) => x.name + (x.key ? ` (${x.key})` : '')).join(', ')}`);
    t.ok(s1.assets === 5 && s1.tracks.filter((x) => x.kind === 'audio').every((x) => x.by === (x.name === 'Original' ? 'you' : 'overdub')), 'the stems are assets in the song, signed by the house; the original by you');
    const calls = await E(page, () => window.__fake.calls);
    t.ok(calls === 1, `the runner ran once (${calls})`);
    const ui1 = await E(page, () => ({ lab: document.querySelector('.tp-tempo .tp-lab')?.textContent, num: document.querySelector('.tp-tempo-num')?.textContent, line: !document.querySelector('.ar-job')?.hidden, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).find((x) => /^Flip: Night Bus is in/.test(x)) || '' }));
    t.ok(ui1.lab === 'Tempo, follows Original' && /^\d+\.\d$/.test(ui1.num || ''), `the tempo readout: "${ui1.lab}" over ${ui1.num}`);
    t.ok(/^Flip: Night Bus is in\. Grid follows the recording, \d+\.\d BPM(, drifting [\d.]+–[\d.]+)?\. Key [A-G][#b]? (major|minor)\. \d+ sections\./.test(ui1.toast) && !ui1.line, `the toast says what landed: "${ui1.toast.replace(/Other readings$/, '')}"; the line is gone`);
    t.note(`the analysis was ${unsure ? 'unsure: the readings step opened by itself' : 'sure: no readings step'}`);
    // a tempo is refused on the map, said where the tempo is
    const refused = await E(page, () => { document.querySelector('.tp-tempo').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); return { tempo: window.overdub.store.get().tempo, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ') }; });
    t.ok(refused.tempo === s1.tempo && /The grid follows Original\. Clear the map to set a tempo\./.test(refused.toast), 'the readout won\'t take a tempo on a map, and says why');
    // get_project's line
    const gp = await E(page, () => window.overdub.summarize({ detail: 'summary' }).split('\n').slice(0, 3).join('\n'));
    t.ok(/Grid follows Original: \d+(\.\d+)? BPM nominal/.test(gp) && /; key [A-G]/.test(gp), `get_project: "${gp.split('\n')[1]?.slice(0, 110)}…"`);
    await E(page, () => window.overdub.arranger.fitSong?.());
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUTDIR, 'flip-landed.png') });

    // a whole-bar drag of the Original carries the grid with it (one undo step); half a bar leaves it, and get_project
    // says how far off the recording sits
    const drag = async (beats) => {
      const at = await E(page, ([id, track, b]) => { const a = window.overdub.arranger, c = window.overdub.store.findClip(id).clip; return { x0: a.xOf(c.start + 1), x1: a.xOf(c.start + 1 + b), y: a.yOf(track) }; }, [orig.id, s1.tracks[0].id, beats]);
      await page.mouse.move(at.x0, at.y + 6); await page.mouse.down();
      for (let k = 1; k <= 8; k++) await page.mouse.move(at.x0 + ((at.x1 - at.x0) * k) / 8, at.y + 6);
      await page.mouse.up();
      await page.waitForTimeout(150);
    };
    await E(page, () => { window.overdub.ui.state.snap = 4; });
    const h0 = s1.hist.length;
    await drag(4);
    const s2 = await state(page);
    const o2 = s2.tracks.find((x) => x.name === 'Original').clips[0];
    const shifted = s2.map && s2.map.anchors.length >= s1.map.anchors.length && Math.abs(s2.map.clipStart - (s1.map.clipStart + 4)) < 1e-6 && Math.abs(o2.start - (orig.start + 4)) < 1e-6;
    const line2 = await E(page, () => window.overdub.summarize({ detail: 'summary' }).split('\n')[1]);
    t.ok(shifted && s2.hist.length === h0 + 1 && !/off its grid/.test(line2), `a bar's drag moves the Original and its grid in one step (clipStart ${s1.map.clipStart?.toFixed(3)} → ${s2.map?.clipStart?.toFixed(3)}, "${s2.hist[s2.hist.length - 1]?.label}")`);
    await E(page, () => window.overdub.store.undo());
    await E(page, () => { window.overdub.ui.state.snap = 1; });
    await drag(2);
    const s3 = await state(page);
    const line3 = await E(page, () => window.overdub.summarize({ detail: 'summary' }).split('\n')[1]);
    t.ok(JSON.stringify(s3.map.anchors) === JSON.stringify(s1.map.anchors) && /Original is off its grid by \d+ ms/.test(line3), `half a bar leaves the grid where it was, and get_project says so ("${(line3.match(/Original is off its grid by \d+ ms/) || [''])[0]}")`);
    await E(page, () => window.overdub.store.undo());

    // the readings (R27): the found grid, double, half, the other downbeat; each plays with the click; Back puts the
    // found one back; Use this one keeps the pick, one step by you
    const before = await state(page);
    const click0 = await E(page, () => window.overdub.engine.metronome);
    await E(page, () => window.overdub.flip.readings());
    await page.waitForTimeout(200);
    const rd = await E(page, () => ({ step: window.overdub.start.step, title: document.querySelector('.st-stage .st-title')?.textContent, run: document.querySelector('.st-stage .st-run')?.textContent, rows: [...document.querySelectorAll('.st-stage .st-reading')].map((x) => x.textContent), click: window.overdub.engine.metronome, playing: window.overdub.engine.playing || window.overdub.engine.starting, n: window.overdub.flip.last().result.readings.length }));
    t.ok(rd.step === 'choose' && rd.run === 'Flip a song' && rd.title === 'Which one nods along with the vocal?' && rd.rows.length === rd.n && rd.n >= 3 && /twice as fast/.test(rd.rows.join()) && /half as fast/.test(rd.rows.join()), `the readings step: "${rd.title}" (${rd.rows.map((x) => x.replace(/hearing$/, '')).join(' / ')})`);
    t.ok(rd.click && rd.playing, 'it plays the recording with the click on');
    await page.screenshot({ path: path.join(OUTDIR, 'flip-readings.png') });
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const picked = await state(page);
    t.ok(picked.hist.length === before.hist.length + 1 && picked.hist[picked.hist.length - 1].by === 'you' && JSON.stringify(picked.map.anchors) !== JSON.stringify(before.map.anchors), `two picks are one step by you ("${picked.hist[picked.hist.length - 1].label}", ${picked.tempo} BPM)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const back = await state(page);
    const click1 = await E(page, () => window.overdub.engine.metronome);
    t.ok(back.hist.length === before.hist.length && JSON.stringify(back.map) === JSON.stringify(before.map) && click1 === click0, 'Back (Esc) puts the found grid back, takes the step out and the click as it was');
    await E(page, () => window.overdub.flip.readings());
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const dbl = await E(page, () => window.overdub.flip.last().result.readings[1]);
    await page.click('.st-stage .st-use');
    await page.waitForTimeout(150);
    const used = await state(page);
    const lenOk = used.tracks.filter((x) => x.kind === 'audio').every((x) => x.clips[0].length > 0 && Math.abs(x.clips[0].start - dbl.start) < 1e-9);
    t.ok(used.hist.length === before.hist.length + 1 && Math.abs(used.tempo - dbl.tempo) < 0.01 && used.map.anchors.length === dbl.anchors.length && lenOk && !(await E(page, () => window.overdub.start.step)), `Use this one keeps it: ${used.tempo} BPM (${dbl.id}), the clips placed on it, the stage closed`);
    await E(page, () => { window.overdub.engine.stop(); window.overdub.store.undo(); });

    // Export release (R33): from the first sound to the tail, muted tracks out, measured in the toast
    const rel = await E(page, async () => {
      const app = window.overdub, p = app.store.get();
      const { releaseTrim } = await import('/app/src/ui/export.js');
      const { lufs } = await import('/app/src/audio/measure.js');
      const wav = await app.exporter.exportRelease();
      const r = app.exporter.lastRelease();
      const vox = p.tracks.find((x) => x.name === 'Vocals').id;
      const only = releaseTrim(await app.engine.render({ sr: 48000, tail: 6, tracks: [vox] }));
      const all = await app.engine.render({ sr: 48000, tail: 6 });
      return { bytes: wav ? wav.length : 0, r, voxLufs: lufs(only), toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).find((x) => /^Release:/.test(x)) || '', allSec: all.length / 48000 };
    });
    t.ok(rel.bytes > 44 && /^Release: \d+:\d\d, −?\d+\.\d LUFS, peak −?\d+\.\d dBTP\. Night Bus \(release\)\.wav, 24-bit, 48 kHz\./.test(rel.toast), `the toast: "${rel.toast}"`);
    t.ok(Math.abs(rel.r.lufs - rel.voxLufs) < 0.1 && rel.r.seconds < rel.allSec, `muted tracks are left out: the release reads ${rel.r.lufs.toFixed(2)} LUFS, the vocal alone ${rel.voxLufs.toFixed(2)}; ${rel.r.seconds.toFixed(1)} s from the first sound (the render is ${rel.allSec.toFixed(1)} s)`);
    await page.screenshot({ path: path.join(OUTDIR, 'flip-release.png') });
    t.ok(!real(o.errors).length, `no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'one file threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ the stems brought as files, the runner off */
{
  console.log('\nbring your own stems (no runner on this site)');
  const o = await blank();
  const { page } = o;
  try {
    await pickFiles(page, [file('drums'), file('vocals'), file('mix'), file('other'), file('bass')]);
    await page.waitForFunction(() => window.overdub.store.history.length >= 1, null, { timeout: 15000 });
    const s0 = await state(page);
    t.ok(s0.hist.length === 1 && s0.hist[0].label === 'Flip: Night Bus' && s0.tracks.map((x) => `${x.name}${x.mute ? '-' : '+'}`).join() === 'Original-,Vocals+,Drums-,Bass-,Other-', `five files, one step: ${s0.tracks.map((x) => `${x.name}${x.mute ? ' (muted)' : ''}`).join(', ')}`);
    await settle(page);
    const s1 = await state(page);
    t.ok(s1.hist.map((x) => x.label).join(' | ') === 'Flip: Night Bus | Grid, key and sections from Night Bus' && s1.map && s1.tracks.filter((x) => x.kind === 'audio').every((x) => Math.abs(x.clips[0].start - s1.map.clipStart) < 1e-9), `no split (the stems came as files); the grid lands on all five clips (${s1.hist.length} steps)`);
    const off = await E(page, async () => { const { pageJobs } = await import('/app/src/jobs/index.js'); const j = await pageJobs(); return j.runner('stems').available; });
    t.ok(off === false, 'with no stems entry in the site config the runner is off');
    t.ok(!real(o.errors).length, `no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'stems threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ no WebGPU: the processor's wait is asked; Cancel */
{
  console.log('\nno WebGPU: asked first; Cancel stops it');
  const o = await blank();
  const { page } = o;
  try {
    await fakeJobs(page, { device: 'cpu', msPerSegment: null }, 800);
    await pickFiles(page, [file('mix')]);
    await page.waitForFunction(() => document.querySelectorAll('.ar-job:not([hidden]) button').length === 2, null, { timeout: 15000 });
    const ask = await E(page, () => ({ text: document.querySelector('.ar-job-t').textContent, acts: [...document.querySelectorAll('.ar-job button')].map((b) => b.textContent) }));
    t.ok(/^Split it into stems\? Roughly \d+ (s|min) on this computer's processor\. No WebGPU here, so the processor does the work\./.test(ask.text) && ask.acts.join() === 'Split on the processor,Skip the split', `it says the wait and asks: "${ask.text}" (${ask.acts.join(' / ')})`);
    await page.screenshot({ path: path.join(OUTDIR, 'flip-ask.png') });
    await page.click('.ar-job button.ar-job-go');
    await page.waitForFunction(() => /^Splitting…/.test(document.querySelector('.ar-job-t')?.textContent || ''), null, { timeout: 10000 });
    await page.click('.ar-job button');
    await page.waitForTimeout(300);
    await idle(page);
    const s = await state(page);
    const toast = await E(page, () => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | '));
    t.ok(s.hist.length === 1 && !s.map && s.tracks.length === 1 && /Stopped the split\. What landed stays/.test(toast) && (await E(page, () => document.querySelector('.ar-job').hidden)), `Cancel stops the split: the import stays, nothing else lands (${s.hist.length} step)`);
    // a second flip of the same song, skipping the split: the grid is read from the mix
    await E(page, () => window.overdub.store.undo());
    await page.waitForTimeout(200);
    await pickFiles(page, [file('mix')]);
    await page.waitForFunction(() => document.querySelectorAll('.ar-job:not([hidden]) button').length === 2, null, { timeout: 15000 });
    await page.click('.ar-job button:not(.ar-job-go)');
    await settle(page);
    const s2 = await state(page);
    t.ok(s2.hist.map((x) => x.label).join(' | ') === 'Flip: Night Bus | Grid, key and sections from Night Bus' && s2.tracks.find((x) => x.name === 'Original') && !s2.tracks.find((x) => x.name === 'Original').mute, 'Skip the split: the grid is read from the recording, which keeps playing');
    t.ok(!real(o.errors).length, `no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'no WebGPU threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ a phone */
{
  console.log('\na phone (390 × 844)');
  const o = await blank({ width: 390, height: 844 });
  const { page } = o;
  try {
    const w0 = await E(page, () => document.documentElement.scrollWidth);
    await pickFiles(page, [file('mix'), file('vocals')]);
    await settle(page);
    await page.waitForTimeout(200);
    const s = await state(page);
    const w1 = await E(page, () => document.documentElement.scrollWidth);
    await page.screenshot({ path: path.join(OUTDIR, 'flip-phone.png') });
    t.ok(w0 <= 390 && w1 <= 390 && s.map && s.tracks.length >= 2, `390 px: the door and the flipped song scroll no sideways (${w0}, ${w1}; ${s.hist.map((x) => x.label).join(' | ')})`);
    await E(page, () => window.overdub.flip.readings());
    await page.waitForTimeout(200);
    const rd = await E(page, () => ({ sw: document.documentElement.scrollWidth, use: document.querySelector('.st-use')?.getBoundingClientRect(), vh: innerHeight }));
    await page.screenshot({ path: path.join(OUTDIR, 'flip-phone-readings.png') });
    t.ok(rd.sw <= 390 && rd.use && rd.use.bottom <= rd.vh && rd.use.height >= 44, `the readings fit the phone, Use this one ${Math.round(rd.use?.height || 0)} px tall inside the screen`);
    await page.keyboard.press('Escape');
    t.ok(!real(o.errors).length, `phone: no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'phone threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

/* ================================================================ off: workflow.flip and stems.local (the default) */
// Off, nothing adds a flip: no door row, no Song ▸ Export ▸ Release, no Flip a song in Find, app.flip refuses, the
// runner is off. A song that already has a tempo map (core song format) loads, plays and renders exactly as with it on.
{
  console.log('\nwith workflow.flip and stems.local off');
  const mapped = async (page) => E(page, () => {
    const app = window.overdub;
    app.store.dispatch([{ type: 'track.add', track: { id: 't_k', name: 'Keys', instrument: { device: 'core.bass' } } },
      { type: 'clip.add', track: 't_k', clip: { id: 'c_k', start: 0, length: 16, notes: [0, 2, 4, 6, 8, 10, 12, 14].map((t) => ({ p: 45 + (t % 5), t, d: 1, v: 0.8 })) } },
      { type: 'tempo.map', map: { anchors: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 5 }, { beat: 16, sec: 9 }] } }], { by: 'you', label: 'a mapped song' });
    return JSON.stringify(app.store.get());
  });
  const sig = (page) => E(page, async () => {
    const buf = await window.overdub.engine.render({ sr: 48000, tail: 1 });
    const x = buf.getChannelData(0);
    let s = 0, e = 0;
    for (let i = 0; i < x.length; i++) { s += Math.abs(x[i]) * ((i % 9973) + 1); e += x[i] * x[i]; }
    return { n: x.length, s: Math.round(s * 1e3) / 1e3, e: Math.round(e * 1e6) / 1e6 };
  });
  const on = await blank();
  let text = null, onSig = null;
  try {
    text = await mapped(on.page);
    onSig = await sig(on.page);
  } catch (e) { t.ok(false, 'the mapped song (on) threw: ' + (e.stack || e)); }
  finally { await on.close(); }
  const o = await blank({ query: 'new' });
  const { page } = o;
  try {
    const d = await E(page, async () => {
      const app = window.overdub;
      const ways = [...document.querySelectorAll('.st-door .st-way-b')].map((b) => b.textContent.trim());
      document.querySelector('.sm-btn').click();
      await new Promise((r) => setTimeout(r, 150));
      const menu = [...document.querySelectorAll('.sm-i')].map((b) => b.textContent.trim());
      const release = !!document.querySelector('.sm-release');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const picked = app.flip.pick();
      const flipped = await app.flip.flip([]);
      const { pageJobs } = await import('/app/src/jobs/index.js');
      const runner = (await pageJobs()).runner('stems');
      const toggles = app.toggles.list().filter((x) => x.id === 'workflow.flip' || x.id === 'stems.local').map((x) => `${x.id}:${x.on}`);
      return { ways, menuN: menu.length, release, picked, flipped, runnerOn: runner.available, toggles };
    });
    t.ok(d.toggles.join() === 'workflow.flip:false,stems.local:false' && d.ways.join() === 'Tap a beat,Hum a tune,Play the keys', `off: the door has three ways (${d.ways.join(' · ')})`);
    t.ok(d.menuN > 5 && !d.release, `off: the Song menu has no Export ▸ Release (${d.menuN} rows)`);
    t.ok(d.picked === false && d.flipped.ok === false && d.flipped.error === "Flip a song isn't on in this studio." && d.runnerOn === false, `off: app.flip.pick() and flip() refuse ("${d.flipped.error}"); the stems runner is off`);
    const helps = await E(page, async () => {
      window.overdub.find.open({ query: 'flip' });
      await new Promise((r) => setTimeout(r, 800));
      const rows = window.overdub.find.search('flip a song').filter((x) => x.kind === 'help').map((x) => x.title);
      const other = window.overdub.find.search('find anything').filter((x) => x.kind === 'help').map((x) => x.title);
      window.overdub.find.close();
      return { rows, other };
    });
    t.ok(!helps.rows.includes('Flip a song') && helps.other.includes('Find anything'), `off: Find has no Flip a song (the guide's other headings are there: ${helps.other.slice(0, 2).join(', ')})`);
    // the mapped song from the on studio: it loads, plays and renders the same here
    const loaded = await E(page, async (txt) => {
      const app = window.overdub;
      app.exporter.loadText(txt, 'mapped.overdub.json');
      for (let i = 0; i < 50 && !app.store.get().tempoMap; i++) await new Promise((r) => setTimeout(r, 100));
      await app.engine.start?.();
      app.engine.play?.();
      await new Promise((r) => setTimeout(r, 400));
      const playing = !!(app.engine.playing || app.engine.starting);
      app.engine.stop?.();
      return { map: app.store.get().tempoMap?.anchors?.length || 0, playing };
    }, text);
    const offSig = await sig(page);
    t.ok(loaded.map === 4 && loaded.playing, `off: a song with a tempo map loads (${loaded.map} anchors) and plays`);
    t.ok(onSig && JSON.stringify(offSig) === JSON.stringify(onSig), `off: and renders the same as with Flip a song on (${offSig.n} samples, ${JSON.stringify(offSig)} vs ${JSON.stringify(onSig)})`);
    t.ok(!real(o.errors).length, `no page errors${real(o.errors).length ? ': ' + real(o.errors).slice(0, 2).join(' | ') : ''}`);
  } catch (e) { t.ok(false, 'off threw: ' + (e.stack || e)); }
  finally { await o.close(); }
}

t.done();
