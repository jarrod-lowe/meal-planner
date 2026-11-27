# Phase 0: Repo setup

**Goal:** a repo where an agent or a person can start work straight away, and
CI checks every PR. Nothing is deployed yet.

You can:

- run lint, typecheck, unit tests, Go tests and E2E tests locally with `make`
- see the same checks run on every PR, and a failing check block the merge
- run `make dev` and see a placeholder page

Source: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase 0. Design
references: DESIGN §6 (backend layout), §7.1 (frontend setup), §7.6
(accessibility), §9 (Make targets and GitHub Actions), §10 (testing).

## Decisions

- **Layout:** the SvelteKit app lives at the repo root (`src/`, `static/`,
  `tests/`), and Go lives in `backend/` with its own `go.mod`, as in
  dnd-planner.
- **Versions:** the latest stable release of every tool and dependency at the
  time of writing: pnpm 12 (pinned via `packageManager`), Node 26 LTS
  (`.nvmrc` and `engines`), Go 1.27 (the `go` and `toolchain` lines in
  `backend/go.mod`), SvelteKit 3, Svelte 5, Vite 8, TypeScript 6 and ESLint
  10. Dependabot keeps them current.
- **TypeScript 6, not 7:** TypeScript 7 has no programmatic API yet, and
  SvelteKit 3, `svelte-check` and `typescript-eslint` all require 6. The
  TypeScript 7 release notes say Svelte projects should stay on 6 for now.
  Dependabot ignores TypeScript major updates until that changes.
- **SvelteKit 3 config** lives in `vite.config.ts`; there is no
  `svelte.config.js`.
- **Imports:** SvelteKit 3 removed `$lib`; code imports `src/lib` via the
  `#lib` subpath import map in `package.json`.
- **Prettier skips Markdown;** markdownlint and cSpell check it instead.
- **Doc checks:** `markdownlint-cli2` and `cspell` run as part of `make lint`,
  so the AGENTS.md docs rule is enforced, not just stated.
- **Playwright:** Chromium only for now, with a desktop and a phone project.
  The phone project matters from phase 6.
- **`make validate`:** Prettier check and `gofmt -l` for now. Terraform joins
  in phase 1.
- **`AGENTS.md`:** already exists from PR #3. This phase only updates the
  commands table if targets change.

## PR 0.1: Tooling

Each item ends with `make test` green and a commit.

- [x] **1. Repo hygiene.** `.gitignore` (node, SvelteKit, Playwright, Go
      build output, `.env.*`), `.editorconfig`, `.prettierrc` and
      `.prettierignore`, `.markdownlint-cli2.jsonc`, and `cspell.config.js`
      reading the words from `.vscode/settings.json`.
  - Tests first: none (config only). Verify `markdownlint-cli2` and `cspell`
    pass on the existing docs.
- [x] **2. SvelteKit skeleton.** pnpm, SvelteKit with Svelte 5,
      `adapter-static` with `fallback: 'index.html'`, strict TypeScript, root
      `+layout.ts` with `ssr = false` and `prerender = false`, and a
      placeholder `+page.svelte`. ESLint (flat config with
      `eslint-plugin-svelte` and `typescript-eslint`), Prettier with the Svelte
      plugin, `svelte-check`.
  - Tests first: none yet; `pnpm check`, `pnpm lint` and `pnpm build` pass.
  - Files: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
    `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `src/app.html`,
    `src/app.d.ts`, `src/routes/+layout.ts`, `src/routes/+page.svelte`.
- [x] **3. i18n and theme.** `src/lib/i18n/en.ts` as a typed message object
      with a `t()` helper (dotted keys, typed so unknown keys fail
      typecheck, `{name}` interpolation). `src/lib/theme.css` with colour,
      spacing and type tokens in light and dark (`prefers-color-scheme`).
      The placeholder page uses both. Empty `src/lib/engine/`,
      `src/lib/model/` and `src/lib/stores/` with a `README.md` each stating
      its rules (the engine one: pure TS, no Svelte, DOM, API or date
      imports).
  - Tests first: Vitest for `t()` (lookup, interpolation, missing
    parameter). This is also the "one sample test".
  - Files: `vitest.config` (in `vite.config.ts`), `src/lib/i18n/en.ts`,
    `src/lib/i18n/en.test.ts`, `src/lib/theme.css`,
    `src/routes/+layout.svelte`, `src/routes/+page.svelte`.
- [x] **4. Engine import guard.** An ESLint `no-restricted-imports` rule on
      `src/lib/engine/**` blocking `svelte*`, `$app/*`, `#lib/api*`,
      `#lib/stores*` and date libraries.
  - Tests first: a temporary engine file with a forbidden import makes
    `pnpm lint` fail; then remove it.
  - Files: `eslint.config.js`.
- [x] **5. Go skeleton.** `backend/go.mod`, `backend/cmd/.gitkeep`,
      `backend/internal/` with a tiny `httpx` package (a `JSON` response
      helper) so there is something real to test and vet.
  - Tests first: `backend/internal/httpx/httpx_test.go`.
  - Files: `backend/go.mod`, `backend/internal/httpx/*.go`.
- [x] **6. Playwright.** Config with a `webServer` starting the dev server,
      desktop and phone (Pixel 7) Chromium projects, and
      `@axe-core/playwright`. One test: the placeholder page loads, shows the
      i18n title, and has no axe violations.
  - Tests first: `tests/e2e/home.test.ts`, failing until the page title
    matches.
  - Files: `playwright.config.ts`, `tests/e2e/home.test.ts`.
- [x] **7. Makefile.** `install`, `dev` (warns if `pgrep -f vite` finds one
      running), `lint` (ESLint, Prettier check, markdownlint, cspell,
      `go vet`, `gofmt -l`), `check` (`svelte-check`), `test-unit` (Vitest),
      `test-go`, `test` (lint + check + test-unit + test-go), `test-e2e`,
      `build` (UI build; Lambda binaries come in phase 2), `format` (Prettier
      write, `gofmt -w`), `validate`, `help`.
  - Tests first: `make test` and `make test-e2e` pass from a clean clone;
    introducing a lint error, a type error, a failing Vitest test and a
    failing Go test each makes `make test` fail.
  - Files: `Makefile`, `AGENTS.md` commands table if needed.

Then open PR 0.1 and run the Codex review loop.

## PR 0.2: CI

Branches from PR 0.1's branch (or `main` once 0.1 is merged).

- [x] **8. `pr-checks.yaml`.** On `pull_request`: checkout, pnpm and Node
      setup with cache, Go setup, `make test`, then Playwright browsers and
      `make test-e2e`, uploading the report on failure. Actions pinned to
      commit SHAs.
  - Tests first: a throwaway PR commit with a failing Vitest test shows the
    check red; revert it.
  - Files: `.github/workflows/pr-checks.yaml`.
- [x] **9. `security.yaml`.** On `pull_request` and weekly:
      `pnpm audit --prod` and `govulncheck ./...`.
  - Files: `.github/workflows/security.yaml`.
- [x] **10. Dependabot.** `npm`, `gomod` (`/backend`) and `github-actions`,
      weekly, with grouped minor and patch updates, plus
      `dependabot-automerge.yml` (adapted from dnd-planner) enabling
      auto-merge for passing patch and minor updates.
  - Files: `.github/dependabot.yml`,
    `.github/workflows/dependabot-automerge.yml`.
- [ ] **11. Branch protection on `main`.** Require the `pr-checks` and
      `security` jobs to pass, and require a PR. Applied with `gh api` after
      the workflows have run once, so the check names exist. **I'll ask you
      before running it**, since it changes repo settings.

**Done when:** a PR that breaks a test is blocked, and `make dev` serves a
placeholder page.
