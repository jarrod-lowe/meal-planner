import { describe, expect, it, vi } from 'vitest';
import { Combobox } from './combobox.svelte.js';

// Node has no KeyboardEvent; the class only reads `key` and calls `preventDefault()`.
function key(name: string) {
  const event = {
    key: name,
    defaultPrevented: false,
    preventDefault: () => (event.defaultPrevented = true)
  };
  return event;
}

function setup(count = 3) {
  const choose = vi.fn();
  return { box: new Combobox(() => count, choose), choose };
}

describe('Combobox', () => {
  it('opens on input with nothing active', () => {
    const { box } = setup();
    box.input();
    expect(box.open).toBe(true);
    expect(box.active).toBe(-1);
  });

  it('ArrowDown starts at the first option and wraps; ArrowUp starts at the last', () => {
    const { box } = setup();
    box.keydown(key('ArrowDown'));
    expect([box.open, box.active]).toEqual([true, 0]);
    box.keydown(key('ArrowDown'));
    box.keydown(key('ArrowDown'));
    box.keydown(key('ArrowDown'));
    expect(box.active).toBe(0);
    box.close();
    box.keydown(key('ArrowUp'));
    expect(box.active).toBe(2);
  });

  it('Enter chooses the active option and closes', () => {
    const { box, choose } = setup();
    box.input();
    const unused = key('Enter');
    expect(box.keydown(unused)).toBe(false);
    expect(unused.defaultPrevented).toBe(false);
    box.keydown(key('ArrowDown'));
    box.keydown(key('ArrowDown'));
    const enter = key('Enter');
    expect(box.keydown(enter)).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(choose).toHaveBeenCalledWith(1);
    expect(box.open).toBe(false);
  });

  it('Escape closes an open list, and is left alone when closed', () => {
    const { box } = setup();
    expect(box.keydown(key('Escape'))).toBe(false);
    box.input();
    expect(box.keydown(key('Escape'))).toBe(true);
    expect(box.open).toBe(false);
  });

  it('ignores arrows with no options', () => {
    const { box } = setup(0);
    expect(box.keydown(key('ArrowDown'))).toBe(false);
    expect(box.open).toBe(false);
  });
});
