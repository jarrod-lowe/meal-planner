# CloudFront in front of the UI bucket and the API (DESIGN §8.1), on the
# site's own name with an ACM certificate in us-east-1.

data "aws_route53_zone" "site" {
  name = var.domain
}

# AWS managed policies. Their IDs are the same in every account (see
# "Use managed cache policies" and "Use managed origin request policies" in
# the CloudFront Developer Guide). They're constants rather than data lookups
# because the lookups' `id` can't be mocked, so `terraform test` couldn't
# check which policy each behaviour uses.
locals {
  cache_policy_caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cache_policy_caching_disabled  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  # Forwards every viewer header except Host (so Authorization reaches the
  # API), plus all query strings and cookies.
  origin_request_policy_all_viewer_except_host_header = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

resource "aws_cloudfront_origin_access_control" "ui" {
  name                              = "${local.resource_prefix}-ui"
  description                       = "CloudFront access to the ${var.environment} UI bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA routing: app routes (no file extension) get index.html. Tested by
# spa-rewrite.test.ts.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${local.resource_prefix}-spa-rewrite"
  comment = "Serve index.html for app routes"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

locals {
  # index.html's inline SvelteKit bootstrap script changes every build, so it
  # can't be hashed here. This header allows inline scripts, and SvelteKit
  # adds a second CSP as a <meta> tag in index.html with that script's hash
  # (`csp` in vite.config.ts). Browsers enforce both policies, so only the
  # hashed bootstrap runs. style-src allows inline styles for Svelte.
  content_security_policy = join("; ", [
    "default-src 'self'",
    "connect-src 'self' https://cognito-idp.${data.aws_region.current.region}.amazonaws.com",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.resource_prefix}-security-headers"
  comment = "Security headers for the ${var.environment} site and API"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    content_security_policy {
      content_security_policy = local.content_security_policy
      override                = true
    }
  }
}

# No WAF: it costs more than this small, invite-only app justifies. Cognito
# and API Gateway throttling cover the API.
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "Meal planner (${var.environment})"
  aliases         = [local.site_domain]

  origin {
    origin_id                = "ui"
    domain_name              = aws_s3_bucket.ui.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.ui.id
  }

  # The stage is named `api`, so /api/health reaches the /health resource
  # with no origin path.
  origin {
    origin_id   = "api"
    domain_name = "${aws_api_gateway_rest_api.api.id}.execute-api.${data.aws_region.current.region}.amazonaws.com"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # The UI. No custom error responses: they would also turn the API's real
  # 403s and 404s into the SPA, so the function does the SPA routing instead.
  default_cache_behavior {
    target_origin_id           = "ui"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_disabled
    origin_request_policy_id   = local.origin_request_policy_all_viewer_except_host_header
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# CloudFront only uses certificates in us-east-1.
resource "aws_acm_certificate" "site" {
  provider = aws.us-east-1

  domain_name       = local.site_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  zone_id         = data.aws_route53_zone.site.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us-east-1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}

resource "aws_route53_record" "site" {
  for_each = toset(["A", "AAAA"])

  zone_id = data.aws_route53_zone.site.zone_id
  name    = local.site_domain
  type    = each.key

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
