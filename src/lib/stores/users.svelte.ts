// The users who can be made members (DESIGN §7.3): `GET /users`, fetched once
// per session and used to show member names.
import { api, type Schemas } from '#lib/api/client.js';
import { session } from './session.svelte.js';

export type User = Schemas['User'];

/** The part of `ApiClient` this store uses. */
export interface UsersApi {
  get(path: '/users'): Promise<Schemas['UserList']>;
}

export class Users {
  list = $state.raw<readonly User[]>([]);
  loaded = $state(false);

  readonly #api: UsersApi;
  #loading: Promise<void> | undefined;

  constructor(client: UsersApi) {
    this.#api = client;
  }

  /**
   * Fetches the list once; later calls share the same request or return at
   * once. A failed fetch rejects, and the next call tries again.
   */
  load(): Promise<void> {
    if (this.#loading) return this.#loading;
    const loading = this.#api.get('/users').then(
      ({ users }) => {
        if (this.#loading !== loading) return; // cleared meanwhile
        this.list = users;
        this.loaded = true;
      },
      (error: unknown) => {
        if (this.#loading === loading) this.#loading = undefined;
        throw error;
      }
    );
    this.#loading = loading;
    return loading;
  }

  /** The user's display name, or `undefined` if they aren't in the list (yet). */
  nameOf(sub: string): string | undefined {
    return this.list.find((user) => user.sub === sub)?.name;
  }

  /** Forgets the list, e.g. on sign-out. */
  clear() {
    this.#loading = undefined;
    this.list = [];
    this.loaded = false;
  }
}

export const users = new Users(api);
session.onSignOut(() => users.clear());
