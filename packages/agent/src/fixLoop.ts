import { fail, ok, type Result } from '@app/shared';
import type { CheckCounts } from './checks.ts';
import { isCreate, isTestPath, type EditsResponse } from './edits.ts';
import { decide, defaultStopRules, type StopRules } from './stop.ts';

// The loop, with every side effect passed in: the hub wires the sandbox, the
// LLM and the role policy; tests pass fakes. The LLM proposes, the sandbox
// decides: a patch only counts if the next check says so.
//
// Unlike an upgrade, a task starts green: nothing is broken until the agent
// changes something. So "done" is green *and* at least one applied proposal.
//
// A bug task goes in two steps, and the step comes from the loop's state,
// never from the task text:
// - reproduce: the answer may only create new test files. They're applied
//   and checked; the loop goes on only if more tests fail than at the
//   baseline. Otherwise they're discarded and the answer is rejected.
// - fix: anything the role's scope allows, except the reproduction.
// So the curve shows the reproduction failing before the fix lands.

export type CheckOutcome = CheckCounts & { errors: string };

export type TaskStep = 'reproduce' | 'fix';

export type TaskLoopDeps = {
  check: () => Promise<CheckOutcome>;
  // The result of a check the caller already ran on the unchanged worktree
  // (the hub's baseline). Given, the loop starts from it instead of checking.
  first?: CheckOutcome;
  propose: (state: {
    latest: CheckOutcome;
    applied: number;
    lastRejection?: string;
    // Bug tasks only: which step the answer is for, and once reproduced,
    // the reproduction's paths.
    step?: TaskStep;
    reproduction?: string[];
  }) => Promise<Result<EditsResponse>>;
  // The role's scope, checked on every answer before the step's own rule.
  // A refusal is a Failure with the reason.
  checkScope?: (edits: EditsResponse['edits']) => Result<unknown>;
  // Role policy + guardrails + write. A refusal is a Failure with the reason.
  apply: (edits: EditsResponse['edits']) => Promise<Result<unknown>>;
  // Given, the task is a bug: reproduce first, then fix. `discard` removes
  // the files of a reproduction that didn't fail.
  reproduce?: { discard: (paths: string[]) => Promise<void> };
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

const norm = (path: string) => path.replaceAll('\\', '/');

// The answer the loop goes on with, before anything is applied: valid, in
// the role's scope, then allowed in this step. Scope comes first, so a step
// never hides an out-of-scope edit from the policy (and its refusal count).
const vetAnswer = (
  proposal: Result<EditsResponse>,
  checkScope: TaskLoopDeps['checkScope'],
  step: TaskStep | undefined,
  reproduction: string[]
): Result<EditsResponse> => {
  if (!proposal.success) return proposal;
  const answer = proposal.value;
  const scope = checkScope?.(answer.edits);
  if (scope && !scope.success) return scope;
  const { edits } = answer;
  if (step === 'reproduce') {
    const other = edits.filter((e) => !isCreate(e) || !isTestPath(e.path));
    return other.length
      ? fail(
          'invalid',
          `First reproduce the problem: this answer may add only new test files, and the fix comes once that test fails. Not allowed yet: ${other.map((e) => e.path).join(', ')}`
        )
      : ok(answer);
  }
  if (step === 'fix') {
    const repro = new Set(reproduction.map(norm));
    const touched = edits.filter((e) => repro.has(norm(e.path)));
    return touched.length
      ? fail(
          'invalid',
          `The reproduction must not change: ${touched.map((e) => e.path).join(', ')}`
        )
      : ok(answer);
  }
  return ok(answer);
};

export const runTaskLoop = async (
  deps: TaskLoopDeps
): Promise<TaskLoopResult> => {
  const rules = deps.rules ?? defaultStopRules;
  let latest = deps.first ?? (await deps.check());
  const history: CheckCounts[] = [latest];
  deps.onIteration(0, latest);
  let lastRejection: string | undefined;
  let applied = 0;
  let step: TaskStep | undefined = deps.reproduce ? 'reproduce' : undefined;
  let reproduction: string[] = [];
  // Where the stop rules start counting: the reproduction raises the count on
  // purpose, so "stopped falling" is measured from its check on.
  let since = 0;

  for (;;) {
    const n = history.length;
    const halted = deps.halt?.();
    if (halted)
      return { status: 'halted', reason: halted, iterations: n - 1, applied };

    const decision = decide(history.slice(since), deps.baseline, rules);
    if (decision.stop && (decision.status === 'gave_up' || applied > 0)) {
      return { ...decision, iterations: n - 1, applied };
    }
    if (n - 1 >= rules.maxIterations) {
      return {
        status: 'gave_up',
        reason: applied
          ? `reached ${rules.maxIterations} iterations`
          : 'no proposal was accepted',
        iterations: n - 1,
        applied,
      };
    }

    const proposal = await deps.propose({
      latest,
      applied,
      ...(lastRejection ? { lastRejection } : {}),
      ...(step ? { step } : {}),
      ...(reproduction.length ? { reproduction } : {}),
    });
    // An invalid answer or a refused patch still uses up an iteration, with
    // the counts unchanged, so a model that keeps failing hits the stop rules.
    const answer = vetAnswer(proposal, deps.checkScope, step, reproduction);
    if (!answer.success) {
      lastRejection = answer.message;
      deps.onNote?.(`Iteration ${n}: answer rejected (${answer.message})`);
    } else {
      deps.onNote?.(
        `Iteration ${n}: ${answer.value.reasoning ?? 'applying edits'}`
      );
      const { edits } = answer.value;
      const result = await deps.apply(edits);
      if (!result.success) {
        lastRejection = result.message;
        deps.onNote?.(`Iteration ${n}: patch refused (${result.message})`);
      } else {
        latest = await deps.check();
        if (
          step === 'reproduce' &&
          latest.testsFailed <= deps.baseline.testsFailed
        ) {
          // Shown in the curve like any check, then taken out again: a test
          // that passes reproduces nothing and never reaches the diff.
          const paths = edits.map((e) => e.path);
          await deps.reproduce?.discard(paths);
          lastRejection = `the reproduction must fail before the fix, but no more tests failed than before (${latest.testsFailed}). Discarded: ${paths.join(', ')}`;
          deps.onNote?.(`Iteration ${n}: answer rejected (${lastRejection})`);
        } else {
          lastRejection = undefined;
          applied++;
          if (step === 'reproduce') {
            step = 'fix';
            reproduction = edits.map((e) => e.path);
            since = n;
          }
        }
      }
    }
    history.push({
      typeErrors: latest.typeErrors,
      testsFailed: latest.testsFailed,
    });
    deps.onIteration(n, latest);
  }
};
