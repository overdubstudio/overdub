// Recording automation (docs/research/AUTOMATION.md 3.9; app/src/input/autorec.js, the recorder's commit hook).
//   1. Node: moved to test/unit/autorec.test.js (gestureOf, planMove, autorec on a store with a stand-in transport).
//   2. The studio (Night Shift, real pointer drags on the Bass's cutoff knob): while R records, the drag writes a lane
//      that reads back the gesture within 2.5% of the knob's travel, outside the touched span nothing moves, letting go
//      glides back to the lane over 200 ms, the take is one undo step and undo is exact; a fader drag in the mixer
//      writes the level lane; with the song just playing, the toast says the knob stays where you left it and offers
//      Write it into the lane, which writes the move; and it is heard (a probe kernel's output, live): the hand while
//      it holds, the lane once let go, the written pass on the next time round the loop.
//
//   node tools/autorec-test.js
import { open, tally } from './pw.js';
import { valueAt, toPos } from '../app/src/core/automation.js';
import { GLIDE_S } from '../app/src/input/autorec.js';

const t = tally('autorec');
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const body = (s) => canon({ ...s.get(), meta: null });
const near = (a, b, e) => Math.abs(a - b) <= e;

/* ------------------------------------------------------------------ 2. the studio */
const { page, errors, close, shot } = await open('/app/', { query: 'demo', width: 1440, height: 900 });
try {
  await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
  await page.evaluate(async () => { const app = window.overdub; await app.engine.start(); app.ui.setOpen?.('bottom', true); });
  const ids = await page.evaluate(() => Object.fromEntries(window.overdub.store.get().tracks.map((x) => [x.name, x.id])));
  const tempo = await page.evaluate(() => window.overdub.store.get().tempo);
  const spbMs = 60000 / tempo;
  const beatNow = () => page.evaluate(() => window.overdub.engine.beat);
  async function until(b) {
    for (let i = 0; i < 2000; i++) {
      const x = await beatNow();
      if (x >= b - 0.015) return x;
      await page.waitForTimeout(Math.max(1, Math.min(250, (b - x) * spbMs - 25)));
    }
    return null;
  }
  const state = () => page.evaluate(() => window.overdub.input.recorder.state);
  async function idle() { for (let i = 0; i < 100 && (await state()) !== 'idle'; i++) await page.waitForTimeout(50); await page.waitForTimeout(80); }
  const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).pop() || '');
  // what the page saw: every pointer event on a knob or the fader, with its audible beat
  await page.evaluate(() => {
    window.__pm = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) window.addEventListener(type, (e) => { const en = window.overdub.engine; window.__pm.push({ type, beat: en.playing ? en.beatAt(e.timeStamp) : null, ts: e.timeStamp }); }, true);
  });
  const ADDR = { track: ids.Bass, insert: 'instrument', param: 'cutoff' };
  const laneOf = (addr) => page.evaluate((a) => { const l = window.overdub.store.get().tracks.find((x) => x.id === a.track); const host = a.insert ? l.instrument : l; return host.auto?.[a.param] || null; }, addr);

  // the Bass's knobs in the rack; a flat cutoff lane to hand back to
  await page.evaluate((b) => { const app = window.overdub; app.ui.select({ track: b }); app.ui.show('rack'); app.store.dispatch([{ type: 'project.set', patch: { loop: { on: false, start: 0, end: 32 } } }, { type: 'auto.write', track: b, insert: 'instrument', param: 'cutoff', points: '0:600 64:600' }], { by: 'you', label: 'setup' }); app.engine.seek(0); }, ids.Bass);
  await page.waitForTimeout(300);
  const dial = page.locator('.rk-card .kn[data-key="cutoff"] .kn-dial').first();
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox();
  t.ok(!!box, `the Bass's cutoff knob is on screen (${box ? Math.round(box.width) + ' px' : 'missing'})`);
  const before = await page.evaluate(() => JSON.stringify({ ...window.overdub.store.get(), meta: null }));
  const hist0 = await page.evaluate(() => window.overdub.store.history.length);
  const stat0 = await page.evaluate((a) => window.overdub.store.track(a.track).instrument.params.cutoff, ADDR);

  /* ---- R, then a slow drag up on the knob from beat 2, held, let go at 5 */
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(2);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const seen = [];
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(cx, cy - i * 2.5);
    await page.waitForTimeout(28);
    if (i % 3 === 0) seen.push(await page.evaluate((a) => ({ beat: window.overdub.engine.beat, v: +document.querySelector('.rk-card .kn[data-key="cutoff"] .kn-dial').getAttribute('aria-valuenow'), hist: window.overdub.store.history.length, off: window.overdub.store.track(a.track).instrument.auto?.cutoff?.off === true, stat: window.overdub.store.track(a.track).instrument.params.cutoff, writing: window.overdub.input.autorec.touching().length }), ADDR));
  }
  const mid = seen[Math.floor(seen.length / 2)];
  t.ok(seen.every((x) => x.hist === hist0) && mid.off && Math.abs(mid.stat - mid.v) < 1 && mid.writing === 1, `while it records, the drag is held and heard (lane held, ${Math.round(mid.stat)} Hz playing, the knob at ${Math.round(mid.v)} Hz) and nothing reaches the history (${seen[0].hist - hist0} steps)`);
  await until(5);
  await page.mouse.up();
  const upBeat = await page.evaluate(() => window.__pm.filter((x) => x.type === 'pointerup').pop()?.beat);
  await page.waitForTimeout(60);
  const pv = await laneOf(ADDR);
  t.ok(pv && !pv.off && pv.points.length > 3, `let go, the lane is back on and already plays the pass (a preview, ${pv?.points.length} points)`);
  await until(7);
  await shot('autorec-recording');
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const after = await page.evaluate((a) => {
    const app = window.overdub, last = app.input.recorder.last, h = app.store.history;
    return { last: { ok: last?.ok, label: last?.label, summary: last?.summary, lanes: last?.lanes }, hist: h.length, top: h[h.length - 1] && { by: h[h.length - 1].by, label: h[h.length - 1].label, ops: h[h.length - 1].ops.map((o) => o.type) }, stat: app.store.track(a.track).instrument.params.cutoff };
  }, ADDR);
  const lane = await laneOf(ADDR);
  t.ok(after.hist === hist0 + 1 && after.top.by === 'you' && /^Cutoff, bars? [\d–]+ \(recorded\)$/.test(after.top.label) && after.top.ops.every((x) => x === 'auto.write'), `the take is one undo step by you: "${after.top?.label}" (${after.top?.ops.join(', ')})`);
  t.ok(after.stat === stat0 && lane && !lane.off && lane.by === 'you', `the knob's own value is untouched (${after.stat} Hz); the lane is yours, playing`);
  t.ok(/^Recorded into its lane: Cutoff, bars? [\d–]+\. Undo takes it back\./.test(await lastToast()), `the toast says so: "${await lastToast()}"`);
  // read back: where the page saw each move, the lane has the knob's value (in its travel)
  const spec = { min: 40, max: 8000, curve: 'log' };
  const errs = seen.map((x) => {
    const lv = valueAt(lane.points, x.beat, spec);
    return Math.abs(toPos(spec, lv) - toPos(spec, x.v));
  });
  const worst = Math.max(...errs);
  t.ok(worst < 0.025, `the lane reads back the gesture: ${seen.length} samples within ${(worst * 100).toFixed(2)}% of the knob's travel (2.5% allowed; thinned to ${lane.points.length} points)`);
  const first = lane.points[0], last = lane.points[lane.points.length - 1];
  const glide = GLIDE_S * tempo / 60;
  t.ok(valueAt(lane.points, 1, spec) === 600 && valueAt(lane.points, 20, spec) === 600 && first.t === 0 && last.t === 64, `outside the touched span nothing moved (beat 1 and 20: 600 Hz; still 0–64)`);
  const vUp = valueAt(lane.points, upBeat - 0.02, spec), vHalf = valueAt(lane.points, upBeat + glide / 2, spec), vBack = valueAt(lane.points, upBeat + glide + 0.02, spec);
  t.ok(vUp > 1000 && vHalf < vUp && vHalf > 600 && near(vBack, 600, 1e-6), `letting go at beat ${upBeat?.toFixed(3)} glides back to the lane over 200 ms (${glide.toFixed(3)} beats): ${Math.round(vUp)} → ${Math.round(vHalf)} → ${Math.round(vBack)} Hz`);
  const held = seen[seen.length - 1];
  t.ok(near(valueAt(lane.points, (held.beat + upBeat) / 2, spec), held.v, held.v * 0.03), `held still after the drag, the last value runs to the let-go (${Math.round(valueAt(lane.points, (held.beat + upBeat) / 2, spec))} Hz)`);
  await page.evaluate(() => window.overdub.store.undo());
  const undone = await page.evaluate(() => JSON.stringify({ ...window.overdub.store.get(), meta: null }));
  t.ok(undone === before, 'undo takes the take back out exactly');

  /* ---- a fader in the mixer while R records: the level lane */
  await page.evaluate(() => { const app = window.overdub; app.ui.show('mixer'); app.engine.seek(8); });
  await page.waitForTimeout(300);
  const fader = page.locator(`.mx-strip[data-track="${ids.Keys}"] .mx-thumb`).first();
  const fb = await fader.boundingBox();
  const g0 = await page.evaluate((k) => window.overdub.store.track(k).gain, ids.Keys);
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(9);
  if (fb) {
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + i * 4); await page.waitForTimeout(25); }
    await page.mouse.up();
  }
  await until(11);
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const gl = await laneOf({ track: ids.Keys, param: 'gain' });
  const gt = await page.evaluate((k) => ({ g: window.overdub.store.track(k).gain, label: window.overdub.store.history.slice(-1)[0]?.label }), ids.Keys);
  const gmin = gl ? Math.min(...gl.points.map((x) => x.v)) : null;
  t.ok(fb && gl && gmin < g0 - 6 && gt.g === g0 && /^Keys level, bars? [\d–]+ \(recorded\)$/.test(gt.label) && gl.points[gl.points.length - 1].v === gmin, `a fader drag while it records writes the level lane (${gl?.points.length} points, down to ${gmin?.toFixed(1)} dB; no lane before, so the last value holds), and the fader's own level stays ${g0} dB ("${gt.label}")`);
  await page.evaluate(() => window.overdub.store.undo());

  /* ---- the song just playing: the move stays, and Write it into the lane */
  await page.evaluate(() => { const app = window.overdub; app.ui.show('rack'); app.engine.seek(16); app.engine.play(); });
  await page.waitForTimeout(400);
  const kb = await dial.boundingBox();
  const hist1 = await page.evaluate(() => window.overdub.store.history.length);
  await until(17);
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - i * 3); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(150);
  const moved = await page.evaluate((a) => ({ hist: window.overdub.store.history.length, stat: window.overdub.store.track(a.track).instrument.params.cutoff, lane: window.overdub.store.track(a.track).instrument.auto?.cutoff?.points?.length ?? 0 }), ADDR);
  const offer = await page.evaluate(() => { const x = [...document.querySelectorAll('.ew-toast')].filter((e) => /moved from/.test(e.textContent)).pop(); return { text: x?.querySelector('.ew-toast-text')?.textContent || '', act: x?.querySelector('.ew-toast-act')?.textContent || '' }; });
  t.ok(moved.hist === hist1 + 1 && moved.stat > stat0, `with the song just playing, the knob moves the song as always (one step; ${Math.round(moved.stat)} Hz)`);
  t.ok(/^Cutoff moved from 600 Hz to [\d.]+ k?Hz over bars? [\d–]+\. It stays where you left it\.$/.test(offer.text) && offer.act === 'Write it into the lane', `and the toast says it stays where you left it, offering to write it into the lane: "${offer.text}" [${offer.act}]`);
  await shot('autorec-keep');
  const keepBtn = page.locator('.ew-toast .ew-toast-act', { hasText: 'Write it into the lane' }).last();
  await keepBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(100);
  const kept = await page.evaluate((a) => { const app = window.overdub, h = app.store.history; return { hist: h.length, label: h[h.length - 1]?.label, stat: app.store.track(a.track).instrument.params.cutoff, lane: app.store.track(a.track).instrument.auto?.cutoff || null, moves: app.input.autorec.moves.map((m) => ({ kept: m.kept, to: m.to })) }; }, ADDR);
  const km = kept.moves[kept.moves.length - 1];
  const kpts = kept.lane?.points || [];
  t.ok(kept.hist === hist1 + 2 && /^Cutoff, bars? [\d–]+ \(kept\)$/.test(kept.label) && kept.lane && !kept.lane.off && kpts.length >= 3 && km?.kept, `Write it into the lane writes the move into the lane after the fact (${kpts.length} points, "${kept.label}")`);
  t.ok(kept.stat === stat0 && kpts.length && Math.abs(Math.max(...kpts.map((x) => x.v)) - km.to) < 1, `as a recording would: up to ${Math.round(km?.to)} Hz in the lane, the knob's own value back at ${stat0} Hz (${kept.stat})`);
  await page.evaluate(() => window.overdub.engine.stop());

  /* ---- heard: a probe (an effect whose output is its knob's value as DC) on a lane at 0.2, recorded over */
  const { PROBE } = await import('./probe-kernel.js');
  const pid = await page.evaluate(async (PROBE) => {
    const app = window.overdub;
    (await import('/app/src/devices/registry.js')).defineDevice(PROBE, { replace: true });
    const r = app.store.dispatch([{ type: 'project.set', patch: { loop: { on: true, start: 0, end: 8 } } }, { type: 'track.add', ref: 'p', track: { name: 'Probe', kind: 'audio' } }, { type: 'insert.add', track: '$p', ref: 'f', insert: { device: 'test.probe' } }], { by: 'you', label: 'probe' });
    if (!r.ok) throw new Error(r.error);
    const tid = r.created.p, fx = r.created.f;
    app.store.dispatch({ type: 'auto.write', track: tid, insert: fx, param: 'v', points: '0:0.2 8:0.2' }, { by: 'you' });
    app.ui.select({ track: tid }); app.ui.show('rack'); app.engine.seek(0);
    await new Promise((res) => setTimeout(res, 400));
    const inst = app.engine.instance(tid, fx), ctx = app.engine.ctx;
    const an = ctx.createAnalyser(); an.fftSize = 512;
    an.channelCount = 1; an.channelCountMode = 'explicit'; an.channelInterpretation = 'discrete'; // (the left channel: the probe's v)
    inst.output.connect(an);
    const buf = new Float32Array(512);
    window.__dc = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x; return s / buf.length; };
    return { tid, fx };
  }, PROBE);
  const pdial = page.locator('.rk-card .kn[data-key="v"] .kn-dial').first();
  await pdial.scrollIntoViewIfNeeded();
  const pb = await pdial.boundingBox();
  await page.evaluate(() => window.overdub.input.recorder.record({ countIn: 0 }));
  await until(1);
  const dc0 = await page.evaluate(() => window.__dc());
  const heard = [];
  if (pb) {
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 - i * 4); await page.waitForTimeout(30); }
    await page.waitForTimeout(150);
    heard.push(await page.evaluate(() => ({ dc: window.__dc(), v: +document.querySelector('.rk-card .kn[data-key="v"] .kn-dial').getAttribute('aria-valuenow'), beat: window.overdub.engine.beat })));
    await until(3);
    await page.mouse.up();
  }
  await page.waitForTimeout(700);
  const dcBack = await page.evaluate(() => ({ dc: window.__dc(), beat: window.overdub.engine.beat }));
  // the next pass plays what this one wrote (beats 2-3: the knob's last value, held)
  // (between the drag's end and the let-go the knob held still at h.v: read the next pass in the middle of that)
  const at = 8 + Math.min(2.8, ((heard[0]?.beat ?? 2.4) + 3) / 2);
  for (let i = 0; i < 600; i++) { const b = await page.evaluate(() => window.overdub.engine.gridBeat); if (b >= at) break; await page.waitForTimeout(15); }
  const dcNext = await page.evaluate((p) => ({ dc: window.__dc(), beat: window.overdub.engine.beat, lane: window.overdub.store.track(p.tid).inserts[0].auto?.v?.points || [] }), pid);
  const wantNext = valueAt(dcNext.lane, dcNext.beat, { min: 0, max: 1 });
  await page.evaluate(() => window.overdub.input.recorder.stop());
  await idle();
  const h = heard[0];
  t.ok(near(dc0, 0.2, 0.005) && h && near(h.dc, h.v, 0.01) && h.v > 0.4, `heard while it records: the lane plays 0.2 (${dc0.toFixed(3)}), then the hand on the knob does (${h?.dc.toFixed(3)} out, the knob at ${h?.v})`);
  t.ok(near(dcBack.dc, 0.2, 0.01), `let go, the lane plays again (${dcBack.dc.toFixed(3)} at beat ${dcBack.beat.toFixed(2)})`);
  t.ok(h && dcNext.lane.length > 2 && near(dcNext.dc, wantNext, 0.02) && wantNext > 0.25, `and the next loop pass plays what the last one wrote (${dcNext.dc.toFixed(3)} at beat ${dcNext.beat.toFixed(2)}; the written lane says ${wantNext?.toFixed(3)} there)`);

  t.ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await close();
}
t.done();
