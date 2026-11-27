// `AuthClient` over Amplify v6 (DESIGN §7.5): SRP sign-in, the first-login
// new-password challenge, Cognito's code-by-email reset, and the ID token.
import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  resetPassword,
  signIn,
  signOut,
  type ResetPasswordOutput,
  type SignInOutput
} from 'aws-amplify/auth';
import {
  authErrorCode,
  type AuthClient,
  type AuthResult,
  type AuthUser,
  type SignInResult
} from './client.js';

export interface AmplifyAuthConfig {
  /** The region is part of the pool ID, e.g. `ap-southeast-2_abc`. */
  readonly userPoolId: string;
  readonly userPoolClientId: string;
}

const fail = (error: unknown) => ({ ok: false, error: authErrorCode(error) }) as const;

function resetStep(output: ResetPasswordOutput): AuthResult<'resetCodeSent' | 'passwordReset'> {
  return output.nextStep.resetPasswordStep === 'DONE'
    ? { ok: true, step: 'passwordReset' }
    : { ok: true, step: 'resetCodeSent' };
}

async function requestReset(email: string): Promise<AuthResult<'resetCodeSent' | 'passwordReset'>> {
  try {
    return resetStep(await resetPassword({ username: email }));
  } catch (error) {
    return fail(error);
  }
}

/** Maps a sign-in `nextStep`. Anything this app doesn't handle (MFA, custom challenges) is `unsupported`. */
async function signInStep(output: SignInOutput, email: string): Promise<SignInResult> {
  switch (output.nextStep.signInStep) {
    case 'DONE':
      return { ok: true, step: 'signedIn' };
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return { ok: true, step: 'newPasswordRequired' };
    case 'RESET_PASSWORD': {
      // An admin flagged the account for reset: send the code now.
      const reset = await requestReset(email);
      return reset.ok ? { ok: true, step: 'resetCodeSent' } : reset;
    }
    default:
      return { ok: false, error: 'unsupported' };
  }
}

const claim = (payload: Record<string, unknown>, name: string) =>
  typeof payload[name] === 'string' ? payload[name] : undefined;

export function createAmplifyAuthClient(config: AmplifyAuthConfig): AuthClient {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId } }
  });

  // The pending sign-in's email, for a RESET_PASSWORD step after confirmSignIn.
  let pendingEmail = '';

  async function idTokenOrNull() {
    try {
      return (await fetchAuthSession()).tokens?.idToken ?? null;
    } catch {
      return null;
    }
  }

  return {
    async signIn(email, password) {
      pendingEmail = email;
      try {
        return await signInStep(await signIn({ username: email, password }), email);
      } catch (error) {
        if (error instanceof Error && error.name === 'UserAlreadyAuthenticatedException') {
          return { ok: true, step: 'signedIn' };
        }
        return fail(error);
      }
    },

    async confirmNewPassword(newPassword) {
      try {
        return await signInStep(
          await confirmSignIn({ challengeResponse: newPassword }),
          pendingEmail
        );
      } catch (error) {
        return fail(error);
      }
    },

    requestPasswordReset: requestReset,

    async confirmPasswordReset(email, code, newPassword) {
      try {
        await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
        return { ok: true, step: 'passwordReset' };
      } catch (error) {
        return fail(error);
      }
    },

    async currentUser(): Promise<AuthUser | null> {
      const token = await idTokenOrNull();
      if (!token) return null;
      const sub = claim(token.payload, 'sub');
      const name = claim(token.payload, 'name');
      const email = claim(token.payload, 'email');
      return sub && name && email ? { sub, name, email } : null;
    },

    async idToken() {
      return (await idTokenOrNull())?.toString() ?? null;
    },

    async signOut() {
      await signOut();
    }
  };
}
