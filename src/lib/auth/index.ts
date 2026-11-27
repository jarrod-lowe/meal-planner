import type { AuthClient } from './client.js';

export type * from './client.js';

let client: Promise<AuthClient> | undefined;

/**
 * The app's `AuthClient`. In Vite's `e2e` mode it's the in-memory fake;
 * otherwise Amplify. `import.meta.env.MODE` is a build-time constant, so a
 * production build drops the fake's import entirely.
 */
export function getAuthClient(): Promise<AuthClient> {
  client ??=
    import.meta.env.MODE === 'e2e'
      ? import('./fake.js').then(({ createFakeAuthClient }) =>
          createFakeAuthClient({ storage: globalThis.sessionStorage })
        )
      : import('./amplify.js').then(({ createAmplifyAuthClient }) =>
          createAmplifyAuthClient({
            userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
            userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? ''
          })
        );
  return client;
}
