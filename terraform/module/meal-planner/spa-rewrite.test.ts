import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The CloudFront Function is a plain script (cloudfront-js-2.0 has no
// modules), so the test evaluates its source and takes the `handler` it
// declares.
interface CloudFrontRequest {
  uri: string;
  method: string;
}

interface CloudFrontEvent {
  request: CloudFrontRequest;
}

type Handler = (event: CloudFrontEvent) => CloudFrontRequest;

const source = readFileSync(new URL('./spa-rewrite.js', import.meta.url), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluates the function file under test
const loadHandler = new Function(`${source}\nreturn handler;`) as () => Handler;
const handler = loadHandler();

function rewrite(uri: string): string {
  return handler({ request: { uri, method: 'GET' } }).uri;
}

describe('spa-rewrite', () => {
  it.each(['/', '/login', '/holidays/abc', '/holidays/abc/', '/v1.2/holidays'])(
    'serves the SPA for the app route %s',
    (uri) => {
      expect(rewrite(uri)).toBe('/index.html');
    }
  );

  it.each(['/_app/immutable/x.js', '/favicon.png', '/robots.txt', '/index.html'])(
    'leaves the file %s unchanged',
    (uri) => {
      expect(rewrite(uri)).toBe(uri);
    }
  );

  it.each(['/api/health', '/api/holidays/abc'])('never rewrites the API path %s', (uri) => {
    expect(rewrite(uri)).toBe(uri);
  });

  it('returns the rest of the request unchanged', () => {
    const request = handler({ request: { uri: '/login', method: 'GET' } });
    expect(request.method).toBe('GET');
  });
});
