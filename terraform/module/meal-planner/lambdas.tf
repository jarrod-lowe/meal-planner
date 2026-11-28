# The Go Lambdas (DESIGN §6), each from the reusable lambda module with its
# own role, log group and least-privilege policy. Terraform creates them from
# a placeholder; `make deploy-lambdas` deploys the real code.

locals {
  lambda_environment = {
    holidays = { TABLE_NAME = aws_dynamodb_table.data.name }
    users    = { USER_POOL_ID = aws_cognito_user_pool.users.id }
  }
}

module "holidays" {
  source = "../lambda"

  name                  = "${local.resource_prefix}-holidays"
  environment_variables = local.lambda_environment.holidays
  api_execution_arn     = aws_api_gateway_rest_api.api.execution_arn

  # TransactWriteItems isn't an IAM action: DynamoDB authorises each item in a
  # transaction as its own PutItem, DeleteItem or ConditionCheckItem.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
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
        Resource = aws_dynamodb_table.data.arn
      },
      {
        Sid      = "Gsi1"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "${aws_dynamodb_table.data.arn}/index/gsi1"
      },
    ]
  })
}

module "users" {
  source = "../lambda"

  name                  = "${local.resource_prefix}-users"
  environment_variables = local.lambda_environment.users
  api_execution_arn     = aws_api_gateway_rest_api.api.execution_arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ListUsers"
      Effect   = "Allow"
      Action   = ["cognito-idp:ListUsers"]
      Resource = aws_cognito_user_pool.users.arn
    }]
  })
}
