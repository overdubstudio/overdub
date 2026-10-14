# The hosted MCP relay behind Connect to Claude (server/relay.js; docs/REMOTE-MCP.md, "Hosting"), at mcp.overdubstudio.com:
#
#   claude.ai ──https──> CloudFront (the live certificate, no caching, all methods)
#                          └─http :8787 + x-overdub-origin: <secret>──> EC2 t4g.nano (AL2023, Node 22, systemd)
#                                                                       security group: CloudFront origin-facing only
#
# Terraform owns the machine and its wiring; deploy/relay/deploy.sh ships the code (relay.js and its catalog) over SSM
# and writes the unit and env file, reading the origin secret on the instance from Parameter Store. It finds the
# instance by its Name tag and the distribution by its alias. Cost: about $7.40 a month (the instance, its disk and the
# public IPv4).

locals {
  relay_name   = "overdub-relay"
  relay_port   = 8787
  relay_secret = "/overdub/relay/origin-secret"
}

# ---------------------------------------------------------------- the instance's role: SSM, and its one parameter
resource "aws_iam_role" "relay" {
  name        = local.relay_name
  description = "Overdub relay instance: SSM, and reading its origin secret"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "relay_ssm" {
  role       = aws_iam_role.relay.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# AmazonSSMManagedInstanceCore already allows ssm:GetParameter on every parameter; this names the one the relay needs,
# so it still works if that policy is ever narrowed. The default aws/ssm key needs no KMS grant in the same account.
resource "aws_iam_role_policy" "relay_secret" {
  name = "overdub-relay-origin-secret"
  role = aws_iam_role.relay.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "ssm:GetParameter", Resource = aws_ssm_parameter.origin_secret.arn }]
  })
}

resource "aws_iam_instance_profile" "relay" {
  name = local.relay_name
  role = aws_iam_role.relay.name
}

# ---------------------------------------------------------------- the origin secret
# CloudFront adds x-overdub-origin: <secret> to every request and the relay refuses one without it, so nobody can put
# another distribution in front of the instance. The value is in this state (CloudFront's config holds it), which the
# state bucket keeps private and encrypted. To rotate: terraform apply -replace=random_password.origin_secret, then
# deploy/relay/deploy.sh (requests 403 for the few minutes CloudFront takes).
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

#trivy:ignore:AVD-AWS-0098 the default aws/ssm key: a customer key would only add a grant to the same account's role
resource "aws_ssm_parameter" "origin_secret" {
  name        = local.relay_secret
  description = "x-overdub-origin: CloudFront to the Overdub relay (infra/live/relay.tf)"
  type        = "SecureString"
  value       = random_password.origin_secret.result
}

# ---------------------------------------------------------------- network: the default VPC, CloudFront's addresses only
data "aws_vpc" "default" {
  default = true
}

data "aws_ec2_instance_type_offerings" "relay" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = [var.relay_instance_type]
  }
}

data "aws_subnet" "relay" {
  vpc_id            = data.aws_vpc.default.id
  default_for_az    = true
  availability_zone = sort(data.aws_ec2_instance_type_offerings.relay.locations)[0]
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "relay" {
  name        = local.relay_name
  description = "Overdub relay: CloudFront origin-facing only"
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = local.relay_name }
}

resource "aws_vpc_security_group_ingress_rule" "relay_cloudfront" {
  security_group_id = aws_security_group.relay.id
  description       = "CloudFront origin-facing (no SSH: deploys go over SSM)"
  ip_protocol       = "tcp"
  from_port         = local.relay_port
  to_port           = local.relay_port
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

#trivy:ignore:AVD-AWS-0104 the instance reaches dnf, SSM and the SSM parameter over the internet; no VPC endpoints at this size
resource "aws_vpc_security_group_egress_rule" "relay_out" {
  security_group_id = aws_security_group.relay.id
  description       = "out: dnf, SSM, Parameter Store"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------------------------------------------------------------- the instance
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "relay" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.relay_instance_type
  subnet_id              = data.aws_subnet.relay.id
  vpc_security_group_ids = [aws_security_group.relay.id]
  iam_instance_profile   = aws_iam_instance_profile.relay.name

  # first boot: a little swap (512 MB of RAM is tight for dnf) and Node 22; deploy/relay/deploy.sh does the rest
  user_data = <<-EOS
    #!/bin/bash
    set -eux
    if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=512; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap defaults 0 0' >> /etc/fstab; fi
    dnf install -y nodejs22
    mkdir -p /opt/overdub-relay/releases
  EOS

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size           = 8
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = local.relay_name }
  }

  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = local.relay_name }

  lifecycle {
    # a newer AL2023 image, or an edit to the first-boot script, must not replace a running relay: replace it on purpose
    # (terraform apply -replace=aws_instance.relay, then deploy/relay/deploy.sh)
    ignore_changes = [ami, user_data]
  }
}

# a stable public address: the origin's DNS name must not change on a stop/start
resource "aws_eip" "relay" {
  domain   = "vpc"
  instance = aws_instance.relay.id
  tags     = { Name = local.relay_name }
}

# ---------------------------------------------------------------- CloudFront and DNS
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# No caching, every method, https only, no compression (so SSE isn't buffered), a 60 s origin read timeout. The hop to
# the instance is plain HTTP inside AWS (docs/REMOTE-MCP.md, "Known gap"). No WAF or access logs: the relay rate-limits
# and logs no tokens itself.
#trivy:ignore:AVD-AWS-0011 no WAF: the relay rate-limits per address itself, and a web ACL costs more than the relay
#trivy:ignore:AVD-AWS-0010 no CloudFront access logs for the relay: its paths carry connector tokens
resource "aws_cloudfront_distribution" "relay" {
  comment         = "${var.relay_domain} (Overdub MCP relay)"
  enabled         = true
  aliases         = [var.relay_domain]
  http_version    = "http2"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    origin_id           = "relay-ec2"
    domain_name         = aws_eip.relay.public_dns
    connection_attempts = 3
    connection_timeout  = 10

    custom_header {
      name  = "x-overdub-origin"
      value = random_password.origin_secret.result
    }

    custom_origin_config {
      http_port                = local.relay_port
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = "relay-ec2"
    viewer_protocol_policy   = "https-only"
    compress                 = false
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.live.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = local.relay_name }
}

resource "aws_route53_record" "relay" {
  for_each = toset(["A", "AAAA"])

  zone_id = aws_route53_zone.live.zone_id
  name    = var.relay_domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.relay.domain_name
    zone_id                = aws_cloudfront_distribution.relay.hosted_zone_id
    evaluate_target_health = false
  }
}
