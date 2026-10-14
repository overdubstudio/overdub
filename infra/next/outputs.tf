output "zone_id" {
  description = "The preview's hosted zone."
  value       = aws_route53_zone.next.zone_id
}

output "zone_name" {
  description = "Its name."
  value       = aws_route53_zone.next.name
}

output "distribution_id" {
  description = "The preview's CloudFront distribution (the repository variable NEXT_DISTRIBUTION)."
  value       = aws_cloudfront_distribution.next.id
}

output "distribution_domain" {
  description = "Its cloudfront.net name."
  value       = aws_cloudfront_distribution.next.domain_name
}

output "deploy_role_arn" {
  description = "The role GitHub Actions assumes to deploy the preview (the repository variable NEXT_DEPLOY_ROLE)."
  value       = aws_iam_role.deploy.arn
}

output "oidc_provider_arn" {
  description = "GitHub's OIDC identity provider in this account (overdub-cloud's roles trust it too)."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "state_bucket" {
  description = "The account's Terraform state bucket (infra/bootstrap)."
  value       = "overdub-tfstate-800849967977"
}
