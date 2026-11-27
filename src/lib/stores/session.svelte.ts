// The current user and the login flow (DESIGN §7.3, §7.5).
import { getAuthClient } from '#lib/auth/index.js';
import type {
  AuthClient,
  AuthErrorCode,
  AuthResult,
  AuthStep,
  AuthUser
} from '#lib/auth/client.js';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

/** The step the login page shows. */
export type LoginStep = 'signIn' | 'newPassword' | 'forgotPassword' | 'resetCode' | 'resetDone';

export class Session {
  status = $state<SessionStatus>('loading');
  user = $state.raw<AuthUser | null>(null);
  step = $state<LoginStep>('signIn');
  error = $state<AuthErrorCode | null>(null);
  pending = $state(false);
  /** The email the reset code was sent to. */
  resetEmail = $state('');

  readonly #client: () => Promise<AuthClient>;
  #loading: Promise<void> | undefined;

  constructor(client: () => Promise<AuthClient>) {
    this.#client = client;
  }

  /** Resolves the existing session, once. */
  load(): Promise<void> {
    this.#loading ??= this.#refreshUser().then(
      () => undefined,
      () => {
        this.user = null;
        this.status = 'signedOut';
      }
    );
    return this.#loading;
  }

  signIn(email: string, password: string) {
    return this.#run(async (client) => {
      const result = await client.signIn(email, password);
      if (result.ok && result.step === 'resetCodeSent') this.resetEmail = email;
      return result;
    });
  }

  confirmNewPassword(newPassword: string) {
    return this.#run((client) => client.confirmNewPassword(newPassword));
  }

  forgotPassword() {
    this.#goTo('forgotPassword');
  }

  requestPasswordReset(email: string) {
    return this.#run(async (client) => {
      const result = await client.requestPasswordReset(email);
      if (result.ok) this.resetEmail = email;
      return result;
    });
  }

  confirmPasswordReset(code: string, newPassword: string) {
    return this.#run((client) => client.confirmPasswordReset(this.resetEmail, code, newPassword));
  }

  backToSignIn() {
    this.#goTo('signIn');
  }

  async signOut() {
    const client = await this.#client();
    await client.signOut();
    this.user = null;
    this.status = 'signedOut';
    this.resetEmail = '';
    this.#goTo('signIn');
  }

  #goTo(step: LoginStep) {
    this.step = step;
    this.error = null;
  }

  async #refreshUser(): Promise<boolean> {
    const user = await (await this.#client()).currentUser();
    this.user = user;
    this.status = user ? 'signedIn' : 'signedOut';
    return user !== null;
  }

  /** Runs one login-flow call, tracking `pending` and moving to the result's step. */
  async #run(call: (client: AuthClient) => Promise<AuthResult>) {
    this.pending = true;
    this.error = null;
    try {
      const result = await call(await this.#client());
      if (!result.ok) {
        this.error = result.error;
        return;
      }
      await this.#onStep(result.step);
    } catch {
      this.error = 'unknown';
    } finally {
      this.pending = false;
    }
  }

  async #onStep(step: AuthStep) {
    switch (step) {
      case 'signedIn':
        if (await this.#refreshUser()) this.#goTo('signIn');
        else this.error = 'unknown';
        return;
      case 'newPasswordRequired':
        return this.#goTo('newPassword');
      case 'resetCodeSent':
        return this.#goTo('resetCode');
      case 'passwordReset':
        return this.#goTo('resetDone');
    }
  }
}

export const session = new Session(getAuthClient);
