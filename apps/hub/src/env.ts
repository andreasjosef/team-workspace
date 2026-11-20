import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    // Localhost only: Caddy is the one public door.
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().default(3000),
    RUNNER: z.enum(['mock', 'real']).default('mock'),
    // The hub's own checkout of the product repo (its `main`). Relative paths
    // resolve against apps/hub.
    HUB_REPO_DIR: z.string().default('../../demo/shop'),
    // Customer reports for the CS view. In a product: the support tool.
    INCIDENTS_FILE: z.string().default('../../demo/incidents.json'),
    // `{id}` is replaced with the task's short id.
    PREVIEW_BASE_URL: z.string().default('https://{id}.preview.localhost'),
    VULTR_INFERENCE_API_KEY: z.string().optional(),
    INFERENCE_BASE_URL: z.url().default('https://api.vultrinference.com/v1'),
    INFERENCE_MODEL: z.string().optional(),
    EGRESS_ADMIN_URL: z.url().default('http://127.0.0.1:8081'),
    TASKS_DIR: z.string().default('/var/lib/team-workspace/tasks'),
    MAX_CONCURRENT_TASKS: z.coerce.number().int().min(1).default(2),
    // Keep task workspaces after the run, for debugging only.
    KEEP_WORKSPACES: z.stringbool().default(false),
  })
  .refine(
    (e) =>
      e.RUNNER === 'mock' || (e.VULTR_INFERENCE_API_KEY && e.INFERENCE_MODEL),
    'RUNNER=real needs VULTR_INFERENCE_API_KEY and INFERENCE_MODEL'
  );

export type Env = z.infer<typeof EnvSchema>;

// Crash at startup on bad config rather than in the middle of a task.
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env =>
  EnvSchema.parse(source);
