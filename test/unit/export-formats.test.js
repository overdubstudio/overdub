// The Song menu's encoders (ui/export.js: WAV, Standard MIDI, zip) parsed back by readers written apart from them
// (helpers/formats.js). Moved intact from tools/mix-test.js; the Song menu's downloads stay there, in the studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, encodeMidi, zipStore } from '../../app/src/ui/export.js';
import { demoProject } from '../../app/src/core/demo.js';
import { parseWav, parseMidi, parseZip, crc32 } from './helpers/formats.js';

const PROJ = demoProject();

test('the encoders, parsed back', () => {
  const wav = (() => {
    const n = 4800,
      L = new Float32Array(n),
      R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      R[i] = i % 100 === 0 ? 1 : -0.25;
    }
    L[10] = 1.5;
    L[11] = -2;
    return Array.from(encodeWav({ sampleRate: 48000, channels: [L, R] }, { bits: 24 }));
  })();
  const w = parseWav(Uint8Array.from(wav));
  assert.ok(
    w &&
      w.format === 1 &&
      w.bits === 24 &&
      w.channels === 2 &&
      w.sr === 48000 &&
      w.block === 6 &&
      w.byteRate === 288000,
    'WAV: a 24-bit stereo PCM header',
  );
  assert.ok(w && w.frames === 4800 && w.riffSize === w.total - 8, 'WAV: the sizes add up');
  let maxErr = 0;
  for (let i = 0; i < 4800; i++) {
    if (i === 10 || i === 11) continue;
    const want = Math.fround(Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5);
    maxErr = Math.max(maxErr, Math.abs(w.ch[0][i] - want));
  }
  assert.ok(
    maxErr < 1.5 / 8388608,
    `WAV: samples round-trip to 24-bit precision (max error ${maxErr.toExponential(2)})`,
  );
  assert.ok(
    Math.abs(w.ch[0][10] - 8388607 / 8388608) < 1e-9 &&
      w.ch[0][11] === -1 &&
      w.ch[1][0] > 0.9999 &&
      Math.abs(w.ch[1][1] + 0.25) < 1e-6,
    'WAV: overs clip cleanly, channels interleave in order',
  );
  const w16 = parseWav(
    Uint8Array.from(
      Array.from(encodeWav({ sampleRate: 44100, channels: [new Float32Array([0, 0.5, -0.5, 1])] }, { bits: 16 })),
    ),
  );
  assert.ok(
    w16 && w16.bits === 16 && w16.channels === 1 && w16.sr === 44100 && Math.abs(w16.ch[0][1] - 0.5) < 1e-4,
    'WAV: 16-bit mono too',
  );

  const mid = Array.from(
    encodeMidi(PROJ, { isDrums: (t) => /drum/i.test(t.instrument?.device || '') || t.name === 'Drums' }),
  );
  const proj = (() => {
    const p = PROJ;
    return {
      tempo: p.tempo,
      meter: p.meter,
      key: p.key,
      title: p.title,
      sections: p.sections.length,
      parts: p.tracks
        .filter((t) => t.kind === 'instrument' && t.clips.some((c) => c.notes?.length))
        .map((t) => ({
          name: t.name,
          n: t.clips.reduce((s, c) => s + c.notes.filter((n) => n.t < c.length).length, 0),
          first: Math.min(...t.clips.flatMap((c) => c.notes.map((n) => c.start + n.t))),
        })),
    };
  })();
  const M = parseMidi(Uint8Array.from(mid));
  assert.ok(
    M && M.format === 1 && M.ppq === 480 && M.consumed,
    'MIDI: a format-1 file at 480 ppq that parses to the end',
  );
  assert.ok(M && M.ntrks === proj.parts.length + 1, `MIDI: a tempo track plus one track per part (${M?.ntrks})`);
  assert.ok(
    M &&
      M.tracks[0].tempo === Math.round(60000000 / proj.tempo) &&
      M.tracks[0].timesig[0] === proj.meter[0] &&
      M.tracks[0].timesig[1] === proj.meter[1],
    `MIDI: tempo ${proj.tempo} bpm and ${proj.meter.join('/')} in the tempo track`,
  );
  assert.ok(
    M && (!proj.key || proj.key.root !== 'A' || (M.tracks[0].keysig?.[0] === 0 && M.tracks[0].keysig?.[1] === 1)),
    'MIDI: the key signature (A minor: no sharps, minor)',
  );
  assert.ok(M && M.tracks[0].markers.length === proj.sections, 'MIDI: sections become markers');
  assert.ok(M && M.tracks.every((t) => t.ended), 'MIDI: every track ends with End of Track');
  const okParts = M
    ? proj.parts.every((p, i) => {
        const t = M.tracks[i + 1];
        return t.name === p.name && t.on === p.n && t.off === p.n && t.notes.length === p.n;
      })
    : false;
  assert.ok(okParts, 'MIDI: every note of every part is there, paired on/off, with its track name');
  assert.ok(
    M && proj.parts.every((p, i) => Math.min(...M.tracks[i + 1].notes.map((n) => n.t)) === Math.round(p.first * 480)),
    'MIDI: notes land on the right ticks',
  );
  assert.ok(M && M.tracks.slice(1).some((t) => t.chans.has(9)), 'MIDI: drums go on channel 10');

  const z = (() => {
    const ex = { zipStore };
    const big = new Uint8Array(70000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
    return Array.from(
      ex.zipStore([
        { name: 'a.txt', data: 'hello overdub' },
        { name: '02 Bass ♪.wav', data: big },
      ]),
    );
  })();
  const Z = parseZip(Uint8Array.from(z));
  assert.ok(
    Z &&
      Z.files?.length === 2 &&
      Z.files[0].name === 'a.txt' &&
      new TextDecoder().decode(Z.files[0].data) === 'hello overdub' &&
      Z.files[1].name === '02 Bass ♪.wav',
    'zip: entries and UTF-8 names read back',
  );
  assert.ok(Z && Z.files.every((f) => crc32(f.data) === f.crc), 'zip: CRC-32s check out');
});
