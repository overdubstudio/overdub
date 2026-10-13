# CloudFront in front of the bucket: an origin access control, the viewer-request path rewrite, AWS's managed
# CachingOptimized, and a response headers policy that adds noindex to the usual security headers.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_origin_access_control" "next" {
  name                              = "overdub-next"
  description                       = ""
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  # deploy/path-rewrite.js is the one source of the function: the preview's copy differs only in its home, so its own
  # paths resolve and nothing redirects testers to the live site.
  live_home         = "var HOME = 'overdubstudio.com';"
  path_rewrite_code = replace(file("${path.module}/../../deploy/path-rewrite.js"), local.live_home, "var HOME = '${var.domain}';")
}

resource "aws_cloudfront_function" "path_rewrite" {
  name    = "overdub-next-path-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "overdub preview path rewrite"
  code    = local.path_rewrite_code
  publish = true

  lifecycle {
    precondition {
      condition     = strcontains(local.path_rewrite_code, "var HOME = '${var.domain}';")
      error_message = "deploy/path-rewrite.js no longer has the line ${local.live_home}: update local.live_home in infra/next/cdn.tf."
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "next" {
  name    = "overdub-next-headers"
  comment = "${var.domain}: security headers plus noindex"

  # the managed SecurityHeadersPolicy's set
  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = false
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      preload                    = false
      override                   = false
    }
    xss_protection {
      protection = true
      mode_block = true
      override   = false
    }
  }

  # so no search engine lists the preview
  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}

# No WAF and no access logs: it's a preview of public files, with nothing to log in to and nothing to protect that the
# live site doesn't already serve. Its own certificate means TLS 1.2+ only (TLSv1.2_2021).
#trivy:ignore:AVD-AWS-0011 no WAF on the preview: static public files, and a web ACL costs more than the site
#trivy:ignore:AVD-AWS-0010 no CloudFront access logging on the preview
resource "aws_cloudfront_distribution" "next" {
  comment         = "${var.domain} (preview)"
  enabled         = true
  aliases         = [var.domain]
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    origin_id                = "s3-overdub-next"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.next.id
    connection_attempts      = 3
    connection_timeout       = 10
  }

  default_cache_behavior {
    target_origin_id           = "s3-overdub-next"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.next.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.path_rewrite.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.next.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
