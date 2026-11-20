import {
  CreateTaskInput,
  DecideInput,
  fail,
  ok,
  paths,
  type CreateTaskResponse,
  type Result,
  type TaskSnapshot,
} from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Hub } from '../hub/load.ts';
import { sendResult } from '../http/sendResult.ts';
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
      const taskId = store.create(input.data, role.policy.approval);
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

  // Who may decide: the approver named by the creating role's policy, or the
  // creating role itself when its policy names none.
  const decide = (
    id: unknown,
    body: unknown,
    decision: 'approved' | 'rejected'
  ): Result<TaskSnapshot> => {
    const params = Params.safeParse(id);
    const task = params.success ? store.snapshot(params.data.id) : null;
    if (!task) return fail('not_found', 'No such task');
    const input = DecideInput.safeParse(body);
    if (!input.success) return fail('invalid', z.prettifyError(input.error));
    const allowedFrom =
      decision === 'approved'
        ? ['proposed']
        : ['proposed', 'flagged', 'gave_up'];
    if (!allowedFrom.includes(task.status)) {
      return fail('conflict', `A ${task.status} task can't be ${decision}`);
    }
    const approver = task.approver ?? task.input.role;
    if (input.data.role !== approver) {
      return fail(
        'forbidden',
        `Only ${approver} can decide on ${task.input.role} tasks`
      );
    }
    store.emit(task.id, {
      type: 'approval',
      by: input.data.role,
      decision,
      ...(input.data.reason ? { reason: input.data.reason } : {}),
    });
    store.emit(task.id, {
      type: 'status',
      status: decision,
      reason: input.data.reason ?? `${decision} by ${input.data.role}`,
    });
    if (decision === 'approved') queue.deploy(task.id);
    return ok(store.snapshot(task.id)!);
  };

  app.post('/api/tasks/:id/approve', async (request, reply) =>
    sendResult(request, reply, decide(request.params, request.body, 'approved'))
  );
  app.post('/api/tasks/:id/reject', async (request, reply) =>
    sendResult(request, reply, decide(request.params, request.body, 'rejected'))
  );

  // Replays the task's events after ?after=<seq>, then streams new ones. A
  // task lives on after its run (approval, deploy), so the socket stays open
  // until the client leaves.
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
