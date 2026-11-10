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
//   withMark(fake, { at, peak }) -> fake   the fake with its mark: one sample at `peak` dBFS (-12), `at` s (1) into a
//       file silent for a second either side of it (it throws if it isn't), on the first channel; fake.mark is `at`
//   hearMark(page, { at, level }) -> before the input opens, the page listens for the mark: window.__lrFile.t0 becomes
//       the audio-clock time the file started (where the mark peaked, less `at`), once the 10 ms after the first sample
//       over `level` (0.02) are in. The peak, not that first sample: a fake at another rate than the capture's is
//       resampled on its way in, which rings ahead of an impulse but keeps where it peaks. And not the first captured
//       block's frame (input.audio.state.firstFrame): Chromium's fake capture runs its file a few ms off that, by a
//       different amount each run
//   fileStart(page, { timeout }) -> t0   once the mark has been heard (it throws if it isn't in `timeout` ms)
//   alignCount(page, { bar1, beats, bpm }) -> { ok, at, error }
//       the audio-clock time to give engine.play's `at` (or the deck's countIn `at`) for a count of `beats` so the
//       fake's bar 1 (bar1 s into the file: fake.js session's timeline.bar1) meets the band's, as it sounds: from where
//       the file started (fileStart) and less the engine's delay compensation (the count sounds that much after its
//       `at`, and the recorder places takes by where it sounds)
//   history(page) -> [{ label, by, reason, kind, ops }]   the song's History, oldest first (ops: the op types)
//   press(page, key, { delay }) -> the key pressed (page.keyboard.press: 'Space', 'Shift+KeyR', 'Meta+KeyZ'), then
//       two frames, so the room's frame has run
//   atOnce(T, flows, { max }) -> flows (each (T) => a promise) that share nothing, up to max at a time: most of such a
//       flow is its fake playing in real time, so they wait side by side. Each gets a tally of its own, printed whole in
//       the order given, so the suite reads as if they ran one after the other; one that throws is a FAIL line and the
//       others still run. Make the fakes before calling it: Node's synthesis would hold up the presses of a flow already
//       under way, and those are timed against the file

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

export function withMark(fake, { at = 1, peak = -12 } = {}) {
  const ch = fake.wav.channels[0], sr = fake.wav.sr, i = Math.round(at * sr);
  for (let k = 0, n = Math.min(ch.length, i + sr); k < n; k++) if (Math.abs(ch[k]) > 1e-4) throw new Error(`the fake isn't silent around its mark at ${at} s (${(k / sr).toFixed(3)} s)`);
  ch[i] = 10 ** (peak / 20);
  return { ...fake, mark: at };
}

export async function hearMark(page, { at = 1, level = 0.02 } = {}) {
  await page.evaluate(({ at, level }) => {
    const o = window.overdub, F = (window.__lrFile = { t0: null, heard: null });
    let first = null, peak = 0, peakF = 0;
    const off = o.input.audio.listen((b) => {
      if (F.t0 != null) return;
      const d = b.d[0], sr = o.input.audio.state.sr || o.engine.ctx.sampleRate;
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]), f = b.f + i;
        if (first == null && v > level) first = f;
        if (first == null) continue;
        if (v > peak) { peak = v; peakF = f; }
        if (f - first >= 0.01 * sr) { F.heard = peakF / sr; F.t0 = F.heard - at; off(); return; }
      }
    });
  }, { at, level });
}

export async function fileStart(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(() => window.__lrFile?.t0 != null, null, { timeout, polling: 20 }).catch(() => {
    throw new Error(`the fake's mark wasn't heard on the input in ${timeout / 1000} s (hearMark before the input opens)`);
  });
  return page.evaluate(() => window.__lrFile.t0);
}

export async function alignCount(page, { bar1 = 1, beats = 4, bpm = 120 } = {}) {
  let t0;
  try { t0 = await fileStart(page); } catch (e) { return { ok: false, error: e.message }; }
  return page.evaluate(({ t0, bar1, beats, bpm }) => {
    const o = window.overdub, ctx = o.engine?.ctx, pdc = o.engine?.latency?.total || 0;
    const at = t0 + bar1 - (beats * 60) / bpm - pdc;
    if (ctx && at < ctx.currentTime + 0.05) return { ok: false, at, error: `bar 1 is too soon to count to (${(at - ctx.currentTime).toFixed(2)} s from now): give the fake a longer lead` };
    return { ok: true, at, pdc };
  }, { t0, bar1, beats, bpm });
}

export async function history(page) {
  return page.evaluate(() => window.overdub.store.history.map((x) => ({ label: x.label || '', by: x.by, reason: x.reason || '', kind: x.revert ? 'revert' : 'do', ops: (x.ops || []).map((o) => o.type) })));
}

export async function press(page, key, { delay = 0 } = {}) {
  await page.keyboard.press(key, delay ? { delay } : undefined);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return key;
}

export async function atOnce(T, flows, { max = 3 } = {}) {
  const logs = flows.map(() => []);
  const tallyInto = (log) => ({
    ok(cond, msg) { log.push(() => T.ok(cond, msg)); return !!cond; },
    note(msg) { log.push(() => T.note(msg)); },
  });
  let next = 0;
  const lane = async () => {
    while (next < flows.length) {
      const i = next++, t = tallyInto(logs[i]);
      try { await flows[i](t); } catch (e) { t.ok(false, `a flow threw: ${String(e?.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, flows.length) }, lane));
  for (const log of logs) for (const say of log) say();
}
