output "function_name" {
  description = "Name of the function"
  value       = aws_lambda_function.this.function_name
}

output "arn" {
  description = "ARN of the function"
  value       = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "Invoke ARN of the function, for the API Gateway integration"
  value       = aws_lambda_function.this.invoke_arn
}

output "role_name" {
  description = "Name of the function's IAM role"
  value       = aws_iam_role.this.name
}

output "policy" {
  description = "JSON of the role's inline policy"
  value       = aws_iam_role_policy.app.policy
}

output "api_source_arn" {
  description = "The API Gateway source ARN allowed to invoke the function"
  value       = aws_lambda_permission.api.source_arn
}
