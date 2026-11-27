import { describe, expect, it } from 'vitest';
import { createFakeAuthClient, fakeResetCode, fakeUsers } from './fake.js';

const { normal, firstLogin } = fakeUsers;
const newPassword = 'a brand new password';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key)
  };
}

describe('createFakeAuthClient', () => {
  it('signs in a seeded user and reports them', async () => {
    const client = createFakeAuthClient();
    expect(await client.currentUser()).toBeNull();
    expect(await client.signIn(normal.email, normal.password)).toEqual({
      ok: true,
      step: 'signedIn'
    });
    expect(await client.currentUser()).toEqual({
      sub: normal.sub,
      name: normal.name,
      email: normal.email
    });
    expect(await client.idToken()).toMatch(/^fake\./);
  });

  it('rejects a wrong password or unknown user', async () => {
    const client = createFakeAuthClient();
    expect(await client.signIn(normal.email, 'wrong')).toEqual({
      ok: false,
      error: 'invalidCredentials'
    });
    expect(await client.signIn('nobody@example.com', 'x')).toEqual({
      ok: false,
      error: 'invalidCredentials'
    });
  });

  it('asks a first-login user for a new password, enforcing 12 characters', async () => {
    const client = createFakeAuthClient();
    expect(await client.signIn(firstLogin.email, firstLogin.password)).toEqual({
      ok: true,
      step: 'newPasswordRequired'
    });
    expect(await client.currentUser()).toBeNull();
    expect(await client.confirmNewPassword('short')).toEqual({
      ok: false,
      error: 'passwordPolicy'
    });
    expect(await client.confirmNewPassword(newPassword)).toEqual({ ok: true, step: 'signedIn' });
    expect((await client.currentUser())?.email).toBe(firstLogin.email);

    await client.signOut();
    expect(await client.signIn(firstLogin.email, newPassword)).toEqual({
      ok: true,
      step: 'signedIn'
    });
  });

  it('rejects confirmNewPassword with no pending challenge', async () => {
    const client = createFakeAuthClient();
    expect(await client.confirmNewPassword(newPassword)).toEqual({ ok: false, error: 'unknown' });
  });

  it('resets a password with the fixed code', async () => {
    const client = createFakeAuthClient();
    expect(await client.requestPasswordReset(normal.email)).toEqual({
      ok: true,
      step: 'resetCodeSent'
    });
    expect(await client.confirmPasswordReset(normal.email, '000000', newPassword)).toEqual({
      ok: false,
      error: 'invalidCode'
    });
    expect(await client.confirmPasswordReset(normal.email, fakeResetCode, 'short')).toEqual({
      ok: false,
      error: 'passwordPolicy'
    });
    expect(await client.confirmPasswordReset(normal.email, fakeResetCode, newPassword)).toEqual({
      ok: true,
      step: 'passwordReset'
    });
    expect(await client.signIn(normal.email, newPassword)).toEqual({ ok: true, step: 'signedIn' });
  });

  it("doesn't reveal unknown emails when requesting a reset", async () => {
    const client = createFakeAuthClient();
    expect(await client.requestPasswordReset('nobody@example.com')).toEqual({
      ok: true,
      step: 'resetCodeSent'
    });
    expect(
      await client.confirmPasswordReset('nobody@example.com', fakeResetCode, newPassword)
    ).toEqual({
      ok: false,
      error: 'invalidCode'
    });
  });

  it('signs out', async () => {
    const client = createFakeAuthClient();
    await client.signIn(normal.email, normal.password);
    await client.signOut();
    expect(await client.currentUser()).toBeNull();
    expect(await client.idToken()).toBeNull();
  });

  it('keeps the session in the given storage, like Amplify does across reloads', async () => {
    const storage = memoryStorage();
    await createFakeAuthClient({ storage }).signIn(normal.email, normal.password);
    expect((await createFakeAuthClient({ storage }).currentUser())?.email).toBe(normal.email);
  });
});
