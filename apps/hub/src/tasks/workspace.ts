import type { RolePolicy } from '@app/shared';
import { refusalFor } from '@app/agent';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// A task's files on the host: <tasksDir>/<id>/repo is what sandboxes see
// (mounted at /work); <tasksDir>/<id>/git is the git directory, which no
// sandbox ever sees.
//
// Why: the sandbox can write anything under /work. If .git lived there, a test
// run could set core.fsmonitor or a hook, and the next `git diff` the hub runs
// on the host would execute it. So the clone uses a separate git dir, the .git
// pointer file is deleted, and every host-side git call names --git-dir and
// --work-tree explicitly.

export type Workspace = { dir: string; repo: string; gitDir: string };

const SAFE_GIT = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.file.allow=never',
  '-c',
  'protocol.ext.allow=never',
];

// `cwd` matters: with --work-tree, `git apply` and pathspecs resolve against
// the current directory, and from the wrong one a patch lands in the hub's own
// source tree. Every call that touches a work tree runs inside it.
export const git = (
  args: string[],
  opts: { input?: string; extra?: string[]; cwd?: string } = {}
) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn('git', [...SAFE_GIT, ...(opts.extra ?? []), ...args], {
      cwd: opts.cwd ?? '/',
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        GIT_TERMINAL_PROMPT: '0',
        HOME: '/nonexistent',
        GIT_AUTHOR_NAME: 'Team hub',
        GIT_AUTHOR_EMAIL: 'hub@localhost',
        GIT_COMMITTER_NAME: 'Team hub',
        GIT_COMMITTER_EMAIL: 'hub@localhost',
      },
      timeout: 60_000,
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (err) => resolve({ code: -1, out: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
    if (child.stdin) {
      // git may exit before reading it all (a patch that doesn't apply).
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input);
    }
  });

export const createWorkspace = async (
  tasksDir: string,
  id: string
): Promise<Workspace> => {
  const dir = join(tasksDir, id);
  await mkdir(dir, { recursive: true });
  return { dir, repo: join(dir, 'repo'), gitDir: join(dir, 'git') };
};

// A fresh copy of the hub repo's committed `main`. The hub repo is trusted
// and local, so this one call allows the file protocol.
export const branchFromHub = async (ws: Workspace, hubRepoDir: string) => {
  const r = await git(
    [
      'clone',
      '--depth',
      '1',
      '--no-tags',
      '--no-hardlinks',
      '--no-recurse-submodules',
      '--separate-git-dir',
      ws.gitDir,
      '--',
      `file://${hubRepoDir}`,
      ws.repo,
    ],
    { extra: ['-c', 'protocol.file.allow=always'] }
  );
  if (r.code !== 0) throw new Error(`git clone failed: ${r.out.slice(-500)}`);
  await rm(join(ws.repo, '.git'), { force: true });
};

const inTask = (ws: Workspace) => [
  `--git-dir=${ws.gitDir}`,
  `--work-tree=${ws.repo}`,
];

export const trackedFiles = async (ws: Workspace) => {
  const r = await git([...inTask(ws), 'ls-files', '-z'], { cwd: ws.repo });
  if (r.code !== 0)
    throw new Error(`git ls-files failed: ${r.out.slice(-500)}`);
  return r.out.split('\0').filter(Boolean);
};

// The diff of exactly the files the agent edited, through the policy check,
// new files included. Anything else a test run wrote in the worktree (it can
// write anything under /work, .hub/ included) never reaches the diff.
export const diffPaths = async (ws: Workspace, paths: string[]) => {
  if (!paths.length) return '';
  const add = await git([...inTask(ws), 'add', '--', ...paths], {
    cwd: ws.repo,
  });
  if (add.code !== 0) throw new Error(`git add failed: ${add.out.slice(-500)}`);
  const r = await git(
    [
      ...inTask(ws),
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--',
      ...paths,
    ],
    { cwd: ws.repo }
  );
  if (r.code !== 0) throw new Error(`git diff failed: ${r.out.slice(-500)}`);
  return r.out;
};

export const removeWorkspace = (ws: Workspace) =>
  rm(ws.dir, { recursive: true, force: true });

// Paths a unified diff touches, from its `diff --git a/x b/y` headers.
export const diffTargets = (patch: string) => {
  const paths = new Set<string>();
  for (const m of patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    paths.add(m[1]!);
    paths.add(m[2]!);
  }
  return [...paths];
};

// The last check before a patch touches the hub repo: every path still inside
// the role's scope, and nothing git could turn into a write elsewhere.
export const checkPatch = (
  policy: RolePolicy,
  patch: string
): string | null => {
  if (/^(new |deleted )?(file )?mode 120000/m.test(patch))
    return 'the patch creates a symlink';
  if (/^GIT binary patch/m.test(patch)) return 'the patch holds binary data';
  if (/^(old|new) mode /m.test(patch)) return 'the patch changes file modes';
  for (const path of diffTargets(patch)) {
    const rule = refusalFor(policy, path);
    if (rule) return `${path}: ${rule}`;
  }
  return null;
};

// Approved: apply the patch to the hub's checkout of main and commit it. git
// apply itself refuses paths outside the repo and writes through symlinks.
export const applyToHub = async (
  hubRepoDir: string,
  patch: string,
  message: string
) => {
  const inHub = [
    `--git-dir=${join(hubRepoDir, '.git')}`,
    `--work-tree=${hubRepoDir}`,
  ];
  const applied = await git(
    [...inHub, 'apply', '--index', '--whitespace=nowarn', '-'],
    {
      input: patch,
      cwd: hubRepoDir,
    }
  );
  if (applied.code !== 0) return `git apply failed: ${applied.out.slice(-300)}`;
  const committed = await git(
    [...inHub, 'commit', '--no-verify', '-m', message],
    {
      cwd: hubRepoDir,
    }
  );
  if (committed.code !== 0)
    return `git commit failed: ${committed.out.slice(-300)}`;
  return null;
};
