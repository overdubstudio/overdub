// The shop [ui; the guitar room's SHOP stream] (docs/research/GUITAR-ROOM.md §2.4-§2.6; design/mock/guitar-room-2/
// shot-4-shop.png, shot-2-cab-zoom.png). A STUB until the shop stream builds it.
//
// The shop stream owns the shop world (R.el.shop: its pixels, the amp wall in sections by tone, the pedal case in
// drawers by category, the try-out corner), carrying gear into the rig (R.rig.swap for a whole stack, R.rig.add for a
// pedal; core/liveroom/stacks.js, core/stacks.js), the rack (ui/liveroom/rack-db.js: Save to rack, load a saved stack,
// the song's room.stack), and the cab zoom's cab builder (R.panel('cab'): the amp's cab, mic, position, distance and
// a second mic, each a param of the real amp through R.rig.turn). Its camera targets are the foundation's 'wall',
// 'case', 'tryout-head', 'tryout-cab' (./index.js SHOP_TARGETS), which it may re-register with drawn boxes; R.gr.shop
// is its state.
//
// Frozen:
//   mount(R) -> view = {
//     press(id) -> { ok, error? } | false     'shop:wall', 'shop:case', 'shop:head', 'shop:cab', 'cat:prev', 'cat:next',
//                                             'save', 'rack'
//     back() -> bool                          Esc in the shop: the try-out corner, then a drawer
//     frame(now), unmount()
//     carry(what) -> { ok, error? }           what: { stack } (a whole stack: an amp and its pedals) or { link } (one
//                                             pedal, { device, params, on }): into the rig, one undo step
//     save(name) -> Promise<{ ok, id?, error? }>   the rig as it is now into the rack
//   }

export function mount(R) {
  const notYet = { ok: false, error: 'The shop isn’t built yet.' };
  return {
    press(id) {
      if (id === 'shop:wall') return { ok: R.camera.zoomTo('wall') };
      if (id === 'shop:case') return { ok: R.camera.zoomTo('case') };
      if (['shop:head', 'shop:cab', 'cat:prev', 'cat:next', 'save', 'rack'].includes(id)) return notYet;
      return false;
    },
    back: () => false,
    frame() {},
    unmount() {},
    carry(what) { return what?.stack ? R.rig.swap(what.stack) : what?.link ? R.rig.add(what.link) : { ok: false, error: 'Carry a stack or a pedal.' }; },
    save: async () => notYet,
  };
}
