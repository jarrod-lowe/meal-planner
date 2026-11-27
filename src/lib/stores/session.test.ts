import { describe, expect, it } from 'vitest';
import type { AuthClient } from '#lib/auth/client.js';
import { createFakeAuthClient, fakeResetCode, fakeUsers } from '#lib/auth/fake.js';
import { safeNext } from './safe-next.js';
import { Session } from './session.svelte.js';

const { normal, firstLogin } = fakeUsers;
const newPassword = 'a brand new password';

function sessionWith(client: AuthClient = createFakeAuthClient()) {
  return new Session(() => Promise.resolve(client));
}

describe('safeNext', () => {
  it.each([
    ['/', '/'],
    ['/holidays/abc', '/holidays/abc'],
    ['/holidays/abc/plan?day=2#dinner', '/holidays/abc/plan?day=2#dinner'],
    ['/recipes?q=a//b', '/recipes?q=a//b']
  ])('allows the same-origin path %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['holidays'],
    ['//evil.com'],
    ['//evil.com/path'],
    ['///evil.com'],
    ['/\\evil.com'],
    ['\\\\evil.com'],
    ['/holidays\\..\\x'],
    ['https://evil.com'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    [' /holidays'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/login'],
    ['/login?next=%2F'],
    ['/login/']
  ])('falls back to / for %j', (next) => {
    expect(safeNext(next)).toBe('/');
  });
});

describe('Session', () => {
  it('starts loading, then is signed out with no session', async () => {
    const session = sessionWith();
    expect(session.status).toBe('loading');
    await session.load();
    expect(session.status).toBe('signedOut');
    expect(session.user).toBeNull();
    expect(session.step).toBe('signIn');
  });

  it('loads an existing session as signed in', async () => {
    const client = createFakeAuthClient();
    await client.signIn(normal.email, normal.password);
    const session = sessionWith(client);
    await session.load();
    expect(session.status).toBe('signedIn');
    expect(session.user?.name).toBe(normal.name);
  });

  it('signs in', async () => {
    const session = sessionWith();
    await session.load();
    const signingIn = session.signIn(normal.email, normal.password);
    expect(session.pending).toBe(true);
    await signingIn;
    expect(session.pending).toBe(false);
    expect(session.status).toBe('signedIn');
    expect(session.user?.email).toBe(normal.email);
    expect(session.error).toBeNull();
  });

  it('shows an error on a wrong password and clears it on the next attempt', async () => {
    const session = sessionWith();
    await session.load();
    await session.signIn(normal.email, 'wrong');
    expect(session.status).toBe('signedOut');
    expect(session.step).toBe('signIn');
    expect(session.error).toBe('invalidCredentials');

    const retry = session.signIn(normal.email, normal.password);
    expect(session.error).toBeNull();
    await retry;
    expect(session.status).toBe('signedIn');
  });

  it('moves to the new-password step on first login, then signs in', async () => {
    const session = sessionWith();
    await session.load();
    await session.signIn(firstLogin.email, firstLogin.password);
    expect(session.step).toBe('newPassword');
    expect(session.status).toBe('signedOut');

    await session.confirmNewPassword('short');
    expect(session.step).toBe('newPassword');
    expect(session.error).toBe('passwordPolicy');

    await session.confirmNewPassword(newPassword);
    expect(session.status).toBe('signedIn');
    expect(session.user?.name).toBe(firstLogin.name);
  });

  it('runs the forgot-password flow and returns to sign-in', async () => {
    const session = sessionWith();
    await session.load();
    session.forgotPassword();
    expect(session.step).toBe('forgotPassword');

    await session.requestPasswordReset(normal.email);
    expect(session.step).toBe('resetCode');
    expect(session.resetEmail).toBe(normal.email);

    await session.confirmPasswordReset('000000', newPassword);
    expect(session.step).toBe('resetCode');
    expect(session.error).toBe('invalidCode');

    await session.confirmPasswordReset(fakeResetCode, newPassword);
    expect(session.step).toBe('resetDone');
    expect(session.error).toBeNull();

    session.backToSignIn();
    expect(session.step).toBe('signIn');
    await session.signIn(normal.email, newPassword);
    expect(session.status).toBe('signedIn');
  });

  it('goes to the reset-code step when sign-in requires a reset', async () => {
    const client: AuthClient = {
      ...createFakeAuthClient(),
      signIn: () => Promise.resolve({ ok: true, step: 'resetCodeSent' })
    };
    const session = sessionWith(client);
    await session.load();
    await session.signIn(normal.email, 'whatever');
    expect(session.step).toBe('resetCode');
    expect(session.resetEmail).toBe(normal.email);
  });

  it('clears the error when changing step', async () => {
    const session = sessionWith();
    await session.load();
    await session.signIn(normal.email, 'wrong');
    session.forgotPassword();
    expect(session.error).toBeNull();
  });

  it('signs out and resets the login flow', async () => {
    const session = sessionWith();
    await session.load();
    await session.signIn(normal.email, normal.password);
    await session.signOut();
    expect(session.status).toBe('signedOut');
    expect(session.user).toBeNull();
    expect(session.step).toBe('signIn');
  });

  it('treats a signed-in result with no readable user as an error', async () => {
    const client: AuthClient = {
      ...createFakeAuthClient(),
      signIn: () => Promise.resolve({ ok: true, step: 'signedIn' }),
      currentUser: () => Promise.resolve(null)
    };
    const session = sessionWith(client);
    await session.load();
    await session.signIn(normal.email, normal.password);
    expect(session.status).toBe('signedOut');
    expect(session.error).toBe('unknown');
  });
});
