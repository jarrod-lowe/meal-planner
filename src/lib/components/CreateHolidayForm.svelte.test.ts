import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import type { HolidayFields } from '#lib/stores/holidays.svelte.js';
import CreateHolidayForm from './CreateHolidayForm.svelte';

type OnCreate = (fields: HolidayFields) => Promise<void>;

function setup(
  props: { oncreate?: OnCreate; defaultTimeZone?: string; timeZones?: string[] } = {}
) {
  const oncreate = vi.fn<OnCreate>(props.oncreate ?? (() => Promise.resolve()));
  render(CreateHolidayForm, { ...props, oncreate });
  const user = userEvent.setup();
  const name = () => screen.getByLabelText(t('createHoliday.name'));
  const start = () => screen.getByLabelText(t('createHoliday.startDate'));
  const end = () => screen.getByLabelText(t('createHoliday.endDate'));
  const timeZone = () => screen.getByLabelText<HTMLSelectElement>(t('createHoliday.timeZone'));
  const submit = () => user.click(screen.getByRole('button', { name: t('createHoliday.submit') }));
  return { oncreate, user, name, start, end, timeZone, submit };
}

/** The text of the elements an input's aria-describedby points at. */
function description(input: HTMLElement): string {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ');
}

describe('CreateHolidayForm', () => {
  it('defaults the time zone to the browser’s', () => {
    const { timeZone } = setup();

    expect(timeZone().value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('offers the supported time zones, and keeps a default that isn’t among them', () => {
    const { timeZone } = setup({
      defaultTimeZone: 'Etc/Unknown',
      timeZones: ['Europe/London', 'Pacific/Auckland']
    });

    const values = [...timeZone().options].map((option) => option.value);
    expect(values).toEqual(['Etc/Unknown', 'Europe/London', 'Pacific/Auckland']);
    expect(timeZone().value).toBe('Etc/Unknown');
  });

  it('shows a message for each missing field, tied to its input', async () => {
    const { oncreate, name, start, end, submit } = setup();

    await submit();

    expect(oncreate).not.toHaveBeenCalled();
    expect(name().getAttribute('aria-invalid')).toBe('true');
    expect(description(name())).toContain(t('createHoliday.errors.nameRequired'));
    expect(description(start())).toContain(t('createHoliday.errors.startRequired'));
    expect(description(end())).toContain(t('createHoliday.errors.endRequired'));
    expect(document.activeElement).toBe(name());
  });

  it('rejects a name of only spaces, and one over 100 characters', async () => {
    const { user, name, submit } = setup();

    await user.type(name(), '   ');
    await submit();
    expect(description(name())).toContain(t('createHoliday.errors.nameRequired'));

    // maxlength stops typing past 100, so set the value directly.
    (name() as HTMLInputElement).value = 'x'.repeat(101);
    name().dispatchEvent(new Event('input', { bubbles: true }));
    await submit();
    expect(description(name())).toContain(t('createHoliday.errors.nameTooLong'));
  });

  it('rejects an end date before the start date', async () => {
    const { oncreate, user, name, start, end, submit } = setup();

    await user.type(name(), 'Summer');
    await user.type(start(), '2027-01-02');
    await user.type(end(), '2026-12-26');
    await submit();

    expect(oncreate).not.toHaveBeenCalled();
    expect(end().getAttribute('aria-invalid')).toBe('true');
    expect(description(end())).toContain(t('createHoliday.errors.endBeforeStart'));
    expect(start().getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(end());
  });

  it('creates with the trimmed name, the dates and the time zone', async () => {
    const { oncreate, user, name, start, end, timeZone, submit } = setup({
      defaultTimeZone: 'Pacific/Auckland',
      timeZones: ['Europe/London', 'Pacific/Auckland']
    });

    await user.type(name(), '  Summer  ');
    await user.type(start(), '2026-12-26');
    await user.type(end(), '2026-12-26');
    await user.selectOptions(timeZone(), 'Europe/London');
    await submit();

    expect(oncreate).toHaveBeenCalledWith({
      name: 'Summer',
      startDate: '2026-12-26',
      endDate: '2026-12-26',
      timeZone: 'Europe/London'
    });
  });

  it('shows the busy state while creating, and an alert when it fails', async () => {
    let fail: (error: unknown) => void = () => {};
    const { user, name, start, end, submit } = setup({
      oncreate: () => new Promise((_, reject) => (fail = reject))
    });
    await user.type(name(), 'Summer');
    await user.type(start(), '2026-12-26');
    await user.type(end(), '2027-01-02');

    await submit();
    const button = screen.getByRole('button', { name: t('createHoliday.busy') });
    expect(button.hasAttribute('disabled')).toBe(true);

    fail(new NetworkError(new TypeError('offline')));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      t('createHoliday.failed')
    );
    expect(screen.getByRole('button', { name: t('createHoliday.submit') })).toBeTruthy();
  });

  it('shows the server’s message for a rejected create', async () => {
    const { user, name, start, end, submit } = setup({
      oncreate: () => Promise.reject(new ApiError(400, 'validation', 'unknown time zone'))
    });
    await user.type(name(), 'Summer');
    await user.type(start(), '2026-12-26');
    await user.type(end(), '2027-01-02');

    await submit();

    expect((await screen.findByRole('alert')).textContent).toBe(
      t('createHoliday.rejected', { message: 'unknown time zone' })
    );
  });
});
