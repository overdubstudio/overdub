# The bucket every Terraform state in the Overdub account lives in, one key per repo and environment:
#   bootstrap/terraform.tfstate          this directory's own state (it starts local; infra/README.md)
#   opensource/next/terraform.tfstate    infra/next in this repo
#   cloud/next/terraform.tfstate         the private overdub-cloud repo's infra
# Locking is S3's own (use_lockfile in each backend): no DynamoDB table.

data "aws_caller_identity" "current" {}

locals {
  state_bucket = "overdub-tfstate-${data.aws_caller_identity.current.account_id}"
}

# No access logging: that needs a second bucket to log into, and CloudTrail already records who touched state.
#trivy:ignore:AVD-AWS-0089 access logs would need a log bucket of their own; versioning keeps every state write
resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3: state holds no secret a customer-managed key would guard better, and a KMS key costs a dollar a month.
#trivy:ignore:AVD-AWS-0132 SSE-S3 (AES256) is the decision for the state bucket; a customer-managed KMS key adds cost and nothing the account boundary doesn't already give
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    blocked_encryption_types = ["SSE-C"]
  }
}

# Old state versions are the undo history; three months of it is plenty.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

data "aws_iam_policy_document" "state" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}
