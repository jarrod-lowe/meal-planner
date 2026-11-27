# IAM roles for GitHub Actions, one per GitHub environment. Each role trusts
# OIDC tokens only from its own environment in this repository. Unlike
# dnd-planner, the read-only role can't assume the read-write role.

locals {
  roles = {
    ro = {
      environment = "prod-ro"
      policy_arn  = "arn:aws:iam::aws:policy/ReadOnlyAccess"
    }
    rw = {
      environment = "prod-rw"
      policy_arn  = "arn:aws:iam::aws:policy/AdministratorAccess"
    }
  }
}

resource "aws_iam_role" "this" {
  for_each = local.roles

  name        = "${var.project}-prod-iac-${each.key}"
  description = "GitHub Actions, ${each.value.environment} environment of ${var.github_owner}/${var.github_repo}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = var.oidc_provider_arn }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "${var.github_oidc_subject_prefix}:environment:${each.value.environment}"
          }
        }
      },
    ]
  })

  tags = {
    access = "oidc"
  }
}

resource "aws_iam_role_policy_attachment" "this" {
  for_each = local.roles

  role       = aws_iam_role.this[each.key].name
  policy_arn = each.value.policy_arn
}

# The attachment above is the role's only managed policy; anything else
# attached outside Terraform is removed.
resource "aws_iam_role_policy_attachments_exclusive" "this" {
  for_each = local.roles

  role_name   = aws_iam_role.this[each.key].name
  policy_arns = [each.value.policy_arn]

  depends_on = [aws_iam_role_policy_attachment.this]
}

# No inline policies at all; any added outside Terraform are removed.
resource "aws_iam_role_policies_exclusive" "this" {
  for_each = local.roles

  role_name    = aws_iam_role.this[each.key].name
  policy_names = []
}
