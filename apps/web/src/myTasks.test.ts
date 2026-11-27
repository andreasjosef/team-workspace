import type { TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { createMyTasks, mine, parseIds } from './myTasks.ts';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

describe('myTasks', () => {
  it('remembers forwarded tasks across page loads', () => {
    const storage = memory();
    createMyTasks(storage).add('a');
    expect(createMyTasks(storage).ids()).toEqual(['a']);
  });

  it('adds each task once and notifies listeners', () => {
    const store = createMyTasks(memory());
    let calls = 0;
    store.subscribe(() => calls++);
    store.add('a');
    store.add('a');
    expect(store.ids()).toEqual(['a']);
    expect(calls).toBe(1);
  });

  it('starts over', () => {
    const storage = memory();
    const store = createMyTasks(storage);
    store.add('a');
    store.clear();
    expect(store.ids()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('works in memory when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createMyTasks(broken);
    store.add('a');
    expect(store.ids()).toEqual(['a']);
    expect(createMyTasks(null).ids()).toEqual([]);
  });

  it('ignores garbage in storage', () => {
    expect(parseIds('not json')).toEqual([]);
    expect(parseIds('{"a":1}')).toEqual([]);
    expect(parseIds('["a",1,null,"b"]')).toEqual(['a', 'b']);
  });

  it('keeps only this browser’s tasks', () => {
    const t = (id: string) => ({ id }) as TaskSnapshot;
    expect(mine([t('a'), t('b'), t('c')], ['c', 'a']).map((x) => x.id)).toEqual(
      ['a', 'c']
    );
  });
});
