// Slide Rule (core.eq8), the eight-band EQ you drag over a live spectrum: the kernel (app/src/devices/builtin/eq8.js),
// its filter math (eq8-curve.js, shared with the window), the window (app/src/ui/editors/eq8.js) and the banded plan
// agents' adjust uses (app/src/agent/lexicon.js eqPlan).
//
// In Node (the kernel, its measured response, clicks, auto gain, solo, cost, the banded plan): moved to
// test/unit/eq-slide-rule.test.js.
// In Chromium: the device check at the defaults and on every preset; the window (from the rack's Open; a node drag in
// one undo step signed you; Shift, Alt and the wheel; double-click to add and to reset; the band menu; solo on the live
// device only; an agent's move flashing the node; the keys and the screen reader's words; the phone sheet and two
// fingers); get_device and adjust on it; no page errors.
//   node tools/eq-test.js        screenshots: tools/.out/eq-*.png
import { kernelCore, kernelCompiler } from '../app/src/kernel/worklet.js';
import { kernelSpecs } from '../app/src/kernel/host.js';
import { makeDsp } from '../app/src/kernel/dsp.js';
import { getDevice, paramValues } from '../app/src/devices/registry.js';
import '../app/src/devices/builtin/index.js';
import { open, tally } from './pw.js';

const T = tally('eq');

// The cost of the kernel in Node, wall clock: 4 s of audio through all eight bands, in 128-frame blocks, under 5% of
// real time. (Timed here, not in test/unit: this runner retries a suite alone when load made it fail.)
{
  const SR = 48000, def = getDevice('core.eq8');
  const K = kernelCore(SR, makeDsp(SR), kernelCompiler);
  const p = {};
  for (let b = 1; b <= 8; b++) Object.assign(p, { [`b${b}_on`]: 1, [`b${b}_type`]: b === 1 ? 5 : b === 8 ? 8 : 0, [`b${b}_gain`]: 3 });
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
  const render = () => {
    const values = paramValues(def, { ...p, out_auto: 1 });
    const c = new K({ source: def.kernel, kind: 'effect', params: kernelSpecs(def), values, seed: 1, transport: { bpm: 120, playing: true, beat: 0, time: 0 } }, () => {});
    c.msg({ type: 'params', values, jump: true });
    const iL = new Float32Array(128), bL = new Float32Array(128), bR = new Float32Array(128);
    for (let f = 0; f < x.length; f += 128) { iL.set(x.subarray(f, f + 128)); c.block(iL, iL, bL, bR, f); }
  };
  render(); // (warm the JIT)
  const t0 = performance.now(); render(); const ms = performance.now() - t0;
  T.ok(ms / 4000 * 100 < 5, `all eight bands on (two of them 48 dB cuts) with auto gain: 4 s in ${ms.toFixed(1)} ms in Node, ${(ms / 40).toFixed(2)}% of real time (the device check warns at 25%)`);
}
const ok = T.ok;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================================================================== in Chromium */
const ours = (errors) => errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia/.test(e));
console.log('\nthe device check (Chromium)');
{
  const s = await open('/app/');
  const { page, errors } = s;
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    const res = await page.evaluate(async () => {
      const { getDevice } = await import('/app/src/devices/registry.js');
      const { checkDevice } = await import('/app/src/kernel/check.js');
      const def = getDevice('core.eq8');
      const out = [{ name: 'defaults', r: await checkDevice(def) }];
      for (const pr of def.presets) out.push({ name: pr.name, r: await checkDevice({ ...def, params: def.params.map((p) => ({ ...p, def: pr.params[p.key] ?? p.def })) }, { quick: true }) });
      return out.map(({ name, r }) => ({ name, ok: r.ok, errors: r.errors, warnings: r.warnings, delta: r.level?.deltaLU, drums: r.level?.drumsDeltaLU, tp: r.truePeak, nan: r.nan, det: r.deterministic, cpu: r.cpu?.pct, worst: r.extremes?.worstPeak }));
    });
    const d = res[0];
    ok(d.ok && !d.nan && d.det === true, `at its defaults: the check passes, no NaN, deterministic (${d.errors.join('; ') || 'no errors'})`);
    ok(Math.abs(d.delta) <= 0.05 && Math.abs(d.drums) <= 0.05, `at its defaults it measures ${d.delta} LU (strum) and ${d.drums} LU (drums) from bypass`);
    ok(d.tp <= -1 && d.cpu < 25, `true peak ${d.tp} dBTP, CPU ${d.cpu}% of real time (budget 25%); every extreme renders (worst ${d.worst} dBFS)`);
    T.note(`warnings at the defaults: ${d.warnings.join(' | ') || 'none'}`);
    for (const p of res.slice(1)) ok(p.ok && !p.nan && p.det === true && p.cpu < 25, `"${p.name}": the check passes (${p.delta} LU, ${p.tp} dBTP, CPU ${p.cpu}%${p.warnings.length ? '; ' + p.warnings.join(' | ') : ''})`);
    ok(!ours(errors).length, `no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) { ok(false, 'the check threw: ' + (e && e.stack || e)); }
  await s.close();
}

console.log('\nthe window (Chromium, desktop)');
{
  const s = await open('/app/', { query: 'demo', width: 1440, height: 900 });
  const { page, errors, shot } = s;
  page.setDefaultTimeout(15000);
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    await E(() => document.querySelector('.ar-welcome-x')?.click());
    const setup = await E(() => {
      const a = window.overdub, t = a.store.get().tracks.find((x) => x.kind === 'instrument');
      const r = a.store.dispatch({ type: 'insert.add', track: t.id, insert: { device: 'core.eq8' }, ref: 'q' }, { by: 'you', label: 'an EQ' });
      a.ui.select({ track: t.id, clip: null, insert: r.created.q }); a.ui.show('rack');
      return { track: t.id, trackName: t.name, fx: r.created.q };
    });
    await sleep(500);
    // from the device window: the rack's Open
    await E((fx) => document.querySelector(`[data-panel="rack"] .rk-card[data-insert="${fx}"]`)?.scrollIntoView({ inline: 'center' }), setup.fx);
    await page.click(`[data-panel="rack"] .rk-card[data-insert="${setup.fx}"] .rk-open`);
    await page.waitForSelector('.pw[data-editor="eq8"] .eq8-plot', { timeout: 10000 });
    await sleep(300);
    const first = await E(() => {
      const w = document.querySelector('.pw'), nodes = [...w.querySelectorAll('.eq8-node')];
      const hint = w.querySelector('.eq8-hint');
      return { editor: w.dataset.editor, nodes: nodes.length, shown: nodes.filter((n) => !n.hidden).length, cells: w.querySelectorAll('.eq8-cell').length, hint: hint && !hint.hidden ? hint.textContent : null, face: !!document.querySelector('.rk-card .pd-screen'), over: w.querySelector('.pw-body').scrollWidth - w.querySelector('.pw-body').clientWidth };
    });
    ok(first.editor === 'eq8' && first.nodes === 8 && first.cells === 8, `Open on its face opens its own window: the plot, eight nodes, the eight bands in a row (${first.editor}, ${first.nodes} nodes, ${first.cells} cells)`);
    ok(first.shown === 0 && /Double-click the line/.test(first.hint || ''), `at its defaults no band is placed, and it says how to place one ("${first.hint}")`);
    ok(first.face, 'its face in the rack draws the curve on a screen');
    ok(first.over <= 1, 'nothing runs out sideways');

    // double-click the plot: a band there
    const h0 = await E(() => window.overdub.store.history.length);
    const at = await E(() => document.querySelector('.eq8').eq8Map.xy(1200, 6));
    await page.mouse.dblclick(at.x, at.y);
    await sleep(150);
    const added = await E(({ track, fx, h0 }) => {
      const a = window.overdub, p = a.store.insert(track, fx).params, last = a.store.history[a.store.history.length - 1];
      const n = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => p[`b${k}_on`] === 1);
      const nd = document.querySelector(`.eq8-node[data-band="${n}"]`);
      return { n, f: p[`b${n}_freq`], g: p[`b${n}_gain`], type: p[`b${n}_type`], steps: a.store.history.length - h0, by: last.by, focus: document.activeElement === nd, label: nd?.getAttribute('aria-label'), sel: nd?.classList.contains('sel') };
    }, { ...setup, h0 });
    ok(added.n === 5 && Math.abs(Math.log2(added.f / 1200)) < 0.03 && Math.abs(added.g - 6) < 0.3 && added.type === 0, `a double-click at 1.2 kHz, +6 dB adds a bell there, on the free band parked nearest (band ${added.n}: ${added.f} Hz, ${added.g} dB)`);
    ok(added.steps === 1 && added.by === 'you' && added.focus && added.sel, `…in one undo step signed you, picked and focused (${added.steps} step, ${added.by})`);
    ok(/^Band 5, bell, 1\.\d+ kHz, plus (5\.\d|6(\.\d)?) dB$/.test(added.label || ''), `its node tells a screen reader "${added.label}"`);
    await shot('eq-added');

    // drag a node: frequency and gain, one undo step signed you
    const node = async (n) => E((n) => { const r = document.querySelector(`.eq8-node[data-band="${n}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, n);
    const params = () => E(({ track, fx }) => ({ ...window.overdub.store.insert(track, fx).params }), setup);
    const drag = async (n, dx, dy, mods = []) => {
      const c = await node(n);
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.move(c.x, c.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + dx * i / 10, c.y + dy * i / 10);
      await page.mouse.up();
      for (const m of mods) await page.keyboard.up(m);
      await sleep(80);
    };
    const p0 = await params(), d0 = await E(() => window.overdub.store.history.length);
    await drag(5, 120, -60);
    const p1 = await params();
    const dragged = await E((d0) => { const a = window.overdub, last = a.store.history[a.store.history.length - 1]; return { steps: a.store.history.length - d0, by: last.by, keys: [...new Set(last.ops.flatMap((o) => Object.keys(o.patch?.params || {})))].sort() }; }, d0);
    ok(p1.b5_freq > p0.b5_freq * 1.5 && p1.b5_gain > p0.b5_gain + 2, `dragging node 5 right and up raises its frequency and gain (${p0.b5_freq} -> ${p1.b5_freq} Hz, ${p0.b5_gain} -> ${p1.b5_gain} dB)`);
    ok(dragged.steps === 1 && dragged.by === 'you' && dragged.keys.includes('b5_freq') && dragged.keys.includes('b5_gain'), `the drag is one undo step, signed you, setting ${dragged.keys.join(', ')}`);
    await E(() => window.overdub.store.undo());
    await sleep(60);
    const p2 = await params();
    ok(p2.b5_freq === p0.b5_freq && p2.b5_gain === p0.b5_gain, `one undo puts both back (${p2.b5_freq} Hz, ${p2.b5_gain} dB)`);
    // Shift: finer; Alt: Q; the wheel: Q
    await drag(5, 120, 0, ['Shift']);
    const p3 = await params();
    const fine = Math.log2(p3.b5_freq / p0.b5_freq), coarse = Math.log2(p1.b5_freq / p0.b5_freq);
    ok(fine > 0 && fine < coarse / 3, `Shift fine-tunes: the same 120 px moves it ${fine.toFixed(2)} octaves instead of ${coarse.toFixed(2)}`);
    await drag(5, 0, -60, ['Alt']);
    const p4 = await params();
    ok(p4.b5_q > p3.b5_q * 1.5 && Math.abs(p4.b5_freq - p3.b5_freq) / p3.b5_freq < 0.01 && p4.b5_gain === p3.b5_gain, `Alt-drag up narrows it: Q ${p3.b5_q} -> ${p4.b5_q}, frequency and gain stay`);
    const c5 = await node(5);
    await page.mouse.move(c5.x, c5.y);
    await page.mouse.wheel(0, 300);
    await sleep(450);
    const p5 = await params();
    ok(p5.b5_q < p4.b5_q / 1.2, `the wheel over a node turns its Q (${p4.b5_q} -> ${p5.b5_q})`);
    // a readout beside the node while it moves
    const c5b = await node(5);
    await page.mouse.move(c5b.x, c5b.y); await page.mouse.down(); await page.mouse.move(c5b.x + 30, c5b.y - 10); await page.mouse.move(c5b.x + 40, c5b.y - 12);
    const rd = await E(() => { const r = document.querySelector('.eq8-read'); const b = r.getBoundingClientRect(), n = document.querySelector('.eq8-node[data-band="5"]').getBoundingClientRect(); return { shown: !r.hidden, text: r.textContent, gap: Math.min(Math.abs(b.left - n.right), Math.abs(n.left - b.right)) }; });
    await page.mouse.up();
    ok(rd.shown && /Band 5/.test(rd.text) && /kHz|Hz/.test(rd.text) && /dB/.test(rd.text) && /Q /.test(rd.text) && rd.gap < 40, `while it moves, its values sit beside it ("${rd.text}")`);
    await sleep(100);
    ok(await E(() => document.querySelector('.eq8-read').hidden), '…and go when it lets go');
    // double-click a node: back to 0 dB and Q 1
    const c5c = await node(5);
    await page.mouse.dblclick(c5c.x, c5c.y);
    await sleep(120);
    const p6 = await params();
    ok(p6.b5_gain === 0 && p6.b5_q === 1 && p6.b5_on === 1, `a double-click on a node resets it to 0 dB and Q 1 (${p6.b5_gain} dB, Q ${p6.b5_q})`);

    // the band's menu: its shape, on, solo
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { b3_on: 1, b3_gain: -4, b3_q: 2 } } }, { by: 'you', label: 'band 3' }), setup);
    await sleep(100);
    const c3 = await node(3);
    await page.mouse.click(c3.x, c3.y, { button: 'right' });
    await page.waitForSelector('.eq8-menu');
    const menu = await E(() => [...document.querySelectorAll('.eq8-menu [role^=menuitem]')].map((b) => ({ role: b.getAttribute('role'), t: b.textContent, checked: b.getAttribute('aria-checked') })));
    ok(menu.filter((m) => m.role === 'menuitemradio').length === 7 && menu.find((m) => m.t === 'Bell')?.checked === 'true' && menu.some((m) => /^On/.test(m.t)) && menu.some((m) => /^Solo/.test(m.t)) && menu.some((m) => /^Automate frequency/.test(m.t)), `right-click a node: its menu (${menu.map((m) => m.t.replace(/[a-z ]+$/i, (x) => x.slice(0, 12))).slice(0, 12).join(', ')}…)`);
    const m0 = await E(() => window.overdub.store.history.length);
    await page.click('.eq8-menu [data-shape="notch"]');
    await sleep(100);
    const notch = await E(({ track, fx, m0 }) => { const a = window.overdub; return { type: a.store.insert(track, fx).params.b3_type, steps: a.store.history.length - m0, by: a.store.history[a.store.history.length - 1].by, label: document.querySelector('.eq8-node[data-band="3"]').getAttribute('aria-label'), menu: !!document.querySelector('.eq8-menu') }; }, { ...setup, m0 });
    ok(notch.type === 9 && notch.steps === 1 && notch.by === 'you' && !notch.menu, `Notch from the menu makes band 3 a notch, one step by you (type ${notch.type}; "${notch.label}")`);
    // a cut's slope: the panel's shape and slope keys
    await E(() => document.querySelector('.eq8-panel:not([hidden]) .eq8-sh[data-shape="lowcut"]').click());
    await sleep(60);
    await E(() => document.querySelector('.eq8-panel:not([hidden]) .eq8-sl[data-slope="48"]').click());
    await sleep(60);
    const cut = await params();
    ok(cut.b3_type === 5, `the panel's shapes and slopes: Low cut, then 48, makes band 3 a 48 dB per octave low cut (type ${cut.b3_type})`);
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { b3_type: 0 } } }, { by: 'you', label: 'bell' }), setup);
    await sleep(60);

    // solo: the live device only, the song untouched
    const soloSeen = await E(async ({ track, fx }) => {
      const a = window.overdub;
      await a.engine.start?.();
      for (let i = 0; i < 40 && !a.engine.instance?.(track, fx); i++) await new Promise((r) => setTimeout(r, 50));
      const inst = a.engine.instance(track, fx);
      if (!inst) return { inst: false };
      window.__solo = [];
      const auto = inst.auto.bind(inst), clear = inst.autoClear.bind(inst);
      inst.auto = (g) => { window.__solo.push(['auto', g.key, g.b, g.c]); return auto(g); };
      inst.autoClear = (k, t, rel) => { window.__solo.push(['clear', k, rel]); return clear(k, t, rel); };
      return { inst: true };
    }, setup);
    const c3s = await node(3);
    await page.mouse.click(c3s.x, c3s.y, { button: 'right' });
    await page.waitForSelector('.eq8-menu');
    await page.click('.eq8-menu [data-act="solo"]');
    await sleep(100);
    const solo1 = await E(({ track, fx }) => ({ log: window.__solo.slice(), stored: window.overdub.store.insert(track, fx).params.solo ?? 0, tog: document.querySelector('.eq8-panel:not([hidden]) .pk-tog')?.getAttribute('aria-pressed'), status: document.querySelector('.pw .pw-status').textContent, soloing: document.querySelector('.eq8-plot').classList.contains('soloing') }), setup);
    ok(soloSeen.inst && solo1.log.some(([k, key, b]) => k === 'auto' && key === 'solo' && Math.abs(b - 3 / 8) < 1e-9), `Solo holds the playing device's solo on band 3 (an automation segment on the live instance: ${JSON.stringify(solo1.log)})`);
    ok(solo1.stored === 0 && solo1.tog === 'true' && solo1.soloing && /Solo: band 3/.test(solo1.status), `…the song keeps solo at 0, and the window says so ("${solo1.status.slice(0, 80)}")`);
    await E(() => document.querySelector('.eq8-panel:not([hidden]) .pk-tog').click());
    await sleep(60);
    const solo2 = await E(() => window.__solo.slice());
    ok(solo2.some(([k, key, rel]) => k === 'clear' && key === 'solo' && rel === true), 'Solo again lets go of it (the song\'s value plays again)');

    // an agent moves a band: the node moves and flashes in the agent's ink
    const before = await node(3);
    await E(({ track, fx }) => window.overdub.store.dispatch({ type: 'insert.set', track, insert: fx, patch: { params: { b3_freq: 2400, b3_gain: 3 } } }, { by: 'claude', label: 'presence' }), setup);
    await sleep(80);
    const agent = await E(() => { const n = document.querySelector('.eq8-node[data-band="3"]'); return { flash: n.classList.contains('eq8-flash'), ink: n.dataset.ink, label: n.getAttribute('aria-label'), status: document.querySelector('.pw .pw-status').textContent, outline: getComputedStyle(n).borderColor }; });
    const after = await node(3);
    ok(after.x > before.x + 50 && after.y < before.y - 20, `an agent's change moves the node (${Math.round(before.x)},${Math.round(before.y)} -> ${Math.round(after.x)},${Math.round(after.y)})`);
    ok(agent.flash && agent.ink === 'agent' && agent.outline === 'rgb(76, 195, 255)', `…flashes it, and its outline is the agent's ink now (${agent.ink}, ${agent.outline})`);
    ok(agent.label === 'Band 3, bell, 2.4 kHz, plus 3 dB', `…and its words are new: "${agent.label}"`);
    ok(/Claude/.test(agent.status), `the window says who moved what ("${agent.status.slice(0, 70)}")`);
    await shot('eq-desktop');
    await sleep(1800);
    ok(await E(() => !document.querySelector('.eq8-node.eq8-flash')), 'the flash fades');

    // the keyboard: Tab between bands, arrows move, Enter on and off, Delete removes
    await E(() => document.querySelector('.eq8-node[data-band="3"]').focus());
    const k0 = await params();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    const k1 = await params();
    ok(Math.abs(Math.log2(k1.b3_freq / k0.b3_freq) - 1 / 12) < 0.01 && Math.abs(k1.b3_gain - k0.b3_gain - 0.6) < 1e-6 && k1.b3_q > k0.b3_q * 1.1, `arrows: right a semitone up (${k0.b3_freq} -> ${k1.b3_freq} Hz), up 0.5 dB and Shift-up 0.1 (${k0.b3_gain} -> ${k1.b3_gain}), Alt-up narrows (Q ${k0.b3_q} -> ${k1.b3_q})`);
    await page.keyboard.press('PageDown');
    ok((await params()).b3_q < k1.b3_q, 'Page Down widens it');
    await page.keyboard.press('Enter');
    const off = await params();
    await page.keyboard.press('Enter');
    ok(off.b3_on === 0 && (await params()).b3_on === 1, 'Enter turns it off and on');
    const order = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await E(() => document.activeElement?.dataset?.band || document.activeElement?.className || '')); }
    ok(order[0] === '5', `Tab goes from band 3 to the next band in use (${order.join(' > ')})`);
    await page.keyboard.press('Shift+Tab');
    await E(() => document.querySelector('.eq8-node[data-band="5"]').focus());
    await page.keyboard.press('Delete');
    await sleep(80);
    const gone = await E(({ track, fx }) => ({ p: window.overdub.store.insert(track, fx).params, hidden: document.querySelector('.eq8-node[data-band="5"]').hidden, focus: document.activeElement?.dataset?.band }), setup);
    ok(gone.p.b5_on === 0 && gone.p.b5_freq === 1500 && gone.hidden && gone.focus === '3', `Delete frees the band (parked again at ${gone.p.b5_freq} Hz) and focus moves to the next one (band ${gone.focus})`);
    // the ledger: arrows pick a band
    await E(() => document.querySelector('.eq8-cell[aria-checked="true"]').focus());
    await page.keyboard.press('ArrowRight');
    const picked = await E(() => ({ cell: document.querySelector('.eq8-cell[aria-checked="true"]')?.dataset.band, panel: document.querySelector('.eq8-panel:not([hidden])')?.dataset.band }));
    ok(picked.cell === '4' && picked.panel === '4', `the row of bands is a radio group: an arrow picks the next band and its controls show (band ${picked.cell})`);
    // every control's name, and the Space bar still the transport's
    const unnamed = await E(() => [...document.querySelectorAll('.pw button, .pw [role=slider], .pw [role=radio], .pw select, .pw [tabindex="0"]')].filter((x) => x.getClientRects().length && !(x.getAttribute('aria-label') || x.textContent.trim() || x.getAttribute('aria-labelledby'))).length);
    ok(unnamed === 0, `every control in the window has a name (${unnamed} without)`);
    // the face follows
    const faceDrawn = await E(() => { const c = document.querySelector('.rk-card .pd-screen'); if (!c) return false; const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 3; i < g.length; i += 4) if (g[i] > 0) lit++; return lit > 50; });
    ok(faceDrawn, 'the rack face draws the curve');
    // closing the window lets go of a solo
    await E(() => { window.__solo.length = 0; document.querySelector('.eq8-panel:not([hidden])') && document.querySelector('.eq8-cell[data-band="3"]').click(); });
    await E(() => document.querySelector('.eq8-panel:not([hidden]) .pk-tog').click());
    await E(() => window.overdub.plugin.close());
    await sleep(60);
    ok(await E(() => window.__solo.some(([k, key, rel]) => k === 'clear' && key === 'solo' && rel === true)), 'closing the window lets go of a solo');

    // agents: get_device and adjust
    const gd = await E(() => window.overdub.tools.run('get_device', { id: 'core.eq8' }, { by: 'claude' }));
    const lines = gd.params || [];
    ok(lines.some((l) => /^b3_freq 20\.\.20000 Hz \(log\) def=300 role=tone — band 3's frequency \(parked at 300 Hz/.test(l)) && lines.some((l) => /^b1_type \[0=BELL 1=LOW SHELF/.test(l)) && (gd.presets || []).length >= 5 && gd.presets.every((p) => p.blurb), `get_device describes every band ("${lines.find((l) => l.startsWith('b3_freq'))}")`);
    const adj = await E(async ({ track }) => {
      const a = window.overdub;
      const r = await a.tools.run('adjust', { axis: 'mud', direction: 'less', amount: 'a_bit', target: { track }, bars: [1, 2] }, { by: 'claude' });
      const t = a.store.track(track), p = t.inserts.find((x) => x.device === 'core.eq8')?.params || {};
      const n = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => p[`b${k}_on`] === 1 && (p[`b${k}_type`] ?? 0) === 0 && Math.abs((p[`b${k}_freq`] ?? 0) - 300) < 1 && p[`b${k}_gain`] < 0);
      return { r: JSON.stringify(r).slice(0, 400), inserts: t.inserts.map((x) => x.device), n, g: n ? p[`b${n}_gain`] : null };
    }, setup);
    ok(adj.n && !adj.inserts.includes('core.eq') && adj.inserts.length === 1, `adjust "less mud" on a track with Slide Rule puts a 300 Hz cut on one of its free bands rather than adding an EQ (band ${adj.n}, ${adj.g} dB; inserts ${adj.inserts.join(', ')})${adj.n ? '' : ': ' + adj.r}`);
    ok(!ours(errors).length, `desktop: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'the desktop run threw: ' + (e && e.stack || e));
  }
  await s.close();
}

console.log('\nthe window (Chromium, a phone)');
{
  const s = await open('/app/', { query: 'demo', width: 390, height: 844 });
  const { page, errors, shot } = s;
  const E = (fn, arg) => page.evaluate(fn, arg);
  try {
    await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
    await sleep(400);
    const setup = await E(async () => {
      const a = window.overdub, t = a.store.get().tracks.find((x) => x.kind === 'instrument');
      const r = a.store.dispatch({ type: 'insert.add', track: t.id, insert: { device: 'core.eq8', params: a.devices.presetParams('core.eq8', 'Vocal presence') }, ref: 'q' }, { by: 'you', label: 'an EQ' });
      a.plugin.open({ track: t.id, slot: r.created.q });
      for (let i = 0; i < 60 && document.querySelector('.pw')?.dataset.editor !== 'eq8'; i++) await new Promise((res) => setTimeout(res, 50));
      await new Promise((res) => setTimeout(res, 300));
      return { track: t.id, fx: r.created.q };
    });
    const m = await E(() => {
      const w = document.querySelector('.pw'), r = w.getBoundingClientRect(), plot = w.querySelector('.eq8-plot').getBoundingClientRect();
      const box = (q) => [...w.querySelectorAll(q)].filter((x) => x.getClientRects().length).map((x) => { const b = x.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
      const texts = [...w.querySelectorAll('.eq8 *')].filter((x) => x.getClientRects().length && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const small = texts.map((x) => [x.className, parseFloat(getComputedStyle(x).fontSize), x.textContent.trim().slice(0, 16)]).filter((x) => x[1] < 12);
      const node = w.querySelector('.eq8-node:not([hidden])'), nb = node.getBoundingClientRect(), cx = nb.left + nb.width / 2, cy = nb.top + nb.height / 2;
      const reach = [[-20, 0], [20, 0], [0, -20], [0, 20]].every(([dx, dy]) => { const t = document.elementFromPoint(cx + dx, cy + dy); return t === node || node.contains(t); });
      return { phone: w.classList.contains('pw-phone'), r: r.toJSON(), vw: innerWidth, plotW: Math.round(plot.width), cells: box('.eq8-cell'), shapes: box('.eq8-panel:not([hidden]) .eq8-sh'), slopes: box('.eq8-panel:not([hidden]) .eq8-sl'), seg: box('.eq8-panel:not([hidden]) .pk-seg-b'), rm: box('.eq8-panel:not([hidden]) .eq8-rm'), small, reach, over: w.querySelector('.pw-body').scrollWidth - w.querySelector('.pw-body').clientWidth };
    });
    await shot('eq-phone');
    const all44 = (xs) => xs.length > 0 && xs.every(([w, hh]) => w >= 44 && hh >= 44);
    ok(m.phone && Math.round(m.r.width) === m.vw && m.plotW >= m.vw - 2, `under 900 px it is a full-height sheet and the plot takes the width (${m.plotW} of ${m.vw} px)`);
    ok(all44(m.cells) && all44(m.shapes) && all44(m.slopes) && all44(m.seg) && m.rm.every(([, hh]) => hh >= 44), `the bands, shapes, slopes, switches and Remove are 44 px targets (${[m.cells, m.shapes, m.slopes, m.seg].map((xs) => Math.min(...xs.map(([w, hh]) => Math.min(w, hh)))).join(', ')})`);
    ok(m.reach, 'a node is a 44 px target under a finger');
    ok(!m.small.length && m.over <= 1, `no text under 12 px, nothing runs out sideways${m.small.length ? ' (' + m.small.slice(0, 3).map((x) => `${x[0]} ${x[1]}px "${x[2]}"`).join('; ') + ')' : ''}`);
    // two fingers on a node: Q (apart: wider); a double tap on the plot: a band
    const pinch = await E(async ({ track, fx }) => {
      const a = window.overdub, nd = document.querySelector('.eq8-node[data-band="6"]'), plot = document.querySelector('.eq8-plot');
      const q0 = a.store.insert(track, fx).params.b6_q;
      const r = nd.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (type, el, id, cx, cy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      ev('pointerdown', nd, 21, x, y);
      ev('pointerdown', plot, 22, x + 30, y);
      for (let i = 1; i <= 6; i++) ev('pointermove', plot, 22, x + 30 + i * 15, y);
      ev('pointerup', plot, 22, x + 120, y);
      ev('pointerup', nd, 21, x, y);
      await new Promise((res) => setTimeout(res, 80));
      const q1 = a.store.insert(track, fx).params.b6_q;
      const pr = plot.getBoundingClientRect(), px = pr.left + pr.width * 0.55, py = pr.top + pr.height * 0.3;
      const before = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => a.store.insert(track, fx).params[`b${n}_on`] === 1).length;
      ev('pointerdown', plot, 31, px, py); ev('pointerup', plot, 31, px, py);
      await new Promise((res) => setTimeout(res, 120));
      ev('pointerdown', plot, 32, px + 2, py + 1); ev('pointerup', plot, 32, px + 2, py + 1);
      await new Promise((res) => setTimeout(res, 120));
      const after = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => a.store.insert(track, fx).params[`b${n}_on`] === 1).length;
      return { q0, q1, before, after };
    }, setup);
    ok(pinch.q1 < pinch.q0 / 2, `two fingers spreading on a node widen it (Q ${pinch.q0} -> ${pinch.q1})`);
    ok(pinch.after === pinch.before + 1, `a double tap on the plot places a band (${pinch.before} -> ${pinch.after} in use)`);
    await shot('eq-phone-after');
    ok(!ours(errors).length, `phone: no page errors${ours(errors).length ? ': ' + ours(errors).slice(0, 3).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'the phone run threw: ' + (e && e.stack || e));
  }
  await s.close();
}
T.done();
