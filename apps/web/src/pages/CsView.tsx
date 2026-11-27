import type { Incident } from '@app/shared';
import { useSearchParams } from 'react-router';
import { Dot, Status } from '../components/common.tsx';
import { ForwardButton } from '../components/ForwardButton.tsx';
import { Workspace } from '../components/Workspace.tsx';
import { useIncidents, useTasks } from '../queries.ts';
import { taskForIncident, timeAgo, type Tone } from '../taskView.ts';

const severityTone: Record<string, Tone> = {
  high: 'red',
  medium: 'gold',
  low: 'muted',
};

// The support rep's cockpit: the inbox of customer reports on the left, and
// the one they're working on in the middle, as a conversation with the
// customer or as the agent's working. Forwarding a report keeps them here.
export const CsView = () => {
  const reports = useIncidents().data ?? [];
  const tasks = useTasks().data ?? [];
  const [params, setParams] = useSearchParams();
  const selected =
    reports.find((r) => r.id === params.get('report')) ?? reports[0];

  return (
    <div className="cockpit">
      <aside className="inbox" aria-label="Customer reports">
        <h2>Inbox</h2>
        <ul className="list">
          {reports.map((r) => {
            const task = taskForIncident(tasks, r.id);
            return (
              <li key={r.id}>
                <button
                  className={`item ${r.id === selected?.id ? 'selected' : ''}`}
                  onClick={() =>
                    setParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('report', r.id);
                      return next;
                    })
                  }
                >
                  <span className="item-title">
                    <Dot tone={severityTone[r.severity] ?? 'muted'} />
                    {r.subject}
                  </span>
                  <span className="item-meta">
                    {task ? <Status status={task.status} /> : <span>New</span>}{' '}
                    · {r.customer} · {timeAgo(r.at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {reports.length === 0 && <p className="empty">No reports.</p>}
      </aside>

      <main className="focus">
        {selected ? (
          <Report report={selected} />
        ) : (
          <p className="empty">Pick a report.</p>
        )}
      </main>
    </div>
  );
};

const Report = ({ report }: { report: Incident }) => {
  const tasks = useTasks().data ?? [];
  const task = taskForIncident(tasks, report.id);
  return (
    <>
      <p className="muted small focus-meta">
        {report.id} · {report.severity} · {report.customer} via {report.channel}{' '}
        · {timeAgo(report.at)}
      </p>
      <h1 className="focus-title">{report.subject}</h1>
      <Workspace
        from={report.customer}
        label={`via ${report.channel} · treated as untrusted`}
        text={report.body}
        task={task}
        forward={<ForwardButton report={report} />}
      />
    </>
  );
};
