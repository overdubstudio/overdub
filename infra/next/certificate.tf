# CloudFront's certificate for the preview, validated by DNS in the preview's own zone. It is already issued; there is
# no aws_acm_certificate_validation here, since that resource only waits and would be a create on an imported cert.
resource "aws_acm_certificate" "next" {
  domain_name       = var.domain
  validation_method = "DNS"
  key_algorithm     = "RSA_2048"

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  cert_validation = one(aws_acm_certificate.next.domain_validation_options)
}

resource "aws_route53_record" "cert_validation" {
  zone_id = aws_route53_zone.next.zone_id
  name    = local.cert_validation.resource_record_name
  type    = local.cert_validation.resource_record_type
  ttl     = 300
  records = [local.cert_validation.resource_record_value]
}
