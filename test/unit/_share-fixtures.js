// A song with every kind of author, a kernel written in it, an audio clip that can't travel, and the other fixtures
// tools/share-test.js and test/unit/share-link.test.js build links from. Not a test file.
import * as S from '../../app/src/core/share.js';
import '../../app/src/devices/builtin/index.js';
import '../../app/src/devices/library/index.js';
import { demoProject } from '../../app/src/core/demo.js';

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const KERNEL = `({ create({ sr, seed, dsp }) { return { process(L, R, n, p) { for (let i = 0; i < n; i++) { L[i] *= 0.5; R[i] *= 0.5; } } }; } })`;
export function richSong() {
  const p = demoProject();
  p.title = 'Shared Reel';
  const bass = p.tracks.find((t) => /bass/i.test(t.name));
  bass.clips[0].notes.slice(0, 4).forEach((n) => {
    n.by = 'you';
  });
  bass.clips[0].notes.slice(4, 6).forEach((n) => {
    n.by = 'mcp:cursor';
  });
  p.tracks.push({
    id: 't_mine01',
    name: 'My hum',
    color: 'var(--c-3)',
    kind: 'instrument',
    instrument: { device: 'core.keys', params: {} },
    inserts: [],
    clips: [
      {
        id: 'c_mine01',
        kind: 'notes',
        start: 0,
        length: 4,
        by: 'you',
        notes: [
          { id: 'n1', p: 69, t: 0, d: 1, v: 0.8, by: 'you' },
          { id: 'n2', p: 72, t: 1, d: 1, v: 0.8, by: 'you' },
          { id: 'n3', p: 76, t: 2, d: 1, v: 0.7, by: 'claude' },
        ],
      },
    ],
    gain: 0,
    pan: 0,
    mute: false,
    solo: false,
    arm: false,
    by: 'you',
  });
  p.tracks.push({
    id: 't_audio1',
    name: 'Guitar DI',
    color: 'var(--c-5)',
    kind: 'audio',
    instrument: null,
    inserts: [{ id: 'fx_half01', device: 'you.half', on: true, params: {}, by: 'you' }],
    clips: [{ id: 'c_aud001', kind: 'audio', start: 0, length: 8, asset: 'a_take01', offset: 0, gain: 0, by: 'you' }],
    gain: -3,
    pan: 0.2,
    mute: false,
    solo: false,
    arm: true,
    input: { device: 'default', channel: 1 },
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
    you: { kind: 'human', name: 'You' },
    claude: { kind: 'agent', name: 'Claude' },
    'mcp:cursor': { kind: 'agent', name: 'cursor' },
  };
  return p;
}
// every authored thing: path -> by
export function signatures(p) {
  const out = {};
  for (const t of p.tracks) {
    out[`track ${t.id}`] = t.by;
    for (const fx of t.inserts) out[`fx ${fx.id}`] = fx.by;
    for (const c of t.clips) {
      out[`clip ${c.id}`] = c.by;
      for (const n of c.notes || []) out[`note ${c.id}/${n.id}`] = n.by;
    }
  }
  for (const fx of p.master.inserts) out[`fx ${fx.id}`] = fx.by;
  for (const d of Object.values(p.devices)) out[`device ${d.id}`] = d.by;
  return out;
}
export const stripBy = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k === 'by' ? undefined : v)));

// A link or song file is anyone's JSON.
export const linkOf = async (song) =>
  '#s=' +
  S.toBase64url(
    await S.deflate(
      new TextEncoder().encode(JSON.stringify({ f: S.SHARE_FORMAT, at: '2026-10-01T00:00:00.000Z', from: {}, song })),
    ),
  );
export const EVIL = { html: '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">' };
export const WRONG_SHAPES = {
  'tracks:[null]': { tracks: [null] },
  'tracks:[5,"x",[]]': { tracks: [5, 'x', []] },
  'clips:[null]': { tracks: [{ clips: [null, 3] }] },
  'clips:{}': { tracks: [{ clips: {} }] },
  'sections:[null]': { tracks: [], sections: [null, 'x'] },
  'sections:{}': { tracks: [], sections: {} },
  'notes:"x"': { tracks: [{ clips: [{ notes: 'x' }] }] },
  'notes:{}': { tracks: [{ clips: [{ notes: {} }] }] },
  'notes:[null]': { tracks: [{ clips: [{ notes: [null, 7] }] }] },
  'inserts:5': { tracks: [{ inserts: 5 }] },
  'inserts:[null]': { tracks: [{ inserts: [null] }] },
  'instrument:"x"': { tracks: [{ instrument: 'x' }] },
  'instrument.params:5': { tracks: [{ instrument: { device: 'core.poly', params: 5 } }] },
  'master:{inserts:{}}': { tracks: [], master: { inserts: {} } },
  'master:5': { tracks: [], master: 5 },
  'devices:[]': { tracks: [], devices: [1] },
  'devices:{x:null}': { tracks: [], devices: { 'sam.x': null } },
  'meta:"x"': { tracks: [], meta: 'x' },
  'meta.authors:[null]': { tracks: [], meta: { authors: [null] } },
  'meta.forkedFrom:5': { tracks: [], meta: { forkedFrom: 5 } },
  'meta.forkedFrom.authors:{}': { tracks: [], meta: { forkedFrom: { title: 'x', authors: {} } } },
  'loop:5': { tracks: [], loop: 5 },
  'key:{root:1}': { tracks: [], key: { root: 1, scale: {} } },
  'auto:5': { tracks: [{ auto: 5 }], master: { auto: 5 } },
  'tracks:{} (a file)': { tracks: {} },
  'title:[]': { tracks: [], title: [] },
};

// a song sent back (FRESH-EYES round 5): Sam's link, made Jo's, sent back. The tool opens the result (sentBack) in a
// browser; the unit test checks who each part is credited to.
export async function spinCycle() {
  const song = demoProject();
  song.title = 'Spin Cycle';
  const kt = song.tracks.find((t) => t.name === 'Keys');
  kt.instrument = { device: 'sam.tape-organ', params: {} };
  for (const c of kt.clips) {
    c.by = 'you';
    for (const n of c.notes) n.by = 'you';
  }
  song.devices['sam.tape-organ'] = {
    id: 'sam.tape-organ',
    name: 'Tape Organ',
    kind: 'instrument',
    cat: 'keys',
    params: [],
    kernel: KERNEL,
    by: 'you',
    version: 1,
  };
  const atJo = await S.openShared((await S.encodeShare(song, { from: { name: 'Sam', me: 'samSecret01' } })).hash, {
    me: 'joSecret001',
  });
  const jos = S.forkSong(atJo.song, { at: '2026-10-02T21:30:00.000Z' });
  jos.tracks
    .find((t) => t.name === 'Bass')
    .clips[0].notes.slice(0, 2)
    .forEach((n) => {
      n.by = 'you';
    }); // (Jo plays a little)
  const sentBack = (await S.encodeShare(jos, { from: { name: 'Jo', me: 'joSecret001' } })).hash; // (for the ask, in a browser below)
  return { atJo, jos, sentBack };
}
