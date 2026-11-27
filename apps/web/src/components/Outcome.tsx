import type { TaskSnapshot } from '@app/shared';
import { outcome } from '../taskView.ts';

// The task in plain words, at the top of the pipeline card in the Agent
// view: what happened, the pull request a developer reviews, and why it
// stopped if it did. The stages below show how far it got and what was
// contained. Nothing is decided here: a developer merges the pull request on
// GitHub.
export const OutcomeSummary = ({ task }: { task: TaskSnapshot }) => {
  const o = outcome(task);
  return (
    <div className="outcome-summary">
      <h2 className="outcome-headline">{o.headline}</h2>
      <p className="outcome-detail">
        {o.detail}
        {task.status === 'pr_opened' && task.pr && (
          <>
            {' '}
            <a href={task.pr.url} rel="noreferrer">
              Pull request #{task.pr.number}
              {task.pr.draft ? ' (draft)' : ''} →
            </a>
          </>
        )}
      </p>
      {/* The drafted reply, in the Conversation, says it better. */}
      {o.customer && !task.replyDraft && (
        <p className="outcome-detail">
          <span className="muted">You can tell the customer: </span>“
          {o.customer}”
        </p>
      )}
      {task.statusReason &&
        ['flagged', 'gave_up', 'error'].includes(task.status) && (
          <p className="muted small outcome-detail">
            Why it stopped: {task.statusReason}
          </p>
        )}
    </div>
  );
};
