# Plan-only checks of the holidays, users and catalogue functions' configuration and
# least-privilege policies (DESIGN §6). The function itself (runtime, memory,
# logs) is tested in the lambda module. The providers are mocked, so no AWS
# calls are made.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_dynamodb_table" {
    defaults = {
      arn = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/meal-planner-test-data"
    }
  }

  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id  = "ap-southeast-2_example"
      arn = "arn:aws:cognito-idp:ap-southeast-2:123456789012:userpool/ap-southeast-2_example"
    }
  }

  override_data {
    target = data.aws_region.current
    values = {
      region = "ap-southeast-2"
    }
  }
}

mock_provider "aws" {
  alias           = "us-east-1"
  override_during = plan

  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/example"
    }
  }
}

variables {
  environment = "test"
  domain      = "wildsea.lowe.kiwi"
  host        = "meal-planner-test"
}

run "functions_are_named_from_the_prefix" {
  command = plan

  assert {
    condition = output.lambda_function_names == {
      holidays  = "meal-planner-test-holidays"
      users     = "meal-planner-test-users"
      catalogue = "meal-planner-test-catalogue"
    }
    error_message = "lambda_function_names must map each Lambda to its function name"
  }
}

run "holidays_gets_the_table_name" {
  command = plan

  assert {
    condition     = local.lambda_environment.holidays == { TABLE_NAME = "meal-planner-test-data" }
    error_message = "The holidays function must get TABLE_NAME, and nothing else"
  }
}

run "users_gets_the_user_pool_id" {
  command = plan

  assert {
    condition     = local.lambda_environment.users == { USER_POOL_ID = "ap-southeast-2_example" }
    error_message = "The users function must get USER_POOL_ID, and nothing else"
  }
}

run "holidays_may_use_only_the_table_and_gsi1" {
  command = plan

  assert {
    condition = jsondecode(module.holidays.policy).Statement == [
      {
        Sid    = "Table"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
        ]
        Resource = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/meal-planner-test-data"
      },
      {
        Sid      = "Gsi1"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/meal-planner-test-data/index/gsi1"
      },
    ]
    error_message = "The holidays function must have only §6's table actions, on the table and gsi1"
  }
}

run "users_may_only_list_users_in_the_pool" {
  command = plan

  assert {
    condition = jsondecode(module.users.policy).Statement == [{
      Sid      = "ListUsers"
      Effect   = "Allow"
      Action   = ["cognito-idp:ListUsers"]
      Resource = "arn:aws:cognito-idp:ap-southeast-2:123456789012:userpool/ap-southeast-2_example"
    }]
    error_message = "The users function may only call cognito-idp:ListUsers on the pool"
  }
}

run "catalogue_gets_the_table_name" {
  command = plan

  assert {
    condition     = local.lambda_environment.catalogue == { TABLE_NAME = "meal-planner-test-data" }
    error_message = "The catalogue function must get TABLE_NAME, and nothing else"
  }
}

run "catalogue_may_get_put_and_query_only_the_table" {
  command = plan

  assert {
    condition = jsondecode(module.catalogue.policy).Statement == [{
      Sid    = "Table"
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
      ]
      Resource = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/meal-planner-test-data"
    }]
    error_message = "The catalogue function must have only §6's table actions (GetItem, PutItem, Query), on the table only"
  }
}
