import type { EventEnvelope, TaskSnapshot } from '@app/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  clock,
  elapsed,
  liveStages,
  outcome,
  threadEvents,
  type Stage,
} from '../taskView.ts';
import { useTaskEvents } from '../useTaskEvents.ts';
import { ReplyDraftBox } from './ReplyDraft.tsx';

// The Conversation view: the exchange with the customer as one thread, in
// order. Their message (untrusted, shown as data), the milestones of the
// agent's run as quiet timeline lines, a live box while the hub works, then
// the outcome in plain words and our reply. Before the report is
// forwarded, the forward button sits where the reply goes.

export const Conversation = ({
  from,
  label,
  at,
  text,
  task,
  onOpenAgent,
  forward,
}: {
  from: string;
  label: string;
  at: string | null;
  text: string;
  task: TaskSnapshot | undefined;
  onOpenAgent: () => void;
  forward?: ReactNode;
}) => (
  <ol className="thread">
    <li className="bubble bubble-in">
      <div className="bubble-from">
        <span>{from}</span>
        <span>{label}</span>
        {at && <span>{clock(at)}</span>}
      </div>
      <p className="untrusted bubble-text">{text}</p>
    </li>
    {task ? (
      <TaskThread key={task.id} task={task} onOpenAgent={onOpenAgent} />
    ) : (
      forward && <li className="thread-compose">{forward}</li>
    )}
  </ol>
);

// Ticks once a second while `on`, so elapsed times move.
const useNow = (on: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
};

const TaskThread = ({
  task,
  onOpenAgent,
}: {
  task: TaskSnapshot;
  onOpenAgent: () => void;
}) => {
  const events = useTaskEvents(task.id);
  const live = task.status === 'queued' || task.status === 'working';
  const now = useNow(live);
  return (
    <>
      {threadEvents(events).map((e) => (
        <li key={e.seq} className="t-event">
          <span className={`t-dot tone-${e.tone}`} aria-hidden="true" />
          <span className="t-text">{e.text}</span>
          <span className="t-time">{clock(e.at)}</span>
        </li>
      ))}
      {live ? (
        <LiveBox stages={liveStages(events, true)} events={events} now={now} />
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
};

const stageMark: Record<Stage['state'], string> = {
  done: '✓',
  current: '',
  todo: '',
  stopped: '✕',
};

// What the hub is doing right now: its four stages, the one under way with
// a pulse, its elapsed time and the last thing it ran.
const LiveBox = ({
  stages,
  events,
  now,
}: {
  stages: Stage[];
  events: EventEnvelope[];
  now: number;
}) => {
  const first = events[0];
  return (
    <li className="card live" aria-live="polite">
      <div className="card-label">
        <span className="pulse" aria-hidden="true" />
        Agent at work
        {first && (
          <span className="card-label-end">{elapsed(first.at, now)}</span>
        )}
      </div>
      <ol className="stages">
        {stages.map((s) => (
          <li key={s.id} className={`stage stage-${s.state}`}>
            <span className="stage-mark" aria-hidden="true">
              {stageMark[s.state]}
            </span>
            <span className="stage-label">{s.label}</span>
            <span className="stage-time">
              {s.startedAt &&
                (s.state === 'current'
                  ? elapsed(s.startedAt, now)
                  : s.endedAt && elapsed(s.startedAt, Date.parse(s.endedAt)))}
            </span>
            {s.state === 'current' && s.latest && (
              <code className="stage-latest">{s.latest}</code>
            )}
          </li>
        ))}
      </ol>
    </li>
  );
};

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
