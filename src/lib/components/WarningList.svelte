<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Schemas } from '#lib/api/client.js';
  import type { Warning } from '#lib/engine/index.js';
  import { formatDay } from '#lib/format/dates.js';
  import { t } from '#lib/i18n/en.js';

  let {
    holidayId,
    warnings,
    meals,
    recipes
  }: {
    holidayId: string;
    /** In the plan's order. */
    warnings: readonly Warning[];
    meals: readonly Schemas['Meal'][];
    recipes: readonly Schemas['Recipe'][];
  } = $props();

  interface Item {
    text: string;
    href: string;
    link: string;
    label: string;
  }

  const mealsById = $derived(new Map(meals.map((meal) => [meal.id, meal])));
  const recipesById = $derived(new Map(recipes.map((recipe) => [recipe.id, recipe])));

  const mealEditor = (mealId: string) =>
    resolve('/holidays/[holidayId]/meals/[mealId]', { holidayId, mealId });

  /** A warning's text and the link to fix it; `null` for those with nothing to show yet. */
  function describe(warning: Warning): Item | null {
    switch (warning.code) {
      case 'meal-without-recipe':
      case 'missing-recipe': {
        const meal = mealsById.get(warning.mealId)?.name ?? t('overview.warnings.unknownMeal');
        return {
          text:
            warning.code === 'meal-without-recipe'
              ? t('overview.warnings.mealWithoutRecipe', { meal })
              : t('overview.warnings.missingRecipe', { meal }),
          href: mealEditor(warning.mealId),
          link: t('overview.warnings.chooseRecipe'),
          label: t('overview.warnings.chooseRecipeLabel', { meal })
        };
      }
      case 'mealtime-without-attendees': {
        const found = mealsById.get(warning.mealId);
        const meal = found?.name ?? t('overview.warnings.unknownMeal');
        const at = found?.mealtimes.find((mealtime) => mealtime.id === warning.mealtimeId)?.at;
        return {
          text: t('overview.warnings.mealtimeWithoutAttendees', {
            meal,
            day: at ? formatDay(at.slice(0, 10)) : ''
          }),
          href: mealEditor(warning.mealId),
          link: t('overview.warnings.chooseEaters'),
          label: t('overview.warnings.chooseEatersLabel', { meal })
        };
      }
      case 'missing-ingredient': {
        // Stock changes come in phase 7, with their own fix.
        if (warning.recipeId === undefined) return null;
        const recipe =
          recipesById.get(warning.recipeId)?.name ?? t('overview.warnings.unknownRecipe');
        return {
          text: t('overview.warnings.missingIngredient', { recipe }),
          href: resolve('/recipes/[recipeId]', { recipeId: warning.recipeId }),
          link: t('overview.warnings.fixRecipe'),
          label: t('overview.warnings.fixRecipeLabel', { recipe })
        };
      }
      default:
        // The engine doesn't raise the others until the phases that need them.
        return null;
    }
  }

  const items = $derived(warnings.map(describe).filter((item): item is Item => item !== null));
</script>

{#if items.length === 0}
  <p class="none">{t('overview.warnings.none')}</p>
{:else}
  <ul>
    {#each items as item, index (index)}
      <li>
        <span class="icon" aria-hidden="true">⚠</span>
        <span class="text">{item.text}</span>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
        <a href={item.href} aria-label={item.label}>{item.link}</a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  p {
    margin: 0;
  }

  .none {
    color: var(--color-text-muted);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
  }

  .icon {
    color: var(--color-warning);
    font-weight: var(--font-weight-bold);
  }

  .text {
    flex: 1 1 14rem;
    overflow-wrap: anywhere;
  }

  a {
    color: var(--color-primary);
    min-block-size: 2.75rem;
    display: inline-flex;
    align-items: center;
  }
</style>
