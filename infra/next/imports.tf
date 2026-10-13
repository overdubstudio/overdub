# Everything here was made by hand (deploy/next/setup.sh, the since-deleted deploy/next/github-oidc.sh, the console)
# before Terraform managed it. These blocks adopted each live resource into state on the first apply; since then they
# are no-ops, kept as the record of what was adopted and from where.

import {
  to = aws_route53_zone.next
  id = "Z035386610HJFO49G29P2"
}

import {
  to = aws_route53_record.next_a
  id = "Z035386610HJFO49G29P2_next.overdubstudio.com_A"
}

import {
  to = aws_route53_record.next_aaaa
  id = "Z035386610HJFO49G29P2_next.overdubstudio.com_AAAA"
}

import {
  to = aws_acm_certificate.next
  id = "arn:aws:acm:us-east-1:800849967977:certificate/a6b0dbf8-2614-401a-8e76-3bc63a59d0b9"
}

import {
  to = aws_route53_record.cert_validation
  id = "Z035386610HJFO49G29P2__e1d60cf3960f667fd8cb181061990a81.next.overdubstudio.com_CNAME"
}

import {
  to = aws_s3_bucket.site
  id = "next.overdubstudio.com"
}

import {
  to = aws_s3_bucket_ownership_controls.site
  id = "next.overdubstudio.com"
}

import {
  to = aws_s3_bucket_public_access_block.site
  id = "next.overdubstudio.com"
}

import {
  to = aws_s3_bucket_server_side_encryption_configuration.site
  id = "next.overdubstudio.com"
}

import {
  to = aws_s3_bucket_policy.site
  id = "next.overdubstudio.com"
}

import {
  to = aws_cloudfront_origin_access_control.next
  id = "EYKPZKTUU1V5M"
}

import {
  to = aws_cloudfront_function.path_rewrite
  id = "overdub-next-path-rewrite"
}

import {
  to = aws_cloudfront_response_headers_policy.next
  id = "b9d24046-474a-4dd1-a3a1-6cd09d42829a"
}

import {
  to = aws_cloudfront_distribution.next
  id = "E2JJVSR8QYGXV1"
}

import {
  to = aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::800849967977:oidc-provider/token.actions.githubusercontent.com"
}

import {
  to = aws_iam_role.deploy
  id = "overdub-next-deploy-github"
}

import {
  to = aws_iam_role_policy.deploy
  id = "overdub-next-deploy-github:deploy-preview"
}

import {
  to = aws_budgets_budget.monthly
  id = "800849967977:overdub-monthly"
}
