// Checks for the groove library (app/src/core/grooves.js and its style files), tap-to-find, the song creator, the
// Grooves tab (app/src/ui/grooves.js) and the agents' find_grooves, use_groove and drum_track (agent/grooves-tool.js).
//   node tools/grooves-test.js      (screenshots: tools/.out/grooves-*.png)
// (Its Node half now lives in test/unit/grooves.test.js; only the all-grooves tap matching stays here, as 20 s is not a unit.)
// In Node: every groove parses with its notes inside its length; feel and humanising are deterministic and the accents
// are where the grid says; the matcher finds a groove from its own jittered onsets (and from a shifted start); the song
// creator's plan puts fills, crashes and the ending where it says (none by default when the loop goes round the song's
// end). In the page: the tab, hearing a groove (the engine schedules its notes), putting one (a clip signed by you, one
// undo step), tap-to-find from taps on the pads, Build drums for the song (in the found groove's style, its ending a
// choice), the tools' results and errors, the demo agent's grooves, a phone upright and on its side, and no page errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../app/src/core/grooves.js';
import { rng } from '../app/src/core/transforms.js';
import { open, tally, OUTDIR } from './pw.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = tally('grooves');
const say = (xs, n = 6) => (xs.length ? ': ' + xs.slice(0, n).join('; ') + (xs.length > n ? ` … (${xs.length})` : '') : '');
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const ignorable = (e) => /Failed to load resource|favicon|net::ERR|fonts\.g|AudioContext|getUserMedia|NotAllowedError|NotFoundError/.test(e);

/* ================================================================== the library */
console.log('\nthe library');
const L = G.library();
/* ================================================================== tap-to-find */
console.log('\ntap-to-find');
const voiceOf = (p) => (G.familyOf(p) === 'kick' ? 'kick' : G.familyOf(p) === 'snare' ? 'snare' : 'hat');
// the onsets of a groove as a drummer would tap them: every hit (ghosts too), at its middle tempo with its swing and
// lay, each jittered up to ±jitter ms (seeded); skip drops the first beats (a shifted start)
function tapsOf(g, { skip = 0, jitter = 12, seed = 7, main = false } = {}) {
  const tempo = Math.round((g.tempo[0] + g.tempo[1]) / 2), len = Math.max(8, g.length * 2) + skip;
  const played = G.realize(g, { tempo, seed, length: len, human: 0 });
  const R = rng(`taps:${seed}:${g.id}`), out = [], seen = new Set();
  for (let k = 0; k * g.length < len; k++) {
    for (const h of g.hits) {
      const t = k * g.length + h.t, v = voiceOf(h.p);
      if (t < skip - 1e-6 || t >= len || h.v < (main ? 0.6 : 0.44) || (main && v === 'hat')) continue;
      const n = played.find((x) => x.p === h.p && Math.abs(x.t - t) < 0.2), key = `${v}:${Math.round(t * 48)}`;
      if (!n || seen.has(key)) continue;
      seen.add(key);
      out.push({ t: (n.t * 60) / tempo + ((R() - 0.5) * 2 * jitter) / 1000, voice: v });
    }
  }
  return { tempo, taps: out.sort((a, b) => a.t - b.t) };
}
const sig = (g) => { const o = G.onsetsOf(g); return JSON.stringify([g.length, o.kick.main, o.snare.main, o.all.main]); };
{
  // every main groove from its own jittered onsets: first, or tied first with a groove that has the same hits
  const main = L.grooves.filter((g) => G.MAIN_PARTS.includes(g.part));
  for (const [label, opt] of [['from the downbeat', {}], ['from a shifted start (the taps begin on beat 2 and a half)', { skip: 1.5 }]]) {
    const miss = [], terr = [];
    let first = 0, tied = 0, top5 = 0;
    for (const g of main) {
      const { tempo, taps } = tapsOf(g, opt);
      const m = G.matchTaps(taps);
      const r0 = m?.results[0];
      if (!r0) { miss.push(`${g.id}: nothing`); continue; }
      terr.push(Math.abs(r0.bpm - tempo) / tempo);
      const mine = m.results.find((r) => r.groove.id === g.id);
      if (mine) top5++;
      if (r0.groove.id === g.id) first++;
      else if (sig(r0.groove) === sig(g) || (mine && r0.score - mine.score < 0.001)) tied++;
      else miss.push(`${g.id} came after ${r0.groove.id} (${mine ? mine.score : 'not in the five'} vs ${r0.score})`);
    }
    terr.sort((a, b) => a - b);
    T.ok(first + tied >= main.length - 1 && top5 === main.length, `${label}: ${first} of ${main.length} main grooves come back first from their own taps, ${tied} tie with one that plays the same hits, all ${top5} in the closest five${say(miss)}`);
    T.ok(terr[terr.length - 1] < 0.02, `${label}: the tempo read from the taps is within 2% for all of them (worst ${(terr[terr.length - 1] * 100).toFixed(2)}%)`);
  }
}

/* ================================================================== the song creator */
console.log('\nthe song creator');
{
  // what agents read (extra-schemas.js): use_groove's track "new"; drum_track's ending and crashes, and no ending by
  // default when the loop goes round; and that find_grooves returns the studio's own library, no song text (the page
  // checks below hold its results to that)
  const { FIND_GROOVES_SCHEMA: F, USE_GROOVE_SCHEMA: U, DRUM_TRACK_SCHEMA: D } = await import('../app/src/agent/extra-schemas.js');
  T.ok(/or "new" for a new Drums track/.test(U.input_schema.properties.track.description) && /pick free bars, or give track "new"/.test(U.description), 'use_groove\'s schema offers track "new", and says to use it when the bars are taken');
  T.ok(D.input_schema.properties.ending?.type === 'boolean' && D.input_schema.properties.crashes?.type === 'boolean' && /when the loop is on and reaches the song's end: then no ending/.test(D.description) && /fills, crashes, ending, loops/.test(D.description), 'drum_track\'s schema has ending and crashes, and says there\'s no ending when the loop goes round');
  T.ok(/returns no song text: every name, blurb and grid in it is the studio's own library/.test(F.description), 'find_grooves\' schema says its results are the studio\'s own library, no song text');
}

/* ================================================================== the studio */
console.log('\nthe studio');
const errs = [];
// two bars of a rock beat (straight eighths) as [beat, pads] at 100 BPM, for app.grooves.tap
const ROCK_TAPS = [[0, ['kick', 'hat']], [0.5, ['hat']], [1, ['snare', 'hat']], [1.5, ['hat']], [2, ['kick', 'hat']], [2.5, ['kick', 'hat']], [3, ['snare', 'hat']], [3.5, ['hat']]];
// The floor on a phone, in the Grooves tab: targets under 44 px, text under 12 px, and how far the page runs sideways
const floorCheck = (E, label) => E((label) => {
  const root = document.querySelector('[data-panel="grooves"]');
  const sel = '.btn, .tog, .gv-pad, .gv-row, .gv-style, .gv-num, .gv-partbtn';
  const small = [...root.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { c: e.className.split(' ')[0] + (e.textContent ? ' ' + e.textContent.trim().slice(0, 14) : ''), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h < 44 || x.w < 44);
  const tiny = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || el.closest('.sr-only, [hidden], [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11.95) tiny.push(`${el.className || el.tagName} ${fs}px "${n.textContent.trim().slice(0, 14)}"`);
  }
  return { label, small, tiny: [...new Set(tiny)], wide: document.documentElement.scrollWidth - innerWidth, rows: root.querySelectorAll('.gv-row').length };
}, label);
{
  const s = await open('/app/', { width: 1600, height: 1000, query: 'demo' });
  const { page, errors } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await E(() => { document.querySelector('.ar-welcome-x')?.click(); localStorage.setItem('overdub:welcomed', '1'); const o = window.overdub; o.ui.setOpen('bottom', true); o.ui.setOpen('left', false); });
  // the tab
  const tabs = await E(() => [...document.querySelectorAll('.ew-region-bottom .ew-tab')].map((t) => t.textContent.trim()));
  T.ok(tabs.indexOf('Grooves') === tabs.indexOf('Beat') + 1, `the Grooves tab sits beside Beat (${tabs.join(', ')})`);
  await page.click('#ew-tab-grooves');
  await page.waitForSelector('[data-panel="grooves"] .gv-row', { timeout: 10000 });
  await E(() => { const o = window.overdub; document.querySelector('.ew-split-v'); o.ui.state.zoom.trackH = 48; });
  await page.waitForTimeout(400);
  const tab = await E(() => {
    const o = window.overdub, rows = [...document.querySelectorAll('.gv-row')];
    const inked = rows.slice(0, 6).map((r) => { const c = r.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; });
    return { visible: o.ui.visible('grooves'), styles: document.querySelectorAll('.gv-style').length, rows: rows.length, inked, sel: document.querySelector('.gv-row.sel')?.dataset.groove, title: document.querySelector('.gv-title').textContent, on: document.querySelector('.gv-on').textContent };
  });
  T.ok(tab.visible && tab.styles === L.styles.length && tab.rows >= 8 && tab.inked.every((n) => n > 40), `the Grooves tab opens: ${tab.styles} styles, ${tab.rows} grooves of ${tab.title.split(',')[0]} drawn as pictures (${tab.inked.join(', ')} inked pixels)`);
  // pick Funk, a groove in it, and see the picture of the selected one in reverse print
  await page.click('.gv-style[data-style="funk"]');
  await page.click('.gv-row[data-groove="funk/ghost-notes"]');
  const picked = await E(() => ({ sel: window.overdub.grooves.selected(), title: document.querySelector('.gv-title').textContent, rows: [...document.querySelectorAll('.gv-row')].map((r) => r.dataset.groove), bg: getComputedStyle(document.querySelector('.gv-row.sel')).backgroundColor, text: getComputedStyle(document.body).getPropertyValue('--text') }));
  T.ok(picked.sel === 'funk/ghost-notes' && picked.title === 'Funk, Ghost notes' && picked.rows.every((id) => id.startsWith('funk/')), `a style's grooves, by part; picking one names it (${picked.title})`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-tab.png'), clip: await E(() => { const r = document.querySelector('.ew-region-bottom').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });

  // hearing it: a preview track the engine plays, never in History, gone when it stops
  const hist0 = await E(() => window.overdub.store.history.length);
  const heard = await E(async () => {
    const o = window.overdub;
    await o.engine.start();
    const r = await o.grooves.hear('funk/ghost-notes', { alone: true });
    const a = o.grooves.hearing();
    const inst = o.engine.instance(a.track, 'instrument');
    const ons = [], on0 = inst.noteOn;
    inst.noteOn = function (p, v, t, x) { ons.push(p); return on0.call(this, p, v, t, x); };
    const t0 = performance.now();
    while (performance.now() - t0 < 2500 && ons.length < 12) await new Promise((r) => setTimeout(r, 50));
    const track = o.store.get().tracks.find((t) => t.id === a.track);
    const out = { ok: r.ok, ons: ons.length, kinds: [...new Set(ons)].sort(), playing: o.engine.playing, name: track?.name, solo: track?.solo, hist: o.store.history.length, saved: !!localStorage.getItem('overdub:grooves-hearing'), pressed: document.querySelector('.gv-hear').getAttribute('aria-pressed') };
    o.grooves.stop();
    await new Promise((r) => setTimeout(r, 200));
    out.after = { hearing: o.grooves.hearing(), gone: !o.store.get().tracks.some((t) => /^Hearing /.test(t.name)), playing: o.engine.playing, hist: o.store.history.length };
    return out;
  });
  T.ok(heard.ok && heard.ons >= 8 && heard.kinds.includes(36) && heard.kinds.includes(38) && heard.kinds.includes(42), `Hear plays it: the engine schedules its notes on a "${heard.name}" track (${heard.ons} notes: ${heard.kinds.join(', ')})`);
  T.ok(heard.solo === true && heard.saved && heard.pressed === 'true' && heard.hist === hist0, 'alone, the groove is soloed; the lamp is lit; nothing is in History');
  T.ok(!heard.after.hearing && heard.after.gone && !heard.after.playing && heard.after.hist === hist0, 'Stop takes the preview back out and stops the song');
  // with the song: the song's drums are muted for it, and come back
  const withSong = await E(async () => {
    const o = window.overdub;
    const drums = o.store.get().tracks.filter((t) => t.instrument?.device === 'core.drums').map((t) => t.id);
    await o.grooves.hear('funk/ghost-notes', { alone: false });
    const during = drums.map((id) => o.store.get().tracks.find((t) => t.id === id).mute);
    o.grooves.stop();
    await new Promise((r) => setTimeout(r, 100));
    return { during, after: drums.map((id) => o.store.get().tracks.find((t) => t.id === id).mute) };
  });
  T.ok(withSong.during.length && withSong.during.every(Boolean) && withSong.after.every((m) => !m), `with the song, its drum track is muted while the groove plays in its place, and comes back (${withSong.during.length} track)`);
  // Escape stops hearing
  await E(async () => { await window.overdub.grooves.hear('funk/ghost-notes'); });
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  T.ok(await E(() => !window.overdub.grooves.hearing() && !window.overdub.engine.playing), 'Escape stops it');
  T.ok(await E(() => document.querySelectorAll('[data-panel="grooves"] .btn-go').length === 1), 'one primary in the tab (Put it at bar)');

  // putting it: a clip signed by you, one undo step
  await page.fill('.gv-at input', '5');
  await page.dispatchEvent('.gv-at input', 'change');
  await page.fill('.gv-for input', '2');
  await page.dispatchEvent('.gv-for input', 'change');
  const before = await E(() => ({ hist: window.overdub.store.history.length, clips: window.overdub.store.get().tracks.reduce((n, t) => n + t.clips.length, 0) }));
  await page.click('.gv-put');
  await page.waitForTimeout(200);
  const put = await E(() => {
    const o = window.overdub, last = o.store.history.at(-1);
    const f = o.store.get().tracks.flatMap((t) => t.clips.map((c) => ({ t, c }))).find((x) => x.c.name === 'Funk, Ghost notes');
    return { hist: o.store.history.length, by: last.by, label: last.label, clip: f && { start: f.c.start, length: f.c.length, by: f.c.by, track: f.t.name, notes: f.c.notes.length }, clips: o.store.get().tracks.reduce((n, t) => n + t.clips.length, 0), toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ') };
  });
  T.ok(put.hist === before.hist + 1 && put.by === 'you' && put.clip?.by === 'you' && put.clip.start === 16 && put.clip.length === 8 && put.clip.track === 'Drums', `Put it at bar 5 for 2 bars: a clip on Drums signed by you, one undo step ("${put.label}", ${put.clip?.notes} notes)`);
  T.ok(/Funk, Ghost notes on Drums, bars 5–6/.test(put.toast) && /Undo/.test(put.toast), `it says what it did, with Undo ("${put.toast.slice(0, 120)}")`);
  const last = await E(() => { const l = document.querySelector('.gv-last'); const b = l.querySelector('.by'); return { text: l.textContent, hidden: l.hidden, ink: b && getComputedStyle(b).color, human: getComputedStyle(document.documentElement).getPropertyValue('--human').trim() }; });
  T.ok(!last.hidden && /Last in the song: Funk, Ghost notes, bars 5–6, by you\./.test(last.text) && last.ink === 'rgb(255, 160, 67)', `who put it there is signed in warm ink ("${last.text}")`);
  await E(() => window.overdub.store.undo());
  T.ok(await E((n) => window.overdub.store.history.length === n - 1 && !window.overdub.store.get().tracks.some((t) => t.clips.some((c) => c.name === 'Funk, Ghost notes')), put.hist), 'one undo takes it back out');

  // dragging a groove onto the arranger
  const dragged = await E(async () => {
    const o = window.overdub;
    const d = o.store.get().tracks.find((t) => t.instrument?.device === 'core.drums');
    const x = o.arranger.xOf(4 * 8 + 0.1), y = o.arranger.yOf(d.id);
    const row = document.querySelector('.gv-row[data-groove="funk/open-hats"]');
    const r = row.getBoundingClientRect();
    const ev = (type, cx, cy) => row.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: cx, clientY: cy }));
    ev('pointerdown', r.left + 20, r.top + 10);
    ev('pointermove', r.left + 40, r.top - 20);
    ev('pointermove', x, y);
    const ghost = document.querySelector('.gv-ghost')?.textContent;
    ev('pointerup', x, y);
    await new Promise((res) => setTimeout(res, 100));
    const f = o.store.get().tracks.flatMap((t) => t.clips.map((c) => ({ t, c }))).find((q) => q.c.name === 'Funk, Open hats');
    return { ghost, clip: f && { start: f.c.start, track: f.t.id === d.id, by: f.c.by }, label: o.store.history.at(-1).label };
  });
  T.ok(dragged.clip?.start === 32 && dragged.clip.track && dragged.clip.by === 'you' && /bar 9, Drums/.test(dragged.ghost || ''), `a groove dragged onto the arranger lands at the bar it's dropped on, on that drum track ("${dragged.ghost}")`);
  await E(() => window.overdub.store.undo());

  // tap-to-find, from taps on the pads: a rock beat at 100 BPM, two bars
  await page.click('.gv-style[data-style="rock"]');
  const pad = async (voice) => { const b = await page.$(`.gv-pad[data-voice="${voice}"]`); const r = await b.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.up(); };
  // The taps are played in the page, on its own clock: five round trips a pad from here took longer than an eighth on
  // a slower machine (a CI runner read 66 BPM). Each is a pointerdown on the pad, which the pad stamps with the event's
  // timeStamp; the real mouse on a pad is checked below (F J K)
  await E(async ({ beat, rhythm }) => {
    const t0 = performance.now() + 50;
    for (let bar = 0; bar < 2; bar++) {
      for (const [b, voices] of rhythm) {
        const at = t0 + (bar * 4 + b) * beat;
        await new Promise((r) => setTimeout(r, Math.max(0, at - performance.now())));
        for (const v of voices) {
          const el = document.querySelector(`.gv-pad[data-voice="${v}"]`), r = el.getBoundingClientRect();
          const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...o, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...o, button: 0, buttons: 0 }));
        }
      }
    }
  }, { beat: 600, rhythm: ROCK_TAPS });
  await page.waitForFunction(() => window.overdub.grooves.view() === 'taps', null, { timeout: 8000 }).catch(() => {});
  const found = await E(() => ({ view: window.overdub.grooves.view(), results: window.overdub.grooves.results(), rows: [...document.querySelectorAll('.gv-row')].map((r) => r.dataset.groove), head: document.querySelector('.gv-listhead')?.textContent, taps: window.overdub.grooves.taps().length, say: document.querySelector('.gv-tapsay').textContent }));
  T.ok(found.view === 'taps' && found.rows.length === 5 && found.results?.length === 5, `tap-to-find, from ${found.taps} taps on the pads, shows the closest five: ${found.rows.join(', ')}`);
  T.ok(/Closest to your taps/.test(found.head || '') && /taps at about (9\d|10\d) BPM/.test(found.head || ''), `it reads the tempo from the taps ("${(found.head || '').trim()}")`);
  T.ok(found.rows.slice(0, 5).includes('rock/straight-eighths') || found.rows.slice(0, 5).some((id) => /straight|eighths/.test(id)), `the straight-eighths rock beat that was tapped is among them (${found.rows[0]} first)`);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-taps.png'), clip: await E(() => { const r = document.querySelector('.ew-region-bottom').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  // the keys play the pads once a pad has been tapped (F J K)
  await E(() => window.overdub.grooves.clearTaps());
  await pad('kick');
  for (const k of ['KeyJ', 'KeyK', 'KeyF']) { await page.keyboard.press(k); await page.waitForTimeout(120); }
  T.ok(await E(() => window.overdub.grooves.taps().map((t) => t.voice).join(' ')) === 'kick snare hat kick', 'once a pad is tapped, F J K play kick, snare and hat');
  await page.keyboard.press('Escape');
  const click0 = await E(() => window.overdub.engine.click.on);
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(150);
  const freed = await E((c) => ({ taps: window.overdub.grooves.taps().length, click: window.overdub.engine.click.on !== c }), click0);
  T.ok(freed.taps === 4 && freed.click, `Escape puts the pads down: K is the click again (${freed.taps} taps kept, the click ${freed.click ? 'toggled' : 'untouched'})`);
  await page.keyboard.press('KeyK');
  await E(() => window.overdub.grooves.clearTaps());
  // Build drums plays the style of the groove picked, a found one too (fresh eyes 6: after Tap to find the header said
  // Rock and the plan Pop): browsing Jazz, tap a rock beat
  await page.click('.gv-style[data-style="jazz"]');
  const follow = await E((rh) => {
    const o = window.overdub, t0 = performance.now();
    for (let bar = 0; bar < 2; bar++) for (const [b, vs] of rh) for (const v of vs) o.grooves.tap(v, t0 + (bar * 4 + b) * 600);
    o.grooves.find();
    const out = { g: o.grooves.selected(), say: document.querySelector('.gv-buildsay').textContent, plan: o.grooves.plan()?.summary };
    document.querySelector('.gv-planacts .btn-txt')?.click();   // Not now: back to the styles
    return { ...out, styleSel: document.querySelector('.gv-style.sel')?.dataset.style, rowSel: document.querySelector('.gv-row.sel')?.dataset.groove };
  }, ROCK_TAPS);
  const fstyle = L.styles.find((x) => x.id === follow.g?.split('/')[0]);
  T.ok(fstyle && fstyle.id !== 'jazz' && follow.say.includes(`in ${fstyle.name},`) && follow.plan?.startsWith(`${fstyle.name}, `) && follow.styleSel === fstyle.id && follow.rowSel === follow.g, `after Tap to find, Build drums plays the found groove's style, not the one browsed: ${follow.g} found, "${follow.say.slice(0, 42)}…", the plan "${(follow.plan || '').slice(0, 30)}…", and the styles open on ${follow.styleSel}`);
  await E(() => window.overdub.grooves.clearTaps());

  // Build drums for the song: the plan said first, then one undo step with one clip per section
  const p0 = await E(() => ({ hist: window.overdub.store.history.length, tracks: window.overdub.store.get().tracks.length, sections: window.overdub.store.get().sections.map((s) => s.name) }));
  await page.click('.gv-style[data-style="pop"]');
  await page.click('.gv-build');
  await page.waitForSelector('.gv-plansay', { timeout: 5000 });
  const planNow = () => E(() => ({ say: document.querySelector('.gv-plansay').textContent, rows: [...document.querySelectorAll('.gv-planrow')].map((r) => r.textContent), tracks: window.overdub.store.get().tracks.length, primaries: [...document.querySelectorAll('[data-panel="grooves"] .btn-go')].map((b) => b.textContent), ends: [...document.querySelectorAll('.gv-end')].map((b) => `${b.textContent}: ${b.getAttribute('aria-pressed')}`).join(', '), note: document.querySelector('.gv-plannote')?.textContent || '', loop: window.overdub.store.get().loop }));
  const plan = await planNow();
  T.ok(plan.primaries.join() === 'Build it', `while the plan is up, Build it is the one primary (${plan.primaries.join(', ')})`);
  T.ok(/^Pop, verse groove in bars 1–4 and chorus groove in 5–8; fills at 4; no ending, so the loop goes round\. On a new track, Drums 2/.test(plan.say) && plan.rows.length === p0.sections.length && plan.tracks === p0.tracks, `Build drums for the song says what it will do first, changing nothing: "${plan.say}"`);
  // the song loops bars 1-8, its whole length: the plan's choice at the end starts on Loop it, no ending
  T.ok(plan.loop.on && plan.loop.start === 0 && plan.loop.end === 32 && plan.ends === 'End with Ring out: false, Loop it, no ending: true', `the song loops round its end, so the plan's choice at the end starts on Loop it, no ending (${plan.ends})`);
  T.ok(/; Drums stays as it is, so both kits play together\./.test(plan.say) && plan.note === 'To hear one kit alone, press M on the other\'s track header.', `it says the new kit plays beside Drums, and how to hear one alone ("${plan.note}")`);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-plan.png'), clip: await E(() => { const r = document.querySelector('.ew-region-bottom').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  await E(() => document.querySelector('.gv-end[data-end="ending"]')?.click());
  const ended = await planNow();
  const want = await E(() => window.overdub.grooves.plan()?.plan);
  T.ok(/; fills at 4; the ending in bars 7–8\. On a new track/.test(ended.say) && ended.ends === 'End with Ring out: true, Loop it, no ending: false' && want?.ending?.bars.join() === '7,8' && ended.tracks === p0.tracks, `End with Ring out puts it back, changing nothing yet ("${ended.say.split('. ')[0]}")`);
  await page.click('.gv-buildit');
  await page.waitForTimeout(200);
  const built = await E(() => {
    const o = window.overdub, t = o.store.get().tracks.at(-1), last = o.store.history.at(-1);
    return { name: t.name, device: t.instrument.device, clips: t.clips.map((c) => ({ start: c.start, length: c.length, by: c.by, notes: c.notes.length })), secs: o.store.get().sections.map((s) => ({ start: s.start, length: s.length })), hist: o.store.history.length, by: last.by, toast: [...document.querySelectorAll('.ew-toast')].map((x) => x.textContent).join(' | ') };
  });
  T.ok(built.hist === p0.hist + 1 && built.by === 'you' && built.name === 'Drums 2' && built.clips.length === built.secs.length && built.clips.every((c, i) => c.start === built.secs[i].start && c.length === built.secs[i].length && c.by === 'you'), `then it builds: ${built.name} with one clip per section (${built.clips.length}), one undo step signed by you`);
  T.ok(built.clips.every((c, i) => c.notes === want.sections[i].notes), `what it builds is the plan with the ending chosen (${built.clips.map((c) => c.notes).join(' and ')} notes)`);
  const toast = built.toast.split(' | ').find((x) => /^Drums for the song/.test(x)) || '';
  T.ok(/^Drums for the song: Pop on Drums 2, 2 clips, one per section\. Drums still plays: M on its header mutes it\./.test(toast) && /Undo/.test(toast), `it says what it did, that Drums still plays and how to mute it, with Undo ("${toast.slice(0, 120)}")`);
  await E(() => window.overdub.store.undo());
  T.ok(await E((n) => window.overdub.store.get().tracks.length === n, p0.tracks), 'one undo takes the whole drum track back out');


  // (the agents' find_grooves, use_groove and drum_track: results, errors and History are in test/unit/grooves-tools.test.js)

  // the demo agent: "give me a funk beat" takes from the library, as cards
  const mock = await E(async () => {
    const o = window.overdub;
    const { runMock } = await import('/app/src/agent/mock.js');
    let text = '';
    const run = runMock(o, 'give me a funk beat', { fast: true, emit: (k, e) => { if (k === 'text') text += e.delta; }, setStatus: () => {} });
    let req = null;
    for (let i = 0; i < 100 && !req; i++) { await new Promise((r) => setTimeout(r, 100)); req = [...o.tools.requests.values()].find((x) => x.kind === 'variations' && x.status === 'pending'); }
    const cards = req ? req.cards.filter((c) => !c.original).map((c) => c.label) : [];
    const h = o.store.history.length;
    if (req) o.tools.answer(req.id, { index: req.cards.find((c) => !c.original).index });
    await run;
    const t = o.store.get().tracks.at(-1);
    return { cards, text, kept: o.store.history.length === h + 1, track: t.name, by: t.clips[0]?.by, clip: t.clips[0]?.name };
  });
  T.ok(mock.cards.length === 3 && /matched "funk" to the library's Funk grooves/.test(mock.text) && /your own drums stay as they are/.test(mock.text), `the demo agent takes "give me a funk beat" to the library, as ${mock.cards.length} cards (${mock.cards.join(', ')}), and says what it matched`);
  T.ok(mock.kept && /^Drums/.test(mock.track) && mock.by === 'claude' && /^Funk, /.test(mock.clip), `a kept card is a new drum track signed by the agent (${mock.track}: ${mock.clip})`);
  errs.push(...errors.filter((e) => !ignorable(e)));
  await s.close();
}
{
  // a tab closed while a groove was heard: the autosave had the preview in it; the next boot takes it back out
  const s = await open('/app/', { width: 1280, height: 860, query: 'demo' });
  const { page, errors } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  const during = await E(async () => {
    const o = window.overdub;
    o.ui.show('grooves');
    await o.engine.start();
    await o.grooves.hear('rock/straight-eighths', { alone: false });
    await new Promise((r) => setTimeout(r, 900));   // the autosave runs half a second after a change
    const saved = JSON.parse(localStorage.getItem('overdub:project'));
    return { saved: saved.tracks.some((t) => /^Hearing /.test(t.name)), muted: saved.tracks.filter((t) => t.mute).map((t) => t.name), key: !!localStorage.getItem('overdub:grooves-hearing') };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  const after = await E(() => { const p = window.overdub.store.get(); return { hearing: p.tracks.some((t) => /^Hearing /.test(t.name)), muted: p.tracks.filter((t) => t.mute).map((t) => t.name), key: localStorage.getItem('overdub:grooves-hearing'), saved: JSON.parse(localStorage.getItem('overdub:project')).tracks.some((t) => /^Hearing /.test(t.name)), hist: window.overdub.store.history.length }; });
  T.ok(during.saved && during.key && during.muted.includes('Drums'), `while a groove plays in the song, the autosave holds the preview (a Hearing track, ${during.muted.join(', ')} muted) and the tab notes it`);
  T.ok(!after.hearing && !after.muted.length && after.key === null && !after.saved && after.hist === 0, 'a reload mid-listen comes back without it: the Hearing track gone, the drums unmuted, saved that way, nothing in History');
  errs.push(...errors.filter((e) => !ignorable(e)));
  await s.close();
}
{
  // a phone: one column, nothing off the side, every target 44 px, no text under 12 px
  const s = await open('/app/', { width: 390, height: 844, query: 'demo' });
  const { page, errors } = s;
  const E = (fn, a) => page.evaluate(fn, a);
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await E(() => { document.querySelector('.ar-welcome-x')?.click(); const o = window.overdub; o.ui.setOpen('bottom', true); o.ui.show('grooves'); });
  await page.waitForTimeout(500);
  const check = (label) => floorCheck(E, label);
  const a = await check('the styles');
  T.ok(a.rows >= 8 && a.wide <= 0, `phone: the Grooves tab opens in one column, nothing off the side (${a.rows} grooves, ${a.wide} px over)`);
  T.ok(!a.small.length, `phone: every target is 44 px${say(a.small.map((x) => `${x.c} ${x.w}x${x.h}`))}`);
  T.ok(!a.tiny.length, `phone: no text under 12 px${say(a.tiny)}`);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-phone.png') });
  // a found groove's line is whole (fresh eyes 6: "16 of 16 taps on its hits, sc…")
  const why = await E((rh) => {
    const o = window.overdub, t0 = performance.now();
    for (let bar = 0; bar < 2; bar++) for (const [b, vs] of rh) for (const v of vs) o.grooves.tap(v, t0 + (bar * 4 + b) * 600);
    o.grooves.find();
    const ws = [...document.querySelectorAll('.gv-why')];
    return { n: ws.length, cut: ws.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent), text: ws[0]?.textContent };
  }, ROCK_TAPS);
  const c = await check('the taps');
  T.ok(why.n === 5 && !why.cut.length && !c.small.length && !c.tiny.length && c.wide <= 0, `phone: the closest five to the taps, each line whole ("${why.text}")${say([...why.cut, ...c.small.map((x) => `${x.c} ${x.w}x${x.h}`), ...c.tiny])}`);
  await E(() => window.overdub.grooves.clearTaps());
  // Build drums with one section says it in words (fresh eyes 6: "A track for every section (1)")
  const one = await E(() => {
    const o = window.overdub, sec = o.store.get().sections.at(-1);
    o.store.dispatch([{ type: 'section.remove', section: sec.id }], { by: 'you' });
    const say = document.querySelector('.gv-buildsay').textContent;
    o.store.undo({ by: 'you' });
    return { say, back: document.querySelector('.gv-buildsay').textContent };
  });
  T.ok(/^A new drum track in [^,]+ for the song's one section: its groove, a crash on its downbeat and no ending, so the loop goes round\.$/.test(one.say) && /a clip for each of the 2 sections/.test(one.back), `phone: with one section, Build says so in words ("${one.say}")`);
  // the plan opens with its first sentence in view, under the pinned bar (fresh eyes 6: Build is at the foot of the
  // column, and the plan opened scrolled up out of sight)
  await E(() => document.querySelector('.gv-build').scrollIntoView({ block: 'center' }));
  await page.click('.gv-build');
  await page.waitForTimeout(200);
  const inView = await E(() => { const say = document.querySelector('.gv-plansay').getBoundingClientRect(), bar = document.querySelector('.gv-bar').getBoundingClientRect(); return { say: Math.round(say.top), bar: Math.round(bar.bottom), vh: innerHeight }; });
  T.ok(inView.say >= inView.bar - 1 && inView.say <= inView.bar + 24 && inView.say < inView.vh - 60, `phone: Build at the foot of the column opens the plan with its first sentence just under the pinned bar (at ${inView.say} px; the bar ends at ${inView.bar})`);
  const b = await check('the plan');
  T.ok(!b.small.length && !b.tiny.length && b.wide <= 0, `phone: the plan keeps the floor too, its choice at the end included${say([...b.small.map((x) => `${x.c} ${x.w}x${x.h}`), ...b.tiny])}`);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-phone-plan.png') });
  errs.push(...errors.filter((e) => !ignorable(e)));
  await s.close();
}
{
  // a phone on its side (844x390, touch; fresh eyes 6: three columns in a 48 px body, the pads cut off at the screen's
  // edge): one column that scrolls, bar and all, so a groove, the pads, Build and Put each come into view whole
  const s = await open('/app/', { width: 844, height: 390, query: 'demo' });
  const ctx = await s.browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const E = (fn, a) => page.evaluate(fn, a);
  await page.goto(s.base + '/app/?demo', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await E(() => { document.querySelector('.ar-welcome-x')?.click(); const o = window.overdub; o.ui.setOpen('bottom', true); o.ui.show('grooves'); });
  await page.waitForTimeout(500);
  const side = await E(() => {
    const root = document.querySelector('[data-panel="grooves"] .gv'), q = (sel) => root.querySelector(sel), r = (e) => e.getBoundingClientRect();
    const stack = ['.gv-bar', '.gv-styles', '.gv-list', '.gv-side'].map((sel) => r(q(sel)));
    const oneCol = stack.every((x, i) => !i || x.top >= stack[i - 1].bottom - 1);
    // scrolled to (as a swipe would), each lies whole inside the tab and on the screen
    const whole = (e) => { e.scrollIntoView({ block: 'nearest' }); const x = r(e), t = r(root); return x.height > 0 && x.top >= Math.max(0, t.top) - 1 && x.bottom <= Math.min(innerHeight, t.bottom) + 1; };
    const parts = { 'a groove': whole(q('.gv-row')), 'the pads': whole(q('.gv-pads')), Build: whole(q('.gv-build')), Put: whole(q('.gv-put')) };
    return { coarse: matchMedia('(pointer: coarse)').matches, tab: Math.round(r(root).height), oneCol, parts, wide: document.documentElement.scrollWidth - innerWidth };
  });
  const cut = Object.entries(side.parts).filter(([, v]) => !v).map(([k]) => `${k} cut off`);
  T.ok(side.coarse && side.oneCol && !cut.length && side.wide <= 0, `on its side (844x390, a ${side.tab} px tab): one column that scrolls, bar and all; a groove, the pads, Build and Put each come into view whole${side.oneCol ? '' : ' (still in columns)'}${say(cut)}`);
  const f = await floorCheck(E, 'on its side');
  T.ok(!f.small.length && !f.tiny.length, `on its side: every target 44 px, no text under 12 px${say([...f.small.map((x) => `${x.c} ${x.w}x${x.h}`), ...f.tiny])}`);
  await page.screenshot({ path: path.join(OUTDIR, 'grooves-side.png') });
  errs.push(...errors.filter((e) => !ignorable(e)));
  await s.close();
}

/* ================================================================== the look */
{
  const src = fs.readFileSync(path.join(HERE, '../app/src/ui/grooves.js'), 'utf8');
  const cssSrc = src.slice(src.lastIndexOf('const CSS = `'));
  T.ok(!/inset\s+-?\d+(\.\d+)?px\s+0\s+0/.test(cssSrc) && !/border-left:\s*\d+px solid var\(--(human|agent|accent)/.test(cssSrc), 'the Grooves tab draws no coloured edge on a box');
  T.ok(!/border-radius:\s*(99|999|50%)/.test(cssSrc) && !/icon\('sparkle'/.test(src), 'no pills, no sparkle');
  T.ok(/byline\(/.test(src), 'who put a groove in the song is a byline');
}
T.ok(!errs.length, `no page errors${say(errs, 3)}`);
T.done();
