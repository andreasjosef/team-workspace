import type { CheckCounts } from './checks.ts';

// The spec's stop rules, as one pure function: green, or the error count
// stopped falling for `patience` iterations, or the iteration cap. An
// iteration is a check that ran in the sandbox. `maxModelCalls` caps every
// model call, rejected answers included; the fix loop applies it, since a
// rejected answer never reaches the history this function reads.

export type StopRules = {
  maxIterations: number;
  patience: number;
  maxModelCalls: number;
};
export const defaultStopRules: StopRules = {
  maxIterations: 6,
  patience: 2,
  maxModelCalls: 10,
};

export type Decision =
  { stop: false } | { stop: true; status: 'green' | 'gave_up'; reason: string };

const total = (c: CheckCounts) => c.typeErrors + c.testsFailed;

// green = no new type errors and no more failing tests than before the
// upgrade, so a repo that was already red isn't blamed on the upgrade.
export const isGreen = (now: CheckCounts, baseline: CheckCounts) =>
  now.typeErrors <= baseline.typeErrors &&
  now.testsFailed <= baseline.testsFailed;

// history[0] is the state right after the install, before any fix.
export const decide = (
  history: CheckCounts[],
  baseline: CheckCounts,
  rules: Pick<StopRules, 'maxIterations' | 'patience'> = defaultStopRules
): Decision => {
  const last = history.at(-1);
  if (!last) return { stop: false };
  if (isGreen(last, baseline))
    return { stop: true, status: 'green', reason: 'all checks pass' };
  const fixes = history.length - 1;
  if (fixes >= rules.maxIterations) {
    return {
      stop: true,
      status: 'gave_up',
      reason: `reached ${rules.maxIterations} iterations`,
    };
  }
  if (fixes >= rules.patience) {
    const best = Math.min(...history.slice(0, -rules.patience).map(total));
    const recent = history.slice(-rules.patience).map(total);
    if (recent.every((t) => t >= best)) {
      return {
        stop: true,
        status: 'gave_up',
        reason: `error count stopped falling for ${rules.patience} iterations`,
      };
    }
  }
  return { stop: false };
};
