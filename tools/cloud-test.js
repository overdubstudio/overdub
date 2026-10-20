// Claude on Overdub credits, the studio's side (agent/cloud.js, cloud-kind.js, cloud-panel.js, the 'cloud' provider in
// claude.js), against a fake of the service in this file (node:http): the public repo never depends on the private one.
// Off without a site config; signing in with Google (the popup, the done page's message, the poll); the balance in the head; the price on screen before
// any ask opens (typed, a suggestion, the tour, a direct send); a Claude of your own first; an ask streaming tool calls
// that run here, signed Claude; Stop, retries, out of credits, credits back on undo; free moves; nothing secret kept in
// the browser; the prompt bundle's version; back from a checkout (/app/?plus=done, /app/?plus=cancel). Songs in the
// account (ui/songs.js, against the fake's /v1/songs): off without them, signed out, no Plus, Save to cloud and the save
// as you work, a newer save made elsewhere, open, earlier saves, delete, a write whose answer is lost sent again as the
// same write, a song put aside and Undo, two tabs on one song, and My songs on a phone; Top up's plans, "on" beside the
// one bought. Browsers run muted
// (tools/pw.js QUIET). Screenshots: tools/.out/cloud-*.png.
//
//   node tools/cloud-test.js
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { open, tally } from './pw.js';

const t = tally('cloud');
const realErrors = (errs) => errs.filter((e) => !/Failed to load resource|favicon|fonts\.g/.test(e));
const ready = (page) => page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100); } };

/* ------------------------------------------------------------------ the fake service */
// Made-up numbers throughout: the real rate card, plans and packs are the service's, never this repo's.
const RATE = [
  { kind: 'quick_change', label: 'A quick change', credits: 2 },
  { kind: 'question', label: 'A question', credits: 2 },
  { kind: 'new_part', label: 'A new part', credits: 7 },
  { kind: 'new_instrument', label: 'A new instrument or effect', credits: 11 },
];
const ev = (type, o = {}) => ({ type, ...o });
export const reply = (text, { stop = 'end_turn' } = {}) => [
  ev('message_start', { message: { id: 'm', model: 'standard', usage: { input_tokens: 3 } } }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
  ev('content_block_stop', { index: 0 }),
  ev('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 5 } }),
  ev('message_stop'),
];
const toolCall = (text, id, name, input) => [
  ev('message_start', { message: { id: 'm', model: 'standard', usage: { input_tokens: 3 } } }),
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
  ev('content_block_stop', { index: 0 }),
  ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id, name, input: {} } }),
  ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
  ev('content_block_stop', { index: 1 }),
  ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }),
  ev('message_stop'),
];

function fakeCloud() {
  const users = new Map();        // email -> { email, balance, trial }
  const sessions = new Map();     // token -> email
  const seen = new Set();         // the studio origins that asked it something: where the done page posts
  let next = 'jess@example.com';  // who the next Google sign-in is
  let popup = { message: true, close: true };   // what the sign-in page does: post overdub:signed-in, close itself
  const actions = new Map();
  const log = [];                 // every request: { method, path, body, headers }
  const script = [];              // what the next calls answer: SSE events, { status, error }, or { hang: true }
  const studio = /^http:\/\/localhost:\d+$/;   // the studio origins it answers (a local studio on any port)
  let paused = false;
  let hosted = true;              // GET /v1/config hosted.enabled: the service's kill switch
  // songs (the service's songs module): off unless a check turns it on, as the service is off without SONGS_BUCKET
  let songsOn = false;
  const SONGS = { maxBytes: 8_000_000, maxSongs: 200 };
  const songs = new Map();        // email -> Map(songId -> { row, docs: Map(rev -> doc), keep: [rev] })
  const songsOf = (email) => { if (!songs.has(email)) songs.set(email, new Map()); return songs.get(email); };
  const KEEP = 10;
  let songSeq = 0;
  // the row the service keeps beside each song: title, rev, when, size, tracks, the assets it names; never the song
  const songRow = (songId, doc, rev, createdAt, savedAt = Date.now()) => {
    const assets = new Set();
    for (const t of doc.tracks || []) for (const c of t.clips || []) if (typeof c.asset === 'string') assets.add(c.asset);
    for (const k of Object.keys(doc.assets || {})) assets.add(k);
    if (typeof doc.reference?.asset === 'string') assets.add(doc.reference.asset);
    return { songId, title: String(doc.title || 'Untitled').slice(0, 120), rev, savedAt, createdAt, bytes: Buffer.byteLength(JSON.stringify(doc)), tracks: doc.tracks.length, assets: [...assets], pid: typeof doc.id === 'string' ? doc.id : null };
  };
  // createId, saveId: optional nonces that make a write safe to send again (8 to 64 of [A-Za-z0-9_-])
  const nonceOk = (x) => x === undefined || (typeof x === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(x));
  const validDoc = (d) => !!d && typeof d === 'object' && !Array.isArray(d) && (d.format === 'overdub/0' || /^earworm\//.test(String(d.format || ''))) && Array.isArray(d.tracks);
  function putSong(email, songId, doc, createdAt) {
    const all = songsOf(email), had = all.get(songId);
    const rev = had ? had.row.rev + 1 : 1;
    const s = had || { docs: new Map(), keep: [] };
    s.docs.set(rev, JSON.parse(JSON.stringify(doc)));
    s.keep.push(rev);
    while (s.keep.length > KEEP) s.docs.delete(s.keep.shift());
    s.row = songRow(songId, doc, rev, createdAt ?? had?.row.createdAt ?? Date.now());
    all.set(songId, s);
    return s.row;
  }
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
  const userOf = (req) => { const e = sessions.get(cookies(req)['od.session_token']); return e ? users.get(e) : null; };
  const PLANS = { plus_x: 'Overdub Plus, monthly', plus_y: 'Overdub Plus, yearly' };   // the config's plans, by sku
  const balance = (u) => ({ total: u.balance, monthly: 0, trial: 0, packs: u.balance, other: 0, held: 0, debt: 0, nextExpiry: null });
  const me = (u) => ({ user: { id: 'usr_' + u.email.length, email: u.email, createdAt: 1 }, balance: balance(u), asksHint: Math.round(u.balance / 3.5),
    plan: u.plan ? { plan: u.plan, label: PLANS[u.plan], status: 'active', renewsAt: Date.now() + 30 * 864e5, endsAt: null, monthlyCredits: 123, nextGrantAt: null } : null, trial: { eligible: !!u.trialEligible, claimed: false },
    creditBack: { budget: 9, left: 9, periodEnd: 1 }, limits: { dailyCreditsLeft: 99 }, notice: u.notice || null,
    ...(songsOn ? { songs: { canSave: !!u.plus, count: songsOf(u.email).size, max: SONGS.maxSongs } } : {}) });
  let lose = 0;
  const send = (res, status, body, headers = {}) => {
    const lost = lose > 0 && /^\/v1\/songs/.test(res.req.url) && res.req.method === 'POST';
    if (lost) lose--;
    res.writeHead(lost ? 502 : status, { 'content-type': 'application/json', ...headers });
    res.end(lost ? JSON.stringify({ error: { code: 'bad_gateway', message: 'The service didn’t answer.' } }) : body === undefined ? '' : JSON.stringify(body));
  };
  const err = (res, status, code, message, details = {}) => send(res, status, { error: { code, message, ...details } });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    log.push({ method: req.method, path: url.pathname, query: url.search, body, headers: req.headers });
    const origin = req.headers.origin;
    const allowed = !!origin && studio.test(origin);
    if (allowed) {
      seen.add(origin);
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-expose-headers', 'retry-after');
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, allowed ? { 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, idempotency-key' } : {}); return res.end(); }
    if (req.method !== 'GET' && !allowed && !url.pathname.startsWith('/dev/')) return err(res, 403, 'forbidden_origin', 'That came from a page Overdub doesn’t know.');
    const p = url.pathname;
    if (p === '/v1/config') return send(res, 200, { ...(songsOn ? { songs: { enabled: true, ...SONGS } } : {}), rateCard: RATE, moreTime: { multiplier: 2, kinds: [] }, plans: [{ sku: 'plus_x', label: 'Overdub Plus, monthly', usd: 1.23, interval: 'month', monthlyCredits: 123 }, { sku: 'plus_y', label: 'Overdub Plus, yearly', usd: 12.3, interval: 'year', monthlyCredits: 123 }], packs: [{ sku: 'pack_x', label: '40 credits', usd: 0.45, credits: 40 }], trial: { credits: 6 }, signIn: { provider: 'google', start: '/v1/auth/google' }, promptVersions: [], hosted: { enabled: hosted } });
    const signIn = (email) => { const tok = randomUUID(); if (!users.has(email)) users.set(email, { email, balance: 30 }); sessions.set(tok, email); return `od.session_token=${tok}; HttpOnly; SameSite=Lax; Path=/`; };
    // Google, the whole round trip in one page: the real service goes to Google, back to its callback, and ends on
    // /v1/auth/done, which sets the cookie, posts overdub:signed-in to the opener at each studio origin and closes
    if (p === '/v1/auth/google') {
      if (url.searchParams.getAll('return').join() !== 'studio') { res.writeHead(400); return res.end('bad return'); }
      const script = [popup.message ? `if (window.opener) for (const o of ${JSON.stringify([...seen])}) window.opener.postMessage({ type: 'overdub:signed-in' }, o);` : '', popup.close ? 'window.close();' : ''].join('\n');
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': signIn(next) });
      return res.end(`<!doctype html><title>You’re signed in</title><p>You’re signed in. You can close this window.</p><script>${script}</script>`);
    }
    // a page on another origin that tells whoever opened it "signed in": the studio must not believe it
    if (p === '/dev/post') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<!doctype html><script>window.opener && window.opener.postMessage({ type: 'overdub:signed-in' }, '*');</script>`); }
    if (p === '/dev/checkout') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p>Fake checkout</p>'); }
    const u = userOf(req);
    if (!u) return err(res, 401, 'not_signed_in', 'Sign in to use Claude on Overdub credits.');
    if (p === '/v1/me' && req.method === 'GET') return send(res, 200, me(u));
    if (p === '/v1/me' && req.method === 'DELETE') { sessions.delete(cookies(req)['od.session_token']); users.delete(u.email); songs.delete(u.email); return send(res, 204); }
    // songs: the contract's API (GET, POST and DELETE; the row without keep; 409 with the newer row)
    const sm = /^\/v1\/songs(?:\/([^/]+))?(\/revs)?$/.exec(p);
    if (sm && !songsOn) return err(res, 404, 'not_found', 'That isn’t here.');
    if (sm) {
      const all = songsOf(u.email), id = sm[1] ? decodeURIComponent(sm[1]) : null, s = id ? all.get(id) : null;
      if (!id && req.method === 'GET') return send(res, 200, { songs: [...all.values()].map((x) => x.row).sort((a, b) => b.savedAt - a.savedAt), canSave: !!u.plus, max: SONGS.maxSongs });
      if (!id && req.method === 'POST') {
        if (!u.plus) return err(res, 403, 'songs_need_plus', 'Cloud saves come with Plus.');
        if (!validDoc(body?.doc)) return err(res, 400, 'validation_failed', 'That isn’t a song.', { field: 'doc' });
        if (Buffer.byteLength(JSON.stringify(body.doc)) > SONGS.maxBytes) return err(res, 413, 'song_too_large', 'That song is too big to save.');
        if (!nonceOk(body.createId)) return err(res, 400, 'validation_failed', 'The studio sent something the service can’t take.', { field: 'createId' });
        // the same create again (a retry after the answer was lost): the song it made, not a second one
        const made = body.createId && [...all.values()].find((x) => x.createId === body.createId);
        if (made) return send(res, 200, { song: made.row });
        if (all.size >= SONGS.maxSongs) return err(res, 403, 'song_limit', 'Your account holds 200 songs.');
        const row = putSong(u.email, 'sng_' + String(++songSeq).padStart(6, '0'), body.doc);
        if (body.createId) all.get(row.songId).createId = body.createId;
        return send(res, 201, { song: row });
      }
      if (!s) return err(res, 404, 'song_not_found', 'That song isn’t in your account.');
      if (sm[2] && req.method === 'GET') return send(res, 200, { revs: s.keep.map((rev) => ({ rev, savedAt: s.row.savedAt - (s.row.rev - rev) * 60000, bytes: Buffer.byteLength(JSON.stringify(s.docs.get(rev))) })) });
      if (req.method === 'GET') {
        const rev = url.searchParams.has('rev') ? Number(url.searchParams.get('rev')) : s.row.rev;
        if (!s.docs.has(rev)) return err(res, 404, 'song_not_found', 'That save isn’t kept any more.');
        return send(res, 200, { song: s.row, doc: s.docs.get(rev) });
      }
      if (req.method === 'POST') {
        if (!u.plus) return err(res, 403, 'songs_need_plus', 'Cloud saves come with Plus.');
        if (!validDoc(body?.doc)) return err(res, 400, 'validation_failed', 'That isn’t a song.', { field: 'doc' });
        if (!nonceOk(body.saveId)) return err(res, 400, 'validation_failed', 'The studio sent something the service can’t take.', { field: 'saveId' });
        if (body.baseRev !== s.row.rev) {
          // the same save again (its answer was lost): the row it made, and nothing written
          if (body.saveId && s.lastSaveId === body.saveId) return send(res, 200, { song: s.row });
          return err(res, 409, 'song_conflict', 'There’s a newer save of this song.', { current: s.row });
        }
        const row = putSong(u.email, id, body.doc);
        s.lastSaveId = body.saveId || null;
        return send(res, 200, { song: row });
      }
      if (req.method === 'DELETE') { all.delete(id); return send(res, 200, { deleted: true }); }
    }
    if (p === '/v1/me/activity') return send(res, 200, { items: [...actions.values()].filter((a) => a.email === u.email && a.charged).map((a) => ({ at: a.at, kind: 'spend', credits: -a.credits, label: RATE.find((r) => r.kind === a.kind).label, actionId: a.id })) });
    if (p === '/v1/auth/logout') { sessions.delete(cookies(req)['od.session_token']); return send(res, 204, undefined, { 'set-cookie': 'od.session_token=; Max-Age=0; Path=/' }); }
    if (p === '/v1/trial/claim') { u.balance += 6; u.trialEligible = false; return send(res, 200, me(u)); }
    // (a checkout remembers what it's for: the sync after it starts that plan, or grants that pack)
    if (p === '/v1/billing/checkout') { u.checkout = body?.sku; return send(res, 200, { url: `http://localhost:${server.address().port}/dev/checkout`, checkoutRef: 'chk_1' }); }
    // chk_late: a checkout the provider hasn't marked paid yet (nothing granted, and the answer says so)
    if (p === '/v1/billing/sync') { if (body?.checkoutRef === 'chk_late') return send(res, 200, { ...me(u), checkoutPaid: false }); if (PLANS[u.checkout]) { u.plan = u.checkout; u.plus = true; } else u.balance += 40; u.checkout = null; return send(res, 200, { ...me(u), checkoutPaid: true }); }
    if (p === '/v1/agent/actions' && req.method === 'POST') {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(req.headers['idempotency-key'] || '')) return err(res, 400, 'validation_failed', 'The studio sent something the agent can’t take. Reload and try again.', { field: 'idempotency-key' });
      if (paused) return err(res, 503, 'hosted_paused', 'Claude on Overdub credits is paused right now. Your own Claude, Claude Code and the demo still work.');
      const openOne = [...actions.values()].find((a) => a.email === u.email && a.status === 'open');
      if (openOne) return err(res, 409, 'action_in_flight', 'The agent is still working on your last ask.', { actionId: openOne.id });
      const row = RATE.find((r) => r.kind === body?.kind);
      if (!row) return err(res, 400, 'validation_failed', 'The studio sent something the agent can’t take. Reload and try again.', { field: 'kind' });
      if (u.balance < row.credits) return err(res, 402, 'insufficient_credits', 'You’re out of credits for this one.', { needed: row.credits, balance: u.balance });
      u.balance -= row.credits;
      const a = { id: 'act_' + randomUUID().slice(0, 8), email: u.email, kind: row.kind, credits: row.credits, status: 'open', calls: [], delivered: 0, at: Date.now(), promptVersion: body.promptVersion };
      actions.set(a.id, a);
      return send(res, 201, { actionId: a.id, kind: a.kind, credits: a.credits, tier: 'standard', maxCalls: 12, balance: balance(u) });
    }
    const m = /^\/v1\/agent\/actions\/([^/]+)\/(calls|wait|finish|credit-back)$/.exec(p);
    const a = m && actions.get(m[1]);
    if (m && (!a || a.email !== u.email)) return err(res, 404, 'action_not_found', 'That ask isn’t here any more.');
    if (m && m[2] === 'calls') {
      if (a.status !== 'open') return err(res, 409, 'action_closed', 'That ask is already finished.');
      a.calls.push(body);
      const next = script.shift() || reply('Done.');
      if (next.status) { res.writeHead(next.status, { 'content-type': 'application/json', ...(next.retryAfter != null ? { 'retry-after': String(next.retryAfter) } : {}) }); return res.end(JSON.stringify({ error: next.error })); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      if (next.hang) { res.write(`event: message_start\ndata: ${JSON.stringify(ev('message_start', { message: { usage: {} } }))}\n\n`); a.delivered++; req.on('close', () => {}); return; }
      for (const e of next) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      a.delivered++;
      res.write(`event: overdub\ndata: ${JSON.stringify({ type: 'overdub', callsUsed: a.calls.length, callsLeft: 12 - a.calls.length, lastCall: false })}\n\n`);
      return res.end();
    }
    if (m && m[2] === 'wait') return send(res, 200, { ok: true });
    if (m && m[2] === 'finish') {
      if (a.settlement) return send(res, 200, a.settlement);
      a.status = body?.outcome === 'stopped' ? 'stopped' : body?.outcome === 'error' ? 'error' : 'done';
      a.finish = body;
      const charge = a.delivered > 0 && body?.outcome !== 'error';
      if (!charge) u.balance += a.credits;
      a.charged = charge;
      a.settlement = { charged: charge ? a.credits : 0, released: charge ? 0 : a.credits, reason: charge ? 'delivered' : 'nothing_delivered', balance: balance(u), creditBackUntil: charge ? Date.now() + 120000 : null };
      return send(res, 200, a.settlement);
    }
    if (m && m[2] === 'credit-back') {
      if (!a.charged) return err(res, 409, 'not_charged', 'That ask wasn’t charged.');
      if (a.back) return err(res, 409, 'already_credited_back', 'Those credits are back already.');
      a.back = body?.reason; u.balance += a.credits;
      return send(res, 200, { creditedBack: a.credits, creditBackLeft: 9 - a.credits, balance: balance(u) });
    }
    return err(res, 404, 'not_found', 'That isn’t here.');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const origin = `http://localhost:${server.address().port}`;
    resolve({
      origin, log, script, users, actions,
      pause(on) { paused = on; },
      hosted(on) { hosted = on; },
      songs(on) { songsOn = on; },
      // a plan on that account (a sku from the config's plans), or none
      plan(email, sku) { users.get(email).plan = sku || null; },
      // the account's songs put aside (an account with none), and back
      stashSongs(email) { const had = songs.get(email); songs.set(email, new Map()); return () => songs.set(email, had); },
      plus(email, on) { if (!users.has(email)) users.set(email, { email, balance: 30 }); users.get(email).plus = on; },
      songsOf: (email) => [...songsOf(email).values()],
      seedSong: (email, doc, savedAt = Date.now()) => { const r = putSong(email, 'sng_' + String(++songSeq).padStart(6, '0'), doc); r.savedAt = savedAt; return r; },
      // another browser saves the song: its rev moves on, so this page's next save is a conflict
      saveElsewhere(email, songId, patch) { const s = songsOf(email).get(songId); const r = putSong(email, songId, { ...s.docs.get(s.row.rev), ...patch }); s.lastSaveId = null; return r; },
      // the next n song writes land, and their answers are lost on the way back (a gateway's 502: a dropped connection
      // would do, but Chromium quietly sends a POST again on a dropped keep-alive socket, so the check couldn't say who)
      loseAnswers(n) { lose = n; },
      next(email) { next = email; },
      popup(o) { popup = { message: true, close: true, ...o }; },
      user(email) { return users.get(email); },
      grant(email, n) { if (!users.has(email)) users.set(email, { email, balance: 0 }); users.get(email).balance = n; },
      reqs(path) { return log.filter((r) => r.path === path || (path instanceof RegExp && path.test(r.path))); },
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    });
  }));
}

/* ------------------------------------------------------------------ the studio, pointed at it */
async function studio(fake, { config = 'env', key = false, query = '' } = {}) {
  if (config === 'env') process.env.OVERDUB_CLOUD_ORIGIN = fake.origin; else delete process.env.OVERDUB_CLOUD_ORIGIN;
  if (key) process.env.OVERDUB_ANTHROPIC_KEY = 'sk-ant-test-key'; else delete process.env.OVERDUB_ANTHROPIC_KEY;
  const q = [query, config === 'query' ? `cloud=${encodeURIComponent(fake.origin)}` : ''].filter(Boolean).join('&');
  const s = await open('/app/', { query: q });
  await ready(s.page);
  await s.page.evaluate(() => { localStorage.setItem('overdub:welcomed', '1'); });
  await s.page.reload({ waitUntil: 'load' });
  await ready(s.page);
  return s;
}
// turn the hosted agent on, as the person would from Agent settings (its ask chip is the panel's own)
async function chooseCloud(page) {
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config, null, { timeout: 10000 });
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); e.agent.useCloud(true); });
  await page.waitForFunction(() => window.overdub.agent.provider === 'cloud', null, { timeout: 5000 });
}
// Continue with Google on the sign-in sheet: the popup is the fake's whole round trip, which posts overdub:signed-in
// and closes
async function signInWithGoogle(page, fake, email = 'jess@example.com') {
  await page.waitForSelector('.ag-cl-signin .ag-cl-google', { timeout: 5000 });
  fake.next(email);
  fake.popup({});
  await Promise.all([page.context().waitForEvent('page'), page.click('.ag-cl-signin .ag-cl-google')]);
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in', null, { timeout: 8000 });
}
const typeAsk = async (page, text) => { await page.fill('.ag-input', text); };
const actionsOpened = (fake) => fake.reqs('/v1/agent/actions').filter((r) => r.method === 'POST');

/* ------------------------------------------------------------------ 0. in Node: the open rules and the canonical form */
{
  const { classify, freeMove, KINDS } = await import('../app/src/agent/cloud-kind.js');
  const k = (text, hint) => classify({ text, hint }).kind;
  const cases = [
    ['Make this warmer', 'quick_change'], ['More space', 'quick_change'], ['Make the hats busier', 'quick_change'],
    ['Write a counter-melody', 'new_part'], ['add a bassline under the chorus', 'new_part'], ['Give me a bass part', 'new_part'], ['Give me three takes on the hook', 'new_part'],
    ['Build me a pedal like this, but darker', 'new_instrument'], ['make a synth that sounds like glass', 'new_instrument'], ['Use the reverb on the keys', 'quick_change'], ['find a fuzz pedal', 'quick_change'],
    ['What would you change?', 'question'], ['why is the bass so loud', 'question'], ['Can you write a bass part?', 'new_part'],
  ];
  const wrong = cases.filter(([s, want]) => k(s) !== want).map(([s, want]) => `"${s}": ${k(s)}, not ${want}`);
  t.ok(!wrong.length, `node: the kind of an ask, by the open rules (${cases.length} asks)${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  t.ok(k('Make this warmer', 'new_part') === 'new_part' && k('x', 'not_a_kind') === 'quick_change' && classify({ text: 'x' }).alternatives.join() === KINDS.join(), 'node: a picked kind wins; an unknown one is ignored; all four kinds are the alternatives');
  const devices = [{ id: 'core.verb', name: 'Reverb', kind: 'effect' }, { id: 'core.pad', name: 'Pad', kind: 'instrument' }];
  const fm = (s, hasTrack = true) => freeMove(s, { devices, hasTrack });
  t.ok(fm('warmer')?.tool === 'adjust' && fm('Make it brighter.')?.input.axis === 'brighter' && fm('less muddy')?.tool === 'adjust', 'node: one lexicon word, or "make it <word>", on a selected track is a free move');
  t.ok(fm('use reverb')?.device === 'core.verb' && fm('add a pad', false)?.device === 'core.pad' && !fm('use reverb', false), 'node: "use / add <device>" by its exact name is a free move (an effect needs a track)');
  t.ok(!fm('warmer', false) && !fm('make it warmer and add a bassline') && !fm('use the cathedral reverb') && !fm('warm the bass up a bit') && !fm(''), 'node: anything looser is an ask, not a free move');

  const { canonicalJson, canonicalBundle, bundleVersion, safeUrl } = await import('../app/src/agent/cloud.js');
  const vec = canonicalBundle('You are a test agent.', [{ name: 'b_tool', description: 'B.', input_schema: { type: 'object', properties: {} } }, { name: 'a_tool', description: 'A.', input_schema: { type: 'object' } }]);
  const want = '{"system":"You are a test agent.","tools":[{"description":"A.","input_schema":{"type":"object"},"name":"a_tool"},{"description":"B.","input_schema":{"properties":{},"type":"object"},"name":"b_tool"}]}';
  const v = await bundleVersion(vec);
  t.ok(canonicalJson(vec) === want && v === 'sha256:4e39ca426d1be9ae', `node: the prompt bundle's canonical form and version match the service's test vector (${v})`);
  t.ok(canonicalBundle('s', [{ name: 'x', description: 'd', input_schema: {}, annotations: { title: 'X' }, eager_input_streaming: true }]).tools[0].annotations === undefined, 'node: a bundle tool is only name, description and input schema');
  t.ok(safeUrl('javascript:alert(1)') === null && safeUrl('http://evil.example/x') === null && !!safeUrl('https://pay.example/x'), 'node: only an https (or local) checkout URL is opened');

  const { cloudOrigin, cloudOverride } = await import('../app/src/site-config.js');
  t.ok(cloudOrigin('https://api.example.com/x') === 'https://api.example.com' && cloudOrigin('http://localhost:8787') === 'http://localhost:8787' && !cloudOrigin('http://api.example.com') && !cloudOrigin('javascript:x') && !cloudOrigin('https://u:p@api.example.com'), 'node: a cloud origin is https, or http on this machine');
  t.ok(cloudOverride('?cloud=http://localhost:8787', 'localhost') === 'http://localhost:8787' && !cloudOverride('?cloud=https://api.example.com', 'localhost') && !cloudOverride('?cloud=http://localhost:8787', 'overdubstudio.com'),
    'node: ?cloud= only points a studio on this machine at a service on this machine (a link can\'t send a song elsewhere)');
}

const fake = await fakeCloud();

/* ------------------------------------------------------------------ 1. off without a site config */
{
  const { page, errors, close } = await studio(fake, { config: 'none' });
  const before = fake.log.length;
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); });
  await sleep(600);
  const out = await page.evaluate(() => ({ cloud: window.overdub.agent.cloud, row: !!document.querySelector('.ag-kc-cloud'), chip: !document.querySelector('.ag-price')?.hidden }));
  out.config = await page.evaluate(() => fetch('site-config.json').then((r) => r.json()));
  // the server answers what deploy.sh ships with no base: {}, no cloud key
  t.ok(out.cloud === null && !out.row && !out.chip && JSON.stringify(out.config) === '{}',
    `with no site config the hosted agent is off: no account, no row in settings, no price (site-config.json ${JSON.stringify(out.config)})`);
  t.ok(fake.log.length === before, `and the studio asks no cloud origin anything (${fake.log.length - before} requests)`);
  t.ok(realErrors(errors).length === 0, 'no page errors (off)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 1b. the config: one read per load, and never a wait past 4 s */
{
  const { page, context, errors, close } = await studio(fake, { config: 'none' });
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/site-config.json')) asked.push(r.url()); });
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.evaluate(() => window.overdub.site.ready);
  await sleep(300);
  const relay = await page.evaluate(() => !!window.overdub.remote);
  t.ok(asked.length === 1 && /\/app\/site-config\.json$/.test(asked[0]) && relay, `one request for site-config.json per studio load, shared by boot, the preview ribbon and the hosted agent (${asked.length}: ${asked.join(', ')})`);
  // a config slower than the cap: boot goes on at 4 s without it (app.siteConfig null), Connect there all the same
  const warned = [];
  page.on('console', (m) => { if (m.type() === 'warning' && /site-config\.json took over/.test(m.text())) warned.push(m.text()); });
  await context.route('**/app/site-config.json', async (route) => { await sleep(6000); await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {}); });
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await ready(page);
  const took = Date.now() - t0;
  const early = await page.evaluate(() => ({ cfg: window.overdub.siteConfig, remote: !!window.overdub.remote }));
  t.ok(early.cfg === null && early.remote && took < 6000 && warned.length === 1,
    `a site-config.json delayed 6 s: the studio is ready in ${took} ms without it (app.siteConfig ${JSON.stringify(early.cfg)}), app.remote ${early.remote}; ${warned.length} warning`);
  await sleep(Math.max(0, 6500 - (Date.now() - t0)));
  // a config this load can't read (CloudFront's 503 page) or no file at all (404): Connect is there either way
  await context.unroute('**/app/site-config.json');
  const look = async (status, body, type) => {
    await context.route('**/app/site-config.json', (route) => route.fulfill({ status, contentType: type, body }));
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    const o = await page.evaluate(() => ({ remote: !!window.overdub.remote }));
    await context.unroute('**/app/site-config.json');
    return o;
  };
  const down = await look(503, '<html><body>503 Service Unavailable</body></html>', 'text/html');
  const gone = await look(404, '<html><body>Not Found</body></html>', 'text/html');
  t.ok(down.remote && gone.remote,
    `a site-config.json answering a 503 HTML page: app.remote ${down.remote}; a 404: app.remote ${gone.remote}`);
  t.ok(realErrors(errors).length === 0, 'no page errors (config read)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 1c. it takes cloud.api, and only that */
{
  const { page, context, errors, close } = await studio(fake, { config: 'none' });
  const look = async (config) => {
    await context.route('**/app/site-config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) }));
    const before = fake.log.length;
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await page.evaluate(() => window.overdub.site.ready);
    await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); });
    await sleep(600);
    const out = await page.evaluate(() => ({ cloud: !!window.overdub.agent.cloud, row: !!document.querySelector('.ag-kc-cloud') }));
    await context.unroute('**/app/site-config.json');
    return { ...out, asked: fake.log.length - before };
  };
  const none = await look({ other: { api: fake.origin } });
  t.ok(!none.cloud && !none.row && none.asked === 0, `a site config without cloud.api: off, no row in settings, ${none.asked} requests to the service`);
  const api = await look({ cloud: { api: fake.origin } });
  t.ok(api.cloud && api.row && api.asked > 0, `cloud.api: the hosted agent is offered (row ${api.row}, ${api.asked} requests to the service)`);
  t.ok(realErrors(errors).length === 0, 'no page errors (cloud.api)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 2. sign in with Google: the popup, the message, the poll */
{
  const { page, context, errors, close, shot } = await studio(fake, { config: 'query' });
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config, null, { timeout: 10000 }).catch(() => {});
  const setup = await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); return { row: document.querySelector('.ag-kc-cloud')?.textContent || '', provider: e.agent.provider }; });
  t.ok(/Claude on Overdub credits/.test(setup.row) && /No set-up, uses credits/.test(setup.row) && setup.provider !== 'cloud', `?cloud=<a local service> on a local studio: settings offer Claude on Overdub credits, not on until chosen ("${setup.row.slice(0, 90)}")`);
  await page.click('.ag-kc-cloud .btn:not(.btn-txt)');
  await page.waitForSelector('.ag-cl-signin', { timeout: 5000 });
  await sleep(200);
  const s1 = await page.evaluate(() => ({ text: document.querySelector('.ag-cl-signin').textContent, live: document.querySelector('.ag-cl-signin [aria-live="polite"]')?.textContent, provider: window.overdub.agent.provider, settings: !!document.querySelector('.ag-keycard'), focus: document.activeElement?.textContent, fields: document.querySelectorAll('.ag-cl-signin input, .ag-cl-signin iframe').length }));
  t.ok(s1.provider === 'cloud' && !s1.settings && /Sign in with your Google account/.test(s1.live) && /Continue with Google/.test(s1.text) && /the studio needs no account/.test(s1.text) && s1.focus === 'Claude on Overdub credits' && s1.fields === 0,
    'chosen in settings while signed out: settings close, the sign-in sheet comes up with its heading focused, one button ("Continue with Google"), no field and no frame, announced politely');
  await shot('cloud-signin');

  // the popup: opened in the click itself, to the service's Google start, as a named popup window. The done page's
  // message is held back here and the tab's poll paused (as if hidden), so nothing but what the test does signs it in.
  await page.evaluate(() => {
    const open = window.open;
    window.__opened = [];
    window.open = function (...a) { window.__opened.push(a); return open.apply(this, a); };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  fake.next('jess@example.com');
  fake.popup({ message: false, close: false });
  const me0 = fake.reqs('/v1/me').length;
  const [pop] = await Promise.all([context.waitForEvent('page'), page.click('.ag-cl-signin .ag-cl-google')]);
  await pop.waitForLoadState('load');
  const opened = await page.evaluate(() => window.__opened);
  const start = fake.reqs('/v1/auth/google').pop();
  t.ok(opened.length === 1 && opened[0][0] === `${fake.origin}/v1/auth/google?return=studio` && opened[0][1] === 'overdub-signin' && /^popup,width=480,height=640$/.test(opened[0][2]) && pop.url() === `${fake.origin}/v1/auth/google?return=studio` && start?.query === '?return=studio',
    `Continue with Google opens a popup to <service>/v1/auth/google?return=studio (${JSON.stringify(opened[0]?.slice(1))})`);
  await page.waitForSelector('.ag-cl-signin[data-state="waiting"]', { timeout: 5000 });
  const w = await page.evaluate(() => ({ text: document.querySelector('.ag-cl-signin').textContent, live: document.querySelector('.ag-cl-signin [aria-live="polite"]')?.textContent || '', cancel: !!document.querySelector('.ag-cl-signin .ag-cl-cancel') }));
  t.ok(/Waiting for Google/.test(w.live) && w.cancel && !/Continue with Google/.test(w.text), `while the popup is out the sheet says so, with Cancel ("${w.live}")`);
  await shot('cloud-waiting');
  // the session cookie is set now (the popup's page did it), so anything that asks /v1/me would sign the tab in. A
  // message from another origin (the studio itself, and a page on 127.0.0.1) asks nothing.
  const other = fake.origin.replace('localhost', '127.0.0.1');
  await page.evaluate((o) => { window.postMessage({ type: 'overdub:signed-in' }, '*'); window.open(o + '/dev/post', 'other'); }, other);
  await sleep(1500);
  const ignored = await page.evaluate(() => window.overdub.agent.cloud.state);
  t.ok(ignored === 'waiting' && fake.reqs('/v1/me').length === me0, `a "signed in" message from any origin but the service's is ignored: still ${ignored}, no /v1/me asked`);
  // the service's own page says it: by the message alone (no poll, no focus), the tab asks /v1/me and is signed in,
  // and closes the popup it opened
  await pop.evaluate((o) => window.opener.postMessage({ type: 'overdub:signed-in' }, o), new URL(page.url()).origin);
  const byMessage = await until(() => page.evaluate(() => window.overdub.agent.cloud?.state === 'signed-in'), 3000);
  const popClosed = await until(() => pop.isClosed(), 3000);
  const s3 = await page.evaluate(() => ({ sheet: !!document.querySelector('.ag-cl-signin'), head: document.querySelector('.ag-who')?.textContent || '' }));
  t.ok(byMessage && fake.reqs('/v1/me').length === me0 + 1 && popClosed && !s3.sheet && /on credits, 30 left/.test(s3.head),
    `by the message alone (the poll paused): one /v1/me, signed in, the popup closed, and the head says "on credits, 30 left" (${s3.head.trim()})`);
  for (const p of context.pages()) if (p !== page) await p.close().catch(() => {});
  await page.evaluate(() => { delete document.visibilityState; });

  // the account sheet: signed in as, the balance, sign out
  await page.click('.ag-pill-cloud');
  await page.waitForSelector('.ag-cl-account', { timeout: 5000 });
  const acc = await page.evaluate(() => document.querySelector('.ag-cl-account').textContent);
  t.ok(/Signed in as jess@example\.com/.test(acc) && /Sign out/.test(acc) && /30, about 9 asks/.test(acc) && /Where your credits went/.test(acc), 'the head opens the account sheet: "Signed in as", the credits in asks, where they went, sign out');
  await shot('cloud-account');
  await page.click('.ag-cl-account .ag-cl-del');
  const delWords = await page.evaluate(() => document.querySelector('.ag-cl-delete')?.textContent || '');
  t.ok(/removes your email address from Overdub\. Our backups keep it for up to 35 days, then it’s gone from them too\./.test(delWords), `Delete my account says the address stays in backups for up to 35 days ("${delWords.slice(0, 120)}…")`);
  await page.click('.ag-cl-delete .ag-link');
  await page.click('.ag-cl-account .ag-cl-who .ag-link');
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-out', null, { timeout: 5000 });
  const out = fake.reqs('/v1/auth/logout').filter((r) => r.method === 'POST');
  t.ok(out.length === 1 && !(await page.evaluate(() => window.overdub.agent.cloud.me)), 'Sign out: POST /v1/auth/logout, and the tab is signed out');

  // by the poll alone: the popup's page posts nothing and stays open; the tab asks /v1/me every 5 s while visible
  await page.waitForSelector('.ag-cl-signin .ag-cl-google', { timeout: 5000 });
  fake.popup({ message: false, close: false });
  const t0 = Date.now(), me1 = fake.reqs('/v1/me').length;
  const [pop2] = await Promise.all([context.waitForEvent('page'), page.click('.ag-cl-signin .ag-cl-google')]);
  const byPoll = await until(() => page.evaluate(() => window.overdub.agent.cloud?.state === 'signed-in'), 9000);
  const took = Date.now() - t0;
  const pop2Closed = await until(() => pop2.isClosed(), 3000);
  t.ok(byPoll && took >= 4000 && fake.reqs('/v1/me').length > me1 && pop2Closed, `with no message, the tab's own poll of /v1/me signs it in (${(took / 1000).toFixed(1)} s), and the popup is closed`);

  // Cancel: back to the button, and the popup goes
  await page.evaluate(() => window.overdub.agent.cloud.signOut());
  await page.waitForSelector('.ag-cl-signin .ag-cl-google', { timeout: 5000 });
  const [pop3] = await Promise.all([context.waitForEvent('page'), page.click('.ag-cl-signin .ag-cl-google')]);
  await page.waitForSelector('.ag-cl-signin .ag-cl-cancel', { timeout: 5000 });
  await page.click('.ag-cl-signin .ag-cl-cancel');
  const cancelled = await page.evaluate(() => ({ state: window.overdub.agent.cloud.state, button: !!document.querySelector('.ag-cl-signin .ag-cl-google') }));
  t.ok(cancelled.state === 'signed-out' && cancelled.button && (await until(() => pop3.isClosed(), 3000)), `Cancel goes back to the button and closes the popup (${cancelled.state})`);
  fake.popup({});

  // a blocked popup is said plainly, on the sheet
  await page.evaluate(() => { window.open = () => null; });
  await page.click('.ag-cl-signin .ag-cl-google');
  await sleep(200);
  const blocked = await page.evaluate(() => ({ state: window.overdub.agent.cloud.state, err: document.querySelector('.ag-cl-signin .ag-cl-err')?.textContent || '' }));
  t.ok(blocked.state === 'error' && /didn’t open\. Allow pop-ups/.test(blocked.err), `a blocked popup: the sheet says so ("${blocked.err}")`);
  t.ok(realErrors(errors).length === 0, 'no page errors (sign in)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 3. the price before any ask, and an ask end to end */
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close, shot } = await studio(fake);
  await chooseCloud(page);
  await signInWithGoogle(page, fake);
  const opened0 = actionsOpened(fake).length;
  // a direct send with no price on screen opens nothing: the panel is asked to show it
  const direct = await page.evaluate(async () => { const e = window.overdub; let quoted = null; const off = e.agent.on('quote', (q) => { quoted = q; }); const r = await e.agent.send('Add a bassline'); off(); return { r, quoted, box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price')?.textContent }; });
  await sleep(300);
  t.ok(direct.r === false && direct.quoted?.kind === 'new_part' && direct.box === 'Add a bassline' && /A new part.· 7 credits/.test(direct.chip) && actionsOpened(fake).length === opened0,
    `a send with no price on screen opens nothing: the ask goes in the box with its price ("${direct.chip}")`);
  await page.fill('.ag-input', '');
  // a suggestion, and the tour's "ask for a take": into the box with the price, nothing sent
  await page.evaluate(() => { const e = window.overdub; e.ui.emit('agent:compose', { text: 'Play a take over my part.', send: true }); });
  await sleep(300);
  const tour = await page.evaluate(() => ({ box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price:not([hidden])')?.textContent || '', say: document.querySelector('.ag-price-say')?.textContent }));
  await page.fill('.ag-input', '');
  await page.evaluate(() => document.querySelector('.ag-sugs .ag-sug:not([data-x])')?.click());
  await sleep(300);
  const sug = await page.evaluate(() => ({ box: document.querySelector('.ag-input').value, chip: document.querySelector('.ag-price:not([hidden])')?.textContent || '' }));
  t.ok(tour.box === 'Play a take over my part.' && /credits?/.test(tour.chip) && tour.say === 'Press Send to ask.' && (!sug.box || /credits?|free/.test(sug.chip)) && actionsOpened(fake).length === opened0,
    `the tour's ask and a suggestion button land in the box with their price, and nothing opens (tour: "${tour.chip}"; suggestion "${sug.box}": "${sug.chip}")`);
  // typed: the price follows the words, and the ▾ lists every kind
  await typeAsk(page, 'Write a counter-melody');
  const c1 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  await typeAsk(page, 'Build me a fuzz pedal');
  const c2 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  await typeAsk(page, 'What is the bass doing?');
  const c3 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  t.ok(/A new part.· 7 credits/.test(c1) && /A new instrument or effect.· 11 credits/.test(c2) && /A question.· 2 credits/.test(c3), `the price follows what's typed, from the service's rate card ("${c1}", "${c2}", "${c3}")`);
  await page.click('.ag-price');
  const menu = await page.evaluate(() => [...document.querySelectorAll('.ag-price-k')].map((b) => b.textContent));
  await page.click('.ag-price-k[data-kind="quick_change"]');
  const c4 = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  t.ok(menu.length === 4 && menu.some((x) => /A new part7 credits/.test(x)) && /A quick change.· 2 credits/.test(c4) && !(await page.evaluate(() => !!document.querySelector('.ag-price-more'))), `▾ lists the four kinds with their prices; picking one changes the price; no "take more time" when the card doesn't offer it (${menu.join(' / ')})`);
  await shot('cloud-chip');

  // the ask, end to end: a tool call that runs here, signed Claude; the first call sends messages, the next only results
  fake.script.push(toolCall('Adding a bass. ', 'toolu_1', 'apply_ops', { label: 'walking bass', reason: 'you asked', ops: [{ type: 'track.add', ref: 'b', track: { name: 'Cloud Bass', instrument: { device: 'core.bass' } } }, { type: 'clip.add', track: '$b', clip: { start: 0, length: 4, notes: 'A1@0:1 C2@1:1 E2@2:1 G2@3:1' } }] }));
  fake.script.push(reply('Take 1 is in: a walking bass under your keys. Keep it?'));
  await typeAsk(page, 'Add a walking bassline');
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => !window.overdub.agent.busy && /walking bass under your keys/.test(document.querySelector('.ag-feed').textContent), null, { timeout: 10000 }).catch(async (e) => { console.log('DEBUG', await page.evaluate(() => ({ feed: document.querySelector('.ag-feed').textContent.slice(-600), busy: window.overdub.agent.busy, box: document.querySelector('.ag-input').value })), fake.log.slice(-6).map((r) => r.method + ' ' + r.path + ' ' + JSON.stringify(r.body).slice(0, 200)), errors); throw e; });
  const a = [...fake.actions.values()].pop();
  const open1 = actionsOpened(fake).pop();
  const done = await page.evaluate(() => {
    const e = window.overdub;
    const tr = e.store.get().tracks.find((x) => x.name === 'Cloud Bass');
    const h = e.store.history.filter((x) => x.label === 'walking bass');
    return { by: tr?.by, clipBy: tr?.clips[0]?.by, notesBy: [...new Set(tr?.clips[0]?.notes.map((n) => n.by))], hist: h.map((x) => x.by), speaker: [...document.querySelectorAll('.ag-msg.ag-agent')].pop()?.dataset.by, head: document.querySelector('.ag-who').textContent, recap: e.agent.recap };
  });
  t.ok(open1.body.kind === 'new_part' && open1.body.moreTime === false && /^sha256:[0-9a-f]{16}$/.test(open1.body.promptVersion) && /^[A-Za-z0-9-]{8,}$/.test(open1.headers['idempotency-key'] || '') && open1.headers.cookie,
    `Send opens one ask: its kind, the prompt version, an Idempotency-Key, the session cookie (${open1.body.kind}, ${open1.body.promptVersion})`);
  const first = a.calls[0], second = a.calls[1];
  t.ok(Object.keys(first).join() === 'messages' && first.messages.length === 1 && first.messages[0].role === 'user' && first.messages[0].content.every((b) => b.type === 'text') && /Add a walking bassline/.test(first.messages[0].content[0].text),
    'the first call sends the opening message only (text blocks), no system prompt, tools or model');
  t.ok(second && Object.keys(second).join() === 'toolResults' && second.toolResults.length === 1 && second.toolResults[0].tool_use_id === 'toolu_1' && second.toolResults[0].type === 'tool_result',
    'the next call sends only the tool results, for exactly the tool calls asked');
  t.ok(done.by === 'claude' && done.clipBy === 'claude' && done.notesBy.join() === 'claude' && done.hist.join() === 'claude' && done.speaker === 'claude', `the hosted agent's work is signed Claude: the track, the clip, the notes, History, the log (${done.hist.join()})`);
  t.ok(a.finish?.outcome === 'done' && a.finish.cardPending === false && /on credits, 23 left/.test(done.head), `finish says done; the head shows the balance after it (${done.head.trim()})`);
  // credits back: undo everything the ask did, inside the window
  await page.evaluate(() => { const e = window.overdub; while (e.store.history.some((x) => x.label === 'walking bass')) e.store.undo(); });
  const posted = () => fake.reqs(/credit-back$/).filter((x) => x.method === 'POST');
  await until(() => posted().length > 0, 4000);
  const back = posted().pop();
  await sleep(300);
  const backNote = await page.evaluate(() => document.querySelector('.ag-feed').textContent);
  t.ok(back?.body?.reason === 'undo' && /Credits back: 7\. You undid everything that ask did\./.test(backNote) && /^[A-Za-z0-9-]{8,}$/.test(back.headers['idempotency-key'] || ''), 'undo every change of an ask inside the window: credits back ("Credits back: 7")');
  // a second ask carries a text-only recap of the first
  fake.script.push(reply('It walks root to fifth.'));
  await typeAsk(page, 'What is the bass doing?');
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => !window.overdub.agent.busy && /root to fifth/.test(document.querySelector('.ag-feed').textContent), null, { timeout: 10000 });
  const r = [...fake.actions.values()].pop().calls[0].messages;
  const blocks = r.flatMap((m) => (typeof m.content === 'string' ? [{ type: 'text' }] : m.content));
  t.ok(r.length === 3 && r[0].role === 'user' && r[1].role === 'assistant' && r[2].role === 'user' && blocks.every((b) => b.type === 'text') && /walking bass under your keys/.test(JSON.stringify(r[1])),
    `a new ask carries a short recap of the last one, text only: no tool calls or results (${r.length} messages)`);
  // Stop: the ask finishes as stopped
  fake.script.push({ hang: true });
  await typeAsk(page, 'Make the hats busier');
  await page.press('.ag-input', 'Enter');
  await sleep(700);
  await page.evaluate(() => window.overdub.agent.stop());
  await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 5000 });
  await sleep(300);
  t.ok([...fake.actions.values()].pop().finish?.outcome === 'stopped', 'Stop mid-answer finishes the ask as stopped');
  // nothing secret stays in the browser: no address, no session, nothing from /v1/me
  const stored = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); o['session:' + k] = sessionStorage.getItem(k); } return { all: JSON.stringify(o), keys: Object.keys(o).filter((k) => /cloud|provider/.test(k)), cookie: document.cookie }; });
  t.ok(!/jess@|example\.com|od\.session_token|session_token|usr_|balance/i.test(stored.all) && !stored.cookie, `nothing secret in the browser's storage after a session: no address, session or balance (cloud keys: ${stored.keys.join(', ')})`);
  t.ok(stored.keys.every((k) => k === 'overdub:agent-provider' || k === 'overdub:cloud:takes' || k.startsWith('overdub:cloud:notice-80:')), 'the only hosted-agent keys are the choice, the ask-to-takes map and the 80% notice');
  // the 80% notice: once, not on every look at the account
  fake.user('jess@example.com').notice = 'eighty_percent';
  await page.evaluate(async () => { await window.overdub.agent.cloud.refresh(); await window.overdub.agent.cloud.refresh(); });
  await sleep(500);
  const count = () => page.evaluate(() => (document.querySelector('.ag-feed').textContent.match(/You’ve used most of this month’s credits/g) || []).length);
  const once = await count();
  await page.evaluate(() => { localStorage.removeItem('overdub:agent:feed:' + window.overdub.store.get().id); });
  await page.reload({ waitUntil: 'load' }); await ready(page);
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in', null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const again = await count();
  t.ok(once === 1 && again === 0, `the 80% notice shows once, and not again after a reload (${once}, then ${again})`);
  fake.user('jess@example.com').notice = null;
  // signing out drops the ask-to-takes map (the service's action ids) from this browser
  const hadTakes = await page.evaluate(() => !!localStorage.getItem('overdub:cloud:takes'));
  await page.evaluate(() => window.overdub.agent.cloud.signOut());
  const keptTakes = await page.evaluate(() => localStorage.getItem('overdub:cloud:takes'));
  t.ok(hadTakes && keptTakes === null, `sign out forgets the ask-to-takes map (had it: ${hadTakes}, after: ${keptTakes})`);
  t.ok(realErrors(errors).length === 0, 'no page errors (asks)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 4. retries, out of credits, paused, the stale ask */
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close, shot } = await studio(fake);
  await chooseCloud(page);
  await signInWithGoogle(page, fake);
  const ask = async (text) => { await typeAsk(page, text); await page.press('.ag-input', 'Enter'); await page.waitForFunction(() => !window.overdub.agent.busy, null, { timeout: 15000 }); await sleep(200); };
  // busy, then busy, then an answer: two retries
  fake.script.push({ status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } }, { status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } }, reply('Brighter now.'));
  await ask('Make the keys sparkle');
  const a1 = [...fake.actions.values()].pop();
  t.ok(a1.calls.length === 3 && JSON.stringify(a1.calls[0]) === JSON.stringify(a1.calls[2]) && a1.finish?.outcome === 'done', `503 upstream_busy is retried with the same body, at most twice (${a1.calls.length} calls)`);
  fake.script.push(...Array.from({ length: 3 }, () => ({ status: 503, retryAfter: 0, error: { code: 'upstream_busy', message: 'Claude is busy. Trying again shortly.', retryAfter: 0 } })));
  await ask('Make the keys sparkle again');
  const a2 = [...fake.actions.values()].pop();
  t.ok(a2.calls.length === 3 && a2.finish?.outcome === 'error', `a third busy answer isn't retried: the ask finishes as an error (${a2.calls.length} calls)`);
  fake.script.push({ status: 502, error: { code: 'upstream_error', message: 'The agent hit a snag on our side. You weren’t charged for it.', retryable: false } });
  await ask('Tidy the drums');
  const a3 = [...fake.actions.values()].pop();
  const note3 = await page.evaluate(() => [...document.querySelectorAll('.ag-note-bad')].pop()?.textContent || '');
  t.ok(a3.calls.length === 1 && /hit a snag on our side/.test(note3), `502 that isn't retryable isn't retried, and the service's words are shown ("${note3}")`);
  // a stale ask on the service: finished as stopped, then this one opens
  const u = fake.user('jess@example.com');
  fake.actions.set('act_stale', { id: 'act_stale', email: u.email, kind: 'question', credits: 2, status: 'open', calls: [], delivered: 0, at: Date.now() });
  fake.script.push(reply('Done, after the stale one.'));
  await ask('Make it punchier please');
  t.ok(fake.actions.get('act_stale').finish?.outcome === 'stopped' && /after the stale one/.test(await page.evaluate(() => document.querySelector('.ag-feed').textContent)), '409 action_in_flight: the stale ask is finished as stopped, then the new one opens');
  // out of credits: both buttons, the same size, and the ask back in the box
  fake.grant('jess@example.com', 1);
  await ask('Add a bassline');
  await page.waitForSelector('.ag-cl-out', { timeout: 5000 });
  const out = await page.evaluate(() => { const b = [...document.querySelectorAll('.ag-cl-out .ag-cl-two .btn')]; const r = b.map((x) => x.getBoundingClientRect()); return { text: document.querySelector('.ag-cl-out').textContent, buttons: b.map((x) => x.textContent), same: r.length === 2 && Math.abs(r[0].width - r[1].width) < 1 && Math.abs(r[0].height - r[1].height) < 1, box: document.querySelector('.ag-input').value }; });
  t.ok(/You’re out of credits\. Top up, or keep going with your own Claude \(free\)\./.test(out.text) && out.buttons.join() === 'Top up,Use your own Claude' && out.same && out.box === 'Add a bassline',
    `402: out of credits, [Top up] and [Use your own Claude] the same size, the ask back in the box (${out.buttons.join(' | ')})`);
  t.ok(/Overdub doesn’t charge for it; your Claude plan’s limits apply/.test(out.text), 'the free path keeps its qualifier: "your Claude plan’s limits apply"');
  await shot('cloud-out');
  await page.click('.ag-cl-out .ag-cl-two .btn:first-child');
  await page.waitForSelector('.ag-cl-topup', { timeout: 5000 });
  const top = await page.evaluate(() => [...document.querySelectorAll('.ag-cl-topup .ag-cl-row')].map((x) => x.textContent));
  t.ok(top.some((x) => /Overdub Plus, monthly/.test(x) && /\$1\.23/.test(x)) && top.some((x) => /40 credits/.test(x) && /\$0\.45/.test(x)), `Top up lists the plans and packs the service names, at its prices (${top.join(' | ')})`);
  // the checkout opens in a new tab; "I've paid" syncs
  const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await page.click('.ag-cl-topup [data-sku="pack_x"] .btn');
  const pop = await popup;
  t.ok(pop && /\/dev\/checkout$/.test(pop.url()), `Buy opens the service's checkout in a new tab (${pop?.url()})`);
  await pop?.close();
  await page.waitForSelector('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)', { timeout: 5000 });
  await page.click('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)');
  await page.waitForFunction(() => window.overdub.agent.cloud.me?.balance?.total === 41, null, { timeout: 5000 }).catch(() => {});
  t.ok(await page.evaluate(() => window.overdub.agent.cloud.me?.balance?.total === 41), 'after paying, "I’ve paid" asks the service and the balance updates');
  // Top up's plans: "on" beside the one plan the account has (GET /v1/me's plan.plan), and a plan bought says so
  const planRows = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ag-cl-topup .ag-cl-row')].map((r) => [r.dataset.sku, { on: [...r.querySelectorAll('.t3')].some((x) => x.textContent === 'on'), btn: r.querySelector('.btn')?.textContent || '' }])));
  const topStatus = () => page.evaluate(() => document.querySelector('.ag-cl-topup .ag-cl-status')?.textContent || '');
  const before = await planRows();
  t.ok((await topStatus()) === 'Done: your credits are in.' && !before.plus_x.on && !before.plus_y.on && before.plus_x.btn === 'Choose' && before.plus_y.btn === 'Choose',
    `a pack paid for: "${await topStatus()}", and with no plan both plans offer Choose (${JSON.stringify(before)})`);
  const popup2 = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await page.click('.ag-cl-topup [data-sku="plus_x"] .btn');
  await (await popup2)?.close();
  await page.waitForSelector('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)', { timeout: 5000 });
  await page.click('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)');
  await page.waitForFunction(() => window.overdub.agent.cloud.me?.plan?.plan === 'plus_x', null, { timeout: 5000 }).catch(() => {});
  await sleep(200);
  const after = await planRows();
  t.ok(after.plus_x.on && !after.plus_y.on && !after.plus_x.btn && !after.plus_y.btn,
    `Plus monthly bought: "on" beside monthly only, and neither plan offers Choose while it runs (${JSON.stringify(after)})`);
  t.ok((await topStatus()) === 'Done: you’re on Overdub Plus, monthly.', `... and the sheet says which plan, not credits ("${await topStatus()}")`);
  await page.evaluate(() => document.querySelector('.ag-cl-topup')?.scrollIntoView({ block: 'start' }));
  await shot('cloud-plan-on');
  fake.plan('jess@example.com', null);
  fake.plus('jess@example.com', false);
  await page.evaluate(() => window.overdub.agent.cloud.refresh());
  // paused
  fake.pause(true);
  await ask('Rework the outro');
  await page.waitForSelector('.ag-cl-paused', { timeout: 5000 });
  const paused = await page.evaluate(() => document.querySelector('.ag-cl-paused').textContent);
  t.ok(/paused right now\. Your own Claude, Claude Code and the demo still work\./.test(paused) && /Try the demo agent/.test(paused), 'paused: the free paths are offered');
  fake.pause(false);
  t.ok(realErrors(errors).length === 0, 'no page errors (limits)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 5. a Claude of your own first; free moves; the bundle */
{
  fake.grant('jess@example.com', 30);
  const { page, close } = await studio(fake, { key: true });
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config && window.overdub.agent.local, null, { timeout: 10000 });
  await page.evaluate(() => { window.overdub.agent.useMock(false); window.overdub.agent.useCloud(true); });
  const prov = await page.evaluate(() => ({ p: window.overdub.agent.provider, chosen: window.overdub.agent.cloudChosen }));
  t.ok(prov.p === 'claude' && prov.chosen, `a key on the local server beats credits, even when credits were chosen (${prov.p})`);
  await page.evaluate(() => { const e = window.overdub; e.ui.setOpen('right', true); e.ui.show('agent'); document.querySelector('.ag-hbtns .ag-hbtn:last-child')?.click(); });
  await sleep(300);
  const row = await page.evaluate(() => document.querySelector('.ag-kc-cloud')?.textContent || '');
  t.ok(/Your own Claude is on here, so it answers first/.test(row), 'and settings say so');
  await close();
  delete process.env.OVERDUB_ANTHROPIC_KEY;
}
{
  fake.grant('jess@example.com', 30);
  const { page, errors, close } = await studio(fake, { query: 'demo' });
  await chooseCloud(page);
  await signInWithGoogle(page, fake);
  const n0 = actionsOpened(fake).length;
  // a free move: one word on the selected track, run here, signed you, never sent
  await page.evaluate(() => { const e = window.overdub; const tr = e.store.get().tracks.find((x) => x.instrument && x.kind !== 'audio'); e.ui.select({ track: tr.id }); });
  await typeAsk(page, 'brighter');
  const chip = await page.evaluate(() => document.querySelector('.ag-price').textContent);
  const h0 = await page.evaluate(() => window.overdub.store.history.length);
  await page.press('.ag-input', 'Enter');
  await page.waitForFunction(() => /free \(no credits\)|didn’t go in|readings/.test([...document.querySelectorAll('.ag-note')].pop()?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const fm = await page.evaluate((h0) => ({ by: window.overdub.store.history.slice(h0).map((x) => x.by), note: [...document.querySelectorAll('.ag-note')].pop()?.textContent || '' }), h0);
  t.ok(/A quick move.· free/.test(chip) && fm.by.length && fm.by.every((b) => b === 'you') && actionsOpened(fake).length === n0 && /free \(no credits\)/.test(fm.note), `"brighter" on a selected track is a free move: the chip says so, it runs here signed you, and nothing is sent ("${fm.note}")`);
  // the prompt bundle: the export and the page agree, and a changed description changes the version
  const { bundleFrom } = await import('./agent-bundle.js');
  const b = await bundleFrom(page);
  const moved = await page.evaluate(async () => { const e = window.overdub; const tool = e.tools.TOOLS.find((x) => x.name === 'highlight'); const was = tool.description; tool.description = was + ' (changed)'; const v = await e.agent.promptVersion(); tool.description = was; return { v, back: await e.agent.promptVersion() }; });
  t.ok(b.version === b.pageVersion && /^sha256:[0-9a-f]{16}$/.test(b.version) && b.tools.every((x) => Object.keys(x).join() === 'name,description,input_schema') && b.tools.map((x) => x.name).join() === b.tools.map((x) => x.name).sort().join(),
    `the exported bundle's version is the one the page sends (${b.version}; ${b.tools.length} tools, sorted, name/description/schema only)`);
  t.ok(moved.v !== b.version && moved.back === b.version, 'a changed tool description changes the version');
  t.ok(realErrors(errors).length === 0, 'no page errors (free moves)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 6. back from a checkout: /app/?plus=done, /app/?plus=cancel */
{
  const { page, errors, close, shot } = await studio(fake);
  // the address-bar part, on its own: plus and ref leave, the rest of the query and the #hash stay
  const strip = await page.evaluate(async () => {
    const { takeCheckoutReturn: takePaidReturn } = await import('/app/src/agent/cloud-panel.js');
    const at = (u) => { const url = new URL(u); let now = u; return { win: { location: url, history: { state: null, replaceState: (_s, _t, to) => { now = new URL(to, url).href; } } }, now: () => now }; };
    const a = at('http://localhost/app/?demo&plus=done&ref=chk_9#s=abc'); const ra = takePaidReturn(a.win);
    const b = at('http://localhost/app/?plus=done&ref=../../x'); const rb = takePaidReturn(b.win);
    const c = at('http://localhost/app/?demo&plus=cancel#s=abc'); const rc = takePaidReturn(c.win);
    const d = at('http://localhost/app/?plus=other'); const rd = takePaidReturn(d.win);
    return { ra, a: a.now(), rb, b: b.now(), rc, c: c.now(), rd, d: d.now() };
  });
  t.ok(strip.ra?.ref === 'chk_9' && strip.a === 'http://localhost/app/?demo#s=abc' && strip.rb?.ref === null && strip.b === 'http://localhost/app/',
    `?plus=done&ref= is read once and leaves the address bar; the rest of the query and the hash stay; a bad ref is dropped (${strip.a} | ${strip.b})`);
  t.ok(strip.rc?.cancelled === true && !('ref' in strip.rc) && strip.c === 'http://localhost/app/?demo#s=abc' && strip.rd === null && strip.d === 'http://localhost/app/?plus=other',
    `?plus=cancel is read once and leaves the address bar the same way; any other plus= is left alone (${strip.c} | ${strip.d})`);
  await chooseCloud(page);
  await signInWithGoogle(page, fake, 'pat@example.com');
  fake.grant('pat@example.com', 30);
  // the checkout's success URL lands here, in a fresh load of the studio, with the Agent panel closed
  await page.evaluate(() => window.overdub.ui.setOpen('right', false));
  const syncs0 = fake.reqs('/v1/billing/sync').filter((r) => r.method === 'POST').length;
  await page.goto(new URL('/app/?plus=done&ref=chk_1', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-account .ag-cl-status', { timeout: 10000 }).catch(() => {});
  await sleep(700);
  const back = await page.evaluate(() => ({
    search: location.search, path: location.pathname, status: document.querySelector('.ag-cl-account .ag-cl-status')?.textContent || '',
    open: window.overdub.ui.isOpen?.('right'), visible: !!document.querySelector('.ag-cl-account')?.getClientRects().length,
    total: window.overdub.agent.cloud?.me?.balance?.total, credits: document.querySelector('.ag-cl-account .ag-cl-dl dd')?.textContent || '',
    focus: document.activeElement?.textContent,
  }));
  const posts = () => fake.reqs('/v1/billing/sync').filter((r) => r.method === 'POST');
  const synced = posts().slice(syncs0);
  t.ok(synced.length === 1 && synced[0].body?.checkoutRef === 'chk_1' && back.total === 70 && /^70/.test(back.credits), `back from paying, the studio asks the service for that checkout and the balance updates (${back.credits}; ${JSON.stringify({ syncs: synced.map((x) => x.body), total: back.total })})`);
  t.ok(back.status === 'Paid. Your credits are in.' && back.open && back.visible && back.focus === 'Claude on Overdub credits', `the Agent panel opens on the account sheet with a plain note ("${back.status}"), its heading focused (${JSON.stringify({ open: back.open, visible: back.visible, focus: back.focus })})`);
  t.ok(back.path === '/app/' && back.search === '', `and the query leaves the address bar (${back.path}${back.search})`);
  await shot('cloud-paid');
  // a reload doesn't ask again
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await sleep(800);
  t.ok(posts().length === syncs0 + 1 && !(await page.evaluate(() => document.querySelector('.ag-cl-status')?.textContent || '')).includes('Paid'), `a reload after that doesn't sync or say it again (${posts().length - syncs0} syncs)`);
  // a payment the provider hasn't marked paid yet: no "your credits are in"; Top up with "I've paid" to press later
  await page.goto(new URL('/app/?plus=done&ref=chk_late', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-topup', { timeout: 10000 }).catch(() => {});
  const late = await page.evaluate(() => ({ text: document.querySelector('.ag-cl-topup')?.textContent || '', btn: [...document.querySelectorAll('.ag-cl-topup .ag-kc-acts .btn:not(.btn-txt)')].map((b) => b.textContent), total: window.overdub.agent.cloud?.me?.balance?.total, search: location.search }));
  t.ok(/The payment hasn’t reached us yet\. Give it a minute, then press I’ve paid\./.test(late.text) && !/credits are in/.test(late.text) && late.btn.includes('I’ve paid: update my credits') && late.total === 70 && late.search === '',
    `a payment that hasn't landed yet: no "credits are in", and "I've paid" is there to press later (${late.btn.join(' | ')})`);
  // a cancelled checkout lands here too: Top up again with one plain line, and nothing asked of the service
  await page.evaluate(() => window.overdub.ui.setOpen('right', false));
  const billing0 = fake.reqs(/^\/v1\/billing\//).filter((r) => r.method === 'POST').length;
  await page.goto(new URL('/app/?plus=cancel', page.url()).href, { waitUntil: 'load' });
  await ready(page);
  await page.waitForSelector('.ag-cl-topup .ag-cl-status', { timeout: 10000 }).catch(() => {});
  await sleep(500);
  const cx = await page.evaluate(() => ({
    status: document.querySelector('.ag-cl-topup .ag-cl-status')?.textContent || '', search: location.search, path: location.pathname,
    open: window.overdub.ui.isOpen?.('right'), visible: !!document.querySelector('.ag-cl-topup')?.getClientRects().length,
    paid: [...document.querySelectorAll('.ag-cl-topup .btn')].some((b) => /I’ve paid/.test(b.textContent)), total: window.overdub.agent.cloud?.me?.balance?.total,
  }));
  const billingPosts = fake.reqs(/^\/v1\/billing\//).filter((r) => r.method === 'POST').length - billing0;
  t.ok(cx.status === 'Nothing was bought.' && cx.open && cx.visible && !cx.paid && cx.total === 70, `back from a cancelled checkout, the Top up sheet opens again with "${cx.status}" and no "I've paid" (${JSON.stringify(cx)})`);
  t.ok(billingPosts === 0, `a cancelled checkout charges and syncs nothing (${billingPosts} billing calls)`);
  t.ok(cx.path === '/app/' && cx.search === '', `and plus=cancel leaves the address bar (${cx.path}${cx.search})`);
  await shot('cloud-cancelled');
  t.ok(realErrors(errors).length === 0, 'no page errors (back from a checkout)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 7. the account sheet: a new account, and the service paused */
{
  const { page, errors, close, shot } = await studio(fake);
  const sheetText = () => page.evaluate(() => ({
    text: document.querySelector('.ag-cl-account')?.textContent || '',
    credits: document.querySelector('.ag-cl-account .ag-cl-dl dd')?.textContent || '',
    topUp: [...document.querySelectorAll('.ag-cl-account .btn')].some((b) => b.textContent === 'Top up'),
    head: document.querySelector('.ag-who')?.textContent || '',
  }));
  // a brand-new account: nothing to spend and nothing spent, so no "about 0 asks" and no credits back yet
  fake.grant('new@example.com', 0);
  await chooseCloud(page);
  await signInWithGoogle(page, fake, 'new@example.com');
  await page.click('.ag-pill-cloud');
  await page.waitForSelector('.ag-cl-account', { timeout: 5000 });
  await until(() => page.evaluate(() => !/Reading…/.test(document.querySelector('.ag-cl-account')?.textContent || '')), 3000);
  const fresh = await sheetText();
  t.ok(fresh.credits === '0' && !/Credits back/.test(fresh.text) && fresh.topUp && !/paused/.test(fresh.text),
    `a new account's sheet: "0" credits (no "about 0 asks"), no credits back until there's something to spend, Top up (${JSON.stringify(fresh.credits)})`);
  await shot('cloud-account-new');
  // credits in: the estimate in asks and the credits-back line come back, its period said once
  fake.grant('new@example.com', 7);
  await page.evaluate(() => window.overdub.agent.cloud.refresh());
  await until(() => sheetText().then((s) => /^7/.test(s.credits)), 3000);
  const funded = await sheetText();
  t.ok(/^7, about 2 asks$/.test(funded.credits) && /Credits backUndo an ask soon after it runs and its credits come back: 9 of 9 left this month/.test(funded.text),
    `with credits: "${funded.credits}" and the credits-back line in one sentence`);
  // the kill switch: the sheet says paused, the head says paused, nothing to buy
  fake.hosted(false);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in' && window.overdub.agent.cloud.config?.hosted?.enabled === false, null, { timeout: 10000 });
  await chooseCloud(page);
  await page.click('.ag-pill-cloud');
  await page.waitForSelector('.ag-cl-account', { timeout: 5000 });
  const paused = await sheetText();
  t.ok(/Claude on Overdub credits is paused right now\./.test(paused.text) && !paused.topUp && /on credits, paused/.test(paused.head),
    `with the service paused: the sheet says so, no Top up, and the head says "on credits, paused" (${paused.head.trim()})`);
  await shot('cloud-account-paused');
  fake.hosted(true);
  t.ok(realErrors(errors).length === 0, 'no page errors (the account sheet)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();
}

/* ------------------------------------------------------------------ 8. songs in the account (ui/songs.js) */
// Save to cloud, My songs (list, open, earlier saves, delete), the link and its save as you work, a newer save made
// elsewhere, no Plus, signed out, and nothing of it without the service's songs module. Desktop and a phone.
{
  const { createProject } = await import('../app/src/core/project.js');
  const song = (title, extra = {}) => ({ ...createProject({ title }), ...extra });
  const songMenu = async (page) => {
    await page.evaluate(() => window.overdub.exporter.openMenu());
    await page.waitForSelector('.sm', { timeout: 3000 });
    return page.evaluate(() => [...document.querySelectorAll('.sm .sm-i')].map((b) => b.textContent.trim()));
  };
  const closeMenu = (page) => page.evaluate(() => { for (const p of document.querySelectorAll('.ew-pop')) p.remove(); });
  const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent.trim()));
  const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('.ew-toast').forEach((t) => t.remove()));
  // the song on screen's link, in the account signed in (overdub:cloud-song is keyed '<user id> <project id>')
  const link = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('overdub:cloud-song') || '{}')[`${window.overdub.agent.cloud?.me?.user?.id} ${window.overdub.store.get().id}`] || null);
  // the tab hidden for a moment: what's waiting goes at once
  const hide = (page) => page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  const toastAct = (page, re) => page.evaluate((src) => { const t = [...document.querySelectorAll('.ew-toast')].find((x) => new RegExp(src).test(x.textContent)); t?.querySelector('.ew-toast-act')?.click(); return !!t; }, re.source);
  const songNamed = (title) => fake.songsOf(who).filter((x) => x.row.title === title);
  const edit = (page, title) => page.evaluate((t) => window.overdub.store.dispatch({ type: 'project.set', patch: { title: t } }, { by: 'you', label: 'title' }), title);
  const songPosts = () => fake.reqs(/^\/v1\/songs/).filter((r) => r.method === 'POST');

  // 8a. the service without songs: nothing of them anywhere
  fake.songs(false);
  {
    const { page, errors, close } = await studio(fake);
    await page.waitForFunction(() => !!window.overdub.agent.cloud?.config, null, { timeout: 10000 });
    const rows = await songMenu(page);
    const find = await page.evaluate(() => window.overdub.find.search('my songs').map((r) => r.title));
    t.ok(!rows.some((r) => /cloud|My songs/.test(r)) && !find.includes('My songs') && !fake.reqs('/v1/songs').length,
      `a service without songs: no Save to cloud or My songs in the Song menu, none in Find, nothing asked (${rows.length} rows)`);
    t.ok(realErrors(errors).length === 0, 'no page errors (songs off)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
    await close();
  }

  fake.songs(true);
  const who = 'sam@example.com';
  fake.plus(who, false);
  const old = fake.seedSong(who, song('Porch Light'), Date.now() - 3 * 3600e3);
  const { page, errors, close, shot: shotNow } = await studio(fake);
  const shot = async (name) => { await sleep(350); await shotNow(name); };   // (after the sheet's fade in)
  await page.waitForFunction(() => !!window.overdub.agent.cloud?.config?.songs, null, { timeout: 10000 });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  // 8b. signed out: Save to cloud says sign in; My songs is the sign-in, the Agent tab's Google
  {
    const rows = await songMenu(page);
    t.ok(rows.some((r) => /^Save to cloudSign in to save songs to your account$/.test(r)) && rows.some((r) => /^My songs/.test(r)),
      `signed out, the Song menu offers Save to cloud with "Sign in to save songs to your account", and My songs (${rows.filter((r) => /cloud|songs/i.test(r)).join(' | ')})`);
    await page.click('.sm .sm-cloud-save');
    await page.waitForSelector('.sg-pop .sg-google', { timeout: 3000 });
    const s = await page.evaluate(() => ({ text: document.querySelector('.sg-pop').textContent, fields: document.querySelectorAll('.sg-pop input, .sg-pop iframe').length }));
    t.ok(/Sign in to save songs to your account/.test(s.text) && /Continue with Google/.test(s.text) && s.fields === 0 && !songPosts().length,
      'Save to cloud signed out opens My songs on the sign-in: one Continue with Google, no field, nothing saved');
    await shot('cloud-songs-signed-out');
    fake.next(who);
    fake.popup({});
    await Promise.all([page.context().waitForEvent('page'), page.click('.sg-pop .sg-google')]);
    await page.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in', null, { timeout: 8000 });
    await page.waitForSelector('.sg-pop .sg-row', { timeout: 5000 });
    const listed = await page.evaluate(() => [...document.querySelectorAll('.sg-pop .sg-row')].map((r) => r.textContent));
    t.ok(listed.length === 1 && /Porch Light/.test(listed[0]) && /saved 3 h ago · 0 tracks/.test(listed[0]),
      `signed in from My songs itself: the sheet lists the account's songs, each with when it was saved and its tracks ("${listed[0]}")`);
  }

  // 8c. no Plus: the list still shows and opens; Save says Plus and opens the plans
  {
    const s = await page.evaluate(() => document.querySelector('.sg-pop').textContent);
    t.ok(/Cloud saves come with Plus\. The songs already here still open/.test(s) && !/Save “/.test(s), 'without Plus, My songs says cloud saves come with Plus, and offers no Save');
    await shot('cloud-songs-no-plus');
    await closeMenu(page);
    const rows = await songMenu(page);
    t.ok(rows.some((r) => /^Save to cloudCloud saves come with Plus$/.test(r)), `... and the Song menu's Save to cloud says "Cloud saves come with Plus" (${rows.find((r) => /^Save to cloud/.test(r))})`);
    await page.click('.sm .sm-cloud-save');
    await page.waitForSelector('.ag-cl-topup', { timeout: 5000 });
    const plans = await page.evaluate(() => ({ open: window.overdub.ui.isOpen('right'), text: document.querySelector('.ag-cl-topup').textContent }));
    t.ok(plans.open && /Overdub Plus, monthly/.test(plans.text) && !songPosts().length, 'Save to cloud without Plus opens the plans (the Agent tab\'s Top up) and saves nothing');
  }

  // 8d. Plus: Save to cloud, the link, and a save as you work (5 s after a change, and when the tab is hidden)
  let first = null;
  {
    fake.plus(who, true);
    // Plus bought in this tab (or another): GET /v1/me says so, and Save to cloud follows it with no other ask
    // (the list read before still said canSave false)
    const listReads = fake.reqs('/v1/songs').filter((r) => r.method === 'GET').length;
    await page.evaluate(() => window.overdub.agent.cloud.refresh());
    const offered = await songMenu(page);
    await closeMenu(page);
    t.ok(offered.some((r) => /^Save to cloudkeeps it in your account, saved as you work$/.test(r)) && fake.reqs('/v1/songs').filter((r) => r.method === 'GET').length === listReads,
      `Plus bought: once /v1/me says so, Save to cloud is offered at once, without reading the list again (${offered.find((r) => /^Save to cloud/.test(r))})`);
    await page.evaluate(() => window.overdub.songs.refresh());
    await edit(page, 'Night Ride');
    const pid = await page.evaluate(() => window.overdub.store.get().id);
    const rows = await songMenu(page);
    t.ok(rows.some((r) => /^Save to cloudkeeps it in your account, saved as you work$/.test(r)), `with Plus, Save to cloud is offered (${rows.find((r) => /^Save to cloud/.test(r))})`);
    await page.click('.sm .sm-cloud-save');
    await until(() => link(page), 5000);
    const l = await link(page);
    const post = songPosts().at(-1);
    first = l?.songId;
    t.ok(post?.path === '/v1/songs' && post.body?.doc?.id === pid && post.body.doc.title === 'Night Ride' && /^[A-Za-z0-9_-]{8,64}$/.test(post.body.createId || '') && post.headers['idempotency-key'] === undefined && l?.rev === 1,
      `Save to cloud: POST /v1/songs with the song (and one createId in the body, no Idempotency-Key header), and overdub:cloud-song links this song to it at rev 1 (${JSON.stringify(l)})`);
    const said = await toasts(page);
    t.ok(said.some((x) => /^“Night Ride” is in your account\. Changes save there as you work; its recordings stay in this browser\./.test(x)), `... and says so ("${said.find((x) => /account/.test(x))}")`);
    await closeMenu(page);
    const rows2 = await songMenu(page);
    t.ok(rows2.some((r) => /^Saved to cloud · just nowsaves as you work$/.test(r)) && !rows2.some((r) => /^Save to cloud/.test(r)), `the Song menu says "Saved to cloud · just now" for it (${rows2.find((r) => /^Saved/.test(r))})`);
    await closeMenu(page);
    // a change: saved 5 s later, from the rev it knows
    const n0 = songPosts().length, at = Date.now();
    await edit(page, 'Night Ride (bridge)');
    await sleep(2500);
    const early = songPosts().length - n0;
    await until(() => songPosts().length > n0, 6000);
    const save = songPosts().at(-1);
    t.ok(early === 0 && save?.path === `/v1/songs/${first}` && save.body.baseRev === 1 && save.body.doc.title === 'Night Ride (bridge)' && Date.now() - at >= 4500,
      `a change saves about 5 s later, not before: POST /v1/songs/${first} with baseRev 1 (${early} saves in the first 2.5 s, ${Date.now() - at} ms)`);
    await until(async () => (await link(page))?.rev === 2, 3000);
    // the tab hidden: what's waiting goes at once
    const n1 = songPosts().length;
    await edit(page, 'Night Ride (outro)');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await until(() => songPosts().length > n1, 2000);
    await page.evaluate(() => { delete document.hidden; });
    t.ok(songPosts().length === n1 + 1 && songPosts().at(-1).body.baseRev === 2 && songPosts().at(-1).body.doc.title === 'Night Ride (outro)', 'the tab hidden: the waiting save goes at once (baseRev 2)');
    await until(async () => (await link(page))?.rev === 3, 3000);
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('overdub:project')).title);
    t.ok(local === 'Night Ride (outro)', `the local autosave is as it was (overdub:project "${local}")`);
  }

  // 8e. a newer save made elsewhere: nothing is saved over it; keep mine as a new song, or open the newer one
  {
    await clearToasts(page);
    fake.saveElsewhere(who, first, { title: 'Night Ride (laptop)' });
    const n0 = songPosts().length;
    await edit(page, 'Night Ride (phone)');
    await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)), null, { timeout: 9000 });
    const tx = (await toasts(page)).find((x) => /newer save/.test(x)) || '';
    const s = fake.songsOf(who).find((x) => x.row.songId === first);
    t.ok(/^Not saved: your account has a newer save of “Night Ride \(phone\)”, from just now, made in another tab or browser\. Nothing was saved over it\./.test(tx) && /Keep mine as a new song/.test(tx) && /Open the newer one/.test(tx) && s.row.title === 'Night Ride (laptop)' && songPosts().length === n0 + 1,
      `a save the account answers 409: a toast with two ways out, and the newer save untouched ("${tx.slice(0, 120)}…")`);
    await shot('cloud-songs-conflict');
    // no more tries while it's open
    await edit(page, 'Night Ride (phone 2)');
    await sleep(6000);
    t.ok(songPosts().length === n0 + 1, `nothing more is sent for that song until it's settled (${songPosts().length - n0} saves)`);
    const rows = await songMenu(page);
    t.ok(rows.some((r) => /^Not saved: a newer save is in your account/.test(r)), `the Song menu says so too (${rows.find((r) => /^Not saved/.test(r))})`);
    await closeMenu(page);
    await page.click('.ew-toast .sg-toast-b');
    await until(async () => (await link(page))?.songId !== first, 5000);
    const l = await link(page);
    t.ok(l && l.songId !== first && l.rev === 1 && fake.songsOf(who).length === 3 && fake.songsOf(who).find((x) => x.row.songId === l.songId).row.title === 'Night Ride (phone 2)',
      `Keep mine as a new song: a new song in the account, this one linked to it (${JSON.stringify(l)}; ${fake.songsOf(who).length} songs)`);
    // the other way: open the newer one
    await clearToasts(page);
    const second = l.songId;
    fake.saveElsewhere(who, second, { title: 'Night Ride (tablet)' });
    await edit(page, 'Night Ride (phone 3)');
    await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)), null, { timeout: 9000 });
    await page.click('.ew-toast .ew-toast-act');
    await page.waitForFunction(() => window.overdub.store.get().title === 'Night Ride (tablet)', null, { timeout: 5000 });
    const after = await page.evaluate(() => ({ recent: window.overdub.exporter.recent().map((r) => r.title), toasts: [...document.querySelectorAll('.ew-toast')].map((t) => t.textContent) }));
    const l2 = await link(page);
    t.ok(after.recent.includes('Night Ride (phone 3)') && l2?.songId === second && l2.rev === 2 && after.toasts.some((x) => /^Opened “Night Ride \(tablet\)” from your account\./.test(x) && /Undo/.test(x)),
      `Open the newer one: it opens the way a song file does (yours in Recent songs, Undo), linked at its rev (${JSON.stringify(l2)})`);
    // saves go on from there
    const n2 = songPosts().length;
    await edit(page, 'Night Ride (tablet, edited)');
    await until(() => songPosts().length > n2, 9000);
    t.ok(songPosts().at(-1).body.baseRev === 2 && songPosts().at(-1).path === `/v1/songs/${second}`, 'and saves go on from the newer one');
  }

  // 8f. My songs: open another song (its missing recordings named), an earlier save as a copy, and delete
  {
    await clearToasts(page);
    const doc = song('Tape Hiss', { tracks: [{ name: 'Vox', kind: 'audio', clips: [{ kind: 'audio', asset: 'a_gone01', start: 0, length: 4 }] }], assets: { a_gone01: { kind: 'audio', name: 'Vocal take 1', sr: 48000, channels: 1, duration: 2 } } });
    const hiss = fake.seedSong(who, doc);
    await page.evaluate(() => window.overdub.songs.open());
    await page.waitForSelector(`.sg-row[data-song="${hiss.songId}"]`, { timeout: 5000 });
    await until(() => page.evaluate((id) => /recording/.test(document.querySelector(`.sg-row[data-song="${id}"]`)?.textContent || ''), hiss.songId), 3000);
    const rowText = await page.evaluate((id) => document.querySelector(`.sg-row[data-song="${id}"]`).textContent, hiss.songId);
    const here = await page.evaluate(() => document.querySelector('.sg-row.sg-here')?.textContent || '');
    t.ok(/1 track · 1 recording, not on this browser/.test(rowText) && /on screen/.test(here), `each song says its tracks and recordings ("${rowText}"), and the one on screen says so`);
    await shot('cloud-songs-list');
    await page.click(`.sg-row[data-song="${hiss.songId}"] .sg-open`);
    await page.waitForFunction(() => window.overdub.store.get().title === 'Tape Hiss', null, { timeout: 5000 });
    const tx = (await toasts(page)).find((x) => /Tape Hiss/.test(x)) || '';
    const l = await link(page);
    t.ok(/^Opened “Tape Hiss” from your account\. One recording isn’t in this browser, so it’s silent here: “Vocal take 1”\. A cloud save keeps the song, not its audio\./.test(tx) && l?.songId === hiss.songId,
      `Open: the song comes in, linked, and its missing recording is named ("${tx.slice(0, 160)}")`);
    // earlier saves of the first song: open one as a copy, unlinked
    await clearToasts(page);
    await page.evaluate(() => window.overdub.songs.open());
    await page.waitForSelector(`.sg-row[data-song="${first}"] .sg-revs`, { timeout: 5000 });
    await page.click(`.sg-row[data-song="${first}"] .sg-revs`);
    await page.waitForSelector(`.sg-row[data-song="${first}"] .sg-rev`, { timeout: 5000 });
    const revs = await page.evaluate((id) => [...document.querySelectorAll(`.sg-row[data-song="${id}"] .sg-rev`)].map((r) => r.textContent), first);
    t.ok(revs.length === 3 && /^Save 3/.test(revs[0]) && /^Save 1/.test(revs[2]), `Earlier saves lists the kept ones, newest first, without the latest (${revs.join(' | ')})`);
    await shot('cloud-songs-revs');
    await page.click(`.sg-row[data-song="${first}"] .sg-rev:last-child .sg-rev-open`);
    await page.waitForFunction(() => /\(save 1\)$/.test(window.overdub.store.get().title), null, { timeout: 5000 });
    const copy = await page.evaluate(() => ({ title: window.overdub.store.get().title, id: window.overdub.store.get().id }));
    t.ok(copy.title === 'Night Ride (save 1)' && !(await link(page)), `Open as a copy: "${copy.title}", a song of its own, linked to nothing`);
    // delete: asked under the row, never a browser dialog
    await page.evaluate(() => window.overdub.songs.open());
    await page.waitForSelector(`.sg-row[data-song="${old.songId}"] .sg-del`, { timeout: 5000 });
    await page.click(`.sg-row[data-song="${old.songId}"] .sg-del`);
    const ask = await page.evaluate((id) => document.querySelector(`.sg-row[data-song="${id}"] .sg-ask`)?.textContent || '', old.songId);
    t.ok(/^Delete “Porch Light” from your account, with its earlier saves\?/.test(ask) && !fake.reqs(/^\/v1\/songs\//).some((r) => r.method === 'DELETE'), `Delete asks first, under the row ("${ask.slice(0, 70)}"), and deletes nothing yet`);
    await shot('cloud-songs-delete');
    await page.click(`.sg-row[data-song="${old.songId}"] .sg-del-go`);
    await page.waitForFunction((id) => !document.querySelector(`.sg-row[data-song="${id}"]`), old.songId, { timeout: 5000 });
    const gone = await page.evaluate(() => document.querySelector('.sg-said')?.textContent || '');
    t.ok(gone === '“Porch Light” is deleted from your account.' && !fake.songsOf(who).some((x) => x.row.songId === old.songId) && dialogs.length === 0,
      `Delete it: gone from the account and the list ("${gone}"), and no browser dialog (${dialogs.length})`);
    const find = await page.evaluate(() => window.overdub.find.search('my songs').map((r) => r.title));
    t.ok(find.includes('My songs'), `Find knows My songs (${find.slice(0, 4).join(', ')})`);
    await closeMenu(page);
  }

  // 8h. a write whose answer is lost goes again as the same write; a song put aside keeps its own save; two tabs
  {
    await clearToasts(page);
    // Save to cloud, its answer lost: sent again with the same createId, and the account has one song, not two
    await edit(page, 'Lost and found');
    const c0 = songPosts().filter((r) => r.path === '/v1/songs').length;
    fake.loseAnswers(1);
    await page.evaluate(() => window.overdub.songs.save());
    await until(() => link(page), 6000);
    const creates = songPosts().filter((r) => r.path === '/v1/songs').slice(c0);
    const lf = (await link(page))?.songId;
    t.ok(creates.length === 2 && creates[0].body.createId && creates[1].body.createId === creates[0].body.createId && songNamed('Lost and found').length === 1 && songNamed('Lost and found')[0].row.songId === lf,
      `Save to cloud whose answer was lost: sent again with the same createId, one song in the account, linked (${creates.length} posts, ${songNamed('Lost and found').length} songs)`);
    // a save whose answer is lost: the next one is the same save again (same saveId), answered as a repeat, then the newer state
    const path = `/v1/songs/${lf}`;
    const s0 = songPosts().filter((r) => r.path === path).length;
    fake.loseAnswers(1);
    await edit(page, 'Lost and found (2)');
    await hide(page);
    const erred = await until(() => page.evaluate(() => window.overdub.songs.state.status === 'error'), 4000);
    await edit(page, 'Lost and found (3)');
    await hide(page);
    await until(() => fake.songsOf(who).find((x) => x.row.songId === lf)?.row.title === 'Lost and found (3)', 6000);
    const saves = songPosts().filter((r) => r.path === path).slice(s0).map((r) => r.body);
    const row3 = fake.songsOf(who).find((x) => x.row.songId === lf).row;
    t.ok(erred && saves.length === 3 && saves[0].saveId && saves[1].saveId === saves[0].saveId && saves[2].saveId !== saves[0].saveId && saves[1].doc.title === 'Lost and found (2)' && saves[1].baseRev === 1 && saves[2].baseRev === 2 && row3.rev === 3 && !(await toasts(page)).some((x) => /newer save/.test(x)),
      `a save whose answer was lost goes again with its saveId (a repeat, no conflict with itself), then the newer state (${saves.map((x) => `${x.doc.title}@${x.baseRev}`).join(', ')}; rev ${row3.rev})`);
    // a song put aside while its save waits: the list's row is that song's, not the one on screen
    await page.evaluate(() => window.overdub.songs.refresh());
    await edit(page, 'Lost and found (4)');
    await page.evaluate(() => window.overdub.exporter.newSong());
    await until(() => fake.songsOf(who).find((x) => x.row.songId === lf)?.row.title === 'Lost and found (4)', 6000);
    await sleep(200);
    const listed = await page.evaluate((id) => window.overdub.songs.list?.songs.find((x) => x.songId === id) || null, lf);
    t.ok(listed?.title === 'Lost and found (4)' && listed.rev === 4,
      `a song put aside saves as itself, and My songs' row says so, not the song on screen ("${listed?.title}", rev ${listed?.rev})`);
    // Undo brings it back (with the save it stands on); "Open the newer one", then Undo to yours: yours is a conflict
    await toastAct(page, /^New song\./);
    await page.waitForFunction(() => window.overdub.store.get().title === 'Lost and found (4)', null, { timeout: 5000 });
    await clearToasts(page);
    fake.saveElsewhere(who, lf, { title: 'Lost and found (desk)' });
    await edit(page, 'Lost and found (mine)');
    await hide(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)), null, { timeout: 6000 });
    await toastAct(page, /newer save/);
    await page.waitForFunction(() => window.overdub.store.get().title === 'Lost and found (desk)', null, { timeout: 5000 });
    await toastAct(page, /^Opened “Lost and found \(desk\)”/);
    await page.waitForFunction(() => window.overdub.store.get().title === 'Lost and found (mine)', null, { timeout: 5000 });
    await clearToasts(page);
    const u0 = songPosts().filter((r) => r.path === path).length;
    await edit(page, 'Lost and found (mine, after Undo)');
    await hide(page);
    await until(() => songPosts().filter((r) => r.path === path).length > u0, 4000);
    await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)), null, { timeout: 4000 }).catch(() => null);
    const undoSave = songPosts().filter((r) => r.path === path).at(-1).body;
    const desk = fake.songsOf(who).find((x) => x.row.songId === lf).row;
    t.ok(undoSave.baseRev === 4 && desk.title === 'Lost and found (desk)' && desk.rev === 5 && (await toasts(page)).some((x) => /^Not saved: your account has a newer save of “Lost and found \(mine, after Undo\)”/.test(x)),
      `Undo after "Open the newer one": yours saves from its own save (baseRev ${undoSave.baseRev}), gets a 409 and asks; the newer save is untouched ("${desk.title}", rev ${desk.rev})`);
    await shot('cloud-songs-undo-conflict');
    // a copy put aside, a conflict: Keep mine makes a song of that copy, not of the song on screen
    await toastAct(page, /newer save/);   // (Open the newer one: settled)
    await page.waitForFunction(() => window.overdub.store.get().title === 'Lost and found (desk)', null, { timeout: 5000 });
    await clearToasts(page);
    fake.saveElsewhere(who, lf, { title: 'Lost and found (phone)' });
    await edit(page, 'Lost and found (desk, mine)');
    await page.evaluate(() => window.overdub.songs.open());
    await page.waitForSelector(`.sg-row[data-song="${lf}"] .sg-open`, { timeout: 5000 });
    await page.click(`.sg-row[data-song="${lf}"] .sg-open`);
    await page.waitForFunction(() => window.overdub.store.get().title === 'Lost and found (phone)', null, { timeout: 5000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save of “Lost and found \(desk, mine\)”/.test(t.textContent)), null, { timeout: 5000 });
    await page.click('.ew-toast .sg-toast-b');
    await until(() => songNamed('Lost and found (desk, mine)').length === 1, 5000);
    const kept = songNamed('Lost and found (desk, mine)');
    const l3 = await link(page);
    t.ok(kept.length === 1 && kept[0].row.songId !== lf && !songNamed('Lost and found (phone)').some((x) => x.row.songId !== lf) && l3?.songId === lf,
      `a conflict on a song just put aside: Keep mine makes a new song of that copy ("${kept[0]?.row.title}"), and the song on screen stays linked to its own (${l3?.songId === lf})`);
    // two tabs on one song: the second one's save is a conflict, never over the first's
    await clearToasts(page);
    await sleep(700);   // (the autosave: the second tab opens this copy)
    const p2 = await page.context().newPage();
    await p2.goto(page.url());
    await ready(p2);
    await p2.waitForFunction(() => window.overdub.agent.cloud?.state === 'signed-in' && !!window.overdub.agent.cloud.config?.songs, null, { timeout: 10000 });
    const p2title = await p2.evaluate(() => window.overdub.store.get().title);
    await edit(page, 'Lost and found (tab 1)');
    await hide(page);
    await until(() => fake.songsOf(who).find((x) => x.row.songId === lf)?.row.title === 'Lost and found (tab 1)', 5000);
    const t0 = songPosts().filter((r) => r.path === path).length;
    await edit(p2, 'Lost and found (tab 2)');
    await hide(p2);
    await until(() => songPosts().filter((r) => r.path === path).length > t0, 4000);
    await p2.waitForFunction(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)), null, { timeout: 4000 }).catch(() => null);
    const tab2 = songPosts().filter((r) => r.path === path).at(-1).body;
    const tabRow = fake.songsOf(who).find((x) => x.row.songId === lf).row;
    const p2toast = await p2.evaluate(() => [...document.querySelectorAll('.ew-toast')].some((t) => /newer save/.test(t.textContent)));
    t.ok(p2title === 'Lost and found (phone)' && tab2.doc.title === 'Lost and found (tab 2)' && tab2.baseRev === tabRow.rev - 1 && tabRow.title === 'Lost and found (tab 1)' && p2toast,
      `two tabs on one song: the second saves from the save it opened (baseRev ${tab2.baseRev}, the account at ${tabRow.rev}), gets a 409 and asks; the first tab's save stands ("${tabRow.title}")`);
    await p2.close();
    await clearToasts(page);
  }
  t.ok(realErrors(errors).length === 0, 'no page errors (songs)' + (realErrors(errors).length ? ': ' + realErrors(errors).slice(0, 3).join(' | ') : ''));
  await close();

  // 8g. on a phone: My songs is a bottom sheet with 12 px text and 44 px keys
  {
    const P = await open('/app/', { width: 390, height: 844 });
    await ready(P.page);
    await P.page.evaluate(() => { localStorage.setItem('overdub:welcomed', '1'); });
    await P.page.reload({ waitUntil: 'load' });
    await ready(P.page);
    await P.page.waitForFunction(() => !!window.overdub.agent.cloud?.config?.songs, null, { timeout: 10000 });
    await P.page.evaluate(() => window.overdub.songs.open());
    await P.page.waitForSelector('.sg-pop .sg-google', { timeout: 5000 });
    fake.next(who);
    fake.popup({});
    await Promise.all([P.page.context().waitForEvent('page'), P.page.click('.sg-pop .sg-google')]);
    await P.page.waitForSelector('.sg-pop .sg-row', { timeout: 8000 });
    await P.page.click('.sg-pop .sg-row .sg-del');
    await sleep(300);
    const m = await P.page.evaluate(() => {
      const pop = document.querySelector('.sg-pop'), r = pop.getBoundingClientRect();
      const small = [];
      const walker = document.createTreeWalker(pop, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el.getClientRects().length) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11.95) small.push(`${el.className} ${fs}px "${n.textContent.trim().slice(0, 16)}"`); }
      const keys = [...pop.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => ({ t: b.textContent.trim().slice(0, 16), h: Math.round(b.getBoundingClientRect().height) }));
      return { left: Math.round(r.left), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), wide: document.documentElement.scrollWidth <= innerWidth, small, short: keys.filter((k) => k.h < 44), keys: keys.length };
    });
    t.ok(m.left === 8 && m.right === 8 && m.bottom === 8 && m.wide, `phone: My songs is a sheet along the bottom, 8 px from the edges, no sideways scroll (${JSON.stringify({ left: m.left, right: m.right, bottom: m.bottom })})`);
    t.ok(!m.small.length, `phone: no text under 12 px in My songs${m.small.length ? ': ' + m.small.slice(0, 4).join(', ') : ''}`);
    t.ok(m.keys >= 4 && !m.short.length, `phone: its ${m.keys} keys are 44 px tall${m.short.length ? ' (not: ' + m.short.map((k) => `${k.t} ${k.h}`).join(', ') + ')' : ''}`);
    await sleep(350);
    await P.shot('cloud-songs-phone');
    t.ok(realErrors(P.errors).length === 0, 'no page errors (songs on a phone)' + (realErrors(P.errors).length ? ': ' + realErrors(P.errors).slice(0, 3).join(' | ') : ''));
    await P.close();
  }
  fake.songs(false);
}

delete process.env.OVERDUB_CLOUD_ORIGIN;
await fake.close();
t.done();
process.exit(process.exitCode || 0);
