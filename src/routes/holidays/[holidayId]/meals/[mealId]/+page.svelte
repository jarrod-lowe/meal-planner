<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import MealEditor from '#lib/components/MealEditor.svelte';
  import { withoutRecipe } from '#lib/stores/meal-return.js';

  const holidayId = $derived(page.params.holidayId ?? '');
  const mealId = $derived(page.params.mealId ?? 'new');
  /** This editor's own path and query, without a recipe it was handed. */
  const here = $derived(withoutRecipe(page.url.pathname + page.url.search));

  /** A new meal has been saved: its own URL replaces `/meals/new`. */
  function created(id: string) {
    void goto(resolve('/holidays/[holidayId]/meals/[mealId]', { holidayId, mealId: id }), {
      replace: true
    });
  }

  function deleted() {
    void goto(resolve('/holidays/[holidayId]/plan', { holidayId }));
  }

  /** The editor has kept its draft: make the recipe, then come back here. */
  function createRecipe(query: string) {
    const params = new URLSearchParams([
      ...(query === '' ? [] : [['name', query]]),
      ['return', here]
    ]);
    const editor = resolve('/recipes/[recipeId]', { recipeId: 'new' });
    // The rule rejects a resolved path with a query string appended.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(`${editor}?${params.toString()}`);
  }

  // The editor has taken the recipe it was handed: drop it from the URL, so a
  // reload or a share doesn't hand it over again.
  $effect(() => {
    if (page.url.searchParams.has('recipe')) {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- this page, less a parameter
      void goto(here, { replace: true, reset: false });
    }
  });
</script>

<main>
  <!-- The layout loads the holiday and the catalogue first. Each meal gets a fresh editor, with its own working copy. -->
  {#key mealId}
    <MealEditor
      {mealId}
      date={page.url.searchParams.get('date')}
      slot={page.url.searchParams.get('slot')}
      recipe={page.url.searchParams.get('recipe')}
      oncreated={created}
      ondeleted={deleted}
      oncreaterecipe={createRecipe}
    />
  {/key}
</main>

<style>
  main {
    max-inline-size: 48rem;
  }
</style>
