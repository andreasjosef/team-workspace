import {
  CreateTaskInput,
  fail,
  ok,
  paths,
  type CreateTaskResponse,
  type TaskSnapshot,
} from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Hub } from '../hub/load.ts';
import { sendResult } from '../http/sendResult.ts';
import { FIXTURE_INPUT } from '../tasks/fixture.ts';
import type { TaskQueue } from '../tasks/queue.ts';
import type { TaskStore } from '../tasks/store.ts';

const Params = z.object({ id: z.uuid() });
const EventsQuery = z.object({ after: z.coerce.number().int().default(-1) });

export const taskRoutes = (
  app: FastifyInstance,
  hub: Hub,
  store: TaskStore,
  queue: TaskQueue
) => {
  // Starting a task is the expensive call (LLM tokens, a VM's CPU): a tight
  // per-client limit on top of the global one.
  app.post(
    paths.tasks,
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = CreateTaskInput.safeParse(request.body);
      if (!input.success)
        return sendResult(
          request,
          reply,
          fail('invalid', z.prettifyError(input.error))
        );
      const role = hub.roles.get(input.data.role)!;
      if (!role.policy.canCreate.includes(input.data.kind)) {
        return sendResult(
          request,
          reply,
          fail(
            'forbidden',
            `${role.policy.label} can create: ${role.policy.canCreate.join(', ')}`
          )
        );
      }
      const taskId = store.create(input.data);
      if (!queue.submit(taskId)) {
        store.emit(taskId, {
          type: 'status',
          status: 'error',
          reason: 'Too many tasks waiting',
        });
        return sendResult(
          request,
          reply,
          fail('unavailable', 'Too many tasks waiting; try again in a minute')
        );
      }
      return sendResult(
        request,
        reply,
        ok<CreateTaskResponse>({ taskId }),
        201
      );
    }
  );

  // "What if the model had obeyed?": a fixture run for a flagged task, the
  // real pipeline driven by the hub's scripted hostile proposal (fixture.ts).
  // Nothing in the request decides any part of it. One per flagged task;
  // asking again answers with the one already started, unless it errored.
  app.post(
    '/api/tasks/:id/fixture',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = Params.safeParse(request.params);
      const flagged = params.success ? store.snapshot(params.data.id) : null;
      if (!flagged)
        return sendResult(request, reply, fail('not_found', 'No such task'));
      if (flagged.fixtureOf !== null || flagged.status !== 'flagged')
        return sendResult(
          request,
          reply,
          fail('forbidden', 'A fixture run starts only for a flagged task')
        );
      const existing = flagged.fixtureRun && store.snapshot(flagged.fixtureRun);
      if (existing && existing.status !== 'error')
        return sendResult(
          request,
          reply,
          ok<CreateTaskResponse>({ taskId: existing.id })
        );
      const taskId = store.create(FIXTURE_INPUT, { fixtureOf: flagged.id });
      store.emit(flagged.id, { type: 'fixture_run', taskId });
      if (!queue.submit(taskId)) {
        store.emit(taskId, {
          type: 'status',
          status: 'error',
          reason: 'Too many tasks waiting',
        });
        return sendResult(
          request,
          reply,
          fail('unavailable', 'Too many tasks waiting; try again in a minute')
        );
      }
      return sendResult(
        request,
        reply,
        ok<CreateTaskResponse>({ taskId }),
        201
      );
    }
  );

  app.get(paths.tasks, async () => store.list());

  app.get('/api/tasks/:id', async (request, reply) => {
    const params = Params.safeParse(request.params);
    const snapshot = params.success ? store.snapshot(params.data.id) : null;
    return sendResult(
      request,
      reply,
      snapshot ? ok<TaskSnapshot>(snapshot) : fail('not_found', 'No such task')
    );
  });

  app.get('/api/tasks/:id/diff', async (request, reply) => {
    const params = Params.safeParse(request.params);
    const diff = params.success ? store.diff(params.data.id) : null;
    if (diff === null)
      return sendResult(
        request,
        reply,
        fail('not_found', 'No diff for this task (yet)')
      );
    return reply.type('text/x-diff; charset=utf-8').send(diff);
  });

  // Replays the task's events after ?after=<seq>, then streams new ones. The
  // socket stays open until the client leaves.
  app.get('/api/tasks/:id/events', { websocket: true }, (socket, request) => {
    const params = Params.safeParse(request.params);
    const query = EventsQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return socket.close(4400, 'bad request');
    const unsubscribe = store.subscribe(
      params.data.id,
      query.data.after,
      (envelope) => socket.send(JSON.stringify(envelope))
    );
    if (!unsubscribe) return socket.close(4404, 'no such task');
    socket.on('close', () => unsubscribe());
  });
};
