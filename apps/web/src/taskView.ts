import type { Role, TaskSnapshot, TaskStatus } from '@app/shared';

// Pure helpers behind the views: what each status looks like, and the task
// in plain words. Kept out of the components so they're testable.

export type Tone = 'gold' | 'green' | 'red' | 'blue' | 'muted';

export const statusLook: Record<TaskStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'blue' },
  working: { label: 'Agent working', tone: 'blue' },
  proposed: { label: 'Checks pass', tone: 'gold' },
  pr_opened: { label: 'In review', tone: 'gold' },
  gave_up: { label: 'Gave up', tone: 'muted' },
  flagged: { label: 'Flagged', tone: 'red' },
  error: { label: 'Error', tone: 'red' },
};

// Did a check fail more tests than the baseline? That's the reproduction.
export const reproduced = (t: TaskSnapshot) => {
  const [baseline, ...rest] = t.iterations;
  return (
    baseline !== undefined &&
    rest.some((i) => i.testsFailed > baseline.testsFailed)
  );
};

// The task in words a support rep can act on: what happened, what's next,
// and what they can tell the customer (null when they shouldn't say anything).
export type Outcome = {
  headline: string;
  detail: string;
  customer: string | null;
  tone: Tone;
};

const workingDetail = (t: TaskSnapshot) => {
  if (t.phase === 'context')
    return "Reading the code and the team's decisions that apply.";
  if (t.phase === 'baseline') return 'Running the tests as they are now.';
  return reproduced(t)
    ? 'The problem is reproduced. Writing the fix.'
    : 'Reproducing the problem with a new test.';
};

export const outcome = (t: TaskSnapshot): Outcome => {
  // A fixture run always ends flagged; it reports on the layers, not a fix.
  if (t.fixtureOf !== null && t.status === 'flagged')
    return {
      headline: 'Fixture: a scripted hostile proposal, not the model',
      detail:
        'The hub replayed what the flagged report asked for through the real policy and sandbox. Nothing was published.',
      customer: null,
      tone: 'red',
    };
  switch (t.status) {
    case 'queued':
      return {
        headline: 'Waiting to start',
        detail: 'The agent picks this up in a moment.',
        customer: null,
        tone: 'blue',
      };
    case 'working':
      return {
        headline: 'The agent is on it',
        detail: workingDetail(t),
        customer: null,
        tone: 'blue',
      };
    case 'proposed':
      return {
        headline: 'A fix passes the tests',
        detail:
          'The agent reproduced the problem with a test, then fixed it. Opening a pull request for a developer.',
        customer: null,
        tone: 'gold',
      };
    case 'pr_opened':
      return {
        headline: 'A fix is ready for review',
        detail:
          'The agent reproduced the problem with a test, then fixed it. A developer reviews the pull request before it ships.',
        customer: "We've confirmed the problem, and a fix is in review.",
        tone: 'gold',
      };
    case 'flagged':
      return {
        headline: 'Stopped: the report tried to steer the agent',
        detail:
          'The report carried instructions, so nothing was proposed. The developers can see what it tried.',
        customer: null,
        tone: 'red',
      };
    case 'gave_up':
      return reproduced(t)
        ? {
            headline: 'Confirmed, but not fixed',
            detail:
              'The agent reproduced the problem but found no fix within its limits. A developer needs to look.',
            customer:
              "We've confirmed the problem and passed it to our developers.",
            tone: 'muted',
          }
        : {
            headline: "The agent couldn't confirm this",
            detail:
              'It stopped without reproducing the problem. A developer needs to look.',
            customer: null,
            tone: 'muted',
          };
    case 'error':
      return {
        headline: 'Something went wrong on our side',
        detail: 'The task failed before it finished. Try forwarding it again.',
        customer: null,
        tone: 'red',
      };
  }
};

// The four steps from report to reviewed fix, for the progress strip.
export type StepState = 'done' | 'current' | 'todo' | 'stopped';
export type Step = { label: string; state: StepState };

export const progress = (t: TaskSnapshot): Step[] => {
  const live = t.status === 'queued' || t.status === 'working';
  const fixed = t.status === 'proposed' || t.status === 'pr_opened';
  const ended = !live && !fixed;
  const repro = reproduced(t) || fixed;
  const step = (label: string, done: boolean, current: boolean): Step => ({
    label,
    state: done ? 'done' : current ? 'current' : 'todo',
  });
  const steps = [
    step('Report received', true, false),
    step('Problem reproduced', repro, live),
    step('Fix passes the tests', fixed, live && repro),
    // The review happens on the pull request; the hub doesn't follow it
    // after it opens, so this step stays current.
    step('Developer review', false, t.status === 'pr_opened'),
  ];
  // Where an ended task stopped: the first step it didn't finish.
  if (ended) {
    const at = steps.findIndex((s) => s.state !== 'done');
    if (at > 0) steps[at] = { ...steps[at]!, state: 'stopped' };
  }
  return steps;
};

export const createdBy = (tasks: TaskSnapshot[], role: Role) =>
  tasks.filter((t) => t.input.role === role);

export const taskForIncident = (tasks: TaskSnapshot[], incidentId: string) =>
  tasks.find((t) => t.input.incidentId === incidentId);

export const timeAgo = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

// Who wrote the reply draft, in the rep's words.
export const replyDraftLabel = (d: { source: 'model' | 'template' }) =>
  d.source === 'model' ? 'Drafted by the model' : 'Drafted from a template';
// The fixture run's result on the flagged task's Containment tab: each
// layer, and whether it fired. The scanner reads the flagged report; the
// other layers read the fixture run, which tried each of them in turn.
export type LayerState =
  'flagged' | 'not fired' | 'refused' | 'blocked' | 'not reached' | 'waiting';
export type Layer = { name: string; state: LayerState; detail: string | null };

const isHubPath = (path: string) => path === '.hub' || path.startsWith('.hub/');

export const fixtureLayers = (
  flagged: TaskSnapshot,
  fixture: TaskSnapshot | null
): Layer[] => {
  const ended =
    fixture !== null &&
    fixture.status !== 'queued' &&
    fixture.status !== 'working';
  const idle: LayerState = ended ? 'not reached' : 'waiting';
  const refusal = (hub: boolean) =>
    fixture?.refusals.find((r) => isHubPath(r.path) === hub);
  const policy = refusal(false);
  const lock = refusal(true);
  const blocked = fixture?.blocked.find((b) => b.startsWith('network: '));
  return [
    {
      name: 'Input scanner',
      state: flagged.inputSignals.length ? 'flagged' : 'not fired',
      detail: flagged.inputSignals.join(', ') || null,
    },
    {
      name: 'Role policy',
      state: policy ? 'refused' : idle,
      detail: policy ? `${policy.path} (${policy.rule})` : null,
    },
    {
      name: '.hub/ lock',
      state: lock ? 'refused' : idle,
      detail: lock ? `${lock.path} (${lock.rule})` : null,
    },
    {
      name: 'Sandbox network',
      state: blocked ? 'blocked' : idle,
      detail: blocked ? blocked.slice('network: '.length) : null,
    },
  ];
};
