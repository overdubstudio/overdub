// The live room's checks: the skeleton in the page [the foundation; frozen] (docs/research/LIVE-ROOM-MODE.md §11.1,
// §14.1, §14.2). The op table (test/unit/ops.test.js), the trials (tools/core-test.js), section.move
// (tools/arrangement-test.js), the cleaners (test/unit/liveroom-model.test.js) and the seams, the ten ops, the song and
// the session (test/unit/liveroom-seams.test.js) hold the rest of §11.1.
//   5. the page (muted Chromium; PAGES=0 skips it): /app/?room opens the room over an inert studio with the anti-flash
//      attribute set and cleared, its keys held, the talkback signed; Control room → gives the studio back with History
//      as it was, and the Live room key brings the room back; bare /app/ and ?new under navigator.webdriver open
//      today's first screens: no room, no key, no data-room. No page errors in any of them.
import { openRoom, history } from './harness.js';

export const name = 'model';
export const pages = true;

const json = (x) => JSON.stringify(x);

export async function run(T, ctx) {
  /* ---------------------------------------------------------------------------------------------- 5. the page */
  if (!ctx.pages) return;
  const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|the server responded with a status of 404/.test(e);
  // What each key the studio declares reaches with the room open, in the shell's own order (ui/shell.js: the keys with
  // a when() first, then the rest; the first that's live takes it): the sigs that reach the studio, which should be
  // the kept ones and no more, and the holds declared for a key nobody declares
  const HOLD = 'Held while the live room is open';
  const KEPT = ['mod+KeyO', 'mod+KeyS', 'mod+KeyY', 'mod+KeyZ', 'mod+shift+KeyZ', 'shift+Escape', 'shift+Slash'];
  const reach = (HOLD) => {
    const list = window.overdub.ui.keys.list(), sig = (k) => `${k.mod ? k.mod + '+' : ''}${k.key}`;
    const order = [...list.filter((k) => k.when), ...list.filter((k) => !k.when)];
    const live = (k) => { try { return !k.when || !!k.when(); } catch { return false; } };
    const through = [];
    for (const sg of new Set(list.map(sig))) {
      const k = order.find((x) => sig(x) === sg && live(x));
      if (k && k.label !== HOLD && k.group !== 'Live room') through.push(sg);
    }
    const holds = new Set(list.filter((k) => k.label === HOLD).map(sig)), studio = new Set(list.filter((k) => k.group !== 'Live room').map(sig));
    return { through: through.sort(), extra: [...holds].filter((x) => !studio.has(x)), n: holds.size };
  };
  const reachOk = (r) => json(r.through) === json(KEPT) && !r.extra.length;
  const reachSaid = (r) => `${r.n} keys held; ${r.through.length} reach the studio${json(r.through) === json(KEPT) ? '' : ': ' + r.through.join(' ')}${r.extra.length ? '; held for nothing: ' + r.extra.join(' ') : ''}`;
  // whether <html> ever had data-room, from before the page's own scripts; and each screen the room mounted, with
  // whether the studio was up by then (data-ready, and Start a song, a module after the room's, installed)
  const watch = () => {
    window.__lrRoomAttr = [];
    window.__lrMounts = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'attributes' && m.attributeName === 'data-room') window.__lrRoomAttr.push(m.target.hasAttribute('data-room'));
        for (const n of m.addedNodes || []) if (n.nodeType === 1 && n.classList.contains('lr-screen')) window.__lrMounts.push({ screen: n.dataset.screen, ready: document.documentElement.dataset.ready === '1', start: !!window.overdub?.start });
      }
    }).observe(document, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-room'] });
  };
  {
    const s = await openRoom('/app/?room', { init: watch });
    try {
      const { page, E } = s;
      await page.waitForFunction(() => window.overdub.liveRoom?.isOpen?.(), null, { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      const up = await E(() => {
        const o = window.overdub, el = document.querySelector('.lr'), L = o.ui.state.liveRoom;
        const under = [...document.body.children].filter((c) => c !== el && !c.classList.contains('ew-toasts'));
        return {
          open: o.liveRoom.isOpen(), state: { ...L }, shown: !!el && !el.hidden && getComputedStyle(el).display !== 'none', inert: under.every((c) => c.inert), covered: o.ui.covered,
          focus: o.ui.state.focus, inRoom: !!el && el.contains(document.activeElement), attr: document.documentElement.hasAttribute('data-room'), seen: window.__lrRoomAttr.slice(),
          key: !!document.querySelector('[data-panel="liveroom"] .lr-key'), screen: el?.querySelector('.lr-screen')?.dataset.screen, history: o.store.history.length, side: JSON.parse(localStorage.getItem('overdub:room') || '{}').side,
        };
      });
      T.ok(up.open && up.state.open && up.state.screen === 'door' && up.shown && up.inert && up.covered === 'liveroom' && up.focus === 'liveroom' && up.inRoom && up.screen === 'door',
        `?room opens the room over the studio on the door: the studio under it inert, ui.covered '${up.covered}', focus in the room (ui.state.liveRoom ${json(up.state)})${up.inert && up.inRoom ? '' : `; inert ${up.inert}, focus in it ${up.inRoom}`}`);
      T.ok(!up.attr && json(up.seen) === json([true, false]), `the anti-flash attribute: set on <html> before the studio was built, cleared once the room was up (${json(up.seen)})`);
      const mounts = await E(() => window.__lrMounts.slice());
      T.ok(mounts.length === 1 && mounts[0].screen === 'door' && mounts[0].ready && mounts[0].start, `opened at load, the room covers the studio at once and mounts its screen once, when the studio is up (${json(mounts)})`);
      T.ok(up.key && up.history === 0 && up.side === 'room', `the studio's Live room key is in the top bar, nothing is in History, and overdub:room says the room (${up.side})`);
      await s.shot('liveroom/model-room');
      // the room holds the studio's keys: B (the browser pane) and Space (play) do nothing under it
      const left0 = await E(() => window.overdub.ui.isOpen('left'));
      await page.keyboard.press('KeyB');
      await page.keyboard.press('Space');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
      const held = await E(() => ({ left: window.overdub.ui.isOpen('left'), playing: !!window.overdub.engine.playing }));
      T.ok(held.left === left0 && !held.playing, `under the room the studio's single keys are held: B left the browser pane ${left0 ? 'open' : 'shut'}, Space didn't play`);
      const r1 = await E(reach, HOLD);
      T.ok(reachOk(r1), `opened at load, every key the studio declares reaches the room's holds but ⌘Z ⇧⌘Z ⌘Y ⌘S ⌘O ? ⇧Esc, in the shell's own order, its modes and every module's keys among them (${reachSaid(r1)})`);
      // the talkback: the house unsigned, an agent signed in its ink
      const tb = await E(() => {
        const o = window.overdub, read = () => ({ text: document.querySelector('.lr-tb-line')?.textContent, by: document.querySelector('.lr-tb-by .by')?.textContent || null, ink: document.querySelector('.lr-tb-by .by')?.className || '' });
        o.liveRoom.say('Two bars of sticks, then you.');
        const house = read();
        o.liveRoom.say('I can double that an octave up.', { by: 'claude' });
        const agent = read();
        return { house, agent, live: document.querySelector('.lr-tb-text')?.getAttribute('aria-live') };
      });
      T.ok(tb.house.text === 'Two bars of sticks, then you.' && tb.house.by === null && tb.agent.by === 'Claude' && /by-agent/.test(tb.agent.ink) && tb.live === 'polite',
        `the talkback: the house's line unsigned, the agent's with its byline in cool ink (${tb.agent.by}), a polite live region`);
      // ? keeps the studio's meaning: the keys sheet comes up over the room, and Esc closes it
      await page.keyboard.press('Shift+Slash');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
      const sheet = await E(() => { const b = document.querySelector('.tpk'); return { up: !!b, inert: !!b?.inert, focus: !!b?.contains(document.activeElement) }; });
      await page.keyboard.press('Escape');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
      const shut = await E(() => ({ gone: !document.querySelector('.tpk'), open: window.overdub.liveRoom.isOpen(), back: !!document.querySelector('.lr')?.contains(document.activeElement) }));
      const fine = sheet.up && !sheet.inert && sheet.focus && shut.gone && shut.open && shut.back;
      T.ok(fine, `? brings up the keys sheet over the room (not held under it), and Esc closes it with the room still open and focus back in it${fine ? '' : `: ${json({ ...sheet, ...shut })}`}`);
      // through the glass and back
      const h0 = await history(page);
      await page.click('.lr-glass');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
      const out = await E(() => {
        const o = window.overdub, el = document.querySelector('.lr');
        return { open: o.liveRoom.isOpen(), hidden: !el || el.hidden, covered: o.ui.covered, inert: [...document.body.children].filter((c) => c !== el).some((c) => c.inert), key: !document.querySelector('[data-panel="liveroom"]')?.hidden, side: JSON.parse(localStorage.getItem('overdub:room') || '{}').side, state: o.ui.state.liveRoom.open, holds: o.ui.keys.list().filter((k) => k.label === 'Held while the live room is open').length };
      });
      const h1 = await history(page);
      T.ok(!out.open && !out.state && out.hidden && out.covered === null && !out.inert && out.key && out.side === 'control' && !out.holds && json(h1) === json(h0),
        `Control room → gives the studio back: the room hidden, nothing inert, no key held, ui.covered ${out.covered}, History as it was (${h1.length} steps), the Live room key still there${out.holds ? `; ${out.holds} keys still held` : ''}`);
      await page.keyboard.press('KeyB');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
      const freed = await E(() => window.overdub.ui.isOpen('left'));
      await page.keyboard.press('KeyB');
      T.ok(freed !== left0, `…and the studio has its keys again (B ${freed ? 'opened' : 'shut'} the browser pane)`);
      await page.click('[data-panel="liveroom"] .lr-key');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
      const again = await E(() => ({ open: window.overdub.liveRoom.isOpen(), screen: window.overdub.ui.state.liveRoom.screen, covered: window.overdub.ui.covered }));
      const r2 = await E(reach, HOLD);
      T.ok(reachOk(r2), `opened again from the studio, the same: only the kept keys reach the studio (${reachSaid(r2)})`);
      const pressed = await E(() => window.overdub.liveRoom.press('glass'));
      const closed = await E(() => !window.overdub.liveRoom.isOpen());
      T.ok(again.open && again.screen === 'door' && again.covered === 'liveroom' && pressed?.ok && closed, `the Live room key brings the room back on the door, and press('glass') goes through again`);
      const errs = s.errors.filter((e) => !ignorable(e));
      T.ok(!errs.length, `no page errors in the room${errs.length ? ': ' + errs.slice(0, 3).join(' | ').slice(0, 400) : ''}`);
    } finally { await s.close(); }
  }
  for (const route of ['/app/', '/app/?new']) {
    const s = await openRoom(route, { init: watch });
    try {
      await s.page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      const st = await s.E(() => ({ room: !!document.querySelector('.lr'), open: !!window.overdub.liveRoom?.isOpen?.(), key: !!document.querySelector('[data-panel="liveroom"]'), attr: document.documentElement.hasAttribute('data-room'), seen: window.__lrRoomAttr.slice(), covered: window.overdub.ui.covered, visible: getComputedStyle(document.getElementById('studio')).visibility, opened: window.overdub.opened, holds: window.overdub.ui.keys.list().filter((k) => k.group === 'Live room').length }));
      const errs = s.errors.filter((e) => !ignorable(e));
      T.ok(!st.room && !st.open && !st.key && !st.attr && !st.seen.length && st.covered === null && st.visible === 'visible' && !st.holds && !errs.length,
        `${route} under navigator.webdriver opens today's first screens (the song ${st.opened}): no room, no Live room key, no key of the room's, no data-room, nothing covered${errs.length ? '; page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 300) : ''}`);
    } finally { await s.close(); }
  }
}
