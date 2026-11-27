<script lang="ts">
  import { t } from '#lib/i18n/en.js';
  import { session } from '#lib/stores/session.svelte.js';

  const name = $derived(session.user?.name ?? '');
</script>

<svelte:head>
  <title>{t('home.title')}</title>
</svelte:head>

<main>
  <h1>{t('home.greeting', { name })}</h1>
  <!-- Signing out flips the session, and the layout's guard returns to /login. -->
  <button type="button" onclick={() => session.signOut()}>{t('home.signOut')}</button>
</main>

<style>
  main {
    max-width: 28rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  button {
    font: inherit;
    cursor: pointer;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }
</style>
