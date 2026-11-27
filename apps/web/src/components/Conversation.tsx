import type { TaskSnapshot } from '@app/shared';
import type { ReactNode } from 'react';
import { outcome } from '../taskView.ts';
import { Progress } from './common.tsx';
import { ReplyDraftBox } from './ReplyDraft.tsx';

// The Conversation tab: the exchange with the customer as a thread. Their
// message on the left (untrusted, shown as data), what the agent made of
// it in the middle, and our reply on the right once there's a draft. Before
// the report is forwarded, the forward button sits where the reply goes.

export const Conversation = ({
  from,
  label,
  text,
  task,
  onOpenAgent,
  forward,
}: {
  from: string;
  label: string;
  text: string;
  task: TaskSnapshot | undefined;
  onOpenAgent: () => void;
  forward?: ReactNode;
}) => (
  <ol className="thread">
    <li className="bubble bubble-in">
      <div className="bubble-from">
        {from} <span className="muted">· {label}</span>
      </div>
      <p className="untrusted bubble-text">{text}</p>
    </li>
    {task && <AgentNote task={task} onOpenAgent={onOpenAgent} />}
    {task?.replyDraft ? (
      <li className="bubble bubble-out">
        <ReplyDraftBox task={task} />
      </li>
    ) : (
      !task && forward && <li className="thread-compose">{forward}</li>
    )}
  </ol>
);

// The agent's part of the thread, in the rep's words. Its full working is
// on the Agent tab.
const AgentNote = ({
  task,
  onOpenAgent,
}: {
  task: TaskSnapshot;
  onOpenAgent: () => void;
}) => {
  const o = outcome(task);
  return (
    <li className={`bubble bubble-agent outcome-${o.tone}`}>
      <div className="bubble-from">Agent</div>
      <strong className="bubble-headline">{o.headline}</strong>
      <p className="bubble-text small">{o.detail}</p>
      {o.customer && !task.replyDraft && (
        <p className="outcome-customer small">
          <span className="muted">You can tell the customer: </span>“
          {o.customer}”
        </p>
      )}
      <Progress task={task} />
      <button className="linkish small" onClick={onOpenAgent}>
        See what the agent did →
      </button>
    </li>
  );
};
