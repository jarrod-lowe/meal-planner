import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { CancelledError, HolidayStore, withRetry, type MutationResult } from './holiday.svelte.js';
import { Toasts } from './toast.svelte.js';

type Facts = Schemas['HolidayFacts'];

const holidayId = '0190a0b0-0000-7000-8000-000000000001';
const annId = '0190a0b0-0000-7000-8000-0000000000a1';
const newId = '0190a0b0-0000-7000-8000-0000000000b2';
const meta = { updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-1' };

const facts = (): Facts => ({
  holiday: {
    id: holidayId,
    name: 'Summer',
    timeZone: 'Pacific/Auckland',
    startDate: '2026-12-26',
    endDate: '2027-01-02',
    version: 3,
    ...meta
  },
  attendees: [{ id: annId, name: 'Ann', version: 2, ...meta }],
  meals: [],
  trips: [],
  stockChanges: [],
  members: [{ userSub: 'sub-1', version: 1, ...meta }]
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Reply = Response | Error | Promise<Response>;

/**
 * A fake API behind a real client. Each `METHOD path` has a queue of replies;
 * an `Error` reply makes fetch reject (a network error).
 */
function setup(options: { sleep?: (ms: number) => Promise<void> } = {}) {
  const queues = new Map<string, Reply[]>();
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    requests.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    });
    const reply = queues.get(`${method} ${path}`)?.shift();
    if (!reply) return Promise.reject(new Error(`unexpected ${method} ${path}`));
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  const reply = (key: string, ...replies: Reply[]) => {
    queues.set(key, [...(queues.get(key) ?? []), ...replies]);
  };

  let clock = 1_000_000;
  const sleeps: number[] = [];
  const toasts = new Toasts();
  const store = new HolidayStore({
    api: createApiClient({ fetch, token: () => Promise.resolve('token') }),
    toasts,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      return options.sleep?.(ms) ?? Promise.resolve();
    }
  });
  const tick = (ms: number) => (clock += ms);

  return { store, toasts, reply, requests, sleeps, tick, fetch };
}

const attendeePath = (id: string) => `/holidays/${holidayId}/attendees/${id}`;

async function loaded(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  env.reply(`GET /holidays/${holidayId}`, json(200, facts()));
  await env.store.load(holidayId);
  return env;
}

/** A promise you resolve later, to look at the store mid-request. */
function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

describe('HolidayStore loading', () => {
  it('loads the facts by id', async () => {
    const { store, requests } = await loaded();

    expect(requests).toEqual([{ method: 'GET', path: `/holidays/${holidayId}`, body: undefined }]);
    expect(store.status).toBe('ready');
    expect(store.facts).toEqual(facts());
  });

  it('keeps a load error for the page to show', async () => {
    const { store, reply } = setup();
    reply(
      `GET /holidays/${holidayId}`,
      json(403, { error: { code: 'not-a-member', message: 'no' } })
    );

    await store.load(holidayId);

    expect(store.status).toBe('error');
    expect(store.facts).toBeNull();
    expect(store.error).toMatchObject({ status: 403, code: 'not-a-member' });
  });

  it('refreshes on demand', async () => {
    const { store, reply } = await loaded();
    const changed = facts();
    changed.holiday.name = 'Winter';
    reply(`GET /holidays/${holidayId}`, json(200, changed));

    await store.refresh();

    expect(store.facts?.holiday.name).toBe('Winter');
  });

  it('keeps the facts and toasts when a refresh fails', async () => {
    const { store, reply, toasts } = await loaded();
    reply(`GET /holidays/${holidayId}`, new TypeError('offline'));

    await store.refresh();

    expect(store.status).toBe('ready');
    expect(store.facts).toEqual(facts());
    expect(toasts.items.map((toast) => toast.message)).toEqual([t('holiday.refreshFailed')]);
  });

  it('ignores a slow response for a holiday that is no longer open', async () => {
    const { store, reply } = setup();
    const otherId = '0190a0b0-0000-7000-8000-0000000000ff';
    const slow = deferred();
    reply(`GET /holidays/${otherId}`, slow.promise);
    reply(`GET /holidays/${holidayId}`, json(200, facts()));

    const first = store.load(otherId);
    await store.load(holidayId);
    slow.resolve(json(200, { ...facts(), holiday: { ...facts().holiday, id: otherId } }));
    await first;

    expect(store.facts?.holiday.id).toBe(holidayId);
  });

  it('forgets everything on clear', async () => {
    const { store } = await loaded();

    store.clear();

    expect(store.facts).toBeNull();
    expect(store.holidayId).toBeNull();
    expect(store.status).toBe('idle');
  });
});

describe('HolidayStore focus refetch', () => {
  it('refetches on focus at most once every 30 s', async () => {
    const { store, reply, requests, tick } = await loaded();
    reply(`GET /holidays/${holidayId}`, json(200, facts()), json(200, facts()));
    const target = new EventTarget();
    const detach = store.attachFocusRefetch(target);

    tick(29_999);
    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    tick(1);
    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    tick(10_000);
    target.dispatchEvent(new Event('focus'));
    tick(30_000);
    detach();
    target.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(requests).toHaveLength(2);
  });

  it('does nothing on focus with no holiday open', () => {
    const { store, requests } = setup();
    const target = new EventTarget();
    store.attachFocusRefetch(target);

    target.dispatchEvent(new Event('focus'));

    expect(requests).toEqual([]);
  });
});

describe('HolidayStore.mutate', () => {
  it('applies a change optimistically, then replaces it with the stored item', async () => {
    const { store, reply, requests } = await loaded();
    const pending = deferred();
    reply(`PUT ${attendeePath(annId)}`, pending.promise);

    const result = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });

    expect(store.facts?.attendees).toEqual([{ id: annId, name: 'Annie', version: 2, ...meta }]);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual({
      method: 'PUT',
      path: attendeePath(annId),
      body: { name: 'Annie', version: 2 }
    });

    const stored = { id: annId, name: 'Annie', version: 3, updatedAt: 'later', updatedBy: 'sub-1' };
    pending.resolve(json(200, stored));

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(store.facts?.attendees).toEqual([stored]);
  });

  it('creates an item with version 0', async () => {
    const { store, reply, requests } = await loaded();
    const stored = { id: newId, name: 'Bob', version: 1, ...meta };
    reply(`PUT ${attendeePath(newId)}`, json(200, stored));

    const result = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });
    expect(store.facts?.attendees.map((a) => [a.name, a.version])).toEqual([
      ['Ann', 2],
      ['Bob', 0]
    ]);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(requests[1]?.body).toEqual({ name: 'Bob', version: 0 });
    expect(store.facts?.attendees.at(-1)).toEqual(stored);
  });

  it('updates the holiday META with its version', async () => {
    const { store, reply, requests } = await loaded();
    const { name, timeZone, startDate, endDate } = facts().holiday;
    const fields = { name, timeZone, startDate, endDate };
    const stored = { ...facts().holiday, name: 'Winter', version: 4 };
    reply(`PUT /holidays/${holidayId}`, json(200, stored));

    const result = store.mutate({ kind: 'holiday', fields: { ...fields, name: 'Winter' } });
    expect(store.facts?.holiday.name).toBe('Winter');

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(requests[1]?.body).toEqual({ ...fields, name: 'Winter', version: 3 });
    expect(store.facts?.holiday).toEqual(stored);
  });

  it('adds a member with version 0 and removes one', async () => {
    const { store, reply, requests } = await loaded();
    const member = { userSub: 'sub-2', version: 1, ...meta };
    reply(`PUT /holidays/${holidayId}/members/sub-2`, json(200, member));
    reply(`DELETE /holidays/${holidayId}/members/sub-1`, new Response(null, { status: 204 }));

    await store.mutate({ kind: 'members', id: 'sub-2', fields: {} });
    const removing = store.mutate({ kind: 'members', id: 'sub-1', remove: true });
    expect(store.facts?.members).toEqual([member]);

    await expect(removing).resolves.toEqual({ outcome: 'saved' });
    expect(requests.slice(1).map((r) => [r.method, r.body])).toEqual([
      ['PUT', { version: 0 }],
      ['DELETE', undefined]
    ]);
    expect(store.facts?.members).toEqual([member]);
  });

  it('deletes an attendee optimistically', async () => {
    const { store, reply } = await loaded();
    reply(`DELETE ${attendeePath(annId)}`, new Response(null, { status: 204 }));

    const result = store.mutate({ kind: 'attendees', id: annId, remove: true });
    expect(store.facts?.attendees).toEqual([]);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(store.facts?.attendees).toEqual([]);
  });

  describe('on a version conflict', () => {
    it('replaces the item with current and toasts with Refresh holiday', async () => {
      const { store, reply, toasts, requests } = await loaded();
      const current = { id: annId, name: 'Anna', version: 5, ...meta };
      reply(
        `PUT ${attendeePath(annId)}`,
        json(409, { error: { code: 'version-conflict', message: 'x' }, current })
      );

      const result = await store.mutate({
        kind: 'attendees',
        id: annId,
        fields: { name: 'Annie' }
      });

      expect(result).toEqual({ outcome: 'conflict' });
      expect(store.facts?.attendees).toEqual([current]);
      expect(toasts.items).toHaveLength(1);
      const [toast] = toasts.items;
      expect(toast?.kind).toBe('error');
      expect(toast?.message).toBe(t('mutate.conflict', { item: 'Annie' }));
      expect(toast?.action?.label).toBe(t('mutate.refreshHoliday'));

      reply(`GET /holidays/${holidayId}`, json(200, facts()));
      toasts.act(toast?.id ?? 0);
      await vi.waitFor(() => expect(requests.at(-1)?.method).toBe('GET'));
    });

    it('removes the item when current is null (deleted)', async () => {
      const { store, reply, toasts } = await loaded();
      reply(
        `PUT ${attendeePath(annId)}`,
        json(409, { error: { code: 'version-conflict', message: 'x' }, current: null })
      );

      const result = await store.mutate({
        kind: 'attendees',
        id: annId,
        fields: { name: 'Annie' }
      });

      expect(result).toEqual({ outcome: 'conflict' });
      expect(store.facts?.attendees).toEqual([]);
      expect(toasts.items[0]?.message).toBe(t('mutate.conflictDeleted', { item: 'Annie' }));
    });

    it('names the item by its label when given one', async () => {
      const { store, reply, toasts } = await loaded();
      reply(
        `PUT ${attendeePath(annId)}`,
        json(409, { error: { code: 'version-conflict', message: 'x' }, current: null })
      );

      await store.mutate({ kind: 'attendees', id: annId, fields: { name: 'A' }, label: 'Ann B' });

      expect(toasts.items[0]?.message).toBe(t('mutate.conflictDeleted', { item: 'Ann B' }));
    });
  });

  describe('on network errors and 5xx', () => {
    it('retries with backoff, then succeeds', async () => {
      const { store, reply, sleeps, toasts } = await loaded();
      const stored = { id: annId, name: 'Annie', version: 3, ...meta };
      reply(
        `PUT ${attendeePath(annId)}`,
        new TypeError('offline'),
        json(503, { message: 'Service Unavailable' }),
        json(500, { error: { code: 'internal', message: 'x' } }),
        json(200, stored)
      );

      const result = await store.mutate({
        kind: 'attendees',
        id: annId,
        fields: { name: 'Annie' }
      });

      expect(result).toEqual({ outcome: 'saved' });
      expect(sleeps).toEqual([500, 1000, 2000]);
      expect(store.facts?.attendees).toEqual([stored]);
      expect(toasts.items).toEqual([]);
    });

    it('rolls back and toasts after 3 retries', async () => {
      const { store, reply, requests, toasts } = await loaded();
      const offline = () => new TypeError('offline');
      reply(`PUT ${attendeePath(annId)}`, offline(), offline(), offline(), offline());

      const result = await store.mutate({
        kind: 'attendees',
        id: annId,
        fields: { name: 'Annie' }
      });

      expect(result).toMatchObject({ outcome: 'failed' });
      expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(4);
      expect(store.facts?.attendees).toEqual(facts().attendees);
      expect(toasts.items.map((toast) => [toast.kind, toast.message])).toEqual([
        ['error', t('mutate.failed', { item: 'Annie' })]
      ]);
    });

    it('rolls back a failed create by removing it', async () => {
      const { store, reply } = await loaded();
      const offline = () => new TypeError('offline');
      reply(`PUT ${attendeePath(newId)}`, offline(), offline(), offline(), offline());

      await store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });

      expect(store.facts?.attendees).toEqual(facts().attendees);
    });

    it('rolls back a failed delete by restoring the item', async () => {
      const { store, reply } = await loaded();
      const down = () => json(500, { error: { code: 'internal', message: 'x' } });
      reply(`DELETE ${attendeePath(annId)}`, down(), down(), down(), down());

      await store.mutate({ kind: 'attendees', id: annId, remove: true });

      expect(store.facts?.attendees).toEqual(facts().attendees);
    });
  });

  it('rolls back other 4xx at once, with the message', async () => {
    const { store, reply, requests, toasts } = await loaded();
    reply(
      `DELETE /holidays/${holidayId}/members/sub-1`,
      json(409, { error: { code: 'last-member', message: 'A holiday needs a member.' } })
    );

    const result = await store.mutate({
      kind: 'members',
      id: 'sub-1',
      remove: true,
      label: 'Sam'
    });

    expect(result).toMatchObject({ outcome: 'failed', error: { code: 'last-member' } });
    expect(requests).toHaveLength(2);
    expect(store.facts?.members).toEqual(facts().members);
    expect(toasts.items[0]?.message).toBe(
      t('mutate.rejected', { item: 'Sam', message: 'A holiday needs a member.' })
    );
  });

  describe('when a create gets already-exists (§5.3)', () => {
    const alreadyExists = () => json(409, { error: { code: 'already-exists', message: 'exists' } });

    it('re-fetches, and treats a matching stored item as saved', async () => {
      const { store, reply, toasts } = await loaded();
      const stored = { id: newId, name: 'Bob', version: 1, ...meta };
      // The first attempt timed out after the server stored it.
      reply(`PUT ${attendeePath(newId)}`, new TypeError('timeout'), alreadyExists());
      reply(`GET /holidays/${holidayId}`, json(200, { ...facts(), attendees: [stored] }));

      const result = await store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });

      expect(result).toEqual({ outcome: 'saved' });
      expect(store.facts?.attendees).toEqual([...facts().attendees, stored]);
      expect(toasts.items).toEqual([]);
    });

    it('handles a stored item that differs as a conflict', async () => {
      const { store, reply, toasts } = await loaded();
      const stored = { id: newId, name: 'Robert', version: 2, ...meta };
      reply(`PUT ${attendeePath(newId)}`, alreadyExists());
      reply(`GET /holidays/${holidayId}`, json(200, { ...facts(), attendees: [stored] }));

      const result = await store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });

      expect(result).toEqual({ outcome: 'conflict' });
      expect(store.facts?.attendees).toEqual([...facts().attendees, stored]);
      expect(toasts.items[0]?.message).toBe(t('mutate.conflict', { item: 'Bob' }));
    });

    it('treats a member that already exists as added', async () => {
      const { store, reply } = await loaded();
      reply(`PUT /holidays/${holidayId}/members/sub-1`, alreadyExists());
      reply(`GET /holidays/${holidayId}`, json(200, facts()));

      await expect(store.mutate({ kind: 'members', id: 'sub-1', fields: {} })).resolves.toEqual({
        outcome: 'saved'
      });
      expect(store.facts?.members).toEqual(facts().members);
    });

    it('does not apply the rule to updates', async () => {
      const { store, reply, requests } = await loaded();
      reply(`PUT ${attendeePath(annId)}`, alreadyExists());

      const result = await store.mutate({ kind: 'attendees', id: annId, fields: { name: 'A' } });

      expect(result).toMatchObject({ outcome: 'failed' });
      expect(requests.filter((r) => r.method === 'GET')).toHaveLength(1);
      expect(store.facts?.attendees).toEqual(facts().attendees);
    });
  });

  it('does not write into a different holiday opened meanwhile', async () => {
    const { store, reply } = await loaded();
    const otherId = '0190a0b0-0000-7000-8000-0000000000ff';
    const other = { ...facts(), holiday: { ...facts().holiday, id: otherId }, attendees: [] };
    const pending = deferred();
    reply(`PUT ${attendeePath(annId)}`, pending.promise);
    reply(`GET /holidays/${otherId}`, json(200, other));

    const result = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
    await store.load(otherId);
    pending.resolve(json(200, { id: annId, name: 'Annie', version: 3, ...meta }));
    await result;

    expect(store.facts).toEqual(other);
  });

  describe('on the same item, one write at a time', () => {
    const offline = () => new TypeError('offline');

    it('sends a delete only after an earlier PUT settles, and keeps the item deleted', async () => {
      const { store, reply, requests } = await loaded();
      const pending = deferred();
      reply(`PUT ${attendeePath(annId)}`, pending.promise);
      reply(`DELETE ${attendeePath(annId)}`, new Response(null, { status: 204 }));

      const renaming = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      const removing = store.mutate({ kind: 'attendees', id: annId, remove: true });
      expect(store.facts?.attendees).toEqual([]);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      await Promise.resolve();
      expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT']);

      pending.resolve(json(200, { id: annId, name: 'Annie', version: 3, ...meta }));
      await expect(renaming).resolves.toEqual({ outcome: 'saved' });
      expect(store.facts?.attendees).toEqual([]);
      await expect(removing).resolves.toEqual({ outcome: 'saved' });

      expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE']);
      expect(store.facts?.attendees).toEqual([]);
    });

    it('sends a rename after a create with the created version', async () => {
      const { store, reply, requests } = await loaded();
      const pending = deferred();
      const renamed = { id: newId, name: 'Bobby', version: 2, ...meta };
      reply(`PUT ${attendeePath(newId)}`, pending.promise, json(200, renamed));

      const creating = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });
      const renaming = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bobby' } });
      expect(store.facts?.attendees.at(-1)?.name).toBe('Bobby');
      await vi.waitFor(() => expect(requests).toHaveLength(2));

      pending.resolve(json(200, { id: newId, name: 'Bob', version: 1, ...meta }));
      await expect(creating).resolves.toEqual({ outcome: 'saved' });
      expect(store.facts?.attendees.at(-1)?.name).toBe('Bobby');
      await expect(renaming).resolves.toEqual({ outcome: 'saved' });

      expect(requests.slice(1).map((r) => r.body)).toEqual([
        { name: 'Bob', version: 0 },
        { name: 'Bobby', version: 1 }
      ]);
      expect(store.facts?.attendees).toEqual([...facts().attendees, renamed]);
    });

    it('drops a queued rename and delete when the create fails', async () => {
      const { store, reply, requests, toasts } = await loaded();
      reply(`PUT ${attendeePath(newId)}`, offline(), offline(), offline(), offline());

      const creating = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });
      const renaming = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bobby' } });
      const removing = store.mutate({ kind: 'attendees', id: newId, remove: true });

      await expect(creating).resolves.toMatchObject({ outcome: 'failed' });
      await expect(renaming).resolves.toMatchObject({ outcome: 'failed' });
      await expect(removing).resolves.toEqual({ outcome: 'saved' });
      expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(4);
      expect(store.facts?.attendees).toEqual(facts().attendees);
      expect(toasts.items.map((toast) => toast.message)).toEqual([
        t('mutate.failed', { item: 'Bob' })
      ]);
    });

    it('drops queued writes after a conflict, keeping the current item', async () => {
      const { store, reply, requests } = await loaded();
      const current = { id: annId, name: 'Anna', version: 5, ...meta };
      reply(
        `PUT ${attendeePath(annId)}`,
        json(409, { error: { code: 'version-conflict', message: 'x' }, current })
      );

      const first = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      const second = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Ann B' } });

      await expect(first).resolves.toEqual({ outcome: 'conflict' });
      await expect(second).resolves.toEqual({ outcome: 'conflict' });
      expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
      expect(store.facts?.attendees).toEqual([current]);
    });

    it('still writes different items at the same time', async () => {
      const { store, reply, requests } = await loaded();
      const ann = deferred();
      const bob = deferred();
      reply(`PUT ${attendeePath(annId)}`, ann.promise);
      reply(`PUT ${attendeePath(newId)}`, bob.promise);

      const renaming = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      const creating = store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });
      await vi.waitFor(() => expect(requests).toHaveLength(3));

      bob.resolve(json(200, { id: newId, name: 'Bob', version: 1, ...meta }));
      ann.resolve(json(200, { id: annId, name: 'Annie', version: 3, ...meta }));
      await expect(renaming).resolves.toEqual({ outcome: 'saved' });
      await expect(creating).resolves.toEqual({ outcome: 'saved' });
    });
  });

  describe('with a refresh in flight', () => {
    it('keeps a create that lands while a stale refresh is in flight', async () => {
      const { store, reply } = await loaded();
      const slow = deferred();
      reply(`GET /holidays/${holidayId}`, slow.promise);
      const bob = { id: newId, name: 'Bob', version: 1, ...meta };
      reply(`PUT ${attendeePath(newId)}`, json(200, bob));

      const refreshing = store.refresh();
      await store.mutate({ kind: 'attendees', id: newId, fields: { name: 'Bob' } });
      const old = facts();
      old.holiday.name = 'Winter';
      slow.resolve(json(200, old));
      await refreshing;

      expect(store.facts?.attendees).toEqual([...facts().attendees, bob]);
      // Items nobody wrote meanwhile still take the fetched copy.
      expect(store.facts?.holiday.name).toBe('Winter');
    });

    it('keeps a delete that lands while a stale refresh is in flight', async () => {
      const { store, reply } = await loaded();
      const slow = deferred();
      reply(`GET /holidays/${holidayId}`, slow.promise);
      reply(`DELETE ${attendeePath(annId)}`, new Response(null, { status: 204 }));

      const refreshing = store.refresh();
      await store.mutate({ kind: 'attendees', id: annId, remove: true });
      slow.resolve(json(200, facts()));
      await refreshing;

      expect(store.facts?.attendees).toEqual([]);
    });

    it('keeps an optimistic change still in flight when a refresh returns', async () => {
      const { store, reply } = await loaded();
      const pending = deferred();
      reply(`PUT ${attendeePath(annId)}`, pending.promise);
      reply(`GET /holidays/${holidayId}`, json(200, facts()));

      const renaming = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      await store.refresh();
      expect(store.facts?.attendees[0]?.name).toBe('Annie');

      const stored = { id: annId, name: 'Annie', version: 3, ...meta };
      pending.resolve(json(200, stored));
      await renaming;
      expect(store.facts?.attendees).toEqual([stored]);
    });
  });

  describe('after clear (sign-out)', () => {
    const expectCancelled = async (result: Promise<MutationResult>) => {
      const settled = await result;
      expect(settled.outcome).toBe('failed');
      expect(settled.outcome === 'failed' && settled.error).toBeInstanceOf(CancelledError);
    };

    it('stops a write waiting to retry, with no more requests', async () => {
      let wake: () => void = () => undefined;
      const backoff = new Promise<void>((resolve) => (wake = resolve));
      const { store, reply, requests, toasts } = await loaded({ sleep: () => backoff });
      reply(`PUT ${attendeePath(annId)}`, new TypeError('offline'), json(200, {}));

      const result = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      store.clear();
      wake();

      await expectCancelled(result);
      expect(requests).toHaveLength(2);
      expect(toasts.items).toEqual([]);
      expect(store.facts).toBeNull();
    });

    it('never sends a write queued behind one in flight', async () => {
      const { store, reply, requests } = await loaded();
      const pending = deferred();
      reply(`PUT ${attendeePath(annId)}`, pending.promise);

      const first = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      const second = store.mutate({ kind: 'attendees', id: annId, remove: true });
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      store.clear();
      pending.resolve(json(200, { id: annId, name: 'Annie', version: 3, ...meta }));

      await expect(first).resolves.toMatchObject({ outcome: 'failed' });
      await expectCancelled(second);
      expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    });

    it('does not apply a response that arrives after clear', async () => {
      const { store, reply, requests, toasts } = await loaded();
      const pending = deferred();
      reply(`PUT ${attendeePath(annId)}`, pending.promise);

      const result = store.mutate({ kind: 'attendees', id: annId, fields: { name: 'Annie' } });
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      store.clear();
      // The same holiday, opened again (say, by the next user).
      reply(`GET /holidays/${holidayId}`, json(200, facts()));
      await store.load(holidayId);
      pending.resolve(json(200, { id: annId, name: 'Annie', version: 3, ...meta }));

      await expectCancelled(result);
      expect(store.facts).toEqual(facts());
      expect(toasts.items).toEqual([]);
    });
  });

  it('refuses to mutate with no holiday loaded', async () => {
    const { store } = setup();

    await expect(
      store.mutate({ kind: 'attendees', id: annId, fields: { name: 'A' } })
    ).rejects.toThrow();
  });
});

describe('withRetry', () => {
  it('does not retry errors that are not retryable', async () => {
    const call = vi.fn(() => Promise.reject(new Error('bad')));
    const sleep = vi.fn(() => Promise.resolve());

    await expect(withRetry(call, { sleep })).rejects.toThrow('bad');

    expect(call).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops with CancelledError, before any attempt, once shouldContinue is false', async () => {
    let going = true;
    const call = vi.fn(() => {
      going = false;
      return Promise.reject(new TypeError('offline'));
    });
    const sleep = vi.fn(() => Promise.resolve());

    await expect(withRetry(call, { sleep, shouldContinue: () => going })).rejects.toBeInstanceOf(
      CancelledError
    );

    expect(call).toHaveBeenCalledOnce();
  });
});

describe('HolidayStore.mutate with meals', () => {
  const mealId = '0190a0b0-0000-7000-8000-0000000000c1';
  const mealPath = `/holidays/${holidayId}/meals/${mealId}`;
  const fields = {
    name: '1 Jan Dinner',
    slot: 'dinner' as const,
    recipeId: null,
    mealtimes: [
      { id: '0190a0b0-0000-7000-8000-0000000000d1', at: '2027-01-01T18:30', attendeeIds: [annId] }
    ]
  };
  const storedMeal = (version: number, name = fields.name) => ({
    ...fields,
    name,
    id: mealId,
    version,
    ...meta
  });

  it('creates a meal with version 0, then keeps the stored copy', async () => {
    const { store, reply, requests } = await loaded();
    reply(`PUT ${mealPath}`, json(200, storedMeal(1)));

    const result = store.mutate({ kind: 'meals', id: mealId, fields });
    expect(store.facts?.meals.map((m) => [m.name, m.version])).toEqual([['1 Jan Dinner', 0]]);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(requests[1]).toEqual({ method: 'PUT', path: mealPath, body: { ...fields, version: 0 } });
    expect(store.facts?.meals).toEqual([storedMeal(1)]);
  });

  it('updates a meal at its version', async () => {
    const { store, reply, requests } = await loaded();
    reply(`PUT ${mealPath}`, json(200, storedMeal(1)), json(200, storedMeal(2, 'Feast')));
    await store.mutate({ kind: 'meals', id: mealId, fields });

    await store.mutate({ kind: 'meals', id: mealId, fields: { ...fields, name: 'Feast' } });

    expect(requests[2]?.body).toEqual({ ...fields, name: 'Feast', version: 1 });
    expect(store.facts?.meals).toEqual([storedMeal(2, 'Feast')]);
  });

  it('sends the expected version as given, so a stale copy conflicts', async () => {
    const env = setup();
    env.reply(`GET /holidays/${holidayId}`, json(200, { ...facts(), meals: [storedMeal(3)] }));
    await env.store.load(holidayId);
    const current = storedMeal(3, 'Someone else’s');
    env.reply(
      `PUT ${mealPath}`,
      json(409, { error: { code: 'version-conflict', message: 'x' }, current })
    );

    const result = await env.store.mutate({
      kind: 'meals',
      id: mealId,
      fields: { ...fields, name: 'Mine' },
      expectedVersion: 2
    });

    expect(result).toEqual({ outcome: 'conflict' });
    expect(env.requests[1]?.body).toEqual({ ...fields, name: 'Mine', version: 2 });
    expect(env.store.facts?.meals).toEqual([current]);
    expect(env.toasts.items[0]?.message).toBe(t('mutate.conflict', { item: 'Mine' }));
  });

  it('deletes a meal optimistically', async () => {
    const env = setup();
    env.reply(`GET /holidays/${holidayId}`, json(200, { ...facts(), meals: [storedMeal(1)] }));
    await env.store.load(holidayId);
    env.reply(`DELETE ${mealPath}`, new Response(null, { status: 204 }));

    const result = env.store.mutate({ kind: 'meals', id: mealId, remove: true });
    expect(env.store.facts?.meals).toEqual([]);

    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(env.requests[1]).toMatchObject({ method: 'DELETE', path: mealPath });
  });

  it('names a meal by a generic label when it has no name', () => {
    expect(t('mutate.items.meals')).toBe('a meal');
  });
});
