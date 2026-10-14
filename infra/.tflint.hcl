# tflint for infra/ (tools/check.sh runs it: tflint --init, then tflint --recursive from here).
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "all"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# These are root configurations split by concern (dns.tf, cdn.tf, ...), not reusable modules: no main.tf or empty
# variables.tf just to satisfy the module layout.
rule "terraform_standard_module_structure" {
  enabled = false
}
