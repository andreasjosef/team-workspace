import { Link, useParams } from 'react-router';
import { Status } from '../components/common.tsx';
import { Workspace } from '../components/Workspace.tsx';
import { useTask } from '../queries.ts';

// One task on its own page, linkable from anywhere, with the same two
// views as the cockpit: the conversation and the agent's working.
export const TaskPage = () => {
  const params = useParams();
  const task = useTask(params.id ?? '');
  const t = task.data;

  if (task.isError) return <p className="error">{task.error.message}</p>;
  if (!t) return <p className="muted">Loading…</p>;

  return (
    <main className="focus focus-page">
      <p className="small">
        <Link
          to={t.input.incidentId ? `/cs?report=${t.input.incidentId}` : '/cs'}
        >
          ← Inbox
        </Link>
      </p>
      <p className="muted small focus-meta">
        {t.input.incidentId ?? 'Report'} · forwarded by {t.input.role} · branch{' '}
        <code>{t.branch}</code>
      </p>
      <div className="task-head">
        <h1 className="focus-title">{t.input.title}</h1>
        <Status status={t.status} />
      </div>
      <Workspace
        from={t.fixtureOf === null ? 'The customer' : 'The fixture'}
        label={
          t.fixtureOf === null
            ? 'treated as untrusted'
            : "a script fixed in the hub's code, not the model"
        }
        text={t.input.text}
        task={t}
      />
    </main>
  );
};
