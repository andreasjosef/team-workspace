import { createInference } from '@app/agent';
import { removeLeftoverSandboxes, sandboxConfigFromEnv } from '@app/sandbox';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';
import { loadHub } from './hub/load.ts';
import { createMockRunner } from './tasks/mockRunner.ts';
import { createPipeline } from './tasks/pipeline.ts';
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
  const removed = await removeLeftoverSandboxes(sandbox);
  if (removed) console.log(`Removed ${removed} leftover sandbox containers`);
  runner = createPipeline({
    hub,
    sandbox,
    inference: createInference({
      baseUrl: env.INFERENCE_BASE_URL,
      apiKey: env.VULTR_INFERENCE_API_KEY!,
      model: env.INFERENCE_MODEL!,
    }),
    tasksDir,
    egressAdminUrl: env.EGRESS_ADMIN_URL,
    keepWorkspaces: env.KEEP_WORKSPACES,
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
