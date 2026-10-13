#!/usr/bin/env bash
# Every static check CI runs (.github/workflows/ci.yml, the static job), in one go: npm run check.
# The tools come from mise.toml (mise install); none of them is a dependency of the studio.
#
#   biome ci        lint (biome.jsonc) and the format check: npm run format writes it
#   tsc             types, for the files that opt in with // @ts-check (jsconfig.json)
#   ShellCheck      the deploy scripts
#   actionlint      the workflows; zizmor audits them for the usual Actions security slips
#   terraform       infra/: fmt, and validate in each root (no AWS credentials: the backend is skipped and the
#                   providers go to a throwaway directory, checked against .terraform.lock.hcl)
#   tflint          infra/ (.tflint.hcl; --init fetches the AWS ruleset from GitHub: set GITHUB_TOKEN to dodge the
#                   rate limit); trivy's config scan of infra/, where each deliberate exception is an inline
#                   #trivy:ignore with its reason
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
run() { echo "== $*"; "$@" || fail=1; }

run biome ci --reporter="${BIOME_REPORTER:-default}" .
run tsc -p jsconfig.json
run sh -c "git ls-files -z '*.sh' | xargs -0 shellcheck -S warning"
run actionlint
run zizmor --offline --min-severity=low .github

# Terraform: every directory under infra/ with a versions.tf is a root of its own
tf_validate() {
  tmp=$(mktemp -d) && mkdir "$tmp/plugins" || return 1
  ok=0
  for dir in infra/*/; do
    [ -f "$dir/versions.tf" ] || continue
    root=${dir%/}
    echo "-- $root"
    TF_DATA_DIR="$tmp/$(basename "$root")" TF_PLUGIN_CACHE_DIR="$tmp/plugins" \
      terraform -chdir="$root" init -backend=false -input=false -lockfile=readonly >/dev/null &&
      TF_DATA_DIR="$tmp/$(basename "$root")" terraform -chdir="$root" validate -no-color || ok=1
  done
  rm -rf "$tmp"
  return "$ok"
}
run terraform fmt -check -recursive infra
run tf_validate
run sh -c 'cd infra && tflint --init --config "$PWD/.tflint.hcl" >/dev/null && tflint --recursive --config "$PWD/.tflint.hcl"'
run trivy config --quiet --skip-version-check --exit-code 1 infra

if [ "$fail" = 0 ]; then echo "static checks: ok"; else echo "static checks: FAIL"; fi
exit "$fail"
