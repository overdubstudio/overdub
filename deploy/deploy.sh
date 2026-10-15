#!/usr/bin/env bash
# Deploy Overdub to https://overdubstudio.com: the landing page (site/), the studio (app/) and the public docs.
# Text files revalidate every time (no-cache + ETag, so a deploy is live at once); media caches for a day.
# Sampled kits (app/kits/<sha256>.odk, gitignored: node tools/fetch-kits.js builds them) go up from the working tree,
# each checked against its name, gzipped, and cached for good (a file named by its hash never changes), with its packed
# twin (<sha256>.odkz, which the studio fetches first and unpacks back to the .odk; the .odk stays as the fallback).
# Every kit the shipped code names must be here, or nothing is deployed; they go up before the code that names them.
# Both sites' AWS is Terraform's (infra/live, infra/next; infra/README.md), in the Overdub account. Usage:
#   deploy/deploy.sh [--skip-tests] [REF]           the live site, s3://overdubstudio.com, from REF (default HEAD). Only
#                                                    from GitHub Actions (.github/workflows/deploy-live.yml, approved);
#                                                    LOCAL_LIVE_DEPLOY=1 is the emergency hatch for a laptop
#   deploy/deploy.sh [--skip-tests] --next [REF]     the preview, https://next.overdubstudio.com, from REF (default
#                                                    HEAD): any committed ref; one
#                                                    older than the ribbon (app/src/ui/preview.js) ships without it
#   DRY_RUN=1 deploy/deploy.sh ...                   stage the files and print the plan; no AWS calls (anywhere)
# The live distribution: LIVE_DISTRIBUTION, else deploy/.distribution-id (terraform -chdir=infra/live output -raw
# distribution_id), else the one whose alias is overdubstudio.com.
# app/site-config.json, the deploy's switches, is never committed: this script is its one writer, for both sites. It
# starts from REF's deploy/live-config.json (committed: the live site's config), else {}; SITE_CONFIG=<file> reads
# another instead (a developer's local override; the old gitignored deploy/site-config.json is read only that way). On
# --next, REF's deploy/next-config.json (committed: what only the preview names, today the staging cloud API) goes over
# that base, one top-level key at a time (an overlay key replaces the base's whole entry; NEXT_CONFIG=<file> reads
# another overlay instead), and then "env": "preview", "preview": true and the commit, so the studio wears the Preview
# ribbon (app/src/ui/preview.js); every other key is kept as it is. A live deploy never reads next-config.json. With no
# "preview" key a studio is the live site. There are no feature toggles: what is
# merged to main ships on the next live deploy, and unfinished work waits on its branch.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=live TESTS=1
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) TESTS= ;;
    --next) TARGET=next; if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then REF=$2; shift; fi ;;
    --*|"") echo "deploy.sh: unknown argument $1 (usage: deploy/deploy.sh [--skip-tests] [--next] [REF])"; exit 2 ;;
    *) if [ -n "${REF:-}" ]; then echo "deploy.sh: one REF only ($REF, then $1)"; exit 2; fi; REF=$1 ;;
  esac
  shift
done
DRY=${DRY_RUN:-}
if [ "$TARGET" = next ]; then
  BUCKET=next.overdubstudio.com HOST=next.overdubstudio.com IDFILE="$ROOT/deploy/.next-distribution-id" SETUP="terraform in infra/next (infra/README.md)"
else
  BUCKET=overdubstudio.com HOST=overdubstudio.com IDFILE="$ROOT/deploy/.distribution-id" SETUP="terraform in infra/live (infra/README.md)"
  # the live site ships from the approved workflow; a laptop needs the hatch (and the Overdub account's credentials)
  if [ -z "$DRY" ] && [ "${GITHUB_ACTIONS:-}" != true ] && [ "${LOCAL_LIVE_DEPLOY:-}" != 1 ]; then
    echo "not deploying: the live site deploys from GitHub Actions (Actions > deploy-live > Run workflow, then approve)."
    echo "LOCAL_LIVE_DEPLOY=1 deploy/deploy.sh ... is the emergency hatch (AWS_PROFILE=overdub); DRY_RUN=1 prints the plan."
    exit 1
  fi
fi
if [ -n "$DRY" ]; then DIST=EDRYRUN
elif [ "$TARGET" = live ] && [ -n "${LIVE_DISTRIBUTION:-}" ]; then DIST=$LIVE_DISTRIBUTION
elif [ -f "$IDFILE" ]; then DIST=$(cat "$IDFILE")
else
  DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$HOST')].Id | [0]" --output text)
  [ "$DIST" != "None" ] && [ -n "$DIST" ] || { echo "no CloudFront distribution for $HOST: run $SETUP"; exit 1; }
fi
# a change: run it, or in a dry run print it
x() { if [ -z "$DRY" ]; then "$@"; else echo "+ $*"; fi; }
cd "$ROOT"

if [ -n "$TESTS" ]; then
  node tools/core-test.js | tail -1
fi

# Ship exactly what is committed (REF, default HEAD), never a half-edited working tree.
REF=${REF:-HEAD}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
DOCS=""
for f in AGENTS ARCHITECTURE DEVICES UX-RESEARCH VISION BRAND REMOTE-MCP GUIDE BENCH; do
  git cat-file -e "$REF:docs/$f.md" 2>/dev/null && DOCS="$DOCS docs/$f.md"
done
git archive "$REF" site app $DOCS | tar -x -C "$STAGE"
SHORT=$(git rev-parse --short "$REF^{commit}")
# The deploy's switches (app/src/ui/preview.js reads env, preview and ref; other modules may read other keys): REF's
# deploy/live-config.json (git show, like the files), else {}; SITE_CONFIG=<file> reads that file instead. The
# preview's copy takes REF's deploy/next-config.json over it (NEXT_CONFIG=<file> reads that file instead; none, or an
# unreadable file, is {}), shallow: each top-level key of the overlay replaces the base's, so the overlay must restate a
# whole entry (all of "stems", say) to change one field of it. Then it adds its three keys and keeps the rest.
if [ -n "${SITE_CONFIG:-}" ]; then
  if [ -f "$SITE_CONFIG" ]; then cp "$SITE_CONFIG" "$STAGE/app/site-config.json"; else echo '{}' > "$STAGE/app/site-config.json"; fi
  BASE_NAME=${SITE_CONFIG#"$ROOT"/}; [ -f "$SITE_CONFIG" ] || BASE_NAME="the site config ({})"
elif git show "$REF:deploy/live-config.json" > "$STAGE/app/site-config.json" 2>/dev/null; then
  BASE_NAME="$REF:deploy/live-config.json"
else
  echo '{}' > "$STAGE/app/site-config.json"; BASE_NAME="the site config ({}: $REF has no deploy/live-config.json)"
fi
OVERLAY_SAID=
if [ "$TARGET" = next ]; then
  OVERLAY='{}' OVERLAY_NAME=
  if [ -n "${NEXT_CONFIG:-}" ]; then
    if [ -f "$NEXT_CONFIG" ]; then OVERLAY=$(cat "$NEXT_CONFIG"); OVERLAY_NAME=${NEXT_CONFIG#"$ROOT"/}; fi
  elif OVERLAY=$(git show "$REF:deploy/next-config.json" 2>/dev/null); then
    OVERLAY_NAME="$REF:deploy/next-config.json"
  else
    OVERLAY='{}'
  fi
  if ! OVERLAY_SAID=$(node -e 'const fs = require("fs"), [file, ref, text, label] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error(file + " is not a JSON object");
    let o;
    try { o = JSON.parse(text); } catch (e) { console.log(`not deploying: ${label} is not JSON (${e.message})`); process.exit(1); }
    if (!o || typeof o !== "object" || Array.isArray(o)) { console.log(`not deploying: ${label} is not a JSON object`); process.exit(1); }
    fs.writeFileSync(file, JSON.stringify({ ...c, ...o, env: "preview", preview: true, ref }, null, 2) + "\n");
    if (label && Object.keys(o).length) console.log(`site config: ${label} over the base (${Object.keys(o).join(", ")})`);' \
    "$STAGE/app/site-config.json" "$SHORT" "$OVERLAY" "$OVERLAY_NAME"); then
    echo "$OVERLAY_SAID"; exit 1
  fi
fi
# The config must be a JSON object. A "toggles" key (the feature toggles, retired 2026-10-14: merged means shipped) is
# dropped from the copy that ships, with a line, so an old deploy/site-config.json can't leave one on the site.
if ! CONFIG_SAID=$(node -e 'const fs = require("fs"), [file, label] = process.argv.slice(1);
    let c;
    try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`not deploying: ${label} is not JSON (${e.message})`); process.exit(1); }
    if (!c || typeof c !== "object" || Array.isArray(c)) { console.log(`not deploying: ${label} is not a JSON object`); process.exit(1); }
    if (Object.hasOwn(c, "toggles")) {
      delete c.toggles;
      fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
      console.log(`site config: dropped ${label}'"'"'s "toggles" (retired: merged means shipped)`);
    }' "$STAGE/app/site-config.json" "$BASE_NAME"); then
  echo "$CONFIG_SAID"; exit 1
fi
# The stems runner's runtime (and its model, when the base names modelFrom), staged on this site: the studio's CSP runs
# scripts and fetches only from its own origin (deploy/stage-stems.js says how they're pinned). Fetched once into
# deploy/.cache/ (gitignored), checked against their SHA-256, never committed. Then the shipped stems entry is checked
# the way the studio will (site-config.js stemsConfig, the runner's same-origin rule): one that would be off for being
# on another site stops a live deploy, and is a warning on --next.
# (on --next what can't be staged is a warning, and the preview ships with stems off: --warn)
STEMS_WARN=; [ "$TARGET" = next ] && STEMS_WARN=--warn
if ! STEMS_SAID=$(node "$ROOT/deploy/stage-stems.js" "$STAGE/app/site-config.json" "$STAGE" "$ROOT/deploy/.cache" ${STEMS_WARN:+"$STEMS_WARN"}); then
  echo "$STEMS_SAID"; exit 1
fi
if [ -f "$STAGE/app/src/jobs/stems/runner.js" ] && ! STEMS_CHECK=$(node --input-type=module -e 'import fs from "node:fs"; import { pathToFileURL } from "node:url";
    const [file, app, host, target] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!c.stems) process.exit(0);
    const { stemsConfig } = await import(pathToFileURL(app + "/src/site-config.js").href);
    const { elsewhere } = await import(pathToFileURL(app + "/src/jobs/stems/runner.js").href);
    const cfg = stemsConfig(c.stems, `https://${host}/app/site-config.json`);
    // a same-origin path this deploy does not ship would 404 (the bucket sync deletes what is not staged)
    const missing = (u) => { const p = new URL(u).pathname; return p.startsWith("/app/") && !fs.existsSync(app + p.slice(4)); };
    const why = !cfg ? "the stems entry is not one the studio accepts (a model, a SHA-256, https: URLs)"
      : elsewhere(cfg, `https://${host}`)
      || (missing(cfg.runtime) ? `stems.runtime ${cfg.runtime} is not in this deploy (stems.runtimeFrom and runtimeSha256 stage it)` : null)
      || (missing(cfg.model) ? `stems.model ${cfg.model} is not in this deploy (stems.modelFrom stages it)` : null);
    if (!why) { console.log(`stems: runtime ${cfg.runtime}, model ${cfg.model}`); process.exit(0); }
    console.log(target === "live" ? `not deploying: ${why}` : `warning: ${why} (a live deploy would stop)`);
    process.exit(target === "live" ? 1 : 0);' "$STAGE/app/site-config.json" "$STAGE/app" "$HOST" "$TARGET"); then
  echo "$STEMS_CHECK"; exit 1
fi
# Paths committed but held back from both sites until AJ decides (empty now: the community gallery, site/community/,
# ships since 2026-10-06; docs/COMMUNITY-SHELF.md, "Where it's on"). The sync below runs with --delete, so taking a
# path off this list is what puts it live.
HELD_BACK=()
for p in ${HELD_BACK[@]+"${HELD_BACK[@]}"}; do rm -rf "${STAGE:?}/$p"; done

# The community shelf, app/community/ (gitignored): pulled from overdub-devices at the commit REF's
# deploy/community-pin.json names, by tools/community-pull.js, which checks it by hash and refuses a wrong one (then
# nothing is deployed). Every deploy ships it; a REF with no pin ships no shelf. The studio reads this copy on every
# load and applies its deny list (revoked), so a device taken off the shelf goes out with the next deploy. No checkout
# with the pinned commit stops a live deploy; --next goes on without the shelf and says so (CI's preview deploy has no
# overdub-devices). A refused pull stops either. The checkout: OVERDUB_DEVICES_DIR, else ../overdub-devices. A dry run may
# read another pin from COMMUNITY_PIN (tools/community-test.js); a real deploy reads REF's only.
if [ -n "${COMMUNITY_PIN:-}" ] && [ -z "$DRY" ]; then echo "COMMUNITY_PIN is for dry runs: a deploy reads the pin at $REF"; exit 2; fi
PIN=$(mktemp)
trap 'rm -rf "$STAGE" "$PIN"' EXIT
if [ -n "${COMMUNITY_PIN:-}" ]; then cp "$COMMUNITY_PIN" "$PIN"; else git show "$REF:deploy/community-pin.json" > "$PIN" 2>/dev/null || : > "$PIN"; fi
if [ ! -s "$PIN" ]; then
  echo "app/community: none ($REF has no deploy/community-pin.json)"
else
  DEVICES_DIR=${OVERDUB_DEVICES_DIR:-$ROOT/../overdub-devices}
  set +e
  node "$ROOT/tools/community-pull.js" --pin-file "$PIN" --from "$DEVICES_DIR" --out "$STAGE/app/community"
  PULLED=$?
  set -e
  if [ "$PULLED" = 3 ] && [ "$TARGET" = live ]; then
    echo "not deploying: no checkout with the pinned shelf's commit at $DEVICES_DIR (OVERDUB_DEVICES_DIR names another)"; exit 1
  elif [ "$PULLED" = 3 ]; then
    rm -rf "${STAGE:?}/app/community"
    echo "app/community: none on this preview: no checkout with the pinned commit at $DEVICES_DIR"
  elif [ "$PULLED" != 0 ]; then
    echo "not deploying: tools/community-pull.js didn't pull the pinned shelf (exit $PULLED)"; exit 1
  else
    echo "app/community: $(find "$STAGE/app/community" -type f | wc -l | tr -d ' ') files, as pinned"
  fi
  # a dry run lists each with the type and caching its upload rule below gives it
  if [ -n "$DRY" ] && [ -d "$STAGE/app/community" ]; then

    (cd "$STAGE" && find app/community -type f | sort) | while read -r f; do
      case "$f" in
        *.json) echo "  $f  application/json; charset=utf-8  no-cache" ;;
        *.mp3) echo "  $f  audio/mpeg  no-cache" ;;
        *) echo "  $f  (the catch-all sync)" ;;
      esac
    done
  fi
fi
echo "$TARGET: $SHORT ($REF): $(find "$STAGE" -type f | wc -l | tr -d ' ') files -> s3://$BUCKET, distribution $DIST"
echo "app/site-config.json: $(tr -d '\n ' < "$STAGE/app/site-config.json")"
if [ -n "$OVERLAY_SAID" ]; then echo "$OVERLAY_SAID"; fi
if [ -n "$CONFIG_SAID" ]; then echo "$CONFIG_SAID"; fi
echo "$STEMS_SAID"
if [ -n "${STEMS_CHECK:-}" ]; then echo "$STEMS_CHECK"; fi

# the sampled kits the shipped devices name (data: { kit: 'sha256-<hex>' }): each must be here and be its own hash
# (a dry run names a missing kit and plans without it, so the plan can be read on a checkout that hasn't built them)
KITS=$( (grep -rhoE "sha256-[0-9a-f]{64}" "$STAGE/app/src/devices" || true) | sort -u | cut -c8-)
HAVE=""
for name in $KITS; do
  f="app/kits/$name.odk"
  if [ ! -e "$f" ] && [ -n "$DRY" ]; then echo "dry run: $f isn't here, so a real deploy would stop (node tools/fetch-kits.js builds it)"; continue; fi
  if [ ! -e "$f" ]; then echo "not deploying: $f isn't here (node tools/fetch-kits.js builds it)"; exit 1; fi
  sum=$(shasum -a 256 "$f" | cut -d' ' -f1)
  if [ "$sum" != "$name" ]; then echo "not deploying: $f's SHA-256 is $sum"; exit 1; fi
  # the packed twin must unpack to exactly that file
  if ! node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto";
    import { unpackOdk } from "'"$ROOT"'/app/src/kernel/odkz.js";
    const [f, want] = process.argv.slice(1);
    const got = crypto.createHash("sha256").update(unpackOdk(fs.readFileSync(f))).digest("hex");
    if (got !== want) { console.error(f + " unpacks to " + got); process.exit(1); }' "${f}z" "$name"; then
    echo "not deploying: ${f}z is missing or doesn't unpack to $f (node tools/fetch-kits.js writes it)"; exit 1
  fi
  HAVE="$HAVE $name"
done

# the kits first, so no page names one that isn't up yet (uploaded once each: a file named by its hash never changes)
KITTMP=$(mktemp -d)
trap 'rm -rf "$STAGE" "$PIN" "$KITTMP"' EXIT
for name in $HAVE; do
  for ext in odkz odk; do
    if [ -z "$DRY" ] && aws s3api head-object --bucket "$BUCKET" --key "app/kits/$name.$ext" >/dev/null 2>&1; then echo "kit $name.$ext: already up"; continue; fi
    gzip -9 -n -c "app/kits/$name.$ext" > "$KITTMP/$name.$ext"
    x aws s3 cp "$KITTMP/$name.$ext" "s3://$BUCKET/app/kits/$name.$ext" --only-show-errors \
      --content-type 'application/octet-stream' --content-encoding gzip --cache-control 'public, max-age=31536000, immutable'
    echo "uploaded kit $name.$ext ($(du -h "$KITTMP/$name.$ext" | cut -f1) gzipped)"
  done
done

up() { x aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --exclude '*' "$@"; }
TEXT='no-cache'
MEDIA='public, max-age=86400'
up --include '*.html' --content-type 'text/html; charset=utf-8' --cache-control "$TEXT"
up --include '*.js' --content-type 'text/javascript; charset=utf-8' --cache-control "$TEXT"
up --include '*.css' --content-type 'text/css; charset=utf-8' --cache-control "$TEXT"
up --include '*.json' --content-type 'application/json; charset=utf-8' --cache-control "$TEXT"
up --include '*.md' --content-type 'text/markdown; charset=utf-8' --cache-control "$TEXT"
up --include '*.txt' --content-type 'text/plain; charset=utf-8' --cache-control "$TEXT"
up --include '*.svg' --content-type 'image/svg+xml' --cache-control "$TEXT"
up --include '*.webp' --content-type 'image/webp' --cache-control "$MEDIA"
up --include '*.png' --content-type 'image/png' --cache-control "$MEDIA"
up --include '*.jpg' --content-type 'image/jpeg' --cache-control "$MEDIA"
up --include '*.gif' --content-type 'image/gif' --cache-control "$MEDIA"
up --include '*.mp4' --content-type 'video/mp4' --cache-control "$MEDIA"
up --include '*.woff2' --content-type 'font/woff2' --cache-control "$MEDIA"
up --include '*.wav' --content-type 'audio/wav' --cache-control "$MEDIA"
# the shelf's clips revalidate like its index and device files (*.json, above), so a rebuild or a takedown is live at the
# next load
up --include 'app/community/*.mp3' --content-type 'audio/mpeg' --cache-control "$TEXT"
# the stems runtime and model, when staged (a module script must be served as JavaScript, WebAssembly as application/wasm)
up --include 'app/vendor/ort/*.mjs' --content-type 'text/javascript; charset=utf-8' --cache-control "$MEDIA"
up --include 'app/vendor/ort/*.wasm' --content-type 'application/wasm' --cache-control "$MEDIA"
up --include 'app/vendor/models/*.onnx' --content-type 'application/octet-stream' --cache-control 'public, max-age=31536000, immutable'
# anything else, and remove what's gone (never the kits: they aren't in git, so they aren't in the stage)
x aws s3 sync "$STAGE" "s3://$BUCKET" --only-show-errors --delete --exclude 'app/kits/*'

if [ -n "$DRY" ]; then
  x aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*'
  echo "dry run: nothing sent"
else
  ID=$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query Invalidation.Id --output text)
  echo "deployed $(find "$STAGE" -type f | wc -l | tr -d ' ') files to s3://$BUCKET; invalidation $ID"
fi
echo "https://$HOST/  ·  https://$HOST/app/"
