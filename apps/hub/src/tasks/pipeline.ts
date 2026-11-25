import {
  applyEdits,
  buildTaskMessages,
  checkPolicy,
  countFailedTests,
  countTypeErrors,
  filesFromErrors,
  isCreate,
  matchDecisions,
  parseEditsResponse,
  rankFiles,
  resolveInside,
  runTaskLoop,
  scanTaskInput,
  topErrors,
  type CheckCounts,
  type CheckOutcome,
  type Inference,
} from '@app/agent';
import { fail, ok } from '@app/shared';
import type {
  fetchDenied,
  NetworkMode,
  runInSandbox,
  SandboxConfig,
} from '@app/sandbox';
import { lstat, readFile } from 'node:fs/promises';
import { reloadHub, type Hub } from '../hub/load.ts';
import type { TaskHandle, TaskRunner } from './runner.ts';
import {
  applyToHub,
  branchFromHub,
  checkPatch,
  createWorkspace,
  diffPaths,
  removeWorkspace,
  trackedFiles,
  type Workspace,
} from './workspace.ts';

// The real task: context → baseline → fix → (preview) → proposed. Untrusted
// code only ever runs through runInSandbox; this file runs on the host and
// holds the secrets (the inference key lives inside `inference`).
//
// Written against the same building blocks as the upgrade agent's pipeline,
// which ran end to end; this one hasn't yet. See README "What's left".

// Every side effect that leaves the host process is a dep: the hub's start-up
// wiring passes `runInSandbox`, `fetchDenied` and the live inference; the
// pipeline test passes fakes (pipeline.test.ts).
export type SandboxRunner = typeof runInSandbox;
export type DeniedLogFetch = typeof fetchDenied;

export type PipelineDeps = {
  hub: Hub;
  sandbox: SandboxConfig;
  runInSandbox: SandboxRunner;
  fetchDenied: DeniedLogFetch;
  inference: Inference;
  tasksDir: string;
  egressAdminUrl: string;
  keepWorkspaces: boolean;
};

const MAX_REFUSALS = 3;
const NETWORK_ATTEMPT =
  /ENETUNREACH|EAI_AGAIN|getaddrinfo ENOTFOUND|ECONNREFUSED/;
const tail = (s: string, n = 8000) => (s.length > n ? `…${s.slice(-n)}` : s);

export const createPipeline = (deps: PipelineDeps): TaskRunner => ({
  run: async (task) => {
    const ws = await createWorkspace(deps.tasksDir, task.id);
    try {
      await runTask(deps, task, ws);
    } finally {
      if (!deps.keepWorkspaces) await removeWorkspace(ws);
    }
  },

  // The patch was made from paths the policy allowed; check it again anyway
  // (the role file or the patch could have changed since), then commit.
  deploy: async ({ input, policy, emit }, diff) => {
    emit({ type: 'phase', phase: 'deploy' });
    const problem = checkPatch(policy, diff);
    if (problem) {
      emit({
        type: 'status',
        status: 'error',
        reason: `Patch refused at deploy: ${problem}`,
      });
      return;
    }
    const failed = await applyToHub(
      deps.hub.repoDir,
      diff,
      `${input.title}\n\nTask from ${policy.label}, approved in the hub.`
    );
    if (failed) {
      emit({ type: 'status', status: 'error', reason: failed });
      return;
    }
    await reloadHub(deps.hub);
    emit({ type: 'log', message: 'Committed to main' });
    // TODO(deploy track): push to GitHub and restart the prod container.
    emit({
      type: 'status',
      status: 'deployed',
      reason: 'Committed to main on the hub',
    });
  },
});

const runTask = async (deps: PipelineDeps, task: TaskHandle, ws: Workspace) => {
  const { id, input, policy, emit, setDiff } = task;
  const text = `${input.title}\n${input.text}`;

  const run = async (cmd: string[], network: NetworkMode) => {
    const r = await deps.runInSandbox(deps.sandbox, cmd, {
      workdir: ws.repo,
      network,
      labels: { 'team-workspace.task': id },
    });
    emit({
      type: 'command',
      cmd: cmd.join(' '),
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      output: tail(r.output),
    });
    if (r.blocked)
      emit({ type: 'blocked', kind: r.blocked.kind, detail: r.blocked.detail });
    return r;
  };

  emit({ type: 'status', status: 'working' });

  // Context: a fresh copy of main, then what the agent gets to see.
  emit({ type: 'phase', phase: 'context' });
  await branchFromHub(ws, deps.hub.repoDir);
  const signals = scanTaskInput(input.text);
  if (signals.length) emit({ type: 'input_flagged', signals });
  const sources: { path: string; content: string }[] = [];
  for (const path of await trackedFiles(ws)) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(path) || /\.(test|spec)\./.test(path))
      continue;
    const content = await readInside(ws.repo, path);
    if (content !== null) sources.push({ path, content });
  }
  const contextFiles = rankFiles(sources, text);
  const decisions = matchDecisions(deps.hub.docs, contextFiles, text);
  emit({
    type: 'context',
    files: contextFiles,
    decisions: decisions.map((d) => ({ id: d.id, title: d.title })),
  });

  // Baseline: install with registry-only network, then check with none.
  emit({ type: 'phase', phase: 'baseline' });
  const hasLock =
    (await lstat(`${ws.repo}/package-lock.json`).catch(() => null)) !== null;
  const since = Date.now();
  const installed = await run(
    hasLock ? ['npm', 'ci'] : ['npm', 'install'],
    'registry'
  );
  const denied = await deps
    .fetchDenied(deps.egressAdminUrl, since)
    .catch(() => []);
  for (const d of denied)
    emit({
      type: 'blocked',
      kind: 'network',
      detail: `${d.method} ${d.target}`,
    });
  if (installed.exitCode !== 0 || denied.length) {
    emit({
      type: 'status',
      status: 'error',
      reason: 'Installing dependencies failed or tried to reach the network',
    });
    return;
  }

  let networkAttempt: string | null = null;
  const check = async (): Promise<CheckOutcome> => {
    const tsc = await run(
      ['npx', '--no-install', 'tsc', '--noEmit', '--pretty', 'false'],
      'none'
    );
    const tests = await run(['npx', '--no-install', 'vitest', 'run'], 'none');
    const attempt = NETWORK_ATTEMPT.exec(tests.output);
    if (attempt && !networkAttempt) {
      networkAttempt = attempt[0];
      emit({
        type: 'blocked',
        kind: 'network',
        detail: `test run: ${attempt[0]} (sandbox has no network)`,
      });
    }
    return {
      typeErrors: countTypeErrors(tsc.output),
      testsFailed: countFailedTests(tests.output, tests.exitCode),
      errors: `${topErrors(tsc.output)}\n${topErrors(tests.output)}`.trim(),
    };
  };
  const first = await check();
  const baseline: CheckCounts = {
    typeErrors: first.typeErrors,
    testsFailed: first.testsFailed,
  };

  // Fix: propose → role policy → guardrails → apply → check, no network.
  emit({ type: 'phase', phase: 'fix' });
  let refusals = 0;
  const touched = new Set<string>();
  const outcome = await runTaskLoop({
    baseline,
    check,
    halt: () =>
      networkAttempt
        ? 'A test run tried to reach the network'
        : refusals >= MAX_REFUSALS
          ? `${refusals} edits refused by the ${policy.label} policy`
          : null,
    propose: async ({ latest, lastRejection }) => {
      const paths = [
        ...new Set([
          ...contextFiles,
          ...touched,
          ...filesFromErrors(latest.errors),
        ]),
      ];
      const files: { path: string; content: string }[] = [];
      for (const path of paths) {
        const content = await readInside(ws.repo, path);
        if (content !== null) files.push({ path, content });
      }
      const reply = await deps.inference.complete(
        buildTaskMessages({
          policy,
          rolePrompt: task.rolePrompt,
          task: input,
          decisions,
          files,
          errors: touched.size ? latest.errors : '',
          ...(lastRejection ? { lastRejection } : {}),
        })
      );
      return reply.success ? parseEditsResponse(reply.value) : reply;
    },
    apply: async (edits) => {
      const verdict = checkPolicy(policy, edits);
      if (!verdict.ok) {
        for (const r of verdict.refusals)
          emit({ type: 'policy_refused', path: r.path, rule: r.rule });
        refusals += verdict.refusals.length;
        return fail(
          'forbidden',
          verdict.refusals.map((r) => `${r.path}: ${r.rule}`).join('; ')
        );
      }
      const applied = await applyEdits(ws.repo, edits);
      if (!applied.success) return applied;
      for (const e of edits) touched.add(e.path);
      emit({
        type: 'log',
        message: `Applied: ${edits.map((e) => `${isCreate(e) ? 'new ' : ''}${e.path}`).join(', ')}`,
      });
      return ok(null);
    },
    onIteration: (n, c) =>
      emit({
        type: 'iteration',
        n,
        typeErrors: c.typeErrors,
        testsFailed: c.testsFailed,
      }),
    onNote: (message) => emit({ type: 'log', message }),
  });

  setDiff(await diffPaths(ws, [...touched]));
  if (outcome.status === 'halted') {
    emit({ type: 'status', status: 'flagged', reason: outcome.reason });
    return;
  }
  if (outcome.status === 'gave_up') {
    emit({ type: 'status', status: 'gave_up', reason: outcome.reason });
    return;
  }
  // TODO(sandbox track): start a preview container from this worktree and
  // emit { type: 'preview', url }. See docs/architecture.md, "Previews".
  emit({
    type: 'status',
    status: 'proposed',
    reason: 'Checks pass in the sandbox',
  });
};

const readInside = async (root: string, path: string) => {
  const resolved = await resolveInside(root, path);
  if (!resolved.success) return null;
  const s = await lstat(resolved.value);
  if (!s.isFile() || s.size > 100_000) return null;
  return readFile(resolved.value, 'utf8');
};
