import { Role } from '@app/shared';
import { Link, useParams } from 'react-router';
import { Status } from '../components/common.tsx';
import { OutcomeCard } from '../components/Outcome.tsx';
import { ReceiptTabs } from '../components/Receipt.tsx';
import { useTask } from '../queries.ts';
import { decider } from '../taskView.ts';

// One task on its own page: the link a developer opens to review it. Same
// order as the cockpit: the outcome in plain words, the customer's report,
// then the receipt.
export const TaskPage = () => {
  const params = useParams();
  const role = Role.parse(params.role);
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
        <code>{t.branch}</code> · review by {decider(t)}
        {t.decidedBy ? ` · decided by ${t.decidedBy}` : ''}
      </p>
      <div className="task-head">
        <h1 className="focus-title">{t.input.title}</h1>
        <Status status={t.status} />
      </div>
      <OutcomeCard task={t} role={role} />
      <section className="message">
        <div className="untrusted-label">
          The customer's report · treated as untrusted
        </div>
        <p className="untrusted">{t.input.text}</p>
      </section>
      <ReceiptTabs task={t} />
    </main>
  );
};
