import { useState } from 'react';
import { RoleScope, Status, TaskList } from '../components/common.tsx';
import { TaskForm } from '../components/TaskForm.tsx';
import { useDocs, useRoles, useTasks } from '../queries.ts';
import { createdBy } from '../taskView.ts';

// The PO's workspace: the product's decisions and docs, the changes they've
// asked for, and a form to ask for more. Decisions sit next to the code they
// explain, so "why is it like this?" has an answer here.
export const PoView = () => {
  const docs = useDocs().data ?? [];
  const tasks = createdBy(useTasks().data ?? [], 'po');
  const role = useRoles().data?.find((r) => r.name === 'po');
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);

  const shown = docs
    .filter((d) =>
      `${d.id} ${d.title} ${d.body}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'decision') - Number(a.kind === 'decision') ||
        a.id.localeCompare(b.id)
    );
  const selected = docs.find((d) => d.path === selectedPath) ?? shown[0];
  const draftDoc = docs.find((d) => d.path === draftFor);

  return (
    <div className="cols cols-3">
      <section className="panel">
        <h2>Decisions & docs</h2>
        <input
          className="filter"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="list">
          {shown.map((d) => (
            <li key={d.path}>
              <button
                className={`item ${d.path === selected?.path ? 'selected' : ''}`}
                onClick={() => setSelectedPath(d.path)}
              >
                <span className="item-title">
                  {d.kind === 'decision' && (
                    <span className="chip">{d.id}</span>
                  )}
                  {d.title}
                </span>
                <span className="item-meta">
                  {d.kind === 'decision'
                    ? `${d.by ?? ''} · ${d.date ?? ''}`
                    : d.path}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        {selected ? (
          <>
            <h2>{selected.kind === 'decision' ? selected.id : 'Doc'}</h2>
            <h3 style={{ marginTop: 0 }}>{selected.title}</h3>
            {selected.files.length > 0 && (
              <p className="small">
                <span className="muted">Explains </span>
                {selected.files.map((f) => (
                  <span className="chip" key={f}>
                    {f}
                  </span>
                ))}
              </p>
            )}
            <div className="doc-body">
              {/* Markdown paragraphs: blank lines split, single breaks join. */}
              {selected.body.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para.replace(/\n/g, ' ')}</p>
              ))}
            </div>
            <p className="below">
              <button
                className="btn"
                onClick={() => setDraftFor(selected.path)}
              >
                Request a change to this
              </button>
            </p>
          </>
        ) : (
          <p className="empty">No docs in the repo.</p>
        )}
      </section>

      <section>
        <div className="panel">
          <h2>Request a change</h2>
          <TaskForm
            key={draftFor ?? 'blank'}
            role="po"
            kinds={role?.canCreate ?? ['change']}
            submitLabel="Ask the agent"
            {...(draftDoc
              ? {
                  draft: {
                    title: `Change: ${draftDoc.title}`.slice(0, 120),
                    text: `Re ${draftDoc.id}: `,
                  },
                }
              : {})}
          />
        </div>
        <div className="panel">
          <h2>My change requests</h2>
          <TaskList tasks={tasks} role="po" empty="None yet." />
          {tasks.some((t) => t.previewUrl) && (
            <p className="small muted" style={{ margin: '0.75rem 0 0.25rem' }}>
              Previews
            </p>
          )}
          <ul className="list small">
            {tasks
              .filter((t) => t.previewUrl)
              .map((t) => (
                <li key={t.id}>
                  <a
                    href={t.previewUrl!}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t.input.title}
                  </a>{' '}
                  <Status status={t.status} />
                </li>
              ))}
          </ul>
        </div>
        <RoleScope role={role} />
      </section>
    </div>
  );
};
