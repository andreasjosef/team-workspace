import { fail, ok } from '@app/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EditsResponse } from './edits.ts';
import { runTaskLoop, type CheckOutcome, type TaskStep } from './fixLoop.ts';

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
  answers: EditsResponse[],
  {
    reproFails = true,
    repro = 'fails' as keyof typeof reproChecks,
    discardFails = false,
    rules = { maxIterations: 6, patience: 2 },
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

    // The combined answer is rejected before anything is written; it uses
    // an iteration with the counts unchanged.
    expect(bug.asked[1]?.lastRejection).toMatch(/only new test files/);
    expect(bug.asked[1]?.lastRejection).toContain('src/a.ts');
    expect(bug.curve).toEqual([0, 0, 1, 0]);
    expect(bug.result).toMatchObject({
      status: 'green',
      applied: 2,
      iterations: 3,
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
      rules: { maxIterations: 3, patience: 2 },
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
      rules: { maxIterations: 2, patience: 5 },
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
      rules: { maxIterations: 2, patience: 5 },
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
      rules: { maxIterations: 2, patience: 2 },
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
    // One rejected fix after the reproduction doesn't end the task: the
    // count rose on purpose, so "stopped falling" counts from the reproduction.
    expect(bug.curve).toEqual([0, 1, 1, 0]);
    expect(bug.result).toMatchObject({ status: 'green', applied: 2 });
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
      rules: { maxIterations: 2, patience: 5 },
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

  it('counts refused patches as iterations and gives up', async () => {
    const result = await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose: async () => ok(edit),
      apply: async () => fail('invalid', 'deny src/auth/**'),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 3, patience: 2 },
    });
    expect(result).toMatchObject({ status: 'gave_up', applied: 0 });
  });

  it('passes the last rejection back to the model', async () => {
    const propose = vi.fn(async () => fail('invalid', 'bad JSON'));
    await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose,
      apply: async () => ok(null),
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 2, patience: 5 },
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
      rules: { maxIterations: 10, patience: 10 },
    });
    expect(result).toMatchObject({
      status: 'halted',
      reason: '3 policy refusals',
      iterations: 3,
    });
  });
});
