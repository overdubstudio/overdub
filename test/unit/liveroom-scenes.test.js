// The rooms in pixels (docs/research/LIVE-ROOM-MODE.md §3.1, §3.13, §3.18, §3.19, §11.6), the Node checks of
// tools/liveroom/checks-pixels.js, moved here whole (liveroom-pixels.test.js holds a smaller first pass): every scene
// paints all of itself with the allowed calls; the same view gives the same pixels; each signal moves what it drives and
// nothing else; reduced motion; the door's crops, the covers and the phone's window; and no red in any of them, counted
// over everything drawn here, which is why this is one test. The browser drawing the same pixels stays there.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import * as px from '../../app/src/ui/liveroom/pixels/index.js';
import * as sc from '../../app/src/ui/liveroom/pixels/scenes.js';
import { paletteOf } from '../../app/src/ui/liveroom/pixels/cover.js';
import { text, textWidth } from '../../app/src/ui/liveroom/pixels/paint.js';
import { LEDGE_PARTS } from '../../app/src/ui/liveroom/pixels/gear.js';
import { pixelBuffer, isRed } from '../../tools/liveroom/checks-pixels.js';

const json = (x) => JSON.stringify(x);
const PLACES = ['metal', 'basement', 'bluesbar', 'kitchen'];
const hex = (b, x, y) => {
  const i = (y * b.width + x) * 4;
  return '#' + [b.data[i], b.data[i + 1], b.data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
};
function draw(place, view = {}, now = 0) {
  const b = pixelBuffer(px.W, px.H);
  px.sceneOf(place).draw(b, { place, reduced: false, ...view }, now);
  return b;
}
const same = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
// the box round every pixel two buffers differ in, and how many: { n, x0, y0, x1, y1 } (n 0: the same)
function diff(a, b) {
  const d = { n: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, px: [] };
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
        d.n++;
        d.x0 = Math.min(d.x0, x);
        d.y0 = Math.min(d.y0, y);
        d.x1 = Math.max(d.x1, x);
        d.y1 = Math.max(d.y1, y);
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
  const lit = new Set(),
    rec = {
      fillStyle: '',
      fillRect(x, y, w, h) {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lit.add(`${x + i},${y + j}`);
      },
    };
  text(rec, str, 0, 0, '#ffffff', k);
  const pts = [...lit].map((p) => p.split(',').map(Number)),
    tw = textWidth(str, k),
    th = 5 * k,
    off = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (!lit.has(`${x},${y}`)) off.push([x, y]);
  const want = rgb(c),
    hits = [];
  const near = (x, y) => {
    const i = (y * b.width + x) * 4;
    return (
      Math.max(Math.abs(b.data[i] - want[0]), Math.abs(b.data[i + 1] - want[1]), Math.abs(b.data[i + 2] - want[2])) <=
      40
    );
  };
  for (let y = 0; y + th <= b.height; y++)
    for (let x = 0; x + tw <= b.width; x++) {
      if (!pts.every(([i, j]) => near(x + i, y + j))) continue;
      if (off.filter(([i, j]) => !near(x + i, y + j)).length >= off.length * 0.6) hits.push([x, y]);
    }
  return hits;
}
const findWords = (b, str, c, k = 1) =>
  String(str)
    .split(' ')
    .every((w) => findText(b, w, c, k).length > 0);
function reds(b, x0 = 0, y0 = 0, w = b.width, h = b.height) {
  let n = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * b.width + x) * 4;
      if (isRed(b.data[i], b.data[i + 1], b.data[i + 2])) n++;
    }
  return n;
}
const colours = (b) => {
  const s = new Set();
  for (let i = 0; i < b.data.length; i += 4) s.add((b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2]);
  return s;
};
const LOUD = {
  plugged: true,
  rolling: true,
  beat: 9.5,
  bar: 3,
  talk: true,
  heard: true,
  ending: true,
  doubled: true,
  title: 'Void Weather',
  invited: { shaker: true, cajon: true, bass: true, strings: true },
  live: {
    input: 0.9,
    L: 0.7,
    R: 0.8,
    kick: 1,
    snare: 0.8,
    hat: 0.6,
    crash: 0.7,
    tom: 0.5,
    bass: 0.8,
    shaker: 0.9,
    cajon: 0.9,
    master: [0.8, 0.7],
  },
};
const views = (place) =>
  [
    ['quiet', {}],
    ['loud', LOUD],
    ['count', { plugged: true, rolling: true, beat: 1, count: 2, live: { input: 0.4 } }],
    [
      'the other side',
      {
        plugged: true,
        rolling: true,
        beat: 33,
        side: 'R',
        live: { input: 0.8, L: 0.6, kick: 0.8, bass: 0.5, master: [0.6, 0.6] },
      },
    ],
    ['learning', { plugged: true, run: 'read', bar: 9 }],
    ['reduced, loud', { ...LOUD, reduced: true }],
    ['crash', { plugged: true, rolling: true, beat: 16, live: { crash: 1, snare: 1, kick: 1, input: 1 } }],
  ].map(([n, v]) => [n, { place, ...v }]);

test('every scene, signal, crop, cover and window, and no red in any of them', async () => {
  const T = checks();
  let redSeen = 0,
    drawn = 0;
  const look = (b) => {
    redSeen += reds(b);
    drawn++;
    return b;
  };

  /* ---------------------------------------------------------------------------------------------- 1. every scene draws */
  {
    const rows = [],
      badCalls = [];
    for (const place of [...PLACES, null, 'nowhere', '__proto__', 'toString']) {
      for (const [vn, v] of views(place)) {
        const b = look(draw(place, v));
        if (b.bad.size) badCalls.push(`${place} ${vn}: ${[...b.bad.keys()].join(', ')}`);
        let clear = 0;
        for (let i = 3; i < b.data.length; i += 4) if (b.data[i] !== 255) clear++;
        if (clear) badCalls.push(`${place} ${vn}: ${clear} px left unpainted`);
        if (vn === 'quiet') rows.push([place, colours(b).size, b.calls]);
      }
    }
    T.ok(
      !badCalls.length,
      `every scene (the four places, the bare room, an unknown place, '__proto__' and 'toString') paints all ${px.W} x ${px.H} with fillStyle, globalAlpha and whole-pixel fillRect only, in ${views('metal').length} views each${badCalls.length ? ': ' + badCalls.slice(0, 6).join('; ') : ''}`,
    );
    T.ok(
      rows.every(([p, n]) => n >= (PLACES.includes(p) ? 40 : 8)),
      `each is a room, not a fill: ${rows.map(([p, n, c]) => `${p ?? 'none'} ${n} colours in ${c} rects`).join(', ')}`,
    );
    const heads = PLACES.map((p) => {
      const b = draw(p, {});
      return [p, findWords(b, sc.KICKS[p], sc.LOOK[p].headInk)];
    });
    T.ok(
      heads.every(([, n]) => n >= 1),
      `each kick head carries its word: ${heads.map(([p, n]) => `${sc.KICKS[p]} (${p}, ${n ? 'found' : 'missing'})`).join(', ')}`,
    );
    const led = PLACES.map((p) => {
      const b = draw(p, { bar: 3 });
      const c = LEDGE_PARTS.counter;
      return findText(b, 'BAR 3', '#d9f36a').some(([x, y]) => inBox(x, y, c));
    });
    T.ok(
      px.LEDGE === 14 && led.every(Boolean),
      `the console ledge along the bottom ${px.LEDGE} px of every scene, its counter in leader green: ${led.map((x, i) => `${PLACES[i]} ${x ? 'BAR 3' : 'no counter'}`).join(', ')}`,
    );
  }

  /* ---------------------------------------------------------------------------------------------- 2. signals */
  {
    const unstable = [];
    for (const place of PLACES)
      for (const [vn, v] of views(place)) {
        const a = draw(place, v, 0),
          b = draw(place, v, 98765.4),
          c = pixelBuffer(px.W, px.H);
        px.sceneOf(place).draw(c, { place, reduced: false, ...JSON.parse(JSON.stringify(v)) }, 3);
        if (!same(a, b) || !same(a, c)) unstable.push(`${place} ${vn}`);
      }
    T.ok(
      !unstable.length,
      `the same view gives the same pixels, whatever now is and from a fresh scene (${PLACES.length * views('metal').length} views)${unstable.length ? ': not for ' + unstable.join(', ') : ''}`,
    );
    const moved = [];
    for (const place of PLACES) {
      const q = { plugged: true, bar: 4, beat: 12 };
      const a = draw(place, q),
        b = draw(place, { ...q, beat: 13.5 }),
        c = draw(place, { ...q, beat: 12 }, 5000);
      if (!same(a, b) || !same(a, c)) moved.push(place);
    }
    T.ok(
      !moved.length,
      `a quiet room holds still: with no signal, another beat or another moment changes no pixel${moved.length ? ' (moved: ' + moved.join(', ') + ')' : ''}`,
    );

    // each signal against a base, where it lands, and (where it's the only thing it drives) that nothing else moved
    const base = { plugged: true, bar: 4, beat: 12, heard: false };
    const lines = [],
      wrong = [];
    for (const place of PLACES) {
      const L = sc.LAYOUT[place],
        B = draw(place, base);
      const reelsBox = {
        metal: { x: 12, y: 118, w: 56, h: 22 },
        basement: { x: 4, y: 86, w: 30, h: 14 },
        bluesbar: { x: 222, y: 44, w: 30, h: 14 },
        kitchen: { x: 138, y: 58, w: 38, h: 30 },
      }[place];
      const cases = [
        [
          'your input',
          { live: { input: 0.9 } },
          place === 'kitchen' ? { x: 140, y: 60, w: 34, h: 22 } : grow(L.ampL),
          place === 'metal' ? null : [place === 'kitchen' ? { x: 140, y: 60, w: 34, h: 22 } : grow(L.ampL, 8)],
        ],
        place === 'kitchen'
          ? ['the tape rolling', [base, { ...base, rolling: true }], reelsBox, [reelsBox]]
          : [
              'the tape rolling a beat on',
              [
                { ...base, rolling: true },
                { ...base, rolling: true, beat: 13 },
              ],
              reelsBox,
              [reelsBox],
            ],
        ['the talkback lamp', { talk: true }, LEDGE_PARTS.talk, [grow(LEDGE_PARTS.talk, 4)]],
        ['the master', { live: { master: [0.9, 0.8] } }, LEDGE_PARTS.vu[0], LEDGE_PARTS.vu],
        [
          'the counter',
          { bar: 17 },
          LEDGE_PARTS.counter,
          [LEDGE_PARTS.counter, ...(place === 'kitchen' ? [reelsBox] : [])],
        ],
        ['the count', { count: 3 }, place === 'kitchen' ? reelsBox : L.kit, [place === 'kitchen' ? reelsBox : L.kit]],
      ];
      if (place !== 'kitchen') {
        cases.push(['the kick', { live: { kick: 1 } }, L.kit, null]);
        cases.push(['the crash', { live: { crash: 1 } }, L.kit, null]);
        cases.push(['the bass', { live: { bass: 0.9 } }, grow(L.bass), [grow(L.bass, 8)]]);
        cases.push([
          'the left amp while you play the right',
          { side: 'R', doubled: true, live: { L: 0.9 } },
          grow(L.ampL),
          null,
        ]);
      }
      if (place === 'metal' || place === 'basement')
        cases.push(['the dust cover off', { doubled: true }, L.ampR, [grow(L.ampR, 3)]]);
      if (place !== 'kitchen' && place !== 'bluesbar')
        cases.push([
          'the right amp with its own level',
          [
            { ...base, doubled: true },
            { ...base, doubled: true, live: { R: 0.9 } },
          ],
          grow(L.ampR),
          [grow(L.ampR, 8)],
        ]);
      if (place === 'bluesbar') {
        cases.push([
          'the neon on your first note',
          { heard: true },
          { x: 90, y: 0, w: 76, h: 50 },
          [{ x: 100, y: 0, w: 56, h: 50 }],
        ]);
        cases.push([
          'the neon on the snare',
          [
            { ...base, heard: true },
            { ...base, heard: true, live: { snare: 1 } },
          ],
          { x: 104, y: 14, w: 48, h: 14 },
          null,
        ]);
        cases.push([
          'LAST CALL on the ending',
          { ending: true },
          { x: 196, y: 6, w: 50, h: 28 },
          [{ x: 192, y: 0, w: 60, h: 40 }],
        ]);
      }
      if (place === 'basement') {
        cases.push(['the bulb on the kick', { live: { kick: 1 } }, { x: 76, y: 0, w: 60, h: 60 }, null]);
        cases.push([
          'the flyer with the title',
          { title: 'Void Weather' },
          { x: 36, y: 30, w: 30, h: 26 },
          [{ x: 36, y: 30, w: 30, h: 26 }],
        ]);
      }
      if (place === 'kitchen') {
        cases.push(['the lamp on the shaker', { live: { shaker: 1 } }, { x: 96, y: 0, w: 48, h: 40 }, null]);
        cases.push(['the cajón on its hits', { live: { cajon: 1 } }, L.kit, [L.kit]]);
        cases.push(['the bass invited', { invited: { bass: true } }, L.bass, [grow(L.bass, 4)]]);
        cases.push([
          'the strings invited',
          { invited: { strings: true } },
          { x: 8, y: 66, w: 26, h: 64 },
          [{ x: 8, y: 66, w: 26, h: 64 }],
        ]);
        cases.push([
          'the shaker invited',
          { invited: { shaker: true } },
          { x: 176, y: 74, w: 12, h: 12 },
          [{ x: 176, y: 74, w: 12, h: 12 }],
        ]);
      }
      let ok = 0;
      for (const [what, v, at, only] of cases) {
        const [va, vb] = Array.isArray(v) ? v : [base, { ...base, ...v }];
        const d = diff(Array.isArray(v) ? draw(place, va) : B, look(draw(place, vb)));
        const lands = d.n > 0 && touches(d, at),
          stays = !only || within(d, only);
        if (lands && stays) ok++;
        else
          wrong.push(
            `${place}: ${what} ${!lands ? `doesn't move what it drives (${bbox(d)})` : `moves more than it drives (${bbox(d)})`}`,
          );
      }
      lines.push(`${place} ${ok}/${cases.length}`);
    }
    T.ok(
      !wrong.length,
      `each signal moves what it drives and nothing else: ${lines.join(', ')}${wrong.length ? '; ' + wrong.slice(0, 6).join('; ') : ''}`,
    );
    const counts = PLACES.map(
      (p) => findText(draw(p, { count: 3 }), '3', p === 'kitchen' ? '#d9f36a' : sc.LOOK[p].headInk, 2).length,
    );
    T.ok(
      counts.every((n) => n >= 1),
      `the count is on the kick head while it counts (a 3 on ${PLACES.slice(0, 3)
        .map((p, i) => `${sc.KICKS[p]} ${counts[i] ? 'yes' : 'no'}`)
        .join(', ')}; the kitchen's on the laptop ${counts[3] ? 'yes' : 'no'})`,
    );
    const loads = PLACES.slice(0, 3).map(
      (p) =>
        findWords(draw(p, { loading: 0.7 }), 'KIT 70%', sc.LOOK[p].headInk) &&
        same(draw(p, { loading: 1 }), draw(p, {})),
    );
    T.ok(
      loads.every(Boolean),
      `while the kit loads its kick head says how much is in (KIT 70% on ${PLACES.slice(0, 3)
        .map((p, i) => `${sc.KICKS[p]} ${loads[i] ? 'yes' : 'no'}`)
        .join(', ')}), and its word comes back once it's in`,
    );
    const flyer = findText(draw('basement', { title: 'Void Weather' }), 'VOID', '#16130f').length;
    T.ok(
      flyer >= 1,
      `the basement's flyer carries the song's title once it has one (VOID ${flyer ? 'found' : 'missing'}), and 'Untitled' is no title: ${same(draw('basement', { title: 'Untitled' }), draw('basement', {})) ? 'the same flyer' : 'a different flyer'}`,
    );
    const cover = PLACES.slice(0, 2).map((p) => {
      const ls = sc.LAYOUT[p].ampR,
        a = draw(p, {}),
        b = draw(p, { cards: [{ takes: { L: ['c1'], R: ['c2'] }, band: [] }] }),
        c = draw(p, { cards: [{ takes: { L: ['c1'], R: [] }, band: [] }] });
      return touches(diff(a, b), ls) && same(a, c);
    });
    T.ok(
      cover.every(Boolean),
      `the second amp's dust cover comes off once a card has a right take, read from the room's cards (${PLACES.slice(0, 2).join(', ')})`,
    );
  }

  /* ---------------------------------------------------------------------------------------------- 3. reduced motion */
  {
    const still = [],
      lit = [],
      lamps = [],
      held = [];
    for (const place of PLACES) {
      const base = { reduced: true, plugged: true, rolling: true, bar: 6, beat: 20 };
      const a = look(draw(place, base)),
        b = look(
          draw(place, {
            ...base,
            beat: 22.5,
            count: null,
            live: { kick: 1, snare: 1, hat: 1, crash: 1, tom: 1, shaker: 1, cajon: 1 },
          }),
        );
      if (!same(a, b)) still.push(`${place} (${bbox(diff(a, b))})`);
      const lv = { live: { input: 0.9, L: 0.8, R: 0.8, bass: 0.9, master: [0.9, 0.9] }, doubled: true };
      const c = look(draw(place, { ...base, doubled: true })),
        d = look(draw(place, { ...base, ...lv }));
      const dd = diff(c, d),
        lights = sc.lightsOf(place);
      if (!within(dd, lights))
        lit.push(
          `${place} (${dd.px.filter(([x, y]) => !lights.some((r) => inBox(x, y, r))).length} px outside the lamps)`,
        );
      if (!dd.n) lamps.push(place);
      const e = draw(place, { ...base, reduced: false, doubled: true }),
        f = draw(place, { ...base, reduced: false, ...lv });
      if (place !== 'kitchen' && within(diff(e, f), lights)) held.push(place);
    }
    T.ok(
      !still.length,
      `reduced motion: hits and the beat change nothing (no pump, sway, swing, shake or turning reel)${still.length ? ': ' + still.join(', ') : ''}`,
    );
    T.ok(
      !lit.length && !lamps.length,
      `reduced motion: the lamps still light with their levels, and only the lamps, meters and counter change${lit.length ? ': ' + lit.join(', ') : ''}${lamps.length ? '; nothing lit in ' + lamps.join(', ') : ''}`,
    );
    T.ok(
      !held.length,
      `without reduced motion the same levels move the gear too (cones, needles; the kitchen has none), so the mode is holding something${held.length ? ': not in ' + held.join(', ') : ''}`,
    );
  }

  /* ---------------------------------------------------------------------------------------------- 4. the door's crops */
  {
    const bad = [],
      off = [];
    for (const place of PLACES)
      for (const size of [
        { w: 168, h: 96 },
        { w: 128, h: 72 },
        { w: 84, h: 48 },
        { w: 256, h: 130 },
      ]) {
        const b = look(pixelBuffer(px.W + 8, px.H + 8));
        px.drawCrop(b, place, size);
        let outside = 0,
          unpainted = 0;
        for (let y = 0; y < b.height; y++)
          for (let x = 0; x < b.width; x++) {
            const a = b.data[(y * b.width + x) * 4 + 3];
            if (x < size.w && y < size.h) {
              if (a !== 255) unpainted++;
            } else if (a) outside++;
          }
        if (b.bad.size || outside || unpainted)
          bad.push(
            `${place} ${size.w}x${size.h}: ${[...b.bad.keys()].join(', ')}${outside ? ` ${outside} px outside` : ''}${unpainted ? ` ${unpainted} px unpainted` : ''}`,
          );
        // the crop is the still room's pixels, from above the ledge
        const full = draw(place, { reduced: true });
        let found = null;
        for (let dy = 0; dy + size.h <= px.H && !found; dy++)
          for (let dx = 0; dx + size.w <= px.W && !found; dx++) {
            let ok = true;
            for (let y = 0; y < size.h && ok; y += 3)
              for (let x = 0; x < size.w && ok; x += 3) if (hex(b, x, y) !== hex(full, dx + x, dy + y)) ok = false;
            if (ok) found = [dx, dy];
          }
        if (!found || found[1] + size.h > px.H - px.LEDGE)
          off.push(
            `${place} ${size.w}x${size.h}${found ? ` reaches y ${found[1] + size.h}` : ' matches no part of the room'}`,
          );
        if (size.w === 168) {
          if (!findWords(b, sc.KICKS[place], sc.LOOK[place].headInk))
            off.push(`${place}'s card shows no ${sc.KICKS[place]}`);
        }
      }
    T.ok(
      !bad.length,
      `drawCrop paints exactly its size at (0, 0) with the allowed calls (4 places x 4 sizes)${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`,
    );
    T.ok(
      !off.length,
      `each crop is the still room above the ledge, a 168 x 96 card showing its kick head's word${off.length ? ': ' + off.join('; ') : ''}`,
    );
    const a = pixelBuffer(168, 96),
      b = pixelBuffer(168, 96),
      c = pixelBuffer(168, 96);
    px.drawCrop(a, 'metal', { w: 168, h: 96 });
    px.drawCrop(b, 'metal', { w: 168, h: 96 }, { reduced: false, live: { kick: 1, crash: 1 } });
    px.drawCrop(c, 'metal', { w: 168, h: 96 });
    T.ok(
      !same(a, b) && same(a, c),
      'a crop is still, and a view (a bar of the band on a focused card) moves it with the hits',
    );
  }

  /* ---------------------------------------------------------------------------------------------- 5. the covers */
  {
    const song = { title: 'Void Weather', key: 'C minor', tempo: 132, bars: 24 };
    const cov = (c, size = { w: 128, h: 80 }) => {
      const b = pixelBuffer(size.w + 6, size.h + 6);
      px.drawCover(b, c, size);
      return look(b);
    };
    const bad = [];
    for (const size of [
      { w: 128, h: 80 },
      { w: 64, h: 40 },
      { w: 104, h: 16 },
    ]) {
      const b = cov(song, size);
      let outside = 0,
        unpainted = 0;
      for (let y = 0; y < b.height; y++)
        for (let x = 0; x < b.width; x++) {
          const a = b.data[(y * b.width + x) * 4 + 3];
          if (x < size.w && y < size.h) {
            if (a !== 255) unpainted++;
          } else if (a) outside++;
        }
      if (b.bad.size || outside || unpainted)
        bad.push(`${size.w}x${size.h}: ${[...b.bad.keys()].join(', ')} ${outside} outside, ${unpainted} unpainted`);
    }
    const nul = cov(null);
    T.ok(
      !bad.length && !nul.bad.size,
      `drawCover paints exactly its size (128 x 80, 64 x 40, a 104 x 16 band) with the allowed calls, and a blank tape's cover too${bad.length ? ': ' + bad.join('; ') : ''}`,
    );
    // one spike per bar: round a circle just outside the hub, the runs of ink are the spikes
    const spikes = [8, 12, 24, 32].map((n) => {
      const c = { ...song, bars: n },
        b = cov(c),
        pal = paletteOf(c),
        r = Math.max(2, 80 * 0.2) + 5,
        cx = 63.5,
        cy = 39.5;
      let runs = 0,
        prev = null,
        first = null;
      for (let i = 0; i < 720; i++) {
        const t = (i / 720) * Math.PI * 2,
          x = Math.round(cx + Math.cos(t) * r),
          y = Math.round(cy + Math.sin(t) * r),
          ink = hex(b, x, y) !== pal.ground;
        if (first === null) first = ink;
        if (ink && prev === false) runs++;
        prev = ink;
      }
      if (first && prev === false) runs++;
      return [n, runs];
    });
    T.ok(
      spikes.every(([n, r]) => n === r),
      `a cover has one spike per bar: ${spikes.map(([n, r]) => `${n} bars, ${r} spikes`).join('; ')}`,
    );
    const A = cov(song),
      again = cov({ ...song });
    const changes = [
      ['title', (i) => ({ ...song, title: `Song ${i}` })],
      ['key', (i) => ({ ...song, key: ['A minor', 'E', 'G', 'D minor', 'B♭'][i] })],
      ['tempo', (i) => ({ ...song, tempo: 90 + i * 17 })],
    ].map(([what, f]) => {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const p = paletteOf(f(i)),
          q = paletteOf(song);
        if (p.ground !== q.ground || p.a !== q.a || p.b !== q.b) n++;
      }
      return [what, n];
    });
    const lens = cov({ ...song, bars: Array.from({ length: 24 }, (_, i) => (i % 3) / 2) });
    T.ok(
      same(A, again) &&
        changes.every(([, n]) => n >= 3) &&
        !same(A, lens) &&
        json(paletteOf(song)) === json(paletteOf({ ...song, bars: [1, 0] })),
      `a cover's palette is seeded by the title, the key and the tempo (the same song, the same cover; another ${changes.map(([w, n]) => `${w}: ${n}/5`).join(', ')} new palettes), and the bars set the spikes, not the colours`,
    );
    let coverReds = 0;
    for (let i = 0; i < 120; i++) {
      const b = cov({ title: `T${i}`, key: i % 2 ? 'C minor' : 'E', tempo: 60 + i, bars: 8 + (i % 40) });
      coverReds += reds(b);
    }
    T.ok(coverReds === 0, `no red in 120 seeded covers (${coverReds} red px)`);
  }

  /* ---------------------------------------------------------------------------------------------- 6. the phone's window */
  {
    const bad = [];
    const fits = (wnd, b) => b.x >= wnd.x && b.x + b.w <= wnd.x + wnd.w && b.y >= wnd.y && b.y + b.h <= wnd.y + wnd.h;
    for (const place of PLACES.slice(0, 3)) {
      const L = sc.LAYOUT[place];
      const tries = [
        ['soundcheck', { step: 'soundcheck' }, [L.ampL]],
        ['the other side', { step: 'double' }, [L.ampL, L.ampR]],
        ['playing the right', { side: 'R' }, [L.ampR]],
        ['a feel', { step: 'feel' }, [L.kit]],
        ['the bass', { focus: 'bass' }, [L.bass]],
      ];
      for (const [what, v, boxes] of tries) {
        const w = px.windowFor({ place, reduced: true, ...v });
        const shape =
          w.w === 192 &&
          w.h === 108 &&
          [w.x, w.y].every(Number.isInteger) &&
          w.x >= 0 &&
          w.y >= 0 &&
          w.x + w.w <= px.W &&
          w.y + w.h <= px.H;
        if (!shape || !boxes.every((b) => fits(w, b))) bad.push(`${place} ${what}: ${JSON.stringify(w)}`);
      }
      const k = px.windowFor({ place, step: 'feel', reduced: true });
      if (k.y !== px.H - 108) bad.push(`${place}: the kit's window leaves the ledge out (y ${k.y})`);
    }
    for (const place of [null, 'nowhere', '__proto__', 'toString']) {
      try {
        const w = px.windowFor({ place, step: 'double', reduced: true });
        if (w.w !== 192 || w.h !== 108) bad.push(`${place}: ${JSON.stringify(w)}`);
        const c = pixelBuffer(168, 96);
        px.drawCrop(c, place, { w: 168, h: 96 });
      } catch (e) {
        bad.push(`${place} threw: ${e.message}`);
      }
    }
    const kw = px.windowFor({ place: 'kitchen', reduced: true }),
      K = sc.LAYOUT.kitchen;
    if (!(kw.w === 192 && kw.h === 72 && kw.y === 72 && fits(kw, K.kit))) bad.push(`kitchen: ${JSON.stringify(kw)}`);
    T.ok(
      !bad.length,
      `the phone's window is 192 x 108 (the kitchen's strip 192 x 72), whole pixels, framed on all of what the step is about: your amp and its lamps in the soundcheck, both amps for the other side, the kit for a feel (with the ledge), the bass; no place, or a place that isn't one, the whole room's middle${bad.length ? ': ' + bad.join('; ') : ''}`,
    );
    px.windowFor({ place: 'metal', step: 'soundcheck', now: 1000, reduced: false });
    const xs = [],
      ys = [];
    for (let t = 1000; t <= 1240; t += 20) {
      const w = px.windowFor({ place: 'metal', step: 'feel', now: t, reduced: false });
      xs.push(w.x);
      ys.push(w.y);
    }
    const from = px.windowFor({ place: 'metal', step: 'soundcheck', reduced: true }).x,
      to = px.windowFor({ place: 'metal', step: 'feel', reduced: true }).x;
    const mono = xs.every(
      (x, i) =>
        Number.isInteger(x) &&
        Number.isInteger(ys[i]) &&
        (i === 0 || ((to >= from ? x >= xs[i - 1] : x <= xs[i - 1]) && ys[i] >= ys[i - 1])),
    );
    T.ok(
      from !== to &&
        xs[0] === from &&
        xs.at(-1) === to &&
        xs[5] !== from &&
        xs[5] !== to &&
        mono &&
        xs.indexOf(to) <= 11,
      `the window pans in whole pixels over 200 ms from the amp to the kit (x ${xs.join(' ')}; y ${ys.join(' ')})`,
    );
    px.windowFor({ place: 'metal', step: 'soundcheck', now: 2000, reduced: false });
    const cut = px.windowFor({ place: 'metal', step: 'feel', now: 2010, reduced: true }).x,
      cut2 =
        (px.windowFor({ place: 'metal', step: 'soundcheck', now: 3000, reduced: false }),
        px.windowFor({ place: 'metal', step: 'feel' }).x);
    T.ok(
      cut === to && cut2 === to,
      `under reduced motion (or with no time) the window cuts instead of panning (x ${cut}, ${cut2})`,
    );
  }

  /* ---------------------------------------------------------------------------------------------- 7. no red */
  T.ok(
    redSeen === 0,
    `no red pixel in any of the ${drawn} scenes, crops and covers drawn above (${redSeen} red px; red is the record light)`,
  );

  T.done();
});
