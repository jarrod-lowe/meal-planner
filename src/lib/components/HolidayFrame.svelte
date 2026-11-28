<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { ApiError } from '#lib/api/client.js';
  import { t } from '#lib/i18n/en.js';
  import { holiday as appHoliday, type HolidayStore } from '#lib/stores/holiday.svelte.js';
  import type { HolidaySection } from './holiday-sections.js';
  import HolidayNav from './HolidayNav.svelte';

  let {
    holidayId,
    current,
    children,
    store = appHoliday
  }: {
    holidayId: string;
    current: HolidaySection;
    children: Snippet;
    store?: HolidayStore;
  } = $props();

  let refreshing = $state(false);

  // Open the holiday whenever the route's id changes. `load` reads and writes
  // the store's state, which mustn't become this effect's dependencies.
  $effect(() => {
    const id = holidayId;
    untrack(() => void store.load(id));
  });

  // Refetch on window focus, at most every 30 s (DESIGN §7.3).
  $effect(() => store.attachFocusRefetch());

  /** Only the open holiday's facts: never the previous one's, mid-switch. */
  const facts = $derived(store.facts?.holiday.id === holidayId ? store.facts : null);

  const problem = $derived.by(() => {
    if (facts || store.status !== 'error') return null;
    const { error } = store;
    if (error instanceof ApiError && error.code === 'not-found') return 'notFound';
    if (error instanceof ApiError && error.code === 'not-a-member') return 'notAMember';
    return 'failed';
  });

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await store.refresh();
    } finally {
      refreshing = false;
    }
  }
</script>

<svelte:head>
  <!-- Each page sets its own title once the holiday is loaded. -->
  {#if !facts}
    <title>{t('holiday.loadingTitle')}</title>
  {/if}
</svelte:head>

{#if facts}
  <div class="frame">
    <header>
      <a class="home" href={resolve('/')}>{t('holiday.allHolidays')}</a>
      <button type="button" onclick={refresh} aria-disabled={refreshing} aria-busy={refreshing}>
        {refreshing ? t('holiday.refreshing') : t('holiday.refresh')}
      </button>
    </header>
    <HolidayNav {holidayId} {current} />
    <div class="content">
      {@render children()}
    </div>
  </div>
{:else if problem}
  <main class="message">
    <h1>{t('holiday.errors.heading')}</h1>
    <p role="alert">{t(`holiday.errors.${problem}`)}</p>
    <div class="actions">
      {#if problem === 'failed'}
        <button type="button" onclick={refresh}>{t('holiday.retry')}</button>
      {/if}
      <a href={resolve('/')}>{t('holiday.backHome')}</a>
    </div>
  </main>
{:else}
  <main class="message">
    <p role="status">{t('holiday.loading')}</p>
  </main>
{/if}

<style>
  .frame {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'header'
      'content';
    gap: var(--space-4);
    max-inline-size: 64rem;
    margin: 0 auto;
    /* Room for the fixed tab bar. */
    padding-block-end: var(--space-12);
  }

  header {
    grid-area: header;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .content {
    grid-area: content;
    min-inline-size: 0;
  }

  @media (min-width: 48rem) {
    .frame {
      grid-template-columns: 12rem minmax(0, 1fr);
      grid-template-areas:
        'header header'
        'nav content';
      padding-block-end: 0;
    }

    .frame > :global(.holiday-nav) {
      grid-area: nav;
    }
  }

  /* Keep toasts above the tab bar on phones. */
  @media (max-width: 47.99rem) {
    :global(body:has(.holiday-nav) .toasts) {
      inset-block-end: calc(var(--space-12) + var(--space-4));
    }
  }

  .message {
    max-inline-size: 36rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  p {
    margin: 0;
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  [role='status'] {
    color: var(--color-text-muted);
  }

  [role='alert'] {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  a {
    color: var(--color-primary);
  }

  button {
    font: inherit;
    cursor: pointer;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-4);
    min-block-size: 2.75rem;
  }

  button[aria-disabled='true'] {
    cursor: progress;
  }
</style>
