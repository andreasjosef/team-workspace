import { useSyncExternalStore } from 'react';

// A first-visit tour of the support view: four short steps that say what the
// live demo stands in for. It opens on its own once per browser and again
// from "How this works". Each step points at an element marked
// `data-tour="<target>"`; when that isn't on screen, the card sits centred.

export type TourStep = {
  target: string;
  title: string;
  body: string;
};

export const tourSteps: TourStep[] = [
  {
    target: 'inbox',
    title: 'Reports from anywhere',
    body: 'These customer reports are hard-coded so every visitor gets the same demo. In a product they would arrive from wherever support already works: a helpdesk, email, chat or a form.',
  },
  {
    target: 'report',
    title: 'The customer’s own words',
    body: 'The report goes to the agent exactly as the customer wrote it, marked untrusted. It can describe the problem; it can’t change what the agent is allowed to do.',
  },
  {
    target: 'forward',
    title: 'One click to a fix',
    body: 'Forwarding starts an agent in a throwaway sandbox, with no secrets and no network. It reproduces the bug, then fixes it within the support role’s limits.',
  },
  {
    target: 'repo',
    title: 'A real repo behind it',
    body: 'Everything runs against a real GitHub repository. A fix that passes its checks becomes a task branch and a pull request; it reaches main only when a developer merges it.',
  },
];

const KEY = 'sandbugs.tourSeen';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// Whether the tour is open. It starts open unless this browser has seen it;
// closing it, finished or skipped, counts as seen. Storage can be missing or
// throw: then the tour opens on every page load, which is harmless.
export const createTour = (storage: Storage | null) => {
  let open = (() => {
    try {
      return storage?.getItem(KEY) !== '1';
    } catch {
      return true;
    }
  })();
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === open) return;
    open = next;
    for (const l of listeners) l();
  };

  return {
    isOpen: () => open,
    start: () => set(true),
    close: () => {
      try {
        storage?.setItem(KEY, '1');
      } catch {
        // Seen for this page load only.
      }
      set(false);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const tour = createTour(browserStorage());

export const useTourOpen = () =>
  useSyncExternalStore(tour.subscribe, tour.isOpen);

type Box = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };

// Where the card goes, in viewport pixels: beside the target if it fits,
// else below it, else above it, always clamped inside the viewport. No
// target: centred.
export const placeCard = (
  target: Box | null,
  card: Size,
  viewport: Size,
  gap = 14,
  margin = 16
): { top: number; left: number } => {
  const clamp = (v: number, max: number) =>
    Math.max(margin, Math.min(v, max - margin));
  const centre = {
    top: (viewport.height - card.height) / 2,
    left: (viewport.width - card.width) / 2,
  };
  if (!target) return centre;

  const right = target.left + target.width + gap;
  if (right + card.width + margin <= viewport.width) {
    return {
      left: right,
      top: clamp(target.top, viewport.height - card.height),
    };
  }
  const left = clamp(target.left, viewport.width - card.width);
  const below = target.top + target.height + gap;
  if (below + card.height + margin <= viewport.height)
    return { left, top: below };
  const above = target.top - gap - card.height;
  if (above >= margin) return { left, top: above };
  return centre;
};
