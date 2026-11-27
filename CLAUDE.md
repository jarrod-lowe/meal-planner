# CLAUDE.md

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
   - Watch the PR for the Codex review (`chatgpt-codex-connector[bot]`):
     either review comments, or its message that it found no major issues.
   - Check every few minutes with `gh pr view <n> --comments` and
     `gh api repos/{owner}/{repo}/pulls/<n>/comments`.
   - For each finding: fix it (with a subagent) or explain why not, reply on
     the thread, push, and wait for the next review.
   - When the review comes back clean, tell the human.
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
  - AWS CLI only for read-only commands, with the read-only profile and
    `--region ap-southeast-2`
- **Shell:**
  - use `rg`, never `find … -exec grep`
  - avoid `$(...)`; run the inner command first and reuse its output
  - use `jq`/`yq` for JSON/YAML, not node or python
- **Docs:** markdown must be markdownlint- and cSpell-clean. Add real technical
  terms to `.vscode/settings.json`.

## Commands

| Command                         | Does                                                                     |
| ------------------------------- | ------------------------------------------------------------------------ |
| `make dev`                      | Vite dev server (check `pgrep -f vite` first)                            |
| `make test`                     | Lint, typecheck, Vitest and Go tests; run before declaring anything done |
| `make test-e2e`                 | Playwright                                                               |
| `make api-types`                | Regenerate TS types after editing `openapi.yaml`                         |
| `make deploy-test`              | Deploy to `meal-planner-test.wildsea.lowe.kiwi`                          |
| `make format` / `make validate` | Formatting and Terraform validation                                      |
