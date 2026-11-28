import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { HolidayStore } from '#lib/stores/holiday.svelte.js';
import { Toasts } from '#lib/stores/toast.svelte.js';
import HolidayFrame from './HolidayFrame.svelte';

const holidayId = '0190a0b0-0000-7000-8000-000000000001';
const otherId = '0190a0b0-0000-7000-8000-000000000002';
const meta = { version: 1, updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-1' };

const facts = (id = holidayId, name = 'Summer'): Schemas['HolidayFacts'] => ({
  holiday: {
    id,
    name,
    timeZone: 'Pacific/Auckland',
    startDate: '2026-12-26',
    endDate: '2027-01-02',
    ...meta
  },
  attendees: [],
  meals: [],
  trips: [],
  stockChanges: [],
  members: []
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string) => json(status, { error: { code, message: code } });

type Reply = Response | Promise<Response>;

function setup(...replies: Reply[]) {
  const queue = [...replies];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const reply = queue.shift();
    return reply ? Promise.resolve(reply) : Promise.reject(new Error('no reply'));
  });
  let clock = 1_000_000;
  const store = new HolidayStore({
    api: createApiClient({ fetch, token: () => Promise.resolve('token') }),
    toasts: new Toasts(),
    now: () => clock,
    sleep: () => Promise.resolve()
  });
  const children = createRawSnippet(() => ({ render: () => '<p>Page content</p>' }));
  const result = render(HolidayFrame, { store, holidayId, current: 'overview', children });
  return {
    store,
    fetch,
    reply: (r: Reply) => queue.push(r),
    tick: (ms: number) => (clock += ms),
    rerender: result.rerender,
    children
  };
}

const backLink = () => screen.getByRole('link', { name: t('holiday.backHome') });

describe('HolidayFrame', () => {
  it('shows a loading status, then the page with the navigation', async () => {
    let answer: (response: Response) => void = () => {};
    const { fetch } = setup(new Promise<Response>((resolve) => (answer = resolve)));

    expect(screen.getByRole('status').textContent).toContain(t('holiday.loading'));
    await vi.waitFor(() => expect(fetch.mock.calls[0]?.[0]).toBe(`/api/holidays/${holidayId}`));

    answer(json(200, facts()));
    expect(await screen.findByText('Page content')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: t('holiday.nav.label') })).toBeTruthy();
    // Loading writes the store's state; that mustn't trigger another load.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('shows not-found with a link back to /', async () => {
    setup(error(404, 'not-found'));

    expect(await screen.findByText(t('holiday.errors.notFound'))).toBeTruthy();
    expect(backLink().getAttribute('href')).toBe('/');
    expect(screen.queryByText('Page content')).toBeNull();
    expect(screen.queryByRole('navigation', { name: t('holiday.nav.label') })).toBeNull();
  });

  it('shows not-a-member with a link back to /', async () => {
    setup(error(403, 'not-a-member'));

    expect(await screen.findByText(t('holiday.errors.notAMember'))).toBeTruthy();
    expect(backLink().getAttribute('href')).toBe('/');
  });

  it('offers a retry when the load fails for another reason', async () => {
    const { reply } = setup(error(500, 'internal'));

    expect(await screen.findByText(t('holiday.errors.failed'))).toBeTruthy();
    reply(json(200, facts()));
    await userEvent.setup().click(screen.getByRole('button', { name: t('holiday.retry') }));
    expect(await screen.findByText('Page content')).toBeTruthy();
  });

  it('refreshes from the refresh button, showing a busy state', async () => {
    const { fetch, reply } = setup(json(200, facts()));
    await screen.findByText('Page content');
    let answer: (response: Response) => void = () => {};
    reply(new Promise<Response>((resolve) => (answer = resolve)));

    await userEvent.setup().click(screen.getByRole('button', { name: t('holiday.refresh') }));

    const busy = screen.getByRole('button', { name: t('holiday.refreshing') });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(fetch).toHaveBeenCalledTimes(2);
    answer(json(200, facts(holidayId, 'Summer (renamed)')));
    expect(await screen.findByRole('button', { name: t('holiday.refresh') })).toBeTruthy();
  });

  it('loads the new holiday when the id changes', async () => {
    const { fetch, reply, rerender } = setup(json(200, facts()));
    await screen.findByText('Page content');
    reply(json(200, facts(otherId, 'Easter')));

    await rerender({ holidayId: otherId });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]?.[0]).toBe(`/api/holidays/${otherId}`);
  });

  it('refetches on window focus once the data is stale', async () => {
    const { fetch, reply, tick } = setup(json(200, facts()));
    await screen.findByText('Page content');
    reply(json(200, facts()));

    tick(31_000);
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
