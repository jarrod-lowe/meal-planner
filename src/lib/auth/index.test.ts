import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUsers } from './fake.js';

vi.mock('./amplify.js', () => ({
  createAmplifyAuthClient: vi.fn(() => ({ kind: 'amplify' }))
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getAuthClient', () => {
  it('uses the fake client in e2e mode', async () => {
    vi.stubEnv('MODE', 'e2e');
    const { getAuthClient } = await import('./index.js');
    const client = await getAuthClient();
    const { email, password } = fakeUsers.normal;
    expect(await client.signIn(email, password)).toEqual({ ok: true, step: 'signedIn' });
  });

  it('uses Amplify with the user pool from the env otherwise', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_USER_POOL_ID', 'ap-southeast-2_pool');
    vi.stubEnv('VITE_USER_POOL_CLIENT_ID', 'client');
    const { getAuthClient } = await import('./index.js');
    const { createAmplifyAuthClient } = await import('./amplify.js');
    expect(await getAuthClient()).toEqual({ kind: 'amplify' });
    expect(createAmplifyAuthClient).toHaveBeenCalledWith({
      userPoolId: 'ap-southeast-2_pool',
      userPoolClientId: 'client'
    });
  });

  it('returns the same client each time', async () => {
    vi.stubEnv('MODE', 'e2e');
    const { getAuthClient } = await import('./index.js');
    expect(await getAuthClient()).toBe(await getAuthClient());
  });
});
