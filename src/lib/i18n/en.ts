// All user-facing text (DESIGN §7.1). Components read it through `t()`.
export const en = {
  app: {
    title: 'Meal planner',
    loading: 'Loading…'
  },
  home: {
    title: 'Home · Meal planner',
    greeting: 'Hello, {name}',
    signOut: 'Sign out'
  },
  login: {
    title: 'Sign in · Meal planner',
    email: 'Email',
    password: 'Password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordHelp: 'At least 12 characters.',
    code: 'Reset code',
    forgotPassword: 'Forgot password?',
    backToSignIn: 'Back to sign in',
    signIn: {
      heading: 'Sign in',
      submit: 'Sign in',
      busy: 'Signing in…'
    },
    newPasswordStep: {
      heading: 'Set a new password',
      intro: 'Choose a password to replace the temporary one you were sent.',
      submit: 'Set password',
      busy: 'Setting password…'
    },
    forgotPasswordStep: {
      heading: 'Reset your password',
      intro: 'Enter your email and we’ll send you a reset code.',
      submit: 'Send code',
      busy: 'Sending code…'
    },
    resetCodeStep: {
      heading: 'Enter your reset code',
      intro: 'If {email} has an account, we’ve sent it a code.',
      submit: 'Reset password',
      busy: 'Resetting password…'
    },
    resetDoneStep: {
      heading: 'Password reset',
      message: 'Your password has been reset. Sign in with your new password.'
    },
    errors: {
      invalidCredentials: 'That email and password don’t match.',
      passwordPolicy: 'That password doesn’t meet the rules. Use at least 12 characters.',
      invalidCode: 'That code is wrong or has expired.',
      tooManyAttempts: 'Too many attempts. Wait a few minutes, then try again.',
      unsupported: 'This account needs a sign-in step the app doesn’t support. Ask an admin.',
      unknown: 'Something went wrong. Try again.',
      mismatch: 'The passwords don’t match.'
    }
  }
} as const;

type Messages = { readonly [key: string]: string | Messages };

/** Dotted paths to the string leaves of `M`, e.g. `'app.title'`. */
export type MessageKey<M> = {
  [K in keyof M & string]: M[K] extends string ? K : `${K}.${MessageKey<M[K]>}`;
}[keyof M & string];

export type Params = Readonly<Record<string, string | number>>;

/**
 * Builds a `t()` for a message object. `{name}` placeholders are replaced from
 * `params`; a placeholder with no matching param is left as-is, so a missing
 * value shows up visibly in the UI rather than crashing the page.
 */
export function translator<M extends Messages>(messages: M) {
  return (key: MessageKey<M>, params?: Params): string => {
    let node: string | Messages | undefined = messages;
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    // Unreachable for well-typed keys; fall back to the key itself.
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (match, name: string) =>
      params && Object.hasOwn(params, name) ? String(params[name]) : match
    );
  };
}

export const t = translator(en);
