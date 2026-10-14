# One certificate for the site, its www and the MCP relay, validated by DNS in the zone. The relay's distribution uses
# it from the first apply; the site's takes it at the cutover (var.serve_names).
resource "aws_acm_certificate" "live" {
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}", var.relay_domain]
  validation_method         = "DNS"
  key_algorithm             = "RSA_2048"

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.live.domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  }

  zone_id         = aws_route53_zone.live.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 300
  records         = [each.value.record]
  allow_overwrite = true
}

# Waits for ACM to issue it, so nothing uses it before it's valid (a few minutes on the first apply).
resource "aws_acm_certificate_validation" "live" {
  certificate_arn         = aws_acm_certificate.live.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
