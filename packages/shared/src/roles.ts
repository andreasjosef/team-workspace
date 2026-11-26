import { z } from 'zod';

// The people who work through the hub. Each role is a policy file in the
// product repo (`.hub/roles/<role>.json`), loaded by the hub at start-up.
export const Role = z.enum(['dev', 'po', 'cs']);
export type Role = z.infer<typeof Role>;

export const TaskKind = z.enum(['bug', 'change']);
export type TaskKind = z.infer<typeof TaskKind>;

// Paths are globs relative to the repo root: `*` stays inside one directory,
// `**` crosses directories. Deny always wins over allow.
export const RolePolicy = z.object({
  name: Role,
  label: z.string().min(1),
  // One line for the UI: what this role is for.
  description: z.string(),
  // Path of the role's system prompt, relative to `.hub/`.
  systemPrompt: z.string().min(1),
  canCreate: z.array(TaskKind).min(1),
  write: z.object({
    allow: z.array(z.string().min(1)).min(1),
    deny: z.array(z.string().min(1)),
  }),
  // Lines added + removed per proposal.
  maxChangedLines: z.number().int().positive().default(200),
  // Ignored since pull requests replaced in-hub approval: a developer merges
  // on GitHub. Kept so the role files still parse; spec 5 removes it.
  approval: Role.nullable(),
});
export type RolePolicy = z.infer<typeof RolePolicy>;

// What the UI gets: the policy without the prompt path.
export const RoleSummary = RolePolicy.omit({ systemPrompt: true });
export type RoleSummary = z.infer<typeof RoleSummary>;
