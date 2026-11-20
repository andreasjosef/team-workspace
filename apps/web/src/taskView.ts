import type { Role, TaskSnapshot, TaskStatus } from '@app/shared';

// Pure helpers behind the role views: what each status looks like, and which
// tasks land in which column. Kept out of the components so they're testable.

export type Tone = 'gold' | 'green' | 'red' | 'blue' | 'muted';

export const statusLook: Record<TaskStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'blue' },
  working: { label: 'Agent working', tone: 'blue' },
  proposed: { label: 'Needs approval', tone: 'gold' },
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

// The dev's board: what needs them first, then what's suspicious, then the rest.
export const devColumns = (tasks: TaskSnapshot[]) => ({
  review: tasks.filter((t) => canApprove(t, 'dev')),
  flagged: tasks.filter((t) => t.status === 'flagged'),
  active: tasks.filter((t) =>
    ['queued', 'working', 'approved'].includes(t.status)
  ),
  closed: tasks.filter((t) =>
    ['deployed', 'rejected', 'gave_up', 'error'].includes(t.status)
  ),
});

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
