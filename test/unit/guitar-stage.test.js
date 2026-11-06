// The guitar room's stage, what Node can hold it to (docs/research/GUITAR-ROOM.md), moved from
// tools/liveroom/checks-room.js, which keeps the stage in muted Chromium: its pixels (room-pixels.js) draw with the room's
// brushes only, at whole pixels, the same every time, with no red pixel; the tape machine holds still under reduced
// motion; the kit moves with a hit; the cab under an amp, and the mics from the amp's params.
import { test } from 'node:test';
import { checks } from './helpers/check.js';
import { pixelBuffer, isRed } from '../../tools/liveroom/checks-pixels.js';

test("the stage's pixels and the cab", async () => {
  const T = checks();
  /* ---------------------------------------------------------------------------------------- Node: the pixels */
  const px = await import('../../app/src/ui/liveroom/guitar/room-pixels.js');
  const { PX, MARGIN, STAGE } = await import('../../app/src/ui/liveroom/guitar/layout.js');
  const W = (STAGE.w + MARGIN.x * 2) / PX,
    H = (STAGE.h + MARGIN.y * 2) / PX;
  const draw = (fn, w, hh) => {
    const b = pixelBuffer(w, hh);
    fn(b);
    return b;
  };
  const stage = (view) => draw((b) => px.drawStage(px.shifted(b, MARGIN.x / PX, MARGIN.y / PX), view), W, H);
  const a = stage({}),
    b2 = stage({}),
    hov = stage({ doorHover: true });
  const reds = (b) => {
    let n = 0;
    for (let i = 0; i < b.data.length; i += 4) if (isRed(b.data[i], b.data[i + 1], b.data[i + 2])) n++;
    return n;
  };
  const same = (x, y) => Buffer.compare(Buffer.from(x.data), Buffer.from(y.data)) === 0;
  T.ok(
    !a.bad.size && same(a, b2) && !same(a, hov) && !reds(a) && !reds(hov) && a.calls > 1000,
    `the stage's pixels: brushes only (${a.bad.size ? [...a.bad.keys()].join(', ') : 'fillStyle, globalAlpha, fillRect'}), the same every time, the door lights when it's hovered, no red pixel (${reds(a)}; ${a.calls} rects)`,
  );
  const tape = (s) => draw((b) => px.drawTape(b, s), px.TAPE.w, px.TAPE.h);
  const t1 = tape({ rolling: true, bar: 5, input: 0.6, spin: 0.3 }),
    t2 = tape({ rolling: true, bar: 5, input: 0.6, spin: 1.4 });
  const r1 = tape({ rolling: true, bar: 5, input: 0.6, spin: 0.3, reduced: true }),
    r2 = tape({ rolling: true, bar: 5, input: 0.6, spin: 1.4, reduced: true });
  const stopped = tape({ rolling: false });
  T.ok(
    !t1.bad.size &&
      !same(t1, t2) &&
      same(r1, r2) &&
      !same(t1, stopped) &&
      !reds(t1) &&
      !reds(tape({ rolling: true, bar: 12, input: 1, hot: true })),
    'the tape machine: its reels turn while it rolls, hold still under reduced motion, the counter and lamps follow; no red pixel',
  );
  const kit = (s) => draw((b) => px.drawKit(b, s), px.KIT.w, px.KIT.h);
  const k0 = kit({}),
    k1 = kit({ kick: 1, snare: 1, crash: 1 }),
    kr = kit({ kick: 1, snare: 1, crash: 1, reduced: true }),
    kc = kit({ count: 3, tap: 1 });
  T.ok(
    !k0.bad.size && !same(k0, k1) && same(k0, kr) && !same(k0, kc) && !reds(k1) && !reds(kc),
    'the kit: a hit moves it, reduced motion holds it, the sticks count; no red pixel',
  );

  /* ---------------------------------------------------------------------------------------- Node: the cab */
  await import('../../app/src/devices/guitar/index.js');
  const rr = await import('../../app/src/ui/liveroom/guitar/room-rig.js');
  const { CLUB_STACK } = await import('../../app/src/core/liveroom/guitar/setup.js');
  const amp = CLUB_STACK.chain.find((l) => l.device === 'amp.recto');
  const club = rr.cabOf(amp),
    own = rr.cabOf({ device: 'amp.recto', params: { cab: 0 } }),
    fridge = rr.cabOf({ device: 'amp.recto', params: { cab: 9 } });
  const mics = rr.micsOf({ mic: 0, micpos: 0.3, micdist: 1 }),
    two = rr.micsOf({ mic: 1, mic2: 3, mic2pos: 0.9 });
  T.ok(
    club.name === '4x12 Modern' &&
      club.n === 4 &&
      club.box.w === 496 &&
      own.n === 4 &&
      /its own/.test(own.name) &&
      fridge.odd === 'fridge' &&
      mics.length === 1 &&
      mics[0].type === 'dyn' &&
      two.length === 2 &&
      two[0].type === 'ribbon' &&
      two[1].type === 'cond' &&
      two[1].pos === 0.9,
    `the cab under the amp: the club's ${club.name}, the amp's own (${own.name}), the fridge; the mics from the amp's params (${two.map((m) => m.name).join(' + ')})`,
  );

  T.done();
});
