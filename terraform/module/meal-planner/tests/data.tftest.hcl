# Plan-only checks of the DynamoDB table (DESIGN §4). The providers are
# mocked, so no AWS calls are made.

mock_provider "aws" {
  override_during = plan

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

run "table_is_on_demand_with_pk_and_sk" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.data.name == "meal-planner-test-data"
    error_message = "The table must be named meal-planner-<env>-data"
  }

  assert {
    condition     = aws_dynamodb_table.data.billing_mode == "PAY_PER_REQUEST"
    error_message = "The table must be on-demand"
  }

  assert {
    condition     = aws_dynamodb_table.data.hash_key == "PK" && aws_dynamodb_table.data.range_key == "SK"
    error_message = "The table's keys must be PK (hash) and SK (range)"
  }

  assert {
    condition = { for a in aws_dynamodb_table.data.attribute : a.name => a.type } == {
      PK     = "S"
      SK     = "S"
      GSI1PK = "S"
      GSI1SK = "S"
    }
    error_message = "The key attributes must be PK, SK, GSI1PK and GSI1SK, all strings"
  }
}

run "gsi1_is_keys_only" {
  command = plan

  assert {
    condition     = length(aws_dynamodb_table.data.global_secondary_index) == 1
    error_message = "The table must have exactly one GSI"
  }

  assert {
    condition = one([
      for g in aws_dynamodb_table.data.global_secondary_index : g
      if g.name == "gsi1" && g.projection_type == "KEYS_ONLY" && [for k in g.key_schema : [k.attribute_name, k.key_type]] == [["GSI1PK", "HASH"], ["GSI1SK", "RANGE"]]
    ]) != null
    error_message = "gsi1 must be on GSI1PK and GSI1SK, with a keys-only projection"
  }
}

run "table_has_point_in_time_recovery" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.data.point_in_time_recovery[0].enabled == true
    error_message = "The table must have point-in-time recovery"
  }
}

run "test_table_can_be_deleted" {
  command = plan

  assert {
    condition     = aws_dynamodb_table.data.deletion_protection_enabled == false
    error_message = "The test table must not have deletion protection"
  }
}

run "prod_table_is_protected_from_deletion" {
  command = plan

  variables {
    environment = "prod"
    host        = "meal-planner"
  }

  assert {
    condition     = aws_dynamodb_table.data.name == "meal-planner-prod-data"
    error_message = "The prod table must be named meal-planner-prod-data"
  }

  assert {
    condition     = aws_dynamodb_table.data.deletion_protection_enabled == true
    error_message = "The prod table must have deletion protection"
  }
}

run "table_name_is_an_output" {
  command = plan

  assert {
    condition     = output.table_name == "meal-planner-test-data"
    error_message = "The table name must be an output"
  }
}
