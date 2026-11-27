# Plan-only checks of the GitHub environments, variables and secrets. The
# providers and the aws environment's remote state are mocked, so no AWS or
# GitHub calls are made.

mock_provider "aws" {
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "123456789012" }
  }

  override_data {
    target = data.aws_region.current
    values = { region = "ap-southeast-2" }
  }
}

mock_provider "github" {}

override_data {
  target = data.terraform_remote_state.aws
  values = {
    outputs = {
      prod_ro_role_arn = "arn:aws:iam::123456789012:role/meal-planner-prod-iac-ro"
      prod_rw_role_arn = "arn:aws:iam::123456789012:role/meal-planner-prod-iac-rw"
    }
  }
}

variables {
  project      = "meal-planner"
  github_owner = "example-owner"
  github_repo  = "meal-planner"
  state_bucket = "meal-planner-iac-state-123456789012"
}

run "only_the_prod_environments_exist" {
  command = plan

  assert {
    condition     = toset(keys(github_repository_environment.this)) == toset(["prod-ro", "prod-rw"])
    error_message = "The environments must be exactly prod-ro and prod-rw"
  }

  assert {
    condition = alltrue([
      for name, env in github_repository_environment.this :
      env.environment == name && env.repository == "meal-planner"
    ])
    error_message = "Each environment must be named after its key, in this repository"
  }
}

run "prod_rw_deploys_only_from_protected_branches" {
  command = plan

  assert {
    condition     = github_repository_environment.this["prod-rw"].deployment_branch_policy[0].protected_branches == true
    error_message = "prod-rw must be limited to protected branches"
  }

  assert {
    condition     = github_repository_environment.this["prod-rw"].deployment_branch_policy[0].custom_branch_policies == false
    error_message = "prod-rw must not use custom branch policies"
  }

  # prod-ro plans on pull requests, so any branch may use it.
  assert {
    condition     = length(github_repository_environment.this["prod-ro"].deployment_branch_policy) == 0
    error_message = "prod-ro must not have a branch policy"
  }
}

run "each_environment_has_the_aws_variables" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for env in ["prod-ro", "prod-rw"] : [
        github_actions_environment_variable.this["${env}/AWS_ACCOUNT"].value == "123456789012",
        github_actions_environment_variable.this["${env}/AWS_REGION"].value == "ap-southeast-2",
        github_actions_environment_variable.this["${env}/STATE_BUCKET"].value == "meal-planner-iac-state-123456789012",
      ]
    ]))
    error_message = "Each environment must have AWS_ACCOUNT, AWS_REGION and STATE_BUCKET"
  }

  assert {
    condition = alltrue([
      for key, v in github_actions_environment_variable.this :
      key == "${v.environment}/${v.variable_name}" && v.repository == "meal-planner"
    ])
    error_message = "Each variable must be set on the environment and name in its key"
  }

  assert {
    condition     = length(github_actions_environment_variable.this) == 6
    error_message = "There must be exactly three variables per environment"
  }
}

run "each_environment_has_its_own_role" {
  command = plan

  assert {
    condition     = github_actions_environment_secret.aws_role["prod-ro"].value == "arn:aws:iam::123456789012:role/meal-planner-prod-iac-ro"
    error_message = "prod-ro's AWS_ROLE must be the read-only role"
  }

  assert {
    condition     = github_actions_environment_secret.aws_role["prod-rw"].value == "arn:aws:iam::123456789012:role/meal-planner-prod-iac-rw"
    error_message = "prod-rw's AWS_ROLE must be the read-write role"
  }

  assert {
    condition = alltrue([
      for name, s in github_actions_environment_secret.aws_role :
      s.secret_name == "AWS_ROLE" && s.environment == name && s.repository == "meal-planner"
    ])
    error_message = "Each environment must have an AWS_ROLE secret"
  }
}
