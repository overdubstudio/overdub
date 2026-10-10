// A small overdub-devices repo, made with git in a directory you give it, for tools/community-pull.js's checks
// (test/unit/community-pull.test.js and tools/community-test.js's dry deploy). Two devices, their inputs committed
// first (c1), then the index built from c1 and committed (c2), as overdub-devices does. Nothing here is a real device.
//
//   makeDevicesRepo(dir) -> repo
//     repo.dir, repo.c1, repo.c2           the inputs commit and the index commit (full SHAs)
//     repo.index()                          the index as committed at HEAD (parsed)
//     repo.sha(file)                        SHA-256 of a file in the working tree
//     repo.write(rel, text | Buffer), repo.commit(msg) -> sha, repo.git(...args) -> stdout
//     repo.writeIndex(mutate)               rewrite index/community-index.json through mutate(index), and commit it
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { kernelHash } from '../../app/src/devices/trust.js';

export const KERNELS = {
  'tester.echo': 'return { process(io) { io.out.set(io.in); } };',
  'tester.keys': 'return { process(io) { io.out.fill(0); } };',
};
export const CLIP = Buffer.alloc(4096, 7); // not audio: the pull never decodes a clip
export const INPUT = Buffer.alloc(2048, 9);

const entry = (id, name, kind) => ({
  id, name, kind, cat: kind === 'effect' ? 'time' : 'keys', tier: 'community',
  author: { handle: 'tester', alias: null }, agent: 'Claude Opus 5.5', requester: 'tester', request: 'A test device.',
  license: 'MIT-0', sha256: kernelHash(KERNELS[id]), added: '2026-10-10',
  preview: { input: 'strum', seconds: 6, lufs: -18, dry: 'strum', wet: { clips: [{ src: `clips/${id}.mp3`, type: 'audio/mpeg', bytes: CLIP.length }, { src: `clips/${id}.wav`, type: 'audio/wav', bytes: 1152044 }] } },
  device: `devices/${id}.overdub-device.json`,
});

export function makeDevicesRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  const write = (rel, body) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  const commit = (msg) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  for (const id of Object.keys(KERNELS)) write(`devices/tester/${id.split('.')[1]}/device.json`, JSON.stringify({ format: 'overdub-device/0', device: { id, kernel: KERNELS[id] } }, null, 2));
  write('revoked.json', '[]\n');
  write('picks.json', '{ "picks": [] }\n');
  const c1 = commit('devices');
  const index = {
    format: 'overdub-community-index/1',
    built: { from: `overdub-devices@${c1.slice(0, 7)}`, at: '2026-10-10T00:00:00Z', checks: null },
    repo: null,
    inputs: { strum: { seconds: 6, lufs: -18, clips: [{ src: 'clips/_inputs/strum.mp3', type: 'audio/mpeg', bytes: INPUT.length }] } },
    revoked: [],
    devices: [entry('tester.echo', 'Test Echo', 'effect'), entry('tester.keys', 'Test Keys', 'instrument')],
  };
  for (const id of Object.keys(KERNELS)) {
    write(`index/devices/${id}.overdub-device.json`, JSON.stringify({ format: 'overdub-device/0', device: { id, kernel: KERNELS[id] } }, null, 2));
    write(`index/clips/${id}.mp3`, CLIP);
    write(`index/clips/${id}.wav`, Buffer.alloc(64, 1)); // committed here to show the pull leaves WAVs behind
  }
  write('index/clips/_inputs/strum.mp3', INPUT);
  write('index/NOTES.txt', 'not part of the shelf\n');
  write('index/community-index.json', JSON.stringify(index, null, 2) + '\n');
  const c2 = commit('index');
  const repo = {
    dir, c1, c2, git, write, commit,
    index: () => JSON.parse(fs.readFileSync(path.join(dir, 'index/community-index.json'), 'utf8')),
    sha: (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex'),
    writeIndex(mutate) {
      const j = repo.index();
      write('index/community-index.json', JSON.stringify(mutate(j) || j, null, 2) + '\n');
      return commit('index again');
    },
  };
  return repo;
}
