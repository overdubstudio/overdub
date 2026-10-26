// @ts-check
// The click's sound (pure: Node and the browser). The engine plays it from a buffer made here (engine.js clickAt), so
// the click a person hears is the click tools/input-test.js measures against the drum kit.
//
//   clickSamples(sr, accent = false) -> Float32Array    one click: a wood-block knock (two bright partials and a
//                                                        body under them), 60 ms, its peak at CLICK.beat / CLICK.bar
//   CLICK = { beat, bar, f, ms }                         the peaks (linear), the knock's pitch, its length
//   sticksSamples(sr, accent = false) -> Float32Array   the drummer's count in the live room (engine.play's countIn
//                                                        voice 'sticks', docs/research/LIVE-ROOM-MODE.md §9.4): two
//                                                        sticks clicked together, 60 ms, peaking where the click does
//   STICKS = { beat, bar, f, ms }                        its peaks (linear), its main ring, its length
//
// Why this sound (docs/ux, 2026-10-05 capture diagnosis): the old click was a 1.3 kHz sine blip peaking at -14.9 dBFS
// (-9.9 on the bar). Under a tapped beat played back on the next pass, the kick was 14 dB and the snare 10 dB louder
// over the first 50 ms of each beat, so the pulse a person heard most was their own last pass, misses and all. This
// one peaks at -6 dBFS (-3 on the bar) and puts its energy at 1.8-5 kHz, over the kick's thump: over its first 50 ms,
// above 1.5 kHz, it is within 2 dB of Gobo Kit's snare (the bar's 3 dB over it) and 14 dB over its kick (the old one was
// 12 dB under the snare there). input-test measures it ("the click").

export const CLICK = { beat: 0.5, bar: 0.71, f: 1780, fBar: 2380, ms: 60 };

export function clickSamples(sr, accent = false) {
  const n = Math.round((CLICK.ms / 1000) * sr), x = new Float32Array(n);
  const f = accent ? CLICK.fBar : CLICK.f;
  // [frequency, level, decay (s)]: the knock, a brighter overtone that dies first, and a low body under them
  const parts = [[f, 1, 0.024], [f * 2.71, 0.5, 0.009], [f * 0.37, 0.22, 0.02]];
  const atk = Math.max(1, Math.round(0.0006 * sr));
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, a = i < atk ? i / atk : 1;
    let v = 0;
    for (const [fr, lv, tau] of parts) v += lv * Math.exp(-t / tau) * Math.sin(2 * Math.PI * fr * t);
    x[i] = v * a;
    pk = Math.max(pk, Math.abs(x[i]));
  }
  const g = (accent ? CLICK.bar : CLICK.beat) / (pk || 1);
  // (the last 2 ms fade to nothing, so the buffer's end is silent)
  const fade = Math.round(0.002 * sr);
  for (let i = 0; i < n; i++) x[i] *= g * (i > n - fade ? (n - i) / fade : 1);
  return x;
}

// The sticks: two hickory sticks clicked together over the kit. A crack of seeded noise (no Math.random: the count is
// the same knock in Node and in the page) rings two stiff wooden partials and a hollow under them, and it's over in a
// few tens of ms. Same peaks as the click (-6 dBFS, the bar -3), and over its first 50 ms, above 1.5 kHz, within a dB
// or so of it: tools/liveroom/checks-input.js measures both. Every sample comes from adds and multiplies on numbers
// fixed once per call, so Node and Chromium make it bit for bit.
export const STICKS = { beat: 0.5, bar: 0.71, f: 2650, fBar: 2800, ms: 60 };

export function sticksSamples(sr, accent = false) {
  const n = Math.round((STICKS.ms / 1000) * sr), x = new Float32Array(n);
  const f = accent ? STICKS.fBar : STICKS.f, hard = accent ? 1.5 : 1;
  // [frequency, level, decay (s)]: the two wooden modes and the hollow knock under them (a harder hit rings longer)
  const modes = [[f, 1, 0.0115], [f * 1.53, 0.7, 0.007], [f * 0.29, 0.3, 0.012]].map(([fr, lv, tau]) => {
    const r = Math.exp(-1 / (tau * hard * sr)), w = (2 * Math.PI * fr) / sr;
    return { a1: 2 * r * Math.cos(w), a2: -r * r, g: lv * (1 - r), y1: 0, y2: 0 };
  });
  // the crack: 1.2 ms of noise, falling off fast
  let s = 0x2545f491;
  const crack = Math.max(4, Math.round(0.0012 * sr)), fall = Math.exp(-1 / (0.0004 * sr));
  let env = 1, pk = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    if (i < crack) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; e = (s / 4294967296 - 0.5) * env; env *= fall; }
    let v = e * 0.35;
    for (const m of modes) { const y = m.a1 * m.y1 + m.a2 * m.y2 + m.g * e * 40; m.y2 = m.y1; m.y1 = y; v += y; }
    x[i] = v;
    pk = Math.max(pk, Math.abs(v));
  }
  const g = (accent ? STICKS.bar : STICKS.beat) / (pk || 1), fade = Math.round(0.003 * sr);
  for (let i = 0; i < n; i++) x[i] *= g * (i > n - fade ? (n - i) / fade : 1);
  return x;
}
