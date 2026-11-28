// A loaded `HolidayStore` behind a fake API, for component tests.
import { vi } from 'vitest';
import { createApiClient, type Schemas } from '#lib/api/client.js';
import { HolidayStore } from '#lib/stores/holiday.svelte.js';
import { Toasts } from '#lib/stores/toast.svelte.js';

export const holidayId = '0190a0b0-0000-7000-8000-000000000001';
export const meta = { updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-me' };

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

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const apiError = (status: number, code: string, message = code, current?: unknown) =>
  json(
    status,
    current === undefined ? { error: { code, message } } : { error: { code, message }, current }
  );

/** A response, a network error, or a function of the request (for ids the test can't know). */
type Reply = Response | Error | Promise<Response> | ((request: SentRequest) => Response);

export interface SentRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A store loaded with `initial`. Queue replies per `METHOD /path` (without `/api`). */
export async function loadedHoliday(initial: Schemas['HolidayFacts']) {
  const queues = new Map<string, Reply[]>();
  const requests: SentRequest[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const request: SentRequest = {
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    };
    requests.push(request);
    // A reply queued for just the method matches any path.
    const reply = (queues.get(`${method} ${path}`) ?? queues.get(method))?.shift();
    if (!reply) return Promise.reject(new Error(`unexpected ${method} ${path}`));
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(typeof reply === 'function' ? reply(request) : reply);
  });
  const reply = (key: string, ...replies: Reply[]) => {
    queues.set(key, [...(queues.get(key) ?? []), ...replies]);
  };
  const toasts = new Toasts();
  const store = new HolidayStore({
    api: createApiClient({ fetch, token: () => Promise.resolve('token') }),
    toasts,
    sleep: () => Promise.resolve()
  });
  reply(`GET /holidays/${holidayId}`, json(200, initial));
  await store.load(holidayId);
  requests.length = 0;
  return { store, toasts, reply, requests };
}
