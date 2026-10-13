# The preview's own hosted zone, delegated from overdubstudio.com. The parent zone (and so the NS records that
# delegate to this one) is in another AWS account and is not managed here.
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
