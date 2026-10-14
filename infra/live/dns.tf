# overdubstudio.com's hosted zone. It was made with the CLI on 2026-10-14 (the domain's name servers point here) and
# copied the records of the old zone in AJ's personal account; imports.tf adopts it, its site records and the
# delegation of next.overdubstudio.com (whose own zone is infra/next's).
resource "aws_route53_zone" "live" {
  name    = var.domain
  comment = "overdubstudio.com (moved from 165604225334)"

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  # where the site's names point: the old distribution until the cutover (var.serve_names), then this one
  site_target = var.serve_names ? {
    name    = aws_cloudfront_distribution.live.domain_name
    zone_id = aws_cloudfront_distribution.live.hosted_zone_id
    } : {
    name    = var.old_distribution_domain
    zone_id = "Z2FDTNDATAQYW2" # CloudFront's alias zone, the same for every distribution
  }
  site_records = {
    apex_a    = { name = var.domain, type = "A" }
    apex_aaaa = { name = var.domain, type = "AAAA" }
    www_a     = { name = "www.${var.domain}", type = "A" }
    www_aaaa  = { name = "www.${var.domain}", type = "AAAA" }
  }
}

resource "aws_route53_record" "site" {
  for_each = local.site_records

  zone_id = aws_route53_zone.live.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = local.site_target.name
    zone_id                = local.site_target.zone_id
    evaluate_target_health = false
  }
}

# next.overdubstudio.com is delegated to its own zone (infra/next)
data "aws_route53_zone" "next" {
  name = "next.${var.domain}"
}

resource "aws_route53_record" "next_delegation" {
  zone_id = aws_route53_zone.live.zone_id
  name    = "next.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = data.aws_route53_zone.next.name_servers
}

# api.overdubstudio.com, the cloud API, is delegated to its own zone, which the private overdub-cloud repo owns (its
# infra/shared) and deploys into. Looked up by name like next's above, so apply overdub-cloud's infra/shared first.
data "aws_route53_zone" "api" {
  name = "api.${var.domain}"
}

resource "aws_route53_record" "api_delegation" {
  zone_id = aws_route53_zone.live.zone_id
  name    = "api.${var.domain}"
  type    = "NS"
  ttl     = 300
  records = data.aws_route53_zone.api.name_servers
}
