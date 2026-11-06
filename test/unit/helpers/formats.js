// Readers for the files the Song menu writes (WAV, Standard MIDI, zip), written apart from the encoders so that a
// round trip through them proves something. Shared by test/unit/export-formats.test.js and tools/mix-test.js.
export function parseWav(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const s = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (s(0, 4) !== 'RIFF' || s(8, 4) !== 'WAVE') return null;
  let o = 12,
    fmt = null,
    data = null;
  while (o + 8 <= b.length) {
    const id = s(o, 4),
      len = dv.getUint32(o + 4, true);
    if (id === 'fmt ')
      fmt = {
        format: dv.getUint16(o + 8, true),
        channels: dv.getUint16(o + 10, true),
        sr: dv.getUint32(o + 12, true),
        byteRate: dv.getUint32(o + 16, true),
        block: dv.getUint16(o + 20, true),
        bits: dv.getUint16(o + 22, true),
      };
    if (id === 'data') data = { off: o + 8, len };
    o += 8 + len + (len & 1);
  }
  if (!fmt || !data) return null;
  const frames = data.len / fmt.block;
  const ch = Array.from({ length: fmt.channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < fmt.channels; c++) {
      const p = data.off + i * fmt.block + c * (fmt.bits / 8);
      let v;
      if (fmt.bits === 24) {
        v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
        if (v & 0x800000) v -= 0x1000000;
        v /= 8388608;
      } else {
        v = dv.getInt16(p, true) / 32768;
      }
      ch[c][i] = v;
    }
  return { ...fmt, frames, ch, riffSize: dv.getUint32(4, true), total: b.length };
}
export function parseMidi(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const s = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (s(0, 4) !== 'MThd' || dv.getUint32(4) !== 6) return null;
  const format = dv.getUint16(8),
    ntrks = dv.getUint16(10),
    ppq = dv.getUint16(12);
  let o = 14;
  const tracks = [];
  for (let k = 0; k < ntrks; k++) {
    if (s(o, 4) !== 'MTrk') return { error: 'bad chunk at ' + o };
    const len = dv.getUint32(o + 4),
      end = o + 8 + len;
    let p = o + 8,
      t = 0,
      run = 0;
    const tr = {
      name: '',
      tempo: null,
      timesig: null,
      keysig: null,
      markers: [],
      on: 0,
      off: 0,
      open: new Map(),
      notes: [],
      ended: false,
      chans: new Set(),
    };
    const vlq = () => {
      let v = 0,
        c;
      do {
        c = b[p++];
        v = (v << 7) | (c & 0x7f);
      } while (c & 0x80);
      return v;
    };
    while (p < end) {
      t += vlq();
      let st = b[p];
      if (st & 0x80) p++;
      else st = run;
      if (st === 0xff) {
        const type = b[p++],
          l = vlq(),
          d = b.slice(p, p + l);
        p += l;
        if (type === 0x03) tr.name = new TextDecoder().decode(d);
        if (type === 0x51) tr.tempo = (d[0] << 16) | (d[1] << 8) | d[2];
        if (type === 0x58) tr.timesig = [d[0], 2 ** d[1]];
        if (type === 0x59) tr.keysig = [(d[0] << 24) >> 24, d[1]];
        if (type === 0x06) tr.markers.push([t, new TextDecoder().decode(d)]);
        if (type === 0x2f) tr.ended = true;
        continue;
      }
      run = st;
      const hi = st & 0xf0;
      tr.chans.add(st & 15);
      if (hi === 0x90 || hi === 0x80) {
        const n = b[p++],
          v = b[p++];
        if (hi === 0x90 && v > 0) {
          tr.on++;
          tr.open.set(n, (tr.open.get(n) || []).concat([[t, v]]));
        } else {
          tr.off++;
          const q = tr.open.get(n);
          if (q?.length) {
            const [t0, v0] = q.shift();
            tr.notes.push({ p: n, t: t0, d: t - t0, v: v0 });
          }
        }
      } else if (hi === 0xc0 || hi === 0xd0) p += 1;
      else p += 2;
    }
    tracks.push(tr);
    o = end;
  }
  return { format, ntrks, ppq, tracks, consumed: o === b.length };
}
export function parseZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) return null;
  const n = dv.getUint16(e + 10, true),
    cdOff = dv.getUint32(e + 16, true);
  const files = [];
  let o = cdOff;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) return { error: 'bad central dir' };
    const crc = dv.getUint32(o + 16, true),
      size = dv.getUint32(o + 20, true),
      nl = dv.getUint16(o + 28, true),
      xl = dv.getUint16(o + 30, true),
      cl = dv.getUint16(o + 32, true),
      lo = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(b.slice(o + 46, o + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) return { error: 'bad local header' };
    const lnl = dv.getUint16(lo + 26, true),
      lxl = dv.getUint16(lo + 28, true);
    const data = b.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + size);
    files.push({ name, crc, data });
    o += 46 + nl + xl + cl;
  }
  return { files };
}
export function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}
