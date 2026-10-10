// tools/community-pull.js, the shelf the studio ships (the shelf-live spec, R2 and R4): against a small overdub-devices
// repo made with git in a temp dir (tools/fixtures/community-repo.js). A good pin fills the out dir with the index, the
// device files and the MP3s only; a wrong index hash, a swapped device file, +dirty, a change to the shelf's inputs
// since built.from and a revoked entry still listed are each refused, with nothing written.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verify, main, summarize, untar, PullError } from '../../tools/community-pull.js';
import { makeDevicesRepo, KERNELS, CLIP } from '../../tools/fixtures/community-repo.js';
import { kernelHash } from '../../app/src/devices/trust.js';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tools/community-pull.js');
let tmp, repo;
const files = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true })
        .filter((f) => fs.statSync(path.join(dir, f)).isFile())
        .sort()
    : [];
const pinFile = (name, pin) => {
  const f = path.join(tmp, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(pin));
  return f;
};
const pull = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const refused = (fn, re) =>
  assert.throws(fn, (e) => e instanceof PullError && e.code === 'refused' && re.test(e.message), `refused with ${re}`);

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'community-pull-'));
  repo = makeDevicesRepo(path.join(tmp, 'devices'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('a good pin', () => {
  test('fills the out dir with the index, the device files and the MP3 clips, and nothing else', () => {
    const out = path.join(tmp, 'good-out');
    const pin = pinFile('good', { repo: 'x', commit: repo.c2, index_sha256: repo.sha('index/community-index.json') });
    const r = pull(['--from', repo.dir, '--out', out, '--pin-file', pin]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(files(out), [
      'clips/_inputs/strum.mp3',
      'clips/tester.echo.mp3',
      'clips/tester.keys.mp3',
      'community-index.json',
      'devices/tester.echo.overdub-device.json',
      'devices/tester.keys.overdub-device.json',
    ]);
    assert.deepEqual(fs.readFileSync(path.join(out, 'clips/tester.echo.mp3')), CLIP);
    assert.match(r.stderr, /built\.checks is null/, 'a null checks field is a warning, not a refusal');
  });

  test('replaces what was in the out dir', () => {
    const out = path.join(tmp, 'replace-out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'stale.mp3'), 'x');
    assert.equal(main(['--from', repo.dir, '--out', out, '--pin', repo.c2, '--pin-file', path.join(tmp, 'replace-pin.json')], () => {}, () => {}), 0);
    assert.ok(!files(out).includes('stale.mp3'));
  });

  test('a short SHA in built.from is matched by prefix, and the index may be committed after it was built', () => {
    const v = verify(repo.dir, repo.c2);
    assert.equal(v.commit, repo.c2);
    assert.equal(v.devices, 2);
    assert.equal(v.clips, 3);
  });

  test('a later commit that leaves devices/, revoked.json and picks.json alone still pins', () => {
    repo.write('README.md', 'docs only\n');
    const c3 = repo.commit('docs');
    assert.equal(verify(repo.dir, c3).commit, c3);
  });
});

describe('refusals write nothing', () => {
  test("an index whose SHA-256 isn't the pin's", () => {
    const out = path.join(tmp, 'bad-sha-out');
    const pin = pinFile('bad-sha', { repo: 'x', commit: repo.c2, index_sha256: '0'.repeat(64) });
    const r = pull(['--from', repo.dir, '--out', out, '--pin-file', pin]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refused: the index at .* hashes to [0-9a-f]{64}, not the pin's 0{64}/);
    assert.deepEqual(files(out), []);
  });

  test("a device file whose kernel isn't its entry's", () => {
    const c = repo.git('rev-parse', 'HEAD');
    repo.write('index/devices/tester.echo.overdub-device.json', JSON.stringify({ device: { id: 'tester.echo', kernel: KERNELS['tester.keys'] } }));
    const bad = repo.commit('swap a device file');
    const out = path.join(tmp, 'swap-out');
    const r = pull(['--from', repo.dir, '--out', out, '--pin', bad, '--pin-file', path.join(tmp, 'swap-pin.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tester\.echo: the kernel in devices\/tester\.echo\.overdub-device\.json hashes to/);
    assert.deepEqual(files(out), []);
    assert.ok(!fs.existsSync(path.join(tmp, 'swap-pin.json')), 'no pin written');
    repo.git('reset', '-q', '--hard', c);
  });

  test('built.from with +dirty', () => {
    const c = repo.git('rev-parse', 'HEAD');
    const bad = repo.writeIndex((j) => { j.built.from += '+dirty'; });
    refused(() => verify(repo.dir, bad), /uncommitted edits/);
    repo.git('reset', '-q', '--hard', c);
  });

  test("built.from that isn't an ancestor of the pin", () => {
    const c = repo.git('rev-parse', 'HEAD');
    repo.git('checkout', '-q', '-b', 'side', repo.c1);
    repo.write('LICENSE', 'side\n');
    const side = repo.commit('side');
    repo.git('checkout', '-q', '-');
    const bad = repo.writeIndex((j) => { j.built.from = `overdub-devices@${side.slice(0, 7)}`; });
    refused(() => verify(repo.dir, bad), /isn't .* or an ancestor of it/);
    repo.git('reset', '-q', '--hard', c);
  });

  test('a change to devices/, revoked.json or picks.json since built.from', () => {
    const c = repo.git('rev-parse', 'HEAD');
    for (const [rel, body] of [['devices/tester/echo/README.md', 'new\n'], ['revoked.json', '[{"sha256":"' + 'a'.repeat(64) + '"}]\n'], ['picks.json', '{ "picks": ["tester.echo"] }\n']]) {
      repo.write(rel, body);
      const bad = repo.commit(`change ${rel}`);
      refused(() => verify(repo.dir, bad), /changed between built\.from .* the index is stale/);
      repo.git('reset', '-q', '--hard', c);
    }
  });

  test('a listed entry whose fingerprint is revoked', () => {
    const c = repo.git('rev-parse', 'HEAD');
    const bad = repo.writeIndex((j) => { j.revoked = [{ sha256: kernelHash(KERNELS['tester.echo']), reason: 'x', at: '2026-10-10' }]; });
    refused(() => verify(repo.dir, bad), /tester\.echo is listed, but its fingerprint .* is on the revoked list/);
    repo.git('reset', '-q', '--hard', c);
  });

  test('a commit the checkout doesn\'t have is unavailable (exit 3), not refused', () => {
    const r = pull(['--from', repo.dir, '--out', path.join(tmp, 'gone-out'), '--pin-file', pinFile('gone', { repo: 'x', commit: 'f'.repeat(40), index_sha256: '0'.repeat(64) })]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /unavailable: f{40} isn't a commit/);
    const none = pull(['--from', path.join(tmp, 'nowhere'), '--out', path.join(tmp, 'gone-out'), '--pin-file', pinFile('gone2', { repo: 'x', commit: repo.c2, index_sha256: '0'.repeat(64) })]);
    assert.equal(none.status, 3);
    assert.deepEqual(files(path.join(tmp, 'gone-out')), []);
  });
});

describe('--pin', () => {
  test('writes the pin, and the summary lists what was added, changed and taken down since the last one', () => {
    const pf = path.join(tmp, 'summary-pin.json');
    const out = path.join(tmp, 'summary-out');
    const lines = [];
    main(['--from', repo.dir, '--out', out, '--pin', repo.c2, '--pin-file', pf], (l) => lines.push(l), () => {});
    const first = JSON.parse(fs.readFileSync(pf, 'utf8'));
    assert.deepEqual(Object.keys(first), ['repo', 'commit', 'index_sha256']);
    assert.equal(first.repo, 'overdubstudio/overdub-devices');
    assert.equal(first.commit, repo.c2);
    assert.match(lines.join('\n'), /no previous pin[\s\S]*\*\*Added\*\*\n- Test Echo \(`tester\.echo`, [0-9a-f]{12}\)\n- Test Keys/);

    // the next shelf: Test Keys revoked (and so unlisted), Test Echo's code changed, Test Drive added
    const c = repo.git('rev-parse', 'HEAD');
    const kernel = 'return { process(io) { io.out.set(io.in); /* v2 */ } };';
    const drive = 'return { process(io) { io.out.set(io.in.map((x) => Math.tanh(x))); } };';
    repo.write('devices/tester/echo/device.json', JSON.stringify({ device: { id: 'tester.echo', kernel } }));
    repo.write('devices/tester/drive/device.json', JSON.stringify({ device: { id: 'tester.drive', kernel: drive } }));
    repo.write('revoked.json', JSON.stringify([{ sha256: kernelHash(KERNELS['tester.keys']), reason: 'It did something it shouldn\'t.', at: '2026-10-11' }]));
    const inputs = repo.commit('next devices');
    repo.write('index/devices/tester.echo.overdub-device.json', JSON.stringify({ device: { id: 'tester.echo', kernel } }));
    repo.write('index/devices/tester.drive.overdub-device.json', JSON.stringify({ device: { id: 'tester.drive', kernel: drive } }));
    repo.write('index/clips/tester.drive.mp3', CLIP);
    const next = repo.writeIndex((j) => {
      j.built.from = `overdub-devices@${inputs.slice(0, 9)}`;
      const keys = j.devices.find((e) => e.id === 'tester.keys');
      j.revoked = [{ sha256: keys.sha256, reason: 'It did something it shouldn\'t.', at: '2026-10-11' }];
      const echo = j.devices.find((e) => e.id === 'tester.echo');
      echo.sha256 = kernelHash(kernel);
      j.devices = [echo, { ...echo, id: 'tester.drive', name: 'Test Drive', sha256: kernelHash(drive), device: 'devices/tester.drive.overdub-device.json', preview: { ...echo.preview, wet: { clips: [{ src: 'clips/tester.drive.mp3', type: 'audio/mpeg', bytes: CLIP.length }] } } }];
    });
    lines.length = 0;
    main(['--from', repo.dir, '--out', out, '--pin', next, '--pin-file', pf], (l) => lines.push(l), () => {});
    const text = lines.join('\n');
    assert.match(text, new RegExp(`overdub-devices@${repo.c2.slice(0, 7)} → overdub-devices@${next.slice(0, 7)}`));
    assert.match(text, /\*\*Added\*\*\n- Test Drive \(`tester\.drive`, [0-9a-f]{12}\)\n\n/);
    assert.match(text, /\*\*Changed\*\*\n- Test Echo \(`tester\.echo`, [0-9a-f]{12}\): new code, was [0-9a-f]{12}\n\n/);
    assert.match(text, /\*\*Taken down\*\*\n- Test Keys \(`tester\.keys`, [0-9a-f]{12}\): revoked, "It did something it shouldn't\."$/);
    assert.equal(JSON.parse(fs.readFileSync(pf, 'utf8')).commit, next);
    repo.git('reset', '-q', '--hard', c);
  });

  test('summarize: an unlisted device, and a listing-only change', () => {
    const a = { devices: [{ id: 'x.a', name: 'A', sha256: '1'.repeat(64), blurb: 'one' }, { id: 'x.b', name: 'B', sha256: '2'.repeat(64) }] };
    const b = { devices: [{ id: 'x.a', name: 'A', sha256: '1'.repeat(64), blurb: 'two' }], revoked: [] };
    const s = summarize(a, b);
    assert.deepEqual(s.added, []);
    assert.deepEqual(s.changed, ['A (`x.a`, 111111111111): the listing only (same code)']);
    assert.deepEqual(s.down, ['B (`x.b`, 222222222222): unlisted']);
  });
});

test('untar reads a pax long name', () => {
  const name = `index/${'d'.repeat(120)}.json`;
  const rec = (k, v) => {
    const body = ` ${k}=${v}\n`;
    let n = body.length + 1;
    n += String(n).length - 1;
    return `${n}${body}`;
  };
  const header = (nm, size, type) => {
    const h = Buffer.alloc(512);
    h.write(nm.slice(0, 99), 0);
    h.write(size.toString(8).padStart(11, '0'), 124);
    h.write(type, 156);
    return h;
  };
  const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const pax = Buffer.from(rec('path', name));
  const tar = Buffer.concat([header('PaxHeader', pax.length, 'x'), pad(pax), header('short', 2, '0'), pad(Buffer.from('ok')), Buffer.alloc(1024)]);
  assert.deepEqual([...untar(tar).keys()], [name]);
});
