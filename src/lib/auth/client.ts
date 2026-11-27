// The app's view of authentication (PHASE_1 "Testing auth without Cognito").
// Amplify implements it in production; an in-memory fake does in `e2e` mode.

/** The signed-in user, from the ID token's claims. */
export interface AuthUser {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
}

/** Why an auth call failed. Each maps to a message in `en.ts`. */
export type AuthErrorCode =
  | 'invalidCredentials'
  | 'passwordPolicy'
  | 'invalidCode'
  | 'tooManyAttempts'
  | 'unsupported'
  | 'unknown';

/** What the login flow does next after a successful call. */
export type AuthStep = 'signedIn' | 'newPasswordRequired' | 'resetCodeSent' | 'passwordReset';

export type AuthResult<S extends AuthStep = AuthStep> =
  { readonly ok: true; readonly step: S } | { readonly ok: false; readonly error: AuthErrorCode };

/** Sign-in can finish, ask for a new password, or (for a user an admin flagged) send a reset code. */
export type SignInResult = AuthResult<'signedIn' | 'newPasswordRequired' | 'resetCodeSent'>;

export interface AuthClient {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Completes the first-login step after `newPasswordRequired`. */
  confirmNewPassword(newPassword: string): Promise<SignInResult>;
  requestPasswordReset(email: string): Promise<AuthResult<'resetCodeSent' | 'passwordReset'>>;
  confirmPasswordReset(
    email: string,
    code: string,
    newPassword: string
  ): Promise<AuthResult<'passwordReset'>>;
  currentUser(): Promise<AuthUser | null>;
  /** The Cognito ID token, which the API authoriser validates. */
  idToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

const errorsByName: Readonly<Record<string, AuthErrorCode>> = {
  NotAuthorizedException: 'invalidCredentials',
  UserNotFoundException: 'invalidCredentials',
  InvalidPasswordException: 'passwordPolicy',
  CodeMismatchException: 'invalidCode',
  ExpiredCodeException: 'invalidCode',
  LimitExceededException: 'tooManyAttempts',
  TooManyRequestsException: 'tooManyAttempts',
  TooManyFailedAttemptsException: 'tooManyAttempts'
};

/** Maps a thrown Cognito error (by its `name`) to an `AuthErrorCode`. */
export function authErrorCode(error: unknown): AuthErrorCode {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  const code =
    typeof name === 'string' && Object.hasOwn(errorsByName, name) ? errorsByName[name] : undefined;
  return code ?? 'unknown';
}
