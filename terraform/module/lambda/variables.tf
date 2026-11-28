variable "name" {
  description = "Function name, also used for its role and log group"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the function"
  type        = map(string)
  default     = {}
}

variable "policy" {
  description = "JSON of the role's least-privilege inline policy (beyond writing its own logs)"
  type        = string
}

variable "api_execution_arn" {
  description = "Execution ARN of the REST API allowed to invoke the function"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention, in days"
  type        = number
  default     = 14
}
