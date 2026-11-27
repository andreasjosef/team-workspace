import { Fragment, useEffect, useState } from 'react';
import type {
  ConnectorState,
  PipelineModel,
  PipelineStage,
  StageId,
} from '../pipelineView.ts';

type Props = {
  model: PipelineModel;
  replaying: boolean;
  canReplay: boolean;
  onReplay: () => void;
  onStopReplay: () => void;
};

const StageIcon = ({ id, blocked }: { id: StageId; blocked: boolean }) => {
  if (id === 'output' && blocked) {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M10 2.5L4 5v4.5c0 4 2.6 6.8 6 8 3.4-1.2 6-4 6-8V5l-6-2.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M7.6 7.6l4.8 4.8m0-4.8l-4.8 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  switch (id) {
    case 'scan':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 2.5L4 5v4.5c0 4 2.6 6.8 6 8 3.4-1.2 6-4 6-8V5l-6-2.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="9.5" r="2" fill="currentColor" />
        </svg>
      );
    case 'sandbox':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 2.8L16.5 6.4v7.2L10 17.2l-6.5-3.6V6.4L10 2.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M10 10v7.2M10 10l6.5-3.6M10 10L3.5 6.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'agent':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 2.5l1.9 4.8L17 9.2l-4.5 2.4L10 17.5l-2.5-5.9L3 9.2l5.1-1.9L10 2.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'verify':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="6.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M7 10.2l2.1 2.1 4-4.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'output':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="6"
            cy="5.5"
            r="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle
            cx="6"
            cy="14.5"
            r="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle
            cx="14.5"
            cy="14.5"
            r="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M6 7.5v5M14.5 12.5V8.8a3.3 3.3 0 0 0-3.3-3.3H8.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
};

const Connector = ({ state }: { state: ConnectorState }) => (
  <div className={`pipe-conn pipe-conn-${state}`} aria-hidden="true">
    <svg viewBox="0 0 26 24">
      <line className="pipe-rail" x1="1" y1="12" x2="25" y2="12" />
      {(state === 'flowing' || state === 'done') && (
        <line className="pipe-stream" x1="1" y1="12" x2="25" y2="12" />
      )}
      {state === 'flowing' && (
        <>
          <circle className="pipe-packet" cx="3" cy="12" r="2.6" />
          <circle
            className="pipe-packet pipe-packet-lag"
            cx="3"
            cy="12"
            r="1.7"
          />
        </>
      )}
      {state === 'done' && (
        <path
          className="pipe-arrow"
          d="M19.5 8.5L23.5 12L19.5 15.5"
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {state === 'blocked' && (
        <g className="pipe-stop">
          <circle cx="13" cy="12" r="6" />
          <path
            d="M10.5 9.5l5 5m0-5l-5 5"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  </div>
);

const StageNode = ({
  stage,
  stepSeconds,
}: {
  stage: PipelineStage;
  stepSeconds: number | null;
}) => {
  const badge =
    stage.badge ??
    (stage.state === 'active' && stepSeconds !== null && stepSeconds >= 2
      ? `${stepSeconds}s`
      : null);
  return (
    <div className={`pipe-node pipe-state-${stage.state}`}>
      <div className="pipe-orb-wrap">
        <div className="pipe-orb">
          {stage.state === 'active' && (
            <svg
              className="pipe-spinner"
              viewBox="0 0 44 44"
              aria-hidden="true"
            >
              <circle cx="22" cy="22" r="20" />
            </svg>
          )}
          <StageIcon id={stage.id} blocked={stage.state === 'blocked'} />
        </div>
        {badge && <span className="pipe-badge">{badge}</span>}
      </div>
      <span className="pipe-label">{stage.label}</span>
      <span className="pipe-detail">{stage.detail}</span>
      {stage.state === 'active' && (
        <span className="pipe-node-bar" aria-hidden="true" />
      )}
    </div>
  );
};

const useTimers = (
  live: boolean,
  replaying: boolean,
  startedAtMs: number | null,
  endedAtMs: number | null,
  lastEventAtMs: number | null
) => {
  const [now, setNow] = useState(() => Date.now());
  const ticking = live && !replaying;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(id);
  }, [ticking]);

  if (startedAtMs === null) {
    return { elapsed: null, stepSeconds: null };
  }
  const end = replaying
    ? (lastEventAtMs ?? startedAtMs)
    : live
      ? now
      : (endedAtMs ?? lastEventAtMs ?? now);
  const secs = Math.max(0, (end - startedAtMs) / 1000);
  const stepSeconds =
    ticking && lastEventAtMs !== null
      ? Math.max(0, Math.floor((now - lastEventAtMs) / 1000))
      : null;
  return { elapsed: `${secs.toFixed(1)}s`, stepSeconds };
};

// The animated graphical pipeline shown directly beneath the Receipt tabs:
// each stage lights up in real time from the WebSocket event stream.
export const PipelineFlow = ({
  model,
  replaying,
  canReplay,
  onReplay,
  onStopReplay,
}: Props) => {
  const { elapsed, stepSeconds } = useTimers(
    model.live,
    replaying,
    model.startedAtMs,
    model.endedAtMs,
    model.lastEventAtMs
  );
  const activeStage = model.stages.find((s) => s.state === 'active');
  const longWait =
    model.live && !replaying && stepSeconds !== null && stepSeconds >= 6;
  const tickerText = longWait
    ? `Still working on ${activeStage?.label ?? 'current step'} (${stepSeconds}s) — ${model.ticker}`
    : model.ticker;

  return (
    <div
      className={`pipeline-card pipeline-mood-${model.mood} ${model.live || replaying ? 'is-active' : ''}`}
      aria-label="Live pipeline flow"
    >
      {(model.live || replaying) && (
        <div className="pipe-activity-bar" aria-hidden="true" />
      )}
      <div className="pipeline-top">
        <div className="pipeline-status">
          <span
            className={`pipe-live-dot ${model.live || replaying ? 'pulsing' : ''}`}
            aria-hidden="true"
          />
          <span className="pipeline-title">
            {replaying ? 'Replaying pipeline' : model.headline}
          </span>
        </div>
        <div className="pipeline-controls">
          {elapsed && <span className="pipeline-stat">{elapsed}</span>}
          {model.eventCount > 0 && (
            <span className="pipeline-stat">
              {model.eventCount} event{model.eventCount === 1 ? '' : 's'}
            </span>
          )}
          {replaying ? (
            <button
              type="button"
              className="pipe-replay-btn active"
              onClick={onStopReplay}
            >
              Skip to end
            </button>
          ) : (
            canReplay && (
              <button
                type="button"
                className="pipe-replay-btn"
                onClick={onReplay}
                title="Replay the pipeline animation"
              >
                ↻ Replay
              </button>
            )
          )}
        </div>
      </div>

      <div className="pipeline-track">
        {model.stages.map((stage, idx) => (
          <Fragment key={stage.id}>
            <StageNode stage={stage} stepSeconds={stepSeconds} />
            {idx < model.connectors.length && (
              <Connector state={model.connectors[idx]!} />
            )}
          </Fragment>
        ))}
      </div>

      <div className="pipe-footer">
        <div className={`pipe-ticker pipe-ticker-${model.tickerTone}`}>
          <span
            className={`pipe-eq ${model.live || replaying ? 'running' : ''}`}
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
          </span>
          <span className="pipe-ticker-text" title={tickerText}>
            {tickerText}
          </span>
        </div>
        {model.iterations.length > 0 && (
          <div className="pipe-iters" aria-label="Iterations">
            {model.iterations.map((it) => (
              <span
                key={it.n}
                className={`pipe-iter-pill pipe-iter-${it.tone}`}
              >
                {it.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
