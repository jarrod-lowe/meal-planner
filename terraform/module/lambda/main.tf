# One Go Lambda function (DESIGN §6, §8.4): its own role, log group and API
# Gateway invoke permission.
#
# Terraform creates the function from a placeholder zip and then ignores code
# changes. Make builds the real binary and deploys it with
# `aws lambda update-function-code` (`make deploy-lambdas`), so plans never
# need a Go build.

terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.74"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
  }
}

locals {
  log_group_name = "/aws/lambda/${var.name}"
}

# Written during plan into the module's build/ directory, which is gitignored.
# Only its existence matters: the real code replaces it.
data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/build/${var.name}.zip"

  source {
    filename = "bootstrap"
    content  = "#!/bin/sh\necho 'Placeholder: run make deploy-lambdas' >&2\nexit 1\n"
  }
}

resource "aws_iam_role" "this" {
  name = var.name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group_name
  retention_in_days = var.log_retention_days
}

# The log group already exists, so the function needs no logs:CreateLogGroup.
# Streams are named by Lambda, so the resource has to cover all of them.
resource "aws_iam_role_policy" "logs" {
  name = "logs"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.this.arn}:*"
    }]
  })
}

resource "aws_iam_role_policy" "app" {
  name   = "app"
  role   = aws_iam_role.this.id
  policy = var.policy
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  role          = aws_iam_role.this.arn
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  handler       = "bootstrap"
  memory_size   = 128
  timeout       = 10

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = var.environment_variables
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.this.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  # The log group (with its retention) and the role's permissions exist before
  # the function can first run.
  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy.logs,
    aws_iam_role_policy.app,
  ]
}

# Separate from the API's own resources, so the API body can use the
# function's invoke ARN without a cycle.
resource "aws_lambda_permission" "api" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
