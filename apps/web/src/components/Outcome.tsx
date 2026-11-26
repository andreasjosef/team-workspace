import type { TaskSnapshot } from '@app/shared';
import { outcome } from '../taskView.ts';
import { Progress } from './common.tsx';
import { SafetyLine } from './Receipt.tsx';

// The task in plain words, for the support rep: what happened, what's next,
// what to tell the customer, how far it got and whether anything was
// stopped. Nothing is decided here: a developer merges the pull request on
// GitHub.
export const OutcomeCard = ({ task }: { task: TaskSnapshot }) => {
  const o = outcome(task);
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
        ['flagged', 'gave_up', 'error'].includes(task.status) && (
          <p className="muted small outcome-reason">
            Why it stopped: {task.statusReason}
          </p>
        )}
      <Progress task={task} />
      <SafetyLine task={task} />
    </section>
  );
};
