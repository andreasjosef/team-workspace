import { z } from 'zod';

// The one contract between the hub and the UI: every task is a stream of
// these. Status changes travel as `status` events too, so the snapshot is
// always derived from the stream and the two can't disagree.

export const Phase = z.enum([
  'context',
  'baseline',
  'fix',
  'preview',
  'publish',
]);
export type Phase = z.infer<typeof Phase>;

export const TaskStatus = z.enum([
  'queued',
  'working',
  'proposed', // green in the sandbox, not published
  'pr_opened', // published: a pull request waits for a developer
  'gave_up', // stop rules hit
  'flagged', // policy refusals or a blocked network call: a human looks first
  'error', // the runner crashed, or publishing failed
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const BlockedKind = z.enum(['network', 'timeout', 'memory', 'pids']);
export type BlockedKind = z.infer<typeof BlockedKind>;

export const ContextDoc = z.object({ id: z.string(), title: z.string() });

export const PullRequest = z.object({
  url: z.string(),
  number: z.number().int(),
  draft: z.boolean(),
});
export type PullRequest = z.infer<typeof PullRequest>;

// One titled part of the prompt the agent saw, capped by the hub before it
// goes into an event; `chars` is its full length.
export const PromptSection = z.object({
  title: z.string(),
  text: z.string(),
  chars: z.number().int(),
});
export type PromptSection = z.infer<typeof PromptSection>;

// The prompt as the agent saw it on its first call, and where its prompt and
// roles came from: `.hub/` at the task's base commit, on GitHub when the hub
// publishes there (`repo` is `owner/name`), else only the commit.
export const AgentPrompt = z.object({
  sections: z.array(PromptSection),
  repo: z.string().nullable(),
});
export type AgentPrompt = z.infer<typeof AgentPrompt>;

// What the model answered in one iteration: its reasoning (model output, not
// hub text), the edits it proposed, the ones the role policy refused, and why
// the answer was rejected, if it was. Capped by the hub.
export const IterationAnswer = z.object({
  reasoning: z.string().optional(),
  proposed: z
    .array(z.object({ path: z.string(), create: z.boolean() }))
    .optional(),
  refused: z.array(z.object({ path: z.string(), rule: z.string() })).optional(),
  rejected: z.string().optional(),
});
export type IterationAnswer = z.infer<typeof IterationAnswer>;
// The reply the support rep can send the customer, drafted after the task
// ended. The hub never sends it.
export const ReplyDraft = z.object({
  text: z.string(),
  source: z.enum(['model', 'template']),
});
export type ReplyDraft = z.infer<typeof ReplyDraft>;

export const TaskEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    status: TaskStatus,
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('phase'), phase: Phase }),
  z.object({
    type: z.literal('command'),
    cmd: z.string(),
    exitCode: z.number(),
    durationMs: z.number(),
    output: z.string(),
  }),
  z.object({
    type: z.literal('iteration'),
    n: z.number(),
    typeErrors: z.number(),
    testsFailed: z.number(),
    // Iterations after the baseline: the answer they checked.
    ...IterationAnswer.shape,
  }),
  z.object({
    type: z.literal('blocked'),
    kind: BlockedKind,
    detail: z.string(),
  }),
  z.object({ type: z.literal('log'), message: z.string() }),
  // The commit of the hub repo's main the task started from. Its pull
  // request's branch is cut here.
  z.object({ type: z.literal('base'), sha: z.string() }),
  // What went into the prompt: the agent's context, shown on the receipt.
  z.object({
    type: z.literal('context'),
    files: z.array(z.string()),
    decisions: z.array(ContextDoc),
  }),
  // The prompt of the agent's first call, for the receipt's Agent tab.
  z.object({ type: z.literal('prompt'), ...AgentPrompt.shape }),
  // The role policy refused an edit. Three of these flag the task.
  z.object({
    type: z.literal('policy_refused'),
    path: z.string(),
    rule: z.string(),
  }),
  // The input scanner found signs of instructions hidden in the task text.
  z.object({ type: z.literal('input_flagged'), signals: z.array(z.string()) }),
  z.object({ type: z.literal('preview'), url: z.string() }),
  // The pull request the hub opened. Followed by status `pr_opened`.
  z.object({ type: z.literal('pr'), ...PullRequest.shape }),
  // The drafted reply. Arrives after the final status and never changes it.
  z.object({ type: z.literal('reply_draft'), ...ReplyDraft.shape }),
]);
export type TaskEvent = z.infer<typeof TaskEvent>;

// What travels over the WebSocket: the event plus its position in the task's
// log, so a client that reconnects can tell what it has already seen.
export const EventEnvelope = z.object({
  seq: z.number(),
  at: z.string(),
  event: TaskEvent,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
