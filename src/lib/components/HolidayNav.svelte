<script lang="ts">
  import { resolve } from '$app/paths';
  import { t } from '#lib/i18n/en.js';
  import { holidaySections as sections, type HolidaySection } from './holiday-sections.js';

  let { holidayId, current }: { holidayId: string; current: HolidaySection } = $props();

  /** The sections built so far; the rest come with later phases. */
  const hrefs = $derived<Partial<Record<HolidaySection, string>>>({
    overview: resolve('/holidays/[holidayId]', { holidayId }),
    people: resolve('/holidays/[holidayId]/people', { holidayId })
  });
</script>

<!-- One nav: a bottom tab bar on phones, a sidebar on wider screens. -->
<nav class="holiday-nav" aria-label={t('holiday.nav.label')}>
  <ul>
    {#each sections as section (section)}
      {@const href = hrefs[section]}
      <li>
        {#if href}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
          <a {href} aria-current={section === current ? 'page' : undefined}>
            {t(`holiday.nav.${section}`)}
          </a>
        {:else}
          <!-- Not built yet: announced as a disabled link, and not focusable. -->
          <span role="link" aria-disabled="true" class="disabled">
            {t(`holiday.nav.${section}`)}
            <span class="visually-hidden">{t('holiday.nav.comingSoon')}</span>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
</nav>

<style>
  nav {
    position: fixed;
    inset-inline: 0;
    inset-block-end: 0;
    z-index: 5;
    background: var(--color-surface-raised);
    border-block-start: 1px solid var(--color-border);
  }

  ul {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a,
  .disabled {
    display: flex;
    align-items: center;
    justify-content: center;
    min-block-size: 3rem;
    padding: var(--space-2) var(--space-1);
    font-size: var(--font-size-sm);
    text-align: center;
  }

  a {
    color: var(--color-text);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  a[aria-current='page'] {
    color: var(--color-primary);
    font-weight: var(--font-weight-bold);
    box-shadow: inset 0 var(--space-1) 0 var(--color-primary);
  }

  .disabled {
    color: var(--color-text-muted);
    cursor: not-allowed;
  }

  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (min-width: 48rem) {
    nav {
      position: sticky;
      inset-block-start: var(--space-4);
      align-self: start;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    ul {
      grid-template-columns: 1fr;
    }

    a,
    .disabled {
      justify-content: flex-start;
      padding: var(--space-2) var(--space-4);
      font-size: var(--font-size-base);
    }

    a[aria-current='page'] {
      box-shadow: inset var(--space-1) 0 0 var(--color-primary);
    }
  }
</style>
