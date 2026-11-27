variable "project" {
  description = "Project name, used as the role name prefix"
  type        = string
}

variable "github_owner" {
  description = "GitHub owner (user or organisation) of the repository"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of the account's GitHub Actions OIDC provider"
  type        = string
}

variable "github_oidc_subject_prefix" {
  description = "The repository's OIDC `sub` prefix. This repository uses GitHub's immutable subject (`repo:<owner>@<owner id>/<repo>@<repo id>`), which survives renames."
  type        = string
}
