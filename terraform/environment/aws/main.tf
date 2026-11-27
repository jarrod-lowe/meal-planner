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

variable "github_owner" {
  description = "GitHub owner (user or organisation) of the repository"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "github_oidc_subject_prefix" {
  description = "The repository's OIDC `sub` prefix, from GitHub's OIDC customisation API (Make looks it up)"
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

# The account's GitHub OIDC provider is owned by dnd-planner's state, so it's
# looked up here, not managed or imported.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

module "iac_roles" {
  source = "../../module/iac-roles"

  project           = var.project
  github_owner      = var.github_owner
  github_repo       = var.github_repo
  oidc_provider_arn = data.aws_iam_openid_connect_provider.github.arn

  github_oidc_subject_prefix = var.github_oidc_subject_prefix
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider the roles trust"
  value       = data.aws_iam_openid_connect_provider.github.arn
}

# Read by the github environment, which stores them as AWS_ROLE secrets.
output "prod_ro_role_arn" {
  description = "ARN of the read-only CI role (prod-ro environment)"
  value       = module.iac_roles.prod_ro_role_arn
}

output "prod_rw_role_arn" {
  description = "ARN of the read-write CI role (prod-rw environment)"
  value       = module.iac_roles.prod_rw_role_arn
}
