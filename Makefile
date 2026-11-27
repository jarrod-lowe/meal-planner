.PHONY: help install dev build lint check test test-unit test-go test-e2e format validate gofmt-check clean

default: help

PROJECT ?= meal-planner

# Use the gofmt from the toolchain pinned in backend/go.mod, not whichever Go
# is first on PATH, so formatting matches CI.
GOFMT := $(shell cd backend && go env GOROOT)/bin/gofmt

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

# Formatting checks. Terraform validate and fmt join in phase 1.
validate: install gofmt-check
	pnpm format:check

# ============================================
# Testing
# ============================================

test-unit: install
	pnpm test

test-go:
	cd backend && go test ./...

test: lint check test-unit test-go

# Playwright starts the dev server itself (or reuses one locally).
test-e2e: install
	pnpm exec playwright test

# ============================================
# Utility
# ============================================

clean:
	rm -rf build .svelte-kit node_modules test-results playwright-report blob-report

help:
	@echo "$(PROJECT) Makefile"
	@echo ""
	@echo "Setup:"
	@echo "  make install     Install pnpm dependencies (only when the lockfile changes)"
	@echo ""
	@echo "Frontend:"
	@echo "  make dev         Start the Vite dev server (warns if one is running)"
	@echo "  make build       Build the UI for production"
	@echo ""
	@echo "Testing:"
	@echo "  make test        Lint, typecheck, Vitest and Go tests"
	@echo "  make test-unit   Run Vitest unit tests"
	@echo "  make test-go     Run Go tests"
	@echo "  make test-e2e    Run Playwright E2E tests"
	@echo ""
	@echo "Code quality:"
	@echo "  make lint        ESLint, Prettier, markdownlint, cspell, go vet, gofmt"
	@echo "  make check       Typecheck (svelte-check)"
	@echo "  make format      Format with Prettier and gofmt"
	@echo "  make validate    Check formatting (Terraform joins in phase 1)"
	@echo ""
	@echo "Utility:"
	@echo "  make clean       Remove generated files and node_modules"
