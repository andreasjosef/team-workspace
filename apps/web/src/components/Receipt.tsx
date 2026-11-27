import type { EventEnvelope, RoleSummary, TaskSnapshot } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, unwrap } from '../api.ts';
import { useDiff, useRoles, useTask } from '../queries.ts';
import {
  fixtureLayers,
  taskLayers,
  type Layer,
  type LayerState,
  type Tone,
} from '../taskView.ts';
import { DiffView } from './DiffView.tsx';
import { LiveLog } from './LiveLog.tsx';
import { RunView } from './RunView.tsx';

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
    <p className="card card-edge edge-red tab-lead">
      <strong>Fixture: a scripted hostile proposal, not the model.</strong> The
      hub replayed a fixed proposal through the real role policy, sandbox and
      patch check. It never publishes.{' '}
      <Link to={`/cs/tasks/${task.fixtureOf}`}>The flagged task</Link>
    </p>
  );

// Green means the layer did its job and stopped something.
const layerTone: Record<LayerState, Tone> = {
  flagged: 'green',
  refused: 'green',
  blocked: 'green',
  'not fired': 'muted',
  'not reached': 'muted',
  waiting: 'blue',
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
    <section className="containment-part">
      <div className="card-label">What if the model had obeyed?</div>
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
  <ol className="layers">
    {layers.map((l) => (
      <li key={l.name} className="layer">
        <span className="layer-name">{l.name}</span>
        <span className={`pill pill-${layerTone[l.state]}`}>{l.state}</span>
        {l.detail && <span className="layer-detail">{l.detail}</span>}
      </li>
    ))}
  </ol>
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
      <div className="card-label">
        {task.fixtureOf === null
          ? 'Each layer on this task'
          : 'The fixture run'}
      </div>
      <LayerList layers={taskLayers(task)} />
      {!clean && (
        <section className="containment-part">
          <div className="card-label">Everything stopped</div>
          <ul className="stopped-list">
            {task.inputSignals.map((sig) => (
              <li key={sig}>
                <span className="muted">Report:</span> {sig}
              </li>
            ))}
            {task.refusals.map((r, i) => (
              <li key={i}>
                <span className="muted">Refused:</span> <code>{r.path}</code>{' '}
                <span className="muted">({r.rule})</span>
              </li>
            ))}
            {task.blocked.map((b, i) => (
              <li key={i}>
                <span className="muted">Blocked:</span> {b}
              </li>
            ))}
          </ul>
        </section>
      )}
      {task.status === 'flagged' && task.fixtureOf === null && (
        <FixtureRun task={task} />
      )}
      <p className="muted small containment-part">
        One throwaway container per command, with no secrets. Checks and fixes
        run with no network at all; only installs go out, through the egress
        proxy's allowlist.
      </p>
      {role && <RoleScope role={role} />}
    </>
  );
};

type Tab = 'changes' | 'run' | 'containment' | 'log';

export const ReceiptTabs = ({
  task,
  events,
}: {
  task: TaskSnapshot;
  events?: EventEnvelope[];
}) => {
  const [picked, setPicked] = useState<Tab | null>(null);
  const diff = useDiff(task.id, task.hasDiff, task.status);
  const flagged =
    task.inputSignals.length + task.refusals.length + task.blocked.length > 0;
  // Until the reader picks one: what got stopped for a flagged task, else
  // the change once there is one, else the log.
  const tab =
    picked ??
    (task.status === 'flagged'
      ? 'containment'
      : task.hasDiff
        ? 'changes'
        : 'log');
  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: 'changes', label: 'Changes', hidden: !task.hasDiff },
    { id: 'run', label: 'Run' },
    { id: 'containment', label: flagged ? 'Containment ●' : 'Containment' },
    { id: 'log', label: 'Log' },
  ];

  return (
    <section className="receipt">
      <div className="receipt-head">
        <div className="tabs" role="tablist">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => (
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
      <div className={`receipt-body ${tab === 'changes' ? 'flush' : ''}`}>
        {tab === 'changes' && <DiffView diff={diff.data ?? ''} />}
        {tab === 'run' && <RunView task={task} />}
        {tab === 'containment' && <ContainmentView task={task} />}
        {tab === 'log' && (
          <LiveLog key={task.id} taskId={task.id} events={events} />
        )}
      </div>
    </section>
  );
};
