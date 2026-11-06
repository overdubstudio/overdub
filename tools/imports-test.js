// Bringing outside material in [imports]:
//   (Parts 1 and 2, the Node halves, now live in test/unit/imports.test.js.)
//   1. input/importers.js in Node: Standard MIDI Files built by hand, byte by byte: type 0 (split by channel) and
//      type 1, the first tempo of a tempo map, time and key signatures, track names, markers, drums on channel 10,
//      running status, note-on at velocity 0 as a note-off, program changes choosing an instrument; the exporter's
//      own MIDI parses back; an import plan is one undo step that undoes to nothing, and into a song that already
//      has parts it keeps that song's tempo and says so.
//   2. ui/reference.js in Node: the comparison's words point the right way on known deltas.
//   3. In the page: a .mid dropped on the arranger makes a track per part (one undo step by you, a toast saying what
//      came in); Song menu → Import MIDI… is there; a WAV dropped on the lanes becomes an audio clip where it was
//      dropped (a new audio track, then the existing one) that renders; the Reference tab takes a dropped file,
//      measures it once, stays out of the song's render, shows its profile beside the mix's, and A/B matches its
//      loudness; compare_to_reference's deltas point the right way on a darker copy and a quieter copy of the song.
//   node tools/imports-test.js      (screenshots: tools/.out/imports-*.png)
import { open, tally } from './pw.js';

const T = tally('imports');
const ok = T.ok;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ours = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

/* ------------------------------------------------------------------ SMF by hand */
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const txt = (s) => [...Buffer.from(s, 'utf8')];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, bytes) => [...txt(type), ...u32(bytes.length), ...bytes];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];
const tempoBytes = (bpm) => { const us = Math.round(60e6 / bpm); return [(us >> 16) & 255, (us >> 8) & 255, us & 255]; };
const smfFile = (format, ppq, tracks) => new Uint8Array([...chunk('MThd', [0, format, 0, tracks.length, (ppq >> 8) & 255, ppq & 255]), ...tracks.flatMap((t) => chunk('MTrk', t))]);
// a track from [delta, ...bytes] events (bytes written as given, so running status is literal)
const trk = (events) => [...events.flatMap(([dt, ...bytes]) => [...vlq(dt), ...bytes]), 0, ...meta(0x2f, [])];


// type 1, ppq 480: a tempo map (100 then 140 bpm), 4/4, markers; Keys (program 0), Beat (channel 10, no program),
// Lead (no program, high notes), Sub Bass (no program: named)
const Q = 480;
const type1 = smfFile(1, Q, [
  trk([[0, ...meta(0x03, txt('Song Title'))], [0, ...meta(0x51, tempoBytes(100))], [0, ...meta(0x58, [4, 2, 24, 8])], [0, ...meta(0x06, txt('Verse'))], [4 * Q, ...meta(0x51, tempoBytes(140))], [4 * Q, ...meta(0x06, txt('Chorus'))]]),
  trk([[0, ...meta(0x03, txt('Keys'))], [0, 0xc0, 0], [0, 0x90, 60, 90], [0, 64, 90], [0, 67, 90], [2 * Q, 0x80, 60, 0], [0, 64, 0], [0, 67, 0], [6 * Q, 0x90, 62, 70], [Q, 62, 0]]),
  trk([[0, ...meta(0x03, txt('Beat'))], [0, 0x99, 36, 120], [Q / 4, 0x89, 36, 0], [Q * 3 / 4, 0x99, 38, 100], [Q / 4, 38, 0]]),
  trk([[0, ...meta(0x03, txt('Lead'))], [8 * Q, 0x92, 76, 100], [Q / 2, 0x82, 76, 0], [0, 0x92, 79, 100], [Q / 2, 79, 0]]),
  trk([[0, ...meta(0x03, txt('Sub Bass'))], [0, 0x93, 33, 110], [4 * Q, 0x83, 33, 0]]),
]);

/* ------------------------------------------------------------------ in the page */
const o = await open('/app/', { query: 'new', width: 1440, height: 900 });
const { page } = o;
await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.overdub?.importers && window.overdub?.reference && window.overdub?.arranger, null, { timeout: 30000 });
await page.evaluate(() => window.overdub.engine.start());

// bytes: an array, or the name of a window variable holding a Uint8Array (big files stay in the page)
const dropAt = (selector, bytes, name, type, where = 'center') => page.evaluate(async ({ selector, bytes, name, type, where }) => {
  const el = document.querySelector(selector);
  if (!el) return { error: 'no ' + selector };
  const r = el.getBoundingClientRect();
  const pt = typeof where === 'object' ? { x: r.left + where.x, y: r.top + where.y } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const target = document.elementFromPoint(pt.x, pt.y) || el;
  const inside = !!target.closest?.(selector), hit = String(target.className || target.tagName);
  const dt = new DataTransfer();
  dt.items.add(new File([typeof bytes === 'string' ? window[bytes] : new Uint8Array(bytes)], name, { type }));
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y }));
  return { x: pt.x, y: pt.y, hit, inside, locate: window.overdub.arranger.locate(pt.x, pt.y) };
}, { selector, bytes: typeof bytes === 'string' ? bytes : [...bytes], name, type, where });
const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).pop() || '');
const waitFor = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// MIDI dropped on the arranger
await dropAt('.ar-lanewrap', type1, 'Night Drive.mid', 'audio/midi');
await waitFor(() => window.overdub.store.get().tracks.length === 4);
const m1 = await page.evaluate(() => { const s = window.overdub.store; return { tracks: s.get().tracks.map((t) => [t.name, t.instrument?.device, t.clips.length, t.by, t.clips[0]?.start]), hist: s.history.map((h) => [h.by, h.label]), tempo: s.get().tempo, sections: s.get().sections.map((x) => x.start) }; });
ok(m1.tracks.length === 4 && m1.tracks.every(([, , n, by]) => n === 1 && by === 'you'), `a dropped .mid makes a track per part, one clip each: ${m1.tracks.map((t) => `${t[0]} (${t[1]})`).join(', ')}`);
ok(m1.tracks.map((t) => t[4]).join(',') === '0,0,8,0' && m1.sections.join(',') === '0,8', `into an empty song it starts at bar 1 wherever it was dropped (clips at ${m1.tracks.map((t) => t[4])}, sections at ${m1.sections})`);
ok(m1.hist.length === 1 && m1.hist[0][0] === 'you' && /import Night Drive\.mid/.test(m1.hist[0][1]) && m1.tempo === 100, `one undo step by you: ${JSON.stringify(m1.hist)}`);
const t1 = await lastToast();
ok(/Imported Night Drive\.mid: 4 tracks, 9 notes/.test(t1), 'the toast says what came in: ' + t1);
await o.shot('imports-midi');
const menu = await page.evaluate(async () => { document.querySelector('.sm-btn')?.click(); await new Promise((r) => setTimeout(r, 200)); const t = [...document.querySelectorAll('.sm-i')].map((b) => b.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return t; });
ok(menu.some((t) => /Import MIDI…/.test(t)) && menu.some((t) => /Import audio…/.test(t)), 'Song menu → Import MIDI… and Import audio… are there');
// a flat key from a MIDI file's key signature (Bb major): the Inspector's Key shows it, not "None"
{
  const k = await page.evaluate(async () => {
    const app = window.overdub;
    app.store.dispatch({ type: 'project.set', patch: { key: { root: 'Bb', scale: 'major' } } }, { by: 'you' });
    app.ui.select({ track: null, clip: null, notes: [] });
    app.ui.show('inspector');
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.querySelector('select[aria-label="Key root"]');
    const r = sel && { value: sel.value, text: sel.selectedOptions[0]?.textContent };
    app.store.undo();
    return r;
  });
  ok(k && k.value === 'A#' && k.text === 'Bb', `a flat root shows in the Inspector's Key (${JSON.stringify(k)})`);
}
// in the page: a file with a 4/2^40 time signature comes in without its meter and the studio keeps drawing; a file
// with more notes than one import takes is refused with the count, and the song is left alone
{
  const hostile = smfFile(0, 96, [trk([[0, ...meta(0x58, [4, 40, 24, 8])], [0, 0x90, 60, 100], [96, 0x80, 60, 0]])]);
  const hm = await page.evaluate(async (bytes) => {
    const app = window.overdub, h = app.store.history.length, meter = app.store.get().meter.join('/');
    const r = await app.importers.importMidi(new Uint8Array(bytes), { name: 'hostile.mid', adopt: true, quiet: true });
    const after = app.store.get().meter.join('/');
    const framed = await Promise.race([new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true)))), new Promise((res) => setTimeout(() => res(false), 3000))]);
    if (r.ok) app.store.undo();
    return { ok: r.ok, meter, after, framed, back: app.store.history.length === h };
  }, [...hostile]);
  ok(hm.ok && hm.after === hm.meter && hm.framed && hm.back, `a 4/2^40 time signature is left out and the studio keeps drawing: meter ${hm.meter} → ${hm.after}, frames ${hm.framed}`);
  const big = await page.evaluate(async () => {
    const app = window.overdub, N = 210000, h = app.store.history.length;
    const ev = [];
    for (let i = 0; i < N; i++) ev.push(0, 0x90, 60, 90, 1, 0x80, 60, 0);
    ev.push(0, 0xff, 0x2f, 0);
    const len = ev.length, head = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
    const r = await app.importers.importMidi(new Uint8Array([...head, ...ev]), { name: 'dense.mid', quiet: true });
    return { ok: r.ok, error: r.error, same: app.store.history.length === h };
  });
  ok(!big.ok && /dense\.mid has 210,000 notes; Overdub imports up to 50,000 at a time\./.test(big.error) && big.same, `a 210,000-note file is refused with the count: ${big.error}`);
}
await page.evaluate(() => { document.querySelectorAll('.ew-popover, .pop').forEach(() => {}); document.body.click(); });

// a WAV dropped on the lanes below the tracks: a new audio track with the clip where it was dropped; it renders
const wav = await page.evaluate(() => {
  const sr = 48000, n = sr, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const e = Math.min(1, i / 480, (n - i) / 480); L[i] = R[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / sr) * e; }
  return [...window.overdub.exporter.encodeWav({ sampleRate: sr, channels: [L, R] }, { bits: 16 })];
});
const th = await page.evaluate(() => window.overdub.ui.state.zoom.trackH);
const ppb = await page.evaluate(() => window.overdub.ui.state.zoom.pxPerBeat);
await page.evaluate(() => { window.overdub.ui.state.snap = 1; });
const d1 = await dropAt('.ar-lanewrap', new Uint8Array(wav), 'sine take.wav', 'audio/wav', { x: Math.round(8.2 * ppb), y: Math.round(4.5 * th) });
const okAudio = await waitFor(() => window.overdub.store.get().tracks.some((t) => t.kind === 'audio' && t.clips.length));
const a1 = await page.evaluate(() => { const p = window.overdub.store.get(); const t = p.tracks.find((x) => x.kind === 'audio'); return t && { name: t.name, index: p.tracks.indexOf(t), clips: t.clips.map((c) => ({ start: c.start, length: c.length, asset: c.asset, kind: c.kind })), asset: p.assets[t.clips[0]?.asset], hist: window.overdub.store.history.length, by: t.by }; });
ok(okAudio && a1 && a1.clips.length === 1 && a1.clips[0].kind === 'audio' && a1.name === 'sine take' && a1.by === 'you', `a dropped WAV becomes an audio clip on a new audio track (${JSON.stringify(a1?.clips)}; drop at ${JSON.stringify(d1.locate)})`);
const tempo = 100;
ok(a1 && a1.clips[0].start === 8 && near(a1.clips[0].length, 1 * tempo / 60, 1e-3) && a1.asset && near(a1.asset.duration, 1, 1e-3) && a1.hist === 2, `…at the drop point (beat ${a1?.clips[0]?.start}, snapped to the beat), ${a1?.clips[0]?.length} beats long, the asset in the song, one more undo step`);
const ren = await page.evaluate(async () => {
  const e = window.overdub.engine, p = window.overdub.store.get(), t = p.tracks.find((x) => x.kind === 'audio');
  const M = await import('/app/src/audio/measure.js');
  const b = await e.render({ from: 8, to: 9, tracks: [t.id], tail: 0 });
  const quiet = await e.render({ from: 12, to: 13, tracks: [t.id], tail: 0 });
  return { lufs: M.measure(b).lufs, quiet: M.measure(quiet).lufs };
});
ok(ren.lufs > -30 && ren.quiet <= -100, `the clip renders where it was dropped (${ren.lufs} LUFS in its beat, ${ren.quiet} after it)`);
const t2 = await lastToast();
ok(/sine take\.wav is in: 1\.0 s on sine take, from bar 3/.test(t2), 'the toast says where: ' + t2);
// a second drop on that audio track's lane lands on it
const row = a1.index;
await dropAt('.ar-lanewrap', new Uint8Array(wav), 'second.wav', 'audio/wav', { x: Math.round(16.1 * ppb), y: Math.round((row + 0.5) * th) });
await waitFor((n) => window.overdub.store.get().tracks.filter((t) => t.kind === 'audio').reduce((a, t) => a + t.clips.length, 0) === n, 2);
const a2 = await page.evaluate(() => window.overdub.store.get().tracks.filter((t) => t.kind === 'audio').map((t) => t.clips.map((c) => c.start)));
ok(a2.length === 1 && a2[0].join(',') === '8,16', `a drop on an audio track's lane lands on that track (${JSON.stringify(a2)})`);
await page.evaluate(() => window.overdub.store.undo());
// Song menu → Import audio…, from the keyboard (no drag: a phone, a screen reader): a file chooser, then a clip on a
// new audio track at the playhead's bar; with an audio track selected, on that track
{
  const pickByKeys = async (fileName) => {
    // Under a full run's load a press now and then brings no file chooser at all (the old code did it too: 3 runs in
    // 11), while the studio opens the picker in the click itself and the same keys work alone. So a press that brings
    // none is tried again, from the menu, up to three times; a keyboard path that is really broken fails all three.
    for (let attempt = 1; ; attempt++) {
      await page.evaluate(() => { document.querySelectorAll('.ew-toast').forEach((t) => t.remove()); if (!document.querySelector('.sm-i')) document.querySelector('.sm-btn')?.click(); });
      // wait for the item itself, not just the menu: under load its first items can be drawn before Import audio… is,
      // and focusing a missing item made Enter do nothing (the file chooser then timed out)
      await page.waitForFunction(() => [...document.querySelectorAll('.sm-i')].some((x) => /Import audio…/.test(x.textContent)), null, { timeout: 20000 });
      const focused = await page.evaluate(() => { const b = [...document.querySelectorAll('.sm-i')].find((x) => /Import audio…/.test(x.textContent)); b?.focus(); return document.activeElement === b; });
      try {
        const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.keyboard.press('Enter')]);
        await fc.setFiles({ name: fileName, mimeType: 'audio/wav', buffer: Buffer.from(wav) });
        if (attempt > 1) console.log(`  (the file chooser came on press ${attempt})`);
        return focused;
      } catch (e) {
        if (attempt >= 3 || e.name !== 'TimeoutError') throw e;
      }
    }
  };
  await page.evaluate(() => { window.overdub.ui.select({ track: null, clip: null, notes: [] }); window.overdub.engine.seek(25); });
  const n0 = await page.evaluate(() => window.overdub.store.get().tracks.length);
  const focused = await pickByKeys('menu take.wav');
  const got = await waitFor((n) => window.overdub.store.get().tracks.length === n + 1, n0);
  const pa = await page.evaluate(() => { const p = window.overdub.store.get(); const t = p.tracks[p.tracks.length - 1]; return { name: t.name, kind: t.kind, starts: t.clips.map((c) => c.start), by: t.clips[0]?.by, id: t.id }; });
  ok(focused && got && pa.kind === 'audio' && pa.name === 'menu take' && pa.starts.join(',') === '24' && pa.by === 'you', `Song menu → Import audio… works from the keyboard: a new audio track, the clip at the playhead's bar (${JSON.stringify(pa)})`);
  await page.evaluate((id) => { window.overdub.ui.select({ track: id, clip: null, notes: [] }); window.overdub.engine.seek(33); }, pa.id);
  await pickByKeys('second menu take.wav');
  await waitFor((id) => window.overdub.store.get().tracks.find((t) => t.id === id)?.clips.length === 2, pa.id);
  const pb = await page.evaluate((id) => ({ tracks: window.overdub.store.get().tracks.length, starts: window.overdub.store.get().tracks.find((t) => t.id === id)?.clips.map((c) => c.start) }), pa.id);
  ok(pb.tracks === n0 + 1 && pb.starts?.join(',') === '24,32', `…and onto the selected audio track (${JSON.stringify(pb)})`);
  await page.evaluate(() => { const s = window.overdub.store; s.undo(); s.undo(); window.overdub.engine.seek(0); });
}
await o.shot('imports-audio');

/* ---------------- the reference */
await page.evaluate(() => window.overdub.exporter.openDemo());
await waitFor(() => window.overdub.store.get().tracks.length > 3);
await page.evaluate(() => window.overdub.ui.show('reference'));
const none = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', {}, { by: 'claude' }));
ok(none.error && /no reference/.test(none.error) && /Reference tab/.test(none.hint || ''), 'compare_to_reference with no reference says so: ' + (none.error || JSON.stringify(none).slice(0, 80)));
const listed = await page.evaluate(() => window.overdub.tools.list().includes('compare_to_reference'));
ok(listed, 'compare_to_reference is in the tool catalog');
// a reference without a measured profile (an agent's op, a hand-made file or link): refused or dropped, and if one
// is ever in the song anyway the tab still draws, with Remove in reach
{
  const bad = await page.evaluate(() => window.overdub.tools.run('apply_ops', { ops: [{ type: 'reference.set', reference: { name: 'x' } }], label: 'p' }, { by: 'claude' }));
  const loaded = await page.evaluate(() => { const s = window.overdub.store; const p = JSON.parse(JSON.stringify(s.get())); s.load({ ...p, reference: { name: 'x.mp3', asset: 'a_zzzzzz' } }, { by: 'you' }); return 'reference' in s.get(); });
  ok(!!bad.error && !loaded, `apply_ops reference.set without a profile is refused (${(bad.error || '').slice(0, 60)}), and a loaded song drops one`);
  const tab = await page.evaluate(async () => {
    const app = window.overdub;
    app.store.get().reference = { name: 'x.mp3', asset: 'a_zzzzzz' };   // test only: as if one slipped past the checks
    app.ui.show('reference');
    await new Promise((r) => setTimeout(r, 200));
    const el = document.querySelector('.rf');
    const text = el?.closest('[role=tabpanel], .ew-panel, section')?.textContent || el?.textContent || '';
    const rm = document.querySelector('.rf .rf-remove');
    rm?.click();
    await new Promise((r) => setTimeout(r, 200));
    return { drawn: !!el, failed: /failed to load/i.test(document.body.textContent), said: /came without its measurement/.test(text), remove: !!rm, gone: !app.store.get().reference, empty: !!document.querySelector('.rf .rf-empty') };
  });
  ok(tab.drawn && !tab.failed && tab.said && tab.remove && tab.gone && tab.empty, `a reference with no profile: the tab says so and Remove clears it (${JSON.stringify(tab)})`);
}

// the song (bars 1-8, as the tool renders them) and a darker copy of it, as a WAV file
const prep = await page.evaluate(async () => {
  const e = window.overdub.engine;
  const b = await e.render({ from: 0, to: 32, tail: 1 });
  const M = await import('/app/src/audio/measure.js');
  const fc = 1200, a = 1 - Math.exp(-2 * Math.PI * fc / b.sampleRate);
  const ch = [];
  for (let c = 0; c < b.numberOfChannels; c++) {
    const x = b.getChannelData(c), y = new Float32Array(x.length);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { s1 += a * (x[i] - s1); s2 += a * (s1 - s2); y[i] = s2; }
    ch.push(y);
  }
  window.__dark = { sampleRate: b.sampleRate, channels: ch };
  window.__songBuf = b;
  window.__darkWav = window.overdub.exporter.encodeWav({ sampleRate: b.sampleRate, channels: ch }, { bits: 24 });
  return { song: M.measure(b).lufs, assets: Object.keys(window.overdub.store.get().assets).length };
});
const beforeRender = await page.evaluate(async () => { const M = await import('/app/src/audio/measure.js'); return M.measure(await window.overdub.engine.render({ from: 0, to: 32, tail: 1 })).lufs; });
await page.evaluate(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
const dr = await dropAt('.rf', '__darkWav', 'darker copy.wav', 'audio/wav', { x: 60, y: 40 });
ok(dr.inside, `the drop lands on the Reference tab (${dr.hit})`);
await waitFor(() => !!window.overdub.store.get().reference, null, 30000);
const ref1 = await page.evaluate(() => { const s = window.overdub.store; const r = s.get().reference; return r && { name: r.name, by: r.by, lufs: r.profile?.lufs, bands: r.profile?.bands, centroid: r.profile?.centroid, tracks: s.get().tracks.length, assets: Object.keys(s.get().assets).length, last: s.history[s.history.length - 1]?.label }; });
ok(ref1 && ref1.name === 'darker copy.wav' && ref1.by === 'you' && Number.isFinite(ref1.lufs) && ref1.lufs > -60 && ref1.bands && ref1.centroid > 0, `a file dropped on the Reference tab is measured once and kept (${ref1?.lufs} LUFS, centre ${ref1?.centroid} Hz)`);
ok(ref1 && /reference: darker copy\.wav/.test(ref1.last) && ref1.assets === prep.assets, 'one undo step by you, and it is not an audio clip or a track asset');
const afterRender = await page.evaluate(async () => { const M = await import('/app/src/audio/measure.js'); return M.measure(await window.overdub.engine.render({ from: 0, to: 32, tail: 1 })).lufs; });
ok(near(beforeRender, afterRender, 0.05), `the reference is not in the song's render (${beforeRender} → ${afterRender} LUFS)`);
const cmp1 = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', { bars: [1, 8] }, { by: 'claude' }));
ok(!cmp1.error && cmp1.deltas.centroidPct > 8 && cmp1.deltas.bands.presence > 1.5 && cmp1.deltas.bands.air > 1.5, `against a darker copy the song reads brighter (centre ${cmp1.deltas?.centroidPct}%, presence ${cmp1.deltas?.bands?.presence} dB, air ${cmp1.deltas?.bands?.air} dB)${cmp1.error ? ': ' + cmp1.error : ''}`);
ok(/brighter/.test(cmp1.summary || '') && (cmp1.differences || []).some((x) => /vs the reference: (more present|airier)/.test(x)), 'in words: ' + cmp1.summary + ' | ' + (cmp1.differences || []).slice(0, 3).join(' | '));
await waitFor(() => !!window.overdub.reference.mix, null, 30000);
await page.evaluate(() => window.overdub.ui.show('reference'));
await new Promise((r) => setTimeout(r, 300));
const panel = await page.evaluate(() => ({ rows: document.querySelectorAll('.rf-row').length, mixBars: document.querySelectorAll('.rf-b-mix').length, sum: document.querySelector('.rf-sum')?.textContent || '', head: document.querySelector('.rf-id')?.textContent || '' }));
ok(panel.rows === 7 && panel.mixBars === 7 && /darker copy\.wav/.test(panel.head) && /Against/.test(panel.sum), `the tab shows the reference's profile beside the mix's (${panel.rows} bands; "${panel.sum.slice(0, 80)}")`);
await o.shot('imports-reference');

// a quieter copy (−6 dB), set directly: louder by ~6 LU, the same tone; A/B turns it up to match
const ref2 = await page.evaluate(async () => {
  const b = window.__songBuf, ch = [];
  for (let c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c).map((v) => v * 0.5));
  const buf = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  ch.forEach((x, i) => buf.copyToChannel(x, i));
  return window.overdub.reference.set({ name: 'quieter copy', buffer: buf }, { quiet: true });
});
const cmp2 = await page.evaluate(() => window.overdub.tools.run('compare_to_reference', { bars: [1, 8] }, { by: 'claude' }));
ok(ref2.ok && near(cmp2.deltas?.lufs, 6.02, 0.1) && /6 LU louder/.test(cmp2.summary) && /close in tone/.test(cmp2.summary), `against a −6 dB copy: ${cmp2.deltas?.lufs} LU, "${cmp2.summary}"`);
// A/B: the match gain is the song's loudness minus the reference's, measured over the whole song
await page.evaluate(() => window.overdub.reference.measureMix());
const ab = await page.evaluate(async () => {
  const R = window.overdub.reference;
  const r = await R.ab.start('B');
  const s1 = R.ab.state;
  R.ab.side('A');
  const s2 = R.ab.state;
  const want = R.abMatch(R.mix.profile.lufs, window.overdub.store.get().reference.profile).db;
  const btn = document.querySelector('.rf-ab-b.on')?.textContent;
  R.ab.stop();
  window.overdub.engine.stop();
  return { r, s1, s2, want, btn, after: R.ab.state, playing: window.overdub.engine.playing };
});
ok(ab.r.ok && ab.s1?.side === 'B' && ab.s2?.side === 'A' && near(ab.s1.gainDb, ab.want, 0.01) && ab.want > 0 && ab.after === null, `A/B plays the reference loudness-matched (${ab.s1?.gainDb} dB), switches sides and stops (${JSON.stringify(ab.r)})`);
// undo puts the first reference back; and once more, no reference at all
const undone = await page.evaluate(() => { const s = window.overdub.store; s.undo(); const a = s.get().reference?.name; s.undo(); return [a, s.get().reference?.name || null]; });
ok(undone[0] === 'darker copy.wav' && undone[1] === null, `undo walks the reference back: ${JSON.stringify(undone)}`);

const errs = ours(o.errors);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await o.close();
T.done();
