<script lang="ts">
  import '#lib/theme.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}

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
</style>
