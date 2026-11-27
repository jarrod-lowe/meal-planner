import { describe, expect, it } from 'vitest';
import { en, t, translator } from './en';

const fixture = {
  greeting: 'Hello, {name}!',
  nested: { count: '{count} items in {place}' }
} as const;
const tf = translator(fixture);

describe('t', () => {
  it('looks up a nested key in en', () => {
    expect(t('app.title')).toBe(en.app.title);
  });

  it('looks up a top-level and a nested key', () => {
    expect(tf('greeting', { name: 'Sam' })).toBe('Hello, Sam!');
    expect(tf('nested.count', { count: 3, place: 'stock' })).toBe('3 items in stock');
  });

  it('replaces every occurrence of a placeholder', () => {
    const twice = translator({ echo: '{x} and {x}' });
    expect(twice('echo', { x: 'a' })).toBe('a and a');
  });

  it('leaves a placeholder with no matching param as-is', () => {
    expect(tf('greeting')).toBe('Hello, {name}!');
    expect(tf('greeting', { other: 'x' })).toBe('Hello, {name}!');
  });

  it('rejects unknown keys at compile time', () => {
    // @ts-expect-error: 'app.nope' is not a message key.
    t('app.nope');
    // @ts-expect-error: 'app' is a group, not a message.
    t('app');
    // @ts-expect-error: 'nested' is a group, not a message.
    tf('nested');
  });
});
