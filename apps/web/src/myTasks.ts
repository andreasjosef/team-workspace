import type { TaskSnapshot } from '@app/shared';
import { useSyncExternalStore } from 'react';

// The live demo has no accounts, and every visitor shares the hub's tasks.
// So each browser remembers the tasks it forwarded, and the support view
// shows only those: a new visitor finds every report untouched. "Start
// over" forgets them. This is about what a view shows, not privacy: the
// hub still lists every task to anyone who asks.

const KEY = 'sandbugs.myTasks';
const MAX = 200; // the hub forgets older tasks anyway

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Storage can be missing or throw (private windows, blocked site data).
// Then the list lives only as long as the page.
const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const parseIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
};

export const createMyTasks = (storage: Storage | null) => {
  let ids: string[] = (() => {
    try {
      return parseIds(storage?.getItem(KEY) ?? null);
    } catch {
      return [];
    }
  })();
  const listeners = new Set<() => void>();

  const set = (next: string[]) => {
    ids = next;
    try {
      if (next.length) storage?.setItem(KEY, JSON.stringify(next));
      else storage?.removeItem(KEY);
    } catch {
      // Kept in memory only.
    }
    for (const l of listeners) l();
  };

  return {
    ids: () => ids,
    add: (id: string) => {
      if (!ids.includes(id)) set([...ids, id].slice(-MAX));
    },
    clear: () => set([]),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const mine = (tasks: TaskSnapshot[], ids: string[]) => {
  const own = new Set(ids);
  return tasks.filter((t) => own.has(t.id));
};

export const myTasks = createMyTasks(browserStorage());

export const useMyTaskIds = () =>
  useSyncExternalStore(myTasks.subscribe, myTasks.ids);
