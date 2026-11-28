// A loaded `HolidayStore` behind a fake API, for component tests.
import type { Schemas } from '#lib/api/client.js';
import { HolidayStore } from '#lib/stores/holiday.svelte.js';
import { Toasts } from '#lib/stores/toast.svelte.js';
import { fakeApi, json, meta } from './api.js';

export { apiError, json, meta, type SentRequest } from './api.js';

export const holidayId = '0190a0b0-0000-7000-8000-000000000001';

export function facts(overrides: Partial<Schemas['HolidayFacts']> = {}): Schemas['HolidayFacts'] {
  return {
    holiday: {
      id: holidayId,
      name: 'Summer',
      timeZone: 'Pacific/Auckland',
      startDate: '2026-12-26',
      endDate: '2027-01-02',
      version: 1,
      ...meta
    },
    attendees: [],
    meals: [],
    trips: [],
    stockChanges: [],
    members: [],
    ...overrides
  };
}

/** A store loaded with `initial`. Queue replies per `METHOD /path` (without `/api`). */
export async function loadedHoliday(initial: Schemas['HolidayFacts']) {
  const { api, reply, requests } = fakeApi();
  const toasts = new Toasts();
  const store = new HolidayStore({ api, toasts, sleep: () => Promise.resolve() });
  reply(`GET /holidays/${holidayId}`, json(200, initial));
  await store.load(holidayId);
  requests.length = 0;
  return { store, toasts, reply, requests };
}
