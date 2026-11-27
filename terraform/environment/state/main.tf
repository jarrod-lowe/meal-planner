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

variable "project" {
  description = "Project name, used in resource names and tags"
  type        = string
}

variable "state_bucket" {
  description = "Name of the Terraform state bucket"
  type        = string
}

provider "aws" {
  default_tags {
    tags = {
      project     = var.project
      environment = "bootstrap"
      managed-by  = "terraform"
    }
  }
}

module "state_infrastructure" {
  source = "../../module/state-infrastructure"

  bucket_name = var.state_bucket
}

# ensure-state-bucket.sh creates the bucket before the first init.
import {
  to = module.state_infrastructure.aws_s3_bucket.state
  id = var.state_bucket
}

output "state_bucket_name" {
  description = "Name of the state bucket"
  value       = module.state_infrastructure.bucket_name
}
