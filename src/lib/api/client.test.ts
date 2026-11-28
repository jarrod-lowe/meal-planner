import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, createApiClient, isRetryable, type Schemas } from './client.js';

const holidayId = '0190a0b0-0000-7000-8000-000000000001';
const attendeeId = '0190a0b0-0000-7000-8000-000000000002';

const holiday: Schemas['Holiday'] = {
  id: holidayId,
  name: 'Summer',
  timeZone: 'Pacific/Auckland',
  startDate: '2026-12-26',
  endDate: '2027-01-02',
  version: 1,
  updatedAt: '2026-11-28T00:00:00Z',
  updatedBy: 'sub-1'
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function clientWith(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  token: string | null = 'id-token'
) {
  const fetch = vi.fn((url: string, init: RequestInit) => Promise.resolve(respond(url, init)));
  const client = createApiClient({ fetch, token: () => Promise.resolve(token) });
  return { client, fetch };
}

function sent(fetch: ReturnType<typeof clientWith>['fetch'], call = 0) {
  const [url, init] = fetch.mock.calls[call] ?? [];
  return { url, init: init ?? {}, headers: new Headers(init?.headers) };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

describe('createApiClient', () => {
  it('GETs under /api with the raw ID token and parses the JSON', async () => {
    const { client, fetch } = clientWith(() => json(200, { holidays: [holiday] }));

    await expect(client.get('/holidays')).resolves.toEqual({ holidays: [holiday] });

    const { url, init, headers } = sent(fetch);
    expect(url).toBe('/api/holidays');
    expect(init.method).toBe('GET');
    expect(headers.get('Authorization')).toBe('id-token');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('fills in and encodes path parameters', async () => {
    const { client, fetch } = clientWith(() => json(200, {}));

    await client.get('/holidays/{holidayId}', { holidayId: 'a/b c' });

    expect(sent(fetch).url).toBe('/api/holidays/a%2Fb%20c');
  });

  it('PUTs a JSON body and returns the stored item', async () => {
    const stored = { id: attendeeId, name: 'Ann', version: 1, updatedAt: 'x', updatedBy: 'y' };
    const { client, fetch } = clientWith(() => json(200, stored));

    const result = await client.put(
      '/holidays/{holidayId}/attendees/{id}',
      { holidayId, id: attendeeId },
      { name: 'Ann', version: 0 }
    );

    expect(result).toEqual(stored);
    const { url, init, headers } = sent(fetch);
    expect(url).toBe(`/api/holidays/${holidayId}/attendees/${attendeeId}`);
    expect(init.method).toBe('PUT');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('id-token');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Ann', version: 0 });
  });

  it('DELETEs and resolves on 204', async () => {
    const { client, fetch } = clientWith(() => new Response(null, { status: 204 }));

    await expect(
      client.del('/holidays/{holidayId}/attendees/{id}', { holidayId, id: attendeeId })
    ).resolves.toBeUndefined();

    expect(sent(fetch).init.method).toBe('DELETE');
  });

  it.each([
    [400, 'validation'],
    [403, 'not-a-member'],
    [404, 'not-found'],
    [409, 'already-exists'],
    [409, 'last-member'],
    [500, 'internal'],
    [401, 'unauthorized']
  ] as const)('parses a %i %s error', async (status, code) => {
    const { client } = clientWith(() => json(status, { error: { code, message: `msg ${code}` } }));

    const error = await failure(client.get('/holidays'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, message: `msg ${code}` });
    expect((error as ApiError).current).toBeUndefined();
  });

  it('keeps the current item on a version conflict', async () => {
    const { client } = clientWith(() =>
      json(409, { error: { code: 'version-conflict', message: 'changed' }, current: holiday })
    );

    const error = await failure(client.get('/holidays'));

    expect(error).toMatchObject({ status: 409, code: 'version-conflict', current: holiday });
  });

  it('keeps a null current item (deleted) on a version conflict', async () => {
    const { client } = clientWith(() =>
      json(409, { error: { code: 'version-conflict', message: 'gone' }, current: null })
    );

    const error = (await failure(client.get('/holidays'))) as ApiError;

    expect(error.code).toBe('version-conflict');
    expect(error.current).toBeNull();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden']
  ] as const)("maps API Gateway's own %i body to %s", async (status, code) => {
    const { client } = clientWith(() => json(status, { message: 'Unauthorized' }));

    const error = await failure(client.get('/holidays'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, message: 'Unauthorized' });
  });

  it.each([
    [502, 'internal'],
    [418, 'unknown']
  ] as const)('maps a %i with a non-JSON body to %s', async (status, code) => {
    const { client } = clientWith(() => new Response('<html>Bad gateway</html>', { status }));

    const error = await failure(client.get('/holidays'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  });

  it('throws a NetworkError when fetch rejects', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = await failure(client.get('/holidays'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('throws a NetworkError when a success body is not JSON', async () => {
    const { client } = clientWith(() => new Response('truncated{', { status: 200 }));

    expect(await failure(client.get('/holidays'))).toBeInstanceOf(NetworkError);
  });

  it('fails as unauthorized without calling fetch when there is no token', async () => {
    const { client, fetch } = clientWith(() => json(200, {}), null);

    const error = await failure(client.get('/holidays'));

    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('ApiClient types', () => {
  it('rejects unknown paths, missing params and wrong bodies at compile time', () => {
    const { client } = clientWith(() => json(200, {}));
    const typeChecksOnly = () => {
      // @ts-expect-error: no such route
      void client.get('/nope');
      // @ts-expect-error: holidayId is required
      void client.get('/holidays/{holidayId}');
      // @ts-expect-error: /users has no PUT
      void client.put('/users', {}, {});
      const params = { holidayId, id: 'x' };
      // @ts-expect-error: an attendee needs a name
      void client.put('/holidays/{holidayId}/attendees/{id}', params, { version: 0 });
    };
    expect(typeChecksOnly).toBeTypeOf('function');
  });
});

describe('isRetryable', () => {
  it.each([
    [new NetworkError(new TypeError('x')), true],
    [new ApiError(500, 'internal', 'x'), true],
    [new ApiError(503, 'unknown', 'x'), true],
    [new ApiError(400, 'validation', 'x'), false],
    [new ApiError(409, 'version-conflict', 'x'), false],
    [new Error('x'), false]
  ])('%o is retryable: %s', (error, expected) => {
    expect(isRetryable(error)).toBe(expected);
  });
});
