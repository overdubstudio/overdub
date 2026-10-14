# Deploys

Two sites, one tree. Both are a private S3 bucket behind CloudFront (an origin access control, the path-rewrite
function in `path-rewrite.js`, no-cache text and day-cached media), and both ship exactly what is committed
(`git archive`), never the working tree. Ids live in the gitignored `deploy/.env` (see `env.example`), never here.

| | Live | Preview |
|---|---|---|
| Address | https://overdubstudio.com | https://next.overdubstudio.com |
| One-time setup | `deploy/setup.sh` | `deploy/next/setup.sh` |
| Ship | `deploy/deploy.sh` (HEAD, or `REF=…`) | `deploy/deploy.sh --next [REF]` (any committed ref; HEAD by default) |
| `app/site-config.json` (never committed) | written by the deploy: `deploy/site-config.json`, else `{}` (configuration only: the hosted agent's `cloud`, the account service's `accounts`, `stems`) | the same, plus `preview` and the commit |
| Search engines | indexed | `X-Robots-Tag: noindex, nofollow` on every response |
| Counts (`app/src/analytics.js`) | on | off (they count on `overdubstudio.com` only) |

`DRY_RUN=1` before either script stages the files and prints what it would send, calling nothing:
`DRY_RUN=1 deploy/deploy.sh --skip-tests --next HEAD~1`, `DRY_RUN=1 deploy/next/setup.sh`.
`tools/analytics-test.js` runs both dry with a stub `aws` and checks the plan.

## The community shelf (`app/community/`)

The studio's shelf is pinned, not committed: `deploy/community-pin.json` names an overdub-devices commit and the
SHA-256 of its `index/community-index.json`. `deploy.sh` reads the pin **at REF**
(`git show REF:deploy/community-pin.json`, never the working tree) and runs `tools/community-pull.js` into its stage
after `git archive`. The pull reads that commit with `git archive <commit> index/` from the overdub-devices checkout
(`OVERDUB_DEVICES_DIR`, else `../overdub-devices`), checks the index's hash and every device file's kernel against its
entry, and copies the index, the device files and the MP3 clips. If it refuses, nothing is deployed. The index and device files go up as JSON and
the clips as `audio/mpeg`, all `no-cache`, so a rebuild or a takedown is live at the next load.

| At REF | What the deploy does with the shelf |
|---|---|
| no `deploy/community-pin.json` (any ref before the pin existed) | nothing: no shelf, as before |
| a pin | pulls, checks and ships it; a refused pull stops the deploy. With no checkout to pull from, a live deploy stops; `--next` goes on without the shelf and says so ("app/community: none on this preview"), so CI's preview deploy works without overdub-devices |

`COMMUNITY_PIN=<file>` reads another pin, in a dry run only.
`tools/community-test.js` runs the deploy dry against a fixture overdub-devices repo and checks the plan.

Moving the shelf forward is a pull request that changes only `deploy/community-pin.json`:
`node tools/community-pull.js --pin <overdub-devices commit>` checks that commit, writes the pin, fills
`app/community/` and prints what's added, changed and taken down since the last pin, for the PR body
(`.github/PULL_REQUEST_TEMPLATE/community-pin.md`). Adding needs the second person to accept the PR; a takedown pin
merges at once and is reviewed after (overdub-devices' `docs/TAKEDOWN.md`).

Taking a device down is a pin that revokes it: the studio reads `app/community/community-index.json` on every load and
applies its `revoked` list, so the next deploy takes it back in every browser.

`node tools/prod-check.js`Once the shelf is on, `node tools/prod-check.js` checks the live copy against the pin: the live index's SHA-256 is the
pin's, its `built.from` is the pinned index's (read from `app/community/` when that's the pinned copy, else from the
pin's commit in `OVERDUB_DEVICES_DIR` or `../overdub-devices`), no revoked fingerprint is listed, and a clip answers
`audio/mpeg`. Run it after every pin move.

Putting it live, in order (COMMUNITY-SHELF.md, "Where it's on", has the why):

1. The headers: `DRY_RUN=1 deploy/headers.sh`, then `deploy/headers.sh` and `deploy/headers.sh --next` (below).
2. `deploy/setup.sh` and `deploy/next/setup.sh` again, so CloudFront runs the current `path-rewrite.js` (the
   `/community/` path).
3. `node tools/prod-check.js`: the frame headers on `/`, `/app/`, `/site/community/` and `/community/`, and
   `/community` a 301.
4. The pin moved to overdub-devices master's merge commit (`node tools/community-pull.js --pin <sha>`), in its own
   pull request.
5. The commit that links the gallery (the **Community** word in the site's top nav, the `llms.txt` line, GUIDE.md's
   line), merged. Then `deploy/deploy.sh`, which ships `app/community/`, then `node tools/prod-check.js` again for the
   shelf checks.

## The response headers (`deploy/headers.sh`)

Both distributions send a custom response headers policy in place of CloudFront's managed SecurityHeadersPolicy:
`overdub-headers` on the live site, `overdub-next-headers` on the preview. It keeps the managed policy's values (HSTS
for a year, `nosniff`, `strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`) with two changes, both
with override on and on every path: `X-Frame-Options: DENY` (not SAMEORIGIN) and
`Content-Security-Policy: frame-ancestors 'none'`. Nothing on the site is framed by another page, and the community
shelf's trust prompt mustn't be. A header CSP holding only `frame-ancestors` adds to the pages' `<meta>` CSPs; it doesn't
loosen them. The preview's copy adds `X-Robots-Tag: noindex, nofollow`. `server/serve.js` sends the same frame headers
and `nosniff` locally.

`deploy/headers.sh` makes the policy or brings it up to date (If-Match), then sets it on the distribution's default
behaviour, and on any behaviour still on the managed policy, only when one differs; a second run changes nothing.
`setup.sh` and `next/setup.sh` call it. For a distribution that already exists:

```sh
DRY_RUN=1 deploy/headers.sh            # the plan, no AWS calls (--next for the preview)
deploy/headers.sh                      # live: deploy/.distribution-id, else the overdubstudio.com alias (DIST=<id> to name it)
deploy/headers.sh --next               # the preview
```

CloudFront takes a few minutes to roll the change out. Then
`curl -sI https://overdubstudio.com/app/ | grep -iE 'frame|content-security'` shows both headers.
`aws cloudfront get-response-headers-policy --id 67f7725c-6f97-4210-82d7-5512b31e9d03` shows the managed values it
copies.

## How the preview works

`deploy/next/setup.sh` (once; re-running skips what exists) makes the bucket `next.overdubstudio.com`, an ACM
certificate for that name validated by a CNAME in the overdubstudio.com zone, a copy of the path-rewrite function whose
home is `next.overdubstudio.com` (so its own paths resolve and nothing redirects testers to the live site), a response
headers policy (`deploy/headers.sh --next`: the live site's headers plus `X-Robots-Tag: noindex, nofollow`), the distribution, the bucket
policy that lets only that distribution read, and the A/AAAA alias. It writes the distribution id to
`deploy/.next-distribution-id` (gitignored); `deploy.sh --next` reads it, or looks the distribution up by its alias.

`deploy.sh --next REF` ships the same files the live site gets, with one difference in `app/site-config.json`, the
deploy's configuration. That file is never committed and `deploy.sh` is its one writer: for both sites it starts from the
gitignored `deploy/site-config.json` (`SITE_CONFIG=<file>` reads another), else `{}`, and the preview's copy adds
`"env": "preview", "preview": true, "ref": "<commit>"`, keeping every other key as it is. The studio reads it at boot
(`app/src/ui/preview.js`, `app.site`) and puts a paper slip in the top-left corner, "Preview · <commit>", and starts
the tab's title with "Preview ·". The live site's copy has no `preview` key, so it never shows the slip. A ref from
before the ribbon existed (no `app/src/ui/preview.js`) deploys without the slip or the title; the noindex header still
applies, since it comes from the distribution.

There are no feature toggles: what is merged to `main` ships at the next live deploy, and unfinished work waits on its
branch. The site config holds configuration only (a dormant service is absent until it names one); a `"toggles"` key
left in the base is dropped from the copy that ships, and the deploy says so. A base that isn't a JSON object stops a
live deploy. After a live deploy, `node tools/prod-check.js` fails when `site-config.json` isn't served or doesn't
parse, or when the studio has no Connect tab or `app.remote`.

## The preview from GitHub Actions

`.github/workflows/ci.yml` runs the unit tests on every pull request and every push to `main`, in one job on Linux
(`ubuntu-latest`):

```sh
node --test "test/unit/*.test.js"    # unit tests, what CI runs (seconds)
```

A push to `main` (a merge) whose tests pass is deployed to the preview by its `deploy-staging` job; you can also start
the workflow by hand on `main` (Actions › ci › Run workflow), which runs the tests and then deploys. CI doesn't run the
integration suites (browsers, servers, renders), so run `node tools/run-all.js` locally before merging.
The deploy signs in to AWS with GitHub's OIDC token, never a stored key, as a role that can write the preview's bucket
and invalidate its distribution and nothing else.
`deploy/next/github-oidc.sh` (once, `AWS_PROFILE=overdub`; `DRY_RUN=1` prints the plan) makes the role and GitHub's
identity provider; `BRANCHES` names the branches whose runs may assume it (default `main`). The role's
ARN and the distribution id go in the repository variables `NEXT_DEPLOY_ROLE` and `NEXT_DISTRIBUTION`.

What a tester should know: songs, keys and settings saved on the preview stay on the preview (each site keeps its own
browser storage). Connect to Claude doesn't work there: the relay accepts the live origin only.
