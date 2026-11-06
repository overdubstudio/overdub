// Checks for "Build a band around it": its agent tool and Sketch's Band button (app/src/agent/arrange-tool.js). The
// arranger itself (app/src/core/arrange.js) is checked in Node by test/unit/arrange-around.test.js.
//   node tools/arrange-around-test.js      (screenshots: tools/.out/band-picker.png, tools/.out/band-in.png)
import { arrangeAround, MAX_BEATS } from '../app/src/core/arrange.js';
import { parseNotes } from '../app/src/core/music.js';
import { open, tally } from './pw.js';

const T = tally('arrange-around');
const MEL4 = 'E4@0:0.5 D4@0.5:0.5 C4@1:1 E4@2:1 G4@3:1 A4@4:1.5 G4@5.5:0.5 E4@6:1 D4@7:1 C4@8:0.5 D4@8.5:0.5 E4@9:1 G4@10:2 A4@12:1 G4@13:1 E4@14:1 D4@15:0.5 C4@15.5:0.5';

/* ================================================================== refused at once (wall clock, so here and not in test/unit) */
{
  const t0 = performance.now();
  const r = arrangeAround({ length: 65536, style: 'pop', notes: parseNotes('C4@0:1 E4@1:1') });
  const ms = performance.now() - t0;
  T.ok(MAX_BEATS === 1024 && r.error && /16,384 bars long; a band is built over up to 256 bars/.test(r.error) && ms < 50, `a 16,384-bar clip is refused in ${ms.toFixed(1)} ms: "${r.error}"`);
}

/* ================================================================== in the studio */
{
  const { page, errors, close, shot } = await open('/app/', { query: 'new' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(300);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'arrange_around'));
  T.ok(schema && schema.input_schema.properties.style.enum.length === 5 && /never touches/.test(schema.description), 'arrange_around is registered with its five styles');

  // a kept hum, the way Sketch keeps one
  const seed = await E((mel) => {
    const app = window.overdub;
    app.store.dispatch({ type: 'project.set', patch: { tempo: 100, key: { root: 'C', scale: 'major' } } }, { by: 'you' });
    const notes = mel.split(' ').map((tok) => { const [pp, rest] = tok.split('@'); const [t, d] = rest.split(':'); return { p: pp, t: +t, d: +d, v: 0.8 }; });
    const ph = app.input.capture.add({ src: 'hum', kind: 'notes', notes: notes.map((n) => ({ ...n, p: { C4: 60, D4: 62, E4: 64, G4: 67, A4: 69 }[n.p] })), tempo: 100 });
    const k = app.input.capture.keep(ph.id, { newTrack: { device: 'core.pluck' } });
    return { ...k, n: app.store.findClip(k.clip).clip.notes.length };
  }, MEL4);
  T.ok(seed.ok && seed.n === 18, `a hum kept as a clip (${seed.n} notes)`);
  await E(() => window.overdub.ui.show('sketch'));
  await page.waitForSelector('.sk-idea .band-btn', { timeout: 5000 }).catch(() => {});
  const btn = await page.$('.sk-idea .band-btn');
  T.ok(!!btn, 'the kept take has a Band button in Sketch');
  const h0 = await E(() => window.overdub.store.history.length);
  const tracks0 = await E(() => JSON.stringify(window.overdub.store.get().tracks));
  await page.waitForTimeout(300);   // the Takes list repaints once after a keep
  await page.click('.sk-idea .band-btn');
  await page.waitForSelector('.band-pop', { timeout: 3000 }).catch(() => {});
  const chips = await page.$$eval('.band-pop [data-style]', (els) => els.map((e) => e.textContent));
  T.ok(chips.join() === 'Pop,Rock,Lo-fi,House,Ballad', `the picker offers the styles (${chips.join(', ')})`);
  await page.click('.band-pop [data-style="lofi"]');
  await page.waitForTimeout(200);
  await shot('band-picker');
  await page.click('.band-pop .band-go');
  await page.waitForFunction((n) => window.overdub.store.history.length > n, h0, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(200);
  const after = await E(() => { const s = window.overdub.store, h = s.history.at(-1); return { n: s.history.length, by: h.by, label: h.label, tracks: s.get().tracks.map((t) => ({ id: t.id, name: t.name, by: t.by, gain: t.gain, dev: t.instrument?.device })) }; });
  T.ok(after.n === h0 + 1 && after.by === 'overdub' && after.tracks.length === 4 && after.tracks.slice(1).every((t) => t.by === 'overdub'), `Build the band: one undo step by the house ("${after.label}": ${after.tracks.slice(1).map((t) => `${t.name} ${t.gain} dB`).join(', ')})`);
  const toast = await page.textContent('.ew-toasts');
  T.ok(/Band in: chords, bass and drums around your 18 notes\. One undo takes it back\./.test(toast || ''), `the toast, in the house voice ("${(toast || '').replace(/Undo$/, '').trim()}")`);
  await shot('band-in');
  // levels, measured the way an agent would: engine.render per stem
  const lv = await E(async () => {
    const app = window.overdub, { measure } = await import('/app/src/audio/measure.js');
    const out = {};
    for (const t of app.store.get().tracks) out[t.name] = measure(await app.engine.render({ from: 0, to: 16, tracks: [t.id], tail: 0.3 })).lufs;
    return out;
  });
  // (a kept hum's new track is Melody: core/sounds.js newPartFor, docs/INSTRUMENTS-UX.md 1.2)
  const seedL = lv.Melody, rest = Object.entries(lv).filter(([k]) => k !== 'Melody');
  T.ok(rest.every(([, v]) => v < seedL - 1), `the seed leads by loudness in the render (Melody ${seedL.toFixed(1)} LUFS; ${rest.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')})`);
  T.ok(rest.every(([, v]) => v > seedL - 14), 'and the band is there to be heard (no part more than 14 LU under it)');
  await E(() => window.overdub.store.undo());
  T.ok((await E(() => JSON.stringify(window.overdub.store.get().tracks))) === tracks0, 'one undo takes the whole band back');

  // Shift+B on the selected clip opens the same picker; Escape closes it
  await E((s) => window.overdub.ui.select({ track: s.track, clip: s.clip, notes: [] }), seed);
  await page.mouse.click(700, 300).catch(() => {});
  await E(() => window.overdub.band.close());
  await E((s) => window.overdub.ui.select({ track: s.track, clip: s.clip, notes: [] }), seed);
  await page.keyboard.press('Shift+KeyB');
  const opened = await page.waitForSelector('.band-pop', { timeout: 2000 }).then(() => true).catch(() => false);
  T.ok(opened, 'Shift+B opens the picker on the selected clip');
  await page.keyboard.press('Escape');
  T.ok(!(await page.$('.band-pop')), 'Escape closes it');

  // the agent tool: applies as one step by the agent, says the person's notes are untouched, undoes cleanly
  const a = await E((s) => window.overdub.tools.run('arrange_around', { target: { track: 'Melody', clip: s.clip }, style: 'house', parts: ['chords', 'bass', 'drums', 'pad'], reason: 'a band to sing over' }, { by: 'claude' }), seed);
  const last = await E(() => { const h = window.overdub.store.history.at(-1); return { by: h.by, reason: h.reason, tracks: window.overdub.store.get().tracks.length, signed: window.overdub.store.get().tracks.slice(1).every((t) => t.by === 'claude') }; });
  T.ok(a.ok && last.by === 'claude' && last.tracks === 5 && last.signed && last.reason === 'a band to sing over', `the agent's arrange_around: one step by claude (${a.summary})`);
  T.ok(a.touches_human_notes === false && /untouched/.test(a.note) && a.checks.in_key && a.checks.strong_beat_rubs === 0 && a.checks.bass_on_roots && a.checks.drums_on_grid, `it says what it left alone ("${a.note}") and its checks pass`);
  T.ok(a.measured && a.tracks.every((t) => t.lu_vs_seed < 0), `its faders are measured: every part under the seed (${a.tracks.map((t) => `${t.part} ${t.lu_vs_seed} LU`).join(', ')})`);
  const u = await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
  T.ok(u.ok && (await E(() => window.overdub.store.get().tracks.length)) === 1, 'undo takes the agent\'s band back');
  const pr = await E((s) => window.overdub.tools.run('arrange_around', { target: { track: s.track, clip: s.clip }, style: 'pop', mode: 'propose' }, { by: 'claude' }), seed);
  T.ok(pr.proposal && pr.variations.length === 2 && pr.variations.map((v) => v.label).join() === 'pop band,ballad band' && /untouched/.test(pr.hint) && (await E(() => window.overdub.store.get().tracks.length)) === 1, `mode "propose": two styles as takes, nothing changed (${pr.variations?.map((v) => v.label).join(' / ')})`);
  const vr = await E((x) => window.overdub.tools.run('propose_variations', { title: x.title, target: x.target, variations: x.variations, wait_seconds: 0 }, { by: 'claude' }), pr);
  T.ok(vr.status === 'pending' && !vr.error, 'propose_variations takes them as they are');
  await E((id) => window.overdub.tools.answer(id, 'original'), vr.id).catch(() => {});
  const bad = await E(() => window.overdub.tools.run('arrange_around', { target: { track: 'Nope' } }, { by: 'claude' }));
  T.ok(bad.error && bad.hint, `errors come back with a hint ("${bad.error}")`);

  const pe = errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g/.test(e));
  T.ok(!pe.length, 'no page errors' + (pe.length ? ': ' + pe.slice(0, 3).join(' | ') : ''));
  await close();
}
T.done();
