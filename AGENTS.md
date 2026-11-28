# AGENTS.md

Holiday meal planner: a SvelteKit SPA with an in-browser planning engine, Go
Lambdas, DynamoDB and Cognito, on AWS.

Read before working:

- `docs/design/PROJECT_BRIEF.md`: domain terms. Use them exactly in code and UI.
- `docs/design/ARCHITECTURE.md` and `docs/design/DESIGN.md`: how it's built.
- `docs/plans/IMPLEMENTATION_PLAN.md`: phase order and scope.

## Roles

- **The primary agent coordinates.** It talks to the human, writes and
  maintains the phase plan, hands checklist items to subagents, checks their
  results, and handles git, PRs and reviews. It keeps its own context small and
  doesn't do bulk implementation itself.
- **Subagents do the work.** Each gets one checklist item, or a small group of
  related items, with a self-contained brief:
  - the goal and acceptance criteria
  - the relevant DESIGN.md sections
  - the files to touch
  - the rules below

  Run subagents in parallel only when their files don't overlap.
- **Don't trust a report alone.** The primary agent re-runs `make test` and
  reviews the diff before ticking an item.

## Phase workflow

1. **Branch** `phase-<n>-<slug>` from an up-to-date `main`.
2. **Plan.** Write `docs/plans/PHASE_<n>.md`:
   - the phase's goal and its "You can" list from IMPLEMENTATION_PLAN.md
   - a checklist (`- [ ]`) of small, independently testable tasks, in order,
     grouped by PR
   - for each task: the tests to write first, and the files involved

   Get the human's approval of the plan before implementing.
3. **Implement.** Work through the checklist with subagents. Tick each item in
   the plan file as it's verified, and commit per item, or per small group of
   items.
4. **Finish.** When `make test` is green and the "You can" list works in the
   test environment, open the PR. The body summarises the phase and links the
   plan.
5. **Review loop.**
   - **Codex** (`chatgpt-codex-connector[bot]`) reviews when a PR opens. It
     keeps one summary comment with a JSON state block. Every few minutes,
     check that state:

     ```sh
     gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[] | select(.user.login == "chatgpt-codex-connector[bot]") | .body | capture("codex-review-state:v1 (?<s>\\{.*\\}) -->").s | fromjson | .code_review'
     ```

   - **Wait** until `status` is `completed` and `commit_sha` is the PR's head
     commit.
   - **If `has_unresolved_findings` is true:**
     1. Read the findings with
        `gh api repos/{owner}/{repo}/pulls/<n>/comments`.
     2. Fix each one (with a subagent), or explain why not.
     3. Reply on each thread and push.
     4. Comment `@codex review` to ask for a new review. Pushes alone don't
        trigger one.
     5. Repeat until no findings remain.
   - **When clean**, Codex reacts 👍 on the PR. Tell the human.
   - **Never merge.**

**If the plan turns out not to work, stop and ask the human.** Don't improvise
a different approach. If implementation has to differ from DESIGN.md, update
DESIGN.md in the same PR.

## Rules

- **Git:** never commit to `main`, and never commit while tests fail.
- **TDD:** write the failing test first, for all code.
- **Planning engine** (`src/lib/engine/`): pure TypeScript, with no imports from
  Svelte, the DOM, the API client or date libraries.
- **Frontend:**
  - user-facing text only via `src/lib/i18n/en.ts`
  - colours only from the CSS variables in `src/lib/theme.css`
  - semantic, accessible markup with keyboard support
  - phone-first layouts for shopping and stock screens
- **Infrastructure:**
  - never run `terraform` directly; use the Make targets
  - AWS CLI only for read-only commands, with
    `--profile meal-planner-ro --region ap-southeast-2`. The profile is
    created in phase 1.
- **Shell:**
  - use `rg`, never `find … -exec grep`
  - avoid `$(...)`; run the inner command first and reuse its output
  - use `jq`/`yq` for JSON/YAML, not node or python
- **Docs:** markdown must be markdownlint- and cSpell-clean. Add real technical
  terms to `.vscode/settings.json`.

## Commands

| Command                                           | Does                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `make dev`                                        | Vite dev server (check `pgrep -f vite` first)                                                        |
| `make test`                                       | Lint, typecheck, validate, Vitest, Go and Terraform tests, Trivy; run before declaring anything done |
| `make test-e2e`                                   | Playwright                                                                                           |
| `make test-terraform`                             | `terraform test` with mocked providers (no AWS)                                                      |
| `make api-types`                                  | Regenerate TS types after editing `openapi.yaml`                                                     |
| `make deploy-test`                                | Deploy to `meal-planner-test.wildsea.lowe.kiwi` and write `.env.local`; the agent runs it            |
| `make deploy-lambdas ENV=`                        | Build the Lambda zips and update an environment's functions (deploy-test and the prod deploy run it) |
| `make build-ui ENV=` / `push-ui ENV=`             | Build the UI with an environment's settings; upload it and invalidate CloudFront                     |
| `make create-user ENV= EMAIL= NAME=`              | Admin-create a Cognito user; the human runs it                                                       |
| `make seed-test EMAIL=`                           | Write a sample holiday to test, with that user as its member; the agent runs it                      |
| `make format` / `make validate`                   | Formatting; format checks and Terraform validation                                                   |
| `make lock`                                       | Record provider hashes in the Terraform lock files after a provider change                           |
| `make setup-state` / `setup-aws` / `setup-github` | One-off bootstrap; the human runs these                                                              |
