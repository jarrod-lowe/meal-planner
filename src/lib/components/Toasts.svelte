<script lang="ts">
  import { t } from '#lib/i18n/en.js';
  import { toasts as appToasts, type Toasts } from '#lib/stores/toast.svelte.js';

  let { toasts = appToasts }: { toasts?: Toasts } = $props();
</script>

<!--
  The log is always in the DOM, so screen readers announce toasts added later.
  `role="log"` is a polite live region that announces additions.
-->
<section class="toasts" aria-label={t('toasts.label')}>
  <ul role="log" aria-live="polite" aria-relevant="additions">
    {#each toasts.items as toast (toast.id)}
      <li class={toast.kind}>
        <p>
          <strong>{t(toast.kind === 'error' ? 'toasts.error' : 'toasts.info')}:</strong>
          {toast.message}
        </p>
        <div class="buttons">
          {#if toast.action}
            <button type="button" class="action" onclick={() => toasts.act(toast.id)}>
              {toast.action.label}
            </button>
          {/if}
          <button
            type="button"
            class="dismiss"
            aria-label={t('toasts.dismiss')}
            onclick={() => toasts.dismiss(toast.id)}
          >
            <span aria-hidden="true">{t('toasts.dismissIcon')}</span>
          </button>
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .toasts {
    position: fixed;
    inset-inline: var(--space-4);
    inset-block-end: var(--space-4);
    z-index: 10;
    pointer-events: none;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-inline-size: 32rem;
    margin: 0 auto;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-inline-start: var(--space-1) solid var(--color-text-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    color: var(--color-text);
    pointer-events: auto;
  }

  li.error {
    border-inline-start-color: var(--color-danger);
  }

  li.error strong {
    color: var(--color-danger);
  }

  p {
    flex: 1 1 12rem;
    margin: 0;
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
  }

  button {
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .action {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: var(--color-primary-text);
    font-weight: var(--font-weight-bold);
  }
</style>
