// Checks for the arrangement edits (app/src/core/arrangement.js and the ops of the same names in core/ops.js), the
// arranger's section and clip menu items and keys, the inspector's buttons, and the `arrange_song` agent tool
// (app/src/agent/arrangement-tool.js).
//   node tools/arrangement-test.js      (screenshot: tools/.out/arrangement-menu.png)
import { createStore } from '../app/src/core/store.js';
import { createProject } from '../app/src/core/project.js';
import { OP_TYPES } from '../app/src/core/ops.js';
import { planSectionDuplicate, planTimeInsert, planClipSplit, nextName } from '../app/src/core/arrangement.js';
import { formatNotes } from '../app/src/core/music.js';
import { demoProject } from '../app/src/core/demo.js';
import { open, tally } from './pw.js';

const T = tally('arrangement');
// canonical JSON (sorted keys), without meta (its modified time moves)
const canon = (x) => JSON.stringify({ ...x, meta: null }, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const near = (a, b) => Math.abs(a - b) < 1e-3;

/* ================================================================== a small song, in Node */
// 4/4 at 120 bpm (half a second a beat). Verse 0–16, Chorus 16–32, Outro 32–40; the loop over the Chorus.
function song() {
  const s = createStore(createProject({ title: 'T', tempo: 120, loop: { on: true, start: 16, end: 32 } }));
  const r = s.dispatch([
    { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 16 } },
    { type: 'section.add', ref: 'c', section: { name: 'Chorus', start: 16, length: 16, color: 'var(--c-7)' } },
    { type: 'section.add', ref: 'o', section: { name: 'Outro', start: 32, length: 8 } },
    { type: 'track.add', ref: 'keys', track: { name: 'Keys', instrument: { device: 'core.keys' } } },
    { type: 'clip.add', track: '$keys', ref: 'ka', clip: { start: 0, length: 16, name: 'Chords', notes: 'C4@0:2 E4@2:2 G4@4:1 C4@6:4 A3@10:2 F4@12:4 D4@15.5:1' } },
    { type: 'clip.add', track: '$keys', ref: 'kb', clip: { start: 20, length: 8, name: 'Stab', notes: 'C5@0:0.5 C5@3.5:1 E5@5:3' } },
    { type: 'track.add', ref: 'drums', track: { name: 'Drums', instrument: { device: 'core.drums' } } },
    { type: 'clip.add', track: '$drums', ref: 'da', clip: { start: 0, length: 32, name: 'Beat', notes: '36@0:0.25 38@4:0.25 36@7.9:0.25 38@12:0.25 36@16:0.25 38@20:0.25 36@24:0.25' } },
    { type: 'track.add', ref: 'vox', track: { name: 'Vox', kind: 'audio' } },
    { type: 'asset.add', asset: { id: 'a_take01', kind: 'audio', name: 'take', sr: 48000, channels: 1, duration: 30 } },
    { type: 'clip.add', track: '$vox', ref: 'va', clip: { kind: 'audio', asset: 'a_take01', start: 4, length: 8, offset: 0.5, name: 'Take' } },
  ], { by: 'you', label: 'the song' });
  // a bassline in the Chorus by the agent, and one the human wrote
  const b = s.dispatch([
    { type: 'track.add', ref: 'bass', track: { name: 'Bass', instrument: { device: 'core.bass' } } },
    { type: 'clip.add', track: '$bass', ref: 'ba', clip: { start: 16, length: 16, name: 'Walk', notes: 'A1@0:1 C2@4:1 E2@8:1 G2@12:3.5' } },
  ], { by: 'claude', label: 'bass' });
  const ids = { ...r.created, ...b.created };
  return { s, ids, T: (name) => s.get().tracks.find((t) => t.name === name), C: (id) => s.findClip(id)?.clip };
}

// Apply ops as one step; check undo is exact and redo gives the same song again. -> the store's result
function roundTrip(s, ops, by, what) {
  const before = canon(s.get());
  const r = s.dispatch(ops, { by, label: what });
  if (!T.ok(r.ok, `${what}: applies${r.ok ? '' : ': ' + r.error}`)) return r;
  const after = canon(s.get());
  T.ok(after !== before, `${what}: changes the song`);
  const steps = s.history.length;
  const u = s.undo();
  T.ok(u.ok && canon(s.get()) === before, `${what}: one undo step puts it back exactly (canonical JSON)`);
  const rd = s.redo();
  T.ok(rd.ok && canon(s.get()) === after && s.history.length === steps, `${what}: redo gives the same song again`);
  return r;
}
// What a clip's notes sound: per pitch, the beats [start, end) in song time, cut at the clip's end; merged.
function sounding(clips, { onsetsOnly = false } = {}) {
  const per = new Map();
  for (const c of clips) {
    for (const n of c.notes) {
      const a = c.start + n.t, b = Math.min(c.start + n.t + n.d, c.start + c.length);
      if (a >= c.start + c.length - 1e-9) continue;
      if (!per.has(n.p)) per.set(n.p, []);
      per.get(n.p).push(onsetsOnly ? [a, a] : [a, b]);
    }
  }
  const out = {};
  for (const [p, xs] of [...per].sort((x, y) => x[0] - y[0])) {
    xs.sort((x, y) => x[0] - y[0]);
    const m = [];
    for (const [a, b] of xs) { const l = m[m.length - 1]; if (!onsetsOnly && l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b); else m.push([+a.toFixed(4), +b.toFixed(4)]); }
    out[p] = m.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]);
  }
  return JSON.stringify(out);
}

T.ok(['section.duplicate', 'section.move', 'time.insert', 'time.remove', 'clip.repeat', 'clip.split'].every((x) => OP_TYPES.includes(x)), 'the six arrangement ops are in the op catalog');

/* ------------------------------------------------------------------ clip.split */
{
  const { s, ids, T: tr, C } = song();
  const keys = tr('Keys'), ka = C(ids.ka);
  const heard = sounding([ka]);
  const noteIds = ka.notes.map((n) => n.id).join();
  const r = roundTrip(s, { type: 'clip.split', track: keys.id, clip: ids.ka, at: 8, ref: 'right' }, 'claude', 'split Chords at bar 3');
  const left = C(ids.ka), right = C(r.created.right);
  T.ok(left.start === 0 && left.length === 8 && right.start === 8 && right.length === 8 && right.name === 'Chords', `the halves: 0–8 and 8–16, the name kept (${left.start}+${left.length}, ${right.start}+${right.length})`);
  const across = left.notes.find((n) => n.p === 60 && n.t === 6), tail = right.notes.find((n) => n.p === 60 && n.t === 0);
  T.ok(across && near(across.d, 2) && tail && near(tail.d, 2), `C4 across the cut keeps both parts: ${across?.d} before, ${tail?.d} after (4 in all)`);
  T.ok(sounding([left, right]) === heard, 'every note sounds exactly where it did (each pitch, beat for beat)');
  T.ok(left.notes.every((n) => noteIds.includes(n.id)) && right.notes.every((n) => n.by === 'you') && left.notes.every((n) => n.by === 'you'), 'notes keep their ids and their author (the human), even split by the agent');
  T.ok(right.by === 'you', 'the right half is still the clip-maker\'s clip');
  // drums: a hit across the cut stays whole on its side (no second kick)
  const drums = tr('Drums'), before = C(ids.da).notes.length;
  const r2 = roundTrip(s, { type: 'clip.split', track: drums.id, clip: ids.da, at: 8, ref: 'r' }, 'you', 'split the Beat at bar 3');
  const dl = C(ids.da), dr = C(r2.created.r);
  T.ok(dl.notes.length + dr.notes.length === before && !dr.notes.some((n) => n.t === 0 && n.p === 36), `a kick across the cut isn't doubled (${dl.notes.length} + ${dr.notes.length} = ${before} hits)`);
  // audio: the right half plays on from the same place in the take
  const vox = tr('Vox');
  const r3 = roundTrip(s, { type: 'clip.split', track: vox.id, clip: ids.va, at: 8, ref: 'r' }, 'you', 'split the Take at bar 3');
  const vl = C(ids.va), vr = C(r3.created.r);
  T.ok(vl.length === 4 && vr.start === 8 && vr.length === 4 && near(vr.offset, 0.5 + 4 * 0.5) && vr.asset === 'a_take01', `audio: the right half starts 2 s further into the take (offset ${vr.offset} s)`);
  let threw = ''; try { planClipSplit(s.get(), { track: keys.id, clip: ids.kb, at: 40 }); } catch (e) { threw = e.message; }
  T.ok(/isn't inside/.test(threw) && /20–28/.test(threw), `a split outside the clip says where the clip is: "${threw}"`);
}

/* ------------------------------------------------------------------ time.insert */
{
  const { s, ids, T: tr, C } = song();
  const heardKeys = sounding([C(ids.ka)]);
  roundTrip(s, { type: 'time.insert', at: 8, length: 8 }, 'claude', 'insert 2 bars at bar 3');
  const p = s.get();
  const keys = tr('Keys');
  const right = keys.clips.find((c) => c.id !== ids.ka && c.id !== ids.kb);
  T.ok(C(ids.ka).length === 8 && right && right.start === 16 && right.length === 8, `a clip across the insert is split there and its second half moves right (${right?.start})`);
  T.ok(C(ids.kb).start === 28 && C(ids.ba).start === 24 && C(ids.va).length === 4, 'clips after it move right by 2 bars; the take across it is split too');
  // the second half's notes are the first's, 8 beats later
  const shifted = JSON.parse(heardKeys);
  for (const k of Object.keys(shifted)) shifted[k] = shifted[k].flatMap(([a, b]) => (b <= 8 ? [[a, b]] : a >= 8 ? [[a + 8, b + 8]] : [[a, 8], [16, b + 8]]));
  T.ok(sounding([C(ids.ka), right]) === JSON.stringify(shifted), 'every Keys note sounds where it did, the part after the insert 2 bars later');
  const sec = Object.fromEntries(p.sections.map((x) => [x.name, [x.start, x.length]]));
  T.ok(JSON.stringify(sec) === JSON.stringify({ Verse: [0, 24], Chorus: [24, 16], Outro: [40, 8] }), `the Verse grows round the new bars, the rest move (${JSON.stringify(sec)})`);
  T.ok(p.loop.on && p.loop.start === 24 && p.loop.end === 40, `the loop moves with the Chorus (${p.loop.start}–${p.loop.end})`);
  // at a section boundary nothing is split and the section before doesn't grow
  const { s: s2, ids: i2, C: C2 } = song();
  roundTrip(s2, { type: 'time.insert', at: 16, length: 4 }, 'you', 'insert a bar at bar 5');
  const sec2 = Object.fromEntries(s2.get().sections.map((x) => [x.name, [x.start, x.length]]));
  T.ok(sec2.Verse[1] === 16 && sec2.Chorus[0] === 20 && C2(i2.ka).length === 16 && C2(i2.ba).start === 20, 'inserting at a section boundary pushes the next section, splitting nothing');
  let threw = ''; try { planTimeInsert(s.get(), { at: 4, length: 0 }); } catch (e) { threw = e.message; }
  T.ok(/more than 0/.test(threw), 'inserting nothing is refused');
}

/* ------------------------------------------------------------------ time.remove */
{
  const { s, ids, C } = song();
  const da0 = C(ids.da).notes.length;
  const r = roundTrip(s, { type: 'time.remove', at: 8, length: 8 }, 'claude', 'delete bars 3–4');
  const p = s.get();
  const ka = C(ids.ka);
  T.ok(ka.start === 0 && ka.length === 8 && formatNotes(ka.notes) === 'C4@0:2 E4@2:2 G4@4:1 C4@6:2', `a clip ending in the cut is trimmed: notes inside go, one across the cut keeps its part (${formatNotes(ka.notes)})`);
  const da = C(ids.da);
  T.ok(da.start === 0 && da.length === 24 && da.notes.length === da0 - 1 && da.notes.some((n) => n.p === 36 && n.t === 7.9 && near(n.d, 0.1)) && da.notes.some((n) => n.p === 36 && n.t === 8), `a clip across the whole cut closes up around it (${da.length} beats, ${da.notes.length} hits, the bar-2 kick trimmed to the cut)`);
  T.ok(C(ids.kb).start === 12 && C(ids.ba).start === 8, 'clips after it move left 2 bars');
  T.ok(C(ids.va).start === 4 && C(ids.va).length === 4, 'the take across the start of the cut is trimmed');
  const sec = Object.fromEntries(p.sections.map((x) => [x.name, [x.start, x.length]]));
  T.ok(JSON.stringify(sec) === JSON.stringify({ Verse: [0, 8], Chorus: [8, 16], Outro: [24, 8] }), `sections close up (${JSON.stringify(sec)})`);
  T.ok(p.loop.start === 8 && p.loop.end === 24 && p.loop.on, 'the loop moves left with the Chorus');
  T.ok(r.ok, 'one step');
  // a section's bars: it and everything starting in it go
  const { s: s2, ids: i2, C: C2 } = song();
  roundTrip(s2, { type: 'time.remove', at: 16, length: 16 }, 'you', 'delete the Chorus\'s bars');
  const p2 = s2.get();
  T.ok(!p2.sections.some((x) => x.name === 'Chorus') && p2.sections.find((x) => x.name === 'Outro').start === 16, 'the Chorus is gone and the Outro moves up');
  T.ok(!C2(i2.ba) && !C2(i2.kb) && C2(i2.da).length === 16, 'clips inside go; one across it is trimmed');
  T.ok(p2.loop.on === false && p2.loop.end > p2.loop.start, `the loop was inside the cut, so it is off (${p2.loop.start}–${p2.loop.end})`);
  // a pitched note across the end of a cut keeps its tail
  const { s: s3, ids: i3, C: C3 } = song();
  s3.dispatch({ type: 'notes.add', track: s3.get().tracks[0].id, clip: i3.ka, notes: 'B3@7:3' }, { by: 'you' });
  roundTrip(s3, { type: 'time.remove', at: 8, length: 1 }, 'you', 'delete one beat');
  const b3 = C3(i3.ka).notes.find((n) => n.p === 59);
  T.ok(b3 && b3.t === 7 && near(b3.d, 2), `a note across the whole cut closes up: B3 now ${b3?.d} beats (was 3)`);
}

/* ------------------------------------------------------------------ section.duplicate */
{
  const { s, ids, T: tr, C } = song();
  const p0 = s.get();
  const chorus = p0.sections.find((x) => x.name === 'Chorus');
  const r = roundTrip(s, { type: 'section.duplicate', section: chorus.id, push: true, ref: 'c2' }, 'claude', 'duplicate the Chorus, pushing');
  const p = s.get();
  const sec = Object.fromEntries(p.sections.map((x) => [x.name, [x.start, x.length]]));
  T.ok(JSON.stringify(sec) === JSON.stringify({ Verse: [0, 16], Chorus: [16, 16], 'Chorus 2': [32, 16], Outro: [48, 8] }), `Chorus 2 lands right after it and the Outro moves right (${JSON.stringify(sec)})`);
  T.ok(p.sections.find((x) => x.name === 'Chorus 2').color === 'var(--c-7)' && r.created.c2 === p.sections.find((x) => x.name === 'Chorus 2').id, 'it keeps the colour, and ref names it');
  const bass = tr('Bass').clips, keys = tr('Keys').clips;
  const copy = bass.find((c) => c.id !== ids.ba);
  T.ok(bass.length === 2 && copy.start === 32 && copy.length === 16 && formatNotes(copy.notes) === formatNotes(C(ids.ba).notes), 'the Walk is copied note for note into Chorus 2');
  const stab = keys.find((c) => c.id !== ids.ka && c.id !== ids.kb);
  T.ok(stab && stab.start === 36 && formatNotes(stab.notes) === formatNotes(C(ids.kb).notes), 'a clip starting inside it is copied to the same place in the copy');
  const beat = tr('Drums').clips.find((c) => c.id !== ids.da);
  const hits = beat ? beat.notes.map((n) => `${n.p}@${n.t}`).join(' ') : '';
  T.ok(beat && beat.start === 32 && beat.length === 16 && hits === '36@0 38@4 36@8' && beat.notes.every((n) => n.by === 'you'), `a clip that starts before the section and plays through it (the Beat, 0–32) is copied from the section's start: Chorus 2 has drums (${beat ? `${beat.start}+${beat.length}: ${hits}` : 'none'})`);
  T.ok(keys.length === 3 && C(ids.ka).start === 0 && C(ids.ka).length === 16, 'a clip that ends where the section starts (the Chords, 0–16) is not copied');
  T.ok(copy.by === 'claude' && stab.by === 'claude' && stab.notes.every((n) => n.by === 'you') && copy.notes.every((n) => n.by === 'claude'), 'the copies are signed by whoever duplicated; every note keeps its author');
  T.ok(p.loop.start === 16 && p.loop.end === 32, 'the loop over the Chorus stays on the Chorus');
  // without push: the copy goes over what is there, and nothing moves
  const { s: s2, ids: i2, C: C2 } = song();
  roundTrip(s2, { type: 'section.duplicate', section: 'Verse', to: 32 }, 'you', 'duplicate the Verse over the Outro');
  const p2 = s2.get();
  T.ok(p2.sections.find((x) => x.name === 'Outro').start === 32 && p2.sections.find((x) => x.name === 'Verse 2').start === 32 && C2(i2.ba).start === 16, 'without push nothing moves');
  // a clip that runs past the section's end is copied up to it
  const { s: s3, ids: i3, T: tr3 } = song();
  s3.dispatch({ type: 'clip.set', track: tr3('Keys').id, clip: i3.kb, patch: { start: 12 } }, { by: 'you' });
  roundTrip(s3, { type: 'section.duplicate', section: 'Verse', push: true }, 'you', 'duplicate the Verse with a clip across its end');
  const cut = tr3('Keys').clips.find((c) => c.start === 28);
  T.ok(cut && cut.length === 4 && formatNotes(cut.notes) === 'C5@0:0.5 C5@3.5:0.5', `the copy stops at the section's end, its last note cut there (${cut && formatNotes(cut.notes)})`);
  T.ok(nextName(s3.get(), 'Verse') === 'Verse 3' && nextName(s3.get(), 'Chorus') === 'Chorus 2' && nextName(s3.get(), 'Verse 2') === 'Verse 3', 'copies are named Verse 2, Verse 3…');
  let threw = ''; try { planSectionDuplicate(s3.get(), { section: 'Bridge' }); } catch (e) { threw = e.message; }
  T.ok(/no section "Bridge"/.test(threw) && /Verse/.test(threw), 'an unknown section lists the ones there are');
  // across the section's start: a pitched note ringing in keeps its tail; an audio take plays on from the same place
  const { s: s4, ids: i4, T: tr4, C: C4 } = song();
  s4.dispatch([{ type: 'clip.set', track: 'Keys', clip: i4.ka, patch: { length: 24 } }, { type: 'clip.set', track: 'Vox', clip: i4.va, patch: { start: 12 } }], { by: 'you' });
  const r4 = roundTrip(s4, { type: 'section.duplicate', section: 'Chorus', push: true }, 'you', 'duplicate the Chorus with clips across its start');
  const kc = tr4('Keys').clips.find((c) => r4.created.clips?.includes(c.id) && c.start === 32);
  T.ok(kc && kc.length === 8 && formatNotes(kc.notes) === 'D4@0:0.5', `Chords (0–24) copies its part from the Chorus's start, D4's tail first (${kc && `${kc.start}+${kc.length}: ${formatNotes(kc.notes)}`})`);
  const vc = tr4('Vox').clips.find((c) => c.id !== i4.va);
  T.ok(vc && vc.start === 32 && vc.length === 4 && near(vc.offset, 0.5 + 4 * 0.5) && near(C4(i4.va).offset, 0.5), `the take across the Chorus's start is copied from there, 2 s further into it (offset ${vc?.offset} s)`);
  // the demo everyone opens: Drums and Keys run under both Verse and Chorus, so a copied Chorus must bring them
  const sd = createStore(demoProject());
  const pd = sd.get(), ch = pd.sections.find((x) => x.name === 'Chorus');
  const sounding0 = pd.tracks.filter((t) => t.clips.some((c) => c.start < ch.start + ch.length && c.start + c.length > ch.start)).map((t) => t.name);
  const rd = sd.dispatch({ type: 'section.duplicate', section: 'Chorus', push: true }, { by: 'you' });
  const c2 = sd.get().sections.find((x) => x.name === 'Chorus 2');
  const in2 = sd.get().tracks.filter((t) => t.clips.some((c) => c.start >= c2.start - 1e-6 && c.start < c2.start + c2.length)).map((t) => t.name);
  T.ok(rd.ok && sounding0.length >= 5 && sounding0.every((n) => in2.includes(n)), `the demo's Chorus copies with every track that plays in it (${sounding0.join(', ')} -> ${in2.join(', ')})`);
  // names: a trailing number past 2^53 can't be counted on (n + 1 === n), and that used to hang the tab
  const sn = createStore(createProject());
  const t0 = Date.now();
  const rn = sn.dispatch([
    { type: 'section.add', ref: 'a', section: { name: 'Chorus 9007199254740992' } }, { type: 'section.duplicate', section: '$a' },
    { type: 'section.add', ref: 'b', section: { name: 'X 99999999999999999999', start: 64 } }, { type: 'section.duplicate', section: '$b' }, { type: 'section.duplicate', section: '$b' },
  ], { by: 'mcp:x' });
  const names = sn.get().sections.map((x) => x.name);
  T.ok(rn.ok && Date.now() - t0 < 1000 && new Set(names.map((x) => x.toLowerCase())).size === names.length && names.includes('Chorus 9007199254740992 2') && names.includes('X 99999999999999999999 3'), `a section named past 2^53 duplicates to a free name, at once (${names.join(' / ')})`);
  T.ok(nextName({ sections: [{ name: 'Verse' }, { name: 'Verse 2' }, { name: 'Verse 3' }] }, 'Verse') === 'Verse 4' && nextName({ sections: [] }, 'Take 07') === 'Take 8', 'ordinary numbers still count up (Verse 4, Take 8)');
  // a loaded song with a section named 5 (or {}): names are text, so Duplicate and lookups by name still work
  const sx = createStore(createProject({ sections: [{ id: 's_x', name: 5, start: 0, length: 16 }, { id: 's_y', name: {}, start: 16, length: 4 }], tracks: [{ name: 7, clips: [] }] }));
  const rx = sx.dispatch([{ type: 'section.duplicate', section: '5' }, { type: 'clip.add', track: '7', clip: { start: 0, notes: 'C4@0:1' } }], { by: 'you' });
  T.ok(rx.ok && sx.get().sections.map((x) => x.name).sort().join() === '5,5 2,Section' && sx.get().tracks[0].name === '7', `a section or track name that isn't text loads as text (${sx.get().sections.map((x) => x.name).join(', ')}${rx.ok ? '' : ': ' + rx.error})`);
}

/* ================================================================== in the studio */
{
  const { page, errors, close, shot } = await open('/app/', { query: 'demo' });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const E = (fn, arg) => page.evaluate(fn, arg);
  // canonical JSON (sorted keys): an undo puts back the same song, though a restored section may list its keys in another order
  const snapshot = async () => canon(await E(() => window.overdub.store.get()));
  const toast = () => E(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent).pop() || '');
  const items = () => page.$$eval('[role=menu] .ek-item', (els) => els.map((e) => e.textContent));
  await E(() => { window.overdub.ui.show('arranger'); window.overdub.arranger.zoomTo?.(0, 48); });
  await page.waitForTimeout(250);

  // keys: both registered (a clash would have skipped one, with a console warning). Split is ⌘E (Ctrl+E), Live's key:
  // S solos the selected track now, as in Logic and GarageBand (whose ⌘T is a browser's new tab)
  const SPLIT = process.platform === 'darwin' ? 'Meta+KeyE' : 'Control+KeyE';
  const keys = await E(() => window.overdub.ui.keys.list().filter((k) => k.group === 'Arrange').map((k) => `${k.mod || ''}+${k.key}:${k.label}`));
  T.ok(keys.some((k) => k.startsWith('mod+KeyD:Duplicate the selected section')) && keys.some((k) => k.startsWith('mod+KeyE:Split')) && !keys.some((k) => k.startsWith('+KeyS:')), `the arranger declares ⌘D for a selected section and ⌘E for split (S solos now) (${keys.filter((k) => /Split/.test(k)).join('; ')})`);

  // the section menu: right-click the Chorus on the ruler
  const at = (beat, y) => E(([b, yy]) => {
    const rw = document.querySelector('.ar-rulerwrap').getBoundingClientRect(), sc = document.querySelector('.ar-scroll');
    return { x: rw.left + b * window.overdub.ui.state.zoom.pxPerBeat - sc.scrollLeft, y: rw.top + yy };
  }, [beat, y]);
  const chorus = await E(() => window.overdub.store.get().sections.find((s) => s.name === 'Chorus'));
  let pt = await at(chorus.start + 2, 10);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForTimeout(150);
  const sm = await items();
  T.ok(['Duplicate', 'Insert bars after', 'Delete these bars'].every((l) => sm.some((x) => x.startsWith(l))), `the section menu has Duplicate, Insert bars after, Delete these bars (${sm.join(' | ')})`);
  await shot('arrangement-menu');
  let pre = await snapshot();
  let h0 = await E(() => window.overdub.store.history.length);
  await page.click('[role=menu] .ek-item:has-text("Duplicate")');
  await page.waitForTimeout(200);
  let st = await E(() => { const s = window.overdub.store, p = s.get(), h = s.history.at(-1); return { secs: p.sections.map((x) => `${x.name}@${x.start}`).join(), n: s.history.length, by: h.by, label: h.label }; });
  T.ok(st.n === h0 + 1 && st.by === 'you' && /Chorus 2@32/.test(st.secs) && /duplicate Chorus/.test(st.label), `Duplicate: one step by you, Chorus 2 at bar 9 (${st.secs})`);
  let tt = await toast();
  T.ok(/^Copied Chorus .* as Chorus 2, with \d+ clips/.test(tt), `the toast says what was copied: "${tt}"`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, 'undo puts the song back exactly');

  // Insert bars after the Verse → 2 bars
  pt = await at(2, 10);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForTimeout(120);
  await page.click('[role=menu] .ek-item:has-text("Insert bars after")');
  await page.waitForTimeout(120);
  const sub = await items();
  T.ok(sub.join() === '1 bar,2 bars,4 bars,8 bars', `Insert bars after offers 1, 2, 4 or 8 (${sub.join(', ')})`);
  await page.click('[role=menu] .ek-item:has-text("2 bars")');
  await page.waitForTimeout(150);
  st = await E(() => { const s = window.overdub.store, p = s.get(); return { end: p.sections.map((x) => `${x.name}@${x.start}`).join(), label: s.history.at(-1).label }; });
  tt = await toast();
  T.ok(/insert 2 bars at bar 5/.test(st.label) && /^Inserted 2 bars at bar 5/.test(tt) && /Chorus@24/.test(st.end), `Insert bars after the Verse: the Chorus moves to bar 7 (${st.end}); "${tt}"`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, '…and undo takes them out again');

  // Delete these bars
  pt = await at(chorus.start + 2, 10);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForTimeout(120);
  await page.click('[role=menu] .ek-item:has-text("Delete these bars")');
  await page.waitForTimeout(150);
  st = await E(() => ({ secs: window.overdub.store.get().sections.map((x) => x.name).join(), label: window.overdub.store.history.at(-1).label }));
  tt = await toast();
  T.ok(!/Chorus/.test(st.secs) && /^Deleted Chorus \(bars 5–8\)/.test(tt) && /Z brings them back/.test(tt), `Delete these bars: "${tt}"`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, '…and undo brings them back');

  // ⌘D on a selected section
  pt = await at(chorus.start + 2, 10);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(120);
  h0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyD' : 'Control+KeyD');
  await page.waitForTimeout(200);
  st = await E(() => ({ n: window.overdub.store.history.length, secs: window.overdub.store.get().sections.map((x) => x.name).join() }));
  T.ok(st.n === h0 + 1 && /Chorus 2/.test(st.secs), `⌘D duplicates the selected section (${st.secs})`);
  await E(() => window.overdub.store.undo());

  // the clip menu: right-click the Bass clip
  const clipAt = (clipId, dx = 0.5) => E(([id, d]) => {
    const app = window.overdub, f = app.store.findClip(id), row = app.store.get().tracks.indexOf(f.track);
    const lw = document.querySelector('.ar-lanewrap').getBoundingClientRect(), sc = document.querySelector('.ar-scroll'), z = app.ui.state.zoom;
    return { x: lw.left + (f.clip.start + d) * z.pxPerBeat - sc.scrollLeft, y: lw.top + row * z.trackH - sc.scrollTop + z.trackH / 2 };
  }, [clipId, dx]);
  const bass = await E(() => { const t = window.overdub.store.get().tracks.find((x) => x.name === 'Bass'); return { id: t.id, clip: t.clips[0].id, start: t.clips[0].start, length: t.clips[0].length, n: t.clips.length }; });
  pt = await clipAt(bass.clip);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.waitForTimeout(150);
  const cm = await items();
  T.ok(['Repeat ×2', 'Repeat ×4', 'Split at playhead'].every((l) => cm.some((x) => x.startsWith(l))), `the clip menu has Repeat ×2, Repeat ×4, Split at playhead (${cm.join(' | ')})`);
  await page.click('[role=menu] .ek-item:has-text("Repeat ×4")');
  await page.waitForTimeout(150);
  st = await E((id) => { const t = window.overdub.store.track(id); return { starts: t.clips.map((c) => c.start).join(), by: window.overdub.store.history.at(-1).by }; }, bass.id);
  tt = await toast();
  const want = [1, 2, 3].map((k) => bass.start + k * bass.length);
  T.ok(st.starts.split(',').length === bass.n + 3 && want.every((b) => st.starts.split(',').map(Number).includes(b)) && st.by === 'you' && /^Repeated .* ×4: 3 copies end to end/.test(tt), `Repeat ×4: three copies end to end (clips at ${st.starts}); "${tt}"`);
  await E(() => window.overdub.store.undo());

  // ⌘E splits the selected clip at the playhead (a click on the clip selects it)
  pt = await clipAt(bass.clip, 1);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(120);
  await E((b) => window.overdub.engine.seek(b), bass.start + 4);
  await page.waitForTimeout(80);
  h0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press(SPLIT);
  await page.waitForTimeout(150);
  st = await E((id) => { const t = window.overdub.store.track(id); return { clips: t.clips.map((c) => `${c.start}+${c.length}`).join(), n: window.overdub.store.history.length, sel: window.overdub.ui.state.selection.clip }; }, bass.id);
  tt = await toast();
  T.ok(st.n === h0 + 1 && st.clips.split(',').length === bass.n + 1 && st.clips.includes(`${bass.start}+4,${bass.start + 4}+${bass.length - 4}`) && /^Split .* at bar \d+/.test(tt), `⌘E splits the selected clip at the playhead (${st.clips}); "${tt}"`);
  await E(() => window.overdub.store.undo());
  // with the playhead elsewhere it says so and changes nothing
  await E(() => window.overdub.engine.seek(1000));
  h0 = await E(() => window.overdub.store.history.length);
  await E((c) => window.overdub.arranger.splitClip(c), bass.clip);
  await page.waitForTimeout(100);
  T.ok((await E(() => window.overdub.store.history.length)) === h0 && /playhead isn’t over/.test(await toast()), `away from the clip, split says where the playhead is: "${await toast()}"`);
  await E(() => window.overdub.engine.seek(0));

  // ⌘E at the playhead cuts on the snap grid (1/16 here), not at the raw beat the playhead stopped on
  await E(([id, b]) => {
    const o = window.overdub, f = o.store.findClip(id);
    o.ui.select({ track: f.track.id, clip: id, notes: [] }); o.arranger.selectClips([id]); document.querySelector('.ar-scroll').focus();
    o.ui.state.snap = 0.25; o.engine.seek(b);
  }, [bass.clip, bass.start + 2.37]);
  await page.waitForTimeout(80);
  await page.keyboard.press(SPLIT);
  await page.waitForTimeout(150);
  st = await E((id) => window.overdub.store.track(id).clips.map((c) => `${c.start}+${c.length}`).join(), bass.id);
  tt = await toast();
  T.ok(st.includes(`${bass.start}+2.25,${bass.start + 2.25}+${bass.length - 2.25}`) && /at bar \d+, beat 3\.25:/.test(tt), `⌘E snaps the cut to the grid: playhead at +2.37, cut at +2.25 (${st}); "${tt}"`);
  await E(() => window.overdub.store.undo());
  // after Repeat ×2 two clips are selected: ⌘E splits the one under the playhead
  await E((id) => { window.overdub.arranger.repeatClip(id, 2); }, bass.clip);
  await page.waitForTimeout(100);
  const nsel = await E(() => window.overdub.arranger.selectedClips().length);
  await E((b) => { window.overdub.engine.seek(b); document.querySelector('.ar-scroll').focus(); }, bass.start + 4);
  h0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press(SPLIT);
  await page.waitForTimeout(150);
  st = await E((id) => ({ n: window.overdub.store.history.length, clips: window.overdub.store.track(id).clips.map((c) => `${c.start}+${c.length}`).join() }), bass.id);
  T.ok(nsel === 2 && st.n === h0 + 1 && st.clips.includes(`${bass.start}+4,${bass.start + 4}+${bass.length - 4}`), `with Repeat's two clips selected, ⌘E splits the one under the playhead (${nsel} selected; ${st.clips})`);
  await E(() => { window.overdub.store.undo(); window.overdub.store.undo(); window.overdub.engine.seek(0); });

  /* ---------------------------------------------------------------- the section strip, by keyboard */
  // a Tab stop of its own: ←/→ pick a section (and its bars), ⌘D duplicates it, Shift+F10 its menu, F2 renames it
  const strip = await E(() => { const r = document.querySelector('.ar-rulerwrap'); return { tab: r.tabIndex, label: r.getAttribute('aria-label') || '' }; });
  T.ok(strip.tab === 0 && /arrow/i.test(strip.label) && /Shift\+F10/.test(strip.label), `the section strip is a Tab stop that says its keys ("${strip.label}")`);
  // Tab order: Shift+Tab from the lanes' first stop reaches it (no pointer)
  await E(() => { window.overdub.ui.select({ clip: null, range: null, notes: [] }); window.overdub.arranger.selectClips([]); document.querySelector('.ar-secadd').focus(); });
  await page.keyboard.press('Tab');
  T.ok(await E(() => document.activeElement === document.querySelector('.ar-rulerwrap')), 'Tab from the Sections + lands on the section strip');
  const said = () => E(() => new Promise((r) => setTimeout(() => r(document.querySelector('.ar .sr-only[aria-live]')?.textContent || ''), 80)));
  await page.keyboard.press('ArrowRight');
  const k1 = await E(() => ({ range: window.overdub.ui.state.selection.range, secs: window.overdub.store.get().sections.map((s) => `${s.name}@${s.start}+${s.length}`) }));
  const s1 = await said();
  await page.keyboard.press('ArrowRight');
  const k2 = await E(() => window.overdub.ui.state.selection.range);
  const s2 = await said();
  T.ok(k1.range && k1.range.from === 0 && /^Section Verse, bars 1–4, 1 of 2\./.test(s1) && k2 && k2.from === 16 && /^Section Chorus, bars 5–8, 2 of 2\./.test(s2), `→ picks each section and selects its bars, and says which ("${s1}" then "${s2}")`);
  h0 = await E(() => window.overdub.store.history.length);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyD' : 'Control+KeyD');
  await page.waitForTimeout(200);
  st = await E(() => ({ n: window.overdub.store.history.length, secs: window.overdub.store.get().sections.map((x) => x.name).join() }));
  T.ok(st.n === h0 + 1 && /Chorus 2/.test(st.secs), `⌘D duplicates the section picked from the keyboard (${st.secs})`);
  await E(() => window.overdub.store.undo());
  await E(() => document.querySelector('.ar-rulerwrap').focus());
  // (the copy ⌘D made was selected, so the start marker and the stopped playhead went to its first bar, bar 9; with the
  // copy undone nothing is picked, so the first ← picks the last section before the playhead, Chorus, and the next Verse)
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(150);
  const km = await E(() => { const p = document.querySelector('.ek-pop[role=menu]'); return { open: !!p, head: p?.getAttribute('aria-label'), inside: !!p && p.contains(document.activeElement), items: p ? [...p.querySelectorAll('[role=menuitem]')].map((b) => b.textContent) : [] }; });
  T.ok(km.open && km.inside && km.head === 'Verse' && ['Duplicate', 'Insert bars after', 'Delete these bars'].every((l) => km.items.some((x) => x.startsWith(l))), `Shift+F10 on the strip opens the section's menu with focus in it (${km.head}: ${km.items.join(' | ')})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  T.ok(await E(() => !document.querySelector('.ek-pop') && document.activeElement === document.querySelector('.ar-rulerwrap')), 'Esc closes it and focus goes back to the strip');
  // Insert bars after, all by keyboard: the menu, ↓ to the item, Enter, then 1 bar
  pre = await snapshot();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(120);
  for (let i = 0; i < 8 && !(await E(() => /^Insert bars after/.test(document.activeElement?.textContent || ''))); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  st = await E(() => ({ secs: window.overdub.store.get().sections.map((x) => `${x.name}@${x.start}`).join(), by: window.overdub.store.history.at(-1).by }));
  T.ok(/Chorus@20/.test(st.secs) && st.by === 'you', `Insert bars after, from the keyboard: a bar after the Verse moves the Chorus to bar 6 (${st.secs})`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, '…and undo takes it out');
  // Delete these bars, by keyboard
  await E(() => document.querySelector('.ar-rulerwrap').focus());
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(120);
  await page.keyboard.press('End');
  const lastItem = await E(() => document.activeElement?.textContent || "");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  st = await E(() => window.overdub.store.get().sections.map((x) => x.name).join());
  T.ok(/^Delete these bars/.test(lastItem) && !/Verse/.test(st) && /^Deleted Verse \(bars 1–4\)/.test(await toast()), `Delete these bars, from the keyboard (${st}); "${await toast()}"`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, '…and undo brings them back');
  // F2 renames it; Enter puts focus back on the strip
  await E(() => document.querySelector('.ar-rulerwrap').focus());
  await page.keyboard.press('Home');
  await page.keyboard.press('F2');
  await page.waitForTimeout(80);
  const ren = await E(() => document.activeElement?.classList.contains('ar-secinput'));
  await page.keyboard.type('Intro');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  st = await E(() => ({ secs: window.overdub.store.get().sections.map((x) => x.name).join(), back: document.activeElement === document.querySelector('.ar-rulerwrap') }));
  T.ok(ren && /^Intro,/.test(st.secs) && st.back, `F2 renames the section, and focus comes back to the strip (${st.secs})`);
  await E(() => window.overdub.store.undo());
  // the clip and track menus reach the section too (the lanes' Shift+F10)
  await E((id) => { const f = window.overdub.store.findClip(id); window.overdub.ui.select({ track: f.track.id, clip: id, notes: [] }); window.overdub.arranger.selectClips([id]); document.querySelector('.ar-scroll').focus(); }, bass.clip);
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(120);
  const cm2 = await items();
  const secItem = cm2.find((x) => /^Section Verse…/.test(x));
  if (secItem) { await page.click('[role=menu] .ek-item:has-text("Section Verse")'); await page.waitForTimeout(120); }
  const sub2 = await E(() => ({ head: document.querySelector('.ek-pop[role=menu]')?.getAttribute('aria-label'), items: [...document.querySelectorAll('.ek-pop [role=menuitem]')].map((b) => b.textContent) }));
  T.ok(!!secItem && sub2.head === 'Verse' && sub2.items.some((x) => x.startsWith('Delete these bars')), `the clip menu has the section under it ("${secItem}" → ${sub2.items.length} items)`);
  await page.keyboard.press('Escape');

  // the inspector's buttons
  await E((x) => { const f = window.overdub.store.findClip(x); window.overdub.ui.select({ track: f.track.id, clip: x, notes: [] }); window.overdub.ui.show('inspector'); }, bass.clip);
  await page.waitForTimeout(250);
  const ib = await page.$$eval('[data-panel="inspector"] [data-act^="clip-"]', (els) => els.map((e) => e.dataset.act));
  T.ok(ib.includes('clip-repeat') && ib.includes('clip-split'), `the inspector has Repeat ×2 and Split at playhead (${ib.join(', ')})`);
  h0 = await E(() => window.overdub.store.history.length);
  await page.click('[data-panel="inspector"] [data-act="clip-repeat"]');
  await page.waitForTimeout(150);
  st = await E((id) => ({ n: window.overdub.store.track(id).clips.length, h: window.overdub.store.history.length }), bass.id);
  T.ok(st.n === bass.n + 1 && st.h === h0 + 1, 'Repeat ×2 in the inspector adds one copy in one step');
  await E(() => window.overdub.store.undo());

  /* ---------------------------------------------------------------- the agent tool */
  const run = (input, by = 'claude') => E(([i, b]) => window.overdub.tools.run('arrange_song', i, { by: b }), [input, by]);
  const schema = await E(() => window.overdub.tools.schemas().find((t) => t.name === 'arrange_song'));
  T.ok(schema && schema.input_schema.properties.op.enum.length === 5, 'arrange_song is registered with its five ops');
  pre = await snapshot();
  h0 = await E(() => window.overdub.store.history.length);
  const a1 = await run({ op: 'duplicate_section', section: 'Chorus', reason: 'the song needs a second chorus' });
  const last = await E(() => { const h = window.overdub.store.history.at(-1); return { n: window.overdub.store.history.length, by: h.by, label: h.label, reason: h.reason }; });
  T.ok(a1.ok && last.n === h0 + 1 && last.by === 'claude' && last.label === 'duplicate Chorus' && last.reason === 'the song needs a second chorus', `duplicate_section: one step signed by the agent ("${a1.summary}")`);
  T.ok(a1.moved?.section === 'Chorus 2' && a1.moved.clips_copied > 0 && a1.created?.section && a1.created.clips.length === a1.moved.clips_copied, `it says what moved: ${JSON.stringify(a1.moved)}`);
  const signed = await E((ids) => ids.map((id) => window.overdub.store.findClip(id)?.clip.by), a1.created.clips);
  T.ok(signed.length && signed.every((b) => b === 'claude'), 'the copied clips are the agent\'s');
  await E(() => window.overdub.tools.run('undo', {}, { by: 'claude' }));
  T.ok((await snapshot()) === pre, 'the agent\'s undo puts it back exactly');
  const a2 = await run({ op: 'insert_bars', bar: 5, bars: 2 });
  T.ok(a2.ok && a2.moved.beats === 8 && a2.moved.at_beat === 16 && /^Inserted 2 bars at bar 5/.test(a2.summary), `insert_bars: "${a2.summary}"`);
  await E(() => window.overdub.store.undo());
  const a3 = await run({ op: 'remove_bars', section: 'Chorus' });
  T.ok(a3.ok && a3.moved.sections_removed === 1 && /^Deleted 4 bars from bar 5/.test(a3.summary), `remove_bars by section: "${a3.summary}"`);
  await E(() => window.overdub.store.undo());
  const a4 = await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 3 });
  T.ok(a4.ok && a4.created?.clips?.length === 2 && a4.moved.new_clips.length === 2, `repeat_clip: "${a4.summary}"`);
  await E(() => window.overdub.store.undo());
  const a5 = await run({ op: 'split_clip', clip: bass.clip, beat: bass.start + 2 });
  T.ok(a5.ok && a5.created?.clip && typeof a5.moved.notes_before === 'number', `split_clip: "${a5.summary}"`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, 'after undoing each, the song is as it was');
  const e1 = await run({ op: 'duplicate_section', section: 'Bridge' });
  const e2 = await run({ op: 'split_clip', clip: bass.clip, bar: 99 });
  const e3 = await run({ op: 'fold' });
  T.ok(e1.error && /sections/.test(e1.error) && e1.hint && e2.error && /isn't inside/.test(e2.error) && e3.error && (await snapshot()) === pre, `mistakes come back as { error, hint } and change nothing ("${e1.error}" / "${e2.error}")`);
  // apply_ops takes the ops too (signed by the agent)
  const a6 = await E(() => window.overdub.tools.run('apply_ops', { ops: [{ type: 'time.insert', at: 0, length: 4 }], label: 'a bar of count-in', reason: 'room to breathe' }, { by: 'claude' }));
  T.ok(a6.ok && (await E(() => window.overdub.store.history.at(-1).by)) === 'claude', 'apply_ops accepts time.insert, signed by the agent');
  await E(() => window.overdub.store.undo());
  // an outside agent can't freeze the tab: loop ×64 three times (5,242,880 notes on the demo's bass before the limits)
  const n0 = await E(() => window.overdub.store.history.length);
  const t1 = Date.now();
  const amp = await E((c) => window.overdub.tools.run('apply_ops', { ops: Array(3).fill({ type: 'clip.repeat', track: 'Bass', clip: c, times: 64, mode: 'loop' }), label: 'longer' }, { by: 'mcp:evil' }), bass.clip);
  T.ok(amp.error && amp.nothing_changed && /up to/.test(amp.error) && (await snapshot()) === pre && (await E(() => window.overdub.store.history.length)) === n0 && Date.now() - t1 < 3000, `apply_ops with loop ×64 three times comes back an error, nothing changed, in ${Date.now() - t1} ms: "${(amp.error || '').slice(0, 120)}"`);
  const amp2 = await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 64, mode: 'loop' }, 'mcp:evil');
  const amp3 = amp2.ok ? await run({ op: 'repeat_clip', track: 'Bass', clip: bass.clip, times: 64, mode: 'loop' }, 'mcp:evil') : amp2;
  T.ok(amp3.error && /up to/.test(amp3.error) && /smaller step/.test(amp3.hint || ''), `arrange_song can't stack loops past the limits either: "${(amp3.error || '').slice(0, 120)}"`);
  if (amp2.ok) await E(() => window.overdub.store.undo());
  const huge = await E(() => window.overdub.tools.run('arrange_song', { op: 'insert_bars', bar: 1, bars: 1e9 }, { by: 'mcp:evil' }));
  T.ok(huge.error && /runs up to beat/.test(huge.error) && (await snapshot()) === pre, `insert_bars of a billion bars is refused: "${(huge.error || '').slice(0, 100)}"`);

  // …and an outside agent's arrangement op through apply_ops flashes what it moved and says what it did, not its type
  const viaOps = (ops) => E(async (o) => {
    const app = window.overdub, { touched } = await import('/app/src/ui/arrange-kit.js'), { opsSummary } = await import('/app/src/agent/diff.js');
    let tch = null;
    const off = app.store.on('change', (e) => { if (e.kind === 'do' && app.store.isAgent(e.by)) tch = touched(e); });
    const r = await app.tools.run('apply_ops', { ops: o, label: 'room' }, { by: 'mcp:x' });
    off();
    const h = app.store.history.at(-1) || {};
    return { r, clips: tch ? [...tch.clips] : [], sections: tch ? [...tch.sections] : [], reason: h.reason, row: opsSummary(h.ops, app.store.get()) };
  }, ops);
  const moved = await E(() => window.overdub.store.get().tracks.flatMap((t) => t.clips.filter((c) => c.start >= 8).map((c) => c.id)));
  const o1 = await viaOps([{ type: 'time.insert', at: 8, length: 4 }]);
  T.ok(o1.r.ok && moved.length && moved.every((id) => o1.clips.includes(id)) && moved.every((id) => o1.r.targets.clips.includes(id)), `apply_ops time.insert flashes and targets the ${moved.length} clips it moved`);
  T.ok(o1.r.summary === 'inserted 1 bar at bar 3' && /^Inserted 1 bar at bar 3/.test(o1.reason) && o1.row === o1.r.summary, `…and its summary, reason and history row say what moved ("${o1.r.summary}" / "${o1.reason}")`);
  await E(() => window.overdub.store.undo());
  const o2 = await viaOps([{ type: 'clip.repeat', track: bass.id, clip: bass.clip, times: 3 }]);
  T.ok(o2.r.ok && o2.r.created.clips?.length === 2 && o2.r.created.clip === o2.r.created.clips[0] && o2.r.created.clips.every((id) => o2.clips.includes(id)), `apply_ops clip.repeat lists both copies in created.clips and flashes them (${o2.r.summary})`);
  await E(() => window.overdub.store.undo());
  const o3 = await viaOps([{ type: 'clip.split', track: bass.id, clip: bass.clip, at: bass.start + 2 }]);
  T.ok(o3.r.ok && o3.clips.includes(bass.clip) && o3.clips.includes(o3.r.created.clip) && /^split Walk at /.test(o3.r.summary), `apply_ops clip.split flashes both halves ("${o3.r.summary}")`);
  await E(() => window.overdub.store.undo());
  const o4 = await viaOps([{ type: 'section.duplicate', section: 'Chorus', push: true }]);
  T.ok(o4.r.ok && o4.sections.includes(o4.r.created.section) && o4.r.summary === 'copied Chorus', `apply_ops section.duplicate flashes the new section ("${o4.r.summary}")`);
  await E(() => window.overdub.store.undo());
  T.ok((await snapshot()) === pre, 'after undoing those, the song is as it was');
  // the agent feed's chip for arrange_song is the plan's line, pointing at what it moved; a misspelt op names the new ones
  const chip = await E(async (b) => {
    const app = window.overdub, { chipFor } = await import('/app/src/agent/tools.js');
    const r = await app.tools.run('arrange_song', { op: 'repeat_clip', clip: b.clip, track: b.id, times: 2 }, { by: 'claude' });
    const c = chipFor(app, 'arrange_song', {}, r);
    app.store.undo();
    return { c, created: r.created };
  }, bass);
  T.ok(chip.c.icon === '✎' && /^repeated Walk ×2/.test(chip.c.text) && chip.c.target?.clips.includes(chip.created.clips[0]), `the arrange_song chip reads "${chip.c.text}", not the tool's name`);
  const typo = await E(() => window.overdub.tools.run('apply_ops', { ops: [{ type: 'time.insrt', at: 0, length: 4 }], label: 'typo' }, { by: 'claude' }));
  T.ok(typo.error && ['section.duplicate', 'time.insert', 'time.remove', 'clip.repeat', 'clip.split'].every((x) => typo.hint.includes(x)) && /arrange_song/.test(typo.hint), 'a misspelt op type is told the arrangement ops exist');

  const bad = errors.filter((e) => !/Failed to load resource|favicon|net::ERR|fonts\.g/.test(e));
  T.ok(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  await close();
}

T.done();
