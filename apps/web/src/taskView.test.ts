import type { TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  canApprove,
  canReject,
  devColumns,
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

describe('devColumns', () => {
  it('sorts tasks into the board', () => {
    const cols = devColumns([
      task({ id: 'a' }),
      task({ id: 'b', status: 'flagged' }),
      task({ id: 'c', status: 'working' }),
      task({ id: 'd', status: 'deployed' }),
    ]);
    expect(
      [cols.review, cols.flagged, cols.active, cols.closed].map((c) =>
        c.map((t) => t.id)
      )
    ).toEqual([['a'], ['b'], ['c'], ['d']]);
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
