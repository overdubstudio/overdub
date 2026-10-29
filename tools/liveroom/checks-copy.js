// The live room's checks: copy and agents [stream G] (docs/research/LIVE-ROOM-MODE.md §11.9, the rules of §10).
// Run by tools/liveroom-test.js (ONLY=copy), whose header says what a checks module exports.
//
// In Node:
//   1. every line in app/src/core/liveroom/lines/*.js, rendered with sample vars and with another set (and not
//      throwing with none), keeps §10.1 and §10.2: no never-says word (as a word, in any case, plurals too), two sentences at most (the
//      tape box's note.*: three), no exclamation mark or emoji, a real minus (−) and a space before a unit, house
//      lines unsigned, and nothing broken in the template (undefined, NaN, [object, doubled spaces)
//   2. ids are unique across the files; every line id the room's code says exists (say(), line(), words(),
//      LINES[...], { id, vars }, const id = ...), and every line defined is said somewhere in it (a literal, or a
//      family a template names: `door.slate.${place}`)
//   3. agents: get_project's summary has the room's and the sheet's lines; the agent tools stay 40, the ten new ops
//      are in apply_ops's hint and examples, and acoustic is a target
// In muted Chromium (?room):
//   4. the in-app agent's say appears in the talkback with a Claude byline in cool ink; the house's lines unsigned
//
// A failure names the file, the id, the rule and the text, so the stream that owns the line can rewrite it (lines
// belong to their streams: this check never edits them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const name = 'copy';
export const pages = true;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LINES_DIR = path.join(ROOT, 'app/src/core/liveroom/lines');
const ROOM_CODE = ['app/src/ui/liveroom', 'app/src/core/liveroom'].map((d) => path.join(ROOT, d));

// §10.2, as words. Each is matched as a whole word (or phrase), in any case, with a plural s or es.
export const NEVER = {
  'the machinery': ['detect', 'detected', 'auto', 'automatic', 'AI', 'smart', 'magic', 'algorithm', 'recognise', 'recognize', 'onset', 'chroma', 'analyser'],
  "the control room's words": ['LUFS', 'compressor', 'EQ', 'bus', 'insert', 'automation', 'quantize', 'latency', 'plug-in', 'gain staging', 'true peak'],
  grades: ['perfect', 'great', 'awesome', 'amazing', 'nailed', 'good job', 'well done', 'score', 'accuracy', 'rating', 'stars', 'percent'],
  alarm: ['error', 'failed', 'failure', 'oops', 'sorry', 'warning', 'wrong', 'red'],
  school: ['tutorial', 'lesson', 'step 1', 'level up', 'unlock', 'achievement', 'streak'],
  "people who aren't there": ['crowd', 'fans', 'audience', 'bandmate'],
  code: ['sandboxed', 'secure'],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEVER_RE = Object.entries(NEVER).flatMap(([kind, words]) => words.map((w) => ({ kind, w, re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(w).replace(/ /g, '\\s+')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu') })));

// Sample vars for every key a line reads (a Proxy hands out the rest), and a second set with the other branches
// (booleans the other way, a small gain, the basement). Arrays print as a reader would ("G, Em, C, D").
const words = (xs) => Object.assign([...xs], { toString() { return this.join(', '); } });
const SAMPLE = {
  a: 'drop C', b: 'C standard', amp: true, back: 1, bar: 5, bars: 8, bpm: 132, capo: 3, cents: 20,
  changes: 'the bass came up 2 dB and a synth track came in', chords: words(['G', 'Em', 'C', 'D']), count: 3, db: -11,
  device: 'Scarlett Solo USB', dir: 'late', empty: 'breakdown', feel: 'gallop', finish: 'loud', first: true, flat: true,
  form: 'intro, verse, chorus, verse, chorus, breakdown, chorus ×2, end', from: 1, hi: 88, input: 2, job: 'comp', kept: 1,
  kind: 'audio', late: true, lines: 4, lo: 80, master: 2, mb: 21, meter: '3/4', mic: 'The laptop’s mic', minutes: 40, ms: 31,
  n: 2, name: 'Drop C', note: 'verse and chorus doubled; the breakdown’s empty', others: ['room', 'tight'], part: 'Chorus',
  parts: 7, pct: 70, place: 'metal', player: 'Shaker', section: 'chorus', sections: 2, take: 2, takes: [1, 2], tempo: 84,
  than: 'tight', time: '1:51', times: 2, title: 'Void Weather', track: 'Bass', tuning: 'drop C', was: 1,
  what: 'the drummer opened up on the crash', where: 'before the second verse', why: 'the song has no parts yet',
};
const OTHER = {
  ...SAMPLE, amp: false, back: 0, bar: 1, bars: 1, chords: words(['Am']), count: 1, db: 0.3, dir: 'early', empty: '', first: false,
  flat: false, kept: 0, kind: 'instrument', late: false, lo: 84, hi: 84, mb: 0, n: 1, note: 'C', parts: 1, place: 'basement',
  player: 'Strings', takes: [3], times: 3, track: 'drums', capo: 0, input: 0, job: 'nothing', minutes: 1,
};
const proxy = (base, seen) => new Proxy(base, { get: (t, k) => { if (typeof k === 'string' && !(k in t)) seen.add(k); return typeof k === 'string' && !(k in t) ? 'the verse' : t[k]; }, has: () => true });

export async function loadLines() {
  const out = [];
  for (const f of fs.readdirSync(LINES_DIR).filter((x) => x.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(path.join(LINES_DIR, f)).href);
    for (const [id, line] of Object.entries(mod.LINES || {})) out.push({ file: `lines/${f}`, id, line });
  }
  return out;
}

// what a line says, each way: [{ how, text }] (or { how, error })
export function renders(line, unknown = new Set()) {
  const out = [];
  for (const [how, vars] of [['sample', proxy(SAMPLE, unknown)], ['other', proxy(OTHER, unknown)]]) {
    try { out.push({ how, text: String(line.text(vars)) }); } catch (e) { out.push({ how, error: String(e?.message || e) }); }
  }
  // (with no vars a line needn't make sense, its caller owes them, but it mustn't throw: the room says {} at worst)
  try { line.text({}); } catch (e) { out.push({ how: 'none', error: String(e?.message || e) }); }
  return out;
}

// sentences: a full stop or a question mark (not inside a number, not an ellipsis) ends one
export const sentences = (s) => (String(s).trim().match(/[^.?]+(?:[.?]+(?=\s|$)|$)/g) || []).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;

const LABELS = /^(door\.slate\.|shelf\.control$)/;
// Every rule a rendered line breaks: [{ rule, why }]
export function breaks(id, text) {
  const out = [];
  const add = (rule, why) => out.push({ rule, why });
  for (const { kind, re } of NEVER_RE) {
    const m = text.match(re);
    if (m) add('§10.2', `says "${m[0]}" (${kind})`);
  }
  if (/!/.test(text)) add('§10.2', 'an exclamation mark');
  if (/\p{Extended_Pictographic}/u.test(text)) add('§10.2', 'an emoji');
  const max = id.startsWith('note.') ? 3 : 2;
  const n = sentences(text);
  if (n > max) add('§10.1.2', `${n} sentences (at most ${max}${max === 3 ? ', the tape box' : ''})`);
  if (/(^|[\s(:])-\d/.test(text)) add('§10.1.4', 'a hyphen for a minus (−)');
  const unit = text.match(/\d(ms|dB|dBFS|BPM|MB|KB|GB|Hz|kHz|LUFS)\b/);
  if (unit) add('§10.1.4', `no space before the unit ("${unit[0]}")`);
  if (/\d\s*db\b|\d\s*bpm\b|\d\s*mb\b/.test(text)) add('§10.1.4', 'a unit in the wrong case (dB, BPM, MB)');
  if (/^\s*(overdub|the house|the engineer|claude)\s*[:—–-]/i.test(text) || /[—–-]\s*(overdub|the house|the engineer)\s*$/i.test(text)) add('§10.1.7', 'the house signs a line');
  if (/\bundefined\b|\bNaN\b|\bnull\b|\[object |Infinity/.test(text)) add('template', `a broken value in "${text}"`);
  if (/ {2}|\s[.,:;?]|^\s|\s$/.test(text)) add('template', 'stray spaces');
  if (!text.trim()) add('template', 'says nothing');
  // a line is said as a sentence: it ends as one (a slate or a box's label is a label, and Control room → points)
  if (!LABELS.test(id) && text.trim() && !/[.?…→]$/.test(text.trim())) add('template', 'no full stop at the end');
  return out;
}

// ---- what the room's code says
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
}
// the text of a call's first argument, from just after its "(" to the comma or ")" at its own depth
function firstArg(s, i) {
  let depth = 0, q = null, out = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === '\\') { out += s[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (!depth) break; depth--; }
    else if (c === ',' && !depth) break;
    out += c;
  }
  return out;
}
const ID = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
export function scanCode(defined) {
  const files = ROOM_CODE.flatMap(walk).filter((f) => !f.startsWith(LINES_DIR + path.sep));
  const says = new Map(), families = new Map(), anywhere = new Set();
  const note = (map, k, f) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(path.relative(ROOT, f)); };
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/['"`]([a-z][a-z0-9]*(?:\.[a-z0-9]+)*)['"`]/g)) if (defined.has(m[1])) anywhere.add(m[1]);
    const args = [];
    for (const m of s.matchAll(/(?<![\w$])(?:say|sayLine|line|words)\(\s*/g)) args.push(firstArg(s, m.index + m[0].length));
    for (const m of s.matchAll(/LINES\[\s*/g)) args.push(firstArg(s, m.index + m[0].length));
    for (const m of s.matchAll(/(?:const|let)\s+(?:id|line|lineId)\s*=\s*/g)) args.push(firstArg(s, m.index + m[0].length).split(/[;\n]/)[0]);
    for (const m of s.matchAll(/\bid:\s*(['"`][^'"`]+['"`])\s*,\s*vars\b/g)) args.push(m[1]);
    for (const a of args) {
      for (const m of a.matchAll(/(['"])([^'"\n]+)\1/g)) if (ID.test(m[2]) || defined.has(m[2])) note(says, m[2], f);
      for (const m of a.matchAll(/`([a-z][a-z0-9]*(?:\.[a-z0-9]+)*)\.\$\{/g)) note(families, m[1], f);
    }
  }
  return { says, families, anywhere };
}

export async function run(T, ctx) {
  const all = await loadLines();
  T.ok(all.length >= 150, `the room's lines are read from ${new Set(all.map((x) => x.file)).size} files in app/src/core/liveroom/lines (${all.length} lines)`);

  // ids unique across the files
  const seen = new Map(), dup = [];
  for (const x of all) { if (seen.has(x.id)) dup.push(`${x.id} (${seen.get(x.id)} and ${x.file})`); else seen.set(x.id, x.file); }
  T.ok(!dup.length, `every line id is defined once across lines/*.js${dup.length ? `: ${dup.join('; ')}` : ''}`);

  // 1. the rules, line by line
  const unknown = new Set(), failures = [];
  const shapes = all.filter((x) => typeof x.line?.text !== 'function' || ('once' in x.line && typeof x.line.once !== 'boolean'));
  T.ok(!shapes.length, `every line is { text(vars), once? }${shapes.length ? `: ${shapes.map((x) => x.id).join(', ')}` : ''}`);
  for (const x of all) {
    if (typeof x.line?.text !== 'function') continue;
    const rs = renders(x.line, unknown);
    const why = new Map();
    for (const r of rs) {
      if (r.error) { why.set(`throws ${r.how}`, `${r.how} vars: throws ${r.error}`); continue; }
      for (const b of breaks(x.id, r.text)) if (!why.has(b.rule + b.why)) why.set(b.rule + b.why, `${b.rule}: ${b.why}: “${r.text}”`);
    }
    if (why.size) failures.push({ ...x, why: [...why.values()] });
  }
  for (const f of failures) T.ok(false, `${f.file} ${f.id}: ${f.why.join(' | ')}`);
  T.ok(!failures.length, `every line keeps §10.1 and §10.2 (${all.length - failures.length} of ${all.length}, each said two ways: sample vars and the other branches)`);
  if (unknown.size) T.note(`vars no sample covers (said as "the verse"): ${[...unknown].sort().join(', ')}`);

  // 2. said and defined
  const defined = new Set(all.map((x) => x.id));
  const { says, families, anywhere } = scanCode(defined);
  const missing = [...says].filter(([id]) => !defined.has(id));
  T.ok(says.size >= 60 && !missing.length, `every line id the room's code says exists (${says.size} said by id)${missing.length ? `: ${missing.map(([id, fs_]) => `${id} (${[...fs_].join(', ')})`).join('; ')}` : ''}`);
  const fam = [...families.keys()];
  const badFam = fam.filter((p) => ![...defined].some((id) => id.startsWith(p + '.')));
  T.ok(!badFam.length, `every family a template names has lines (${fam.map((p) => p + '.*').join(', ') || 'none'})${badFam.length ? `: none for ${badFam.join(', ')}` : ''}`);
  const said = (id) => says.has(id) || anywhere.has(id) || fam.some((p) => id.startsWith(p + '.') && !id.slice(p.length + 1).includes('.'));
  const unsaid = all.filter((x) => !said(x.id));
  for (const x of unsaid) T.ok(false, `${x.file} ${x.id} is defined but nothing in the room says it`);
  T.ok(!unsaid.length, `every line defined is said somewhere in app/src/ui/liveroom or app/src/core/liveroom (${all.length - unsaid.length} of ${all.length})`);

  // 3. agents, in Node
  {
    const { summarize } = await import(pathToFileURL(path.join(ROOT, 'app/src/core/project.js')).href);
    const { createStore } = await import(pathToFileURL(path.join(ROOT, 'app/src/core/store.js')).href);
    const store = createStore(null);
    const made = store.dispatch([
      { type: 'section.add', ref: 'v', section: { name: 'Verse', start: 0, length: 32 } },
      { type: 'room.set', patch: { place: 'metal', tuning: 'drop-c', finish: 'tight' } },
      { type: 'room.part.set', section: '$v', patch: { feel: 'chugs' } },
      { type: 'sheet.set', patch: { capo: 3, time: [3, 4] } },
      { type: 'sheet.section.add', section: { name: 'Verse 1', lines: [{ text: 'Somewhere a [G]paper [Em]moon' }] } },
    ], { by: 'claude' });
    const text = made.ok === false ? '' : summarize(store.get());
    const room = (text.match(/^room: .*$/m) || [''])[0], sheet = (text.match(/^sheet: .*$/m) || [''])[0];
    T.ok(!!room && !!sheet && /metal club/.test(room) && /capo 3/.test(sheet), `get_project's summary has the room's and the sheet's lines ("${room.slice(0, 70)}" · "${sheet.slice(0, 60)}")`);
    const tools = await import(pathToFileURL(path.join(ROOT, 'app/src/agent/tools.js')).href);
    const cat = await tools.catalogSchemas();
    const rm = cat.find((x) => x.name === 'render_and_measure'), ap = cat.find((x) => x.name === 'apply_ops'), say = cat.find((x) => x.name === 'say');
    const TEN = ['room.set', 'room.part.set', 'sheet.set', 'sheet.section.add', 'sheet.section.set', 'sheet.section.remove', 'sheet.line.add', 'sheet.line.set', 'sheet.line.remove', 'section.move'];
    const { ROOM_OPS } = await import(pathToFileURL(path.join(ROOT, 'app/src/core/liveroom/room-ops.js')).href);
    const { SHEET_OPS } = await import(pathToFileURL(path.join(ROOT, 'app/src/core/liveroom/sheet-ops.js')).href);
    const theirs = [...Object.keys(ROOM_OPS), ...Object.keys(SHEET_OPS), 'section.move'].sort();
    T.ok(cat.length === 40 && JSON.stringify(theirs) === JSON.stringify([...TEN].sort()) && /section\.move/.test(ap.description) && /sheet\./.test(ap.description) && /room\.\*/.test(ap.description)
      && rm.input_schema.properties.targets.enum.includes('acoustic') && /talkback/.test(say.description),
      `the agent tools stay 40 (${cat.length}); apply_ops names section.move, sheet.* and room.* (the ten ops: ${theirs.join(' ')}); render_and_measure takes the acoustic targets; say knows the talkback`);
  }

  // 4. the talkback, in muted Chromium
  if (!ctx.pages) return;
  const { openRoom } = await import('./harness.js');
  const s = await openRoom('/app/?room', { name: 'copy' });
  try {
    await s.page.waitForFunction(() => window.overdub?.liveRoom?.isOpen?.() && document.querySelector('.lr-talkback'), null, { timeout: 20000 });
    const read = () => s.E(() => {
      const tb = [...document.querySelectorAll('.lr-talkback')].find((x) => x.offsetParent) || document.querySelector('.lr-talkback');
      const by = tb?.querySelector('.lr-tb-by .by');
      return { line: tb?.querySelector('.lr-tb-line')?.textContent || '', by: by ? { text: by.textContent, agent: by.classList.contains('by-agent'), color: getComputedStyle(by).color } : null, ink: getComputedStyle(document.documentElement).getPropertyValue('--agent').trim() };
    });
    await s.E(() => window.overdub.liveRoom.say('The chorus is in.'));
    const house = await read();
    const r = await s.E(() => window.overdub.tools.run('say', { text: 'The bridge could go before the last chorus.' }, { by: 'claude' }));
    await s.E(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
    const agent = await read();
    const hex = (c) => { const m = String(c).match(/\d+/g); return m ? '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('') : c; };
    T.ok(house.line === 'The chorus is in.' && !house.by, `the house's line is in the talkback, unsigned ("${house.line}", ${house.by ? `signed ${house.by.text}` : 'no byline'})`);
    T.ok(r?.ok && /talkback/.test(r.where || '') && agent.line === 'The bridge could go before the last chorus.' && agent.by?.text === 'Claude' && agent.by.agent && hex(agent.by.color) === agent.ink.toLowerCase(),
      `the in-app agent's say is in the talkback with a Claude byline in cool ink ("${agent.line}", ${agent.by ? `${agent.by.text}, ${hex(agent.by.color)} (--agent ${agent.ink})` : 'unsigned'}; ${r?.where || r?.error})`);
    const n = await s.E(() => window.overdub.tools.list().length);
    T.ok(n === 40, `the studio has 40 agent tools with the room open (${n})`);
    T.ok(!s.errors.length, `the copy check's page: no page errors${s.errors.length ? `: ${s.errors.slice(0, 2).join(' | ')}` : ''}`);
  } finally { await s.close(); }
}
