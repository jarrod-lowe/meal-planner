// In-memory `AuthClient` for Playwright, loaded only in Vite's `e2e` mode
// (see index.ts), so it never ships in a production bundle.
import type { AuthClient, AuthUser } from './client.js';

interface SeededUser extends AuthUser {
  readonly password: string;
  /** Like an admin-created Cognito user: must set a password first. */
  readonly mustChangePassword: boolean;
}

export const fakeUsers = {
  normal: {
    sub: 'fake-sub-normal',
    name: 'Sam Example',
    email: 'sam@example.com',
    password: 'fake-e2e-sam-password',
    mustChangePassword: false
  },
  firstLogin: {
    sub: 'fake-sub-first-login',
    name: 'Nova Newcomer',
    email: 'nova@example.com',
    password: 'fake-e2e-temporary-password',
    mustChangePassword: true
  }
} as const satisfies Record<string, SeededUser>;

/** The reset code the fake "emails" to every user. */
export const fakeResetCode = '123456';

/** Same minimum as the Cognito pool's password policy. */
const minPasswordLength = 12;

const sessionKey = 'meal-planner.fake-auth.email';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createFakeAuthClient(options: { storage?: SessionStorage } = {}): AuthClient {
  const { storage } = options;
  const users = new Map<string, SeededUser>(
    Object.values(fakeUsers).map((user) => [user.email, { ...user }])
  );
  let signedIn: string | null = storage?.getItem(sessionKey) ?? null;
  let pendingNewPassword: string | null = null;

  function setSignedIn(email: string | null) {
    signedIn = email;
    if (email) storage?.setItem(sessionKey, email);
    else storage?.removeItem(sessionKey);
  }

  const current = () => (signedIn ? users.get(signedIn) : undefined);

  return {
    signIn(email, password) {
      const user = users.get(email);
      if (!user || user.password !== password) {
        return Promise.resolve({ ok: false, error: 'invalidCredentials' });
      }
      if (user.mustChangePassword) {
        pendingNewPassword = email;
        return Promise.resolve({ ok: true, step: 'newPasswordRequired' });
      }
      setSignedIn(email);
      return Promise.resolve({ ok: true, step: 'signedIn' });
    },

    confirmNewPassword(newPassword) {
      const user = pendingNewPassword ? users.get(pendingNewPassword) : undefined;
      if (!user) return Promise.resolve({ ok: false, error: 'unknown' });
      if (newPassword.length < minPasswordLength) {
        return Promise.resolve({ ok: false, error: 'passwordPolicy' });
      }
      users.set(user.email, { ...user, password: newPassword, mustChangePassword: false });
      pendingNewPassword = null;
      setSignedIn(user.email);
      return Promise.resolve({ ok: true, step: 'signedIn' });
    },

    requestPasswordReset() {
      // Like Cognito with user-existence errors off: always "sent".
      return Promise.resolve({ ok: true, step: 'resetCodeSent' });
    },

    confirmPasswordReset(email, code, newPassword) {
      const user = users.get(email);
      if (!user || code !== fakeResetCode)
        return Promise.resolve({ ok: false, error: 'invalidCode' });
      if (newPassword.length < minPasswordLength) {
        return Promise.resolve({ ok: false, error: 'passwordPolicy' });
      }
      users.set(email, { ...user, password: newPassword, mustChangePassword: false });
      return Promise.resolve({ ok: true, step: 'passwordReset' });
    },

    currentUser() {
      const user = current();
      return Promise.resolve(user ? { sub: user.sub, name: user.name, email: user.email } : null);
    },

    idToken() {
      const user = current();
      return Promise.resolve(user ? `fake.${user.sub}.token` : null);
    },

    signOut() {
      setSignedIn(null);
      pendingNewPassword = null;
      return Promise.resolve();
    }
  };
}
