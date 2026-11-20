import type { Result } from '@app/shared';
import type { CheckCounts } from './checks.ts';
import type { EditsResponse } from './edits.ts';
import { decide, defaultStopRules, type StopRules } from './stop.ts';

// The loop, with every side effect passed in: the hub wires the sandbox, the
// LLM and the role policy; tests pass fakes. The LLM proposes, the sandbox
// decides: a patch only counts if the next check says so.
//
// Unlike an upgrade, a task starts green: nothing is broken until the agent
// changes something. So "done" is green *and* at least one applied proposal.

export type CheckOutcome = CheckCounts & { errors: string };

export type TaskLoopDeps = {
  check: () => Promise<CheckOutcome>;
  propose: (state: {
    latest: CheckOutcome;
    applied: number;
    lastRejection?: string;
  }) => Promise<Result<EditsResponse>>;
  // Role policy + guardrails + write. A refusal is a Failure with the reason.
  apply: (edits: EditsResponse['edits']) => Promise<Result<unknown>>;
  // Checked before every proposal: a reason stops the loop as `halted` (the
  // hub uses it for "too many policy refusals").
  halt?: () => string | null;
  onIteration: (n: number, counts: CheckCounts) => void;
  onNote?: (note: string) => void;
  baseline: CheckCounts;
  rules?: StopRules;
};

export type TaskLoopResult = {
  status: 'green' | 'gave_up' | 'halted';
  reason: string;
  iterations: number;
  applied: number;
};

export const runTaskLoop = async (
  deps: TaskLoopDeps
): Promise<TaskLoopResult> => {
  const rules = deps.rules ?? defaultStopRules;
  let latest = await deps.check();
  const history: CheckCounts[] = [latest];
  deps.onIteration(0, latest);
  let lastRejection: string | undefined;
  let applied = 0;

  for (;;) {
    const n = history.length;
    const halted = deps.halt?.();
    if (halted)
      return { status: 'halted', reason: halted, iterations: n - 1, applied };

    const decision = decide(history, deps.baseline, rules);
    if (decision.stop && (decision.status === 'gave_up' || applied > 0)) {
      return { ...decision, iterations: n - 1, applied };
    }
    if (n - 1 >= rules.maxIterations) {
      return {
        status: 'gave_up',
        reason: 'no proposal was accepted',
        iterations: n - 1,
        applied,
      };
    }

    const proposal = await deps.propose({
      latest,
      applied,
      ...(lastRejection ? { lastRejection } : {}),
    });
    // An invalid answer or a refused patch still uses up an iteration, with
    // the counts unchanged, so a model that keeps failing hits the stop rules.
    if (!proposal.success) {
      lastRejection = proposal.message;
      deps.onNote?.(`Iteration ${n}: answer rejected (${proposal.message})`);
    } else {
      deps.onNote?.(
        `Iteration ${n}: ${proposal.value.reasoning ?? 'applying edits'}`
      );
      const result = await deps.apply(proposal.value.edits);
      if (!result.success) {
        lastRejection = result.message;
        deps.onNote?.(`Iteration ${n}: patch refused (${result.message})`);
      } else {
        lastRejection = undefined;
        applied++;
        latest = await deps.check();
      }
    }
    history.push({
      typeErrors: latest.typeErrors,
      testsFailed: latest.testsFailed,
    });
    deps.onIteration(n, latest);
  }
};
