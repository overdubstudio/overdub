// The guitar checks' page (window.__gt), shared by tools/guitar-test.js and tools/amp-rigs.js: the gear and the
// registry, a chain of devices rendered offline (optionally through the band's tail), clawd-o-matic's loudness, the
// house's test inputs. boot(page) puts it on a page opened with tools/pw.js open().
export const HELPERS = `
  const G = await import('/app/src/devices/guitar/index.js');
  const R = await import('/app/src/devices/registry.js');
  const TS = await import('/app/src/audio/testsignals.js');
  const M = await import('/app/src/audio/measure.js');
  const SR = 48000;
  // clawd-o-matic's loudness (vendor/pop-punk engine.js E.loudness: a +4 dB shelf at 1.5 kHz and a 38 Hz high-pass,
  // designed at 44.1 kHz as it is there, mean square of both channels, no gating): the number its levels were set by
  function clawdLufs(L, Rr, from = 0.5) {
    const hs = () => { const sr = 44100, w = 2 * Math.PI * 1500 / sr, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, 4 / 40), sA = 2 * Math.sqrt(A) * (s / 2) * Math.SQRT2;
      const b0 = A * (A + 1 + (A - 1) * c + sA), b1 = -2 * A * (A - 1 + (A + 1) * c), b2 = A * (A + 1 + (A - 1) * c - sA), a0 = A + 1 - (A - 1) * c + sA, a1 = 2 * (A - 1 - (A + 1) * c), a2 = A + 1 - (A - 1) * c - sA;
      const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0, z2: 0 };
      return (x) => { const y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; return y; }; };
    const hp = () => { const g = Math.tan(Math.PI * 38 / 44100), k = 1 / 0.5, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2; let s1 = 0, s2 = 0;
      return (x) => { const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3; s1 = 2 * v1 - s1; s2 = 2 * v2 - s2; return x - k * v1 - v2; }; };
    const sl = hs(), sr = hs(), hl = hp(), hr = hp();
    let ms = 0; const a = Math.round(from * SR), b = L.length;
    for (let i = a; i < b; i++) { const l = hl(sl(L[i])), r = hr(sr(Rr[i])); ms += l * l + r * r; }
    return -0.691 + 10 * Math.log10(ms / Math.max(1, b - a) + 1e-12);
  }
  // the band's master tail in clawd-o-matic (app.js): a soft clip at 4x and -1.5 dB
  function tail(c) {
    const clip = c.createWaveShaper(), n = 4096, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 4 - 2, q = Math.abs(x), y = q <= 0.85 ? q : 0.85 + 0.15 * Math.tanh((q - 0.85) / 0.15); cv[i] = x < 0 ? -y : y; }
    clip.curve = cv; clip.oversample = '4x';
    const trim = c.createGain(); trim.gain.value = Math.pow(10, -1.5 / 20);
    clip.connect(trim); return { input: clip, output: trim };
  }
  const inputs = {};
  const input = (kind = 'di', secs = 8) => { const k = kind + secs; if (!inputs[k]) inputs[k] = kind === 'bass' ? TS.bassDI(secs, SR) : TS.diStrum(secs, SR); return inputs[k]; };
  // render input through [{ device, params, on }] (offline, at bpm), optionally through the band's tail
  async function render(chain, x, { band = false, bpm = 170, extra = 0, insts } = {}) {
    const n = x.length + Math.round(extra * SR), c = new OfflineAudioContext(2, n, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
    b.copyToChannel(x, 0); src.buffer = b;
    let at = src;
    const made = [];
    for (let k = 0; k < chain.length; k++) {
      const s = chain[k], inst = await R.instantiate(c, s.device, { uid: 'u' + k + '-' + s.device, params: s.params || {}, on: s.on !== false, bpm });
      await inst.ready; made.push(inst);
      at.connect(inst.input); at = inst.output;
    }
    if (band) { const tl = tail(c); at.connect(tl.input); at = tl.output; }
    at.connect(c.destination); src.start(0);
    const r = await c.startRendering();
    for (const i of made) i.dispose();
    if (insts) insts.push(...made);
    return [r.getChannelData(0), r.getChannelData(1)];
  }
  const check = (chs) => { let pk = 0, bad = 0; for (const ch of chs) for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > pk) pk = Math.abs(v); } return { bad, peak: 20 * Math.log10(pk + 1e-12) }; };
  const tp = (chs) => Math.max(...chs.map((ch) => M.truePeak({ sampleRate: SR, numberOfChannels: 1, length: ch.length, getChannelData: () => ch })));
  window.__gt = { G, R, TS, M, SR, clawdLufs, tail, input, render, check, tp };
`;

export async function boot(page) {
  await page.addScriptTag({ type: 'module', content: HELPERS });
  await page.waitForFunction(() => window.__gt, null, { timeout: 30000 });
}
