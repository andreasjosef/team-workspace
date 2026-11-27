import { EventEnvelope } from '@app/shared';
import { useEffect, useState } from 'react';
import { eventsUrl } from './api.ts';

// Subscribes to a task's event stream. Render with key={taskId}, so another
// task starts from an empty list. On a dropped connection it reconnects
// and asks only for what it hasn't seen (?after=<lastSeq>).
export const useTaskEvents = (taskId: string) => {
  const [events, setEvents] = useState<EventEnvelope[]>([]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let lastSeq = -1;

    const connect = () => {
      socket = new WebSocket(eventsUrl(taskId, lastSeq));
      socket.onmessage = (msg) => {
        const parsed = EventEnvelope.safeParse(JSON.parse(String(msg.data)));
        if (!parsed.success || parsed.data.seq <= lastSeq) return;
        lastSeq = parsed.data.seq;
        setEvents((prev) => [...prev, parsed.data]);
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
      socket?.close();
    };
  }, [taskId]);

  return events;
};
