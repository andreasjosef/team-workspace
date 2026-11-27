import type { IterationSummary, TaskSnapshot } from '@app/shared';

type StepKind =
  | 'baseline'
  | 'repro'
  | 'pass'
  | 'failing'
  | 'refused'
  | 'rejected'
  | 'blocked';

type StepRow = {
  n: number;
  label: string;
  shortLabel: string;
  kind: StepKind;
  badge: string;
  detail: string;
  typeErrors: number;
  testsFailed: number;
  ranCheck: boolean;
};

const classifySteps = (task: TaskSnapshot): StepRow[] => {
  const baseline = task.iterations[0];
  const baseFails = baseline?.testsFailed ?? 0;
  const lastIdx = task.iterations.length - 1;
  const hasBlocked = task.blocked.length > 0;
  let sawRepro = false;

  return task.iterations.map((it: IterationSummary, idx: number) => {
    const label = it.n === 0 ? 'baseline' : `step ${it.n}`;
    const shortLabel = it.n === 0 ? 'base' : `#${it.n}`;
    const filesSummary = it.proposed?.length
      ? it.proposed.map((p) => `${p.create ? 'new ' : ''}${p.path}`).join(', ')
      : '';

    if (it.n === 0) {
      const clean = it.typeErrors === 0 && it.testsFailed === 0;
      return {
        n: it.n,
        label,
        shortLabel,
        kind: clean ? 'baseline' : 'failing',
        badge: clean ? 'Baseline green' : 'Baseline red',
        detail: clean
          ? 'tsc + vitest passed before any edits'
          : `${it.typeErrors} type error${it.typeErrors === 1 ? '' : 's'}, ${it.testsFailed} failing test${it.testsFailed === 1 ? '' : 's'} at start`,
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: true,
      };
    }

    if (it.refused?.length) {
      const first = it.refused[0]!;
      const extra =
        it.refused.length > 1 ? ` (+${it.refused.length - 1} more)` : '';
      return {
        n: it.n,
        label,
        shortLabel,
        kind: 'refused',
        badge: 'Policy refused',
        detail: `${first.path} (${first.rule})${extra}`,
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: false,
      };
    }

    if (it.rejected) {
      return {
        n: it.n,
        label,
        shortLabel,
        kind: 'rejected',
        badge: 'Rejected',
        detail: it.rejected,
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: false,
      };
    }

    if (hasBlocked && idx === lastIdx) {
      return {
        n: it.n,
        label,
        shortLabel,
        kind: 'blocked',
        badge: 'Blocked',
        detail: task.blocked[0] ?? 'Sandbox blocked a network attempt',
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: true,
      };
    }

    if (!sawRepro && it.testsFailed > baseFails) {
      sawRepro = true;
      return {
        n: it.n,
        label,
        shortLabel,
        kind: 'repro',
        badge: 'Reproduced',
        detail: filesSummary || 'New failing test confirmed the bug',
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: true,
      };
    }

    if (it.typeErrors === 0 && it.testsFailed === 0) {
      return {
        n: it.n,
        label,
        shortLabel,
        kind: 'pass',
        badge: 'Passed',
        detail: filesSummary || 'All type checks and tests pass',
        typeErrors: it.typeErrors,
        testsFailed: it.testsFailed,
        ranCheck: true,
      };
    }

    return {
      n: it.n,
      label,
      shortLabel,
      kind: 'failing',
      badge: 'Still failing',
      detail: filesSummary || 'Checks still reporting failures',
      typeErrors: it.typeErrors,
      testsFailed: it.testsFailed,
      ranCheck: true,
    };
  });
};

const W = 640;
const H = 164;
const PAD_L = 36;
const PAD_R = 28;
const PAD_T = 26;
const PAD_B = 34;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const toneOf = (kind: StepKind): string => {
  switch (kind) {
    case 'baseline':
    case 'pass':
      return 'green';
    case 'repro':
      return 'gold';
    case 'refused':
    case 'rejected':
    case 'blocked':
    case 'failing':
      return 'red';
  }
};

export const ChecksView = ({ task }: { task: TaskSnapshot }) => {
  if (task.iterations.length === 0) {
    return <p className="empty">Not run yet</p>;
  }

  const steps = classifySteps(task);
  const maxFail = Math.max(0, ...steps.map((s) => s.testsFailed));
  const maxType = Math.max(0, ...steps.map((s) => s.typeErrors));
  const maxY = Math.max(2, maxFail, maxType);
  const hasTypeErrors = maxType > 0;

  const xOf = (i: number) =>
    steps.length === 1
      ? PAD_L + PLOT_W / 2
      : PAD_L + (i / (steps.length - 1)) * PLOT_W;
  const yOf = (v: number) => PAD_T + PLOT_H - (v / maxY) * PLOT_H;
  const baseY = yOf(0);

  const failPoints = steps
    .map((s, i) => `${xOf(i)},${yOf(s.testsFailed)}`)
    .join(' ');
  const failArea =
    steps.length > 1
      ? `M ${xOf(0)},${baseY} ${steps
          .map((s, i) => `L ${xOf(i)},${yOf(s.testsFailed)}`)
          .join(' ')} L ${xOf(steps.length - 1)},${baseY} Z`
      : '';
  const typePoints = steps
    .map((s, i) => `${xOf(i)},${yOf(s.typeErrors)}`)
    .join(' ');

  const yTicks =
    maxY <= 3
      ? [0, 1, maxY].filter((v, i, a) => a.indexOf(v) === i)
      : [0, Math.ceil(maxY / 2), maxY];

  const reproStep = steps.find((s) => s.kind === 'repro');
  const refusedCount = steps.filter(
    (s) => s.kind === 'refused' || s.kind === 'rejected'
  ).length;
  const lastStep = steps[steps.length - 1]!;
  const ranCount = steps.filter((s) => s.ranCheck).length;

  return (
    <div className="checks-view">
      <div className="checks-stats">
        <div className="checks-stat">
          <span className="checks-stat-label">Baseline</span>
          <span className="checks-stat-value">
            {steps[0]!.typeErrors === 0 && steps[0]!.testsFailed === 0
              ? 'Clean (0)'
              : `${steps[0]!.typeErrors} err · ${steps[0]!.testsFailed} fail`}
          </span>
        </div>
        <div className="checks-stat">
          <span className="checks-stat-label">Reproduction</span>
          <span
            className={`checks-stat-value ${reproStep ? 'tone-gold' : 'muted'}`}
          >
            {reproStep
              ? `${reproStep.testsFailed} failing test${reproStep.testsFailed === 1 ? '' : 's'}`
              : 'None'}
          </span>
        </div>
        <div className="checks-stat">
          <span className="checks-stat-label">Checks run</span>
          <span className="checks-stat-value">
            {ranCount} of {steps.length}
            {refusedCount > 0 ? ` (${refusedCount} stopped)` : ''}
          </span>
        </div>
        <div className="checks-stat">
          <span className="checks-stat-label">Outcome</span>
          <span className={`checks-stat-value tone-${toneOf(lastStep.kind)}`}>
            {lastStep.badge}
          </span>
        </div>
      </div>

      <div className="checks-chart-card">
        <div className="checks-chart-head">
          <span className="checks-chart-title">Check curve</span>
          <div className="checks-legend">
            <span className="checks-legend-item">
              <i className="checks-swatch checks-swatch-fail" /> Failing tests
            </span>
            {hasTypeErrors && (
              <span className="checks-legend-item">
                <i className="checks-swatch checks-swatch-type" /> Type errors
              </span>
            )}
            {refusedCount > 0 && (
              <span className="checks-legend-item">
                <i className="checks-swatch checks-swatch-stopped" /> Stopped
                before check
              </span>
            )}
          </div>
        </div>

        <svg
          className="checks-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Test failures and check outcomes across iterations"
        >
          {yTicks.map((v) => {
            const y = yOf(v);
            return (
              <g key={v}>
                <line
                  className={v === 0 ? 'checks-grid-zero' : 'checks-grid'}
                  x1={PAD_L}
                  y1={y}
                  x2={W - PAD_R}
                  y2={y}
                />
                <text className="checks-axis-y" x={PAD_L - 10} y={y + 3.5}>
                  {v}
                </text>
              </g>
            );
          })}

          {failArea && maxFail > 0 && (
            <path className="checks-area" d={failArea} />
          )}

          {steps.length > 1 && (
            <polyline className="checks-line-fail" points={failPoints} />
          )}

          {hasTypeErrors && steps.length > 1 && (
            <polyline className="checks-line-type" points={typePoints} />
          )}

          {steps.map((s, i) => {
            const x = xOf(i);
            const y = yOf(s.testsFailed);
            const tone = toneOf(s.kind);
            const stopped =
              s.kind === 'refused' ||
              s.kind === 'rejected' ||
              s.kind === 'blocked';
            const topLabel = stopped
              ? s.kind === 'blocked'
                ? 'blocked'
                : s.kind === 'refused'
                  ? 'refused'
                  : 'rejected'
              : s.kind === 'repro'
                ? `repro (${s.testsFailed})`
                : s.kind === 'pass'
                  ? 'pass'
                  : s.n === 0
                    ? `${s.testsFailed}`
                    : `${s.testsFailed}`;

            return (
              <g key={s.n} className={`checks-point checks-point-${tone}`}>
                {stopped ? (
                  <>
                    <circle
                      className="checks-dot-stopped"
                      cx={x}
                      cy={y}
                      r="7"
                    />
                    <path
                      className="checks-dot-x"
                      d={`M ${x - 3} ${y - 3} L ${x + 3} ${y + 3} M ${x + 3} ${y - 3} L ${x - 3} ${y + 3}`}
                    />
                  </>
                ) : (
                  <>
                    <circle className="checks-dot-halo" cx={x} cy={y} r="8" />
                    <circle className="checks-dot" cx={x} cy={y} r="4.5" />
                  </>
                )}
                <text className="checks-point-tag" x={x} y={y - 12}>
                  {topLabel}
                </text>
                <text className="checks-axis-x" x={x} y={H - 10}>
                  {s.shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ol className="checks-steps">
        {steps.map((s) => (
          <li key={s.n} className="checks-step">
            <span className="checks-step-num">{s.label}</span>
            <span
              className={`checks-step-badge checks-badge-${toneOf(s.kind)}`}
            >
              {s.badge}
            </span>
            <span className="checks-step-detail">{s.detail}</span>
            <span className="checks-step-counts">
              {s.ranCheck ? (
                <>
                  <span>{s.typeErrors} TS</span>
                  <span className={s.testsFailed > 0 ? 'tone-red' : ''}>
                    {s.testsFailed} fail
                  </span>
                </>
              ) : (
                <span className="muted">not run</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
