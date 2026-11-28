import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { t } from '#lib/i18n/en.js';
import HolidayNav from './HolidayNav.svelte';

const holidayId = '0190a0b0-0000-7000-8000-000000000001';

const nav = () => screen.getByRole('navigation', { name: t('holiday.nav.label') });

describe('HolidayNav', () => {
  it('links Overview and People', () => {
    render(HolidayNav, { holidayId, current: 'overview' });

    const overview = within(nav()).getByRole('link', { name: t('holiday.nav.overview') });
    const people = within(nav()).getByRole('link', { name: t('holiday.nav.people') });
    expect(overview.getAttribute('href')).toBe(`/holidays/${holidayId}`);
    expect(people.getAttribute('href')).toBe(`/holidays/${holidayId}/people`);
  });

  it('shows Plan, Trips and Stock disabled and out of the tab order', () => {
    render(HolidayNav, { holidayId, current: 'overview' });

    for (const key of ['plan', 'trips', 'stock'] as const) {
      const item = within(nav()).getByRole('link', { name: new RegExp(t(`holiday.nav.${key}`)) });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.hasAttribute('href')).toBe(false);
      expect(item.tabIndex).toBe(-1);
      expect(item.textContent).toContain(t('holiday.nav.comingSoon'));
    }
  });

  it('marks the current section with aria-current', () => {
    render(HolidayNav, { holidayId, current: 'people' });

    const people = within(nav()).getByRole('link', { name: t('holiday.nav.people') });
    const overview = within(nav()).getByRole('link', { name: t('holiday.nav.overview') });
    expect(people.getAttribute('aria-current')).toBe('page');
    expect(overview.hasAttribute('aria-current')).toBe(false);
  });
});
