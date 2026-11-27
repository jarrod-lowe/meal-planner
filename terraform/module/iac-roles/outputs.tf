output "prod_ro_role_arn" {
  description = "ARN of the read-only role, for the prod-ro GitHub environment"
  value       = aws_iam_role.this["ro"].arn
}

output "prod_rw_role_arn" {
  description = "ARN of the read-write role, for the prod-rw GitHub environment"
  value       = aws_iam_role.this["rw"].arn
}
