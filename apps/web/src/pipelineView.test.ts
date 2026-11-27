import type { EventEnvelope, TaskEvent, TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  buildReplayCutoffs,
  derivePipeline,
  snapshotFromEvents,
} from './pipelineView.ts';

const baseTask = (over: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id: 'task-1',
  createdAt: '2026-11-27T10:00:00.000Z',
  updatedAt: '2026-11-27T10:00:00.000Z',
  input: {
    role: 'cs',
    kind: 'bug',
    title: 'Discount code says invalid',
    text: 'summer20 fails at checkout',
    incidentId: 'INC-1042',
  },
  status: 'queued',
  statusReason: null,
  branch: 'task/task-1',
  baseSha: null,
  phase: null,
  iterations: [],
  context: { files: [], decisions: [] },
  inputSignals: [],
  refusals: [],
  blocked: [],
  previewUrl: null,
  hasDiff: false,
  pr: null,
  prompt: null,
  replyDraft: null,
  fixtureOf: null,
  fixtureRun: null,
  ...over,
});

const wrap = (events: TaskEvent[]): EventEnvelope[] =>
  events.map((event, seq) => ({
    seq,
    at: new Date(
      Date.parse('2026-11-27T10:00:00.000Z') + seq * 500
    ).toISOString(),
    event,
  }));

describe('derivePipeline', () => {
  it('activates scan when a task is queued', () => {
    const p = derivePipeline(baseTask(), []);
    expect(p.live).toBe(true);
    expect(p.mood).toBe('running');
    expect(p.stages[0]?.state).toBe('active');
    expect(p.stages[1]?.state).toBe('pending');
  });

  it('tracks context → baseline → reproduce → fix → pr_opened end to end', () => {
    const events = wrap([
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
      { type: 'base', sha: '000000000042' },
      {
        type: 'context',
        files: ['src/checkout/discount.ts'],
        decisions: [{ id: 'D-014', title: 'Case-insensitive codes' }],
      },
      { type: 'phase', phase: 'baseline' },
      {
        type: 'command',
        cmd: 'npm ci',
        exitCode: 0,
        durationMs: 400,
        output: '',
      },
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'phase', phase: 'fix' },
      {
        type: 'prompt',
        sections: [{ title: 'Role', text: 'cs', chars: 2 }],
        repo: null,
      },
      {
        type: 'iteration',
        n: 1,
        typeErrors: 0,
        testsFailed: 1,
        proposed: [
          { path: 'src/checkout/discount-case.test.ts', create: true },
        ],
      },
    ]);

    // Mid-run during reproduction: Agent active, Verify warns on repro
    const midSnap = snapshotFromEvents(baseTask(), events, { replace: true });
    const mid = derivePipeline(midSnap, events);
    expect(mid.live).toBe(true);
    expect(mid.stages.map((s) => s.state)).toEqual([
      'done',
      'done',
      'active',
      'warn',
      'pending',
    ]);
    expect(mid.stages[3]?.badge).toBe('Repro');

    // Finish the fix and open PR #1
    const fullEvents = wrap([
      ...events.map((e) => e.event),
      {
        type: 'iteration',
        n: 2,
        typeErrors: 0,
        testsFailed: 0,
        proposed: [{ path: 'src/checkout/discount.ts', create: false }],
      },
      { type: 'phase', phase: 'publish' },
      {
        type: 'pr',
        url: 'https://github.invalid/demo/shop/pull/1',
        number: 1,
        draft: false,
      },
      { type: 'status', status: 'pr_opened', reason: 'PR #1 open' },
    ]);
    const doneSnap = snapshotFromEvents(baseTask(), fullEvents, {
      replace: true,
    });
    const done = derivePipeline(
      doneSnap,
      fullEvents,
      'diff --git a/src/checkout/discount.ts b/src/checkout/discount.ts\n--- a/src/checkout/discount.ts\n+++ b/src/checkout/discount.ts\n-old\n+new\n'
    );
    expect(done.live).toBe(false);
    expect(done.mood).toBe('done');
    expect(done.stages.map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(done.connectors).toEqual(['done', 'done', 'done', 'done']);
    expect(done.stages[4]?.label).toBe('PR #1');
    expect(done.stages[4]?.detail).toBe('1 file · +1 -1');
  });

  it('shows containment blocks across scan, agent policy, sandbox network, and output on hostile tickets', () => {
    const events = wrap([
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
      { type: 'input_flagged', signals: ['tries to override instructions'] },
      { type: 'phase', phase: 'baseline' },
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'phase', phase: 'fix' },
      {
        type: 'policy_refused',
        path: 'src/auth/users.ts',
        rule: 'deny: src/auth/**',
      },
      {
        type: 'blocked',
        kind: 'network',
        detail: 'ENETUNREACH collector.attacker.example',
      },
      { type: 'status', status: 'flagged', reason: 'Network blocked' },
    ]);
    const snap = snapshotFromEvents(baseTask(), events, { replace: true });
    const p = derivePipeline(snap, events);
    expect(p.mood).toBe('flagged');
    expect(p.stages[0]?.state).toBe('blocked');
    expect(p.stages[2]?.state).toBe('blocked');
    expect(p.stages[3]?.state).toBe('blocked');
    expect(p.stages[4]?.state).toBe('blocked');
    expect(p.stages[4]?.label).toBe('Blocked');
    expect(p.stages[4]?.detail).toBe('Nothing published');
    expect(p.connectors[3]).toBe('blocked');
  });

  it('marks later stages stopped when a task gives up', () => {
    const events = wrap([
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
      { type: 'context', files: [], decisions: [] },
      { type: 'phase', phase: 'baseline' },
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'status', status: 'gave_up', reason: 'Unknown scenario' },
    ]);
    const snap = snapshotFromEvents(baseTask(), events, { replace: true });
    const p = derivePipeline(snap, events);
    expect(p.mood).toBe('stopped');
    expect(p.stages[2]?.state).toBe('stopped');
    expect(p.stages[4]?.label).toBe('Escalated');
  });

  it('builds replay cutoffs ending at the full event length', () => {
    const events = wrap([
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
      { type: 'log', message: 'note' },
      { type: 'context', files: ['a.ts'], decisions: [] },
      { type: 'log', message: 'trailing note' },
    ]);
    const cutoffs = buildReplayCutoffs(events);
    expect(cutoffs).toEqual([1, 2, 4, 5]);
  });

  it('does not regress a finalized task snapshot while live WebSocket events are still catching up', () => {
    const finished = baseTask({
      status: 'pr_opened',
      statusReason: 'PR #1 open',
      iterations: [
        { n: 0, typeErrors: 0, testsFailed: 0 },
        { n: 1, typeErrors: 0, testsFailed: 1 },
        { n: 2, typeErrors: 0, testsFailed: 0 },
      ],
      pr: {
        url: 'https://github.invalid/demo/shop/pull/1',
        number: 1,
        draft: false,
      },
      hasDiff: true,
    });
    const earlyEvents = wrap([
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
    ]);
    const merged = snapshotFromEvents(finished, earlyEvents, {
      replace: false,
    });
    expect(merged.status).toBe('pr_opened');
    expect(merged.iterations).toHaveLength(3);
    expect(merged.pr?.number).toBe(1);
    expect(merged.hasDiff).toBe(true);
  });
});
