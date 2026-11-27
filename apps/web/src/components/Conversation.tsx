import type { EventEnvelope, TaskSnapshot } from '@app/shared';
import { useState, type ReactNode } from 'react';
import {
  clock,
  elapsed,
  outcome,
  threadEvents,
  type ThreadEvent,
} from '../taskView.ts';
import { ReplyDraftBox } from './ReplyDraft.tsx';

// The Conversation view: the exchange with the customer as one thread, in
// order. Their message (untrusted, shown as data), the milestones of the
// agent's run as quiet timeline lines, the live pipeline while the hub
// works, then
// the outcome in plain words and our reply. Before the report is
// forwarded, the forward button sits where the reply goes.

export const Conversation = ({
  from,
  label,
  at,
  text,
  task,
  events,
  live,
  onOpenAgent,
  forward,
}: {
  from: string;
  label: string;
  at: string | null;
  text: string;
  task: TaskSnapshot | undefined;
  events: EventEnvelope[];
  live: ReactNode;
  onOpenAgent: () => void;
  forward?: ReactNode;
}) => (
  <ol className="thread">
    <li className="bubble bubble-in" data-tour="report">
      <div className="bubble-from">
        <span>{from}</span>
        <span>{label}</span>
        {at && <span>{clock(at)}</span>}
      </div>
      <p className="untrusted bubble-text">{text}</p>
    </li>
    {task ? (
      <TaskThread
        task={task}
        events={events}
        live={live}
        onOpenAgent={onOpenAgent}
      />
    ) : (
      forward && <li className="thread-compose">{forward}</li>
    )}
  </ol>
);

// The run's milestones, folded to one row of fixed height: the latest one,
// its time and how many there are. A live run only changes that row, so
// the thread doesn't grow line by line. Opens to the full list.
const Timeline = ({ items }: { items: ThreadEvent[] }) => {
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  if (!last) return null;
  return (
    <li className="timeline">
      <button
        className="t-event t-summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`t-dot tone-${last.tone}`} aria-hidden="true" />
        <span className="t-text">{open ? 'Timeline' : last.text}</span>
        <span className="t-count">
          {items.length} event{items.length === 1 ? '' : 's'} {open ? '▾' : '▸'}
        </span>
        <span className="t-time">{clock(last.at)}</span>
      </button>
      {open && (
        <ol className="t-list">
          {items.map((e) => (
            <li key={e.seq} className="t-event">
              <span className={`t-dot tone-${e.tone}`} aria-hidden="true" />
              <span className="t-text">{e.text}</span>
              <span className="t-time">{clock(e.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
};

const TaskThread = ({
  task,
  events,
  live,
  onOpenAgent,
}: {
  task: TaskSnapshot;
  events: EventEnvelope[];
  live: ReactNode;
  onOpenAgent: () => void;
}) => (
  <>
    <Timeline items={threadEvents(events)} />
    {task.status === 'queued' || task.status === 'working' ? (
      <li className="thread-live">{live}</li>
    ) : (
      <AgentNote task={task} events={events} onOpenAgent={onOpenAgent} />
    )}
    {task.replyDraft && (
      <li className="bubble bubble-out">
        <ReplyDraftBox task={task} />
      </li>
    )}
  </>
);

// Where the run ended, in the rep's words. The working is on the Agent view.
const AgentNote = ({
  task,
  events,
  onOpenAgent,
}: {
  task: TaskSnapshot;
  events: EventEnvelope[];
  onOpenAgent: () => void;
}) => {
  const o = outcome(task);
  const first = events[0];
  const last = events[events.length - 1];
  return (
    <li className={`card card-edge edge-${o.tone}`}>
      <div className="card-label">
        Agent
        {first && last && (
          <span className="card-label-end">
            took {elapsed(first.at, Date.parse(last.at))}
          </span>
        )}
      </div>
      <strong className="card-headline">{o.headline}</strong>
      <p className="card-text">{o.detail}</p>
      {o.customer && !task.replyDraft && (
        <p className="card-text">
          <span className="muted">You can tell the customer: </span>“
          {o.customer}”
        </p>
      )}
      <div className="card-actions">
        {task.pr && (
          <a href={task.pr.url} rel="noreferrer">
            Pull request #{task.pr.number}
          </a>
        )}
        <button className="linkish" onClick={onOpenAgent}>
          See what the agent did →
        </button>
      </div>
    </li>
  );
};
