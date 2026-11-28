# Phase 2: Holidays and people

**Goal:** the first real data path: holidays, members and attendees, stored in
DynamoDB, served by Go Lambdas, and managed from the UI.

You can:

- see the holidays you belong to and create one (name, dates, time zone)
- add and remove other users as members, including removing yourself
- add, rename and remove attendees, including people without a login
- see a friend's changes after a refresh

Source: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase 2. Design
references: DESIGN §1 (conventions), §2.2 (stored facts), §4 (DynamoDB), §5
(API, validation, errors), §6 (backend), §7.2–7.3 (routes, state, `mutate()`),
§7.4 People, §8.4, §9, §10 (backend and E2E testing).

## Decisions

- **Auth:** the client sends the Cognito ID token (as in phase 1). The
  Lambda reads `sub` and `name` from `requestContext.authorizer.claims`.
- **Lambda code:** Terraform creates each function from a placeholder zip
  made by `archive_file` (the `hashicorp/archive` provider, latest stable),
  and ignores later code changes. Make builds the real binaries and deploys
  them with `aws lambda update-function-code`, as dnd-planner does. No
  binaries are committed, and CI plans don't need a Go build.
- **Lambda deploy:** `make deploy-lambdas ENV=` builds, zips and updates
  every function, reading the function names from the environment's
  Terraform outputs. `make deploy-test` runs it after the apply. The prod
  deploy workflow runs it after the apply and before the UI upload.
- **DynamoDB Local:** `make test-go` starts `amazon/dynamodb-local` in Docker
  on a fixed port (8765), runs the Go tests with `DYNAMODB_ENDPOINT` set, and
  stops the container. Store tests fail (not skip) without the endpoint, so CI
  can't pass them silently. GitHub's Ubuntu runners have Docker.
- **Time zones:** the Lambda checks the name with `time.LoadLocation`, and
  embeds `time/tzdata` because `provided.al2023` has no zoneinfo.
- **Semantic checks added to §5.2:** `startDate <= endDate`. DESIGN is
  updated in the same PR.
- **Not found vs not a member:** for routes under `/holidays/{holidayId}`,
  the Lambda gets the caller's member item. If it's missing, it gets `META`:
  missing gives `404 not-found`, present gives `403 not-a-member`.
- **Last-member check:** count `MEMBER#` items, then delete. The race between
  two members removing each other at once is accepted at this scale.
- **Deletes:** `DELETE /holidays/{holidayId}/{kind}/{id}` is the one generic
  route from §5.1. In this phase the Lambda accepts only
  `kind = attendees` and returns `400 validation` for the others. Later
  phases add kinds.
- **`GET /holidays/{holidayId}`** already returns the full `HolidayFacts`
  shape. `meals`, `trips` and `stockChanges` are empty arrays until later
  phases.
- **IDs:** the client generates UUIDv7s with the `uuid` package.
- **Seed data:** `make seed-test EMAIL=` looks up the user's `sub` with
  `admin-get-user`, builds the items with `jq`, and writes them with
  `transact-write-items` using the admin profile. The human runs it.
- **Component tests:** add `@testing-library/svelte` with `jsdom` to
  Vitest, for the components in this phase.
- **Attendees in mealtimes:** there are no meals yet, so deleting an attendee
  is a plain delete. The "remove from meals first" flow (§7.4 People) comes
  with phase 4.

## Prerequisites

- [ ] The human creates a second test user (`make create-user ENV=test`) to
      check "a friend's changes after a refresh".

## PR 2.1: Holidays API

- [x] **1. Model and validation.** `backend/internal/model` (holiday, member,
      attendee, `HolidayFacts`, the `*Input` types, with `json` and
      `dynamodbav` tags) and `backend/internal/validate` (names 1–100
      characters, dates, `startDate <= endDate`, time zone, UUIDs).
  - Tests first: table-driven `validate` tests, including each boundary;
    JSON round trips of each model type.
- [x] **2. Auth.** `backend/internal/auth`: the caller from the proxy event's
      authorizer claims; an error when `sub` is missing.
  - Tests first: claims present, missing, and without `name`.
- [x] **3. Store.** `backend/internal/store`, behind an interface the
      handlers use:
  - get, put with a version condition (`version: 0` creates with
    `attribute_not_exists`), delete, partition query (paginated), membership
    check, member count, the create-holiday transaction, my-holidays via
    `gsi1` plus `BatchGetItem` (retrying unprocessed keys), and
    delete-holiday paging (`BatchWriteItem` in 25s, retrying unprocessed
    items)
  - errors the handlers map: `ErrVersionConflict` (with the current item),
    `ErrAlreadyExists`, `ErrNotFound`
  - `make test-go` with DynamoDB Local, per the decision above
  - Tests first, against DynamoDB Local: version conditions, create
    conflicts, membership, member count, holiday deletion with more than 25
    items, and listing more than 100 holidays.
- [x] **4. Holidays Lambda.** `backend/cmd/holidays`, routing on
      `(httpMethod, resource)`:
  - `GET /holidays`, `PUT /holidays/{id}` (create in one transaction, or
    update `META`), `GET /holidays/{id}`, `DELETE /holidays/{id}`
  - members `PUT`/`DELETE`, with the last-member rule
  - attendees `PUT`, and the generic `DELETE` for `attendees`
  - one JSON log line per request (route, holiday ID, sub, status,
    duration), via `log/slog`
  - Tests first, with a fake store: every route's success path, membership
    (`403` and `404`), each `409` code, `400` for each validation failure,
    and `500` without details.
- [x] **5. Users Lambda.** `backend/cmd/users`: `GET /users` via paginated
      `ListUsers`, returning `sub` and `name` (falling back to the email's
      local part), never emails.
  - Tests first, with a fake Cognito client: pagination, name fallback, and
    no email in the response.
- [x] **6. OpenAPI.** `terraform/module/meal-planner/openapi.yaml`: the routes
      above with the Cognito authoriser, request validators, schemas (§5.2
      limits and patterns), and the error shape; `make api-types`.
  - Tests first: a `terraform test` that the rendered body contains each
    route with the authoriser and a Lambda integration; `make
    api-types-check` passes.
- [x] **7. DynamoDB table.** `meal-planner-<env>-data` per §4: on-demand,
      PITR, `gsi1` keys-only, deletion protection in prod only.
  - Tests first: `terraform test` for the keys, GSI projection, PITR, and
    deletion protection on in prod and off in test.
- [x] **8. Lambda module and functions.** `terraform/module/lambda` (function
      from a placeholder, `ignore_changes` on code, its own role and 14-day
      log group, API invoke permission). The `holidays` and `users`
      functions with §6's least-privilege policies and environment
      variables; their ARNs in the OpenAPI template; function names as
      outputs. `make lock`.
  - Tests first: `terraform test` for runtime, architecture, memory,
    timeout, the IAM actions and resources of each function, and log
    retention.
- [ ] **9. Build and deploy.** Make: build `build/lambdas/<name>/bootstrap`
      (`GOOS=linux GOARCH=arm64`, `-tags lambda.norpc`), reproducible zips,
      `deploy-lambdas ENV=`, added to `deploy-test` and `make build`. The
      prod deploy workflow sets up Go from `backend/go.mod` and runs
      `make deploy-lambdas ENV=prod`. Update DESIGN §9 and the AGENTS.md
      commands table.
  - Check: `make build` makes both zips; two builds give identical zips.
- [ ] **10. Deploy to test.** The human runs `make deploy-test`. Then
      `GET /api/holidays` without a token returns `401`, and the functions
      have the real code (`aws lambda get-function`, read-only profile).
- [ ] **11. PR and review.** Open the PR; Codex loop.

## PR 2.2: Holidays UI

- [ ] **12. API client.** `src/lib/api/client.ts`: typed `get`/`put`/`del`
      from the generated types, adding the ID token, parsing the error shape
      into a typed `ApiError`. `src/lib/stores/users.svelte.ts`: `GET /users`
      cached for the session.
  - Tests first: headers, success parsing, each error code, network errors,
    and the users cache fetching once.
- [ ] **13. Holiday store and `mutate()`.** `src/lib/stores/holiday.svelte.ts`
      (load, refetch at most every 30 s on focus, refresh) and `mutate()` per
      §7.3, with a toast store and a toast component.
  - Tests first: optimistic apply, replace on success, version conflict
    (replace with `current` and a toast with **Refresh holiday**), retry
    with backoff up to 3 times on network errors and `5xx`, rollback with an
    error toast, and the `already-exists` re-fetch rule from §5.3.
- [ ] **14. Holiday list.** `/` lists my holidays (name and dates) and has a
      create form (name, start and end dates, time zone defaulting to the
      browser's). Creating goes to the new holiday.
  - Tests first: component tests for the form's validation and the time-zone
    default; the list's empty state.
- [ ] **15. Holiday layout and Overview.** `/holidays/[holidayId]/+layout`:
      loads the holiday; a bottom tab bar on mobile and a sidebar on desktop
      with only Overview and People enabled (the others shown disabled); a
      refresh button. Overview shows the name and dates. A `404` or `403`
      shows a message with a link back to `/`.
  - Tests first: component tests for the disabled tabs and the error states.
- [ ] **16. People.** `/holidays/[holidayId]/people`: attendees (add, rename,
      delete) and members (add from `GET /users`, showing names; remove;
      removing yourself confirms and returns to `/`; the last-member error
      shown plainly).
  - Tests first: component tests for each action and the confirmation.
- [ ] **17. E2E.** Playwright against the dev server with the API mocked by
      route interception: create a holiday, add an attendee, add a member,
      and a version conflict showing the toast. Axe checks on each new page,
      desktop and Pixel 7.
- [ ] **18. Seed.** `make seed-test EMAIL=`, per the decision above.
- [ ] **19. Verify in test (human).** `make deploy-test`, then the "You can"
      list, using the second user for the refresh check.
- [ ] **20. PR and review.** Open the PR; Codex loop.
