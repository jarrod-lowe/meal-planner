<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, isRetryable } from '#lib/api/client.js';
  import { t } from '#lib/i18n/en.js';
  import type { HolidayFields } from '#lib/stores/holidays.svelte.js';

  type ErrorKey =
    'nameRequired' | 'nameTooLong' | 'startRequired' | 'endRequired' | 'endBeforeStart';
  type Field = 'name' | 'start' | 'end';

  let {
    oncreate,
    defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeZones = Intl.supportedValuesOf('timeZone')
  }: {
    /** Creates the holiday; a rejection is shown as an alert in the form. */
    oncreate: (fields: HolidayFields) => Promise<void>;
    defaultTimeZone?: string;
    timeZones?: readonly string[];
  } = $props();

  /** Names are 1–100 characters (DESIGN §5.2). */
  const maxName = 100;

  // The defaults are read once: they seed the form, which is then the user's.
  // svelte-ignore state_referenced_locally
  let timeZone = $state(defaultTimeZone);
  let name = $state('');
  let startDate = $state('');
  let endDate = $state('');
  let errors = $state<Partial<Record<Field, ErrorKey>>>({});
  let pending = $state(false);
  let failure = $state<string | null>(null);

  // svelte-ignore state_referenced_locally
  const zoneOptions = timeZones.includes(defaultTimeZone)
    ? timeZones
    : [defaultTimeZone, ...timeZones];

  const inputs: Partial<Record<Field, HTMLInputElement>> = {};

  function validate(): Partial<Record<Field, ErrorKey>> {
    const found: Partial<Record<Field, ErrorKey>> = {};
    const trimmed = name.trim();
    if (!trimmed) found.name = 'nameRequired';
    else if (trimmed.length > maxName) found.name = 'nameTooLong';
    if (!startDate) found.start = 'startRequired';
    if (!endDate) found.end = 'endRequired';
    else if (startDate && endDate < startDate) found.end = 'endBeforeStart';
    return found;
  }

  function failureMessage(error: unknown): string {
    return error instanceof ApiError && !isRetryable(error)
      ? t('createHoliday.rejected', { message: error.message })
      : t('createHoliday.failed');
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    failure = null;
    errors = validate();
    const first = (['name', 'start', 'end'] as const).find((field) => errors[field]);
    if (first) {
      await tick();
      inputs[first]?.focus();
      return;
    }
    pending = true;
    try {
      await oncreate({ name: name.trim(), startDate, endDate, timeZone });
    } catch (error) {
      failure = failureMessage(error);
    } finally {
      pending = false;
    }
  }

  const errorId = (field: Field) => `create-holiday-${field}-error`;
</script>

{#snippet fieldError(field: Field)}
  {#if errors[field]}
    <p id={errorId(field)} class="error">{t(`createHoliday.errors.${errors[field]}`)}</p>
  {/if}
{/snippet}

<form onsubmit={submit} novalidate aria-labelledby="create-holiday-heading">
  <h2 id="create-holiday-heading">{t('createHoliday.heading')}</h2>

  <div class="field">
    <label for="create-holiday-name">{t('createHoliday.name')}</label>
    <input
      id="create-holiday-name"
      type="text"
      autocomplete="off"
      required
      maxlength={maxName}
      bind:value={name}
      bind:this={inputs.name}
      aria-invalid={errors.name ? true : undefined}
      aria-describedby={errors.name ? errorId('name') : undefined}
    />
    {@render fieldError('name')}
  </div>

  <div class="dates">
    <div class="field">
      <label for="create-holiday-start">{t('createHoliday.startDate')}</label>
      <input
        id="create-holiday-start"
        type="date"
        required
        bind:value={startDate}
        bind:this={inputs.start}
        aria-invalid={errors.start ? true : undefined}
        aria-describedby={errors.start ? errorId('start') : undefined}
      />
      {@render fieldError('start')}
    </div>

    <div class="field">
      <label for="create-holiday-end">{t('createHoliday.endDate')}</label>
      <input
        id="create-holiday-end"
        type="date"
        required
        min={startDate || undefined}
        bind:value={endDate}
        bind:this={inputs.end}
        aria-invalid={errors.end ? true : undefined}
        aria-describedby={errors.end ? errorId('end') : undefined}
      />
      {@render fieldError('end')}
    </div>
  </div>

  <div class="field">
    <label for="create-holiday-time-zone">{t('createHoliday.timeZone')}</label>
    <select
      id="create-holiday-time-zone"
      bind:value={timeZone}
      aria-describedby="create-holiday-time-zone-help"
    >
      {#each zoneOptions as zone (zone)}
        <option value={zone}>{zone}</option>
      {/each}
    </select>
    <p id="create-holiday-time-zone-help" class="help">{t('createHoliday.timeZoneHelp')}</p>
  </div>

  <div role="alert" class="error">{failure ?? ''}</div>

  <button type="submit" class="primary" disabled={pending} aria-busy={pending}>
    {pending ? t('createHoliday.busy') : t('createHoliday.submit')}
  </button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .dates .field {
    flex: 1 1 10rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  input,
  select {
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    min-block-size: 2.75rem;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  p {
    margin: 0;
  }

  .help {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  .primary {
    align-self: flex-start;
    font: inherit;
    cursor: pointer;
    color: var(--color-primary-text);
    background: var(--color-primary);
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    font-weight: var(--font-weight-bold);
  }

  .primary:disabled {
    cursor: progress;
    opacity: 0.7;
  }
</style>
