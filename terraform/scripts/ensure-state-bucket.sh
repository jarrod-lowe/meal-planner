#!/bin/bash
# Creates the Terraform state bucket if it doesn't exist yet, so the state
# environment can store its own state in it. The state environment then
# imports the bucket and manages the rest of its settings.
#
# Called by Make with STATE_BUCKET and AWS_REGION set.
set -euo pipefail

: "${STATE_BUCKET:?STATE_BUCKET must be set}"
: "${AWS_REGION:?AWS_REGION must be set}"

if aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
  echo "State bucket $STATE_BUCKET exists."
  exit 0
fi

echo "Creating state bucket $STATE_BUCKET in $AWS_REGION..."
aws s3api create-bucket \
  --bucket "$STATE_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration "LocationConstraint=$AWS_REGION"
aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption \
  --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block \
  --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
