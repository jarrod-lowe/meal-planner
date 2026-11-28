import '#lib/test/dialog.js';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NetworkError, type Schemas } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import { Users } from '#lib/stores/users.svelte.js';
import { apiError, facts, holidayId, json, loadedHoliday, meta } from '#lib/test/holiday.js';
import MemberList from './MemberList.svelte';

const me = '0190a0b0-0000-7000-8000-00000000000e';
const bob = '0190a0b0-0000-7000-8000-0000000000b0';
const cat = '0190a0b0-0000-7000-8000-0000000000c0';
const ghost = '0190a0b0-0000-7000-8000-0000000000f0';
const member = (userSub: string) => ({ userSub, version: 1, ...meta });
const people: Schemas['User'][] = [
  { sub: me, name: 'Me Myself' },
  { sub: bob, name: 'Bob' },
  { sub: cat, name: 'Cat' }
];
const path = (sub: string) => `/holidays/${holidayId}/members/${sub}`;

async function setup(
  options: {
    members?: string[];
    users?: () => Promise<Schemas['UserList']>;
  } = {}
) {
  const env = await loadedHoliday(facts({ members: (options.members ?? [me, bob]).map(member) }));
  const users = new Users({
    get: vi.fn(options.users ?? (() => Promise.resolve({ users: people })))
  });
  const onleave = vi.fn();
  render(MemberList, { store: env.store, users, me, onleave });
  // Let GET /users settle.
  await vi.waitFor(() => expect(users.loaded || options.users !== undefined).toBe(true));
  return { ...env, users, onleave, user: userEvent.setup() };
}

const list = () => screen.getByRole('list', { name: t('people.members.heading') });
const select = () => screen.getByLabelText<HTMLSelectElement>(t('people.members.addField'));

describe('MemberList', () => {
  it('lists members by name, marking you, with a fallback for unknown users', async () => {
    await setup({ members: [me, bob, ghost] });

    const items = within(list()).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Me Myself');
    expect(items[0]?.textContent).toContain(t('people.members.you'));
    expect(items[1]?.textContent).toContain('Bob');
    expect(items[1]?.textContent).not.toContain(t('people.members.you'));
    expect(items[2]?.textContent).toContain(t('people.members.unknown'));
  });

  it('offers only users who aren’t members yet', async () => {
    await setup();

    const options = [...select().options].map((option) => option.textContent?.trim());
    expect(options).toEqual([t('people.members.choose'), 'Cat']);
  });

  it('adds the chosen user as a member', async () => {
    const { user, reply, requests } = await setup();
    reply(`PUT ${path(cat)}`, json(200, member(cat)));

    await user.selectOptions(select(), cat);
    await user.click(screen.getByRole('button', { name: t('people.members.add') }));

    expect(requests).toEqual([{ method: 'PUT', path: path(cat), body: { version: 0 } }]);
    expect(within(list()).getByText('Cat')).toBeTruthy();
    // Cat was the last user who could be added.
    expect(screen.getByText(t('people.members.noneToAdd'))).toBeTruthy();
  });

  it('says so when every user is already a member', async () => {
    await setup({ members: [me, bob, cat] });

    expect(screen.getByText(t('people.members.noneToAdd'))).toBeTruthy();
    expect(screen.queryByLabelText(t('people.members.addField'))).toBeNull();
  });

  it('says when the users can’t be loaded', async () => {
    await setup({ users: () => Promise.reject(new NetworkError(new TypeError('offline'))) });

    expect(await screen.findByText(t('people.members.usersFailed'))).toBeTruthy();
  });

  it('removes another member without asking', async () => {
    const { user, reply, requests, onleave } = await setup();
    reply(`DELETE ${path(bob)}`, new Response(null, { status: 204 }));

    await user.click(
      screen.getByRole('button', { name: t('people.members.removeLabel', { name: 'Bob' }) })
    );

    expect(requests).toEqual([{ method: 'DELETE', path: path(bob), body: undefined }]);
    expect(within(list()).queryByText('Bob')).toBeNull();
    expect(onleave).not.toHaveBeenCalled();
  });

  it('asks before you leave, and calls onleave once you have', async () => {
    const { user, reply, requests, onleave } = await setup();
    reply(`DELETE ${path(me)}`, new Response(null, { status: 204 }));

    await user.click(screen.getByRole('button', { name: t('people.members.leave') }));
    const dialog = screen.getByRole('dialog', { name: t('people.members.leaveHeading') });
    expect(dialog.textContent).toContain(t('people.members.leaveMessage', { holiday: 'Summer' }));
    expect(requests).toHaveLength(0);
    await user.click(
      within(dialog).getByRole('button', { name: t('people.members.leaveConfirm') })
    );

    expect(requests).toEqual([{ method: 'DELETE', path: path(me), body: undefined }]);
    expect(onleave).toHaveBeenCalledOnce();
  });

  it('stays put when leaving is cancelled', async () => {
    const { user, requests, onleave } = await setup();

    await user.click(screen.getByRole('button', { name: t('people.members.leave') }));
    await user.click(screen.getByRole('button', { name: t('confirm.cancel') }));

    expect(requests).toHaveLength(0);
    expect(onleave).not.toHaveBeenCalled();
  });

  it('explains plainly when you’re the last member', async () => {
    const { user, reply, onleave } = await setup({ members: [me] });
    reply(`DELETE ${path(me)}`, apiError(409, 'last-member', 'last member'));

    await user.click(screen.getByRole('button', { name: t('people.members.leave') }));
    const dialog = screen.getByRole('dialog', { name: t('people.members.leaveHeading') });
    await user.click(
      within(dialog).getByRole('button', { name: t('people.members.leaveConfirm') })
    );

    expect((await screen.findByRole('alert')).textContent).toBe(t('people.members.lastMember'));
    expect(onleave).not.toHaveBeenCalled();
    // Rolled back: you're still listed.
    expect(within(list()).getByText('Me Myself')).toBeTruthy();
  });
});
