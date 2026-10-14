// tools/mat.js, the MAT v5 reader the Aachen rooms are read with (tools/kits/air-rooms.js): a small MAT-file built
// here, element by element (a compressed double vector, a struct whose numbers MATLAB packed into a smaller integer
// type, a char array, a cell), read back.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readMat } from '../../tools/mat.js';

const MI = { int8: 1, uint8: 2, uint16: 4, int32: 5, uint32: 6, single: 7, double: 9, matrix: 14, compressed: 15 };
const CLS = { cell: 1, struct: 2, char: 4, double: 6 };

// one data element: its tag, its data, padded to 8 bytes (the small form when the data fits in 4)
function el(type, data, { small = true } = {}) {
  if (small && data.length <= 4 && type !== MI.matrix && type !== MI.compressed) {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((data.length << 16) | type, 0);
    data.copy(b, 4);
    return b;
  }
  const tag = Buffer.alloc(8);
  tag.writeUInt32LE(type, 0);
  tag.writeUInt32LE(data.length, 4);
  const pad = type === MI.compressed ? 0 : (8 - (data.length % 8)) % 8;
  return Buffer.concat([tag, data, Buffer.alloc(pad)]);
}
const typed = (Arr, values) => Buffer.from(new Arr(values).buffer);
const ascii = (s) => Buffer.from(s, 'latin1');
function matrix(cls, dims, name, body) {
  return el(
    MI.matrix,
    Buffer.concat([
      el(MI.uint32, typed(Uint32Array, [cls, 0]), { small: false }),
      el(MI.int32, typed(Int32Array, dims), { small: false }),
      el(MI.int8, ascii(name)),
      ...body,
    ]),
  );
}
function header() {
  const h = Buffer.alloc(128, 0x20);
  h.write('MATLAB 5.0 MAT-file, built by test/unit/mat.test.js', 0, 'latin1');
  h.fill(0, 116, 124);
  h.writeUInt16LE(0x0100, 124);
  h.write('IM', 126, 'latin1');
  return h;
}
function structOf(name, fields) {
  const W = 32;
  const names = Buffer.alloc(W * fields.length);
  fields.forEach(([key], k) => {
    names.write(key, k * W, 'latin1');
  });
  return matrix(CLS.struct, [1, 1], name, [
    el(MI.int32, typed(Int32Array, [W])),
    el(MI.int8, names),
    ...fields.map(([, m]) => m),
  ]);
}

describe('tools/mat.js', () => {
  const h = [0.5, -0.25, 1e-3, 3.141592653589793];
  const file = Buffer.concat([
    header(),
    el(MI.compressed, zlib.deflateSync(matrix(CLS.double, [1, 4], 'h_air', [el(MI.double, typed(Float64Array, h))]))),
    structOf('air_info', [
      // MATLAB stores a whole-number double in the smallest integer type that holds it
      ['fs', matrix(CLS.double, [1, 1], '', [el(MI.uint16, typed(Uint16Array, [48000]))])],
      [
        'room',
        matrix(CLS.char, [1, 4], '', [
          el(
            MI.uint16,
            typed(
              Uint16Array,
              [...'aula'].map((c) => c.charCodeAt(0)),
            ),
          ),
        ]),
      ],
      ['gain', matrix(CLS.double, [1, 2], '', [el(MI.single, typed(Float32Array, [0.5, -2]))])],
    ]),
    matrix(CLS.cell, [1, 2], 'notes', [
      matrix(CLS.char, [1, 2], '', [el(MI.uint8, ascii('hi'))]),
      matrix(CLS.double, [1, 1], '', [el(MI.int8, typed(Int8Array, [-3]))]),
    ]),
  ]);

  test('reads a compressed double vector, exactly, with its dims', () => {
    const m = readMat(file);
    assert.ok(m.h_air instanceof Float64Array);
    assert.deepEqual(Array.from(m.h_air), h);
    assert.deepEqual(m.h_air.dims, [1, 4]);
  });
  test('reads a struct: packed integers back as numbers, a char array as a string, singles as doubles', () => {
    const { air_info } = readMat(file);
    assert.equal(air_info.fs[0], 48000);
    assert.equal(air_info.room, 'aula');
    assert.deepEqual(Array.from(air_info.gain), [0.5, -2]);
  });
  test('reads a cell array', () => {
    const { notes } = readMat(file);
    assert.equal(notes[0], 'hi');
    assert.equal(notes[1][0], -3);
  });
  test('refuses what it does not read, by name', () => {
    assert.throws(() => readMat(Buffer.alloc(64)), /shorter than its header/);
    const v73 = header();
    v73.writeUInt16LE(0x0200, 124);
    assert.throws(() => readMat(v73), /not a level 5/);
    const complex = Buffer.concat([
      header(),
      el(
        MI.matrix,
        Buffer.concat([
          el(MI.uint32, typed(Uint32Array, [CLS.double | 0x800, 0]), { small: false }),
          el(MI.int32, typed(Int32Array, [1, 1]), { small: false }),
          el(MI.int8, ascii('z')),
          el(MI.double, typed(Float64Array, [1])),
          el(MI.double, typed(Float64Array, [2])),
        ]),
      ),
    ]);
    assert.throws(() => readMat(complex), /complex/);
  });
});
