<script lang="ts">
  import { resolve } from '$app/paths';
  import { t } from '#lib/i18n/en.js';
  import { appSections, type AppSection } from './app-sections.js';

  let { current, onsignout }: { current: AppSection | null; onsignout: () => void } = $props();

  const hrefs: Record<AppSection, string> = {
    holidays: resolve('/'),
    recipes: resolve('/recipes'),
    ingredients: resolve('/ingredients')
  };
</script>

<!-- Compact on phones, so it sits above a holiday's own tab bar. -->
<header class="app-header">
  <span class="name">{t('app.title')}</span>
  <nav aria-label={t('appNav.label')}>
    <ul>
      {#each appSections as section (section)}
        <li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
          <a href={hrefs[section]} aria-current={section === current ? 'page' : undefined}>
            {t(`appNav.${section}`)}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
  <button type="button" onclick={onsignout}>{t('appNav.signOut')}</button>
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    max-inline-size: 64rem;
    margin: 0 auto var(--space-4);
    padding-block-end: var(--space-2);
    border-block-end: 1px solid var(--color-border);
  }

  .name {
    font-weight: var(--font-weight-bold);
  }

  nav {
    flex: 1 1 auto;
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    display: inline-flex;
    align-items: center;
    min-block-size: 2.75rem;
    padding: 0 var(--space-2);
    color: var(--color-text);
    text-decoration: none;
    border-radius: var(--radius-sm);
  }

  a:hover {
    text-decoration: underline;
  }

  a[aria-current='page'] {
    color: var(--color-primary);
    font-weight: var(--font-weight-bold);
    box-shadow: inset 0 calc(-1 * var(--space-1)) 0 var(--color-primary);
  }

  button {
    font: inherit;
    cursor: pointer;
    min-block-size: 2.75rem;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  @media (max-width: 47.99rem) {
    header {
      font-size: var(--font-size-sm);
    }

    .name {
      flex-basis: 100%;
    }

    nav {
      flex: 1 1 0;
    }

    a {
      padding: 0 var(--space-1);
    }

    button {
      padding: var(--space-1) var(--space-2);
    }
  }
</style>
