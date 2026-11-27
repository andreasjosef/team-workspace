import {
  applyEdits,
  buildTaskMessages,
  checkCommand,
  checkPolicy,
  draftReply,
  filesFromErrors,
  isCreate,
  isTestPath,
  matchDecisions,
  parseEditsResponse,
  promptSections,
  flaggedReason,
  rankFiles,
  readCheckOutput,
  resolveInside,
  runTaskLoop,
  scanReport,
  type CheckCounts,
  type CheckOutcome,
  type Edit,
  type Inference,
  type TaskContext,
} from '@app/agent';
import {
  fail,
  isFinalStatus,
  ok,
  type FinalStatus,
  type IterationAnswer,
  type Result,
  type TaskEvent,
} from '@app/shared';
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
import type { Hub } from '../hub/load.ts';
import {
  createScratch,
  findEntry,
  prepareMountPoint,
  promoteScratch,
  readLockfile,
  removeScratch,
} from './depsCache.ts';
import type { HubSync } from './hubSync.ts';
import { fixtureInference } from './fixture.ts';
import { buildPrBody } from './prBody.ts';
import { commitMessage, type Publisher } from './publisher.ts';
import type { TaskHandle, TaskRunner } from './runner.ts';
import {
  branchFromHub,
  checkPatch,
  createWorkspace,
  diffPaths,
  removeWorkspace,
  trackedFiles,
  type Workspace,
} from './workspace.ts';

// The real task: sync → context → baseline → fix → (preview) → publish, which
// opens a pull request. Untrusted code only ever runs through runInSandbox;
// this file runs on the host and holds the secrets (the inference key lives
// inside `inference`, a GitHub token inside `publisher`).
//
// Written against the same building blocks as the upgrade agent's pipeline,
// which ran end to end; this one hasn't yet. See README "What's left".

// Every side effect that leaves the host process is a dep: the hub's start-up
// wiring passes `runInSandbox`, `fetchDenied`, the live inference, the sync
// and the publisher; the pipeline test passes fakes, a local publisher and
// a hub repo with a local bare repo as its origin
// (pipeline.test.ts).
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
  // Brings the hub repo to origin's main and clones it, before each task.
  // One per hub: its lock spans every task (hubSync.ts).
  sync: HubSync;
  // Opens a green task's pull request.
  publisher: Publisher;
  // The task's page in the hub, linked from the pull request for what its
  // body leaves out.
  receiptUrl?: (taskId: string) => string;
  // GITHUB_REPO as `owner/name`, when set: the Agent tab links to `.hub/`
  // at the task's base commit there.
  githubRepo?: string;
  // How long the reply draft may take before the template stands in.
  draftTimeoutMs?: number;
};

const MAX_REFUSALS = 3;
// With the host it tried, when the error names one, so the blocked request
// says where it was going.
const NETWORK_ATTEMPT =
  /(?:ENETUNREACH|EAI_AGAIN|getaddrinfo ENOTFOUND|ECONNREFUSED)(?: [\w.-]+(?::\d+)?)?/;
const tail = (s: string, n = 8000) => (s.length > n ? `…${s.slice(-n)}` : s);
const head = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
// Caps on what the Agent tab gets: each prompt section, and per iteration
// the model's reasoning and why an answer was rejected.
const MAX_PROMPT_SECTION_CHARS = 4000;
const MAX_REASONING_CHARS = 2000;
const MAX_REJECTION_CHARS = 1000;
// The loop's own note for an answer it didn't take (fixLoop.ts).
const REJECTION_NOTE =
  /^Iteration \d+: (?:answer rejected|patch refused) \((.*)\)$/s;

export const createPipeline = (deps: PipelineDeps): TaskRunner => ({
  run: async (task) => {
    const ws = await createWorkspace(deps.tasksDir, task.id);
    // What the reply draft needs, picked off the stream as it passes.
    const seen = {
      status: null as string | null,
      decisions: [] as { id: string; title: string }[],
      diff: '',
    };
    const watched: TaskHandle = {
      ...task,
      emit: (e) => {
        if (e.type === 'status') seen.status = e.status;
        if (e.type === 'context') seen.decisions = e.decisions;
        task.emit(e);
      },
      setDiff: (d) => {
        seen.diff = d;
        task.setDiff(d);
      },
    };
    // A fault ends the task as an error here, so it gets its reply draft
    // too; rethrown after it for the queue to log (queue.ts).
    let crash: { err: unknown } | null = null;
    try {
      await runTask(deps, watched, ws);
    } catch (err) {
      crash = { err };
      if (!isFinalStatus(seen.status))
        watched.emit({
          type: 'status',
          status: 'error',
          reason: 'internal error',
        });
    } finally {
      if (!deps.keepWorkspaces) await removeWorkspace(ws);
    }
    if (isFinalStatus(seen.status))
      await emitReplyDraft(deps, task, {
        status: seen.status,
        decisions: seen.decisions,
        files: [...seen.diff.matchAll(/^diff --git a\/(\S+) b\//gm)].map(
          (m) => m[1]!
        ),
        ...(task.fixtureOf ? { fixture: true } : {}),
      });
    if (crash) throw crash.err;
  },
});

// The reply the support rep can send, drafted once the status is final: one
// more model call for the outcomes a model may describe, the template for
// the rest and for any draft that fails its rules. It never changes the
// status. Fixture runs pass `fixture: true` to get the template.
const emitReplyDraft = async (
  deps: PipelineDeps,
  { input, emit }: TaskHandle,
  facts: {
    status: FinalStatus;
    decisions: { id: string; title: string }[];
    files: string[];
    fixture?: boolean;
  }
) => {
  const { draft, fallback } = await draftReply(
    deps.inference,
    {
      ...facts,
      title: input.title,
      report: input.text,
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
    },
    deps.draftTimeoutMs === undefined ? {} : { timeoutMs: deps.draftTimeoutMs }
  );
  if (fallback)
    emit({ type: 'log', message: `Reply draft: the template (${fallback})` });
  emit({ type: 'reply_draft', ...draft });
};

const runTask = async (deps: PipelineDeps, task: TaskHandle, ws: Workspace) => {
  const { id, input, setDiff } = task;
  // Kept for the receipt (the pull request's body), which is built from
  // the stream, as the snapshot is.
  const events: TaskEvent[] = [];
  const emit = (event: TaskEvent) => {
    events.push(event);
    task.emit(event);
  };
  const reasoning: string[] = [];
  const text = `${input.title}\n${input.text}`;
  // A fixture run is driven by the scripted hostile proposal, not the model;
  // everything else below is the same pipeline.
  const inference = task.fixtureOf ? fixtureInference() : deps.inference;

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

  // Context: the hub repo brought to origin's main and cloned (one lock over
  // both), then what the agent gets to see. The pull request's branch is cut
  // at the commit synced here, whatever main does meanwhile.
  emit({ type: 'phase', phase: 'context' });
  const { baseSha } = await deps.sync.sync({
    log: (message) => emit({ type: 'log', message }),
    clone: () => branchFromHub(ws, deps.hub.repoDir),
  });
  emit({ type: 'base', sha: baseSha });
  // The role as the synced main defines it: a policy or prompt a developer
  // merged since the task was queued applies to it.
  const role = deps.hub.roles.get(input.role);
  if (!role) {
    emit({
      type: 'status',
      status: 'error',
      reason: `The synced main has no ${input.role} role`,
    });
    return;
  }
  const { policy } = role;
  const signals = scanReport(input);
  if (signals.length) emit({ type: 'input_flagged', signals });
  const sources: { path: string; content: string }[] = [];
  const tracked = await trackedFiles(ws);
  for (const path of tracked) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(path) || /\.(test|spec)\./.test(path))
      continue;
    const content = await readInside(ws.repo, path);
    if (content !== null) sources.push({ path, content });
  }
  const contextFiles = rankFiles(sources, text);
  const decisions = matchDecisions(deps.hub.docs, contextFiles, text);
  // Tests that sit next to the context files: a bug's reproduce step names
  // them, so the model picks a new file instead of one that exists.
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
  const contextDirs = new Set(contextFiles.map(dirOf));
  const existingTests = tracked.filter(
    (path) => isTestPath(path) && contextDirs.has(dirOf(path))
  );
  emit({
    type: 'context',
    files: contextFiles,
    decisions: decisions.map((d) => ({ id: d.id, title: d.title })),
  });
  // A flagged report ends here, before any install, sandbox or model call:
  // the reproduce step asks for a failing test, and a report with no real
  // bug only gets one by the model inventing a bug. Decided on host facts
  // only (the scanner's signals), never on the text. A fixture run goes on:
  // it exists to show the deeper layers stopping a hostile proposal.
  if (signals.length && !task.fixtureOf) {
    emit({ type: 'status', status: 'flagged', reason: flaggedReason(signals) });
    return;
  }

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
  // Recorded for the Agent tab, never read back by the loop: the prompt of
  // the first call, and what the model answered in the iteration under way,
  // which goes out with that iteration's check.
  let promptRecorded = false;
  let answer: IterationAnswer = {};
  const checkRoleScope = (edits: Edit[]): Result<null> => {
    const verdict = checkPolicy(policy, edits);
    if (verdict.ok) return ok(null);
    for (const r of verdict.refusals)
      emit({ type: 'policy_refused', path: r.path, rule: r.rule });
    answer.refused = [...(answer.refused ?? []), ...verdict.refusals];
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
    reproduceFirst: input.kind === 'bug',
    // A path that couldn't be taken out stays in `touched`: it may still be
    // in the worktree, so it stays in the diff for the reviewer to see.
    discard: async (paths: string[]) => {
      const left: string[] = [];
      for (const path of paths) {
        const removed = await removeInside(ws.repo, path);
        if (removed.success) touched.delete(path);
        else left.push(removed.message);
      }
      return left.length ? fail('invalid', left.join('; ')) : ok(null);
    },
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
      const ctx: TaskContext = {
        policy,
        rolePrompt: role.prompt,
        task: input,
        decisions,
        files,
        errors: touched.size ? latest.errors : '',
        ...(lastRejection ? { lastRejection } : {}),
        ...(step ? { step, existingTests } : {}),
        ...(reproduction ? { reproduction } : {}),
      };
      if (!promptRecorded) {
        promptRecorded = true;
        emit({
          type: 'prompt',
          sections: promptSections(ctx, MAX_PROMPT_SECTION_CHARS),
          repo: deps.githubRepo ?? null,
        });
      }
      const reply = await inference.complete(buildTaskMessages(ctx));
      if (!reply.success) return reply;
      const parsed = parseEditsResponse(reply.value);
      if (parsed.success && parsed.value.reasoning)
        reasoning.push(parsed.value.reasoning);
      if (parsed.success)
        answer = {
          ...(parsed.value.reasoning
            ? { reasoning: head(parsed.value.reasoning, MAX_REASONING_CHARS) }
            : {}),
          proposed: parsed.value.edits.map((e) => ({
            path: e.path,
            create: isCreate(e),
          })),
        };
      return parsed;
    },
    // The loop runs this on every answer, before a bug's step rule; apply
    // runs it again before writing. An answer that passed once passes again,
    // so each refusal is emitted and counted once.
    checkScope: checkRoleScope,
    apply: async (edits) => {
      const scope = checkRoleScope(edits);
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
    onIteration: (n, c) => {
      emit({
        type: 'iteration',
        n,
        typeErrors: c.typeErrors,
        testsFailed: c.testsFailed,
        ...answer,
      });
      answer = {};
    },
    onNote: (message) => {
      const rejected = REJECTION_NOTE.exec(message);
      if (rejected?.[1])
        answer.rejected = head(rejected[1], MAX_REJECTION_CHARS);
      emit({ type: 'log', message });
    },
  });

  const diff = await diffPaths(ws, [...touched]);
  setDiff(diff);
  // A fixture run never publishes, whatever its checks say: it ends flagged,
  // with what the layers stopped.
  if (task.fixtureOf) {
    emit({ type: 'status', status: 'flagged', reason: fixtureReason(events) });
    return;
  }
  // A flagged report never gets here: it ended after the context phase.
  // Spec 4 owns the full halt rule; see docs/ticket-to-pr/README.md, "Open
  // questions".
  if (outcome.status === 'halted') {
    emit({ type: 'status', status: 'flagged', reason: outcome.reason });
    return;
  }
  if (outcome.status === 'gave_up') {
    emit({ type: 'status', status: 'gave_up', reason: outcome.reason });
    return;
  }
  const receipt = buildPrBody({
    input,
    branch: task.branch,
    baseSha,
    events,
    files: [...touched].sort(),
    reasoning,
    receiptUrl: deps.receiptUrl?.(id) ?? null,
  });
  await publish(
    deps,
    { ...task, policy, rolePrompt: role.prompt },
    baseSha,
    diff,
    receipt
  );
};

// Green: the checked patch goes out as a pull request. The patch was made
// from paths the policy allowed; check it again anyway (a test run could
// have swapped a file for a symlink since), then hand it to the publisher.
// Nothing here touches the hub repo's main.
const publish = async (
  deps: PipelineDeps,
  { input, policy, branch, emit }: TaskHandle,
  baseSha: string,
  diff: string,
  // The receipt: the pull request's title and body (prBody.ts).
  receipt: { title: string; body: string }
) => {
  emit({ type: 'phase', phase: 'publish' });
  const problem = checkPatch(policy, diff);
  if (problem) {
    emit({
      type: 'status',
      status: 'error',
      reason: `Patch refused at publish: ${problem}`,
    });
    return;
  }
  const published = await deps.publisher.publish({
    branch,
    baseSha,
    patch: diff,
    title: receipt.title,
    body: receipt.body,
    draft: false,
    message: commitMessage(input),
    // The report id is validated by CreateTaskInput.
    labels: ['from-support', ...(input.incidentId ? [input.incidentId] : [])],
    log: (message) => emit({ type: 'log', message }),
  });
  if (!published.success) {
    emit({
      type: 'status',
      status: 'error',
      reason: `Publishing failed: ${published.message}`,
    });
    return;
  }
  emit({ type: 'pr', ...published.value, draft: false });
  emit({
    type: 'status',
    status: 'pr_opened',
    reason: `Pull request #${published.value.number} is open for a developer`,
  });
};

// What a fixture run's layers stopped, in one line.
const fixtureReason = (events: TaskEvent[]) => {
  const refused = events.filter((e) => e.type === 'policy_refused').length;
  const blocked = events.filter((e) => e.type === 'blocked').length;
  return `Fixture run: ${refused} edit${refused === 1 ? '' : 's'} refused, ${blocked} request${blocked === 1 ? '' : 's'} blocked. Nothing is published.`;
};

const readInside = async (root: string, path: string) => {
  const resolved = await resolveInside(root, path);
  if (!resolved.success) return null;
  const s = await lstat(resolved.value);
  if (!s.isFile() || s.size > 100_000) return null;
  return readFile(resolved.value, 'utf8');
};

// Takes out a file the agent created (a reproduction that didn't fail). Only
// a regular file, reached without following a symlink (resolveInside refuses
// a symlink anywhere on the path, parent folders included): a test run could
// have swapped it for anything since. Already gone counts as taken out.
const removeInside = async (
  root: string,
  path: string
): Promise<Result<null>> => {
  const resolved = await resolveInside(root, path);
  if (!resolved.success)
    return resolved.code === 'not_found' ? ok(null) : resolved;
  const s = await lstat(resolved.value);
  if (!s.isFile())
    return fail('invalid', `Not a regular file, left in place: ${path}`);
  await rm(resolved.value);
  return ok(null);
};
