// The live room's harness [tools; frozen after the foundation] (docs/research/LIVE-ROOM-MODE.md §11): the room opened in
// muted headless Chromium (tools/pw.js), a fake session lined up with the count, History read, keys pressed. Nothing
// here reaches a speaker: pw.js launches with --mute-audio, and the fake input is a file.
//
//   openRoom(route = '/app/?room', { fake, name, width, height, webdriver, init, ready }) -> session
//       tools/pw.js open's session ({ page, errors, close, shot, ... }) once the studio is ready, plus E(fn, arg)
//       (page.evaluate) and plays() (every engine.play call since the studio was ready: [{ from, opts, now }], now on
//       the audio clock). fake: a WAV file, or fake.js session()'s { wav } (written to tools/.out/liveroom/<name>.wav);
//       webdriver: false reads navigator.webdriver as false, as a visitor's browser does (the first-run coach and the
//       first screens behave as they do for one); init: pw.js open's, run after that; ready: false returns before the
//       studio is ready. Under PAGES=0 it throws: no check opens a browser then.
//   alignCount(page, { bar1, beats, bpm }) -> { ok, at, error }
//       the audio-clock time to give engine.play's `at` (or the deck's countIn `at`) for a count of `beats` so the
//       fake's bar 1 (bar1 s into the file: fake.js session's timeline.bar1) meets the band's. Chromium's fake capture
//       plays its file from when the input opens, on its own clock: this reads the audio-clock frame of the first block
//       the input captured (input.audio.state.firstFrame, §9.4) and counts from there
//   history(page) -> [{ label, by, reason, kind, ops }]   the song's History, oldest first (ops: the op types)
//   press(page, key, { delay }) -> the key pressed (page.keyboard.press: 'Space', 'Shift+KeyR', 'Meta+KeyZ'), then
//       two frames, so the room's frame has run

import path from 'node:path';
import { open, OUTDIR } from '../pw.js';
import { writeWav } from './fake.js';

export const OUT = path.join(OUTDIR, 'liveroom');

// navigator.webdriver as a visitor's browser has it (before any of the page's own scripts)
const NOT_WEBDRIVER = () => { try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); } catch { /* fine */ } };

export async function openRoom(route = '/app/?room', { fake = null, name = 'fake', width = 1440, height = 900, webdriver = true, init = null, ready = true } = {}) {
  if (process.env.PAGES === '0') throw new Error('PAGES=0: no browser');
  let fakeAudio = null;
  if (typeof fake === 'string') fakeAudio = fake;
  else if (fake?.wav) fakeAudio = writeWav(path.join(OUT, `${name}.wav`), fake.wav);
  // (one init script: navigator.webdriver first, then the check's own)
  const scripts = [];
  if (!webdriver) scripts.push(`(${NOT_WEBDRIVER})();`);
  if (typeof init === 'string') scripts.push(init);
  else if (typeof init === 'function') scripts.push(`(${init})();`);
  else if (Array.isArray(init)) scripts.push(`(${init[0]})(${JSON.stringify(init[1] ?? null)});`);
  const s = await open(route, { width, height, fakeAudio, init: scripts.length ? scripts.join('\n') : null });
  const E = (fn, arg) => s.page.evaluate(fn, arg);
  if (ready) {
    await s.page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    // engine.play's calls, as the room made them (the count's `at` among them)
    await E(() => {
      const o = window.overdub, play = o.engine.play.bind(o.engine), log = (window.__lrPlays = []);
      o.engine.play = (from, opts) => { log.push({ from: from ?? null, opts: opts ? JSON.parse(JSON.stringify(opts)) : null, now: o.engine.ctx?.currentTime ?? null }); return play(from, opts); };
    });
  }
  return { ...s, E, plays: () => E(() => window.__lrPlays || []) };
}

export async function alignCount(page, { bar1 = 1, beats = 4, bpm = 120 } = {}) {
  return page.evaluate(({ bar1, beats, bpm }) => {
    const o = window.overdub, st = o.input?.audio?.state, ctx = o.engine?.ctx;
    if (!st?.open) return { ok: false, error: 'the input isn’t open' };
    if (!Number.isFinite(st.firstFrame)) return { ok: false, error: 'the input doesn’t say when it captured its first block (input.audio.state.firstFrame)' };
    const sr = st.sr || ctx?.sampleRate || 48000, at = st.firstFrame / sr + bar1 - (beats * 60) / bpm;
    if (ctx && at < ctx.currentTime + 0.05) return { ok: false, at, error: `bar 1 is too soon to count to (${(at - ctx.currentTime).toFixed(2)} s from now): give the fake a longer lead` };
    return { ok: true, at };
  }, { bar1, beats, bpm });
}

export async function history(page) {
  return page.evaluate(() => window.overdub.store.history.map((x) => ({ label: x.label || '', by: x.by, reason: x.reason || '', kind: x.revert ? 'revert' : 'do', ops: (x.ops || []).map((o) => o.type) })));
}

export async function press(page, key, { delay = 0 } = {}) {
  await page.keyboard.press(key, delay ? { delay } : undefined);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return key;
}
