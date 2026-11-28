terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
      # aws.us-east-1 is for the CloudFront certificate, which must be there.
      configuration_aliases = [aws, aws.us-east-1]
    }
    # The Lambdas' placeholder zips (module lambda).
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
  }
}

locals {
  resource_prefix = "meal-planner-${var.environment}"
  site_domain     = "${var.host}.${var.domain}"
  site_url        = "https://${local.site_domain}"
  is_prod         = var.environment == "prod"
}

data "aws_region" "current" {}

# The UI bucket: the SvelteKit build, served only through CloudFront (DESIGN
# §8.1, §8.4). `make push-ui` uploads to it.
resource "aws_s3_bucket" "ui" {
  bucket = "${local.resource_prefix}-ui"
}

resource "aws_s3_bucket_public_access_block" "ui" {
  bucket = aws_s3_bucket.ui.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "ui" {
  bucket = aws_s3_bucket.ui.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "ui" {
  bucket = aws_s3_bucket.ui.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 rather than a customer-managed KMS key (DESIGN §8.4). The bucket
# holds only the public UI build, so a CMK would add a key policy (and
# CloudFront access to it) and a monthly cost for no gain.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "ui" {
  bucket = aws_s3_bucket.ui.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

locals {
  ui_bucket_arn = "arn:aws:s3:::${aws_s3_bucket.ui.bucket}"
}

# Only this distribution may read, and only over TLS. ListBucket makes a
# missing file a 404 rather than a 403.
resource "aws_s3_bucket_policy" "ui" {
  bucket = aws_s3_bucket.ui.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontRead"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${local.ui_bucket_arn}/*"
        Condition = {
          StringEquals = { "aws:SourceArn" = aws_cloudfront_distribution.site.arn }
        }
      },
      {
        Sid       = "CloudFrontList"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:ListBucket"
        Resource  = local.ui_bucket_arn
        Condition = {
          StringEquals = { "aws:SourceArn" = aws_cloudfront_distribution.site.arn }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [local.ui_bucket_arn, "${local.ui_bucket_arn}/*"]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
    ]
  })

  # Apply the public access block first, so the policy is never briefly
  # evaluated without it.
  depends_on = [aws_s3_bucket_public_access_block.ui]
}
