<script lang="ts">
  import { resolve } from '$app/paths';
  import { searchRecipes } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Recipe
  } from '#lib/stores/catalogue.svelte.js';

  let { store = appCatalogue }: { store?: CatalogueStore } = $props();

  const uid = $props.id();

  let query = $state('');
  let showHidden = $state(false);

  const results = $derived(searchRecipes(store.recipes, query, { includeHidden: showHidden }));

  const ingredientCount = (recipe: Recipe) =>
    recipe.lines.length === 1
      ? t('recipes.oneIngredient')
      : t('recipes.ingredientCount', { count: recipe.lines.length });
</script>

<div class="recipes">
  <div class="toolbar">
    <div class="search">
      <label for="{uid}-search">{t('recipes.search')}</label>
      <input id="{uid}-search" type="search" autocomplete="off" bind:value={query} />
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={showHidden} />
      {t('recipes.showHidden')}
    </label>
    <a class="new" href={resolve('/recipes/[recipeId]', { recipeId: 'new' })}>
      {t('recipes.new')}
    </a>
  </div>

  {#if store.recipes.length === 0}
    <p class="muted">{t('recipes.empty')}</p>
  {:else if results.length === 0}
    <p class="muted">{t('recipes.noMatches', { query: query.trim() })}</p>
  {:else}
    <ul aria-label={t('recipes.heading')}>
      {#each results as recipe (recipe.id)}
        <li>
          <div class="summary">
            <a href={resolve('/recipes/[recipeId]', { recipeId: recipe.id })}>{recipe.name}</a>
            <span class="muted">
              {t('recipes.serves', { count: recipe.servings })} · {ingredientCount(recipe)}
            </span>
            {#if recipe.deleted}
              <span class="badge">{t('recipes.hidden')}</span>
            {/if}
          </div>
          {#if recipe.deleted}
            <button
              type="button"
              aria-label={t('recipes.showAgainLabel', { name: recipe.name })}
              onclick={() => store.show('recipes', recipe.id)}
            >
              {t('recipes.showAgain')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .recipes {
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

  input[type='search'] {
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
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

  .new {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-4);
    color: var(--color-primary-text);
    background: var(--color-primary);
    border-radius: var(--radius-md);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  li + li {
    border-block-start: 1px solid var(--color-border);
  }

  .summary {
    display: flex;
    flex: 1 1 14rem;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  .summary a {
    color: var(--color-primary);
    font-weight: var(--font-weight-bold);
    overflow-wrap: anywhere;
  }

  .badge {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
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
</style>
