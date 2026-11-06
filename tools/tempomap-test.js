// The tempo map [tempomap]: a song's grid bent to a recording (core/music.js "The tempo map", docs/ARCHITECTURE.md).
//   1. Node (test/unit/tempomap.test.js, but the renders): the normaliser keeps a good map, drops a bad one whole (with a warning) and never repairs one; the shared
//      conversions round-trip to 1e-9 s; without a map every conversion is the old expression; tempo is the map's
//      nominal tempo and project.set { tempo } is refused on a mapped song; tempo.map undoes and redoes exactly;
//      time.insert / time.remove carry the map with the recording; section.duplicate over a mapped span is refused;
//      shiftMap moves the grid with its recording; the MIDI export writes a tempo per segment that reads back within a
//      tick; the DAWproject export writes the map as tempo automation; a constant map renders bit for bit as the same
//      song without one; the flip:tempo-map golden scene's drum hits land on the recording's clicks.
//   2. Chromium (QUIET: muted): the browser's offline render of flip:tempo-map against the Node one; a constant map
//      against no map; the live transport's notes on a map, across segment boundaries, a loop wrap and a seek.
//   node tools/tempomap-test.js
import { open, tally } from './pw.js';
import { mapSec } from '../app/src/core/music.js';
import { renderSong } from '../app/src/engine/node/render.js';
import { sha256 } from '../app/src/engine/node/io.js';
import { tempoMapScene, CLICK_KERNEL } from './golden-scenes.js';

const T = tally('tempomap');
const ok = T.ok;
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ renders (R2, R3, R4) in Node */
const scene = tempoMapScene();
function constantPair() {
  // the scene's song at one tempo: once plain, once with a map that says the same tempo at every bar
  const plain = clone(scene.project);
  delete plain.tempoMap;
  plain.tempo = 96;
  const mapped = clone(plain);
  mapped.tempoMap = { anchors: Array.from({ length: 9 }, (_, k) => ({ beat: 4 * k, sec: (4 * k * 60) / 96 })) };
  return { plain, mapped };
}
{
  const { plain, mapped } = constantPair();
  const a = renderSong(plain, { ...scene.opts, assets: scene.assets }), b = renderSong(mapped, { ...scene.opts, assets: scene.assets });
  ok(a.length === b.length && sha256(a) === sha256(b), `a constant map renders bit for bit as the same song without one (Node, ${sha256(a).slice(0, 12)})`);
  const c = renderSong(plain, { from: 5, to: 30, assets: scene.assets }), d = renderSong(mapped, { from: 5, to: 30, assets: scene.assets });
  ok(sha256(c) === sha256(d), 'and from mid-song too (from beat 5)');
  const r = renderSong(scene.project, { ...scene.opts, assets: scene.assets, tracks: ['Drums'] });
  const L = r.channels[0];
  let worst = 0;
  for (const f of scene.clicks) { let g = Math.max(0, f - 8); while (g < L.length && Math.abs(L[g]) < 0.2) g++; worst = Math.max(worst, Math.abs(g - f)); }
  ok(!r.warnings.length && worst <= 1, `flip:tempo-map: every one of ${scene.clicks.length} drum hits lands within a sample of its click on the 92 -> 96 BPM recording (worst ${worst})`);
  const flat = clone(scene.project); delete flat.tempoMap; flat.tempo = 94;
  const off = renderSong(flat, { ...scene.opts, assets: scene.assets, tracks: ['Drums'] }).channels[0];
  let late = 0;
  for (const f of scene.clicks) { let g = Math.max(0, f - 20000); while (g < off.length && Math.abs(off[g]) < 0.2) g++; late = Math.max(late, Math.abs(g - f)); }
  ok(late > 1000, `without the map the same hits drift off the clicks (by up to ${(late / 48).toFixed(0)} ms)`);
}

/* ------------------------------------------------------------------ Chromium */
const { page, errors, close } = await open('/tools/engine-test.html');
try {
  const b64 = (f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
  const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const browserRender = (project, opts) => page.evaluate(async ({ project, opts, assets }) => {
    const { renderProject } = await import('/app/src/engine/render.js');
    const { cleanProject } = await import('/app/src/core/project.js');
    const reg = await import('/app/src/devices/registry.js');
    for (const d of Object.values(project.devices || {})) reg.defineDevice({ ...d, source: 'project' }, { replace: true });
    const dec = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Float32Array(u.buffer); };
    const bufs = {};
    for (const [k, a] of Object.entries(assets)) {
      const ch = a.channels.map(dec);
      const ab = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: a.sr });
      ch.forEach((c, i) => ab.copyToChannel(c, i));
      bufs[k] = ab;
    }
    const report = [];
    const buf = await renderProject(cleanProject(project), { ...opts, assets: { get: async (id) => bufs[id] || null }, report: (e) => report.push(e) });
    const enc = (f) => { const u = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    return { report, len: buf.length, ch: [enc(buf.getChannelData(0)), enc(buf.getChannelData(1))] };
  }, { project, opts, assets: Object.fromEntries(Object.entries(scene.assets).map(([k, a]) => [k, { sr: a.sr, channels: a.channels.map(b64) }])) });
  const compare = (out, r) => {
    let diff = 0, worst = 0;
    const ch = out.ch.map(unb64);
    for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(ch[c].length, r.channels[c].length); i++) { const d = Math.abs(ch[c][i] - r.channels[c][i]); if (d) { diff++; worst = Math.max(worst, d); } }
    return { diff, worst, db: worst ? 20 * Math.log10(worst) : -Infinity, len: out.len === r.length, ch };
  };
  {
    const node = renderSong(scene.project, { ...scene.opts, assets: scene.assets });
    const out = await browserRender(scene.project, scene.opts);
    const c = compare(out, node);
    ok(c.len && !out.report.length && c.db <= -90, `flip:tempo-map in Chromium against Node: ${c.diff ? `${c.diff} samples differ, at most ${c.db.toFixed(1)} dBFS` : 'bit-identical'}`);
    const drums = await browserRender(scene.project, { ...scene.opts, tracks: ['t_drums'] });
    const nd = renderSong(scene.project, { ...scene.opts, assets: scene.assets, tracks: ['t_drums'] });
    const cd = compare(drums, nd);
    ok(cd.len && cd.diff === 0, `its drum part (a kernel on the map) is bit-identical in Chromium and Node${cd.diff ? ` (${cd.diff} samples differ)` : ''}`);
    let worst = 0;
    const L = cd.ch[0];
    for (const f of scene.clicks) { let g = Math.max(0, f - 8); while (g < L.length && Math.abs(L[g]) < 0.2) g++; worst = Math.max(worst, Math.abs(g - f)); }
    ok(worst <= 1, `in Chromium every drum hit lands within a sample of its click too (worst ${worst})`);
  }
  {
    const { plain, mapped } = constantPair();
    const a = await browserRender(plain, scene.opts), b = await browserRender(mapped, scene.opts);
    ok(a.len === b.len && a.ch[0] === b.ch[0] && a.ch[1] === b.ch[1], 'a constant map renders bit for bit as no map in Chromium too');
  }
  // live: the transport on a map. Short segments (one beat each, 150..260 BPM) so a few seconds cross many of them,
  // then a loop that wraps across them, then a seek into the middle of one
  const live = await page.evaluate(async ({ kernel }) => {
    const E = await import('/app/src/engine/engine.js');
    const S = await import('/app/src/core/store.js');
    const R = await import('/app/src/devices/registry.js');
    R.defineDevice({ ...kernel, source: 'project' }, { replace: true });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const anchors = [{ beat: 0, sec: 0 }];
    for (let k = 0; k < 16; k++) anchors.push({ beat: k + 1, sec: anchors[k].sec + 60 / [150, 260, 180, 220, 200, 240, 170, 250][k % 8] });
    const notes = [];
    for (let i = 0; i < 64; i++) notes.push({ id: 'n' + i, p: 60 + (i % 4), t: i / 4, d: 0.1, v: 0.8 });
    const song = (loop) => ({ format: 'overdub/0', id: 'p_map', title: 'map', tempo: 200, meter: [4, 4], key: null, loop, tempoMap: { anchors }, sections: [], assets: {}, master: { gain: 0, inserts: [] }, meta: {},
      devices: { [kernel.id]: kernel },
      tracks: [{ id: 't_a', name: 'A', kind: 'instrument', instrument: { device: kernel.id, params: {} }, inserts: [], clips: [{ id: 'c_a', kind: 'notes', start: 0, length: 16, notes }], gain: 0, pan: 0, mute: false, solo: false }] });
    const run = async (loop, from, secs, seekTo = null) => {
      const store = S.createStore(song(loop));
      const engine = E.createEngine(store);
      await engine.start();
      await engine.settled();
      const inst = engine.instance('t_a', 'instrument');
      const ons = [];
      const on0 = inst.noteOn;
      inst.noteOn = (p, v, t, x) => { ons.push(t); return on0.call(inst, p, v, t, x); };
      await engine.play(from);
      const c0 = engine.ctx.currentTime, w0 = performance.now();
      let sought = null;
      while (engine.ctx.currentTime < c0 + secs && performance.now() - w0 < 15000) {
        await sleep(10);
        if (seekTo != null && sought == null && engine.ctx.currentTime > c0 + secs / 2) { sought = ons.length; engine.seek(seekTo); }
      }
      const beat = engine.beat, bpm = engine.clock.bpm();
      engine.stop();
      await engine.dispose();
      return { ons, sought, beat, bpm };
    };
    return {
      straight: await run({ on: false, start: 0, end: 16 }, 0, 2.2),
      loop: await run({ on: true, start: 1.5, end: 4.5 }, 1.5, 3.2),
      seek: await run({ on: false, start: 0, end: 16 }, 0, 2.4, 6.3),
      anchors,
    };
  }, { kernel: CLICK_KERNEL });
  const LA = live.anchors, at = (b) => mapSec(LA, b);
  const steps = (ons, beats) => ons.slice(1).map((t, i) => Math.abs((t - ons[i]) - (at(beats[i + 1]) - at(beats[i]))));
  {
    const n = live.straight.ons.length, beats = Array.from({ length: n }, (_, i) => i / 4);
    const err = steps(live.straight.ons, beats);
    ok(n >= 12 && Math.max(...err) < 1.5 / 48000, `live: ${n} notes on a map of one-beat segments (150..260 BPM) land where the map says, across ${Math.floor(beats[n - 1])} segment boundaries (worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
  }
  {
    // the loop: 1.5 .. 4.5, wrapping back; the beats it plays are 1.5, 1.75, ... 4.25, then 1.5 again
    const pass = Array.from({ length: 12 }, (_, i) => 1.5 + i / 4);
    const n = live.loop.ons.length, beats = Array.from({ length: n }, (_, i) => pass[i % 12]);
    const err = live.loop.ons.slice(1).map((t, i) => {
      const a = beats[i], b = beats[i + 1];
      const want = b > a ? at(b) - at(a) : at(4.5) - at(a) + (at(b) - at(1.5));
      return Math.abs(t - live.loop.ons[i] - want);
    });
    ok(n > 12 && Math.max(...err) < 1.5 / 48000, `live: a loop across map segments wraps sample-accurately (${n} notes, ${Math.floor(n / 12)} wraps, worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
  }
  {
    const s = live.seek, after = s.ons.slice(s.sought);
    // after the seek to 6.3: the note at 6.25 still sounding there is chased (it starts at 6.3), then 6.5, 6.75, ...
    const beats = Array.from({ length: after.length }, (_, i) => (i ? 6.25 + i / 4 : 6.3));
    const err = steps(after, beats);
    ok(s.sought != null && after.length >= 4 && Math.max(...err) < 1.5 / 48000, `live: after a seek into the middle of a segment the notes follow the map (${after.length} notes, the held one chased, worst ${(Math.max(...err) * 1e6).toFixed(1)} µs)`);
    ok(Math.abs(s.bpm - 60 / (at(Math.floor(s.beat) + 1) - at(Math.floor(s.beat)))) < 1e-6, `the live clock's bpm() is the segment's tempo where the song is (${s.bpm.toFixed(2)} at beat ${s.beat.toFixed(2)})`);
  }
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally { await close(); }
T.done();
