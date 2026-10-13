provider "aws" {
  region = "us-east-1"

  # Only ever the Overdub account: a plan run with the wrong profile stops here instead of planning a second bucket.
  allowed_account_ids = ["800849967977"]

  default_tags {
    tags = {
      project      = "overdub"
      "managed-by" = "terraform"
      repo         = "overdubstudio/overdub"
    }
  }
}
