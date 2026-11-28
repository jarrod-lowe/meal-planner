<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { v7 as uuidv7 } from 'uuid';
  import { resolve } from '$app/paths';
  import { COMMON_INGREDIENTS } from '#lib/catalogue/common.js';
  import type { CommonIngredient } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Ingredient,
    type Recipe
  } from '#lib/stores/catalogue.svelte.js';
  import type { MutationResult } from '#lib/stores/mutation-queue.js';
  import IngredientPicker from './IngredientPicker.svelte';
  import { maxNameLength } from './names.js';
  import {
    hasErrors,
    recipeErrors,
    recipeFields,
    type DraftLine,
    type RecipeDraft,
    type RecipeErrors
  } from './recipe-draft.js';

  let {
    store = appCatalogue,
    recipeId,
    common = COMMON_INGREDIENTS,
    name: startName = null,
    back = null,
    oncreated
  }: {
    store?: CatalogueStore;
    /** The recipe to edit, or `new`. The route remounts the editor when it changes. */
    recipeId: string;
    common?: readonly CommonIngredient[];
    /** A new recipe's name to start with. */
    name?: string | null;
    /** The meal editor this was opened from, to go back to in place of the recipe list. */
    back?: string | null;
    /** A new recipe was saved under `id`. */
    oncreated?: (id: string) => void;
  } = $props();

  const uid = $props.id();
  // The editor is keyed by `recipeId`, so these are fixed for its lifetime.
  // svelte-ignore state_referenced_locally
  const isNew = recipeId === 'new';
  // svelte-ignore state_referenced_locally
  const id = isNew ? uuidv7() : recipeId;

  const existing = $derived(isNew ? undefined : store.recipes.find((r) => r.id === id));
  const ingredientsById = $derived(new Map(store.ingredients.map((item) => [item.id, item])));

  let nextKey = 0;
  const newLine = (): DraftLine => ({
    key: `line${nextKey++}`,
    ingredientId: null,
    quantity: null
  });

  const seed = (recipe: Recipe | undefined): RecipeDraft =>
    recipe
      ? {
          name: recipe.name,
          servings: recipe.servings,
          notes: recipe.notes,
          lines: recipe.lines.map((line) => ({ ...newLine(), ...line }))
        }
      : { name: untrack(() => startName) ?? '', servings: 4, notes: '', lines: [newLine()] };
  /** What a draft would save, for telling whether it has edits. */
  const saveable = (from: RecipeDraft) => JSON.stringify(recipeFields(from, false));

  /** The working copy, seeded from the stored recipe (and again on Load latest). */
  let draft = $state<RecipeDraft>(untrack(() => seed(existing)));
  /**
   * The stored version the draft is based on, and what it saved as then. A
   * save sends it as the expected version, so it can't overwrite a change
   * that someone else made since.
   */
  let base = $state.raw(untrack(() => ({ version: existing?.version, fields: saveable(draft) })));
  /** This editor's own saves, hides and shows in flight: they change the version too. */
  let ownWrites = $state(0);
  /** Save, Hide and Show wait for those, so a save is never sent at a base a pending write moves on. */
  const busy = $derived(ownWrites > 0);

  const dirty = $derived(saveable(draft) !== base.fields);
  const changedElsewhere = $derived(
    existing !== undefined && ownWrites === 0 && existing.version !== base.version
  );

  let submitted = $state(false);
  let saving = $state(false);
  let saved = $state(false);
  /** Per line key: why the ingredient just picked wasn't used. */
  let lineMessages = $state<Record<string, string>>({});
  const errors = $derived<RecipeErrors>(submitted ? recipeErrors(draft) : { lines: {} });

  // `$state`, so `bind:this` on its properties is a reactive binding.
  const pickers = $state<Record<string, { focus(): void } | undefined>>({});
  let addButton = $state<HTMLButtonElement>();

  const fieldId = (name: string) => `${uid}-${name}`;
  const lineId = (line: DraftLine, part: string) => `${uid}-${line.key}-${part}`;

  function describedBy(...ids: (string | false | undefined)[]): string | undefined {
    const present = ids.filter((value): value is string => Boolean(value));
    return present.length > 0 ? present.join(' ') : undefined;
  }

  async function focusPicker(key: string) {
    await tick();
    pickers[key]?.focus();
  }

  async function focusElement(elementId: string) {
    await tick();
    document.getElementById(elementId)?.focus();
  }

  function edited() {
    saved = false;
  }

  function choose(line: DraftLine, index: number, ingredient: Ingredient) {
    edited();
    const other = draft.lines.findIndex(
      (candidate, at) => at !== index && candidate.ingredientId === ingredient.id
    );
    if (other !== -1) {
      lineMessages[line.key] = t('recipe.alreadyUsed', {
        name: ingredient.name,
        unit: ingredient.unit,
        n: other + 1
      });
      void focusPicker(line.key);
      return;
    }
    delete lineMessages[line.key];
    line.ingredientId = ingredient.id;
    void focusElement(lineId(line, 'quantity'));
  }

  function change(line: DraftLine) {
    edited();
    line.ingredientId = null;
    void focusPicker(line.key);
  }

  function insertLine(at: number) {
    edited();
    const line = newLine();
    draft.lines.splice(at, 0, line);
    void focusPicker(line.key);
  }

  async function remove(index: number) {
    edited();
    const [line] = draft.lines.splice(index, 1);
    if (line) delete lineMessages[line.key];
    await tick();
    addButton?.focus();
  }

  function onQuantityKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      insertLine(index + 1);
    }
  }

  function focusFirstError(found: RecipeErrors) {
    if (found.name) return void focusElement(fieldId('name'));
    if (found.servings) return void focusElement(fieldId('servings'));
    if (found.notes) return void focusElement(fieldId('notes'));
    const line = draft.lines.find((candidate) => found.lines[candidate.key]);
    if (!line) return;
    if (found.lines[line.key]?.ingredient) void focusPicker(line.key);
    else void focusElement(lineId(line, 'quantity'));
  }

  async function save() {
    if (busy) return;
    submitted = true;
    saved = false;
    const found = recipeErrors(draft);
    if (hasErrors(found)) return focusFirstError(found);
    saving = true;
    ownWrites++;
    try {
      const fields = recipeFields(draft, existing?.deleted ?? false);
      const sent = saveable(draft);
      const result = await store.mutate({
        kind: 'recipes',
        id,
        fields,
        expectedVersion: base.version
      });
      if (result.outcome === 'saved') {
        base = { version: existing?.version, fields: sent };
        saved = true;
        if (isNew) oncreated?.(id);
      }
    } finally {
      ownWrites--;
      saving = false;
    }
  }

  /** Reseeds the draft from the stored recipe, dropping its edits. */
  function reseed() {
    draft = seed(existing);
    base = { version: existing?.version, fields: saveable(draft) };
    lineMessages = {};
    submitted = false;
    saved = false;
  }

  function loadLatest() {
    reseed();
    void focusElement(fieldId('name'));
  }

  // Someone else's change, with nothing here to lose: take it. An effect, not
  // a `$derived`, since the draft is a deep working copy the inputs bind to.
  $effect(() => {
    if (changedElsewhere && !dirty) untrack(reseed);
  });

  /** Hides or shows the recipe; the version it leaves is the draft's base, if the content still matches. */
  async function setVisibility(write: () => Promise<MutationResult>) {
    if (busy) return;
    const focused = focusElement(fieldId('visibility'));
    ownWrites++;
    try {
      const result = await write();
      // The hide's fetch may bring back someone else's change: then the base
      // stays, and the draft reconciles it (at once if untouched, or via Load latest).
      if (result.outcome === 'saved' && existing && saveable(seed(existing)) === base.fields) {
        base = { ...base, version: existing.version };
      }
    } finally {
      ownWrites--;
    }
    await focused;
  }

  const hide = () => setVisibility(() => store.hide('recipes', id));
  const show = () => setVisibility(() => store.show('recipes', id));

  const ingredientText = (ingredient: Ingredient) =>
    t('picker.option', {
      name: ingredient.name,
      unit: ingredient.unit,
      section: t(`shopSections.${ingredient.shopSection}`)
    });
</script>

<svelte:head>
  <title>{existing ? t('recipe.title', { name: existing.name }) : t('recipe.newTitle')}</title>
</svelte:head>

<div class="editor">
  {#if back}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an in-app path, checked by the route -->
    <a class="back" href={back}>{t('recipe.backToMeal')}</a>
  {:else}
    <a class="back" href={resolve('/recipes')}>{t('recipe.back')}</a>
  {/if}

  {#if !isNew && !existing}
    <h1>{t('recipe.notFound.heading')}</h1>
    <p role="alert" class="error">{t('recipe.notFound.message')}</p>
  {:else}
    <div class="title">
      <h1>{existing ? existing.name : t('recipe.newHeading')}</h1>
      {#if existing}
        {#if existing.deleted}
          <button
            type="button"
            id={fieldId('visibility')}
            onclick={show}
            aria-disabled={busy}
            aria-busy={busy && !saving}
          >
            {t('recipe.showAgain')}
          </button>
        {:else}
          <button
            type="button"
            id={fieldId('visibility')}
            onclick={hide}
            aria-disabled={busy}
            aria-busy={busy && !saving}
          >
            {t('recipe.hide')}
          </button>
        {/if}
      {/if}
    </div>
    {#if existing?.deleted}
      <p class="note">{t('recipe.hiddenNote')}</p>
    {/if}
    <!-- Always present, so screen readers announce the notice when it appears. -->
    <div role="status">
      {#if changedElsewhere}
        <div class="changed">
          <p>{t('recipe.changedElsewhere')}</p>
          <button type="button" onclick={loadLatest}>{t('recipe.loadLatest')}</button>
        </div>
      {/if}
    </div>

    <div class="fields">
      <div class="field grow">
        <label for={fieldId('name')}>{t('recipe.name')}</label>
        <input
          id={fieldId('name')}
          type="text"
          autocomplete="off"
          maxlength={maxNameLength}
          bind:value={draft.name}
          oninput={edited}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(errors.name && fieldId('name-error'))}
        />
        {#if errors.name}
          <p id={fieldId('name-error')} class="error">{t(`recipe.errors.${errors.name}`)}</p>
        {/if}
      </div>
      <div class="field">
        <label for={fieldId('servings')}>{t('recipe.servings')}</label>
        <input
          id={fieldId('servings')}
          class="number"
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          bind:value={draft.servings}
          oninput={edited}
          aria-invalid={errors.servings ? true : undefined}
          aria-describedby={describedBy(errors.servings && fieldId('servings-error'))}
        />
        {#if errors.servings}
          <p id={fieldId('servings-error')} class="error">
            {t(`recipe.errors.${errors.servings}`)}
          </p>
        {/if}
      </div>
    </div>

    <section aria-labelledby={fieldId('lines')}>
      <h2 id={fieldId('lines')}>{t('recipe.lines')}</h2>
      <p class="note" id={fieldId('lines-help')}>{t('recipe.linesHelp')}</p>
      <ol aria-labelledby={fieldId('lines')}>
        {#each draft.lines as line, index (line.key)}
          {@const n = index + 1}
          {@const ingredient = line.ingredientId
            ? ingredientsById.get(line.ingredientId)
            : undefined}
          {@const lineErrors = errors.lines[line.key] ?? {}}
          {@const message = lineMessages[line.key]}
          <li class="line">
            <div class="ingredient">
              {#if line.ingredientId === null}
                <IngredientPicker
                  bind:this={pickers[line.key]}
                  {store}
                  {common}
                  label={t('recipe.ingredientLabel', { n })}
                  labelHidden
                  invalid={Boolean(lineErrors.ingredient)}
                  describedby={describedBy(
                    message && lineId(line, 'message'),
                    lineErrors.ingredient && lineId(line, 'ingredient-error')
                  )}
                  onselect={(chosen: Ingredient) => choose(line, index, chosen)}
                />
              {:else}
                <div class="chosen">
                  <span class="chosen-name">
                    {ingredient ? ingredientText(ingredient) : t('recipe.unknownIngredient')}
                    {#if ingredient?.deleted}
                      <span class="badge">{t('recipe.hiddenIngredient')}</span>
                    {/if}
                  </span>
                  <button
                    type="button"
                    aria-label={t('recipe.changeLabel', { n })}
                    onclick={() => change(line)}
                  >
                    {t('recipe.change')}
                  </button>
                </div>
              {/if}
              {#if message}
                <p id={lineId(line, 'message')} class="error" role="alert">{message}</p>
              {/if}
              {#if lineErrors.ingredient}
                <p id={lineId(line, 'ingredient-error')} class="error">
                  {t(`recipe.errors.${lineErrors.ingredient}`)}
                </p>
              {/if}
            </div>
            <div class="quantity">
              <label class="visually-hidden" for={lineId(line, 'quantity')}>
                {t('recipe.quantityLabel', { n })}
              </label>
              <input
                id={lineId(line, 'quantity')}
                class="number"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                bind:value={line.quantity}
                oninput={edited}
                onkeydown={(event) => onQuantityKeydown(event, index)}
                aria-invalid={lineErrors.quantity ? true : undefined}
                aria-describedby={describedBy(
                  ingredient && lineId(line, 'unit'),
                  lineErrors.quantity && lineId(line, 'quantity-error'),
                  fieldId('lines-help')
                )}
              />
              {#if ingredient}
                <span id={lineId(line, 'unit')} class="unit">{ingredient.unit}</span>
              {/if}
              <button
                type="button"
                aria-label={t('recipe.removeLabel', { n })}
                onclick={() => remove(index)}
              >
                {t('recipe.remove')}
              </button>
              {#if lineErrors.quantity}
                <p id={lineId(line, 'quantity-error')} class="error">
                  {t(`recipe.errors.${lineErrors.quantity}`)}
                </p>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
      {#if errors.tooManyLines}
        <p class="error" role="alert">{t('recipe.errors.tooManyLines')}</p>
      {/if}
      <div>
        <button type="button" bind:this={addButton} onclick={() => insertLine(draft.lines.length)}>
          {t('recipe.addLine')}
        </button>
      </div>
    </section>

    <div class="field">
      <label for={fieldId('notes')}>{t('recipe.notes')}</label>
      <textarea
        id={fieldId('notes')}
        rows="6"
        bind:value={draft.notes}
        oninput={edited}
        aria-invalid={errors.notes ? true : undefined}
        aria-describedby={describedBy(
          fieldId('notes-help'),
          errors.notes && fieldId('notes-error')
        )}></textarea>
      <p id={fieldId('notes-help')} class="note">{t('recipe.notesHelp')}</p>
      {#if errors.notes}
        <p id={fieldId('notes-error')} class="error">{t(`recipe.errors.${errors.notes}`)}</p>
      {/if}
    </div>

    <div class="actions">
      <button type="button" class="primary" onclick={save} aria-disabled={busy} aria-busy={saving}>
        {saving ? t('recipe.saving') : t('recipe.save')}
      </button>
      <p role="status" class="saved">{saved ? t('recipe.saved') : ''}</p>
    </div>
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

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  p {
    margin: 0;
  }

  .note {
    color: var(--color-text-muted);
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

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  ol {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
    padding-inline-start: var(--space-6);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    gap: var(--space-2) var(--space-3);
  }

  .ingredient {
    display: flex;
    flex: 1 1 18rem;
    flex-direction: column;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  .chosen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 2.75rem;
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

  .quantity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .quantity .error {
    flex-basis: 100%;
  }

  .unit {
    min-inline-size: 3rem;
    color: var(--color-text-muted);
  }

  input,
  textarea {
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  input.number {
    inline-size: 6rem;
  }

  textarea {
    resize: vertical;
  }

  [aria-invalid='true'] {
    border-color: var(--color-danger);
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

  button[aria-disabled='true'] {
    cursor: progress;
  }

  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
