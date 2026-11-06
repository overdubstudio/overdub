// ui/provenance.js (the report: who played what, the devices agents wrote, the session's history) and
// core/dawproject.js (the .dawproject zip), in Node. Moved from tools/provenance-test.js sections 1 and 2.
import { test } from 'node:test';
import { createStore } from '../../app/src/core/store.js';
import { demoProject } from '../../app/src/core/demo.js';
import * as registry from '../../app/src/devices/registry.js';
import '../../app/src/devices/builtin/index.js';
import '../../app/src/devices/library/index.js';
import { provenanceModel, provenanceHtml, normCheck } from '../../app/src/ui/provenance.js';
import { dawprojectFiles, dawprojectXml, inkOf } from '../../app/src/core/dawproject.js';
import { zipStore, encodeWav } from '../../app/src/ui/export.js';
import { T } from './_t.js';
import { unzip, parseXml, kids, kid, all } from './_xml.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ a song with every kind of author */
const KERNEL = `({ create({ sr, seed, dsp }) { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.5; } } }; } })`;
function richSong() {
  const p = demoProject();
  p.title = 'Night Shift <take 2> & "friends"';
  const bass = p.tracks.find((t) => /bass/i.test(t.name));
  bass.clips[0].notes.slice(0, 5).forEach((n) => {
    n.by = 'you';
  });
  bass.clips[0].notes.slice(5, 8).forEach((n) => {
    n.by = 'mcp:cursor';
  });
  bass.mute = true;
  bass.solo = false;
  p.tracks.push({
    id: 't_mine01',
    name: 'My hum <script>alert(1)</script>',
    color: 'var(--c-3)',
    kind: 'instrument',
    instrument: { device: 'core.keys', params: {} },
    inserts: [{ id: 'fx_half01', device: 'you.half', on: true, params: {}, by: 'you' }],
    clips: [
      {
        id: 'c_mine01',
        kind: 'notes',
        start: 4,
        length: 4,
        by: 'you',
        notes: [
          { id: 'n1', p: 69, t: 0, d: 1, v: 0.8, by: 'you' },
          { id: 'n2', p: 72, t: 1, d: 1, v: 0.8, by: 'you' },
          { id: 'n3', p: 76, t: 2, d: 3, v: 0.7, by: 'claude' }, // runs past the clip: sounds for 2 beats
          { id: 'n4', p: 79, t: 6, d: 1, v: 0.7, by: 'claude' },
        ],
      },
    ], // starts after the clip: never sounds
    gain: -6,
    pan: -0.5,
    mute: false,
    solo: true,
    arm: false,
    by: 'you',
  });
  p.tracks.push({
    id: 't_audio1',
    name: 'Guitar DI',
    color: '#335577',
    kind: 'audio',
    instrument: null,
    inserts: [],
    clips: [
      {
        id: 'c_aud001',
        kind: 'audio',
        start: 8,
        length: 8,
        asset: 'a_take01',
        offset: 0.5,
        gain: -2,
        name: 'Take 1',
        by: 'you',
      },
    ],
    gain: 2,
    pan: 0.2,
    mute: false,
    solo: false,
    arm: true,
    by: 'you',
  });
  p.assets = { a_take01: { kind: 'audio', name: 'Take 1', sr: 48000, channels: 1, duration: 10 } };
  p.devices['you.half'] = {
    id: 'you.half',
    name: 'Half Measure',
    kind: 'effect',
    cat: 'utility',
    blurb: 'half the level',
    params: [],
    look: { color: '#334455' },
    kernel: KERNEL,
    by: 'you',
    version: 2,
    created: '2026-09-01T00:00:00.000Z',
  };
  p.meta.authors = {
    ...p.meta.authors,
    you: { kind: 'human', name: 'You' },
    'mcp:cursor': { kind: 'agent', name: 'cursor' },
  };
  p.meta.forkedFrom = {
    title: 'Night Shift (AJ’s)',
    authors: [
      { name: 'AJ', kind: 'human' },
      { name: 'Claude', kind: 'agent' },
    ],
    at: '2026-09-30T20:00:00.000Z',
    id: 'p_orig01',
  };
  return p;
}

// what the report should say, counted straight from the song
function expected(p) {
  const by = {},
    tracks = {};
  let total = 0,
    beats = 0;
  for (const t of p.tracks) {
    const per = (tracks[t.id] = {});
    for (const c of t.clips) {
      if (c.kind === 'audio') {
        const k = c.by;
        by[k] = by[k] || { notes: 0, beats: 0, audioSecs: 0 };
        by[k].audioSecs += (c.length * 60) / p.tempo;
        continue;
      }
      for (const n of c.notes) {
        const k = n.by || 'unsigned';
        const s = n.t >= 0 && n.t < c.length ? Math.max(0, Math.min(n.d, c.length - n.t)) : 0;
        by[k] = by[k] || { notes: 0, beats: 0, audioSecs: 0 };
        by[k].notes++;
        by[k].beats += s;
        per[k] = per[k] || { notes: 0, beats: 0 };
        per[k].notes++;
        per[k].beats += s;
        total++;
        beats += s;
      }
    }
  }
  return { by, tracks, total, beats };
}

test('provenance report: numbers, devices, timeline, page', () => {
  const p = richSong();
  const store = createStore(p, { getDevice: registry.getDevice });
  store.addAuthor('mcp:cursor', { kind: 'agent', name: 'cursor' });
  const hum = 't_mine01';
  // a session: you add notes, Claude builds a device (with a reason), you nudge a knob three times, Claude tidies
  let r = store.dispatch(
    { type: 'notes.add', track: hum, clip: 'c_mine01', notes: 'C5@3:0.5' },
    { by: 'you', label: 'add notes' },
  );
  T.ok(r.ok, 'you add a note');
  r = store.dispatch(
    {
      type: 'device.define',
      device: {
        id: 'claude.glassbox',
        name: 'Glass Box',
        kind: 'effect',
        cat: 'space',
        blurb: 'a small bright room',
        request: 'A tiny glassy room for the hum, like singing into a jar.',
        params: [],
        kernel: KERNEL,
      },
    },
    { by: 'claude', label: 'built Glass Box', reason: 'you asked for a jar-sized room; this one is small and bright' },
  );
  T.ok(r.ok, 'Claude writes a device');
  r = store.dispatch(
    { type: 'insert.add', track: hum, insert: { device: 'claude.glassbox' } },
    { by: 'claude', label: 'add Glass Box', reason: 'on the hum, after Half Measure' },
  );
  T.ok(r.ok, 'Claude puts it on the hum');
  for (let i = 0; i < 3; i++)
    store.dispatch({ type: 'track.set', track: hum, patch: { gain: -6 + i } }, { by: 'you', label: 'track gain' });
  store.dispatch({ type: 'track.set', track: hum, patch: { pan: -0.4 } }, { by: 'you', label: 'track pan' });
  store.dispatch(
    { type: 'notes.set', track: hum, clip: 'c_mine01', notes: [{ id: 'n1', v: 0.6 }] },
    { by: 'mcp:cursor', label: 'softer downbeat', reason: 'the first note was louder than the rest' },
  );
  const hist = store.history;
  T.ok(hist.length === 8, `the session has 8 transactions (${hist.length})`);

  const song = store.get();
  const exp = expected(song);
  const checks = {
    'claude.glassbox': normCheck(
      {
        ok: true,
        kind: 'effect',
        level: { lufs: -20.3, deltaLU: 0.4 },
        truePeak: -4.2,
        tail: { seconds: 0.31 },
        cpu: { pct: 0.7 },
        deterministic: true,
        warnings: ['quiet at the default mix'],
      },
      'built',
      Date.parse('2026-10-01T10:00:00Z'),
    ),
  };
  const m = provenanceModel(song, {
    history: hist,
    author: (id) => store.author(id),
    getDevice: registry.getDevice,
    checks,
  });

  // the numbers
  T.ok(m.totals.notes === exp.total, `total notes ${m.totals.notes} = ${exp.total}`);
  T.ok(near(m.totals.beats, exp.beats, 0.01), `total sounding beats ${m.totals.beats} = ${exp.beats}`);
  let sumN = 0,
    sumB = 0,
    authorsOk = true;
  for (const [id, e] of Object.entries(exp.by)) {
    const a = m.authors.find((x) => x.id === id);
    if (!a || a.notes !== e.notes || !near(a.beats, e.beats, 0.01) || !near(a.audioSecs, e.audioSecs, 0.06)) {
      authorsOk = false;
      T.note(`author ${id}: ${JSON.stringify(a)} vs ${JSON.stringify(e)}`);
    }
    if (a) {
      if (!near(a.notesPct, Math.round((e.notes / exp.total) * 1000) / 10, 0.051)) {
        authorsOk = false;
        T.note(`${id} notes share ${a.notesPct}`);
      }
      if (!near(a.beatsPct, Math.round((e.beats / exp.beats) * 1000) / 10, 0.051)) {
        authorsOk = false;
        T.note(`${id} beats share ${a.beatsPct}`);
      }
      sumN += a.notesPct;
      sumB += a.beatsPct;
    }
  }
  T.ok(
    authorsOk,
    `every author's notes, beats, recorded seconds and shares match the song (${m.authors.map((a) => `${a.name} ${a.notes}/${a.notesPct}%`).join(', ')})`,
  );
  T.ok(
    Math.abs(sumN - 100) < 0.5 && Math.abs(sumB - 100) < 0.5,
    `shares add up to 100% (count ${sumN.toFixed(1)}, length ${sumB.toFixed(1)})`,
  );
  const you = m.authors.find((a) => a.id === 'you'),
    claude = m.authors.find((a) => a.id === 'claude'),
    cursor = m.authors.find((a) => a.id === 'mcp:cursor');
  T.ok(
    you.kind === 'human' && claude.kind === 'agent' && cursor.kind === 'agent' && cursor.name === 'cursor',
    'authors carry their kind and name (you human; Claude and cursor agents)',
  );
  T.ok(near(you.audioSecs, (8 * 60) / song.tempo, 0.06), `your recording counts: ${you.audioSecs} s`);
  T.ok(
    you.edits === 5 && claude.edits === 2 && cursor.edits === 1,
    `changes per author from the history (you ${you.edits}, Claude ${claude.edits}, cursor ${cursor.edits})`,
  );
  let tracksOk = true;
  for (const t of m.tracks) {
    for (const [id, e] of Object.entries(exp.tracks[t.id] || {})) {
      const sh = t.shares.find((s) => s.id === id);
      if (!sh || sh.notes !== e.notes || !near(sh.beats, e.beats, 0.01)) {
        tracksOk = false;
        T.note(`track ${t.name} / ${id}: ${JSON.stringify(sh)} vs ${JSON.stringify(e)}`);
      }
    }
  }
  T.ok(tracksOk, 'per-track shares match the song, track by track');
  const humT = m.tracks.find((t) => t.id === hum);
  const hc = humT.shares.find((s) => s.id === 'claude');
  T.ok(
    hc.notes === 2 && near(hc.beats, 2),
    `a note past the clip's end counts by length only as far as it sounds; one after it, not at all (Claude on the hum: ${hc.notes} notes, ${hc.beats} beats)`,
  );

  // devices
  const ag = m.devices.filter((d) => d.authorKind === 'agent');
  const gb = m.devices.find((d) => d.id === 'claude.glassbox');
  T.ok(
    gb &&
      gb.authorKind === 'agent' &&
      gb.request === 'A tiny glassy room for the hum, like singing into a jar.' &&
      /jar-sized/.test(gb.reason),
    'the device Claude wrote in the session appears with its request and reason',
  );
  T.ok(gb.check && gb.check.ok && gb.check.lufs === -20.3 && gb.check.source === 'built', 'with its check report');
  T.ok(
    gb.usedOn.length === 1 && gb.usedOn[0].placedBy === 'Claude',
    `and where it's used (${gb.usedOn.map((u) => u.track).join(', ')})`,
  );
  for (const id of ['claude.firefly', 'claude.night-bus', 'claude.tidal-cathedral']) {
    const d = m.devices.find((x) => x.id === id);
    T.ok(
      d && d.authorKind === 'agent' && d.request && d.request.length > 10,
      `${id}: written by an agent, its request kept (“${(d?.request || '').slice(0, 40)}…”)`,
    );
  }
  const half = m.devices.find((d) => d.id === 'you.half');
  T.ok(
    half && half.authorKind === 'human' && !ag.includes(half),
    'a device you wrote is listed as yours, not an agent’s',
  );

  // the timeline
  const runs = m.timeline.runs;
  T.ok(
    runs.length === 4 && runs.map((x) => x.by).join(',') === 'you,claude,you,mcp:cursor',
    `history collapses into runs by author (${runs.map((x) => `${x.name}×${x.count}`).join(', ')})`,
  );
  const gainItem = runs[2].items.find((i) => i.label === 'track gain');
  T.ok(
    gainItem && gainItem.n === 3 && runs[2].items.length === 2,
    'repeats of one change are counted within a run (track gain ×3, then track pan)',
  );
  T.ok(
    runs[1].items.every((i) => i.reason),
    'agent reasons travel with their changes',
  );

  // the page
  const html = provenanceHtml(m);
  T.ok(
    /not a legal opinion/.test(html) && /What it isn’t/.test(html),
    'the page says what it is and isn’t (“not a legal opinion”)',
  );
  T.ok(
    html.includes('Night Shift &lt;take 2&gt; &amp; &quot;friends&quot;') && !html.includes('<take 2>'),
    'the song title is escaped',
  );
  T.ok(
    !/<script/i.test(html) && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
    'a track name with a script tag is shown as text (no <script> anywhere)',
  );
  T.ok(
    /Content-Security-Policy[^>]+default-src 'none'/.test(html) && !/script-src/.test(html),
    'strict CSP: nothing runs',
  );
  {
    // its fonts come from the studio's own files (by URL in its tab, inline when saved), never from a font host
    const csp = (h) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(h)?.[1] || '';
    const byUrl = provenanceHtml(m, {
      fonts:
        "@font-face { font-family: 'Archivo'; src: url(https://overdubstudio.com/app/style/fonts/archivo/archivo-latin.woff2) format('woff2'); }",
      fontSrc: 'https://overdubstudio.com',
    });
    const odd = provenanceHtml(m, { fontSrc: "'unsafe-inline' https://fonts.gstatic.com" });
    T.ok(
      /font-src data:$/.test(csp(html)) &&
        /font-src https:\/\/overdubstudio\.com$/.test(csp(byUrl)) &&
        /font-src data:$/.test(csp(odd)) &&
        ![html, byUrl].some((x) => /googleapis|gstatic/.test(x)),
      `the report's policy takes fonts from data: or the studio's own origin, and nothing else (${csp(byUrl)})`,
    );
  }
  T.ok(
    html.includes('A tiny glassy room for the hum, like singing into a jar.') && html.includes('Glass Box'),
    'the agent device and its request are on the page',
  );
  T.ok(
    /LUFS/.test(html) && /quiet at the default mix/.test(html) && /passes/.test(html),
    'with its check report (passes, LUFS, the warning)',
  );
  T.ok(
    html.includes('Make my guitar sound like it') && html.includes('Something glassy that twinkles over the chorus'),
    'the demo’s agent devices show their requests too',
  );
  T.ok(
    html.includes('softer downbeat') && html.includes('the first note was louder than the rest') && html.includes('×3'),
    'history labels, reasons and collapsed repeats are on the page',
  );
  T.ok(
    html.includes('Night Shift (AJ’s)') && html.includes('p_orig01') && /Forked from/.test(html),
    'the fork is named',
  );
  T.ok(
    html.includes(`${you.notes}</td>`) && html.includes(`${you.notesPct}%`) && html.includes(`${claude.beatsPct}%`),
    'the page shows the same numbers as the model',
  );
  // Liner notes: a sleeve, not a stack of cards. Names are bylines in the paper inks; no side stripe, no numbered slate,
  // no tracked capitals; the credits are a dot-leader list; each section opens on a heavy rule
  {
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    const stripes = style.match(/border-left(-width)?:\s*\d+px|inset\s+\d+px\s+0\s+0/g) || [];
    const caps = style.match(/text-transform:\s*uppercase/g) || [];
    T.ok(
      !stripes.length && !caps.length && !/class="slate/.test(html) && !/border-radius:\s*[3-9]\d*px/.test(style),
      `the print draws no stripes, no tracked capitals, no boxed slates, no rounded cards (${stripes.length} stripes, ${caps.length} caps)`,
    );
    T.ok(
      /<span class="by k-agent">Claude<\/span>/.test(html) &&
        /\.by\.k-agent \{ color: var\(--ink-agent\)/.test(style) &&
        /--ink-agent: #085f92/.test(style) &&
        /--ink-human: #9a4400/.test(style),
      'names are bylines in the deep paper inks (#9a4400 warm, #085f92 cool)',
    );
    T.ok(
      /<ul class="credits"/.test(html) &&
        /<header class="sh"><h2>Who played what<\/h2>/.test(html) &&
        /<li class="run k-agent">/.test(html),
      'the cover carries the credits; sections open on a heavy-rule head; the timeline is a signed ledger',
    );
  }
  const plain = provenanceModel(demoProject(), { getDevice: registry.getDevice });
  T.ok(
    /Not forked/.test(provenanceHtml(plain)) && /No changes in this session yet/.test(provenanceHtml(plain)),
    'a fresh song: not forked, no session changes, said plainly',
  );
  // a song started from nothing: you hummed 5 notes and Band added 20 (signed by the house). None of it is demo content
  const fresh = createStore();
  const hummed = Array.from({ length: 5 }, (_, i) => ({ p: 60 + i, t: i, d: 1 }));
  const banded = Array.from({ length: 20 }, (_, i) => ({ p: 40 + (i % 5), t: i * 0.25, d: 0.25 }));
  fresh.dispatch(
    [
      { type: 'track.add', ref: 'm', track: { name: 'Hum' } },
      { type: 'clip.add', track: '$m', clip: { kind: 'notes', start: 0, length: 8, notes: hummed } },
    ],
    { by: 'you' },
  );
  fresh.dispatch(
    [
      { type: 'track.add', ref: 'b', track: { name: 'Band Bass' } },
      { type: 'clip.add', track: '$b', clip: { kind: 'notes', start: 0, length: 8, notes: banded } },
    ],
    { by: 'overdub' },
  );
  const fh = provenanceHtml(provenanceModel(fresh.get(), { getDevice: registry.getDevice }));
  T.ok(
    !/the demo|demo content/.test(fh) && /By count: you 20%, Overdub 80%/.test(fh) && /like Band/.test(fh),
    'Band’s parts in a song from scratch are Overdub’s, not “the demo”: ' + (/By count:[^.]*\./.exec(fh) || [''])[0],
  );
});

test('DAWproject: zip, project.xml, tracks, devices, notes, audio, markers', () => {
  const p = richSong();
  const sr = 48000,
    len = sr * 2;
  const ch = new Float32Array(len);
  for (let i = 0; i < len; i++) ch[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / sr);
  const wav = encodeWav({ sampleRate: sr, channels: [ch] }, { bits: 24 });
  const { files, warnings, counts } = dawprojectFiles(p, {
    getDevice: registry.getDevice,
    audio: { a_take01: wav },
    app: { name: 'Overdub', version: '0.1.0' },
  });
  T.ok(!warnings.length, `no warnings when every recording is there (${warnings.join('; ') || 'none'})`);
  const zip = zipStore(files);
  let entries = null;
  try {
    entries = unzip(zip);
  } catch (e) {
    T.note(e.message);
  }
  T.ok(
    entries && entries.has('project.xml') && entries.has('metadata.xml'),
    `the zip unzips: ${entries ? [...entries.keys()].join(', ') : 'no'}`,
  );
  const audioPath = [...entries.keys()].find((k) => k.startsWith('audio/') && k.endsWith('.wav'));
  T.ok(
    audioPath && Buffer.compare(Buffer.from(entries.get(audioPath)), Buffer.from(wav)) === 0,
    `the recording is embedded byte for byte (${audioPath})`,
  );
  let x = null,
    md = null;
  try {
    x = parseXml(new TextDecoder().decode(entries.get('project.xml')));
    md = parseXml(new TextDecoder().decode(entries.get('metadata.xml')));
  } catch (e) {
    T.note('xml: ' + e.message);
  }
  T.ok(
    x && x.name === 'Project' && x.attrs.version === '1.0' && kid(x, 'Application')?.attrs.name === 'Overdub',
    'project.xml parses: <Project version="1.0">, Application Overdub',
  );
  T.ok(
    md && kid(md, 'Title')?.text === p.title && /Overdub/.test(kid(md, 'Comment')?.text || ''),
    `metadata.xml: the title (${kid(md, 'Title')?.text}) and a comment`,
  );
  const tr = kid(x, 'Transport');
  T.ok(
    +kid(tr, 'Tempo').attrs.value === p.tempo && kid(tr, 'Tempo').attrs.unit === 'bpm',
    `tempo ${kid(tr, 'Tempo').attrs.value} bpm`,
  );
  T.ok(
    +kid(tr, 'TimeSignature').attrs.numerator === 4 && +kid(tr, 'TimeSignature').attrs.denominator === 4,
    'time signature 4/4',
  );
  // ids: unique, and every reference resolves
  const ids = new Set();
  let dup = 0;
  (function walk(el) {
    if (el.attrs.id) {
      if (ids.has(el.attrs.id)) dup++;
      ids.add(el.attrs.id);
    }
    el.children.forEach(walk);
  })(x);
  const refs = [];
  (function walk(el) {
    for (const k of ['destination', 'track']) if (el.attrs[k]) refs.push(el.attrs[k]);
    el.children.forEach(walk);
  })(x);
  T.ok(!dup && refs.every((r) => ids.has(r)), `${ids.size} ids, all unique; ${refs.length} references all resolve`);
  // tracks
  const tracks = kids(kid(x, 'Structure'), 'Track');
  T.ok(
    tracks.length === p.tracks.length + 1 &&
      tracks[tracks.length - 1].attrs.name === 'Master' &&
      kid(tracks[tracks.length - 1], 'Channel').attrs.role === 'master',
    `${tracks.length} tracks: the song's ${p.tracks.length} and the master`,
  );
  let mixOk = true;
  p.tracks.forEach((t, i) => {
    const el = tracks[i],
      chn = kid(el, 'Channel');
    const vol = +kid(chn, 'Volume').attrs.value,
      pan = +kid(chn, 'Pan').attrs.value,
      mute = kid(chn, 'Mute').attrs.value === 'true',
      solo = chn.attrs.solo === 'true';
    const ok =
      el.attrs.name === t.name &&
      el.attrs.color === inkOf(t.color) &&
      near(vol, 10 ** ((t.gain || 0) / 20), 1e-5) &&
      near(pan, ((t.pan || 0) + 1) / 2, 1e-6) &&
      mute === !!t.mute &&
      solo === !!t.solo &&
      chn.attrs.destination === kid(tracks[tracks.length - 1], 'Channel').attrs.id;
    if (!ok) {
      mixOk = false;
      T.note(`track ${t.name}: ${JSON.stringify(el.attrs)} vol ${vol} pan ${pan} mute ${mute} solo ${solo}`);
    }
  });
  T.ok(mixOk, 'every track: name, colour, volume (linear from dB), pan (normalized), mute, solo, routed to the master');
  // devices
  const devs = all(kid(x, 'Structure'), 'BuiltinDevice');
  const want = p.tracks.reduce((n, t) => n + (t.instrument ? 1 : 0) + t.inserts.length, 0) + p.master.inserts.length;
  T.ok(
    devs.length === want &&
      devs.every(
        (d) =>
          d.attrs.loaded === 'false' &&
          /^overdub:/.test(d.attrs.deviceID) &&
          /Overdub device/.test(d.attrs.comment) &&
          d.attrs.deviceName,
      ),
    `${devs.length} devices as named placeholders (loaded="false", deviceID overdub:<id>, a comment saying so)`,
  );
  const keysDev = devs.find((d) => d.attrs.deviceID === 'overdub:core.keys');
  T.ok(
    keysDev &&
      keysDev.attrs.deviceName === registry.getDevice('core.keys').name &&
      keysDev.attrs.deviceRole === 'instrument',
    `instruments carry their display name (${keysDev?.attrs.deviceName}) and role`,
  );
  T.ok(
    devs.some(
      (d) =>
        d.attrs.deviceID === 'overdub:claude.tidal-cathedral' &&
        /Written by Claude/.test(d.attrs.comment) &&
        d.attrs.deviceRole === 'audioFX',
    ),
    'an agent-written effect says who wrote it',
  );
  const bassDev = devs.find((d) => d.attrs.deviceID === 'overdub:core.bass');
  const cutoff = all(bassDev, 'RealParameter').find((q) => q.attrs.parameterID === 'cutoff');
  T.ok(
    cutoff && +cutoff.attrs.value === 900 && cutoff.attrs.unit === 'hertz',
    'placeholder parameters carry the settings (Capstan cutoff 900 Hz)',
  );
  // notes
  const laneOf = new Map(
    all(kid(x, 'Arrangement'), 'Lanes')
      .filter((l) => l.attrs.track)
      .map((l) => [l.attrs.track, l]),
  );
  T.ok(kid(kid(x, 'Arrangement'), 'Lanes').attrs.timeUnit === 'beats', 'the arrangement is in beats');
  let notesOk = true,
    nNotes = 0;
  p.tracks.forEach((t, i) => {
    const lane = laneOf.get(tracks[i].attrs.id);
    const clips = kids(kid(lane, 'Clips'), 'Clip');
    const noteClips = t.clips.filter((c) => c.kind === 'notes').sort((a, b) => a.start - b.start);
    const xNoteClips = clips.filter((c) => kid(c, 'Notes'));
    if (xNoteClips.length !== noteClips.length) {
      notesOk = false;
      T.note(`${t.name}: ${xNoteClips.length} note clips vs ${noteClips.length}`);
      return;
    }
    noteClips.forEach((c, j) => {
      const xc = xNoteClips[j];
      const want = c.notes.filter((n) => n.t >= 0 && n.t < c.length && n.d > 0).sort((a, b) => a.t - b.t || a.p - b.p);
      const got = kids(kid(xc, 'Notes'), 'Note');
      nNotes += got.length;
      if (+xc.attrs.time !== c.start || +xc.attrs.duration !== c.length || got.length !== want.length) {
        notesOk = false;
        T.note(
          `${t.name} clip ${j}: ${xc.attrs.time}/${xc.attrs.duration} ${got.length} notes vs ${c.start}/${c.length} ${want.length}`,
        );
        return;
      }
      want.forEach((n, k) => {
        const g = got[k].attrs;
        if (
          +g.key !== n.p ||
          !near(+g.time, n.t) ||
          !near(+g.duration, Math.min(n.d, c.length - n.t)) ||
          !near(+g.vel, n.v ?? 0.8)
        ) {
          notesOk = false;
          T.note(`${t.name} note ${k}: ${JSON.stringify(g)} vs ${JSON.stringify(n)}`);
        }
      });
    });
  });
  T.ok(notesOk, `every sounding note, in beats, with key, time, length and velocity (${nNotes} notes)`);
  T.ok(
    counts.notes >= nNotes && nNotes === counts.notes - 1,
    `the one note that starts after its clip ends is left out, as Overdub never plays it (${counts.notes} in the song, ${nNotes} exported)`,
  );
  // audio
  const audioTrackIdx = p.tracks.findIndex((t) => t.id === 't_audio1');
  const aLane = laneOf.get(tracks[audioTrackIdx].attrs.id);
  const outer = kids(kid(aLane, 'Clips'), 'Clip')[0];
  const audioEl = outer && all(outer, 'Audio')[0];
  const warps = outer && all(outer, 'Warp');
  T.ok(
    outer && +outer.attrs.time === 8 && +outer.attrs.duration === 8 && kid(audioEl, 'File')?.attrs.path === audioPath,
    `the audio clip at beat 8 for 8 beats points at ${kid(audioEl, 'File')?.attrs.path}`,
  );
  T.ok(
    audioEl &&
      +audioEl.attrs.sampleRate === 48000 &&
      +audioEl.attrs.channels === 1 &&
      near(+audioEl.attrs.duration, 2, 1e-3),
    'the Audio element has the file’s rate, channels and length (read from the WAV)',
  );
  T.ok(
    warps &&
      warps.length === 2 &&
      +warps[0].attrs.contentTime === 0.5 &&
      near(+warps[1].attrs.contentTime, 0.5 + (8 * 60) / p.tempo, 1e-5),
    'warp markers map beats to seconds from the clip’s offset',
  );
  // markers
  const marks = all(kid(x, 'Arrangement'), 'Marker');
  T.ok(
    marks.length === p.sections.length &&
      marks.every((mk, i) => mk.attrs.name === p.sections[i].name && +mk.attrs.time === p.sections[i].start),
    `sections become markers (${marks.map((mk) => mk.attrs.name).join(', ')})`,
  );
  // a recording that isn't in this browser
  const miss = dawprojectXml(p, { getDevice: registry.getDevice, audio: {} });
  T.ok(
    miss.warnings.length === 1 &&
      /Take 1/.test(miss.warnings[0]) &&
      !/<Audio/.test(miss.project) &&
      miss.media.length === 0,
    `a missing recording is a warning, and its clip is left out (“${miss.warnings[0]}”)`,
  );
  let parses = false;
  try {
    parses = parseXml(miss.project).name === 'Project';
  } catch (e) {
    T.note(e.message);
  }
  T.ok(parses, 'and the project still parses');
});
