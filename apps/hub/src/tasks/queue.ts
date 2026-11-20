import type { FastifyBaseLogger } from 'fastify';
import type { Hub } from '../hub/load.ts';
import type { TaskHandle, TaskRunner } from './runner.ts';
import type { TaskStore } from './store.ts';

// Runs at most `maxConcurrent` tasks at once; the rest wait in order. Each
// task costs LLM tokens and VM CPU, and the app is public. Deploys skip the
// queue: they're short, and only ever follow an approval.
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
    const input = opts.store.input(id);
    const role = input && opts.hub.roles.get(input.role);
    if (!input || !role) return null;
    return {
      id,
      input,
      policy: role.policy,
      rolePrompt: role.prompt,
      emit: (e) => opts.store.emit(id, e),
      setDiff: (d) => opts.store.setDiff(id, d),
    };
  };

  // A fault in the runner: log the detail, show the user a short line.
  const crashed = (id: string, what: string) => (err: unknown) => {
    opts.log.error({ err, taskId: id }, `${what} crashed`);
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
      .catch(crashed(id, 'task'))
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
    deploy: (id: string) => {
      const task = handle(id);
      const diff = opts.store.diff(id);
      if (!task || diff === null) return;
      void opts.runner.deploy(task, diff).catch(crashed(id, 'deploy'));
    },
  };
};

export type TaskQueue = ReturnType<typeof createTaskQueue>;
