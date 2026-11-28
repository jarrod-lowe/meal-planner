<script lang="ts">
  import PlannerGrid from '#lib/components/PlannerGrid.svelte';
  import { t } from '#lib/i18n/en.js';
  import { catalogue } from '#lib/stores/catalogue.svelte.js';
  import { holiday } from '#lib/stores/holiday.svelte.js';

  // The layout renders this page only once the holiday and the catalogue are loaded.
  const facts = $derived(holiday.facts);
</script>

<svelte:head>
  <title>{t('plan.title', { name: facts?.holiday.name ?? '' })}</title>
</svelte:head>

{#if facts}
  <main>
    <h1>{t('plan.heading')}</h1>
    <PlannerGrid holidayId={facts.holiday.id} {facts} recipes={catalogue.recipes} />
  </main>
{/if}

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }
</style>
