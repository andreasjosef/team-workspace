import {
  applyEdits,
  buildTaskMessages,
  checkCommand,
  checkPolicy,
  filesFromErrors,
  isCreate,
  matchDecisions,
  parseEditsResponse,
  rankFiles,
  readCheckOutput,
  resolveInside,
  runTaskLoop,
  scanTaskInput,
  type CheckCounts,
  type CheckOutcome,
  type Edit,
  type Inference,
} from '@app/agent';
import { fail, ok, type Result } from '@app/shared';
import {
  CONTAINER_WORKDIR,
  scanInstallScripts,
  type ExtraMount,
  type fetchDenied,
  type NetworkMode,
  type runInSandbox,
  type SandboxConfig,
} from '@app/sandbox';
import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { reloadHub, type Hub } from '../hub/load.ts';
import {
  createScratch,
  findEntry,
  prepareMountPoint,
  promoteScratch,
  readLockfile,
  removeScratch,
} from './depsCache.ts';
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
  // Warm node_modules, one per lockfile hash (depsCache.ts).
  depsCacheDir: string;
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

  const run = async (
    cmd: string[],
    network: NetworkMode,
    { workdir = ws.repo, mounts = [] as ExtraMount[] } = {}
  ) => {
    const r = await deps.runInSandbox(deps.sandbox, cmd, {
      workdir,
      network,
      labels: { 'team-workspace.task': id },
      ...(mounts.length ? { extraMounts: mounts } : {}),
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

  // Baseline: install with registry-only network (or reuse a cached install
  // of the same lockfile), then check with none.
  emit({ type: 'phase', phase: 'baseline' });
  // One install in `workdir`, vetted: exit code, the proxy's denied log, and
  // what the install left in its node_modules (read on the host, never run).
  const install = async (
    cmd: string[],
    workdir: string
  ): Promise<Result<null>> => {
    const since = Date.now();
    const installed = await run(cmd, 'registry', { workdir });
    const denied = await deps
      .fetchDenied(deps.egressAdminUrl, since)
      .catch(() => []);
    for (const d of denied)
      emit({
        type: 'blocked',
        kind: 'network',
        detail: `${d.method} ${d.target}`,
      });
    if (installed.exitCode !== 0 || denied.length)
      return fail(
        'invalid',
        'Installing dependencies failed or tried to reach the network'
      );
    // The install ran untrusted code with /work writable: node_modules could
    // now be a symlink to anywhere on the host, which the scanner would walk
    // and a cache entry would hand to every later sandbox as a mount source.
    const nm = await lstat(join(workdir, 'node_modules')).catch(() => null);
    if (nm && !nm.isDirectory())
      return fail(
        'invalid',
        'The install left node_modules as something other than a folder'
      );
    const flagged = (await scanInstallScripts(workdir)).filter(
      (s) => s.suspicious
    );
    for (const s of flagged)
      emit({
        type: 'log',
        message: `Install script flagged: ${s.pkg} ${s.hook} (${s.reasons.join(', ')}): ${tail(s.script, 500)}`,
      });
    if (flagged.length)
      return fail(
        'invalid',
        `Suspicious install script in ${[...new Set(flagged.map((s) => s.pkg))].join(', ')}`
      );
    return ok(null);
  };

  // The dependencies every later run sees: installed into the worktree, or a
  // cache entry mounted read-only at /work/node_modules.
  const prepareDependencies = async (): Promise<Result<ExtraMount[]>> => {
    const lock = await readLockfile(ws.repo);
    if (!lock) {
      // No lockfile, nothing to key a cache by: install into the worktree.
      const installed = await install(['npm', 'install'], ws.repo);
      return installed.success ? ok([]) : installed;
    }
    let entry = await findEntry(deps.depsCacheDir, lock.key);
    if (entry) {
      emit({
        type: 'log',
        message: `Dependencies from the cache (lockfile ${lock.key.slice(0, 12)})`,
      });
    } else {
      // A miss: install in a scratch folder, and only a vetted install
      // becomes an entry. On any failure the scratch folder goes and the
      // cache is left as it was.
      const scratch = await createScratch(deps.depsCacheDir, lock);
      try {
        const installed = await install(['npm', 'ci'], scratch);
        if (!installed.success) return installed;
        // Promote only a real folder, never a symlink (install() refuses
        // one too); a missing node_modules leaves nothing to cache.
        const nm = await lstat(join(scratch, 'node_modules')).catch(() => null);
        if (!nm?.isDirectory())
          return fail('unexpected', 'The install left no node_modules folder');
        entry = await promoteScratch(deps.depsCacheDir, lock.key, scratch);
      } finally {
        await removeScratch(scratch);
      }
      emit({
        type: 'log',
        message: `Dependencies installed and cached (lockfile ${lock.key.slice(0, 12)})`,
      });
    }
    await prepareMountPoint(ws.repo);
    return ok([
      {
        source: entry,
        target: `${CONTAINER_WORKDIR}/node_modules`,
        readonly: true,
      },
    ]);
  };

  const dependencies = await prepareDependencies();
  if (!dependencies.success) {
    emit({ type: 'status', status: 'error', reason: dependencies.message });
    return;
  }
  const mounts = dependencies.value;

  let networkAttempt: string | null = null;
  const check = async (): Promise<CheckOutcome> => {
    // Type check and tests in one sandbox boot; see checkCommand.
    const ran = await run(checkCommand(), 'none', { mounts });
    const { testOutput, ...outcome } = readCheckOutput(ran.output);
    const attempt = NETWORK_ATTEMPT.exec(testOutput);
    if (attempt && !networkAttempt) {
      networkAttempt = attempt[0];
      emit({
        type: 'blocked',
        kind: 'network',
        detail: `test run: ${attempt[0]} (sandbox has no network)`,
      });
    }
    return outcome;
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
  const inScope = (edits: Edit[]): Result<null> => {
    const verdict = checkPolicy(policy, edits);
    if (verdict.ok) return ok(null);
    for (const r of verdict.refusals)
      emit({ type: 'policy_refused', path: r.path, rule: r.rule });
    refusals += verdict.refusals.length;
    return fail(
      'forbidden',
      verdict.refusals.map((r) => `${r.path}: ${r.rule}`).join('; ')
    );
  };
  const outcome = await runTaskLoop({
    baseline,
    check,
    first,
    // A bug is reproduced before it's fixed. The kind is the validated task
    // kind the role picked, not anything read from the task text.
    ...(input.kind === 'bug'
      ? {
          reproduce: {
            discard: async (paths: string[]) => {
              for (const path of paths) {
                touched.delete(path);
                await removeInside(ws.repo, path);
              }
            },
          },
        }
      : {}),
    halt: () =>
      networkAttempt
        ? 'A test run tried to reach the network'
        : refusals >= MAX_REFUSALS
          ? `${refusals} edits refused by the ${policy.label} policy`
          : null,
    propose: async ({ latest, lastRejection, step, reproduction }) => {
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
          ...(step ? { step } : {}),
          ...(reproduction ? { reproduction } : {}),
        })
      );
      return reply.success ? parseEditsResponse(reply.value) : reply;
    },
    // The loop runs this on every answer, before a bug's step rule; apply
    // runs it again before writing. An answer that passed once passes again,
    // so each refusal is emitted and counted once.
    checkScope: inScope,
    apply: async (edits) => {
      const scope = inScope(edits);
      if (!scope.success) return scope;
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
  // A flagged report never ends proposed, even when the checks are green: a
  // model that refused the report's instructions still produced a change
  // nobody asked for in good faith. Decided on host facts only (the scanner's
  // signals and the loop's outcome), never on the text. Spec 4 owns the full
  // halt rule; see docs/ticket-to-pr/README.md, "Open questions".
  if (signals.length) {
    emit({
      type: 'status',
      status: 'flagged',
      reason: `The report carried instructions (${signals.join(', ')}), so the change was not proposed`,
    });
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

// Takes out a file the agent created (a reproduction that didn't fail). Only
// a regular file, reached without following a symlink: a test run could have
// swapped it for anything since.
const removeInside = async (root: string, path: string) => {
  const resolved = await resolveInside(root, path);
  if (!resolved.success) return;
  const s = await lstat(resolved.value).catch(() => null);
  if (s?.isFile()) await rm(resolved.value);
};
