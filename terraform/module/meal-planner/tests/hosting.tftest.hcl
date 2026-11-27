# Plan-only checks of the UI bucket, CloudFront, the certificate and DNS. The
# providers are mocked, so no AWS calls are made. `override_during = plan`
# makes the mocked values below (and the data sources) known at plan time.

mock_provider "aws" {
  override_during = plan

  # A certificate made with the default (ap-southeast-2) provider would get
  # this ARN, and fail the us-east-1 check below.
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:ap-southeast-2:123456789012:certificate/wrong-region"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn = "arn:aws:cloudfront::123456789012:distribution/EEXAMPLE"
    }
  }

  mock_resource "aws_cloudfront_origin_access_control" {
    defaults = {
      id = "EOACEXAMPLE"
    }
  }

  mock_resource "aws_cloudfront_response_headers_policy" {
    defaults = {
      id = "security-headers-example"
    }
  }

  override_data {
    target = data.aws_region.current
    values = {
      region = "ap-southeast-2"
    }
  }

  override_data {
    target = data.aws_route53_zone.site
    values = {
      zone_id = "Z0000000000EXAMPLE"
      name    = "wildsea.lowe.kiwi"
    }
  }
}

mock_provider "aws" {
  alias           = "us-east-1"
  override_during = plan

  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/example"
    }
  }
}

variables {
  environment = "test"
  domain      = "wildsea.lowe.kiwi"
  host        = "meal-planner-test"
}

run "ui_bucket_is_private" {
  command = plan

  assert {
    condition = (
      aws_s3_bucket_public_access_block.ui.block_public_acls &&
      aws_s3_bucket_public_access_block.ui.block_public_policy &&
      aws_s3_bucket_public_access_block.ui.ignore_public_acls &&
      aws_s3_bucket_public_access_block.ui.restrict_public_buckets
    )
    error_message = "The UI bucket must block all public access"
  }

  assert {
    condition     = aws_s3_bucket_versioning.ui.versioning_configuration[0].status == "Enabled"
    error_message = "The UI bucket must be versioned"
  }

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.ui.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "The UI bucket must use SSE-S3"
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.ui.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "The UI bucket must disable ACLs (BucketOwnerEnforced)"
  }
}

run "ui_bucket_policy_allows_only_this_distribution_over_tls" {
  command = plan

  assert {
    condition = anytrue([
      for s in jsondecode(aws_s3_bucket_policy.ui.policy).Statement :
      s.Effect == "Deny" && s.Condition.Bool["aws:SecureTransport"] == "false"
    ])
    error_message = "The UI bucket policy must deny requests without TLS"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_s3_bucket_policy.ui.policy).Statement :
      s.Principal == { Service = "cloudfront.amazonaws.com" } && can(s.Condition.StringEquals["aws:SourceArn"])
      if s.Effect == "Allow"
    ])
    error_message = "The UI bucket policy must allow only CloudFront, for this distribution"
  }
}

run "default_behaviour_serves_the_spa_from_s3" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].cache_policy_id == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    error_message = "The default behaviour must use Managed-CachingOptimized"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].target_origin_id == "ui"
    error_message = "The default behaviour must serve the UI bucket"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "The default behaviour must redirect HTTP to HTTPS"
  }

  assert {
    condition = [
      for f in aws_cloudfront_distribution.site.default_cache_behavior[0].function_association : f.event_type
    ] == ["viewer-request"]
    error_message = "The default behaviour must run the SPA rewrite on viewer request"
  }

  assert {
    condition     = one([for o in aws_cloudfront_distribution.site.origin : o if o.origin_id == "ui"]).origin_access_control_id != null
    error_message = "The UI bucket origin must use Origin Access Control"
  }
}

run "spa_rewrite_function_is_the_tested_file" {
  command = plan

  assert {
    condition     = aws_cloudfront_function.spa_rewrite.runtime == "cloudfront-js-2.0"
    error_message = "The SPA rewrite must use the cloudfront-js-2.0 runtime"
  }

  assert {
    condition     = aws_cloudfront_function.spa_rewrite.code == file("spa-rewrite.js")
    error_message = "The SPA rewrite must deploy spa-rewrite.js, the file Vitest tests"
  }
}

run "api_behaviour_passes_everything_to_api_gateway" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.site.ordered_cache_behavior) == 1
    error_message = "There must be exactly one extra behaviour, for the API"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.ordered_cache_behavior[0].path_pattern == "/api/*"
    error_message = "The API behaviour must match /api/*"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.ordered_cache_behavior[0].target_origin_id == "api"
    error_message = "The API behaviour must go to the API Gateway origin"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.ordered_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    error_message = "The API behaviour must use Managed-CachingDisabled"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.ordered_cache_behavior[0].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    error_message = "The API behaviour must use Managed-AllViewerExceptHostHeader, which forwards Authorization"
  }

  assert {
    condition     = toset(aws_cloudfront_distribution.site.ordered_cache_behavior[0].allowed_methods) == toset(["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"])
    error_message = "The API behaviour must allow all HTTP methods"
  }

  assert {
    condition     = length(aws_cloudfront_distribution.site.ordered_cache_behavior[0].function_association) == 0
    error_message = "The SPA rewrite must not run on the API behaviour"
  }

  assert {
    condition     = one([for o in aws_cloudfront_distribution.site.origin : o if o.origin_id == "api"]).custom_origin_config[0].origin_protocol_policy == "https-only"
    error_message = "CloudFront must reach API Gateway over HTTPS only"
  }
}

run "api_errors_are_not_turned_into_the_spa" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_distribution.site.custom_error_response) == 0
    error_message = "There must be no custom error responses: they would turn API 403/404s into the SPA"
  }
}

run "security_headers" {
  command = plan

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].strict_transport_security[0].access_control_max_age_sec == 31536000
    error_message = "HSTS must last a year"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].strict_transport_security[0].include_subdomains
    error_message = "HSTS must include subdomains"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].content_type_options[0].override
    error_message = "X-Content-Type-Options must be set"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].referrer_policy[0].referrer_policy == "strict-origin-when-cross-origin"
    error_message = "Referrer-Policy must be strict-origin-when-cross-origin"
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].frame_options[0].frame_option == "DENY"
    error_message = "Framing must be denied"
  }

  assert {
    condition     = strcontains(aws_cloudfront_response_headers_policy.security.security_headers_config[0].content_security_policy[0].content_security_policy, "connect-src 'self' https://cognito-idp.ap-southeast-2.amazonaws.com;")
    error_message = "The CSP must allow connecting to Cognito"
  }

  assert {
    condition     = startswith(aws_cloudfront_response_headers_policy.security.security_headers_config[0].content_security_policy[0].content_security_policy, "default-src 'self';")
    error_message = "The CSP must default to 'self'"
  }

  assert {
    condition = alltrue([
      aws_cloudfront_distribution.site.default_cache_behavior[0].response_headers_policy_id == aws_cloudfront_response_headers_policy.security.id,
      aws_cloudfront_distribution.site.ordered_cache_behavior[0].response_headers_policy_id == aws_cloudfront_response_headers_policy.security.id,
    ])
    error_message = "Both behaviours must use the security headers policy"
  }
}

run "site_is_served_on_its_own_domain" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.site.aliases == toset(["meal-planner-test.wildsea.lowe.kiwi"])
    error_message = "The distribution must be served on meal-planner-test.wildsea.lowe.kiwi"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "The distribution must require TLS 1.2 or later"
  }

  assert {
    condition     = toset([for r in aws_route53_record.site : r.type]) == toset(["A", "AAAA"])
    error_message = "There must be A and AAAA alias records"
  }

  assert {
    condition     = alltrue([for r in aws_route53_record.site : r.name == "meal-planner-test.wildsea.lowe.kiwi" && r.zone_id == "Z0000000000EXAMPLE"])
    error_message = "The alias records must be for the site's name, in the wildsea.lowe.kiwi zone"
  }

  assert {
    condition     = data.aws_route53_zone.site.name == "wildsea.lowe.kiwi"
    error_message = "The zone must be looked up by the domain name"
  }
}

run "certificate_is_in_us_east_1" {
  command = plan

  assert {
    condition     = aws_acm_certificate.site.domain_name == "meal-planner-test.wildsea.lowe.kiwi"
    error_message = "The certificate must be for the site's name"
  }

  assert {
    condition     = aws_acm_certificate.site.validation_method == "DNS"
    error_message = "The certificate must be DNS-validated"
  }

  assert {
    condition     = startswith(aws_cloudfront_distribution.site.viewer_certificate[0].acm_certificate_arn, "arn:aws:acm:us-east-1:")
    error_message = "CloudFront's certificate must be in us-east-1"
  }
}

run "prod_uses_the_prod_host" {
  command = plan

  variables {
    environment = "prod"
    host        = "meal-planner"
  }

  assert {
    condition     = aws_cloudfront_distribution.site.aliases == toset(["meal-planner.wildsea.lowe.kiwi"])
    error_message = "Prod must be served on meal-planner.wildsea.lowe.kiwi"
  }
}
