// Echo Chamber (core.rooms), the parts that need no Aachen bank: tools/kits/zip.js's ranged zip reader against a local
// server, and the device's contract (def, params, the words it says, ROOM_TAIL verbatim and no banned Math calls
// after LIB, no bank = the input as it is). Moved from tools/rooms-test.js; what needs the bank stays there.
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openZipRanged } from '../../tools/kits/zip.js';
import rooms, { ROOMS_BODY } from '../../app/src/devices/builtin/rooms.js';
import { ROOM_LABELS, ROOMS_HASH, ROOMS_SAYS, ROOM_TAIL } from '../../app/src/devices/builtin/rooms-lib.js';
import { LIB } from '../../app/src/devices/builtin/lib.js';
import { diStrum } from '../../app/src/audio/testsignals.js';
import { run } from '../../tools/amp-scenes.js';
import { T } from './_t.js';

const ok = T.ok;
const SR = 48000;

test('the ranged zip: members by Range, pinned and cached, offline, a server that ignores Range', async () => {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  // a zip of three members, one stored and two deflated, with 300 KB of padding before the directory
  const files = [
    ['a/license.txt', Buffer.from('MIT License\n\nthe text'), 0],
    ['a/one.bin', crypto.createHash('sha512').update('one').digest(), 8],
    ['a/big.bin', Buffer.alloc(200000, 7), 8],
  ];
  const parts = [],
    dir = [];
  let at = 0;
  for (const [name, data, method] of files) {
    const body = method ? zlib.deflateRawSync(data) : data,
      nm = Buffer.from(name),
      crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    lh.writeUInt16LE(4, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(at, 42);
    // (the local header carries a 4-byte extra field the directory doesn't: the reader must use the local lengths)
    parts.push(lh, nm, Buffer.alloc(4), body);
    dir.push(ch, nm);
    at += 30 + nm.length + 4 + body.length;
  }
  parts.push(Buffer.alloc(300000));
  const cd = Buffer.concat(dir),
    start = at + 300000,
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(start, 16);
  const zip = Buffer.concat([...parts, cd, end]);
  const pins = Object.fromEntries(files.map(([n, d]) => [n, sha(d)]));
  let ranges = 0,
    wholes = 0,
    honour = true;
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (m && honour) {
      ranges++;
      const a = +m[1],
        b = Math.min(zip.length - 1, +m[2]);
      res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${zip.length}`, 'content-length': b - a + 1 });
      res.end(zip.subarray(a, b + 1));
    } else {
      wholes++;
      res.writeHead(200, { 'content-length': zip.length });
      res.end(zip);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/air.zip`,
    src = { url, sha256: sha(zip), size: zip.length };
  const dirs = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-zip-'));
    dirs.push(d);
    return d;
  };
  const cache = tmp();
  try {
    const z = await openZipRanged(src, { cache, members: pins });
    const same = files.every(([n, d]) => z.read(n).equals(d));
    ok(
      z.how === 'range' && same && wholes === 0,
      `members by Range: ${ranges} requests for ${(zip.length / 1000).toFixed(0)} KB, every member its pin (${z.how}, ${wholes} whole downloads)`,
    );
    ok(
      files.every(([n]) => fs.existsSync(path.join(cache, pins[n] + path.extname(n)))),
      'each member is cached by its own SHA-256',
    );
    ranges = 0;
    const z2 = await openZipRanged(src, { cache, offline: true, members: pins });
    ok(
      z2.how === 'cache' && ranges === 0 && files.every(([n, d]) => z2.read(n).equals(d)),
      'read again offline, from the cache alone',
    );
    const bad = { ...pins, 'a/one.bin': sha(Buffer.from('not it')) };
    let msg = '';
    try {
      await openZipRanged(src, { cache: tmp(), members: bad });
    } catch (e) {
      msg = e.message;
    }
    ok(/a\/one\.bin: SHA-256 .* pinned/.test(msg), `a member that isn't its pin is refused ("${msg.slice(0, 60)}...")`);
    msg = '';
    try {
      await openZipRanged({ ...src, size: zip.length + 1 }, { cache: tmp(), members: pins });
    } catch (e) {
      msg = e.message;
    }
    ok(/pinned/.test(msg), "a zip whose size isn't the pinned one is refused");
    honour = false;
    wholes = 0;
    const c3 = tmp();
    const z3 = await openZipRanged(src, { cache: c3, members: pins });
    ok(
      z3.how === 'zip' &&
        wholes >= 1 &&
        files.every(([n, d]) => z3.read(n).equals(d)) &&
        fs.existsSync(path.join(c3, src.sha256 + '.zip')),
      'a server that ignores Range: the whole zip, checked by its SHA-256 and cached',
    );
    let wrong = '';
    try {
      await openZipRanged({ ...src, sha256: sha(Buffer.from('x')) }, { cache: tmp(), members: pins });
    } catch (e) {
      wrong = e.message;
    }
    ok(/SHA-256 .* pinned/.test(wrong), 'and the whole zip must be its pin');
  } finally {
    server.close();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('Echo Chamber: the def, its params, its words, ROOM_TAIL verbatim, no bank = the input as it is', () => {
  const d = rooms;
  ok(
    d.id === 'core.rooms' &&
      d.name === 'Echo Chamber' &&
      d.kind === 'effect' &&
      d.cat === 'ambient' &&
      d.by === 'overdub' &&
      d.trails === true &&
      d.tail === 12 &&
      d.latency == null &&
      d.data.aachen === ROOMS_HASH,
    'core.rooms is Echo Chamber: an ambient effect, trails, tail 12 s, no declared latency, data { aachen }',
  );
  ok(
    JSON.stringify(d.params.map((p) => p.key)) ===
      JSON.stringify(['room', 'predelay', 'decay', 'damp', 'lowcut', 'width', 'mix']) &&
      JSON.stringify(d.params[0].opts) === JSON.stringify(ROOM_LABELS) &&
      d.params[0].auto === false,
    `its params, keys forever: ${d.params.map((p) => p.key).join(', ')}; ROOM a switch of ${ROOM_LABELS.join(', ')}, never automated`,
  );
  ok(
    JSON.stringify(d.dataSays) === JSON.stringify(ROOMS_SAYS) &&
      ROOMS_SAYS.loading[0] === 'Loading rooms…' &&
      ROOMS_SAYS.missing[0] === 'No rooms here',
    `it says "${ROOMS_SAYS.loading[0]}" while the bank loads and "${ROOMS_SAYS.missing[0]}" without it`,
  );
  // R8 and R22: ROOM_TAIL verbatim in the kernel; nothing after LIB calls Math.exp, pow, sin, cos, tan or log
  ok(
    d.kernel.includes(ROOM_TAIL) &&
      d.kernel.includes(ROOMS_BODY) &&
      d.kernel.indexOf(ROOMS_BODY) > d.kernel.indexOf(LIB) + LIB.length - 1,
    "the kernel carries ROOM_TAIL verbatim, after lib.js's LIB",
  );
  const banned = ROOMS_BODY.match(/Math\.(exp|pow|sin|cos|tan|log)\w*/g);
  ok(
    !banned,
    `the kernel's own text (${ROOMS_BODY.length} characters after LIB) calls no Math.exp, pow, sin, cos, tan or log${banned ? ': ' + [...new Set(banned)].join(', ') : ''}`,
  );
  // R24: no bank, the input as it is
  const strum = diStrum(4, SR),
    st = [
      Float32Array.from(strum, (v) => v * 0.7),
      Float32Array.from(strum, (v, i) => v * 0.5 + 0.1 * Math.sin(i * 0.01)),
    ];
  const [nl, nr] = run(d, {}, st[0], st[1], { data: null });
  let same = true;
  for (let i = 0; i < nl.length; i++)
    if (nl[i] !== st[0][i] || nr[i] !== st[1][i]) {
      same = false;
      break;
    }
  ok(same, 'with no bank (loading, or not on this server) the input passes through, sample for sample');
});
