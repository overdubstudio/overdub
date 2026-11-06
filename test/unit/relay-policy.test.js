// What the hosted relay needs before it faces anyone, none of it a running relay (moved from tools/relay-test.js, which
// has the relay end to end): its catalog is the generated one and every tool in it annotated; the page's policy lets
// the tab reach it; the deploy, dry, keeps the origin secret out of the SSM command and infra/live keeps it a
// SecureString; and server/relay.js's own helpers (the token, rate-limit keys, claude.ai's range, the log redactor). A
// stub aws comes first on PATH and there are no credentials, so nothing here can reach AWS whatever the script does.
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as relayMod from '../../server/relay.js';
import { checks } from './helpers/check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// The pair a studio makes (docs/REMOTE-MCP.md): the connector token made from the tab's secret one way.
const derive = (secret) =>
  crypto.createHash('sha256').update(`overdub-relay-token/v1:${secret}`).digest('base64url').slice(0, 22);
const RELAY = /export const RELAY = '([^']+)'/.exec(read('app/src/agent/remote.js'))?.[1];

test('the catalog the relay lists is generated, and every tool in it annotated', () => {
  const t = checks();
  // the catalog the relay lists is a generated file, current with the studio's (tools.js catalogSchemas())
  const chk = spawnSync(process.execPath, [path.join(ROOT, 'tools/relay-catalog.js'), '--check'], { encoding: 'utf8' });
  t.ok(
    chk.status === 0,
    `server/relay-catalog.json is tools.js's catalog, generated (node tools/relay-catalog.js --check): ${(chk.stdout + chk.stderr).trim().split('\n').pop().slice(0, 160)}`,
  );
  // every tool in it has its annotations (a title and four hints), and the relay won't start on a catalog with a tool
  // that has none: it names the tool
  const shipped = JSON.parse(read('server/relay-catalog.json'));
  const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
  const bareIn = shipped
    .filter(
      (x) =>
        !(
          x.annotations &&
          typeof x.annotations.title === 'string' &&
          x.annotations.title &&
          HINTS.every((k) => typeof x.annotations[k] === 'boolean')
        ),
    )
    .map((x) => x.name);
  const tmpCat = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-cat-')), 'catalog.json');
  fs.writeFileSync(
    tmpCat,
    JSON.stringify([...shipped, { name: 'jam_probe', description: 'probe', input_schema: { type: 'object' } }]),
  );
  let refused = '';
  try {
    relayMod.loadCatalog(tmpCat);
  } catch (e) {
    refused = e.message;
  }
  fs.rmSync(path.dirname(tmpCat), { recursive: true, force: true });
  t.ok(
    shipped.length && !bareIn.length && /jam_probe has no annotations/.test(refused),
    `every tool in server/relay-catalog.json has a title and its four hints (${shipped.length}${bareIn.length ? `; not: ${bareIn.join(', ')}` : ''}), and the relay won't load one without: "${refused}"`,
  );
  t.done();
});

test("the page's policy lets the tab reach the hosted relay", () => {
  const t = checks();
  const html = read('app/index.html');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] || '';
  const connect = (/connect-src ([^;]*)/.exec(csp)?.[1] || '').split(/\s+/);
  const why = (/<!--([\s\S]*?)-->/.exec(html)?.[1] || '').replace(/\s+/g, ' ');
  t.ok(
    !!RELAY && connect.includes(RELAY) && why.includes(`connect-src ${RELAY}`) && /Connect to Claude/.test(why),
    `app/index.html's connect-src allows the relay (${RELAY}), and the comment there says why (${connect.join(' ')})`,
  );
  t.done();
});

test('the deploy, dry: the origin secret is read on the instance, never put in the SSM command', () => {
  const t = checks();
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-dry-'));
  fs.writeFileSync(path.join(stub, 'aws'), '#!/bin/sh\necho "aws was called: $*" >&2\nexit 97\n', { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${stub}${path.delimiter}${process.env.PATH}`,
    DRY_RUN: '1',
    AWS_CONFIG_FILE: '/dev/null',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    DEPLOY_ENV: '/dev/null',
  };
  for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete env[k];
  const dry = spawnSync('bash', [path.join(ROOT, 'deploy/relay/deploy.sh'), '--skip-tests'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
  fs.rmSync(stub, { recursive: true, force: true });
  const out = (dry.stdout || '') + (dry.stderr || '');
  t.ok(
    dry.status === 0 && !/aws was called/.test(out),
    `deploy/relay/deploy.sh with DRY_RUN=1 builds the release without calling AWS (exit ${dry.status})`,
  );
  const envLine = out.split('\n').find((l) => l.includes('/etc/overdub-relay.env') && l.includes('printf')) || '';
  t.ok(
    /aws ssm get-parameter [^\n]*--name \/overdub\/relay\/origin-secret[^\n]*--with-decryption/.test(out) &&
      /"RELAY_ORIGIN_SECRET=\$SECRET"/.test(envLine) &&
      !/dryrun-secret/.test(out),
    `the deploy command carries no origin secret: the instance reads it from Parameter Store (/overdub/relay/origin-secret) as the command runs (${envLine.trim().slice(0, 110)})`,
  );
  t.done();
});

// its AWS is Terraform's (infra/live/relay.tf): the secret a SecureString only the instance's role may read,
// CloudFront's header from the same value, and the name the studio talks to
test("the relay's AWS keeps the secret, and its name is the studio's RELAY", () => {
  const t = checks();
  const tf = read('infra/live/relay.tf');
  const vars = read('infra/live/variables.tf');
  const relayName = /variable "relay_domain"[\s\S]*?default\s*=\s*"([^"]+)"/.exec(vars)?.[1];
  t.ok(
    /type\s*=\s*"SecureString"/.test(tf) &&
      /Action = "ssm:GetParameter", Resource = aws_ssm_parameter\.origin_secret\.arn/.test(tf) &&
      /name\s*=\s*"x-overdub-origin"\s*\n\s*value\s*=\s*random_password\.origin_secret\.result/.test(tf) &&
      /"\/overdub\/relay\/origin-secret"/.test(tf) &&
      `https://${relayName}` === RELAY &&
      spawnSync('bash', ['-n', path.join(ROOT, 'deploy/relay/deploy.sh')]).status === 0,
    `infra/live/relay.tf keeps the secret as a SecureString the instance may read and gives CloudFront the same value; its relay_domain is RELAY (${relayName})`,
  );
  t.done();
});

test("the relay's own helpers", () => {
  const t = checks();
  const { addressKey, inRanges, redact, tokenFor } = relayMod;
  const s0 = crypto.randomBytes(32).toString('base64url');
  t.ok(
    typeof tokenFor === 'function' && tokenFor(s0) === derive(s0) && /^[A-Za-z0-9_-]{22}$/.test(derive(s0)),
    'the relay makes the token from a secret the documented way (SHA-256 with a prefix, 22 characters)',
  );
  const keys = [
    addressKey('2001:db8:1:2::1'),
    addressKey('2001:db8:1:2:ffff:ffff:ffff:9'),
    addressKey('2001:db8:1:3::1'),
    addressKey('203.0.113.7'),
    addressKey('::ffff:203.0.113.7'),
    addressKey('203.0.113.8'),
  ];
  t.ok(
    keys[0] === keys[1] && keys[0] !== keys[2] && keys[3] === keys[4] && keys[3] !== keys[5],
    `rate limits key IPv6 by its /64 and IPv4 by its address (${keys.join(' | ')})`,
  );
  t.ok(
    inRanges('160.79.104.9', ['160.79.104.0/21']) &&
      inRanges('160.79.111.250', ['160.79.104.0/21']) &&
      !inRanges('160.79.112.1', ['160.79.104.0/21']) &&
      inRanges('::ffff:160.79.105.1', ['160.79.104.0/21']) &&
      inRanges('2607:6bc0::1', ['2607:6bc0::/48']),
    "claude.ai's published range (160.79.104.0/21) is recognised, IPv4-mapped too",
  );
  const line = redact(`failed for /s/${derive(s0)}/hello with ${s0}, session ${crypto.randomUUID()}`);
  t.ok(
    !!line && !line.includes(s0) && !line.includes(derive(s0)) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(line),
    `a log line loses anything shaped like a token, secret or session id: "${line}"`,
  );
  t.done();
});
