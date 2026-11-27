import type { TaskSnapshot } from '@app/shared';
import { outcome } from '../taskView.ts';
import { Progress } from './common.tsx';
import { SafetyLine } from './Receipt.tsx';

// The task in plain words, for the support rep: what happened, the pull
// request a developer reviews, how far it got and whether anything was
// stopped. The drafted reply sits right under it. Nothing is decided here: a developer merges the pull request on
// GitHub.
export const OutcomeCard = ({ task }: { task: TaskSnapshot }) => {
  const o = outcome(task);
  return (
    <section className={`card card-edge edge-${o.tone} outcome-card`}>
      <div className="card-label">Outcome</div>
      <h2 className="card-headline">{o.headline}</h2>
      <p className="card-text">{o.detail}</p>
      {task.status === 'pr_opened' && task.pr && (
        <p className="card-actions">
          <a href={task.pr.url} rel="noreferrer">
            Pull request #{task.pr.number}
            {task.pr.draft ? ' (draft)' : ''}, waiting for a developer →
          </a>
        </p>
      )}
      {/* The drafted reply, right under this card, says it better. */}
      {o.customer && !task.replyDraft && (
        <p className="card-text">
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
