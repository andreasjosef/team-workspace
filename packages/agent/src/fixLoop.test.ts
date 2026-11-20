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
