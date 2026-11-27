# Shared by the test and prod environments, which symlink this file. Each
# environment's own environment.tf sets local.environment, local.domain and
# local.host.

terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
    }
  }

  # bucket, key and region come from Make (-backend-config).
  backend "s3" {
    use_lockfile = true
  }
}

locals {
  # DESIGN §8.4: on everything.
  default_tags = {
    project     = "meal-planner"
    environment = local.environment
    managed-by  = "terraform"
  }
}

provider "aws" {
  default_tags {
    tags = local.default_tags
  }
}

# CloudFront's certificate must be in us-east-1.
provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}

module "meal_planner" {
  source = "../../module/meal-planner"

  environment = local.environment
  domain      = local.domain
  host        = local.host

  providers = {
    aws           = aws
    aws.us-east-1 = aws.us-east-1
  }
}
