output "zone_id" {
  description = "overdubstudio.com's hosted zone."
  value       = aws_route53_zone.live.zone_id
}

output "distribution_id" {
  description = "The live site's CloudFront distribution (the repository variable LIVE_DISTRIBUTION)."
  value       = aws_cloudfront_distribution.live.id
}

output "distribution_domain" {
  description = "Its cloudfront.net name: where the first deploy is checked, before the cutover."
  value       = aws_cloudfront_distribution.live.domain_name
}

output "serving_names" {
  description = "Whether the distribution has taken overdubstudio.com and www (var.serve_names)."
  value       = var.serve_names
}

output "deploy_role_arn" {
  description = "The role deploy-live.yml assumes (the repository variable LIVE_DEPLOY_ROLE)."
  value       = aws_iam_role.deploy.arn
}

output "models_bucket" {
  description = "The stems model's bucket (deploy/live-config.json's modelFrom)."
  value       = aws_s3_bucket.this["models"].bucket
}

output "logs_bucket" {
  description = "CloudFront's access logs, for the counts (deploy/analytics/setup.sh, tools/stats.sh)."
  value       = aws_s3_bucket.this["logs"].bucket
}

output "certificate_arn" {
  description = "The certificate for overdubstudio.com, www and the relay."
  value       = aws_acm_certificate.live.arn
}

output "relay_url" {
  description = "The hosted MCP relay (RELAY in app/src/agent/remote.js)."
  value       = "https://${var.relay_domain}"
}

output "relay_instance_id" {
  description = "The relay's instance (deploy/relay/deploy.sh finds it by its Name tag)."
  value       = aws_instance.relay.id
}

output "relay_distribution_id" {
  description = "The relay's CloudFront distribution."
  value       = aws_cloudfront_distribution.relay.id
}
