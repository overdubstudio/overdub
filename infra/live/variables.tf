variable "domain" {
  description = "The live site's name, and its hosted zone."
  type        = string
  default     = "overdubstudio.com"
}

variable "relay_domain" {
  description = <<-EOT
    The hosted MCP relay behind Connect to Claude (server/relay.js; RELAY in app/src/agent/remote.js). Not
    relay.overdubstudio.com: that name is the account relay's (ACCOUNT_RELAY, overdub-cloud).
  EOT
  type        = string
  default     = "mcp.overdubstudio.com"
}

variable "serve_names" {
  description = <<-EOT
    The cutover switch. false: the distribution has no aliases and CloudFront's default certificate, serves its own
    cloudfront.net name (path-rewrite.js, CLOUDFRONT_NAME), and the apex and www records still point at the old
    distribution in AJ's personal account. true: it takes overdubstudio.com and www with the certificate, and the records
    point at it. Turn it on only after the old distribution has let go of both names (the runbook's cutover).
  EOT
  type        = bool
  default     = false
}

variable "old_distribution_domain" {
  description = "The old live distribution (AJ's personal account), where the apex and www records point until serve_names."
  type        = string
  default     = "d1guk2yqr2krqh.cloudfront.net"
}

variable "access_logs" {
  description = "CloudFront standard logging into the logs bucket, for the counts (tools/stats.sh, deploy/analytics/setup.sh)."
  type        = bool
  default     = true
}

variable "github_repo" {
  description = "The repository whose Actions runs may deploy the live site (owner/name)."
  type        = string
  default     = "overdubstudio/overdub"
}

variable "github_sub_claim_prefix" {
  description = <<-EOT
    The repository's OIDC subject prefix (GitHub's immutable subjects, with the owner's and the repo's numeric ids), as
    infra/next. Read it with gh api repos/overdubstudio/overdub/actions/oidc/customization/sub -q .sub_claim_prefix
  EOT
  type        = string
  default     = "repo:overdubstudio@338787741/overdub@1404804332"
}

variable "deploy_environment" {
  description = <<-EOT
    The GitHub environment whose jobs may assume the live deploy role (.github/workflows/deploy-live.yml). It has
    required reviewers and deploys from main only, so the role is only ever used by an approved run.
  EOT
  type        = string
  default     = "production"
}

variable "relay_instance_type" {
  description = "The relay's instance (Graviton): one Node process, about 60 MB resident."
  type        = string
  default     = "t4g.nano"
}
