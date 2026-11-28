<script lang="ts">
  import { ApiError } from '#lib/api/client.js';
  import { t } from '#lib/i18n/en.js';
  import { holiday as appHoliday, type HolidayStore } from '#lib/stores/holiday.svelte.js';
  import { users as appUsers, type Users } from '#lib/stores/users.svelte.js';
  import ConfirmDialog from './ConfirmDialog.svelte';

  let {
    me,
    onleave,
    store = appHoliday,
    users = appUsers
  }: {
    /** The signed-in user's sub. */
    me: string;
    /** Called once you've removed yourself. */
    onleave: () => void;
    store?: HolidayStore;
    users?: Users;
  } = $props();

  const members = $derived(store.facts?.members ?? []);
  const holidayName = $derived(store.facts?.holiday.name ?? '');
  const addable = $derived(
    users.list.filter((user) => !members.some((member) => member.userSub === user.sub))
  );

  let usersStatus = $state<'loading' | 'ready' | 'failed'>('loading');
  let chosen = $state('');
  let confirmOpen = $state(false);
  let lastMember = $state(false);

  async function loadUsers() {
    usersStatus = 'loading';
    try {
      await users.load();
      usersStatus = 'ready';
    } catch {
      usersStatus = 'failed';
    }
  }

  void loadUsers();

  const nameOf = (sub: string) => users.nameOf(sub) ?? t('people.members.unknown');

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const sub = chosen;
    if (!sub) return;
    chosen = '';
    await store.mutate({ kind: 'members', id: sub, fields: {}, label: nameOf(sub) });
  }

  async function remove(sub: string) {
    lastMember = false;
    await store.mutate({ kind: 'members', id: sub, remove: true, label: nameOf(sub) });
  }

  async function leave() {
    lastMember = false;
    const result = await store.mutate({
      kind: 'members',
      id: me,
      remove: true,
      label: nameOf(me)
    });
    if (result.outcome === 'saved') {
      onleave();
    } else if (
      result.outcome === 'failed' &&
      result.error instanceof ApiError &&
      result.error.code === 'last-member'
    ) {
      lastMember = true;
    }
  }
</script>

<section aria-labelledby="members-heading">
  <h2 id="members-heading">{t('people.members.heading')}</h2>
  <p class="muted">{t('people.members.intro')}</p>

  {#if lastMember}
    <p role="alert" class="error">{t('people.members.lastMember')}</p>
  {/if}

  <ul aria-labelledby="members-heading">
    {#each members as member (member.userSub)}
      {@const name = nameOf(member.userSub)}
      {@const isMe = member.userSub === me}
      <li>
        <div class="row">
          <span class="name">
            {name}
            {#if isMe}<span class="muted">{t('people.members.you')}</span>{/if}
          </span>
          {#if isMe}
            <button type="button" onclick={() => (confirmOpen = true)}>
              {t('people.members.leave')}
            </button>
          {:else}
            <button
              type="button"
              aria-label={t('people.members.removeLabel', { name })}
              onclick={() => remove(member.userSub)}
            >
              {t('people.members.remove')}
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  {#if usersStatus === 'loading'}
    <p class="muted" role="status">{t('people.members.usersLoading')}</p>
  {:else if usersStatus === 'failed'}
    <div class="row">
      <p class="error">{t('people.members.usersFailed')}</p>
      <button type="button" onclick={loadUsers}>{t('people.members.retry')}</button>
    </div>
  {:else if addable.length === 0}
    <p class="muted">{t('people.members.noneToAdd')}</p>
  {:else}
    <form class="add" onsubmit={add}>
      <label for="add-member">{t('people.members.addField')}</label>
      <div class="row">
        <select id="add-member" bind:value={chosen}>
          <option value="">{t('people.members.choose')}</option>
          {#each addable as user (user.sub)}
            <option value={user.sub}>{user.name}</option>
          {/each}
        </select>
        <button type="submit" class="primary">{t('people.members.add')}</button>
      </div>
    </form>
  {/if}

  <ConfirmDialog
    bind:open={confirmOpen}
    heading={t('people.members.leaveHeading')}
    message={t('people.members.leaveMessage', { holiday: holidayName })}
    confirmLabel={t('people.members.leaveConfirm')}
    onconfirm={leave}
  />
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--color-text-muted);
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }

  li + li {
    border-block-start: 1px solid var(--color-border);
  }

  li {
    padding: var(--space-2) var(--space-3);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
    flex: 1 1 8rem;
    overflow-wrap: anywhere;
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  select {
    flex: 1 1 10rem;
    min-inline-size: 0;
    min-block-size: 2.75rem;
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  button {
    font: inherit;
    cursor: pointer;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .primary {
    color: var(--color-primary-text);
    background: var(--color-primary);
    border-color: var(--color-primary);
    font-weight: var(--font-weight-bold);
  }

  .error {
    flex-basis: 100%;
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }
</style>
