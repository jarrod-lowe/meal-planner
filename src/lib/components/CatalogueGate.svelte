<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { t } from '#lib/i18n/en.js';
  import { catalogue as appCatalogue, type CatalogueStore } from '#lib/stores/catalogue.svelte.js';

  let { store = appCatalogue, children }: { store?: CatalogueStore; children: Snippet } = $props();

  // Load once per session, and refetch on window focus at most every 30 s (DESIGN §7.3).
  // `load` reads and writes the store's state, which mustn't become this effect's dependencies.
  $effect(() => {
    const target = store;
    untrack(() => void target.load());
  });
  $effect(() => store.attachFocusRefetch());
</script>

{#if store.status === 'ready'}
  {@render children()}
{:else if store.status === 'error'}
  <p role="alert">{t('catalogue.loadFailed')}</p>
  <div>
    <button type="button" onclick={() => void store.refresh()}>{t('catalogue.retry')}</button>
  </div>
{:else}
  <p role="status">{t('catalogue.loading')}</p>
{/if}

<style>
  p {
    margin: 0;
  }

  [role='status'] {
    color: var(--color-text-muted);
  }

  [role='alert'] {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  button {
    font: inherit;
    cursor: pointer;
    min-block-size: 2.75rem;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
  }
</style>
