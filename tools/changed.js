// Which suites a change can affect, for node tools/run-all.js --changed [BASE] (what the suites workflow runs on a
// push to a branch). The studio loads almost all of itself on every page, so a change to it, the server, the docs or
// anything the harness stands on runs every suite (measured: an app/src file is used by 80 of 91 suites at the median;
// overdub-intents 0017's plan.md). What can be narrowed is the suites' own code:
//   - a suite runs itself; a deleted one runs nothing;
//   - any other file under tools/ runs every suite whose code names it (by its file name, in an import, a spawn or a
//     path; a comment doesn't count) or whose text names it by a glob like checks-*.js, through the helpers between; a file no suite names runs everything, as it may be reached in a way this can't
//     see (a computed path);
//   - the unit tests, workflows other than suites.yml, and prose outside the pages the suites read (README.md, docs/,
//     site/, design/, integrations/) run the unit suite alone: it reads the workflows and the docs;
//   - everything else runs everything.
// The unit suite runs on any change: it takes seconds. When this can't decide, the answer is more suites, never fewer.
//
//   pick({ files, suites, tools })  -> { all, why, suites: Map(suite -> why) }
//     files: the changed paths (repo-relative); suites: the tools/*-test.js names; tools: Map(path -> text) of the
//     files under tools/
//   changedFiles(base, cwd)  -> the paths changed since the merge base with `base`, the working tree's and untracked
//     files included (throws when git can't say)
//   toolsTexts(cwd)  -> the Map pick reads
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// what every suite stands on
const HARNESS = [
  /^tools\/(run-all|pw|suite-status|changed|fetch-kits)\.js$/,
  /^tools\/golden\.json$/,
  /^tools\/kits\//,
  /^\.github\/workflows\/suites\.yml$/,
];
// the pages and data the suites read as files (pages-test, the docs build, community-test's CDN config)
const READ_AS_PAGES = /^(docs|site|design|integrations)\//;
const UNIT_ONLY = (f) =>
  /^test\/unit\//.test(f) || /^\.github\//.test(f) || (/\.md$/.test(f) && f !== 'README.md' && !READ_AS_PAGES.test(f));
const SUITE = /^tools\/[^/]+-test\.js$/;

// A file names another by its file name, or by a glob its name matches (`checks-*.js`: a runner that lists its folder
// says what it picks up). A glob needs a literal part and an extension, so a lone `*` names nothing.
const GLOB = /[\w.-]*\*[\w.-]*\.[a-z]+\b/g;
const globs = new Map();
function globsOf(text) {
  if (!globs.has(text))
    globs.set(text, [...new Set(text.match(GLOB) || [])].filter((g) => g.replace(/\*/g, '').length >= 4).map((g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')));
  return globs.get(text);
}
// A file's name in a comment doesn't load it ("tools/liveroom/checks-model.js has the rest"), so names are read from
// the code with its comments taken out. Globs are read from the comments too: that is where a runner that lists its
// folder says what it picks up, and reading more only ever picks more.
const codes = new Map();
function codeOf(text) {
  if (!codes.has(text)) codes.set(text, text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1'));
  return codes.get(text);
}
const names = (text, name) => codeOf(text).includes(name) || globsOf(text).some((re) => re.test(name));

// every suite that names `file`, directly or through files under tools/ that name it
function namedBy(file, suites, tools) {
  const found = new Set(), seen = new Set([file]), queue = [file];
  while (queue.length) {
    const name = path.posix.basename(queue.shift());
    for (const [p, text] of tools) {
      if (seen.has(p) || !names(text, name)) continue;
      seen.add(p);
      // a suite is where the search ends: what names a suite (the harness, by *-test.js) doesn't run what it reaches
      if (SUITE.test(p)) {
        if (suites.includes(path.posix.basename(p))) found.add(path.posix.basename(p));
        continue;
      }
      queue.push(p);
    }
  }
  return found;
}

export function pick({ files, suites, tools }) {
  const picked = new Map();
  const add = (s, why) => { if (!picked.has(s)) picked.set(s, why); };
  const everything = (why) => ({ all: true, why, suites: new Map(suites.map((s) => [s, why])) });
  for (const f of files) {
    if (HARNESS.some((re) => re.test(f))) return everything(`${f} is the harness`);
    if (UNIT_ONLY(f)) continue;
    if (SUITE.test(f)) {
      if (suites.includes(path.posix.basename(f))) add(path.posix.basename(f), `${f} changed`);
      continue;
    }
    if (f.startsWith('tools/')) {
      const by = namedBy(f, suites, tools);
      if (!by.size) return everything(`no suite names ${f}`);
      for (const s of by) add(s, `names ${f}`);
      continue;
    }
    return everything(`${f} is outside the suites' own code`);
  }
  if (files.length && suites.includes('unit-test.js')) add('unit-test.js', 'runs on any change');
  return { all: false, why: '', suites: picked };
}

const TEXT = /\.(js|mjs|cjs|json|html|sh|txt|css)$/;
export function toolsTexts(cwd) {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', 'tools'], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = new Map();
  for (const p of r.stdout.split('\n').filter(Boolean)) {
    const abs = path.join(cwd, p);
    try {
      out.set(p, TEXT.test(p) && fs.statSync(abs).size < 4 << 20 ? fs.readFileSync(abs, 'utf8') : '');
    } catch { /* gone from the tree */ }
  }
  return out;
}

export function changedFiles(base, cwd) {
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim() || 'failed'}`);
    return r.stdout.split('\n').filter(Boolean);
  };
  return [...new Set([...git('diff', '--name-only', `${base}...HEAD`), ...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])].sort();
}
