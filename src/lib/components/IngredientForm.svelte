<script lang="ts">
  import { tick } from 'svelte';
  import { findDuplicate, unitSuggestions } from '#lib/catalogue/search.js';
  import { t } from '#lib/i18n/en.js';
  import { SHOP_SECTIONS, type ShopSection } from '#lib/model/sections.js';
  import {
    catalogue as appCatalogue,
    type CatalogueStore,
    type Ingredient
  } from '#lib/stores/catalogue.svelte.js';
  import { ingredientErrors, maxUnitLength, type IngredientFields } from './ingredient-fields.js';
  import { maxNameLength } from './names.js';

  let {
    store = appCatalogue,
    initial = { name: '', unit: '', shopSection: 'other' },
    exceptId,
    purpose,
    label,
    focus = 'name',
    onsave,
    oncancel,
    onuseexisting
  }: {
    store?: CatalogueStore;
    initial?: IngredientFields;
    /** The ingredient being edited, which isn't a duplicate of itself. */
    exceptId?: string;
    /** Picking for a recipe, adding on the ingredients page, or editing one. */
    purpose: 'pick' | 'add' | 'edit';
    /** Names the form for assistive technology. */
    label: string;
    focus?: 'name' | 'unit';
    onsave: (fields: IngredientFields) => void | Promise<void>;
    oncancel: () => void;
    /** Use the duplicate instead (once shown again, if it was hidden). */
    onuseexisting?: (ingredient: Ingredient) => void;
  } = $props();

  const uid = $props.id();

  // The form edits its own copy; `initial` only seeds it.
  // svelte-ignore state_referenced_locally
  let name = $state(initial.name);
  // svelte-ignore state_referenced_locally
  let unit = $state(initial.unit);
  // svelte-ignore state_referenced_locally
  let shopSection = $state<ShopSection>(initial.shopSection);
  let submitted = $state(false);
  let busy = $state(false);
  let duplicate = $state.raw<Ingredient | null>(null);

  let nameField = $state<HTMLInputElement>();
  let unitField = $state<HTMLInputElement>();

  const errors = $derived(submitted ? ingredientErrors({ name, unit }) : {});
  const units = $derived(unitSuggestions(store.ingredients, name));
  const fields = $derived<IngredientFields>({ name: name.trim(), unit: unit.trim(), shopSection });

  function edited() {
    duplicate = null;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitted = true;
    const found = ingredientErrors({ name, unit });
    if (found.name) return nameField?.focus();
    if (found.unit) return unitField?.focus();
    duplicate = findDuplicate(store.ingredients, name, unit, exceptId) ?? null;
    if (duplicate) return;
    await save();
  }

  async function save() {
    if (busy) return;
    busy = true;
    try {
      await onsave(fields);
    } finally {
      busy = false;
    }
  }

  async function useExisting() {
    const existing = duplicate;
    if (!existing) return;
    if (existing.deleted) await store.show('ingredients', existing.id);
    onuseexisting?.(store.ingredients.find((item) => item.id === existing.id) ?? existing);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      oncancel();
    }
  }

  /** An attachment that focuses the field as it appears, if it's the `focus` one. */
  const focusOnMount = (which: 'name' | 'unit') => (input: HTMLInputElement) => {
    if (focus === which) void tick().then(() => input.focus());
  };
</script>

<!-- Escape in any of its fields cancels the form. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="ingredient-form" aria-label={label} onsubmit={submit} {onkeydown} novalidate>
  <div class="fields">
    <div class="field">
      <label for="{uid}-name">{t('ingredientForm.name')}</label>
      <input
        id="{uid}-name"
        type="text"
        autocomplete="off"
        maxlength={maxNameLength}
        bind:value={name}
        bind:this={nameField}
        oninput={edited}
        aria-invalid={errors.name ? true : undefined}
        aria-describedby={errors.name ? `${uid}-name-error` : undefined}
        {@attach focusOnMount('name')}
      />
      {#if errors.name}
        <p id="{uid}-name-error" class="error">{t(`ingredientForm.errors.${errors.name}`)}</p>
      {/if}
    </div>
    <div class="field unit">
      <label for="{uid}-unit">{t('ingredientForm.unit')}</label>
      <input
        id="{uid}-unit"
        type="text"
        autocomplete="off"
        maxlength={maxUnitLength}
        list="{uid}-units"
        bind:value={unit}
        bind:this={unitField}
        oninput={edited}
        aria-invalid={errors.unit ? true : undefined}
        aria-describedby={errors.unit ? `${uid}-unit-error` : undefined}
        {@attach focusOnMount('unit')}
      />
      <datalist id="{uid}-units">
        {#each units as suggestion (suggestion)}
          <option value={suggestion}></option>
        {/each}
      </datalist>
      {#if errors.unit}
        <p id="{uid}-unit-error" class="error">{t(`ingredientForm.errors.${errors.unit}`)}</p>
      {/if}
    </div>
    <div class="field">
      <label for="{uid}-section">{t('ingredientForm.shopSection')}</label>
      <select id="{uid}-section" bind:value={shopSection} onchange={edited}>
        {#each SHOP_SECTIONS as section (section)}
          <option value={section}>{t(`shopSections.${section}`)}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if duplicate}
    <div class="warning" role="alert">
      <p>
        {t(duplicate.deleted ? 'ingredientForm.duplicateHidden' : 'ingredientForm.duplicate', {
          name: duplicate.name,
          unit: duplicate.unit
        })}
      </p>
      <div class="buttons">
        {#if purpose !== 'edit'}
          <button type="button" class="primary" onclick={useExisting}>
            {#if purpose === 'pick'}
              {t(duplicate.deleted ? 'ingredientForm.showAndUse' : 'ingredientForm.useExisting')}
            {:else}
              {t(duplicate.deleted ? 'ingredientForm.showExisting' : 'ingredientForm.keepExisting')}
            {/if}
          </button>
        {/if}
        <button type="button" onclick={save} aria-disabled={busy}>
          {t(purpose === 'edit' ? 'ingredientForm.saveAnyway' : 'ingredientForm.createAnyway')}
        </button>
      </div>
    </div>
  {/if}

  <div class="buttons">
    <button type="submit" class="primary" aria-disabled={busy}>{t('ingredientForm.save')}</button>
    <button type="button" onclick={oncancel}>{t('ingredientForm.cancel')}</button>
  </div>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex: 1 1 10rem;
    flex-direction: column;
    gap: var(--space-1);
    min-inline-size: 0;
  }

  .field.unit {
    flex-basis: 6rem;
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  input,
  select {
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

  p {
    margin: 0;
  }

  .error {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  .warning {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    color: var(--color-warning);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-md);
  }

  .warning p {
    font-weight: var(--font-weight-bold);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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

  button[aria-disabled='true'] {
    cursor: progress;
  }
</style>
