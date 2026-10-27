// The live room's checks: the guitar room's SHOP stream [guitar room] (docs/research/GUITAR-ROOM.md; the stream's
// module, app/src/ui/liveroom/guitar/shop.js, says what it owns and its frozen API). Run by tools/liveroom-test.js
// (ONLY=shop), whose header says what a checks module exports. The shop stream adds its checks here (Node first, then muted
// Chromium through ./harness.js openRoom, the club opened with core/liveroom/guitar/setup.js planGuitarRoom and
// app.liveRoom.open({ screen: 'guitar' }); the room's R is document.querySelector('.gr').__gr). The seams it shares with
// the other streams are checks-guitar.js's.

export const name = 'shop';
export const pages = false;

export async function run(T) {
  const m = await import('../../app/src/ui/liveroom/guitar/shop.js');
  T.ok(typeof m.mount === 'function', 'the shop stream\'s module exports mount(R) (its checks come with its build)');
}
