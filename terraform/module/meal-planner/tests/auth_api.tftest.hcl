# Plan-only checks of the user pool and the API. The providers are mocked, so
# no AWS calls are made. `override_during = plan` makes the mocked values
# below (and the data sources) known at plan time.

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

  # Known at plan, so the validation records' for_each can be planned.
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

run "only_admins_create_users" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.users.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "Only admins may create users (no self sign-up)"
  }
}

run "users_sign_in_by_email_with_a_name" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.users.username_attributes == toset(["email"])
    error_message = "Users must sign in with their email address"
  }

  assert {
    condition     = aws_cognito_user_pool.users.auto_verified_attributes == toset(["email"])
    error_message = "Email must be auto-verified, so password resets can use it"
  }

  assert {
    condition     = anytrue([for s in aws_cognito_user_pool.users.schema : s.name == "name" && s.required])
    error_message = "The name attribute must be required"
  }
}

run "passwords_are_at_least_12_characters_and_mfa_is_off" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.users.password_policy[0].minimum_length == 12
    error_message = "Passwords must be at least 12 characters"
  }

  assert {
    condition     = aws_cognito_user_pool.users.mfa_configuration == "OFF"
    error_message = "MFA must be off"
  }
}

run "test_pool_can_be_deleted" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.users.deletion_protection == "INACTIVE"
    error_message = "The test user pool must not have deletion protection"
  }
}

run "prod_pool_is_protected_from_deletion" {
  command = plan

  variables {
    environment = "prod"
    host        = "meal-planner"
  }

  assert {
    condition     = aws_cognito_user_pool.users.deletion_protection == "ACTIVE"
    error_message = "The prod user pool must have deletion protection"
  }
}

run "web_client_is_public_srp_only" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.web.generate_secret == false
    error_message = "The web client is public, so it must have no secret"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.explicit_auth_flows == toset(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"])
    error_message = "The web client must allow only SRP and refresh-token auth"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED"
    error_message = "Sign-in errors must not reveal whether a user exists"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.allowed_oauth_flows_user_pool_client == false
    error_message = "The web client must not use OAuth"
  }
}

run "refresh_tokens_last_30_days" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.web.refresh_token_validity == 30
    error_message = "Refresh tokens must last 30"
  }

  assert {
    condition     = aws_cognito_user_pool_client.web.token_validity_units[0].refresh_token == "days"
    error_message = "Refresh token validity must be in days"
  }
}

run "api_stage_is_named_api" {
  command = plan

  assert {
    condition     = aws_api_gateway_stage.api.stage_name == "api"
    error_message = "The stage must be named api, so /api/health reaches the /health resource"
  }

  assert {
    condition     = aws_api_gateway_rest_api.api.endpoint_configuration[0].types == tolist(["REGIONAL"])
    error_message = "The API must be regional (CloudFront is in front of it)"
  }
}

run "api_is_throttled_to_20_per_second_burst_40" {
  command = plan

  assert {
    condition     = aws_api_gateway_method_settings.all.method_path == "*/*"
    error_message = "Throttling must apply to every method"
  }

  assert {
    condition     = aws_api_gateway_method_settings.all.settings[0].throttling_rate_limit == 20
    error_message = "The API must be throttled to 20 requests per second"
  }

  assert {
    condition     = aws_api_gateway_method_settings.all.settings[0].throttling_burst_limit == 40
    error_message = "The API burst limit must be 40"
  }
}

run "api_access_logs_are_kept_14_days" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.api_access.retention_in_days == 14
    error_message = "API access logs must be kept for 14 days"
  }

  assert {
    condition     = can(jsondecode(aws_api_gateway_stage.api.access_log_settings[0].format).requestId)
    error_message = "API access logs must be JSON, including the request ID"
  }
}

run "health_is_a_public_mock" {
  command = plan

  assert {
    condition     = yamldecode(aws_api_gateway_rest_api.api.body).paths["/health"].get.security == []
    error_message = "GET /health must be public"
  }

  assert {
    condition     = yamldecode(aws_api_gateway_rest_api.api.body).paths["/health"].get["x-amazon-apigateway-integration"].type == "mock"
    error_message = "GET /health must be a mock integration"
  }
}

run "cognito_authoriser_uses_the_user_pool" {
  command = plan

  assert {
    condition = yamldecode(aws_api_gateway_rest_api.api.body).components.securitySchemes.CognitoAuthorizer["x-amazon-apigateway-authorizer"].providerARNs == [
      "arn:aws:cognito-idp:ap-southeast-2:123456789012:userpool/ap-southeast-2_example",
    ]
    error_message = "The Cognito authoriser must trust this user pool"
  }

  assert {
    condition     = yamldecode(aws_api_gateway_rest_api.api.body).security == [{ CognitoAuthorizer = [] }]
    error_message = "Routes must require the Cognito authoriser unless they opt out"
  }
}
