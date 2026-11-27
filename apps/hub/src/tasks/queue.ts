import type { FastifyBaseLogger } from 'fastify';
import type { Hub } from '../hub/load.ts';
import type { TaskHandle, TaskRunner } from './runner.ts';
import type { TaskStore } from './store.ts';

// Runs at most `maxConcurrent` tasks at once; the rest wait in order. Each
// task costs LLM tokens and VM CPU, and the app is public.
export const createTaskQueue = (opts: {
  hub: Hub;
  store: TaskStore;
  runner: TaskRunner;
  maxConcurrent: number;
  maxWaiting?: number;
  log: FastifyBaseLogger;
}) => {
  const waiting: string[] = [];
  let running = 0;
  const maxWaiting = opts.maxWaiting ?? 10;

  const handle = (id: string): TaskHandle | null => {
    const task = opts.store.snapshot(id);
    const role = task && opts.hub.roles.get(task.input.role);
    if (!task || !role) return null;
    return {
      id,
      branch: task.branch,
      input: task.input,
      policy: role.policy,
      rolePrompt: role.prompt,
      fixtureOf: task.fixtureOf,
      emit: (e) => opts.store.emit(id, e),
      setDiff: (d) => opts.store.setDiff(id, d),
    };
  };

  // A fault in the runner: log the detail, show the user a short line.
  const crashed = (id: string) => (err: unknown) => {
    opts.log.error({ err, taskId: id }, 'task crashed');
    opts.store.emit(id, {
      type: 'status',
      status: 'error',
      reason: 'internal error',
    });
  };

  const start = (id: string) => {
    const task = handle(id);
    if (!task) return;
    running++;
    opts.runner
      .run(task)
      .catch(crashed(id))
      .finally(() => {
        running--;
        const next = waiting.shift();
        if (next) start(next);
      });
  };

  return {
    // false when the queue is full; the caller answers 503.
    submit: (id: string) => {
      if (running < opts.maxConcurrent) {
        start(id);
        return true;
      }
      if (waiting.length >= maxWaiting) return false;
      waiting.push(id);
      return true;
    },
  };
};

export type TaskQueue = ReturnType<typeof createTaskQueue>;
