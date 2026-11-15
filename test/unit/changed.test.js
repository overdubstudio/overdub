// tools/changed.js picks the suites a push runs (node tools/run-all.js --changed): what it leaves out is what a branch's
// "suites" check never ran, so every rule that can't be sure has to fall to everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick } from '../../tools/changed.js';

const SUITES = ['a-test.js', 'b-test.js', 'c-test.js', 'd-test.js', 'e-test.js', 'unit-test.js'];
// what's in tools/ (path -> text): a and b share a helper; b spawns a script by name; c stands alone
const TOOLS = new Map([
  ['tools/a-test.js', "import { h } from './lib/helper.js';"],
  ['tools/b-test.js', "import { h } from './lib/helper.js'; spawn(process.execPath, [path.join(HERE, 'render.js')]);"],
  ['tools/unit-test.js', "spawnSync('node', ['--test'])"],
  ['tools/lib/helper.js', "import { deep } from './deep.js';"],
  ['tools/lib/deep.js', 'export const deep = 1;'],
  ['tools/render.js', "import '../app/src/core/x.js';"],
  ['tools/orphan.js', 'export const nobody = 1;'],
  ['tools/fixtures/b.wav', ''],
  [
    'tools/room/suite.js',
    '// runs tools/room/checks-*.js, each found by name\nfs.readdirSync(HERE).filter((f) => /^checks-/.test(f))',
  ],
  ['tools/room/checks-band.js', 'export const checks = [];'],
  ['tools/c-test.js', "import { runSuite } from './room/suite.js'; import { open } from './pw.js';"],
  ['tools/pw.js', '// Shared harness. Every *-test.js in tools/ uses this.'],
  ['tools/e-test.js', "import { open } from './pw.js';"],
  [
    'tools/d-test.js',
    "// the room's model checks are in tools/room/checks-band.js\n/* and lib/deep.js */ const url = 'http://x/y'; console.log('  ok');",
  ],
]);
const run = (files) => pick({ files, suites: SUITES, tools: TOOLS });
const names = (r) => [...r.suites.keys()].sort();

test('a change to a suite runs that suite, and the unit suite (which runs on any change)', () => {
  const r = run(['tools/c-test.js']);
  assert.equal(r.all, false);
  assert.deepEqual(names(r), ['c-test.js', 'unit-test.js']);
});

test('a helper runs every suite that reaches it, through helpers in between', () => {
  assert.deepEqual(names(run(['tools/lib/deep.js'])), ['a-test.js', 'b-test.js', 'unit-test.js']);
});

test('a script a suite names (spawned, not imported) runs that suite', () => {
  assert.deepEqual(names(run(['tools/render.js'])), ['b-test.js', 'unit-test.js']);
});

test('a glob names the files it matches: a runner that lists its folder says which', () => {
  assert.deepEqual(names(run(['tools/room/checks-band.js'])), ['c-test.js', 'unit-test.js']);
  assert.deepEqual(names(run(['tools/room/checks-new.js'])), ['c-test.js', 'unit-test.js']);
});

test('the search stops at a suite: what names a suite (a harness, by *-test.js) is not what the change reaches', () => {
  assert.deepEqual(names(run(['tools/room/checks-band.js'])), ['c-test.js', 'unit-test.js']);
});

test('a file named only in a comment is not loaded by it', () => {
  assert.deepEqual(names(run(['tools/room/checks-band.js'])), ['c-test.js', 'unit-test.js']);
  assert.deepEqual(names(run(['tools/lib/deep.js'])), ['a-test.js', 'b-test.js', 'unit-test.js']);
});

test('a tools file no suite names runs everything: it may be reached in a way this cannot see', () => {
  const r = run(['tools/orphan.js']);
  assert.equal(r.all, true);
  assert.match(r.why, /tools\/orphan\.js/);
});

test('the studio, the server, docs and the harness run everything', () => {
  for (const f of [
    'app/src/core/ops.js',
    'server/serve.js',
    'docs/GUIDE.md',
    'site/index.html',
    'tools/run-all.js',
    'tools/pw.js',
    'tools/suite-status.js',
    'tools/changed.js',
    'tools/fetch-kits.js',
    'tools/golden.json',
    'tools/kits/x/kit.json',
    'mise.toml',
    'package.json',
    '.github/workflows/suites.yml',
    'deploy/deploy.sh',
    'README.md',
  ])
    assert.equal(run([f]).all, true, f);
});

test('one file that runs everything outweighs any number that do not', () => {
  assert.equal(run(['tools/c-test.js', 'app/src/main.js']).all, true);
});

test('prose, other workflows and the unit tests run the unit suite alone (it reads workflows and docs)', () => {
  for (const f of [
    'CONTRIBUTING.md',
    'CLAUDE.md',
    'notes/x.md',
    '.github/workflows/ci.yml',
    '.github/dependabot.yml',
    'test/unit/changed.test.js',
  ])
    assert.deepEqual(names(run([f])), ['unit-test.js'], f);
});

test('README.md, the docs, the site, design, integrations and infra are read by suites: they run everything', () => {
  for (const f of [
    'README.md',
    'docs/GUIDE.md',
    'docs/research/x.md',
    'site/assets/social/README.md',
    'design/LINER-NOTES-KIT.md',
    'integrations/README.md',
    'infra/live/cdn.tf',
  ])
    assert.equal(run([f]).all, true, f);
});

test('a deleted suite runs nothing for itself', () => {
  assert.deepEqual(names(run(['tools/gone-test.js'])), ['unit-test.js']);
});

test('no change runs nothing', () => {
  const r = run([]);
  assert.equal(r.all, false);
  assert.equal(r.suites.size, 0);
});

test('each picked suite says which change picked it', () => {
  assert.match(run(['tools/lib/deep.js']).suites.get('a-test.js'), /tools\/lib\/deep\.js/);
});
