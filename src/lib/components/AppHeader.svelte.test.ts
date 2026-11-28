import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '#lib/i18n/en.js';
import AppHeader from './AppHeader.svelte';
import { appSectionOf } from './app-sections.js';

const nav = () => screen.getByRole('navigation', { name: t('appNav.label') });
const link = (name: string) => within(nav()).getByRole('link', { name });

describe('AppHeader', () => {
  it('names the app and links Holidays, Recipes and Ingredients', () => {
    render(AppHeader, { current: 'holidays', onsignout: vi.fn() });

    expect(screen.getByText(t('app.title'))).toBeTruthy();
    expect(link(t('appNav.holidays')).getAttribute('href')).toBe('/');
    expect(link(t('appNav.recipes')).getAttribute('href')).toBe('/recipes');
    expect(link(t('appNav.ingredients')).getAttribute('href')).toBe('/ingredients');
  });

  it('marks only the current page with aria-current', () => {
    render(AppHeader, { current: 'recipes', onsignout: vi.fn() });

    expect(link(t('appNav.recipes')).getAttribute('aria-current')).toBe('page');
    expect(link(t('appNav.holidays')).hasAttribute('aria-current')).toBe(false);
    expect(link(t('appNav.ingredients')).hasAttribute('aria-current')).toBe(false);
  });

  it('marks nothing when the page is in no section', () => {
    render(AppHeader, { current: null, onsignout: vi.fn() });

    for (const key of ['holidays', 'recipes', 'ingredients'] as const) {
      expect(link(t(`appNav.${key}`)).hasAttribute('aria-current')).toBe(false);
    }
  });

  it('signs out', async () => {
    const onsignout = vi.fn();
    render(AppHeader, { current: 'holidays', onsignout });

    await userEvent.setup().click(screen.getByRole('button', { name: t('appNav.signOut') }));

    expect(onsignout).toHaveBeenCalledOnce();
  });
});

describe('appSectionOf', () => {
  it.each([
    ['/', 'holidays'],
    ['/holidays/[holidayId]', 'holidays'],
    ['/holidays/[holidayId]/people', 'holidays'],
    ['/recipes', 'recipes'],
    ['/recipes/[recipeId]', 'recipes'],
    ['/ingredients', 'ingredients'],
    ['/login', null],
    [null, null]
  ] as const)('%s is %s', (routeId, section) => {
    expect(appSectionOf(routeId)).toBe(section);
  });
});
