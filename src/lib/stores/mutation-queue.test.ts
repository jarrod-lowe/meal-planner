import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '#lib/api/client.js';
import { t } from '#lib/i18n/en.js';
import {
  CancelledError,
  matches,
  MutationQueue,
  withRetry,
  type Lane,
  type MutationResult,
  type QueueHooks,
  type Write
} from './mutation-queue.js';
import { Toasts } from './toast.svelte.js';

interface Item {
  readonly id: string;
  readonly name: string;
  readonly version: number;
}
type Op = 'put' | 'delete';
type TestLane = Lane<string, Item, Op>;

/** A promise you resolve or reject later, to look at the queue mid-request. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const offline = () => new NetworkError(new TypeError('offline'));
const conflict = (current: Item | null) =>
  new ApiError(409, 'version-conflict', 'conflict', current);
const alreadyExists = () => new ApiError(409, 'already-exists', 'exists');

/**
 * A queue over a map of items. `replies` holds, per id, what each send does in
 * turn: an item (or `undefined`) to resolve with, an error to throw, or a
 * deferred promise.
 */
function setup(options: { sleep?: (ms: number) => Promise<void>; canVanish?: boolean } = {}) {
  const items = new Map<string, Item>();
  const replies = new Map<string, (Item | undefined | Error | Promise<Item | undefined>)[]>();
  const sent: { id: string; op: Op; fields: unknown; version: number }[] = [];
  const stored = new Map<string, Item | undefined>();
  const refreshed = vi.fn();
  const toasts = new Toasts();
  const sleeps: number[] = [];

  const hooks: QueueHooks<string, Item, Op> = {
    apply: (lane, item, write) => ({
      ...item,
      ...(write.fields as Partial<Item>),
      id: lane.context,
      name: (write.fields.name as string | undefined) ?? item?.name ?? '',
      version: item?.version ?? 0
    }),
    show: (lane, item) => {
      if (item) items.set(lane.context, item);
      else items.delete(lane.context);
    },
    send: (lane, write, version) => {
      sent.push({ id: lane.context, op: write.mutation, fields: write.fields, version });
      const reply = replies.get(lane.context)?.shift();
      if (reply instanceof Error) return Promise.reject(reply);
      if (reply instanceof Promise) return reply;
      return Promise.resolve(reply);
    },
    fetchStored: (lane) => Promise.resolve(stored.get(lane.context)),
    canVanish: () => options.canVanish ?? true
  };
  const queue = new MutationQueue<string, Item, Op>({
    hooks,
    toasts,
    refresh: { label: () => 'Refresh', run: refreshed },
    sleep: (ms) => {
      sleeps.push(ms);
      return options.sleep?.(ms) ?? Promise.resolve();
    }
  });
  const reply = (id: string, ...more: (Item | undefined | Error | Promise<Item | undefined>)[]) =>
    replies.set(id, [...(replies.get(id) ?? []), ...more]);

  const write = (
    id: string,
    change: { name?: string; remove?: boolean },
    label = change.name ?? 'item'
  ): Promise<MutationResult> => {
    const shown = items.get(id);
    const entry: Write<Op> = {
      mutation: change.remove ? 'delete' : 'put',
      fields: change.name === undefined ? {} : { name: change.name },
      remove: change.remove ?? false,
      label,
      existed: shown !== undefined
    };
    return queue.enqueue(id, id, shown, entry);
  };

  return { queue, items, reply, sent, stored, toasts, refreshed, sleeps, write };
}

const ann: Item = { id: 'a', name: 'Ann', version: 2 };
const messages = (toasts: Toasts) => toasts.items.map((toast) => toast.message);

describe('MutationQueue', () => {
  it('shows a write at once, sends it with the version, then keeps the response', async () => {
    const { items, reply, sent, write } = setup();
    items.set('a', ann);
    const pending = deferred<Item>();
    reply('a', pending.promise);

    const result = write('a', { name: 'Annie' });

    expect(items.get('a')).toEqual({ id: 'a', name: 'Annie', version: 2 });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ op: 'put', version: 2 });
    pending.resolve({ id: 'a', name: 'Annie', version: 3 });
    await expect(result).resolves.toEqual({ outcome: 'saved' });
    expect(items.get('a')).toEqual({ id: 'a', name: 'Annie', version: 3 });
  });

  it('creates with version 0, unless a hook says otherwise', async () => {
    const { reply, sent, write } = setup();
    reply('b', { id: 'b', name: 'Bob', version: 1 });

    await write('b', { name: 'Bob' });

    expect(sent[0]?.version).toBe(0);
  });

  it('sends writes on one item in turn, each with the version the last one left', async () => {
    const { items, reply, sent, write } = setup();
    const first = deferred<Item>();
    reply('b', first.promise, { id: 'b', name: 'Bobby', version: 2 });

    const creating = write('b', { name: 'Bob' });
    const renaming = write('b', { name: 'Bobby' });
    expect(items.get('b')?.name).toBe('Bobby');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await Promise.resolve();
    expect(sent).toHaveLength(1);

    first.resolve({ id: 'b', name: 'Bob', version: 1 });
    await expect(creating).resolves.toEqual({ outcome: 'saved' });
    // The response doesn't hide the queued rename.
    expect(items.get('b')?.name).toBe('Bobby');
    await expect(renaming).resolves.toEqual({ outcome: 'saved' });
    expect(sent.map((s) => s.version)).toEqual([0, 1]);
    expect(items.get('b')).toEqual({ id: 'b', name: 'Bobby', version: 2 });
  });

  it('writes different items at the same time', async () => {
    const { items, reply, sent, write } = setup();
    items.set('a', ann);
    const a = deferred<Item>();
    const b = deferred<Item>();
    reply('a', a.promise);
    reply('b', b.promise);

    const one = write('a', { name: 'Annie' });
    const two = write('b', { name: 'Bob' });
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    b.resolve({ id: 'b', name: 'Bob', version: 1 });
    a.resolve({ id: 'a', name: 'Annie', version: 3 });
    await expect(one).resolves.toEqual({ outcome: 'saved' });
    await expect(two).resolves.toEqual({ outcome: 'saved' });
  });

  it('removes an item, and a response for an earlier write does not bring it back', async () => {
    const { items, reply, write } = setup();
    items.set('a', ann);
    const pending = deferred<Item>();
    reply('a', pending.promise, undefined);

    const renaming = write('a', { name: 'Annie' });
    const removing = write('a', { remove: true });
    expect(items.has('a')).toBe(false);

    pending.resolve({ id: 'a', name: 'Annie', version: 3 });
    await renaming;
    expect(items.has('a')).toBe(false);
    await expect(removing).resolves.toEqual({ outcome: 'saved' });
    expect(items.has('a')).toBe(false);
  });

  describe('on errors', () => {
    it('retries network errors with backoff', async () => {
      const { items, reply, sleeps, toasts, write } = setup();
      items.set('a', ann);
      reply('a', offline(), offline(), offline(), { ...ann, name: 'Annie', version: 3 });

      await expect(write('a', { name: 'Annie' })).resolves.toEqual({ outcome: 'saved' });
      expect(sleeps).toEqual([500, 1000, 2000]);
      expect(toasts.items).toEqual([]);
    });

    it('rolls back after 3 retries, with a toast naming the item', async () => {
      const { items, reply, toasts, write } = setup();
      items.set('a', ann);
      reply('a', offline(), offline(), offline(), offline());

      await expect(write('a', { name: 'Annie' })).resolves.toMatchObject({ outcome: 'failed' });
      expect(items.get('a')).toEqual(ann);
      expect(messages(toasts)).toEqual([t('mutate.failed', { item: 'Annie' })]);
    });

    it('rolls back a 4xx at once, with its message', async () => {
      const { items, reply, sent, toasts, write } = setup();
      items.set('a', ann);
      reply('a', new ApiError(400, 'validation', 'Too long'));

      await write('a', { name: 'Annie' });

      expect(sent).toHaveLength(1);
      expect(items.get('a')).toEqual(ann);
      expect(messages(toasts)).toEqual([
        t('mutate.rejected', { item: 'Annie', message: 'Too long' })
      ]);
    });

    it('drops queued writes on an item whose create failed', async () => {
      const { items, reply, sent, toasts, write } = setup();
      reply('b', offline(), offline(), offline(), offline());

      const creating = write('b', { name: 'Bob' });
      const renaming = write('b', { name: 'Bobby' });
      const removing = write('b', { remove: true });

      await expect(creating).resolves.toMatchObject({ outcome: 'failed' });
      await expect(renaming).resolves.toMatchObject({ outcome: 'failed' });
      await expect(removing).resolves.toEqual({ outcome: 'saved' });
      expect(sent).toHaveLength(4);
      expect(items.has('b')).toBe(false);
      expect(toasts.items).toHaveLength(1);
    });
  });

  describe('on a version conflict', () => {
    it('keeps the current copy, drops queued writes and toasts with the refresh action', async () => {
      const { items, reply, sent, toasts, refreshed, write } = setup();
      items.set('a', ann);
      const current = { id: 'a', name: 'Anna', version: 5 };
      reply('a', conflict(current));

      const first = write('a', { name: 'Annie' });
      const second = write('a', { name: 'Ann B' });

      await expect(first).resolves.toEqual({ outcome: 'conflict' });
      await expect(second).resolves.toEqual({ outcome: 'conflict' });
      expect(sent).toHaveLength(1);
      expect(items.get('a')).toEqual(current);
      expect(messages(toasts)).toEqual([t('mutate.conflict', { item: 'Annie' })]);
      expect(toasts.items[0]?.action?.label).toBe('Refresh');
      toasts.act(toasts.items[0]?.id ?? 0);
      expect(refreshed).toHaveBeenCalledOnce();
    });

    it('removes an item that is gone', async () => {
      const { items, reply, toasts, write } = setup();
      items.set('a', ann);
      reply('a', conflict(null));

      await write('a', { name: 'Annie' });

      expect(items.has('a')).toBe(false);
      expect(messages(toasts)).toEqual([t('mutate.conflictDeleted', { item: 'Annie' })]);
    });

    it('keeps an item that cannot vanish', async () => {
      const { items, reply, write } = setup({ canVanish: false });
      items.set('a', ann);
      reply('a', conflict(null));

      await write('a', { name: 'Annie' });

      expect(items.get('a')).toEqual(ann);
    });
  });

  describe('when a create gets already-exists (§5.3)', () => {
    it('treats a matching stored item as saved', async () => {
      const { items, reply, stored, toasts, write } = setup();
      const bob = { id: 'b', name: 'Bob', version: 1 };
      reply('b', offline(), alreadyExists());
      stored.set('b', bob);

      await expect(write('b', { name: 'Bob' })).resolves.toEqual({ outcome: 'saved' });
      expect(items.get('b')).toEqual(bob);
      expect(toasts.items).toEqual([]);
    });

    it('treats a stored item that differs as a conflict', async () => {
      const { items, reply, stored, toasts, write } = setup();
      const robert = { id: 'b', name: 'Robert', version: 2 };
      reply('b', alreadyExists());
      stored.set('b', robert);

      await expect(write('b', { name: 'Bob' })).resolves.toEqual({ outcome: 'conflict' });
      expect(items.get('b')).toEqual(robert);
      expect(messages(toasts)).toEqual([t('mutate.conflict', { item: 'Bob' })]);
    });

    it('does not apply to updates', async () => {
      const { items, reply, write } = setup();
      items.set('a', ann);
      reply('a', alreadyExists());

      await expect(write('a', { name: 'Annie' })).resolves.toMatchObject({ outcome: 'failed' });
      expect(items.get('a')).toEqual(ann);
    });
  });

  describe('written()', () => {
    it('lists items with writes pending, and items written since the fetch started', async () => {
      const { queue, items, reply, write } = setup();
      items.set('a', ann);
      const pending = deferred<Item>();
      reply('a', pending.promise);
      reply('b', { id: 'b', name: 'Bob', version: 1 });

      queue.fetchStarted();
      const renaming = write('a', { name: 'Annie' });
      await write('b', { name: 'Bob' });
      const keys = (lanes: TestLane[]) => [...new Set(lanes.map((lane) => lane.key))].sort();
      expect(keys(queue.written())).toEqual(['a', 'b']);

      queue.fetchStarted();
      expect(keys(queue.written())).toEqual(['a']);
      pending.resolve({ id: 'a', name: 'Annie', version: 3 });
      await renaming;
      expect(keys(queue.written())).toEqual(['a']);

      queue.fetchStarted();
      expect(queue.written()).toEqual([]);
    });
  });

  describe('after reset (sign-out)', () => {
    const expectCancelled = async (result: Promise<MutationResult>) => {
      const settled = await result;
      expect(settled.outcome).toBe('failed');
      expect(settled.outcome === 'failed' && settled.error).toBeInstanceOf(CancelledError);
    };

    it('stops a write waiting to retry, sending nothing more', async () => {
      let wake: () => void = () => undefined;
      const backoff = new Promise<void>((resolve) => (wake = resolve));
      const { queue, items, reply, sent, toasts, write } = setup({ sleep: () => backoff });
      items.set('a', ann);
      reply('a', offline(), { ...ann, version: 3 });

      const result = write('a', { name: 'Annie' });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      queue.reset();
      wake();

      await expectCancelled(result);
      expect(sent).toHaveLength(1);
      expect(toasts.items).toEqual([]);
    });

    it('never sends a queued write, and applies no response', async () => {
      const { queue, items, reply, sent, write } = setup();
      items.set('a', ann);
      const pending = deferred<Item>();
      reply('a', pending.promise);

      const first = write('a', { name: 'Annie' });
      const second = write('a', { remove: true });
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      queue.reset();
      items.clear();
      pending.resolve({ id: 'a', name: 'Annie', version: 3 });

      await expectCancelled(first);
      await expectCancelled(second);
      expect(sent).toHaveLength(1);
      expect(items.size).toBe(0);
      expect(queue.written()).toEqual([]);
    });
  });
});

describe('withRetry', () => {
  it('does not retry errors that are not retryable', async () => {
    const call = vi.fn(() => Promise.reject(new Error('bad')));
    const sleep = vi.fn(() => Promise.resolve());

    await expect(withRetry(call, { sleep })).rejects.toThrow('bad');

    expect(call).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network errors and 5xx, then gives up', async () => {
    const call = vi.fn(() => Promise.reject(new ApiError(503, 'internal', 'down')));
    const sleep = vi.fn(() => Promise.resolve());

    await expect(withRetry(call, { sleep, delays: [1, 2] })).rejects.toThrow('down');

    expect(call).toHaveBeenCalledTimes(3);
  });

  it('stops with CancelledError once shouldContinue is false', async () => {
    let going = true;
    const call = vi.fn(() => {
      going = false;
      return Promise.reject(new TypeError('offline'));
    });

    await expect(
      withRetry(call, { sleep: () => Promise.resolve(), shouldContinue: () => going })
    ).rejects.toBeInstanceOf(CancelledError);
    expect(call).toHaveBeenCalledOnce();
  });
});

describe('matches', () => {
  it('compares only the fields sent, by value', () => {
    expect(matches({ name: 'Bob', lines: [{ q: 1 }], version: 3 }, { lines: [{ q: 1 }] })).toBe(
      true
    );
    expect(matches({ name: 'Bob' }, { name: 'Robert' })).toBe(false);
  });
});
