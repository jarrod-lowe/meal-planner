import '#lib/test/dialog.js';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '#lib/i18n/en.js';
import ConfirmDialog from './ConfirmDialog.svelte';

const props = (onconfirm = vi.fn()) => ({
  open: true,
  heading: 'Delete Ann?',
  message: 'It can’t be undone.',
  confirmLabel: 'Delete attendee',
  onconfirm
});

describe('ConfirmDialog', () => {
  it('is a modal dialog named by its heading and described by its message', () => {
    render(ConfirmDialog, props());

    const dialog = screen.getByRole('dialog', { name: 'Delete Ann?' });
    const described = dialog.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe('It can’t be undone.');
  });

  it('starts on Cancel, the safe choice', async () => {
    render(ConfirmDialog, props());

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: t('confirm.cancel') }))
    );
  });

  it('confirms, then closes', async () => {
    const onconfirm = vi.fn();
    render(ConfirmDialog, props(onconfirm));

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete attendee' }));

    expect(onconfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels without confirming', async () => {
    const onconfirm = vi.fn();
    render(ConfirmDialog, props(onconfirm));

    await userEvent.setup().click(screen.getByRole('button', { name: t('confirm.cancel') }));

    expect(onconfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
