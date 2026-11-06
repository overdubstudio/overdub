// The two sites' deploys, the part CI can check: what infra/live promises, read from its HCL; the config the studio's
// policy has to allow; and the scripts' refusals, which stop before any kit is read. A stub aws comes first on PATH and
// there are no credentials, so nothing here reaches AWS. Whole dry deploys (which read every kit, and name HEAD~1, which
// a shallow checkout hasn't got) are tools/analytics-test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-sites-'));
after(() => fs.rmSync(stub, { recursive: true, force: true }));
fs.writeFileSync(path.join(stub, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });

const env = {
  ...process.env,
  PATH: `${stub}${path.delimiter}${process.env.PATH}`,
  DRY_RUN: '1',
  AWS_CONFIG_FILE: '/dev/null',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  DEPLOY_ENV: '/dev/null',
  SITE_CONFIG: '/dev/null',
  NEXT_CONFIG: '/dev/null',
  COMMUNITY_PIN: '/dev/null',
};
for (const k of [
  'AWS_PROFILE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'NEXT_ZONE',
  'NEXT_OAC',
  'NEXT_CERT',
  'OAC',
  'ZONE',
  'CERT',
  'REF',
  'LIVE_DISTRIBUTION',
  'LOCAL_LIVE_DEPLOY',
  'GITHUB_ACTIONS',
])
  delete env[k];
const run = (script, extra, ...args) => {
  const r = spawnSync('bash', [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout;
const committed = (f) => JSON.parse(git('show', `HEAD:${f}`) || 'null');

// Both sites' AWS is Terraform's (infra/live, infra/next): what the live site's directory promises, read from its HCL
// (tools/check.sh validates it; the plan itself needs credentials)
const hcl = (f) => fs.readFileSync(path.join(ROOT, 'infra/live', f), 'utf8');
const cdn = hcl('cdn.tf');
const dns = hcl('dns.tf');
const gh = hcl('github.tf');
const bucket = hcl('bucket.tf');
const vars = hcl('variables.tf');

// on by default since the cutover (2026-10-14, #30); false still restores the pre-cutover shape
test('infra/live: the cutover is one variable, serve_names, on by default since the cutover (false gives the distribution no names and the default certificate, and keeps the apex and www records on the old distribution)', () => {
  assert.ok(
    /variable "serve_names"[\s\S]*?default\s*=\s*true/.test(vars) &&
      /aliases\s*=\s*var\.serve_names \? \[var\.domain, "www\.\$\{var\.domain\}"\] : \[\]/.test(cdn) &&
      /cloudfront_default_certificate = !var\.serve_names/.test(cdn) &&
      /site_target = var\.serve_names \?/.test(dns) &&
      /var\.old_distribution_domain/.test(dns),
  );
});
test("infra/live: until the cutover the path-rewrite function also serves the distribution's cloudfront.net name (CLOUDFRONT_NAME)", () => {
  assert.ok(
    /"var CLOUDFRONT_NAME = \$\{var\.serve_names \? "false" : "true"\};"/.test(cdn) &&
      /path-rewrite\.js/.test(cdn) &&
      /name\s*=\s*"overdub-path-rewrite"/.test(cdn),
  );
});
test("infra/live: the deploy role reuses infra/next's OIDC provider and trusts one subject, <prefix>:environment:production", () => {
  assert.ok(
    /data "aws_iam_openid_connect_provider" "github"/.test(gh) &&
      !/resource "aws_iam_openid_connect_provider"/.test(gh) &&
      /"token\.actions\.githubusercontent\.com:sub" = "\$\{var\.github_sub_claim_prefix\}:environment:\$\{var\.deploy_environment\}"/.test(
        gh,
      ) &&
      !/StringLike/.test(gh) &&
      /variable "deploy_environment"[\s\S]*?default\s*=\s*"production"/.test(vars),
  );
});
test('infra/live: private buckets for the site (read only by its distribution) and the stems model', () => {
  assert.ok(
    /site\s*=\s*var\.domain/.test(bucket) &&
      /models = "overdub-models-\$\{local\.account_id\}"/.test(bucket) &&
      /block_public_policy\s*=\s*true/.test(bucket) &&
      /"AWS:SourceArn" = aws_cloudfront_distribution\.live\.arn/.test(bucket),
  );
});
test("deploy/live-config.json takes the model from infra/live's models bucket", () => {
  assert.ok(
    /s3:\/\/overdub-models-800849967977\//.test(fs.readFileSync(path.join(ROOT, 'deploy/live-config.json'), 'utf8')) &&
      /account_id = "800849967977"/.test(bucket),
  );
});

// the Athena half of the counts, dry; and it refuses AJ's personal account (a stub that answers sts with it)
test('deploy/analytics/setup.sh, dry: the Athena database, table and view', () => {
  const logs = run('deploy/analytics/setup.sh');
  assert.ok(
    logs.status === 0 &&
      !/aws was called/.test(logs.out) &&
      /CREATE DATABASE IF NOT EXISTS overdub/.test(logs.out) &&
      /CREATE OR REPLACE VIEW overdub\.events/.test(logs.out),
    `exit ${logs.status}`,
  );
});
test("deploy/analytics/setup.sh refuses AJ's personal account before anything else", () => {
  const personal = path.join(stub, 'personal');
  fs.mkdirSync(personal);
  fs.writeFileSync(
    path.join(personal, 'aws'),
    '#!/bin/sh\ncase "$*" in "sts get-caller-identity"*) echo 165604225334; exit 0;; esac\necho "aws was called: $*" >&2\nexit 97\n',
    { mode: 0o755 },
  );
  const own = run('deploy/analytics/setup.sh', {
    DRY_RUN: '',
    PATH: `${personal}${path.delimiter}${process.env.PATH}`,
  });
  assert.ok(
    own.status === 1 &&
      /refusing: these credentials are AJ's personal account/.test(own.out) &&
      !/aws was called/.test(own.out),
    `exit ${own.status}`,
  );
});

// the live site from GitHub Actions only (deploy-live.yml); LOCAL_LIVE_DEPLOY=1 is the hatch, a dry run needs neither
test('a live deploy off GitHub Actions, without LOCAL_LIVE_DEPLOY=1, is refused before anything is staged or called', () => {
  const refused = run('deploy/deploy.sh', { DRY_RUN: '' }, '--skip-tests');
  assert.ok(
    refused.status === 1 &&
      /not deploying: the live site deploys from GitHub Actions/.test(refused.out) &&
      !/aws was called/.test(refused.out) &&
      !/\+ aws/.test(refused.out),
    `exit ${refused.status}`,
  );
});
// a base that isn't a JSON object stops a live deploy before anything is planned
test("a base that isn't a JSON object stops a live deploy", () => {
  const base = path.join(stub, 'site-config.json');
  fs.writeFileSync(base, '[1]');
  const badLive = run('deploy/deploy.sh', { SITE_CONFIG: base }, '--skip-tests');
  assert.ok(
    badLive.status !== 0 &&
      /not deploying: .* is not a JSON object/.test(badLive.out) &&
      !/aws (s3|cloudfront)/.test(badLive.out),
    `exit ${badLive.status}`,
  );
});

test('the site config is never committed: deploy.sh writes it', () => {
  const tracked = git('ls-files', 'app/site-config.json', 'deploy/site-config.json').trim();
  const ignored =
    git('check-ignore', 'app/site-config.json', 'deploy/site-config.json').trim().split('\n').length === 2;
  assert.ok(!tracked && ignored, `${tracked || 'untracked'}, ${ignored ? 'ignored' : 'not ignored'}`);
});

// the studio's policy lets it reach every cloud origin a committed config names, and the comment says why
test("app/index.html's connect-src names every cloud origin the committed configs name, and its comment says why", () => {
  const page = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page)?.[1] || '';
  const connect = (/connect-src ([^;]*)/.exec(policy)?.[1] || '').split(/\s+/);
  const named = [committed('deploy/next-config.json'), committed('deploy/live-config.json')]
    .flatMap((c) => [c?.cloud?.api, c?.accounts?.api])
    .filter(Boolean);
  const comment = (/<!--([\s\S]*?)-->/.exec(page)?.[1] || '').replace(/\s+/g, ' ');
  assert.ok(
    named.length &&
      named.every((o) => connect.includes(new URL(o).origin) && comment.includes(`connect-src ${new URL(o).origin}`)),
    named.join(', '),
  );
});
