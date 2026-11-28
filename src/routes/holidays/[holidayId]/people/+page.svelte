<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import AttendeeList from '#lib/components/AttendeeList.svelte';
  import MemberList from '#lib/components/MemberList.svelte';
  import { t } from '#lib/i18n/en.js';
  import { holiday } from '#lib/stores/holiday.svelte.js';
  import { session } from '#lib/stores/session.svelte.js';

  const name = $derived(holiday.facts?.holiday.name ?? '');
  const me = $derived(session.user?.sub ?? '');

  /** You've left the holiday, so it's no longer yours to show. */
  async function left() {
    holiday.clear();
    await goto(resolve('/'));
  }
</script>

<svelte:head>
  <title>{t('people.title', { name })}</title>
</svelte:head>

<main>
  <h1>{t('people.heading')}</h1>
  <AttendeeList />
  <MemberList {me} onleave={left} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-inline-size: 40rem;
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }
</style>
