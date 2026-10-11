// Flip a song (spec 0014 section D): the door's fourth way in. A song the person owns comes in as one undo step, then
// the chores run on their own while the person plays, scrolls and works: the split (when this site has a stems
// runner, jobs/), then the analysis in its Worker (audio/analyze/). Nothing is modal and nothing is fetched from a
// link: the files are local, the analysis runs here, and the runner (off unless app/site-config.json names a model)
// runs here too.
//
//   1. The import, "Flip: <name>", by you (core/flip.js planFlip): Original, then Vocals, Drums, Bass and Other when
//      they were brought as files (labelled by name, input/importers.js importFlip). The vocal plays; the rest are on
//      hand, muted. With no stems yet the original plays until they arrive.
//   2. The split, when the runner is on and no stems were brought: its estimate first (jobs.estimate: the graphics
//      card's wait goes ahead; the processor's wait, or a machine under 8 GB, asks: Split on the processor or Skip the
//      split). Its stems land as their own step, "Stems from <name>", by the house (core/flip.js planStems), the vocal
//      playing and the original muted. Off: the person brings stems as files (the door says how).
//   3. The analysis: its result lands as one step by the house, "Grid, key and sections from <name>"
//      (analyze/toOps.js resultToOps: the map, the clips placed on it, the key, the sections with their keys, a muted
//      Chords track). The toast says what landed: "Flip: One Last Breath is in. Grid follows the recording, 68.4 BPM,
//      drifting 66.9–70.2. Key D minor. 8 sections."
//   4. When the analysis is unsure (result.sure false), the readings step opens (app.start.choose: the tap door's
//      step): "Which one nods along with the vocal?", the found grid, double, half, the other downbeat, each played with
//      the click over the recording. Picking one replaces the map, joined into one undo step by you; Back puts the
//      found grid back. The toast's "Other readings" opens it any time after.
//
// The progress line (one sentence and a hairline that fills, at the foot of the arranger: arranger.js draws
// app.flip.line() in its frame): "Splitting… 40%. About 25 s on this computer's graphics card.", "Finding the
// beat…", "Marking sections…"; Cancel stops what is running and leaves what landed.
//
// app.flip = { pick(), flip(files, { split? }) -> Promise<{ ok, name, tracks, clips }>, line() -> { text, fraction,
//   actions: [{ label, run, go? }] } | null, cancel(), readings() (open the readings step for the last flip), busy,
//   idle() -> Promise (the chores of the running flip settle), last() -> { name, result, clips, tracks } | null,
//   useJobs(jobs) (the tests' fake runner: jobs/fake.js) }

import { newId } from '../core/project.js';
import { beatsPerBar } from '../core/music.js';
import { planFlip, planStems, STEM_ROLES } from '../core/flip.js';
// (the analysis, its ops and the job layer load on the first flip, not with the studio)
const lazy = { toOps: null, client: null, jobs: null };
const toOps = async () => lazy.toOps || (lazy.toOps = await import('../audio/analyze/toOps.js'));
const analyzeAudio = async (...a) => (lazy.client || (lazy.client = await import('../audio/analyze/client.js'))).analyzeAudio(...a);
const pageJobs = async () => (lazy.jobs || (lazy.jobs = await import('../jobs/index.js'))).pageJobs();

const STAGE_TEXT = { beat: 'Finding the beat…', key: 'Finding the key…', sections: 'Marking sections…' };
const lower = (s) => String(s || '').replace(/^[A-Z](?=[a-z ])/, (c) => c.toLowerCase());
const isAbort = (e) => e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''));
const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));

export default function (app) {
  const { store, ui, engine } = app;
  let jobsOverride = null, jobsP = null;
  const jobs = () => (jobsOverride ? Promise.resolve(jobsOverride) : jobsP || (jobsP = pageJobs().catch(() => null)));

  // the running (or last) flip: { name, files, clips: [{ role, track, clip }], split, ctl, line, done, result, txn,
  // reading, pickTxn }
  let run = null, last = null;
  const P = () => store.get();
  const toast = (text, opts = {}) => ui?.toast?.(text, opts);
  const setLine = (text, fraction = null, actions = []) => { if (run) run.line = text ? { text, fraction, actions } : null; };

  function pick() {
    if (!app.importers?.pickFlip) return false;
    app.importers.pickFlip((files) => flip(files));
    return true;
  }

  async function flip(items, { split = true } = {}) {
    if (run && run.busy) { toast('A flip is still running: its line in the arranger says where it is, and Cancel stops it.'); return { ok: false, error: 'busy' }; }
    if (P().tracks.some((t) => t.clips.length)) { toast('Flip a song is for a blank song: Song ▸ New song gives you one.'); return { ok: false, error: 'not blank' }; }
    if (!app.importers?.importFlip) return { ok: false, error: 'no importers' };
    const imp = await app.importers.importFlip(items);
    if (imp.failed.length) toast(`Couldn’t read ${imp.failed.join(', ')}: this browser can’t decode ${imp.failed.length === 1 ? 'it' : 'them'}. WAV, MP3, M4A and OGG work.`, { kind: 'bad' });
    if (!imp.files.length) return { ok: false, error: 'nothing decoded' };
    const brought = imp.files.some((f) => STEM_ROLES.includes(f.role));
    const original = imp.files.find((f) => f.role === 'original') || null;
    const j = split && !brought && original ? await jobs() : null;
    const runner = j?.runner?.('stems');
    const willSplit = !!(runner && runner.available);
    // the samples first (IndexedDB), then the document: a clip never names an asset that isn't there
    const assets = app.engine?.assets;
    if (!assets || typeof assets.put !== 'function') { toast('Audio can’t come in yet: the audio engine is still loading.', { kind: 'bad' }); return { ok: false, error: 'no asset store' }; }
    const files = imp.files.map((f) => ({ ...f, asset: { id: newId('a'), name: f.name, sr: f.buf.sampleRate, channels: f.buf.numberOfChannels, duration: f.buf.duration } }));
    for (const f of files) await assets.put(f.asset.id, f.buf);
    const plan = planFlip(P(), { name: imp.name, files, stemsLater: willSplit });
    const r = store.dispatch(plan.ops, { by: 'you', label: plan.label });
    if (!r.ok) { for (const f of files) assets.remove?.(f.asset.id); toast(`Couldn’t bring it in: ${r.error}`, { kind: 'bad' }); return { ok: false, error: r.error }; }
    const clips = plan.refs.map((x) => ({ role: x.role, track: r.created[x.track], clip: r.created[x.clip] }));
    run = last = { name: imp.name, files, clips, split: willSplit, jobs: j, busy: true, line: null, result: null, txn: null, reading: 0, pickTxn: null, ctl: new AbortController(), importTxn: r.txn?.id };
    const playing = clips.find((c) => !P().tracks.find((t) => t.id === c.track)?.mute);
    try { ui.select({ track: playing?.track || clips[0].track, clip: null, notes: [] }); } catch { /* ok */ }
    ui.emit?.('import', { kind: 'flip', tracks: clips.map((c) => c.track), clips: clips.map((c) => c.clip) });
    setLine(willSplit ? 'Flip: getting ready to split…' : STAGE_TEXT.beat);
    const me = run;
    me.done = chores(me).finally(() => { me.busy = false; me.line = null; });
    return { ok: true, name: imp.name, tracks: clips.map((c) => c.track), clips: clips.map((c) => c.clip), split: willSplit };
  }

  // the flip's clips the song still has, the conformed one (the original, else the first) first
  function liveClips(me) {
    const out = [];
    for (const c of me.clips) { const f = store.findClip(c.clip); if (f && f.track.id === c.track) out.push(c); }
    out.sort((a, b) => (a.role === 'original' ? -1 : b.role === 'original' ? 1 : 0));
    return out;
  }
  const alive = (me) => run === me && !me.ctl.signal.aborted;

  // the person's choice on the line: resolves true (go) or false (skip)
  function ask(me, text, goLabel) {
    return new Promise((resolve) => {
      const settle = (v) => { if (me.asking) { me.asking = null; resolve(v); } };
      me.asking = settle;
      setLine(text, null, [{ label: goLabel, go: true, run: () => settle(true) }, { label: 'Skip the split', run: () => settle(false) }]);
      me.ctl.signal.addEventListener('abort', () => settle(false), { once: true });
    });
  }

  async function chores(me) {
    const signal = me.ctl.signal;
    const orig = me.files.find((f) => f.role === 'original');
    let stems = null;
    try {
      // brought stems: the analysis reads them as the split's would be read
      const brought = me.files.filter((f) => STEM_ROLES.includes(f.role));
      if (brought.length) { stems = {}; for (const f of brought) if (!stems[f.role]) stems[f.role] = channelsOf(f.buf); }
      if (me.split && orig) stems = (await split(me, orig)) || stems;
      if (!alive(me)) return;
      setLine(STAGE_TEXT.beat);
      const input = { sr: (orig || me.files[0]).buf.sampleRate, ...(orig ? { mix: channelsOf(orig.buf) } : {}), ...(stems ? { stems } : {}) };
      const { result } = await analyzeAudio(input, { signal, onProgress: (st) => { if (alive(me)) setLine(STAGE_TEXT[st] || STAGE_TEXT.beat); } });
      if (!alive(me)) return;
      me.result = result;
      await toOps();
      if (!alive(me)) return;
      land(me);
    } catch (e) {
      if (isAbort(e)) return;
      console.error('flip', e);
      toast(`The grid couldn’t be read: ${e.message}. The recording is in; the song keeps its one tempo.`, { kind: 'bad', ms: 8000 });
    }
  }

  async function split(me, orig) {
    const j = me.jobs, input = { sr: orig.buf.sampleRate, channels: channelsOf(orig.buf) };
    let est = null;
    try { est = await j.estimate({ kind: 'stems', input }); } catch (e) { console.warn('flip: estimate', e); }
    if (!alive(me)) return null;
    if (est && !est.cached && (est.device !== 'gpu' || est.warn)) {
      const go = await ask(me, `Split it into stems? ${est.text}`, est.device === 'gpu' ? 'Split anyway' : 'Split on the processor');
      if (!go || !alive(me)) { if (alive(me)) setLine(STAGE_TEXT.beat); return null; }
    }
    const tail = est && !est.cached ? ` ${est.text}` : '';
    setLine(`Splitting… 0%.${tail}`, 0);
    let out;
    try {
      out = await j.run({ kind: 'stems', input }, { signal: me.ctl.signal, onProgress: (pr) => { if (alive(me)) { const f = Math.max(0, Math.min(1, +pr.fraction || 0)); setLine(`Splitting… ${Math.round(f * 100)}%.${tail}`, f); } } });
    } catch (e) {
      if (isAbort(e) || !alive(me)) throw e;
      toast(`The split didn’t finish: ${e.message}. The grid is read from the whole recording instead.`, { kind: 'bad', ms: 8000 });
      return null;
    }
    if (!alive(me)) return null;
    // the stems land as their own step, by the house
    const assets = app.engine.assets, res = out.result, ids = {};
    for (const role of STEM_ROLES) {
      const ch = res.stems[role];
      if (!ch || !ch.length) continue;
      const id = newId('a');
      await assets.put(id, { sr: res.sr, channels: ch });
      ids[role] = { id, name: `${me.name} (${role})`, sr: res.sr, channels: ch.length, duration: ch[0].length / res.sr };
    }
    if (!alive(me)) return null;
    const o = liveClips(me).find((c) => c.role === 'original');
    const plan = planStems(P(), { name: me.name, original: o || null, assets: ids });
    const r = store.dispatch(plan.ops, { by: 'overdub', label: plan.label });
    if (!r.ok) { for (const a of Object.values(ids)) assets.remove?.(a.id); toast(`The stems didn’t go in: ${r.error}`, { kind: 'bad' }); return null; }
    for (const x of plan.refs) me.clips.push({ role: x.role, track: r.created[x.track], clip: r.created[x.clip] });
    return res.stems;
  }

  function land(me) {
    const result = me.result;
    if (!result.readings || !result.readings.length) {
      toast(`Flip: ${me.name} is in. No steady beat found, so the song keeps its one tempo.`, { ms: 7000 });
      return;
    }
    const clips = liveClips(me);
    if (!clips.length) return;
    const { resultToOps, flipSummary } = lazy.toOps;
    const ops = resultToOps(P(), result, 'found', { clips: clips.map(({ track, clip }) => ({ track, clip })) });
    const r = store.dispatch(ops, { by: 'overdub', label: `Grid, key and sections from ${me.name}` });
    if (!r.ok) { toast(`The grid didn’t go in: ${r.error}`, { kind: 'bad' }); return; }
    me.txn = r.txn?.id || null;
    me.reading = 0;
    const many = result.readings.length > 1;
    me.toastEl = toast(`Flip: ${me.name} is in. ${flipSummary(result, 'found', { clip: 'the recording' })}`, { kind: 'ok', ms: 9000, action: many ? { label: 'Other readings', run: () => readings() } : null });
    if (!result.sure && many) readings();
  }

  /* ---------------------------------------------------------------- the readings (R27) */
  const WORDS = { found: 'the recording’s own tempo', double: 'twice as fast', half: 'half as fast', twothirds: 'in threes: two thirds of the tempo' };
// (the other downbeat says where its 1 is: "the 1 is a beat later", from analyze/map.js)
  function readings() {
    const me = last;
    if (!me || !me.result || !me.result.readings?.length || !app.start?.choose || !lazy.toOps) return false;
    const { readingOps } = lazy.toOps;
    const rs = me.result.readings;
    const clips = () => liveClips(me).map(({ track, clip }) => ({ track, clip }));
    if (!clips().length) return false;
    const before = me.reading, click = engine.metronome;
    const hasVocal = me.clips.some((c) => c.role === 'vocals');
    const hear = (i) => {
      const R = rs[i];
      const playFrom = () => { try { engine.metronome = true; const bpb = beatsPerBar(P().meter); const b = R.anchors[1] ? R.anchors[1].beat : 0; engine.play(Math.max(0, b - bpb)); } catch { /* silent engine */ } };
      if (i === me.reading) { playFrom(); return true; }
      const r = store.dispatch(readingOps(P(), me.result, R, { clips: clips() }), { by: 'you', label: `another reading: ${R.tempo} BPM`, ...(me.pickTxn ? { join: me.pickTxn } : {}) });
      if (!r.ok) { toast(r.error, { kind: 'bad' }); return false; }
      me.pickTxn = r.txn?.id || me.pickTxn;
      me.reading = i;
      playFrom();
      return true;
    };
    me.pickTxn = null;
    const restore = () => { try { engine.metronome = click; } catch { /* ok */ } };
    const opened = app.start.choose({
      run: 'Flip a song', stepName: 'The grid',
      title: hasVocal ? 'Which one nods along with the vocal?' : 'Which one nods along with the recording?',
      sub: `Each plays the recording with the click on its grid. The studio's first guess is ${WORDS[rs[0].id] || 'the found grid'}${me.result.why?.length ? `, but ${me.result.why.join(' and ')}` : ''}.`,
      items: rs.map((R) => ({ main: `${(Math.round(R.tempo * 10) / 10).toFixed(1)} BPM`, what: lower(WORDS[R.id] || R.why) })),
      at: me.reading,
      pick: (i) => hear(i),
      use: (i) => { restore(); const R = rs[i]; if (i !== before) toast(`The grid is ${(Math.round(R.tempo * 10) / 10).toFixed(1)} BPM: ${WORDS[R.id] || R.why}.`, { kind: 'ok' }); },
      back: () => {
        restore();
        try { engine.stop(); } catch { /* ok */ }
        if (me.reading === before) return;
        const h = store.history, top = h[h.length - 1];
        if (me.pickTxn && top && top.id === me.pickTxn) store.undo();
        else store.dispatch(readingOps(P(), me.result, rs[before], { clips: clips() }), { by: 'you', label: 'the grid as it was' });
        me.reading = before;
      },
    });
    // (the landing's toast would sit over the rows on a phone: its one action is this step, so it goes)
    if (opened) { try { me.toastEl?.remove?.(); } catch { /* gone */ } hear(me.reading); }
    return opened;
  }

  function cancel() {
    const me = run;
    if (!me || !me.busy) return false;
    const what = me.line && /^Split/.test(me.line.text) ? 'the split' : 'the grid';
    me.ctl.abort();
    me.busy = false; me.line = null;
    toast(`Stopped ${what}. What landed stays; ${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'}Z takes it out.`);
    return true;
  }

  // an undo of the import (or another song) ends the chores quietly
  store.on('change', (e) => {
    const me = run;
    if (!me || !me.busy) return;
    if (e.kind === 'load' || !me.clips.some((c) => store.findClip(c.clip))) { me.ctl.abort(); me.busy = false; me.line = null; }
  });

  const api = app.flip = {
    pick, flip, cancel, readings,
    line() {
      const me = run;
      if (!me || !me.busy || !me.line) return null;
      const acts = me.line.actions && me.line.actions.length ? me.line.actions : [{ label: 'Cancel', run: cancel }];
      return { text: me.line.text, fraction: me.line.fraction, actions: acts };
    },
    get busy() { return !!(run && run.busy); },
    idle: () => (run && run.done ? run.done : Promise.resolve()),
    last: () => (last ? { name: last.name, result: last.result, reading: last.reading, split: last.split, clips: last.clips.map((c) => ({ ...c })) } : null),
    useJobs(j) { jobsOverride = j || null; },
  };
  return api;
}
