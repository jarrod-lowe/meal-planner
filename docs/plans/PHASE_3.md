# Phase 3: Ingredient and recipe catalogue

**Goal:** a shared catalogue of ingredients and recipes, edited in the app and
ready for meals in phase 4.

You can:

- add ingredients (name, unit, shop section), with suggestions from a common
  list and a warning if one is a duplicate
- add and edit recipes: servings, ingredient lines picked by fuzzy search, and
  notes
- search for recipes and ingredients
- hide recipes and ingredients you no longer want offered

Source: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase 3. Design
references: DESIGN §2.1 (shop sections), §2.2 (`Recipe`, `Ingredient`), §2.3
(soft deletes, duplicates), §4 (the `CATALOGUE` partition), §5.1–5.3, §6,
§7.3 (`catalogue.svelte.ts`, `mutate()`), §7.4 (recipe editor, ingredient
picker), §10 (component tests); ARCHITECTURE "Helpfulness".

## Decisions

- **One shared catalogue.** Every signed-in user can read and edit it; there's
  no per-user or per-holiday catalogue and no membership check.
- **Hiding and showing again:** `DELETE /catalogue/{kind}/{id}` sets
  `deleted: true` and bumps `version`, unconditionally and idempotently (get,
  then put with a version condition, retried on a conflict). `RecipeInput` and
  `IngredientInput` include `deleted`, so the UI shows an item again with a
  `PUT` of `deleted: false`. The lists have a **Show hidden** toggle.
- **`GET /catalogue`** reads every page of the partition and returns
  `{ recipes, ingredients }`, hidden items included.
- **Validation** (§5.2 plus): names 1–100 characters, unit 1–20, notes up to
  10,000, servings and quantities > 0, up to 200 lines, the `ShopSection`
  enum, and each ingredient at most once per recipe. Referenced ingredient
  IDs aren't checked to exist (§5.2).
- **IAM:** `catalogue` gets `GetItem`, `PutItem` and `Query` on the table,
  per §6. It reuses the `store` package's versioned put.
- **Shared write queue.** The per-item queue, version handling, retries and
  sign-out cancellation in `holiday.svelte.ts` move into one module that both
  `holiday.svelte.ts` and `catalogue.svelte.ts` use. The holiday store's tests
  must pass unchanged.
- **Navigation:** the root layout gets an app header with **Holidays**,
  **Recipes** and **Ingredients** links and the sign-out control. The holiday
  layout's tabs stay as they are.
- **Fuzzy search:** Fuse.js (latest stable), over names, with a threshold
  tuned in tests. Results with the same name sit together, sorted by unit.
- **Pickers** follow the WAI-ARIA combobox pattern (an input with a listbox),
  usable by keyboard alone.
- **Common ingredients:** `data/common-ingredients.json` holds about 150
  entries of `{ name, unit, shopSection }`, imported into the bundle via a
  `#data/*` import map entry. A Vitest test checks every entry against the
  schema and that there are no duplicate name + unit pairs.
- **Units** suggested in the create form: units already used for that name in
  the catalogue, then a fixed common list (g, kg, ml, l, each, can, packet,
  bottle, bunch, dozen).
- **"Used in"** on the recipe editor needs meals, so it comes in phase 4.
- **Seed data:** `make seed-test` also writes about 15 ingredients and 4
  recipes with fixed IDs, each put only if it doesn't exist, so running it
  again doesn't duplicate them.

## PR 3.1: Catalogue API

- [x] **1. Model and validation.** `Recipe`, `RecipeLine`, `Ingredient`,
      `Catalogue` and the inputs in `backend/internal/model`, with storage
      keys per §4; the checks above in `backend/internal/validate`.
  - Tests first: table-driven validation at each boundary, including a
    repeated ingredient, the enum, and 200 vs 201 lines.
- [x] **2. Store.** Catalogue load (paginated query of `CATALOGUE`) and soft
      delete (get, put `deleted: true` with a version condition, retried on a
      conflict, `ErrNotFound` if missing).
  - Tests first, against DynamoDB Local: load across pages with hidden items,
    soft delete bumping the version, deleting twice, deleting a missing item,
    and a delete racing an update.
- [x] **3. Catalogue Lambda.** `backend/cmd/catalogue`: `GET /catalogue`,
      `PUT /catalogue/recipes/{id}`, `PUT /catalogue/ingredients/{id}`,
      `DELETE /catalogue/{kind}/{id}` (`kind` is `recipes` or
      `ingredients`), with the same logging and error mapping as `holidays`.
  - Tests first, with a fake store: each route, create, update, conflict,
    `already-exists`, each validation failure, an unknown kind, and `500`
    without details.
- [x] **4. OpenAPI.** The routes and schemas (`Recipe`, `RecipeInput`,
      `Ingredient`, `IngredientInput`, `Catalogue`, the `ShopSection` enum)
      with §5.2's limits; `make api-types`. Static `recipes` and
      `ingredients` segments each get their own `DELETE`, as attendees did.
  - Tests first: the route test requires every new route and method.
- [x] **5. Terraform.** The `catalogue` function through the `lambda`
      module, with its policy and `TABLE_NAME`; add it to `LAMBDAS` and the
      function-name output.
  - Tests first: the function's settings and IAM actions and resources.
- [x] **6. Deploy to test.** The agent runs `make deploy-test`; then
      `GET /api/catalogue` without a token returns `401`, and the function
      runs the built zip.
- [x] **7. PR and review.** Open the PR; Codex loop.

## PR 3.2: Catalogue UI

- [x] **8. Shared write queue.** Extract the queue from
      `holiday.svelte.ts` into `src/lib/stores/mutation-queue.ts`.
  - Tests first: the queue's own tests (moved and generalised); the holiday
    store's tests pass unchanged.
- [x] **9. Catalogue store.** `src/lib/stores/catalogue.svelte.ts`: load once
      per session, refetch on focus at most every 30 s and on **Refresh**,
      clear on sign-out, `mutate()` for both kinds, plus hide and show again.
  - Tests first: load, throttle, create, update, hide, show again, a
    conflict, and sign-out cancellation.
- [x] **10. Search and data.** `src/lib/catalogue/search.ts` (Fuse.js, same
      names together, hidden items left out unless asked) and
      `data/common-ingredients.json` with its validation test.
  - Tests first: typo matching (a misspelt "tomato"), grouping by name, hidden items,
    and suggestions that leave out names + units already in the catalogue.
- [x] **11. App header.** Holidays, Recipes and Ingredients links with
      `aria-current`, and sign-out.
  - Tests first: component test for the links and the active page.
- [x] **12. Ingredient picker.** `IngredientPicker.svelte`: results as
      "Sugar · g · Pantry", suggestions marked *Add to catalogue*, an inline
      create form (name, unit with suggestions, shop section), and a duplicate
      warning for an existing name + unit.
  - Tests first: fuzzy match, keyboard navigation and selection, choosing a
    suggestion creates it, create new, and the duplicate warning.
- [x] **13. Ingredients page.** `/ingredients`: search, a list grouped by
      shop section, inline edit (name, unit, section), add via the create
      form, hide, **Show hidden** and show again.
  - Tests first: component tests for edit, hide and show again.
- [x] **14. Recipes.** `/recipes`: search, list, **Show hidden**, and a new
      recipe button. `/recipes/[recipeId]` (`new` creates): name, servings,
      notes, and lines of picker + quantity with the unit beside it. Enter on
      a quantity adds a line; lines can be removed; save is one `PUT`; hide
      and show again.
  - Tests first: component tests for the keyboard flow, line removal, the
    one-line-per-ingredient rule, and save.
- [x] **15. Recipe picker.** `RecipePicker.svelte`: a fuzzy combobox with a
      *Create new recipe* option, for phase 4.
  - Tests first: component tests for matching, keyboard selection, and the
    create option.
- [x] **16. Seed.** `make seed-test` adds the catalogue items, per the
      decision above.
- [x] **17. E2E.** With the mocked API: create an ingredient from a
      suggestion, build a recipe with the picker (keyboard only), hide it
      and show it again. Axe checks on `/ingredients`, `/recipes` and the
      editor, desktop and Pixel 7.
- [x] **18. Verify in test (human).** The agent runs `make deploy-test` and
      `make seed-test`; the human checks the "You can" list.
- [ ] **19. PR and review.** Open the PR; Codex loop.
