# The preview's files: a private bucket that only its distribution reads. deploy/deploy.sh --next fills it (an
# aws s3 sync of the committed tree); Terraform manages the bucket and never its objects.

# Not versioned, logged or KMS-encrypted, as it was made: every object is a copy of a commit, which deploy.sh can put
# back at any time, and the files are public through CloudFront anyway.
#trivy:ignore:AVD-AWS-0090 no versioning: the bucket mirrors a git commit; history lives in git and a redeploy restores it
#trivy:ignore:AVD-AWS-0089 no access logging on a preview bucket; CloudFront is its only reader
#trivy:ignore:AVD-AWS-0320 the name has dots because it is the site's name; renaming a bucket means replacing it
resource "aws_s3_bucket" "site" {
  bucket = var.domain

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3's default encryption, as the bucket was made with (SSE-S3, SSE-C refused).
#trivy:ignore:AVD-AWS-0132 SSE-S3 is enough for files that are served publicly through CloudFront
resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled       = false
    blocked_encryption_types = ["SSE-C"]
  }
}

# Plain JSON rather than an aws_iam_policy_document: a data source that reads a resource is deferred to apply when that
# resource has any pending change, and the plan would then show the policy as "known after apply".
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.next.arn } }
    }]
  })
}
