// PROTOTYPE, throwaway: floating ←/→ bar that cycles `?variant=`.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export const useVariant = (variants: readonly string[], fallback: string) => {
  const [params] = useSearchParams();
  const v = params.get('variant');
  return v && variants.includes(v) ? v : fallback;
};

export const PrototypeSwitcher = ({
  variants,
  names,
  current,
}: {
  variants: readonly string[];
  names: Record<string, string>;
  current: string;
}) => {
  const [params, setParams] = useSearchParams();
  const go = (step: number) => {
    const i = variants.indexOf(current);
    const next = variants[(i + step + variants.length) % variants.length]!;
    const p = new URLSearchParams(params);
    p.set('variant', next);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el?.closest(
          'input, textarea, [contenteditable=""], [contenteditable="true"]'
        )
      )
        return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;
  return (
    <div className="proto-switcher">
      <button onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {current} ({names[current]})
      </span>
      <button onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
};
