# Plan-only checks of the state bucket's security settings. The provider is
# mocked, so no AWS calls are made.

mock_provider "aws" {}

variables {
  bucket_name = "meal-planner-iac-state-123456789012"
}

run "bucket_is_named_from_input" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.bucket == "meal-planner-iac-state-123456789012"
    error_message = "The bucket must use the given name"
  }
}

run "bucket_is_encrypted" {
  command = plan

  assert {
    condition = alltrue([
      for rule in aws_s3_bucket_server_side_encryption_configuration.state.rule :
      alltrue([
        for d in rule.apply_server_side_encryption_by_default : d.sse_algorithm == "AES256"
      ])
    ])
    error_message = "The bucket must have SSE-S3 default encryption"
  }

  assert {
    condition     = length(aws_s3_bucket_server_side_encryption_configuration.state.rule) == 1
    error_message = "The bucket must have exactly one encryption rule"
  }
}

run "bucket_is_versioned" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning must be enabled"
  }
}

run "public_access_is_blocked" {
  command = plan

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.state.block_public_acls,
      aws_s3_bucket_public_access_block.state.block_public_policy,
      aws_s3_bucket_public_access_block.state.ignore_public_acls,
      aws_s3_bucket_public_access_block.state.restrict_public_buckets,
    ])
    error_message = "All four public access block settings must be on"
  }
}

run "policy_denies_insecure_transport" {
  command = plan

  assert {
    condition = anytrue([
      for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement :
      s.Effect == "Deny"
      && s.Principal == "*"
      && s.Action == "s3:*"
      && s.Condition.Bool["aws:SecureTransport"] == "false"
      && toset(s.Resource) == toset([
        "arn:aws:s3:::meal-planner-iac-state-123456789012",
        "arn:aws:s3:::meal-planner-iac-state-123456789012/*",
      ])
    ])
    error_message = "The bucket policy must deny all S3 actions over plain HTTP, on the bucket and its objects"
  }
}
