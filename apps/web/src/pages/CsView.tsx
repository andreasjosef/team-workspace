import { useState } from 'react';
import { Link } from 'react-router';
import { Dot, RoleScope, Status, TaskList } from '../components/common.tsx';
import { TaskForm } from '../components/TaskForm.tsx';
import { useIncidents, useRoles, useTasks } from '../queries.ts';
import { createdBy, taskForIncident, timeAgo, type Tone } from '../taskView.ts';

const severityTone: Record<string, Tone> = {
  high: 'red',
  medium: 'gold',
  low: 'muted',
};

// The CS rep's workspace: what customers are reporting, and one button from a
// report to an agent that reproduces and fixes it. The report goes in as the
// customer wrote it, which is exactly why the agent behind it is boxed in.
export const CsView = () => {
  const incidents = useIncidents().data ?? [];
  const allTasks = useTasks().data ?? [];
  const mine = createdBy(allTasks, 'cs');
  const role = useRoles().data?.find((r) => r.name === 'cs');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = incidents.find((i) => i.id === selectedId) ?? incidents[0];
  const existing = selected && taskForIncident(allTasks, selected.id);

  return (
    <div className="cols cols-3">
      <section className="panel">
        <h2>Latest incidents</h2>
        <ul className="list">
          {incidents.map((i) => {
            const task = taskForIncident(allTasks, i.id);
            return (
              <li key={i.id}>
                <button
                  className={`item ${i.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(i.id)}
                >
                  <span className="item-title">
                    <Dot tone={severityTone[i.severity] ?? 'muted'} />
                    {i.subject}
                  </span>
                  <span className="item-meta">
                    {i.customer} · {i.channel} · {timeAgo(i.at)}
                    {task && (
                      <>
                        {' '}
                        · <Status status={task.status} />
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        {selected ? (
          <>
            <h2>
              {selected.id} · {selected.severity}
            </h2>
            <h3 style={{ marginTop: 0 }}>{selected.subject}</h3>
            <div className="untrusted-label">
              {selected.customer} wrote, via {selected.channel}
            </div>
            <p className="untrusted">{selected.body}</p>
            {existing ? (
              <p>
                <Link to={`/cs/tasks/${existing.id}`}>
                  Open the agent's task
                </Link>{' '}
                <Status status={existing.status} />
              </p>
            ) : (
              <TaskForm
                key={selected.id}
                role="cs"
                kinds={['bug']}
                submitLabel="Ask the agent to fix it"
                draft={{
                  title: selected.subject,
                  text: selected.body,
                  incidentId: selected.id,
                }}
              />
            )}
          </>
        ) : (
          <p className="empty">No incidents.</p>
        )}
      </section>

      <section>
        <div className="panel">
          <h2>My reports</h2>
          <TaskList
            tasks={mine}
            role="cs"
            empty="None yet. Pick an incident."
          />
        </div>
        <RoleScope role={role} />
      </section>
    </div>
  );
};
