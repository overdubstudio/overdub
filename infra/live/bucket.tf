# Three private buckets: the site's files (deploy/deploy.sh fills it; Terraform never touches its objects), the stems
# model the deploy stages beside the studio (deploy/live-config.json, modelFrom s3://...), and CloudFront's access logs
# for the counts.

locals {
  account_id = "800849967977"
  buckets = {
    site   = var.domain
    models = "overdub-models-${local.account_id}"
    logs   = "overdub-logs-${local.account_id}"
  }
}

# Not versioned, logged or KMS-encrypted, as infra/next's: the site's objects are a copy of a commit (a redeploy
# restores them), the model is pinned by its SHA-256 and kept in deploy/.cache too, and the logs expire.
#trivy:ignore:AVD-AWS-0090 no versioning: each bucket's contents can be put back (a deploy, the pinned model) or expire
#trivy:ignore:AVD-AWS-0089 no access logging of these buckets: CloudFront is the site's only reader, the deploy the model's
#trivy:ignore:AVD-AWS-0320 the site's bucket has dots because it is the site's name, as infra/next's
resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value

  lifecycle {
    prevent_destroy = true
  }
}

# The logs bucket keeps ACLs: CloudFront's standard logging writes with an ACL grant (it adds its own when logging is
# switched on). The others are bucket-owner-enforced.
resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id

  rule {
    object_ownership = each.key == "logs" ? "BucketOwnerPreferred" : "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

#trivy:ignore:AVD-AWS-0132 SSE-S3 is enough: the site is public through CloudFront, the model is a public download, the logs expire
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled       = false
    blocked_encryption_types = ["SSE-C"]
  }
}

# Plain JSON, not a data source (infra/next/bucket.tf says why). Only the live distribution reads the site.
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.this["site"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.this["site"].arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.live.arn } }
    }]
  })
}

# The logs forget after 90 days (the counts never need the client addresses longer); Athena's results after 7.
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.this["logs"].id

  rule {
    id     = "forget-after-90-days"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "athena-results-7-days"
    status = "Enabled"
    filter {
      prefix = "athena-results/"
    }
    expiration {
      days = 7
    }
  }
}
