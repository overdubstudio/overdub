provider "aws" {
  region = "us-east-1" # CloudFront's certificate, functions and policies are us-east-1 only, and so is everything here

  # Only ever the Overdub account: a plan run with the wrong profile stops here.
  allowed_account_ids = ["800849967977"]

  default_tags {
    tags = {
      project      = "overdub"
      "managed-by" = "terraform"
      repo         = "overdubstudio/overdub"
    }
  }
}
