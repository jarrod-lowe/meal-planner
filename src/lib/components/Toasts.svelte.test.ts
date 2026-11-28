import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { t } from '#lib/i18n/en.js';
import { Toasts as ToastStore } from '#lib/stores/toast.svelte.js';
import Toasts from './Toasts.svelte';

function setup() {
  const store = new ToastStore();
  render(Toasts, { toasts: store });
  return { store, user: userEvent.setup() };
}

const region = () => screen.getByRole('region', { name: t('toasts.label') });

describe('Toasts', () => {
  it('renders an empty live region up front, so later toasts are announced', () => {
    setup();

    const live = within(region()).getByRole('log');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent?.trim()).toBe('');
  });

  it('shows each toast message', () => {
    const { store } = setup();

    store.error('Could not save');
    store.info('Saved');
    flushSync();

    expect(within(region()).getByText('Could not save')).toBeTruthy();
    expect(within(region()).getByText('Saved')).toBeTruthy();
  });

  it('dismisses a toast with its labelled dismiss button', async () => {
    const { store, user } = setup();
    store.error('Could not save');
    flushSync();

    await user.click(screen.getByRole('button', { name: t('toasts.dismiss') }));

    expect(screen.queryByText('Could not save')).toBeNull();
  });

  it('runs the action and dismisses, from the keyboard', async () => {
    const { store, user } = setup();
    const run = vi.fn();
    store.error('Changed elsewhere', { label: 'Refresh holiday', run });
    flushSync();

    screen.getByRole('button', { name: 'Refresh holiday' }).focus();
    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText('Changed elsewhere')).toBeNull();
  });

  it('marks errors so they are not told apart by colour alone', () => {
    const { store } = setup();
    store.error('Could not save');
    flushSync();

    const item = screen.getByText('Could not save').closest('li');
    expect(item?.textContent).toContain(t('toasts.error'));
  });
});
