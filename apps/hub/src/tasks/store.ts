import type {
  CreateTaskInput,
  EventEnvelope,
  TaskEvent,
  TaskSnapshot,
} from '@app/shared';
import { randomUUID } from 'node:crypto';

// In-memory on purpose (persistence is out of scope for the demo). A restart
// forgets every task. The snapshot is derived from the event stream, so the
// audit trail and the state can't drift apart.

type Listener = (envelope: EventEnvelope) => void;

type TaskRecord = Omit<TaskSnapshot, 'hasDiff'> & {
  diff: string | null;
  events: EventEnvelope[];
  listeners: Set<Listener>;
};

const MAX_TASKS = 200;
const MAX_EVENTS = 5000;
const FINISHED = new Set(['pr_opened', 'gave_up', 'flagged', 'error']);

export const createTaskStore = () => {
  const tasks = new Map<string, TaskRecord>();

  // `fixtureOf`: the flagged task a fixture run is for (set only by the
  // fixture route, never from a request body).
  const create = (
    input: CreateTaskInput,
    { fixtureOf = null }: { fixtureOf?: string | null } = {}
  ) => {
    // Forget the oldest task once full; Maps iterate in insertion order.
    if (tasks.size >= MAX_TASKS) tasks.delete(tasks.keys().next().value!);
    const id = randomUUID();
    const now = new Date().toISOString();
    tasks.set(id, {
      id,
      createdAt: now,
      updatedAt: now,
      input,
      status: 'queued',
      statusReason: null,
      branch: `task/${id.slice(0, 8)}`,
      baseSha: null,
      phase: null,
      iterations: [],
      context: { files: [], decisions: [] },
      inputSignals: [],
      refusals: [],
      blocked: [],
      previewUrl: null,
      pr: null,
      fixtureOf,
      fixtureRun: null,
      diff: null,
      events: [],
      listeners: new Set(),
    });
    return id;
  };

  const apply = (t: TaskRecord, e: TaskEvent) => {
    switch (e.type) {
      case 'status':
        t.status = e.status;
        t.statusReason = e.reason ?? null;
        break;
      case 'phase':
        t.phase = e.phase;
        break;
      case 'iteration':
        t.iterations.push({
          n: e.n,
          typeErrors: e.typeErrors,
          testsFailed: e.testsFailed,
        });
        break;
      case 'context':
        t.context = { files: e.files, decisions: e.decisions };
        break;
      case 'input_flagged':
        t.inputSignals = e.signals;
        break;
      case 'policy_refused':
        t.refusals.push({ path: e.path, rule: e.rule });
        break;
      case 'blocked':
        t.blocked.push(`${e.kind}: ${e.detail}`);
        break;
      case 'preview':
        t.previewUrl = e.url;
        break;
      case 'base':
        t.baseSha = e.sha;
        break;
      case 'pr':
        t.pr = { url: e.url, number: e.number, draft: e.draft };
        break;
      case 'fixture_run':
        t.fixtureRun = e.taskId;
        break;
    }
  };

  const emit = (id: string, event: TaskEvent) => {
    const t = tasks.get(id);
    if (!t) return;
    apply(t, event);
    const envelope: EventEnvelope = {
      seq: t.events.length,
      at: new Date().toISOString(),
      event,
    };
    t.updatedAt = envelope.at;
    if (t.events.length < MAX_EVENTS) t.events.push(envelope);
    for (const listener of t.listeners) listener(envelope);
  };

  const toSnapshot = (t: TaskRecord): TaskSnapshot => {
    const { diff, events: _events, listeners: _listeners, ...rest } = t;
    return { ...rest, hasDiff: diff !== null };
  };

  // Replays what happened after `afterSeq`, then delivers new events live.
  const subscribe = (id: string, afterSeq: number, listener: Listener) => {
    const t = tasks.get(id);
    if (!t) return null;
    for (const e of t.events) if (e.seq > afterSeq) listener(e);
    t.listeners.add(listener);
    return () => t.listeners.delete(listener);
  };

  return {
    create,
    emit,
    subscribe,
    snapshot: (id: string) => {
      const t = tasks.get(id);
      return t ? toSnapshot(t) : null;
    },
    // Newest first.
    list: () => [...tasks.values()].reverse().map(toSnapshot),
    setDiff: (id: string, diff: string) => {
      const t = tasks.get(id);
      if (t) t.diff = diff;
    },
    diff: (id: string) => tasks.get(id)?.diff ?? null,
    isFinished: (id: string) => FINISHED.has(tasks.get(id)?.status ?? ''),
  };
};

export type TaskStore = ReturnType<typeof createTaskStore>;
