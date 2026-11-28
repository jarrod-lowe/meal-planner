<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { v7 as uuidv7 } from 'uuid';
  import { resolve } from '$app/paths';
  import type { Schemas } from '#lib/api/client.js';
  import { plan, type LocalDateTime } from '#lib/engine/index.js';
  import { formatQuantity } from '#lib/format/quantity.js';
  import { t } from '#lib/i18n/en.js';
  import { isLocalDate } from '#lib/model/dates.js';
  import { servings as servingsOf } from '#lib/model/meals.js';
  import { MEAL_SLOTS, SLOT_DEFAULT_TIMES, type MealSlot } from '#lib/model/slots.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Recipe
  } from '#lib/stores/catalogue.svelte.js';
  import { holiday as appHoliday, type HolidayStore } from '#lib/stores/holiday.svelte.js';
  import { mealDraftKey, mealDrafts, type MealDrafts } from '#lib/stores/meal-drafts.js';
  import { now as appNow } from '#lib/stores/now.svelte.js';
  import { engineCatalogue, engineFacts } from '#lib/stores/plan.svelte.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import {
    hasErrors,
    mealErrors,
    mealFields,
    suggestName,
    type MealDraft,
    type MealErrors
  } from './meal-draft.js';
  import { maxNameLength } from './names.js';
  import RecipePicker from './RecipePicker.svelte';

  type Meal = Schemas['Meal'];

  let {
    store = appHoliday,
    catalogue = appCatalogue,
    now = appNow,
    drafts = mealDrafts,
    mealId,
    date: queryDate = null,
    slot: querySlot = null,
    recipe: returnedRecipeId = null,
    oncreated,
    ondeleted,
    oncreaterecipe
  }: {
    store?: HolidayStore;
    catalogue?: CatalogueStore;
    now?: { readonly current: LocalDateTime | null };
    /** Unsaved drafts kept while the user makes a recipe for the meal. */
    drafts?: MealDrafts;
    /** The meal to edit, or `new`. The route remounts the editor when it changes. */
    mealId: string;
    /** A new meal's date and slot, from the query; ignored unless valid. */
    date?: string | null;
    slot?: string | null;
    /** A recipe just made for this meal, to use in place of the draft's. */
    recipe?: string | null;
    /** A new meal was saved under `id`. */
    oncreated?: (id: string) => void;
    /** The meal was deleted. */
    ondeleted?: () => void;
    /**
     * *Create new recipe* in the picker, with what was typed. The draft is kept
     * in `drafts` meanwhile. Without it, there's no such option.
     */
    oncreaterecipe?: (query: string) => void;
  } = $props();

  const uid = $props.id();
  // The editor is keyed by `mealId`, so these are fixed for its lifetime.
  // svelte-ignore state_referenced_locally
  const isNew = mealId === 'new';
  /** Where this editor's draft is kept while the user makes a recipe for it. */
  const draftKey = untrack(() =>
    mealDraftKey(store.facts?.holiday.id ?? '', mealId, queryDate, querySlot)
  );
  /** The draft left here on the way to making a recipe, if any. */
  const restored = untrack(() => drafts.take(draftKey));
  // svelte-ignore state_referenced_locally
  const id = restored?.id ?? (isNew ? uuidv7() : mealId);

  const facts = $derived(store.facts);
  const attendees = $derived(facts?.attendees ?? []);
  const existing = $derived(isNew ? undefined : facts?.meals.find((meal) => meal.id === id));
  const recipesById = $derived(new Map(catalogue.recipes.map((recipe) => [recipe.id, recipe])));
  const ingredientsById = $derived(new Map(catalogue.ingredients.map((item) => [item.id, item])));

  /** The first mealtime is the one this editor edits; its id stays the same across edits. */
  const mealtimeId = restored?.mealtimeId ?? untrack(() => existing?.mealtimes[0]?.id) ?? uuidv7();

  function isSlot(value: string | null): value is MealSlot {
    return MEAL_SLOTS.some((slot) => slot === value);
  }

  function seed(meal: Meal | undefined): MealDraft {
    if (meal) {
      const [first] = meal.mealtimes;
      return {
        name: meal.name,
        slot: meal.slot,
        date: first?.at.slice(0, 10) ?? '',
        time: first?.at.slice(11, 16) ?? '',
        recipeId: meal.recipeId,
        attendeeIds: [...(first?.attendeeIds ?? [])]
      };
    }
    const slot: MealSlot = isSlot(querySlot) ? querySlot : 'dinner';
    const date =
      queryDate !== null && isLocalDate(queryDate) ? queryDate : (facts?.holiday.startDate ?? '');
    return {
      name: suggestName(date, slot),
      slot,
      date,
      time: SLOT_DEFAULT_TIMES[slot],
      recipeId: null,
      attendeeIds: attendees.map((attendee) => attendee.id)
    };
  }

  /** What a draft would save, for telling whether it has edits. */
  const fieldsOf = (from: MealDraft) =>
    mealFields(from, { id: mealtimeId, rest: existing?.mealtimes.slice(1) ?? [] }, attendees);
  const saveable = (from: MealDraft) => JSON.stringify(fieldsOf(from));

  /**
   * The working copy: the restored draft, or seeded from the stored meal (and
   * again on Load latest). A recipe just made for the meal replaces its own.
   */
  const start = untrack(() => restored?.draft ?? seed(existing));
  let draft = $state<MealDraft>(
    untrack(() => {
      const made = catalogue.recipes.find((candidate) => candidate.id === returnedRecipeId);
      return made ? { ...start, recipeId: made.id } : { ...start };
    })
  );
  /** The name and time follow the date and slot until the user edits them. */
  let nameEdited = $state(
    untrack(() => restored?.nameEdited ?? draft.name !== suggestName(draft.date, draft.slot))
  );
  let timeEdited = $state(
    untrack(() => restored?.timeEdited ?? draft.time !== SLOT_DEFAULT_TIMES[draft.slot])
  );
  /**
   * The stored version the draft is based on, and what it saved as then. A
   * save sends it as the expected version, so it can't overwrite a change
   * that someone else made since.
   */
  let base = $state.raw(
    untrack(() => restored?.base ?? { version: existing?.version, fields: saveable(start) })
  );
  /** This editor's own saves in flight: they change the version too. */
  let ownWrites = $state(0);
  const busy = $derived(ownWrites > 0);

  const dirty = $derived(saveable(draft) !== base.fields);
  const changedElsewhere = $derived(
    existing !== undefined && ownWrites === 0 && existing.version !== base.version
  );

  let submitted = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  let confirmingDelete = $state(false);
  /** Choosing a recipe in place of the one the meal has. */
  let changingRecipe = $state(false);
  let changeButton = $state<HTMLButtonElement>();
  let picker = $state<{ focus(): void }>();
  /** A new meal's fields while its first save is in flight: the editor remounts from its response. */
  const locked = $derived(isNew && saving);
  const errors = $derived<MealErrors>(submitted ? mealErrors(draft) : {});

  const fieldId = (name: string) => `${uid}-${name}`;

  function edited() {
    saved = false;
  }

  function setSlot(slot: MealSlot) {
    edited();
    draft.slot = slot;
    if (!timeEdited) draft.time = SLOT_DEFAULT_TIMES[slot];
    if (!nameEdited) draft.name = suggestName(draft.date, slot);
  }

  function setDate(date: string) {
    edited();
    draft.date = date;
    if (!nameEdited) draft.name = suggestName(date, draft.slot);
  }

  function setName(name: string) {
    edited();
    draft.name = name;
    nameEdited = true;
  }

  function setTime(time: string) {
    edited();
    draft.time = time;
    timeEdited = true;
  }

  function setEveryone(all: boolean) {
    edited();
    draft.attendeeIds = all ? attendees.map((attendee) => attendee.id) : [];
  }

  async function chooseRecipe(recipe: Recipe) {
    if (locked) return;
    edited();
    draft.recipeId = recipe.id;
    changingRecipe = false;
    await tick();
    changeButton?.focus();
  }

  async function changeRecipe() {
    changingRecipe = true;
    await tick();
    picker?.focus();
  }

  async function removeRecipe() {
    edited();
    draft.recipeId = null;
    changingRecipe = false;
    await tick();
    picker?.focus();
  }

  async function focusElement(elementId: string) {
    await tick();
    document.getElementById(elementId)?.focus();
  }

  async function save() {
    if (busy) return;
    submitted = true;
    saved = false;
    const found = mealErrors(draft);
    if (hasErrors(found)) {
      const first = found.name ? 'name' : found.date ? 'date' : 'time';
      return void focusElement(fieldId(first));
    }
    saving = true;
    ownWrites++;
    try {
      const fields = fieldsOf(draft);
      const sent = JSON.stringify(fields);
      const result = await store.mutate({
        kind: 'meals',
        id,
        fields,
        expectedVersion: base.version
      });
      if (result.outcome === 'saved') {
        base = { version: existing?.version, fields: sent };
        saved = true;
        drafts.clear(draftKey);
        if (isNew) oncreated?.(id);
      }
    } finally {
      ownWrites--;
      saving = false;
    }
  }

  /** Reseeds the draft from the stored meal, dropping its edits. */
  function reseed() {
    draft = seed(existing);
    nameEdited = draft.name !== suggestName(draft.date, draft.slot);
    timeEdited = draft.time !== SLOT_DEFAULT_TIMES[draft.slot];
    base = { version: existing?.version, fields: saveable(draft) };
    changingRecipe = false;
    submitted = false;
    saved = false;
  }

  function loadLatest() {
    reseed();
    void focusElement(fieldId('name'));
  }

  // Someone else's change, with nothing here to lose: take it. An effect, not
  // a `$derived`, since the draft is a working copy the inputs bind to.
  $effect(() => {
    if (changedElsewhere && !dirty) untrack(reseed);
  });

  function askDelete() {
    if (!busy) confirmingDelete = true;
  }

  function remove() {
    // Optimistic: the meal leaves the plan at once, and a failure brings it back with a toast.
    void store.mutate({ kind: 'meals', id, remove: true, label: existing?.name });
    drafts.clear(draftKey);
    ondeleted?.();
  }

  /** Keeps the draft, as it is, for when the user comes back with a recipe. */
  function createRecipe(query: string) {
    if (locked) return;
    drafts.put(draftKey, {
      id,
      mealtimeId,
      draft: $state.snapshot(draft),
      nameEdited,
      timeEdited,
      base
    });
    oncreaterecipe?.(query);
  }

  const recipe = $derived(draft.recipeId === null ? undefined : recipesById.get(draft.recipeId));
  const servings = $derived(servingsOf(draft, attendees));

  /** The engine's consumption for the draft's mealtime, with the draft in place of the stored meal. */
  const consumption = $derived.by(() => {
    if (!facts || !recipe || servings === 0) return [];
    const meal: Meal = {
      ...fieldsOf(draft),
      id,
      version: existing?.version ?? 0,
      updatedAt: '',
      updatedBy: ''
    };
    const others = facts.meals.filter((other) => other.id !== id);
    const result = plan(
      { ...engineFacts(facts), meals: [...others, meal] },
      engineCatalogue(catalogue),
      now.current ?? ''
    );
    return result.consumption.get(mealtimeId) ?? [];
  });

  const holidayId = $derived(facts?.holiday.id ?? '');
  const holidayName = $derived(facts?.holiday.name ?? '');
</script>

<svelte:head>
  <title>
    {existing
      ? t('meal.title', { name: existing.name, holiday: holidayName })
      : t('meal.newTitle', { holiday: holidayName })}
  </title>
</svelte:head>

<div class="editor">
  <a class="back" href={resolve('/holidays/[holidayId]/plan', { holidayId })}>{t('meal.back')}</a>

  {#if !isNew && !existing}
    <h1>{t('meal.notFound.heading')}</h1>
    <p role="alert" class="error">{t('meal.notFound.message')}</p>
  {:else}
    <div class="title">
      <h1>{existing ? existing.name : t('meal.newHeading')}</h1>
      {#if existing}
        <button type="button" class="danger" onclick={askDelete} aria-disabled={busy}>
          {t('meal.delete')}
        </button>
      {/if}
    </div>
    <!-- Always present, so screen readers announce the notice when it appears. -->
    <div role="status">
      {#if changedElsewhere}
        <div class="changed">
          <p>{t('meal.changedElsewhere')}</p>
          <button type="button" onclick={loadLatest}>{t('meal.loadLatest')}</button>
        </div>
      {/if}
    </div>

    <!-- A new meal's first save remounts the editor from the response, so lock its fields meanwhile. -->
    <fieldset class="draft" role="presentation" disabled={locked}>
      <div class="fields">
        <div class="field grow">
          <label for={fieldId('name')}>{t('meal.name')}</label>
          <input
            id={fieldId('name')}
            type="text"
            autocomplete="off"
            maxlength={maxNameLength}
            bind:value={() => draft.name, setName}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? fieldId('name-error') : undefined}
          />
          {#if errors.name}
            <p id={fieldId('name-error')} class="error">{t(`meal.errors.${errors.name}`)}</p>
          {/if}
        </div>
        <div class="field">
          <label for={fieldId('slot')}>{t('meal.slot')}</label>
          <select id={fieldId('slot')} bind:value={() => draft.slot, setSlot}>
            {#each MEAL_SLOTS as slot (slot)}
              <option value={slot}>{t(`slots.${slot}`)}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for={fieldId('date')}>{t('meal.date')}</label>
          <input
            id={fieldId('date')}
            type="date"
            bind:value={() => draft.date, setDate}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? fieldId('date-error') : undefined}
          />
          {#if errors.date}
            <p id={fieldId('date-error')} class="error">{t(`meal.errors.${errors.date}`)}</p>
          {/if}
        </div>
        <div class="field">
          <label for={fieldId('time')}>{t('meal.time')}</label>
          <input
            id={fieldId('time')}
            type="time"
            bind:value={() => draft.time, setTime}
            aria-invalid={errors.time ? true : undefined}
            aria-describedby={errors.time ? fieldId('time-error') : undefined}
          />
          {#if errors.time}
            <p id={fieldId('time-error')} class="error">{t(`meal.errors.${errors.time}`)}</p>
          {/if}
        </div>
      </div>

      <section class="recipe" aria-labelledby={fieldId('recipe')}>
        <h2 id={fieldId('recipe')}>{t('meal.recipe')}</h2>
        {#if draft.recipeId !== null}
          <div class="chosen">
            <span class="chosen-name">
              {recipe ? recipe.name : t('meal.missingRecipe')}
              {#if recipe?.deleted}
                <span class="badge">{t('meal.hiddenRecipe')}</span>
              {/if}
            </span>
            <button
              type="button"
              bind:this={changeButton}
              aria-label={t('meal.changeLabel')}
              aria-expanded={changingRecipe}
              onclick={changeRecipe}
            >
              {t('meal.change')}
            </button>
            <button type="button" aria-label={t('meal.removeLabel')} onclick={removeRecipe}>
              {t('meal.remove')}
            </button>
          </div>
        {:else}
          <p class="none">{t('meal.noRecipe')}</p>
        {/if}
        {#if draft.recipeId === null || changingRecipe}
          <RecipePicker
            bind:this={picker}
            store={catalogue}
            label={t('meal.findRecipe')}
            onselect={chooseRecipe}
            oncreate={oncreaterecipe ? createRecipe : undefined}
          />
        {/if}
      </section>

      <fieldset class="eating">
        <legend>{t('meal.eating')}</legend>
        {#if attendees.length === 0}
          <p class="note">{t('meal.noAttendees')}</p>
        {:else}
          <div class="shortcuts">
            <button type="button" onclick={() => setEveryone(true)}>{t('meal.everyone')}</button>
            <button type="button" onclick={() => setEveryone(false)}>{t('meal.noOne')}</button>
          </div>
          <ul>
            {#each attendees as attendee (attendee.id)}
              <li>
                <input
                  id={fieldId(`attendee-${attendee.id}`)}
                  type="checkbox"
                  value={attendee.id}
                  bind:group={draft.attendeeIds}
                  onchange={edited}
                />
                <label for={fieldId(`attendee-${attendee.id}`)}>{attendee.name}</label>
              </li>
            {/each}
          </ul>
        {/if}
      </fieldset>

      <section class="preview" aria-labelledby={fieldId('preview')}>
        <h2 id={fieldId('preview')}>{t('meal.preview.heading')}</h2>
        {#if !recipe}
          <p class="note">{t('meal.preview.noRecipe')}</p>
        {:else if servings === 0}
          <p class="note">{t('meal.preview.noOne')}</p>
        {:else}
          <p>
            {t('meal.preview.serves', {
              servings,
              recipeServings: formatQuantity(recipe.servings),
              factor: formatQuantity(servings / recipe.servings)
            })}
          </p>
          {#if consumption.length === 0}
            <p class="note">{t('meal.preview.empty')}</p>
          {:else}
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('meal.preview.ingredient')}</th>
                  <th scope="col" class="number">{t('meal.preview.quantity')}</th>
                  <th scope="col">{t('meal.preview.unit')}</th>
                </tr>
              </thead>
              <tbody>
                {#each consumption as line (line.ingredientId)}
                  {@const item = ingredientsById.get(line.ingredientId)}
                  <tr>
                    <td>{item?.name}</td>
                    <td class="number">{formatQuantity(line.quantity)}</td>
                    <td>{item?.unit}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      </section>
    </fieldset>

    <div class="actions">
      <button type="button" class="primary" onclick={save} aria-disabled={busy} aria-busy={saving}>
        {saving ? t('meal.saving') : t('meal.save')}
      </button>
      <p role="status" class="saved">{saved ? t('meal.saved') : ''}</p>
    </div>

    {#if existing}
      <ConfirmDialog
        bind:open={confirmingDelete}
        heading={t('meal.deleteHeading', { name: existing.name })}
        message={t('meal.deleteMessage', { name: existing.name })}
        confirmLabel={t('meal.deleteConfirm')}
        onconfirm={remove}
      />
    {/if}
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .back {
    color: var(--color-primary);
    align-self: start;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
    overflow-wrap: anywhere;
  }

  h2,
  legend {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  p {
    margin: 0;
  }

  .note,
  .none {
    color: var(--color-text-muted);
  }

  .none {
    font-style: italic;
  }

  .error {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  .changed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3);
    color: var(--color-warning);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
  }

  .changed p {
    font-weight: var(--font-weight-bold);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field.grow {
    flex: 1 1 16rem;
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  section,
  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .draft {
    min-inline-size: 0;
    gap: var(--space-6);
  }

  legend {
    padding: 0;
    margin-block-end: var(--space-3);
  }

  .chosen,
  .shortcuts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .chosen-name {
    flex: 1 1 10rem;
    overflow-wrap: anywhere;
  }

  .badge {
    margin-inline-start: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
  }

  .eating ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--space-1) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .eating li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 2.75rem;
  }

  .eating li label {
    font-weight: var(--font-weight-normal);
  }

  input[type='checkbox'] {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    accent-color: var(--color-primary);
  }

  input:not([type='checkbox']),
  select {
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  [aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  table {
    border-collapse: collapse;
    inline-size: min(100%, 32rem);
  }

  th,
  td {
    padding: var(--space-1) var(--space-2);
    text-align: start;
    border-block-end: 1px solid var(--color-border);
  }

  .number {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .saved {
    color: var(--color-success);
    font-weight: var(--font-weight-bold);
  }

  button {
    font: inherit;
    cursor: pointer;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .primary {
    color: var(--color-primary-text);
    background: var(--color-primary);
    border-color: var(--color-primary);
    font-weight: var(--font-weight-bold);
  }

  .danger {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  button[aria-disabled='true'] {
    cursor: progress;
  }
</style>
