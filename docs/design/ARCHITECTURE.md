# Architecture

This document describes how the meal planner is built and deployed. Domain terms
(holiday, meal, mealtime, stock, shopping trip, etc.) are defined in
[PROJECT_BRIEF.md](PROJECT_BRIEF.md) and used here with the same meaning.

## Summary

The app is a static single-page app with a thin data API. **All planning logic
runs in the browser.**

- The backend stores and returns **facts** only: holidays, attendees, meals and
  their mealtimes, shopping trips, stock changes, recipes and ingredients.
- The browser loads a whole holiday plus the shared catalogue and runs the
  **planning engine**. The engine is a pure TypeScript module that replays the
  holiday in time order and derives stock levels, shopping lists and shortfalls.
- Derived results are never stored. Any edit simply re-runs the engine, so a
  last-minute change can never leave a stale total behind.

```plain
                ┌──────────────────────┐        ┌──────────────┐
                │  CloudFront          │        │   Cognito    │
  Browser ─────▶│  meal-planner        │        │  user pool   │
  (SvelteKit    │  .wildsea.lowe.kiwi  │        └──────▲───────┘
   SPA +        │                      │               │ JWT authorizer
   planning     │   /*     ─▶ S3 (UI)  │        ┌──────┴───────┐     ┌──────────┐     ┌──────────┐
   engine)      │   /api/* ───────────────────▶ │ API Gateway  │────▶│  Lambda  │────▶│ DynamoDB │
                └──────────────────────┘        │  (REST)      │     │  (Go)    │     │ (single  │
                                                └──────────────┘     └──────────┘     │  table)  │
                                                                                      └──────────┘
```

### Why this shape

- The brief says a full replay of a holiday (under ~30 days) is cheap, and
  refresh-to-see-changes is enough. Neither needs server-side computation.
- Computing locally makes planning screens update instantly. For example,
  moving an attendee off a lunch shows the new shopping list straight away.
- On a phone in a shop, one load gives the full shopping list; only ticking
  items off needs the network.
- The engine is a pure function, so it's straightforward to unit test.
- If server-side answers are ever needed (alerts, reports), the engine package
  can run unchanged in a Node.js Lambda.

Alternatives considered: running the engine in Lambda on each request, and
precomputing results via DynamoDB Streams. Both were rejected as more
infrastructure and slower feedback for needs the brief doesn't have.

## Technology stack

| Layer            | Technology                                                           |
| ---------------- | -------------------------------------------------------------------- |
| UI framework     | SvelteKit (Svelte 5) with `adapter-static`, TypeScript               |
| Planning engine  | Pure TypeScript module, no framework or browser dependencies         |
| Build tool       | Vite                                                                 |
| Auth client      | Amplify v6 library (Auth only; no Amplify CLI or Hosting)            |
| API              | API Gateway REST API, defined by an OpenAPI document                 |
| Backend handlers | Go Lambdas (`provided.al2023`, arm64)                                |
| Database         | DynamoDB, single table, on-demand billing                            |
| Authentication   | Cognito user pool, admin-created users only                          |
| Hosting          | S3 + CloudFront, ACM certificate, Route 53 under `wildsea.lowe.kiwi` |
| Infrastructure   | Terraform, run only via Make targets                                 |
| CI/CD            | GitHub Actions with OIDC into AWS                                    |
| Testing          | Vitest (unit/component), Go tests, Playwright (E2E)                  |
| Package manager  | pnpm                                                                 |

These choices match `../dnd-planner` so that its Terraform modules, Makefile
patterns and pipelines can be reused.

## Frontend

### Structure

```plain
src/
  lib/
    engine/        # planning engine: pure TS, no imports from svelte or the DOM
    api/           # typed API client (types generated from openapi.yaml)
    stores/        # holiday + catalogue state (Svelte 5 runes)
    components/
  routes/          # SvelteKit pages (static, client-rendered)
data/
  common-ingredients.json   # suggested ingredients shipped with the app
```

### Data flow

1. Opening a holiday fetches `GET /api/holidays/{id}` (all of the holiday's
   facts) and `GET /api/catalogue` (all recipes and ingredients).
2. These populate a holiday store. Engine output is a `$derived` value of that
   store, so every view (shopping list, shortfalls, stock at a time) updates
   whenever a fact changes.
3. Edits are applied to the store at once (optimistic) and sent to the API. If
   a write fails, the store rolls back and the user sees an error explaining
   what happened.
4. Other users' changes appear on refresh. The app also refetches when the tab
   regains focus. There are no real-time updates (a non-goal).

### Mobile

The shopping list and the stock add/remove views are mobile-first. Other views
may be desktop-first. Writes from the shopping view use client-generated IDs, so
a retry after a dropped connection can't create duplicates.

### Helpfulness

Pickers for recipes and ingredients do fuzzy matching against the
already-loaded catalogue, with no server search. Suggestions also come from
`data/common-ingredients.json`. Choosing one that isn't yet in the catalogue
creates it with its unit and shop section.

## Planning engine

The engine is the core of the app. It lives in `src/lib/engine/` and must stay
independent of Svelte, the DOM and the API client.

```ts
plan(facts: HolidayFacts, catalogue: Catalogue, now: LocalDateTime): Plan
```

**Input:** the holiday's facts, the recipe and ingredient catalogue, and the
current time in the holiday's time zone.

### Output (`Plan`)

- the stock of each ingredient after each event
- each shopping trip's shopping list, grouped by shop section, with
  same-named ingredients side by side
- shortfalls, each linked to the mealtime and ingredient involved
- warnings, such as a meal with no recipe yet or a reference to a deleted
  catalogue item

### Processing

- All events (manual stock changes, trip purchases, mealtime consumption) are
  sorted by holiday-local time.
- When several events share the same time they run in a fixed order: manual
  stock changes, then trip purchases, then mealtime consumption. So a trip at
  17:00 can supply a dinner at 17:00.
- Mealtime consumption is the recipe's ingredients scaled by the number of
  attendees ÷ the recipe's servings, with no rounding.
- **Upcoming trips** are assumed to obtain their whole shopping list. A trip's
  list covers, per ingredient, the mealtimes after the trip up to the next trip
  that can also obtain that ingredient's shop section, minus the stock
  projected at the trip.
- **Trips that have happened** contribute only their recorded purchases.
- A shortfall occurs when a mealtime needs more of an ingredient than the
  projected stock.

The detailed rules, such as when a trip counts as "happened" and how stock
behaves after a shortfall, are in [DESIGN.md §3](DESIGN.md#3-planning-engine)
and the engine's tests.

## API

The API is defined in `terraform/module/meal-planner/openapi.yaml` and served
by API Gateway (REST) under `/api/*` on the app's own CloudFront domain. Because
the app and API share one origin, no CORS setup is needed. API Gateway
validates request bodies against the OpenAPI schemas, and the frontend's
TypeScript types are generated from the same file.

The API is plain data access, with few endpoints:

| Method & path                                      | Purpose                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/holidays`                                | Holidays the caller is a member of                              |
| `PUT /api/holidays/{holidayId}`                    | Create or update a holiday's details                            |
| `GET /api/holidays/{holidayId}`                    | Every fact in the holiday (one partition Query)                 |
| `DELETE /api/holidays/{holidayId}`                 | Delete the holiday and all its items                            |
| `PUT /api/holidays/{holidayId}/{kind}/{itemId}`    | Create or update a member, attendee, meal, trip or stock change |
| `DELETE /api/holidays/{holidayId}/{kind}/{itemId}` | Remove one of those                                             |
| `GET /api/catalogue`                               | All recipes and ingredients                                     |
| `PUT /api/catalogue/{kind}/{itemId}`               | Create or update a recipe or ingredient                         |
| `DELETE /api/catalogue/{kind}/{itemId}`            | Soft-delete a recipe or ingredient                              |
| `GET /api/users`                                   | Cognito users, for adding members to a holiday                  |

- **IDs** are generated by the client (UUIDv7), so creation is an idempotent
  `PUT`.
- **Lambdas**: one per area (`holidays`, `catalogue`, `users`), in
  `backend/cmd/<name>`, sharing code in `backend/internal`.

### Authorisation

- API Gateway's Cognito authorizer rejects requests without a valid JWT.
- For any `/holidays/{holidayId}/...` route, the Lambda first checks that a
  `MEMBER#<caller sub>` item exists in that holiday, and returns `403` if not.
  All members have equal rights.
- Catalogue routes are open to any signed-in user.
- The `users` Lambda calls Cognito `ListUsers` and returns only an ID and a
  display name per user.

### Concurrent edits

Every item carries a `version` number:

- An update sends the version it last read, and the Lambda writes with a
  DynamoDB condition on that version.
- On a mismatch the API returns `409`, and the UI says someone else changed the
  item and offers to refresh.
- Creates use `attribute_not_exists`.
- Shopping purchases are separate stock-change items rather than edits to the
  trip. Two people ticking off items on the same trip therefore never conflict.

## Data model

A single DynamoDB table (`PK`, `SK`) with one GSI. The details are in
[DESIGN.md §4](DESIGN.md#4-dynamodb-storage); the layout is:

| PK             | SK                 | Item                                                                                                  |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `HOLIDAY#<id>` | `META`             | Holiday name, time zone, date range                                                                   |
| `HOLIDAY#<id>` | `MEMBER#<userSub>` | Membership; `GSI1PK=USER#<userSub>` lists a user's holidays                                           |
| `HOLIDAY#<id>` | `ATTENDEE#<id>`    | Attendee name                                                                                         |
| `HOLIDAY#<id>` | `MEAL#<id>`        | Meal name, recipe ID (optional), and its **mealtimes** embedded (each with ID, time and attendee IDs) |
| `HOLIDAY#<id>` | `TRIP#<id>`        | Shopping trip time, shop sections covered, status                                                     |
| `HOLIDAY#<id>` | `STOCK#<id>`       | Stock change: time, ingredient, quantity (±), source (`manual` or trip ID)                            |
| `CATALOGUE`    | `RECIPE#<id>`      | Recipe name, servings, ingredient lines, notes                                                        |
| `CATALOGUE`    | `INGREDIENT#<id>`  | Ingredient name, unit, shop section                                                                   |

Design points:

- **One Query per screen load.** A holiday is a single partition, and so is the
  catalogue. Both are small enough to read whole.
- **Mealtimes are embedded in their meal.** A meal is the unit the UI edits.
  Changing a generic meal's dates regenerates its mealtimes in one write, and
  the item size limit isn't a concern.
- **Purchases are stock changes** with a trip as their source. The engine
  doesn't need to tell them apart beyond knowing which trip they came from.
- **Times** are stored as holiday-local ISO date-times without an offset
  (`2027-01-01T18:00`). The holiday's IANA time zone is used only to work out
  "now".
- **Catalogue deletes are soft** (`deleted: true`). Old holidays can still
  resolve the recipes and ingredients they refer to, while pickers hide them.
- Point-in-time recovery is enabled on the table.

## Infrastructure and deployment

The deployment is modelled on `../dnd-planner` and uses the same AWS account
and region (`ap-southeast-2`). Resources are prefixed `meal-planner-<env>` and
Terraform state is kept under its own key prefix.

```plain
terraform/
  module/
    meal-planner/      # CloudFront, S3, ACM (us-east-1), Route 53 record, Cognito,
                       # API Gateway + openapi.yaml, Lambdas, DynamoDB
    lambda/            # reusable Lambda module
    oidc/ iac-roles/ state-infrastructure/
  environment/
    state/ aws/ github/    # one-off bootstrap
    test/                  # meal-planner-test.wildsea.lowe.kiwi
    prod/                  # meal-planner.wildsea.lowe.kiwi
    _shared/
```

| Environment | Host                                  | Deployed by                                 |
| ----------- | ------------------------------------- | ------------------------------------------- |
| test        | `meal-planner-test.wildsea.lowe.kiwi` | `make deploy-test` from a developer machine |
| prod        | `meal-planner.wildsea.lowe.kiwi`      | GitHub Actions on merge to `main`           |

- **Make** is the only interface to Terraform, the Lambda builds and the UI
  builds/uploads. Terraform is never run directly.
- **GitHub Actions:**
  - plan on pull request
  - on merge to `main`: lint, typecheck, unit and E2E tests, then
    `terraform apply`, then Lambda code and UI upload with CloudFront
    invalidation
  - a security workflow (Trivy IaC scan, dependency audit)
  - Dependabot with auto-merge for passing minor updates
- **Cognito:**
  - `allow_admin_create_user_only = true`
  - users are created with `aws cognito-idp admin-create-user` via a Make
    target
  - no post-confirmation trigger is needed
- **Observability:** API Gateway access logs and Lambda logs go to CloudWatch
  with short retention, matching dnd-planner.

## Testing

| Layer      | Tooling                  | Focus                                                                                                |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Engine     | Vitest                   | The bulk of the tests: scaling, ordering, trip coverage, shortfalls, past vs upcoming trips          |
| Components | Vitest + Testing Library | Pickers, mealtime entry, shopping list interactions                                                  |
| Lambdas    | Go tests                 | Membership checks, version conditions, input mapping                                                 |
| End to end | Playwright               | Main flows against the dev server and the test environment, including a mobile viewport for shopping |

## Future options

These are not planned, but the architecture keeps them open:

- **Server-side planning** (alerts, emailed shopping lists): run
  `src/lib/engine` in a Node.js Lambda.
- **Real-time updates**: add API Gateway WebSockets or AppSync for change
  notifications. The holiday's data stays the same; clients just refetch.
- **Social login**: add an identity provider to the Cognito user pool.
