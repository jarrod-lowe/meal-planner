# Read by Make (`terraform output -json` into output.json) for .env.local, the
# UI build, push-ui and create-user, and by CI for the prod deploy.

output "region" {
  description = "AWS region the app runs in"
  value       = module.meal_planner.region
}

output "site_domain" {
  description = "The site's host name"
  value       = module.meal_planner.site_domain
}

output "site_url" {
  description = "The site's URL"
  value       = module.meal_planner.site_url
}

output "ui_bucket_name" {
  description = "S3 bucket the UI build is uploaded to"
  value       = module.meal_planner.ui_bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID, for invalidations"
  value       = module.meal_planner.cloudfront_distribution_id
}

output "user_pool_id" {
  description = "Cognito user pool ID (VITE_USER_POOL_ID)"
  value       = module.meal_planner.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito web client ID (VITE_USER_POOL_CLIENT_ID)"
  value       = module.meal_planner.user_pool_client_id
}

output "api_id" {
  description = "API Gateway REST API ID"
  value       = module.meal_planner.api_id
}

output "table_name" {
  description = "DynamoDB table name"
  value       = module.meal_planner.table_name
}

output "lambda_function_names" {
  description = "Lambda function names, by Lambda (for make deploy-lambdas)"
  value       = module.meal_planner.lambda_function_names
}
