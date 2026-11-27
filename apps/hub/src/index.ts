import { createInference } from '@app/agent';
import {
  fetchDenied,
  removeLeftoverSandboxes,
  runInSandbox,
  sandboxConfigFromEnv,
} from '@app/sandbox';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';
import { loadHub } from './hub/load.ts';
import { createMockRunner } from './tasks/mockRunner.ts';
import { removeLeftoverScratch } from './tasks/depsCache.ts';
import { createHubSync } from './tasks/hubSync.ts';
import { createPipeline } from './tasks/pipeline.ts';
import {
  createGitHubPublisher,
  createLocalPublisher,
} from './tasks/publisher.ts';
import type { TaskRunner } from './tasks/runner.ts';

const env = loadEnv();
const hub = await loadHub(
  resolve(env.HUB_REPO_DIR),
  resolve(env.INCIDENTS_FILE)
);

let runner: TaskRunner;
if (env.RUNNER === 'real') {
  const sandbox = sandboxConfigFromEnv();
  // Absolute: it becomes a bind-mount source for every sandbox.
  const tasksDir = resolve(env.TASKS_DIR);
  await mkdir(tasksDir, { recursive: true });
  // Absolute too: cache entries are mounted at /work/node_modules.
  const depsCacheDir = resolve(env.DEPS_CACHE_DIR);
  await mkdir(depsCacheDir, { recursive: true });
  const unfinished = await removeLeftoverScratch(depsCacheDir);
  if (unfinished)
    console.log(`Removed ${unfinished} unfinished dependency installs`);
  const removed = await removeLeftoverSandboxes(sandbox);
  if (removed) console.log(`Removed ${removed} leftover sandbox containers`);
  runner = createPipeline({
    hub,
    sandbox,
    runInSandbox,
    fetchDenied,
    inference: createInference({
      baseUrl: env.INFERENCE_BASE_URL,
      apiKey: env.VULTR_INFERENCE_API_KEY!,
      model: env.INFERENCE_MODEL!,
    }),
    tasksDir,
    depsCacheDir,
    egressAdminUrl: env.EGRESS_ADMIN_URL,
    keepWorkspaces: env.KEEP_WORKSPACES,
    // One sync for the hub: every task starts from origin's main, if the
    // hub repo has an origin, under one lock.
    sync: createHubSync(hub),
    // GITHUB_REPO set: push to origin and open a pull request there.
    // Unset: a branch in the hub repo and a file:// link.
    // The env schema requires a token with GITHUB_REPO and RUNNER=real.
    publisher: env.github
      ? createGitHubPublisher({
          hubRepoDir: hub.repoDir,
          scratchDir: tasksDir,
          repo: env.github.repo,
          token: env.github.token,
          apiUrl: env.GITHUB_API_URL,
        })
      : createLocalPublisher({
          hubRepoDir: hub.repoDir,
          scratchDir: tasksDir,
        }),
    ...(env.github
      ? {
          githubRepo: `${env.github.repo.owner}/${env.github.repo.name}`,
        }
      : {}),
  });
  console.log(
    env.github
      ? `Publishing pull requests to ${env.github.repo.owner}/${env.github.repo.name}`
      : 'Publishing branches in the hub repo (GITHUB_REPO unset)'
  );
} else {
  runner = createMockRunner(hub, { previewBaseUrl: env.PREVIEW_BASE_URL });
}

const app = await buildApp({
  hub,
  runner,
  maxConcurrentTasks: env.MAX_CONCURRENT_TASKS,
  logger:
    env.NODE_ENV === 'production'
      ? { level: 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty' } },
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: env.API_HOST, port: env.API_PORT });
app.log.info(`runner: ${env.RUNNER}, repo: ${hub.repoDir}`);
