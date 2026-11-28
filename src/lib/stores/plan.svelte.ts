// The derived plan (DESIGN §7.3): the engine run on the open holiday's facts,
// the catalogue and holiday-local now. It re-derives whenever any of them
// changes, optimistic writes included.
import type { Schemas } from '#lib/api/client.js';
import {
  plan as runEngine,
  type Catalogue,
  type HolidayFacts as EngineFacts,
  type LocalDateTime,
  type ManualStockChange,
  type Plan,
  type ShoppingTrip
} from '#lib/engine/index.js';
import { catalogue as appCatalogue, type CatalogueStore } from './catalogue.svelte.js';
import { holiday as appHoliday, type HolidayStore } from './holiday.svelte.js';
import { now as appNow } from './now.svelte.js';

type ApiFacts = Schemas['HolidayFacts'];

// The API leaves trips and stock changes loosely typed until phases 6 and 7,
// and this phase's engine doesn't read them, so `engineFacts()` passes none.
// These fail to compile once the API types them: then pass them through.
const tripsUntyped: ApiFacts['trips'] extends ShoppingTrip[] ? never : true = true;
const stockUntyped: ApiFacts['stockChanges'] extends ManualStockChange[] ? never : true = true;
void tripsUntyped;
void stockUntyped;

/** The engine's facts from the API's: the members aren't part of the plan. */
export function engineFacts(facts: ApiFacts): EngineFacts {
  return {
    holiday: facts.holiday,
    attendees: facts.attendees,
    meals: facts.meals,
    trips: [],
    stockChanges: []
  };
}

/** The engine's catalogue from the store's lists. */
export function engineCatalogue(store: Pick<CatalogueStore, 'recipes' | 'ingredients'>): Catalogue {
  return { recipes: [...store.recipes], ingredients: [...store.ingredients] };
}

export interface PlanStoreOptions {
  readonly holiday: HolidayStore;
  readonly catalogue: CatalogueStore;
  readonly now: { readonly current: LocalDateTime | null };
}

export class PlanStore {
  readonly #options: PlanStoreOptions;

  /** The plan, or `null` until the holiday, the catalogue and now are all there. */
  readonly plan = $derived.by<Plan | null>(() => {
    const { holiday, catalogue, now } = this.#options;
    const facts = holiday.facts;
    const at = now.current;
    if (!facts || catalogue.status !== 'ready' || at === null) return null;
    return runEngine(engineFacts(facts), engineCatalogue(catalogue), at);
  });

  constructor(options: PlanStoreOptions) {
    this.#options = options;
  }
}

/** The open holiday's plan. */
export const planStore = new PlanStore({
  holiday: appHoliday,
  catalogue: appCatalogue,
  now: appNow
});
