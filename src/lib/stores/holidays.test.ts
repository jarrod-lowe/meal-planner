import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type Schemas } from '#lib/api/client.js';
import { MyHolidays } from './holidays.svelte.js';

type Holiday = Schemas['Holiday'];

const id = '0190a0b0-0000-7000-8000-000000000001';
const fields = {
  name: 'Summer',
  timeZone: 'Pacific/Auckland',
  startDate: '2026-12-26',
  endDate: '2027-01-02'
};
const stored: Holiday = {
  id,
  ...fields,
  version: 1,
  updatedAt: '2026-11-28T00:00:00Z',
  updatedBy: 'sub-1'
};
const later: Holiday = {
  ...stored,
  id: '0190a0b0-0000-7000-8000-000000000002',
  name: 'Easter',
  startDate: '2027-03-26',
  endDate: '2027-03-29'
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string) => json(status, { error: { code, message: code } });

type Reply = Response | Error;

function setup() {
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
  const store = new MyHolidays({
    api: createApiClient({ fetch, token: () => Promise.resolve('token') }),
    sleep: () => Promise.resolve()
  });
  return { store, reply, requests };
}

describe('MyHolidays', () => {
  it('loads GET /holidays, sorted by start date', async () => {
    const { store, reply } = setup();
    reply('GET /holidays', json(200, { holidays: [later, stored] }));
    expect(store.status).toBe('idle');

    const loading = store.load();
    expect(store.status).toBe('loading');
    await loading;

    expect(store.status).toBe('ready');
    expect(store.list.map((holiday) => holiday.name)).toEqual(['Summer', 'Easter']);
  });

  it('records a failed load', async () => {
    const { store, reply } = setup();
    reply('GET /holidays', error(400, 'validation'));

    await store.load();

    expect(store.status).toBe('error');
    expect(store.error).toBeInstanceOf(ApiError);
  });

  it('creates with PUT and version 0, and adds the stored holiday to the list', async () => {
    const { store, reply, requests } = setup();
    reply(`PUT /holidays/${id}`, json(200, stored));

    const created = await store.create(id, fields);

    expect(created).toEqual(stored);
    expect(requests).toEqual([
      { method: 'PUT', path: `/holidays/${id}`, body: { ...fields, version: 0 } }
    ]);
    expect(store.list).toEqual([stored]);
  });

  it('retries a create after a network error', async () => {
    const { store, reply } = setup();
    reply(`PUT /holidays/${id}`, new TypeError('offline'), json(200, stored));

    await expect(store.create(id, fields)).resolves.toEqual(stored);
  });

  it('treats already-exists as success when the stored holiday matches (§5.3)', async () => {
    const { store, reply } = setup();
    reply(`PUT /holidays/${id}`, error(409, 'already-exists'));
    reply(
      `GET /holidays/${id}`,
      json(200, {
        holiday: stored,
        attendees: [],
        meals: [],
        trips: [],
        stockChanges: [],
        members: []
      })
    );

    await expect(store.create(id, fields)).resolves.toEqual(stored);
  });

  it('rejects already-exists when the stored holiday differs', async () => {
    const { store, reply } = setup();
    reply(`PUT /holidays/${id}`, error(409, 'already-exists'));
    reply(
      `GET /holidays/${id}`,
      json(200, {
        holiday: { ...stored, name: 'Other' },
        attendees: [],
        meals: [],
        trips: [],
        stockChanges: [],
        members: []
      })
    );

    await expect(store.create(id, fields)).rejects.toMatchObject({ code: 'already-exists' });
    expect(store.list).toEqual([]);
  });

  it('rejects other errors without retrying', async () => {
    const { store, reply, requests } = setup();
    reply(`PUT /holidays/${id}`, error(400, 'validation'));

    await expect(store.create(id, fields)).rejects.toMatchObject({ code: 'validation' });
    expect(requests).toHaveLength(1);
  });

  it('forgets the list on clear', async () => {
    const { store, reply } = setup();
    reply('GET /holidays', json(200, { holidays: [stored] }));
    await store.load();

    store.clear();

    expect(store.list).toEqual([]);
    expect(store.status).toBe('idle');
  });
});
