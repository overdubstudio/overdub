#!/usr/bin/env bash
# The response headers policy CloudFront adds to every response, made or brought up to date, and set on the
# distribution. Safe to re-run: it changes only what differs, and says so.
#
#   deploy/headers.sh                  the live site: policy overdub-headers on the overdubstudio.com distribution
#   deploy/headers.sh --next           the preview: policy overdub-next-headers (the same, plus noindex) on next.*
#   deploy/headers.sh --policy-only    make or update the policy and print only its id; touch no distribution
#                                      (setup.sh and next/setup.sh use this before they create a distribution)
#   DRY_RUN=1 deploy/headers.sh [...]  prints the plan and the policy, calls nothing
#
# The distribution is DIST=<id>, else deploy/.distribution-id (.next-distribution-id), else the one whose alias is the
# site's name. Needs AWS credentials (us-east-1); the plan and what changed go to stderr.
#
# The values are the managed SecurityHeadersPolicy's (67f7725c-6f97-4210-82d7-5512b31e9d03, which this replaces), with
# two changes: X-Frame-Options is DENY, not SAMEORIGIN, and Content-Security-Policy: frame-ancestors 'none' is added,
# both with override on, so no other page can frame the studio, its trust prompt or the gallery (Q-C: every path). A
# header CSP holding only frame-ancestors adds to the pages' <meta> CSPs; it doesn't replace or loosen them.
# To confirm the managed values have not moved:
#   aws cloudfront get-response-headers-policy --id 67f7725c-6f97-4210-82d7-5512b31e9d03
# server/serve.js sends the same frame headers and nosniff locally (FRAME_HEADERS).
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_PAGER=""
HERE=$(cd "$(dirname "$0")" && pwd)
MANAGED=67f7725c-6f97-4210-82d7-5512b31e9d03   # managed SecurityHeadersPolicy (an AWS constant, the same in every account)
NEXT="" ONLY=""
for a in "$@"; do
  case "$a" in
    --next) NEXT=1 ;;
    --policy-only) ONLY=1 ;;
    *) echo "usage: deploy/headers.sh [--next] [--policy-only]   (DRY_RUN=1 to print the plan)" >&2; exit 2 ;;
  esac
done
if [ -n "$NEXT" ]; then
  NAME=overdub-next-headers HOST=next.overdubstudio.com IDFILE="$HERE/.next-distribution-id"
  COMMENT="next.overdubstudio.com: security headers, no framing, noindex"
  CUSTOM='{ "Quantity": 1, "Items": [{ "Header": "X-Robots-Tag", "Value": "noindex, nofollow", "Override": true }] }'
else
  NAME=overdub-headers HOST=overdubstudio.com IDFILE="$HERE/.distribution-id"
  COMMENT="overdubstudio.com: security headers, no framing"
  CUSTOM='{ "Quantity": 0, "Items": [] }'
fi
DRY=${DRY_RUN:-}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say() { printf '\033[1m%s\033[0m %s\n' "$1" "${*:2}" >&2; }
# a change: run it (its output to stderr), or in a dry run print it with any file:// argument's contents
x() {
  if [ -z "$DRY" ]; then "$@" >&2; return; fi
  echo "+ $*" >&2
  for a in "$@"; do case "$a" in file://*|fileb://*) sed 's/^/    /' "${a#*://}" >&2;; esac; done
}
if [ -n "$DRY" ] && [ -z "$ONLY" ]; then say dry-run "no AWS calls: this is what a first run would do"; fi

cat > "$TMP/headers.json" <<JSON
{ "Name": "$NAME", "Comment": "$COMMENT",
  "SecurityHeadersConfig": {
    "XSSProtection": { "Override": false, "Protection": true, "ModeBlock": true },
    "FrameOptions": { "Override": true, "FrameOption": "DENY" },
    "ReferrerPolicy": { "Override": false, "ReferrerPolicy": "strict-origin-when-cross-origin" },
    "ContentSecurityPolicy": { "Override": true, "ContentSecurityPolicy": "frame-ancestors 'none'" },
    "ContentTypeOptions": { "Override": true },
    "StrictTransportSecurity": { "Override": false, "IncludeSubdomains": false, "Preload": false, "AccessControlMaxAgeSec": 31536000 } },
  "CustomHeadersConfig": $CUSTOM }
JSON

# ---- the policy: found by name, made if missing, updated (If-Match) only when it differs
if [ -n "$DRY" ]; then RHP=None
else RHP=$(aws cloudfront list-response-headers-policies --type custom --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$NAME'].ResponseHeadersPolicy.Id | [0]" --output text)
fi
if [ "$RHP" = "None" ] || [ -z "$RHP" ]; then
  if [ -n "$DRY" ]; then x aws cloudfront create-response-headers-policy --response-headers-policy-config "file://$TMP/headers.json"; RHP=RHPDRYRUN
  else RHP=$(aws cloudfront create-response-headers-policy --response-headers-policy-config "file://$TMP/headers.json" --query ResponseHeadersPolicy.Id --output text)
  fi
  say headers "created $NAME ($RHP)"
else
  aws cloudfront get-response-headers-policy-config --id "$RHP" > "$TMP/current.json"
  # same: every value this script sets is already there (AWS may answer with fields it fills in itself)
  if node -e '
    const fs = require("fs"), [cur, want] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    const same = (w, g) => Array.isArray(w) ? (w.length === 0 ? g == null || (Array.isArray(g) && !g.length) : Array.isArray(g) && w.length === g.length && w.every((v, i) => same(v, g[i])))
      : w && typeof w === "object" ? !!g && typeof g === "object" && Object.keys(w).every((k) => same(w[k], g[k])) : w === g;
    process.exit(same(want, cur.ResponseHeadersPolicyConfig) ? 0 : 1);' "$TMP/current.json" "$TMP/headers.json"; then
    say headers "$NAME ($RHP) is up to date"
  else
    RETAG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).ETag)' "$TMP/current.json")
    aws cloudfront update-response-headers-policy --id "$RHP" --if-match "$RETAG" --response-headers-policy-config "file://$TMP/headers.json" >/dev/null
    say headers "updated $NAME ($RHP)"
  fi
fi
if [ -n "$ONLY" ]; then echo "$RHP"; exit 0; fi

# ---- the distribution: its default behaviour (and any behaviour still on the managed policy) uses this one
if [ -n "${DIST:-}" ]; then :
elif [ -n "$DRY" ]; then DIST=EDRYRUN
elif [ -f "$IDFILE" ]; then DIST=$(cat "$IDFILE")
else
  DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$HOST')].Id | [0]" --output text)
  if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then echo "no CloudFront distribution for $HOST: run deploy/${NEXT:+next/}setup.sh" >&2; exit 1; fi
fi
if [ -n "$DRY" ]; then
  echo "+ aws cloudfront get-distribution-config --id $DIST" >&2
  echo "+ aws cloudfront update-distribution --id $DIST --if-match <its ETag> --distribution-config <the same, with DefaultCacheBehavior.ResponseHeadersPolicyId $RHP and any behaviour on $MANAGED moved to it> (only if one differs)" >&2
  say distribution "$DIST: headers $RHP"
  exit 0
fi
aws cloudfront get-distribution-config --id "$DIST" > "$TMP/dist.json"
# writes the new config and its ETag when something differs, nothing when all is set; names what it moved on stderr
node -e '
  const fs = require("fs"), [file, rhp, managed, out, etag] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(file, "utf8")), cfg = d.DistributionConfig, moved = [];
  const set = (b, name) => { if (b.ResponseHeadersPolicyId !== rhp) { moved.push(`${name}: ${b.ResponseHeadersPolicyId || "none"} -> ${rhp}`); b.ResponseHeadersPolicyId = rhp; } };
  set(cfg.DefaultCacheBehavior, "default");
  for (const b of (cfg.CacheBehaviors && cfg.CacheBehaviors.Items) || []) if (b.ResponseHeadersPolicyId === managed) set(b, b.PathPattern);
  if (moved.length) { fs.writeFileSync(out, JSON.stringify(cfg)); fs.writeFileSync(etag, d.ETag); console.error(moved.join("\n")); }' \
  "$TMP/dist.json" "$RHP" "$MANAGED" "$TMP/config.json" "$TMP/etag"
if [ -f "$TMP/config.json" ]; then
  aws cloudfront update-distribution --id "$DIST" --if-match "$(cat "$TMP/etag")" --distribution-config "file://$TMP/config.json" >/dev/null
  say distribution "$DIST now sends $NAME ($RHP); CloudFront takes a few minutes to roll it out"
else
  say distribution "$DIST already sends $NAME ($RHP)"
fi
