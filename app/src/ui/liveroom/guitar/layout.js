// @ts-check
// The guitar room's layout model [ui; the guitar room's foundation, frozen] (docs/research/GUITAR-ROOM.md §2.2; the
// second mock, design/mock/guitar-room-2/: the screen IS the stage, seen from the front). Pure numbers and rects.
//
// The room is drawn in a DESIGN SPACE of world units and scaled to the window by the camera (./camera.js), so the
// gear is laid out once and holds at 1440 x 900, 1280 x 800 and ~2000 wide: the whole stage fits the view (the
// smaller of the two scales), and a wide window shows more of the room past the core (MARGIN: the pixel walls run on).
// The gear is real DOM (the studio's faces, ui/faces.js) and CSS, so it stays crisp at any scale; the pixel rooms are
// canvases at whole room pixels (PX world units each), scaled with image-rendering: pixelated.
//
//   STAGE = { w: 1440, h: 804 }      the stage world: one world unit is one CSS pixel at 1440 x 900 (the header and the
//                                    strip take the rest)
//   SHOP  = { w: 1440, h: 804 }      the shop world, the same size
//   PX = 4                           world units per room pixel (the walls); the kit's own canvas uses 6
//   MARGIN = { x: 480, y: 120 }      how far the room's pixels run past the core on each side
//   CHROME = { top: 48, strip: 52 }  the room's header and bottom strip, in CSS pixels (the view is what's between)
//   REGIONS                          where each thing stands on the stage, in world units: the room stream draws them
//                                    there and every other stream reads them (a stream that needs the precise box of
//                                    a drawn thing asks the room's API, R.parts.room.rect(name), ./stage.js):
//     meter (the input meter on the head), head, cab, board (the pedalboard, full width along the front), tuner (the
//     tuner pedal, first on the board), jack (where the cable plugs in), kit (the drummer's kit), riser (its front:
//     the drummer's plate and the beat cards), banner, tape (the tape machine on its road case), door (the shop's
//     door, under NO STAIRWAY)
//   SHOP_REGIONS                     the shop's: wall (the amp wall, five sections), case (the pedal case), corner (the
//                                    try-out corner your stack stands in), door (back to the stage)
//   fit(view) -> { s, x, y }         the overview: the whole world in a view { w, h } (CSS pixels), centred
//   frame(view, R, { right, left, top, bottom, pad, maxS, ax, ay }) -> { s, x, y }
//                                    a world rect framed in the view, leaving room for a side panel (right, left) or a
//                                    bottom sheet (bottom); ax, ay: where it sits in what's left (0..1)
//   toView(cam, R) -> R              a world rect on screen (the view's own coordinates) under a camera { s, x, y }
//   viewSize(win) -> { w, h }        the view for a window { w, h }: the window less CHROME

export const STAGE = Object.freeze({ w: 1440, h: 804 });
export const SHOP = Object.freeze({ w: 1440, h: 804 });
export const PX = 4;
export const MARGIN = Object.freeze({ x: 480, y: 120 });
export const CHROME = Object.freeze({ top: 48, strip: 52 });

const R = (x, y, w, h) => Object.freeze({ x, y, w, h });
// (the second mock's stage, measured off its 1440 x 900 shots)
export const REGIONS = Object.freeze({
  meter: R(76, 22, 292, 22),
  head: R(62, 52, 494, 150),
  cab: R(60, 206, 500, 336),
  board: R(16, 556, 1408, 248),
  tuner: R(68, 570, 138, 206),
  jack: R(16, 628, 52, 24),
  kit: R(540, 160, 600, 336),
  riser: R(560, 460, 552, 96),
  banner: R(664, 48, 344, 60),
  tape: R(1116, 248, 128, 308),
  door: R(1264, 240, 144, 316),
});
export const SHOP_REGIONS = Object.freeze({
  wall: R(150, 84, 772, 500),
  case: R(150, 84, 772, 500),
  corner: R(960, 60, 470, 560),
  door: R(18, 288, 120, 310),
});

export function fit(view, world = STAGE) {
  const s = Math.min(view.w / world.w, view.h / world.h);
  return { s, x: (view.w - world.w * s) / 2, y: (view.h - world.h * s) / 2 };
}

export function frame(view, rect, { right = 0, left = 0, top = 0, bottom = 0, pad = 24, maxS = 4.2, ax = 0.5, ay = 0.5 } = {}) {
  const aw = Math.max(40, view.w - right - left - pad * 2), ah = Math.max(40, view.h - bottom - top - pad * 2);
  const s = Math.min(aw / rect.w, ah / rect.h, maxS);
  return { s, x: left + pad + (aw - rect.w * s) * ax - rect.x * s, y: top + pad + (ah - rect.h * s) * ay - rect.y * s };
}

export const toView = (cam, r) => ({ x: cam.x + r.x * cam.s, y: cam.y + r.y * cam.s, w: r.w * cam.s, h: r.h * cam.s });

export const viewSize = (win) => ({ w: Math.max(0, win.w), h: Math.max(0, win.h - CHROME.top - CHROME.strip) });
