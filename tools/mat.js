// A MAT-file (MATLAB level 5) reader, for the Aachen rooms (tools/kits/air-rooms.js): their Aula Carolina exists only
// as .mat. Node built-ins only (node:zlib). It reads what those files hold and refuses the rest, by name:
//   miCOMPRESSED elements (zlib), miMATRIX of class double, single, the integers, char, struct (1 x 1) and cell;
//   the numeric data in any of the integer or float storage types MATLAB packs it into; both byte orders.
// Not read: complex, sparse, logical-as-sparse, objects, function handles, v7.3 (HDF5) files.
//
//   readMat(buffer) -> { name: value }   a numeric array is a Float64Array (column-major, its `dims` on it), a char
//                                        array a string, a struct an object of its fields, a cell an array
import zlib from 'node:zlib';

const CLASS = { 1: 'cell', 2: 'struct', 3: 'object', 4: 'char', 5: 'sparse', 6: 'double', 7: 'single', 8: 'int8', 9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32', 13: 'uint32', 14: 'int64', 15: 'uint64' };
// mi type -> [bytes, reader name]
const MI = { 1: [1, 'Int8'], 2: [1, 'UInt8'], 3: [2, 'Int16'], 4: [2, 'UInt16'], 5: [4, 'Int32'], 6: [4, 'UInt32'], 7: [4, 'Float'], 9: [8, 'Double'], 12: [8, 'BigInt64'], 13: [8, 'BigUInt64'], 16: [1, 'UInt8'] };

export function readMat(buf) {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 128) throw new Error('mat: shorter than its header');
  const ver = b.readUInt16LE(124), le = b.toString('latin1', 126, 128) === 'IM';
  if (!le && b.toString('latin1', 126, 128) !== 'MI') throw new Error('mat: not a level 5 MAT-file (no endian mark)');
  const E = le ? 'LE' : 'BE';
  if ((le ? ver : b.readUInt16BE(124)) !== 0x0100) throw new Error('mat: not a level 5 MAT-file (version ' + ver + ')');
  const u32 = (x, o) => x[`readUInt32${E}`](o);
  // one element at o of x: { type, data, next }; the small form packs type and size in one word, data in the next
  const element = (x, o) => {
    const w = u32(x, o);
    if (w >>> 16) return { type: w & 0xffff, data: x.subarray(o + 4, o + 4 + (w >>> 16)), next: o + 8 };
    const n = u32(x, o + 4), type = w;
    // (a compressed element isn't padded; everything else is, to 8 bytes)
    return { type, data: x.subarray(o + 8, o + 8 + n), next: o + 8 + (type === 15 ? n : (n + 7) & ~7) };
  };
  const numbers = (el) => {
    const t = MI[el.type];
    if (!t) throw new Error('mat: numeric data of type ' + el.type);
    const [sz, rd] = t, n = el.data.length / sz, out = new Float64Array(n), fn = `read${rd}${sz > 1 ? E : ''}`;
    for (let i = 0; i < n; i++) out[i] = Number(el.data[fn](i * sz));
    return out;
  };
  const matrix = (x) => {
    let o = 0;
    const flags = element(x, o); o = flags.next;
    const f0 = u32(flags.data, 0), cls = CLASS[f0 & 0xff];
    if (f0 & 0x800) throw new Error('mat: complex arrays aren\'t read');
    const dimsEl = element(x, o); o = dimsEl.next;
    const dims = Array.from(numbers(dimsEl));
    const nameEl = element(x, o); o = nameEl.next;
    const name = nameEl.data.toString('latin1');
    const count = dims.reduce((a, d) => a * d, 1);
    let value;
    if (cls === 'double' || cls === 'single' || /int/.test(cls || '')) {
      const re = element(x, o);
      value = count ? numbers(re) : new Float64Array(0);
      Object.defineProperty(value, 'dims', { value: dims });
    } else if (cls === 'char') {
      const d = element(x, o), t = MI[d.type];
      value = t && t[0] === 2 ? Array.from(numbers(d), (c) => String.fromCharCode(c)).join('') : d.data.toString(d.type === 16 ? 'utf8' : 'latin1');
    } else if (cls === 'struct') {
      if (count !== 1) throw new Error('mat: only 1 x 1 structs are read');
      const fl = element(x, o); o = fl.next;
      const width = u32(fl.data, 0);
      const fn = element(x, o); o = fn.next;
      value = {};
      for (let k = 0; k * width < fn.data.length; k++) {
        const key = fn.data.toString('latin1', k * width, (k + 1) * width).replace(/\0.*$/s, '');
        const el = element(x, o); o = el.next;
        if (el.type !== 14) throw new Error('mat: a struct field that isn\'t a matrix');
        value[key] = el.data.length ? matrix(el.data).value : null;
      }
    } else if (cls === 'cell') {
      value = [];
      for (let k = 0; k < count; k++) { const el = element(x, o); o = el.next; value.push(el.data.length ? matrix(el.data).value : null); }
    } else throw new Error('mat: arrays of class ' + (cls || f0 & 0xff) + ' aren\'t read');
    return { name, value };
  };
  const out = {};
  for (let o = 128; o + 8 <= b.length;) {
    let el = element(b, o); o = el.next;
    if (el.type === 15) el = element(zlib.inflateSync(el.data), 0);
    if (el.type !== 14) continue;
    const { name, value } = matrix(el.data);
    out[name] = value;
  }
  return out;
}
