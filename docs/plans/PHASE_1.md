# Phase 1: Walking skeleton

**Goal:** the app is deployed to test and prod, and a person can log in.

You can:

- open `meal-planner-test.wildsea.lowe.kiwi` and `meal-planner.wildsea.lowe.kiwi`
- sign in with an account an admin made for you
- set your own password on first login and reset a forgotten one
- see `Hello, <name>` and sign out

Source: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase 1. Design
references: DESIGN §7.1 (config), §7.5 (login), §8 (infrastructure), §9
(Make targets and GitHub Actions); ARCHITECTURE "Infrastructure and
deployment".

## Decisions

- **Copy and adapt dnd-planner** (`../dnd-planner/terraform`, `Makefile`,
  `.github/workflows`), replacing every `dnd-planner` name with a variable or
  `meal-planner`.
- **Versions:** latest stable: Terraform 1.17, AWS provider 6.x, GitHub
  provider 6.x, `aws-amplify` 6.x, Trivy 0.76, `dflook/terraform-*` v3.
- **State:** a new `meal-planner-iac-state-<account>` bucket, keys
  `meal-planner/<env>/terraform.tfstate`, with S3 native locking
  (`use_lockfile = true`). dnd-planner has no locking; we add it.
- **AWS profiles:**
  - `meal-planner`: SSO `AWSAdministratorAccess`, used by Make for `setup-*`,
    `deploy-test` and `create-user`. The human adds it to `~/.aws/config`.
  - `meal-planner-ro`: SSO `AWSReadOnlyAccess`, for agents. No IAM role is
    needed, which replaces the IAM role in IMPLEMENTATION_PLAN PR 1.1; that
    file is updated to match.
- **Shared-account singletons:**
  - The GitHub OIDC provider is owned by dnd-planner's state, so we look it up
    with a `data` source.
  - `aws_api_gateway_account` (the account-wide CloudWatch logging role) is
    already set by dnd-planner, so we don't declare it. API access logging
    relies on it.
- **CI roles:** `meal-planner-prod-iac-ro` (`ReadOnlyAccess`) and
  `meal-planner-prod-iac-rw` (`AdministratorAccess`), trusted per GitHub
  environment (`prod-ro`, `prod-rw`). Unlike dnd-planner, the ro role can't
  assume the rw role.
- **GitHub Terraform** manages only the environments, variables and secrets.
  Branch protection stays as set in phase 0; new required checks are added
  with `gh api`, after asking.
- **SPA routing** follows DESIGN §8.1: `adapter-static` with an `index.html`
  fallback and a CloudFront Function rewrite. This is not dnd-planner's
  prerender approach.
- **Login** follows DESIGN §7.5: an in-app `/login` page using Amplify
  `signIn` (SRP). This is not dnd-planner's hosted Managed Login. No identity
  pool and no Cognito domain are created.
- **API auth:** the client sends the Cognito **ID token**, which is what API
  Gateway's Cognito authoriser validates. In phase 1 the only route,
  `GET /api/health`, is a public mock. The authoriser is defined, and
  first used in phase 2.
- **Frontend env:** Make writes `.env.local` (git-ignored) from the test
  outputs, for `make dev`. Builds for an environment get `VITE_*` from Make
  or CI as environment variables. This replaces the `.env.<env>` files in
  DESIGN §7.1, which is updated to match.
- **Testing infrastructure:**
  - `terraform test` with `mock_provider` (plan only, no AWS calls) asserts
    the properties that matter. These include admin-create-only Cognito, the
    password policy, the `/api/*` behaviour, the headers policy and tags.
    They join `make test`.
  - The CloudFront Function is a plain JS file, unit-tested with Vitest.
  - Trivy (CRITICAL and HIGH) runs in `make test` when installed, and always
    in CI.
- **Testing auth without Cognito:** `src/lib/auth/` exposes a small
  `AuthClient` interface, implemented over Amplify. Playwright runs the dev
  server in an `e2e` mode that swaps in a fake client, so login flows are
  tested end to end without AWS. The fake is loaded by a dynamic import that
  is only reachable in that mode, so it's left out of production bundles.

## Prerequisites (human)

- [x] Add the `meal-planner` and `meal-planner-ro` profiles to
      `~/.aws/config`: copies of `dnd-planner` and `dnd-planner-ro`.
- [ ] Run each `make setup-*` and `make deploy-test` when asked. Agents can't
      apply with admin credentials.

## PR 1.1: Terraform bootstrap

- [x] **1. Make and Terraform plumbing.** Makefile header (`PROJECT`,
      `AWS_PROFILE ?= meal-planner`, account and region lookup, GitHub
      owner), init, plan and apply stamp rules, `validate`, `format` and
      `test-terraform` for every env. Copy `terraform/scripts/` helpers.
  - Tests first: `make validate` fails on a deliberately broken `.tf`, then
    passes.
  - Files: `Makefile`, `terraform/scripts/ensure-state-bucket.sh`.
- [x] **2. State environment.** `module/state-infrastructure` and
      `environment/state`: the bucket, encrypted, versioned, private, TLS
      only.
  - Tests first: `terraform test` asserting the encryption, versioning,
    public access block and TLS-only policy.
  - Files: `terraform/module/state-infrastructure/*`,
    `terraform/environment/state/*`.
- [x] **3. AWS environment.** `module/iac-roles` (ro and rw roles, OIDC trust
      per GitHub environment) and `environment/aws` (OIDC provider as a data
      source).
  - Tests first: `terraform test` asserting the trust conditions (repo and
    environment `sub`, audience) and that ro has no `sts:AssumeRole`.
  - Files: `terraform/module/iac-roles/*`, `terraform/environment/aws/*`.
- [x] **4. GitHub environment.** Environments `prod-ro` and `prod-rw` (rw
      limited to protected branches), with variables (`AWS_ACCOUNT`,
      `AWS_REGION`, `STATE_BUCKET`) and the `AWS_ROLE` secret from the role
      outputs. Make supplies `GITHUB_TOKEN` from `gh auth token`.
  - Tests first: `terraform test` asserting the environment names and the
    branch policy.
  - Files: `terraform/environment/github/*`.
- [x] **5. Trivy and `make test`.** Trivy IaC scan in `security.yaml`;
      `make test` runs `test-terraform`, plus Trivy when it's installed;
      `pr-checks.yaml` installs Terraform.
  - Files: `.github/workflows/security.yaml`,
    `.github/workflows/pr-checks.yaml`, `Makefile`.
- [x] **6. Docs.** IMPLEMENTATION_PLAN PR 1.1 (SSO ro profile) and the AGENTS
      commands table.
- [x] **7. Apply (human).** `make setup-state`, `setup-aws`, `setup-github`.
      I then verify read-only with
      `aws iam get-role --profile meal-planner-ro`.

## PR 1.2: App infrastructure and login

- [ ] **8. CloudFront Function.** `spa-rewrite.js` (viewer request): a path
      with no file extension becomes `/index.html`; `/api/*` is never
      rewritten.
  - Tests first: Vitest over the function file (`/`, `/holidays/x`,
    `/_app/a.js`, `/favicon.png`, `/api/health`).
  - Files: `terraform/module/meal-planner/spa-rewrite.js`,
    `src/infra/spa-rewrite.test.ts` (or similar).
- [ ] **9. App module: hosting.** UI bucket, OAC, CloudFront (default and
      `/api/*` behaviours, the function, the response headers policy from
      DESIGN §8.1), the ACM certificate in us-east-1 and the Route 53 alias.
  - Tests first: `terraform test` asserting the behaviours, cache policies,
    headers (HSTS, CSP `connect-src` with Cognito) and the alias.
  - Files: `terraform/module/meal-planner/{main,cdn,variables,outputs}.tf`.
- [ ] **10. App module: Cognito and API.** User pool (admin-create only,
      email sign-in, `name` required, 12-character minimum, MFA off), public
      SRP client with 30-day refresh, and a REST API from `openapi.yaml`
      (stage `api`, mock `GET /health`, Cognito authoriser defined,
      throttling 20/40, access logs with 14-day retention).
  - Tests first: `terraform test` asserting the Cognito settings, the stage
    name, throttling and log retention.
  - Files: `terraform/module/meal-planner/{cognito,api}.tf`,
    `terraform/module/meal-planner/openapi.yaml`.
- [ ] **11. Environments.** `test` and `prod` with `_shared/` symlinks, as in
      dnd-planner, and `default_tags` (`project`, `environment`).
  - Files: `terraform/environment/{test,prod,_shared}/*`.
- [ ] **12. Make targets.** `deploy-test` (apply, write `.env.local`, build,
      upload with the DESIGN §8.1 cache headers, invalidate), `push-ui ENV=`,
      `create-user ENV= EMAIL= NAME=`, and `api-types` (`openapi-typescript`
      into `src/lib/api/types.ts`). `make dev` proxies `/api` to the test
      CloudFront.
  - Tests first: `make api-types` output is checked in, and `make test`
    fails if it's stale.
  - Files: `Makefile`, `vite.config.ts`, `src/lib/api/types.ts`.
- [ ] **13. Auth client.** `AuthClient` interface, the Amplify
      implementation (configure, `signIn` with the new-password step,
      `confirmSignIn`, `resetPassword` and `confirmResetPassword`, the
      current user's `name`, sign-out, the ID token), and a fake for tests.
  - Tests first: Vitest for the Amplify adapter, with `aws-amplify/auth`
    mocked, covering each sign-in `nextStep` mapping.
  - Files: `src/lib/auth/*`.
- [ ] **14. Session store and guard.** `session.svelte.ts` (state, sign-in
      steps, sign-out) and a root-layout guard redirecting to
      `/login?next=<path>`; `next` must be a same-origin path.
  - Tests first: Vitest for the store transitions and the `next`
    sanitiser.
  - Files: `src/lib/stores/session.svelte.ts`, `src/routes/+layout.ts` or
    `+layout.svelte`.
- [ ] **15. Login and home pages.** `/login` with sign-in, new-password and
      forgot-password steps (labelled fields, error text, keyboard
      submission), and `/` showing `Hello, <name>` and **Sign out**. All
      text in `en.ts`.
  - Tests first: Playwright in `e2e` mode for each flow (sign in, first
    login, forgot password, wrong password, sign out, guard redirect), with
    axe checks, on desktop and phone.
  - Files: `src/routes/login/+page.svelte`, `src/routes/+page.svelte`,
    `src/lib/i18n/en.ts`, `tests/e2e/*`.
- [ ] **16. Deploy test (human), then verify.** Run `make deploy-test`, then
      `make create-user ENV=test …`. You check the "You can" list on the test
      host, including on a phone; I check headers and `/api/health` with
      `curl`.

## PR 1.3: Prod pipeline

- [ ] **17. `environment-prod-plan.yaml`.** On PRs: call `pr-checks.yaml` as
      a reusable workflow, then `dflook/terraform-plan` for prod in the
      `prod-ro` environment, posting the plan as a comment. Skipped for
      Dependabot.
  - Files: `.github/workflows/environment-prod-plan.yaml`,
    `.github/workflows/pr-checks.yaml` (`workflow_call`).
- [ ] **18. `environment-prod-deploy.yaml`.** On push to `main`: the checks,
      then `dflook/terraform-apply` (`prod-rw`), then `make push-ui ENV=prod`
      with the built `VITE_*` from the outputs.
  - Files: `.github/workflows/environment-prod-deploy.yaml`.
- [ ] **19. Required checks.** Add the prod plan check to branch protection.
      I'll ask before running it.
- [ ] **20. Prod users (human).** After the first prod deploy,
      `make create-user ENV=prod …` and check both hosts.

**Done when:** a new user gets the invitation email and can log in on both
hosts, and merging a PR changes prod with no manual step.
