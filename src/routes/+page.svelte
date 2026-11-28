<script lang="ts">
  import { v7 as uuidv7 } from 'uuid';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CreateHolidayForm from '#lib/components/CreateHolidayForm.svelte';
  import HolidayList from '#lib/components/HolidayList.svelte';
  import { t } from '#lib/i18n/en.js';
  import { myHolidays, type HolidayFields } from '#lib/stores/holidays.svelte.js';
  import { session } from '#lib/stores/session.svelte.js';

  const name = $derived(session.user?.name ?? '');

  void myHolidays.load();

  async function create(fields: HolidayFields) {
    const created = await myHolidays.create(uuidv7(), fields);
    await goto(resolve('/holidays/[holidayId]', { holidayId: created.id }));
  }
</script>

<svelte:head>
  <title>{t('home.title')}</title>
</svelte:head>

<main>
  <header>
    <h1>{t('home.greeting', { name })}</h1>
    <!-- Signing out flips the session, and the layout's guard returns to /login. -->
    <button type="button" onclick={() => session.signOut()}>{t('home.signOut')}</button>
  </header>

  <section aria-labelledby="holidays-heading">
    <h2 id="holidays-heading">{t('home.holidaysHeading')}</h2>
    <HolidayList
      holidays={myHolidays.list}
      status={myHolidays.status}
      onretry={() => void myHolidays.load()}
    />
  </section>

  <section>
    <CreateHolidayForm oncreate={create} />
  </section>
</main>

<style>
  main {
    max-width: 36rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  h2 {
    font-size: var(--font-size-lg);
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
