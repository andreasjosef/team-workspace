import { EventEnvelope, type TaskEvent } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { eventsUrl } from '../api.ts';

// Events that change the task snapshot or diff on the hub: invalidating the
// query keeps the inbox, outcome, ReplyDraftBox and Changes tab in sync
// immediately instead of waiting for the next poll tick.
const SNAPSHOT_EVENTS = new Set<TaskEvent['type']>([
  'status',
  'phase',
  'iteration',
  'context',
  'prompt',
  'input_flagged',
  'policy_refused',
  'blocked',
  'pr',
  'reply_draft',
  'fixture_run',
]);

// Subscribes to one task's live WebSocket event stream, replaying from seq 0
// and reconnecting with ?after=<lastSeq> if the socket drops.
export const useTaskEvents = (taskId: string) => {
  const client = useQueryClient();
  const [state, setState] = useState<{
    taskId: string;
    events: EventEnvelope[];
  }>({ taskId, events: [] });

  useEffect(() => {
    if (!taskId) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let lastSeq = -1;

    const scheduleSync = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = undefined;
        void client.invalidateQueries({ queryKey: ['tasks'] });
        void client.invalidateQueries({ queryKey: ['task', taskId] });
        void client.invalidateQueries({ queryKey: ['diff', taskId] });
      }, 120);
    };

    const connect = () => {
      socket = new WebSocket(eventsUrl(taskId, lastSeq));
      socket.onmessage = (msg) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(msg.data));
        } catch {
          return;
        }
        const parsed = EventEnvelope.safeParse(raw);
        if (!parsed.success || parsed.data.seq <= lastSeq) return;
        const envelope = parsed.data;
        lastSeq = envelope.seq;
        setState((prev) => ({
          taskId,
          events:
            prev.taskId === taskId ? [...prev.events, envelope] : [envelope],
        }));
        if (SNAPSHOT_EVENTS.has(envelope.event.type)) scheduleSync();
      };
      socket.onclose = (ev) => {
        if (closed || ev.code === 4404) return;
        retry = setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(invalidateTimer);
      socket?.close();
    };
  }, [client, taskId]);

  return state.taskId === taskId ? state.events : [];
};
