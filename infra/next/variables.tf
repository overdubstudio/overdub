variable "domain" {
  description = "The preview site's name, and its delegated hosted zone."
  type        = string
  default     = "next.overdubstudio.com"
}

variable "github_repo" {
  description = "The repository whose Actions runs may deploy the preview (owner/name)."
  type        = string
  default     = "overdubstudio/overdub"
}

variable "github_sub_claim_prefix" {
  description = <<-EOT
    The repository's OIDC subject prefix. This repo uses GitHub's immutable subjects, which carry the owner's and the
    repo's numeric ids, so a renamed or re-created repo can't inherit the role. Read it with
    gh api repos/overdubstudio/overdub/actions/oidc/customization/sub -q .sub_claim_prefix
  EOT
  type        = string
  default     = "repo:overdubstudio@338787741/overdub@1404804332"
}

variable "deploy_branches" {
  description = "The branches whose Actions runs may assume the deploy role (ci.yml deploys main only)."
  type        = list(string)
  default     = ["main"]
}

variable "monthly_budget_usd" {
  description = "The account's monthly cost budget, in US dollars."
  type        = string
  default     = "50.0"
}

variable "budget_alert_emails" {
  description = <<-EOT
    Who the budget emails. Not committed (this repo is public): set it in infra/next/private.auto.tfvars (gitignored)
    or TF_VAR_budget_alert_emails. infra/README.md says how.
  EOT
  type        = list(string)
  sensitive   = true
}
