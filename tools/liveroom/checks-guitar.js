// The live room's checks: the guitar room's foundation [guitar room] (docs/research/GUITAR-ROOM.md; docs/ARCHITECTURE.md
// "The guitar room"). Run by tools/liveroom-test.js (ONLY=guitar), whose header says what a checks module exports. Each
// of the six streams has its own file beside this one (checks-room, -shop, -drummer, -start, -takes, -tape); this one
// holds the seams they share, so a stream that breaks one hears it here.
//   (frozen names, the club's setup, the rig's plans and the key table: test/unit/guitar-foundation.test.js)
//   LEVELS: the guitars' fader (setup.js GUITAR_DB) measured again: the metal DI fixtures through the club's stack and
//     through the old Half Stack at its fader, rendered offline in muted Chromium (the stack's devices are graph devices),
//     BS.1770
//   muted Chromium: the door offers the metal club and the control room alone; the club opens on the screen 'guitar' by
//     default; every stream mounts with its frozen API; the camera goes to each target and back (Esc), through the
//     door to the shop and back (S); keys land where they should (1 stomps pedal 1 on both sides, one step by you; a
//     typed letter in a field stays in the field; G is the tape machine, ⌘G the glass); no <select> and no range slider
//     in the room; no console or page errors
import { openRoom, press, history } from './harness.js';
import '../../app/src/devices/builtin/index.js';

export const name = 'guitar';
export const pages = true;

const W = '../../app/src/';
// each stream's module: mount(R) and the API its view returns (./index.js says who calls what)
export const STREAM_API = {
  room: ['press', 'back', 'frame', 'unmount', 'rect', 'el'],
  shop: ['press', 'back', 'frame', 'unmount', 'carry', 'save'],
  drummer: ['press', 'back', 'frame', 'unmount', 'playing', 'stop', 'countIn'],
  start: ['press', 'back', 'frame', 'unmount', 'open', 'done', 'tuner'],
  takes: ['press', 'back', 'frame', 'unmount', 'inReview', 'part', 'place'],
  tape: ['press', 'back', 'frame', 'unmount', 'riffs', 'grab'],
};
const TARGETS = ['head', 'cab', 'kit', 'board', 'tuner', 'tape'];
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

export async function run(T, ctx) {
  if (!ctx.pages) return;
  const setup = await import(W + 'core/liveroom/guitar/setup.js');
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const s = await openRoom('/app/?room', { name: 'guitar' });
  const { page, E, errors } = s;
  try {
    if (ctx.levels) {
      // the fader, measured: the metal DI fixtures through each stack, offline
      const { metalDI } = await import('../amp-scenes.js');
      const dis = { chug: Array.from(metalDI('chug')), chords: Array.from(metalDI('chords')) };
      const lv = await E(async (dis) => {
        const R = await import('/app/src/devices/registry.js');
        const M = await import('/app/src/audio/measure.js');
        const { setupOf } = await import('/app/src/core/liveroom/places.js');
        const { guitarSetup } = await import('/app/src/core/liveroom/guitar/setup.js');
        const SR = 48000;
        async function render(chain, x) {
          const c = new OfflineAudioContext(2, x.length, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
          b.copyToChannel(x, 0); src.buffer = b;
          let at = src;
          const made = [];
          for (let k = 0; k < chain.length; k++) {
            const l = chain[k], inst = await R.instantiate(c, l.device, { uid: `gl${k}`, params: l.params || {}, on: l.on !== false, bpm: 132 });
            await inst.ready; made.push(inst); at.connect(inst.input); at = inst.output;
          }
          at.connect(c.destination); src.start(0);
          const r = await c.startRendering();
          for (const i of made) i.dispose();
          return r;
        }
        const old = setupOf('metal').tracks.find((t) => t.role === 'guitarL'), now = guitarSetup().tracks.find((t) => t.role === 'guitarL');
        const out = [];
        for (const [n, arr] of Object.entries(dis)) {
          const x = Float32Array.from(arr);
          out.push({ n, old: M.lufs(await render(old.inserts, x)) + old.gain, now: M.lufs(await render(now.inserts, x)) + now.gain });
        }
        return out;
      }, dis);
      const mean = (k) => lv.reduce((a, r) => a + r[k], 0) / lv.length;
      const off = mean('now') - mean('old');
      T.ok(Math.abs(off) <= 0.5 && lv.every((r) => Math.abs(r.now - r.old) <= 2), `the guitars' fader is measured: the club's stack at ${setup.GUITAR_DB} dB reads as the old Half Stack at its fader, the DIs' mean within 0.5 LU (${f1(off)}), each within 2 (${lv.map((r) => `${r.n} ${f1(r.now)} against ${f1(r.old)}`).join(', ')} LUFS)`);
    }

    // the door
    const door = await E(async () => {
      const o = window.overdub;
      if (o.liveRoom.isOpen()) o.liveRoom.close();
      o.liveRoom.open({ screen: 'door' });
      await new Promise((r) => setTimeout(r, 200));
      const cards = [...document.querySelectorAll('.lrd-card')].filter((c) => c.offsetParent).map((c) => c.dataset.place);
      const links = [...document.querySelectorAll('.lrd-quiet button')].filter((b) => b.offsetParent).map((b) => b.className.replace(/.*lrd-(\w+)$/, '$1'));
      return { cards, links };
    });
    T.ok(door.cards.join() === 'metal' && door.links.join() === 'nogtr', `the door offers the metal club and the control room alone (cards: ${door.cards.join(', ')}; links: ${door.links.join(', ')})`);
    await press(page, 'Digit1');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'guitar', null, { timeout: 15000 }).catch(() => {});
    const opened = await E(() => {
      const o = window.overdub, L = o.ui.state.liveRoom, p = o.store.get();
      return { screen: L.screen, place: p.room?.place, beat: p.room?.beat, where: document.querySelector('.lr-where')?.textContent || '', steps: o.store.history.length, by: o.store.history.at(-1)?.by };
    });
    T.ok(opened.screen === 'guitar' && opened.place === 'metal' && opened.by === 'you', `1 at the door: the metal club, one step by you, on the guitar room (${opened.screen}; "${opened.where}")`);
    // opened again later: the song's own screen
    const again = await E(async () => {
      const o = window.overdub;
      o.liveRoom.close();
      o.liveRoom.open();
      await new Promise((r) => setTimeout(r, 100));
      const L = o.ui.state.liveRoom, gr = L.gr;
      const parts = gr && document.querySelector('.gr') ? Object.fromEntries(Object.entries(document.querySelector('.gr').__gr?.parts || {}).map(([k, v]) => [k, v ? Object.keys(v) : null])) : null;
      return { screen: L.screen, gr: !!gr, parts, slots: ['.gr-view', '.gr-world[data-world=stage]', '.gr-world[data-world=shop]', '.gr-panels', '.gr-sheets', '.gr-drawer', '.gr-over', '.gr-callout', '.gr-strip'].filter((q) => !document.querySelector(q)) };
    });
    T.ok(again.screen === 'guitar' && again.gr && !again.slots.length, `a song in the club opens on the guitar room by default, with every slot the streams draw in${again.slots.length ? ' (missing: ' + again.slots.join(', ') + ')' : ''}`);
    const api = again.parts || {};
    const missing = Object.entries(STREAM_API).filter(([k, names]) => !api[k] || names.some((n) => !api[k].includes(n))).map(([k, names]) => `${k}: ${api[k] ? names.filter((n) => !api[k].includes(n)).join(' ') : 'not mounted'}`);
    T.ok(!missing.length, `every stream mounts with its frozen API (${Object.keys(STREAM_API).join(', ')})${missing.length ? ': ' + missing.join('; ') : ''}`);

    // the camera
    const cam = [];
    for (const t of TARGETS) {
      const r = await E(async (t) => {
        const o = window.overdub, gr = o.ui.state.liveRoom.gr, w = document.querySelector('.gr-world[data-world=stage]');
        const before = w.style.transform;
        const p = o.liveRoom.press(`cam:${t}`);
        await new Promise((r) => setTimeout(r, 50));
        return { ok: p.ok, at: gr.cam, moved: w.style.transform !== before, s: Number(/scale\(([\d.]+)\)/.exec(w.style.transform)?.[1] || 0) };
      }, t);
      await press(page, 'Escape');
      const back = await E(() => window.overdub.ui.state.liveRoom.gr.cam);
      cam.push({ t, ...r, back });
    }
    T.ok(cam.every((c) => c.ok && c.at === c.t && c.moved && c.s > 1 && c.back === 'stage'), `the camera goes to each target, closer, and Esc brings it back to the stage (${cam.map((c) => `${c.t} ×${f1(c.s)}${c.back === 'stage' ? '' : ' (back: ' + c.back + ')'}`).join(', ')})`);
    // keys: H, C, K, B on the stage
    const byKey = [];
    for (const [key, t] of [['KeyH', 'head'], ['KeyC', 'cab'], ['KeyK', 'kit'], ['KeyB', 'board']]) {
      await press(page, key);
      byKey.push([key.slice(3), await E(() => window.overdub.ui.state.liveRoom.gr.cam), t]);
      await press(page, 'Escape');
    }
    T.ok(byKey.every(([, at, t]) => at === t), `H C K B go to the head, the cab, the kit, the board (${byKey.map(([k, at]) => `${k} ${at}`).join(', ')})`);
    // the shop, through the door
    await press(page, 'KeyS');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'shop', null, { timeout: 5000 }).catch(() => {});
    const inShop = await E(() => ({ world: window.overdub.ui.state.liveRoom.gr.world, cam: window.overdub.ui.state.liveRoom.gr.cam, shown: !document.querySelector('.gr-world[data-world=shop]').hidden, stage: !document.querySelector('.gr-world[data-world=stage]').hidden }));
    await press(page, 'KeyS');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.gr.world === 'stage', null, { timeout: 5000 }).catch(() => {});
    const outShop = await E(() => window.overdub.ui.state.liveRoom.gr.world);
    T.ok(inShop.world === 'shop' && inShop.shown && !inShop.stage && outShop === 'stage', `S goes through the door to the shop (${inShop.cam}) and back (${outShop})`);

    // a stomp: pedal 1 on both sides, one step by you
    const h0 = (await history(page)).length;
    await press(page, 'Digit1');
    const st = await E(async () => {
      const o = window.overdub, { rigOf } = await import('/app/src/core/liveroom/guitar/rig.js');
      const R = rigOf(o.store.get());
      return { on: R.board[0].on, same: R.same, dev: R.board[0].device };
    });
    const h1 = await history(page);
    T.ok(!st.on && st.same && h1.length === h0 + 1 && h1.at(-1).by === 'you', `1 stomps pedal 1 (${st.dev}) on both guitars, one step by you (${h1.at(-1)?.label})`);
    await press(page, 'Digit1');

    // keys in a field stay in the field; G is the tape, ⌘G the glass
    const typed = await E(async () => {
      const o = window.overdub, gr = o.ui.state.liveRoom.gr;
      const f = document.createElement('input');
      f.type = 'text'; f.className = 'gr-probe';
      document.querySelector('.gr-strip-tools').append(f);
      f.focus();
      return gr.cam;
    });
    await page.keyboard.type('hckb1');
    const afterType = await E(() => { const f = document.querySelector('.gr-probe'); const v = f.value; f.remove(); document.querySelector('.lr').focus(); return { v, cam: window.overdub.ui.state.liveRoom.gr.cam }; });
    T.ok(afterType.v === 'hckb1' && afterType.cam === typed, `letters typed in a field stay in it ("${afterType.v}"; the camera stayed at ${afterType.cam})`);
    await press(page, 'KeyG');
    const g = await E(() => ({ open: window.overdub.liveRoom.isOpen(), screen: window.overdub.ui.state.liveRoom.screen }));
    await press(page, 'Escape');
    await press(page, 'Meta+KeyG');
    const mg = await E(() => window.overdub.liveRoom.isOpen());
    T.ok(g.open && g.screen === 'guitar' && !mg, `G stays in the room (the tape machine's), ⌘G goes through the glass (open after G: ${g.open}; after ⌘G: ${mg})`);
    await E(() => window.overdub.liveRoom.open());
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'guitar', null, { timeout: 5000 }).catch(() => {});

    const form = await E(() => ({ sel: document.querySelectorAll('.gr select').length, range: document.querySelectorAll('.gr input[type=range]').length }));
    T.ok(!form.sel && !form.range, `no <select> and no range slider in the room (${form.sel}, ${form.range})`);
    await s.shot?.('guitar-stage');
    T.ok(!errors.length, `no console or page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await s.close();
  }
}
