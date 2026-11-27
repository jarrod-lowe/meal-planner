# Plan-only checks of the CI roles' trust and permissions. The provider is
# mocked, so no AWS calls are made.

mock_provider "aws" {}

variables {
  project           = "meal-planner"
  github_owner      = "example-owner"
  github_repo       = "meal-planner"
  oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  # GitHub's immutable subject: owner and repository IDs, not just names.
  github_oidc_subject_prefix = "repo:example-owner@111/meal-planner@222"
}

run "roles_are_named_per_access_level" {
  command = plan

  assert {
    condition     = aws_iam_role.this["ro"].name == "meal-planner-prod-iac-ro"
    error_message = "The read-only role must be meal-planner-prod-iac-ro"
  }

  assert {
    condition     = aws_iam_role.this["rw"].name == "meal-planner-prod-iac-rw"
    error_message = "The read-write role must be meal-planner-prod-iac-rw"
  }
}

run "ro_trusts_only_the_prod_ro_environment" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.this["ro"].assume_role_policy).Statement == [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = var.oidc_provider_arn }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:example-owner@111/meal-planner@222:environment:prod-ro"
          }
        }
      },
    ]
    error_message = "The read-only role must trust only GitHub OIDC tokens for the prod-ro environment"
  }
}

run "rw_trusts_only_the_prod_rw_environment" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.this["rw"].assume_role_policy).Statement == [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = var.oidc_provider_arn }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:example-owner@111/meal-planner@222:environment:prod-rw"
          }
        }
      },
    ]
    error_message = "The read-write role must trust only GitHub OIDC tokens for the prod-rw environment"
  }
}

run "ro_has_only_read_only_access" {
  command = plan

  assert {
    condition     = aws_iam_role_policy_attachment.this["ro"].policy_arn == "arn:aws:iam::aws:policy/ReadOnlyAccess"
    error_message = "The read-only role must have ReadOnlyAccess attached"
  }

  # Exclusive management: no other managed policy can be attached, and no
  # inline policy (such as one allowing sts:AssumeRole on the rw role) can
  # exist, even if added outside Terraform.
  assert {
    condition     = aws_iam_role_policy_attachments_exclusive.this["ro"].policy_arns == toset(["arn:aws:iam::aws:policy/ReadOnlyAccess"])
    error_message = "ReadOnlyAccess must be the read-only role's only managed policy"
  }

  assert {
    condition     = length(aws_iam_role_policies_exclusive.this["ro"].policy_names) == 0
    error_message = "The read-only role must have no inline policies, so it can't assume the read-write role"
  }
}

run "rw_has_administrator_access" {
  command = plan

  assert {
    condition     = aws_iam_role_policy_attachment.this["rw"].policy_arn == "arn:aws:iam::aws:policy/AdministratorAccess"
    error_message = "The read-write role must have AdministratorAccess attached"
  }

  assert {
    condition     = aws_iam_role_policy_attachments_exclusive.this["rw"].policy_arns == toset(["arn:aws:iam::aws:policy/AdministratorAccess"])
    error_message = "AdministratorAccess must be the read-write role's only managed policy"
  }
}
