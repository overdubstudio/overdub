// The amp path's soak (docs/research/AMP-PATH.md §11; not a suite: run it by hand, and before calling the amp path
// done). The real studio in a muted headless browser with AJ's rig faked: a Scarlett Solo by name (the fake devices
// renamed), a sustained chord at -12 dBFS on input 2 and near silence on input 1 (written to tools/.out/amp-soak/di.wav,
// never played to a speaker). Into the metal club's guitar room, the things a guitarist does, each scenario N times,
// measured at the audio graph after every step: the input's pick, Guitar L's strip input, every insert's in and out,
// the chain's end, the master and the speakers' feed. A step is
//   wet      what a guitarist expects: the rig made most of what comes out (share: the power not at the DI's notes)
//   clean    little distortion through a live amp that isn't bypassed (a clean amp: by design where a step says so)
//   partly   the club's stack measuring well under its own wet share (a pedal half on, the amp passing dry beside it)
//   dry      the DI itself at the speakers (the amp bypassed or a stand-in)
//   silent   nothing of the guitar (or the context isn't running)
//   pedal-stuck / stand-in   wet overall, but a pedal is bypassed against the song, or a stand-in plays
// A step that isn't wet (or what it expects) is measured again 3 s later: one that stays is stuck, one that clears was
// passing. Failures print as they happen (XX), then a tally; the exit code is 1 on any.
//
//   node tools/amp-soak.js [scenario[,scenario] ...] [--n N] [--reuse] [--list]   (default: every scenario, N = 4)
//   --reuse          the scenarios that run in a session keep one browser for all N cycles (the room as a guitarist
//                    leaves it, cycle after cycle; a new one after a cycle that failed, threw or logged a page error);
//                    the cold and first-visit ones always launch their own
//   CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   AJ's Chrome (default: the harness's Chromium)
//   SR=48000         the context at this rate (default: the browser's)
//   LABELS=0         no standing microphone grant: enumerateDevices has no ids or labels until the first getUserMedia
//                    (a first visit, or after Chrome's "Allow this time" ran out)
//   STRICT=1         Chrome's own autoplay policy (the context starts suspended until a real key or click)
//   NOPERM=1         the microphone not granted before the page asks
//   TREE=/checkout   serve another checkout (its tools/pw.js and server), to compare before and after
//   OUT=file.json    where the rows go (default tools/.out/amp-soak/<browser>-<sr>[-scenarios].json)
//   FAKE_OUTPUT=1    the browser plays to a fake output (tools/pw.js): when the Mac's output device has stopped
//                    answering, every context's clock stalls and every step reads silent
// The machine is shared and the browser is muted: run it under nice -n 10, one browser at a time. A timed step that
// fails under load and passes alone is load: say so.
//
// Scenarios: race (the footswitch's glide with the audio clock moved between its reads, on the page's own kit.js: no
// room), cold, coldgs, reload, pick, device, suspend, stomp, knobs, swap, pedals, rack, glass, song, drums, take, kill,
// jamclose, chipdefault, unplug, oldtrack, and the first-visit ones takefirst, firstgs, sketchfirst, staleid.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE = process.env.TREE ? path.resolve(process.env.TREE) : path.resolve(HERE, '..');
const imp = (rel) => import(pathToFileURL(path.join(TREE, rel)).href);
const PW = await imp('tools/pw.js');
const { writeWav } = await import(pathToFileURL(path.join(HERE, 'liveroom/fake.js')).href);
const OUTDIR = path.join(HERE, '.out', 'amp-soak');
fs.mkdirSync(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the fake DI: a sustained chord (three low notes and two upper partials, 108, 168, 312, 714, 1386 Hz: no
   intermodulation product of order 4 or less within 12 Hz of one, so what lands between them is what the rig made) at
   -12 dBFS peak on input 2 of a two-input interface; input 1 seeded noise at -90 dBFS. 10 s of whole cycles: the fake
   capture loops it seamlessly. */
const FREQS = [108, 168, 312, 714, 1386];
function makeDI(file, { sr = 48000, secs = 10, peak = -12 } = {}) {
  const AMPS = [1, 1, 0.8, 0.45, 0.3], n = sr * secs, x = new Float32Array(n), q = new Float32Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    let v = 0; for (const [k, f] of FREQS.entries()) v += AMPS[k] * Math.sin((2 * Math.PI * f * i) / sr + k);
    x[i] = v; s = (s * 16807) % 2147483647; q[i] = ((s / 2147483647) * 2 - 1) * 3e-5;
  }
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const g = Math.pow(10, peak / 20) / pk; for (let i = 0; i < n; i++) x[i] *= g;
  return writeWav(file, { sr, channels: [q, x] });
}
const DI = path.join(OUTDIR, 'di.wav');
if (!fs.existsSync(DI)) makeDI(DI);

/* ---- the in-page probe (window.__amp): measure() adds branches off the graph's nodes into a capture, and changes
   nothing in the sound. measure({ secs }) -> { at, complete, state, points: { name: { db, peak, share } }, inserts:
   [{ i, id, device, on (the song), inst: 'live' | 'stand-in' | 'held' | 'none', instOn, health, lag, g, res,
   bypassed }] }. bypassed: the insert's out is its in (lag 0, unity, residual under -27 dB). */
function PROBE() {
  const o = window.overdub, FREQS = [108, 168, 312, 714, 1386];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let tapNode = null, untap = null, tapCtx = null;
  function ensureTap() {
    const a = o.input && o.input.audio, c = o.engine.ctx;
    if (!a || !c) return null;
    if (tapNode && tapCtx === c) return tapNode;
    if (untap) { try { untap(); } catch { /* gone */ } }
    tapNode = c.createGain(); tapCtx = c;
    untap = a.tap(tapNode);
    return tapNode;
  }
  const capModule = (c) => { if (!c.__ewCap) c.__ewCap = c.audioWorklet.addModule('/app/src/input/cap-worklet.js').then(() => true, () => false); return c.__ewCap; };
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function analyze(x, sr) {
    let ss = 0, pk = 0;
    for (let i = 0; i < x.length; i++) { ss += x[i] * x[i]; const v = Math.abs(x[i]); if (v > pk) pk = v; }
    const N = 16384, P = new Float64Array(N / 2), w = new Float32Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    for (let s = 0; s + N <= x.length; s += N / 2) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
      fft(re, im);
      for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    }
    const bin = sr / N;
    let tot = 0, tone = 0;
    for (let k = Math.ceil(20 / bin); k < Math.min(N / 2, 16000 / bin); k++) { tot += P[k]; const f = k * bin; if (FREQS.some((F) => Math.abs(f - F) <= 8)) tone += P[k]; }
    return { db: +(10 * Math.log10(ss / x.length + 1e-20)).toFixed(1), peak: +(20 * Math.log10(pk + 1e-12)).toFixed(1), share: tot > 0 ? +(1 - tone / tot).toFixed(4) : null };
  }
  // y against x delayed by 0..maxLag: the best lag, its gain, and the residual's share of y's power
  function identity(x, y, maxLag = 700) {
    const n = Math.min(x.length, y.length) - maxLag, s0 = maxLag;
    if (n < 4096) return null;
    let yy = 0; for (let i = s0; i < s0 + n; i++) yy += y[i] * y[i];
    if (yy < 1e-14) return { lag: 0, g: 0, res: 1, silent: true };
    let best = null;
    for (let L = 0; L <= maxLag; L++) {
      let xy = 0, xx = 0;
      for (let i = s0; i < s0 + n; i += 2) { const a = x[i - L]; xy += a * y[i]; xx += a * a; }
      const c = xy / Math.sqrt((xx * yy) / 2 + 1e-30);
      if (!best || c > best.c) best = { L, c };
    }
    let xy = 0, xx = 0;
    for (let i = s0; i < s0 + n; i++) { const a = x[i - best.L]; xy += a * y[i]; xx += a * a; }
    const g = xx > 0 ? xy / xx : 0;
    let rr = 0; for (let i = s0; i < s0 + n; i++) { const r = y[i] - g * x[i - best.L]; rr += r * r; }
    return { lag: best.L, g: +g.toFixed(4), res: +(rr / yy).toFixed(5) };
  }
  function roomTracks() {
    const p = o.store.get(), ids = (p.room && p.room.tracks) || {};
    const L = p.tracks.find((t) => t.id === ids.guitarL) || p.tracks.find((t) => t.name === 'Guitar L');
    return { L, p };
  }
  const safe = (fn) => { try { return JSON.parse(JSON.stringify(fn() ?? null)); } catch (e) { return { error: String(e && e.message || e) }; } };
  function stateNow() {
    const a = o.input && o.input.audio, st = (a && a.state) || {}, c = o.engine.ctx, { L } = roomTracks();
    const mt = a && a.monitorTrack ? a.monitorTrack() : null;
    return {
      ctx: c ? c.state : 'none', sr: c ? c.sampleRate : 0, open: !!st.open, label: st.label, kind: st.inputKind, channel: st.channel, channels: st.channels,
      monitoring: !!st.monitoring, monitorOff: st.monitorOff || '', holds: st.monitorHolds || [], monitorTrack: mt ? mt.name : null, monitorIsL: !!(mt && L && mt.id === L.id),
      path: st.path ? { state: st.path.state, line: st.path.line } : null, screen: o.ui.state.liveRoom && o.ui.state.liveRoom.screen, playing: o.engine.playing,
      chain: L ? L.inserts.map((x) => x.device.replace(/^(pedal|amp|core)\./, '') + (x.on === false ? '(off)' : '')).join('>') : null,
      tuner: !!(o.ui.state.liveRoom && o.ui.state.liveRoom.gr && o.ui.state.liveRoom.gr.tuner && o.ui.state.liveRoom.gr.tuner.on),
    };
  }
  async function measure({ secs = 0.8, settle = true } = {}) {
    const c = o.engine.ctx;
    if (!c) return { state: stateNow(), error: 'no context' };
    if (settle) { try { await Promise.race([o.engine.settled(), sleep(4000)]); } catch { /* measured anyway */ } }
    ensureTap();
    if (!(await capModule(c))) return { state: stateNow(), error: 'no capture module' };
    const { L } = roomTracks();
    const pts = [['pick', tapNode]];
    if (L) pts.push(['strip', o.engine.inputNode(L.id)]);
    const ins = [];
    if (L) for (const [i, x] of L.inserts.entries()) {
      const inst = o.engine.instance(L.id, x.id);
      ins.push({ i, id: x.id, device: x.device, on: x.on !== false, inst: inst ? (inst.fallback ? 'stand-in' : inst.held ? 'held' : 'live') : 'none', instOn: inst ? inst.on : null, health: inst && inst.health ? safe(() => inst.health()) : null });
      if (inst && inst.input) pts.push([`${i}.in`, inst.input]);
      if (inst && inst.output) pts.push([`${i}.out`, inst.output]);
    }
    const last = ins.length ? `${ins.length - 1}.out` : null;
    pts.push(['master', o.engine.masterTap]);
    if (o.engine._monitor) pts.push(['speaker', o.engine._monitor]);
    const live = pts.filter(([, n]) => n && n.context === c), N = live.length;
    const merge = c.createChannelMerger(N);
    const cap = new AudioWorkletNode(c, 'ew-cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: N, channelCountMode: 'explicit', channelInterpretation: 'discrete', processorOptions: { channels: N } });
    const bufs = live.map(() => []), want = Math.round(secs * c.sampleRate);
    let got = 0;
    const done = new Promise((res) => { cap.port.onmessage = (e) => { const d = e.data.d; for (let k = 0; k < N; k++) bufs[k].push(d[k]); got += d[0].length; if (got >= want) res(); }; });
    // (a mono downmix of each point: the strip's fader is stereo, the chain mono)
    const downs = live.map(([, n], k) => { const g = c.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; n.connect(g); g.connect(merge, 0, k); return [n, g]; });
    merge.connect(cap);
    const t0 = c.currentTime;
    const ok = await Promise.race([done.then(() => true), sleep(secs * 1000 + 3000).then(() => false)]);
    try { cap.port.postMessage('off'); merge.disconnect(); for (const [n, g] of downs) { try { n.disconnect(g); } catch { /* gone */ } g.disconnect(); } } catch { /* gone */ }
    const cat = (arr) => { let n = 0; for (const b of arr) n += b.length; const x = new Float32Array(n); let at = 0; for (const b of arr) { x.set(b, at); at += b.length; } return x; };
    const X = bufs.map(cat), points = {};
    live.forEach(([name], k) => { points[name] = analyze(X[k], c.sampleRate); });
    if (last && points[last]) points.chain = points[last];
    for (const x of ins) {
      const a = live.findIndex(([n]) => n === `${x.i}.in`), b = live.findIndex(([n]) => n === `${x.i}.out`);
      if (a >= 0 && b >= 0) {
        const id = identity(X[a], X[b]);
        Object.assign(x, id || {});
        x.bypassed = !!(id && !id.silent && id.lag === 0 && Math.abs(id.g - 1) < 0.02 && id.res < 2e-3);
      }
    }
    return { at: +t0.toFixed(3), complete: ok, state: stateNow(), points, inserts: ins };
  }
  window.__amp = { measure, stateNow, roomTracks, ensureTap };
  return true;
}

/* ---- the browser: tools/pw.js's open (the microphone granted, autoplay allowed), or under STRICT / NOPERM our own
   launch with Chrome's real policies */
const require = createRequire(import.meta.url);
function findPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_CORE, 'playwright-core', path.join(os.homedir(), 'Code/xenobotany/node_modules/playwright-core')].filter(Boolean)) { try { return require(t); } catch { /* next */ } }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE');
}
async function openStrict(route, { fakeAudio, init }) {
  const { startServer, ready } = await imp('server/serve.js');
  await ready;
  const srv = await startServer({ port: 0, quiet: true });
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--mute-audio', ...PW.QUIET, ...PW.TEXT, `--use-file-for-fake-audio-capture=${fakeAudio}`];
  if (process.env.STRICT !== '1') args.push('--autoplay-policy=no-user-gesture-required');
  let exe = process.env.CHROMIUM;
  if (!exe) { const base = path.join(os.homedir(), 'Library/Caches/ms-playwright'); if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) if (d.startsWith('chromium_headless_shell')) exe = path.join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'); }
  const browser = await findPlaywright().chromium.launch({ headless: true, executablePath: exe, args });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: process.env.NOPERM === '1' ? [] : ['microphone'] });
  await context.addInitScript({ content: init });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.stack) || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.url + route, { waitUntil: 'load' });
  return { page, browser, context, errors, close: async () => { await browser.close().catch(() => {}); await srv.close(); } };
}
const OWN = process.env.STRICT === '1' || process.env.NOPERM === '1';

// before the studio's own scripts: Getting started done, AJ's Scarlett by its name, the rate forced if asked,
// navigator.webdriver false (a visitor's browser), and under LABELS=0 no labels or ids until the first getUserMedia
function initScript({ sr = 0, input = null } = {}) {
  return `(() => {
    try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); } catch {}
    try { if (!localStorage.getItem('overdub:guitar-room')) localStorage.setItem('overdub:guitar-room', JSON.stringify({ v: 1, countIn: true, gs: { done: true, step: null, skipped: [] }, tuning: null, tunerStyle: 'needle', snap: true })); } catch {}
    ${input ? `try { if (!localStorage.getItem('overdub:input')) localStorage.setItem('overdub:input', ${JSON.stringify(JSON.stringify(input))}); } catch {}` : ''}
    try { const gum = MediaDevices.prototype.getUserMedia; MediaDevices.prototype.getUserMedia = async function (c) { const st = await gum.call(this, c); window.__granted = true; window.__streams = (window.__streams || []).concat(st); return st; }; } catch {}
    const blind = ${process.env.LABELS === '0' ? 'true' : 'false'};
    const NAME = 'Scarlett Solo USB (1235:8211)', MIC = 'MacBook Pro Microphone (Built-in)';
    const rename = (l) => /fake default/i.test(l) ? 'Default - ' + NAME : /fake audio input 1/i.test(l) ? NAME : /fake audio input/i.test(l) ? MIC : l;
    try {
      const lab = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'label');
      Object.defineProperty(MediaStreamTrack.prototype, 'label', { configurable: true, get() { const l = lab.get.call(this); return this.kind === 'audio' ? rename(l) : l; } });
      const en = MediaDevices.prototype.enumerateDevices;
      window.__enumAll = async () => (await en.call(navigator.mediaDevices)).map((d) => ({ deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: rename(d.label) }));
      const dev = (d, label) => ({ deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label, toJSON() { return { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label }; } });
      MediaDevices.prototype.enumerateDevices = async function () {
        const L = await en.call(this);
        if (blind && !window.__granted) { const first = L.find((d) => d.kind === 'audioinput'); return L.filter((d) => d.kind !== 'audioinput').concat(first ? [dev({ deviceId: '', groupId: '', kind: 'audioinput' }, '')] : []); }
        return L.map((d) => (d.kind !== 'audioinput' ? d : dev(d, rename(d.label))));
      };
    } catch (e) { console.warn('amp-soak: rename', e); }
    ${sr ? `try { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(o = {}) { super({ ...o, sampleRate: ${sr} }); } }; window.webkitAudioContext = window.AudioContext; } catch {}` : ''}
  })();`;
}

const PROBE_SRC = `(${PROBE})()`;
async function reprobe(s) { await s.page.waitForSelector('html[data-ready="1"]', { timeout: 40000 }); await s.E(PROBE_SRC); }
// a session: the studio open; aj: AJ returning (the input remembered as the Scarlett's own id, input 2)
async function launch({ sr = +process.env.SR || 0, route = '/app/', input = null, aj = true } = {}) {
  const init = initScript({ sr, input });
  const s = OWN ? await openStrict(route, { fakeAudio: DI, init }) : await PW.open(route, { fakeAudio: DI, init });
  const S = { ...s, E: (fn, arg) => s.page.evaluate(fn, arg) };
  await reprobe(S);
  if (aj) {
    await S.E(async () => {
      const l = window.__enumAll ? await window.__enumAll() : await navigator.mediaDevices.enumerateDevices();
      const d = l.find((x) => x.kind === 'audioinput' && /^Scarlett/.test(x.label));
      localStorage.setItem('overdub:input', JSON.stringify({ deviceId: d ? d.deviceId : '', channel: '2', countIn: true }));
    });
    await s.page.reload({ waitUntil: 'load' });
    await reprobe(S);
  }
  return S;
}
const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function key(page, k) { await page.keyboard.press(k); await frames(page); }
// into the guitar room: the door, then the club (key 1)
async function intoClub(s) {
  const { page, E } = s;
  if ((await E(() => window.overdub.ui.state.liveRoom?.screen || null)) === 'guitar' && (await E(() => window.overdub.liveRoom.isOpen()))) return true;
  await E(async () => { const o = window.overdub; if (o.liveRoom.isOpen()) o.liveRoom.close(); o.liveRoom.open({ screen: 'door' }); await new Promise((r) => setTimeout(r, 300)); });
  await key(page, 'Digit1');
  await page.waitForFunction(() => window.overdub.ui.state.liveRoom?.screen === 'guitar' && document.querySelector('.gr'), null, { timeout: 15000 }).catch(() => {});
  await sleep(400);
  return E(() => window.overdub.ui.state.liveRoom?.screen === 'guitar');
}
const gsAtPlug = (s) => s.E(async () => { const { gprefs } = await import('/app/src/ui/liveroom/guitar/prefs.js'); gprefs.set({ gs: { step: 'plug' } }); });
// the room's ways to open the input: 'tuner' (U on, U off, real key presses), 'gs' (Getting started's Plug in, then
// Skip), 'api' (audio.open with the picker's input)
async function plugIn(s, how = 'tuner') {
  const { page, E } = s;
  if (how === 'tuner') {
    await key(page, 'KeyU');
    await page.waitForFunction(() => window.overdub.input.audio.state.open, null, { timeout: 10000 }).catch(() => {});
    await sleep(500);
    await key(page, 'KeyU');
    await sleep(300);
  } else if (how === 'gs') {
    // (Getting started opens where it was left: a session that skipped past Plug in before comes back to Tune, whose
    // own way in is the tuner. This is its Plug in: the step it was left at is Plug in)
    await gsAtPlug(s);
    await E(() => window.overdub.liveRoom.press('gs'));
    await sleep(700);
    const b = page.locator('.gr-co-b.go', { hasText: 'Plug in' });
    if (await b.count()) await b.first().click();
    await page.waitForFunction(() => window.overdub.input.audio.state.open, null, { timeout: 10000 }).catch(() => {});
    await sleep(2500); // (the first strum picks the channel: the fake plays on input 2)
    await E(() => window.overdub.liveRoom.press('gs:skip'));
    await sleep(300);
  } else if (how === 'api') {
    await E(() => window.overdub.input.audio.open());
    await sleep(300);
  }
  return E(() => window.__amp.stateNow());
}
const measure = (s, o = {}) => s.E((o) => window.__amp.measure(o), o);

const CLUB = 'gate>mantisboost>recto>delay(off)>lobsterplate(off)>eq8';
function verdict(m, { ref = null, at = 'speaker' } = {}) {
  if (!m || m.error || !m.points) return { v: 'error', why: m?.error || 'no measurement', standIn: [] };
  const P = m.points, out = P[at] || P.speaker || P.master, st = m.state || {}, ins = m.inserts || [];
  const standIn = ins.filter((x) => x.inst !== 'live').map((x) => `${x.device}:${x.inst}`);
  const amp = ins.find((x) => /^amp\.|^core\.stack$/.test(x.device));
  let v;
  if (st.ctx !== 'running' || !m.complete || !out || !Number.isFinite(out.db) || out.db < -70) v = 'silent';
  else if (out.share < 0.03) v = !amp || amp.inst !== 'live' || amp.bypassed || !amp.on ? 'dry' : 'clean';
  else if (ref && st.chain === CLUB && out.share < ref * 0.6) v = 'partly';
  else v = 'wet';
  return { v, share: out?.share, db: out?.db, chainShare: P.chain?.share, chainDb: P.chain?.db, standIn };
}

/* ---- the run */
const args = process.argv.slice(2);
const N = args.includes('--n') ? Math.max(1, +args[args.indexOf('--n') + 1] || 1) : 4;
const REUSE = args.includes('--reuse');
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n').flatMap((a) => a.split(',')).filter(Boolean);
const browserName = /Google Chrome/.test(process.env.CHROMIUM || '') ? 'chrome' : 'chromium';
const SR = +process.env.SR || 0;
const rows = [];
let REF = null; // the club's stack, wet, as the first good measurement had it
let fails = 0;

function record(scen, rep, step, m, o = {}) {
  const v = verdict(m, { ref: o.ref === false ? null : REF, at: o.at || 'speaker' });
  // every pedal as the song says (bypassed when off, not when on; the gate and the EQ can't be told at this level)
  const ins = (m && m.inserts) || [];
  const mism = ins.filter((x) => x.inst === 'live' && x.bypassed != null && !/gate|eq8/.test(x.device) && !x.silent && (x.on ? x.bypassed : !x.bypassed && !/delay|plate|verb|echo/.test(x.device))).map((x) => `${x.device}:${x.on ? 'on-but-dry' : 'off-but-wet'}`);
  const st = (m && m.state) || {};
  const row = { scen, rep, step, v: v.v, share: v.share, db: v.db, chainShare: v.chainShare, chainDb: v.chainDb, pickDb: m?.points?.pick?.db, stripDb: m?.points?.strip?.db, mism, standIn: v.standIn, state: st, note: o.note || '' };
  if (mism.length && row.v === 'wet') row.v = 'pedal-stuck';
  if (v.standIn.length && row.v === 'wet') row.v = 'stand-in';
  const bad = row.v !== 'wet' && !(o.expect || []).includes(row.v);
  row.bad = bad;
  rows.push(row);
  console.log(`${bad ? 'XX' : 'ok'} ${scen}#${rep} ${step}: ${row.v} share ${row.share} ${row.db} dB | pick ${row.pickDb} strip ${row.stripDb} chain ${row.chainDb} | mon ${st.monitoring ? st.monitorTrack : 'off' + (st.monitorOff ? ':' + st.monitorOff : '')}${st.holds?.length ? ' held:' + st.holds.join('+') : ''} ch${st.channel} ${st.ctx}${st.path ? ' path:' + st.path.state : ''}${mism.length ? ' | ' + mism.join(',') : ''}${v.standIn.length ? ' | ' + v.standIn.join(',') : ''} | ${st.chain}`);
  if (bad) {
    // what each insert was doing: the stand-ins, the bypass against the song, the device's own word on itself
    for (const x of ins) console.log(`     ${x.i}. ${x.device}${x.on ? '' : ' (off)'}: ${x.inst}${x.bypassed ? ', passing its input' : ''}${x.silent ? ', silent' : ''}${x.g != null ? `, g ${x.g} res ${x.res} lag ${x.lag}` : ''}${x.health ? ' | health ' + JSON.stringify(x.health) : ''}`);
  }
  return row;
}
// measured now; if it isn't right, again 3 s later (a failure that stays is stuck, one that clears was passing)
async function check(s, scen, rep, step, o = {}) {
  await sleep(o.wait ?? 600);
  const r = record(scen, rep, step, await measure(s, { secs: 0.8 }), o);
  if (r.bad && !o.once) {
    await sleep(3000);
    const r2 = record(scen, rep, step + ' (+3 s)', await measure(s, { secs: 0.8 }), o);
    r.later = r2.v;
  }
  return r;
}
async function session(o = {}) {
  const s = await launch(o);
  await intoClub(s);
  await plugIn(s, o.how || 'tuner');
  return s;
}
const R = (s, fn, arg) => s.E(fn, arg);

// The footswitch race, on the page's own kit.js glide: the audio clock read once `skew` before the glide's later
// reads (Chrome's clock steps 5.8 ms at a time, even inside one task), on a gain wired in 25 ms later (a device built,
// then wired after the strip's dip). The gain must end where it was sent, on every browser.
async function race(rep) {
  const s = await PW.open('/app/style/tokens.css', {});
  try {
    const r = await s.page.evaluate(async () => {
      const { glide } = await import('/app/src/devices/kit.js');
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const c = new AudioContext();
      await c.resume();
      const k = c.createConstantSource(); k.start();
      const skewed = (skew) => { let reads = 0; return new Proxy(c, { get(t, p) { if (p === 'currentTime') return reads++ ? t.currentTime : t.currentTime - skew; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } }); };
      const out = [];
      for (const skew of [0, 0.0029, 0.0031, 0.0058, 0.0116]) {
        let stuck = 0, threw = 0;
        for (let i = 0; i < 6; i++) {
          const from = i % 2 ? 0 : 1, to = i % 2 ? 0.1778 : 0;
          const g = c.createGain(); g.gain.value = from;
          try { glide(skewed(skew), g.gain, to, 0.01); } catch { threw++; }
          await sleep(25);
          k.connect(g); const a = c.createAnalyser(); a.fftSize = 128; g.connect(a);
          await sleep(120);
          const b = new Float32Array(128); a.getFloatTimeDomainData(b);
          k.disconnect(g); g.disconnect();
          if (Math.abs(b[127] - to) > 1e-3) stuck++;
        }
        out.push({ skew, stuck, of: 6, threw });
      }
      await c.close();
      return { ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0], out };
    });
    for (const x of r.out) {
      const bad = x.stuck > 0;
      rows.push({ scen: 'race', rep, step: `clock moved ${(x.skew * 1000).toFixed(1)} ms`, v: bad ? 'stuck' : 'wet', bad, ...x });
      console.log(`${bad ? 'XX' : 'ok'} race#${rep} ${r.ua}: clock moved ${(x.skew * 1000).toFixed(1).padStart(4)} ms between reads: ${x.stuck}/${x.of} gains stuck${x.threw ? `, ${x.threw} threw` : ''}`);
    }
  } finally { await s.close(); }
}

// scenarios with a session of their own (cold ones, first visits) take (rep); the rest get (rep, s) on a session that
// has plugged in by the tuner and measured 'before'
const SCEN = {
  race,
  // a fresh browser each time: the room, the input opened by the tuner pedal (U on, U off)
  async cold(rep) {
    const s = await session();
    try {
      const r = await check(s, 'cold', rep, 'plugged in (tuner)', { ref: false });
      if (r.v === 'wet' && !REF) REF = r.share;
      await check(s, 'cold', rep, 'after 3 s', { wait: 3000 });
    } finally { await s.close(); }
  },
  async coldgs(rep) {
    const s = await session({ how: 'gs' });
    try { await check(s, 'coldgs', rep, 'plugged in (Getting started)'); } finally { await s.close(); }
  },
  async reload(rep, s) {
    for (let k = 0; k < 3; k++) {
      await s.page.reload({ waitUntil: 'load' });
      await reprobe(s);
      await sleep(800);
      const at = await R(s, () => window.overdub.ui.state.liveRoom?.screen);
      if (at !== 'guitar') await intoClub(s);
      await plugIn(s, 'tuner');
      await check(s, 'reload', rep, `reload ${k + 1} (room ${at === 'guitar' ? 'came back by itself' : 'entered'})`);
    }
  },
  async pick(rep, s) {
    await R(s, () => window.overdub.input.audio.useChannel('1'));
    await check(s, 'pick', rep, 'on input 1', { expect: ['silent'], once: true });
    await R(s, () => window.overdub.input.audio.useChannel('2'));
    await check(s, 'pick', rep, 'input 2 picked in place');
    await R(s, () => window.overdub.input.audio.setChannel('1'));
    await sleep(500);
    await R(s, () => window.overdub.input.audio.setChannel('2'));
    await check(s, 'pick', rep, 'input 1 then 2 by reopening');
  },
  // the browser's "Default - Scarlett" entry, the built-in mic, the Scarlett again, closed and the tuner
  async device(rep, s) {
    const devs = await R(s, () => window.overdub.input.audio.devices());
    const scar = devs.find((d) => /^Scarlett/.test(d.label)), def = devs.find((d) => d.id === 'default'), mic = devs.find((d) => /MacBook/.test(d.label));
    await R(s, (id) => window.overdub.input.audio.setDevice(id), def.id);
    await check(s, 'device', rep, 'the browser default ("Default - Scarlett")');
    await R(s, (id) => window.overdub.input.audio.setDevice(id), scar.id);
    await check(s, 'device', rep, 'the Scarlett picked again');
    await R(s, (id) => window.overdub.input.audio.setDevice(id), mic.id);
    await sleep(400);
    await R(s, (id) => window.overdub.input.audio.setDevice(id), scar.id);
    await check(s, 'device', rep, 'the mic, then the Scarlett');
    await R(s, () => window.overdub.input.audio.close());
    await sleep(300);
    await plugIn(s, 'tuner');
    await check(s, 'device', rep, 'closed, then the tuner opens it again');
  },
  // the context suspended and resumed; suspended with nobody resuming it, then a key in the room
  async suspend(rep, s) {
    await R(s, async () => { const c = window.overdub.engine.ctx; await c.suspend(); await new Promise((r) => setTimeout(r, 800)); await c.resume(); });
    await check(s, 'suspend', rep, 'suspended 0.8 s, resumed');
    await R(s, async () => { await window.overdub.engine.ctx.suspend(); });
    await sleep(500);
    await check(s, 'suspend', rep, 'suspended, nobody resumes it', { once: true, expect: ['silent'] });
    await plugIn(s, 'tuner');
    await check(s, 'suspend', rep, 'then the tuner, U U');
    await R(s, async () => { const c = window.overdub.engine.ctx; if (c.state !== 'running') await c.resume(); });
    await R(s, async () => { window.overdub.liveRoom.press('stomp:2'); const t = performance.now(); while (performance.now() - t < 400) { /* a stalled main thread */ } });
    await check(s, 'suspend', rep, 'a stomp under a 400 ms main-thread stall');
    await R(s, () => window.overdub.liveRoom.press('stomp:2'));
    await check(s, 'suspend', rep, 'stomped back');
  },
  // each of the first four pedals stomped 2-4 times, 5-60 ms apart; the song put back after an odd count
  async stomp(rep, s) {
    const board = await R(s, () => (document.querySelector('.gr')?.__gr?.rig.now()?.board || []).map((b) => b.device));
    for (let n = 1; n <= Math.min(4, board.length); n++) {
      for (const [gap, times] of [[15, 2], [15, 3], [60, 2], [5, 4]]) {
        for (let t = 0; t < times; t++) { await s.page.keyboard.press(`Digit${n}`); if (gap) await sleep(gap); }
        await frames(s.page);
        await check(s, 'stomp', rep, `pedal ${n} (${board[n - 1]}) x${times} @${gap}ms`, { wait: 400 });
        if (times % 2) { await s.page.keyboard.press(`Digit${n}`); await sleep(400); }
      }
    }
  },
  async knobs(rep, s) {
    const turn = (slot, k, v, commit = true) => R(s, ([slot, k, v, commit]) => document.querySelector('.gr').__gr.rig.turn(slot, k, v, { commit }), [slot, k, v, commit]);
    const amp = await R(s, () => document.querySelector('.gr').__gr.rig.now().amp.slot);
    for (let i = 0; i < 20; i++) { await turn(amp, 'gain', 4 + (i % 7), false); await sleep(16); }
    await turn(amp, 'gain', 6.8, true);
    await check(s, 'knobs', rep, 'gain dragged (20 moves at 60 Hz)');
    for (const cab of [1, 3, 7]) { await turn(amp, 'cab', cab); await sleep(40); }
    await check(s, 'knobs', rep, 'the cab changed three times, 40 ms apart');
    await turn(amp, 'mic', 2); await turn(amp, 'micpos', 0.8); await turn(amp, 'mic', 0); await turn(amp, 'micpos', 0.3);
    await check(s, 'knobs', rep, 'the mics moved and back');
    await turn(amp, 'level', 2); await sleep(200); await turn(amp, 'level', 6.2);
    await check(s, 'knobs', rep, 'master down and back');
  },
  // amps carried from the shop's wall, the club's stack loaded back, a try and its release, a carry undone
  async swap(rep, s) {
    const amps = await R(s, async () => { const D = await import('/app/src/ui/liveroom/guitar/shop-data.js'); return D.ampsBySection().flatMap((x) => x.amps || []).map((d) => d.id || d).filter((id) => typeof id === 'string'); });
    const pick = [amps[rep % amps.length], amps[(rep * 7 + 3) % amps.length], 'core.stack'].filter(Boolean);
    // (a clean amp reads clean: by design)
    for (const id of pick) {
      const r = await R(s, (id) => document.querySelector('.gr').__gr.parts.shop.carry({ link: { device: id, params: {}, on: true } }), id);
      await check(s, 'swap', rep, `carried ${id} (${r?.ok ? 'ok' : r?.error})`, { ref: false, expect: ['clean'] });
    }
    const r = await R(s, () => document.querySelector('.gr').__gr.parts.shop.load('house.metal.club'));
    await check(s, 'swap', rep, `the club's stack loaded back (${r?.ok ? 'ok' : r?.error})`);
    await R(s, (id) => document.querySelector('.gr').__gr.parts.shop.tryOn(id), pick[0]);
    await check(s, 'swap', rep, `trying ${pick[0]}`, { ref: false, expect: ['clean'] });
    await R(s, () => document.querySelector('.gr').__gr.parts.shop.release());
    await check(s, 'swap', rep, 'released');
    await R(s, (id) => document.querySelector('.gr').__gr.parts.shop.carry({ link: { device: id, params: {}, on: true } }), pick[1]);
    await sleep(300);
    await key(s.page, 'Meta+KeyZ');
    await check(s, 'swap', rep, 'carried, then ⌘Z');
  },
  async pedals(rep, s) {
    const a = await R(s, () => document.querySelector('.gr').__gr.rig.add({ device: 'pedal.drive', params: {}, on: true }));
    await check(s, 'pedals', rep, `a drive added (${a.ok ? 'ok' : a.error})`, { ref: false });
    const m = await R(s, () => { const g = document.querySelector('.gr').__gr, r = g.rig.now(); return g.rig.move(r.board.at(-1).slot, 0); });
    await check(s, 'pedals', rep, `the last pedal moved first (${m.ok ? 'ok' : m.error})`, { ref: false });
    await key(s.page, 'Meta+KeyZ');
    const d = await R(s, () => { const g = document.querySelector('.gr').__gr, x = g.rig.now().board.find((b) => b.device === 'pedal.drive'); return x ? g.rig.remove(x.slot) : { ok: false, error: 'no drive' }; });
    await check(s, 'pedals', rep, `the drive taken off (${d.ok ? 'ok' : d.error})`);
    for (let i = 0; i < 3; i++) { await R(s, () => document.querySelector('.gr').__gr.rig.add({ device: 'pedal.chorus', params: {}, on: true })); await sleep(30); await key(s.page, 'Meta+KeyZ'); }
    await check(s, 'pedals', rep, 'a chorus added and undone three times, fast');
  },
  async rack(rep, s) {
    const sv = await R(s, (n) => document.querySelector('.gr').__gr.parts.shop.save(n), `soak ${rep}`);
    await R(s, () => document.querySelector('.gr').__gr.parts.shop.carry({ link: { device: 'core.stack', params: {}, on: true } }));
    await sleep(500);
    const ld = sv?.id ? await R(s, (id) => document.querySelector('.gr').__gr.parts.shop.load(id), sv.id) : { ok: false, error: sv?.error };
    await check(s, 'rack', rep, `saved, carried the Half Stack, loaded the save (${ld?.ok ? 'ok' : ld?.error})`);
  },
  async glass(rep, s) {
    await key(s.page, 'Meta+KeyG');
    await sleep(500);
    await check(s, 'glass', rep, 'in the control room', { once: true, expect: ['silent', 'dry', 'partly', 'clean'] });
    await R(s, () => window.overdub.liveRoom.open({ screen: 'guitar' }));
    await sleep(600);
    await check(s, 'glass', rep, 'back through the glass');
    await R(s, () => window.overdub.liveRoom.close());
    await sleep(300);
    await intoClub(s);
    await check(s, 'glass', rep, 'out of the room, back in through the door');
    await R(s, () => window.overdub.liveRoom.press('tuner'));
    await sleep(300);
    await key(s.page, 'Meta+KeyG');
    await sleep(400);
    await R(s, () => window.overdub.liveRoom.open({ screen: 'guitar' }));
    await sleep(600);
    await check(s, 'glass', rep, 'left with the tuner on, came back');
  },
  async song(rep, s) {
    await R(s, () => window.overdub.exporter.newSong({ door: true }));
    await sleep(600);
    await intoClub(s);
    await check(s, 'song', rep, 'a new song, into the club (the input still open)');
  },
  async drums(rep, s) {
    await key(s.page, 'Space');
    await sleep(1500);
    await check(s, 'drums', rep, 'the drummer playing (at the chain)', { at: 'chain', ref: false });
    await key(s.page, 'Space');
    await sleep(2500);
    await check(s, 'drums', rep, 'the drummer stopped');
    await sleep(3000);
    await check(s, 'drums', rep, 'after the polite stop');
  },
  async take(rep, s) {
    await key(s.page, 'KeyR');
    await sleep(2000);
    await check(s, 'take', rep, 'recording (at the chain)', { at: 'chain', ref: false, once: true });
    await sleep(2500);
    await key(s.page, 'Space');
    await sleep(1500);
    // (the take plays back over the live guitar in review: partly is the take, not a fault)
    await check(s, 'take', rep, 'take stopped, in review', { expect: ['partly'] });
    await key(s.page, 'Enter');
    await sleep(1500);
    await check(s, 'take', rep, 'kept');
  },
  // the killswitch: the guitar back once the strips are renewed, with nothing else pressed
  async kill(rep, s) {
    await key(s.page, 'Shift+Escape');
    await check(s, 'kill', rep, 'after Shift+Esc', { wait: 2000 });
    await plugIn(s, 'tuner');
    await check(s, 'kill', rep, 'then the tuner, U U');
  },
  // the Jam room's close (it used to turn monitoring off first), then the room's tuner, then Getting started
  async jamclose(rep, s) {
    await R(s, () => { const a = window.overdub.input.audio; a.close(); });
    await sleep(300);
    await plugIn(s, 'tuner');
    await check(s, 'jamclose', rep, 'closed, then the tuner (U U)');
    await R(s, () => window.overdub.input.audio.close());
    await sleep(300);
    await plugIn(s, 'gs');
    await check(s, 'jamclose', rep, 'closed, then Getting started’s Plug in');
  },
  // Getting started's "Default - Scarlett" chip (it opens on input 1; the first strum picks input 2), a reload and the
  // tuner, then the Scarlett's own chip
  async chipdefault(rep, s) {
    await gsAtPlug(s);
    await R(s, () => window.overdub.liveRoom.press('gs'));
    await sleep(800);
    const chip = s.page.locator('.gr-co-chip', { hasText: 'Default - ' });
    const n = await chip.count();
    if (n) await chip.first().click();
    await sleep(3000);
    const ch = await R(s, () => window.overdub.input.audio.state.channel);
    await R(s, () => window.overdub.liveRoom.press('gs:skip'));
    await check(s, 'chipdefault', rep, `Getting started's "Default - Scarlett" chip (${n ? 'clicked' : 'no chip'}; input ${ch} after the strum)`);
    await s.page.reload({ waitUntil: 'load' });
    await reprobe(s);
    await sleep(800);
    if ((await R(s, () => window.overdub.ui.state.liveRoom?.screen)) !== 'guitar') await intoClub(s);
    await plugIn(s, 'tuner');
    await check(s, 'chipdefault', rep, 'reloaded, the tuner (U U)');
    await gsAtPlug(s);
    await R(s, () => window.overdub.liveRoom.press('gs'));
    await sleep(800);
    const own = s.page.locator('.gr-co-chip', { hasText: /^Scarlett/ });
    if (await own.count()) await own.first().click();
    await sleep(3000);
    await R(s, () => window.overdub.liveRoom.press('gs:skip'));
    await check(s, 'chipdefault', rep, 'then the "Scarlett" chip');
  },
  // the interface goes away (unplugged, the Mac slept: the track ends); the tuner opens it again
  async unplug(rep, s) {
    await R(s, () => { const st = (window.__streams || []).at(-1); const t = st && st.getAudioTracks()[0]; if (t) { t.stop(); t.dispatchEvent(new Event('ended')); } });
    await sleep(500);
    await check(s, 'unplug', rep, 'the input went away', { once: true, expect: ['silent'] });
    await plugIn(s, 'tuner');
    await check(s, 'unplug', rep, 'plugged back, the tuner (U U)');
  },
  // a song whose first audio track isn't the room's (an older Audio track, armed), loaded while the room is up
  async oldtrack(rep, s) {
    await R(s, async () => {
      const o = window.overdub, p = JSON.parse(JSON.stringify(o.store.get()));
      p.tracks.unshift({ id: 't_old' + Date.now().toString(36), name: 'Audio', kind: 'audio', arm: true, gain: 0, pan: 0, mute: false, solo: false, inserts: [], clips: [] });
      p.title = 'Another metal song';
      o.exporter.loadText(JSON.stringify(p), 'a song');
      await new Promise((r) => setTimeout(r, 1500));
    });
    const at = await R(s, () => window.overdub.ui.state.liveRoom?.screen);
    await check(s, 'oldtrack', rep, `another song with an armed Audio track first (screen: ${at})`);
  },
  // first visits (nothing remembered): R before plugging in (the take opens the input itself)
  async takefirst(rep) {
    const s = await launch({ aj: false });
    try {
      await intoClub(s);
      await key(s.page, 'KeyR');
      await sleep(2500);
      await check(s, 'takefirst', rep, 'R first: recording (at the chain)', { at: 'chain', once: true });
      await sleep(2000);
      await key(s.page, 'Space');
      await sleep(1500);
      await key(s.page, 'Escape');
      await sleep(800);
      await check(s, 'takefirst', rep, 'after the take');
    } finally { await s.close(); }
  },
  async firstgs(rep) {
    const s = await launch({ aj: false });
    try {
      await intoClub(s);
      await plugIn(s, 'gs');
      await check(s, 'firstgs', rep, 'a first visit, Getting started’s Plug in');
    } finally { await s.close(); }
  },
  // the input first opened by Sketch (the picker's device: none yet), input 2, then the room
  async sketchfirst(rep) {
    const s = await launch({ aj: false });
    try {
      await R(s, () => window.overdub.input.audio.open());
      await sleep(300);
      await R(s, () => window.overdub.input.audio.useChannel('2'));
      await intoClub(s);
      await check(s, 'sketchfirst', rep, 'opened by Sketch first, input 2, into the room');
      await plugIn(s, 'tuner');
      await check(s, 'sketchfirst', rep, 'then the tuner (U U)');
      await s.page.reload({ waitUntil: 'load' });
      await reprobe(s);
      await sleep(800);
      if ((await R(s, () => window.overdub.ui.state.liveRoom?.screen)) !== 'guitar') await intoClub(s);
      await plugIn(s, 'tuner');
      await check(s, 'sketchfirst', rep, 'reloaded, the tuner (U U)');
    } finally { await s.close(); }
  },
  // the remembered id no longer there (another USB port, site data cleared): never the voice-processed default
  async staleid(rep) {
    const s = await launch({ aj: false, input: { deviceId: 'f'.repeat(64), channel: '2', countIn: true } });
    try {
      await intoClub(s);
      await plugIn(s, 'tuner');
      const st = await R(s, () => { const x = window.overdub.input.audio.state; return { label: x.label, ch: x.settings.channelCount, ec: x.settings.echoCancellation, ns: x.settings.noiseSuppression, agc: x.settings.autoGainControl, err: x.error }; });
      const processed = !!(st.ec || st.ns || st.agc);
      await check(s, 'staleid', rep, `a stale remembered id, the tuner (opened ${st.label}, ${st.ch} ch${processed ? ', VOICE PROCESSING ON' : ''}${st.err ? ', ' + st.err : ''})`, { once: true });
      if (processed) { rows.push({ scen: 'staleid', rep, step: 'voice processing', v: 'processed', bad: true }); console.log('XX staleid: the input opened with the browser’s voice processing on'); }
      await sleep(4000);
      await check(s, 'staleid', rep, '4 s on', { once: true });
    } finally { await s.close(); }
  },
};
const OWN_SESSION = new Set(['race', 'cold', 'coldgs', 'takefirst', 'firstgs', 'sketchfirst', 'staleid']);

if (args.includes('--list')) { console.log(Object.keys(SCEN).join('\n')); process.exit(0); }
const list = only.length ? only : Object.keys(SCEN);
const unknown = list.filter((n) => !SCEN[n]);
if (unknown.length) { console.error(`amp-soak: no scenario ${unknown.join(', ')} (--list)`); process.exit(2); }
const OUT = process.env.OUT || path.join(OUTDIR, `${browserName}-${SR || 'default'}${only.length ? '-' + only.join('+') : ''}.json`);
console.log(`amp-soak on ${process.env.CHROMIUM || 'the harness’s Chromium'}${SR ? ' at ' + SR : ''}${process.env.LABELS === '0' ? ', no labels' : ''}${process.env.STRICT === '1' ? ', strict autoplay' : ''}: ${list.join(', ')} x${N}  (serving ${TREE})`);
const T0 = Date.now(), secs = {};
for (const name of list) {
  let s = null;
  const t0 = Date.now();
  for (let rep = 1; rep <= N; rep++) {
    const before = rows.filter((r) => r.bad).length;
    try {
      if (OWN_SESSION.has(name)) await SCEN[name](rep);
      else {
        if (!s) s = await session();
        else { await intoClub(s); await plugIn(s, 'tuner'); }
        let keep = false;
        try {
          const r0 = await check(s, name, rep, 'before', { once: true });
          if (r0.v === 'wet' && !REF) REF = r0.share;
          await SCEN[name](rep, s);
          keep = REUSE;
        } finally {
          if (s.errors.length) { rows.push({ scen: name, rep, step: 'page errors', v: 'errors', bad: true, errors: s.errors.slice(0, 6) }); console.log('XX page errors:', s.errors.slice(0, 3).join(' | ').slice(0, 400)); keep = false; }
          if (rows.filter((r) => r.bad).length > before) keep = false;
          if (!keep) { const x = s; s = null; await x.close(); }
        }
      }
    } catch (e) { console.log(`XX ${name}#${rep} threw: ${String(e && e.message).split('\n')[0]}`); rows.push({ scen: name, rep, step: 'threw', v: 'error', bad: true, error: String(e && e.message).slice(0, 300) }); }
  }
  if (s) await s.close();
  secs[name] = Math.round((Date.now() - t0) / 1000);
  console.log(`-- ${name}: ${N} cycles in ${secs[name]} s`);
}
fs.writeFileSync(OUT, JSON.stringify({ browser: process.env.CHROMIUM || 'chromium', sr: SR, ref: REF, n: N, reuse: REUSE, secs, rows }, null, 1));
const tally = {};
for (const r of rows) {
  const t = (tally[r.scen] ??= { n: 0, bad: {} });
  t.n++;
  if (r.bad) { const k = `${r.step.replace(/ \(\+3 s\)/, ' +3 s')}: ${r.v}`; t.bad[k] = (t.bad[k] || 0) + 1; fails++; }
}
console.log(`\n== amp-soak: ${rows.length} measurements, ${fails} failed (the club's stack wet at share ${REF}) in ${Math.round((Date.now() - T0) / 60000)} min`);
for (const [k, t] of Object.entries(tally)) { const b = Object.entries(t.bad); console.log(`${b.length ? 'XX' : 'ok'} ${k}: ${t.n} measured${b.length ? '' : ', all as expected'}`); for (const [w, n] of b) console.log(`     ${n}x ${w}`); }
console.log('rows ->', OUT);
process.exitCode = fails ? 1 : 0;
