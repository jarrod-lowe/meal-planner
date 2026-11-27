# Users sign in on the app's own /login page with SRP (DESIGN §7.5, §8.3).
# There is no identity pool, no hosted login domain and no OAuth.

resource "aws_cognito_user_pool" "users" {
  name                     = local.resource_prefix
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = local.is_prod ? "ACTIVE" : "INACTIVE"

  # Admins create every account (`make create-user`); Cognito's own email
  # sends the temporary password.
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Your Meal planner account"
      email_message = "You've been invited to Meal planner at ${local.site_url}. Sign in with {username} and the temporary password {####}, then choose your own password."
      sms_message   = "Meal planner: sign in at ${local.site_url} with {username} and the temporary password {####}."
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Length only, with no character-class rules (DESIGN §8.3).
  password_policy {
    minimum_length                   = 12
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # Forgotten passwords are reset by a code sent to the verified email.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # A changed email isn't used until the user verifies it.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # The display name. Constraints are Cognito's defaults for standard
  # attributes, so plans don't show a perpetual diff.
  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.resource_prefix}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # A browser app can't keep a secret.
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Sign-in is SRP from the app's own page, not the OAuth hosted UI.
  allowed_oauth_flows_user_pool_client = false

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
