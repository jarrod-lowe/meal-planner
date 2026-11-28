# Plan-only checks that every API route (DESIGN §5.1) is in the rendered
# OpenAPI body, signed-in only, and proxied to the right Lambda. The providers
# are mocked, so no AWS calls are made.

mock_provider "aws" {
  override_during = plan

  mock_resource "aws_cognito_user_pool" {
    defaults = {
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

override_resource {
  target          = module.holidays.aws_lambda_function.this
  override_during = plan
  values = {
    invoke_arn = "arn:aws:apigateway:ap-southeast-2:lambda:path/2015-03-31/functions/holidays/invocations"
  }
}

override_resource {
  target          = module.users.aws_lambda_function.this
  override_during = plan
  values = {
    invoke_arn = "arn:aws:apigateway:ap-southeast-2:lambda:path/2015-03-31/functions/users/invocations"
  }
}

override_resource {
  target          = module.catalogue.aws_lambda_function.this
  override_during = plan
  values = {
    invoke_arn = "arn:aws:apigateway:ap-southeast-2:lambda:path/2015-03-31/functions/catalogue/invocations"
  }
}

variables {
  environment = "test"
  domain      = "wildsea.lowe.kiwi"
  host        = "meal-planner-test"
}

run "every_route_is_signed_in_and_proxied_to_its_lambda" {
  command = plan

  # [path, method, lambda] for each route built so far.
  assert {
    condition = [
      for r in [
        ["/holidays", "get", "holidays"],
        ["/holidays/{holidayId}", "put", "holidays"],
        ["/holidays/{holidayId}", "get", "holidays"],
        ["/holidays/{holidayId}", "delete", "holidays"],
        ["/holidays/{holidayId}/members/{userSub}", "put", "holidays"],
        ["/holidays/{holidayId}/members/{userSub}", "delete", "holidays"],
        ["/holidays/{holidayId}/attendees/{id}", "put", "holidays"],
        # Needed as well as the generic route: API Gateway prefers the static
        # attendees segment over {kind}.
        ["/holidays/{holidayId}/attendees/{id}", "delete", "holidays"],
        ["/holidays/{holidayId}/{kind}/{id}", "delete", "holidays"],
        ["/users", "get", "users"],
        ["/catalogue", "get", "catalogue"],
        ["/catalogue/recipes/{id}", "put", "catalogue"],
        ["/catalogue/ingredients/{id}", "put", "catalogue"],
        # Needed as well as the generic route: API Gateway prefers the static
        # recipes and ingredients segments over {kind}.
        ["/catalogue/recipes/{id}", "delete", "catalogue"],
        ["/catalogue/ingredients/{id}", "delete", "catalogue"],
        ["/catalogue/{kind}/{id}", "delete", "catalogue"],
      ] : "${upper(r[1])} ${r[0]}"
      if !can(yamldecode(aws_api_gateway_rest_api.api.body).paths[r[0]][r[1]])
    ] == []
    error_message = "Every route built so far must be in the OpenAPI body"
  }

  assert {
    condition = alltrue(flatten([
      for path, ops in yamldecode(aws_api_gateway_rest_api.api.body).paths : [
        for method, op in ops : op.security == [{ CognitoAuthorizer = [] }]
        if method != "parameters"
      ] if path != "/health"
    ]))
    error_message = "Every route but /health must require the Cognito authoriser"
  }

  assert {
    condition = alltrue(flatten([
      for path, ops in yamldecode(aws_api_gateway_rest_api.api.body).paths : [
        for method, op in ops : (
          op["x-amazon-apigateway-integration"].type == "aws_proxy" &&
          op["x-amazon-apigateway-integration"].httpMethod == "POST" &&
          op["x-amazon-apigateway-integration"].uri == "arn:aws:apigateway:ap-southeast-2:lambda:path/2015-03-31/functions/${path == "/users" ? "users" : startswith(path, "/catalogue") ? "catalogue" : "holidays"}/invocations"
        )
        if method != "parameters"
      ] if path != "/health"
    ]))
    error_message = "Every route but /health must be an aws_proxy POST to its Lambda (/users to users, /catalogue to catalogue, the rest to holidays)"
  }

  assert {
    condition = alltrue(flatten([
      for path, ops in yamldecode(aws_api_gateway_rest_api.api.body).paths : [
        for method, op in ops : op["x-amazon-apigateway-request-validator"] == "all"
        if method != "parameters"
      ] if path != "/health"
    ]))
    error_message = "Every route but /health must validate its body and parameters"
  }
}

run "lambdas_may_be_invoked_only_by_this_api" {
  command = plan

  override_resource {
    target          = aws_api_gateway_rest_api.api
    override_during = plan
    values = {
      execution_arn = "arn:aws:execute-api:ap-southeast-2:123456789012:abc123"
    }
  }

  assert {
    condition = [module.holidays.api_source_arn, module.users.api_source_arn, module.catalogue.api_source_arn] == [
      "arn:aws:execute-api:ap-southeast-2:123456789012:abc123/*/*",
      "arn:aws:execute-api:ap-southeast-2:123456789012:abc123/*/*",
      "arn:aws:execute-api:ap-southeast-2:123456789012:abc123/*/*",
    ]
    error_message = "Each Lambda must be invokable only by this API"
  }
}

run "version_conflict_current_may_be_null_in_draft_04" {
  command = plan

  # openapi.yaml marks it `nullable` (OpenAPI 3.0) for openapi-typescript.
  # API Gateway's models are draft-04, which has no `nullable`, so the body
  # it imports says the same thing with a type list.
  assert {
    condition = yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.VersionConflictError.properties.current == {
      type = ["object", "null"]
    }
    error_message = "VersionConflictError.current must be an object or null, in draft-04 terms"
  }

  assert {
    condition     = local.openapi.components.schemas.VersionConflictError.properties.current.nullable == true
    error_message = "openapi.yaml must mark VersionConflictError.current nullable, so the generated type allows null"
  }
}

run "catalogue_schemas_keep_section_order_and_positive_quantities" {
  command = plan

  # DESIGN §2.1: the enum's order is the order sections appear on a list.
  assert {
    condition = yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.ShopSection.enum == [
      "produce", "bakery", "meat-fish", "dairy", "frozen",
      "pantry", "drinks", "household", "other",
    ]
    error_message = "ShopSection must list DESIGN §2.1's sections, in order"
  }

  # Draft-04 (API Gateway) and OpenAPI 3.0 (openapi-typescript) both spell
  # "> 0" as a minimum with a boolean exclusiveMinimum.
  assert {
    condition = yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.PositiveNumber == {
      type             = "number"
      minimum          = 0
      exclusiveMinimum = true
    }
    error_message = "PositiveNumber must be a number > 0, in draft-04 terms"
  }

  assert {
    condition = [
      for s in [
        yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.RecipeLine.properties.quantity,
        yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.Recipe.properties.servings,
        yamldecode(aws_api_gateway_rest_api.api.body).components.schemas.RecipeInput.properties.servings,
      ] : s["$ref"]
    ] == [for i in range(3) : "#/components/schemas/PositiveNumber"]
    error_message = "Recipe servings and line quantities must be PositiveNumbers"
  }
}
