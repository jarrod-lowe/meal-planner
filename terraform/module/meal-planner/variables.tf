variable "environment" {
  description = "Environment name, used in resource names"
  type        = string

  validation {
    condition     = contains(["test", "prod"], var.environment)
    error_message = "environment must be test or prod."
  }
}

variable "domain" {
  description = "Existing Route 53 hosted zone the site lives in (e.g. wildsea.lowe.kiwi)"
  type        = string
}

variable "host" {
  description = "Host name within the domain (e.g. meal-planner-test)"
  type        = string
}
