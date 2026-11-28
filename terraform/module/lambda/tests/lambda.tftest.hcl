# Plan-only checks of one Lambda function and its role, log group and API
# permission. The AWS provider is mocked, so no AWS calls are made. The
# archive provider is real: it writes the placeholder zip during plan.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ap-southeast-2:123456789012:log-group:/aws/lambda/meal-planner-test-example"
    }
  }
}

variables {
  name                  = "meal-planner-test-example"
  environment_variables = { TABLE_NAME = "meal-planner-test-data" }
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem"]
      Resource = "arn:aws:dynamodb:ap-southeast-2:123456789012:table/meal-planner-test-data"
    }]
  })
  api_execution_arn = "arn:aws:execute-api:ap-southeast-2:123456789012:abc123"
}

run "function_is_arm64_al2023_128mb_10s" {
  command = plan

  assert {
    condition     = aws_lambda_function.this.function_name == "meal-planner-test-example"
    error_message = "The function must be named from var.name"
  }

  assert {
    condition     = aws_lambda_function.this.runtime == "provided.al2023"
    error_message = "The runtime must be provided.al2023"
  }

  assert {
    condition     = aws_lambda_function.this.architectures == tolist(["arm64"])
    error_message = "The function must run on arm64"
  }

  assert {
    condition     = aws_lambda_function.this.handler == "bootstrap"
    error_message = "The handler must be bootstrap"
  }

  assert {
    condition     = aws_lambda_function.this.memory_size == 128
    error_message = "The function must have 128 MB"
  }

  assert {
    condition     = aws_lambda_function.this.timeout == 10
    error_message = "The function must time out after 10 s"
  }

  assert {
    condition     = aws_lambda_function.this.environment[0].variables == tomap({ TABLE_NAME = "meal-planner-test-data" })
    error_message = "The function must get the given environment variables"
  }

  assert {
    condition     = aws_lambda_function.this.logging_config[0].log_format == "JSON"
    error_message = "The function must log in JSON"
  }

  assert {
    condition     = aws_lambda_function.this.logging_config[0].log_group == "/aws/lambda/meal-planner-test-example"
    error_message = "The function must log to its own log group"
  }
}

run "function_starts_from_a_placeholder_zip" {
  command = plan

  assert {
    condition     = aws_lambda_function.this.filename == data.archive_file.placeholder.output_path
    error_message = "The function must be created from the placeholder zip"
  }

  assert {
    condition     = endswith(data.archive_file.placeholder.output_path, "/build/meal-planner-test-example.zip")
    error_message = "The placeholder zip must go in the module's (gitignored) build directory"
  }
}

run "logs_are_kept_14_days" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.this.name == "/aws/lambda/meal-planner-test-example"
    error_message = "The log group must be the function's default one"
  }

  assert {
    condition     = aws_cloudwatch_log_group.this.retention_in_days == 14
    error_message = "Logs must be kept for 14 days by default"
  }
}

run "log_retention_can_be_changed" {
  command = plan

  variables {
    log_retention_days = 30
  }

  assert {
    condition     = aws_cloudwatch_log_group.this.retention_in_days == 30
    error_message = "log_retention_days must set the retention"
  }
}

run "role_is_assumable_only_by_lambda" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role.this.assume_role_policy).Statement == [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
    error_message = "Only Lambda may assume the function's role"
  }
}

run "role_may_write_only_to_its_own_log_group" {
  command = plan

  assert {
    condition = jsondecode(aws_iam_role_policy.logs.policy).Statement == [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:ap-southeast-2:123456789012:log-group:/aws/lambda/meal-planner-test-example:*"
    }]
    error_message = "The logging policy must allow writing only to the function's log group"
  }
}

run "role_has_the_given_policy" {
  command = plan

  assert {
    condition     = jsondecode(aws_iam_role_policy.app.policy) == jsondecode(var.policy)
    error_message = "The role must have the given inline policy"
  }

  assert {
    condition     = output.policy == var.policy
    error_message = "The module must output its inline policy"
  }
}

run "api_gateway_may_invoke_from_this_api_only" {
  command = plan

  assert {
    condition     = aws_lambda_permission.api.principal == "apigateway.amazonaws.com"
    error_message = "The permission must be for API Gateway"
  }

  assert {
    condition     = aws_lambda_permission.api.action == "lambda:InvokeFunction"
    error_message = "The permission must allow only invoking"
  }

  assert {
    condition     = aws_lambda_permission.api.source_arn == "arn:aws:execute-api:ap-southeast-2:123456789012:abc123/*/*"
    error_message = "The permission must be scoped to this API's stages and methods"
  }
}
