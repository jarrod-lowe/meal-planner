<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import CatalogueGate from '#lib/components/CatalogueGate.svelte';
  import RecipeEditor from '#lib/components/RecipeEditor.svelte';

  const recipeId = $derived(page.params.recipeId ?? 'new');

  /** A new recipe has been saved: its own URL replaces `/recipes/new`. */
  function created(id: string) {
    void goto(resolve('/recipes/[recipeId]', { recipeId: id }), { replace: true });
  }
</script>

<main>
  <CatalogueGate>
    <!-- Each recipe gets a fresh editor, with its own working copy. -->
    {#key recipeId}
      <RecipeEditor {recipeId} oncreated={created} />
    {/key}
  </CatalogueGate>
</main>

<style>
  main {
    max-inline-size: 48rem;
    margin: 0 auto;
  }
</style>
