import { describe, expect, it, vi } from 'vitest';
import { NetworkError, type Schemas } from '#lib/api/client.js';
import { Users } from './users.svelte.js';

const list: Schemas['User'][] = [
  { sub: 'sub-1', name: 'Ann' },
  { sub: 'sub-2', name: 'Bob' }
];

function usersWith(get: () => Promise<Schemas['UserList']>) {
  const api = { get: vi.fn(get) };
  return { users: new Users(api), api };
}

describe('Users', () => {
  it('starts empty, then loads GET /users', async () => {
    const { users, api } = usersWith(() => Promise.resolve({ users: list }));
    expect(users.list).toEqual([]);
    expect(users.loaded).toBe(false);

    await users.load();

    expect(api.get).toHaveBeenCalledWith('/users');
    expect(users.list).toEqual(list);
    expect(users.loaded).toBe(true);
  });

  it('fetches once for the session, sharing the in-flight request', async () => {
    const { users, api } = usersWith(() => Promise.resolve({ users: list }));

    await Promise.all([users.load(), users.load()]);
    await users.load();

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('looks up names by sub', async () => {
    const { users } = usersWith(() => Promise.resolve({ users: list }));
    await users.load();

    expect(users.nameOf('sub-2')).toBe('Bob');
    expect(users.nameOf('sub-9')).toBeUndefined();
  });

  it('rejects on failure and fetches again next time', async () => {
    const get = vi
      .fn<() => Promise<Schemas['UserList']>>()
      .mockRejectedValueOnce(new NetworkError(new TypeError('offline')))
      .mockResolvedValueOnce({ users: list });
    const { users } = usersWith(get);

    await expect(users.load()).rejects.toBeInstanceOf(NetworkError);
    expect(users.loaded).toBe(false);
    await users.load();

    expect(get).toHaveBeenCalledTimes(2);
    expect(users.nameOf('sub-1')).toBe('Ann');
  });

  it('forgets the list on clear, and fetches again', async () => {
    const { users, api } = usersWith(() => Promise.resolve({ users: list }));
    await users.load();

    users.clear();
    expect(users.list).toEqual([]);
    expect(users.loaded).toBe(false);
    await users.load();

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('ignores a response that lands after clear', async () => {
    let resolve: (value: Schemas['UserList']) => void = () => undefined;
    const { users } = usersWith(() => new Promise((r) => (resolve = r)));

    const loading = users.load();
    users.clear();
    resolve({ users: list });
    await loading;

    expect(users.list).toEqual([]);
    expect(users.loaded).toBe(false);
  });
});
