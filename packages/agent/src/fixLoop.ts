import { fail, ok, type Result } from '@app/shared';
import type { CheckCounts } from './checks.ts';
import {
  isCreate,
  isStop,
  isTestPath,
  slashPath,
  type Answer,
  type EditsResponse,
} from './edits.ts';
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
//   and checked; the loop goes on only if the check shows the bug (see
//   reproductionGate). Otherwise they're discarded and the answer is
//   rejected.
// - fix: anything the role's scope allows, except the reproduction.
// So the curve shows the reproduction failing before the fix lands.

// `someTestFailed`: at least one test ran and failed, as opposed to a suite
// that didn't load or a run that crashed (see checks.ts).
export type CheckOutcome = CheckCounts & {
  someTestFailed: boolean;
  errors: string;
};

export type TaskStep = 'reproduce' | 'fix';

type LoopDeps = {
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
  }) => Promise<Result<Answer>>;
  // The role's scope, checked on every answer before the step's own rule.
  // A refusal is a Failure with the reason.
  checkScope?: (edits: EditsResponse['edits']) => Result<unknown>;
  // Role policy + guardrails + write. A refusal is a Failure with the reason.
  apply: (edits: EditsResponse['edits']) => Promise<Result<unknown>>;
  // Checked before every proposal: a reason stops the loop as `halted` (the
  // hub uses it for "too many policy refusals").
  halt?: () => string | null;
  // Once per check that ran in the sandbox (0 is the baseline). An answer
  // refused before the sandbox gets notes, never an iteration. `rejected`:
  // the check ran, then its answer wasn't taken (a reproduction that didn't
  // show the bug and was discarded), and why.
  onIteration: (n: number, counts: CheckCounts, rejected?: string) => void;
  // Log text: `Model call k: …` for each answer and why it was rejected;
  // `Iteration n: answer rejected (…)` for a discarded reproduction. Only
  // for the log: anything the caller acts on comes as an argument above.
  onNote?: (note: string) => void;
  baseline: CheckCounts;
  // The stop rules and the model-call cap (stop.ts).
  rules?: StopRules;
};

export type TaskLoopDeps = LoopDeps &
  (
    | { reproduceFirst?: false }
    | {
        // A bug: reproduce first, then fix. The caller decides from the
        // validated task kind, never from the task text.
        reproduceFirst: true;
        // Takes out the files of a reproduction that didn't fail. A Failure
        // says what couldn't be taken out.
        discard: (paths: string[]) => Promise<Result<unknown>>;
      }
  );

// Where a bug task is. Once reproduced: the reproduction's paths, and the
// iteration whose check it raised the count at. The stop rules count from
// there, since the reproduction raised the count on purpose.
type BugState =
  | { step: 'reproduce' }
  | { step: 'fix'; reproduction: string[]; since: number };

// `stopped`: the model answered "stop" (it won't change anything), and
// `reason` is its reason, capped at MAX_STOP_REASON_CHARS.
export type TaskLoopResult = {
  status: 'green' | 'gave_up' | 'halted' | 'stopped';
  reason: string;
  // Checks that ran in the sandbox after the baseline.
  iterations: number;
  applied: number;
  // Every answer asked for, rejected ones included.
  modelCalls: number;
};

export const MAX_STOP_REASON_CHARS = 500;

const capReason = (reason: string) => {
  const text = reason.trim();
  return text.length > MAX_STOP_REASON_CHARS
    ? `${text.slice(0, MAX_STOP_REASON_CHARS)}…`
    : text;
};

// The answer the loop goes on with, before anything is applied: valid, in
// the role's scope, then allowed in this step. Scope comes first, so a step
// never hides an out-of-scope edit from the policy (and its refusal count).
const vetAnswer = (
  answer: EditsResponse,
  checkScope: TaskLoopDeps['checkScope'],
  bug: BugState | undefined
): Result<EditsResponse> => {
  const scope = checkScope?.(answer.edits);
  if (scope && !scope.success) return scope;
  const { edits } = answer;
  if (bug?.step === 'reproduce') {
    const other = edits.filter((e) => !isCreate(e) || !isTestPath(e.path));
    return other.length
      ? fail(
          'invalid',
          `First reproduce the problem: this answer may add only new test files, and the fix comes once that test fails. Not allowed yet: ${other.map((e) => e.path).join(', ')}`
        )
      : ok(answer);
  }
  if (bug?.step === 'fix') {
    const repro = new Set(bug.reproduction.map(slashPath));
    const touched = edits.filter((e) => repro.has(slashPath(e.path)));
    return touched.length
      ? fail(
          'invalid',
          `The reproduction must not change: ${touched.map((e) => e.path).join(', ')}`
        )
      : ok(answer);
  }
  return ok(answer);
};

// Whether a reproduction's check shows the bug: more tests fail than at the
// baseline, no new type errors (the reproduction gets locked, and a type
// error in it would keep the run from ever going green), and a test really
// failed (a test file that doesn't load counts as a failure too, but
// reproduces nothing). A crash in the code under test fails a test, so it
// passes. Decided on the loop's state and the check alone. Null when
// accepted, otherwise why not, for the model.
export const reproductionGate = (
  latest: CheckOutcome,
  baseline: CheckCounts
): string | null => {
  const broken: string[] = [];
  // "No test failed" only says more when the count did rise: otherwise
  // "no more tests failed" already covers it.
  if (latest.testsFailed <= baseline.testsFailed)
    broken.push(
      `the reproduction must fail before the fix, but no more tests failed than before (${latest.testsFailed}).`
    );
  else if (!latest.someTestFailed)
    broken.push(
      'the reproduction must fail a test, but no test failed: a test file did not load, or the run crashed before any test ran.'
    );
  if (latest.typeErrors > baseline.typeErrors)
    broken.push(
      `the reproduction must not add type errors, but there are ${latest.typeErrors} (${baseline.typeErrors} before). Fix the test's types.`
    );
  if (!broken.length) return null;
  return [
    ...broken,
    ...(latest.errors ? [`Current errors:\n${latest.errors}`] : []),
  ].join('\n');
};

export const runTaskLoop = async (
  deps: TaskLoopDeps
): Promise<TaskLoopResult> => {
  const rules = deps.rules ?? defaultStopRules;
  let latest = deps.first ?? (await deps.check());
  // One row per check that ran in the sandbox, the baseline first. An answer
  // refused before the sandbox adds no row: the curve, patience and the
  // iteration cap see only checks that ran.
  const history: CheckCounts[] = [latest];
  deps.onIteration(0, latest);
  let lastRejection: string | undefined;
  let applied = 0;
  let modelCalls = 0;
  let bug: BugState | undefined = deps.reproduceFirst
    ? { step: 'reproduce' }
    : undefined;

  for (;;) {
    const n = history.length;
    const end = { iterations: n - 1, applied, modelCalls };
    const halted = deps.halt?.();
    if (halted) return { status: 'halted', reason: halted, ...end };

    // Each step has its own budget of checks, counted from the check it
    // started at: the fix step from the accepted reproduction's. Discarded
    // reproductions stay on the curve but never use up the fix step's
    // checks or patience (spec #41, story 12).
    const since = bug?.step === 'fix' ? bug.since : 0;
    // The stop rules don't apply while reproducing: a reproduction raises
    // the count on purpose, so "stopped falling" means nothing there, and a
    // green check isn't done before anything was accepted. The step's
    // check cap and the model-call cap bound it.
    if (bug?.step !== 'reproduce') {
      const decision = decide(history.slice(since), deps.baseline, rules);
      if (decision.stop && (decision.status === 'gave_up' || applied > 0)) {
        return { ...decision, ...end };
      }
    }
    if (n - 1 - since >= rules.maxIterations) {
      return {
        status: 'gave_up',
        reason: applied
          ? `reached ${rules.maxIterations} iterations`
          : 'no proposal was accepted',
        ...end,
      };
    }
    // Rejected answers use no iteration, so this cap is what bounds a model
    // that keeps answering outside the rules (and what a run costs).
    if (modelCalls >= rules.maxModelCalls) {
      return {
        status: 'gave_up',
        reason: `reached the cap of ${rules.maxModelCalls} model calls${applied ? '' : ' with no proposal accepted'}`,
        ...end,
      };
    }

    modelCalls++;
    const call = `Model call ${modelCalls}`;
    const proposal = await deps.propose({
      latest,
      applied,
      ...(lastRejection ? { lastRejection } : {}),
      ...(bug ? { step: bug.step } : {}),
      ...(bug?.step === 'fix' ? { reproduction: bug.reproduction } : {}),
    });
    // A valid stop ends the loop at once, in either step, and never counts
    // as green, even after an applied fix. It carries no edits, so there's
    // nothing for the policy to check.
    let answer: Result<EditsResponse>;
    if (!proposal.success) answer = proposal;
    else {
      const value = proposal.value;
      if (isStop(value)) {
        const reason = capReason(value.reason);
        if (value.reasoning) deps.onNote?.(`${call}: ${value.reasoning}`);
        deps.onNote?.(`${call}: stopped (${reason})`);
        return { status: 'stopped', reason, ...end, modelCalls };
      }
      deps.onNote?.(`${call}: ${value.reasoning ?? 'proposing edits'}`);
      answer = vetAnswer(value, deps.checkScope, bug);
    }
    // An invalid answer or a refused patch never reaches the sandbox: it adds
    // no check, and the model hears why on its next call.
    if (!answer.success) {
      lastRejection = answer.message;
      deps.onNote?.(`${call}: answer rejected (${answer.message})`);
      continue;
    }
    const { edits } = answer.value;
    const result = await deps.apply(edits);
    if (!result.success) {
      lastRejection = result.message;
      deps.onNote?.(`${call}: patch refused (${result.message})`);
      continue;
    }
    latest = await deps.check();
    let rejected: string | undefined;
    const refused =
      bug?.step === 'reproduce'
        ? reproductionGate(latest, deps.baseline)
        : null;
    if (deps.reproduceFirst && refused) {
      // A check that ran, so it's in the curve like any other, then taken
      // out again: a test that doesn't show the bug never reaches the diff.
      const paths = edits.map((e) => e.path);
      const discarded = await deps.discard(paths);
      lastRejection = `${refused}\n${discarded.success ? `Discarded: ${paths.join(', ')}` : `Not all discarded: ${discarded.message}`}`;
      rejected = lastRejection;
      deps.onNote?.(`Iteration ${n}: answer rejected (${lastRejection})`);
    } else {
      lastRejection = undefined;
      applied++;
      if (bug?.step === 'reproduce') {
        bug = {
          step: 'fix',
          reproduction: edits.map((e) => e.path),
          since: n,
        };
      }
    }
    history.push({
      typeErrors: latest.typeErrors,
      testsFailed: latest.testsFailed,
    });
    deps.onIteration(n, latest, rejected);
  }
};
