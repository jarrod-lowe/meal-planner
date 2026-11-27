.PHONY: help install dev build lint check test test-unit test-go test-e2e format validate gofmt-check clean \
	terraform-fmt-check test-terraform trivy lock setup-state setup-aws setup-github

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
endif
AWS_REGION ?= ap-southeast-2
export AWS_REGION
AWS_PAGER :=
export AWS_PAGER

# These call AWS or GitHub, so they are looked up only when a recipe uses them
# (never by `make test`), then cached for the rest of the run.
AWS_ACCOUNT = $(eval AWS_ACCOUNT := $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null))$(AWS_ACCOUNT)
STATE_BUCKET = $(PROJECT)-iac-state-$(AWS_ACCOUNT)
GITHUB_OWNER ?= $(eval GITHUB_OWNER := $(shell gh repo view --json owner -q .owner.login 2>/dev/null))$(GITHUB_OWNER)
GITHUB_REPO ?= $(eval GITHUB_REPO := $(shell gh repo view --json name -q .name 2>/dev/null))$(GITHUB_REPO)

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
terraform/environment/%/.terraform:
	$(require-aws)
	cd terraform/environment/$* && terraform init -input=false \
		-backend-config="bucket=$(STATE_BUCKET)" \
		-backend-config="key=$(PROJECT)/$*/terraform.tfstate" \
		-backend-config="region=$(AWS_REGION)"

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
	terraform plan -input=false -out=tfplan

# Apply the plan if there is one, then remove it, so the next run plans again.
terraform/environment/%/.apply: terraform/environment/%/tfplan
	cd terraform/environment/$* && \
	if [ -s tfplan ]; then \
		terraform apply -input=false -auto-approve tfplan || EXIT_CODE=$$?; \
	fi; \
	rm -f tfplan; \
	touch .apply; \
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

# One-off bootstrap, run by the human with admin credentials.
setup-state: terraform/environment/state/.apply
setup-aws: terraform/environment/aws/.apply
setup-github: terraform/environment/github/.apply

# Validate one environment, with no backend and no credentials.
validate-%: terraform/environment/%/.init-local
	cd terraform/environment/$* && $(TF_LOCAL) validate

terraform-fmt-check:
	terraform fmt -check -recursive -diff terraform

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

# Production build. Lambda binaries join in phase 2.
build: install
	pnpm build

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
validate: install gofmt-check terraform-fmt-check $(addprefix validate-,$(TF_ENVS))
	pnpm format:check

# ============================================
# Testing
# ============================================

test-unit: install
	pnpm test

test-go:
	cd backend && go test ./...

test: lint check validate test-unit test-go test-terraform trivy

# Playwright starts the dev server itself (or reuses one locally).
test-e2e: install
	pnpm exec playwright test

# ============================================
# Utility
# ============================================

clean:
	rm -rf build .svelte-kit node_modules test-results playwright-report blob-report
	rm -rf terraform/*/*/.terraform-local
	rm -f terraform/*/*/.init-local

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
	@echo "Frontend:"
	@echo "  make dev             Start the Vite dev server (warns if one is running)"
	@echo "  make build           Build the UI for production"
	@echo ""
	@echo "Testing:"
	@echo "  make test            Lint, typecheck, validate, Vitest, Go, Terraform tests, Trivy"
	@echo "  make test-unit       Run Vitest unit tests"
	@echo "  make test-go         Run Go tests"
	@echo "  make test-terraform  Run terraform test (mocked providers, no AWS)"
	@echo "  make test-e2e        Run Playwright E2E tests"
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
