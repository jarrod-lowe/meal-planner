<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import HolidayFrame from '#lib/components/HolidayFrame.svelte';
  import type { HolidaySection } from '#lib/components/holiday-sections.js';

  let { children }: { children: Snippet } = $props();

  const holidayId = $derived(page.params.holidayId ?? '');
  /** The meal editor is part of Plan. */
  const current = $derived.by<HolidaySection>(() => {
    const route = page.route.id ?? '';
    if (route.endsWith('/people')) return 'people';
    if (route.endsWith('/plan') || route.includes('/meals/')) return 'plan';
    return 'overview';
  });
</script>

<HolidayFrame {holidayId} {current}>
  {@render children()}
</HolidayFrame>
