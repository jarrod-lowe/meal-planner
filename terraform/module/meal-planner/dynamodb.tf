# The app's single table (DESIGN §4): holidays and their items, and the
# catalogue. gsi1 lists a user's holidays from their member items.
#
# Encrypted with the AWS-owned key, DynamoDB's default (DESIGN §4): a
# customer-managed key would add a key policy and a monthly cost for no gain
# at this scale.
resource "aws_dynamodb_table" "data" {
  name                        = "${local.resource_prefix}-data"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = local.is_prod

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    projection_type = "KEYS_ONLY"

    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }
}
