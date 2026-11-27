// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  // Written by Make from Terraform outputs (PHASE_1 "Frontend env").
  interface ImportMetaEnv {
    readonly VITE_USER_POOL_ID?: string;
    readonly VITE_USER_POOL_CLIENT_ID?: string;
  }
}

export {};
