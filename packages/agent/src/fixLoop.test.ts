import { fail, ok } from '@app/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EditsResponse } from './edits.ts';
import { runTaskLoop, type TaskStep } from './fixLoop.ts';

const edit = { edits: [{ path: 'src/a.ts', search: 'a', replace: 'b' }] };
const clean = { typeErrors: 0, testsFailed: 0 };

// ---- A bug task against a fake worktree ----------------------------------

const REPRO = 'src/a.case.test.ts';
const reproduction: EditsResponse = {
  edits: [{ path: REPRO, create: "it('fails', ...)" }],
};
const together: EditsResponse = {
  edits: [...reproduction.edits, ...edit.edits],
};

// The worktree is a set of paths. Tests fail while the reproduction is in it
// and the fix (an edit to src/a.ts) isn't, unless `reproFails` is false.
// `answers` are the model's replies in order; the last one repeats.
const bugTask = async (
  answers: EditsResponse[],
  { reproFails = true, rules = { maxIterations: 6, patience: 2 } } = {}
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
    check: async () => ({
      typeErrors: 0,
      testsFailed:
        reproFails && files.has(REPRO) && !files.has('src/a.ts') ? 1 : 0,
      errors: '',
    }),
    propose: async ({ step, reproduction, lastRejection }) => {
      asked.push({ step, reproduction, lastRejection });
      return ok(answers[Math.min(asked.length - 1, answers.length - 1)]!);
    },
    apply: async (edits) => {
      for (const e of edits) files.add(e.path);
      return ok(null);
    },
    reproduce: {
      discard: async (paths) => {
        discarded.push(paths);
        for (const p of paths) files.delete(p);
      },
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
    await runTaskLoop({
      check: async () => ({ ...clean, errors: '' }),
      propose,
      checkScope: (edits) => {
        scoped.push(edits.map((e) => e.path));
        return fail('forbidden', 'src/a.ts: deny src/**');
      },
      apply: async () => ok(null),
      reproduce: { discard: async () => {} },
      onIteration: () => {},
      baseline: clean,
      rules: { maxIterations: 2, patience: 5 },
    });
    expect(scoped).toEqual([
      [REPRO, 'src/a.ts'],
      [REPRO, 'src/a.ts'],
    ]);
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
        return { typeErrors: 0, testsFailed: counts.shift()!, errors: '' };
      };
      const first = handFirstIn
        ? { typeErrors: 0, testsFailed: counts.shift()!, errors: '' }
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
