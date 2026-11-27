# Plan-only checks of the AWS bootstrap environment. The provider is mocked,
# so no AWS calls are made.

mock_provider "aws" {
  override_data {
    target = data.aws_iam_openid_connect_provider.github
    values = {
      arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    }
  }
}

variables {
  project      = "meal-planner"
  github_owner = "example-owner"
  github_repo  = "meal-planner"
}

# dnd-planner's state owns the account's GitHub OIDC provider, so this
# environment only looks it up.
run "oidc_provider_is_looked_up_not_managed" {
  command = plan

  assert {
    condition     = data.aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com"
    error_message = "The GitHub OIDC provider must be looked up by its URL"
  }

  assert {
    condition     = output.github_oidc_provider_arn == "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    error_message = "The roles must trust the looked-up OIDC provider"
  }
}
