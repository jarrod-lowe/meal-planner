# REST API built from openapi.yaml (DESIGN §5, §8.2), served by CloudFront
# under /api/* from the stage named `api`.
#
# Access logging needs the account's API Gateway CloudWatch role
# (`aws_api_gateway_account`). That's an account-wide singleton already set by
# dnd-planner, so it isn't declared here.

locals {
  api_name = "${local.resource_prefix}-api"

  # openapi.yaml shares pieces of its operations through YAML anchors under
  # `x-shared`. Decoding resolves them, and the block itself is dropped, so
  # API Gateway imports plain JSON with nothing it doesn't know.
  openapi = yamldecode(templatefile("${path.module}/openapi.yaml", {
    cognito_user_pool_arn       = aws_cognito_user_pool.users.arn
    holidays_lambda_invoke_arn  = module.holidays.invoke_arn
    users_lambda_invoke_arn     = module.users.invoke_arn
    catalogue_lambda_invoke_arn = module.catalogue.invoke_arn
  }))

  # Nullable properties (VersionConflictError.current, Meal.recipeId and so
  # on) are `nullable` (OpenAPI 3.0) in openapi.yaml, so openapi-typescript
  # allows null. API Gateway's models are JSON Schema draft-04, which has no
  # `nullable`, so the imported body says the same with a type list instead.
  # This covers every component schema's direct properties; HCL can't recurse,
  # so a nullable anywhere deeper would need adding here. A nullable property
  # can't be a $ref, since draft-04 ignores keywords beside one.
  #
  # The for expressions (rather than conditionals) let each property keep its
  # own object shape.
  openapi_schemas = {
    for name, schema in local.openapi.components.schemas : name => merge(schema, {
      for key in can(schema.properties) ? ["properties"] : [] : key => {
        for prop, s in schema.properties : prop => merge(
          { for k, v in s : k => v if k != "nullable" },
          { for k in try(s.nullable, false) ? ["type"] : [] : k => [s.type, "null"] },
        )
      }
    })
  }
  openapi_body = merge({ for k, v in local.openapi : k => v if k != "x-shared" }, {
    components = merge(local.openapi.components, { schemas = local.openapi_schemas })
  })
}

resource "aws_api_gateway_rest_api" "api" {
  name        = local.api_name
  description = "Meal planner API (${var.environment})"
  body        = jsonencode(local.openapi_body)

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_deployment" "api" {
  rest_api_id = aws_api_gateway_rest_api.api.id

  triggers = {
    redeployment = sha256(aws_api_gateway_rest_api.api.body)
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.api_name}/access"
  retention_in_days = 14
}

resource "aws_api_gateway_stage" "api" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  deployment_id = aws_api_gateway_deployment.api.id
  stage_name    = "api"

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      resourcePath       = "$context.resourcePath"
      status             = "$context.status"
      responseLength     = "$context.responseLength"
      integrationLatency = "$context.integrationLatency"
      userSub            = "$context.authorizer.claims.sub"
      errorMessage       = "$context.error.message"
    })
  }
}

resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.api.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }
}
