// The live room's checks: the rooms in pixels [stream E] (docs/research/LIVE-ROOM-MODE.md §3.1, §3.13, §3.18, §3.19,
// §11.6). Run by tools/liveroom-test.js (ONLY=pixels), whose header says what a checks module exports.
//   1. every scene draws in Node into a pixel buffer, with fillStyle, fillRect and globalAlpha only, at whole pixels:
//      the four places and the bare room, each covering the whole 256 x 144 with its kick head's word on it and the
//      console ledge along its bottom
//   2. the same view gives the same pixels (whatever `now` is); a quiet view holds still; each signal moves what it
//      drives and nothing else moves (the amps with their own levels, the kick heads, the count, the reels, the dust
//      cover, the bulb, the lamp, the neon, the LAST CALL sign, the ledge's lamp, counter and needles)
//   3. reduced motion: hits and the beat change nothing; a level changes only the lamps, the meters and the counter
//   4. no red pixel in any scene, crop or cover (BRAND: red is the record light)
//   5. the door's crops, the tape box's covers (one spike per bar, the palette seeded by title, key and tempo) and the
//      phone's window (192 x 108, chosen by the step, panned in whole pixels)
//   6. (muted Chromium) the browser draws the Node buffer's pixels; whole scales at 1440, 1280 and 390 wide are exact
//      blocks; reduced motion from the browser's own setting; a frame's cost at 390 px with the CPU slowed 4x
//
// Exports beside the runner's: pixelBuffer(w, h) (the Node canvas the checks draw into), toPNG(buf, scale), isRed(r, g,
// b) (the definition the no-red checks hold), so the unit tests use the same ones.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as px from '../../app/src/ui/liveroom/pixels/index.js';
import * as sc from '../../app/src/ui/liveroom/pixels/scenes.js';
import { paletteOf } from '../../app/src/ui/liveroom/pixels/cover.js';
import { text, textWidth } from '../../app/src/ui/liveroom/pixels/paint.js';
import { LEDGE_PARTS } from '../../app/src/ui/liveroom/pixels/gear.js';

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
const hex = (b, x, y) => { const i = (y * b.width + x) * 4; return '#' + [b.data[i], b.data[i + 1], b.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); };
function draw(place, view = {}, now = 0) {
  const b = pixelBuffer(px.W, px.H);
  px.sceneOf(place).draw(b, { place, reduced: false, ...view }, now);
  return b;
}
const same = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
// the box round every pixel two buffers differ in, and how many: { n, x0, y0, x1, y1 } (n 0: the same)
function diff(a, b) {
  const d = { n: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, px: [] };
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
      d.n++; d.x0 = Math.min(d.x0, x); d.y0 = Math.min(d.y0, y); d.x1 = Math.max(d.x1, x); d.y1 = Math.max(d.y1, y);
      if (d.px.length < 4096) d.px.push([x, y]);
    }
  }
  return d;
}
const inBox = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const touches = (d, r) => d.px.some(([x, y]) => inBox(x, y, r));
const within = (d, rs) => d.px.every(([x, y]) => rs.some((r) => inBox(x, y, r)));
const grow = (r, m = 6) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const bbox = (d) => (d.n ? `${d.n} px in x ${d.x0}-${d.x1}, y ${d.y0}-${d.y1}` : 'nothing');
// where str is written in colour c at size k: every lit pixel of the font near that colour (a stage light over it is
// fine), most of the unlit ones in its box not. A word at a time, so a head's two lines are found too.
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function findText(b, str, c, k = 1) {
  const lit = new Set(), rec = { fillStyle: '', fillRect(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lit.add(`${x + i},${y + j}`); } };
  text(rec, str, 0, 0, '#ffffff', k);
  const pts = [...lit].map((p) => p.split(',').map(Number)), tw = textWidth(str, k), th = 5 * k, off = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (!lit.has(`${x},${y}`)) off.push([x, y]);
  const want = rgb(c), hits = [];
  const near = (x, y) => { const i = (y * b.width + x) * 4; return Math.max(Math.abs(b.data[i] - want[0]), Math.abs(b.data[i + 1] - want[1]), Math.abs(b.data[i + 2] - want[2])) <= 40; };
  for (let y = 0; y + th <= b.height; y++) for (let x = 0; x + tw <= b.width; x++) {
    if (!pts.every(([i, j]) => near(x + i, y + j))) continue;
    if (off.filter(([i, j]) => !near(x + i, y + j)).length >= off.length * 0.6) hits.push([x, y]);
  }
  return hits;
}
const findWords = (b, str, c, k = 1) => String(str).split(' ').every((w) => findText(b, w, c, k).length > 0);
function reds(b, x0 = 0, y0 = 0, w = b.width, h = b.height) {
  let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * b.width + x) * 4; if (isRed(b.data[i], b.data[i + 1], b.data[i + 2])) n++; }
  return n;
}
const colours = (b) => { const s = new Set(); for (let i = 0; i < b.data.length; i += 4) s.add((b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2]); return s; };
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
  let redSeen = 0, drawn = 0;
  const look = (b) => { redSeen += reds(b); drawn++; return b; };

  /* ---------------------------------------------------------------------------------------------- 1. every scene draws */
  {
    const rows = [], badCalls = [];
    for (const place of [...PLACES, null, 'nowhere']) {
      for (const [vn, v] of views(place)) {
        const b = look(draw(place, v));
        if (b.bad.size) badCalls.push(`${place} ${vn}: ${[...b.bad.keys()].join(', ')}`);
        let clear = 0;
        for (let i = 3; i < b.data.length; i += 4) if (b.data[i] !== 255) clear++;
        if (clear) badCalls.push(`${place} ${vn}: ${clear} px left unpainted`);
        if (vn === 'quiet') rows.push([place, colours(b).size, b.calls]);
      }
    }
    T.ok(!badCalls.length, `every scene (the four places, the bare room, an unknown place) paints all ${px.W} x ${px.H} with fillStyle, globalAlpha and whole-pixel fillRect only, in ${views('metal').length} views each${badCalls.length ? ': ' + badCalls.slice(0, 6).join('; ') : ''}`);
    T.ok(rows.every(([p, n]) => n >= (PLACES.includes(p) ? 40 : 8)), `each is a room, not a fill: ${rows.map(([p, n, c]) => `${p ?? 'none'} ${n} colours in ${c} rects`).join(', ')}`);
    const heads = PLACES.map((p) => { const b = draw(p, {}); return [p, findWords(b, sc.KICKS[p], sc.LOOK[p].headInk)]; });
    T.ok(heads.every(([, n]) => n >= 1), `each kick head carries its word: ${heads.map(([p, n]) => `${sc.KICKS[p]} (${p}, ${n ? 'found' : 'missing'})`).join(', ')}`);
    const led = PLACES.map((p) => { const b = draw(p, { bar: 3 }); const c = LEDGE_PARTS.counter; return findText(b, 'BAR 3', '#d9f36a').some(([x, y]) => inBox(x, y, c)); });
    T.ok(px.LEDGE === 14 && led.every(Boolean), `the console ledge along the bottom ${px.LEDGE} px of every scene, its counter in leader green: ${led.map((x, i) => `${PLACES[i]} ${x ? 'BAR 3' : 'no counter'}`).join(', ')}`);
    for (const p of PLACES) fs.writeFileSync(path.join(ctx.out, `pixels-${p}.png`), toPNG(draw(p, LOUD), 4));
    fs.writeFileSync(path.join(ctx.out, 'pixels-bare.png'), toPNG(draw(null, {}), 4));
  }

  /* ---------------------------------------------------------------------------------------------- 2. signals */
  {
    const unstable = [];
    for (const place of PLACES) for (const [vn, v] of views(place)) {
      const a = draw(place, v, 0), b = draw(place, v, 98765.4), c = pixelBuffer(px.W, px.H);
      px.sceneOf(place).draw(c, { place, reduced: false, ...JSON.parse(JSON.stringify(v)) }, 3);
      if (!same(a, b) || !same(a, c)) unstable.push(`${place} ${vn}`);
    }
    T.ok(!unstable.length, `the same view gives the same pixels, whatever now is and from a fresh scene (${PLACES.length * views('metal').length} views)${unstable.length ? ': not for ' + unstable.join(', ') : ''}`);
    const moved = [];
    for (const place of PLACES) {
      const q = { plugged: true, bar: 4, beat: 12 };
      const a = draw(place, q), b = draw(place, { ...q, beat: 13.5 }), c = draw(place, { ...q, beat: 12 }, 5000);
      if (!same(a, b) || !same(a, c)) moved.push(place);
    }
    T.ok(!moved.length, `a quiet room holds still: with no signal, another beat or another moment changes no pixel${moved.length ? ' (moved: ' + moved.join(', ') + ')' : ''}`);

    // each signal against a base, where it lands, and (where it's the only thing it drives) that nothing else moved
    const base = { plugged: true, bar: 4, beat: 12, heard: false };
    const lines = [], wrong = [];
    for (const place of PLACES) {
      const L = sc.LAYOUT[place], B = draw(place, base);
      const reelsBox = { metal: { x: 12, y: 118, w: 56, h: 22 }, basement: { x: 4, y: 86, w: 30, h: 14 }, bluesbar: { x: 222, y: 44, w: 30, h: 14 }, kitchen: { x: 138, y: 58, w: 38, h: 30 } }[place];
      const cases = [
        ['your input', { live: { input: 0.9 } }, place === 'kitchen' ? { x: 140, y: 60, w: 34, h: 22 } : grow(L.ampL), place === 'metal' ? null : [place === 'kitchen' ? { x: 140, y: 60, w: 34, h: 22 } : grow(L.ampL, 8)]],
        place === 'kitchen' ? ['the tape rolling', [base, { ...base, rolling: true }], reelsBox, [reelsBox]] : ['the tape rolling a beat on', [{ ...base, rolling: true }, { ...base, rolling: true, beat: 13 }], reelsBox, [reelsBox]],
        ['the talkback lamp', { talk: true }, LEDGE_PARTS.talk, [grow(LEDGE_PARTS.talk, 4)]],
        ['the master', { live: { master: [0.9, 0.8] } }, LEDGE_PARTS.vu[0], LEDGE_PARTS.vu],
        ['the counter', { bar: 17 }, LEDGE_PARTS.counter, [LEDGE_PARTS.counter, ...(place === 'kitchen' ? [reelsBox] : [])]],
        ['the count', { count: 3 }, place === 'kitchen' ? reelsBox : L.kit, [place === 'kitchen' ? reelsBox : L.kit]],
      ];
      if (place !== 'kitchen') {
        cases.push(['the kick', { live: { kick: 1 } }, L.kit, null]);
        cases.push(['the crash', { live: { crash: 1 } }, L.kit, null]);
        cases.push(['the bass', { live: { bass: 0.9 } }, grow(L.bass), [grow(L.bass, 8)]]);
        cases.push(['the left amp while you play the right', { side: 'R', doubled: true, live: { L: 0.9 } }, grow(L.ampL), null]);
      }
      if (place === 'metal' || place === 'basement') cases.push(['the dust cover off', { doubled: true }, L.ampR, [grow(L.ampR, 3)]]);
      if (place !== 'kitchen' && place !== 'bluesbar') cases.push(['the right amp with its own level', [{ ...base, doubled: true }, { ...base, doubled: true, live: { R: 0.9 } }], grow(L.ampR), [grow(L.ampR, 8)]]);
      if (place === 'bluesbar') {
        cases.push(['the neon on your first note', { heard: true }, { x: 90, y: 0, w: 76, h: 50 }, [{ x: 100, y: 0, w: 56, h: 50 }]]);
        cases.push(['the neon on the snare', [{ ...base, heard: true }, { ...base, heard: true, live: { snare: 1 } }], { x: 104, y: 14, w: 48, h: 14 }, null]);
        cases.push(['LAST CALL on the ending', { ending: true }, { x: 196, y: 6, w: 50, h: 28 }, [{ x: 192, y: 0, w: 60, h: 40 }]]);
      }
      if (place === 'basement') {
        cases.push(['the bulb on the kick', { live: { kick: 1 } }, { x: 76, y: 0, w: 60, h: 60 }, null]);
        cases.push(['the flyer with the title', { title: 'Void Weather' }, { x: 36, y: 30, w: 30, h: 26 }, [{ x: 36, y: 30, w: 30, h: 26 }]]);
      }
      if (place === 'kitchen') {
        cases.push(['the lamp on the shaker', { live: { shaker: 1 } }, { x: 96, y: 0, w: 48, h: 40 }, null]);
        cases.push(['the cajón on its hits', { live: { cajon: 1 } }, L.kit, [L.kit]]);
        cases.push(['the bass invited', { invited: { bass: true } }, L.bass, [grow(L.bass, 4)]]);
        cases.push(['the strings invited', { invited: { strings: true } }, { x: 8, y: 66, w: 26, h: 64 }, [{ x: 8, y: 66, w: 26, h: 64 }]]);
        cases.push(['the shaker invited', { invited: { shaker: true } }, { x: 176, y: 74, w: 12, h: 12 }, [{ x: 176, y: 74, w: 12, h: 12 }]]);
      }
      let ok = 0;
      for (const [what, v, at, only] of cases) {
        const [va, vb] = Array.isArray(v) ? v : [base, { ...base, ...v }];
        const d = diff(Array.isArray(v) ? draw(place, va) : B, look(draw(place, vb)));
        const lands = d.n > 0 && touches(d, at), stays = !only || within(d, only);
        if (lands && stays) ok++;
        else wrong.push(`${place}: ${what} ${!lands ? `doesn't move what it drives (${bbox(d)})` : `moves more than it drives (${bbox(d)})`}`);
      }
      lines.push(`${place} ${ok}/${cases.length}`);
    }
    T.ok(!wrong.length, `each signal moves what it drives and nothing else: ${lines.join(', ')}${wrong.length ? '; ' + wrong.slice(0, 6).join('; ') : ''}`);
    const counts = PLACES.map((p) => findText(draw(p, { count: 3 }), '3', p === 'kitchen' ? '#d9f36a' : sc.LOOK[p].headInk, 2).length);
    T.ok(counts.every((n) => n >= 1), `the count is on the kick head while it counts (a 3 on ${PLACES.slice(0, 3).map((p, i) => `${sc.KICKS[p]} ${counts[i] ? 'yes' : 'no'}`).join(', ')}; the kitchen's on the laptop ${counts[3] ? 'yes' : 'no'})`);
    const loads = PLACES.slice(0, 3).map((p) => findText(draw(p, { loading: 0.7 }), '70%', sc.LOOK[p].headInk).length > 0 && same(draw(p, { loading: 1 }), draw(p, {})));
    T.ok(loads.every(Boolean), `while the kit loads its kick head says how much is in (70% on ${PLACES.slice(0, 3).map((p, i) => `${sc.KICKS[p]} ${loads[i] ? 'yes' : 'no'}`).join(', ')}), and its word comes back once it's in`);
    const flyer = findText(draw('basement', { title: 'Void Weather' }), 'VOID', '#16130f').length;
    T.ok(flyer >= 1, `the basement's flyer carries the song's title once it has one (VOID ${flyer ? 'found' : 'missing'}), and 'Untitled' is no title: ${same(draw('basement', { title: 'Untitled' }), draw('basement', {})) ? 'the same flyer' : 'a different flyer'}`);
    const cover = PLACES.slice(0, 2).map((p) => {
      const ls = sc.LAYOUT[p].ampR, a = draw(p, {}), b = draw(p, { cards: [{ takes: { L: ['c1'], R: ['c2'] }, band: [] }] }), c = draw(p, { cards: [{ takes: { L: ['c1'], R: [] }, band: [] }] });
      return touches(diff(a, b), ls) && same(a, c);
    });
    T.ok(cover.every(Boolean), `the second amp's dust cover comes off once a card has a right take, read from the room's cards (${PLACES.slice(0, 2).join(', ')})`);
  }

  /* ---------------------------------------------------------------------------------------------- 3. reduced motion */
  {
    const still = [], lit = [], lamps = [], held = [];
    for (const place of PLACES) {
      const base = { reduced: true, plugged: true, rolling: true, bar: 6, beat: 20 };
      const a = look(draw(place, base)), b = look(draw(place, { ...base, beat: 22.5, count: null, live: { kick: 1, snare: 1, hat: 1, crash: 1, tom: 1, shaker: 1, cajon: 1 } }));
      if (!same(a, b)) still.push(`${place} (${bbox(diff(a, b))})`);
      const lv = { live: { input: 0.9, L: 0.8, R: 0.8, bass: 0.9, master: [0.9, 0.9] }, doubled: true };
      const c = look(draw(place, { ...base, doubled: true })), d = look(draw(place, { ...base, ...lv }));
      const dd = diff(c, d), lights = sc.lightsOf(place);
      if (!within(dd, lights)) lit.push(`${place} (${dd.px.filter(([x, y]) => !lights.some((r) => inBox(x, y, r))).length} px outside the lamps)`);
      if (!dd.n) lamps.push(place);
      const e = draw(place, { ...base, reduced: false, doubled: true }), f = draw(place, { ...base, reduced: false, ...lv });
      if (place !== 'kitchen' && within(diff(e, f), lights)) held.push(place);
    }
    T.ok(!still.length, `reduced motion: hits and the beat change nothing (no pump, sway, swing, shake or turning reel)${still.length ? ': ' + still.join(', ') : ''}`);
    T.ok(!lit.length && !lamps.length, `reduced motion: the lamps still light with their levels, and only the lamps, meters and counter change${lit.length ? ': ' + lit.join(', ') : ''}${lamps.length ? '; nothing lit in ' + lamps.join(', ') : ''}`);
    T.ok(!held.length, `without reduced motion the same levels move the gear too (cones, needles; the kitchen has none), so the mode is holding something${held.length ? ': not in ' + held.join(', ') : ''}`);
  }

  /* ---------------------------------------------------------------------------------------------- 4. the door's crops */
  {
    const bad = [], off = [];
    for (const place of PLACES) for (const size of [{ w: 168, h: 96 }, { w: 128, h: 72 }, { w: 84, h: 48 }, { w: 256, h: 130 }]) {
      const b = look(pixelBuffer(px.W + 8, px.H + 8));
      px.drawCrop(b, place, size);
      let outside = 0, unpainted = 0;
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
        const a = b.data[(y * b.width + x) * 4 + 3];
        if (x < size.w && y < size.h) { if (a !== 255) unpainted++; } else if (a) outside++;
      }
      if (b.bad.size || outside || unpainted) bad.push(`${place} ${size.w}x${size.h}: ${[...b.bad.keys()].join(', ')}${outside ? ` ${outside} px outside` : ''}${unpainted ? ` ${unpainted} px unpainted` : ''}`);
      // the crop is the still room's pixels, from above the ledge
      const full = draw(place, { reduced: true });
      let found = null;
      for (let dy = 0; dy + size.h <= px.H && !found; dy++) for (let dx = 0; dx + size.w <= px.W && !found; dx++) {
        let ok = true;
        for (let y = 0; y < size.h && ok; y += 3) for (let x = 0; x < size.w && ok; x += 3) if (hex(b, x, y) !== hex(full, dx + x, dy + y)) ok = false;
        if (ok) found = [dx, dy];
      }
      if (!found || found[1] + size.h > px.H - px.LEDGE) off.push(`${place} ${size.w}x${size.h}${found ? ` reaches y ${found[1] + size.h}` : ' matches no part of the room'}`);
      if (size.w === 168) {
        fs.writeFileSync(path.join(ctx.out, `pixels-crop-${place}.png`), toPNG(b, 3));
        if (!findWords(b, sc.KICKS[place], sc.LOOK[place].headInk)) off.push(`${place}'s card shows no ${sc.KICKS[place]}`);
      }
    }
    T.ok(!bad.length, `drawCrop paints exactly its size at (0, 0) with the allowed calls (4 places x 4 sizes)${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
    T.ok(!off.length, `each crop is the still room above the ledge, a 168 x 96 card showing its kick head's word${off.length ? ': ' + off.join('; ') : ''}`);
    const a = pixelBuffer(168, 96), b = pixelBuffer(168, 96), c = pixelBuffer(168, 96);
    px.drawCrop(a, 'metal', { w: 168, h: 96 }); px.drawCrop(b, 'metal', { w: 168, h: 96 }, { reduced: false, live: { kick: 1, crash: 1 } }); px.drawCrop(c, 'metal', { w: 168, h: 96 });
    T.ok(!same(a, b) && same(a, c), "a crop is still, and a view (a bar of the band on a focused card) moves it with the hits");
  }

  /* ---------------------------------------------------------------------------------------------- 5. the covers */
  {
    const song = { title: 'Void Weather', key: 'C minor', tempo: 132, bars: 24 };
    const cov = (c, size = { w: 128, h: 80 }) => { const b = pixelBuffer(size.w + 6, size.h + 6); px.drawCover(b, c, size); return look(b); };
    const bad = [];
    for (const size of [{ w: 128, h: 80 }, { w: 64, h: 40 }, { w: 104, h: 16 }]) {
      const b = cov(song, size);
      let outside = 0, unpainted = 0;
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
        const a = b.data[(y * b.width + x) * 4 + 3];
        if (x < size.w && y < size.h) { if (a !== 255) unpainted++; } else if (a) outside++;
      }
      if (b.bad.size || outside || unpainted) bad.push(`${size.w}x${size.h}: ${[...b.bad.keys()].join(', ')} ${outside} outside, ${unpainted} unpainted`);
    }
    const nul = cov(null);
    T.ok(!bad.length && !nul.bad.size, `drawCover paints exactly its size (128 x 80, 64 x 40, a 104 x 16 band) with the allowed calls, and a blank tape's cover too${bad.length ? ': ' + bad.join('; ') : ''}`);
    fs.writeFileSync(path.join(ctx.out, 'pixels-cover.png'), toPNG(cov(song), 4));
    // one spike per bar: round a circle just outside the hub, the runs of ink are the spikes
    const spikes = [8, 12, 24, 32].map((n) => {
      const c = { ...song, bars: n }, b = cov(c), pal = paletteOf(c), r = Math.max(2, 80 * 0.2) + 5, cx = 63.5, cy = 39.5;
      let runs = 0, prev = null, first = null;
      for (let i = 0; i < 720; i++) {
        const t = (i / 720) * Math.PI * 2, x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r), ink = hex(b, x, y) !== pal.ground;
        if (first === null) first = ink;
        if (ink && prev === false) runs++;
        prev = ink;
      }
      if (first && prev === false) runs++;
      return [n, runs];
    });
    T.ok(spikes.every(([n, r]) => n === r), `a cover has one spike per bar: ${spikes.map(([n, r]) => `${n} bars, ${r} spikes`).join('; ')}`);
    const A = cov(song), again = cov({ ...song });
    const changes = [['title', (i) => ({ ...song, title: `Song ${i}` })], ['key', (i) => ({ ...song, key: ['A minor', 'E', 'G', 'D minor', 'B♭'][i] })], ['tempo', (i) => ({ ...song, tempo: 90 + i * 17 })]].map(([what, f]) => {
      let n = 0;
      for (let i = 0; i < 5; i++) { const p = paletteOf(f(i)), q = paletteOf(song); if (p.ground !== q.ground || p.a !== q.a || p.b !== q.b) n++; }
      return [what, n];
    });
    const lens = cov({ ...song, bars: Array.from({ length: 24 }, (_, i) => (i % 3) / 2) });
    T.ok(same(A, again) && changes.every(([, n]) => n >= 3) && !same(A, lens) && json(paletteOf(song)) === json(paletteOf({ ...song, bars: [1, 0] })), `a cover's palette is seeded by the title, the key and the tempo (the same song, the same cover; another ${changes.map(([w, n]) => `${w}: ${n}/5`).join(', ')} new palettes), and the bars set the spikes, not the colours`);
    let coverReds = 0;
    for (let i = 0; i < 120; i++) { const b = cov({ title: `T${i}`, key: i % 2 ? 'C minor' : 'E', tempo: 60 + i, bars: 8 + (i % 40) }); coverReds += reds(b); }
    T.ok(coverReds === 0, `no red in 120 seeded covers (${coverReds} red px)`);
  }

  /* ---------------------------------------------------------------------------------------------- 6. the phone's window */
  {
    const bad = [];
    const fits = (wnd, b) => b.x >= wnd.x && b.x + b.w <= wnd.x + wnd.w && b.y >= wnd.y && b.y + b.h <= wnd.y + wnd.h;
    for (const place of PLACES.slice(0, 3)) {
      const L = sc.LAYOUT[place];
      const tries = [['soundcheck', { step: 'soundcheck' }, [L.ampL]], ['the other side', { step: 'double' }, [L.ampL, L.ampR]], ['playing the right', { side: 'R' }, [L.ampR]], ['a feel', { step: 'feel' }, [L.kit]], ['the bass', { focus: 'bass' }, [L.bass]]];
      for (const [what, v, boxes] of tries) {
        const w = px.windowFor({ place, reduced: true, ...v });
        const shape = w.w === 192 && w.h === 108 && [w.x, w.y].every(Number.isInteger) && w.x >= 0 && w.y >= 0 && w.x + w.w <= px.W && w.y + w.h <= px.H;
        if (!shape || !boxes.every((b) => fits(w, b))) bad.push(`${place} ${what}: ${JSON.stringify(w)}`);
      }
      const k = px.windowFor({ place, step: 'feel', reduced: true });
      if (k.y !== px.H - 108) bad.push(`${place}: the kit's window leaves the ledge out (y ${k.y})`);
    }
    const kw = px.windowFor({ place: 'kitchen', reduced: true }), K = sc.LAYOUT.kitchen;
    if (!(kw.w === 192 && kw.h === 72 && kw.y === 72 && fits(kw, K.kit))) bad.push(`kitchen: ${JSON.stringify(kw)}`);
    T.ok(!bad.length, `the phone's window is 192 x 108 (the kitchen's strip 192 x 72), whole pixels, framed on all of what the step is about: your amp and its lamps in the soundcheck, both amps for the other side, the kit for a feel (with the ledge), the bass${bad.length ? ': ' + bad.join('; ') : ''}`);
    px.windowFor({ place: 'metal', step: 'soundcheck', now: 1000, reduced: false });
    const xs = [], ys = [];
    for (let t = 1000; t <= 1240; t += 20) { const w = px.windowFor({ place: 'metal', step: 'feel', now: t, reduced: false }); xs.push(w.x); ys.push(w.y); }
    const from = px.windowFor({ place: 'metal', step: 'soundcheck', reduced: true }).x, to = px.windowFor({ place: 'metal', step: 'feel', reduced: true }).x;
    const mono = xs.every((x, i) => Number.isInteger(x) && Number.isInteger(ys[i]) && (i === 0 || ((to >= from ? x >= xs[i - 1] : x <= xs[i - 1]) && ys[i] >= ys[i - 1])));
    T.ok(from !== to && xs[0] === from && xs.at(-1) === to && xs[5] !== from && xs[5] !== to && mono && xs.indexOf(to) <= 11, `the window pans in whole pixels over 200 ms from the amp to the kit (x ${xs.join(' ')}; y ${ys.join(' ')})`);
    px.windowFor({ place: 'metal', step: 'soundcheck', now: 2000, reduced: false });
    const cut = px.windowFor({ place: 'metal', step: 'feel', now: 2010, reduced: true }).x, cut2 = (px.windowFor({ place: 'metal', step: 'soundcheck', now: 3000, reduced: false }), px.windowFor({ place: 'metal', step: 'feel' }).x);
    T.ok(cut === to && cut2 === to, `under reduced motion (or with no time) the window cuts instead of panning (x ${cut}, ${cut2})`);
  }

  /* ---------------------------------------------------------------------------------------------- 7. no red */
  T.ok(redSeen === 0, `no red pixel in any of the ${drawn} scenes, crops and covers drawn above (${redSeen} red px; red is the record light)`);

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
const json = (x) => JSON.stringify(x);
