# This directory makes the bucket its own state lives in, so it began with local state: apply once with this file
# absent, then add it and run terraform init -migrate-state (infra/README.md, "Bootstrap").
terraform {
  backend "s3" {
    bucket       = "overdub-tfstate-800849967977"
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
