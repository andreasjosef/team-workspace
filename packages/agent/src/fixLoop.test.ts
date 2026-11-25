import { fail, ok } from '@app/shared';
import { describe, expect, it, vi } from 'vitest';
import { runTaskLoop } from './fixLoop.ts';

const edit = { edits: [{ path: 'src/a.ts', search: 'a', replace: 'b' }] };
const clean = { typeErrors: 0, testsFailed: 0 };

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
