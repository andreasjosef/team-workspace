import type { TaskSnapshot } from '@app/shared';

// What the agent saw and what got stopped: the part of the receipt that lets
// a reviewer trust (or distrust) the diff without reading the whole log.

export const ContextPanel = ({ task }: { task: TaskSnapshot }) => (
  <div className="panel">
    <h2>Context the agent got</h2>
    <dl className="kv">
      <dt>Files</dt>
      <dd>
        {task.context.files.length ? (
          task.context.files.map((f) => (
            <span className="chip" key={f}>
              {f}
            </span>
          ))
        ) : (
          <span className="muted">none yet</span>
        )}
      </dd>
      <dt>Decisions</dt>
      <dd>
        {task.context.decisions.length ? (
          task.context.decisions.map((d) => (
            <div key={d.id}>
              <span className="chip">{d.id}</span>
              {d.title}
            </div>
          ))
        ) : (
          <span className="muted">none matched</span>
        )}
      </dd>
    </dl>
  </div>
);

export const SecurityPanel = ({ task }: { task: TaskSnapshot }) => {
  const clean =
    !task.inputSignals.length && !task.refusals.length && !task.blocked.length;
  return (
    <div className="panel">
      <h2>Containment</h2>
      {clean ? (
        <p className="tone-green" style={{ margin: 0 }}>
          ● Nothing flagged, refused or blocked
        </p>
      ) : (
        <div className="alert">
          {task.inputSignals.length > 0 && (
            <>
              <strong>Task text looks like it carries instructions</strong>
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
      <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
        No secrets, no network, one throwaway container per command.
      </p>
    </div>
  );
};

export const ChecksPanel = ({ task }: { task: TaskSnapshot }) => (
  <div className="panel">
    <h2>Checks in the sandbox</h2>
    {task.iterations.length === 0 ? (
      <p className="empty">Not run yet</p>
    ) : (
      <table className="iters">
        <thead>
          <tr>
            <th>step</th>
            <th>type errors</th>
            <th>failing tests</th>
          </tr>
        </thead>
        <tbody>
          {task.iterations.map((i, k) => (
            <tr key={k}>
              <td>{i.n === 0 ? 'baseline' : i.n}</td>
              <td>{i.typeErrors}</td>
              <td className={i.testsFailed ? 'tone-red' : ''}>
                {i.testsFailed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);
