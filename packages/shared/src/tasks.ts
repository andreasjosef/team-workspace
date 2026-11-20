import { z } from 'zod';
import { ContextDoc, TaskStatus } from './events.ts';
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

export const DecideInput = z.object({
  // The role pressing the button. No auth in the demo: the hub checks it
  // against the task role's policy, nothing more.
  role: Role,
  reason: z.string().trim().max(500).optional(),
});
export type DecideInput = z.infer<typeof DecideInput>;

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
  // Who must approve, from the creating role's policy.
  approver: Role.nullable(),
  branch: z.string(),
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
  decidedBy: Role.nullable(),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshot>;

export const CreateTaskResponse = z.object({ taskId: z.string() });
export type CreateTaskResponse = z.infer<typeof CreateTaskResponse>;
