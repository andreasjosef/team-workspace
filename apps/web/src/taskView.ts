import type { Role, TaskSnapshot, TaskStatus } from '@app/shared';

// Pure helpers behind the views: what each status looks like, and the task
// in plain words. Kept out of the components so they're testable.

export type Tone = 'gold' | 'green' | 'red' | 'blue' | 'muted';

export const statusLook: Record<TaskStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'blue' },
  working: { label: 'Agent working', tone: 'blue' },
  proposed: { label: 'In review', tone: 'gold' },
  gave_up: { label: 'Gave up', tone: 'muted' },
  flagged: { label: 'Flagged', tone: 'red' },
  approved: { label: 'Deploying', tone: 'blue' },
  rejected: { label: 'Rejected', tone: 'muted' },
  deployed: { label: 'Live', tone: 'green' },
  error: { label: 'Error', tone: 'red' },
};

export const decider = (t: TaskSnapshot): Role => t.approver ?? t.input.role;

export const canApprove = (t: TaskSnapshot, role: Role) =>
  t.status === 'proposed' && decider(t) === role;

export const canReject = (t: TaskSnapshot, role: Role) =>
  ['proposed', 'flagged', 'gave_up'].includes(t.status) && decider(t) === role;

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
        headline: 'A fix is ready for review',
        detail:
          'The agent reproduced the problem with a test, then fixed it. A developer reviews the change before it ships.',
        customer: "We've confirmed the problem, and a fix is in review.",
        tone: 'gold',
      };
    case 'approved':
      return {
        headline: 'Fix approved',
        detail: 'A developer approved the fix. It ships now.',
        customer: "We've fixed it. It goes live shortly.",
        tone: 'blue',
      };
    case 'deployed':
      return {
        headline: 'Fixed and live',
        detail: 'A developer approved the fix, and it shipped.',
        customer: "It's fixed. Thanks for telling us.",
        tone: 'green',
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
    case 'rejected':
      return {
        headline: 'Closed by a developer',
        detail: 'A developer closed this without shipping it.',
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

// The four steps from report to shipped fix, for the progress strip.
export type StepState = 'done' | 'current' | 'todo' | 'stopped';
export type Step = { label: string; state: StepState };

export const progress = (t: TaskSnapshot): Step[] => {
  const live = t.status === 'queued' || t.status === 'working';
  // A rejected task had a passing fix; a developer closed it at review.
  const fixed = ['proposed', 'approved', 'deployed', 'rejected'].includes(
    t.status
  );
  const ended =
    !live && !['proposed', 'approved', 'deployed'].includes(t.status);
  const repro = reproduced(t) || fixed;
  const step = (label: string, done: boolean, current: boolean): Step => ({
    label,
    state: done ? 'done' : current ? 'current' : 'todo',
  });
  const steps = [
    step('Report received', true, false),
    step('Problem reproduced', repro, live),
    step('Fix passes the tests', fixed, live && repro),
    step(
      'Developer review',
      t.status === 'approved' || t.status === 'deployed',
      t.status === 'proposed'
    ),
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
  tasks.find(
    (t) => t.input.incidentId === incidentId && t.status !== 'rejected'
  );

export const timeAgo = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};
