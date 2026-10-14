# CloudFront in front of the site's bucket: an origin access control, the viewer-request path rewrite, AWS's managed
# CachingOptimized, and the frame headers policy. Until the cutover (var.serve_names) the distribution has no names.

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_origin_access_control" "live" {
  name                              = "overdub-live"
  description                       = "overdubstudio.com's bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  # deploy/path-rewrite.js is the one source of the function. Before the cutover it also serves the distribution's own
  # cloudfront.net name (CLOUDFRONT_NAME), so the first deploy can be checked there instead of redirecting to the old site.
  cloudfront_name_off = "var CLOUDFRONT_NAME = false;"
  path_rewrite_code = replace(file("${path.module}/../../deploy/path-rewrite.js"), local.cloudfront_name_off,
  "var CLOUDFRONT_NAME = ${var.serve_names ? "false" : "true"};")
}

resource "aws_cloudfront_function" "path_rewrite" {
  name    = "overdub-path-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "overdub path rewrite"
  code    = local.path_rewrite_code
  publish = true

  lifecycle {
    precondition {
      condition     = strcontains(local.path_rewrite_code, "var HOME = '${var.domain}';") && strcontains(local.path_rewrite_code, "var CLOUDFRONT_NAME = ")
      error_message = "deploy/path-rewrite.js no longer has the lines var HOME = '${var.domain}'; and ${local.cloudfront_name_off}: update infra/live/cdn.tf."
    }
  }
}

# The managed SecurityHeadersPolicy's values, with X-Frame-Options DENY (not SAMEORIGIN) and
# Content-Security-Policy: frame-ancestors 'none', both overriding: no other page may frame the studio, its trust prompt
# or the gallery. A header CSP with only frame-ancestors adds to the pages' <meta> CSPs. tools/prod-check.js checks both.
resource "aws_cloudfront_response_headers_policy" "live" {
  name    = "overdub-headers"
  comment = "${var.domain}: security headers, no framing"

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    content_security_policy {
      content_security_policy = "frame-ancestors 'none'"
      override                = true
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
}

# No WAF: static public files, nothing to sign in to, and a web ACL costs more than the site. Before the cutover it has
# no names, so CloudFront's default certificate (and its default minimum TLS); after, its own (TLSv1.2_2021).
#trivy:ignore:AVD-AWS-0011 no WAF on a static site of public files
#trivy:ignore:AVD-AWS-0013 TLSv1.2_2021 once it has its names; the default certificate before the cutover can't set it
resource "aws_cloudfront_distribution" "live" {
  comment         = "${var.domain} (live)"
  enabled         = true
  aliases         = var.serve_names ? [var.domain, "www.${var.domain}"] : []
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    origin_id                = "s3-overdub"
    domain_name              = aws_s3_bucket.this["site"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.live.id
    connection_attempts      = 3
    connection_timeout       = 10
  }

  default_cache_behavior {
    target_origin_id           = "s3-overdub"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.live.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.path_rewrite.arn
    }
  }

  # the counts (app/src/analytics.js, tools/stats.sh): standard logging, no cookies
  dynamic "logging_config" {
    for_each = var.access_logs ? [1] : []
    content {
      bucket          = aws_s3_bucket.this["logs"].bucket_domain_name
      prefix          = "cf-logs/"
      include_cookies = false
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !var.serve_names
    acm_certificate_arn            = var.serve_names ? aws_acm_certificate_validation.live.certificate_arn : null
    ssl_support_method             = var.serve_names ? "sni-only" : null
    minimum_protocol_version       = var.serve_names ? "TLSv1.2_2021" : "TLSv1"
  }

  depends_on = [aws_s3_bucket_ownership_controls.this]
}
