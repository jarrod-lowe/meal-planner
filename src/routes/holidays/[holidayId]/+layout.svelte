<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import HolidayFrame from '#lib/components/HolidayFrame.svelte';
  import type { HolidaySection } from '#lib/components/holiday-sections.js';

  let { children }: { children: Snippet } = $props();

  const holidayId = $derived(page.params.holidayId ?? '');
  const current = $derived<HolidaySection>(
    page.route.id?.endsWith('/people') ? 'people' : 'overview'
  );
</script>

<HolidayFrame {holidayId} {current}>
  {@render children()}
</HolidayFrame>
