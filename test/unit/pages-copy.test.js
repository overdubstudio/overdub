// The press kit, docs and landing copy read as source: the claims (nothing retired, no Chrome-only, no "sandboxed", built-in
// counts, the Tap lane's keys, the share copy), the gallery's public path (path-rewrite.js in a vm, the server on a free
// port), the landing page's words for any device, and the guide's buttons, models, keys and counts. Moved intact from
// tools/pages-test.js; the pages in a browser, the tool counts (they ask the live studio), the suite and check counts (they
// read tools/.out/run-all.json, which CI has not got) stay there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS } from '../../tools/docs-build.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// The deck, the strategy memo and the launch drafts live in a private repo beside this one (OVERDUB_PRIVATE to point
// elsewhere). The claims checks read them when they're there and skip them in a public clone.
const CHECKOUT = ROOT.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '');
const PRIV = process.env.OVERDUB_PRIVATE || path.resolve(CHECKOUT, '..', 'overdub-private');
const HAS_PRIV = fs.existsSync(path.join(PRIV, 'deck/index.html'));

test('words for any device: the hum, and the landing pedal', () => {
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sk = rd('app/src/ui/sketch.js'),
    pedal = rd('site/assets/pedal.js');
  assert.ok(
    /The sound stays on this device; an agent you’ve connected can read the notes/.test(sk) &&
      !/nothing leaves this device/.test(sk) &&
      !/leaves this computer/.test(sk + rd('site/index.html')),
    'the hum says the sound stays on this device and a connected agent can read the notes (never "nothing leaves": get_capture reads them)',
  );
  assert.ok(
    /Drag the knobs, or tab to one and use the arrow keys/.test(pedal),
    'the landing pedal\'s hint reads on a phone too ("Drag the knobs, or tab to one…")',
  );
});

test('the gallery at /community/ and path-rewrite.js', async () => {
  const vm = await import('node:vm');
  const { startServer } = await import('../../server/serve.js');
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const [a, b] = await Promise.all(['/community/', '/site/community/'].map((u) => fetch(srv.url + u)));
    const [ta, tb] = await Promise.all([a.text(), b.text()]);
    assert.ok(
      a.status === 200 && b.status === 200 && ta === tb && /<title>Community shelf/.test(ta),
      `/community/ and /site/community/ both serve the gallery (${a.status}, ${b.status})`,
    );
    assert.ok(
      /<link rel="canonical" href="https:\/\/overdubstudio\.com\/community\/">/.test(tb),
      'the gallery is canonical to https://overdubstudio.com/community/',
    );
    const r = await fetch(srv.url + '/community?kind=effect', { redirect: 'manual' });
    assert.ok(
      r.status === 301 && r.headers.get('location') === '/community/?kind=effect',
      `/community is a 301 to /community/, the query kept (${r.status} ${r.headers.get('location')})`,
    );
  } finally {
    await srv.close();
  }
  // the page's own references are absolute, so it works from either path
  const html = fs.readFileSync(path.join(ROOT, 'site/community/index.html'), 'utf8');
  const rel = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(\/|https?:|#|mailto:)/.test(u));
  assert.ok(
    !rel.length,
    `the gallery's src and href are absolute, so /community/ and /site/community/ load the same files${rel.length ? ' (relative: ' + rel.join(', ') + ')' : ''}`,
  );

  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'deploy/path-rewrite.js'), 'utf8'), sandbox);
  const ev = (uri, host = 'overdubstudio.com', querystring = {}) =>
    sandbox.handler({ request: { uri, querystring, headers: host ? { host: { value: host } } : {} } });
  const g = ev('/community/'),
    noDot = ev('/community', 'overdubstudio.com', { kind: { value: 'effect' } }),
    other = ev('/community/', 'overdub.ajsmithhq.com');
  assert.ok(
    g.uri === '/site/community/index.html' &&
      ev('/site/community/').uri === '/site/community/index.html' &&
      ev('/').uri === '/site/index.html' &&
      ev('/app/').uri === '/app/index.html',
    `path-rewrite.js: /community/ maps to /site/community/index.html, and /site/community/, / and /app/ still map (${g.uri})`,
  );
  assert.ok(
    noDot.statusCode === 301 && noDot.headers.location.value === '/community/?kind=effect',
    `path-rewrite.js: /community is a 301 to /community/, the query kept (${noDot.statusCode} ${noDot.headers?.location?.value})`,
  );
  assert.ok(
    other.statusCode === 301 &&
      other.headers.location.value === 'https://overdubstudio.com/community/' &&
      ev('/app', 'www.overdubstudio.com').headers.location.value === 'https://overdubstudio.com/app',
    `path-rewrite.js: another host still redirects to the same path on overdubstudio.com (${other.headers?.location?.value})`,
  );
  assert.ok(
    /^var HOME = 'overdubstudio\.com';$/m.test(fs.readFileSync(path.join(ROOT, 'deploy/path-rewrite.js'), 'utf8')),
    "path-rewrite.js still starts its home as var HOME = 'overdubstudio.com'; (deploy/next/setup.sh seds that line)",
  );
  // CLOUDFRONT_NAME: false in git (a cloudfront.net name redirects home); infra/live publishes it true before the
  // cutover, and then the distribution's cloudfront.net name is served as itself
  const src = fs.readFileSync(path.join(ROOT, 'deploy/path-rewrite.js'), 'utf8'),
    CF = 'd111111abcdef8.cloudfront.net';
  const pre = {};
  vm.runInNewContext(src.replace(/^var CLOUDFRONT_NAME = false;$/m, 'var CLOUDFRONT_NAME = true;'), pre);
  const evPre = (uri, host) => pre.handler({ request: { uri, querystring: {}, headers: { host: { value: host } } } });
  assert.ok(
    /^var CLOUDFRONT_NAME = false;$/m.test(src) &&
      ev('/app/', CF).statusCode === 301 &&
      evPre('/app/', CF).uri === '/app/index.html' &&
      evPre('/app/', 'www.overdubstudio.com').statusCode === 301 &&
      evPre('/app/', 'overdub.example').statusCode === 301,
    'path-rewrite.js: var CLOUDFRONT_NAME = false; in git, so a cloudfront.net name redirects home; true (infra/live, before the cutover) serves it, and other hosts still redirect',
  );
});

test('claims: what the public copy says is still true of the product', async (tctx) => {
  const at = (f) => (fs.existsSync(path.join(ROOT, f)) ? path.join(ROOT, f) : path.join(PRIV, f));
  const read = (f) => fs.readFileSync(at(f), 'utf8');
  const md = (dir) =>
    fs
      .readdirSync(at(dir))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `${dir}/${f}`);
  const PRIVATE = HAS_PRIV ? ['deck/index.html', 'docs/STRATEGY.md', ...md('docs/launch')] : [];

  // Everything that speaks for Overdub.
  const COPY = [
    'site/index.html',
    'site/press/index.html',
    'site/llms.txt',
    ...DOCS.map((d) => `site/docs/${d.slug}.html`),
    'site/docs/index.html',
    'README.md',
    'app/index.html',
    'integrations/README.md',
    // (dated records keep the numbers that were true when they were written: the fresh-eyes reports)
    ...md('docs').filter((f) => !/FRESH-EYES/.test(f)),
    ...PRIVATE.filter((f) => f !== 'docs/STRATEGY.md'),
  ];
  const text = Object.fromEntries(COPY.map((f) => [f, read(f)]));
  const plain = (s) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/g, ' ');
  const hits = (re, files = COPY) =>
    files.flatMap((f) =>
      [...text[f].matchAll(re)].map((m) => `${f}: "${m[0].replace(/\s+/g, ' ').trim().slice(0, 90)}"`),
    );
  const say = (list) => (list.length ? ':\n       ' + list.join('\n       ') : '');

  // Browsers: Safari, Firefox and phones pass tools/compat-test.js, so nothing says Chrome only.
  const chrome = hits(
    /Chrome (only|is the target)|runs in Chrome(?![,\s]+(Safari|Edge))|\bUse Chrome\b|in Chrome(, for now| for now|,? nothing to install)|Chrome on a (desktop|laptop|computer)|\(and Chrome, for now\)|studio in Chrome|Yes to both, in Chrome|Free, in Chrome/g,
  );
  assert.ok(
    !chrome.length,
    `no copy says Overdub is Chrome-only (compat-test covers WebKit, Firefox and a phone)${say(chrome)}`,
  );
  // ... nor do the notes that steer the work (CLAUDE.md), nor the studio's own errors (Firefox has Web MIDI; a missing
  // getUserMedia is usually a page served over plain http, not the browser)
  const appSrc = fs
    .readdirSync(path.join(ROOT, 'app/src'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`app/src/${f}`, read(path.join('app/src', f))]);
  const steer = [['CLAUDE.md', read('CLAUDE.md')], ...appSrc].flatMap(([f, s]) =>
    [...s.matchAll(/Chrome (only|is the target)|\bTry Chrome\b|use Chrome or Edge(?!,? or Firefox)/g)].map(
      (m) => `${f}: "${m[0]}"`,
    ),
  );
  assert.ok(!steer.length, `CLAUDE.md and the studio's messages don't steer to Chrome alone${say(steer)}`);

  // Kernels: the worklet scope is a rule for determinism, not a security boundary, and share links carry strangers'
  // kernels. "Sandbox" may only appear about the future (WASM, iframes) or to say it is not one.
  const sandbox = COPY.flatMap((f) => {
    const s = plain(text[f]);
    return [...s.matchAll(/sandbox(ed|ing)?/gi)]
      .map((m) => {
        const a = Math.max(s.lastIndexOf('.', m.index), s.lastIndexOf('\n\n', m.index)) + 1;
        const b = s.indexOf('.', m.index + 1);
        return {
          f,
          sentence: s
            .slice(a, b < 0 ? undefined : b)
            .replace(/\s+/g, ' ')
            .trim(),
        };
      })
      .filter((x) => !/WASM|iframe|not a (security )?(sandbox|boundary)/i.test(x.sentence))
      .map((x) => `${x.f}: "${x.sentence.slice(0, 110)}"`);
  });
  const security = hits(/gives security|security and determinism/gi);
  assert.ok(
    !sandbox.length && !security.length,
    `no copy calls kernels sandboxed or secure (only WASM, later, would be)${say([...sandbox, ...security])}`,
  );

  // MCP: a visitor's tab on the live site can't be driven over MCP (the bridge is localhost-only and the relay is off),
  // so wherever the landing page mentions MCP, the same paragraph says it needs a local copy.
  const landing = text['site/index.html'];
  const mcpParas = [...landing.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => plain(m[2]))
    .filter((p) => /\bMCP\b/.test(p));
  const uncaveated = mcpParas.filter((p) => !/own computer|locally|local copy|isn(’|')t public/.test(p));
  assert.ok(
    mcpParas.length > 0 && !uncaveated.length,
    `the landing page's MCP copy says it needs a local copy (${mcpParas.length} paragraph(s))${say(uncaveated.map((p) => `"${p.replace(/\s+/g, ' ').trim().slice(0, 100)}"`))}`,
  );

  // Retired claims, each wrong for a reason the product or the source makes plain.
  const RETIRED = [
    [/learns what it means to you/gi, 'no personal lexicon yet: the agent asks which one you mean'],
    [/Drum on the desk or the space bar/gi, 'Space plays and stops; tapping is F J K L, the pads or the mic'],
    [
      /stay out of the red|never go silent|as loud as what went in|is it (about )?as loud as its input/gi,
      'the device check refuses compile errors, NaN, runaways and stuck notes; loudness and silence are warnings',
    ],
    [/refiled 18 Sept/gi, 'UMG and Sony filed a second suit; nothing was refiled'],
    [
      /absolutely terrible[”"]? for creative work|for three reasons: the agent can(’|')t hear/gi,
      'the write-up never said it; a commenter did, about mixing commands',
    ],
    [/most-discussed write-up/gi, 'a Show HN for an Ableton MCP had more points: say widely read'],
    [
      /Practitioners report the same three problems/gi,
      'the three problems are our landscape review, not a practitioner report',
    ],
    [/edit accuracy (lost|fell|falls)|lose 39 to 52%/gi, 'RIME measured edit similarity, for two small models'],
    [/object model has no render/gi, 'the Extensions SDK beta can bounce a track to WAV'],
    [/the README already says MIT/gi, 'the licence is undecided'],
    [/not there yet: Safari|sharing songs or devices by link/gi, 'Safari, Firefox and share links shipped'],
    [/The mark \(spiral\)/g, 'the mark is the Weave'],
    [
      /\b515\b[^.\n|]{0,30}tools|openDAW(’|')s 515/gi,
      'opendaw-mcp lists 543 tools in full mode (and has a 39-tool lite mode): say 500+',
    ],
    [/the song it ships with|(3|three) in the demo song/gi, 'four demo songs ship: Night Shift is the first'],
    [/rings past 4 s|true peak −10\.8/gi, "Tidal Cathedral's device check: no warnings, true peak −6 dBTP"],
    [/Claude played a part over it/gi, 'the demo songs are staged: a build script wrote and signed every part'],
    [/no server (ever )?sees it/gi, "only Overdub's servers never see a link; whatever carries it does"],
  ];

  // Share links carry kernels, which are code: wherever a newcomer reads about sharing (the landing page's share note,
  // the guide's Share and fork), the same passage says so.
  {
    const shareNote = plain((landing.match(/<p class="rn-tag">Share<\/p>([\s\S]*?)<\/li>/) || ['', ''])[1]);
    const guideShare = (read('docs/GUIDE.md').match(/## Share and fork([\s\S]*?)\n## /) || ['', ''])[1];
    const bad = [
      ['site/index.html share note', shareNote],
      ['docs/GUIDE.md Share and fork', guideShare],
    ]
      .filter(([, x]) => !/\bcode\b/.test(x) || !/trust/.test(x) || !/Overdub(’|')s servers/.test(x))
      .map(([f]) => f);
    assert.ok(
      !bad.length,
      `the share copy says links carry code, to open them from people you trust, and that only Overdub's servers never see them${bad.length ? ' (not in: ' + bad.join(', ') + ')' : ''}`,
    );
  }
  for (const [re, why] of RETIRED) {
    const h = hits(re);
    assert.ok(!h.length, `retired claim gone (${why})${say(h)}`);
  }
  // The in-browser API key is gone (agent/claude.js): no public copy offers to keep one in the browser. (The private
  // launch drafts change with the release that ships this.)
  {
    const pub = COPY.filter((f) => !PRIVATE.includes(f));
    const byok = hits(
      /paste (an |your )?(Anthropic )?API key|bring[- ]your[- ]own[- ]key|\bBYOK\b|own (Claude|Anthropic) (API )?key|key (stays|is kept|kept) in (this|that|your) browser|keyless demo/gi,
      pub,
    );
    assert.ok(
      !byok.length,
      `no public copy offers an API key kept in the browser (the studio keeps none; a self-hoster's stays on their server)${say(byok)}`,
    );
  }

  // The tap lane names the keys input/tap.js actually listens to.
  const { ROWS } = await import('../../app/src/input/tap.js');
  const lane = (landing.match(/<h3>Tap it<\/h3><p>([^<]*)<\/p>/) || [])[1] || '';
  const keys = ROWS.map((r) => r.hint);
  assert.ok(
    keys.every((k) => new RegExp(`\\b${k}\\b`).test(lane)) && !/space bar/i.test(lane),
    `the Tap lane names the tap keys (${keys.join(' ')}): "${lane}"`,
  );

  // Built-in device counts: every number stated for the built-ins ("32 built-in instruments and effects", "32
  // built-ins", the press kit's counts, "19 instruments and 13 effects") is the shelf's. The launch drafts are noted.
  {
    const B = await import('../../app/src/devices/builtin/index.js');
    const want = { all: B.BUILTINS.length, inst: B.INSTRUMENTS.length + B.SAMPLED.length, fx: B.EFFECTS.length };
    const said = (f) => {
      const x = text[f],
        out = [];
      for (const m of x.matchAll(/\b(\d+)(?:\s|&nbsp;)+built-in(?:s\b|\s+(?:instruments and effects|devices))/g))
        out.push([+m[1], want.all, m[0]]);
      for (const m of x.matchAll(/<dt>Built-in (?:devices|instruments and effects)<\/dt><dd>(\d+)/g))
        out.push([+m[1], want.all, m[0]]);
      for (const m of x.matchAll(/\b(\d+) instruments and (\d+) effects/g))
        out.push([+m[1] + '+' + m[2], want.inst + '+' + want.fx, m[0]]);
      return out.filter(([n, w]) => n !== w).map(([, , m]) => `${f}: "${m.replace(/\s+/g, ' ')}"`);
    };
    const pub = COPY.filter((f) => !PRIVATE.includes(f)),
      priv = COPY.filter((f) => PRIVATE.includes(f));
    const n = pub.reduce((k, f) => k + [...text[f].matchAll(/built-in/gi)].length, 0);
    const bad = pub.flatMap(said);
    assert.ok(
      n >= 5 && !bad.length,
      `every stated count of built-in devices is the shelf's ${want.all} (${want.inst} instruments, ${want.fx} effects)${say(bad)}`,
    );
    const stale = priv.flatMap(said);
    if (stale.length)
      tctx.diagnostic(
        `launch drafts with another built-in count (overdub-private):\n       ${stale.join('\n       ')}`,
      );
  }

  // The bench slide's device check is Tidal Cathedral's real report: the one the device library shows (reports.js,
  // kernel/check.js in full mode), not a separate render. A warning on the slide only if the check gave one.
  if (HAS_PRIV) {
    const { REPORTS } = await import('../../app/src/devices/library/reports.js');
    const rep = REPORTS['claude.tidal-cathedral'];
    const dl = (text['deck/index.html'].match(/<dl class="check">([\s\S]*?)<\/dl>/) || [])[1] || '';
    const dd = Object.fromEntries(
      [...dl.matchAll(/<dt>([^<]+)<\/dt><dd class="(\w+)">([^<]+)<\/dd>/g)].map((m) => [
        m[1],
        { cls: m[2], v: m[3].replace(/−/g, '-') },
      ]),
    );
    const num = (k, i = 0) => +(dd[k]?.v.match(/-?\d+(?:\.\d+)?/g) || [])[i];
    const wet = num('Level vs dry'),
      dry = num('Level vs dry', 1),
      tp = num('True peak'),
      tail = num('Tail');
    const warns = Object.values(dd).filter((x) => x.cls === 'warn').length;
    const near = (x, y) => Math.abs(x - y) < 0.051;
    assert.ok(
      rep &&
        near(wet, rep.lufs) &&
        near(dry, rep.lufs - rep.deltaLU) &&
        near(tp, rep.truePeak) &&
        near(tail, rep.tail) &&
        warns === rep.warnings,
      `the deck's Tidal Cathedral check is the library's report (deck ${wet}/${dry} LUFS, ${tp} dBTP, tail ${tail} s, ${warns} warning(s); report ${rep?.lufs}/${rep && +(rep.lufs - rep.deltaLU).toFixed(1)}, ${rep?.truePeak}, ${rep?.tail} s, ${rep?.warnings})`,
    );
  }
});

test('the guide: what it tells a newcomer to press is really there', async () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const guide = read('docs/GUIDE.md');
  const src = fs
    .readdirSync(path.join(ROOT, 'app/src'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => read(path.join('app/src', f)))
    .join('\n');
  assert.ok(
    DOCS[0].slug === 'guide' && DOCS[0].src === 'docs/GUIDE.md',
    `the Guide is the first doc in the hub (${DOCS[0].slug})`,
  );
  const deploy = read('deploy/deploy.sh');
  const unshipped = DOCS.filter(
    (d) => d.raw && !new RegExp(`for f in [^;]*\\b${path.basename(d.src, '.md')}\\b`).test(deploy),
  );
  assert.ok(
    !unshipped.length,
    `the deploy ships every doc's Markdown that the docs link to${unshipped.length ? ' (missing ' + unshipped.map((d) => d.src).join(', ') + ')' : ''}`,
  );
  // labels the guide names, as the studio spells them
  const LABELS = [
    'Try the demo agent (free)',
    'Hold to hear',
    'Keep as a clip',
    'Make it yours',
    'Share a link',
    'Export device',
    'Import a device…',
    'Provenance report',
    'Attribution log',
    'DAWproject',
    'Stems',
    'Save the project file',
    'Takes',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the label as the source spells it, template and all
    "Revert all ${store.author(by).name}'s changes (keep mine)",
    'Import MIDI…',
    'Import audio…',
    'Measure the mix',
    'Your words',
  ];
  const missing = LABELS.filter(
    (l) => !src.includes(`'${l}'`) && !src.includes(`\`${l}\``) && !src.includes(`"${l}"`),
  ).concat(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the label as the source spells it, template and all
    LABELS.filter((l) => !guide.includes(l.replace('${store.author(by).name}', 'Claude'))).map(
      (l) => 'not in the guide: ' + l,
    ),
  );
  assert.ok(
    !missing.length,
    `the ${LABELS.length} buttons and menus the guide names exist, spelled the same${missing.length ? ': ' + missing.join('; ') : ''}`,
  );
  // the models it lists are the Agent tab's
  const models = [...read('app/src/agent/claude.js').matchAll(/name: '((?:Opus|Sonnet|Haiku) [\d.]+)'/g)].map(
    (m) => m[1],
  );
  assert.ok(
    models.length >= 2 && models.every((m) => guide.includes(m)),
    `the guide names the Agent tab's models (${models.join(', ')})`,
  );
  // the keys table: each key is one the studio declares
  // (M, S and K are the layout of Logic and GarageBand: M mutes and S solos the selected track, K is the click; ⌘E,
  // Live's key, splits; ⇧M is bound to nothing now)
  const KEYS = {
    '`Space`': "key: 'Space'",
    '`R`': "key: 'KeyR'",
    '`L`': "key: 'KeyL'",
    '`M`': "key: 'KeyM', run",
    '`S`': "key: 'KeyS', run",
    '`K`': "key: 'KeyK', run",
    '`H`': "key: 'KeyH'",
    '`T`': "key: 'KeyT'",
    '`` ` ``': "key: 'Backquote'",
    '`/`': "key: 'Slash'",
    '`⌘/`': "key: 'Slash', mod: 'mod'",
    '`A`': "key: 'KeyA'",
    '`B`': "key: 'KeyB'",
    '`D`': "key: 'KeyD'",
    '`⌘Z`': "key: 'KeyZ', mod: 'mod'",
    '`⇧⌘Z`': "key: 'KeyZ', mod: 'mod+shift'",
    '`⇧B`': "key: 'KeyB', mod: 'shift'",
    '`Esc`': "key: 'Escape'",
    '`?`': "key: 'Slash', mod: 'shift'",
    '`⇧Esc`': "key: 'Escape', mod: 'shift'",
    '`0`': "key: 'Digit0'",
    '`E`': "key: 'KeyE', when",
    '`⇧Space`': "key: 'Space', mod: 'shift'",
    '`Home`': "key: 'Home'",
    '`⇧K`': "key: 'KeyK', mod: 'shift'",
    '`⌘E`': "key: 'KeyE', mod: 'mod', when",
    '`⇧R`': "key: 'KeyR', mod: 'shift'",
    '`⌘↑`': "key: 'ArrowUp', mod: 'mod'",
    '`⌘↓`': "key: 'ArrowDown', mod: 'mod'",
  };
  const table = (guide.match(/## Keys[\s\S]*$/) || [''])[0];
  const rows = [...table.matchAll(/^\| (`[^|]+?) \|/gm)].flatMap((m) => m[1].split(' · ').map((k) => k.trim()));
  const unknown = rows.filter((k) => !KEYS[k] || !src.includes(KEYS[k]));
  assert.ok(
    rows.length >= 12 && !unknown.length,
    `the guide's ${rows.length} keys are all declared in the studio${unknown.length ? ' (not found: ' + unknown.join(' ') + ')' : ''}`,
  );
  // the keys that moved: the table has M, S, K, ⇧K and ⌘E, and nothing in the guide or the landing page still names ⇧M
  // or the old split and click keys
  const moved = ['`M`', '`S`', '`K`', '`⇧K`', '`⌘E`'].filter((k) => !rows.includes(k));
  const stale = [
    ['docs/GUIDE.md', guide],
    ['site/index.html', read('site/index.html')],
    ['README.md', read('README.md')],
  ].flatMap(([f, x]) =>
    [...x.matchAll(/⇧M|Shift\+M\b|`M` turns the click|`S` splits|\bM metronome|\(`S`\)/g)].map(
      (m) => `${f}: "${m[0]}"`,
    ),
  );
  assert.ok(
    !moved.length && !stale.length,
    `the guide's key table has M, S, K, ⇧K and ⌘E, and no page names the old click, count-in or split keys${moved.length || stale.length ? ' (' + [...moved.map((k) => 'missing ' + k), ...stale].join('; ') + ')' : ''}`,
  );
  // its numbers are the library's
  const [{ BUILTINS }, { SHOWCASE }, { LIBRARY_DEFS }] = await Promise.all([
    import('../../app/src/devices/builtin/index.js'),
    import('../../app/src/devices/showcase.js'),
    import('../../app/src/devices/library/index.js'),
  ]);
  const all = [...BUILTINS, ...SHOWCASE, ...LIBRARY_DEFS],
    byAgent = all.filter((d) => d.by === 'claude').length;
  const m = guide.match(/has (\d+) devices: the (\d+) built-in instruments and effects, and (\d+) Claude\s+wrote/);
  assert.ok(
    m && +m[1] === all.length && +m[2] === BUILTINS.length && +m[3] === byAgent,
    `the guide's device counts are the library's (${m ? m.slice(1).join('/') : 'not found'}; real ${all.length}/${BUILTINS.length}/${byAgent})`,
  );
  // the landing page's Library card says the same, and that the Guitar Studio's pedals and amps aren't on that shelf
  const card = (read('site/index.html').match(/<p class="rn-tag">Library<\/p>([\s\S]*?)<\/li>/) || ['', ''])[1].replace(
    /<[^>]+>/g,
    '',
  );
  const lm = card.match(/The (\d+) built-in instruments and effects, and (\d+) an agent wrote/);
  assert.ok(
    lm && +lm[1] === BUILTINS.length && +lm[2] === byAgent && /pedals and amps/.test(card),
    `the landing page's Library card splits the shelf into built-ins and agent-written, and says where the pedals and amps are (${lm ? lm[1] + '/' + lm[2] : 'not found'})`,
  );
  // the guide covers bringing material in, not just taking it out
  assert.ok(
    /## Bring material in[\s\S]*Import MIDI…[\s\S]*Reference/.test(guide),
    'the guide has a Bring material in section (MIDI, audio, the Reference tab)',
  );
});
