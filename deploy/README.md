# Deploys

Two sites, one tree. Both are a private S3 bucket behind CloudFront (an origin access control, the path-rewrite
function in `path-rewrite.js`, no-cache text and day-cached media), and both ship exactly what is committed
(`git archive`), never the working tree. Ids live in the gitignored `deploy/.env` (see `env.example`), never here.

| | Live | Preview |
|---|---|---|
| Address | https://overdubstudio.com | https://next.overdubstudio.com |
| AWS setup | `deploy/setup.sh` (once) | Terraform: `infra/next` ([`infra/README.md`](../infra/README.md)) |
| Ship | `deploy/deploy.sh` (HEAD, or `REF=…`) | `deploy/deploy.sh --next [REF]` (any committed ref; HEAD by default) |
| `app/site-config.json` (never committed) | written by the deploy: `deploy/site-config.json`, else `{}`, plus REF's `deploy: 'on'` toggles (relay, which `on('relay')` reads; accounts and the hosted agent are `on('accounts')` and `on('cloud.agent')`) | the same, plus `preview` and the commit |
| Search engines | indexed | `X-Robots-Tag: noindex, nofollow` on every response |
| Counts (`app/src/analytics.js`) | on | off (they count on `overdubstudio.com` only) |

`DRY_RUN=1` before the deploy stages the files and prints what it would send, calling nothing:
`DRY_RUN=1 deploy/deploy.sh --skip-tests --next HEAD~1`. `tools/analytics-test.js` runs it dry with a stub `aws` and
checks the plan (and runs the old `deploy/next/setup.sh` dry too: it is kept for that check, and no longer matches the
account).

## How the preview works

Its AWS is Terraform's, in [`infra/next`](../infra/README.md): the hosted zone `next.overdubstudio.com` (delegated from
overdubstudio.com, whose zone is in another account), the bucket `next.overdubstudio.com`, an ACM certificate for that
name validated by a CNAME in its own zone, a copy of the path-rewrite function whose home is `next.overdubstudio.com`
(so its own paths resolve and nothing redirects testers to the live site; Terraform builds it from `path-rewrite.js`, so
that file stays the one source), a response headers policy with the managed security headers plus
`X-Robots-Tag: noindex, nofollow`, the distribution, the bucket policy that lets only that distribution read, and the
A/AAAA alias. Terraform never touches the bucket's objects: `deploy.sh --next` ships them and invalidates. It reads the
distribution id from `deploy/.next-distribution-id` (gitignored; `terraform -chdir=infra/next output -raw
distribution_id`), or looks the distribution up by its alias.

`deploy.sh --next REF` ships the same files the live site gets, with one difference in `app/site-config.json`, the
deploy's switches. That file is never committed and `deploy.sh` is its one writer: for both sites it starts from the
gitignored `deploy/site-config.json` (`SITE_CONFIG=<file>` reads another), else `{}`, and the preview's copy adds
`"env": "preview", "preview": true, "ref": "<commit>"`, keeping every other key as it is. The studio reads it at boot
(`app/src/ui/preview.js`, `app.site`) and puts a paper slip in the top-left corner, "Preview · <commit>", and starts
the tab's title with "Preview ·". The live site's copy has no `preview` key, so it never shows the slip. A ref from
before the ribbon existed (no `app/src/ui/preview.js`) deploys without the slip or the title; the noindex header still
applies, since it comes from the distribution.

Both copies also carry the feature toggles (`"toggles": { "<id>": "on" | "off" }`, read by `app/src/toggles.js`).
`deploy.sh` imports REF's own registry and adds `"<id>": "on"` for each `deploy: 'on'` entry the base doesn't name
(only relay, which was on live before the registry existed; an explicit `"relay": "off"` is kept), then prints
`toggles on: …` under the config line. A `toggles` that isn't an object, a value other than `"on"` or `"off"`, or an
id REF doesn't register stops a live deploy; on `--next` it's one warning line. A REF with no registry gets no toggles,
and the deploy says so. After a live deploy, `node tools/prod-check.js` prints `toggles on live: …` and fails when a
`deploy: 'on'` toggle is off (saying whether the file said `"off"` or left it out), when the live file names a toggle
the live registry doesn't have, or when the studio has no Connect tab or `app.remote`.

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
`infra/next/github.tf` holds the role and GitHub's identity provider; `deploy_branches` names the branches whose runs
may assume it (default `main`). The role's ARN and the distribution id (`terraform -chdir=infra/next output`) go in the
repository variables `NEXT_DEPLOY_ROLE` and `NEXT_DISTRIBUTION`.

What a tester should know: songs, keys and settings saved on the preview stay on the preview (each site keeps its own
browser storage). Connect to Claude doesn't work there: the relay accepts the live origin only.
