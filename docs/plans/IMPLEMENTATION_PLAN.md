# Implementation Plan

This plan sets the order in which the design in
[DESIGN.md](../design/DESIGN.md) gets built.

It starts with repo setup and a deployed walking skeleton. After that, **every
phase delivers something a person can use in the browser**. The backend,
engine and UI for a feature are built together as a vertical slice, not layer
by layer. The planning engine grows a piece at a time, each piece arriving with
the screen that first shows its output.

## How we work

These rules apply to every phase.

- **One phase, one or more PRs.** Each PR leaves `make test` green and is
  deployable. Large phases are split into the PRs listed.
- **Every merge reaches prod.** From phase 1 on, merging to `main` deploys to
  `meal-planner.wildsea.lowe.kiwi`. Anything merged must therefore be usable,
  or at least harmless. Unfinished screens stay unlinked until their phase
  completes.
- **Test-first** for the engine and the Lambdas. Every user-visible flow gets a
  Playwright test in the phase that adds it.
- **Every phase follows the frontend rules** of DESIGN §7: text in the i18n
  file, colours from theme variables, accessible markup.
- **Each phase ends with a demo.** It's done when the "You can" list works on
  the test environment, including on a phone where marked 📱.
- **Seed data** grows with each phase. `make seed-test` loads a sample holiday
  into the test environment, for demos and smoke tests.

## Overview

| Phase | You can                                                        | Engine work added                          |
| ----- | -------------------------------------------------------------- | ------------------------------------------ |
| 0     | *(repo only)*: run lint, tests and CI locally and on PRs       | —                                          |
| 1     | Open the test and prod sites, log in, set your password        | —                                          |
| 2     | Create a holiday, add members and attendees                    | —                                          |
| 3     | Build a shared catalogue of ingredients and recipes            | —                                          |
| 4     | Plan one-off meals on a grid and see scaled ingredients        | Consumption / scaling                      |
| 5     | Plan multi-day meals, with different people each day           | (reuses scaling)                           |
| 6     | Record stock and see shortfalls, on a phone                    | Event ordering, walk, shortfalls, warnings |
| 7     | Plan shopping trips and see what each needs to buy, on a phone | Trip windows, list quantities              |
| 8     | Shop with your phone: tick items off, finish the trip          | Recorded purchases, finished trips         |
| 9     | Everything above, but smoother                                 | Property tests, profiling                  |

You can start planning a holiday from phase 4. From phase 7 it's useful in the run-up
to a trip, and from phase 8 it's useful during one.

---

## Phase 0: Repo setup

**Goal:** a repo where an agent or a person can start work straight away, and
CI checks every PR. Nothing is deployed yet.

### PR 0.1: Tooling

- **Frontend:**
  - pnpm, SvelteKit (Svelte 5) with `adapter-static` (SPA fallback) and
    TypeScript in strict mode
  - Vite, ESLint, Prettier and `svelte-check`
- **Backend:** a Go module, with `backend/cmd/` and `backend/internal/`
  skeletons, `gofmt` and `go vet`.
- **Tests:**
  - Vitest with one sample test
  - Playwright with one sample test against the dev server
- **Frontend foundations:**
  - `src/lib/i18n/en.ts` with the `t()` helper
  - `src/lib/theme.css` with light and dark tokens
  - empty `src/lib/engine/`, `src/lib/model/` and `src/lib/stores/`
- **Makefile:** `make dev`, `make test`, `make test-e2e`, `make build`,
  `make format` and `make validate` (without Terraform for now).
- **Agent guidance:** `CLAUDE.md` / `AGENTS.md` with the working rules (TDD,
  Terraform only via Make, i18n, theme variables only, accessibility, never
  commit to `main`).
- **Git:** `.gitignore` and `.editorconfig`.

### PR 0.2: CI

- **`pr-checks.yaml`:** lint, typecheck, unit tests, Go tests and E2E tests
  against the dev server, on every PR.
- **`security.yaml`:** `pnpm audit` and `govulncheck`, on PRs and weekly. The
  Trivy scan is added in phase 1, once Terraform exists.
- **Dependabot:** npm, Go modules and GitHub Actions, plus the auto-merge
  workflow for passing patch and minor updates.
- **Branch protection on `main`:** require PR checks to pass.

**Done when:** a PR that breaks a test is blocked, and `make dev` serves a
placeholder page.

---

## Phase 1: Walking skeleton

You can:

- open `meal-planner-test.wildsea.lowe.kiwi` and `meal-planner.wildsea.lowe.kiwi`
- sign in with an account an admin made for you
- set your own password on first login and reset a forgotten one
- see `Hello, <name>` and sign out

### PR 1.1: Terraform bootstrap

- **Environments** (copied and adapted from dnd-planner):
  - `terraform/environment/state`: the state bucket under the
    `meal-planner` key prefix
  - `terraform/environment/aws`: OIDC provider (reused if it already exists in
    the account) and IAM roles
  - `terraform/environment/github`: repo variables and secrets for the
    workflows
- **Make targets:** `setup-state`, `setup-aws` and `setup-github`, plus
  `validate` and `format` for Terraform.
- **Security workflow:** the Trivy IaC scan joins `security.yaml`.

### PR 1.2: App infrastructure and login

- **`terraform/module/meal-planner`:**
  - S3 bucket for the UI
  - CloudFront with an ACM certificate (us-east-1) and the Route 53 alias
  - the SPA rewrite CloudFront Function
  - the response headers policy
  - a Cognito user pool and app client (admin-create only)
  - the API Gateway REST API from `openapi.yaml`, with only the mock
    `/api/health` route
- **Environments:** `test` and `prod`.
- **Make targets:**
  - `deploy-test`: Terraform apply, UI build, upload and invalidation
  - `create-user ENV= EMAIL= NAME=`
  - `api-types`, generating TS types from `openapi.yaml`
- **Frontend:**
  - `/login`, covering sign-in, the new-password step and forgot-password
  - the session store and route guard
  - `/` showing `Hello, <name>` and a sign-out button

### PR 1.3: Prod pipeline

- **On PRs:** `environment-prod-plan.yaml`, which runs the PR checks and then
  posts the prod `terraform plan` as a comment.
- **On merge to `main`:** `environment-prod-deploy.yaml`, which runs the
  checks, then `terraform apply`, then uploads the UI and invalidates the
  CloudFront cache.
- **Prod users:** create the first prod users with `make create-user`.

Done when:

- A new user gets the invitation email and can log in on both hosts.
- Merging a PR changes prod with no manual step.

---

## Phase 2: Holidays and people

You can:

- see the holidays you belong to and create one (name, dates, time zone)
- add and remove other users as members, including removing yourself
- add, rename and remove attendees, including people without a login
- see a friend's changes after a refresh

This phase introduces the data path that every later phase reuses:

- the DynamoDB table
- the store layer with version conditions
- the membership check
- the `mutate()` helper with optimistic updates and conflict handling

### PR 2.1: Holidays API

- **Terraform:** the DynamoDB table with `gsi1`, point-in-time recovery, and
  deletion protection in prod; the reusable Lambda module; deploying Lambda
  code via Make and CI.
- **`backend/internal`:**
  - `auth`, `httpx` and `model` (holiday, member, attendee)
  - `store`: get, put with a version condition, delete, partition query,
    membership check, transactions
  - `validate`
  - tests against DynamoDB Local
- **`holidays` Lambda routes:**
  - `GET /holidays`
  - `PUT /holidays/{id}` (create adds the caller as a member, in one
    transaction)
  - `GET /holidays/{id}`
  - `DELETE /holidays/{id}`
  - members `PUT`/`DELETE`, including the last-member rule
  - attendees `PUT`/`DELETE`
- **`users` Lambda:** `GET /users` via `ListUsers`, returning `sub` and `name`
  only.
- **`openapi.yaml`:** these routes, their schemas and the error shape.

### PR 2.2: Holidays UI

- **Holiday list:** `/` becomes the holiday list, with a create-holiday form.
  The time zone defaults to the browser's.
- **Holiday layout:**
  - loads the holiday
  - mobile tab bar or desktop sidebar, with only Overview and People enabled
  - a refresh button and refetch on focus
- **People:** `/holidays/[id]/people`, managing attendees and members.
- **Stores:** `holiday.svelte.ts` with `mutate()`: optimistic update, retry,
  rollback, and a version-conflict toast.
- **Overview:** a placeholder showing the holiday's name and dates.
- **Tooling:** `make seed-test` creates a sample holiday with attendees.
- **E2E:** create a holiday, add an attendee, add a member, and trigger a
  version conflict.

---

## Phase 3: Ingredient and recipe catalogue

You can:

- add ingredients (name, unit, shop section), with suggestions from a common
  list and a warning if one is a duplicate
- add and edit recipes: servings, ingredient lines picked by fuzzy search, and
  notes
- search for recipes and ingredients
- hide recipes and ingredients you no longer want offered

### PR 3.1: Catalogue API

- **`catalogue` Lambda:** `GET /catalogue` (paginated query) and `PUT` for
  recipes and ingredients.
- **Soft delete:** `DELETE` sets `deleted: true`.
- **Validation:** one line per ingredient within a recipe.

### PR 3.2: Catalogue UI

- **Store:** `catalogue.svelte.ts`, loaded once and fetched again on focus.
- **Ingredients:** the `/ingredients` list and inline editor.
- **Recipes:** the `/recipes` list with search, and the `/recipes/[id]` editor
  (keyboard-friendly line entry).
- **Ingredient picker** (the shared component): Fuse.js matching; results that
  share a name sit together; suggestions from `data/common-ingredients.json`;
  an inline create form; a duplicate warning.
- **Recipe picker:** a fuzzy combobox, ready for phase 4.
- **Data:** a first version of `data/common-ingredients.json`.
- **Seed data:** `make seed-test` adds a handful of recipes.
- **E2E:** create an ingredient from a suggestion, then build a recipe using
  the picker.

---

## Phase 4: Plan one-off meals

You can:

- see the holiday as a grid of days and meal slots
- add a one-off meal from an empty cell (the date, slot and time come
  prefilled)
- give the meal a recipe, or leave it as *No recipe yet*
- choose who's eating, with *Everyone* / *No one* shortcuts
- see the recipe's ingredients scaled to the number of people eating, updating
  as you tick people
- put Dinner A and Dinner B side by side

### Engine (first slice)

- the `plan()` entry point and the `HolidayFacts`, `Catalogue` and `Plan`
  types
- consumption: servings, the scaling factor, attendee references that no
  longer resolve
- the warnings `meal-without-recipe`, `mealtime-without-attendees`,
  `missing-recipe` and `missing-ingredient`
- tests for all of the above

### PR 4.1: Meals API and engine consumption

- **API:** meals `PUT`/`DELETE` on the `holidays` Lambda, with the
  embedded-mealtime validation.
- **Engine:** the slice above, test-first.

### PR 4.2: Planner and meal editor

- **Stores:** `plan.svelte.ts` (the plan derived from the stores) and
  `now.svelte.ts`.
- **Planner:** `/holidays/[id]/plan`, with day × slot cells, chips, parallel
  meals side by side, and **+** on empty cells.
- **Meal editor:** `/holidays/[id]/meals/[mealId]`, one-day mode only:
  - name suggestion
  - recipe picker, with an option to create a new recipe that returns to the
    meal
  - time
  - attendee checkboxes
  - live scaled-ingredient preview
- **Overview:** lists the warnings, each linking to where it can be fixed.
- **Navigation:** Plan is enabled in the holiday navigation.
- **E2E:** plan a dinner for 6 using a recipe for 4 and check the preview
  shows ×1.5.

---

## Phase 5: Multi-day meals

You can:

- create "Jan 1–5 Lunch" once, choosing the recipe once
- see it as one bar spanning those days on the grid
- mark someone as away for one day, or for all of them, in a who's-eating grid
- change the date range without losing who's eating on the days that remain

This phase is frontend only. The API and engine already support meals with
several mealtimes.

### PR 5.1

- **Meal editor:**
  - a **One day / Several days** toggle; the mealtime ID stays the same when
    switching from one to several
  - mealtimes regenerate when the dates change, keeping existing IDs and
    attendees; new days copy from the nearest day
  - the who's-eating grid (mealtimes × attendees), with row and column toggles
  - a per-day table in the scaled preview
- **Planner:** consecutive mealtimes are joined into one bar.
- **E2E:** create a 5-day lunch, remove one person from day 3, then extend the
  range to 7 days.

---

## Phase 6: Stock and shortfalls 📱

You can:

- record food you brought or bought outside a planned trip, and record extra
  food used up (on a phone)
- see what's in stock now, and each ingredient's history
- see shortfalls: mealtimes that will run short, and by how much
- see shortfall dots on the planner grid

There are no trips yet, so every planned need shows as a shortfall unless
stock covers it. This makes the screen useful straight away for "what do we
need to bring?".

### Engine (second slice)

- grouping events per ingredient
- sorting by time, then type, then the tie-breakers
- the walk, covering manual add, manual remove (stopping at zero, with the
  `removed-more-than-stock` warning) and mealtime consumption with shortfalls
- the `past` flag
- the `outside-holiday-dates` warning
- the stock timeline and `stockAt()`

### PR 6.1: Stock changes API and engine walk

- **API:** stock-changes `PUT`/`DELETE` (manual kinds only for now; a change's
  kind can't be edited).
- **Engine:** the slice above, test-first.

### PR 6.2: Stock and shortfall UI

- **Stock view:** `/holidays/[id]/stock`, mobile-first:
  - stock now, grouped by section
  - **Add** and **Remove** sheets (picker, quantity, time defaulting to now,
    and an optional note)
  - each ingredient's history
- **Overview:** upcoming shortfall cards (with past ones collapsed) and an
  alerts badge in the holiday navigation.
- **Planner:** shortfall dots on chips.
- **Navigation:** Stock is enabled.
- **E2E:** at a phone viewport, add stock, then see a shortfall shrink and
  disappear.

---

## Phase 7: Shopping trips and lists 📱

You can:

- add shopping trips with a time and the shop sections they cover (for
  example, a corner shop that only does Bakery and Dairy)
- open a trip on your phone and see its shopping list:
  - grouped by section
  - same-named ingredients side by side
  - quantities net of stock you'll have
- see trips as markers on the planner
- see shortfalls only where no trip can cover the need
- from a shortfall, use **Add a trip before this**

### Engine (third slice)

- trips as events, for the ingredients in sections they cover
- each trip's window: up to the next trip covering that ingredient
- the peak net-outflow list quantity, with planned trips assumed to obtain
  their list
- shopping-list output
- tests including the brief's beans example and the no-freezer trip

### PR 7.1: Trips API and engine lists

- **API:** trips `PUT`/`DELETE`, with `status` always `planned` for now.
- **Engine:** the slice above, test-first.

### PR 7.2: Trips UI

- **Trips list:** `/holidays/[id]/trips`, with create and edit (name, time,
  section checkboxes defaulting to all).
- **Trip page:** `/holidays/[id]/trips/[tripId]`, a read-only shopping list for
  now, mobile-first.
- **Planner:** trip markers.
- **Overview:** **Add a trip before this** on shortfall cards, and the next
  trips listed.
- **Navigation:** Trips is enabled.
- **E2E:** two mealtimes, some stock and one trip produce the expected list.
  Adding a second trip splits the list.

---

## Phase 8: Shopping mode 📱

You can:

- tap **Got it** on a list line, adjust the quantity, and have it go into stock
- add things that weren't on the list
- fix or undo a line you ticked by mistake
- shop the same trip as a friend without clashing
- tap **Finish trip** and see what wasn't bought, and which shortfalls that
  causes
- reopen a finished trip
- get a reminder about trips whose time has passed but haven't been finished

### Engine (final slice)

- recorded purchases count toward stock
- a planned trip contributes `max(list, recorded)`
- a finished trip contributes only what was recorded
- purchases outside a trip's sections count as exactly what was recorded, and
  don't end an earlier trip's shopping window
- purchases of a deleted trip are ignored
- the `trip-not-finished` warning

### PR 8.1: Purchases API and engine purchases

- **API:** the `purchase` stock-change kind, and the trip `status` changing to
  `done` and back.
- **Engine:** the slice above, test-first.

### PR 8.2: Shopping mode UI

- **Trip page** becomes shopping mode:
  - **Got it** quantity sheet, prefilled with what's left to buy
  - recorded state on each line
  - edit or remove a recorded purchase
  - **Add something else**
  - a per-line spinner while a write is pending
  - retries that can't create duplicates
- **Finish trip:** a summary step before confirming, and **Reopen trip**.
- **Stock view:** a banner while trips are unfinished.
- **Overview:** the next 48 hours (mealtimes and trips), plus prompts for
  unfinished trips.
- **E2E:** shop a trip at a phone viewport, finish it with one item not
  bought, and see the shortfall. Two browser contexts tick off different items
  on the same trip without a conflict.

At the end of phase 8, **everything in the brief works**.

---

## Phase 9: Hardening and polish

These items have no single "you can" list. Pick them up as they matter.

- **Accessibility:** axe checks in every E2E flow, and a keyboard-only pass
  through each view.
- **Engine robustness:** a fast-check property test (no upcoming shortfalls
  for covered ingredients when every trip buys its list). Profile a large
  synthetic holiday.
- **Attendee deletion:** list the meals the attendee is assigned to, then
  remove them from those meals before deleting.
- **Usage hints:** a recipe's "Used in" list, and a warning when deleting a
  trip that has recorded purchases.
- **Refetch:** check the refetch-on-focus timing and conflict messages after
  real use.
- **Smoke test:** a Playwright smoke test against the test environment, using
  `make seed-test` data, run after each deploy.
- **Cost and security review:** Lambda sizes, log retention, IAM policies, and
  throttling limits.

---

## Changes to DESIGN.md

This plan replaces the layer-by-layer **Delivery order** in DESIGN §11, which
built the whole engine before any feature screens.
