import type { TaskSnapshot } from '@app/shared';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { statusLook } from '../taskView.ts';
import { Conversation } from './Conversation.tsx';
import { Dot } from './common.tsx';
import { OutcomeCard } from './Outcome.tsx';
import { ReceiptTabs } from './Receipt.tsx';

// The main column under a report's title: two views of one report. The
// Conversation is the support rep's: the customer, the agent's verdict in
// plain words, the reply. The Agent view is the working: the outcome, then
// the receipt. The pick lives in the URL (`?view=agent`), so a link opens
// the same view and it stays put when the rep moves between reports.

type View = 'conversation' | 'agent';

export const Workspace = ({
  from,
  label,
  text,
  task,
  forward,
}: {
  from: string;
  label: string;
  text: string;
  task: TaskSnapshot | undefined;
  forward?: ReactNode;
}) => {
  const [params, setParams] = useSearchParams();
  const view: View =
    task && params.get('view') === 'agent' ? 'agent' : 'conversation';
  const pick = (v: View) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === 'agent') next.set('view', 'agent');
        else next.delete('view');
        return next;
      },
      { replace: true }
    );
  const look = task ? statusLook[task.status] : null;

  return (
    <>
      <div className="view-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'conversation'}
          className={`view-tab ${view === 'conversation' ? 'active' : ''}`}
          onClick={() => pick('conversation')}
        >
          Conversation
        </button>
        <button
          role="tab"
          aria-selected={view === 'agent'}
          className={`view-tab ${view === 'agent' ? 'active' : ''}`}
          disabled={!task}
          title={task ? undefined : 'Forward the report to start the agent'}
          onClick={() => pick('agent')}
        >
          Agent
          {look && (
            <span className={`view-tab-status tone-${look.tone}`}>
              <Dot tone={look.tone} />
              {look.label}
            </span>
          )}
        </button>
      </div>
      {view === 'conversation' || !task ? (
        <Conversation
          from={from}
          label={label}
          text={text}
          task={task}
          forward={forward}
          onOpenAgent={() => pick('agent')}
        />
      ) : (
        <>
          <OutcomeCard task={task} />
          <ReceiptTabs task={task} />
        </>
      )}
    </>
  );
};
