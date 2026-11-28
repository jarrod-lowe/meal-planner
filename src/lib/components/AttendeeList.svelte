<script lang="ts">
  import { tick } from 'svelte';
  import { v7 as uuidv7 } from 'uuid';
  import type { Schemas } from '#lib/api/client.js';
  import { t } from '#lib/i18n/en.js';
  import { holiday as appHoliday, type HolidayStore } from '#lib/stores/holiday.svelte.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { maxNameLength, nameError, type NameError } from './names.js';

  type Attendee = Schemas['Attendee'];

  let { store = appHoliday }: { store?: HolidayStore } = $props();

  const attendees = $derived(store.facts?.attendees ?? []);

  let newName = $state('');
  let newError = $state<NameError | null>(null);
  let newField = $state<HTMLInputElement>();

  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editError = $state<NameError | null>(null);

  let deleting = $state<Attendee | null>(null);
  let confirmOpen = $state(false);

  const renameButtonId = (id: string) => `attendee-rename-${id}`;

  async function add(event: SubmitEvent) {
    event.preventDefault();
    newError = nameError(newName);
    if (newError) {
      newField?.focus();
      return;
    }
    const name = newName.trim();
    newName = '';
    await store.mutate({ kind: 'attendees', id: uuidv7(), fields: { name } });
  }

  function startRename(attendee: Attendee) {
    editingId = attendee.id;
    editName = attendee.name;
    editError = null;
  }

  async function finishRename(id: string) {
    editingId = null;
    editError = null;
    await tick();
    document.getElementById(renameButtonId(id))?.focus();
  }

  async function saveRename(event: SubmitEvent, attendee: Attendee) {
    event.preventDefault();
    editError = nameError(editName);
    if (editError) return;
    const name = editName.trim();
    const changed = name !== attendee.name;
    await finishRename(attendee.id);
    if (changed) await store.mutate({ kind: 'attendees', id: attendee.id, fields: { name } });
  }

  function onEditKeydown(event: KeyboardEvent, id: string) {
    if (event.key === 'Escape') {
      event.preventDefault();
      void finishRename(id);
    }
  }

  function askDelete(attendee: Attendee) {
    deleting = attendee;
    confirmOpen = true;
  }

  async function confirmDelete() {
    const attendee = deleting;
    if (!attendee) return;
    await store.mutate({ kind: 'attendees', id: attendee.id, remove: true, label: attendee.name });
  }

  /** Focuses the rename field as it appears, with its text selected. */
  function focusSelect(input: HTMLInputElement) {
    input.focus();
    input.select();
  }
</script>

<section aria-labelledby="attendees-heading">
  <h2 id="attendees-heading">{t('people.attendees.heading')}</h2>
  <p class="muted">{t('people.attendees.intro')}</p>

  {#if attendees.length === 0}
    <p class="muted">{t('people.attendees.empty')}</p>
  {:else}
    <ul aria-labelledby="attendees-heading">
      {#each attendees as attendee (attendee.id)}
        <li>
          {#if editingId === attendee.id}
            <form class="row" onsubmit={(event) => saveRename(event, attendee)} novalidate>
              <input
                type="text"
                autocomplete="off"
                maxlength={maxNameLength}
                aria-label={t('people.attendees.renameField', { name: attendee.name })}
                aria-invalid={editError ? true : undefined}
                aria-describedby={editError ? `attendee-edit-error-${attendee.id}` : undefined}
                bind:value={editName}
                onkeydown={(event) => onEditKeydown(event, attendee.id)}
                {@attach focusSelect}
              />
              <div class="buttons">
                <button type="submit" class="primary">{t('people.attendees.save')}</button>
                <button type="button" onclick={() => finishRename(attendee.id)}>
                  {t('people.attendees.cancel')}
                </button>
              </div>
              {#if editError}
                <p id="attendee-edit-error-{attendee.id}" class="error">
                  {t(`people.${editError}`)}
                </p>
              {/if}
            </form>
          {:else}
            <div class="row">
              <span class="name">{attendee.name}</span>
              <div class="buttons">
                <button
                  type="button"
                  id={renameButtonId(attendee.id)}
                  aria-label={t('people.attendees.renameLabel', { name: attendee.name })}
                  onclick={() => startRename(attendee)}
                >
                  {t('people.attendees.rename')}
                </button>
                <button
                  type="button"
                  aria-label={t('people.attendees.deleteLabel', { name: attendee.name })}
                  onclick={() => askDelete(attendee)}
                >
                  {t('people.attendees.delete')}
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form class="add" onsubmit={add} novalidate>
    <label for="new-attendee">{t('people.attendees.newName')}</label>
    <div class="row">
      <input
        id="new-attendee"
        type="text"
        autocomplete="off"
        maxlength={maxNameLength}
        bind:value={newName}
        bind:this={newField}
        oninput={() => (newError = null)}
        aria-invalid={newError ? true : undefined}
        aria-describedby={newError ? 'new-attendee-error' : undefined}
      />
      <button type="submit" class="primary">{t('people.attendees.add')}</button>
    </div>
    {#if newError}
      <p id="new-attendee-error" class="error">{t(`people.${newError}`)}</p>
    {/if}
  </form>

  <ConfirmDialog
    bind:open={confirmOpen}
    heading={t('people.attendees.deleteHeading', { name: deleting?.name ?? '' })}
    message={t('people.attendees.deleteMessage', { name: deleting?.name ?? '' })}
    confirmLabel={t('people.attendees.deleteConfirm')}
    onconfirm={confirmDelete}
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

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  input {
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

  input[aria-invalid='true'] {
    border-color: var(--color-danger);
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
