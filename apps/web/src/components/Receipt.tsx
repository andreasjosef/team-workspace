import type { RoleSummary, TaskSnapshot } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../api.ts';
import { useTaskEvents } from '../hooks/useTaskEvents.ts';
import {
  buildReplayCutoffs,
  derivePipeline,
  snapshotFromEvents,
} from '../pipelineView.ts';
import { useDiff, useRoles, useTask } from '../queries.ts';
import {
  fixtureLayers,
  taskLayers,
  type Layer,
  type LayerState,
} from '../taskView.ts';
import { AgentView } from './AgentView.tsx';
import { ChecksView } from './ChecksView.tsx';
import { DiffView } from './DiffView.tsx';
import { LiveLog } from './LiveLog.tsx';
import { PipelineFlow } from './PipelineFlow.tsx';
import { ReplyDraftBox } from './ReplyDraft.tsx';

type ReceiptTab =
  'reply' | 'changes' | 'checks' | 'agent' | 'containment' | 'log';

// The receipt: what the agent saw, what it ran, what it changed and what got
// stopped. It lets a developer trust (or distrust) the change without
// reading the whole log. Tabs keep it to one readable column.

// One line for the top of the task: was anything stopped? The full list is
// on the Containment tab.
export const SafetyLine = ({ task }: { task: TaskSnapshot }) => {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [
    task.inputSignals.length > 0 && 'the report carried instructions',
    task.refusals.length > 0 &&
      `${plural(task.refusals.length, 'edit')} refused`,
    task.blocked.length > 0 &&
      `${plural(task.blocked.length, 'network attempt')} blocked`,
  ].filter(Boolean);
  return parts.length ? (
    <p className="safety tone-red">● Contained: {parts.join(', ')}.</p>
  ) : (
    <p className="safety tone-green">
      ● Contained: no secrets, no network, nothing stopped.
    </p>
  );
};

const RoleScope = ({ role }: { role: RoleSummary }) => (
  <dl className="kv">
    <dt>May change</dt>
    <dd>
      {role.write.allow.map((g) => (
        <span className="chip" key={g}>
          {g}
        </span>
      ))}
    </dd>
    <dt>Never</dt>
    <dd>
      {[...role.write.deny, '.hub/**'].map((g) => (
        <span className="chip" key={g}>
          {g}
        </span>
      ))}
    </dd>
  </dl>
);

// The label a fixture run carries wherever it appears.
export const FixtureLabel = ({ task }: { task: TaskSnapshot }) =>
  task.fixtureOf === null ? null : (
    <p className="alert tab-lead">
      <strong>Fixture: a scripted hostile proposal, not the model.</strong> The
      hub replayed a fixed proposal through the real role policy, sandbox and
      patch check. It never publishes.{' '}
      <Link to={`/cs/tasks/${task.fixtureOf}`}>The flagged task</Link>
    </p>
  );

const layerTone: Record<LayerState, string> = {
  flagged: 'tone-green',
  refused: 'tone-green',
  blocked: 'tone-green',
  'not fired': 'muted',
  'not reached': 'muted',
  waiting: 'tone-blue',
};

// "What if the model had obeyed?" on a flagged task: starts its fixture run,
// then shows each layer and whether it fired.
const FixtureRun = ({ task }: { task: TaskSnapshot }) => {
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: async () => unwrap(await api.startFixture(task.id)),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const fixtureId = task.fixtureRun ?? start.data?.taskId ?? null;
  return (
    <section className="tab-lead">
      <h3>What if the model had obeyed?</h3>
      {fixtureId ? (
        <FixtureResult task={task} fixtureId={fixtureId} />
      ) : (
        <>
          <p className="muted small">
            Runs a scripted hostile proposal (an admin user in{' '}
            <code>src/auth/</code>, a wider role under <code>.hub/</code>, a
            test that posts <code>.env</code> to the attacker's URL) through the
            real policy and sandbox. Nothing is published.
          </p>
          <button
            className="btn"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'What if the model had obeyed?'}
          </button>
          {start.isError && <p className="error">{start.error.message}</p>}
        </>
      )}
    </section>
  );
};

const LayerList = ({ layers }: { layers: Layer[] }) => (
  <dl className="kv">
    {layers.map((l) => (
      <Fragment key={l.name}>
        <dt>{l.name}</dt>
        <dd>
          <span className={layerTone[l.state]}>{l.state}</span>
          {l.detail && <span className="muted"> · {l.detail}</span>}
        </dd>
      </Fragment>
    ))}
  </dl>
);

const FixtureResult = ({
  task,
  fixtureId,
}: {
  task: TaskSnapshot;
  fixtureId: string;
}) => {
  const fixture = useTask(fixtureId).data ?? null;
  return (
    <>
      <p className="muted small">
        <strong>Fixture: a scripted hostile proposal, not the model.</strong>{' '}
        <Link to={`/cs/tasks/${fixtureId}`}>The fixture task</Link>
        {fixture?.pr === null && fixture.status === 'flagged'
          ? ' · nothing published'
          : ''}
      </p>
      <LayerList layers={fixtureLayers(task, fixture)} />
    </>
  );
};

// Each layer and whether it fired on this task, the details of anything
// stopped, and on a flagged task the fixture run.
const ContainmentView = ({ task }: { task: TaskSnapshot }) => {
  const role = useRoles().data?.find((r) => r.name === task.input.role);
  const clean =
    !task.inputSignals.length && !task.refusals.length && !task.blocked.length;
  return (
    <>
      <FixtureLabel task={task} />
      <h3>{task.fixtureOf === null ? 'This task' : 'The fixture run'}</h3>
      <LayerList layers={taskLayers(task)} />
      {!clean && (
        <div className="alert tab-lead">
          {task.inputSignals.length > 0 && (
            <>
              <strong>The report looks like it carries instructions</strong>
              <ul>
                {task.inputSignals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {task.refusals.length > 0 && (
            <>
              <strong>Edits refused by the {task.input.role} policy</strong>
              <ul>
                {task.refusals.map((r, i) => (
                  <li key={i}>
                    <code>{r.path}</code>{' '}
                    <span className="muted">({r.rule})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {task.blocked.length > 0 && (
            <>
              <strong>Blocked by the sandbox</strong>
              <ul>
                {task.blocked.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {task.status === 'flagged' && task.fixtureOf === null && (
        <FixtureRun task={task} />
      )}
      <p className="muted small">
        One throwaway container per command, with no secrets. Checks and fixes
        run with no network at all; only installs go out, through the egress
        proxy's allowlist.
      </p>
      {role && <RoleScope role={role} />}
    </>
  );
};

const REPLAY_BEAT_MS = 620;

const scrollElementToTop = (el: HTMLElement | null) => {
  if (!el) return;
  const scroller = el.closest('.focus');
  if (scroller && scroller.scrollHeight > scroller.clientHeight + 2) {
    const top =
      scroller.scrollTop +
      el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export const ReceiptTabs = ({
  task,
  autoScroll = false,
  onAutoScrolled,
}: {
  task: TaskSnapshot;
  autoScroll?: boolean;
  onAutoScrolled?: () => void;
}) => {
  const [picked, setPicked] = useState<ReceiptTab | null>(null);
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const receiptRef = useRef<HTMLElement>(null);
  const events = useTaskEvents(task.id);
  const cutoffs = useMemo(() => buildReplayCutoffs(events), [events]);

  const replaying = replayStep !== null && cutoffs.length > 0;

  const focusPipeline = useCallback(() => {
    requestAnimationFrame(() => scrollElementToTop(receiptRef.current));
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    focusPipeline();
    onAutoScrolled?.();
  }, [autoScroll, focusPipeline, onAutoScrolled]);

  useEffect(() => {
    if (replayStep === null || cutoffs.length === 0) return;
    if (replayStep >= cutoffs.length - 1) {
      const done = setTimeout(() => setReplayStep(null), 900);
      return () => clearTimeout(done);
    }
    const next = setTimeout(
      () => setReplayStep((s) => (s === null ? null : s + 1)),
      REPLAY_BEAT_MS
    );
    return () => clearTimeout(next);
  }, [replayStep, cutoffs.length]);

  const visibleEvents = useMemo(
    () =>
      replaying
        ? events.slice(0, cutoffs[Math.min(replayStep, cutoffs.length - 1)]!)
        : events,
    [replaying, replayStep, cutoffs, events]
  );

  const viewTask = useMemo(
    () => snapshotFromEvents(task, visibleEvents, { replace: replaying }),
    [task, visibleEvents, replaying]
  );

  const diff = useDiff(task.id, viewTask.hasDiff, task.status);
  const diffText = viewTask.hasDiff ? (diff.data ?? '') : '';
  const pipeline = useMemo(
    () => derivePipeline(viewTask, visibleEvents, diffText),
    [viewTask, visibleEvents, diffText]
  );

  const flagged =
    viewTask.inputSignals.length +
      viewTask.refusals.length +
      viewTask.blocked.length >
    0;

  // Until the reader picks one: log while running, what got stopped for a
  // flagged task, else the change once there is one, else the reply draft,
  // else the log.
  const tab: ReceiptTab =
    picked ??
    (pipeline.live
      ? 'log'
      : viewTask.status === 'flagged'
        ? 'containment'
        : viewTask.hasDiff
          ? 'changes'
          : viewTask.replyDraft
            ? 'reply'
            : 'log');

  const tabs: { id: ReceiptTab; label: string }[] = [
    { id: 'reply', label: 'Reply' },
    { id: 'changes', label: 'Changes' },
    { id: 'checks', label: 'Checks' },
    { id: 'agent', label: 'Agent' },
    { id: 'containment', label: flagged ? 'Containment ●' : 'Containment' },
    { id: 'log', label: 'Log' },
  ];

  return (
    <section className="receipt" ref={receiptRef}>
      <div className="receipt-head">
        <h2>Receipt</h2>
        {viewTask.pr && (
          <a className="receipt-pr" href={viewTask.pr.url} rel="noreferrer">
            Pull request #{viewTask.pr.number}
            {viewTask.pr.draft ? ' (draft)' : ''}
          </a>
        )}
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''} ${
                t.id === 'containment' && flagged ? 'tone-red' : ''
              }`}
              onClick={() => setPicked(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <PipelineFlow
        model={pipeline}
        replaying={replaying}
        canReplay={!pipeline.live && cutoffs.length > 1}
        onReplay={() => {
          setReplayStep(0);
          focusPipeline();
        }}
        onStopReplay={() => setReplayStep(null)}
      />

      <div className={`receipt-body ${tab === 'changes' ? 'flush' : ''}`}>
        {tab === 'reply' && <ReplyDraftBox task={viewTask} />}
        {tab === 'changes' && <DiffView diff={diffText} />}
        {tab === 'checks' && <ChecksView task={viewTask} />}
        {tab === 'agent' && <AgentView task={viewTask} />}
        {tab === 'containment' && <ContainmentView task={viewTask} />}
        {tab === 'log' && (
          <LiveLog key={task.id} taskId={task.id} events={visibleEvents} />
        )}
      </div>
    </section>
  );
};
