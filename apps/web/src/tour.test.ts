import { describe, expect, it } from 'vitest';
import { createTour, placeCard } from './tour.ts';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('tour', () => {
  it('opens on the first visit and stays closed once closed', () => {
    const storage = memory();
    const first = createTour(storage);
    expect(first.isOpen()).toBe(true);
    first.close();
    expect(first.isOpen()).toBe(false);
    expect(createTour(storage).isOpen()).toBe(false);
  });

  it('reopens on request and notifies listeners', () => {
    const t = createTour(memory());
    t.close();
    let calls = 0;
    t.subscribe(() => calls++);
    t.start();
    expect(t.isOpen()).toBe(true);
    expect(calls).toBe(1);
  });

  it('opens every time when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const t = createTour(broken);
    expect(t.isOpen()).toBe(true);
    t.close();
    expect(t.isOpen()).toBe(false);
  });
});

describe('placeCard', () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 320, height: 200 };

  it('centres the card without a target', () => {
    expect(placeCard(null, card, viewport)).toEqual({ top: 300, left: 440 });
  });

  it('puts the card beside a target with room to its right', () => {
    const target = { top: 100, left: 20, width: 300, height: 600 };
    expect(placeCard(target, card, viewport)).toEqual({ top: 100, left: 334 });
  });

  it('falls back to below, then above, when the right is full', () => {
    const below = { top: 100, left: 700, width: 480, height: 50 };
    expect(placeCard(below, card, viewport)).toEqual({ top: 164, left: 700 });
    const above = { top: 700, left: 700, width: 480, height: 50 };
    expect(placeCard(above, card, viewport)).toEqual({ top: 486, left: 700 });
  });

  it('keeps the card inside the viewport', () => {
    const target = { top: 750, left: 20, width: 300, height: 40 };
    expect(placeCard(target, card, viewport).top).toBe(584);
  });
});
