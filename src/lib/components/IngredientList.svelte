<script lang="ts">
  import { tick } from 'svelte';
  import { v7 as uuidv7 } from 'uuid';
  import { COMMON_INGREDIENTS } from '#lib/catalogue/common.js';
  import {
    searchIngredients,
    suggestIngredients,
    type CommonIngredient
  } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import { SHOP_SECTIONS } from '#lib/model/sections.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Ingredient
  } from '#lib/stores/catalogue.svelte.js';
  import type { IngredientFields } from './ingredient-fields.js';
  import IngredientForm from './IngredientForm.svelte';

  let {
    store = appCatalogue,
    common = COMMON_INGREDIENTS
  }: { store?: CatalogueStore; common?: readonly CommonIngredient[] } = $props();

  const uid = $props.id();

  let query = $state('');
  let showHidden = $state(false);
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let searchField = $state<HTMLInputElement>();
  let addButton = $state<HTMLButtonElement>();

  const results = $derived(
    searchIngredients(store.ingredients, query, { includeHidden: showHidden })
  );
  const groups = $derived(
    SHOP_SECTIONS.map((section) => ({
      section,
      items: results.filter((item) => item.shopSection === section)
    })).filter((group) => group.items.length > 0)
  );
  const suggestions = $derived(suggestIngredients(common, store.ingredients, query, 5));

  const editButtonId = (id: string) => `${uid}-edit-${id}`;
  const toggleButtonId = (id: string) => `${uid}-toggle-${id}`;

  async function focusById(id: string) {
    await tick();
    document.getElementById(id)?.focus();
  }

  async function create(fields: IngredientFields) {
    await store.mutate({
      kind: 'ingredients',
      id: uuidv7(),
      fields: { ...fields, deleted: false }
    });
  }

  async function addFromForm(fields: IngredientFields) {
    const focused = closeAdd();
    await create(fields);
    await focused;
  }

  async function closeAdd() {
    adding = false;
    await tick();
    addButton?.focus();
  }

  async function finishEdit(id: string) {
    editingId = null;
    await focusById(editButtonId(id));
  }

  async function saveEdit(item: Ingredient, fields: IngredientFields) {
    const changed =
      fields.name !== item.name ||
      fields.unit !== item.unit ||
      fields.shopSection !== item.shopSection;
    const done = finishEdit(item.id);
    if (changed) {
      await store.mutate({
        kind: 'ingredients',
        id: item.id,
        fields: { ...fields, deleted: item.deleted }
      });
    }
    await done;
  }

  async function hide(item: Ingredient) {
    const done = showHidden ? focusById(toggleButtonId(item.id)) : focusSearch();
    await store.hide('ingredients', item.id);
    await done;
  }

  async function focusSearch() {
    await tick();
    searchField?.focus();
  }

  async function show(item: Ingredient) {
    const done = focusById(toggleButtonId(item.id));
    await store.show('ingredients', item.id);
    await done;
  }
</script>

<div class="ingredients">
  <div class="toolbar">
    <div class="search">
      <label for="{uid}-search">{t('ingredients.search')}</label>
      <input
        id="{uid}-search"
        type="search"
        autocomplete="off"
        bind:value={query}
        bind:this={searchField}
      />
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={showHidden} />
      {t('ingredients.showHidden')}
    </label>
    {#if !adding}
      <button type="button" class="primary" bind:this={addButton} onclick={() => (adding = true)}>
        {t('ingredients.add')}
      </button>
    {/if}
  </div>

  {#if adding}
    <IngredientForm
      {store}
      purpose="add"
      label={t('ingredients.addForm')}
      initial={{ name: query.trim(), unit: '', shopSection: 'other' }}
      onsave={addFromForm}
      oncancel={closeAdd}
      onuseexisting={closeAdd}
    />
  {/if}

  {#if suggestions.length > 0}
    <section class="suggestions" aria-labelledby="{uid}-suggestions">
      <h2 id="{uid}-suggestions" class="minor">{t('ingredients.suggestions')}</h2>
      <ul>
        {#each suggestions as entry (`${entry.name} ${entry.unit}`)}
          {@const section = t(`shopSections.${entry.shopSection}`)}
          <li class="row">
            <span class="name">
              {t('ingredients.row', { name: entry.name, unit: entry.unit })}
              <span class="muted">· {section}</span>
            </span>
            <button
              type="button"
              aria-label={t('ingredients.addSuggestionLabel', {
                name: entry.name,
                unit: entry.unit,
                section
              })}
              onclick={() => create(entry)}
            >
              {t('ingredients.addSuggestion')}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if store.ingredients.length === 0}
    <p class="muted">{t('ingredients.empty')}</p>
  {:else if groups.length === 0}
    <p class="muted">{t('ingredients.noMatches', { query: query.trim() })}</p>
  {/if}

  {#each groups as group (group.section)}
    {@const headingId = `${uid}-section-${group.section}`}
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{t(`shopSections.${group.section}`)}</h2>
      <ul aria-labelledby={headingId}>
        {#each group.items as item (item.id)}
          <li>
            {#if editingId === item.id}
              <IngredientForm
                {store}
                purpose="edit"
                label={t('ingredients.editForm', { name: item.name })}
                initial={{ name: item.name, unit: item.unit, shopSection: item.shopSection }}
                exceptId={item.id}
                onsave={(fields: IngredientFields) => saveEdit(item, fields)}
                oncancel={() => finishEdit(item.id)}
              />
            {:else}
              {@const names = { name: item.name, unit: item.unit }}
              <div class="row">
                <span class="name">
                  {t('ingredients.row', names)}
                  {#if item.deleted}
                    <span class="badge">{t('ingredients.hidden')}</span>
                  {/if}
                </span>
                <div class="buttons">
                  <button
                    type="button"
                    id={editButtonId(item.id)}
                    aria-label={t('ingredients.editLabel', names)}
                    onclick={() => (editingId = item.id)}
                  >
                    {t('ingredients.edit')}
                  </button>
                  {#if item.deleted}
                    <button
                      type="button"
                      id={toggleButtonId(item.id)}
                      aria-label={t('ingredients.showAgainLabel', names)}
                      onclick={() => show(item)}
                    >
                      {t('ingredients.showAgain')}
                    </button>
                  {:else}
                    <button
                      type="button"
                      id={toggleButtonId(item.id)}
                      aria-label={t('ingredients.hideLabel', names)}
                      onclick={() => hide(item)}
                    >
                      {t('ingredients.hide')}
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .ingredients {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-3) var(--space-4);
  }

  .search {
    display: flex;
    flex: 1 1 14rem;
    flex-direction: column;
    gap: var(--space-1);
  }

  .search label {
    font-weight: var(--font-weight-bold);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-block-size: 2.75rem;
  }

  .toggle input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  h2.minor {
    font-size: var(--font-size-base);
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--color-text-muted);
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }

  li {
    padding: var(--space-2) var(--space-3);
  }

  li + li {
    border-block-start: 1px solid var(--color-border);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
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

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  input[type='search'] {
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
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
</style>
