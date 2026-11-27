import type { EventEnvelope, TaskEvent, TaskSnapshot } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  fixtureLayers,
  NETWORK_LAYER,
  outcome,
  replyDraftLabel,
  reproduced,
  runSteps,
  taskLayers,
  taskForIncident,
  threadEvents,
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
  replyDraft: null,
  fixtureOf: null,
  fixtureRun: null,
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

  it('labels who drafted the reply', () => {
    expect(replyDraftLabel({ source: 'model' })).toBe('Drafted by the model');
    expect(replyDraftLabel({ source: 'template' })).toBe(
      'Drafted from a template'
    );
  });

  it('tells the customer nothing about a flagged report', () => {
    const o = outcome(task({ status: 'flagged' }));
    expect(o.tone).toBe('red');
    expect(o.customer).toBeNull();
  });
});

describe('fixture run', () => {
  const flagged = task({
    status: 'flagged',
    pr: null,
    inputSignals: ['tries to override instructions'],
    fixtureRun: 'f1',
  });
  const fixture = (patch: Partial<TaskSnapshot>) =>
    task({ id: 'f1', status: 'flagged', pr: null, fixtureOf: 'x', ...patch });
  const states = (f: TaskSnapshot | null) =>
    fixtureLayers(flagged, f).map((l) => [l.name, l.state]);

  it('shows each layer that fired: refused, refused, blocked', () => {
    const layers = fixtureLayers(
      flagged,
      fixture({
        refusals: [
          { path: 'src/auth/users.ts', rule: 'deny src/auth/**' },
          {
            path: '.hub/roles/cs.json',
            rule: 'role policies are never agent-writable',
          },
        ],
        blocked: ['network: test run: EAI_AGAIN collector.attacker.example'],
      })
    );
    expect(layers.map((l) => [l.name, l.state])).toEqual([
      ['Input scanner', 'flagged'],
      ['Role policy', 'refused'],
      ['.hub/ lock', 'refused'],
      [NETWORK_LAYER, 'blocked'],
    ]);
    expect(layers[1]!.detail).toMatch(/^src\/auth\/users\.ts/);
    expect(layers[3]!.detail).toMatch(/collector\.attacker\.example/);
  });

  it('says not reached once it ended, waiting while it runs', () => {
    expect(states(fixture({}))).toEqual([
      ['Input scanner', 'flagged'],
      ['Role policy', 'not reached'],
      ['.hub/ lock', 'not reached'],
      [NETWORK_LAYER, 'not reached'],
    ]);
    expect(states(fixture({ status: 'working' })).at(-1)).toEqual([
      NETWORK_LAYER,
      'waiting',
    ]);
    expect(states(null).at(1)).toEqual(['Role policy', 'waiting']);
  });

  it('labels a fixture run as scripted, not the model', () => {
    const o = outcome(fixture({}));
    expect(o.headline).toBe(
      'Fixture: a scripted hostile proposal, not the model'
    );
    expect(o.customer).toBeNull();
  });

  it("reads a task's own layers: what fired, what didn't", () => {
    const t = task({
      refusals: [{ path: 'src/auth/users.ts', rule: 'deny src/auth/**' }],
    });
    expect(taskLayers(t).map((l) => [l.name, l.state])).toEqual([
      ['Input scanner', 'not fired'],
      ['Role policy', 'refused'],
      ['.hub/ lock', 'not fired'],
      [NETWORK_LAYER, 'not fired'],
    ]);
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

describe('runSteps', () => {
  const verdicts = (t: TaskSnapshot) => runSteps(t).map((s) => s.verdict);

  it('reads a bug run as baseline, reproduced, green', () => {
    expect(verdicts(task({ iterations: iters(0, 1, 0) }))).toEqual([
      'baseline',
      'reproduced',
      'green',
    ]);
  });

  it('marks rejected and refused answers, whatever the counts', () => {
    const t = task({
      iterations: [
        { n: 0, typeErrors: 0, testsFailed: 0 },
        { n: 1, typeErrors: 0, testsFailed: 0, rejected: 'no test' },
        {
          n: 2,
          typeErrors: 0,
          testsFailed: 0,
          refused: [{ path: '.hub/roles/cs.yaml', rule: 'hub' }],
        },
      ],
    });
    expect(verdicts(t)).toEqual(['baseline', 'rejected', 'refused']);
  });

  it('compares a fix step with the step before it', () => {
    const t = task({
      iterations: [
        { n: 0, typeErrors: 0, testsFailed: 0 },
        { n: 1, typeErrors: 0, testsFailed: 2 },
        { n: 2, typeErrors: 3, testsFailed: 2 },
        { n: 3, typeErrors: 0, testsFailed: 1 },
        { n: 4, typeErrors: 0, testsFailed: 1 },
      ],
    });
    expect(verdicts(t)).toEqual([
      'baseline',
      'reproduced',
      'worse',
      'better',
      'no change',
    ]);
  });
});

const stream = (...events: TaskEvent[]): EventEnvelope[] =>
  events.map((event, seq) => ({
    seq,
    at: `2026-11-27T10:00:${String(seq).padStart(2, '0')}Z`,
    event,
  }));

describe('threadEvents', () => {
  it('tells a fix as forwarded, reproduced, green, pull request', () => {
    const events = stream(
      { type: 'status', status: 'working' },
      { type: 'phase', phase: 'context' },
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'iteration', n: 1, typeErrors: 0, testsFailed: 1 },
      { type: 'iteration', n: 2, typeErrors: 0, testsFailed: 0 },
      { type: 'pr', url: 'u', number: 7, draft: false },
      { type: 'status', status: 'pr_opened' }
    );
    expect(threadEvents(events).map((e) => e.text)).toEqual([
      'Forwarded to the agent',
      'Problem reproduced with a failing test (step 1)',
      'Fix passes the tests (step 2)',
      'Pull request #7 opened',
    ]);
  });

  it('keeps what got stopped, and why the run ended', () => {
    const events = stream(
      { type: 'status', status: 'working' },
      { type: 'input_flagged', signals: ['ignore previous'] },
      { type: 'policy_refused', path: '.hub/roles/cs.yaml', rule: 'hub' },
      { type: 'status', status: 'flagged', reason: '3 edits refused' }
    );
    expect(threadEvents(events).map((e) => [e.text, e.tone])).toEqual([
      ['Forwarded to the agent', 'muted'],
      ['The report looks like it carries instructions', 'red'],
      ['Edit to .hub/roles/cs.yaml refused by the role policy', 'red'],
      ['Stopped: 3 edits refused', 'red'],
    ]);
  });

  it('reads passing checks as neutral once something was stopped', () => {
    const events = stream(
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'policy_refused', path: 'src/auth/users.ts', rule: 'scope' },
      {
        type: 'iteration',
        n: 1,
        typeErrors: 0,
        testsFailed: 0,
        proposed: [{ path: 'src/a.ts', create: false }],
      }
    );
    expect(threadEvents(events).at(-1)).toMatchObject({
      text: 'Checks pass (step 1)',
      tone: 'muted',
    });
  });

  it('does not call a step green before anything changed', () => {
    const events = stream(
      { type: 'iteration', n: 0, typeErrors: 0, testsFailed: 0 },
      { type: 'iteration', n: 1, typeErrors: 0, testsFailed: 0, rejected: 'x' }
    );
    expect(threadEvents(events)).toHaveLength(1);
  });
});
