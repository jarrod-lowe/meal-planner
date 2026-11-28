# Phase 4: Plan one-off meals

**Goal:** plan meals on a grid of days and slots, give them recipes and
eaters, and see the scaled ingredients, computed by the first slice of the
planning engine.

You can:

- see the holiday as a grid of days and meal slots
- add a one-off meal from an empty cell (the date, slot and time come
  prefilled)
- give the meal a recipe, or leave it as *No recipe yet*
- choose who's eating, with *Everyone* / *No one* shortcuts
- see the recipe's ingredients scaled to the number of people eating, updating
  as you tick people
- put Dinner A and Dinner B side by side

Source: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase 4. Design
references: DESIGN §1, §2.1 (`MEAL_SLOTS`, `SLOT_DEFAULT_TIMES`), §2.2
(`Meal`, `Mealtime`), §2.3, §3 intro, §3.1, §3.2, §3.3, §3.6, §5.1–5.3, §7.2,
§7.3, §7.4 (planner grid, meal editor, overview, people), §10 (engine tests).

## Decisions

- **Engine slice:** `plan()` returns the full `Plan` shape. This phase fills
  `consumption` and four warnings: `meal-without-recipe` (only when one of
  the meal's mealtimes is at or after `now`), `mealtime-without-attendees`,
  `missing-recipe` and `missing-ingredient` (recipe lines). `shoppingLists`,
  `shortfalls` and `stock` are empty until phases 6 and 7. The other warnings
  come with the phases that need them.
- **Engine types** are written by hand in `src/lib/engine/types.ts`, matching
  §3, with the stored facts taken from the generated API types. The engine
  imports only types from the API module, never the client, and the ESLint
  guard allows that.
- **Meal validation** in the Lambda: name 1–100, slot in `MEAL_SLOTS`,
  `recipeId` a UUID or `null`, 1–100 mealtimes, each `at` a real
  `LocalDateTime`, mealtime IDs unique, attendee IDs unique within a mealtime
  (up to 100). The server stores mealtimes sorted by `at`. Referenced recipe
  and attendee IDs aren't checked (§5.2).
- **Nullable `recipeId`:** written as `nullable: true` in `openapi.yaml`, and
  turned into a draft-04 type list in `api.tf`, as `current` already is.
- **`HolidayFacts.meals`** becomes a typed `Meal[]` in the API and in Go.
  `trips` and `stockChanges` stay loosely typed until their phases.
- **Deleting a meal:** a static `DELETE /holidays/{holidayId}/meals/{id}` route,
  plus `meals` accepted by the generic `{kind}` delete, like attendees.
- **Now:** `now.svelte.ts` gives the holiday-local `LocalDateTime` from the
  holiday's time zone with `Intl.DateTimeFormat`, ticking every minute. It is
  outside the engine, which only takes `now` as a string.
- **Holiday layout loads the catalogue** as well as the holiday, as §7.2
  says, so the plan can resolve recipes.
- **Planner on phones:** the grid is desktop-first. Below 48rem it becomes a
  list of days, each with its slots, using the same cells.
- **This phase's grid** shows one-off meals as chips (name, recipe or *No
  recipe yet*, servings). Joined bars for several-day meals come in phase 5,
  shortfall dots in phase 6, and trip markers in phase 7.
- **Meal editor, one-day mode only:** name (suggested from the date and slot,
  for example "1 Jan Dinner", until edited), slot, date, time (defaulting to
  the slot's time), recipe picker, attendee checkboxes with *Everyone* and
  *No one*, a live preview, save, and delete with a confirm. A new meal
  starts with everyone ticked. The name follows the app's en-GB date format,
  so DESIGN's "Jan 1 Dinner" examples are updated to match.
- **Preview** uses the engine on the draft, not the saved meal: the editor
  runs `plan()` on the holiday's facts with the draft swapped in, so it
  updates as you tick people.
- **Create a recipe from the meal editor:** *Create new recipe* opens
  `/recipes/new?return=<meal editor path>`. The unsaved meal draft is kept in
  memory meanwhile. After saving, the recipe editor returns with the new
  recipe ID, and the meal editor picks it up.
- **Deleting an attendee who eats meals** (deferred from phase 2): People
  lists the meals first, then removes the attendee from each with a `PUT`
  per meal before deleting them, per §7.4.

## PR 4.1: Meals API and engine consumption

- [x] **1. Meal model and validation.** `Meal` and `Mealtime` in
      `backend/internal/model`, typed `HolidayFacts.Meals`, `MealInput`, and
      the checks above in `validate`.
  - Tests first: table-driven checks at each boundary (0, 1, 100, 101
    mealtimes; duplicate mealtime and attendee IDs; bad and impossible
    date-times; null and bad `recipeId`); JSON round trip with `null`.
- [x] **2. Meal routes.** `PUT /holidays/{holidayId}/meals/{id}` (membership,
      versioned create and update, mealtimes stored sorted) and the meal
      `DELETE`s, in the `holidays` Lambda; `LoadHoliday` returns meals.
  - Tests first, with the fake store: create, update, conflict,
    `already-exists`, membership `403`/`404`, validation `400`s, sorted
    mealtimes, delete on both routes; a store test that a loaded holiday
    includes its meals.
- [x] **3. OpenAPI.** `Meal`, `Mealtime`, `MealInput`, `MealSlot`, the routes,
      nullable `recipeId`, and typed `HolidayFacts.meals`; `make api-types`.
  - Tests first: the route test requires the new routes; a schema test that
    the imported body has the draft-04 type list for `recipeId`.
- [x] **4. Engine types and `factsBuilder()`.** `src/lib/engine/types.ts`
      (`HolidayFacts`, `Catalogue`, `Plan` and its parts, `Warning`), the
      fixed lists in `src/lib/model/` (`MEAL_SLOTS`, `SLOT_DEFAULT_TIMES`),
      and a `factsBuilder()` test helper that builds a holiday in a few lines.
  - Tests first: the builder's own tests; `MEAL_SLOTS` matches the API enum.
- [x] **5. Engine consumption.** `plan()` with reference resolution (§3.2)
      and consumption (§3.3).
  - Tests first: recipe for 4 eaten by 8 doubles; 3 eaten by 2 gives exact
    fractions; 0 attendees consume nothing; a deleted attendee isn't
    counted; a soft-deleted recipe and ingredient are used normally; a
    missing recipe gives no consumption; a missing ingredient's line is
    skipped; Dinner A and Dinner B both consume.
- [x] **6. Engine warnings.** The four warnings above, in a stable order.
  - Tests first: each warning; `meal-without-recipe` only when a mealtime is
    at or after `now`; dangling references give the right warnings and
    nothing else; output order is deterministic.
- [x] **7. Deploy to test.** The agent runs `make deploy-test`; then the meal
      routes return `401` without a token.
- [ ] **8. PR and review.** Open the PR; Codex loop.

## PR 4.2: Planner and meal editor

- [ ] **9. `now` and `plan` stores.** `now.svelte.ts` (holiday-local, ticks
      each minute, injectable clock) and `plan.svelte.ts` (`$derived` from
      the holiday and catalogue stores and `now`). The holiday layout also
      loads the catalogue. `mutate()` gains the `meals` kind.
  - Tests first: `now` in another time zone and across midnight; the plan
    re-derives when facts change; meal create, update, delete and conflict
    through `mutate()`.
- [ ] **10. Planner grid.** `/holidays/[holidayId]/plan`: days × slots,
      chips, parallel meals side by side, **+** on empty cells (and beside
      existing meals, for Dinner B), the phone list layout, keyboard
      navigation; Plan enabled in the holiday navigation.
  - Tests first: component tests for rows and columns from the dates,
    parallel meals, *No recipe yet*, servings, the **+** link's prefill, and
    the phone layout.
- [ ] **11. Meal editor.** `/holidays/[holidayId]/meals/[mealId]` (`new`
      creates, prefilled from the query): the fields above, the live
      preview, save as one `PUT`, delete with a confirm, and the base-version
      rule from phase 3 (a stale save conflicts, with **Load latest**).
  - Tests first: name suggestion until edited, the slot's default time,
    *Everyone* / *No one*, the preview scaling as people are ticked, the
    save payload, and delete.
- [ ] **12. Create a recipe from the meal.** The `return` flow above.
  - Tests first: the draft survives the round trip and the new recipe is
    selected; an invalid `return` path is ignored (only paths inside the
    app).
- [ ] **13. Overview warnings.** Each warning with a link to fix it: the meal
      editor for meal warnings, the recipe editor for a missing ingredient.
  - Tests first: component tests for each warning's text and link.
- [ ] **14. Deleting an attendee who eats meals.** The People flow above.
  - Tests first: the list of affected meals, one `PUT` per meal, then the
    delete; a failed `PUT` stops before the delete.
- [ ] **15. E2E.** With the mocked API: plan a dinner for 6 using a recipe for
      4 and check the preview shows ×1.5; add Dinner B beside it; a meal
      without a recipe shows on Overview with a working link; create a
      recipe from the meal editor and return. Axe on the planner, the
      editor and Overview, desktop and Pixel 7.
- [ ] **16. Seed.** `make seed-test` adds a few meals to the sample holiday,
      using the seeded recipes.
- [ ] **17. Verify in test (human).** The agent runs `make deploy-test` and
      `make seed-test`; the human checks the "You can" list.
- [ ] **18. PR and review.** Open the PR; Codex loop.
