<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import MealEditor from '#lib/components/MealEditor.svelte';

  const holidayId = $derived(page.params.holidayId ?? '');
  const mealId = $derived(page.params.mealId ?? 'new');

  /** A new meal has been saved: its own URL replaces `/meals/new`. */
  function created(id: string) {
    void goto(resolve('/holidays/[holidayId]/meals/[mealId]', { holidayId, mealId: id }), {
      replace: true
    });
  }

  function deleted() {
    void goto(resolve('/holidays/[holidayId]/plan', { holidayId }));
  }
</script>

<main>
  <!-- The layout loads the holiday and the catalogue first. Each meal gets a fresh editor, with its own working copy. -->
  {#key mealId}
    <MealEditor
      {mealId}
      date={page.url.searchParams.get('date')}
      slot={page.url.searchParams.get('slot')}
      oncreated={created}
      ondeleted={deleted}
    />
  {/key}
</main>

<style>
  main {
    max-inline-size: 48rem;
  }
</style>
