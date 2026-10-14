#!/usr/bin/env bash
# One-time setup for Overdub's counts (app/src/analytics.js, site/assets/analytics.js): the Athena database, table and
# view that tools/stats.sh reads, over CloudFront's access logs. Safe to re-run (IF NOT EXISTS / OR REPLACE).
#
# The logs themselves are Terraform's (infra/live): the private bucket overdub-logs-<account>, which forgets after 90
# days, and standard logging on the live distribution into it (var.access_logs). Run terraform first; this script only
# makes the Athena side, which isn't a Terraform resource here.
#
#   AWS_PROFILE=overdub deploy/analytics/setup.sh    (region us-east-1)
#   DRY_RUN=1 deploy/analytics/setup.sh              prints the statements, calls nothing
#
# Costs: Athena at $5/TB scanned (each stats.sh run scans the logs once per query, a few MB). No servers. CloudFront logs
# every request, as any web server would, including the client address and user agent; the lifecycle rule deletes them
# after 90 days, and the Athena view used by stats.sh never selects them. It refuses AJ's personal account (165604225334).
set -euo pipefail
export AWS_DEFAULT_REGION=us-east-1 AWS_REGION=us-east-1 AWS_PAGER=""
HERE=$(cd "$(dirname "$0")" && pwd)
PERSONAL=165604225334
DRY=${DRY_RUN:-}
[ -n "$DRY" ] && echo "dry run: no AWS calls; these are the statements a first run sends"
ACCOUNT=$( [ -n "$DRY" ] && echo 000000000000 || aws sts get-caller-identity --query Account --output text)
[ "$ACCOUNT" != "$PERSONAL" ] || { echo "refusing: these credentials are AJ's personal account ($PERSONAL). The logs live in the Overdub account: AWS_PROFILE=overdub"; exit 1; }
BUCKET="overdub-logs-$ACCOUNT"
LOGS="s3://$BUCKET"
if [ -z "$DRY" ] && ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "no $BUCKET: terraform apply in infra/live first (infra/README.md)"; exit 1
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---- Athena: the database, the table over the logs and the events view (deploy/analytics/athena.sql)
run() {
  if [ -n "$DRY" ]; then echo "+ aws athena start-query-execution --work-group primary --query-string \"${1:0:100}…\""; return 0; fi
  local id st
  id=$(aws athena start-query-execution --query-string "$1" --work-group primary \
    --result-configuration "OutputLocation=$LOGS/athena-results/" --query QueryExecutionId --output text)
  while :; do
    st=$(aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.State --output text)
    case "$st" in
      SUCCEEDED) return 0 ;;
      FAILED|CANCELLED) aws athena get-query-execution --query-execution-id "$id" --query QueryExecution.Status.StateChangeReason --output text >&2; return 1 ;;
    esac
    sleep 1
  done
}
python3 - "$HERE/athena.sql" "$LOGS" > "$TMP/statements" <<'PY'
import sys
sql = open(sys.argv[1]).read().replace("__LOGS__", sys.argv[2])
body = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))
for s in body.split(";"):
    s = " ".join(s.split())
    if s: print(s)
PY
while IFS= read -r stmt <&3; do
  run "$stmt"
  echo "athena: ${stmt:0:60}…"
done 3< "$TMP/statements"

echo "done. Read the counts with tools/stats.sh [days]"
