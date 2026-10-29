// The live room's checks: the guitar room's SHOP stream [guitar room] (docs/research/GUITAR-ROOM.md §2.9; the stream's
// module, app/src/ui/liveroom/guitar/shop.js, says what it owns and its frozen API). Run by tools/liveroom-test.js
// (ONLY=shop), whose header says what a checks module exports. The seams it shares with the other streams are
// checks-guitar.js's.
//   Node: the catalogue (the amp wall holds every amp once, in its tone's section; the pedal case every pedal once, in
//     its drawer); a carried amp keeps your cab and mics and comes in at its measured level; the house's stacks and
//     the club's (rack-db get knows 'house.metal.club'); the shop's own words keep the talkback's rules
//     (checks-copy.js)
//   LEVELS: every amp carried onto the club's stack, rendered offline in muted Chromium with the metal DI fixtures,
//     reads as the club's stack within 1 LU (shop-data.js AMP_TRIM; SHOP_PRINT=1 prints the measured table)
//   muted Chromium: the shop through the door, the wall in five sections with name plates and the case in drawers;
//     looking at an amp shows its card; trying it is a preview (nothing in History, released on leaving); carrying an
//     amp, a pedal, a stack is one step by you on both guitars, refused during a take; the rack: Save to rack
//     round-trips through rack-db and loads onto both guitars with the song's room.stack, one step; the cab builder
//     (on the stage's cab zoom and the try-out corner's) turns the amp's real cab and mic params, one step a gesture;
//     keys (A P [ ] H C S, Esc back out) land with a pedal's knob focused; no <select>, no range slider; no errors;
//     screenshots tools/.out/liveroom/gr-shop-*.png

import { openRoom, press, history } from './harness.js';

export const name = 'shop';
export const pages = true;

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

export async function run(T, ctx) {
  const D = await import('../../app/src/ui/liveroom/guitar/shop-data.js');
  const { getDevice, listDevices } = await import('../../app/src/devices/registry.js');
  const { CLUB_STACK } = await import('../../app/src/core/liveroom/guitar/setup.js');

  /* ---------------------------------------------------------------------------------------- Node */
  {
    const secs = D.ampsBySection();
    const onWall = secs.flatMap((s) => s.amps.map((d) => d.id));
    const amps = listDevices({ cat: 'amp' }).filter((d) => d.id.startsWith('amp.')).map((d) => d.id);
    const missing = amps.filter((id) => !onWall.includes(id));
    const twice = onWall.filter((id, i) => onWall.indexOf(id) !== i);
    const wrong = secs.flatMap((s) => s.amps.filter((d) => D.toneOf(d) !== s.tone).map((d) => d.id));
    T.ok(!missing.length && !twice.length && !wrong.length && onWall.includes('core.stack'), `the amp wall holds every amp once, in its tone's section, the Half Stack with the high-gain heads (${secs.map((s) => `${s.label} ${s.amps.length}`).join(', ')})${missing.length ? ': missing ' + missing.join(' ') : ''}${twice.length ? ': twice ' + twice.join(' ') : ''}`);
    const cats = D.pedalsByCat();
    const inCase = cats.flatMap((c) => c.pedals.map((d) => d.id));
    const pedals = listDevices({ kind: 'effect' }).filter((d) => d.id.startsWith('pedal.')).map((d) => d.id);
    const lost = pedals.filter((id) => !inCase.includes(id));
    T.ok(!lost.length && inCase.length === pedals.length, `the pedal case holds every pedal once, in its drawer (${cats.map((c) => `${c.word} ${c.pedals.length}`).join(', ')}; ${inCase.length} of ${pedals.length})${lost.length ? ': not in a drawer ' + lost.join(' ') : ''}`);
    const club = CLUB_STACK.chain.find((l) => l.device === 'amp.recto');
    const meg = D.carriedAmp('amp.metal', club);
    const yours = { device: 'amp.recto', params: { cab: 7, mic: 1, micpos: 0.5, micdist: 3, micang: 0 } }, meg2 = D.carriedAmp('amp.metal', yours);
    const keep = ['cab', 'mic', 'micpos', 'micdist', 'micang'].every((k) => meg2.params[k] === yours.params[k]) && !('cab' in meg.params) && !('mic' in meg.params);
    const lv = D.carryLevel('amp.metal');
    const hs = D.carriedAmp('core.stack', club);
    T.ok(keep && meg.params.level === lv.value && meg.on && !('gain' in meg.params) && !('cab' in hs.params) && hs.params.level === D.carryLevel('core.stack').value,
      `a carried amp keeps the cab and mics you chose (Megalodon from a Kraken on cab ${yours.params.cab}: cab ${meg2.params.cab}), comes onto its own default off the club's (${D.cabOf(meg).cabName}) and in at its measured level, its own knobs at their defaults (MASTER ${lv.value}; the Half Stack: LEVEL ${hs.params.level} dB)`);
    const said = D.describeStack(CLUB_STACK.chain);
    T.ok(/^Kraken on a Modern 4x12, close dynamic, a noise gate and a treble booster in front$/.test(said), `a stack in a phrase: "${said}"`);
    const cab = D.cabOf(club), des = D.cabOf(yours), bass = D.cabOf({ device: 'amp.whale', params: {} });
    T.ok(cab.kind === 'clawd' && cab.cab === 'modern-close' && cab.measured && cab.def === 'modern-close' && cab.mic1 === null && cab.mic2 === null
      && des.cab === 'v412' && !des.measured && des.mic1.type === 'ribbon' && des.mic1.pos === 0.5 && bass.cab === 'own' && bass.def === 'own' && !bass.measured && bass.mic1.type === 'dyn'
      && D.MEASURED_CABS.length === 6 && D.cabOf({ device: 'core.stack', params: {} }).kind === 'stack',
    `the cab builder reads the amp's own params, its default when none is set (Kraken: ${cab.cabName}, measured, no mic to place; on cab 7: ${des.cabName}, ${D.MICS[des.mic1.type].name} ${D.onCone(des.mic1.pos)}, ${D.inches(des.mic1.dist)}; Blue Whale: ${bass.cabName})`);
    // the shop's own words keep the talkback's rules
    const { SAY, SAMPLE } = await import('../../app/src/ui/liveroom/guitar/shop-say.js');
    const { NEVER, sentences } = await import('./checks-copy.js');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const NEVER_RE = Object.entries(NEVER).flatMap(([kind, words]) => words.map((w) => ({ kind, w, re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(w).replace(/ /g, '\\s+')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu') })));
    const bad = [];
    for (const [k, fn] of Object.entries(SAY)) {
      let text;
      try { text = fn(SAMPLE[k] || {}); } catch (e) { bad.push(`${k} throws: ${e.message}`); continue; }
      for (const { kind, re } of NEVER_RE) { const m = text.match(re); if (m) bad.push(`${k} says "${m[0]}" (${kind})`); }
      if (sentences(text) > 2) bad.push(`${k}: ${sentences(text)} sentences`);
      if (/!|undefined|NaN|\[object|\s{2}/.test(text)) bad.push(`${k}: "${text}"`);
    }
    T.ok(!bad.length, `the shop's ${Object.keys(SAY).length} lines keep the talkback's rules (no never-says word, two sentences at most, nothing broken)${bad.length ? ': ' + bad.join('; ') : ''}`);
  }

  if (!ctx.pages) return;
  /* ---------------------------------------------------------------------------------------- muted Chromium */
  const s = await openRoom('/app/?room', { name: 'shop' });
  const { page, E, errors } = s;
  try {
    if (ctx.levels) {
      const { metalDI } = await import('../amp-scenes.js');
      const dis = { chug: Array.from(metalDI('chug')), chords: Array.from(metalDI('chords')) };
      const lv = await E(async (dis) => {
        const R = await import('/app/src/devices/registry.js');
        const M = await import('/app/src/audio/measure.js');
        const D = await import('/app/src/ui/liveroom/guitar/shop-data.js');
        const { CLUB_STACK } = await import('/app/src/core/liveroom/guitar/setup.js');
        const SR = 48000;
        async function render(chain, x) {
          const c = new OfflineAudioContext(2, x.length, SR), src = c.createBufferSource(), b = c.createBuffer(1, x.length, SR);
          b.copyToChannel(x, 0); src.buffer = b;
          let at = src;
          const made = [];
          for (let k = 0; k < chain.length; k++) {
            const l = chain[k];
            if (l.on === false) continue;
            const inst = await R.instantiate(c, l.device, { uid: `sl${k}`, params: l.params || {}, on: true, bpm: 132 });
            await inst.ready; made.push(inst); at.connect(inst.input); at = inst.output;
          }
          at.connect(c.destination); src.start(0);
          const r = await c.startRendering();
          for (const i of made) i.dispose();
          return r;
        }
        const xs = Object.values(dis).map((a) => Float32Array.from(a));
        const loud = async (chain) => { let s = 0; for (const x of xs) s += M.lufs(await render(chain, x)); return s / xs.length; };
        const club = CLUB_STACK.chain.map((l) => ({ ...l, params: { ...l.params } }));
        const ai = club.findIndex((l) => l.device === 'amp.recto');
        const target = await loud(club);
        const out = { target, amps: {} };
        for (const id of Object.keys(D.AMP_TRIM)) {
          const carried = D.carriedAmp(id, club[ai]);
          // (at the default level: what the trim was measured at; and as carried: what the trim makes it)
          const lvl = D.carryLevel(id);
          const atDef = { ...carried, params: { ...carried.params } };
          delete atDef.params[lvl.key];
          const chainDef = club.map((l, i) => (i === ai ? atDef : l));
          const chainNow = club.map((l, i) => (i === ai ? carried : l));
          out.amps[id] = { def: await loud(chainDef), now: await loud(chainNow), level: lvl.value };
        }
        return out;
      }, dis);
      const rows = Object.entries(lv.amps).map(([id, r]) => ({ id, ...r, trim: Math.round((lv.target - r.def) * 10) / 10 }));
      if (process.env.SHOP_PRINT) console.log('AMP_TRIM', JSON.stringify(Object.fromEntries(rows.map((r) => [r.id, r.trim]))), 'target', f1(lv.target));
      const off = rows.filter((r) => Math.abs(r.now - lv.target) > 1 && !(r.level <= 0 || r.level >= 10));
      T.ok(!off.length, `every amp carried onto the club's stack reads as the club's stack within 1 LU, measured (the metal DIs offline; the club at ${f1(lv.target)} LUFS; ${rows.length} amps, the widest ${f1(Math.max(...rows.map((r) => Math.abs(r.now - lv.target))))} LU)${off.length ? ': ' + off.map((r) => `${r.id} ${f1(r.now)} at ${r.level}`).join(', ') : ''}`);
    }

    // into the club, then through the door
    await E(async () => { const o = window.overdub; if (o.liveRoom.isOpen()) o.liveRoom.close(); o.liveRoom.open({ screen: 'door' }); await new Promise((r) => setTimeout(r, 200)); });
    await press(page, 'Digit1');
    await page.waitForFunction(() => window.overdub.ui.state.liveRoom.screen === 'guitar', null, { timeout: 15000 }).catch(() => {});
    const wait = (ms) => page.waitForTimeout(ms);
    const at = () => E(() => { const gr = window.overdub.ui.state.liveRoom.gr; return { world: gr.world, cam: gr.cam, area: gr.shop.area, trying: gr.shop.trying || null }; });
    const rig = () => E(async () => {
      const { rigOf } = await import('/app/src/core/liveroom/guitar/rig.js');
      const r = rigOf(window.overdub.store.get());
      return r && { same: r.same, amp: r.amp ? r.chain[r.amp.slot] : null, board: r.board.map((b) => b.device), chain: r.chain, stack: window.overdub.store.get().room?.stack || null };
    });
    await E(() => window.overdub.liveRoom.press('shop'));
    await page.waitForFunction(() => { const gr = window.overdub.ui.state.liveRoom.gr; return gr.world === 'shop' && gr.cam === 'wall'; }, null, { timeout: 5000 }).catch(() => {});
    await wait(500);
    const wall = await E(() => {
      const q = (s) => [...document.querySelectorAll(s)];
      const amps = q('.gr .grs-amp').map((b) => b.dataset.id), plates = q('.gr .grs-amp .grs-plate').filter((p) => p.textContent.trim()).length;
      const ewf = q('.gr .grs-amp .am').filter((a) => a.getBoundingClientRect().width > 10).length;
      return { amps, plates, ewf, list: document.querySelector('.gr [role=listbox]')?.getAttribute('aria-label') || '', taken: q('.gr .grs-amp.taken').map((b) => b.dataset.id) };
    });
    const D2 = D.ampsBySection().flatMap((x) => x.amps.map((d) => d.id));
    T.ok(wall.amps.length === D2.length && wall.plates === D2.length && wall.ewf === D2.length && wall.taken.join() === 'amp.recto', `through the door: the amp wall, ${wall.amps.length} amps each on its shelf with a name plate, in five sections; the club's Kraken is off the wall, on your stack (${wall.taken.join()})`);
    await s.shot('liveroom/gr-shop-wall');

    // a look: the card; held: a try (heard, never kept); away: your stack is back
    const h0 = (await history(page)).length;
    await page.hover('.gr .grs-amp[data-id="amp.metal"]');
    await wait(200);
    const card = await E(() => { const c = document.querySelector('.gr .grs-card'); return { on: c.classList.contains('on'), text: c.textContent }; });
    await wait(800);
    const trying = await at(), during = await rig();
    await s.shot('liveroom/gr-shop-card');
    await page.mouse.move(1300, 880);
    await wait(150);
    const after = await rig(), hTry = (await history(page)).length;
    const megNod = getDevice('amp.metal')?.nod;
    T.ok(card.on && card.text.includes('Megalodon') && (!megNod || card.text.includes(`In the spirit of ${megNod}`)) && trying.trying === 'amp.metal' && during.amp.device === 'amp.metal' && during.same && after.amp.device === 'amp.recto' && hTry === h0,
      `a look at Megalodon shows its card ("In the spirit of ${megNod}"); held, you hear it on both guitars (${during.amp.device}); looked away, the Kraken is back and History never knew (${hTry - h0} steps)`);

    // carrying: an amp, one step by you on both guitars, at its measured level, on your cab
    await page.click('.gr .grs-amp[data-id="amp.metal"]');
    await wait(150);
    const carried = await rig(), h1 = await history(page);
    const lv = D.carryLevel('amp.metal');
    T.ok(carried.amp.device === 'amp.metal' && carried.same && carried.amp.params.level === lv.value && carried.amp.params.cab == null && h1.length === h0 + 1 && h1.at(-1).by === 'you',
      `a click carries Megalodon to your stack: one step by you, both guitars, at its measured level (MASTER ${lv.value}) on its own measured cab (${h1.at(-1)?.label})`);
    // refused during a take
    const refused = await E(() => {
      const o = window.overdub, L = o.ui.state.liveRoom, R = document.querySelector('.gr').__gr, was = L.run, n = o.store.history.length;
      L.run = 'take';
      const r1 = R.parts.shop.carry({ link: { device: 'amp.clean' } }), r2 = R.parts.shop.carry({ link: { device: 'pedal.delay' } });
      const tried = R.parts.shop.tryOn('amp.clean');
      L.run = was;
      return { r1, r2, tried, n: o.store.history.length - n };
    });
    T.ok(!refused.r1.ok && !refused.r2.ok && !refused.tried && refused.n === 0 && /once the take is in/.test(refused.r1.error), `during a take the rig stays as it is: nothing carried, nothing tried ("${refused.r1.error}")`);

    // by keys: an amp focused, the arrows walk the wall, Enter carries
    const hk0 = (await history(page)).length;
    await E(() => document.querySelector('.gr .grs-amp[data-id="amp.recto"]').focus());
    await press(page, 'ArrowRight');
    const focused = await E(() => document.activeElement?.dataset?.id || null);
    await press(page, 'Enter');
    await wait(100);
    const byKeys = await rig(), hk1 = await history(page);
    T.ok(focused && focused !== 'amp.recto' && byKeys.amp.device === focused && byKeys.same && hk1.length === hk0 + 1 && hk1.at(-1).by === 'you', `by keys: an arrow walks the wall to ${focused}, Enter carries it to your stack, one step by you (${byKeys.amp.device}, ${hk1.length - hk0} steps, ${hk1.at(-1)?.label})`);
    await page.mouse.move(1300, 880);
    // the case: drawers, ] to the next, a pedal onto the board
    await E(() => window.overdub.liveRoom.press('shop:case'));
    await wait(450);
    const c0 = await E(() => ({ cam: window.overdub.ui.state.liveRoom.gr.cam, tabs: document.querySelectorAll('.gr .grs-cat').length, cat: window.overdub.ui.state.liveRoom.gr.shop.cat, peds: document.querySelectorAll('.gr .grs-ped').length }));
    await press(page, 'BracketRight');
    const c1 = await E(() => ({ cat: window.overdub.ui.state.liveRoom.gr.shop.cat, peds: [...document.querySelectorAll('.gr .grs-ped')].map((p) => p.dataset.id) }));
    await press(page, 'BracketLeft');
    const cats = D.pedalsByCat();
    T.ok(c0.cam === 'case' && c0.tabs === cats.length && c0.peds === cats.find((c) => c.cat === c0.cat).pedals.length && c1.cat !== c0.cat && c1.peds.length === cats.find((c) => c.cat === c1.cat).pedals.length,
      `P opens the pedal case: ${c0.tabs} drawers; ] goes to the next (${c0.cat} to ${c1.cat}), its ${c1.peds.length} pedals on the shelves`);
    await E(() => { const t = document.querySelector('.gr .grs-cat[data-cat="mod"]'); t?.click(); });
    await wait(150);
    const before = await rig(), hp0 = (await history(page)).length;
    await page.click('.gr .grs-ped[data-id="pedal.chorus"]');
    await wait(200);
    const withP = await rig(), hp1 = await history(page);
    await s.shot('liveroom/gr-shop-case');
    T.ok(withP.board.length === before.board.length + 1 && withP.board.includes('pedal.chorus') && withP.same && hp1.length === hp0 + 1 && hp1.at(-1).by === 'you',
      `a click puts a pedal on your board: one step by you, both guitars (${withP.board.join(', ')})`);

    // the board along the front: drag a pedal to move it, × puts it back in the case
    const order0 = (await rig()).board, hb0 = (await history(page)).length;
    const box = async (sel) => page.locator(sel).boundingBox();
    const g0 = await box('.gr .grs-slot[data-device="pedal.gate"]'), m0 = await box('.gr .grs-slot[data-device="pedal.mantisboost"]');
    await page.mouse.move(g0.x + g0.width / 2, g0.y + 8);
    await page.mouse.down();
    await page.mouse.move(g0.x + g0.width / 2 + 20, g0.y + 8, { steps: 3 });
    await page.mouse.move(m0.x + m0.width * 0.9, g0.y + 8, { steps: 6 });
    await page.mouse.up();
    await wait(150);
    const order1 = (await rig()).board, hb1 = await history(page);
    await page.click('.gr .grs-slot[data-device="pedal.chorus"] .rm');
    await wait(150);
    const order2 = await rig(), hb2 = await history(page);
    T.ok(order1.indexOf('pedal.gate') === order0.indexOf('pedal.gate') + 1 && hb1.length === hb0 + 1 && !order2.board.includes('pedal.chorus') && order2.same && hb2.length === hb0 + 2 && hb2.slice(-2).every((x) => x.by === 'you'),
      `on the board, a drag moves a pedal (${order1.slice(0, 2).join(', ')}) and × puts one back in the case (${order2.board.length} left), a step each by you`);
    // the rack: Save to rack, a name, Enter
    await E(() => window.overdub.liveRoom.press('rack'));
    await wait(400);
    await E(() => window.overdub.liveRoom.press('save'));
    await wait(120);
    const field = await E(() => { const i = document.activeElement; return i?.tagName === 'INPUT' ? i.value : null; });
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('Shop check wall');
    const hs0 = (await history(page)).length;
    await page.keyboard.press('Enter');
    await wait(400);
    const saved = await E(async () => {
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      const list = await rack.list();
      const st = window.overdub.store.get().room?.stack;
      const mine = list.find((x) => x.name === 'Shop check wall');
      return { st, id: mine?.id || null, chain: mine?.chain || null, cam: window.overdub.ui.state.liveRoom.gr.cam };
    });
    const hs1 = await history(page);
    T.ok(field && saved.id && saved.st?.id === saved.id && hs1.length === hs0 + 1 && hs1.at(-1).by === 'you' && saved.cam === 'rack',
      `Save to rack: the name field (it offered "${field}"), Enter keeps it on the rack (${saved.id}) and the song's stack names it, one step by you`);
    await s.shot('liveroom/gr-shop-rack');
    // the club's stack back on, then the saved one: each one step, both guitars, the song's stack
    const loads = await E(async (id) => {
      const o = window.overdub, R = document.querySelector('.gr').__gr, { rigOf } = await import('/app/src/core/liveroom/guitar/rig.js'), { sameChain } = await import('/app/src/core/liveroom/stacks.js');
      const n0 = o.store.history.length;
      const a = await R.parts.shop.load('house.metal.club');
      const r1 = rigOf(o.store.get()), st1 = o.store.get().room.stack;
      const n1 = o.store.history.length;
      const rack = await import('/app/src/ui/liveroom/rack-db.js');
      const saved = await rack.get(id);
      const b = await R.parts.shop.load(id);
      const r2 = rigOf(o.store.get()), st2 = o.store.get().room.stack;
      const n2 = o.store.history.length;
      o.store.undo();
      const st3 = o.store.get().room.stack, r3 = rigOf(o.store.get());
      o.store.redo();
      return { a: a.ok, b: b.ok, club: r1.amp && r1.chain[r1.amp.slot].device, same1: r1.same, st1, st2, steps: [n1 - n0, n2 - n1], by: o.store.history.at(-1).by, back: sameChain(r2.chain, saved.chain) && r2.same, undone: st3?.id, undoneAmp: r3.amp && r3.chain[r3.amp.slot].device, changed: R.parts.shop.changed() };
    }, saved.id);
    T.ok(loads.a && loads.b && loads.club === 'amp.recto' && loads.same1 && loads.st1.id === 'house.metal.club' && loads.st2.id === saved.id && loads.steps.join() === '1,1' && loads.by === 'you' && loads.back && loads.undone === 'house.metal.club' && loads.undoneAmp === 'amp.recto' && !loads.changed,
      `the rack loads the club's stack and the saved one onto both guitars with the song's stack, one step each (undo takes the stack and its name back together: ${loads.undone}, ${loads.undoneAmp})`);

    // the rack: take one off, put it back
    await E(() => window.overdub.liveRoom.press('rack'));
    await wait(300);
    await E((id) => document.querySelector(`.gr .grs-unit[data-id="${id}"]`)?.focus(), saved.id);
    await wait(60);
    await E(() => [...document.querySelectorAll('.gr .grs-sheet button')].find((b) => /off the rack/.test(b.textContent))?.click());
    await wait(250);
    const off = await E(async (id) => (await (await import('/app/src/ui/liveroom/rack-db.js')).list()).some((x) => x.id === id), saved.id);
    await E(() => [...document.querySelectorAll('.gr .grs-sheet button')].find((b) => /Put it back/.test(b.textContent))?.click());
    await wait(250);
    const back = await E(async (id) => (await (await import('/app/src/ui/liveroom/rack-db.js')).list()).some((x) => x.id === id), saved.id);
    T.ok(!off && back, `a stack of yours comes off the rack and goes back on (off: ${!off}, back: ${back})`);
    // the try-out corner: the head (a knob focused, keys still land), the cab builder
    await E(() => window.overdub.liveRoom.press('shop:head'));
    await wait(450);
    const head = await E(() => ({ cam: window.overdub.ui.state.liveRoom.gr.cam, panel: document.querySelector('.gr-panel[data-target="tryout-head"], .gr-panels [data-target="tryout-head"]')?.textContent?.slice(0, 80) || '' }));
    await s.shot('liveroom/gr-shop-head');
    const kh0 = (await history(page)).length;
    await E(() => document.querySelector('.gr .grs-head [role=slider]')?.focus());
    await press(page, 'ArrowUp');
    const kh1 = await history(page);
    await press(page, 'KeyC');
    const toCab = await at();
    T.ok(head.cam === 'tryout-head' && kh1.length === kh0 + 1 && kh1.at(-1).by === 'you' && toCab.cam === 'tryout-cab', `H goes to your head: a focused knob turns with the arrows (one step by you: ${kh1.at(-1)?.label}), and C with it focused goes to the cab (${toCab.cam})`);
    // a knob on the head dragged: it keeps turning while the hand moves (the head isn't drawn again under it)
    await press(page, 'Escape');
    await wait(450);
    const gain0 = (await rig()).amp.params.gain, kd0 = (await history(page)).length;
    const kb = await page.locator('.gr .grs-head [role=slider]').first().boundingBox();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 + i * 6); await wait(20); }
    await page.mouse.up();
    await wait(100);
    const gain1 = (await rig()).amp.params.gain, kd1 = await history(page);
    const gd = getDevice((await rig()).amp.device).params.find((p) => p.key === 'gain');
    T.ok(gain0 - gain1 > (gd.max - gd.min) * 0.15 && kd1.length - kd0 <= 1 && kd1.at(-1).by === 'you' && /gain/.test(kd1.at(-1).label), `a head knob dragged keeps turning as the hand moves, one step by you (the arrow's turn before it coalesces in: gain ${f1(gain0)} to ${f1(gain1)} over 48 px)`);
    await press(page, 'KeyC');
    await wait(450);
    const cb0 = await rig(), hc0 = (await history(page)).length;
    // on its measured cab: the six measured cabs first (its default marked and picked), the designed ones after, and no
    // mic to place
    const meas = await E(() => {
      const p = document.querySelector('.gr-panel[data-target=tryout-cab]'), q = (sel) => [...p.querySelectorAll(sel)];
      return { measured: q('.grs-cablist.measured .grs-chip').map((b) => b.textContent), on: q('.grs-cablist.measured .grs-chip[aria-checked=true]').map((b) => b.textContent),
        designed: q('.grs-cablist:not(.measured) .grs-chip').length, faders: q('.grs-fader').length, mics: document.querySelectorAll('.gr .grs-cab.open .grs-mic').length,
        note: p.textContent.includes('no mic to move'), plate: document.querySelector('.gr .grs-cab.open')?.classList.contains('ir') };
    });
    await s.shot('liveroom/gr-shop-cab-measured');
    T.ok(meas.measured.length === 6 && meas.on.length === 1 && /· default$/.test(meas.on[0]) && meas.designed > 8 && !meas.faders && !meas.mics && meas.note && meas.plate,
      `the cab builder on a measured cab: the six measured cabs (${meas.on[0]} picked), ${meas.designed} designed ones after; no mic to move, and it says so`);
    await page.click('.gr-panel[data-target=tryout-cab] .grs-cablist:not(.measured) .grs-chip:nth-child(3)');
    await wait(100);
    const cb1 = await rig();
    await E(() => document.querySelector('.gr-panel[data-target=tryout-cab] .grs-fader[aria-label^="Mic 1: distance"]')?.focus());
    await press(page, 'ArrowRight');
    const cb2 = await rig(), hc2 = await history(page);
    const mics = await E(() => document.querySelectorAll('.gr .grs-cab.open .grs-mic').length);
    await s.shot('liveroom/gr-shop-cab');
    T.ok(cb1.amp.params.cab !== cb0.amp.params.cab && cb2.amp.params.micdist > (cb1.amp.params.micdist ?? 1) && cb2.same && hc2.length === hc0 + 2 && hc2.slice(-2).every((x) => x.by === 'you') && mics >= 1,
      `C opens the cab builder at the grille (${mics} mic on it): a cab chip and a distance fader turn the amp's own params on both guitars, a step each (cab ${cb0.amp.params.cab} to ${cb1.amp.params.cab}, mic ${cb2.amp.params.micdist}″ back)`);
    // a mic dragged across the cone
    const md0 = (await rig()).amp.params.micpos ?? 0.3, hm0 = (await history(page)).length;
    const mb = await box('.gr .grs-cab.open .grs-mic .mic-body');
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.down();
    await page.mouse.move(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 + 30, { steps: 4 });
    await page.mouse.move(mb.x + mb.width / 2 + 90, mb.y + mb.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await wait(120);
    const md1 = await rig(), hm1 = await history(page);
    const held = await E(() => ({ dragging: window.overdub.ui.state.liveRoom.gr.shop.dragging, mics: document.querySelectorAll('.gr .grs-cab.open .grs-mic.dragging').length }));
    T.ok(md1.amp.params.micpos !== md0 && md1.same && hm1.length === hm0 + 1 && hm1.at(-1).by === 'you' && !held.dragging && !held.mics, `a mic dragged across the cone moves on both guitars, one step by you, and is let go with the hand (on the cone ${md0} to ${md1.amp.params.micpos}; still held: ${held.dragging})`);
    // Esc back out: the corner, the case, the stage
    const esc = [];
    for (let i = 0; i < 3; i++) { await press(page, 'Escape'); await wait(i === 2 ? 600 : 80); esc.push((await at()).cam); }
    T.ok(esc.join() === 'tryout-head,rack,stage', `Esc walks back the way you came: the head, the rack, the stage (${esc.join(' → ')})`);
    // the stage's cab zoom: the same builder, a mic to drag on a small cab
    await press(page, 'KeyC');
    await wait(450);
    const stageCab = await E(() => ({ cam: window.overdub.ui.state.liveRoom.gr.cam, chips: document.querySelectorAll('.gr-panel[data-target=cab] .grs-cablist .grs-chip').length, mics: document.querySelectorAll('.gr-panel[data-target=cab] .grs-cab.mini .grs-mic').length }));
    await s.shot('liveroom/gr-shop-stagecab');
    await press(page, 'Escape');
    T.ok(stageCab.cam === 'cab' && stageCab.chips > 8 && stageCab.mics >= 1, `on the stage, C's cab zoom is the cab builder too (${stageCab.chips} cabs, ${stageCab.mics} mic on the small cab)`);
    // the Half Stack carried: its measured cabs are chips, its head draws no menu
    const hsr = await E(() => document.querySelector('.gr').__gr.parts.shop.carry({ link: { device: 'core.stack' } }));
    await press(page, 'KeyC');
    await wait(450);
    const hs = await E(() => ({ chips: [...document.querySelectorAll('.gr-panel[data-target=cab] .grs-cablist .grs-chip')].map((b) => b.textContent), head: document.querySelector('.gr .grs-head')?.dataset.amp }));
    await s.shot('liveroom/gr-shop-stackcab');
    await press(page, 'Escape');
    const stackCabs = getDevice('core.stack').params.find((p) => p.key === 'cab').opts;
    T.ok(hsr.ok && hs.head === 'core.stack' && hs.chips.length === stackCabs.length, `the Half Stack carried: the cab zoom offers its ${hs.chips.length} measured cabs as chips (${hs.chips.slice(0, 3).join(', ')}, …)`);
    const form = await E(() => ({ sel: document.querySelectorAll('.gr select').length, range: document.querySelectorAll('.gr input[type=range]').length }));
    T.ok(!form.sel && !form.range, `no <select> and no range slider in the shop (${form.sel}, ${form.range})`);
    T.ok(!errors.length, `no console or page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await s.close();
  }
}
