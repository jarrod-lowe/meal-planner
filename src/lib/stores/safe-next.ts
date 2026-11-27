// Post-login redirect target (DESIGN §7.5 route guard).

const fallback = '/';
const loginPath = '/login';
// A base that can't clash with a real origin, to check `next` stays on it.
const probeOrigin = 'https://same-origin.invalid';

/**
 * Where to go after signing in. Only a same-origin absolute path is allowed
 * (no `//host`, backslashes, schemes, whitespace or control characters), and
 * never the login page itself; anything else is `/`.
 */
export function safeNext(next: string | null): string {
  if (!next?.startsWith('/') || next.startsWith('//')) return fallback;
  // Backslashes act as slashes, and browsers drop tabs and newlines, so
  // `/\evil.com` or `/\t/evil.com` would leave the origin.
  if (/[\\\s\p{Cc}]/u.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, probeOrigin);
  } catch {
    return fallback;
  }
  if (url.origin !== probeOrigin) return fallback;
  if (url.pathname === loginPath || url.pathname.startsWith(`${loginPath}/`)) return fallback;
  return next;
}
