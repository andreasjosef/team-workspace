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
import { createPipeline } from './tasks/pipeline.ts';
import { createLocalPublisher } from './tasks/publisher.ts';
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
    // Local only for now: a branch in the hub repo and a file:// link. The
    // GitHub publisher takes over when GITHUB_REPO is set.
    publisher: createLocalPublisher({
      hubRepoDir: hub.repoDir,
      scratchDir: tasksDir,
    }),
  });
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
