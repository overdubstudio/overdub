// The rooms in pixels (docs/research/LIVE-ROOM-MODE.md §3.19): the Node half of tools/liveroom/checks-pixels.js, small
// enough for CI. Every place draws with the allowed calls only, the same view gives the same pixels, nothing is red,
// and the door's crops, the covers and the phone's window keep their shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as px from '../../app/src/ui/liveroom/pixels/index.js';
import { pixelBuffer, isRed } from '../../tools/liveroom/checks-pixels.js';

const PLACES = ['metal', 'basement', 'bluesbar', 'kitchen', null, 'nowhere', '__proto__', 'toString'];
const LOUD = {
  reduced: false,
  plugged: true,
  rolling: true,
  beat: 9.5,
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
    crash: 0.7,
    bass: 0.8,
    shaker: 1,
    cajon: 1,
    master: [0.8, 0.7],
  },
};
const draw = (place, view, now = 0) => {
  const b = pixelBuffer(px.W, px.H);
  px.sceneOf(place).draw(b, { place, ...view }, now);
  return b;
};
const redCount = (b) => {
  let n = 0;
  for (let i = 0; i < b.data.length; i += 4) if (isRed(b.data[i], b.data[i + 1], b.data[i + 2])) n++;
  return n;
};

test('every place paints the whole scene with fillStyle, globalAlpha and fillRect only', () => {
  for (const place of PLACES) {
    for (const view of [{ reduced: false }, LOUD, { ...LOUD, reduced: true }]) {
      const b = draw(place, view);
      assert.deepEqual([...b.bad.keys()], [], `${place}: only the allowed calls`);
      for (let i = 3; i < b.data.length; i += 4) assert.equal(b.data[i], 255, `${place}: every pixel painted`);
    }
  }
});

test('the same view gives the same pixels, whatever the time', () => {
  for (const place of PLACES)
    assert.deepEqual(draw(place, LOUD, 0).data, draw(place, LOUD, 123456).data, String(place));
});

test('no red in any scene or cover', () => {
  for (const place of PLACES)
    for (const view of [{}, LOUD, { ...LOUD, count: 3 }]) assert.equal(redCount(draw(place, view)), 0, String(place));
  for (let i = 0; i < 40; i++) {
    const b = pixelBuffer(128, 80);
    px.drawCover(
      b,
      { title: `Song ${i}`, key: i % 2 ? 'E' : 'C minor', tempo: 80 + i, bars: 8 + i },
      { w: 128, h: 80 },
    );
    assert.equal(redCount(b), 0, `cover ${i}`);
  }
});

test('a crop and a cover paint exactly their size', () => {
  for (const [fn, size] of [
    [(b) => px.drawCrop(b, 'metal', { w: 168, h: 96 }), { w: 168, h: 96 }],
    [(b) => px.drawCover(b, { title: 'X', bars: 12 }, { w: 64, h: 40 }), { w: 64, h: 40 }],
  ]) {
    const b = pixelBuffer(200, 120);
    fn(b);
    for (let y = 0; y < b.height; y++)
      for (let x = 0; x < b.width; x++) {
        const a = b.data[(y * b.width + x) * 4 + 3];
        assert.equal(a, x < size.w && y < size.h ? 255 : 0, `${x},${y}`);
      }
  }
});

test("the phone's window is 192 x 108 (the kitchen's 192 x 72) in whole pixels inside the scene", () => {
  for (const place of PLACES) {
    for (const step of ['soundcheck', 'double', 'feel', 'bass', undefined]) {
      const w = px.windowFor({ place, step, reduced: true });
      assert.equal(w.w, 192);
      assert.equal(w.h, place === 'kitchen' ? 72 : 108);
      assert.ok(Number.isInteger(w.x) && Number.isInteger(w.y) && w.x >= 0 && w.y >= 0);
      assert.ok(w.x + w.w <= px.W && w.y + w.h <= px.H);
    }
  }
});
