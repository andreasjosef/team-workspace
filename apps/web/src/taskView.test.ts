import type { TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  canApprove,
  canReject,
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
  status: 'proposed',
  statusReason: null,
  approver: 'dev',
  branch: 'task/x',
  phase: null,
  iterations: [],
  context: { files: [], decisions: [] },
  inputSignals: [],
  refusals: [],
  blocked: [],
  previewUrl: null,
  hasDiff: true,
  decidedBy: null,
  ...patch,
});

describe('who decides', () => {
  it("lets the policy's approver decide, not the creator", () => {
    expect(canApprove(task({}), 'dev')).toBe(true);
    expect(canApprove(task({}), 'cs')).toBe(false);
  });

  it('lets a role without an approver decide on its own tasks', () => {
    const own = task({
      approver: null,
      input: { role: 'dev', kind: 'change', title: 'x', text: 'x' },
    });
    expect(canApprove(own, 'dev')).toBe(true);
  });

  it('allows closing flagged tasks, never approving them', () => {
    expect(canApprove(task({ status: 'flagged' }), 'dev')).toBe(false);
    expect(canReject(task({ status: 'flagged' }), 'dev')).toBe(true);
  });
});

const iters = (...failing: number[]) =>
  failing.map((testsFailed, n) => ({ n, typeErrors: 0, testsFailed }));

describe('plain words for the support rep', () => {
  it('counts a reproduction only when a check fails more than the baseline', () => {
    expect(reproduced(task({ iterations: iters(0, 0, 2, 0) }))).toBe(true);
    expect(reproduced(task({ iterations: iters(0, 0) }))).toBe(false);
    expect(reproduced(task({ iterations: iters(1, 1) }))).toBe(false);
  });

  it('says a proposed fix is in review, with a line for the customer', () => {
    const o = outcome(task({ iterations: iters(0, 1, 0) }));
    expect(o.headline).toBe('A fix is ready for review');
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
    expect(
      states(task({ status: 'rejected', iterations: iters(0, 1, 0) }))
    ).toEqual(['done', 'done', 'done', 'stopped']);
    expect(
      states(task({ status: 'deployed', iterations: iters(0, 1, 0) }))
    ).toEqual(['done', 'done', 'done', 'done']);
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
    expect(
      taskForIncident([{ ...t, status: 'rejected' }], 'INC-1')
    ).toBeUndefined();
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(timeAgo('2026-11-18T11:59:30Z', now)).toBe('30s ago');
    expect(timeAgo('2026-11-18T10:00:00Z', now)).toBe('2h ago');
  });
});
