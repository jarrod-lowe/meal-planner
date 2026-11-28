import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // `make deploy-test` (or `make env-local`) writes VITE_API_PROXY_TARGET to
  // .env.local: the test environment's site. Without it, /api isn't proxied.
  const { VITE_API_PROXY_TARGET: apiProxyTarget } = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in Svelte 6.
          runes: ({ filename }) =>
            filename.split(/[/\\]/).includes('node_modules') ? undefined : true
        },
        // Client-only SPA: every unknown path serves index.html (DESIGN §7.1).
        adapter: adapter({ fallback: 'index.html' }),
        // index.html has an inline bootstrap <script> that changes every build,
        // so CloudFront's fixed CSP header can't hash it and allows inline
        // scripts. Kit adds this policy, with the script's hash, as a <meta> tag
        // in index.html. Browsers enforce both, so only the bootstrap runs.
        csp: {
          mode: 'hash',
          directives: { 'script-src': ['self'] }
        }
      })
    ],
    server: {
      // The API is always the relative /api (DESIGN §7.1). In dev it goes to
      // the test environment's CloudFront, which routes it to API Gateway.
      proxy: apiProxyTarget ? { '/api': { target: apiProxyTarget, changeOrigin: true } } : undefined
    },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            // terraform/: the CloudFront Function's tests sit next to it.
            include: ['src/**/*.test.ts', 'terraform/**/*.test.ts'],
            exclude: ['src/**/*.svelte.test.ts'],
            environment: 'node'
          }
        },
        {
          // Component tests (DESIGN §10): Svelte's browser build in jsdom,
          // with Testing Library's cleanup after each test.
          extends: true,
          plugins: [svelteTesting()],
          test: {
            name: 'components',
            include: ['src/**/*.svelte.test.ts'],
            environment: 'jsdom'
          }
        }
      ]
    }
  };
});
