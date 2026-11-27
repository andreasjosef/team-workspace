import type {
  IterationSummary,
  PromptSection,
  TaskSnapshot,
} from '@app/shared';
import { useEffect, useRef, useState } from 'react';
import { runSteps, type RunStep, type StepVerdict } from '../taskView.ts';

// The receipt's Run tab: the checks and the agent in one place. A burn-down
// of failing tests per step on top, one row per step under it (click one to
// see what the model said and did), and what the agent was told at the
// bottom. Model output is styled as the model's, never as the hub's words.

const OPEN_UP_TO = 600; // characters; longer prompt sections start collapsed

const verdictLabel: Record<StepVerdict, string> = {
  baseline: 'baseline',
  reproduced: 'reproduced',
  green: 'all green',
  better: 'closer',
  worse: 'worse',
  'no change': 'no change',
  rejected: 'not taken',
  refused: 'refused',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The run in one sentence, from the steps alone.
const runSentence = (steps: RunStep[], live: boolean) => {
  const repro = steps.find((s) => s.verdict === 'reproduced');
  const green = steps.find((s) => s.verdict === 'green');
  const used = steps.length - 1;
  if (used === 0) return live ? 'Baseline checked; waiting for the agent.' : '';
  const parts = [
    repro
      ? `Reproduced at step ${repro.n} (${plural(repro.testsFailed, 'failing test')})`
      : 'Not reproduced',
    green ? `green at step ${green.n}` : live ? 'not green yet' : 'never green',
  ];
  return `${parts.join(', ')}. ${plural(used, 'step')} used.`;
};

// --- The chart ------------------------------------------------------------

const H = 170;
const PAD = { top: 16, right: 64, bottom: 26, left: 28 };

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
};

const Burndown = ({
  steps,
  selected,
  onSelect,
}: {
  steps: RunStep[];
  selected: number | null;
  onSelect: (n: number) => void;
}) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(
    1,
    ...steps.flatMap((s) => [s.testsFailed, s.typeErrors])
  );
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, steps.length);
  const x = (k: number) => PAD.left + band * k + band / 2;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const ticks = top <= 4 ? [...Array(top + 1).keys()] : [0, top / 2, top];
  const line = (pick: (s: RunStep) => number) =>
    steps.map((s, k) => `${k ? 'L' : 'M'}${x(k)},${y(pick(s))}`).join(' ');
  const last = steps.length - 1;
  const lastStep = steps[last];
  const shown = hover ?? selected;
  const tip = shown === null ? null : steps.find((s) => s.n === shown);
  const tipK = tip ? steps.indexOf(tip) : -1;

  return (
    <figure className="burndown" ref={ref}>
      <figcaption className="burndown-legend small">
        <span>
          <i className="key key-tests" /> failing tests
        </span>
        <span>
          <i className="key key-types" /> type errors
        </span>
      </figcaption>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label="Failing tests and type errors after each step"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className="grid"
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(t)}
              y2={y(t)}
            />
            <text
              className="axis"
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
            >
              {t}
            </text>
          </g>
        ))}
        {steps.map((s, k) => (
          <text
            key={s.n}
            className={`axis ${shown === s.n ? 'axis-on' : ''}`}
            x={x(k)}
            y={H - 6}
            textAnchor="middle"
          >
            {s.n === 0 ? 'base' : s.n}
          </text>
        ))}
        {shown !== null && tipK >= 0 && (
          <rect
            className="band"
            x={PAD.left + band * tipK}
            y={PAD.top}
            width={band}
            height={innerH}
            rx={4}
          />
        )}
        <path className="series-types" d={line((s) => s.typeErrors)} />
        <path className="series-tests" d={line((s) => s.testsFailed)} />
        {steps.map((s, k) => (
          <circle
            key={s.n}
            className={`dot-tests dot-${s.verdict.replace(' ', '-')}`}
            cx={x(k)}
            cy={y(s.testsFailed)}
            r={s.verdict === 'reproduced' || s.verdict === 'green' ? 6 : 4}
          />
        ))}
        {lastStep && (
          <>
            <text
              className="direct"
              x={x(last) + 10}
              y={y(lastStep.testsFailed) + 4}
            >
              {lastStep.testsFailed} tests
            </text>
            {lastStep.typeErrors !== lastStep.testsFailed && (
              <text
                className="direct muted"
                x={x(last) + 10}
                y={y(lastStep.typeErrors) + 4}
              >
                {lastStep.typeErrors} types
              </text>
            )}
          </>
        )}
        {steps.map((s, k) => (
          <rect
            key={s.n}
            className="hit"
            x={PAD.left + band * k}
            y={0}
            width={band}
            height={H}
            onMouseEnter={() => setHover(s.n)}
            onClick={() => onSelect(s.n)}
          />
        ))}
      </svg>
      {tip && (
        <div
          className="burndown-tip small"
          style={{
            left: Math.min(Math.max(x(tipK), 70), width - 70),
            top: Math.max(0, y(Math.max(tip.testsFailed, tip.typeErrors)) - 60),
          }}
        >
          <strong>{tip.n === 0 ? 'Baseline' : `Step ${tip.n}`}</strong>{' '}
          <span className={`tone-${tip.tone}`}>
            {verdictLabel[tip.verdict]}
          </span>
          <br />
          {plural(tip.testsFailed, 'failing test')} ·{' '}
          {plural(tip.typeErrors, 'type error')}
        </div>
      )}
    </figure>
  );
};

// --- The steps ------------------------------------------------------------

const Delta = ({
  now,
  before,
}: {
  now: number;
  before: number | undefined;
}) => {
  if (before === undefined || now === before) return null;
  return (
    <span className="muted">
      {' '}
      ({now > before ? '+' : '−'}
      {Math.abs(now - before)})
    </span>
  );
};

const StepRow = ({
  it,
  step,
  prev,
  open,
  onToggle,
}: {
  it: IterationSummary;
  step: RunStep;
  prev: IterationSummary | undefined;
  open: boolean;
  onToggle: () => void;
}) => {
  const refused = new Set(it.refused?.map((r) => r.path));
  const hasMore = Boolean(it.reasoning || it.refused?.length || it.rejected);
  return (
    <li className={`step-row ${open ? 'open' : ''}`}>
      <button
        className="step-row-head"
        onClick={onToggle}
        disabled={!hasMore}
        aria-expanded={open}
      >
        <span className="step-n">{it.n === 0 ? 'base' : it.n}</span>
        <span className={`pill pill-${step.tone}`}>
          {verdictLabel[step.verdict]}
        </span>
        <span className="step-files">
          {it.proposed?.length ? (
            it.proposed.map((e, k) => (
              <span
                className={`chip ${refused.has(e.path) ? 'tone-red' : ''}`}
                key={k}
              >
                {e.create ? '+ ' : ''}
                {e.path.split('/').pop()}
              </span>
            ))
          ) : it.n === 0 ? (
            <span className="muted small">the tests as they were</span>
          ) : null}
        </span>
        <span className="step-counts small">
          <span className={it.testsFailed ? 'tone-red' : ''}>
            {it.testsFailed} failing
          </span>
          <Delta now={it.testsFailed} before={prev?.testsFailed} />
          {it.typeErrors > 0 && (
            <span className="muted"> · {it.typeErrors} type</span>
          )}
        </span>
        {hasMore && <span className="step-caret">{open ? '▾' : '▸'}</span>}
      </button>
      {open && (
        <div className="step-body">
          {it.proposed?.length ? (
            <p className="small step-paths">
              {it.proposed.map((e, k) => (
                <code key={k} className={refused.has(e.path) ? 'tone-red' : ''}>
                  {e.create ? 'new ' : ''}
                  {e.path}
                </code>
              ))}
            </p>
          ) : null}
          {it.reasoning && (
            <blockquote className="model-says">
              <span className="untrusted-label">Model</span>
              {it.reasoning}
            </blockquote>
          )}
          {it.refused?.map((r, k) => (
            <div className="tone-red small" key={k}>
              Refused by the role policy: <code>{r.path}</code> ({r.rule})
            </div>
          ))}
          {it.rejected && (
            <div className="tone-gold small">Not taken: {it.rejected}</div>
          )}
        </div>
      )}
    </li>
  );
};

// --- What the agent saw ---------------------------------------------------

// `.hub/` at the task's base commit: prompts and roles change only through
// a merged pull request, so the commit names the version the task ran on.
const Source = ({ task }: { task: TaskSnapshot }) => {
  if (!task.baseSha)
    return <span className="muted">not synced to main yet</span>;
  const short = task.baseSha.slice(0, 7);
  const repo = task.prompt?.repo;
  return (
    <>
      <code>main</code> at{' '}
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
    </>
  );
};

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

const AgentSaw = ({ task }: { task: TaskSnapshot }) => {
  const chars = task.prompt?.sections.reduce((n, s) => n + s.chars, 0) ?? 0;
  return (
    <details className="agent-saw">
      <summary>
        <span className="agent-heading">What the agent saw</span>
        <span className="muted small">
          {' '}
          {plural(task.context.files.length, 'file')} ·{' '}
          {plural(task.context.decisions.length, 'decision')}
          {task.prompt
            ? ` · ${chars.toLocaleString()} characters of prompt`
            : ''}
        </span>
      </summary>
      <dl className="kv agent-saw-kv">
        <dt>Prompt and roles</dt>
        <dd>
          <Source task={task} />
        </dd>
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
      {task.prompt ? (
        task.prompt.sections.map((s) => <Section key={s.title} section={s} />)
      ) : (
        <p className="empty">
          {task.status === 'queued' || task.status === 'working'
            ? 'No prompt sent yet'
            : 'No prompt was sent'}
        </p>
      )}
    </details>
  );
};

// --- The tab --------------------------------------------------------------

export const RunView = ({ task }: { task: TaskSnapshot }) => {
  const steps = runSteps(task);
  const [open, setOpen] = useState<number | null>(null);
  const live = task.status === 'queued' || task.status === 'working';
  const refusedEdits = task.iterations.reduce(
    (n, it) => n + (it.refused?.length ?? 0),
    0
  );
  const notTaken = steps.filter((s) => s.verdict === 'rejected').length;
  const repro = steps.find((s) => s.verdict === 'reproduced');
  const green = steps.find((s) => s.verdict === 'green');
  const toggle = (n: number) => setOpen((o) => (o === n ? null : n));

  return (
    <>
      {steps.length === 0 ? (
        <p className="empty tab-lead">{live ? 'Not run yet' : 'Not run'}</p>
      ) : (
        <>
          <p className="tab-lead run-sentence">{runSentence(steps, live)}</p>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{steps.length - 1}</span>
              <span className="stat-label">steps</span>
            </div>
            <div className="stat">
              <span className={`stat-value ${repro ? 'tone-gold' : 'muted'}`}>
                {repro ? `#${repro.n}` : '—'}
              </span>
              <span className="stat-label">reproduced</span>
            </div>
            <div className="stat">
              <span className={`stat-value ${green ? 'tone-green' : 'muted'}`}>
                {green ? `#${green.n}` : '—'}
              </span>
              <span className="stat-label">green</span>
            </div>
            <div className="stat">
              <span
                className={`stat-value ${refusedEdits + notTaken ? 'tone-red' : 'muted'}`}
              >
                {refusedEdits + notTaken}
              </span>
              <span className="stat-label">refused or not taken</span>
            </div>
          </div>
          {steps.some((s) => s.testsFailed || s.typeErrors) ? (
            <Burndown steps={steps} selected={open} onSelect={toggle} />
          ) : (
            <p className="muted small">
              No test or type error moved: nothing to chart.
            </p>
          )}
          <ol className="step-rows">
            {task.iterations.map((it, k) => (
              <StepRow
                key={it.n}
                it={it}
                step={steps[k]!}
                prev={task.iterations[k - 1]}
                open={open === it.n}
                onToggle={() => toggle(it.n)}
              />
            ))}
          </ol>
        </>
      )}
      <AgentSaw task={task} />
    </>
  );
};
