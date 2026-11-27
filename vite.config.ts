import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in Svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true
      },
      // Client-only SPA: every unknown path serves index.html (DESIGN §7.1).
      adapter: adapter({ fallback: 'index.html' })
    })
  ],
  test: {
    // terraform/: the CloudFront Function's tests sit next to it.
    include: ['src/**/*.test.ts', 'terraform/**/*.test.ts'],
    environment: 'node'
  }
});
