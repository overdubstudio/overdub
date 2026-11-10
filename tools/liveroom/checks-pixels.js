// The live room's checks: the rooms in pixels [stream E] (docs/research/LIVE-ROOM-MODE.md §3.1, §3.13, §3.18, §3.19,
// §11.6). Run by tools/liveroom-test.js (ONLY=pixels), whose header says what a checks module exports.
// The scenes in Node, what each signal moves, reduced motion, no red, the crops, the covers and the phone's window are
// test/unit/liveroom-scenes.test.js, which draws into this module's pixelBuffer. Here:
//   the PNGs to look at (tools/.out/liveroom/pixels-*.png), and
//   6. (muted Chromium) the browser draws the Node buffer's pixels; whole scales at 1440, 1280 and 390 wide are exact
//      blocks; reduced motion from the browser's own setting; a frame's cost at 390 px with the CPU slowed 4x
//
// Exports beside the runner's: pixelBuffer(w, h) (the Node canvas the checks draw into), toPNG(buf, scale), isRed(r, g,
// b) (the definition the no-red checks hold), so the unit tests use the same ones.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as px from '../../app/src/ui/liveroom/pixels/index.js';

export const name = 'pixels';
export const pages = true;


/* ------------------------------------------------------------------------------------------------ the Node canvas */
// A 2D context with only what the scenes may use: fillStyle ('#rrggbb'), globalAlpha and fillRect at whole pixels,
// blended source-over the way Chromium's canvas does it (an 8-bit alpha, rounded). Anything else it's asked for is
// counted in bad (and a call to it does nothing), so a check can say what a scene used that it mustn't.
export function pixelBuffer(w, h) {
  const data = new Uint8ClampedArray(w * h * 4), bad = new Map();
  const flag = (what) => bad.set(what, (bad.get(what) || 0) + 1);
  let fill = [0, 0, 0], style = '#000000', ga = 1, calls = 0;
  const state = {
    width: w, height: h, data, bad,
    get calls() { return calls; },
    get fillStyle() { return style; },
    set fillStyle(c) {
      const m = /^#([0-9a-f]{6})$/i.exec(String(c));
      if (!m) { flag(`fillStyle ${c}`); return; }
      const n = parseInt(m[1], 16);
      fill = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; style = '#' + m[1].toLowerCase();
    },
    get globalAlpha() { return ga; },
    set globalAlpha(a) { if (typeof a === 'number' && a >= 0 && a <= 1) ga = a; else flag(`globalAlpha ${a}`); },
    fillRect(x, y, rw, rh) {
      calls++;
      if (![x, y, rw, rh].every(Number.isInteger)) flag('fillRect off the pixel grid');
      let x0 = Math.round(rw < 0 ? x + rw : x), y0 = Math.round(rh < 0 ? y + rh : y), x1 = x0 + Math.round(Math.abs(rw)), y1 = y0 + Math.round(Math.abs(rh));
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
      const A = Math.round(ga * 255);
      if (A <= 0) return;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * w + xx) * 4;
        if (A >= 255) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255; continue; }
        const da = data[i + 3];
        if (da === 255) { for (let k = 0; k < 3; k++) data[i + k] = Math.round((fill[k] * A) / 255) + Math.round((data[i + k] * (255 - A)) / 255); continue; }
        const oa = A + (da * (255 - A)) / 255;
        for (let k = 0; k < 3; k++) data[i + k] = Math.round(((fill[k] * A) / 255 + ((data[i + k] * da) / 255) * ((255 - A) / 255)) * (255 / oa));
        data[i + 3] = Math.round(oa);
      }
    },
  };
  return new Proxy(state, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'string') flag(k); return () => {}; },
    set(t, k, v) { if (k in t) { t[k] = v; return true; } flag(`${String(k)} =`); return true; },
  });
}

// a buffer as a PNG, each pixel scale x scale (for looking at, in tools/.out/liveroom)
export function toPNG(buf, scale = 1) {
  const w = buf.width * scale, h = buf.height * scale, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / scale) * buf.width + Math.floor(x / scale)) * 4), d = y * (w * 4 + 1) + 1 + x * 4;
      raw[d] = buf.data[s]; raw[d + 1] = buf.data[s + 1]; raw[d + 2] = buf.data[s + 2]; raw[d + 3] = buf.data[s + 3];
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Red, as the record light is: a hue within 15 degrees of red, with chroma (the strongest channel over the weakest) of
// 64 or more and a saturation of 0.4 or more. Amber and ochre are further round the wheel; a brown, a dark wine or a
// pale pink has too little colour to read as one.
export function isRed(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < 64 || c / max < 0.4 || max !== r) return false;
  const hue = (60 * (g - b)) / c; // -60..60 around red
  return Math.abs(hue) <= 15;
}


// a PNG's pixels (8-bit RGB or RGBA, not interlaced: what Chromium's screenshots are)
export function fromPNG(buf) {
  let o = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9]; }
    else if (kind === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < bpp ? line[x * bpp + k] : 255;
    prev = line;
  }
  return { width: w, height: h, data: out };
}

/* ------------------------------------------------------------------------------------------------ helpers */
const PLACES = ['metal', 'basement', 'bluesbar', 'kitchen'];
function draw(place, view = {}, now = 0) {
  const b = pixelBuffer(px.W, px.H);
  px.sceneOf(place).draw(b, { place, reduced: false, ...view }, now);
  return b;
}
const LOUD = { plugged: true, rolling: true, beat: 9.5, bar: 3, talk: true, heard: true, ending: true, doubled: true, title: 'Void Weather', invited: { shaker: true, cajon: true, bass: true, strings: true }, live: { input: 0.9, L: 0.7, R: 0.8, kick: 1, snare: 0.8, hat: 0.6, crash: 0.7, tom: 0.5, bass: 0.8, shaker: 0.9, cajon: 0.9, master: [0.8, 0.7] } };
const views = (place) => [
  ['quiet', {}],
  ['loud', LOUD],
  ['count', { plugged: true, rolling: true, beat: 1, count: 2, live: { input: 0.4 } }],
  ['the other side', { plugged: true, rolling: true, beat: 33, side: 'R', live: { input: 0.8, L: 0.6, kick: 0.8, bass: 0.5, master: [0.6, 0.6] } }],
  ['learning', { plugged: true, run: 'read', bar: 9 }],
  ['reduced, loud', { ...LOUD, reduced: true }],
  ['crash', { plugged: true, rolling: true, beat: 16, live: { crash: 1, snare: 1, kick: 1, input: 1 } }],
].map(([n, v]) => [n, { place, ...v }]);

export async function run(T, ctx) {
  // the rooms to look at (tools/.out/liveroom/pixels-*.png)
  for (const p of PLACES) {
    fs.writeFileSync(path.join(ctx.out, `pixels-${p}.png`), toPNG(draw(p, LOUD), 4));
    const b = pixelBuffer(px.W + 8, px.H + 8);
    px.drawCrop(b, p, { w: 168, h: 96 });
    fs.writeFileSync(path.join(ctx.out, `pixels-crop-${p}.png`), toPNG(b, 3));
  }
  fs.writeFileSync(path.join(ctx.out, 'pixels-bare.png'), toPNG(draw(null, {}), 4));
  const cover = pixelBuffer(134, 86);
  px.drawCover(cover, { title: 'Void Weather', key: 'C minor', tempo: 132, bars: 24 }, { w: 128, h: 80 });
  fs.writeFileSync(path.join(ctx.out, 'pixels-cover.png'), toPNG(cover, 4));

  /* ---------------------------------------------------------------------------------------------- 8. in the browser */
  if (!ctx.pages) { T.note('PAGES=0: the browser checks skipped'); return; }
  // (pw.js only now, so the unit tests that use this module's buffer don't load the server)
  const { open } = await import('../pw.js');
  const s = await open('/app/src/ui/liveroom/pixels/index.js', { width: 1440, height: 900 });
  try {
    const { page } = s;
    await page.evaluate(async () => { window.__px = await import('/app/src/ui/liveroom/pixels/index.js'); document.body.replaceChildren(); document.body.style.margin = '0'; document.body.style.background = '#141210'; });
    // the browser draws the Node buffer's pixels, through a context that counts what it's asked for
    const drawIn = (place, view) => page.evaluate(({ place, view }) => {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
      const g = cv.getContext('2d'), used = new Set();
      const rec = new Proxy({
        get fillStyle() { return g.fillStyle; }, set fillStyle(c) { g.fillStyle = c; },
        get globalAlpha() { return g.globalAlpha; }, set globalAlpha(a) { g.globalAlpha = a; },
        fillRect(x, y, w, h) { g.fillRect(x, y, w, h); },
      }, { get(t, k) { if (k in t) return t[k]; used.add(String(k)); return () => {}; }, set(t, k, v) { if (k in t) { t[k] = v; return true; } used.add(String(k)); return true; } });
      window.__px.sceneOf(place).draw(rec, view, performance.now());
      const d = g.getImageData(0, 0, 256, 144).data;
      let bin = '';
      for (let i = 0; i < d.length; i += 8192) bin += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
      return { data: btoa(bin), used: [...used] };
    }, { place, view });
    const cmp = [], used = [];
    let worst = 0, exact = 0, total = 0;
    for (const place of [...PLACES, null]) for (const [vn, v] of views(place).filter(([n]) => n !== 'learning')) {
      const view = { place, reduced: false, ...v }, got = await drawIn(place, view), node = draw(place, view);
      const data = Buffer.from(got.data, 'base64');
      if (got.used.length) used.push(`${place} ${vn}: ${got.used.join(', ')}`);
      let max = 0, ex = 0;
      for (let i = 0; i < data.length; i += 4) {
        const m = Math.max(Math.abs(data[i] - node.data[i]), Math.abs(data[i + 1] - node.data[i + 1]), Math.abs(data[i + 2] - node.data[i + 2]));
        if (m > max) max = m;
        if (!m) ex++;
      }
      worst = Math.max(worst, max); exact += ex; total += data.length / 4;
      if (max > 3) cmp.push(`${place} ${vn}: off by ${max}`);
    }
    T.ok(!used.length, `in Chromium the scenes ask the canvas for fillStyle, globalAlpha and fillRect only${used.length ? ': ' + used.slice(0, 4).join('; ') : ''}`);
    T.ok(!cmp.length, `Chromium draws the Node buffer's pixels: ${((exact / total) * 100).toFixed(2)}% exact, the rest within ${worst} of 255 (alpha rounding) over ${PLACES.length + 1} scenes x ${views('metal').length - 1} views${cmp.length ? ': ' + cmp.slice(0, 4).join('; ') : ''}`);

    // whole scales: each scene pixel an exact block of device pixels (a page of its own at each size and density)
    const scales = [];
    const atSize = async (width, height, dpr, phone) => {
      const c2 = await s.browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: phone });
      const p2 = await c2.newPage();
      p2.on('pageerror', (e) => s.errors.push('pageerror: ' + (e?.stack || e)));
      await p2.goto(s.url, { waitUntil: 'load' });
      await p2.evaluate(async () => { window.__px = await import('/app/src/ui/liveroom/pixels/index.js'); document.body.replaceChildren(); document.body.style.margin = '0'; document.body.style.background = '#141210'; });
      return { c2, p2 };
    };
    const SCALE_VIEW = { place: 'metal', reduced: false, plugged: true, bar: 3, live: { input: 0.7, kick: 1, crash: 0.5, master: [0.6, 0.5] } };
    for (const [width, height, dpr, k, phone] of [[1440, 900, 1, 4, false], [1280, 800, 1, 3, false], [1280, 800, 2, 3, false], [390, 844, 3, 2, true]]) {
      const { c2, p2 } = await atSize(width, height, dpr, phone);
      const wnd = phone ? px.windowFor({ place: 'metal', step: 'double', reduced: true }) : { x: 0, y: 0, w: px.W, h: px.H };
      const box = await p2.evaluate(({ k, wnd, view }) => {
        const frame = document.createElement('div'), cv = document.createElement('canvas');
        cv.width = 256; cv.height = 144;
        Object.assign(frame.style, { position: 'absolute', left: '3px', top: '5px', width: wnd.w * k + 'px', height: wnd.h * k + 'px', overflow: 'hidden' });
        Object.assign(cv.style, { display: 'block', width: 256 * k + 'px', height: 144 * k + 'px', imageRendering: 'pixelated', transform: `translate(${-wnd.x * k}px, ${-wnd.y * k}px)` });
        frame.append(cv); document.body.append(frame);
        window.__px.sceneOf('metal').draw(cv.getContext('2d'), view, 0);
        const r = frame.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, scroll: document.documentElement.scrollWidth, inner: window.innerWidth };
      }, { k, wnd, view: SCALE_VIEW });
      const png = await p2.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h }, scale: 'device' });
      const shot = fromPNG(png), node = draw('metal', SCALE_VIEW), n = k * dpr;
      let off = 0, max = 0;
      for (let y = 0; y < shot.height; y++) for (let x = 0; x < shot.width; x++) {
        const sx = wnd.x + Math.floor(x / n), sy = wnd.y + Math.floor(y / n), i = (y * shot.width + x) * 4, j = (sy * px.W + sx) * 4;
        const m = Math.max(Math.abs(shot.data[i] - node.data[j]), Math.abs(shot.data[i + 1] - node.data[j + 1]), Math.abs(shot.data[i + 2] - node.data[j + 2]));
        if (m > 3) off++;
        max = Math.max(max, m);
      }
      const dims = shot.width === wnd.w * n && shot.height === wnd.h * n;
      scales.push({ ok: dims && !off && box.x + box.w <= width && box.scroll <= box.inner, line: `${width} px${dpr > 1 ? ` at ${dpr}x` : ''}: ${phone ? 'the window ' : ''}${wnd.w * k} x ${wnd.h * k} at x${k} (${shot.width} x ${shot.height} device px)${dims ? '' : ' wrong size'}${off ? `, ${off} px off by up to ${max}` : ''}` });
      if (dpr === 1 || phone) fs.writeFileSync(path.join(ctx.out, `pixels-${width}${phone ? '-phone' : ''}.png`), png);
      await c2.close();
    }
    T.ok(scales.every((x) => x.ok), `whole scales hold: every scene pixel an exact block of device pixels, fitting the width: ${scales.map((x) => x.line).join('; ')}`);

    // reduced motion from the browser's own setting (the view leaves it out)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const hits = { place: 'basement', plugged: true, rolling: true, beat: 13, bar: 4, live: { kick: 1, crash: 1, input: 0.6 } };
    const red1 = Buffer.from((await drawIn('basement', hits)).data, 'base64'), want = draw('basement', { ...hits, reduced: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const red0 = Buffer.from((await drawIn('basement', hits)).data, 'base64');
    const near = (a, b) => a.every((v, i) => Math.abs(v - b.data[i]) <= 3);
    T.ok(near(red1, want) && !near(red0, want), "with the browser's prefers-reduced-motion and no reduced in the view, the scene holds still as if it were told; without it, it moves");

    // a frame's cost on a phone: 390 px at 3x, the CPU slowed 4x
    const phone = await atSize(390, 844, 3, true), pcdp = await phone.c2.newCDPSession(phone.p2);
    await pcdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const cost = await phone.p2.evaluate(async (places) => {
      document.body.replaceChildren();
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 144;
      Object.assign(cv.style, { width: '512px', height: '288px', imageRendering: 'pixelated' });
      document.body.append(cv);
      const g = cv.getContext('2d'), out = {};
      for (const place of places) {
        const sc = window.__px.sceneOf(place), ts = [];
        for (let i = 0; i < 90; i++) {
          const v = { place, reduced: false, plugged: true, rolling: true, beat: i * 0.25, live: { input: (i % 7) / 7, L: (i % 5) / 5, R: (i % 3) / 3, kick: i % 4 ? 0 : 1, snare: i % 8 === 4 ? 1 : 0, hat: 0.5, crash: i % 16 ? 0 : 1, bass: 0.6, shaker: i % 2, cajon: i % 4 ? 0 : 1, master: [0.6, 0.5] }, heard: true, doubled: i > 40, invited: { shaker: true, cajon: true, bass: true, strings: true } };
          const t0 = performance.now(); sc.draw(g, v, t0); g.getImageData(0, 0, 1, 1); ts.push(performance.now() - t0);
          await new Promise((r) => requestAnimationFrame(r));
        }
        ts.sort((a, b) => a - b);
        out[place] = { median: ts[ts.length >> 1], p95: ts[Math.floor(ts.length * 0.95)] };
      }
      return out;
    }, PLACES);
    await pcdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await phone.c2.close();
    const worstP95 = Math.max(...Object.values(cost).map((c) => c.p95));
    T.ok(worstP95 < 8, `a frame's cost at 390 px with the CPU slowed 4x: ${Object.entries(cost).map(([p, c]) => `${p} ${c.median.toFixed(1)} ms median, ${c.p95.toFixed(1)} p95`).join('; ')} (budget: p95 under 8 of 16.7 ms, as the Weave's)`);
    T.ok(!s.errors.length, `no page errors${s.errors.length ? ': ' + s.errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await s.close();
  }
}
