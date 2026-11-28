import { describe, expect, it, vi } from 'vitest';
import { Toasts } from './toast.svelte.js';

describe('Toasts', () => {
  it('shows toasts in order, each with its own id', () => {
    const toasts = new Toasts();

    const a = toasts.error('Could not save');
    const b = toasts.info('Saved');

    expect(a).not.toBe(b);
    expect(toasts.items).toEqual([
      { id: a, kind: 'error', message: 'Could not save' },
      { id: b, kind: 'info', message: 'Saved' }
    ]);
  });

  it('keeps an optional action', () => {
    const toasts = new Toasts();
    const run = vi.fn();

    toasts.error('Changed elsewhere', { label: 'Refresh holiday', run });

    expect(toasts.items[0]?.action).toEqual({ label: 'Refresh holiday', run });
  });

  it('dismisses by id, ignoring unknown ids', () => {
    const toasts = new Toasts();
    const a = toasts.error('A');
    const b = toasts.error('B');

    toasts.dismiss(a);
    toasts.dismiss(999);

    expect(toasts.items.map((toast) => toast.id)).toEqual([b]);
  });

  it('runs an action, then dismisses its toast', () => {
    const toasts = new Toasts();
    const run = vi.fn();
    const id = toasts.error('Changed elsewhere', { label: 'Refresh holiday', run });

    toasts.act(id);

    expect(run).toHaveBeenCalledOnce();
    expect(toasts.items).toEqual([]);
  });

  it('auto-dismisses info toasts without an action, but never errors or actions', () => {
    vi.useFakeTimers();
    try {
      const toasts = new Toasts({ infoTimeoutMs: 5000 });
      toasts.info('Saved');
      toasts.info('Undo?', { label: 'Undo', run: () => undefined });
      toasts.error('Failed');

      vi.advanceTimersByTime(5000);

      expect(toasts.items.map((toast) => toast.message)).toEqual(['Undo?', 'Failed']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears everything', () => {
    const toasts = new Toasts();
    toasts.error('A');
    toasts.info('B');

    toasts.clear();

    expect(toasts.items).toEqual([]);
  });
});
