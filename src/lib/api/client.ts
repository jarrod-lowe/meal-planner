// Typed API client (DESIGN §5). Paths, parameters, bodies and responses come
// from the OpenAPI types (`make api-types`); every call adds the Cognito ID
// token, which the API Gateway authoriser takes as-is (no "Bearer").
import { getAuthClient } from '#lib/auth/index.js';
import type { components, paths } from './types.js';

export type Schemas = components['schemas'];

/** The Lambdas' codes (§5.3), plus API Gateway's 401/403 and anything unparseable. */
export type ApiErrorCode =
  Schemas['ErrorDetail']['code'] | 'unauthorized' | 'forbidden' | 'unknown';

/** The server answered with an error status. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** On `version-conflict`: the stored item, or `null` if it was deleted. Otherwise `undefined`. */
    readonly current?: unknown
  ) {
    super(message);
  }
}

/** The request never got an answer (offline, DNS, CORS, a cut-off body). */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';

  constructor(cause: unknown) {
    super('Network error', { cause });
  }
}

/** Network errors and 5xx are worth retrying (§7.3); other errors aren't. */
export function isRetryable(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
}

type Method = 'get' | 'put' | 'delete';

/** The paths that have an operation for `M`. */
type PathsWith<M extends Method> = {
  [P in keyof paths]: [NonNullable<paths[P][M]>] extends [never] ? never : P;
}[keyof paths];

type Operation<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;

type ParamNames<P extends string> = P extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParamNames<Rest>
  : never;

/** `{holidayId}`-style placeholders in `P`, as an object of strings. */
export type PathParams<P extends string> = Readonly<Record<ParamNames<P>, string>>;

/** No argument for a path without placeholders; the params object otherwise. */
type ParamsArg<P extends string> = [ParamNames<P>] extends [never] ? [] : [PathParams<P>];

type JsonContent<T> = T extends { content: { 'application/json': infer C } } ? C : never;

export type ResponseBody<P extends keyof paths, M extends Method> = Operation<
  P,
  M
>['responses'] extends { 200: infer R }
  ? JsonContent<R>
  : never;

export type RequestBody<P extends keyof paths, M extends Method> = JsonContent<
  Operation<P, M>['requestBody']
>;

export type GetPath = PathsWith<'get'>;
export type PutPath = PathsWith<'put'>;
export type DeletePath = PathsWith<'delete'>;

export interface ApiClient {
  get<P extends GetPath>(path: P, ...params: ParamsArg<P>): Promise<ResponseBody<P, 'get'>>;
  put<P extends PutPath>(
    path: P,
    params: PathParams<P>,
    body: RequestBody<P, 'put'>
  ): Promise<ResponseBody<P, 'put'>>;
  del<P extends DeletePath>(path: P, ...params: ParamsArg<P>): Promise<void>;
}

export interface ApiClientOptions {
  /** The current ID token, or `null` when signed out. */
  readonly token: () => Promise<string | null>;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Defaults to the same-origin `/api` (§7.1). */
  readonly base?: string;
}

function fillPath(path: string, params: Readonly<Record<string, string>> = {}): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const lambdaCodes: ReadonlySet<string> = new Set<ApiErrorCode>([
  'validation',
  'not-a-member',
  'not-found',
  'version-conflict',
  'already-exists',
  'last-member',
  'internal',
  'unauthorized'
]);

function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status >= 500) return 'internal';
  return 'unknown';
}

/** Parses a Lambda `{error:{code,message}}` body, or API Gateway's `{message}`, or anything else. */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const detail = isObject(body) && isObject(body.error) ? body.error : undefined;
  if (detail && typeof detail.code === 'string' && lambdaCodes.has(detail.code)) {
    const message = typeof detail.message === 'string' ? detail.message : response.statusText;
    const current = isObject(body) && 'current' in body ? body.current : undefined;
    return new ApiError(response.status, detail.code as ApiErrorCode, message, current);
  }
  const message =
    isObject(body) && typeof body.message === 'string' ? body.message : response.statusText;
  return new ApiError(response.status, fallbackCode(response.status), message);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.base ?? '/api';
  // Looked up per call, so tests (and the browser) can swap the global.
  const fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    params: Readonly<Record<string, string>> | undefined,
    body?: unknown
  ): Promise<unknown> {
    const token = await options.token();
    if (!token) throw new ApiError(401, 'unauthorized', 'Not signed in');

    const headers: Record<string, string> = { Authorization: token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(base + fillPath(path, params), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new NetworkError(error);
    }

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch (error) {
      throw new NetworkError(error);
    }
  }

  return {
    get: (path, ...[params]) => request('GET', path, params) as never,
    put: (path, params, body) => request('PUT', path, params, body) as never,
    del: async (path, ...[params]) => {
      await request('DELETE', path, params);
    }
  };
}

/** The app's client, using the signed-in user's ID token. */
export const api: ApiClient = createApiClient({
  token: async () => (await getAuthClient()).idToken()
});
