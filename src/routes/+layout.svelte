<script lang="ts">
  import '#lib/theme.css';
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { match, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { t } from '#lib/i18n/en.js';
  import { safeNext } from '#lib/stores/safe-next.js';
  import { session } from '#lib/stores/session.svelte.js';

  let { children }: { children: Snippet } = $props();

  void session.load();

  const loginPath = resolve('/login');
  const onLogin = $derived(page.url.pathname === loginPath);
  // Show a route only when the guard won't redirect away from it.
  const ready = $derived(
    session.status === 'signedIn' ? !onLogin : session.status === 'signedOut' && onLogin
  );

  // Route guard (DESIGN §7.5). Navigation in response to session state.
  $effect(() => {
    if (session.status === 'signedOut' && !onLogin) {
      const here = page.url.pathname + page.url.search + page.url.hash;
      // The rule rejects a resolved path with a query string appended.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(`${resolve('/login')}?next=${encodeURIComponent(here)}`, { replace: true });
    } else if (session.status === 'signedIn' && onLogin) {
      void goToNext(safeNext(page.url.searchParams.get('next')));
    }
  });

  /** `goto` rejects paths with no route, so those fall back to home. */
  async function goToNext(next: string) {
    const route = await match(next);
    // `next` is a same-origin path that matches a route, which `resolve` can't type.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    await goto(route ? next : resolve('/'), { replace: true });
  }
</script>

{#if ready}
  {@render children()}
{:else}
  <main>
    <p role="status">{t('app.loading')}</p>
  </main>
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: var(--space-4);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-family-base);
    font-size: var(--font-size-base);
    line-height: var(--line-height-base);
  }

  :global(:focus-visible) {
    outline: var(--focus-ring-width) solid var(--color-focus-ring);
    outline-offset: var(--focus-ring-offset);
  }

  p {
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
