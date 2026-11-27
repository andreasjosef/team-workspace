import {
  DIFF_VARIANT_NAMES,
  DIFF_VARIANTS,
  PrototypeDiff,
} from './DiffView.prototype.tsx';
import { PrototypeSwitcher, useVariant } from './PrototypeSwitcher.tsx';

const lineClass = (line: string) => {
  if (
    line.startsWith('diff ') ||
    line.startsWith('+++') ||
    line.startsWith('---')
  )
    return 'file';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('@@')) return 'hunk';
  return '';
};

const CurrentDiffView = ({ diff }: { diff: string }) => (
  <pre className="diff">
    {diff ? (
      diff.split('\n').map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || ' '}
        </div>
      ))
    ) : (
      <div className="muted">No changes.</div>
    )}
  </pre>
);

// PROTOTYPE: `?variant=` swaps in the Linear-like variants (dev only).
export const DiffView = ({ diff }: { diff: string }) => {
  const variant = useVariant(DIFF_VARIANTS, 'A');
  if (!import.meta.env.DEV) return <CurrentDiffView diff={diff} />;
  return (
    <>
      {variant === 'current' ? (
        <CurrentDiffView diff={diff} />
      ) : (
        <PrototypeDiff diff={diff} variant={variant} />
      )}
      <PrototypeSwitcher
        variants={DIFF_VARIANTS}
        names={DIFF_VARIANT_NAMES}
        current={variant}
      />
    </>
  );
};
