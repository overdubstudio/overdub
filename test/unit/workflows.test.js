// The self-hosted runner (Peter's Mac mini, ghastly) runs whatever code the job checks out, on a real machine. This repo
// is public, so a job on it must never be reachable from an event an outsider can cause: a pull request from a fork
// (pull_request, pull_request_target), a comment, an issue. Every workflow that names a self-hosted runner may only be
// triggered by workflow_dispatch, push or schedule, which take write access to the repo (deploy-live.yml, its e2e job).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const ALLOWED = new Set(['workflow_dispatch', 'push', 'schedule']);

// No YAML parser (zero dependencies): the two shapes the workflows are written in are enough, and anything this can't
// read is a failure, not a pass.
function triggers(yml) {
  const lines = yml.split('\n');
  const i = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (i < 0) throw new Error('no top-level on:');
  const inline = lines[i]
    .replace(/^[^:]+:\s*/, '')
    .replace(/\s+#.*$/, '')
    .trim();
  if (inline)
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break; // the next top-level key
    const m = /^ {2}([A-Za-z_]+):?/.exec(l) || /^ {2}- ([A-Za-z_]+)/.exec(l);
    if (m) out.push(m[1]);
  }
  if (!out.length) throw new Error('on: has no events this check can read');
  return out;
}

const selfHosted = (yml) =>
  /runs-on:[^\n]*self-hosted|runs-on:\s*\n(\s+- [^\n]*\n)*\s+- self-hosted|overdub-e2e/.test(yml);

function check(yml) {
  if (!selfHosted(yml)) return [];
  return triggers(yml).filter((t) => !ALLOWED.has(t));
}

test('no workflow puts the self-hosted runner within reach of an outsider', () => {
  const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  const hosted = files.filter((f) => selfHosted(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8')));
  assert.ok(hosted.includes('deploy-live.yml'), 'deploy-live.yml runs the e2e job on the self-hosted runner');
  for (const f of hosted)
    assert.deepEqual(check(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8')), [], `${f}: events an outsider can cause`);
});

test('the check itself: what it refuses and what it lets through', () => {
  const job = 'jobs:\n  e2e:\n    runs-on: [self-hosted, macOS, ARM64, overdub-e2e]\n';
  assert.deepEqual(check(`on:\n  workflow_dispatch:\n    inputs: {}\n  push:\n    branches: [main]\n${job}`), []);
  assert.deepEqual(check(`on:\n  pull_request:\n  push:\n${job}`), ['pull_request']);
  assert.deepEqual(check(`on: [push, pull_request_target]\n${job}`), ['pull_request_target']);
  assert.deepEqual(check(`on: issue_comment\n${job}`), ['issue_comment']);
  assert.deepEqual(check(`on:\n  - push\n  - workflow_call\n${job}`), ['workflow_call']);
  assert.deepEqual(check(`on:\n  pull_request:\njobs:\n  a:\n    runs-on:\n      - self-hosted\n      - macOS\n`), [
    'pull_request',
  ]);
  // a hosted-runner workflow may run on pull requests
  assert.deepEqual(check('on:\n  pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n'), []);
  assert.throws(() => check(`name: x\n${job}`), /no top-level on/);
});
