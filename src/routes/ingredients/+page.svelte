<script lang="ts">
  import CatalogueGate from '#lib/components/CatalogueGate.svelte';
  import IngredientList from '#lib/components/IngredientList.svelte';
  import { t } from '#lib/i18n/en.js';
</script>

<svelte:head>
  <title>{t('ingredients.title')}</title>
</svelte:head>

<main>
  <h1>{t('ingredients.heading')}</h1>
  <CatalogueGate>
    <IngredientList />
  </CatalogueGate>
</main>

<style>
  main {
    max-inline-size: 48rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }
</style>
