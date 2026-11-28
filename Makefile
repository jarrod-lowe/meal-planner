.PHONY: help install dev build lint check test test-unit test-go test-e2e format validate gofmt-check clean \
	terraform-fmt-check terraform-version-check test-terraform trivy lock setup-state setup-aws setup-github \
	env-local build-ui push-ui deploy-test create-user seed-test build-lambdas deploy-lambdas

default: help

PROJECT ?= meal-planner

# Use the gofmt from the toolchain pinned in backend/go.mod, not whichever Go
# is first on PATH, so formatting matches CI.
GOFMT := $(shell cd backend && go env GOROOT)/bin/gofmt

# ============================================
# AWS and GitHub
# ============================================

# The `meal-planner` profile (SSO admin) is for the human's `setup-*` and
# `deploy-test` runs. In CI, or with credentials already in the environment,
# don't force a profile.
AWS_PROFILE ?= meal-planner
ifeq ($(or $(CI),$(AWS_ACCESS_KEY_ID)),)
export AWS_PROFILE
# GNU Make before 4.4 (macOS ships 3.81) doesn't pass exported variables to
# $(shell ...), so lookups set the profile themselves.
AWS_SHELL_ENV := AWS_PROFILE=$(AWS_PROFILE)
endif
AWS_REGION ?= ap-southeast-2
export AWS_REGION
AWS_PAGER :=
export AWS_PAGER

# These call AWS or GitHub, so they are looked up only when a recipe uses them
# (never by `make test`), then cached for the rest of the run.
AWS_ACCOUNT = $(eval AWS_ACCOUNT := $(shell $(AWS_SHELL_ENV) AWS_REGION=$(AWS_REGION) aws sts get-caller-identity --query Account --output text 2>/dev/null))$(AWS_ACCOUNT)
STATE_BUCKET = $(PROJECT)-iac-state-$(AWS_ACCOUNT)
GITHUB_OWNER ?= $(eval GITHUB_OWNER := $(shell gh repo view --json owner -q .owner.login 2>/dev/null))$(GITHUB_OWNER)
GITHUB_REPO ?= $(eval GITHUB_REPO := $(shell gh repo view --json name -q .name 2>/dev/null))$(GITHUB_REPO)
# The OIDC `sub` prefix the CI roles trust. This repository uses GitHub's
# immutable subject (`repo:<owner>@<id>/<repo>@<id>`), so ask GitHub rather
# than building it from names; fall back to the classic form.
GITHUB_OIDC_SUBJECT_PREFIX ?= $(eval GITHUB_OIDC_SUBJECT_PREFIX := $(or $(shell gh api repos/$(GITHUB_OWNER)/$(GITHUB_REPO)/actions/oidc/customization/sub --jq '.sub_claim_prefix // empty' 2>/dev/null),repo:$(GITHUB_OWNER)/$(GITHUB_REPO)))$(GITHUB_OIDC_SUBJECT_PREFIX)

# Stops a recipe early when the AWS account can't be looked up.
require-aws = $(if $(AWS_ACCOUNT),,$(error Can't find the AWS account. Run `aws sso login --profile $(AWS_PROFILE)`))

# ============================================
# Terraform
# ============================================

# Environments are the directories under terraform/environment, except the
# `_shared` files that test and prod symlink.
TF_ENVS := $(filter-out _shared,$(patsubst terraform/environment/%/,%,$(wildcard terraform/environment/*/)))
# Every module or environment with `terraform test` files.
TF_TEST_DIRS := $(sort $(patsubst %/tests/,%,$(dir $(wildcard terraform/*/*/tests/*.tftest.hcl))))
TF_LOCK_PLATFORMS := -platform=darwin_arm64 -platform=linux_amd64

# Validate, test and lock use a separate data directory, initialised without a
# backend, so they never touch AWS and never clash with the real backend init
# in `.terraform`.
TF_LOCAL := TF_DATA_DIR=.terraform-local terraform

# Backend-less init, redone when the directory's Terraform files change.
# Environment lock files are committed, and must already list every provider
# (run `make lock` after changing a provider).
.SECONDEXPANSION:
.PRECIOUS: terraform/%/.init-local
terraform/%/.init-local: $$(wildcard terraform/$$*/*.tf) $$(wildcard terraform/$$*/.terraform.lock.hcl)
	cd terraform/$* && $(TF_LOCAL) init -backend=false -input=false \
		$(if $(and $(filter environment/%,$*),$(wildcard terraform/$*/.terraform.lock.hcl)),-lockfile=readonly)
	@touch $@

# Real init, against the S3 backend. State locking (`use_lockfile`) is set in
# each environment's backend block.
.PRECIOUS: terraform/environment/%/.terraform
# Re-run when the lock file changes (a new or upgraded provider needs a fresh
# init). Touched afterwards, since init needn't change the directory's mtime.
terraform/environment/%/.terraform: $$(wildcard terraform/environment/$$*/.terraform.lock.hcl)
	$(require-aws)
	cd terraform/environment/$* && terraform init -input=false \
		-backend-config="bucket=$(STATE_BUCKET)" \
		-backend-config="key=$(PROJECT)/$*/terraform.tfstate" \
		-backend-config="region=$(AWS_REGION)"
	@touch $@

# The state environment keeps its state in the bucket it manages, so the
# bucket has to exist before init.
.PRECIOUS: terraform/environment/state/.terraform
terraform/environment/state/.terraform:
	$(require-aws)
	STATE_BUCKET=$(STATE_BUCKET) terraform/scripts/ensure-state-bucket.sh
	cd terraform/environment/state && terraform init -input=false \
		-backend-config="bucket=$(STATE_BUCKET)" \
		-backend-config="key=$(PROJECT)/state/terraform.tfstate" \
		-backend-config="region=$(AWS_REGION)"

# Plan, passing the shared inputs as TF_VAR_* so each environment declares only
# the ones it uses.
terraform/environment/%/tfplan: terraform/environment/%/.terraform terraform/environment/%/.stamp
	$(require-aws)
	cd terraform/environment/$* && \
	TF_VAR_project=$(PROJECT) \
	TF_VAR_state_bucket=$(STATE_BUCKET) \
	TF_VAR_github_owner=$(GITHUB_OWNER) \
	TF_VAR_github_repo=$(GITHUB_REPO) \
	TF_VAR_github_oidc_subject_prefix='$(GITHUB_OIDC_SUBJECT_PREFIX)' \
	terraform plan -input=false -out=tfplan

# Apply the plan if there is one, then remove it, so the next run plans again.
# The `.apply` stamp is written only after a successful apply; on failure it's
# removed, so the next run retries instead of reporting success.
terraform/environment/%/.apply: terraform/environment/%/tfplan
	cd terraform/environment/$* && \
	if [ -s tfplan ]; then \
		terraform apply -input=false -auto-approve tfplan || EXIT_CODE=$$?; \
	fi; \
	rm -f tfplan; \
	if [ $${EXIT_CODE:-0} -eq 0 ]; then touch .apply; else rm -f .apply; fi; \
	exit $${EXIT_CODE:-0}

# The GitHub provider reads GITHUB_TOKEN. Exported only for these targets, so
# it isn't echoed in a command line.
terraform/environment/github/tfplan terraform/environment/github/.apply: export GITHUB_TOKEN = $(shell gh auth token)

# Stamps: an environment replans when its own or its modules' files change.
terraform/environment/state/.stamp: $(wildcard terraform/environment/state/*.tf) \
		$(wildcard terraform/module/state-infrastructure/*.tf)
	@touch $@

terraform/environment/aws/.stamp: $(wildcard terraform/environment/aws/*.tf) \
		$(wildcard terraform/module/iac-roles/*.tf)
	@touch $@

terraform/environment/github/.stamp: $(wildcard terraform/environment/github/*.tf)
	@touch $@

# The app environments symlink their files from _shared; wildcard follows the
# links. The module's openapi.yaml and CloudFront Function count too.
APP_MODULE_FILES := $(wildcard $(addprefix terraform/module/meal-planner/,*.tf *.yaml *.js))
terraform/environment/test/.stamp terraform/environment/prod/.stamp: terraform/environment/%/.stamp: \
		$$(wildcard terraform/environment/$$*/*.tf) $(APP_MODULE_FILES)
	@touch $@

# One-off bootstrap, run by the human with admin credentials.
setup-state: terraform/environment/state/.apply
setup-aws: terraform/environment/aws/.apply
setup-github: terraform/environment/github/.apply

# ============================================
# App environments (test, prod)
# ============================================

# The environment for push-ui, build-ui and create-user.
APP_ENVS := test prod
OUTPUT_JSON = terraform/environment/$(ENV)/output.json
require-env = $(if $(filter $(APP_ENVS),$(ENV)),,$(error Set ENV=test or ENV=prod))
# The output.json prerequisite, only once ENV is valid, so a missing ENV
# fails with a clear message rather than a missing-rule error.
env-output-json = $(if $(filter $(APP_ENVS),$(ENV)),$(OUTPUT_JSON))

# One Terraform output from output.json, failing when it's missing. The
# optional second argument is a jq path into the output's value (`.users`).
# Recipes are expanded after their prerequisites are made, so the file is
# current.
tf-output = $(or $(shell jq -r '.$(1).value$(2) // empty' $(OUTPUT_JSON) 2>/dev/null),$(error No `$(1)$(2)` in $(OUTPUT_JSON)))

# The environment's Terraform outputs, read from its state. Always refreshed,
# and deliberately not dependent on an apply, so CI (which applies with its
# own action) can produce it for push-ui too.
.PHONY: FORCE
FORCE:
terraform/environment/%/output.json: terraform/environment/%/.terraform FORCE
	cd terraform/environment/$* && terraform output -json > output.json

# Settings for `make dev`, from the test environment.
.env.local: terraform/environment/test/output.json
	jq -r '"VITE_USER_POOL_ID=\(.user_pool_id.value)", "VITE_USER_POOL_CLIENT_ID=\(.user_pool_client_id.value)", "VITE_API_PROXY_TARGET=\(.site_url.value)"' $< > $@
	@echo "Wrote $@"

env-local: .env.local

# Build the UI for ENV, with its Cognito settings as VITE_* variables.
build-ui: install $(env-output-json)
	$(require-env)
	VITE_USER_POOL_ID='$(call tf-output,user_pool_id)' \
	VITE_USER_POOL_CLIENT_ID='$(call tf-output,user_pool_client_id)' \
	pnpm build

# Upload build/ to ENV's bucket, then invalidate CloudFront (DESIGN §8.1).
# Hashed assets go first, so the new index.html never refers to a missing
# file. Old hashed assets are deleted last.
IMMUTABLE_CACHE := public, max-age=31536000, immutable
push-ui: $(env-output-json)
	$(require-env)
	@test -f build/index.html || { echo "No build/index.html. Run make build-ui ENV=$(ENV) first."; exit 1; }
	aws s3 sync build/_app/immutable s3://$(call tf-output,ui_bucket_name)/_app/immutable \
		--cache-control '$(IMMUTABLE_CACHE)'
	aws s3 sync build/ s3://$(call tf-output,ui_bucket_name)/ \
		--exclude '_app/immutable/*' --cache-control 'no-cache' --delete
	aws s3 sync build/_app/immutable s3://$(call tf-output,ui_bucket_name)/_app/immutable \
		--cache-control '$(IMMUTABLE_CACHE)' --delete
	aws cloudfront create-invalidation \
		--distribution-id $(call tf-output,cloudfront_distribution_id) --paths '/*'

# Apply test, write .env.local, deploy the Lambda code, then build and upload
# the UI. Each step is a separate make, so they run in order.
deploy-test: terraform/environment/test/.apply
	$(MAKE) .env.local
	$(MAKE) deploy-lambdas ENV=test
	$(MAKE) build-ui ENV=test
	$(MAKE) push-ui ENV=test

# Admin-create a Cognito user. Cognito emails them a temporary password.
create-user: $(if $(and $(EMAIL),$(NAME)),$(env-output-json))
	$(require-env)
	$(if $(EMAIL),,$(error Set EMAIL=<their email address>))
	$(if $(NAME),,$(error Set NAME="<their name>"))
	@mkdir -p build
	jq -nc --arg email "$(EMAIL)" --arg name "$(NAME)" \
		'[{Name: "email", Value: $$email}, {Name: "email_verified", Value: "true"}, {Name: "name", Value: $$name}]' \
		> build/user-attributes.json
	aws cognito-idp admin-create-user \
		--user-pool-id $(call tf-output,user_pool_id) \
		--username "$(EMAIL)" \
		--user-attributes file://build/user-attributes.json \
		--desired-delivery-mediums EMAIL
	@rm -f build/user-attributes.json

# Write a sample holiday to test: the user (by EMAIL) as its member, four
# attendees and a few meals using the sample catalogue's recipes. The items
# are built by scripts/seed-test.jq and written in one transaction, each only
# if it doesn't exist yet. Then write the sample
# catalogue from scripts/seed-catalogue.json, which has fixed IDs: one put per
# item, each only if it doesn't exist, so running it again adds nothing new
# (a transaction would fail as a whole once any item exists).
seed-test: override ENV = test
seed-test: $(if $(EMAIL),terraform/environment/test/output.json)
	$(if $(EMAIL),,$(error Set EMAIL=<the user's email address>))
	@mkdir -p build
	aws cognito-idp admin-get-user \
		--user-pool-id $(call tf-output,user_pool_id) \
		--username "$(EMAIL)" > build/seed-test-user.json
	od -An -N240 -tx1 /dev/urandom > build/seed-test-random.txt
	jq -n --arg table "$(call tf-output,table_name)" \
		--slurpfile user build/seed-test-user.json \
		--rawfile random build/seed-test-random.txt \
		--slurpfile catalogue scripts/seed-catalogue.json \
		-f scripts/seed-test.jq > build/seed-test.json
	aws dynamodb transact-write-items --transact-items file://build/seed-test.json
	jq --arg table "$(call tf-output,table_name)" \
		--slurpfile user build/seed-test-user.json \
		-f scripts/seed-catalogue.jq scripts/seed-catalogue.json > build/seed-catalogue.json
	@jq -c '.[]' build/seed-catalogue.json | while read -r item; do \
		if aws dynamodb put-item --cli-input-json "$$item" 2> build/seed-catalogue-error.txt; then \
			echo added; \
		elif rg -q ConditionalCheckFailedException build/seed-catalogue-error.txt; then \
			echo existing; \
		else \
			cat build/seed-catalogue-error.txt >&2; exit 1; \
		fi; \
	done > build/seed-catalogue-results.txt
	@jq -r --arg site "$(call tf-output,site_url)" \
		'.[0].Put.Item.id.S | "Seeded holiday \(.)\n\($$site)/holidays/\(.)"' build/seed-test.json
	@jq -Rnr '[inputs] | "catalogue: \(map(select(. == "added")) | length) added, \(map(select(. == "existing")) | length) already there"' \
		build/seed-catalogue-results.txt
	@rm -f build/seed-test-user.json build/seed-test-random.txt build/seed-test.json \
		build/seed-catalogue.json build/seed-catalogue-error.txt build/seed-catalogue-results.txt

# ============================================
# Lambdas
# ============================================

# One per backend/cmd directory. Terraform creates each function from a
# placeholder; these targets replace its code (DESIGN §9).
LAMBDAS := holidays users catalogue
LAMBDA_ARCHIVES := $(addprefix dist/archives/,$(addsuffix .zip,$(LAMBDAS)))

# Every Lambda rebuilds when the shared packages or the module change.
GO_INTERNAL_SOURCES := $(filter-out %_test.go,$(shell find backend/internal -name '*.go'))

# The arm64 binary, named `bootstrap` for the provided.al2023 runtime.
dist/lambdas/%/bootstrap: $$(filter-out %_test.go,$$(wildcard backend/cmd/$$*/*.go)) \
		$(GO_INTERNAL_SOURCES) backend/go.mod backend/go.sum
	@mkdir -p $(@D)
	cd backend && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -buildvcs=false \
		-tags lambda.norpc -ldflags='-s -w' -o ../$@ ./cmd/$*

# A reproducible zip: fixed mode and timestamp, and no extra attributes, so
# the same binary always gives the same bytes. The binary's timestamp is set
# back afterwards, so Make doesn't see it as older than its sources.
.PRECIOUS: dist/lambdas/%/bootstrap
dist/archives/%.zip: dist/lambdas/%/bootstrap
	@mkdir -p $(@D)
	chmod 755 $<
	touch -t 198001010000 $<
	rm -f $@
	cd $(<D) && zip -X -q ../../archives/$*.zip bootstrap
	touch $< $@

build-lambdas: $(LAMBDA_ARCHIVES)

# Replace one function's code, publish a version, and wait until the update
# has finished. The function name comes from ENV's Terraform outputs.
deploy-lambda/%: dist/archives/%.zip $(env-output-json)
	$(require-env)
	aws lambda update-function-code \
		--function-name $(call tf-output,lambda_function_names,.$*) \
		--zip-file fileb://$< --publish > /dev/null
	aws lambda wait function-updated-v2 \
		--function-name $(call tf-output,lambda_function_names,.$*)

# Deploy every Lambda's code to ENV (test or prod).
deploy-lambdas: $(addprefix deploy-lambda/,$(LAMBDAS))

# Validate one environment, with no backend and no credentials.
validate-%: terraform/environment/%/.init-local
	cd terraform/environment/$* && $(TF_LOCAL) validate

terraform-fmt-check:
	terraform fmt -check -recursive -diff terraform

# CI's dflook actions take the Terraform version from the root module's
# `required_version`, ahead of .terraform-version, so the app environments pin
# it exactly. Fails when the pin and .terraform-version disagree.
TF_VERSION_FILE := .terraform-version
TF_PINNED_ROOT := terraform/environment/_shared/main.tf
terraform-version-check:
	@version=`cat $(TF_VERSION_FILE)`; \
	grep -qF "required_version = \"$$version\"" $(TF_PINNED_ROOT) || \
		{ echo "$(TF_PINNED_ROOT) must set required_version = \"$$version\" (from $(TF_VERSION_FILE))."; exit 1; }

# `terraform test` (mocked providers, plan only) for one module or environment.
test-terraform/%: %/.init-local
	cd $* && $(TF_LOCAL) test

test-terraform: $(addprefix test-terraform/,$(TF_TEST_DIRS))

# Record provider hashes for every platform that runs Terraform, in each
# environment's committed lock file.
lock-%:
	cd terraform/environment/$* && \
	$(TF_LOCAL) init -backend=false -input=false && \
	$(TF_LOCAL) providers lock $(TF_LOCK_PLATFORMS)

lock: $(addprefix lock-,$(TF_ENVS))

# Trivy IaC scan (CRITICAL and HIGH). Runs when trivy is installed; CI always
# runs it. Suppress a finding only inline (`#trivy:ignore:<ID>`), with a reason.
trivy:
	@if command -v trivy > /dev/null 2>&1; then \
		trivy config --exit-code 1 --severity CRITICAL,HIGH \
			--skip-dirs '**/.terraform' --skip-dirs '**/.terraform-local' terraform; \
	else \
		echo "trivy isn't installed; skipping the IaC scan (CI runs it)."; \
	fi

# ============================================
# Setup
# ============================================

# Reinstall only when the lockfile or package.json changes.
node_modules/.stamp: package.json pnpm-lock.yaml
	pnpm install --frozen-lockfile
	@touch $@

install: node_modules/.stamp

# ============================================
# Frontend
# ============================================

# Development server. Don't start a second one if Vite is already running.
# `[v]ite` matches "vite" but not this recipe's own shell command line.
dev: install
	@if pgrep -f '[v]ite' > /dev/null; then \
		pgrep -f '[v]ite' | paste -sd ' ' - | sed 's/.*/Warning: Vite is already running (PID &). Not starting another./'; \
	else \
		pnpm dev; \
	fi

# Production build: the UI into build/, and the Lambda zips into dist/.
build: install
	pnpm build
	$(MAKE) build-lambdas

# ============================================
# Code quality
# ============================================

lint: install gofmt-check
	pnpm lint
	pnpm format:check
	pnpm exec markdownlint-cli2 "**/*.md"
	pnpm exec cspell lint --no-progress --gitignore "**/*.md"
	cd backend && go vet ./...

# Typecheck (svelte-check over .ts and .svelte, including tests/)
check: install
	pnpm check

# Fails, listing the files, when any Go file needs formatting.
gofmt-check:
	@cd backend && $(GOFMT) -l . | awk '{ print "gofmt needed: backend/" $$0; bad = 1 } END { exit bad }'

format: install
	pnpm format
	cd backend && $(GOFMT) -w .
	terraform fmt -recursive terraform

# Formatting checks, and `terraform validate` for every environment.
validate: install gofmt-check terraform-fmt-check terraform-version-check $(addprefix validate-,$(TF_ENVS))
	pnpm format:check

# ============================================
# API types
# ============================================

.PHONY: api-types api-types-check

OPENAPI_SPEC ?= terraform/module/meal-planner/openapi.yaml
API_TYPES ?= src/lib/api/types.ts
# Prettier formats the generated file, so it's checked in exactly as
# `format:check` expects.
API_TYPES_GEN = pnpm exec openapi-typescript $(OPENAPI_SPEC) --output $(1) \
	&& pnpm exec prettier --write --log-level warn $(1)

# Regenerate the TypeScript types from the OpenAPI spec (check the result in).
api-types: install
	@if [ ! -f $(OPENAPI_SPEC) ]; then \
		echo "$(OPENAPI_SPEC) doesn't exist yet; skipping api-types."; \
	else \
		mkdir -p $(dir $(API_TYPES)) && $(call API_TYPES_GEN,$(API_TYPES)); \
	fi

# Fails when the checked-in types are stale against the spec.
api-types-check: install
	@if [ ! -f $(OPENAPI_SPEC) ]; then \
		echo "$(OPENAPI_SPEC) doesn't exist yet; skipping the api-types check."; \
	else \
		tmp=$(API_TYPES).check.ts; \
		$(call API_TYPES_GEN,$$tmp) > /dev/null || { rm -f $$tmp; exit 1; }; \
		if diff -u $(API_TYPES) $$tmp; then rm -f $$tmp; \
		else rm -f $$tmp; echo "$(API_TYPES) is stale. Run \`make api-types\`."; exit 1; fi; \
	fi

# ============================================
# Testing
# ============================================

test-unit: install
	pnpm test

# The store tests run against DynamoDB Local in Docker, and fail without it.
# The container is always stopped, and go test's exit code kept.
DYNAMODB_LOCAL_IMAGE := amazon/dynamodb-local:3.3.2
DYNAMODB_LOCAL_NAME := $(PROJECT)-dynamodb-local
DYNAMODB_LOCAL_PORT := 8765
DYNAMODB_LOCAL_URL := http://localhost:$(DYNAMODB_LOCAL_PORT)
# Dummy credentials, and no profile, so the SDK never looks for real ones.
GO_TEST_ENV := DYNAMODB_ENDPOINT=$(DYNAMODB_LOCAL_URL) AWS_PROFILE= \
	AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_REGION=$(AWS_REGION)

test-go:
	@docker rm -f $(DYNAMODB_LOCAL_NAME) > /dev/null 2>&1 || true
	docker run -d --rm -p $(DYNAMODB_LOCAL_PORT):8000 --name $(DYNAMODB_LOCAL_NAME) \
		$(DYNAMODB_LOCAL_IMAGE) -jar DynamoDBLocal.jar -inMemory -sharedDb > /dev/null
	@tries=0; until curl -s -o /dev/null $(DYNAMODB_LOCAL_URL); do \
		tries=`expr $$tries + 1`; \
		if [ $$tries -ge 60 ]; then \
			echo "DynamoDB Local didn't start on $(DYNAMODB_LOCAL_URL)."; \
			docker stop $(DYNAMODB_LOCAL_NAME) > /dev/null; exit 1; \
		fi; \
		sleep 0.5; \
	done
	cd backend && $(GO_TEST_ENV) go test ./... || status=$$?; \
	docker stop $(DYNAMODB_LOCAL_NAME) > /dev/null; \
	exit $${status:-0}

test: lint check validate api-types-check test-unit test-go test-terraform trivy

# Playwright starts the dev server itself (or reuses one locally).
test-e2e: install
	pnpm exec playwright test

# ============================================
# Utility
# ============================================

clean:
	rm -rf build dist .svelte-kit node_modules test-results playwright-report blob-report
	rm -rf terraform/*/*/.terraform-local
	rm -f terraform/*/*/.init-local terraform/environment/*/output.json

help:
	@echo "$(PROJECT) Makefile"
	@echo ""
	@echo "Setup:"
	@echo "  make install         Install pnpm dependencies (only when the lockfile changes)"
	@echo ""
	@echo "Infrastructure (admin credentials, run by the human):"
	@echo "  make setup-state     Create and manage the Terraform state bucket"
	@echo "  make setup-aws       Apply the CI IAM roles"
	@echo "  make setup-github    Apply the GitHub environments, variables and secrets"
	@echo ""
	@echo "Deploy (admin credentials locally, or credentials from the environment in CI):"
	@echo "  make deploy-test     Apply test, write .env.local, deploy the Lambdas, build and upload the UI"
	@echo "  make deploy-lambdas ENV=  Build the Lambda zips and update ENV's functions"
	@echo "  make env-local       Write .env.local from the test environment's outputs"
	@echo "  make build-ui ENV=   Build the UI with ENV's (test or prod) Cognito settings"
	@echo "  make push-ui ENV=    Upload build/ to ENV's bucket and invalidate CloudFront"
	@echo "  make create-user ENV= EMAIL= NAME=  Admin-create a user (Cognito emails a password)"
	@echo "  make seed-test EMAIL=  Write a sample holiday (that user as its member) and catalogue to test"
	@echo ""
	@echo "Frontend:"
	@echo "  make dev             Start the Vite dev server; proxies /api to test once .env.local exists"
	@echo "  make build           Build the UI (with VITE_* from the environment) and the Lambda zips"
	@echo "  make build-lambdas   Build the Lambda binaries and zips into dist/"
	@echo ""
	@echo "Testing:"
	@echo "  make test            Lint, typecheck, validate, Vitest, Go, Terraform tests, Trivy"
	@echo "  make test-unit       Run Vitest unit tests"
	@echo "  make test-go         Run Go tests"
	@echo "  make test-terraform  Run terraform test (mocked providers, no AWS)"
	@echo "  make test-e2e        Run Playwright E2E tests"
	@echo ""
	@echo "API:"
	@echo "  make api-types       Regenerate src/lib/api/types.ts from openapi.yaml"
	@echo ""
	@echo "Code quality:"
	@echo "  make lint            ESLint, Prettier, markdownlint, cspell, go vet, gofmt"
	@echo "  make check           Typecheck (svelte-check)"
	@echo "  make format          Format with Prettier, gofmt and terraform fmt"
	@echo "  make validate        Check formatting and validate Terraform"
	@echo "  make lock            Record provider hashes in the Terraform lock files"
	@echo "  make trivy           Trivy IaC scan of terraform/ (skipped if not installed)"
	@echo ""
	@echo "Utility:"
	@echo "  make clean           Remove generated files and node_modules"
