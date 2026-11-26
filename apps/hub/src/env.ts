import { z } from 'zod';

// `NAME=` in an env file means unset, not an empty value.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export type GitHubRepo = { owner: string; name: string };

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
    // Warm node_modules, one per lockfile hash, mounted read-only.
    DEPS_CACHE_DIR: z.string().default('/var/lib/team-workspace/deps'),
    MAX_CONCURRENT_TASKS: z.coerce.number().int().min(1).default(2),
    // Keep task workspaces after the run, for debugging only.
    KEEP_WORKSPACES: z.stringbool().default(false),
    // The GitHub repo the hub repo is a clone of, as `owner/name`. Set, a
    // green task is pushed there and opened as a pull request; unset, it
    // stays a branch in the hub repo (the local publisher).
    GITHUB_REPO: unsetIfEmpty(
      z
        .string()
        .regex(
          /^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/,
          'GITHUB_REPO must be owner/name'
        )
        // Parsed once here: the regex allows exactly one `/`.
        .transform((repo): GitHubRepo => {
          const slash = repo.indexOf('/');
          return { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
        })
    ),
    // Fine-grained, for that one repo: contents and pull requests.
    GITHUB_TOKEN: unsetIfEmpty(z.string()),
    GITHUB_API_URL: z.url().default('https://api.github.com'),
  })
  .refine(
    (e) =>
      e.RUNNER === 'mock' || (e.VULTR_INFERENCE_API_KEY && e.INFERENCE_MODEL),
    'RUNNER=real needs VULTR_INFERENCE_API_KEY and INFERENCE_MODEL'
  )
  .refine(
    (e) => e.RUNNER === 'mock' || !e.GITHUB_REPO || e.GITHUB_TOKEN,
    'GITHUB_REPO with RUNNER=real needs GITHUB_TOKEN'
  )
  // Repo and token together, so a caller narrows once instead of asserting
  // the token: set when both are (always, with GITHUB_REPO and RUNNER=real).
  .transform((e) => ({
    ...e,
    github:
      e.GITHUB_REPO && e.GITHUB_TOKEN
        ? { repo: e.GITHUB_REPO, token: e.GITHUB_TOKEN }
        : undefined,
  }));

export type Env = z.infer<typeof EnvSchema>;

// Crash at startup on bad config rather than in the middle of a task.
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env =>
  EnvSchema.parse(source);
