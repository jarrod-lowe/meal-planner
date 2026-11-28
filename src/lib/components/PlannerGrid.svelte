<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Schemas } from '#lib/api/client.js';
  import { formatDate, formatDay } from '#lib/format/dates.js';
  import { t } from '#lib/i18n/en.js';
  import { MEAL_SLOTS } from '#lib/model/slots.js';
  import PlannerCell from './PlannerCell.svelte';
  import { plannerGrid } from './planner-grid.js';

  let {
    holidayId,
    facts,
    recipes
  }: {
    holidayId: string;
    facts: Schemas['HolidayFacts'];
    recipes: readonly Schemas['Recipe'][];
  } = $props();

  const uid = $props.id();
  const grid = $derived(plannerGrid(facts));
  const recipesById = $derived(new Map(recipes.map((recipe) => [recipe.id, recipe])));

  /** Row and column steps for each arrow key. */
  const moves: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1]
  };

  /** Arrow keys move focus to the first link in the next cell over (the links stay in the tab order). */
  function arrowKeys(table: HTMLTableElement) {
    const onKeydown = (event: KeyboardEvent) => {
      const move = moves[event.key];
      if (!move || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target instanceof Element)) return;
      const cell = event.target.closest<HTMLElement>('td[data-row]');
      if (!cell) return;
      const row = Number(cell.dataset.row) + move[0];
      const col = Number(cell.dataset.col) + move[1];
      const next = table.querySelector<HTMLElement>(`td[data-row="${row}"][data-col="${col}"] a`);
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    table.addEventListener('keydown', onKeydown);
    return () => table.removeEventListener('keydown', onKeydown);
  }

  const firstDate = (meal: Schemas['Meal']) => formatDate(meal.mealtimes[0]?.at.slice(0, 10) ?? '');
</script>

<div class="planner">
  <!-- Desktop: a table of days × meal slots (DESIGN §7.6). -->
  <div class="table-wrap">
    <table {@attach arrowKeys}>
      <caption class="visually-hidden">{t('plan.caption')}</caption>
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">{t('plan.day')}</span></th>
          {#each MEAL_SLOTS as slot (slot)}
            <th scope="col">{t(`slots.${slot}`)}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each grid.days as day, row (day.date)}
          <tr>
            <th scope="row">{formatDay(day.date)}</th>
            {#each MEAL_SLOTS as slot, col (slot)}
              <td data-row={row} data-col={col}>
                <PlannerCell
                  {holidayId}
                  date={day.date}
                  {slot}
                  chips={day.cells[slot]}
                  recipes={recipesById}
                />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Phones: a list of days, each with its slots, using the same cells. -->
  <ol class="days" data-testid="planner-days">
    {#each grid.days as day (day.date)}
      <li aria-labelledby="{uid}-day-{day.date}">
        <h2 id="{uid}-day-{day.date}">{formatDay(day.date)}</h2>
        <div class="slots">
          {#each MEAL_SLOTS as slot (slot)}
            <div class="slot">
              <h3>{t(`slots.${slot}`)}</h3>
              <PlannerCell
                {holidayId}
                date={day.date}
                {slot}
                chips={day.cells[slot]}
                recipes={recipesById}
              />
            </div>
          {/each}
        </div>
      </li>
    {/each}
  </ol>

  {#if grid.outside.length > 0}
    <section class="outside" aria-labelledby="{uid}-outside">
      <h2 id="{uid}-outside">{t('plan.outside.heading')}</h2>
      <p>{t('plan.outside.intro')}</p>
      <ul>
        {#each grid.outside as meal (meal.id)}
          <li>
            <a
              href={resolve('/holidays/[holidayId]/meals/[mealId]', { holidayId, mealId: meal.id })}
            >
              {t('plan.outside.meal', { name: meal.name, date: firstDate(meal) })}
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .planner {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  th,
  td {
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    vertical-align: top;
  }

  thead th {
    text-align: start;
  }

  thead th:first-child {
    inline-size: 6.5rem;
  }

  th[scope='row'] {
    text-align: start;
    white-space: nowrap;
  }

  .days {
    display: none;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .days > li {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-3);
    border-block-end: 1px solid var(--color-border);
  }

  .slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .slot {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
    align-items: start;
    gap: var(--space-2);
  }

  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  h3 {
    font-size: var(--font-size-base);
    margin: 0;
    padding-block-start: var(--space-2);
  }

  @media (max-width: 47.99rem) {
    .table-wrap {
      display: none;
    }

    .days {
      display: block;
    }
  }

  .outside {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .outside p {
    margin: 0;
    color: var(--color-text-muted);
  }

  .outside ul {
    margin: 0;
    padding-inline-start: var(--space-6);
  }

  a {
    color: var(--color-primary);
  }

  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
