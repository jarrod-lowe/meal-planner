import { beforeEach, describe, expect, it, vi } from 'vitest';

const { configure } = vi.hoisted(() => ({ configure: vi.fn() }));
vi.mock('aws-amplify', () => ({ Amplify: { configure } }));
vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  fetchAuthSession: vi.fn(),
  signOut: vi.fn()
}));

const auth = await import('aws-amplify/auth');
const { createAmplifyAuthClient } = await import('./amplify.js');

const config = { userPoolId: 'ap-southeast-2_abc', userPoolClientId: 'client123' };

function cognitoError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

const signInStep = (step: string) => ({
  isSignedIn: step === 'DONE',
  nextStep: { signInStep: step }
});

describe('createAmplifyAuthClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('configures Amplify with the user pool', () => {
    createAmplifyAuthClient(config);
    expect(configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId }
      }
    });
  });

  describe('signIn', () => {
    it('signs in with the email as username (SRP default)', async () => {
      vi.mocked(auth.signIn).mockResolvedValue(signInStep('DONE') as never);
      const client = createAmplifyAuthClient(config);

      await expect(client.signIn('sam@example.com', 'pw')).resolves.toEqual({
        ok: true,
        step: 'signedIn'
      });
      expect(auth.signIn).toHaveBeenCalledWith({ username: 'sam@example.com', password: 'pw' });
    });

    it('maps the new-password challenge to newPasswordRequired', async () => {
      vi.mocked(auth.signIn).mockResolvedValue(
        signInStep('CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') as never
      );
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: true, step: 'newPasswordRequired' });
    });

    it('maps RESET_PASSWORD to resetCodeSent after requesting a code', async () => {
      vi.mocked(auth.signIn).mockResolvedValue(signInStep('RESET_PASSWORD') as never);
      vi.mocked(auth.resetPassword).mockResolvedValue({
        isPasswordReset: false,
        nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE', codeDeliveryDetails: {} }
      });
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: true, step: 'resetCodeSent' });
      expect(auth.resetPassword).toHaveBeenCalledWith({ username: 'a@b.c' });
    });

    it.each([
      'CONFIRM_SIGN_IN_WITH_TOTP_CODE',
      'CONFIRM_SIGN_IN_WITH_SMS_CODE',
      'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE',
      'CONTINUE_SIGN_IN_WITH_MFA_SELECTION',
      'CONFIRM_SIGN_UP'
    ])('returns an unsupported error for %s', async (step) => {
      vi.mocked(auth.signIn).mockResolvedValue(signInStep(step) as never);
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: false, error: 'unsupported' });
    });

    it.each([
      ['NotAuthorizedException', 'invalidCredentials'],
      ['UserNotFoundException', 'invalidCredentials'],
      ['InvalidPasswordException', 'passwordPolicy'],
      ['CodeMismatchException', 'invalidCode'],
      ['ExpiredCodeException', 'invalidCode'],
      ['LimitExceededException', 'tooManyAttempts'],
      ['TooManyRequestsException', 'tooManyAttempts'],
      ['SomethingElseException', 'unknown']
    ])('maps %s to %s', async (name, error) => {
      vi.mocked(auth.signIn).mockRejectedValue(cognitoError(name));
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: false, error });
    });

    it('maps a non-Error rejection to unknown', async () => {
      vi.mocked(auth.signIn).mockRejectedValue('boom');
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: false, error: 'unknown' });
    });

    it('treats an already signed-in user as signed in', async () => {
      vi.mocked(auth.signIn).mockRejectedValue(cognitoError('UserAlreadyAuthenticatedException'));
      const result = await createAmplifyAuthClient(config).signIn('a@b.c', 'pw');
      expect(result).toEqual({ ok: true, step: 'signedIn' });
    });
  });

  describe('confirmNewPassword', () => {
    it('sends the new password as the challenge response', async () => {
      vi.mocked(auth.confirmSignIn).mockResolvedValue(signInStep('DONE') as never);
      const result = await createAmplifyAuthClient(config).confirmNewPassword('new password!');
      expect(result).toEqual({ ok: true, step: 'signedIn' });
      expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'new password!' });
    });

    it('maps a password policy failure', async () => {
      vi.mocked(auth.confirmSignIn).mockRejectedValue(cognitoError('InvalidPasswordException'));
      const result = await createAmplifyAuthClient(config).confirmNewPassword('short');
      expect(result).toEqual({ ok: false, error: 'passwordPolicy' });
    });

    it('returns unsupported for an MFA step after the new password', async () => {
      vi.mocked(auth.confirmSignIn).mockResolvedValue(
        signInStep('CONTINUE_SIGN_IN_WITH_TOTP_SETUP') as never
      );
      const result = await createAmplifyAuthClient(config).confirmNewPassword('new password!');
      expect(result).toEqual({ ok: false, error: 'unsupported' });
    });
  });

  describe('requestPasswordReset', () => {
    it('maps CONFIRM_RESET_PASSWORD_WITH_CODE to resetCodeSent', async () => {
      vi.mocked(auth.resetPassword).mockResolvedValue({
        isPasswordReset: false,
        nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE', codeDeliveryDetails: {} }
      });
      const result = await createAmplifyAuthClient(config).requestPasswordReset('a@b.c');
      expect(result).toEqual({ ok: true, step: 'resetCodeSent' });
      expect(auth.resetPassword).toHaveBeenCalledWith({ username: 'a@b.c' });
    });

    it('maps DONE to passwordReset', async () => {
      vi.mocked(auth.resetPassword).mockResolvedValue({
        isPasswordReset: true,
        nextStep: { resetPasswordStep: 'DONE', codeDeliveryDetails: {} }
      });
      const result = await createAmplifyAuthClient(config).requestPasswordReset('a@b.c');
      expect(result).toEqual({ ok: true, step: 'passwordReset' });
    });

    it('maps LimitExceededException to tooManyAttempts', async () => {
      vi.mocked(auth.resetPassword).mockRejectedValue(cognitoError('LimitExceededException'));
      const result = await createAmplifyAuthClient(config).requestPasswordReset('a@b.c');
      expect(result).toEqual({ ok: false, error: 'tooManyAttempts' });
    });
  });

  describe('confirmPasswordReset', () => {
    it('confirms with the code and new password', async () => {
      vi.mocked(auth.confirmResetPassword).mockResolvedValue(undefined);
      const result = await createAmplifyAuthClient(config).confirmPasswordReset(
        'a@b.c',
        '123456',
        'new password!'
      );
      expect(result).toEqual({ ok: true, step: 'passwordReset' });
      expect(auth.confirmResetPassword).toHaveBeenCalledWith({
        username: 'a@b.c',
        confirmationCode: '123456',
        newPassword: 'new password!'
      });
    });

    it('maps CodeMismatchException to invalidCode', async () => {
      vi.mocked(auth.confirmResetPassword).mockRejectedValue(cognitoError('CodeMismatchException'));
      const result = await createAmplifyAuthClient(config).confirmPasswordReset('a@b.c', '1', 'x');
      expect(result).toEqual({ ok: false, error: 'invalidCode' });
    });
  });

  describe('session', () => {
    const idToken = {
      payload: { sub: 'user-1', name: 'Sam', email: 'sam@example.com' },
      toString: () => 'id.jwt.token'
    };

    it('reads the current user from the ID token claims', async () => {
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({ tokens: { idToken } } as never);
      await expect(createAmplifyAuthClient(config).currentUser()).resolves.toEqual({
        sub: 'user-1',
        name: 'Sam',
        email: 'sam@example.com'
      });
    });

    it('returns the ID token string', async () => {
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({ tokens: { idToken } } as never);
      await expect(createAmplifyAuthClient(config).idToken()).resolves.toBe('id.jwt.token');
    });

    it('returns null when signed out', async () => {
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({});
      const client = createAmplifyAuthClient(config);
      await expect(client.currentUser()).resolves.toBeNull();
      await expect(client.idToken()).resolves.toBeNull();
    });

    it('returns null when the session cannot be fetched', async () => {
      vi.mocked(auth.fetchAuthSession).mockRejectedValue(cognitoError('NetworkError'));
      const client = createAmplifyAuthClient(config);
      await expect(client.currentUser()).resolves.toBeNull();
      await expect(client.idToken()).resolves.toBeNull();
    });

    it('returns null when the token lacks the expected claims', async () => {
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { idToken: { payload: { sub: 'user-1' }, toString: () => 'x' } }
      } as never);
      await expect(createAmplifyAuthClient(config).currentUser()).resolves.toBeNull();
    });

    it('signs out', async () => {
      vi.mocked(auth.signOut).mockResolvedValue(undefined);
      await createAmplifyAuthClient(config).signOut();
      expect(auth.signOut).toHaveBeenCalled();
    });
  });
});
