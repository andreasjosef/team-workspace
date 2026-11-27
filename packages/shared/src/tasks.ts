import { z } from 'zod';
import { ContextDoc, PullRequest, TaskStatus } from './events.ts';
import { Role, TaskKind } from './roles.ts';

// A task is one request from one role: "discount codes fail at checkout",
// "make the signup button say Start free". The text is untrusted: it may be a
// customer's words pasted in verbatim.
export const CreateTaskInput = z.object({
  role: Role,
  kind: TaskKind,
  title: z.string().trim().min(3).max(120),
  text: z.string().trim().min(1).max(4000),
  // The incident this task came from, when a CS rep started it from one.
  incidentId: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,40}$/)
    .optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const IterationSummary = z.object({
  n: z.number(),
  typeErrors: z.number(),
  testsFailed: z.number(),
});
export type IterationSummary = z.infer<typeof IterationSummary>;

export const TaskSnapshot = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  input: CreateTaskInput,
  status: TaskStatus,
  statusReason: z.string().nullable(),
  branch: z.string(),
  // The commit of main the task started from, once it has synced.
  baseSha: z.string().nullable(),
  phase: z.string().nullable(),
  iterations: z.array(IterationSummary),
  context: z.object({
    files: z.array(z.string()),
    decisions: z.array(ContextDoc),
  }),
  inputSignals: z.array(z.string()),
  refusals: z.array(z.object({ path: z.string(), rule: z.string() })),
  blocked: z.array(z.string()),
  previewUrl: z.string().nullable(),
  hasDiff: z.boolean(),
  // The pull request, once the hub opened one. A developer merges it on
  // GitHub; the hub never does.
  pr: PullRequest.nullable(),
  // A fixture run: the flagged task it was started for. The hub drove it
  // with a scripted hostile proposal, not the model, and it never publishes.
  fixtureOf: z.string().nullable(),
  // On a flagged task: its fixture run, once one was started.
  fixtureRun: z.string().nullable(),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshot>;

export const CreateTaskResponse = z.object({ taskId: z.string() });
export type CreateTaskResponse = z.infer<typeof CreateTaskResponse>;
