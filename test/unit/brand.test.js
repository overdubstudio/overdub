// Brand checks that need no browser (the browser half is tools/brand-test.js). Counted claims and design contracts
// read straight from the source:
//   tokens: every contract name present; text colours clear WCAG AA on every surface
//   the rule (Liner notes): CLAUDE.md and BRAND.md say authorship is a byline; the new tokens are there (rules, the
//           press radius, the paper inks at AA on cream), corners are 2 px or square, nothing sitting in the page casts
//           a shadow, slate can't read as the agent's cool; app.css draws no stripe and no pill; dom.js has byline()
//           and no sparkle
//   assets: the marks are the Weave (app/assets and site/assets match; tools/brand-marks.js regenerates them exactly),
//           og.png is 1200x630
//   copy: the old theme (worm, "stuck in your head", the spiral as the logo) is gone from the page
//   session notes: its counts (devices, agent-built ones, transforms, bench tasks) and demo cards match the source
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const T = { ok: (cond, msg) => (assert.ok(cond, msg), !!cond) };

const CONTRACT = [
  '--bg',
  '--bg-2',
  '--bg-3',
  '--panel',
  '--line',
  '--line-2',
  '--text',
  '--text-2',
  '--text-3',
  '--accent',
  '--accent-2',
  '--human',
  '--agent',
  '--ok',
  '--warn',
  '--bad',
  '--rec',
  '--font-ui',
  '--font-display',
  '--font-mono',
  '--r-1',
  '--r-2',
  '--r-3',
  '--shadow-1',
  '--shadow-2',
  '--c-1',
  '--c-2',
  '--c-3',
  '--c-4',
  '--c-5',
  '--c-6',
  '--c-7',
  '--c-8',
];
const tokensSrc = fs.readFileSync(path.join(ROOT, 'app/style/tokens.css'), 'utf8');
const tok = {};
for (const m of tokensSrc.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tok[m[1]] = m[2].trim();
test('tokens.css has every contract name', () => {
  const missing = CONTRACT.filter((n) => !(n in tok));
  T.ok(
    !missing.length,
    `tokens.css has every contract name${missing.length ? ' (missing ' + missing.join(' ') + ')' : ''}`,
  );
});
const lum = (h) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const surfaces = ['--bg', '--bg-2', '--bg-3', '--panel'];
test('tokens: contrast and faces', async () => {
  for (const t of ['--text', '--text-2', '--text-3', '--human', '--agent', '--accent', '--ok', '--warn', '--bad']) {
    const worst = Math.min(...surfaces.map((s) => ratio(tok[t], tok[s])));
    T.ok(worst >= 4.5, `${t} ${tok[t]} is AA on every surface (worst ${worst.toFixed(2)}:1)`);
  }
  const trackWorst = Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ratio(tok['--c-' + i], tok['--bg'])));
  T.ok(trackWorst >= 6, `track colours read as text on --bg (worst ${trackWorst.toFixed(2)}:1)`);
  T.ok(
    ratio(tok['--bg'], tok['--accent']) >= 4.5,
    `--bg text on an --accent button is AA (${ratio(tok['--bg'], tok['--accent']).toFixed(2)}:1)`,
  );

  // the tape box (site.css): ink on leader-tape cream
  const siteCss = fs.readFileSync(path.join(ROOT, 'site/assets/site.css'), 'utf8');
  const stok = {};
  for (const m of siteCss.matchAll(/(--(?:paper|ink|ink-2))\s*:\s*(#[0-9a-f]{6})/g)) stok[m[1]] = m[2];
  for (const t of ['--ink', '--ink-2'])
    T.ok(
      stok[t] && ratio(stok[t], stok['--paper']) >= 4.5,
      `tape box: ${t} ${stok[t]} on --paper ${stok['--paper']} is AA (${stok[t] ? ratio(stok[t], stok['--paper']).toFixed(2) : '?'}:1)`,
    );
  T.ok(
    ratio(stok['--ink'], tok['--accent']) >= 4.5,
    `tape box: ink on a leader-green button is AA (${ratio(stok['--ink'], tok['--accent']).toFixed(2)}:1)`,
  );
  // Echo Chamber's face (intent 0006 R25): its printed ink on its hammered cream is AA
  {
    const { default: rooms } = await import('../../app/src/devices/builtin/rooms.js');
    const L = rooms.look || {},
      r = L.ink && L.color ? ratio(L.ink, L.color) : 0;
    T.ok(r >= 4.5, `Echo Chamber's face: ink ${L.ink} on ${L.color} is AA (${r.toFixed(2)}:1)`);
  }
  {
    // the faces come from the site: tokens.css imports fonts.css, which declares Archivo over its width axis to 125
    let fontsSrc = '';
    try {
      fontsSrc = fs.readFileSync(path.join(ROOT, 'app/style/fonts.css'), 'utf8');
    } catch {
      /* none: the check fails */
    }
    T.ok(
      /@import url\('fonts\.css'\)/.test(tokensSrc) &&
        /font-family: 'Archivo';[^}]*font-stretch: 62% 125%/.test(fontsSrc) &&
        /font-family: 'Atkinson Hyperlegible Next'/.test(fontsSrc) &&
        /font-family: 'Atkinson Hyperlegible Mono'/.test(fontsSrc),
      'tokens.css loads Archivo (with the wdth axis to 125), Atkinson Hyperlegible Next and Mono, from the site (fonts.css)',
    );
  }
  T.ok(
    /'wdth'\s*125/.test(tok['--font-display-vars'] || ''),
    `--font-display-vars sets Archivo's width (${tok['--font-display-vars']})`,
  );
});

// ---- the rule: authorship is a byline (design/DECISION.md, design/LINER-NOTES-KIT.md)
test('the rule: authorship is a byline', () => {
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const brand = fs.readFileSync(path.join(ROOT, 'docs/BRAND.md'), 'utf8');
  const sect = (md, head) => md.split(/\n## /).find((x) => x.startsWith(head)) || '';
  T.ok(
    /Authorship is a \*\*byline\*\*/.test(claude) &&
      /no container is striped, tinted or filled by who made it/.test(claude) &&
      /the house is unsigned/.test(claude) &&
      !/edge or a badge/.test(claude),
    'CLAUDE.md: authorship is a byline; no container striped, tinted or filled; the house unsigned',
  );
  const colour = sect(brand, 'Colour'),
    studio = sect(brand, 'In the studio'),
    illus = sect(brand, 'Illustration');
  T.ok(
    /byline/.test(colour) && !/edge or a badge|corner tab/.test(colour),
    'BRAND.md, Colour: authorship is a byline (no edge, badge or corner tab)',
  );
  T.ok(
    /track sheet\s+of signed lines/.test(studio) && !/column of warm and cool\s+edges/.test(studio),
    'BRAND.md, In the studio: History is a track sheet of signed lines',
  );
  T.ok(
    /tape box/.test(illus) && !/above each section \(`01/.test(illus),
    'BRAND.md, Illustration: the numbered slate only on the tape box',
  );
  T.ok(
    fs.existsSync(path.join(ROOT, 'design/LINER-NOTES-KIT.md')),
    'design/LINER-NOTES-KIT.md is there for the surfaces',
  );

  const NEW = [
    '--rule',
    '--rule-2',
    '--rule-heavy',
    '--r-press',
    '--paper',
    '--ink',
    '--ink-2',
    '--ink-human',
    '--ink-agent',
  ];
  const gone = NEW.filter((n) => !(n in tok));
  T.ok(
    !gone.length,
    `tokens.css has the Liner notes names${gone.length ? ' (missing ' + gone.join(' ') + ')' : ` (${NEW.join(' ')})`}`,
  );
  const px = (v) => (/^0(px)?$/.test(v) ? 0 : parseFloat(v));
  T.ok(
    ['--r-1', '--r-2', '--r-press'].every((n) => px(tok[n]) <= 2) && px(tok['--r-3']) === 0,
    `one radius, 2 px, for things you press; panels square (r-1 ${tok['--r-1']}, r-2 ${tok['--r-2']}, r-3 ${tok['--r-3']}, press ${tok['--r-press']})`,
  );
  T.ok(
    tok['--shadow-1'] === 'none' && /\d/.test(tok['--shadow-2']),
    `nothing in the page casts a shadow (--shadow-1 ${tok['--shadow-1']}); floating things keep --shadow-2`,
  );
  T.ok(
    /2px solid var\(--text\)/.test(tok['--rule-heavy']) && /1px solid var\(--line\)/.test(tok['--rule']),
    `the rules: hairline ${tok['--rule']}, heavy ${tok['--rule-heavy']}`,
  );
  for (const t of ['--ink', '--ink-2', '--ink-3', '--ink-human', '--ink-agent']) {
    const r = ratio(tok[t], tok['--paper']);
    T.ok(r >= 4.5, `paper: ${t} ${tok[t]} on --paper ${tok['--paper']} is AA (${r.toFixed(2)}:1)`);
  }
  T.ok(
    ratio('#f07612', tok['--paper']) < 4.5 && ratio('#1b95dc', tok['--paper']) < 4.5,
    `the riso pair stays off paper text (warm ${ratio('#f07612', tok['--paper']).toFixed(1)}:1, cool ${ratio('#1b95dc', tok['--paper']).toFixed(1)}:1): bylines on paper use --ink-human / --ink-agent`,
  );
  // no track colour may read as the agent: within 30 degrees of its hue AND saturated (slate was #8fa8d4, 18 degrees off at 45%)
  const hsl = (hx) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      d = mx - mn;
    let hh = 0;
    if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
    const l = (mx + mn) / 2;
    return { h: hh, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0 };
  };
  const ag = hsl(tok['--agent']);
  const cool = [1, 2, 3, 4, 5, 6, 7, 8].filter((i) => {
    const c = hsl(tok['--c-' + i]);
    const dh = Math.min(Math.abs(c.h - ag.h), 360 - Math.abs(c.h - ag.h));
    return dh < 30 && c.s > 0.3;
  });
  const s5 = hsl(tok['--c-5']);
  T.ok(
    !cool.length,
    `no track colour reads as the agent's cool (slate ${tok['--c-5']}: hue ${s5.h.toFixed(0)}°, ${(s5.s * 100).toFixed(0)}% vs agent ${ag.h.toFixed(0)}°${cool.length ? '; too close: ' + cool.map((i) => '--c-' + i).join(' ') : ''})`,
  );
  for (const f of ['app/src/ui/provenance.js', 'app/src/core/dawproject.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = /'c-5':\s*'(#[0-9a-f]{6})'/.exec(src);
    T.ok(m && m[1] === tok['--c-5'], `${f} prints slate as tokens.css does (${m && m[1]})`);
  }

  const appCss = fs.readFileSync(path.join(ROOT, 'app/style/app.css'), 'utf8');
  const stripes =
    appCss.match(
      /inset\s+-?\d+(\.\d+)?px\s+0\s+0[^;]*var\(--(human|agent|accent-2|text-3)\)|border-(left|right|inline-start)\s*:\s*\d+px\s+solid/g,
    ) || [];
  T.ok(!stripes.length, `app.css draws no side stripe${stripes.length ? ' (' + stripes.join('; ') + ')' : ''}`);
  const pills = appCss.match(/border-radius:\s*(99|999|9999)px|border-radius:\s*50%/g) || [];
  T.ok(!pills.length, `app.css has no pill radii (${pills.length})`);
  T.ok(
    !/\.by-(human|agent)\s*\{[^}]*box-shadow/.test(appCss) &&
      !/\.badge-(agent|human)\s*\{[^}]*(99px|background:\s*var\(--(agent|human)-wash)/.test(appCss),
    'the old .by-* stripe and .badge-* pill rules are gone (the names stay as bylines)',
  );
  for (const c of [
    '.btn',
    '.btn-go',
    '.btn-txt',
    '.tog',
    '.ledger',
    '.sheet-head',
    '.num',
    '.disp',
    '.disp-s',
    '.crop',
    '.paper',
    '.empty',
  ]) {
    T.ok(new RegExp('(^|[\\s,}])' + c.replace('.', '\\.') + '[\\s,{:.]').test(appCss), `app.css has the shared ${c}`);
  }
  const domSrc = fs.readFileSync(path.join(ROOT, 'app/src/ui/dom.js'), 'utf8');
  const path_ = (n) => (new RegExp(`\\n\\s*${n}: '([^']*)'`).exec(domSrc) || [])[1] || '';
  T.ok(
    /export function byline\(/.test(domSrc) && /export function authorOf\(/.test(domSrc),
    'dom.js exports byline() and authorOf()',
  );
  T.ok(
    !/<circle/.test(path_('agent')) &&
      /--agent/.test(path_('agent')) &&
      /--agent/.test(path_('sparkle')) &&
      !/z"/.test(path_('sparkle')),
    `icon('agent') and icon('sparkle') are a plain cool stroke (no face, no star): ${path_('agent')}`,
  );
});

// ---- assets: the Weave
test('assets: the marks in app and site are identical', () => {
  for (const f of ['logo.svg', 'wordmark.svg', 'wordmark-ink.svg', 'favicon.svg']) {
    const a = path.join(ROOT, 'app/assets', f),
      s = path.join(ROOT, 'site/assets', f);
    T.ok(
      fs.existsSync(a) && fs.existsSync(s) && fs.readFileSync(a).equals(fs.readFileSync(s)),
      `${f} in app/assets and site/assets, identical`,
    );
  }
});
test('assets: the Weave and its generator', () => {
  const logo = fs.readFileSync(path.join(ROOT, 'app/assets/logo.svg'), 'utf8');
  const strands = (logo.match(/<path d="M[^"]+" stroke="#[0-9a-f]{6}" mask=/g) || []).length;
  T.ok(
    strands === 2 && logo.includes('#f07612') && logo.includes('#1b95dc') && !/radialGradient|spiral/i.test(logo),
    `logo.svg is the Weave: two masked strands, warm and cool (${strands})`,
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overdub-marks-'));
  execFileSync(process.execPath, [path.join(ROOT, 'tools/brand-marks.js'), tmp]);
  const same = ['logo.svg', 'favicon.svg', 'wordmark.svg', 'wordmark-ink.svg'].filter((f) =>
    fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(ROOT, 'app/assets', f))),
  );
  T.ok(same.length === 4, `tools/brand-marks.js regenerates the installed marks exactly (${same.join(' ')})`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- copy: the old theme is gone (the Sketch tab's pitch spiral is real music theory and may be named once, in a screenshot's alt)
test('copy: the old theme is gone', () => {
  const html =
    fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'site/llms.txt'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'site/assets/og-card.html'), 'utf8');
  const bad = html.match(/\bworms?\b|earworm|stuck in your head|out of your head|fraunces|soil|burrow/gi) || [];
  T.ok(
    !bad.length,
    `no worm, soil or "stuck in your head" copy on the page${bad.length ? ' (' + [...new Set(bad)].join(', ') + ')' : ''}`,
  );
  const spirals = (html.match(/spiral/gi) || []).length;
  T.ok(spirals <= 1, `the spiral is no longer the brand (${spirals} mention, the Sketch screenshot)`);
});
// ---- session notes (section 08): every number and every demo link is the studio's, counted from the source
test('session notes: every number and demo link is the studios', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  const sec = (html.match(/<section class="reel"[\s\S]*?<\/section>/) || [''])[0];
  T.ok(
    /<h2[^>]*>(?:<[^>]+>)*Since the last session\.</.test(sec),
    'session notes: the section is there, under its head',
  );
  const [{ BUILTINS }, { SHOWCASE }, { LIBRARY_DEFS }, { DEMOS }, { TRANSFORMS }] = await Promise.all([
    import('../../app/src/devices/builtin/index.js'),
    import('../../app/src/devices/showcase.js'),
    import('../../app/src/devices/library/index.js'),
    import('../../app/src/core/demo.js'),
    import('../../app/src/core/transforms.js'),
  ]);
  const all = [...BUILTINS, ...SHOWCASE, ...LIBRARY_DEFS];
  const tasks = fs.readdirSync(path.join(ROOT, 'tools/bench/tasks')).filter((f) => f.endsWith('.json')).length;
  const real = {
    devices: all.length,
    'agent-devices': all.filter((d) => d.by === 'claude').length,
    transforms: TRANSFORMS.length,
    'bench-tasks': tasks,
  };
  const said = Object.fromEntries([...sec.matchAll(/data-count="([a-z-]+)">(\d+)</g)].map((m) => [m[1], +m[2]]));
  const wrong = Object.keys(real).filter((k) => said[k] !== real[k]);
  T.ok(
    !wrong.length,
    `session notes: the counts are real (${Object.entries(real)
      .map(([k, v]) => `${k} ${said[k]}/${v}`)
      .join(', ')})`,
  );
  const more = DEMOS.slice(1);
  const words = {
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
  };
  const n = words[((sec.match(/(\w+) more songs/i) || [])[1] || '').toLowerCase()];
  T.ok(
    n === more.length,
    `session notes: "${(sec.match(/\w+ more songs/i) || ['?'])[0]}" (${more.length} besides ${DEMOS[0].title})`,
  );
  const cards = [
    ...sec.matchAll(
      /href="\/app\/\?demo=([a-z-]+)"[^>]*><b>([^<]+)<\/b><span>([^<]+)<\/span><span>(\d+) bpm(?: ·|,) ([^<]+)<\/span>/g,
    ),
  ].map((m) => ({ id: m[1], title: m[2], genre: m[3], tempo: +m[4], key: m[5] }));
  const off = more.filter(
    (d) =>
      !cards.some(
        (c) => c.id === d.id && c.title === d.title && c.genre === d.genre && c.tempo === d.tempo && c.key === d.key,
      ),
  );
  T.ok(
    cards.length === more.length && !off.length,
    `session notes: a link per demo song, with its real title, genre, tempo and key${off.length ? ' (wrong: ' + off.map((d) => d.id).join(', ') + ')' : ` (${cards.map((c) => c.id).join(', ')})`}`,
  );
  // "vibes by Claude": the part named on each card is one Claude played in that song
  const bys = [
    ...sec.matchAll(/\?demo=([a-z-]+)"[\s\S]*?class="rn-by">([^<]+) by (?:<span class="by by-agent">)?Claude</g),
  ].map((m) => ({ id: m[1], part: m[2].replace(/^an? /, '') }));
  const unbacked = bys.filter((b) => {
    const d = more.find((x) => x.id === b.id);
    return !d || !new RegExp(`${b.part}[^,]* by Claude`, 'i').test(d.line);
  });
  T.ok(
    bys.length === more.length && !unbacked.length,
    `session notes: each card's Claude part is in the song's own line${unbacked.length ? ' (' + unbacked.map((b) => b.id).join(', ') + ')' : ''}`,
  );
});

test('og.png', () => {
  const og = path.join(ROOT, 'site/assets/og.png');
  if (T.ok(fs.existsSync(og), 'og.png exists')) {
    const b = fs.readFileSync(og);
    T.ok(
      b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630,
      `og.png is 1200x630 (${b.readUInt32BE(16)}x${b.readUInt32BE(20)}), ${(b.length / 1024).toFixed(0)} KB`,
    );
  }
});

test('site screenshots are real and small', () => {
  for (const f of [
    'liveroom.webp',
    'liveroom-960.webp',
    'studio.webp',
    'studio-960.webp',
    'rack.webp',
    'sketch.webp',
    'history.webp',
  ]) {
    const fp = path.join(ROOT, 'site/assets', f);
    T.ok(
      fs.existsSync(fp) && fs.statSync(fp).size <= 400 * 1024,
      `${f}: a real studio screenshot (node tools/shots.js), under 400 KB${fs.existsSync(fp) ? ' (' + (fs.statSync(fp).size / 1024).toFixed(0) + ' KB)' : ''}`,
    );
  }
});
