<script lang="ts">
  import { formatDateRange } from '#lib/format/dates.js';
  import { t } from '#lib/i18n/en.js';
  import { holiday } from '#lib/stores/holiday.svelte.js';

  // The layout renders this page only once the holiday's facts are loaded.
  const meta = $derived(holiday.facts?.holiday);
</script>

<svelte:head>
  <title>{t('overview.title', { name: meta?.name ?? '' })}</title>
</svelte:head>

{#if meta}
  <main>
    <h1>{meta.name}</h1>
    <dl>
      <div>
        <dt>{t('overview.dates')}</dt>
        <dd>{formatDateRange(meta.startDate, meta.endDate)}</dd>
      </div>
      <div>
        <dt>{t('overview.timeZone')}</dt>
        <dd>{meta.timeZone}</dd>
      </div>
    </dl>
    <p class="muted">{t('overview.placeholder')}</p>
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

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    margin: 0;
  }

  dt {
    font-weight: var(--font-weight-bold);
  }

  dd {
    margin: 0;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--color-text-muted);
  }
</style>
