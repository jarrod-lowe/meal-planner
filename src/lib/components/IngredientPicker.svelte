<script lang="ts">
  import { v7 as uuidv7 } from 'uuid';
  import { COMMON_INGREDIENTS } from '#lib/catalogue/common.js';
  import {
    searchIngredients,
    suggestIngredients,
    type CommonIngredient
  } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Ingredient
  } from '#lib/stores/catalogue.svelte.js';
  import { Combobox } from './combobox.svelte.js';
  import type { IngredientFields } from './ingredient-fields.js';
  import IngredientForm from './IngredientForm.svelte';

  let {
    store = appCatalogue,
    common = COMMON_INGREDIENTS,
    label,
    labelHidden = false,
    invalid = false,
    describedby,
    onselect
  }: {
    store?: CatalogueStore;
    common?: readonly CommonIngredient[];
    /** The input's label. */
    label: string;
    /** Keep the label for assistive technology only. */
    labelHidden?: boolean;
    /** Marks the input invalid (aria-invalid). */
    invalid?: boolean;
    /** Ids of text describing the input, such as an error. */
    describedby?: string;
    onselect: (ingredient: Ingredient) => void;
  } = $props();

  type Choice =
    | { kind: 'ingredient'; ingredient: Ingredient }
    | { kind: 'suggestion'; entry: CommonIngredient }
    | { kind: 'create' };

  const uid = $props.id();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  let query = $state('');
  let creating = $state<string | null>(null);
  let adding = $state<string | null>(null);
  let input = $state<HTMLInputElement>();

  const matches = $derived(searchIngredients(store.ingredients, query, { limit: 8 }));
  const suggestions = $derived(suggestIngredients(common, store.ingredients, query, 5));
  const choices = $derived<Choice[]>(
    query.trim() === ''
      ? []
      : [
          ...matches.map((ingredient) => ({ kind: 'ingredient' as const, ingredient })),
          ...suggestions.map((entry) => ({ kind: 'suggestion' as const, entry })),
          { kind: 'create' }
        ]
  );

  const box = new Combobox(
    () => choices.length,
    (index) => void choose(index)
  );
  const expanded = $derived(box.open && choices.length > 0 && creating === null);

  // Keep the active option in view as the arrow keys move through a long list.
  $effect(() => {
    if (expanded && box.active >= 0) {
      document.getElementById(optionId(box.active))?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  /** Puts focus in the input, e.g. for a new recipe line. */
  export function focus() {
    input?.focus();
  }

  function done(ingredient: Ingredient) {
    query = '';
    creating = null;
    box.close();
    onselect(ingredient);
  }

  async function create(fields: IngredientFields): Promise<void> {
    const id = uuidv7();
    adding = fields.name;
    try {
      const { outcome } = await store.mutate({
        kind: 'ingredients',
        id,
        fields: { ...fields, deleted: false }
      });
      const created = store.ingredients.find((item) => item.id === id);
      if (outcome === 'saved' && created) done(created);
    } finally {
      adding = null;
    }
  }

  async function choose(index: number) {
    const choice = choices[index];
    if (!choice) return;
    box.close();
    if (choice.kind === 'ingredient') done(choice.ingredient);
    else if (choice.kind === 'suggestion') await create(choice.entry);
    else creating = query.trim();
  }

  function cancelCreate() {
    creating = null;
    input?.focus();
  }

  const sectionName = (item: { shopSection: Ingredient['shopSection'] }) =>
    t(`shopSections.${item.shopSection}`);
</script>

<div class="picker">
  <label for={inputId} class={{ 'visually-hidden': labelHidden }}>{label}</label>
  <div class="combo">
    <input
      id={inputId}
      type="text"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedby}
      aria-expanded={expanded}
      aria-controls={listId}
      aria-activedescendant={expanded && box.active >= 0 ? optionId(box.active) : undefined}
      bind:value={query}
      bind:this={input}
      oninput={() => box.input()}
      onkeydown={(event) => box.keydown(event)}
      onblur={() => box.close()}
    />
    <!-- Options aren't focusable: the input's keys drive them (aria-activedescendant). -->
    <!-- Pressing an option mustn't blur the input before its click lands. -->
    <div
      role="listbox"
      id={listId}
      aria-label={label}
      hidden={!expanded}
      tabindex="-1"
      onmousedown={(event) => event.preventDefault()}
    >
      {#each choices as choice, index (index)}
        {#if choice.kind === 'suggestion' && choices[index - 1]?.kind !== 'suggestion'}
          {@render suggestionGroup(index)}
        {:else if choice.kind !== 'suggestion'}
          {@render option(choice, index)}
        {/if}
      {/each}
    </div>
  </div>
  {#if adding}
    <p class="status" role="status">{t('picker.adding', { name: adding })}</p>
  {/if}
  {#if creating !== null}
    <IngredientForm
      {store}
      purpose="pick"
      label={t('picker.newIngredient')}
      initial={{ name: creating, unit: '', shopSection: 'other' }}
      focus={creating ? 'unit' : 'name'}
      onsave={create}
      oncancel={cancelCreate}
      onuseexisting={done}
    />
  {/if}
</div>

{#snippet suggestionGroup(start: number)}
  <div role="group" aria-label={t('picker.suggestions')}>
    <div class="group-heading" aria-hidden="true">{t('picker.suggestions')}</div>
    {#each choices as choice, index (index)}
      {#if index >= start && choice.kind === 'suggestion'}
        {@render option(choice, index)}
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet option(choice: Choice, index: number)}
  <!-- The input owns focus and keys (aria-activedescendant), so options take no tabindex. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
  <div
    role="option"
    id={optionId(index)}
    class={choice.kind}
    aria-selected={box.active === index}
    onclick={() => void choose(index)}
  >
    {#if choice.kind === 'ingredient'}
      {t('picker.option', {
        name: choice.ingredient.name,
        unit: choice.ingredient.unit,
        section: sectionName(choice.ingredient)
      })}
    {:else if choice.kind === 'suggestion'}
      {t('picker.option', {
        name: choice.entry.name,
        unit: choice.entry.unit,
        section: sectionName(choice.entry)
      })}
      <span class="tag">{t('picker.addToCatalogue')}</span>
    {:else}
      {t('picker.create', { query: query.trim() })}
    {/if}
  </div>
{/snippet}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  .combo {
    position: relative;
  }

  input {
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  [role='listbox'] {
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(100% + var(--space-1));
    z-index: 10;
    max-block-size: 20rem;
    overflow-y: auto;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  [role='listbox'][hidden] {
    display: none;
  }

  [role='option'] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }

  [role='option']:hover {
    text-decoration: underline;
  }

  [role='option'][aria-selected='true'] {
    outline: var(--focus-ring-width) solid var(--color-focus-ring);
    outline-offset: calc(-1 * var(--focus-ring-width));
    font-weight: var(--font-weight-bold);
  }

  [role='option'].create {
    border-block-start: 1px solid var(--color-border);
    color: var(--color-primary);
  }

  .group-heading {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-bold);
    color: var(--color-text-muted);
    border-block-start: 1px solid var(--color-border);
  }

  .tag {
    font-size: var(--font-size-sm);
    color: var(--color-primary);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
  }

  .status {
    margin: 0;
    color: var(--color-text-muted);
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
