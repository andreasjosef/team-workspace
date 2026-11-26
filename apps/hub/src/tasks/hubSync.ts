import { reloadHub, type Hub } from '../hub/load.ts';
import { git, hubHead } from './workspace.ts';

// Each task starts from origin's current main (GitHub's, on the VM): a change
// a developer merged shows up in the next task's context and policies,
// without restarting the hub. Both publishers start tasks through this.
//
// Fetch + reset + reload + the task's clone run under one lock, so two tasks
// starting together each clone a consistent checkout, and no reset lands
// under a clone. The rest of each task runs in parallel. The pull request's
// branch is cut at the `baseSha` returned here, whatever main does later.
//
// The hub's only writer to its own main is this fetch.

export type SyncResult = {
  // The commit the task starts from: the checkout's HEAD after the sync.
  baseSha: string;
  // false when nothing was fetched: no origin, or the fetch failed.
  fetched: boolean;
};

export type HubSync = {
  sync: (task: {
    // A line for the task log (a failed fetch, a main that didn't load).
    log: (message: string) => void;
    // Copies the synced checkout into the task workspace, inside the lock.
    clone: (baseSha: string) => Promise<void>;
  }) => Promise<SyncResult>;
};

const ORIGIN_MAIN = 'refs/remotes/origin/main';
const short = (sha: string) => sha.slice(0, 12);
const tail = (s: string) => s.trim().split('\n').slice(-3).join(' ');

export const createHubSync = (hub: Hub): HubSync => {
  const gitDir = `--git-dir=${hub.repoDir}/.git`;
  const inCheckout = [gitDir, `--work-tree=${hub.repoDir}`];
  const hubGit = (args: string[], extra: string[] = []) =>
    git(args, { cwd: hub.repoDir, extra });

  const hasOrigin = async () =>
    (await hubGit([gitDir, 'remote', 'get-url', 'origin'])).code === 0;

  // The origin URL comes from the hub repo's own config, which only the
  // operator writes, so this one call allows the file protocol (a local
  // bare repo standing in for GitHub). Nothing a task wrote reaches it.
  const fetchMain = () =>
    hubGit(
      [
        gitDir,
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-recurse-submodules',
        'origin',
        `+refs/heads/main:${ORIGIN_MAIN}`,
      ],
      ['-c', 'protocol.file.allow=always']
    );

  const resetTo = async (sha: string) => {
    const r = await hubGit([...inCheckout, 'reset', '--quiet', '--hard', sha]);
    if (r.code !== 0) throw new Error(`git reset failed: ${r.out.slice(-500)}`);
  };

  const syncOnce: HubSync['sync'] = async ({ log, clone }) => {
    const before = await hubHead(hub.repoDir);
    if (!(await hasOrigin())) {
      await clone(before);
      return { baseSha: before, fetched: false };
    }
    const fetched = await fetchMain();
    if (fetched.code !== 0) {
      log(
        `Fetching origin main failed; starting from the last good main (${short(before)}): ${tail(fetched.out)}`
      );
      await clone(before);
      return { baseSha: before, fetched: false };
    }
    const sha = (
      await hubGit([gitDir, 'rev-parse', '--verify', ORIGIN_MAIN])
    ).out.trim();
    await resetTo(sha);
    try {
      await reloadHub(hub);
    } catch (err) {
      // A merged main the hub can't load (a broken role file): keep
      // running on the last one that loaded. reloadHub changed nothing.
      await resetTo(before);
      log(
        `origin main ${short(sha)} does not load (${err instanceof Error ? err.message : String(err)}); starting from the last good main (${short(before)})`
      );
      await clone(before);
      return { baseSha: before, fetched: true };
    }
    await clone(sha);
    return { baseSha: sha, fetched: true };
  };

  // One sync at a time, in arrival order; a failure doesn't block the next.
  let last: Promise<unknown> = Promise.resolve();
  return {
    sync: (task) => {
      const turn = last.then(() => syncOnce(task));
      last = turn.catch(() => {});
      return turn;
    },
  };
};
