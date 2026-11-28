<script lang="ts">
  import { resolve } from '$app/paths';
  import { formatDateRange } from '#lib/format/dates.js';
  import { t } from '#lib/i18n/en.js';
  import type { Holiday, MyHolidaysStatus } from '#lib/stores/holidays.svelte.js';

  let {
    holidays,
    status,
    onretry
  }: {
    holidays: readonly Holiday[];
    status: MyHolidaysStatus;
    onretry: () => void;
  } = $props();
</script>

{#if status === 'error'}
  <div class="problem" role="alert">
    <p>{t('home.loadFailed')}</p>
    <button type="button" onclick={onretry}>{t('home.retry')}</button>
  </div>
{:else if status !== 'ready' && holidays.length === 0}
  <p class="muted" role="status">{t('home.loading')}</p>
{:else if holidays.length === 0}
  <p class="muted">{t('home.empty')}</p>
{:else}
  <ul>
    {#each holidays as holiday (holiday.id)}
      <li>
        <a href={resolve('/holidays/[holidayId]', { holidayId: holiday.id })}>
          <span class="name">{holiday.name}</span>
          <span class="dates">{formatDateRange(holiday.startDate, holiday.endDate)}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text);
    text-decoration: none;
  }

  a:hover .name {
    text-decoration: underline;
  }

  .name {
    font-weight: var(--font-weight-bold);
    color: var(--color-primary);
  }

  .dates,
  .muted {
    color: var(--color-text-muted);
  }

  p {
    margin: 0;
  }

  .problem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-danger);
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
</style>
