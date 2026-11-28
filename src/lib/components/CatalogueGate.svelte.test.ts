import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { t } from '#lib/i18n/en.js';
import { CatalogueStore } from '#lib/stores/catalogue.svelte.js';
import { Toasts } from '#lib/stores/toast.svelte.js';
import { fakeApi, json } from '#lib/test/api.js';
import CatalogueGate from './CatalogueGate.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>loaded</p>' }));

function setup() {
  const env = fakeApi();
  const store = new CatalogueStore({
    api: env.api,
    toasts: new Toasts(),
    sleep: () => Promise.resolve()
  });
  return { ...env, store };
}

describe('CatalogueGate', () => {
  it('loads the catalogue, then shows its content', async () => {
    const { store, reply, requests } = setup();
    reply('GET /catalogue', json(200, { recipes: [], ingredients: [] }));

    render(CatalogueGate, { store, children });

    expect(screen.getByRole('status').textContent).toBe(t('catalogue.loading'));
    expect(await screen.findByText('loaded')).toBeTruthy();
    expect(requests.map((r) => r.path)).toEqual(['/catalogue']);
  });

  it('says when loading fails, and retries', async () => {
    const { store, reply, requests } = setup();
    reply('GET /catalogue', json(400, { error: { code: 'validation', message: 'x' } }));
    reply('GET /catalogue', json(200, { recipes: [], ingredients: [] }));

    render(CatalogueGate, { store, children });

    expect((await screen.findByRole('alert')).textContent).toBe(t('catalogue.loadFailed'));
    expect(requests).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: t('catalogue.retry') }));
    expect(await screen.findByText('loaded')).toBeTruthy();
  });
});
