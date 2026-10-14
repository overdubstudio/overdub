# GitHub Actions deploys the preview (.github/workflows/ci.yml, deploy-staging) with its OIDC token, never a stored key,
# as a role that can write the preview's bucket and invalidate its distribution and nothing else.

# Account-wide: one provider per issuer per account. overdub-cloud's roles trust this same provider (by ARN); this
# state owns it.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # thumbprint_list is left to AWS: IAM trusts GitHub's certificate chain for this issuer and doesn't check it
}

resource "aws_iam_role" "deploy" {
  name                 = "overdub-next-deploy-github"
  description          = "GitHub Actions (${var.github_repo}) deploys https://${var.domain}"
  max_session_duration = 3600

  # Plain JSON, not aws_iam_policy_document data sources (bucket.tf says why). A run on one of these branches of this
  # repo may assume it; a pull request's run has a different subject.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [for b in var.deploy_branches : "${var.github_sub_claim_prefix}:ref:refs/heads/${b}"]
        }
      }
    }]
  })
}

# Exactly what deploy/deploy.sh --next calls: the preview's bucket and distribution, and reading the stems model the
# committed deploy/live-config.json names (infra/live's models bucket; without it the preview ships with stems off).
resource "aws_iam_role_policy" "deploy" {
  name = "deploy-preview"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListPreviewBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.site.arn
      },
      {
        Sid      = "WritePreviewObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
      {
        Sid      = "ReadModels"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = ["arn:aws:s3:::overdub-models-800849967977", "arn:aws:s3:::overdub-models-800849967977/*"]
      },
      {
        Sid      = "InvalidatePreview"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.next.arn
      },
    ]
  })
}
