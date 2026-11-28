<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { t } from '#lib/i18n/en.js';

  let {
    open = $bindable(false),
    heading,
    message,
    confirmLabel,
    onconfirm,
    children
  }: {
    open?: boolean;
    /** Already translated. */
    heading: string;
    message: string;
    confirmLabel: string;
    onconfirm: () => void;
    /** More detail, between the message and the buttons. */
    children?: Snippet;
  } = $props();

  const id = $props.id();

  /**
   * Opens the native modal dialog, which traps focus, closes on Escape and
   * returns focus to the opener when it closes.
   */
  function modal(dialog: HTMLDialogElement) {
    if (open && !dialog.open) {
      dialog.showModal();
      // Start on Cancel, the safe choice.
      void tick().then(() => dialog.querySelector<HTMLElement>('[data-cancel]')?.focus());
    } else if (!open && dialog.open) dialog.close();
  }

  function confirm() {
    open = false;
    onconfirm();
  }
</script>

<dialog
  {@attach modal}
  aria-labelledby="{id}-heading"
  aria-describedby="{id}-message"
  onclose={() => (open = false)}
>
  {#if open}
    <h2 id="{id}-heading">{heading}</h2>
    <p id="{id}-message">{message}</p>
    {@render children?.()}
    <div class="buttons">
      <button type="button" data-cancel onclick={() => (open = false)}>
        {t('confirm.cancel')}
      </button>
      <button type="button" class="danger" onclick={confirm}>{confirmLabel}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    max-inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-raised);
    color: var(--color-text);
  }

  dialog::backdrop {
    background: var(--color-text);
    opacity: 0.4;
  }

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0 0 var(--space-3);
  }

  p {
    margin: 0 0 var(--space-6);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  button {
    font: inherit;
    cursor: pointer;
    min-block-size: 2.75rem;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
  }

  .danger {
    border-color: var(--color-danger);
    background: var(--color-danger);
    color: var(--color-surface);
    font-weight: var(--font-weight-bold);
  }
</style>
