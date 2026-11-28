// A fake `fetch` behind a real API client, for store and component tests.
import { vi } from 'vitest';
import { createApiClient } from '#lib/api/client.js';

export const meta = { updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-me' };

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const apiError = (status: number, code: string, message = code, current?: unknown) =>
  json(
    status,
    current === undefined ? { error: { code, message } } : { error: { code, message }, current }
  );

/** A response, a network error, or a function of the request (for ids the test can't know). */
export type Reply = Response | Error | Promise<Response> | ((request: SentRequest) => Response);

export interface SentRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** Queue replies per `METHOD /path` (without `/api`), or per method for any path. */
export function fakeApi() {
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
  const api = createApiClient({ fetch, token: () => Promise.resolve('token') });
  return { api, fetch, reply, requests };
}
