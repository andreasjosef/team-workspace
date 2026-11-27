import type { TaskSnapshot } from '@app/shared';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { usePipeline } from '../hooks/usePipeline.ts';
import { useTaskEvents } from '../hooks/useTaskEvents.ts';
import { statusLook } from '../taskView.ts';
import { Conversation } from './Conversation.tsx';
import { Dot } from './common.tsx';
import { OutcomeSummary } from './Outcome.tsx';
import { PipelineFlow } from './PipelineFlow.tsx';
import { ReceiptTabs } from './Receipt.tsx';

// The main column under a report's title: two views of one report. The
// Conversation is the support rep's: the customer, the run's milestones,
// the live pipeline while the hub works, the outcome and the reply. The
// Agent view is the working: the pipeline (with Replay) headed by the
// outcome, then the receipt. The pick lives in the URL (`?view=agent`), so a link opens
// the same view and it stays put when the rep moves between reports.

type View = 'conversation' | 'agent';

type Props = {
  from: string;
  label: string;
  at: string | null;
  text: string;
  task: TaskSnapshot | undefined;
  forward?: ReactNode;
};

export const Workspace = (props: Props) => {
  const [params, setParams] = useSearchParams();
  const { task } = props;
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
      {task ? (
        <TaskViews
          key={task.id}
          {...props}
          task={task}
          view={view}
          onOpenAgent={() => pick('agent')}
        />
      ) : (
        <Conversation
          {...props}
          task={undefined}
          events={[]}
          live={null}
          onOpenAgent={() => pick('agent')}
        />
      )}
    </>
  );
};

// One subscription to the task's events feeds both views.
const TaskViews = ({
  task,
  view,
  onOpenAgent,
  ...message
}: Props & {
  task: TaskSnapshot;
  view: View;
  onOpenAgent: () => void;
}) => {
  const events = useTaskEvents(task.id);
  const pipeline = usePipeline(task, events);

  if (view === 'conversation')
    return (
      <Conversation
        {...message}
        task={task}
        events={events}
        onOpenAgent={onOpenAgent}
        live={
          <PipelineFlow
            model={pipeline.model}
            replaying={false}
            canReplay={false}
            onReplay={() => {}}
            onStopReplay={() => {}}
          />
        }
      />
    );

  // While replaying, the outcome and the receipt show the task as of the
  // beat on the card.
  const shown = pipeline.viewTask;
  return (
    <>
      <PipelineFlow
        outcome={<OutcomeSummary task={shown} />}
        model={pipeline.model}
        replaying={pipeline.replaying}
        canReplay={pipeline.canReplay}
        onReplay={pipeline.replay}
        onStopReplay={pipeline.stop}
      />
      <ReceiptTabs task={shown} events={events} />
    </>
  );
};
