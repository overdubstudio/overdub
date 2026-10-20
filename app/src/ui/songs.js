// My songs: songs kept in your Overdub account (agent/cloud.js, the service's songs module), beside the copy every song
// already has in this browser. Only when the deploy names the service (app/src/site-config.js) and its GET /v1/config
// has songs on; otherwise nothing here draws, and nothing is asked of anyone.
//
// The Song menu (ui/export.js) asks app.songs.menuRows() for its rows: Save to cloud for a song that isn't in the
// account, "Saved to cloud · 2 min ago" for one that is, and My songs. My songs is a sheet under the Song key (and
// Find's "My songs"): each song's title, when it was last saved, its tracks, and its recordings, which stay in the
// browser they were made in ("2 recordings on this browser only"). Open, Earlier saves (open one as a copy) and Delete
// (asked under the row, never a browser dialog).
//
// The link: localStorage overdub:cloud-song maps an account's project id to { songId, rev, savedAt }, and each copy of
// a song keeps the save it stands on (its base: agent/cloud-songs.js), so a copy put aside or open in another tab never
// saves from a newer one's rev. A linked song saves to the account 5 s after a change and when the tab is hidden, beside
// the local autosave, which stays as it is. A song from a link isn't saved until it's made yours. A save the account
// turns down because it has a newer one (409), or a copy whose base isn't known, saves nothing over it: a toast asks to
// open the newer one or keep that copy as a new song. Opening a
// song from the account goes the way a song file does (app.exporter.openSong: Recent songs and Undo, the held
// devices' ask, guardDevices), and its recordings missing from this browser are named.
//
// Signed out: "Sign in to save songs to your account", with the same Google sign-in as the Agent tab. Signed in
// without Plus: the list still shows and opens, and Save says "Cloud saves come with Plus" and opens the plans (the
// Agent tab's Top up, ui event 'cloud:show').
//
//   app.songs = { enabled, open({ anchor }), save(), menuRows() -> [{ cls, label, sub, run }], status() -> words for the
//                 menu's header line, list, state }

import { h, css } from './dom.js';
import { popover } from './rack.js';
import { newId } from '../core/project.js';
import { songLinks, songBases, docStamp, songAssets, savedAgo, jsonBytes, createSaver, songNonce } from '../agent/cloud-songs.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const titleOf = (x) => String(x?.title || 'Untitled').slice(0, 120);
// My songs without a plan, and nothing in the account yet: what saving there gives you
const PLUS_WHY = 'Cloud saves come with Plus: your songs save to your account as you work, and open on any browser.';

export default function (app) {
  const { store, ui } = app;
  css('ew-songs', SONGS_CSS);
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  const links = songLinks(storage);
  const bases = songBases(storage);
  let cloud = null;
  let list = null, listErr = '', listing = null, listFor = '';   // the account's songs (GET /v1/songs), for whom
  const here = new Map();       // songId -> { n, here }: its recordings, and how many are in this browser
  let pop = null, body = null;  // My songs, while it's open
  let row = null;               // { songId, step: 'delete' | 'revs', revs?, err? } the row that's asking or open
  let busy = '';                // what's working: 'save' | 'open:<id>' | 'delete:<id>' | 'revs:<id>'
  let said = '';                // the sheet's last line
  let offFind = null;
  let edits = 0;                // changes to the song on screen (a save made while it changed goes again)

  let meCanSave = null;          // GET /v1/me's songs.canSave, as last seen
  let lastUid = '';              // the account last signed in here (a linked song says "signed out" while nobody is)
  const on = () => !!cloud?.enabled && !!cloud.songs;
  const listening = () => !!app.share?.listening;
  const pid = () => store.get().id;
  const uid = () => (on() && cloud.me?.user?.id) || '';
  const linked = () => links.get(uid() || lastUid, pid());
  const canSave = () => (typeof list?.canSave === 'boolean' ? list.canSave : typeof cloud?.me?.songs?.canSave === 'boolean' ? cloud.me.songs.canSave : null);
  const maxSongs = () => list?.max || cloud?.me?.songs?.max || cloud?.songs?.maxSongs || 0;

  const saver = createSaver({
    cloud: { saveSong: (id, doc, baseRev, saveId) => cloud.saveSong(id, doc, baseRev, saveId) },
    links,
    bases,
    getDoc: () => (listening() ? null : store.get()),
    user: uid,
    maxBytes: () => cloud?.songs?.maxBytes || 0,
    onState: (s) => {
      if (s.status === 'conflict') conflictToast(s);
      if (s.status === 'saved') touchList(s);
      // gone from the account (deleted in another tab, or with the account): this song is only in this browser now
      // (the saver let go of its link in that account)
      if (s.status === 'blocked' && s.error?.code === 'song_not_found') queueMicrotask(() => saver.clear(s.pid));
      paint();
    },
  });
  saver.loaded(store.get());

  /* ---------------------------------------------------------------- the account */
  function attach() {
    const c = app.agent?.cloud || null;
    if (c !== cloud) cloud = c;
    if (on() && !offFind) offFind = ui.workspace?.addFind?.({ title: 'My songs', purpose: 'Songs saved to your Overdub account', aliases: ['songs', 'cloud', 'account', 'saved', 'open a song'], run: () => open() }) || null;
    if (!on() && offFind) { offFind(); offFind = null; }
    const who = cloud?.me?.user?.id || '';
    if (who) lastUid = who;
    if (on() && who && who !== listFor) { listFor = who; saver.clear(); refresh(); }
    if (!who && listFor) { listFor = ''; list = null; here.clear(); }
    // GET /v1/me says whether saving is on now (a plan bought or ended in this tab or another): its newest answer
    // wins over the list's older one, and a song held for want of Plus saves again
    const can = on() && who && typeof cloud.me?.songs?.canSave === 'boolean' ? cloud.me.songs.canSave : null;
    if (can !== null && can !== meCanSave) {
      if (list) list.canSave = can;
      if (can && saver.held(pid())?.code === 'songs_need_plus') { saver.clear(pid()); saver.changed(); }
    }
    meCanSave = can;
    paint();
  }
  app.agent?.on?.('cloud', attach);
  attach();

  async function refresh() {
    if (!on() || !cloud.me) return null;
    if (listing) return listing;
    listing = (async () => {
      try { list = await cloud.listSongs(); listErr = ''; } catch (e) { listErr = e.message; if (e.status === 401) list = null; }
      listing = null;
      paint();
      if (list) countHere(list.songs);
      return list;
    })();
    return listing;
  }
  // a song just saved: its row in the list says so without asking the service again, from the row the service answered
  // and the song that went (which may be one just put aside, not the song on screen)
  function touchList(s) {
    const r = list?.songs.find((x) => x.songId === (s.song?.songId || s.songId));
    if (!r) return;
    const song = s.song || {}, doc = s.doc || {};
    if (Number.isFinite(Number(song.rev))) r.rev = Number(song.rev);
    r.savedAt = Number(song.savedAt) || s.savedAt || r.savedAt;
    r.title = typeof song.title === 'string' ? song.title : titleOf(doc);
    r.tracks = Number.isFinite(song.tracks) ? song.tracks : Array.isArray(doc.tracks) ? doc.tracks.length : r.tracks;
  }
  const hasAsset = async (id) => {
    const a = app.engine?.assets;
    try { return a?.has ? !!(await a.has(id)) : !!(await a?.get?.(id)); } catch { return false; }
  };
  async function countHere(songs) {
    for (const s of songs) {
      const ids = Array.isArray(s.assets) ? s.assets : [];
      const got = await Promise.all(ids.map(hasAsset));
      here.set(s.songId, { n: ids.length, here: got.filter(Boolean).length });
    }
    paint();
  }
  // "2 recordings on this browser only": a song's audio never goes to the account
  function recordingsWords(s) {
    const r = here.get(s.songId) || { n: Array.isArray(s.assets) ? s.assets.length : 0, here: null };
    if (!r.n) return '';
    if (r.here == null || r.here === r.n) return `${plural(r.n, 'recording')} on this browser only`;
    if (!r.here) return `${plural(r.n, 'recording')}, not on this browser`;
    return `${r.here} of ${r.n} recordings on this browser only`;
  }

  /* ---------------------------------------------------------------- saving */
  store.on('change', (e) => {
    if (e.kind === 'preview') return;
    // (a song on screen: its base is the one kept with that copy, whether songs are on yet or not)
    if (e.kind === 'load') { saver.loaded(store.get()); row = null; paint(); return; }
    edits++;
    saver.changed();
  });
  // a song about to be put aside (ui/export.js: Recent songs, overdub:previous, Undo): it keeps the base it had, and
  // what was waiting goes now, as the song was
  ui.on('song:replacing', ({ song } = {}) => { saver.replacing(song); });
  const flush = () => { if (on()) saver.flush(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  // Save to cloud: the song on screen becomes a song in the account, and saves there as you work
  async function save({ anchor = null } = {}) {
    if (!on()) return false;
    if (!cloud.me) { open({ anchor }); return false; }
    if (canSave() === false) { plans(); return false; }
    const doc = store.get();
    const max = cloud.songs?.maxBytes || 0, bytes = max ? jsonBytes(doc) : 0;
    if (max && bytes > max) { ui.toast(`“${titleOf(doc)}” is too big for a cloud save: ${mb(bytes)} of ${mb(max)}. Save the project file instead.`, { kind: 'bad', ms: 7000 }); return false; }
    busy = 'save'; paint();
    const at = edits, who = uid(), mark = saver.mark();
    try {
      const song = await create(doc);
      if (!song?.songId) throw new Error('The service didn’t say where the song went. Try again.');
      linkTo(who, mark, song);
      saver.clear(doc.id);
      busy = '';
      // (its recordings, when it has any, by count: a cloud save keeps the song, not its audio)
      const n = songAssets(doc).length;
      ui.toast(`“${titleOf(doc)}” is in your account. Changes save there as you work${n ? `; its ${plural(n, 'recording')} ${n === 1 ? 'stays' : 'stay'} in this browser` : ''}.`, { kind: 'ok', ms: 6000 });
      if (edits !== at) saver.changed();   // (changed while it went)
      refresh();
      return true;
    } catch (e) {
      busy = '';
      paint();
      failToast(e, doc);
      return false;
    }
  }
  // One createId per press, sent again when the answer is lost on the way (the network, a service that fell over), so
  // a create that landed answers with its song instead of making a second one.
  async function create(doc) {
    const createId = songNonce();
    for (let tries = 0; ; tries++) {
      try { return await cloud.createSong(doc, createId); } catch (e) {
        if (tries >= 2 || !(e.status === 0 || e.status >= 500)) throw e;
        await new Promise((r) => setTimeout(r, 800 * (tries + 1)));
      }
    }
  }
  // a song gone from that account: no song here is linked to it there any more
  const forget = (who, songId) => { links.dropSong(who, songId); bases.dropSong(who, songId); };
  // that copy of a song is that song in the account now, at its first save
  function linkTo(who, mark, song) {
    const l = { songId: song.songId, rev: Number(song.rev) || 1, savedAt: Number(song.savedAt) || Date.now() };
    // (a copy put aside meanwhile keeps the new base; the link moves only for the song on screen, or a song of its own)
    if (mark.gen === saver.gen || mark.doc?.id !== pid()) links.set(who, mark.doc?.id, l);
    saver.based(who, mark, l);
  }
  function failToast(e, doc = store.get()) {
    if (e.code === 'songs_need_plus') { if (list) list.canSave = false; ui.toast('Cloud saves come with Plus. The songs already in your account still open.', { action: { label: 'See the plans', run: plans } }); return; }
    if (e.code === 'song_limit') { ui.toast(`Your account holds ${maxSongs() || 'its most'} songs. Delete one in My songs to save “${titleOf(doc)}”.`, { action: { label: 'My songs', run: () => open() } }); return; }
    if (e.code === 'song_too_large') { ui.toast(`“${titleOf(doc)}” is too big for a cloud save. Save the project file instead.`, { kind: 'bad', ms: 7000 }); return; }
    if (e.status === 401) { ui.toast('Sign in to save songs to your account.', { action: { label: 'My songs', run: () => open() } }); return; }
    ui.toast(`Not saved to your account: ${e.message}`, { kind: 'bad', ms: 6000 });
  }
  const plans = () => ui.emit('cloud:show', { view: 'topup' });

  // Two saves of one song: the account's is newer than the one this copy stands on (or this copy's isn't known).
  // Nothing is saved over it. s.doc is the copy that wasn't saved: the song on screen, or one just put aside.
  function conflictToast(s = saver.state) {
    const doc = s.doc || store.get();
    const songId = s.songId || links.get(s.uid || uid(), doc.id)?.songId;
    if (!songId) return;
    const cur = s.current || {};
    const title = titleOf(doc);
    const why = s.current === null && s.error?.details?.unknown
      ? `Not saved: this copy of “${title}” may be older than the save in your account. Nothing was saved over it.`
      : `Not saved: your account has a newer save of “${title}”${cur.savedAt ? `, from ${savedAgo(cur.savedAt)}` : ''}, made in another tab or browser. Nothing was saved over it.`;
    // two equal ways out, side by side past the toast's hairline
    ui.toast(why, { kind: 'info', ms: 20000, action: [
      { label: 'Open the newer one', run: () => openNewer(songId, cur.title || title) },
      { label: 'Keep mine as a new song', run: () => keepAsNew(s) },
    ] });
  }
  async function openNewer(songId, title) {
    const ok = await openSong({ songId, title });
    if (ok) saver.clear(pid());
  }
  // the copy that wasn't saved becomes a song of its own in the account (the song on screen, as it is now, when the
  // conflict was its own; a song just put aside, as it was, when the conflict was that copy's)
  async function keepAsNew(s = saver.state) {
    const live = !s.doc || s.gen === saver.gen;
    const doc = live ? store.get() : s.doc;
    const who = uid(), mark = live ? saver.mark() : { gen: s.gen, stamp: docStamp(doc), doc };
    try {
      const song = await create(doc);
      if (!song?.songId) throw new Error('The service didn’t say where the song went. Try again.');
      linkTo(who, mark, song);
      saver.clear(doc.id);
      ui.toast(`Yours is a new song in your account, “${titleOf(doc)}”. The newer save is there too, in My songs.`, { kind: 'ok', ms: 6000 });
      refresh();
    } catch (e) { failToast(e, doc); }
  }

  /* ---------------------------------------------------------------- opening */
  // a song from the account, the way a song file opens; rev: an earlier save, opened as a copy (a song of its own,
  // not linked, so it saves nowhere until you save it)
  async function openSong(s, { rev = null } = {}) {
    if (!app.exporter?.openSong) return false;
    busy = `open:${s.songId}`; paint();
    const who = uid();
    let r;
    try { r = await cloud.getSong(s.songId, rev); } catch (e) {
      busy = ''; said = e.code === 'song_not_found' ? `“${titleOf(s)}” isn’t in your account any more.` : e.message; paint();
      if (e.code === 'song_not_found' && who && who === uid()) { forget(who, s.songId); refresh(); }
      if (!pop) ui.toast(said, { kind: 'bad' });
      return false;
    }
    busy = '';
    let doc = r?.doc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tracks)) { said = 'That save isn’t a song the studio can open.'; paint(); return false; }
    const copy = rev != null;
    if (copy) doc = { ...doc, id: newId('p'), title: `${titleOf(doc)} (save ${rev})` };
    const missing = await missingWords(doc);
    close();
    const what = copy ? `Opened save ${rev} of “${titleOf(r.song || s)}” as a song of its own.` : `Opened “${titleOf(doc)}” from your account.`;
    const ok = await app.exporter.openSong(doc, { from: 'cloud', name: titleOf(doc), said: what + missing });
    if (ok && !copy && r.song) { linkTo(who, saver.mark(), { songId: r.song.songId || s.songId, rev: Number(r.song.rev) || 1, savedAt: Number(r.song.savedAt) || 0 }); saver.clear(store.get().id); }
    return !!ok;
  }
  // its recordings that aren't in this browser (a cloud save keeps the song, not its audio), by name
  async function missingWords(doc) {
    const ids = songAssets(doc);
    if (!ids.length) return '';
    const got = await Promise.all(ids.map(hasAsset));
    const gone = ids.filter((_, i) => !got[i]);
    if (!gone.length) return '';
    const names = gone.map((id) => doc.assets?.[id]?.name || (doc.reference?.asset === id && doc.reference.name) || 'a recording').slice(0, 3).map((n) => `“${String(n).slice(0, 40)}”`);
    const more = gone.length > 3 ? ` and ${gone.length - 3} more` : '';
    return ` ${gone.length === 1 ? 'One recording isn’t' : `${gone.length} recordings aren’t`} in this browser, so ${gone.length === 1 ? 'it’s' : 'they’re'} silent here: ${names.join(', ')}${more}. A cloud save keeps the song, not its audio.`;
  }

  async function remove(s) {
    busy = `delete:${s.songId}`; paint();
    const who = uid();
    try {
      await cloud.deleteSong(s.songId);
      const wasHere = links.get(who, pid())?.songId === s.songId;
      forget(who, s.songId);
      if (list) list.songs = list.songs.filter((x) => x.songId !== s.songId);
      row = null; busy = '';
      said = `“${titleOf(s)}” is deleted from your account.${wasHere ? ' The song on screen stays in this browser.' : ''}`;
      if (wasHere) saver.clear(pid());
    } catch (e) {
      busy = '';
      if (e.code === 'song_not_found') { if (who === uid()) forget(who, s.songId); if (list) list.songs = list.songs.filter((x) => x.songId !== s.songId); row = null; said = `“${titleOf(s)}” was already gone from your account.`; }
      else said = e.message;
    }
    paint();
  }
  async function revs(s) {
    if (row?.songId === s.songId && row.step === 'revs') { row = null; paint(); return; }
    row = { songId: s.songId, step: 'revs', revs: null };
    busy = `revs:${s.songId}`; paint();
    try { const all = await cloud.songRevs(s.songId); if (row?.songId === s.songId) row.revs = all.filter((x) => Number(x.rev) !== Number(s.rev)).sort((a, b) => b.rev - a.rev); }
    catch (e) { if (row?.songId === s.songId) row.err = e.message; }
    busy = ''; paint();
  }

  /* ---------------------------------------------------------------- the Song menu's rows */
  function menuRows() {
    if (!on() || listening()) return [];
    const out = [];
    const l = linked();
    const st = saver.state.pid === pid() ? saver.state : null;
    if (l && cloud.me) {
      const hold = saver.held(pid());
      const c = saver.conflict(pid());
      if (st?.status === 'conflict' || hold?.code === 'song_conflict') out.push({ cls: '.sm-cloud.sm-cloud-bad', label: 'Not saved: a newer save is in your account', sub: 'open it, or keep yours as a new song', run: () => conflictToast(st?.status === 'conflict' ? st : { ...c, pid: pid(), uid: uid(), current: hold.details?.current ?? null }) });
      else if (hold?.code === 'songs_need_plus') out.push({ cls: '.sm-cloud.sm-cloud-bad', label: 'Not saved: cloud saves come with Plus', sub: 'see the plans', run: plans });
      else if (hold) out.push({ cls: '.sm-cloud.sm-cloud-bad', label: 'Not saved to your account', sub: hold.message || '', run: () => open() });
      else if (st?.status === 'saving' || st?.status === 'waiting') out.push({ cls: '.sm-cloud', label: 'Saving to your account…', sub: 'saves as you work', run: () => open() });
      else if (st?.status === 'error') out.push({ cls: '.sm-cloud.sm-cloud-bad', label: 'Not saved to your account yet', sub: `${st.error?.message || 'the service didn’t answer'}: the next change tries again`, run: () => { saver.changed(); saver.flush(); } });
      else out.push({ cls: '.sm-cloud', label: `Saved to cloud · ${savedAgo(st?.savedAt || l.savedAt)}`, sub: 'saves as you work', run: () => open() });
    } else if (l && !cloud.me) out.push({ cls: '.sm-cloud.sm-cloud-bad', label: 'Not saved: signed out', sub: 'Sign in to save songs to your account', run: () => open() });
    else {
      const sub = !cloud.me ? 'Sign in to save songs to your account' : canSave() === false ? 'Cloud saves come with Plus' : 'keeps it in your account, saved as you work';
      out.push({ cls: '.sm-cloud.sm-cloud-save', label: busy === 'save' ? 'Saving to your account…' : 'Save to cloud', sub, run: () => save() });
    }
    const n = list?.songs?.length;
    out.push({ cls: '.sm-mysongs', label: 'My songs', sub: cloud.me ? (n != null ? `${plural(n, 'song')} in your account` : 'songs in your account') : 'sign in to see your songs', run: () => open() });
    return out;
  }

  // the Song menu's header line, after "100 bpm, 6 tracks": how the song on screen stands in the account, only while
  // it's linked ("saved to your account just now"); '' otherwise
  function status() {
    if (!on() || listening()) return '';
    const l = linked();
    if (!l) return '';
    if (!cloud.me) return 'not saved to your account: signed out';
    const st = saver.state.pid === pid() ? saver.state : null;
    if (st?.status === 'conflict' || saver.held(pid()) || st?.status === 'error') return 'not saved to your account';
    if (st?.status === 'saving' || st?.status === 'waiting') return 'saving to your account…';
    return `saved to your account ${savedAgo(st?.savedAt || l.savedAt)}`;
  }

  /* ---------------------------------------------------------------- My songs */
  function open({ anchor = null } = {}) {
    if (!on()) return false;
    const vis = (x) => x?.isConnected && x.getClientRects().length > 0;
    const at = [anchor, document.querySelector('.ew-region-top .sm-btn'), document.querySelector('.ws-find-btn')].find(vis) || document.querySelector('.ew-top') || document.body;
    close();
    body = h('div.sg', { dataset: { k: 'sheet' } });
    said = ''; row = null;
    pop = popover(at, body, { align: 'end', className: 'sg-pop', label: 'My songs', onClose: () => { pop = null; body = null; row = null; } });
    paint();
    pop.el.querySelector('.sg-head b')?.focus({ preventScroll: true });
    if (cloud.me) refresh();
    return true;
  }
  function close() { pop?.close(); pop = null; body = null; }

  // the sheet, drawn again whenever something it shows changes; the control that had focus keeps it
  function paint() {
    if (!body) return;
    const k = document.activeElement?.closest?.('.sg [data-k]')?.dataset.k || null;
    body.replaceChildren(...sheet().filter(Boolean));
    if (k) (body.querySelector(`[data-k="${CSS.escape(k)}"]`) || body.querySelector('.sg-head b'))?.focus({ preventScroll: true });
    pop?.place();
  }
  const btn = (k, cls, label, onclick, extra = {}) => h(`button.btn${cls}`, { type: 'button', dataset: { k }, onclick, ...extra }, label);
  function sheet() {
    const me = cloud?.me;
    const n = list?.songs?.length;
    const head = h('div.sm-head.sg-head', h('b', { tabindex: '-1' }, 'My songs'),
      h('small', me ? `${n != null ? `${n}${maxSongs() ? ` of ${maxSongs()}` : ''} songs, ` : ''}in your Overdub account as ${me.user?.email || 'you'}` : 'songs kept in your Overdub account'));
    if (!me) return [head, ...signedOut()];
    const out = [head];
    // no plan and no songs: what Plus gives, and the plans; nothing about saving or keeping songs it can't do yet
    const plusOnly = !listening() && canSave() === false && !!list && !list.songs.length;
    // the song on screen: in the account already, or a Save to cloud for it
    const l = linked();
    if (!listening()) {
      if (l) out.push(h('p.sg-line', `“${titleOf(store.get())}” is in your account and saves as you work.`));
      else if (canSave() === false) out.push(h('div.sg-plus', h('p.sg-line', plusOnly ? PLUS_WHY : 'Cloud saves come with Plus. The songs already here still open, and you can delete them.'), h('div.sg-acts', btn('plans', '', 'See the plans', () => { close(); plans(); }))));
      else out.push(h('div.sg-acts', btn('save', '.btn-go.sg-save', busy === 'save' ? 'Saving…' : `Save “${titleOf(store.get()).slice(0, 40)}” to cloud`, () => save(), { disabled: busy === 'save' })));
    }
    if (said) out.push(h('p.sg-said', { role: 'status' }, said));
    if (listErr && !list) out.push(h('p.sg-err', listErr), h('div.sg-acts', btn('retry', '', 'Try again', () => refresh())));
    else if (!list) out.push(h('p.sg-line.sg-quiet', 'Reading your songs…'));
    else if (plusOnly) return out;
    else if (!list.songs.length) out.push(h('p.sg-line.sg-quiet', 'Nothing in your account yet. Save to cloud keeps the song on screen here, and it saves as you work.'));
    else out.push(h('ul.sg-list', list.songs.map(songRow)));
    out.push(h('p.sg-note', 'Songs here are kept until you delete them or your account. Recordings stay in the browser they were made in.'));
    return out;
  }
  function signedOut() {
    const st = cloud.state;
    if (st === 'waiting') {
      return [h('p.sg-line', { role: 'status' }, 'Waiting for Google. Finish signing in in the window that opened; this tab notices on its own.'),
        h('div.sg-acts', btn('cancel', '.btn-txt', 'Cancel', () => { cloud.cancelSignIn(); paint(); }))];
    }
    return [h('p.sg-line', 'Sign in to save songs to your account, and open them on any browser.'),
      // (the popup opens in this click itself: an await first and the browser blocks it)
      h('div.sg-acts', btn('google', '.btn-go.sg-google', 'Continue with Google', () => { cloud.signIn(); paint(); })),
      st === 'error' && cloud.error ? h('p.sg-err', cloud.error.message) : null,
      h('p.sg-note', 'A window opens for Google. Overdub gets your email address from it, never your password. Your songs stay in this browser as well.')];
  }
  function songRow(s) {
    const isHere = links.get(uid(), pid())?.songId === s.songId;
    const bits = [s.savedAt ? `saved ${savedAgo(s.savedAt)}` : '', Number.isFinite(s.tracks) ? plural(s.tracks, 'track') : '', recordingsWords(s)].filter(Boolean);
    const asking = row?.songId === s.songId ? row : null;
    const id = s.songId;
    const kids = [
      h('div.sg-row-t', h('b', titleOf(s), isHere ? h('span.sg-on', ' · on screen') : null), h('small', bits.join(' · '))),
      h('div.sg-acts',
        btn(`open:${id}`, '.sg-open', busy === `open:${id}` ? 'Opening…' : 'Open', () => openSong(s), { disabled: !!busy, 'aria-label': `Open “${titleOf(s)}”` }),
        btn(`revs:${id}`, '.btn-txt.sg-revs', 'Earlier saves', () => revs(s), { 'aria-expanded': String(asking?.step === 'revs'), disabled: busy === `revs:${id}` }),
        btn(`del:${id}`, '.btn-txt.sg-del', 'Delete', () => { row = asking?.step === 'delete' ? null : { songId: id, step: 'delete' }; paint(); }, { 'aria-expanded': String(asking?.step === 'delete') })),
    ];
    if (asking?.step === 'delete') {
      kids.push(h('div.sg-ask', { role: 'group', 'aria-label': `Delete “${titleOf(s)}”?` },
        h('p.sg-line', `Delete “${titleOf(s)}” from your account, with its earlier saves?${isHere ? ' The song on screen stays in this browser.' : ''}`),
        h('div.sg-acts',
          btn(`del-go:${id}`, '.sg-del-go', busy === `delete:${id}` ? 'Deleting…' : 'Delete it', () => remove(s), { disabled: !!busy }),
          btn(`del-keep:${id}`, '.btn-txt', 'Keep it', () => { row = null; paint(); }))));
    }
    if (asking?.step === 'revs') {
      const rv = asking.revs;
      kids.push(h('div.sg-revs-list',
        asking.err ? h('p.sg-err', asking.err)
          : rv == null ? h('p.sg-line.sg-quiet', 'Reading its earlier saves…')
            : !rv.length ? h('p.sg-line.sg-quiet', 'No earlier saves yet: the account keeps the last ten.')
              : h('ul', rv.map((x) => h('li.sg-rev', h('span', h('b', `Save ${x.rev}`), h('small', ` · ${savedAgo(x.savedAt)}`)),
                btn(`rev:${id}:${x.rev}`, '.btn-txt.sg-rev-open', 'Open as a copy', () => openSong(s, { rev: x.rev }), { disabled: !!busy, 'aria-label': `Open save ${x.rev} of “${titleOf(s)}” as a copy` }))))));
    }
    return h(`li.sg-row${isHere ? '.sg-here' : ''}`, { dataset: { song: id } }, kids);
  }

  app.songs = {
    get enabled() { return on(); },
    get list() { return list; },
    get state() { return saver.state; },
    open, save, menuRows, status, refresh,
  };
}

const SONGS_CSS = `
/* My songs: the Song menu's ledger, a sheet under the Song key (a bottom sheet on a phone) */
.sg-pop { width: min(400px, calc(100vw - 16px)); max-height: min(80vh, 640px); }
.sg { display: grid; gap: 8px; padding: 0 0 4px; }
.sg-head b:focus { outline: none; }
.sg-line, .sg-said, .sg-err, .sg-note { margin: 0 10px; font-size: 12.5px; line-height: 1.45; color: var(--text-2); }
.sg-said { color: var(--text); }
.sg-err { color: var(--bad); }
.sg-note { font-size: 12px; color: var(--text-3); padding-top: 8px; border-top: var(--rule); }
.sg-quiet { color: var(--text-3); }
.sg-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 10px; }
.sg-plus { display: grid; gap: 8px; }
.sg-list { list-style: none; margin: 0; padding: 0; border-top: var(--rule); }
.sg-row { display: grid; gap: 6px; padding: 9px 0; border-bottom: var(--rule); }
.sg-row-t { display: grid; gap: 2px; margin: 0 10px; min-width: 0; }
.sg-row-t b { font-size: 13px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
.sg-row-t small { font-size: 12px; color: var(--text-3); }
.sg-on { font-weight: 400; color: var(--text-3); font-size: 12px; }
.sg-row .sg-acts .btn { height: 28px; }
.sg-row .sg-acts .btn-txt { height: auto; }
.sg-ask { display: grid; gap: 6px; margin: 2px 0 0; padding-top: 8px; border-top: var(--rule); }
.sg-revs-list { margin: 0 10px 0 20px; border-left: var(--rule); }
.sg-revs-list ul { list-style: none; margin: 0; padding: 0; }
.sg-revs-list .sg-line { margin: 4px 10px; }
.sg-rev { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 10px; font-size: 12.5px; color: var(--text-2); }
.sg-rev small { font-size: 12px; color: var(--text-3); }
.sm-cloud-bad b { color: var(--text); }
.sm-cloud-bad small { color: var(--bad); }
/* a phone, or a finger: rows of 44 px keys, the sheet along the bottom */
@media (pointer: coarse), (max-width: 640px) {
  .sg .btn, .sg .btn-txt, .sg-row .sg-acts .btn, .sg-row .sg-acts .btn-txt { min-height: 44px; }
  .sg .btn-txt { padding: 0 6px; }
}
@media (max-width: 640px) {
  .ew-pop.sg-pop { left: 8px !important; right: 8px; top: auto !important; bottom: 8px; width: auto; max-width: none; max-height: 82vh; }
}
`;
