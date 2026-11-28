import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '#lib/i18n/en.js';
import type { Holiday } from '#lib/stores/holidays.svelte.js';
import HolidayList from './HolidayList.svelte';

const meta = { version: 1, updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'sub-1' };
const summer: Holiday = {
  id: '0190a0b0-0000-7000-8000-000000000001',
  name: 'Summer',
  timeZone: 'Pacific/Auckland',
  startDate: '2026-12-26',
  endDate: '2027-01-02',
  ...meta
};
const easter: Holiday = {
  id: '0190a0b0-0000-7000-8000-000000000002',
  name: 'Easter',
  timeZone: 'Pacific/Auckland',
  startDate: '2027-03-26',
  endDate: '2027-03-29',
  ...meta
};

describe('HolidayList', () => {
  it('lists each holiday as a link to it, with its dates', () => {
    render(HolidayList, { holidays: [summer, easter], status: 'ready', onretry: vi.fn() });

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const link = within(items[0]!).getByRole('link', { name: /Summer/ });
    expect(link.getAttribute('href')).toBe(`/holidays/${summer.id}`);
    expect(items[0]!.textContent).toContain('26 Dec 2026 – 2 Jan 2027');
    expect(within(items[1]!).getByRole('link', { name: /Easter/ })).toBeTruthy();
  });

  it('shows an empty state when there are no holidays', () => {
    render(HolidayList, { holidays: [], status: 'ready', onretry: vi.fn() });

    expect(screen.getByText(t('home.empty'))).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows a loading status', () => {
    render(HolidayList, { holidays: [], status: 'loading', onretry: vi.fn() });

    expect(screen.getByRole('status').textContent).toContain(t('home.loading'));
    expect(screen.queryByText(t('home.empty'))).toBeNull();
  });

  it('shows a failed load with a retry button', async () => {
    const onretry = vi.fn();
    render(HolidayList, { holidays: [], status: 'error', onretry });

    expect(screen.getByRole('alert').textContent).toContain(t('home.loadFailed'));
    await userEvent.setup().click(screen.getByRole('button', { name: t('home.retry') }));
    expect(onretry).toHaveBeenCalledOnce();
  });
});
