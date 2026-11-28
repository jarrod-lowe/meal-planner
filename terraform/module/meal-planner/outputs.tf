output "region" {
  description = "AWS region the app runs in"
  value       = data.aws_region.current.region
}

output "site_domain" {
  description = "The site's host name"
  value       = local.site_domain
}

output "site_url" {
  description = "The site's URL"
  value       = local.site_url
}

output "ui_bucket_name" {
  description = "S3 bucket the UI build is uploaded to"
  value       = aws_s3_bucket.ui.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID, for invalidations"
  value       = aws_cloudfront_distribution.site.id
}

output "user_pool_id" {
  description = "Cognito user pool ID (VITE_USER_POOL_ID)"
  value       = aws_cognito_user_pool.users.id
}

output "user_pool_client_id" {
  description = "Cognito web client ID (VITE_USER_POOL_CLIENT_ID)"
  value       = aws_cognito_user_pool_client.web.id
}

output "api_id" {
  description = "API Gateway REST API ID"
  value       = aws_api_gateway_rest_api.api.id
}

output "table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.data.name
}

output "lambda_function_names" {
  description = "Lambda function names, by Lambda (for make deploy-lambdas)"
  value = {
    holidays = module.holidays.function_name
    users    = module.users.function_name
  }
}
