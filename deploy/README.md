# Deploys

Two sites, one tree, both in the **Overdub AWS account** (800849967977; nothing Overdub lives in AJ's personal account
any more). Both are a private S3 bucket behind CloudFront (an origin access control, the path-rewrite function in
`path-rewrite.js`, a response headers policy, no-cache text and day-cached media), and both ship exactly what is
committed (`git archive`), never the working tree. Their AWS is **Terraform's** ([`infra/README.md`](../infra/README.md)):
`infra/live` and `infra/next`. The scripts here only ship code and config.

**main goes to the preview by itself; the live site moves only by a manual, approved workflow.**

| | Live | Preview |
|---|---|---|
| Address | https://overdubstudio.com (www redirects there) | https://next.overdubstudio.com |
| AWS | `infra/live` | `infra/next` |
| Ships | by hand: Actions › **deploy-live** › Run workflow (a commit on main, default its head), then a reviewer of the `production` environment (AJ or brvtl) approves | every push to main whose unit tests and static checks pass (ci.yml, `deploy-staging`) |
| Runs | `deploy/deploy.sh --skip-tests <sha>`, then `node tools/prod-check.js` | `deploy/deploy.sh --skip-tests --next <sha>` |
| AWS role | `overdub-live-deploy-github`, only for a job in the `production` environment | `overdub-next-deploy-github`, only for runs on main |
| Repository variables | `LIVE_DEPLOY_ROLE`, `LIVE_DISTRIBUTION` | `NEXT_DEPLOY_ROLE`, `NEXT_DISTRIBUTION` |
| `app/site-config.json` (never committed) | REF's `deploy/live-config.json` (committed: today only the `stems` entry; no cloud) | the same, with REF's `deploy/next-config.json` over it (the staging cloud API), plus `preview` and the commit |
| Search engines | indexed | `X-Robots-Tag: noindex, nofollow` on every response |
| Counts (`app/src/analytics.js`) | on (`infra/live` logs; `deploy/analytics/setup.sh`, `tools/stats.sh`) | off (they count on `overdubstudio.com` only) |

The relay behind Connect to Claude is in the same account, at https://mcp.overdubstudio.com: `infra/live/relay.tf`
makes it, `deploy/relay/deploy.sh` ships its code (docs/REMOTE-MCP.md, "Hosting").

`deploy/deploy.sh` refuses a live deploy outside GitHub Actions. `LOCAL_LIVE_DEPLOY=1 AWS_PROFILE=overdub
deploy/deploy.sh [REF]` is the emergency hatch, for when Actions is down and the site has to move, and needs a checkout
of overdub-devices at the pinned commit. The preview can still be deployed from a laptop (`deploy/deploy.sh --next [REF]`).

`DRY_RUN=1` before a script prints what it would do and calls nothing: `DRY_RUN=1 deploy/deploy.sh --skip-tests`,
`DRY_RUN=1 deploy/deploy.sh --skip-tests --next HEAD~1`, `DRY_RUN=1 deploy/relay/deploy.sh`,
`DRY_RUN=1 deploy/analytics/setup.sh`. `tools/analytics-test.js` runs them dry with a stub `aws` and checks the plans.

## The live site

`infra/live` (Terraform; `infra/README.md`) holds:

- the zone `overdubstudio.com` (imported: it was made with the CLI when the name servers moved) and its records: the
  apex and www, the certificate's validation CNAMEs, the relay's name and the delegation of `next.overdubstudio.com`;
- the bucket `overdubstudio.com`, private, readable only by the distribution;
- one ACM certificate for overdubstudio.com, www.overdubstudio.com and mcp.overdubstudio.com;
- the origin access control `overdub-live`, the function `overdub-path-rewrite` (built from `path-rewrite.js`, the one
  source for both sites) and the response headers policy `overdub-headers` (below);
- the distribution;
- the private buckets `overdub-models-800849967977` (the stems model) and `overdub-logs-800849967977` (CloudFront's
  access logs, forgotten after 90 days);
- the deploy role, trusting only `<repo>:environment:production`, on infra/next's GitHub OIDC provider;
- the relay (`relay.tf`).

**The cutover is a variable.** `serve_names` is false at first: the distribution has no aliases and CloudFront's
default certificate, the apex and www records still point at the old distribution in AJ's personal account, and the
function also serves the distribution's own `<id>.cloudfront.net` name (`CLOUDFRONT_NAME` in `path-rewrite.js`, false
in git), so the first deploy can be checked there. Once the old distribution has let go of both names (a CLI step in
the personal account, which isn't in Terraform), `terraform apply -var serve_names=true` (then set it in
`variables.tf`) gives the distribution both names and the certificate, publishes the function without the
cloudfront.net name, and points the records at it.

`deploy/deploy.sh` (live) ships to `s3://overdubstudio.com` and invalidates the distribution named by
`LIVE_DISTRIBUTION` (what the workflow passes), else `deploy/.distribution-id`, else the one whose alias is
overdubstudio.com.

### The site config

`app/site-config.json`, the deploy's configuration, is never committed: `deploy.sh` is its one writer. It starts from
**REF's `deploy/live-config.json`** (read with `git show`, like the files), else `{}`, so what ships is reviewed in a
pull request like everything else. `SITE_CONFIG=<file>` reads another file instead, for a developer's local experiment.
Today the file holds the stems runner's entry: the model (`modelFrom`, `s3://overdub-models-800849967977/…`, copied
with `aws s3 cp` under the deploy's own credentials and checked against `sha256`) and the onnxruntime-web runtime
(`runtimeFrom`, a pinned jsDelivr directory, checked against `runtimeSha256`), both staged beside the studio
(`deploy/stage-stems.js`). Both deploy roles may read the models bucket. One that can't be staged stops a live deploy;
on `--next` it's a warning and the preview ships with no stems entry (stems off there).

The preview's copy then lays **REF's `deploy/next-config.json`** over that base (a live deploy never reads it), and adds
`"env": "preview", "preview": true, "ref": "<commit>"`, keeping every other key as it is. The overlay is shallow, one
top-level key at a time: a key in `next-config.json` replaces the base's whole entry (to change one field of `stems`
there, restate all of `stems`), and the three preview keys win over both. Today it names only the staging cloud API,
`{ "cloud": { "api": "https://api.next.overdubstudio.com" } }` (overdub-cloud, deployed by its own repo; its CORS
answers only https://next.overdubstudio.com), so Claude on Overdub credits and its sign-in with Google can be tried on
the preview. It doesn't name `accounts.api`: Sign in with Overdub for Connect also needs the account relay
(`ACCOUNT_RELAY`, relay.overdubstudio.com) and overdub-cloud's OAuth side (`OAUTH_ENABLED`), and neither is deployed.
The live config names no cloud, as there is no production service yet. The studio's CSP (`app/index.html`) allows the
staging origin in `connect-src` on both sites, since a `<meta>` policy can't vary by host; the live studio never
connects to it because its config doesn't name it. A production service is a change to `deploy/live-config.json` and
that `connect-src` together. `NEXT_CONFIG=<file>` reads another overlay instead of REF's (no file, or one that can't be
read, is `{}`); like `SITE_CONFIG`, it's for a developer's experiment and the dry-run checks. An overlay that isn't a
JSON object stops the preview deploy. `tools/analytics-test.js` checks that `--next` ships `cloud.api` from it, that a
live deploy ships no cloud key, and that every cloud origin a committed config names is in the studio's `connect-src`.

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

Once the shelf is on, `node tools/prod-check.js` checks the live copy against the pin: the live index's SHA-256 is the
pin's, its `built.from` is the pinned index's (read from `app/community/` when that's the pinned copy, else from the
pin's commit in `OVERDUB_DEVICES_DIR` or `../overdub-devices`), no revoked fingerprint is listed, and a clip answers
`audio/mpeg`. Run it after every pin move.

Putting it live, in order (COMMUNITY-SHELF.md, "Where it's on", has the why):

1. The headers and the current `path-rewrite.js` (the `/community/` path) on both distributions: they are Terraform's,
   so `terraform plan` in `infra/live` and `infra/next` shows nothing to change.
2. (Was the scripts' second run; nothing to do now.)
3. `node tools/prod-check.js`: the frame headers on `/`, `/app/`, `/site/community/` and `/community/`, and
   `/community` a 301.
4. The pin moved to overdub-devices master's merge commit (`node tools/community-pull.js --pin <sha>`), in its own
   pull request.
5. The commit that links the gallery (the **Community** word in the site's top nav, the `llms.txt` line, GUIDE.md's
   line), merged. Then the deploy-live workflow, which ships `app/community/` and runs `node tools/prod-check.js` for the
   shelf checks.

## The response headers

Both distributions send a custom response headers policy in place of CloudFront's managed SecurityHeadersPolicy:
`overdub-headers` on the live site (`infra/live/cdn.tf`), `overdub-next-headers` on the preview (`infra/next/cdn.tf`).
It keeps the managed policy's values (HSTS for a year, `nosniff`, `strict-origin-when-cross-origin`,
`X-XSS-Protection: 1; mode=block`) with two changes, both with override on and on every path: `X-Frame-Options: DENY`
(not SAMEORIGIN) and `Content-Security-Policy: frame-ancestors 'none'`. Nothing on the site is framed by another page,
and the community shelf's trust prompt mustn't be. A header CSP holding only `frame-ancestors` adds to the pages'
`<meta>` CSPs; it doesn't loosen them. The preview's copy adds `X-Robots-Tag: noindex, nofollow`. `server/serve.js`
sends the same frame headers and `nosniff` locally; `tools/prod-check.js` checks them on the live site after every
deploy, and `tools/community-test.js` checks both policies' HCL. Then
`curl -sI https://overdubstudio.com/app/ | grep -iE 'frame|content-security'` shows both headers.

## How the preview works

Its AWS is Terraform's, in [`infra/next`](../infra/README.md): the hosted zone `next.overdubstudio.com` (delegated from
overdubstudio.com, whose NS record is `infra/live`'s), the bucket `next.overdubstudio.com`, an ACM certificate for that
name validated by a CNAME in its own zone, a copy of the path-rewrite function whose home is `next.overdubstudio.com`
(so its own paths resolve and nothing redirects testers to the live site), the response headers policy above with
noindex, the distribution, the bucket policy that lets only that distribution read, and the A/AAAA alias. Terraform
never touches the bucket's objects: `deploy.sh --next` ships them and invalidates. It reads the distribution id from
`deploy/.next-distribution-id` (gitignored; `terraform -chdir=infra/next output -raw distribution_id`), or looks the
distribution up by its alias.

The studio reads the preview's config at boot (`app/src/ui/preview.js`, `app.site`) and puts a paper slip in the
top-left corner, "Preview · <commit>", and starts the tab's title with "Preview ·". The live site's copy has no
`preview` key, so it never shows the slip. A ref from before the ribbon existed (no `app/src/ui/preview.js`) deploys
without the slip or the title; the noindex header still applies, since it comes from the distribution.

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
invalidate its distribution and read the stems model, and nothing else.
`infra/next/github.tf` holds the role and GitHub's identity provider; `deploy_branches` names the branches whose runs
may assume it (default `main`). The role's ARN and the distribution id (`terraform -chdir=infra/next output`) go in the
repository variables `NEXT_DEPLOY_ROLE` and `NEXT_DISTRIBUTION`.

What a tester should know: songs, keys and settings saved on the preview stay on the preview (each site keeps its own
browser storage).

## The live site from GitHub Actions

`.github/workflows/deploy-live.yml` runs only by hand: Actions › deploy-live › Run workflow, on main, with `ref` (a
SHA, a tag or `main`; empty is main's head). Two jobs.

**e2e**, first, on Peter's self-hosted Mac mini (`ghastly`, labels `self-hosted, macOS, ARM64, overdub-e2e`): it
resolves the ref the same way (a commit on main), then runs the whole end-to-end suite, `node tools/run-all.js` one
suite at a time (`PAR=1`, so the real-time checks have the machine to themselves), the browsers, renders and real-time
checks GitHub's shared macOS runners are too slow for. It sets itself up each run (Node from `mise.toml`, the kits with
their downloads kept in `~/Library/Caches/overdub-kits`, playwright-core and its browsers), so the machine needs nothing
but the runner. It holds no AWS role, no environment and no secret; a failed run keeps its screenshots as the `e2e-out`
artifact. A self-hosted runner must never take a job an outsider can start: the repo is public, so a fork's pull request
would run its code on that machine. `test/unit/workflows.test.js` fails any workflow that names a self-hosted runner and
can be triggered by anything but `workflow_dispatch`, `push` or `schedule`.

**deploy** needs e2e, so a reviewer is only asked once the suite passed, and it ships the commit e2e tested (an empty
ref is main's head, which may have moved in between). It:

1. waits in the `production` environment until a required reviewer (AJ or brvtl) approves; the environment's
   deployment branches are main only, so a run started from another branch never gets that far;
2. checks that commit is on main again, then checks it out, and checks out overdub-devices (private) with the
   environment's read-only deploy key, `OVERDUB_DEVICES_DEPLOY_KEY`, for the community shelf;
3. builds the sampled kits (`node tools/fetch-kits.js`, with ci.yml's cache) and installs playwright-core and its
   headless Chromium for the check, before any AWS credentials exist in the job;
4. signs in to AWS as `overdub-live-deploy-github` with GitHub's OIDC token and runs `deploy/deploy.sh --skip-tests <sha>`;
5. runs `node tools/prod-check.js` against https://overdubstudio.com, or the distribution's cloudfront.net name before
   the cutover.

Runs never overlap (a concurrency group with no cancelling).

GitHub settings (by `gh api`, done once): the `production` environment with AJ and brvtl as required reviewers and
deployment branches limited to main; the repository variables `LIVE_DEPLOY_ROLE` and `LIVE_DISTRIBUTION`
(`terraform -chdir=infra/live output`); the environment secret `OVERDUB_DEVICES_DEPLOY_KEY`; and, under Actions >
General, "Require approval for all external contributors" for fork pull requests, the second guard on the self-hosted
runner. The runner itself is registered to this repository only (`~/actions-runner` on ghastly, a service).
