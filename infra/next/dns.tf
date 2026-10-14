# The preview's own hosted zone, delegated from overdubstudio.com. The parent zone, and the NS record in it that
# delegates to this one, are infra/live's.
resource "aws_route53_zone" "next" {
  name    = var.domain
  comment = "staging delegated from overdubstudio.com"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "next_a" {
  zone_id = aws_route53_zone.next.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.next.domain_name
    zone_id                = aws_cloudfront_distribution.next.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "next_aaaa" {
  zone_id = aws_route53_zone.next.zone_id
  name    = var.domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.next.domain_name
    zone_id                = aws_cloudfront_distribution.next.hosted_zone_id
    evaluate_target_health = false
  }
}

# api.next.overdubstudio.com, the cloud API's staging host, is delegated to its own zone. The zone is the private
# overdub-cloud repo's (its infra/shared), which deploys the API; this repo only points at it. Looked up by name, so
# a plan here fails until that zone exists: apply overdub-cloud's infra/shared first.
data "aws_route53_zone" "api" {
  name = "api.${var.domain}"
}

resource "aws_route53_record" "api_delegation" {
  zone_id = aws_route53_zone.next.zone_id
  name    = "api.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = data.aws_route53_zone.api.name_servers
}
