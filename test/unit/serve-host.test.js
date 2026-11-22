// Where server/serve.js listens and which names it answers to. On a machine it is 127.0.0.1 and localhost or an IP,
// nothing else (DNS rebinding: docs/SECURITY.md, "Local"). The preview image (Dockerfile) is the one place that asks
// for more: OVERDUB_HOST=0.0.0.0 to be reached from outside its container, and OVERDUB_ANY_HOST=1 because a preview is
// asked for by its own name, which no one knows until it exists. Each server is on a free port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../../server/serve.js';

const PREVIEW = 'overdub-12.preview.example.com';
// a GET for the landing page, asked for by that name (fetch won't send a Host of its own choosing)
const get = (port, host) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
// run with these variables set, then put them back as they were
async function withEnv(vars, run) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('by default: 127.0.0.1, and only localhost or an IP is answered', async () => {
  const srv = await withEnv({ OVERDUB_HOST: '', OVERDUB_ANY_HOST: '' }, () => startServer({ port: 0, quiet: true }));
  try {
    assert.equal(srv.server.address().address, '127.0.0.1', 'it listens on 127.0.0.1');
    assert.equal(await get(srv.port, `localhost:${srv.port}`), 200, 'localhost is answered');
    assert.equal(await get(srv.port, `10.42.0.7:${srv.port}`), 200, 'an IP is answered');
    assert.equal(await get(srv.port, PREVIEW), 403, 'another name is refused');
  } finally {
    await srv.close();
  }
});

test('anyHost answers a request made to any name', async () => {
  const srv = await startServer({ port: 0, quiet: true, anyHost: true });
  try {
    assert.equal(await get(srv.port, PREVIEW), 200, 'the preview name is answered');
    assert.equal(await get(srv.port, `localhost:${srv.port}`), 200, 'and so is localhost');
  } finally {
    await srv.close();
  }
});

test('OVERDUB_HOST and OVERDUB_ANY_HOST=1 are the same two things from the environment', async () => {
  const srv = await withEnv({ OVERDUB_HOST: '0.0.0.0', OVERDUB_ANY_HOST: '1' }, () =>
    startServer({ port: 0, quiet: true }),
  );
  try {
    assert.equal(srv.server.address().address, '0.0.0.0', 'it listens where OVERDUB_HOST says');
    assert.equal(await get(srv.port, PREVIEW), 200, 'and answers the preview name');
  } finally {
    await srv.close();
  }
});

test('OVERDUB_ANY_HOST is on only as 1', async () => {
  const srv = await withEnv({ OVERDUB_ANY_HOST: 'true' }, () => startServer({ port: 0, quiet: true }));
  try {
    assert.equal(await get(srv.port, PREVIEW), 403, 'any other value leaves the check on');
  } finally {
    await srv.close();
  }
});
