import { fail, ok } from '@app/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Answer, EditsResponse, StopAnswer } from './edits.ts';
import {
  reproductionGate,
  runTaskLoop,
  type CheckOutcome,
  type TaskStep,
} from './fixLoop.ts';

const edit = { edits: [{ path: 'src/a.ts', search: 'a', replace: 'b' }] };
const clean = { typeErrors: 0, testsFailed: 0, someTestFailed: false };

// ---- A bug task against a fake worktree ----------------------------------

const REPRO = 'src/a.case.test.ts';
const reproduction: EditsResponse = {
  edits: [{ path: REPRO, create: "it('fails', ...)" }],
};
const together: EditsResponse = {
  edits: [...reproduction.edits, ...edit.edits],
};

// What the check shows while the reproduction is in the worktree and the
// fix isn't: a test failing on an assertion (or a crash in the code under
// test, which reads the same), a passing test, a test that adds a type
// error, or a test file that doesn't load.
const reproChecks = {
  fails: {
    typeErrors: 0,
    testsFailed: 1,
    someTestFailed: true,
    errors: 'AssertionError: expected 9 to be 8',
  },
  passes: { ...clean, errors: '' },
  typeError: {
    typeErrors: 1,
    testsFailed: 1,
    someTestFailed: true,
    errors: `${REPRO}(3,20): error TS2339: Property 'email' does not exist.`,
  },
  doesNotLoad: {
    typeErrors: 0,
    testsFailed: 1,
    someTestFailed: false,
    errors: "Error: Cannot find module './missing.ts'",
  },
} satisfies Record<string, CheckOutcome>;

// The worktree is a set of paths. Tests fail while the reproduction is in it
// and the fix (an edit to src/a.ts) isn't, unless `reproFails` is false;
// `repro` picks what else that check shows. `answers` are the model's
// replies in order; the last one repeats.
const bugTask = async (
  answers: Answer[],
  {
    reproFails = true,
    repro = 'fails' as keyof typeof reproChecks,
    discardFails = false,
    rules = { maxIterations: 6, patience: 2, maxModelCalls: 10 },
  } = {}
) => {
  const files = new Set<string>();
  const asked: {
    step?: TaskStep;
    reproduction?: string[];
    lastRejection?: string;
  }[] = [];
  const curve: number[] = [];
  const discarded: string[][] = [];
  const result = await runTaskLoop({
    check: async () =>
      files.has(REPRO) && !files.has('src/a.ts')
        ? reproChecks[reproFails ? repro : 'passes']
        : { ...clean, errors: '' },
    propose: async ({ step, reproduction, lastRejection }) => {
      asked.push({ step, reproduction, lastRejection });
      return ok(answers[Math.min(asked.length - 1, answers.length - 1)]!);
    },
    apply: async (edits) => {
      for (const e of edits) files.add(e.path);
      return ok(null);
    },
    reproduceFirst: true,
    discard: async (paths) => {
      discarded.push(paths);
      if (discardFails) return fail('invalid', `${paths[0]}: not a file`);
      for (const p of paths) files.delete(p);
      return ok(null);
    },
    onIteration: (_n, c) => curve.push(c.testsFailed),
    baseline: clean,
    rules,
  });
  return { result, files, asked, curve, discarded };
};

describe('runTaskLoop, bug task', () => {
  it('rejects a reproduction sent together with the fix, then goes 0, 1, 0 with the test first', async () => {
    const bug = await bugTask([together, reproduction, edit]);

    // The combined answer is rejected before anything is written: it costs
    // a model call, but no check and no iteration.
    expect(bug.asked[1]?.lastRejection).toMatch(/only new test files/);
    expect(bug.asked[1]?.lastRejection).toContain('src/a.ts');
    expect(bug.curve).toEqual([0, 1, 0]);
    expect(bug.result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 2,
      modelCalls: 3,
    });
    expect(bug.asked.map((a) => a.step)).toEqual([
      'reproduce',
      'reproduce',
      'fix',
    ]);
    expect(bug.asked[2]?.reproduction).toEqual([REPRO]);
  });

  it('ends 0, 1, 0 when the model sends the test first, then the fix', async () => {
    const bug = await bugTask([reproduction, edit]);
    expect(bug.curve).toEqual([0, 1, 0]);
    expect(bug.result).toMatchObject({ status: 'green', iterations: 2 });
  });

  it('rejects a reproduction that does not fail, discards it, and tells the model why', async () => {
    const bug = await bugTask([reproduction], {
      reproFails: false,
      rules: { maxIterations: 3, patience: 2, maxModelCalls: 10 },
    });

    // Each attempt is applied and checked (a normal check), then discarded.
    expect(bug.curve).toEqual([0, 0, 0, 0]);
    expect(bug.discarded).toEqual([[REPRO], [REPRO], [REPRO]]);
    expect(bug.files.size).toBe(0);
    expect(bug.asked[1]).toMatchObject({
      step: 'reproduce',
      lastRejection: expect.stringMatching(
        /the reproduction must fail before the fix/
      ),
    });
    // Never green: a discarded reproduction isn't an accepted proposal.
    expect(bug.result).toMatchObject({
      status: 'gave_up',
      applied: 0,
      iterations: 3,
    });
  });

  it('discards a reproduction that adds type errors, and names them', async () => {
    const bug = await bugTask([reproduction], {
      repro: 'typeError',
      rules: { maxIterations: 2, patience: 5, maxModelCalls: 10 },
    });
    // More tests fail, but the reproduction would be locked with a type
    // error in it, and the run could never go green. Its check stays on the
    // curve.
    expect(bug.curve).toEqual([0, 1, 1]);
    expect(bug.discarded).toEqual([[REPRO], [REPRO]]);
    expect(bug.files.size).toBe(0);
    const rejection = bug.asked[1]?.lastRejection;
    expect(rejection).toMatch(/must not add type errors/);
    expect(rejection).toContain('error TS2339');
    expect(rejection).toContain(`Discarded: ${REPRO}`);
    expect(rejection).not.toMatch(/must fail before the fix/);
    expect(bug.asked.map((a) => a.step)).toEqual(['reproduce', 'reproduce']);
    expect(bug.result).toMatchObject({ status: 'gave_up', applied: 0 });
  });

  it("discards a reproduction whose test file didn't load, and gives the load error", async () => {
    const bug = await bugTask([reproduction], {
      repro: 'doesNotLoad',
      rules: { maxIterations: 2, patience: 5, maxModelCalls: 10 },
    });
    // The count rose (a suite that doesn't load counts as a failure), but no
    // test ran, so nothing was reproduced.
    expect(bug.curve).toEqual([0, 1, 1]);
    expect(bug.discarded).toEqual([[REPRO], [REPRO]]);
    const rejection = bug.asked[1]?.lastRejection;
    expect(rejection).toMatch(/must fail a test, but no test failed/);
    expect(rejection).toContain("Cannot find module './missing.ts'");
    expect(rejection).not.toMatch(/type errors/);
    expect(bug.result).toMatchObject({ status: 'gave_up', applied: 0 });
  });

  it('accepts a crash in the code under test: it fails a test', async () => {
    const crash: CheckOutcome = {
      typeErrors: 0,
      testsFailed: 1,
      someTestFailed: true,
      errors:
        "TypeError: Cannot read properties of undefined (reading 'reduce')",
    };
    const asked: { step?: TaskStep; lastRejection?: string }[] = [];
    const checks = [crash, { ...clean, errors: '' }];
    const result = await runTaskLoop({
      check: async () => checks.shift()!,
      first: { ...clean, errors: '' },
      propose: async ({ step, lastRejection }) => {
        asked.push({ step, lastRejection });
        return ok(asked.length === 1 ? reproduction : edit);
      },
      apply: async () => ok(null),
      reproduceFirst: true,
      discard: async () => fail('invalid', 'should not discard'),
      onIteration: () => {},
      baseline: clean,
    });
    expect(asked).toEqual([
      { step: 'reproduce', lastRejection: undefined },
      { step: 'fix', lastRejection: undefined },
    ]);
    expect(result).toMatchObject({ status: 'green', applied: 2 });
  });

  it('says so when a reproduction could not be discarded', async () => {
    const bug = await bugTask([reproduction], {
      reproFails: false,
      discardFails: true,
      rules: { maxIterations: 2, patience: 2, maxModelCalls: 10 },
    });
    expect(bug.asked[1]?.lastRejection).toContain(
      `Not all discarded: ${REPRO}: not a file`
    );
    expect(bug.asked[1]?.lastRejection).not.toContain('Discarded:');
    expect(bug.result).toMatchObject({ status: 'gave_up', applied: 0 });
  });

  it('rejects an edit to the reproduction in the fix step', async () => {
    const touchRepro: EditsResponse = {
      edits: [{ path: REPRO, search: 'fails', replace: 'passes' }],
    };
    const bug = await bugTask([reproduction, touchRepro, edit]);

    expect(bug.asked[2]).toMatchObject({
      step: 'fix',
      lastRejection: expect.stringContaining(REPRO),
    });
    // The rejected fix never ran, so the curve has no row for it.
    expect(bug.curve).toEqual([0, 1, 0]);
    expect(bug.result).toMatchObject({ status: 'green', applied: 2 });
  });

  it('two rejected answers in a row in the fix step neither end the loop nor report an iteration', async () => {
    const touchRepro: EditsResponse = {
      edits: [{ path: REPRO, search: 'fails', replace: 'passes' }],
    };
    // patience 2: before, two rejections with unchanged counts ended the run
    // as "stopped falling" without one fix tried in the sandbox.
    const bug = await bugTask([reproduction, touchRepro, touchRepro, edit]);

    expect(bug.curve).toEqual([0, 1, 0]);
    expect(bug.result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 2,
      modelCalls: 4,
    });
    expect(bug.asked.map((a) => a.step)).toEqual([
      'reproduce',
      'fix',
      'fix',
      'fix',
    ]);
  });

  it("rejections in the reproduce step don't use up the fix step's checks", async () => {
    // Three rejected answers, then the reproduction and the fix: two checks,
    // exactly the iteration cap.
    const bug = await bugTask(
      [together, together, together, reproduction, edit],
      { rules: { maxIterations: 2, patience: 2, maxModelCalls: 10 } }
    );

    expect(bug.curve).toEqual([0, 1, 0]);
    expect(bug.result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 2,
      modelCalls: 5,
    });
  });

  it("discarded reproductions stay on the curve, but use up neither patience nor the fix step's checks", async () => {
    // Two reproductions that add type errors, then one that fails cleanly,
    // then the fix. Before, the two discards tripped patience 2 ("stopped
    // falling"), and one budget of 3 checks left none for the fix.
    const answers: Answer[] = [reproduction, reproduction, reproduction, edit];
    const checks: CheckOutcome[] = [
      reproChecks.typeError,
      reproChecks.typeError,
      reproChecks.fails,
      { ...clean, errors: '' },
    ];
    const asked: (TaskStep | undefined)[] = [];
    const iterations: { n: number; rejected?: string }[] = [];
    const result = await runTaskLoop({
      check: async () => checks.shift()!,
      first: { ...clean, errors: '' },
      propose: async ({ step }) => {
        asked.push(step);
        return ok(answers[asked.length - 1]!);
      },
      apply: async () => ok(null),
      reproduceFirst: true,
      discard: async () => ok(null),
      onIteration: (n, _c, rejected) =>
        iterations.push(rejected ? { n, rejected } : { n }),
      baseline: clean,
      rules: { maxIterations: 3, patience: 2, maxModelCalls: 10 },
    });

    expect(asked).toEqual(['reproduce', 'reproduce', 'reproduce', 'fix']);
    // Every check is an iteration; the discarded ones say why.
    expect(iterations.map((i) => i.n)).toEqual([0, 1, 2, 3, 4]);
    expect(iterations[1]?.rejected).toMatch(/must not add type errors/);
    expect(iterations[2]?.rejected).toMatch(/must not add type errors/);
    expect(iterations[3]).toEqual({ n: 3 });
    expect(iterations[4]).toEqual({ n: 4 });
    expect(result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 4,
      modelCalls: 4,
    });
  });

  it('gives the fix step its own patience, counted from the reproduction', async () => {
    // One discarded reproduction, the accepted one, then fixes that don't
    // bring the count down: patience ends it after two fix checks.
    const checks: CheckOutcome[] = [
      reproChecks.passes,
      reproChecks.fails,
      reproChecks.fails,
      reproChecks.fails,
    ];
    let calls = 0;
    const result = await runTaskLoop({
      check: async () => checks.shift()!,
      first: { ...clean, errors: '' },
      propose: async () => ok(++calls <= 2 ? reproduction : edit),
      apply: async () => ok(null),
      reproduceFirst: true,
      discard: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 6, patience: 2, maxModelCalls: 10 },
    });
    expect(result).toMatchObject({
      status: 'gave_up',
      reason: 'error count stopped falling for 2 iterations',
      iterations: 4,
      applied: 3,
    });
  });

  it('ends gave_up at the model-call cap, naming it, when no answer is ever taken', async () => {
    const bug = await bugTask([together], {
      rules: { maxIterations: 6, patience: 2, maxModelCalls: 4 },
    });

    expect(bug.asked).toHaveLength(4);
    expect(bug.curve).toEqual([0]);
    expect(bug.result).toEqual({
      status: 'gave_up',
      reason: 'reached the cap of 4 model calls with no proposal accepted',
      iterations: 0,
      applied: 0,
      modelCalls: 4,
    });
  });

  it('checks the scope before the step, so the policy sees every answer', async () => {
    const scoped: string[][] = [];
    const propose = vi.fn(async () => ok(together));
    const apply = vi.fn(async () => ok(null));
    await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose,
      checkScope: (edits) => {
        scoped.push(edits.map((e) => e.path));
        return fail('forbidden', 'src/a.ts: deny src/**');
      },
      apply,
      reproduceFirst: true,
      discard: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 2, patience: 5, maxModelCalls: 2 },
    });
    // Once per answer, and a refused answer never reaches apply (where the
    // hub would check, and count, its refusals a second time).
    expect(scoped).toEqual([
      [REPRO, 'src/a.ts'],
      [REPRO, 'src/a.ts'],
    ]);
    expect(apply).not.toHaveBeenCalled();
    expect(propose.mock.calls[1]).toEqual([
      expect.objectContaining({ lastRejection: 'src/a.ts: deny src/**' }),
    ]);
  });

  it('leaves tasks that are not bugs as they were: no steps, test and fix together', async () => {
    const asked: { step?: TaskStep }[] = [];
    const counts = [0, 0];
    const result = await runTaskLoop({
      check: async () => ({
        typeErrors: 0,
        testsFailed: counts.shift()!,
        someTestFailed: false,
        errors: '',
      }),
      propose: async ({ step }) => {
        asked.push({ step });
        return ok(together);
      },
      apply: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
    });
    expect(result).toMatchObject({ status: 'green', applied: 1 });
    expect(asked).toEqual([{ step: undefined }]);
  });

  it('a task that is not a bug runs as before, except that rejections no longer count', async () => {
    // Bad JSON, a refused patch, then an edit that makes the checks pass
    // with one red check in between: the stop rules see two checks.
    const answers = [
      fail('invalid', 'bad JSON'),
      ok(edit),
      ok(edit),
      ok(edit),
    ] as const;
    const refuse = [true, false, false];
    const counts = [0, 1, 0];
    const iterations: [number, number][] = [];
    const notes: string[] = [];
    let k = 0;
    const result = await runTaskLoop({
      check: async () => ({
        typeErrors: 0,
        testsFailed: counts.shift()!,
        someTestFailed: false,
        errors: '',
      }),
      propose: async ({ step }) => {
        expect(step).toBeUndefined();
        return answers[k++]!;
      },
      apply: async () =>
        refuse.shift() ? fail('forbidden', 'deny src/auth/**') : ok(null),
      onIteration: (n, c) => iterations.push([n, c.testsFailed]),
      onNote: (note) => notes.push(note),
      baseline: clean,
      rules: { maxIterations: 2, patience: 2, maxModelCalls: 10 },
    });

    expect(iterations).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(result).toMatchObject({
      status: 'green',
      reason: 'all checks pass',
      iterations: 2,
      applied: 2,
      modelCalls: 4,
    });
    // The rejections still go out as notes, one per model call.
    expect(notes).toContain('Model call 1: answer rejected (bad JSON)');
    expect(notes).toContain('Model call 2: patch refused (deny src/auth/**)');
  });
});

describe('runTaskLoop, stop answer', () => {
  const stop: StopAnswer = {
    action: 'stop',
    reasoning: 'D-007 says codes are case-sensitive.',
    reason: 'This is intended: discount codes are case-sensitive (D-007).',
  };
  // A fix attempt that leaves the reproduction failing.
  const wrongFix: EditsResponse = {
    edits: [{ path: 'src/b.ts', search: 'a', replace: 'b' }],
  };

  it('ends the loop stopped with the reason in the reproduce step, before any check', async () => {
    const bug = await bugTask([stop, reproduction, edit]);
    expect(bug.asked).toHaveLength(1);
    expect(bug.curve).toEqual([0]);
    expect(bug.files.size).toBe(0);
    expect(bug.result).toEqual({
      status: 'stopped',
      reason: stop.reason,
      iterations: 0,
      applied: 0,
      modelCalls: 1,
    });
  });

  it('ends the loop stopped with the reason in the fix step', async () => {
    const bug = await bugTask([reproduction, stop, edit]);
    expect(bug.asked.map((a) => a.step)).toEqual(['reproduce', 'fix']);
    expect(bug.curve).toEqual([0, 1]);
    expect(bug.result).toEqual({
      status: 'stopped',
      reason: stop.reason,
      iterations: 1,
      applied: 1,
      modelCalls: 2,
    });
  });

  it("a stop after an applied fix doesn't count as green", async () => {
    const bug = await bugTask([reproduction, wrongFix, stop]);
    expect(bug.files.has('src/b.ts')).toBe(true);
    expect(bug.curve).toEqual([0, 1, 1]);
    expect(bug.result).toMatchObject({ status: 'stopped', applied: 2 });
  });

  it("a stop on a task that isn't a bug, after an applied edit, isn't green either", async () => {
    const answers: Answer[] = [edit, stop];
    const result = await runTaskLoop({
      check: async () => ({ ...clean, testsFailed: 1, errors: '' }),
      first: { ...clean, errors: '' },
      propose: async () => ok(answers.shift()!),
      apply: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
    });
    expect(result).toMatchObject({
      status: 'stopped',
      reason: stop.reason,
      applied: 1,
    });
  });

  it('needs no policy check, notes the reasoning and the reason, and caps the reason', async () => {
    const checkScope = vi.fn(() => ok(null));
    const apply = vi.fn(async () => ok(null));
    const notes: string[] = [];
    const result = await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose: async () =>
        ok({
          action: 'stop' as const,
          reasoning: 'why',
          reason: 'x'.repeat(2000),
        }),
      checkScope,
      apply,
      reproduceFirst: true,
      discard: async () => ok(null),
      onIteration: () => {},
      onNote: (note) => notes.push(note),
      baseline: clean,
    });
    expect(checkScope).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(result.status).toBe('stopped');
    expect(result.reason).toBe(`${'x'.repeat(500)}…`);
    expect(notes).toEqual([
      'Model call 1: why',
      `Model call 1: stopped (${'x'.repeat(500)}…)`,
    ]);
  });
});

describe('runTaskLoop', () => {
  it("doesn't stop at a green start: a task needs an applied proposal", async () => {
    // Start green, the reproduction test goes red, the fix brings it back.
    const counts = [0, 1, 0];
    const result = await runTaskLoop({
      check: async () => ({
        typeErrors: 0,
        testsFailed: counts.shift()!,
        someTestFailed: false,
        errors: '',
      }),
      propose: async () => ok(edit),
      apply: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
    });
    expect(result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 2,
    });
  });

  it('starts from a given first result without checking it again', async () => {
    // The same task twice: once the loop runs its own first check, once the
    // caller hands in the result of the check it already ran.
    const run = async (handFirstIn: boolean) => {
      const counts = [0, 1, 0];
      const calls: string[] = [];
      const iterations: [number, number][] = [];
      const check = async () => {
        calls.push('check');
        return { ...clean, testsFailed: counts.shift()!, errors: '' };
      };
      const first = handFirstIn
        ? { ...clean, testsFailed: counts.shift()!, errors: '' }
        : undefined;
      const result = await runTaskLoop({
        check,
        ...(first ? { first } : {}),
        propose: async () => {
          calls.push('propose');
          return ok(edit);
        },
        apply: async () => ok(null),
        onIteration: (n, c) => iterations.push([n, c.testsFailed]),
        baseline: clean,
      });
      return { result, calls, iterations };
    };

    const given = await run(true);
    const own = await run(false);
    expect(own.calls[0]).toBe('check');
    expect(given.calls).toEqual(own.calls.slice(1));
    expect(given.iterations).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(given.iterations).toEqual(own.iterations);
    expect(given.result).toEqual(own.result);
  });

  it('gives up at the model-call cap when every patch is refused, with no check run', async () => {
    const check = vi.fn(async () => ({ ...clean, errors: '' }));
    const iterations: number[] = [];
    const result = await runTaskLoop({
      check,
      propose: async () => ok(edit),
      apply: async () => fail('invalid', 'deny src/auth/**'),
      onIteration: (n) => iterations.push(n),
      baseline: clean,
      rules: { maxIterations: 3, patience: 2, maxModelCalls: 5 },
    });
    expect(result).toEqual({
      status: 'gave_up',
      reason: 'reached the cap of 5 model calls with no proposal accepted',
      iterations: 0,
      applied: 0,
      modelCalls: 5,
    });
    // Only the baseline was checked.
    expect(check).toHaveBeenCalledTimes(1);
    expect(iterations).toEqual([0]);
  });

  it('names the cap without "no proposal accepted" once one was applied', async () => {
    // One fix that leaves a test red, then answers that are all refused:
    // patience never sees a second check, so the cap ends it.
    let n = 0;
    const result = await runTaskLoop({
      check: async () => ({
        typeErrors: 0,
        testsFailed: 1,
        someTestFailed: true,
        errors: '',
      }),
      first: {
        typeErrors: 0,
        testsFailed: 1,
        someTestFailed: true,
        errors: '',
      },
      propose: async () => ok(edit),
      apply: async () =>
        n++ === 0 ? ok(null) : fail('invalid', 'deny src/auth/**'),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 6, patience: 2, maxModelCalls: 3 },
    });
    expect(result).toMatchObject({
      status: 'gave_up',
      reason: 'reached the cap of 3 model calls',
      iterations: 1,
      applied: 1,
    });
  });

  it('passes the last rejection back to the model', async () => {
    const propose = vi.fn(async () => fail('invalid', 'bad JSON'));
    await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose,
      apply: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 2, patience: 5, maxModelCalls: 2 },
    });
    expect(propose.mock.calls[1]).toEqual([
      expect.objectContaining({ lastRejection: 'bad JSON' }),
    ]);
  });

  it('halts when the hub says so', async () => {
    let refusals = 0;
    const result = await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose: async () => ok(edit),
      apply: async () => {
        refusals++;
        return fail('invalid', 'refused');
      },
      halt: () => (refusals >= 3 ? '3 policy refusals' : null),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 10, patience: 10, maxModelCalls: 10 },
    });
    // The refusals never ran a check, so none counted as an iteration.
    expect(result).toMatchObject({
      status: 'halted',
      reason: '3 policy refusals',
      iterations: 0,
      modelCalls: 3,
    });
  });
});

describe('reproductionGate', () => {
  it('names one rule when no more tests failed and none ran', () => {
    const gate = reproductionGate(
      { ...clean, errors: 'Error: Cannot find module' },
      clean
    );
    expect(gate).toMatch(/no more tests failed than before/);
    expect(gate).not.toMatch(/no test failed/);
  });
});
