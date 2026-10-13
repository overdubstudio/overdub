# The account's state bucket (infra/bootstrap), one key per repo and environment. Locking is S3's own lock file.
terraform {
  backend "s3" {
    bucket       = "overdub-tfstate-800849967977"
    key          = "opensource/next/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
