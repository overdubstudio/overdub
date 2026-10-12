// @ts-check
// The Preview ribbon: next.overdubstudio.com wears it, the live site never does. Which one this is comes from
// app/site-config.json, the deploy's switches: never committed, written by deploy/deploy.sh for each site from one base.
// The preview's copy adds { "env": "preview", "preview": true, "ref": "<commit>" }; this module reads those three keys and
// leaves the rest to whoever owns them. No "preview" key, or a missing, unreadable or non-JSON file, is the live site.
// The ribbon is a paper slip in the top-left corner, above the logo, out of the way of every click (pointer-events: none), and the tab's
// title starts "Preview ·" so a tester can tell the two apart in a row of tabs. Songs saved on the preview stay on
// the preview: browsers keep each site's storage apart, which the slip's label says for a screen reader.
//
// app.site = { env, preview, ref, ready }   (production until the config is read; ready resolves when it has been;
//                                          the read never holds up the studio's boot)

import { h, css } from './dom.js';
import { loadSiteConfig } from '../site-config.js';

// The three keys this module owns, from the parsed file (or anything else: no object is the live site).
export function siteOf(c) {
  if (!c || typeof c !== 'object') return { env: 'production', preview: false, ref: '' };
  return { env: String(c.env || 'production'), preview: c.preview === true, ref: typeof c.ref === 'string' ? c.ref.slice(0, 12) : '' };
}

export default function preview(app) {
  app.site = { env: 'production', preview: false, ref: '' };
  // the one read of site-config.json (site-config.js; main.js started it at boot): no second fetch
  app.site.ready = loadSiteConfig().then((c) => siteOf(c.raw), () => siteOf(null)).then((c) => { Object.assign(app.site, c); if (c.preview) wear(app.site); return app.site; });
}

function wear(site) {
  css('preview', `
    .preview-slip { position: fixed; top: 0; left: 0; z-index: 2147483000; pointer-events: none;
      padding: 1px 8px 2px calc(8px + env(safe-area-inset-left, 0px)); padding-top: calc(1px + env(safe-area-inset-top, 0px));
      background: var(--paper); color: var(--ink); font: 600 9px/11px var(--font-mono); letter-spacing: .14em;
      text-transform: uppercase; white-space: nowrap; border-radius: 0 0 var(--r-press) 0; }
    .preview-slip b { font-weight: 700; }
    .preview-slip span { color: var(--ink-3); letter-spacing: .06em; }
    @media (max-width: 600px) { .preview-slip span { display: none; } }   /* a phone: the word only, over the logo's cell */
  `);
  const slip = h('div.preview-slip', { role: 'note', 'aria-label': `Preview build${site.ref ? ' ' + site.ref : ''}. Songs saved here stay on this site.`, 'data-preview': site.ref || '' },
    h('b', {}, 'Preview'), site.ref ? h('span', {}, ` · ${site.ref}`) : null);
  document.body.append(slip);
  if (!document.title.startsWith('Preview')) document.title = `Preview · ${document.title}`;
  document.documentElement.dataset.preview = '1';
}
