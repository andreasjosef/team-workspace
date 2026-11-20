import { Role } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, unwrap } from '../api.ts';
import { Status } from '../components/common.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { LiveLog } from '../components/LiveLog.tsx';
import {
  ChecksPanel,
  ContextPanel,
  SecurityPanel,
} from '../components/Receipt.tsx';
import { useDiff, useTask } from '../queries.ts';
import { canApprove, canReject, decider } from '../taskView.ts';

// One task, as the current role sees it: the receipt, the diff, the live log,
// and the approve/reject buttons only for the role allowed to press them.
export const TaskPage = () => {
  const params = useParams();
  const role = Role.parse(params.role);
  const id = params.id ?? '';
  const task = useTask(id);
  const t = task.data;
  const diff = useDiff(id, Boolean(t?.hasDiff), t?.status ?? '');
  const client = useQueryClient();

  const decide = useMutation({
    mutationFn: async (action: 'approve' | 'reject') =>
      unwrap(await api[action](id, { role })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['task', id] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  if (task.isError) return <p className="error">{task.error.message}</p>;
  if (!t) return <p className="muted">Loading…</p>;

  return (
    <>
      <p className="small">
        <Link to={`/${role}`}>← back</Link>
      </p>
      <div className="task-head">
        <h1>{t.input.title}</h1>
        <Status status={t.status} />
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {t.input.kind} from {t.input.role}
        {t.input.incidentId ? ` (${t.input.incidentId})` : ''} · branch{' '}
        <code>{t.branch}</code> · approval by {decider(t)}
        {t.decidedBy ? ` · decided by ${t.decidedBy}` : ''}
      </p>

      <div className="actions">
        {canApprove(t, role) && (
          <button
            className="btn btn-primary"
            disabled={decide.isPending}
            onClick={() => decide.mutate('approve')}
          >
            Approve and deploy
          </button>
        )}
        {canReject(t, role) && (
          <button
            className="btn btn-danger"
            disabled={decide.isPending}
            onClick={() => decide.mutate('reject')}
          >
            {t.status === 'proposed' ? 'Reject' : 'Close'}
          </button>
        )}
        {t.status === 'proposed' && !canApprove(t, role) && (
          <span className="muted">Waiting for {decider(t)} to review.</span>
        )}
        {t.previewUrl && (
          <a
            className="btn"
            href={t.previewUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open preview
          </a>
        )}
        {t.statusReason && <span className="muted">{t.statusReason}</span>}
        {decide.isError && (
          <span className="error">{decide.error.message}</span>
        )}
      </div>

      <div className="cols cols-task">
        <div>
          <div className="panel">
            <h2>Task</h2>
            <div className="untrusted-label">
              As submitted, treated as untrusted
            </div>
            <p className="untrusted">{t.input.text}</p>
          </div>
          <SecurityPanel task={t} />
          <ContextPanel task={t} />
          <ChecksPanel task={t} />
        </div>
        <div>
          {t.hasDiff && <DiffView diff={diff.data ?? ''} />}
          <div className={t.hasDiff ? 'below' : ''}>
            <LiveLog key={id} taskId={id} />
          </div>
        </div>
      </div>
    </>
  );
};
