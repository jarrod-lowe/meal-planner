<script lang="ts">
  import { searchRecipes } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Recipe
  } from '#lib/stores/catalogue.svelte.js';
  import { Combobox } from './combobox.svelte.js';

  let {
    store = appCatalogue,
    label,
    labelHidden = false,
    onselect,
    oncreate
  }: {
    store?: CatalogueStore;
    /** The input's label. */
    label: string;
    /** Keep the label for assistive technology only. */
    labelHidden?: boolean;
    onselect: (recipe: Recipe) => void;
    /** The user chose *Create new recipe*, with what they typed (trimmed). Without it, there's no such option. */
    oncreate?: (query: string) => void;
  } = $props();

  const uid = $props.id();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  let query = $state('');
  let input = $state<HTMLInputElement>();

  const matches = $derived(
    query.trim() === '' ? [] : searchRecipes(store.recipes, query, { limit: 8 })
  );
  /** The matches, then the create option. */
  const count = $derived(query.trim() === '' ? 0 : matches.length + (oncreate ? 1 : 0));

  const box = new Combobox(() => count, choose);
  const expanded = $derived(box.open && count > 0);

  $effect(() => {
    if (expanded && box.active >= 0) {
      document.getElementById(optionId(box.active))?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  /** Puts focus in the input. */
  export function focus() {
    input?.focus();
  }

  function choose(index: number) {
    const recipe = matches[index];
    const text = query.trim();
    query = '';
    box.close();
    if (recipe) onselect(recipe);
    else oncreate?.(text);
  }
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
      {#each matches as recipe, index (recipe.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
        <div
          role="option"
          id={optionId(index)}
          aria-selected={box.active === index}
          onclick={() => choose(index)}
        >
          {t('recipePicker.option', { name: recipe.name, servings: recipe.servings })}
        </div>
      {/each}
      {#if oncreate && count > 0}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
        <div
          role="option"
          id={optionId(matches.length)}
          class="create"
          aria-selected={box.active === matches.length}
          onclick={() => choose(matches.length)}
        >
          {t('recipePicker.create', { query: query.trim() })}
        </div>
      {/if}
    </div>
  </div>
</div>

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
    align-items: center;
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

  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
