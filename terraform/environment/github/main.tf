terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }

  # bucket, key and region come from Make (-backend-config).
  backend "s3" {
    use_lockfile = true
  }
}

variable "project" {
  description = "Project name, used in the aws environment's state key"
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

variable "state_bucket" {
  description = "Name of the Terraform state bucket"
  type        = string
}

provider "aws" {}

# Reads GITHUB_TOKEN, which Make sets from `gh auth token`.
provider "github" {
  owner = var.github_owner
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# The CI role ARNs come from the aws environment's outputs, so the role names
# are defined in one place.
data "terraform_remote_state" "aws" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "${var.project}/aws/terraform.tfstate"
    region = data.aws_region.current.region
  }
}

locals {
  # Branch protection, rulesets and labels are managed outside Terraform (see
  # docs/plans/PHASE_1.md); this environment manages only these.
  environments = {
    # Terraform plan on pull requests, from any branch.
    "prod-ro" = {
      role_arn                = data.terraform_remote_state.aws.outputs.prod_ro_role_arn
      protected_branches_only = false
    }
    # Terraform apply on merge, from protected branches only.
    "prod-rw" = {
      role_arn                = data.terraform_remote_state.aws.outputs.prod_rw_role_arn
      protected_branches_only = true
    }
  }

  variables = {
    AWS_ACCOUNT  = data.aws_caller_identity.current.account_id
    AWS_REGION   = data.aws_region.current.region
    STATE_BUCKET = var.state_bucket
  }

  # One entry per environment and variable, keyed "<environment>/<name>".
  environment_variables = {
    for pair in setproduct(keys(local.environments), keys(local.variables)) :
    "${pair[0]}/${pair[1]}" => {
      environment = pair[0]
      name        = pair[1]
      value       = local.variables[pair[1]]
    }
  }
}

resource "github_repository_environment" "this" {
  for_each = local.environments

  repository  = var.github_repo
  environment = each.key

  dynamic "deployment_branch_policy" {
    for_each = each.value.protected_branches_only ? [1] : []

    content {
      protected_branches     = true
      custom_branch_policies = false
    }
  }
}

resource "github_actions_environment_variable" "this" {
  for_each = local.environment_variables

  repository    = var.github_repo
  environment   = github_repository_environment.this[each.value.environment].environment
  variable_name = each.value.name
  value         = each.value.value
}

resource "github_actions_environment_secret" "aws_role" {
  for_each = local.environments

  repository  = var.github_repo
  environment = github_repository_environment.this[each.key].environment
  secret_name = "AWS_ROLE"
  value       = each.value.role_arn
}
