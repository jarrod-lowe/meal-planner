<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import CatalogueGate from '#lib/components/CatalogueGate.svelte';
  import RecipeEditor from '#lib/components/RecipeEditor.svelte';
  import { mealReturn, withRecipe } from '#lib/stores/meal-return.js';

  const recipeId = $derived(page.params.recipeId ?? 'new');
  /** The meal editor this was opened from, if it's one; anything else is ignored. */
  const back = $derived(mealReturn(page.url.searchParams.get('return')));

  /**
   * A new recipe has been saved: back to the meal it was made for, with it
   * chosen, or its own URL replaces `/recipes/new`.
   */
  function created(id: string) {
    if (back) {
      // `back` is a checked meal editor path, which `resolve` can't type.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(withRecipe(back, id), { replace: true });
    } else {
      void goto(resolve('/recipes/[recipeId]', { recipeId: id }), { replace: true });
    }
  }
</script>

<main>
  <CatalogueGate>
    <!-- Each recipe gets a fresh editor, with its own working copy. -->
    {#key recipeId}
      <RecipeEditor
        {recipeId}
        name={page.url.searchParams.get('name')}
        {back}
        oncreated={created}
      />
    {/key}
  </CatalogueGate>
</main>

<style>
  main {
    max-inline-size: 48rem;
    margin: 0 auto;
  }
</style>
