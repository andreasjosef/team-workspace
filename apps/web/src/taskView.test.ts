import type { TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  outcome,
  progress,
  reproduced,
  taskForIncident,
  timeAgo,
} from './taskView.ts';

const task = (patch: Partial<TaskSnapshot>): TaskSnapshot => ({
  id: 'x',
  createdAt: '2026-11-18T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
  input: { role: 'cs', kind: 'bug', title: 'Discount', text: 'x' },
  status: 'pr_opened',
  statusReason: null,
  branch: 'task/x',
  baseSha: 'abc123',
  phase: null,
  iterations: [],
  context: { files: [], decisions: [] },
  inputSignals: [],
  refusals: [],
  blocked: [],
  previewUrl: null,
  hasDiff: true,
  pr: { url: 'https://github.invalid/pull/7', number: 7, draft: false },
  prompt: null,
  ...patch,
});

const iters = (...failing: number[]) =>
  failing.map((testsFailed, n) => ({ n, typeErrors: 0, testsFailed }));

describe('plain words for the support rep', () => {
  it('counts a reproduction only when a check fails more than the baseline', () => {
    expect(reproduced(task({ iterations: iters(0, 0, 2, 0) }))).toBe(true);
    expect(reproduced(task({ iterations: iters(0, 0) }))).toBe(false);
    expect(reproduced(task({ iterations: iters(1, 1) }))).toBe(false);
  });

  it('says a fix with a pull request is in review, with a line for the customer', () => {
    const o = outcome(task({ iterations: iters(0, 1, 0) }));
    expect(o.headline).toBe('A fix is ready for review');
    expect(o.detail).toMatch(/pull request/);
    expect(o.tone).toBe('gold');
    expect(o.customer).toMatch(/confirmed/);
  });

  it('says what the agent is doing while it works', () => {
    expect(
      outcome(task({ status: 'working', phase: 'context' })).detail
    ).toMatch(/decisions/);
    expect(
      outcome(task({ status: 'working', phase: 'fix', iterations: iters(0) }))
        .detail
    ).toMatch(/Reproducing/);
    expect(
      outcome(
        task({ status: 'working', phase: 'fix', iterations: iters(0, 1) })
      ).detail
    ).toMatch(/fix/);
  });

  it('tells the customer nothing about a flagged report', () => {
    const o = outcome(task({ status: 'flagged' }));
    expect(o.tone).toBe('red');
    expect(o.customer).toBeNull();
  });

  it('walks the steps: reported, reproduced, fixed, review', () => {
    const states = (t: TaskSnapshot) => progress(t).map((s) => s.state);
    expect(states(task({ iterations: iters(0, 1, 0) }))).toEqual([
      'done',
      'done',
      'done',
      'current',
    ]);
    expect(
      states(task({ status: 'working', phase: 'fix', iterations: iters(0) }))
    ).toEqual(['done', 'current', 'todo', 'todo']);
    expect(
      states(task({ status: 'gave_up', iterations: iters(0, 1, 1, 1) }))
    ).toEqual(['done', 'done', 'stopped', 'todo']);
    // Green, but publishing failed: it stopped before the developer.
    expect(
      states(task({ status: 'error', pr: null, iterations: iters(0, 1, 0) }))
    ).toEqual(['done', 'done', 'stopped', 'todo']);
  });
});

describe('helpers', () => {
  it('finds the open task for an incident', () => {
    const t = task({
      input: {
        role: 'cs',
        kind: 'bug',
        title: 'x',
        text: 'x',
        incidentId: 'INC-1',
      },
    });
    expect(taskForIncident([t], 'INC-1')).toBe(t);
    expect(taskForIncident([t], 'INC-2')).toBeUndefined();
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(timeAgo('2026-11-18T11:59:30Z', now)).toBe('30s ago');
    expect(timeAgo('2026-11-18T10:00:00Z', now)).toBe('2h ago');
  });
});
