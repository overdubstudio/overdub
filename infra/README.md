# Infrastructure

Terraform for the AWS that the preview site, https://next.overdubstudio.com, runs on, and for the account-wide pieces
around it. Everything is in the Overdub AWS account (800849967977, us-east-1). The live site, overdubstudio.com, is in
another account and isn't here (`deploy/setup.sh`).

| Directory | What it manages | State |
|---|---|---|
| `bootstrap/` | the state bucket, `overdub-tfstate-800849967977` | `bootstrap/terraform.tfstate` in that bucket |
| `next/` | the preview (zone, bucket, certificate, CloudFront, DNS) and the account-wide pieces: GitHub's OIDC provider, the deploy role, the monthly budget | `opensource/next/terraform.tfstate` |

The private overdub-cloud repo has its own `infra/` for the API, with its state at `cloud/next/terraform.tfstate` in the
same bucket. Its roles trust the GitHub OIDC provider this repo's `next/` owns (one per issuer per account).

## Running it

The tools are pinned in `mise.toml` (`mise install`): Terraform, tflint and trivy. Credentials are the `overdub` SSO
profile:

```sh
aws sso login --profile overdub
export AWS_PROFILE=overdub
terraform -chdir=infra/next init
terraform -chdir=infra/next plan
terraform -chdir=infra/next apply
terraform -chdir=infra/next output        # the distribution id and deploy role ARN, for the repository variables
```

`next/` needs one value that isn't committed, since this repo is public: who the budget emails. Put it in
`infra/next/private.auto.tfvars` (gitignored), or export `TF_VAR_budget_alert_emails`:

```hcl
budget_alert_emails = ["someone@example.com"]
```

Both providers refuse any account but 800849967977, so a plan run under the wrong profile stops before it plans
anything. Locking is S3's own lock file (`use_lockfile`), so two applies can't overlap; there is no DynamoDB table.

`npm run check` (`tools/check.sh`, and CI's static job) runs `terraform fmt -check`, `terraform validate` in each
directory (with `-backend=false` and a throwaway data dir, so it needs no AWS credentials), tflint (`.tflint.hcl`,
with the AWS ruleset) and `trivy config`. A trivy finding that conflicts with how the resource has to be (no WAF or
access logs on a preview, a bucket named after its site) is ignored inline with `#trivy:ignore:<id>` and the reason.

`.terraform.lock.hcl` in each directory pins the AWS provider with hashes for darwin_arm64, linux_amd64 and
linux_arm64. After changing the provider version, refresh it for all three:

```sh
terraform -chdir=infra/next providers lock -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64
```

## What Terraform manages, and what the deploy does

Terraform owns the resources: the zone and its records, the bucket and its settings and policy, the certificate,
the CloudFront function, origin access control, response headers policy and distribution, the deploy role and its
policy, the OIDC provider and the budget. It never touches the bucket's objects. `deploy/deploy.sh --next [REF]` (and
CI's deploy-staging job) still ships the committed tree with `aws s3 sync` and invalidates the distribution.

The CloudFront function's code is `deploy/path-rewrite.js` with its home changed to `next.overdubstudio.com`
(`next/cdn.tf`), so that file stays the one source for both sites. Editing it changes the next plan; the live site
still gets it through `deploy/setup.sh`.

Not managed here: the NS records in the parent overdubstudio.com zone that delegate `next.overdubstudio.com` (that zone
is in another account), and AWS's managed CachingOptimized cache policy (a data source).

## Bootstrap: the bucket that holds its own state

`bootstrap/` makes the bucket its own state lives in, so the first run had to be local:

1. With `bootstrap/backend.tf` absent: `terraform -chdir=infra/bootstrap init && terraform -chdir=infra/bootstrap apply`.
   That makes the bucket (versioned, SSE-S3, public access blocked, TLS required, bucket-owner-enforced, old versions
   expired after 90 days) with the state in a local `terraform.tfstate`.
2. Add `bootstrap/backend.tf` (the `backend "s3"` block, key `bootstrap/terraform.tfstate`) and run
   `terraform -chdir=infra/bootstrap init -migrate-state`. Terraform copies the local state into the bucket.
3. Delete the local `terraform.tfstate` and its backup, and check `terraform -chdir=infra/bootstrap plan` says
   "No changes".

That's done; from a fresh checkout `bootstrap/` is an ordinary S3-backed directory. To rebuild the account from
nothing, run the same three steps with `backend.tf` moved aside for step 1.

## The import

Everything in `next/` existed before Terraform: `deploy/next/setup.sh`, the since-deleted `deploy/next/github-oidc.sh`
and the console made it. `next/imports.tf` has an `import {}` block per resource, so the adoption is reviewable. The
HCL was written from each resource's live configuration (read-only `describe`/`get` calls), not from the scripts, and
iterated until the plan showed only the imports and tags. The first apply imported 18 resources, added and destroyed
nothing, and changed only:

- the provider's default tags (`project=overdub`, `managed-by=terraform`, `repo=overdubstudio/overdub`), added to the
  eight resources that take tags;
- two Terraform-only settings an import can't read: the zone's `force_destroy` (false) and the function's `publish`
  (true). Setting `publish` made the provider republish the function's DEVELOPMENT stage to LIVE, which was already
  byte-for-byte the same code.

The deploy role's trust policy names the subject prefix from GitHub's immutable subjects, read with
`gh api repos/overdubstudio/overdub/actions/oidc/customization/sub -q .sub_claim_prefix`: it carries the owner's and
repo's numeric ids (`repo:overdubstudio@338787741/overdub@1404804332`), so a renamed or re-created repo can't inherit
the role. It's the default of `github_sub_claim_prefix` in `next/variables.tf`, taken from the live role.
