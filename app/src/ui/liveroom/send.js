// Sending [ui; stream F] (docs/research/LIVE-ROOM-MODE.md §3.14): the mix as a file, and the whole song with its
// recordings as a zip a room opens again. It adds the 'send' screen to the registry (ui/liveroom/screens.js) when it's
// imported; the stage and the shelf open it with app.liveRoom.open({ screen: 'send' }).
//
// Frozen (§14.2):
//   sendMix(app) -> Promise of { ok, error?, via?, name?, bytes?, seconds?, lufs? }
//       the release (ui/export.js releaseRender: the first sound to the end of the tail, muted tracks out, through the
//       finish on the master) as a 16-bit 48 kHz WAV: through the share sheet when navigator.canShare({ files }) says
//       it can take it (via 'share'), else a download (via 'download'). A share you close isn't an error: { ok: false,
//       cancelled: true }
//   sendSong(app) -> Promise of { ok, error?, name?, bytes?, recordings?, missing? }
//       the song's JSON and its recordings as 32-bit float WAVs, one zip (ui/export.js songZip), downloaded: ⌘O opens
//       it again, here or in another browser, and puts the recordings back. It's also the shelf's backup.
// What each did is said in the talkback when the room is open (core/liveroom/lines/shelf.js send.*), else as a toast.
// No share link: a link carries the notes and the devices and leaves the recordings behind, so it would send the band
// without you.
//
// Inside (not exported: the module's names are §14.2's):
//   sizes(app) -> Promise of { seconds, mixBytes, songBytes, recordings }   what the screen's two choices say
//   mixFor(app) -> Promise of releaseRender's result                    the mix of the song as it is now: the screen
//       starts it as it opens, so a press shares the file at once (a share sheet wants the press it came from, and a
//       render takes seconds); a change to the song starts again

import { h, css } from '../dom.js';
import { screens } from './screens.js';
import { LINES } from '../../core/liveroom/lines/shelf.js';
import { download, songAssets } from '../export.js';

const line = (id, vars) => LINES[id].text(vars || {});
const MB = (b) => Math.max(1, Math.round(b / 1e6));
const fmtTime = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function tell(app, text, kind = 'ok') {
  if (app.liveRoom?.isOpen?.()) app.liveRoom.say(text);
  else app.ui?.toast?.(text, { kind, ms: 7000 });
}
let sending = null;
// the mix the send screen made ahead: { app, ver, p } (ver: the song's changes, counted while the screen is up, which
// is the only time one is kept: with no screen to count them, every send renders the song as it is)
let ahead = null, ver = 0, watching = 0;
function mixFor(app) {
  if (ahead && ahead.app === app && ahead.ver === ver) return ahead.p;
  const p = Promise.resolve().then(() => app.exporter.releaseRender({ bits: 16 }));
  if (!watching) return p;
  const mine = (ahead = { app, ver, p });
  p.catch(() => { if (ahead === mine) ahead = null; });
  return p;
}

export async function sendMix(app) {
  if (sending) return { ok: false, error: `Still sending the ${sending}.` };
  if (!app.exporter?.releaseRender) return { ok: false, error: 'The studio’s exports aren’t loaded yet.' };
  sending = 'mix';
  try {
    let r;
    try { r = await mixFor(app); } catch (e) { const t = line('send.didnt', { why: String(e?.message || e) }); tell(app, t, 'bad'); return { ok: false, error: t }; }
    if (r.error === 'empty') { const t = line('send.nothing'); tell(app, t, 'info'); return { ok: false, error: t }; }
    if (r.error === 'silent') { const t = line('send.silent'); tell(app, t, 'info'); return { ok: false, error: t }; }
    if (r.error) { const t = line('send.didnt', { why: r.error }); tell(app, t, 'bad'); return { ok: false, error: t }; }
    const name = `${r.name}.wav`, vars = { name, time: fmtTime(r.seconds), mb: MB(r.bytes) };
    const out = { name, bytes: r.bytes, seconds: r.seconds, lufs: r.lufs, peak: r.peak, sampleRate: r.sampleRate };
    let file = null;
    try { file = new File([r.wav], name, { type: 'audio/wav' }); } catch { file = null; }
    let can = false;
    try { can = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch { can = false; }
    if (can) {
      try {
        await navigator.share({ files: [file], title: r.name });
        tell(app, line('send.shared', vars) + (r.out || ''));
        return { ok: true, via: 'share', ...out };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, cancelled: true, ...out };
        // (a share sheet that won't take it: the file is saved instead)
      }
    }
    download(name, r.wav, 'audio/wav');
    tell(app, line('send.saved', vars) + (r.out || ''));
    return { ok: true, via: 'download', ...out };
  } finally { sending = null; }
}

export async function sendSong(app) {
  if (sending) return { ok: false, error: `Still sending the ${sending}.` };
  if (!app.exporter?.songZip) return { ok: false, error: 'The studio’s exports aren’t loaded yet.' };
  sending = 'song';
  try {
    let r;
    try { r = await app.exporter.songZip(); } catch (e) { const t = line('send.song.didnt', { why: String(e?.message || e) }); tell(app, t, 'bad'); return { ok: false, error: t }; }
    download(r.name, r.zip, 'application/zip');
    tell(app, line('send.song.saved', { name: r.name, mb: MB(r.bytes), n: r.recordings }) + (r.missing ? ` ${line('send.song.missing', { n: r.missing })}` : ''));
    return { ok: true, name: r.name, bytes: r.bytes, recordings: r.recordings, missing: r.missing };
  } finally { sending = null; }
}

// What the two choices say before either is pressed: the mix's length and size (16-bit stereo at 48 kHz, from the
// song's length), and the song's (its JSON and each recording as 32-bit float, as the zip will hold them)
async function sizes(app) {
  const p = app.store.get();
  let beats = 0;
  try { beats = app.engine?.songEnd?.() || 0; } catch { beats = 0; }
  let seconds = 0;
  try { seconds = app.engine?.beatToSec ? app.engine.beatToSec(beats) : (beats * 60) / (p.tempo || 120); } catch { seconds = (beats * 60) / (p.tempo || 120); }
  seconds += 1;
  let songBytes = JSON.stringify(p).length + 22, recordings = 0;
  for (const id of songAssets(p)) {
    let b = app.engine?.assets?.peek?.(id) || null;
    if (!b) { try { b = await app.engine?.assets?.get?.(id); } catch { b = null; } }
    const meta = p.assets?.[id];
    const bytes = b ? b.length * b.numberOfChannels * 4 : meta ? Math.round((meta.sr || 48000) * (meta.duration || 0) * (meta.channels || 1) * 4) : 0;
    if (bytes) { songBytes += bytes + 44 + 80; recordings++; }
  }
  return { seconds, mixBytes: Math.round(seconds * 48000) * 4 + 44, songBytes, recordings };
}

/* ------------------------------------------------------------------------------------------------ the screen */
const CSS = `
.lrs { width: min(100%, 720px); display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
.lrs-choice { display: flex; flex-direction: column; gap: 4px; padding: 16px; min-height: 64px; text-align: left; cursor: pointer; font: inherit; color: var(--text);
  background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--r-press, 2px); }
.lrs-choice:hover, .lrs-choice:focus-visible { background: var(--bg-3); border-color: var(--text-3); outline: none; }
.lrs-choice:focus-visible { box-shadow: 0 0 0 2px var(--accent-2); }
.lrs-choice[disabled] { opacity: .55; cursor: default; }
.lrs-choice b { font-size: 18px; font-weight: 600; }
.lrs-choice span { font-size: 14px; color: var(--text-2); }
.lrs-back { align-self: center; }
/* (the talkback under the two choices, in their column) */
.lr[data-screen="send"] > .lr-talkback { width: min(100%, 720px); }
`;

screens.add({
  id: 'send',
  mount(el, ctx) {
    const { app, ui, store } = ctx;
    css('liveroom-send', CSS);
    let gone = false;
    // (what the stage or the table last said was about them: the talkback starts empty here, for what sending says)
    try { /** @type {any} */ (el.closest('.lr'))?.__lrTalkback?.clear?.(); } catch { /* fine */ }
    // (each choice is its line once the sizes are known: "Send a mix: about 1:51 and 21 MB." from the song's length, then
    // "Send a mix: 1:51, about 21 MB." once the mix has rendered)
    const mixSays = h('b', 'Send a mix'), songSays = h('b', 'Send the song');
    const mixBtn = h('button.lrs-choice.lrs-mix', { type: 'button', onclick: () => go('mix') }, mixSays);
    const songBtn = h('button.lrs-choice.lrs-song', { type: 'button', onclick: () => go('song') }, songSays);
    const stage = () => (!store.get().room ? 'door' : store.get().room.place === 'kitchen' ? 'kitchen' : 'stage');
    const back = () => app.liveRoom.open({ screen: stage() });
    el.append(h('div.lrs',
      h('h1.lr-h.disp', 'Send'),
      mixBtn, songBtn,
      h('button.btn.btn-txt.lrs-back', { type: 'button', onclick: back }, stage() === 'door' ? 'Back to the door' : stage() === 'kitchen' ? 'Back to the table' : 'Back to the stage')));
    // the mix starts rendering now, so a press can hand it to the share sheet at once; a change starts it again
    const offChange = store.on('change', () => { ver++; });
    watching++;
    let rendered = false;
    const sayMix = (seconds, bytes, { about = false } = {}) => { if (!gone && !(about && rendered)) { rendered = !about; mixSays.textContent = line(about ? 'send.mix.about' : 'send.mix', { time: fmtTime(seconds), mb: MB(bytes) }); } };
    (async () => {
      const s = await sizes(app);
      if (gone) return;
      sayMix(s.seconds, s.mixBytes, { about: true });
      songSays.textContent = line('send.song', { mb: MB(s.songBytes) });
    })();
    if (app.exporter?.releaseRender && store.get().tracks.some((t) => t.clips.length)) {
      const v = ver;
      mixFor(app).then((r) => { if (r && !r.error && v === ver) sayMix(r.seconds, r.bytes); }).catch(() => { /* said when pressed */ });
    }
    async function go(what) {
      mixBtn.disabled = songBtn.disabled = true;
      try { return await (what === 'mix' ? sendMix(app) : sendSong(app)); } finally { if (!gone) mixBtn.disabled = songBtn.disabled = false; }
    }
    setTimeout(() => { if (!gone && !el.contains(document.activeElement)) mixBtn.focus({ preventScroll: true }); }, 0);
    const open = () => !gone && app.liveRoom?.isOpen?.();
    const offs = [ui.keys.add({ key: 'Escape', first: true, when: open, group: 'Live room', label: 'Back to the stage', run: back })];
    return {
      frame() {},
      press(id) {
        if (id === 'mix' || id === 'send.mix') { go('mix'); return { ok: true }; }
        if (id === 'song' || id === 'send.song') { go('song'); return { ok: true }; }
        if (id === 'back') { back(); return { ok: true }; }
        return false;
      },
      unmount() { gone = true; offChange(); watching--; ver++; ahead = null; for (const off of offs) off(); el.replaceChildren(); },
    };
  },
});
