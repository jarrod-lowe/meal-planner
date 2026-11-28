<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Schemas } from '#lib/api/client.js';
  import { formatDay } from '#lib/format/dates.js';
  import { t } from '#lib/i18n/en.js';
  import type { MealSlot } from '#lib/model/slots.js';
  import type { Chip } from './planner-grid.js';

  let {
    holidayId,
    date,
    slot,
    chips,
    recipes
  }: {
    holidayId: string;
    date: string;
    slot: MealSlot;
    chips: readonly Chip[];
    recipes: ReadonlyMap<string, Schemas['Recipe']>;
  } = $props();

  const editor = (mealId: string) =>
    resolve('/holidays/[holidayId]/meals/[mealId]', { holidayId, mealId });
  const addHref = $derived(`${editor('new')}?${new URLSearchParams({ date, slot }).toString()}`);
  const where = $derived({ slot: t(`slots.${slot}`), date: formatDay(date) });

  function recipeText(recipeId: string | null): string {
    if (recipeId === null) return t('plan.noRecipe');
    return recipes.get(recipeId)?.name ?? t('plan.missingRecipe');
  }
</script>

<div class="cell">
  {#if chips.length > 0}
    <ul>
      {#each chips as { meal, mealtime, servings } (mealtime.id)}
        <li>
          <a class="chip" href={editor(meal.id)}>
            <span class="name">{meal.name}</span><span class="visually-hidden">, </span>
            <span class={['recipe', meal.recipeId === null && 'none']}>
              {recipeText(meal.recipeId)}
            </span><span class="visually-hidden">, </span>
            <span class="servings">{t('plan.servings', { count: servings })}</span>
          </a>
        </li>
      {/each}
    </ul>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus a query -->
    <a class="another" href={addHref} aria-label={t('plan.addAnotherLabel', where)}>
      {t('plan.addAnother')}
    </a>
  {:else}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus a query -->
    <a class="add" href={addHref} aria-label={t('plan.addLabel', where)}>{t('plan.add')}</a>
  {/if}
</div>

<style>
  .cell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    flex: 1 1 7rem;
    min-inline-size: 0;
  }

  .chip {
    display: flex;
    flex-direction: column;
    block-size: 100%;
    box-sizing: border-box;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text);
    text-decoration: none;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-inline-start: var(--space-1) solid var(--color-primary);
    border-radius: var(--radius-md);
    overflow-wrap: anywhere;
  }

  .chip:hover .name {
    text-decoration: underline;
  }

  .name {
    font-weight: var(--font-weight-bold);
  }

  .recipe,
  .servings {
    font-size: var(--font-size-sm);
  }

  .recipe.none {
    font-style: italic;
    color: var(--color-text-muted);
  }

  .servings {
    color: var(--color-text-muted);
  }

  .add,
  .another {
    display: flex;
    align-items: center;
    justify-content: center;
    min-block-size: 2.75rem;
    color: var(--color-primary);
    border-radius: var(--radius-md);
  }

  .add {
    font-size: var(--font-size-lg);
    text-decoration: none;
    border: 1px dashed var(--color-border);
  }

  .another {
    min-block-size: 2rem;
    font-size: var(--font-size-sm);
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
