# GitHub Actions deploys the live site (.github/workflows/deploy-live.yml) with its OIDC token, never a stored key, as a
# role only a job in the production environment can assume: the environment has required reviewers and deploys from
# main only, so every use of the role is an approved run of a commit on main.

# The account's one GitHub provider is infra/next's (one per issuer per account): read here, never made twice.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "deploy" {
  name                 = "overdub-live-deploy-github"
  description          = "GitHub Actions (${var.github_repo}, environment ${var.deploy_environment}) deploys https://${var.domain}"
  max_session_duration = 3600

  # Plain JSON (infra/next/bucket.tf says why). One subject: a job in the environment. A run on a branch, a pull
  # request's run, or a job outside the environment carries another and can't assume it.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "${var.github_sub_claim_prefix}:environment:${var.deploy_environment}"
        }
      }
    }]
  })
}

# Exactly what deploy/deploy.sh (live) and the workflow call: the site's bucket, reading the stems model, and the
# distribution (its invalidations, and reading it to know which name to check).
resource "aws_iam_role_policy" "deploy" {
  name = "deploy-live"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListLiveBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.this["site"].arn
      },
      {
        Sid      = "WriteLiveObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.this["site"].arn}/*"
      },
      {
        Sid      = "ReadModels"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.this["models"].arn, "${aws_s3_bucket.this["models"].arn}/*"]
      },
      {
        Sid      = "InvalidateLive"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistribution"]
        Resource = aws_cloudfront_distribution.live.arn
      },
    ]
  })
}
