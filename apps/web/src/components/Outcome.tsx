import type { Role, TaskSnapshot } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../api.ts';
import { canApprove, canReject, outcome } from '../taskView.ts';
import { Progress } from './common.tsx';
import { SafetyLine } from './Receipt.tsx';

// The task in plain words, for the support rep: what happened, what's next,
// what to tell the customer, how far it got and whether anything was
// stopped. A developer (on their review link) also gets the decision buttons.
export const OutcomeCard = ({
  task,
  role,
}: {
  task: TaskSnapshot;
  role: Role;
}) => {
  const o = outcome(task);
  const client = useQueryClient();
  const decide = useMutation({
    mutationFn: async (action: 'approve' | 'reject') =>
      unwrap(await api[action](task.id, { role })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['task', task.id] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const approve = canApprove(task, role);
  const reject = canReject(task, role);

  return (
    <section className={`outcome outcome-${o.tone}`}>
      <h2 className="outcome-headline">{o.headline}</h2>
      <p className="outcome-detail">{o.detail}</p>
      {o.customer && (
        <p className="outcome-customer">
          <span className="muted">You can tell the customer: </span>“
          {o.customer}”
        </p>
      )}
      {task.statusReason &&
        ['flagged', 'gave_up', 'error', 'rejected'].includes(task.status) && (
          <p className="muted small outcome-reason">
            Why it stopped: {task.statusReason}
          </p>
        )}
      <Progress task={task} />
      <SafetyLine task={task} />
      {(approve || reject || decide.isError) && (
        <div className="actions">
          {approve && (
            <button
              className="btn btn-primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate('approve')}
            >
              Approve and deploy
            </button>
          )}
          {reject && (
            <button
              className="btn btn-danger"
              disabled={decide.isPending}
              onClick={() => decide.mutate('reject')}
            >
              {task.status === 'proposed' ? 'Reject' : 'Close'}
            </button>
          )}
          {decide.isError && (
            <span className="error">{decide.error.message}</span>
          )}
        </div>
      )}
    </section>
  );
};
