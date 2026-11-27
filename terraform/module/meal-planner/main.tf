terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
      # aws.us-east-1 is for the CloudFront certificate, which must be there.
      configuration_aliases = [aws, aws.us-east-1]
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
