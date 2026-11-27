import type {
  IterationSummary,
  PromptSection,
  TaskSnapshot,
} from '@app/shared';

// The receipt's Agent tab: what the agent was told on its first call, which
// version of the prompt and roles that was, and what it answered each time.
// Model output is styled as the model's, never as the hub's own words.

const OPEN_UP_TO = 600; // characters; longer sections start collapsed

// `.hub/` at the task's base commit: prompts and roles change only through
// a merged pull request, so the commit names the version the task ran on.
const Source = ({ task }: { task: TaskSnapshot }) => {
  if (!task.baseSha)
    return <p className="muted tab-lead">Not synced to main yet.</p>;
  const short = task.baseSha.slice(0, 7);
  const repo = task.prompt?.repo;
  return (
    <p className="tab-lead">
      Prompt and roles from <code>main</code> at{' '}
      {repo ? (
        <a
          href={`https://github.com/${repo}/tree/${task.baseSha}/.hub`}
          rel="noreferrer"
        >
          <code>{short}</code>
        </a>
      ) : (
        <code>{short}</code>
      )}
      <span className="muted">
        {' '}
        · changed only through a merged pull request
      </span>
    </p>
  );
};

// The context files and decisions at a glance; their text is in the prompt
// sections below.
const ContextSummary = ({ task }: { task: TaskSnapshot }) => (
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
);

const Section = ({ section }: { section: PromptSection }) => {
  const cut = section.text.length < section.chars;
  const report = section.title === "The customer's report";
  return (
    <details className="prompt-section" open={section.chars <= OPEN_UP_TO}>
      <summary>
        {section.title}
        <span className="muted small">
          {' '}
          {section.chars.toLocaleString()} characters
          {cut ? ', the start shown' : ''}
          {report ? ', the report inside its untrusted wrapper' : ''}
        </span>
      </summary>
      <pre className={report ? 'untrusted' : ''}>{section.text}</pre>
    </details>
  );
};

const Iteration = ({ it }: { it: IterationSummary }) => {
  const refused = new Set(it.refused?.map((r) => r.path));
  return (
    <li className="agent-iteration">
      <div className="agent-iteration-head">Iteration {it.n}</div>
      {it.reasoning && (
        <blockquote className="model-says">
          <span className="untrusted-label">Model</span>
          {it.reasoning}
        </blockquote>
      )}
      {it.proposed && it.proposed.length > 0 && (
        <div>
          <span className="muted small">Proposed </span>
          {it.proposed.map((e, k) => (
            <span
              className={`chip ${refused.has(e.path) ? 'tone-red' : ''}`}
              key={k}
            >
              {e.create ? 'new ' : ''}
              {e.path}
            </span>
          ))}
        </div>
      )}
      {it.refused?.map((r, k) => (
        <div className="tone-red small" key={k}>
          Refused by the role policy: <code>{r.path}</code> ({r.rule})
        </div>
      ))}
      {it.rejected && (
        <div className="tone-gold small">Not taken: {it.rejected}</div>
      )}
      <div className="muted small">
        After: {it.typeErrors} type errors,{' '}
        <span className={it.testsFailed ? 'tone-red' : ''}>
          {it.testsFailed} failing tests
        </span>
      </div>
    </li>
  );
};

export const AgentView = ({ task }: { task: TaskSnapshot }) => {
  const [baseline, ...rest] = task.iterations;
  return (
    <>
      <Source task={task} />
      <h3 className="agent-heading">What the agent saw</h3>
      <ContextSummary task={task} />
      {task.prompt ? (
        task.prompt.sections.map((s) => <Section key={s.title} section={s} />)
      ) : (
        <p className="empty">No prompt sent yet</p>
      )}
      <h3 className="agent-heading">What it did</h3>
      {baseline && (
        <p className="muted small">
          Baseline: {baseline.typeErrors} type errors, {baseline.testsFailed}{' '}
          failing tests
        </p>
      )}
      {rest.length ? (
        <ol className="agent-iterations">
          {rest.map((it) => (
            <Iteration key={it.n} it={it} />
          ))}
        </ol>
      ) : (
        <p className="empty">No answer yet</p>
      )}
    </>
  );
};
