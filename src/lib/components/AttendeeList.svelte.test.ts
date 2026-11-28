import '#lib/test/dialog.js';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '#lib/i18n/en.js';
import { apiError, facts, holidayId, json, loadedHoliday, meta } from '#lib/test/holiday.js';
import AttendeeList from './AttendeeList.svelte';

const annId = '0190a0b0-0000-7000-8000-0000000000a1';
const ann = { id: annId, name: 'Ann', version: 2, ...meta };
const path = (id: string) => `/holidays/${holidayId}/attendees/${id}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function setup(attendees = [ann]) {
  const env = await loadedHoliday(facts({ attendees }));
  render(AttendeeList, { store: env.store });
  return { ...env, user: userEvent.setup() };
}

const list = () => screen.getByRole('list', { name: t('people.attendees.heading') });

describe('AttendeeList', () => {
  it('lists the attendees', async () => {
    await setup();

    expect(within(list()).getByText('Ann')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    await setup([]);

    expect(screen.getByText(t('people.attendees.empty'))).toBeTruthy();
  });

  it('adds an attendee with a new UUIDv7, and clears the field', async () => {
    const { user, reply, requests } = await setup([]);
    reply('PUT', (request) =>
      json(200, { id: request.path.split('/').at(-1), name: 'Bob', version: 1, ...meta })
    );
    const field = screen.getByLabelText(t('people.attendees.newName'));

    await user.type(field, '  Bob ');
    await user.click(screen.getByRole('button', { name: t('people.attendees.add') }));

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe('PUT');
    const id = request?.path.split('/').at(-1) ?? '';
    expect(id).toMatch(uuid);
    expect(request?.body).toEqual({ name: 'Bob', version: 0 });
    expect(within(list()).getByText('Bob')).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('won’t add an empty name, and says why', async () => {
    const { user, requests } = await setup([]);

    await user.click(screen.getByRole('button', { name: t('people.attendees.add') }));

    const field = screen.getByLabelText(t('people.attendees.newName'));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const errorId = field.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(errorId)?.textContent).toBe(t('people.nameRequired'));
    expect(requests).toHaveLength(0);
  });

  it('renames inline with Enter, sending the version it read', async () => {
    const { user, reply, requests } = await setup();
    reply(`PUT ${path(annId)}`, json(200, { ...ann, name: 'Annie', version: 3 }));

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Ann' }) })
    );
    const field = screen.getByLabelText(t('people.attendees.renameField', { name: 'Ann' }));
    expect(document.activeElement).toBe(field);
    await user.clear(field);
    await user.type(field, 'Annie{Enter}');

    expect(requests).toEqual([
      { method: 'PUT', path: path(annId), body: { name: 'Annie', version: 2 } }
    ]);
    expect(within(list()).getByText('Annie')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Annie' }) })
    );
  });

  it('cancels a rename with Escape', async () => {
    const { user, requests } = await setup();

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Ann' }) })
    );
    await user.type(
      screen.getByLabelText(t('people.attendees.renameField', { name: 'Ann' })),
      'xyz{Escape}'
    );

    expect(requests).toHaveLength(0);
    expect(within(list()).getByText('Ann')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Ann' }) })
    );
  });

  it('cancels a rename with the Cancel button', async () => {
    const { user, requests } = await setup();

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Ann' }) })
    );
    await user.click(screen.getByRole('button', { name: t('people.attendees.cancel') }));

    expect(requests).toHaveLength(0);
    expect(screen.queryByLabelText(t('people.attendees.renameField', { name: 'Ann' }))).toBeNull();
  });

  it('deletes after confirming', async () => {
    const { user, reply, requests } = await setup();
    reply(`DELETE ${path(annId)}`, new Response(null, { status: 204 }));

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.deleteLabel', { name: 'Ann' }) })
    );
    const dialog = screen.getByRole('dialog', {
      name: t('people.attendees.deleteHeading', { name: 'Ann' })
    });
    await user.click(
      within(dialog).getByRole('button', { name: t('people.attendees.deleteConfirm') })
    );

    expect(requests).toEqual([{ method: 'DELETE', path: path(annId), body: undefined }]);
    expect(screen.queryByText('Ann')).toBeNull();
  });

  it('keeps the attendee when the delete is cancelled', async () => {
    const { user, requests } = await setup();

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.deleteLabel', { name: 'Ann' }) })
    );
    await user.click(screen.getByRole('button', { name: t('confirm.cancel') }));

    expect(requests).toHaveLength(0);
    expect(within(list()).getByText('Ann')).toBeTruthy();
  });

  it('shows the other person’s version after a conflicting rename', async () => {
    const { user, reply, toasts } = await setup();
    reply(
      `PUT ${path(annId)}`,
      apiError(409, 'version-conflict', 'conflict', { ...ann, name: 'Anna', version: 3 })
    );

    await user.click(
      screen.getByRole('button', { name: t('people.attendees.renameLabel', { name: 'Ann' }) })
    );
    const field = screen.getByLabelText(t('people.attendees.renameField', { name: 'Ann' }));
    await user.clear(field);
    await user.type(field, 'Annie{Enter}');

    expect(within(list()).getByText('Anna')).toBeTruthy();
    expect(toasts.items[0]?.action?.label).toBe(t('mutate.refreshHoliday'));
  });
});
