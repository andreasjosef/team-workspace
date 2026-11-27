import { useEffect, useRef } from 'react';
import { useTaskEvents } from '../useTaskEvents.ts';

export const LiveLog = ({ taskId }: { taskId: string }) => {
  const events = useTaskEvents(taskId);
  // Follow new lines inside the log box (never the page), and only while
  // the reader is at the bottom: scrolling up to read stops the follow.
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div
      className="log"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {events.map(({ seq, event: e }) => {
        switch (e.type) {
          case 'phase':
            return (
              <div key={seq} className="phase">
                ▸ {e.phase}
              </div>
            );
          case 'status':
            return (
              <div key={seq} className="muted">
                status → {e.status}
                {e.reason ? `: ${e.reason}` : ''}
              </div>
            );
          case 'log':
            return (
              <div
                key={seq}
                className="muted"
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {e.message}
              </div>
            );
          case 'policy_refused':
            return (
              <div key={seq} className="tone-red">
                ⛔ policy refused {e.path} ({e.rule})
              </div>
            );
          case 'blocked':
            return (
              <div key={seq} className="tone-red">
                ⛔ blocked {e.kind}: {e.detail}
              </div>
            );
          case 'input_flagged':
            return (
              <div key={seq} className="tone-red">
                ⚑ task text: {e.signals.join(', ')}
              </div>
            );
          case 'pr':
            return (
              <div key={seq} className="tone-gold">
                pull request #{e.number}
                {e.draft ? ' (draft)' : ''} opened: {e.url}
              </div>
            );
          case 'preview':
            return <div key={seq}>preview: {e.url}</div>;
          case 'command':
            return (
              <details key={seq}>
                <summary>
                  <span className={e.exitCode === 0 ? '' : 'tone-red'}>
                    $ {e.cmd}
                  </span>
                  <span className="muted">
                    {' '}
                    · exit {e.exitCode} · {(e.durationMs / 1000).toFixed(1)}s
                  </span>
                </summary>
                <pre>{e.output || '(no output)'}</pre>
              </details>
            );
          default:
            return null;
        }
      })}
      {events.length === 0 && <p className="empty">Nothing yet.</p>}
    </div>
  );
};
